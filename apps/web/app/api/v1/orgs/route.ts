import { createOrgSchema } from "@trd-aiblitz/domain";
import { NextRequest } from "next/server";
import { createOrganization, listOrganizations } from "@/lib/control-plane-store";
import { fail, ok } from "@/lib/http";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = createOrgSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid organization payload", 400, parsed.error.flatten());
  }

  const org = createOrganization(parsed.data);
  return ok({ organization: org }, 201);
}

export async function GET() {
  return ok({ organizations: listOrganizations() });
}
