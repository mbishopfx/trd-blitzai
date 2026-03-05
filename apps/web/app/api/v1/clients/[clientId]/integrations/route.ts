import { NextRequest } from "next/server";
import { getRequestContext, hasRole } from "@/lib/auth";
import { getClientById, listClientIntegrations } from "@/lib/control-plane-store";
import { fail, ok } from "@/lib/http";
import { isSupabaseConfigured } from "@/lib/supabase";

interface Params {
  params: { clientId: string };
}

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

  const integrations = await listClientIntegrations(params.clientId);
  return ok({ integrations });
}
