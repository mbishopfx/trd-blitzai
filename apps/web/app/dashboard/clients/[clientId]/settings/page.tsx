"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ClientTabs } from "../../../_components/client-tabs";
import { useDashboardContext } from "../../../_components/dashboard-context";
import styles from "../../../_components/dashboard.module.css";

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
  provider: "gbp" | "ga4" | "google_ads" | "ghl";
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

function toInt(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.round(value)));
}

export default function ClientOrchestrationSettingsPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const { request, buildAuthHeaders } = useDashboardContext();

  const [tone, setTone] = useState("professional-local-expert");
  const [objectivesText, setObjectivesText] = useState("");
  const [photoUrlsText, setPhotoUrlsText] = useState("");
  const [selectedPhotoAssetIds, setSelectedPhotoAssetIds] = useState<string[]>([]);
  const [sitemapUrl, setSitemapUrl] = useState("");
  const [defaultPostUrl, setDefaultPostUrl] = useState("");
  const [reviewReplyStyle, setReviewReplyStyle] = useState("balanced");
  const [postFrequencyPerWeek, setPostFrequencyPerWeek] = useState(3);
  const [postWordCountMin, setPostWordCountMin] = useState(500);
  const [postWordCountMax, setPostWordCountMax] = useState(800);
  const [eeatStructuredSnippetEnabled, setEeatStructuredSnippetEnabled] = useState(true);
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

  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const selectedAssetSet = useMemo(() => new Set(selectedPhotoAssetIds), [selectedPhotoAssetIds]);

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
        setPostFrequencyPerWeek(settings.postFrequencyPerWeek);
        setPostWordCountMin(settings.postWordCountMin);
        setPostWordCountMax(settings.postWordCountMax);
        setEeatStructuredSnippetEnabled(settings.eeatStructuredSnippetEnabled);
        const mediaFlood = asRecord(asRecord(settings.metadata).mediaFlood);
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
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  useEffect(loadWorkspace, [clientId, request]);

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
          postFrequencyPerWeek,
          postWordCountMin,
          postWordCountMax,
          eeatStructuredSnippetEnabled,
          metadata: {
            updatedFrom: "dashboard-client-orchestration",
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
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.set("file", file);

        const response = await fetch(`/api/v1/clients/${clientId}/media-assets`, {
          method: "POST",
          headers: buildAuthHeaders(),
          body: form
        });

        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) {
          throw new Error(payload?.error ?? `Upload failed (${response.status})`);
        }
      }

      setStatus(`Uploaded ${files.length} file(s) to client media bucket.`);
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

  return (
    <>
      <section className={styles.hero}>
        <h2 className={styles.heroTitle}>Client Orchestration Settings</h2>
        <p className={styles.heroSubtitle}>
          Configure voice/objectives, post cadence, EEAT snippet mode, approved post photos from the client bucket, and external analytics/ad integrations.
        </p>
        <ClientTabs clientId={clientId} />
        <div className={styles.kpiRow}>
          <span className={styles.badge}>Post frequency: {postFrequencyPerWeek}/week</span>
          <span className={styles.badge}>Word range: {postWordCountMin}-{postWordCountMax}</span>
          <span className={styles.badge}>EEAT snippets: {eeatStructuredSnippetEnabled ? "Enabled" : "Disabled"}</span>
          <span className={styles.badge}>Media flood target: {mediaFloodTargetAssets}</span>
          <span className={styles.badge}>Allowed assets: {mediaAssets.filter((asset) => asset.isAllowedForPosts).length}</span>
        </div>
        <div className={styles.inlineActions}>
          <button type="button" className={styles.buttonPrimary} onClick={() => void saveSettings()} disabled={busy}>
            {busy ? "Saving..." : "Save Settings"}
          </button>
          <button type="button" className={styles.buttonGhost} onClick={loadWorkspace} disabled={busy}>
            Reload
          </button>
        </div>
        {status ? <span className={`${styles.badge} ${styles.statusActive}`}>{status}</span> : null}
        {error ? <span className={`${styles.badge} ${styles.statusError}`}>{error}</span> : null}
      </section>

      <section className={styles.grid}>
        <article className={`${styles.card} ${styles.col6}`}>
          <header className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Content + Review Voice</h3>
          </header>
          <label className={styles.field}>
            <span className={styles.label}>Tone</span>
            <input
              className={styles.input}
              value={tone}
              onChange={(event) => setTone(event.target.value)}
              placeholder="professional-local-expert"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Review Reply Style</span>
            <input
              className={styles.input}
              value={reviewReplyStyle}
              onChange={(event) => setReviewReplyStyle(event.target.value)}
              placeholder="balanced"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Objectives (one per line)</span>
            <textarea
              className={styles.textarea}
              value={objectivesText}
              onChange={(event) => setObjectivesText(event.target.value)}
              placeholder={"Increase local visibility\nIncrease direction clicks\nImprove review response velocity"}
            />
          </label>
        </article>

        <article className={`${styles.card} ${styles.col6}`}>
          <header className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Cadence + URL Routing</h3>
          </header>
          <div className={styles.split}>
            <label className={styles.field}>
              <span className={styles.label}>Posts Per Week</span>
              <input
                className={styles.input}
                type="number"
                min={0}
                max={21}
                value={postFrequencyPerWeek}
                onChange={(event) => setPostFrequencyPerWeek(Number(event.target.value))}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>EEAT Snippet Mode</span>
              <select
                className={styles.select}
                value={eeatStructuredSnippetEnabled ? "enabled" : "disabled"}
                onChange={(event) => setEeatStructuredSnippetEnabled(event.target.value === "enabled")}
              >
                <option value="enabled">enabled</option>
                <option value="disabled">disabled</option>
              </select>
            </label>
          </div>
          <div className={styles.split}>
            <label className={styles.field}>
              <span className={styles.label}>Post Word Count Min</span>
              <input
                className={styles.input}
                type="number"
                min={120}
                max={2000}
                value={postWordCountMin}
                onChange={(event) => setPostWordCountMin(Number(event.target.value))}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Post Word Count Max</span>
              <input
                className={styles.input}
                type="number"
                min={120}
                max={2000}
                value={postWordCountMax}
                onChange={(event) => setPostWordCountMax(Number(event.target.value))}
              />
            </label>
          </div>
          <label className={styles.field}>
            <span className={styles.label}>Sitemap URL</span>
            <input
              className={styles.input}
              value={sitemapUrl}
              onChange={(event) => setSitemapUrl(event.target.value)}
              placeholder="https://client.com/sitemap.xml"
            />
          </label>
          <div className={styles.inlineActions}>
            <button type="button" className={styles.buttonSecondary} onClick={() => void autoDetectSitemap()} disabled={busy}>
              Auto-detect Sitemap
            </button>
          </div>
          <label className={styles.field}>
            <span className={styles.label}>Default GBP Post URL</span>
            <input
              className={styles.input}
              value={defaultPostUrl}
              onChange={(event) => setDefaultPostUrl(event.target.value)}
              placeholder="https://client.com/local-offer"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Optional External Media URLs (one per line)</span>
            <textarea
              className={styles.textarea}
              value={photoUrlsText}
              onChange={(event) => setPhotoUrlsText(event.target.value)}
              placeholder={"https://cdn.client.com/image-1.jpg\nhttps://cdn.client.com/video-1.mp4"}
            />
          </label>
          <header className={styles.cardHeader} style={{ marginTop: 16 }}>
            <h3 className={styles.cardTitle}>Media Flood Controls</h3>
            <p className={styles.cardHint}>Controls derivative volume, pacing, and computer-vision behavior for media phase runs.</p>
          </header>
          <div className={styles.split}>
            <label className={styles.field}>
              <span className={styles.label}>Target Assets</span>
              <input
                className={styles.input}
                type="number"
                min={5}
                max={150}
                value={mediaFloodTargetAssets}
                onChange={(event) => setMediaFloodTargetAssets(Number(event.target.value))}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Batch Size</span>
              <input
                className={styles.input}
                type="number"
                min={1}
                max={30}
                value={mediaFloodBatchSize}
                onChange={(event) => setMediaFloodBatchSize(Number(event.target.value))}
              />
            </label>
          </div>
          <div className={styles.split}>
            <label className={styles.field}>
              <span className={styles.label}>Cooldown (ms)</span>
              <input
                className={styles.input}
                type="number"
                min={50}
                max={5000}
                value={mediaFloodCooldownMs}
                onChange={(event) => setMediaFloodCooldownMs(Number(event.target.value))}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Max Per Location</span>
              <input
                className={styles.input}
                type="number"
                min={1}
                max={100}
                value={mediaFloodMaxPerLocation}
                onChange={(event) => setMediaFloodMaxPerLocation(Number(event.target.value))}
              />
            </label>
          </div>
          <div className={styles.split}>
            <label className={styles.field}>
              <span className={styles.label}>Vision Metadata</span>
              <select
                className={styles.select}
                value={mediaFloodEnableVision ? "enabled" : "disabled"}
                onChange={(event) => setMediaFloodEnableVision(event.target.value === "enabled")}
              >
                <option value="enabled">enabled</option>
                <option value="disabled">disabled</option>
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Geo Tags</span>
              <select
                className={styles.select}
                value={mediaFloodIncludeGeoTags ? "enabled" : "disabled"}
                onChange={(event) => setMediaFloodIncludeGeoTags(event.target.value === "enabled")}
              >
                <option value="enabled">enabled</option>
                <option value="disabled">disabled</option>
              </select>
            </label>
          </div>
          <div className={styles.split}>
            <label className={styles.field}>
              <span className={styles.label}>Generate Stories</span>
              <select
                className={styles.select}
                value={mediaFloodIncludeStories ? "enabled" : "disabled"}
                onChange={(event) => setMediaFloodIncludeStories(event.target.value === "enabled")}
              >
                <option value="enabled">enabled</option>
                <option value="disabled">disabled</option>
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Use Video Assets</span>
              <select
                className={styles.select}
                value={mediaFloodIncludeVideos ? "enabled" : "disabled"}
                onChange={(event) => setMediaFloodIncludeVideos(event.target.value === "enabled")}
              >
                <option value="enabled">enabled</option>
                <option value="disabled">disabled</option>
              </select>
            </label>
          </div>
          <label className={styles.field}>
            <span className={styles.label}>Generate 360/Panorama Variants</span>
            <select
              className={styles.select}
              value={mediaFloodIncludeVirtualTours ? "enabled" : "disabled"}
              onChange={(event) => setMediaFloodIncludeVirtualTours(event.target.value === "enabled")}
            >
              <option value="enabled">enabled</option>
              <option value="disabled">disabled</option>
            </select>
          </label>
        </article>

        <article className={`${styles.card} ${styles.col12}`}>
          <header className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Client Media Bucket</h3>
            <p className={styles.cardHint}>Upload photos/videos and choose what the GBP workers can use</p>
          </header>
          <div className={styles.inlineActions}>
            <label className={styles.buttonSecondary}>
              Upload Media
              <input
                type="file"
                accept="image/*,video/mp4,video/quicktime,video/webm"
                multiple
                style={{ display: "none" }}
                onChange={(event) => void uploadFiles(event.target.files)}
              />
            </label>
          </div>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Preview</th>
                  <th>File</th>
                  <th>Allowed</th>
                  <th>Selected Pool</th>
                  <th>Uploaded</th>
                  <th>Delete</th>
                </tr>
              </thead>
              <tbody>
                {mediaAssets.map((asset) => (
                  <tr key={asset.id}>
                    <td>
                      {asset.previewUrl ? (
                        asset.mimeType?.startsWith("video/") ? (
                          <video
                            src={asset.previewUrl}
                            muted
                            playsInline
                            controls={false}
                            style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8 }}
                          />
                        ) : (
                          <img
                            src={asset.previewUrl}
                            alt={asset.fileName}
                            style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 8 }}
                          />
                        )
                      ) : (
                        <span className={styles.muted}>No preview</span>
                      )}
                    </td>
                    <td>
                      <strong>{asset.fileName}</strong>
                      <br />
                      <span className={styles.muted}>{asset.storageBucket}/{asset.storagePath}</span>
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={asset.isAllowedForPosts}
                        onChange={(event) => void toggleAssetAllowed(asset, event.target.checked)}
                      />
                    </td>
                    <td>
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
                    <td>{formatDate(asset.createdAt)}</td>
                    <td>
                      <button type="button" className={styles.buttonDanger} disabled={busy} onClick={() => void deleteAsset(asset)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {!mediaAssets.length ? (
                  <tr>
                    <td colSpan={6}>
                      <p className={styles.empty}>No media uploaded yet for this client bucket.</p>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </article>

        <article className={`${styles.card} ${styles.col6}`}>
          <header className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Connect GA4</h3>
          </header>
          <label className={styles.field}>
            <span className={styles.label}>GA4 Property / Account ID</span>
            <input className={styles.input} value={ga4AccountId} onChange={(event) => setGa4AccountId(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Scopes (comma-separated)</span>
            <input className={styles.input} value={ga4Scopes} onChange={(event) => setGa4Scopes(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Metadata JSON</span>
            <textarea className={styles.textarea} value={ga4Metadata} onChange={(event) => setGa4Metadata(event.target.value)} />
          </label>
          <button type="button" className={styles.buttonSecondary} disabled={busy} onClick={() => void connectIntegration("ga4")}>
            Connect GA4
          </button>
        </article>

        <article className={`${styles.card} ${styles.col6}`}>
          <header className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Connect Google Ads</h3>
          </header>
          <label className={styles.field}>
            <span className={styles.label}>Google Ads Customer ID</span>
            <input className={styles.input} value={adsAccountId} onChange={(event) => setAdsAccountId(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Scopes (comma-separated)</span>
            <input className={styles.input} value={adsScopes} onChange={(event) => setAdsScopes(event.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Metadata JSON</span>
            <textarea className={styles.textarea} value={adsMetadata} onChange={(event) => setAdsMetadata(event.target.value)} />
          </label>
          <button type="button" className={styles.buttonSecondary} disabled={busy} onClick={() => void connectIntegration("google_ads")}>
            Connect Google Ads
          </button>
        </article>

        <article className={`${styles.card} ${styles.col12}`}>
          <header className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Connected Integrations</h3>
          </header>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Account</th>
                  <th>Scopes</th>
                  <th>Connected</th>
                  <th>Token Expires</th>
                </tr>
              </thead>
              <tbody>
                {integrations.map((integration) => (
                  <tr key={integration.id}>
                    <td>{integration.provider}</td>
                    <td>{integration.providerAccountId}</td>
                    <td>{integration.scopes.join(", ") || "-"}</td>
                    <td>{formatDate(integration.connectedAt)}</td>
                    <td>{integration.tokenExpiresAt ? formatDate(integration.tokenExpiresAt) : "-"}</td>
                  </tr>
                ))}
                {!integrations.length ? (
                  <tr>
                    <td colSpan={5}>
                      <p className={styles.empty}>No integrations connected for this client yet.</p>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </article>
      </section>
    </>
  );
}
