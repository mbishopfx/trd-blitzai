import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { getRequestContext, hasRole } from "@/lib/auth";
import {
  createClientMediaAsset,
  getClientById,
  listClientMediaAssets
} from "@/lib/control-plane-store";
import { fail, ok } from "@/lib/http";
import { getSupabaseServiceClient, isSupabaseConfigured } from "@/lib/supabase";

interface Params {
  params: { clientId: string };
}

function bucketNameForClient(clientId: string): string {
  const normalized = clientId.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 42);
  return `client-${normalized || "media"}`;
}

function sanitizeFileName(value: string): string {
  const cleaned = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-");
  return cleaned.slice(0, 120) || `asset-${Date.now()}.jpg`;
}

async function resolveAuthClient(request: NextRequest, clientId: string): Promise<{ organizationId: string } | Response> {
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

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await resolveAuthClient(request, params.clientId);
  if (auth instanceof Response) {
    return auth;
  }

  const assets = await listClientMediaAssets(params.clientId);
  if (!isSupabaseConfigured()) {
    return ok({ assets });
  }

  const supabase = getSupabaseServiceClient();
  const withPreview = await Promise.all(
    assets.map(async (asset) => {
      const { data } = await supabase.storage.from(asset.storageBucket).createSignedUrl(asset.storagePath, 60 * 60 * 24 * 30);
      return {
        ...asset,
        previewUrl: data?.signedUrl ?? null
      };
    })
  );

  return ok({ assets: withPreview });
}

export async function POST(request: NextRequest, { params }: Params) {
  const auth = await resolveAuthClient(request, params.clientId);
  if (auth instanceof Response) {
    return auth;
  }

  if (!isSupabaseConfigured()) {
    return fail("Supabase storage must be configured to upload media assets", 503);
  }

  const contentType = request.headers.get("content-type") ?? "";
  const supabase = getSupabaseServiceClient();
  const bucket = bucketNameForClient(params.clientId);

  const { data: existingBucket } = await supabase.storage.getBucket(bucket);
  if (!existingBucket) {
    const { error: createBucketError } = await supabase.storage.createBucket(bucket, {
      public: false,
      fileSizeLimit: 25 * 1024 * 1024,
      allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/heic", "image/gif"]
    });
    if (createBucketError && !createBucketError.message.toLowerCase().includes("already exists")) {
      return fail(`Failed to create client media bucket: ${createBucketError.message}`, 500);
    }
  }

  let fileName = "";
  let mimeType = "application/octet-stream";
  let bytes = 0;
  let buffer: Buffer;

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return fail("Multipart upload requires a file field named 'file'", 400);
    }

    fileName = sanitizeFileName(file.name || `asset-${Date.now()}.jpg`);
    mimeType = file.type || "application/octet-stream";
    const arrayBuffer = await file.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
    bytes = buffer.byteLength;
  } else {
    const body = await request.json().catch(() => null) as
      | {
          fileName?: string;
          mimeType?: string;
          base64Data?: string;
        }
      | null;
    if (!body?.base64Data) {
      return fail("JSON upload requires base64Data", 400);
    }

    fileName = sanitizeFileName(body.fileName ?? `asset-${Date.now()}.jpg`);
    mimeType = body.mimeType ?? "application/octet-stream";
    buffer = Buffer.from(body.base64Data, "base64");
    bytes = buffer.byteLength;
  }

  const storagePath = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${fileName}`;
  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(storagePath, buffer, {
      contentType: mimeType,
      upsert: false
    });

  if (uploadError) {
    return fail(`Failed to upload media asset: ${uploadError.message}`, 500);
  }

  const asset = await createClientMediaAsset({
    organizationId: auth.organizationId,
    clientId: params.clientId,
    storageBucket: bucket,
    storagePath,
    fileName,
    mimeType,
    bytes,
    isAllowedForPosts: true,
    metadata: {
      uploadedVia: "dashboard-media-upload"
    }
  });

  const { data: signed } = await supabase.storage.from(bucket).createSignedUrl(storagePath, 60 * 60 * 24 * 30);
  return ok(
    {
      asset: {
        ...asset,
        previewUrl: signed?.signedUrl ?? null
      }
    },
    201
  );
}
