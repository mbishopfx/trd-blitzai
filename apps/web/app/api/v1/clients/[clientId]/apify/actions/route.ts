import { z } from "zod";
import { NextRequest } from "next/server";
import { getRequestContext, hasRole } from "@/lib/auth";
import { apifyActionKeys, listApifyRunsForClient, runApifyAction } from "@/lib/apify";
import { getClientById } from "@/lib/control-plane-store";
import { fail, ok } from "@/lib/http";
import { isSupabaseConfigured } from "@/lib/supabase";

interface Params {
  params: { clientId: string };
}

const runActionSchema = z.object({
  actionKey: z.enum(apifyActionKeys)
});

async function loadAuthorizedClient(request: NextRequest, clientId: string, minRole: "analyst" | "operator") {
  const ctx = await getRequestContext(request);
  if (isSupabaseConfigured()) {
    if (!ctx.isAuthenticated) {
      return { error: fail("Unauthorized", 401) };
    }
    if (!hasRole(ctx, minRole)) {
      return { error: fail("Forbidden", 403) };
    }
  }

  const client = await getClientById(clientId);
  if (!client) {
    return { error: fail("Client not found", 404) };
  }

  if (isSupabaseConfigured() && client.organizationId !== ctx.organizationId) {
    return { error: fail("Forbidden", 403) };
  }

  return { client, ctx };
}

export async function GET(request: NextRequest, { params }: Params) {
  const authorized = await loadAuthorizedClient(request, params.clientId, "analyst");
  if ("error" in authorized) {
    return authorized.error;
  }

  const runs = await listApifyRunsForClient(authorized.client.id, authorized.client.organizationId);
  return ok({ runs });
}

export async function POST(request: NextRequest, { params }: Params) {
  const authorized = await loadAuthorizedClient(request, params.clientId, "operator");
  if ("error" in authorized) {
    return authorized.error;
  }

  const body = await request.json().catch(() => null);
  const parsed = runActionSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid Apify action payload", 400, parsed.error.flatten());
  }

  const run = await runApifyAction({
    actionKey: parsed.data.actionKey,
    client: {
      id: authorized.client.id,
      organizationId: authorized.client.organizationId,
      name: authorized.client.name,
      websiteUrl: authorized.client.websiteUrl,
      primaryLocationLabel: authorized.client.primaryLocationLabel
    },
    createdBy: authorized.ctx.userId
  });

  return ok({ run }, 201);
}
