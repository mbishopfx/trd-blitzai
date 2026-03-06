import { NextRequest } from "next/server";
import { getRequestContext, hasRole } from "@/lib/auth";
import { getClientById, updateContentArtifact } from "@/lib/control-plane-store";
import { fail, ok } from "@/lib/http";
import { isSupabaseConfigured } from "@/lib/supabase";

interface Params {
  params: { clientId: string; artifactId: string };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

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

  const body = await request.json().catch(() => null);
  const metadata = asRecord(body?.metadata);
  const title =
    typeof body?.title === "string" ? body.title : body?.title === null ? null : undefined;
  const contentBody = typeof body?.body === "string" ? body.body : undefined;
  const status = typeof body?.status === "string" ? body.status : undefined;
  const publishedAt = typeof body?.publishedAt === "string" ? body.publishedAt : undefined;
  const scheduledFor = typeof body?.scheduledFor === "string" || body?.scheduledFor === null ? body.scheduledFor : undefined;

  const updated = await updateContentArtifact(params.artifactId, {
    title,
    body: contentBody,
    status: status as "draft" | "scheduled" | "published" | "failed" | undefined,
    metadata: Object.keys(metadata).length ? metadata : undefined,
    publishedAt,
    scheduledFor
  });
  if (!updated) {
    return fail("Content artifact not found", 404);
  }
  return ok({ artifact: updated });
}
