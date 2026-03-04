import { createClientSchema } from "@trd-aiblitz/domain";
import { NextRequest } from "next/server";
import { getRequestContext, hasRole } from "@/lib/auth";
import { createClient, listClientsForOrg } from "@/lib/control-plane-store";
import { fail, ok } from "@/lib/http";
import { isSupabaseConfigured } from "@/lib/supabase";

interface Params {
  params: { orgId: string };
}

export async function POST(request: NextRequest, { params }: Params) {
  const context = await getRequestContext(request);
  if (isSupabaseConfigured()) {
    if (!context.isAuthenticated) {
      return fail("Unauthorized", 401);
    }
    if (context.organizationId !== params.orgId) {
      return fail("Forbidden", 403);
    }
    if (!hasRole(context, "operator")) {
      return fail("Forbidden", 403);
    }
  }

  const body = await request.json().catch(() => null);
  const parsed = createClientSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid client payload", 400, parsed.error.flatten());
  }

  const client = await createClient({
    organizationId: params.orgId,
    ...parsed.data
  });

  return ok({ client }, 201);
}

export async function GET(request: NextRequest, { params }: Params) {
  const context = await getRequestContext(request);
  if (isSupabaseConfigured()) {
    if (!context.isAuthenticated) {
      return fail("Unauthorized", 401);
    }
    if (context.organizationId !== params.orgId) {
      return fail("Forbidden", 403);
    }
    if (!hasRole(context, "client_viewer")) {
      return fail("Forbidden", 403);
    }
  }

  return ok({ clients: await listClientsForOrg(params.orgId) });
}
