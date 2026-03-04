import { connectIntegrationSchema } from "@trd-aiblitz/domain";
import { NextRequest } from "next/server";
import { getRequestContext } from "@/lib/auth";
import { connectIntegration } from "@/lib/control-plane-store";
import { encryptJson } from "@/lib/crypto";
import { fail, ok } from "@/lib/http";

interface Params {
  params: { clientId: string };
}

export async function POST(request: NextRequest, { params }: Params) {
  const ctx = getRequestContext(request);
  const body = await request.json().catch(() => null);
  const parsed = connectIntegrationSchema.safeParse(body);

  if (!parsed.success) {
    return fail("Invalid integration payload", 400, parsed.error.flatten());
  }

  const connection = connectIntegration({
    organizationId: ctx.organizationId,
    clientId: params.clientId,
    provider: "ga4",
    providerAccountId: parsed.data.providerAccountId,
    scopes: parsed.data.scopes,
    encryptedTokenPayload: {
      token: encryptJson(parsed.data.metadata)
    }
  });

  return ok({ connection }, 201);
}
