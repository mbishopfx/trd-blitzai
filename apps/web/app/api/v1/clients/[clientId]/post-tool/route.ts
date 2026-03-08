import { NextRequest } from "next/server";
import { getRequestContext, hasRole } from "@/lib/auth";
import {
  createContentArtifact,
  getClientById,
  getClientOrchestrationSettings,
  listClientContentArtifacts,
  listClientMediaAssets,
  updateContentArtifact
} from "@/lib/control-plane-store";
import { fail, ok } from "@/lib/http";
import { discoverSitemapForWebsite, listUrlsFromSitemap } from "@/lib/sitemap-discovery";
import { isSupabaseConfigured } from "@/lib/supabase";

interface Params {
  params: { clientId: string };
}

type PostToolMode = "single" | "spawn3";

interface PostToolPayload {
  action?: unknown;
  mode?: unknown;
  landingUrls?: unknown;
  toneOverride?: unknown;
  systemMessage?: unknown;
  artifactIds?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function normalizeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(String).map((entry) => entry.trim()).filter(Boolean);
}

function shuffleInPlace<T>(items: T[]): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
}

function daysFromNow(dayOffset: number): string {
  return new Date(Date.now() + dayOffset * 24 * 60 * 60 * 1000).toISOString();
}

function parseLandingUrlFromArtifactMetadata(metadata: Record<string, unknown>): string | null {
  const direct = normalizeHttpUrl(metadata.landingUrl);
  if (direct) {
    return direct;
  }
  const sourceLandingUrl = normalizeHttpUrl(metadata.sourceLandingUrl);
  if (sourceLandingUrl) {
    return sourceLandingUrl;
  }
  const actionPayload = asRecord(metadata.actionPayload);
  return normalizeHttpUrl(actionPayload.landingUrl);
}

async function authorize(
  request: NextRequest,
  clientId: string,
  minimumRole: "analyst" | "operator"
): Promise<{ organizationId: string } | Response> {
  const ctx = await getRequestContext(request);
  if (isSupabaseConfigured()) {
    if (!ctx.isAuthenticated) {
      return fail("Unauthorized. Session expired. Sign in again from the dashboard header.", 401);
    }
    if (!hasRole(ctx, minimumRole)) {
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

async function resolveSitemapUrls(clientId: string): Promise<{
  sitemapUrl: string | null;
  defaultPostUrl: string | null;
  urls: string[];
  warnings: string[];
}> {
  const client = await getClientById(clientId);
  const settings = await getClientOrchestrationSettings(clientId);
  const warnings: string[] = [];

  let sitemapUrl = normalizeHttpUrl(settings.sitemapUrl);
  const defaultPostUrl = normalizeHttpUrl(settings.defaultPostUrl) ?? normalizeHttpUrl(client?.websiteUrl ?? null);

  if (!sitemapUrl && client?.websiteUrl) {
    const discovered = await discoverSitemapForWebsite(client.websiteUrl);
    sitemapUrl = normalizeHttpUrl(discovered.sitemapUrl);
    if (!sitemapUrl) {
      warnings.push("No sitemap was configured or auto-discovered.");
    }
  }

  if (!sitemapUrl) {
    return {
      sitemapUrl: null,
      defaultPostUrl,
      urls: defaultPostUrl ? [defaultPostUrl] : [],
      warnings
    };
  }

  try {
    const listed = await listUrlsFromSitemap(sitemapUrl, { maxUrls: 400, maxDepth: 5 });
    const urls = listed.urls.map((entry) => normalizeHttpUrl(entry)).filter((entry): entry is string => Boolean(entry));
    return {
      sitemapUrl,
      defaultPostUrl,
      urls,
      warnings: [...warnings, ...listed.warnings]
    };
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : "Failed to parse sitemap URLs");
    return {
      sitemapUrl,
      defaultPostUrl,
      urls: defaultPostUrl ? [defaultPostUrl] : [],
      warnings
    };
  }
}

function resolveMode(value: unknown): PostToolMode {
  if (typeof value !== "string") {
    return "single";
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "spawn3" ? "spawn3" : "single";
}

export async function GET(request: NextRequest, { params }: Params) {
  const auth = await authorize(request, params.clientId, "analyst");
  if (auth instanceof Response) {
    return auth;
  }

  const settings = await getClientOrchestrationSettings(params.clientId);
  const { sitemapUrl, defaultPostUrl, urls, warnings } = await resolveSitemapUrls(params.clientId);
  const assets = await listClientMediaAssets(params.clientId);
  const selectedAssetIds = new Set(settings.photoAssetIds);
  const allowedAssets = assets
    .filter((asset) => {
      if (!asset.isAllowedForPosts) {
        return false;
      }
      if (selectedAssetIds.size > 0 && !selectedAssetIds.has(asset.id)) {
        return false;
      }
      return true;
    })
    .map((asset) => ({
      id: asset.id,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      bytes: asset.bytes
    }));

  const existingArtifacts = await listClientContentArtifacts(params.clientId, {
    channel: "gbp",
    phase: "content",
    status: "all",
    limit: 250
  });
  const queuedLandingUrls = existingArtifacts
    .filter((artifact) => artifact.status === "draft" || artifact.status === "scheduled")
    .map((artifact) => parseLandingUrlFromArtifactMetadata(artifact.metadata))
    .filter((entry): entry is string => Boolean(entry));
  const dueScheduledCount = existingArtifacts.filter((artifact) => {
    if (artifact.status !== "scheduled") {
      return false;
    }
    if (!artifact.scheduledFor) {
      return true;
    }
    return new Date(artifact.scheduledFor).getTime() <= Date.now();
  }).length;
  const postToolArtifacts = existingArtifacts
    .filter((artifact) => {
      const metadata = artifact.metadata as Record<string, unknown>;
      const actionPayload = asRecord(metadata.actionPayload);
      const source = typeof metadata.source === "string" ? metadata.source : "";
      const objective = typeof actionPayload.objective === "string" ? actionPayload.objective : "";
      return source === "isolated_post_tool" || objective === "manual_post_tool_publish";
    })
    .map((artifact) => {
      const metadata = artifact.metadata as Record<string, unknown>;
      return {
        id: artifact.id,
        status: artifact.status,
        title: artifact.title,
        createdAt: artifact.createdAt,
        scheduledFor: artifact.scheduledFor,
        landingUrl: parseLandingUrlFromArtifactMetadata(metadata),
        mediaAssetId: typeof metadata.mediaAssetId === "string" ? metadata.mediaAssetId : null
      };
    })
    .slice(0, 120);

  return ok({
    modeDefaults: {
      tone: settings.tone
    },
    sitemapUrl,
    defaultPostUrl,
    sitemapUrls: [...new Set(urls)].slice(0, 500),
    allowedAssets,
    queuedLandingUrls,
    dueScheduledCount,
    scheduledDispatcherExpected: true,
    postToolArtifacts,
    warnings
  });
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const auth = await authorize(request, params.clientId, "operator");
    if (auth instanceof Response) {
      return auth;
    }

    const payload = (await request.json().catch(() => null)) as PostToolPayload | null;
    if (!payload) {
      return fail("Invalid post tool payload", 400);
    }
    const action = typeof payload.action === "string" ? payload.action.trim().toLowerCase() : "queue";

    if (action === "push_now") {
      const artifactIds = toStringArray(payload.artifactIds);
      if (!artifactIds.length) {
        return fail("artifactIds are required for push_now", 400);
      }

      const candidates = await listClientContentArtifacts(params.clientId, {
        channel: "gbp",
        phase: "content",
        status: "all",
        limit: 500
      });
      const index = new Map(candidates.map((artifact) => [artifact.id, artifact]));
      const nowIso = new Date().toISOString();
      const updated: Array<{ id: string; status: string; scheduledFor: string | null }> = [];
      const skipped: Array<{ id: string; reason: string }> = [];

      for (const artifactId of artifactIds) {
        const artifact = index.get(artifactId);
        if (!artifact) {
          skipped.push({ id: artifactId, reason: "not_found" });
          continue;
        }
        if (artifact.status === "published") {
          skipped.push({ id: artifactId, reason: "already_published" });
          continue;
        }
        if (artifact.status === "failed") {
          skipped.push({ id: artifactId, reason: "failed_status" });
          continue;
        }
        const nextMetadata = {
          ...artifact.metadata,
          pushedNowAt: nowIso,
          pushedNowVia: "isolated_post_tool"
        };
        const next = await updateContentArtifact(artifact.id, {
          status: "scheduled",
          scheduledFor: nowIso,
          metadata: nextMetadata
        });
        if (!next) {
          skipped.push({ id: artifactId, reason: "update_failed" });
          continue;
        }
        updated.push({
          id: next.id,
          status: next.status,
          scheduledFor: next.scheduledFor
        });
      }

      return ok({
        action: "push_now",
        pushedCount: updated.length,
        updated,
        skipped
      });
    }

    const mode = resolveMode(payload.mode);
    const rawLandingUrls = toStringArray(payload.landingUrls)
      .map((entry) => normalizeHttpUrl(entry))
      .filter((entry): entry is string => Boolean(entry));
    const normalizedUniqueLandingUrls = [...new Set(rawLandingUrls.map((entry) => entry.toLowerCase()))]
      .map((entry) => rawLandingUrls.find((url) => url.toLowerCase() === entry) ?? entry);

    if (!normalizedUniqueLandingUrls.length) {
      return fail("Select at least one sitemap URL", 400);
    }

    if (mode === "single" && normalizedUniqueLandingUrls.length !== 1) {
      return fail("Single mode requires exactly one sitemap URL", 400);
    }

    if (mode === "spawn3" && normalizedUniqueLandingUrls.length !== 3) {
      return fail("Spawn 3 mode requires exactly three unique sitemap URLs", 400);
    }

    const settings = await getClientOrchestrationSettings(params.clientId);
    const candidateArtifacts = await listClientContentArtifacts(params.clientId, {
      channel: "gbp",
      phase: "content",
      status: "all",
      limit: 300
    });
    const duplicateProtectionSet = new Set<string>();
    const queuedByLandingUrl = new Map<string, (typeof candidateArtifacts)[number]>();
    for (const artifact of candidateArtifacts) {
      if (artifact.status !== "draft" && artifact.status !== "scheduled") {
        continue;
      }
      const existingUrl = parseLandingUrlFromArtifactMetadata(artifact.metadata);
      if (existingUrl) {
        const key = existingUrl.toLowerCase();
        duplicateProtectionSet.add(key);
        if (!queuedByLandingUrl.has(key)) {
          queuedByLandingUrl.set(key, artifact);
        }
      }
    }

    const conflicting = normalizedUniqueLandingUrls.filter((url) => duplicateProtectionSet.has(url.toLowerCase()));
    if (conflicting.length) {
      type ExistingQueuedEntry = {
        id: string;
        scheduledFor: string;
        landingUrl: string;
        mediaAssetId: string | null;
        status: "draft" | "scheduled" | "published" | "failed";
      };
      const existingQueued = conflicting
        .map((url) => {
          const queued = queuedByLandingUrl.get(url.toLowerCase());
          if (!queued) {
            return null;
          }
          return {
            id: queued.id,
            scheduledFor: queued.scheduledFor ?? new Date().toISOString(),
            landingUrl: url,
            mediaAssetId:
              typeof (queued.metadata as Record<string, unknown>).mediaAssetId === "string"
                ? String((queued.metadata as Record<string, unknown>).mediaAssetId)
                : null,
            status: queued.status as ExistingQueuedEntry["status"]
          };
        })
        .filter((entry): entry is ExistingQueuedEntry => entry !== null);

      return ok({
        scheduledCount: 0,
        mode,
        created: existingQueued,
        warnings: [
          "Selected URLs are already queued. Existing queued artifacts were returned so you can use Push Now instead of creating duplicates."
        ]
      });
    }

    const toneOverride = typeof payload.toneOverride === "string" && payload.toneOverride.trim()
      ? payload.toneOverride.trim().slice(0, 180)
      : settings.tone;
    const systemMessage = typeof payload.systemMessage === "string" && payload.systemMessage.trim()
      ? payload.systemMessage.trim().slice(0, 3000)
      : null;

    const assets = await listClientMediaAssets(params.clientId);
    const selectedAssetIds = new Set(settings.photoAssetIds);
    const availableAssetIds = shuffleInPlace(
      assets
        .filter((asset) => {
          if (!asset.isAllowedForPosts) {
            return false;
          }
          if (selectedAssetIds.size > 0 && !selectedAssetIds.has(asset.id)) {
            return false;
          }
          return true;
        })
        .map((asset) => asset.id)
    );

    const requestedCount = mode === "spawn3" ? 3 : 1;
    const created = [] as Array<{
      id: string;
      scheduledFor: string;
      landingUrl: string;
      mediaAssetId: string | null;
      status: string;
    }>;
    const warnings: string[] = [];

    for (let index = 0; index < requestedCount; index += 1) {
      const landingUrl = normalizedUniqueLandingUrls[index];
      if (!landingUrl) {
        continue;
      }
      const mediaAssetId = availableAssetIds[index] ?? null;
      if (!mediaAssetId && availableAssetIds.length > 0) {
        warnings.push(`Post ${index + 1} is set to text-only because unique assets were exhausted.`);
      }
      if (!mediaAssetId && availableAssetIds.length === 0) {
        warnings.push("No approved assets available. Posts will publish as text-only.");
      }

      const scheduledFor = daysFromNow(index);
      const artifact = await createContentArtifact({
        organizationId: auth.organizationId,
        clientId: params.clientId,
        phase: "content",
        channel: "gbp",
        title: `Post Tool Dispatch ${index + 1}: ${landingUrl}`,
        body: `Post Tool scheduled publish targeting ${landingUrl}`,
        metadata: {
          source: "isolated_post_tool",
          mode,
          landingUrl,
          mediaAssetId,
          toneOverride,
          systemMessage,
          dispatchActionType: "post_publish",
          dispatchRiskTier: "medium",
          actionPayload: {
            objective: "manual_post_tool_publish",
            landingUrl,
            toneOverride,
            systemMessage,
            mediaAssetId,
            postToolMode: mode
          }
        },
        status: "scheduled",
        scheduledFor
      });

      created.push({
        id: artifact.id,
        scheduledFor,
        landingUrl,
        mediaAssetId,
        status: artifact.status
      });
    }

    return ok(
      {
        scheduledCount: created.length,
        mode,
        created,
        warnings
      },
      201
    );
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Failed to queue isolated post tool run", 500);
  }
}
