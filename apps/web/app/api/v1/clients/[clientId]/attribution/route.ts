import { attributionWindowSchema } from "@trd-aiblitz/domain";
import { NextRequest } from "next/server";
import { getAttributionWindow } from "@/lib/control-plane-store";
import { fail, ok } from "@/lib/http";

interface Params {
  params: { clientId: string };
}

export async function GET(request: NextRequest, { params }: Params) {
  const windowRaw = request.nextUrl.searchParams.get("window") ?? "30d";
  const windowParsed = attributionWindowSchema.safeParse(windowRaw);
  if (!windowParsed.success) {
    return fail("Invalid attribution window", 400, windowParsed.error.flatten());
  }

  const result = getAttributionWindow(params.clientId, windowParsed.data);
  return ok(result);
}
