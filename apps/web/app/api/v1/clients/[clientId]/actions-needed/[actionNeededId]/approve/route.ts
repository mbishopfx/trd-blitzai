import { NextRequest } from "next/server";
import { getRequestContext, hasRole } from "@/lib/auth";
import {
  getClientActionNeededById,
  getClientById,
  updateClientActionNeeded
} from "@/lib/control-plane-store";
import { applyClientGbpPatch } from "@/lib/gbp-runtime";
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
  const patch = asRecord(payload.patch);
  const updateMask = toStringArray(payload.updateMask);
  if (!Object.keys(patch).length || !updateMask.length) {
    return fail("Actions-needed item is missing patch/updateMask payload", 422);
  }

  const approvedAt = new Date().toISOString();
  await updateClientActionNeeded(record.id, {
    status: "approved",
    approvedBy: ctx.userId,
    approvedAt
  });

  try {
    const execution = await applyClientGbpPatch({
      clientId: params.clientId,
      accountName: typeof payload.accountName === "string" ? payload.accountName : null,
      locationName: typeof payload.locationName === "string" ? payload.locationName : record.locationName,
      locationId: typeof payload.locationId === "string" ? payload.locationId : record.locationId,
      patch,
      updateMask
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
