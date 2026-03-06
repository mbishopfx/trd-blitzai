import { z } from "zod";
import { NextRequest } from "next/server";
import { getRequestContext, hasRole } from "@/lib/auth";
import { createClientMediaAsset, getClientById } from "@/lib/control-plane-store";
import { fail, ok } from "@/lib/http";
import { getSupabaseServiceClient, isSupabaseConfigured } from "@/lib/supabase";

interface Params {
  params: { clientId: string };
}

const requestSchema = z.object({
  bucket: z.string().min(3).max(80),
  storagePath: z.string().min(3).max(500),
  fileName: z.string().min(1).max(220),
  mimeType: z.string().min(1).max(120),
  bytes: z.number().int().positive().max(150 * 1024 * 1024)
});

async function authorize(request: NextRequest, clientId: string): Promise<{ organizationId: string } | Response> {
  const ctx = await getRequestContext(request);
  if (isSupabaseConfigured()) {
    if (!ctx.isAuthenticated) {
      return fail("Unauthorized", 401);
    }
    if (!hasRole(ctx, "operator")) {
      return fail("Forbidden", 403);
    }
  }

  const client = await getClientById(clientId);
  if (!client) {
    return fail("Client not found", 404);
  }
  if (isSupabaseConfigured() && client.organizationId !== ctx.organizationId) {
    return fail("Forbidden", 403);
  }

  return { organizationId: client.organizationId };
}

export async function POST(request: NextRequest, { params }: Params) {
  const auth = await authorize(request, params.clientId);
  if (auth instanceof Response) {
    return auth;
  }

  if (!isSupabaseConfigured()) {
    return fail("Supabase storage must be configured for media upload", 503);
  }

  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid upload completion payload", 400, parsed.error.flatten());
  }

  const supabase = getSupabaseServiceClient();
  const { data: signed, error: signedError } = await supabase.storage
    .from(parsed.data.bucket)
    .createSignedUrl(parsed.data.storagePath, 60 * 60 * 24 * 30);
  if (signedError || !signed?.signedUrl) {
    return fail(
      `Upload completion failed because the file is not accessible in storage: ${signedError?.message ?? "unknown error"}`,
      422
    );
  }

  const asset = await createClientMediaAsset({
    organizationId: auth.organizationId,
    clientId: params.clientId,
    storageBucket: parsed.data.bucket,
    storagePath: parsed.data.storagePath,
    fileName: parsed.data.fileName,
    mimeType: parsed.data.mimeType,
    bytes: parsed.data.bytes,
    isAllowedForPosts: true,
    metadata: {
      uploadedVia: "dashboard-media-upload-signed"
    }
  });

  return ok(
    {
      asset: {
        ...asset,
        previewUrl: signed.signedUrl
      }
    },
    201
  );
}
