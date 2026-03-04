import { createOrgSchema } from "@trd-aiblitz/domain";
import { NextRequest } from "next/server";
import { createOrganization, listOrganizations } from "@/lib/control-plane-store";
import { getRequestContext } from "@/lib/auth";
import { fail, ok } from "@/lib/http";
import { isSupabaseConfigured } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const context = await getRequestContext(request);
  if (isSupabaseConfigured() && !context.isAuthenticated) {
    return fail("Unauthorized", 401);
  }

  const body = await request.json().catch(() => null);
  const parsed = createOrgSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid organization payload", 400, parsed.error.flatten());
  }

  const org = await createOrganization({
    ...parsed.data,
    ownerUserId: context.isAuthenticated ? context.userId : undefined
  });
  return ok({ organization: org }, 201);
}

export async function GET(request: NextRequest) {
  const context = await getRequestContext(request);
  if (isSupabaseConfigured() && !context.isAuthenticated) {
    return fail("Unauthorized", 401);
  }

  return ok({
    organizations: await listOrganizations({
      userId: context.isAuthenticated ? context.userId : undefined
    })
  });
}
