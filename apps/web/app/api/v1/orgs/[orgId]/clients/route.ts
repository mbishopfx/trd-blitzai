import { createClientSchema } from "@trd-aiblitz/domain";
import { NextRequest } from "next/server";
import { createClient, listClientsForOrg } from "@/lib/control-plane-store";
import { fail, ok } from "@/lib/http";

interface Params {
  params: { orgId: string };
}

export async function POST(request: NextRequest, { params }: Params) {
  const body = await request.json().catch(() => null);
  const parsed = createClientSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid client payload", 400, parsed.error.flatten());
  }

  const client = createClient({
    organizationId: params.orgId,
    ...parsed.data
  });

  return ok({ client }, 201);
}

export async function GET(_request: NextRequest, { params }: Params) {
  return ok({ clients: listClientsForOrg(params.orgId) });
}
