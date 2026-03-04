import { NextRequest } from "next/server";
import { getRequestContext, hasRole } from "@/lib/auth";
import { rollbackAction } from "@/lib/control-plane-store";
import { fail, ok } from "@/lib/http";
import { isSupabaseConfigured } from "@/lib/supabase";

interface Params {
  params: { actionId: string };
}

export async function POST(request: NextRequest, { params }: Params) {
  const context = await getRequestContext(request);
  if (isSupabaseConfigured()) {
    if (!context.isAuthenticated) {
      return fail("Unauthorized", 401);
    }
    if (!hasRole(context, "operator")) {
      return fail("Forbidden", 403);
    }
  }

  const body = await request.json().catch(() => ({}));
  const reason = typeof body.reason === "string" && body.reason.length > 0 ? body.reason : "manual rollback";

  const result = await rollbackAction(params.actionId, reason);
  if (!result) {
    return fail("Action not found", 404);
  }

  if (isSupabaseConfigured() && result.action.organizationId !== context.organizationId) {
    return fail("Forbidden", 403);
  }

  return ok(result);
}
