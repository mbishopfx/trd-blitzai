import { attributionWindowSchema } from "@trd-aiblitz/domain";
import { NextRequest } from "next/server";
import { getRequestContext, hasRole } from "@/lib/auth";
import { getClientById } from "@/lib/control-plane-store";
import { syncClientAttribution } from "@/lib/attribution-runtime";
import { fail, ok } from "@/lib/http";
import { isSupabaseConfigured } from "@/lib/supabase";

interface Params {
  params: { clientId: string };
}

export async function POST(request: NextRequest, { params }: Params) {
  const ctx = await getRequestContext(request);
  if (isSupabaseConfigured()) {
    if (!ctx.isAuthenticated) {
      return fail("Unauthorized", 401);
    }
    if (!hasRole(ctx, "operator")) {
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

  const body = await request.json().catch(() => ({}));
  const windowRaw = typeof body?.window === "string" ? body.window : "30d";
  const parsed = attributionWindowSchema.safeParse(windowRaw);
  if (!parsed.success) {
    return fail("Invalid attribution window", 400, parsed.error.flatten());
  }

  try {
    const summary = await syncClientAttribution({
      clientId: params.clientId,
      window: parsed.data
    });
    return ok({ summary });
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), 502);
  }
}
