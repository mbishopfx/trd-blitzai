import { NextRequest } from "next/server";
import { rollbackAction } from "@/lib/control-plane-store";
import { fail, ok } from "@/lib/http";

interface Params {
  params: { actionId: string };
}

export async function POST(request: NextRequest, { params }: Params) {
  const body = await request.json().catch(() => ({}));
  const reason = typeof body.reason === "string" && body.reason.length > 0 ? body.reason : "manual rollback";

  const result = rollbackAction(params.actionId, reason);
  if (!result) {
    return fail("Action not found", 404);
  }

  return ok(result);
}
