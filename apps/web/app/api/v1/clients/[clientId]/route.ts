import type { BlitzAction } from "@trd-aiblitz/domain";
import { NextRequest } from "next/server";
import { getRequestContext, hasRole } from "@/lib/auth";
import { deleteClientById, getClientById, listClientRuns, listRunActions } from "@/lib/control-plane-store";
import { fail, ok } from "@/lib/http";
import { isSupabaseConfigured } from "@/lib/supabase";

interface Params {
  params: { clientId: string };
}

function summarizeActions(actions: BlitzAction[]): {
  attempted: number;
  executed: number;
  failed: number;
  pending: number;
  rolledBack: number;
  skipped: number;
} {
  return actions.reduce(
    (acc, action) => {
      acc.attempted += 1;
      if (action.status === "executed") acc.executed += 1;
      if (action.status === "failed") acc.failed += 1;
      if (action.status === "pending") acc.pending += 1;
      if (action.status === "rolled_back") acc.rolledBack += 1;
      if (action.status === "skipped") acc.skipped += 1;
      return acc;
    },
    {
      attempted: 0,
      executed: 0,
      failed: 0,
      pending: 0,
      rolledBack: 0,
      skipped: 0
    }
  );
}

export async function GET(request: NextRequest, { params }: Params) {
  const ctx = await getRequestContext(request);
  if (isSupabaseConfigured()) {
    if (!ctx.isAuthenticated) {
      return fail("Unauthorized", 401);
    }
    if (!hasRole(ctx, "client_viewer")) {
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

  const runs = await listClientRuns(client.id, { limit: 15 });
  const latestRun = runs[0] ?? null;
  const latestRunActions = latestRun ? await listRunActions(latestRun.id) : [];

  const workerStatus = latestRun
    ? latestRun.status === "running" || latestRun.status === "created"
      ? "active"
      : latestRun.status === "failed"
        ? "error"
        : "idle"
    : "idle";

  return ok({
    client,
    workerStatus,
    latestRun,
    latestRunActionSummary: summarizeActions(latestRunActions),
    recentRuns: runs
  });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const ctx = await getRequestContext(request);
  if (isSupabaseConfigured()) {
    if (!ctx.isAuthenticated) {
      return fail("Unauthorized", 401);
    }
    if (!hasRole(ctx, "admin")) {
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

  const result = await deleteClientById(params.clientId, client.organizationId);
  return ok(result);
}
