import { NextRequest } from "next/server";
import { getRun } from "@/lib/control-plane-store";
import { fail, ok } from "@/lib/http";

interface Params {
  params: { runId: string };
}

export async function GET(_request: NextRequest, { params }: Params) {
  const run = getRun(params.runId);
  if (!run) {
    return fail("Run not found", 404);
  }

  return ok({ run });
}
