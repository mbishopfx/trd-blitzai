import { z } from "zod";
import { NextRequest } from "next/server";
import { getRequestContext, hasRole } from "@/lib/auth";
import {
  deleteClientMediaAsset,
  getClientById,
  getClientMediaAssetById,
  updateClientMediaAsset
} from "@/lib/control-plane-store";
import { fail, ok } from "@/lib/http";
import { getSupabaseServiceClient, isSupabaseConfigured } from "@/lib/supabase";

interface Params {
  params: { clientId: string; assetId: string };
}

const patchSchema = z.object({
  isAllowedForPosts: z.boolean().optional(),
  tags: z.array(z.string().min(1).max(60)).max(30).optional(),
  metadata: z.record(z.unknown()).optional()
});

async function authorize(request: NextRequest, params: Params["params"]) {
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

  const asset = await getClientMediaAssetById(params.assetId);
  if (!asset || asset.clientId !== params.clientId) {
    return fail("Media asset not found", 404);
  }

  return { client, asset };
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await authorize(request, params);
  if (auth instanceof Response) {
    return auth;
  }

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return fail("Invalid media asset update payload", 400, parsed.error.flatten());
  }

  const updated = await updateClientMediaAsset(params.assetId, {
    isAllowedForPosts: parsed.data.isAllowedForPosts,
    tags: parsed.data.tags,
    metadata: parsed.data.metadata
  });

  return ok({ asset: updated });
}

export async function DELETE(request: NextRequest, { params }: Params) {
  const auth = await authorize(request, params);
  if (auth instanceof Response) {
    return auth;
  }

  if (isSupabaseConfigured()) {
    const supabase = getSupabaseServiceClient();
    await supabase.storage.from(auth.asset.storageBucket).remove([auth.asset.storagePath]);
  }

  await deleteClientMediaAsset(params.assetId);
  return ok({ deleted: true });
}
