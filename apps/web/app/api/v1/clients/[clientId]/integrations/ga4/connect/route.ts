import { connectIntegrationSchema } from "@trd-aiblitz/domain";
import { NextRequest } from "next/server";
import { getRequestContext, hasRole } from "@/lib/auth";
import { connectIntegration } from "@/lib/control-plane-store";
import { encryptJson } from "@/lib/crypto";
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
    if (!hasRole(ctx, "admin")) {
      return fail("Forbidden", 403);
    }
  }

  const body = await request.json().catch(() => null);
  const parsed = connectIntegrationSchema.safeParse(body);

  if (!parsed.success) {
    return fail("Invalid integration payload", 400, parsed.error.flatten());
  }

  const connection = await connectIntegration({
    organizationId: ctx.organizationId,
    clientId: params.clientId,
    provider: "ga4",
    providerAccountId: parsed.data.providerAccountId,
    scopes: parsed.data.scopes,
    encryptedTokenPayload: {
      token: encryptJson(parsed.data.metadata)
    },
    metadata: parsed.data.metadata
  });

  return ok({ connection }, 201);
}
