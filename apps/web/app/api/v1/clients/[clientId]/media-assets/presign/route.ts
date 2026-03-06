import { randomUUID } from "node:crypto";
import { z } from "zod";
import { NextRequest } from "next/server";
import { getRequestContext, hasRole } from "@/lib/auth";
import { getClientById } from "@/lib/control-plane-store";
import { fail, ok } from "@/lib/http";
import { getSupabaseServiceClient, isSupabaseConfigured } from "@/lib/supabase";

interface Params {
  params: { clientId: string };
}

const DEFAULT_MEDIA_MAX_BYTES = 50 * 1024 * 1024;

function mediaMaxBytes(): number {
  const raw = process.env.CLIENT_MEDIA_MAX_BYTES;
  if (!raw) {
    return DEFAULT_MEDIA_MAX_BYTES;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MEDIA_MAX_BYTES;
  }
  return parsed;
}

const requestSchema = z.object({
  fileName: z.string().min(1).max(220),
  mimeType: z.string().min(1).max(120),
  bytes: z.number().int().positive().max(mediaMaxBytes())
});

function bucketNameForClient(clientId: string): string {
  const normalized = clientId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 42);
  return `client-${normalized || "media"}`;
}

function sanitizeFileName(value: string): string {
  const cleaned = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
  return cleaned.slice(0, 120) || `asset-${Date.now()}.jpg`;
}

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
  try {
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
      return fail("Invalid presign payload", 400, parsed.error.flatten());
    }

    const bucket = bucketNameForClient(params.clientId);
    const supabase = getSupabaseServiceClient();
    const bucketConfig = {
      public: false,
      fileSizeLimit: mediaMaxBytes(),
      allowedMimeTypes: [
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/heic",
        "image/gif",
        "video/mp4",
        "video/quicktime",
        "video/webm"
      ]
    };

    const { data: existingBucket } = await supabase.storage.getBucket(bucket);
    if (!existingBucket) {
      const { error } = await supabase.storage.createBucket(bucket, bucketConfig);
      if (error) {
        const message = error.message.toLowerCase();
        if (!message.includes("already exists") && !message.includes("duplicate")) {
          return fail(`Failed to create client media bucket: ${error.message}`, 500);
        }
      }
    }

    const fileName = sanitizeFileName(parsed.data.fileName);
    const storagePath = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${fileName}`;
    const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(storagePath, {
      upsert: false
    });
    if (error || !data) {
      return fail(`Failed to create signed upload URL: ${error?.message ?? "unknown error"}`, 500);
    }

    const baseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
    const signedUrl =
      baseUrl && data.signedUrl.startsWith("/")
        ? new URL(data.signedUrl, baseUrl).toString()
        : data.signedUrl;

    return ok({
      upload: {
        bucket,
        storagePath,
        token: data.token,
        signedUrl,
        fileName,
        mimeType: parsed.data.mimeType,
        bytes: parsed.data.bytes
      }
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to prepare media upload", 500);
  }
}
