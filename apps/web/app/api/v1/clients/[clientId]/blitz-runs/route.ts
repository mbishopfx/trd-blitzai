import { createBlitzRunSchema } from "@trd-aiblitz/domain";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { getRequestContext } from "@/lib/auth";
import { createBlitzRun } from "@/lib/control-plane-store";
import { publishEvent } from "@/lib/events";
import { fail, ok } from "@/lib/http";

interface Params {
  params: { clientId: string };
}

export async function POST(request: NextRequest, { params }: Params) {
  const ctx = getRequestContext(request);
  const body = await request.json().catch(() => null);
  const parsed = createBlitzRunSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid blitz run payload", 400, parsed.error.flatten());
  }

  const run = createBlitzRun({
    organizationId: ctx.organizationId,
    clientId: params.clientId,
    createdBy: parsed.data.triggeredBy,
    policySnapshot: parsed.data.policySnapshot
  });

  await publishEvent({
    id: randomUUID(),
    type: "blitz.run.requested",
    timestamp: new Date().toISOString(),
    payload: {
      runId: run.id,
      organizationId: run.organizationId,
      clientId: run.clientId,
      triggeredBy: run.createdBy
    }
  });

  return ok({ run }, 201);
}
