"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ClientTabs } from "../../../_components/client-tabs";
import { useDashboardContext } from "../../../_components/dashboard-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getSupabaseBrowserClient, isSupabaseBrowserConfigured } from "@/lib/supabase-browser";

interface OrchestrationSettings {
  clientId: string;
  organizationId: string;
  tone: string;
  objectives: string[];
  photoAssetUrls: string[];
  photoAssetIds: string[];
  sitemapUrl: string | null;
  defaultPostUrl: string | null;
  reviewReplyStyle: string;
  postFrequencyPerWeek: number;
  postWordCountMin: number;
  postWordCountMax: number;
  eeatStructuredSnippetEnabled: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface MediaAsset {
  id: string;
  organizationId: string;
  clientId: string;
  storageBucket: string;
  storagePath: string;
  fileName: string;
  mimeType: string | null;
  bytes: number | null;
  isAllowedForPosts: boolean;
  tags: string[];
  metadata: Record<string, unknown>;
  previewUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface IntegrationRecord {
  id: string;
  provider: "gbp" | "ga4" | "google_ads" | "search_console" | "ghl";
  providerAccountId: string;
  scopes: string[];
  tokenExpiresAt: string | null;
  connectedAt: string;
  isActive: boolean;
}

function toLines(values: string[]): string {
  return values.join("\n");
}

function fromLines(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function parseJsonMetadata(raw: string): Record<string, unknown> {
  if (!raw.trim()) {
    return {};
  }

  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Metadata must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(String).map((entry) => entry.trim()).filter(Boolean);
}

function toInt(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

const HARDCODED_POSTS_PER_DAY = 2;
const HARDCODED_POST_DAYS_PER_WEEK = 3;
const HARDCODED_POSTS_PER_WEEK = HARDCODED_POSTS_PER_DAY * HARDCODED_POST_DAYS_PER_WEEK;

export default function ClientOrchestrationSettingsPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const searchParams = useSearchParams();
  const { request } = useDashboardContext();

  const [tone, setTone] = useState("professional-local-expert");
  const [objectivesText, setObjectivesText] = useState("");
  const [photoUrlsText, setPhotoUrlsText] = useState("");
  const [selectedPhotoAssetIds, setSelectedPhotoAssetIds] = useState<string[]>([]);
  const [sitemapUrl, setSitemapUrl] = useState("");
  const [defaultPostUrl, setDefaultPostUrl] = useState("");
  const [reviewReplyStyle, setReviewReplyStyle] = useState("balanced");
  const [reviewAutoReplyMinRating, setReviewAutoReplyMinRating] = useState(1);
  const [reviewRequestUrl, setReviewRequestUrl] = useState("");
  const [reviewRequestDailyCap, setReviewRequestDailyCap] = useState(24);
  const [reviewRequestCooldownMinutes, setReviewRequestCooldownMinutes] = useState(30);
  const [reviewRequestDelayMinutes, setReviewRequestDelayMinutes] = useState(10);
  const [reviewRequestJitterMaxMinutes, setReviewRequestJitterMaxMinutes] = useState(30);
  const [postWordCountMin, setPostWordCountMin] = useState(500);
  const [postWordCountMax, setPostWordCountMax] = useState(800);
  const [eeatStructuredSnippetEnabled, setEeatStructuredSnippetEnabled] = useState(true);
  const [geoRequireOperatorApproval, setGeoRequireOperatorApproval] = useState(true);
  const [geoDripMinDays, setGeoDripMinDays] = useState(3);
  const [geoDripMaxDays, setGeoDripMaxDays] = useState(4);
  const [geoFollowUpCount, setGeoFollowUpCount] = useState(8);
  const [geoQaTarget, setGeoQaTarget] = useState(24);
  const [geoFactBankText, setGeoFactBankText] = useState("");
  const [mediaFloodTargetAssets, setMediaFloodTargetAssets] = useState(50);
  const [mediaFloodBatchSize, setMediaFloodBatchSize] = useState(12);
  const [mediaFloodCooldownMs, setMediaFloodCooldownMs] = useState(350);
  const [mediaFloodMaxPerLocation, setMediaFloodMaxPerLocation] = useState(80);
  const [mediaFloodEnableVision, setMediaFloodEnableVision] = useState(true);
  const [mediaFloodIncludeGeoTags, setMediaFloodIncludeGeoTags] = useState(true);
  const [mediaFloodIncludeStories, setMediaFloodIncludeStories] = useState(true);
  const [mediaFloodIncludeVideos, setMediaFloodIncludeVideos] = useState(true);
  const [mediaFloodIncludeVirtualTours, setMediaFloodIncludeVirtualTours] = useState(true);

  const [mediaAssets, setMediaAssets] = useState<MediaAsset[]>([]);
  const [integrations, setIntegrations] = useState<IntegrationRecord[]>([]);

  const [ga4AccountId, setGa4AccountId] = useState("");
  const [ga4Scopes, setGa4Scopes] = useState("https://www.googleapis.com/auth/analytics.readonly");
  const [ga4Metadata, setGa4Metadata] = useState("{}");

  const [adsAccountId, setAdsAccountId] = useState("");
  const [adsScopes, setAdsScopes] = useState("https://www.googleapis.com/auth/adwords");
  const [adsMetadata, setAdsMetadata] = useState("{}");
  const [searchConsolePropertyUrl, setSearchConsolePropertyUrl] = useState("");
  const [syncingAttribution, setSyncingAttribution] = useState(false);

  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [existingMetadata, setExistingMetadata] = useState<Record<string, unknown>>({});
  const supabaseBrowserConfigured = isSupabaseBrowserConfigured();

  const selectedAssetSet = useMemo(() => new Set(selectedPhotoAssetIds), [selectedPhotoAssetIds]);
  const mediaAssetCount = mediaAssets.length;
  const allowedAssetCount = useMemo(() => mediaAssets.filter((asset) => asset.isAllowedForPosts).length, [mediaAssets]);
  const activeIntegrationCount = useMemo(() => integrations.filter((integration) => integration.isActive).length, [integrations]);
  const selectedMediaCount = selectedPhotoAssetIds.length;

  const loadWorkspace = () => {
    setBusy(true);
    setError(null);
    setStatus(null);

    void Promise.all([
      request<{ settings: OrchestrationSettings }>(`/api/v1/clients/${clientId}/orchestration/settings`),
      request<{ assets: MediaAsset[] }>(`/api/v1/clients/${clientId}/media-assets`),
      request<{ integrations: IntegrationRecord[] }>(`/api/v1/clients/${clientId}/integrations`)
    ])
      .then(([settingsPayload, assetsPayload, integrationsPayload]) => {
        const settings = settingsPayload.settings;
        setTone(settings.tone);
        setObjectivesText(toLines(settings.objectives));
        setPhotoUrlsText(toLines(settings.photoAssetUrls));
        setSelectedPhotoAssetIds(settings.photoAssetIds);
        setSitemapUrl(settings.sitemapUrl ?? "");
        setDefaultPostUrl(settings.defaultPostUrl ?? "");
        setReviewReplyStyle(settings.reviewReplyStyle);
        setPostWordCountMin(settings.postWordCountMin);
        setPostWordCountMax(settings.postWordCountMax);
        setEeatStructuredSnippetEnabled(settings.eeatStructuredSnippetEnabled);
        const metadata = asRecord(settings.metadata);
        setExistingMetadata(metadata);
        setReviewAutoReplyMinRating(toInt(Number(metadata.reviewAutoReplyMinRating), 1, 1, 5));
        setReviewRequestUrl(typeof metadata.reviewRequestUrl === "string" ? metadata.reviewRequestUrl : "");
        setReviewRequestDailyCap(toInt(Number(metadata.reviewRequestDailyCap), 24, 1, 400));
        setReviewRequestCooldownMinutes(toInt(Number(metadata.reviewRequestCooldownMinutes), 30, 5, 720));
        setReviewRequestDelayMinutes(toInt(Number(metadata.reviewRequestDelayMinutes), 10, 0, 720));
        setReviewRequestJitterMaxMinutes(toInt(Number(metadata.reviewRequestJitterMaxMinutes), 30, 0, 240));
        const geoContent = asRecord(metadata.geoContent);
        setGeoRequireOperatorApproval(geoContent.requireOperatorApproval !== false);
        setGeoDripMinDays(toInt(Number(geoContent.dripMinDays), 3, 1, 14));
        setGeoDripMaxDays(toInt(Number(geoContent.dripMaxDays), 4, 1, 21));
        setGeoFollowUpCount(toInt(Number(geoContent.followUpCount), 8, 1, 30));
        setGeoQaTarget(toInt(Number(geoContent.qnaTarget), 24, 20, 30));
        setGeoFactBankText(toLines(toStringArray(geoContent.factBank)));
        const mediaFlood = asRecord(metadata.mediaFlood);
        setMediaFloodTargetAssets(toInt(Number(mediaFlood.targetAssets), 50, 5, 150));
        setMediaFloodBatchSize(toInt(Number(mediaFlood.batchSize), 12, 1, 30));
        setMediaFloodCooldownMs(toInt(Number(mediaFlood.cooldownMs), 350, 50, 5000));
        setMediaFloodMaxPerLocation(toInt(Number(mediaFlood.maxPerLocation), 80, 1, 100));
        setMediaFloodEnableVision(mediaFlood.enableVision !== false);
        setMediaFloodIncludeGeoTags(mediaFlood.includeGeoTags !== false);
        setMediaFloodIncludeStories(mediaFlood.includeStories !== false);
        setMediaFloodIncludeVideos(mediaFlood.includeVideos !== false);
        setMediaFloodIncludeVirtualTours(mediaFlood.includeVirtualTours !== false);
        setMediaAssets(assetsPayload.assets);
        setIntegrations(integrationsPayload.integrations);
        const ga4 = integrationsPayload.integrations.find((integration) => integration.provider === "ga4");
        const ads = integrationsPayload.integrations.find((integration) => integration.provider === "google_ads");
        const searchConsole = integrationsPayload.integrations.find((integration) => integration.provider === "search_console");
        if (ga4?.providerAccountId) {
          setGa4AccountId(ga4.providerAccountId);
        }
        if (ads?.providerAccountId) {
          setAdsAccountId(ads.providerAccountId);
        }
        if (searchConsole?.providerAccountId) {
          setSearchConsolePropertyUrl(searchConsole.providerAccountId);
        } else if (settings.defaultPostUrl) {
          try {
            setSearchConsolePropertyUrl(new URL(settings.defaultPostUrl).origin);
          } catch {
            setSearchConsolePropertyUrl("");
          }
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  useEffect(loadWorkspace, [clientId, request]);

  useEffect(() => {
    const connectedProviders = ["ga4", "google_ads", "search_console"].filter(
      (provider) => searchParams.get(`${provider}_connected`) === "true"
    );
    if (connectedProviders.length) {
      setStatus(`${connectedProviders.join(", ")} connection updated.`);
      loadWorkspace();
    }
  }, [searchParams]);

  const saveSettings = async () => {
    setBusy(true);
    setError(null);
    setStatus(null);

    const objectives = fromLines(objectivesText);
    const photoAssetUrls = fromLines(photoUrlsText);

    if (!objectives.length) {
      setError("At least one objective is required.");
      setBusy(false);
      return;
    }

    if (postWordCountMin > postWordCountMax) {
      setError("Post word count minimum cannot exceed maximum.");
      setBusy(false);
      return;
    }
    if (geoDripMinDays > geoDripMaxDays) {
      setError("GEO drip minimum days cannot exceed maximum days.");
      setBusy(false);
      return;
    }

    try {
      await request<{ settings: OrchestrationSettings }>(`/api/v1/clients/${clientId}/orchestration/settings`, {
        method: "POST",
        body: {
          tone: tone.trim(),
          objectives,
          photoAssetUrls,
          photoAssetIds: selectedPhotoAssetIds,
          sitemapUrl: sitemapUrl.trim() || null,
          defaultPostUrl: defaultPostUrl.trim() || null,
          reviewReplyStyle: reviewReplyStyle.trim(),
          postFrequencyPerWeek: HARDCODED_POSTS_PER_WEEK,
          postWordCountMin,
          postWordCountMax,
          eeatStructuredSnippetEnabled,
          metadata: {
            ...existingMetadata,
            updatedFrom: "dashboard-client-orchestration",
            reviewAutoReplyMinRating: toInt(reviewAutoReplyMinRating, 1, 1, 5),
            reviewRequestUrl: reviewRequestUrl.trim() || null,
            reviewRequestDailyCap: toInt(reviewRequestDailyCap, 24, 1, 400),
            reviewRequestCooldownMinutes: toInt(reviewRequestCooldownMinutes, 30, 5, 720),
            reviewRequestDelayMinutes: toInt(reviewRequestDelayMinutes, 10, 0, 720),
            reviewRequestJitterMaxMinutes: toInt(reviewRequestJitterMaxMinutes, 30, 0, 240),
            geoContent: {
              requireOperatorApproval: geoRequireOperatorApproval,
              dripMinDays: toInt(geoDripMinDays, 3, 1, 14),
              dripMaxDays: toInt(geoDripMaxDays, 4, 1, 21),
              followUpCount: toInt(geoFollowUpCount, 8, 1, 30),
              qnaTarget: toInt(geoQaTarget, 24, 20, 30),
              factBank: fromLines(geoFactBankText)
            },
            mediaFlood: {
              targetAssets: toInt(mediaFloodTargetAssets, 50, 5, 150),
              batchSize: toInt(mediaFloodBatchSize, 12, 1, 30),
              cooldownMs: toInt(mediaFloodCooldownMs, 350, 50, 5000),
              maxPerLocation: toInt(mediaFloodMaxPerLocation, 80, 1, 100),
              enableVision: mediaFloodEnableVision,
              includeGeoTags: mediaFloodIncludeGeoTags,
              includeStories: mediaFloodIncludeStories,
              includeVideos: mediaFloodIncludeVideos,
              includeVirtualTours: mediaFloodIncludeVirtualTours
            }
          }
        }
      });

      setStatus("Orchestration settings saved. Worker behavior updated for future runs.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const autoDetectSitemap = async () => {
    setBusy(true);
    setError(null);
    setStatus(null);

    try {
      const payload = await request<{
        updatedSitemapUrl: string | null;
        updatedDefaultPostUrl: string | null;
        discovery: { source: string };
      }>(`/api/v1/clients/${clientId}/orchestration/sitemap/autofill`, {
        method: "POST",
        body: {
          overwrite: false
        }
      });

      if (payload.updatedSitemapUrl) {
        setSitemapUrl(payload.updatedSitemapUrl);
      }
      if (payload.updatedDefaultPostUrl) {
        setDefaultPostUrl(payload.updatedDefaultPostUrl);
      }
      setStatus(
        payload.updatedSitemapUrl
          ? `Auto-detected sitemap (${payload.discovery.source}) and saved orchestration URL settings.`
          : "No sitemap was discovered, but default post URL was updated when available."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }

    setBusy(true);
    setError(null);
    setStatus(null);

    try {
      const browserSupabase = supabaseBrowserConfigured ? getSupabaseBrowserClient() : null;
      for (const file of Array.from(files)) {
        const presign = await request<{
          upload: {
            bucket: string;
            storagePath: string;
            token: string;
            signedUrl: string;
            fileName: string;
            mimeType: string;
            bytes: number;
          };
        }>(`/api/v1/clients/${clientId}/media-assets/presign`, {
          method: "POST",
          body: {
            fileName: file.name,
            mimeType: file.type || "application/octet-stream",
            bytes: file.size
          }
        });

        if (browserSupabase) {
          const upload = await browserSupabase.storage
            .from(presign.upload.bucket)
            .uploadToSignedUrl(
              presign.upload.storagePath,
              presign.upload.token,
              file,
              {
                contentType: file.type || presign.upload.mimeType
              }
            );
          if (upload.error) {
            throw new Error(`Signed upload failed for ${file.name}: ${upload.error.message}`);
          }
        } else {
          const response = await fetch(presign.upload.signedUrl, {
            method: "PUT",
            headers: {
              "content-type": file.type || presign.upload.mimeType,
              "x-upsert": "false"
            },
            body: file
          });
          if (!response.ok) {
            throw new Error(`Signed upload failed for ${file.name} (${response.status})`);
          }
        }

        await request(`/api/v1/clients/${clientId}/media-assets/complete`, {
          method: "POST",
          body: presign.upload
        });
      }

      setStatus(`Uploaded ${files.length} file(s) to client media bucket via signed upload.`);
      loadWorkspace();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleAssetAllowed = async (asset: MediaAsset, next: boolean) => {
    setBusy(true);
    setError(null);
    setStatus(null);

    try {
      await request(`/api/v1/clients/${clientId}/media-assets/${asset.id}`, {
        method: "PATCH",
        body: {
          isAllowedForPosts: next,
          tags: asset.tags,
          metadata: asset.metadata
        }
      });
      loadWorkspace();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const deleteAsset = async (asset: MediaAsset) => {
    const confirmed = window.confirm(`Remove ${asset.fileName} from Blitz platform bucket for this client?`);
    if (!confirmed) {
      return;
    }

    setBusy(true);
    setError(null);
    setStatus(null);

    try {
      await request(`/api/v1/clients/${clientId}/media-assets/${asset.id}`, {
        method: "DELETE"
      });
      setSelectedPhotoAssetIds((current) => current.filter((id) => id !== asset.id));
      loadWorkspace();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const connectIntegration = async (provider: "ga4" | "google_ads") => {
    setBusy(true);
    setError(null);
    setStatus(null);

    try {
      if (provider === "ga4") {
        await request(`/api/v1/clients/${clientId}/integrations/ga4/connect`, {
          method: "POST",
          body: {
            providerAccountId: ga4AccountId.trim(),
            scopes: ga4Scopes
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
            metadata: parseJsonMetadata(ga4Metadata)
          }
        });
      } else {
        await request(`/api/v1/clients/${clientId}/integrations/google-ads/connect`, {
          method: "POST",
          body: {
            providerAccountId: adsAccountId.trim(),
            scopes: adsScopes
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
            metadata: parseJsonMetadata(adsMetadata)
          }
        });
      }

      setStatus(`${provider === "ga4" ? "GA4" : "Google Ads"} integration saved for this client.`);
      loadWorkspace();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const startGoogleOauth = async (provider: "ga4" | "google_ads" | "search_console") => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const providerAccountId =
        provider === "ga4" ? ga4AccountId.trim() : provider === "google_ads" ? adsAccountId.trim() : searchConsolePropertyUrl.trim();
      const payload = await request<{ authUrl: string }>(
        `/api/v1/google/oauth/start?provider=${encodeURIComponent(provider)}&clientId=${encodeURIComponent(clientId)}&providerAccountId=${encodeURIComponent(providerAccountId)}&returnPath=${encodeURIComponent(`/dashboard/clients/${clientId}/settings`)}`,
      );
      window.location.assign(payload.authUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const syncAttribution = async () => {
    setSyncingAttribution(true);
    setError(null);
    setStatus(null);
    try {
      const payload = await request<{
        summary: {
          rowCount: number;
          dateFrom: string;
          dateTo: string;
          channels: string[];
        };
      }>(`/api/v1/clients/${clientId}/attribution/sync`, {
        method: "POST",
        body: {
          window: "30d"
        }
      });
      setStatus(
        `Attribution sync complete. ${payload.summary.rowCount} rows stored for ${payload.summary.channels.join(", ")} from ${payload.summary.dateFrom} to ${payload.summary.dateTo}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSyncingAttribution(false);
    }
  };

  return (
    <div className="space-y-6 pb-8">
      <Card className="overflow-hidden border-stone-200/80 bg-white/95 shadow-sm">
        <CardHeader className="space-y-5 p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <Badge variant="outline" className="w-fit rounded-full border-stone-200 bg-stone-50 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-stone-600">
                Orchestration
              </Badge>
              <div className="space-y-2">
                <CardTitle className="text-3xl font-medium tracking-tight text-balance">Client Orchestration Settings</CardTitle>
                <CardDescription className="max-w-4xl text-base leading-7">
                  Configure tone, cadence, review behavior, media gating, and external integrations from one structured workspace.
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void saveSettings()} disabled={busy}>
                {busy ? "Saving..." : "Save Settings"}
              </Button>
              <Button variant="outline" onClick={loadWorkspace} disabled={busy}>
                Reload
              </Button>
              <Button variant="secondary" onClick={() => void syncAttribution()} disabled={busy || syncingAttribution}>
                {syncingAttribution ? "Syncing Attribution..." : "Sync Attribution Now"}
              </Button>
            </div>
          </div>

          <ClientTabs clientId={clientId} />

          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Post frequency: {HARDCODED_POSTS_PER_WEEK}/week</Badge>
            <Badge variant="secondary">Word range: {postWordCountMin}-{postWordCountMax}</Badge>
            <Badge variant="secondary">EEAT snippets: {eeatStructuredSnippetEnabled ? "Enabled" : "Disabled"}</Badge>
            <Badge variant="secondary">Auto reply min rating: {reviewAutoReplyMinRating}</Badge>
            <Badge variant="secondary">Review cap/day: {reviewRequestDailyCap}</Badge>
            <Badge variant="secondary">GEO approval: {geoRequireOperatorApproval ? "On" : "Off"}</Badge>
            <Badge variant="secondary">Media target: {mediaFloodTargetAssets}</Badge>
            <Badge variant="secondary">Allowed assets: {allowedAssetCount}</Badge>
          </div>

          {status ? (
            <Alert className="border-emerald-200 bg-emerald-50/80 text-emerald-950">
              <AlertTitle>Workspace update</AlertTitle>
              <AlertDescription>{status}</AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Workspace issue</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardHeader>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
        <div className="space-y-6">
          <Card className="border-stone-200/80 bg-white/95 shadow-sm">
            <CardHeader>
              <CardTitle>Content + Review Voice</CardTitle>
              <CardDescription>Set the tone and review voice the client will feel across content and replies.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-stone-700">Tone</span>
                  <Input value={tone} onChange={(event) => setTone(event.target.value)} placeholder="professional-local-expert" />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-stone-700">Review Reply Style</span>
                  <Input value={reviewReplyStyle} onChange={(event) => setReviewReplyStyle(event.target.value)} placeholder="balanced" />
                </label>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-stone-700">Auto Reply Min Rating (1-5)</span>
                  <Input
                    type="number"
                    min={1}
                    max={5}
                    value={reviewAutoReplyMinRating}
                    onChange={(event) => setReviewAutoReplyMinRating(Number(event.target.value))}
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-stone-700">Review Request URL</span>
                  <Input value={reviewRequestUrl} onChange={(event) => setReviewRequestUrl(event.target.value)} placeholder="https://g.page/r/.../review" />
                </label>
              </div>
              <label className="space-y-2">
                <span className="text-sm font-medium text-stone-700">Objectives (one per line)</span>
                <Textarea
                  className="min-h-36"
                  value={objectivesText}
                  onChange={(event) => setObjectivesText(event.target.value)}
                  placeholder={"Increase local visibility\nIncrease direction clicks\nImprove review response velocity"}
                />
              </label>
            </CardContent>
          </Card>

          <Card className="border-stone-200/80 bg-white/95 shadow-sm">
            <CardHeader>
              <CardTitle>Cadence + URL Routing</CardTitle>
              <CardDescription>Keep post volume, review routing, and default URLs in one predictable control surface.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-stone-700">Posts Per Week</span>
                  <Input type="number" min={HARDCODED_POSTS_PER_WEEK} max={HARDCODED_POSTS_PER_WEEK} value={HARDCODED_POSTS_PER_WEEK} disabled />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-stone-700">EEAT Snippet Mode</span>
                  <Select value={eeatStructuredSnippetEnabled ? "enabled" : "disabled"} onValueChange={(value) => setEeatStructuredSnippetEnabled(value === "enabled")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="enabled">enabled</SelectItem>
                        <SelectItem value="disabled">disabled</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </label>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-stone-700">Review Request Daily Cap</span>
                  <Input type="number" min={1} max={400} value={reviewRequestDailyCap} onChange={(event) => setReviewRequestDailyCap(Number(event.target.value))} />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-stone-700">Review Request Cooldown (minutes)</span>
                  <Input
                    type="number"
                    min={5}
                    max={720}
                    value={reviewRequestCooldownMinutes}
                    onChange={(event) => setReviewRequestCooldownMinutes(Number(event.target.value))}
                  />
                </label>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-stone-700">Review Request Delay (minutes)</span>
                  <Input
                    type="number"
                    min={0}
                    max={720}
                    value={reviewRequestDelayMinutes}
                    onChange={(event) => setReviewRequestDelayMinutes(Number(event.target.value))}
                  />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-stone-700">Review Request Jitter Max (minutes)</span>
                  <Input
                    type="number"
                    min={0}
                    max={240}
                    value={reviewRequestJitterMaxMinutes}
                    onChange={(event) => setReviewRequestJitterMaxMinutes(Number(event.target.value))}
                  />
                </label>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-stone-700">Post Word Count Min</span>
                  <Input type="number" min={120} max={2000} value={postWordCountMin} onChange={(event) => setPostWordCountMin(Number(event.target.value))} />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-stone-700">Post Word Count Max</span>
                  <Input type="number" min={120} max={2000} value={postWordCountMax} onChange={(event) => setPostWordCountMax(Number(event.target.value))} />
                </label>
              </div>
            </CardContent>
          </Card>

          <Card className="border-stone-200/80 bg-white/95 shadow-sm">
            <CardHeader>
              <CardTitle>GEO + Q&A Controls</CardTitle>
              <CardDescription>Control approval gating, drip cadence, and truth-constrained Q&A seeding behavior.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-stone-700">Require Operator Approval</span>
                  <Select value={geoRequireOperatorApproval ? "enabled" : "disabled"} onValueChange={(value) => setGeoRequireOperatorApproval(value === "enabled")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="enabled">enabled</SelectItem>
                        <SelectItem value="disabled">disabled</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-stone-700">Q&A Target</span>
                  <Input type="number" min={20} max={30} value={geoQaTarget} onChange={(event) => setGeoQaTarget(Number(event.target.value))} />
                </label>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-stone-700">Drip Min Days</span>
                  <Input type="number" min={1} max={14} value={geoDripMinDays} onChange={(event) => setGeoDripMinDays(Number(event.target.value))} />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-stone-700">Drip Max Days</span>
                  <Input type="number" min={1} max={21} value={geoDripMaxDays} onChange={(event) => setGeoDripMaxDays(Number(event.target.value))} />
                </label>
              </div>
              <label className="space-y-2">
                <span className="text-sm font-medium text-stone-700">Follow-up Draft Count</span>
                <Input type="number" min={1} max={30} value={geoFollowUpCount} onChange={(event) => setGeoFollowUpCount(Number(event.target.value))} />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-stone-700">Truth Fact Bank (one per line)</span>
                <Textarea
                  className="min-h-40"
                  value={geoFactBankText}
                  onChange={(event) => setGeoFactBankText(event.target.value)}
                  placeholder={"Same-day dispatch cutoff is 12:00 PM local time.\nLabor warranty is 5 years on qualifying installs.\nRheem and Navien tankless models are supported."}
                />
              </label>
              <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-stone-700">Sitemap URL</span>
                  <Input value={sitemapUrl} onChange={(event) => setSitemapUrl(event.target.value)} placeholder="https://client.com/sitemap.xml" />
                </label>
                <Button variant="outline" onClick={() => void autoDetectSitemap()} disabled={busy}>
                  Auto-detect Sitemap
                </Button>
              </div>
              <label className="space-y-2">
                <span className="text-sm font-medium text-stone-700">Default GBP Post URL</span>
                <Input value={defaultPostUrl} onChange={(event) => setDefaultPostUrl(event.target.value)} placeholder="https://client.com/local-offer" />
              </label>
            </CardContent>
          </Card>

          <Card className="border-stone-200/80 bg-white/95 shadow-sm">
            <CardHeader>
              <CardTitle>Media Flood Controls</CardTitle>
              <CardDescription>Control derivative volume, pacing, and computer-vision behavior for media phase runs.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-stone-700">Target Assets</span>
                  <Input type="number" min={5} max={150} value={mediaFloodTargetAssets} onChange={(event) => setMediaFloodTargetAssets(Number(event.target.value))} />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-stone-700">Batch Size</span>
                  <Input type="number" min={1} max={30} value={mediaFloodBatchSize} onChange={(event) => setMediaFloodBatchSize(Number(event.target.value))} />
                </label>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-stone-700">Cooldown (ms)</span>
                  <Input type="number" min={50} max={5000} value={mediaFloodCooldownMs} onChange={(event) => setMediaFloodCooldownMs(Number(event.target.value))} />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-stone-700">Max Per Location</span>
                  <Input type="number" min={1} max={100} value={mediaFloodMaxPerLocation} onChange={(event) => setMediaFloodMaxPerLocation(Number(event.target.value))} />
                </label>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-stone-700">Vision Metadata</span>
                  <Select value={mediaFloodEnableVision ? "enabled" : "disabled"} onValueChange={(value) => setMediaFloodEnableVision(value === "enabled")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="enabled">enabled</SelectItem>
                        <SelectItem value="disabled">disabled</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-stone-700">Geo Tags</span>
                  <Select value={mediaFloodIncludeGeoTags ? "enabled" : "disabled"} onValueChange={(value) => setMediaFloodIncludeGeoTags(value === "enabled")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="enabled">enabled</SelectItem>
                        <SelectItem value="disabled">disabled</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </label>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-stone-700">Generate Stories</span>
                  <Select value={mediaFloodIncludeStories ? "enabled" : "disabled"} onValueChange={(value) => setMediaFloodIncludeStories(value === "enabled")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="enabled">enabled</SelectItem>
                        <SelectItem value="disabled">disabled</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-stone-700">Use Video Assets</span>
                  <Select value={mediaFloodIncludeVideos ? "enabled" : "disabled"} onValueChange={(value) => setMediaFloodIncludeVideos(value === "enabled")}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="enabled">enabled</SelectItem>
                        <SelectItem value="disabled">disabled</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </label>
              </div>
              <label className="space-y-2">
                <span className="text-sm font-medium text-stone-700">Generate 360/Panorama Variants</span>
                <Select value={mediaFloodIncludeVirtualTours ? "enabled" : "disabled"} onValueChange={(value) => setMediaFloodIncludeVirtualTours(value === "enabled")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="enabled">enabled</SelectItem>
                      <SelectItem value="disabled">disabled</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </label>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="border-stone-200/80 bg-white/95 shadow-sm">
            <CardHeader>
              <CardTitle>Workspace Snapshot</CardTitle>
              <CardDescription>Quick readout of the current orchestration settings.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-stone-200/80 bg-stone-50/70 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-stone-500">Post cadence</p>
                <p className="mt-2 text-2xl font-semibold text-stone-900">{HARDCODED_POSTS_PER_WEEK}/week</p>
              </div>
              <div className="rounded-2xl border border-stone-200/80 bg-stone-50/70 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-stone-500">Word range</p>
                <p className="mt-2 text-2xl font-semibold text-stone-900">
                  {postWordCountMin}-{postWordCountMax}
                </p>
              </div>
              <div className="rounded-2xl border border-stone-200/80 bg-stone-50/70 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-stone-500">Media pool</p>
                <p className="mt-2 text-2xl font-semibold text-stone-900">{mediaAssetCount}</p>
              </div>
              <div className="rounded-2xl border border-stone-200/80 bg-stone-50/70 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-stone-500">Selectable assets</p>
                <p className="mt-2 text-2xl font-semibold text-stone-900">{selectedMediaCount}</p>
              </div>
              <div className="rounded-2xl border border-stone-200/80 bg-stone-50/70 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-stone-500">Allowed assets</p>
                <p className="mt-2 text-2xl font-semibold text-stone-900">{allowedAssetCount}</p>
              </div>
              <div className="rounded-2xl border border-stone-200/80 bg-stone-50/70 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-stone-500">Active integrations</p>
                <p className="mt-2 text-2xl font-semibold text-stone-900">{activeIntegrationCount}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-stone-200/80 bg-white/95 shadow-sm">
            <CardHeader>
              <CardTitle>Connect GA4</CardTitle>
              <CardDescription>Store the property ID and attach OAuth metadata for analytics attribution.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="space-y-2">
                <span className="text-sm font-medium text-stone-700">GA4 Property / Account ID</span>
                <Input value={ga4AccountId} onChange={(event) => setGa4AccountId(event.target.value)} />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-stone-700">Scopes (comma-separated)</span>
                <Input value={ga4Scopes} onChange={(event) => setGa4Scopes(event.target.value)} />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-stone-700">Metadata JSON</span>
                <Textarea className="min-h-28 font-mono text-sm" value={ga4Metadata} onChange={(event) => setGa4Metadata(event.target.value)} />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => void startGoogleOauth("ga4")} disabled={busy}>
                  Connect to Google
                </Button>
                <Button variant="outline" onClick={() => void connectIntegration("ga4")} disabled={busy}>
                  Save Manual Metadata
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-stone-200/80 bg-white/95 shadow-sm">
            <CardHeader>
              <CardTitle>Connect Google Ads</CardTitle>
              <CardDescription>Attach the Ads customer ID and metadata used by the attribution pipeline.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="space-y-2">
                <span className="text-sm font-medium text-stone-700">Google Ads Customer ID</span>
                <Input value={adsAccountId} onChange={(event) => setAdsAccountId(event.target.value)} />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-stone-700">Scopes (comma-separated)</span>
                <Input value={adsScopes} onChange={(event) => setAdsScopes(event.target.value)} />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-stone-700">Metadata JSON</span>
                <Textarea className="min-h-28 font-mono text-sm" value={adsMetadata} onChange={(event) => setAdsMetadata(event.target.value)} />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => void startGoogleOauth("google_ads")} disabled={busy}>
                  Connect to Google
                </Button>
                <Button variant="outline" onClick={() => void connectIntegration("google_ads")} disabled={busy}>
                  Save Manual Metadata
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-stone-200/80 bg-white/95 shadow-sm">
            <CardHeader>
              <CardTitle>Connect Search Console</CardTitle>
              <CardDescription>Map the verified property URL used for search attribution.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <label className="space-y-2">
                <span className="text-sm font-medium text-stone-700">Property URL</span>
                <Input
                  value={searchConsolePropertyUrl}
                  onChange={(event) => setSearchConsolePropertyUrl(event.target.value)}
                  placeholder="sc-domain:example.com or https://www.example.com/"
                />
              </label>
              <p className="text-sm leading-6 text-muted-foreground">
                Use the verified property URL you want mapped into attribution for this client.
              </p>
              <Button variant="secondary" onClick={() => void startGoogleOauth("search_console")} disabled={busy}>
                Connect to Google
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      <Card className="border-stone-200/80 bg-white/95 shadow-sm">
        <CardHeader>
          <CardTitle>Client Media Bucket</CardTitle>
          <CardDescription>Upload photos and videos, then choose which assets the GBP workers can use.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <label className="inline-flex cursor-pointer items-center rounded-full border border-stone-300 bg-stone-50 px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-white">
              Upload Media
              <input
                type="file"
                accept="image/*,video/mp4,video/quicktime,video/webm"
                multiple
                className="hidden"
                onChange={(event) => void uploadFiles(event.target.files)}
              />
            </label>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-stone-200/80">
            <table className="min-w-full text-sm">
              <thead className="bg-stone-50 text-left text-xs uppercase tracking-[0.14em] text-stone-500">
                <tr>
                  <th className="px-4 py-3">Preview</th>
                  <th className="px-4 py-3">File</th>
                  <th className="px-4 py-3">Allowed</th>
                  <th className="px-4 py-3">Selected Pool</th>
                  <th className="px-4 py-3">Uploaded</th>
                  <th className="px-4 py-3">Delete</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200/80">
                {mediaAssets.map((asset) => (
                  <tr key={asset.id} className="align-top">
                    <td className="px-4 py-4">
                      {asset.previewUrl ? (
                        asset.mimeType?.startsWith("video/") ? (
                          <video src={asset.previewUrl} muted playsInline controls={false} className="size-16 rounded-2xl object-cover" />
                        ) : (
                          <img src={asset.previewUrl} alt={asset.fileName} className="size-16 rounded-2xl object-cover" />
                        )
                      ) : (
                        <span className="text-sm text-muted-foreground">No preview</span>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <div className="space-y-1">
                        <p className="font-medium text-stone-900">{asset.fileName}</p>
                        <p className="text-xs text-muted-foreground">
                          {asset.storageBucket}/{asset.storagePath}
                        </p>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        checked={asset.isAllowedForPosts}
                        onChange={(event) => void toggleAssetAllowed(asset, event.target.checked)}
                      />
                    </td>
                    <td className="px-4 py-4">
                      <input
                        type="checkbox"
                        checked={selectedAssetSet.has(asset.id)}
                        onChange={(event) => {
                          setSelectedPhotoAssetIds((current) => {
                            if (event.target.checked) {
                              return Array.from(new Set([...current, asset.id]));
                            }
                            return current.filter((id) => id !== asset.id);
                          });
                        }}
                      />
                    </td>
                    <td className="px-4 py-4 text-muted-foreground">{formatDate(asset.createdAt)}</td>
                    <td className="px-4 py-4">
                      <Button variant="destructive" size="sm" disabled={busy} onClick={() => void deleteAsset(asset)}>
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
                {!mediaAssets.length ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                      No media uploaded yet for this client bucket.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className="border-stone-200/80 bg-white/95 shadow-sm">
        <CardHeader>
          <CardTitle>Connected Integrations</CardTitle>
          <CardDescription>Live OAuth and manual connections stored for this client.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-stone-50 text-left text-xs uppercase tracking-[0.14em] text-stone-500">
              <tr>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Account</th>
                <th className="px-4 py-3">Scopes</th>
                <th className="px-4 py-3">Connected</th>
                <th className="px-4 py-3">Token Expires</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200/80">
              {integrations.map((integration) => (
                <tr key={integration.id}>
                  <td className="px-4 py-4 capitalize">{integration.provider}</td>
                  <td className="px-4 py-4">{integration.providerAccountId}</td>
                  <td className="px-4 py-4">{integration.scopes.join(", ") || "-"}</td>
                  <td className="px-4 py-4">{formatDate(integration.connectedAt)}</td>
                  <td className="px-4 py-4">{integration.tokenExpiresAt ? formatDate(integration.tokenExpiresAt) : "-"}</td>
                  <td className="px-4 py-4">{integration.isActive ? "active" : "inactive"}</td>
                </tr>
              ))}
              {!integrations.length ? (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    No integrations connected for this client yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
