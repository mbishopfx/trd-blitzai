import type { NextRequest } from "next/server";
import type { OrgRole } from "@trd-aiblitz/domain";

export interface RequestContext {
  organizationId: string;
  userId: string;
  role: OrgRole;
}

export function getRequestContext(request: NextRequest): RequestContext {
  const organizationId = request.headers.get("x-org-id") ?? "demo-org";
  const userId = request.headers.get("x-user-id") ?? "demo-user";
  const rawRole = request.headers.get("x-role");
  const role: OrgRole =
    rawRole === "owner" ||
    rawRole === "admin" ||
    rawRole === "operator" ||
    rawRole === "analyst" ||
    rawRole === "client_viewer"
      ? rawRole
      : "owner";

  return {
    organizationId,
    userId,
    role
  };
}
