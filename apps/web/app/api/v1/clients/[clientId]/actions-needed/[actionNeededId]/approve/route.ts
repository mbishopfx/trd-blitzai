import { NextRequest } from "next/server";
import { getRequestContext, hasRole } from "@/lib/auth";
import {
  getClientActionNeededById,
  getClientById,
  updateClientActionNeeded
} from "@/lib/control-plane-store";
import {
  applyClientGbpPatch,
  executeClientGbpOperations,
  type GbpExecutionOperation
} from "@/lib/gbp-runtime";
import { fail, ok } from "@/lib/http";
import { isSupabaseConfigured } from "@/lib/supabase";

interface Params {
  params: { clientId: string; actionNeededId: string };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(String).map((entry) => entry.trim()).filter(Boolean);
}

function parseExecutionOperations(payload: Record<string, unknown>): GbpExecutionOperation[] {
  const executionPlan = asRecord(payload.executionPlan);
  const operationsRaw = Array.isArray(executionPlan.operations) ? executionPlan.operations : [];
  const operations: GbpExecutionOperation[] = [];

  for (const raw of operationsRaw) {
    const record = asRecord(raw);
    const kind = typeof record.kind === "string" ? record.kind : "";
    if (kind === "patch_location") {
      const patch = asRecord(record.patch);
      const updateMask = toStringArray(record.updateMask);
      if (!Object.keys(patch).length || !updateMask.length) {
        continue;
      }
      operations.push({
        kind: "patch_location",
        patch,
        updateMask
      });
      continue;
    }
    if (kind === "update_attributes") {
      const attributeMask = toStringArray(record.attributeMask);
      const attributes = Array.isArray(record.attributes)
        ? record.attributes.map((entry) => asRecord(entry)).filter((entry) => Object.keys(entry).length > 0)
        : [];
      if (!attributeMask.length || !attributes.length) {
        continue;
      }
      operations.push({
        kind: "update_attributes",
        attributes,
        attributeMask
      });
      continue;
    }
    if (kind === "upsert_place_action_links") {
      const links = Array.isArray(record.links)
        ? record.links.map((entry) => asRecord(entry)).filter((entry) => Object.keys(entry).length > 0)
        : [];
      if (!links.length) {
        continue;
      }
      operations.push({
        kind: "upsert_place_action_links",
        links
      });
    }
  }

  return operations;
}

export async function POST(request: NextRequest, { params }: Params) {
  const ctx = await getRequestContext(request);
  if (isSupabaseConfigured()) {
    if (!ctx.isAuthenticated) {
      return fail("Unauthorized", 401);
    }
    if (!hasRole(ctx, "operator")) {
      return fail("Forbidden", 403);
    }
  }

  const client = await getClientById(params.clientId);
  if (!client) {
    return fail("Client not found", 404);
  }
  if (isSupabaseConfigured() && client.organizationId !== ctx.organizationId) {
    return fail("Forbidden", 403);
  }

  const record = await getClientActionNeededById(params.actionNeededId);
  if (!record || record.clientId !== params.clientId) {
    return fail("Actions-needed item not found", 404);
  }
  if (record.status !== "pending") {
    return fail(`Actions-needed item cannot be approved from status '${record.status}'`, 409);
  }
  if (record.provider !== "gbp") {
    return fail(`Provider '${record.provider}' approval execution is not implemented`, 422);
  }

  const payload = asRecord(record.payload);
  const operations = parseExecutionOperations(payload);
  const legacyPatch = asRecord(payload.patch);
  const legacyUpdateMask = toStringArray(payload.updateMask);
  if (!operations.length && (!Object.keys(legacyPatch).length || !legacyUpdateMask.length)) {
    return fail("Actions-needed item is missing executable operation payload", 422);
  }

  const approvedAt = new Date().toISOString();
  await updateClientActionNeeded(record.id, {
    status: "approved",
    approvedBy: ctx.userId,
    approvedAt
  });

  try {
    const execution =
      operations.length > 0
        ? await executeClientGbpOperations({
            clientId: params.clientId,
            accountName: typeof payload.accountName === "string" ? payload.accountName : null,
            locationName: typeof payload.locationName === "string" ? payload.locationName : record.locationName,
            locationId: typeof payload.locationId === "string" ? payload.locationId : record.locationId,
            operations
          })
        : await applyClientGbpPatch({
            clientId: params.clientId,
            accountName: typeof payload.accountName === "string" ? payload.accountName : null,
            locationName: typeof payload.locationName === "string" ? payload.locationName : record.locationName,
            locationId: typeof payload.locationId === "string" ? payload.locationId : record.locationId,
            patch: legacyPatch,
            updateMask: legacyUpdateMask
          });

    const updated = await updateClientActionNeeded(record.id, {
      status: "executed",
      approvedBy: ctx.userId,
      approvedAt,
      executedAt: execution.executedAt,
      result: {
        ...record.result,
        execution
      }
    });

    return ok({ actionNeeded: updated, execution });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const updated = await updateClientActionNeeded(record.id, {
      status: "failed",
      approvedBy: ctx.userId,
      approvedAt,
      result: {
        ...record.result,
        error: message,
        failedAt: new Date().toISOString()
      }
    });
    return fail(`Approval execution failed: ${message}`, 502, {
      actionNeeded: updated
    });
  }
}
