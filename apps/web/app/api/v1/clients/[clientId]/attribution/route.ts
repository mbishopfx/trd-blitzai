import { attributionWindowSchema } from "@trd-aiblitz/domain";
import { NextRequest } from "next/server";
import { getRequestContext, hasRole } from "@/lib/auth";
import { getAttributionWindow } from "@/lib/control-plane-store";
import { fail, ok } from "@/lib/http";
import { isSupabaseConfigured } from "@/lib/supabase";

interface Params {
  params: { clientId: string };
}

export async function GET(request: NextRequest, { params }: Params) {
  const context = await getRequestContext(request);
  if (isSupabaseConfigured()) {
    if (!context.isAuthenticated) {
      return fail("Unauthorized", 401);
    }
    if (!hasRole(context, "analyst")) {
      return fail("Forbidden", 403);
    }
  }

  const windowRaw = request.nextUrl.searchParams.get("window") ?? "30d";
  const windowParsed = attributionWindowSchema.safeParse(windowRaw);
  if (!windowParsed.success) {
    return fail("Invalid attribution window", 400, windowParsed.error.flatten());
  }

  const result = await getAttributionWindow(params.clientId, windowParsed.data);
  return ok(result);
}
