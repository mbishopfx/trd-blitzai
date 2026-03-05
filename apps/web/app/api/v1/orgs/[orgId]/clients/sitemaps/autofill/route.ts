import { NextRequest } from "next/server";
import { getRequestContext, hasRole } from "@/lib/auth";
import {
  getClientOrchestrationSettings,
  listClientsForOrg,
  upsertClientOrchestrationSettings
} from "@/lib/control-plane-store";
import { fail, ok } from "@/lib/http";
import { discoverSitemapForWebsite } from "@/lib/sitemap-discovery";
import { isSupabaseConfigured } from "@/lib/supabase";

interface Params {
  params: { orgId: string };
}

interface AutofillResult {
  clientId: string;
  clientName: string;
  status: "updated" | "skipped" | "failed";
  reason?: string;
  sitemapUrl?: string | null;
  defaultPostUrl?: string | null;
}

export async function POST(request: NextRequest, { params }: Params) {
  const context = await getRequestContext(request);
  if (isSupabaseConfigured()) {
    if (!context.isAuthenticated) {
      return fail("Unauthorized", 401);
    }
    if (context.organizationId !== params.orgId) {
      return fail("Forbidden", 403);
    }
    if (!hasRole(context, "operator")) {
      return fail("Forbidden", 403);
    }
  }

  const body = await request.json().catch(() => ({} as { overwrite?: boolean }));
  const overwrite = body?.overwrite === true;

  const clients = await listClientsForOrg(params.orgId);
  const results: AutofillResult[] = [];

  for (const client of clients) {
    try {
      if (!client.websiteUrl) {
        results.push({
          clientId: client.id,
          clientName: client.name,
          status: "skipped",
          reason: "missing_website_url"
        });
        continue;
      }

      const discovery = await discoverSitemapForWebsite(client.websiteUrl);
      const existing = await getClientOrchestrationSettings(client.id);
      const nextSitemap = overwrite ? discovery.sitemapUrl : existing.sitemapUrl ?? discovery.sitemapUrl;
      const nextDefaultPostUrl = overwrite
        ? discovery.defaultPostUrl ?? existing.defaultPostUrl
        : existing.defaultPostUrl ?? discovery.defaultPostUrl;

      if (!nextSitemap && !nextDefaultPostUrl) {
        results.push({
          clientId: client.id,
          clientName: client.name,
          status: "skipped",
          reason: discovery.reason ?? "no_sitemap_found"
        });
        continue;
      }

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

      results.push({
        clientId: client.id,
        clientName: client.name,
        status: "updated",
        sitemapUrl: updated.sitemapUrl,
        defaultPostUrl: updated.defaultPostUrl
      });
    } catch (error) {
      results.push({
        clientId: client.id,
        clientName: client.name,
        status: "failed",
        reason: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const summary = {
    total: results.length,
    updated: results.filter((item) => item.status === "updated").length,
    skipped: results.filter((item) => item.status === "skipped").length,
    failed: results.filter((item) => item.status === "failed").length
  };

  return ok({
    summary,
    results
  });
}

