import { createApiKeySchema } from "@trd-aiblitz/domain";
import { NextRequest } from "next/server";
import { getRequestContext, hasRole } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { getSupabaseServiceClient, isSupabaseConfigured } from "@/lib/supabase";

interface Params {
  params: { orgId: string };
}

export async function GET(request: NextRequest, { params }: Params) {
  if (!isSupabaseConfigured()) {
    return fail("Supabase is not configured", 503);
  }

  const context = await getRequestContext(request);
  if (!context.isAuthenticated) {
    return fail("Unauthorized", 401);
  }
  if (context.organizationId !== params.orgId) {
    return fail("Forbidden", 403);
  }
  if (!hasRole(context, "admin")) {
    return fail("Forbidden", 403);
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase
    .from("api_keys")
    .select("id,name,key_prefix,scopes,status,last_used_at,expires_at,created_at,revoked_at")
    .eq("organization_id", params.orgId)
    .order("created_at", { ascending: false });
  if (error) {
    return fail("Failed to list API keys", 500, error.message);
  }

  return ok({ apiKeys: data ?? [] });
}

export async function POST(request: NextRequest, { params }: Params) {
  if (!isSupabaseConfigured()) {
    return fail("Supabase is not configured", 503);
  }

  const context = await getRequestContext(request);
  if (!context.isAuthenticated) {
    return fail("Unauthorized", 401);
  }
  if (context.organizationId !== params.orgId) {
    return fail("Forbidden", 403);
  }
  if (!hasRole(context, "admin")) {
    return fail("Forbidden", 403);
  }

  const body = await request.json().catch(() => null);
  const parsed = createApiKeySchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid API key payload", 400, parsed.error.flatten());
  }

  const supabase = getSupabaseServiceClient();
  const { data, error } = await supabase.rpc("create_api_key", {
    p_organization_id: params.orgId,
    p_name: parsed.data.name,
    p_scopes: parsed.data.scopes,
    p_expires_at: parsed.data.expiresAt ?? null,
    p_metadata: parsed.data.metadata
  });
  if (error) {
    return fail("Failed to create API key", 500, error.message);
  }

  const created = Array.isArray(data) && data.length > 0 ? data[0] : null;
  if (!created) {
    return fail("API key was not returned by RPC", 500);
  }

  const actorType = context.userId.startsWith("api-key:") ? "api_key" : "user";
  await supabase.from("audit_events").insert({
    organization_id: params.orgId,
    actor_id: context.userId,
    actor_type: actorType,
    action: "api_key.created",
    entity_type: "api_key",
    entity_id: String(created.key_id),
    policy_snapshot: {
      scopes: parsed.data.scopes
    },
    after_state: {
      keyPrefix: created.key_prefix,
      name: parsed.data.name
    }
  });

  return ok(
    {
      apiKey: {
        id: created.key_id,
        keyPrefix: created.key_prefix,
        secret: created.key_secret
      }
    },
    201
  );
}
