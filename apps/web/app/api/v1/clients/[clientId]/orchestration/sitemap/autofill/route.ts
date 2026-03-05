import { NextRequest } from "next/server";
import { getRequestContext, hasRole } from "@/lib/auth";
import {
  getClientById,
  getClientOrchestrationSettings,
  upsertClientOrchestrationSettings
} from "@/lib/control-plane-store";
import { fail, ok } from "@/lib/http";
import { discoverSitemapForWebsite } from "@/lib/sitemap-discovery";
import { isSupabaseConfigured } from "@/lib/supabase";

interface Params {
  params: { clientId: string };
}

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

  if (!client.websiteUrl) {
    return fail("Client website URL is missing. Add website URL first before sitemap autofill.", 400);
  }

  const body = await request.json().catch(() => ({} as { overwrite?: boolean }));
  const overwrite = body?.overwrite === true;

  const discovery = await discoverSitemapForWebsite(client.websiteUrl);
  const existing = await getClientOrchestrationSettings(client.id);

  const nextSitemap = overwrite ? discovery.sitemapUrl : existing.sitemapUrl ?? discovery.sitemapUrl;
  const nextDefaultPostUrl = overwrite
    ? discovery.defaultPostUrl ?? existing.defaultPostUrl
    : existing.defaultPostUrl ?? discovery.defaultPostUrl;

  const updated = await upsertClientOrchestrationSettings(client.id, {
    tone: existing.tone,
    objectives: existing.objectives,
    photoAssetUrls: existing.photoAssetUrls,
    photoAssetIds: existing.photoAssetIds,
    sitemapUrl: nextSitemap,
    defaultPostUrl: nextDefaultPostUrl,
    reviewReplyStyle: existing.reviewReplyStyle,
    postFrequencyPerWeek: existing.postFrequencyPerWeek,
    postWordCountMin: existing.postWordCountMin,
    postWordCountMax: existing.postWordCountMax,
    eeatStructuredSnippetEnabled: existing.eeatStructuredSnippetEnabled,
    metadata: {
      ...existing.metadata,
      sitemapAutofill: {
        source: discovery.source,
        checkedUrls: discovery.checkedUrls,
        reason: discovery.reason ?? null,
        updatedAt: new Date().toISOString()
      }
    }
  });

  return ok({
    clientId: client.id,
    clientName: client.name,
    websiteUrl: client.websiteUrl,
    updatedSitemapUrl: updated.sitemapUrl,
    updatedDefaultPostUrl: updated.defaultPostUrl,
    discovery
  });
}

