import { z } from "zod";
import { NextRequest } from "next/server";
import { getRequestContext, hasRole } from "@/lib/auth";
import { getClientById } from "@/lib/control-plane-store";
import { fail, ok } from "@/lib/http";
import { postClientReviewReply } from "@/lib/gbp-runtime";
import { isSupabaseConfigured } from "@/lib/supabase";

interface Params {
  params: { clientId: string; reviewId: string };
}

const replySchema = z.object({
  comment: z.string().min(2).max(4096)
});

export async function POST(request: NextRequest, { params }: Params) {
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

  const body = await request.json().catch(() => null);
  const parsed = replySchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid review reply payload", 400, parsed.error.flatten());
  }

  const reply = await postClientReviewReply({
    clientId: params.clientId,
    reviewId: params.reviewId,
    comment: parsed.data.comment
  });

  return ok({ reply });
}
