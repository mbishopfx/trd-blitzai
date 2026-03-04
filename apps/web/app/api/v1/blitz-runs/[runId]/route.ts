import { NextRequest } from "next/server";
import { getRequestContext, hasRole } from "@/lib/auth";
import { getRun } from "@/lib/control-plane-store";
import { fail, ok } from "@/lib/http";
import { isSupabaseConfigured } from "@/lib/supabase";

interface Params {
  params: { runId: string };
}

export async function GET(request: NextRequest, { params }: Params) {
  const context = await getRequestContext(request);
  if (isSupabaseConfigured()) {
    if (!context.isAuthenticated) {
      return fail("Unauthorized", 401);
    }
    if (!hasRole(context, "analyst")) {
      return fail("Forbidden", 403);
    }
  }

  const run = await getRun(params.runId);
  if (!run) {
    return fail("Run not found", 404);
  }

  if (isSupabaseConfigured() && run.organizationId !== context.organizationId) {
    return fail("Forbidden", 403);
  }

  return ok({ run });
}
