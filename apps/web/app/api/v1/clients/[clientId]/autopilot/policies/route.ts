import { upsertAutopilotPolicySchema } from "@trd-aiblitz/domain";
import { NextRequest } from "next/server";
import { getAutopilotPolicy, upsertAutopilotPolicy } from "@/lib/control-plane-store";
import { fail, ok } from "@/lib/http";

interface Params {
  params: { clientId: string };
}

export async function GET(_request: NextRequest, { params }: Params) {
  return ok({ policy: getAutopilotPolicy(params.clientId) });
}

export async function POST(request: NextRequest, { params }: Params) {
  const body = await request.json().catch(() => null);
  const parsed = upsertAutopilotPolicySchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid autopilot policy payload", 400, parsed.error.flatten());
  }

  const policy = upsertAutopilotPolicy(params.clientId, parsed.data);
  return ok({ policy });
}
