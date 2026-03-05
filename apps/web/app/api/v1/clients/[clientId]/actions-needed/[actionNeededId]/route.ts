import { z } from "zod";
import { NextRequest } from "next/server";
import { getRequestContext, hasRole } from "@/lib/auth";
import {
  getClientActionNeededById,
  getClientById,
  updateClientActionNeeded
} from "@/lib/control-plane-store";
import { fail, ok } from "@/lib/http";
import { isSupabaseConfigured } from "@/lib/supabase";

interface Params {
  params: { clientId: string; actionNeededId: string };
}

const patchSchema = z.object({
  status: z.enum(["dismissed", "manual_completed"]),
  note: z.string().trim().max(2000).optional()
});

export async function PATCH(request: NextRequest, { params }: Params) {
  const ctx = await getRequestContext(request);
  if (isSupabaseConfigured()) {
    if (!ctx.isAuthenticated) {
      return fail("Unauthorized", 401);
    }
    if (!hasRole(ctx, "operator")) {
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

  const record = await getClientActionNeededById(params.actionNeededId);
  if (!record || record.clientId !== params.clientId) {
    return fail("Actions-needed item not found", 404);
  }

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid actions-needed update payload", 400, parsed.error.flatten());
  }

  const nextResult: Record<string, unknown> = {
    ...record.result,
    statusUpdatedBy: ctx.userId,
    statusUpdatedAt: new Date().toISOString()
  };
  if (parsed.data.note) {
    nextResult.note = parsed.data.note;
  }

  const updated = await updateClientActionNeeded(params.actionNeededId, {
    status: parsed.data.status,
    result: nextResult
  });
  if (!updated) {
    return fail("Failed to update actions-needed item", 500);
  }

  return ok({ actionNeeded: updated });
}
