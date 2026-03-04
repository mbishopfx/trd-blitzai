import type { NextRequest } from "next/server";
import type { OrgRole } from "@trd-aiblitz/domain";
import { getSupabaseServiceClient, isSupabaseConfigured } from "./supabase";

export interface RequestContext {
  organizationId: string;
  userId: string;
  role: OrgRole;
  isAuthenticated: boolean;
}

const roleRank: Record<OrgRole, number> = {
  owner: 5,
  admin: 4,
  operator: 3,
  analyst: 2,
  client_viewer: 1
};

function normalizeRole(value: string | null): OrgRole {
  if (value === "owner" || value === "admin" || value === "operator" || value === "analyst" || value === "client_viewer") {
    return value;
  }
  return "owner";
}

function getFallbackContext(request: NextRequest): RequestContext {
  return {
    organizationId: request.headers.get("x-org-id") ?? "demo-org",
    userId: request.headers.get("x-user-id") ?? "demo-user",
    role: normalizeRole(request.headers.get("x-role")),
    isAuthenticated: false
  };
}

function getBearerToken(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) {
    return null;
  }

  const [scheme, token] = authHeader.split(" ", 2);
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    return null;
  }
  return token;
}

export async function getRequestContext(request: NextRequest): Promise<RequestContext> {
  const fallback = getFallbackContext(request);
  if (!isSupabaseConfigured()) {
    return fallback;
  }

  const supabase = getSupabaseServiceClient();
  const apiKey = request.headers.get("x-api-key");
  if (apiKey) {
    const { data, error } = await supabase.rpc("resolve_api_key", {
      raw_key: apiKey
    });
    const resolved = Array.isArray(data) && data.length > 0 ? data[0] : null;

    if (!error && resolved?.organization_id && resolved?.key_id) {
      await supabase.from("api_keys").update({ last_used_at: new Date().toISOString() }).eq("id", resolved.key_id);
      return {
        organizationId: String(resolved.organization_id),
        userId: `api-key:${resolved.key_id}`,
        role: "admin",
        isAuthenticated: true
      };
    }
  }

  const token = getBearerToken(request);
  if (!token) {
    return fallback;
  }

  const { data: userResult, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userResult.user) {
    return fallback;
  }

  const headerOrgId = request.headers.get("x-org-id");
  const membershipQuery = supabase
    .from("organization_users")
    .select("organization_id, role")
    .eq("user_id", userResult.user.id)
    .limit(1);

  const { data: membership, error: membershipError } = headerOrgId
    ? await membershipQuery.eq("organization_id", headerOrgId).maybeSingle()
    : await membershipQuery.maybeSingle();

  if (membershipError || !membership) {
    return {
      ...fallback,
      userId: userResult.user.id,
      isAuthenticated: true
    };
  }

  return {
    organizationId: membership.organization_id,
    userId: userResult.user.id,
    role: normalizeRole(membership.role),
    isAuthenticated: true
  };
}

export function hasRole(context: RequestContext, minRole: OrgRole): boolean {
  return roleRank[context.role] >= roleRank[minRole];
}
