import { blitzPhaseSchema } from "@trd-aiblitz/domain";
import { NextRequest } from "next/server";
import { getRequestContext, hasRole } from "@/lib/auth";
import { getClientById, listClientContentArtifacts } from "@/lib/control-plane-store";
import { fail, ok } from "@/lib/http";
import { isSupabaseConfigured } from "@/lib/supabase";

interface Params {
  params: { clientId: string };
}

const statusValues = new Set(["draft", "scheduled", "published", "failed", "all"]);

export async function GET(request: NextRequest, { params }: Params) {
  const ctx = await getRequestContext(request);
  if (isSupabaseConfigured()) {
    if (!ctx.isAuthenticated) {
      return fail("Unauthorized", 401);
    }
    if (!hasRole(ctx, "analyst")) {
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

  const channel = request.nextUrl.searchParams.get("channel") ?? undefined;
  const phaseRaw = request.nextUrl.searchParams.get("phase");
  const statusRaw = request.nextUrl.searchParams.get("status") ?? "all";
  const limitRaw = Number(request.nextUrl.searchParams.get("limit") ?? "100");

  const phase = phaseRaw ? blitzPhaseSchema.parse(phaseRaw) : undefined;
  const status = statusValues.has(statusRaw) ? statusRaw : "all";
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 300)) : 100;

  const artifacts = await listClientContentArtifacts(params.clientId, {
    channel,
    phase,
    status: status as "draft" | "scheduled" | "published" | "failed" | "all",
    limit
  });
  return ok({ artifacts });
}
