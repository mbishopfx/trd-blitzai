import { upsertAutopilotPolicySchema } from "@trd-aiblitz/domain";
import { NextRequest } from "next/server";
import { getRequestContext, hasRole } from "@/lib/auth";
import { getAutopilotPolicy, upsertAutopilotPolicy } from "@/lib/control-plane-store";
import { fail, ok } from "@/lib/http";
import { isSupabaseConfigured } from "@/lib/supabase";

interface Params {
  params: { clientId: string };
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

  return ok({ policy: await getAutopilotPolicy(params.clientId) });
}

export async function POST(request: NextRequest, { params }: Params) {
  const context = await getRequestContext(request);
  if (isSupabaseConfigured()) {
    if (!context.isAuthenticated) {
      return fail("Unauthorized", 401);
    }
    if (!hasRole(context, "admin")) {
      return fail("Forbidden", 403);
    }
  }

  const body = await request.json().catch(() => null);
  const parsed = upsertAutopilotPolicySchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid autopilot policy payload", 400, parsed.error.flatten());
  }

  const policy = await upsertAutopilotPolicy(params.clientId, parsed.data);
  return ok({ policy });
}
