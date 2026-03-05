import { z } from "zod";
import { NextRequest } from "next/server";
import { getRequestContext, hasRole } from "@/lib/auth";
import { getClientById, listClientActionsNeeded } from "@/lib/control-plane-store";
import { fail, ok } from "@/lib/http";
import { isSupabaseConfigured } from "@/lib/supabase";

interface Params {
  params: { clientId: string };
}

const querySchema = z.object({
  status: z.enum(["pending", "approved", "executed", "failed", "dismissed", "manual_completed", "all"]).optional(),
  limit: z.coerce.number().int().positive().max(500).optional()
});

export async function GET(request: NextRequest, { params }: Params) {
  const ctx = await getRequestContext(request);
  if (isSupabaseConfigured()) {
    if (!ctx.isAuthenticated) {
      return fail("Unauthorized", 401);
    }
    if (!hasRole(ctx, "analyst")) {
      return fail("Forbidden", 403);
    }
  }

  const client = await getClientById(params.clientId);
  if (!client) {
    return fail("Client not found", 404);
  }
  if (isSupabaseConfigured() && client.organizationId !== ctx.organizationId) {
    return fail("Forbidden", 403);
  }

  const parsed = querySchema.safeParse({
    status: request.nextUrl.searchParams.get("status") ?? undefined,
    limit: request.nextUrl.searchParams.get("limit") ?? undefined
  });
  if (!parsed.success) {
    return fail("Invalid query parameters", 400, parsed.error.flatten());
  }

  const actionsNeeded = await listClientActionsNeeded(params.clientId, {
    status: parsed.data.status ?? "pending",
    limit: parsed.data.limit ?? 200
  });

  return ok({ actionsNeeded });
}
