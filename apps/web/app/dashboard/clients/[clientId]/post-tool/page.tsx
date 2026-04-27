"use client";

import { useParams } from "next/navigation";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type PostToolMode = "single" | "spawn3";

interface SitemapPayload {
  modeDefaults: {
    tone: string;
  };
  sitemapUrl: string | null;
  defaultPostUrl: string | null;
  sitemapUrls: string[];
  allowedAssets: Array<{
    id: string;
    fileName: string;
    mimeType: string | null;
    bytes: number | null;
  }>;
  queuedLandingUrls: string[];
  dueScheduledCount: number;
  scheduledDispatcherExpected: boolean;
  postToolArtifacts: Array<{
    id: string;
    status: "draft" | "scheduled" | "published" | "failed";
    title: string | null;
    createdAt: string;
    scheduledFor: string | null;
    landingUrl: string | null;
    mediaAssetId: string | null;
  }>;
  warnings: string[];
}

interface QueueResponse {
  mode: PostToolMode;
  scheduledCount: number;
  created: Array<{
    id: string;
    scheduledFor: string;
    landingUrl: string;
    mediaAssetId: string | null;
    status: string;
  }>;
  warnings: string[];
}

interface PushNowResponse {
  action: "push_now";
  pushedCount: number;
  updated: Array<{
    id: string;
    status: string;
    scheduledFor: string | null;
  }>;
  skipped: Array<{
    id: string;
    reason: string;
  }>;
  dispatchSummary: {
    attemptedCount: number;
    publishedCount: number;
    failedCount: number;
    skippedCount: number;
    publishedArtifactIds: string[];
    failedArtifacts: Array<{ artifactId: string; error: string; terminal: boolean }>;
    skippedArtifacts: Array<{ artifactId: string; reason: string }>;
  } | null;
  dispatchError: string | null;
  publishedSelectedArtifactIds: string[];
}

interface UnscheduleResponse {
  action: "unschedule";
  unscheduledCount: number;
  updated: Array<{
    id: string;
    status: string;
    scheduledFor: string | null;
  }>;
  skipped: Array<{
    id: string;
    reason: string;
  }>;
}

function normalizeHttpUrl(value: string): string | null {
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

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function formatUrlLabel(value: string): string {
  try {
    const parsed = new URL(value);
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.hostname}${path}${parsed.search}`;
  } catch {
    return value;
  }
}

function statTone(count: number): "secondary" | "outline" | "destructive" {
  if (count > 0) {
    return "secondary";
  }
  return "outline";
}

export default function ClientPostToolPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const { request } = useDashboardContext();

  const [mode, setMode] = useState<PostToolMode>("single");
  const [toneOverride, setToneOverride] = useState("");
  const [systemMessage, setSystemMessage] = useState("");
  const [sitemapUrl, setSitemapUrl] = useState<string | null>(null);
  const [defaultPostUrl, setDefaultPostUrl] = useState<string | null>(null);
  const [sitemapUrls, setSitemapUrls] = useState<string[]>([]);
  const [queuedLandingUrls, setQueuedLandingUrls] = useState<string[]>([]);
  const [dueScheduledCount, setDueScheduledCount] = useState(0);
  const [scheduledDispatcherExpected, setScheduledDispatcherExpected] = useState(true);
  const [persistedArtifacts, setPersistedArtifacts] = useState<SitemapPayload["postToolArtifacts"]>([]);
  const [allowedAssets, setAllowedAssets] = useState<SitemapPayload["allowedAssets"]>([]);
  const [urlFilter, setUrlFilter] = useState("");
  const [singleUrl, setSingleUrl] = useState("");
  const [spawn3Selection, setSpawn3Selection] = useState<string[]>([]);
  const [submitPreview, setSubmitPreview] = useState<QueueResponse | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = (options?: { preserveMessages?: boolean }) => {
    setBusy(true);
    if (!options?.preserveMessages) {
      setError(null);
      setStatus(null);
    }

    void request<SitemapPayload>(`/api/v1/clients/${clientId}/post-tool`)
      .then((payload) => {
        setToneOverride(payload.modeDefaults.tone ?? "professional-local-expert");
        setSitemapUrl(payload.sitemapUrl);
        setDefaultPostUrl(payload.defaultPostUrl);
        setSitemapUrls(payload.sitemapUrls);
        setQueuedLandingUrls(payload.queuedLandingUrls);
        setDueScheduledCount(payload.dueScheduledCount);
        setScheduledDispatcherExpected(payload.scheduledDispatcherExpected);
        setPersistedArtifacts(payload.postToolArtifacts);
        setAllowedAssets(payload.allowedAssets);
        setWarnings(payload.warnings);

        const nextSingle = payload.sitemapUrls[0] ?? payload.defaultPostUrl ?? "";
        setSingleUrl(nextSingle);
        setSpawn3Selection(payload.sitemapUrls.slice(0, 3));
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  useEffect(load, [clientId, request]);

  const queuedSet = useMemo(() => new Set(queuedLandingUrls.map((url) => url.toLowerCase())), [queuedLandingUrls]);
  const filteredSitemapUrls = useMemo(() => {
    const query = urlFilter.trim().toLowerCase();
    if (!query) {
      return sitemapUrls;
    }
    return sitemapUrls.filter((url) => url.toLowerCase().includes(query));
  }, [sitemapUrls, urlFilter]);

  const effectiveSelection = useMemo(() => {
    if (mode === "single") {
      const normalized = normalizeHttpUrl(singleUrl);
      return normalized ? [normalized] : [];
    }
    return [...new Set(spawn3Selection.map((entry) => normalizeHttpUrl(entry)).filter((entry): entry is string => Boolean(entry)))];
  }, [mode, singleUrl, spawn3Selection]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setStatus(null);
    setSubmitPreview(null);

    if (mode === "single" && effectiveSelection.length !== 1) {
      setError("Single mode requires exactly one sitemap URL.");
      setBusy(false);
      return;
    }
    if (mode === "spawn3" && effectiveSelection.length !== 3) {
      setError("Spawn 3 mode requires exactly three unique sitemap URLs.");
      setBusy(false);
      return;
    }

    try {
      const payload = await request<QueueResponse>(`/api/v1/clients/${clientId}/post-tool`, {
        method: "POST",
        body: {
          mode,
          landingUrls: effectiveSelection,
          toneOverride,
          systemMessage
        }
      });
      setSubmitPreview(payload);
      setStatus(`Queued ${payload.scheduledCount} post dispatch${payload.scheduledCount === 1 ? "" : "es"}.`);
      void load({ preserveMessages: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const pushNow = async (artifactIds: string[]) => {
    if (!artifactIds.length) {
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const payload = await request<PushNowResponse>(`/api/v1/clients/${clientId}/post-tool`, {
        method: "POST",
        body: {
          action: "push_now",
          artifactIds
        }
      });
      if (payload.dispatchError) {
        setError(`Fallback dispatch failed: ${payload.dispatchError}`);
      }
      if (payload.publishedSelectedArtifactIds.length > 0) {
        const backlogFlushCount = Math.max(
          0,
          (payload.dispatchSummary?.publishedCount ?? payload.publishedSelectedArtifactIds.length) -
            payload.publishedSelectedArtifactIds.length
        );
        setStatus(
          backlogFlushCount > 0
            ? `Published ${payload.publishedSelectedArtifactIds.length} selected artifact(s) immediately and flushed ${backlogFlushCount} other due post(s).`
            : `Published ${payload.publishedSelectedArtifactIds.length} selected artifact(s) immediately.`
        );
      } else {
        setStatus(`Pushed ${payload.pushedCount} artifact(s) for immediate dispatch.`);
      }
      void load({ preserveMessages: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const unschedule = async (artifactIds: string[]) => {
    if (!artifactIds.length) {
      return;
    }
    const confirmed = window.confirm(`Unschedule ${artifactIds.length} queued post artifact(s)?`);
    if (!confirmed) {
      return;
    }

    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const payload = await request<UnscheduleResponse>(`/api/v1/clients/${clientId}/post-tool`, {
        method: "POST",
        body: {
          action: "unschedule",
          artifactIds
        }
      });
      setStatus(`Unscheduled ${payload.unscheduledCount} artifact(s).`);
      void load({ preserveMessages: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Card className="border-border/70 bg-card/90 shadow-sm">
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">Post Tool</Badge>
                <Badge variant="outline">{sitemapUrls.length} sitemap URLs</Badge>
                <Badge variant="outline">{queuedLandingUrls.length} queued</Badge>
                <Badge variant={statTone(dueScheduledCount)}>{dueScheduledCount} due now</Badge>
                <Badge variant="outline">{allowedAssets.length} assets</Badge>
              </div>
              <CardTitle className="text-3xl">Isolated GBP Post Tool</CardTitle>
              <CardDescription className="max-w-3xl text-base">
                Queue one-off GBP posts or a 3-post sequence with a cleaner preview flow. Scheduled dispatch still runs through the worker, and Push Now also attempts an immediate server-side fallback publish.
              </CardDescription>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => load()} disabled={busy}>
                Refresh Sources
              </Button>
              {submitPreview?.created.length ? (
                <Button variant="secondary" onClick={() => void pushNow(submitPreview.created.map((entry) => entry.id))} disabled={busy}>
                  Push Latest Now
                </Button>
              ) : null}
              {submitPreview?.created.length ? (
                <Button variant="destructive" onClick={() => void unschedule(submitPreview.created.map((entry) => entry.id))} disabled={busy}>
                  Unschedule Latest
                </Button>
              ) : null}
              <Button onClick={() => void submit()} disabled={busy}>
                Queue Post Tool Run
              </Button>
            </div>
          </div>

          <ClientTabs clientId={clientId} />

          {scheduledDispatcherExpected ? (
              <Alert>
              <AlertTitle>Worker dispatch</AlertTitle>
              <AlertDescription>
                Posts are dispatched automatically from the worker scheduler. Push Now also triggers an immediate fallback dispatch attempt from the web app so missed worker ticks do not fail silently.
              </AlertDescription>
            </Alert>
          ) : null}
          {status ? (
            <Alert>
              <AlertTitle>Run queued</AlertTitle>
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-border/70 bg-card/90 shadow-sm">
          <CardHeader>
            <CardDescription>Sitemap URLs</CardDescription>
            <CardTitle>{sitemapUrls.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Discovered URLs available for single or batched post scheduling.</p>
          </CardContent>
        </Card>
        <Card className="border-border/70 bg-card/90 shadow-sm">
          <CardHeader>
            <CardDescription>Queued URLs</CardDescription>
            <CardTitle>{queuedLandingUrls.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Landing pages already protected from duplicate near-term queueing.</p>
          </CardContent>
        </Card>
        <Card className="border-border/70 bg-card/90 shadow-sm">
          <CardHeader>
            <CardDescription>Due Now</CardDescription>
            <CardTitle>{dueScheduledCount}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Scheduled artifacts waiting on the worker to publish eligibility.</p>
          </CardContent>
        </Card>
        <Card className="border-border/70 bg-card/90 shadow-sm">
          <CardHeader>
            <CardDescription>Allowed Assets</CardDescription>
            <CardTitle>{allowedAssets.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Media assets that can be attached to the post queue.</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.85fr)]">
        <Card className="border-border/70 bg-card/90 shadow-sm">
          <CardHeader className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <CardTitle>Run Config</CardTitle>
                <CardDescription>Set generation mode, voice, and landing pages.</CardDescription>
              </div>
              <Badge variant="outline">{mode === "single" ? "Single Post" : "Spawn 3"}</Badge>
            </div>
            <Separator />
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Mode</label>
                <select
                  className="w-full rounded-xl border border-border/80 bg-background px-3 py-2.5 text-sm shadow-sm outline-none transition focus:border-amber-500 focus:ring-2 focus:ring-amber-500/15"
                  value={mode}
                  onChange={(event) => setMode(event.target.value === "spawn3" ? "spawn3" : "single")}
                  disabled={busy}
                >
                  <option value="single">Single Post</option>
                  <option value="spawn3">Spawn 3 (1 day apart)</option>
                </select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Tone / Generation Profile</label>
                <Input
                  value={toneOverride}
                  onChange={(event) => setToneOverride(event.target.value)}
                  placeholder="professional-local-expert"
                  disabled={busy}
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">System Message (Optional)</label>
              <Textarea
                value={systemMessage}
                onChange={(event) => setSystemMessage(event.target.value)}
                placeholder="Provide any specific writing rules or campaign instruction for this run."
                disabled={busy}
                className="min-h-[130px]"
              />
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                  {mode === "single" ? "Landing URL" : "Landing URLs (pick 3)"}
                </label>
                <span className="text-xs text-muted-foreground">
                  {mode === "single" ? "Choose one URL" : `${effectiveSelection.length}/3 selected`}
                </span>
              </div>

              <Input
                value={urlFilter}
                onChange={(event) => setUrlFilter(event.target.value)}
                placeholder="Filter sitemap URLs"
                disabled={busy}
              />

              <ScrollArea className="h-[320px] rounded-2xl border border-border/80 bg-muted/20 p-2">
                <div className="grid gap-2">
                  {filteredSitemapUrls.length ? (
                    filteredSitemapUrls.map((url) => {
                      const selected =
                        mode === "single"
                          ? singleUrl === url
                          : spawn3Selection.includes(url);
                      const queued = queuedSet.has(url.toLowerCase());

                      return (
                        <button
                          key={url}
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            if (mode === "single") {
                              setSingleUrl(url);
                              return;
                            }

                            setSpawn3Selection((current) => {
                              if (current.includes(url)) {
                                return current.filter((entry) => entry !== url);
                              }
                              if (current.length >= 3) {
                                return current;
                              }
                              return [...current, url];
                            });
                          }}
                          className={cn(
                            "flex items-start justify-between gap-3 rounded-2xl border px-3 py-3 text-left transition",
                            selected
                              ? "border-amber-500 bg-amber-50 text-foreground shadow-sm"
                              : "border-border/80 bg-background hover:border-amber-300 hover:bg-amber-50/60",
                            queued ? "ring-1 ring-red-400/50" : ""
                          )}
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{formatUrlLabel(url)}</span>
                            <span className="mt-1 block text-xs text-muted-foreground">{url}</span>
                          </span>
                          <span className="flex flex-col items-end gap-1 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                            {queued ? <span className="text-red-600">Queued</span> : <span>Ready</span>}
                            {selected ? <span className="text-foreground">Selected</span> : null}
                          </span>
                        </button>
                      );
                    })
                  ) : (
                    <div className="rounded-2xl border border-dashed border-border/80 bg-background p-6 text-sm text-muted-foreground">
                      No sitemap URLs match the current filter.
                    </div>
                  )}
                </div>
              </ScrollArea>

              <div className="rounded-2xl border border-border/80 bg-muted/30 p-3">
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Selected URLs</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {effectiveSelection.length ? (
                    effectiveSelection.map((url) => (
                      <Badge key={url} variant={queuedSet.has(url.toLowerCase()) ? "destructive" : "secondary"}>
                        {formatUrlLabel(url)}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">No URL selected yet.</span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => load()} disabled={busy}>
                  Refresh Sources
                </Button>
                <Button onClick={() => void submit()} disabled={busy}>
                  Queue Post Tool Run
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4 xl:sticky xl:top-6">
          <Card className="border-border/70 bg-card/90 shadow-sm">
            <CardHeader>
              <CardTitle>Validation + Queue Safety</CardTitle>
              <CardDescription>Review what will be protected before you queue the run.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 text-sm">
                <div className="rounded-2xl border border-border/80 bg-muted/25 p-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Sitemap</p>
                  <p className="mt-2 break-all text-foreground">{sitemapUrl ?? "Not set"}</p>
                </div>
                <div className="rounded-2xl border border-border/80 bg-muted/25 p-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Default URL</p>
                  <p className="mt-2 break-all text-foreground">{defaultPostUrl ?? "Not set"}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl border border-border/80 bg-muted/25 p-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Selected</p>
                    <p className="mt-2 text-lg font-semibold">{effectiveSelection.length}</p>
                  </div>
                  <div className="rounded-2xl border border-border/80 bg-muted/25 p-3">
                    <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Duplicate protection</p>
                    <p className="mt-2 text-lg font-semibold">{queuedLandingUrls.length}</p>
                  </div>
                </div>
              </div>

              <Separator />

              <div>
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">Discovery warnings</p>
                {warnings.length ? (
                  <div className="mt-3 space-y-2">
                    {warnings.map((warning) => (
                      <div key={warning} className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                        {warning}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">No discovery warnings.</p>
                )}
              </div>
            </CardContent>
          </Card>

          {submitPreview ? (
            <Card className="border-border/70 bg-card/90 shadow-sm">
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <CardTitle>Latest Queue Result</CardTitle>
                    <CardDescription>Preview of what the worker accepted on the last submit.</CardDescription>
                  </div>
                  <Badge variant="outline">{submitPreview.mode}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{submitPreview.scheduledCount} queued</Badge>
                </div>
                <div className="rounded-2xl border border-border/80">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] border-collapse text-sm">
                      <thead className="bg-muted/50 text-left text-xs uppercase tracking-[0.16em] text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2">Artifact</th>
                          <th className="px-3 py-2">Landing URL</th>
                          <th className="px-3 py-2">Scheduled</th>
                          <th className="px-3 py-2">Asset</th>
                          <th className="px-3 py-2">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {submitPreview.created.map((item) => (
                          <tr key={item.id} className="border-t border-border/80">
                            <td className="px-3 py-3 align-top font-mono text-xs">{item.id}</td>
                            <td className="px-3 py-3 align-top break-all">{formatUrlLabel(item.landingUrl)}</td>
                            <td className="px-3 py-3 align-top">{formatDate(item.scheduledFor)}</td>
                            <td className="px-3 py-3 align-top">{item.mediaAssetId ?? "text-only"}</td>
                            <td className="px-3 py-3 align-top">
                              <div className="flex flex-wrap gap-2">
                                <Button variant="outline" size="sm" onClick={() => void pushNow([item.id])} disabled={busy}>
                                  Push Now
                                </Button>
                                <Button variant="destructive" size="sm" onClick={() => void unschedule([item.id])} disabled={busy}>
                                  Unschedule
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                {submitPreview.warnings.length ? (
                  <Alert>
                    <AlertTitle>Queue warnings</AlertTitle>
                    <AlertDescription className="whitespace-pre-wrap">{submitPreview.warnings.join("\n")}</AlertDescription>
                  </Alert>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <Card className="border-border/70 bg-card/90 shadow-sm">
        <CardHeader>
          <CardTitle>Persisted Post Tool Queue</CardTitle>
          <CardDescription>Saved artifacts in the queue, ready for the worker or manual push.</CardDescription>
        </CardHeader>
        <CardContent>
          {persistedArtifacts.length ? (
            <div className="rounded-2xl border border-border/80">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[860px] border-collapse text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase tracking-[0.16em] text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Artifact</th>
                      <th className="px-3 py-2">Landing URL</th>
                      <th className="px-3 py-2">Created</th>
                      <th className="px-3 py-2">Scheduled</th>
                      <th className="px-3 py-2">Asset</th>
                      <th className="px-3 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {persistedArtifacts.map((item) => (
                      <tr key={item.id} className="border-t border-border/80">
                        <td className="px-3 py-3 align-top font-mono text-xs">{item.id}</td>
                        <td className="px-3 py-3 align-top break-all">{item.landingUrl ?? "n/a"}</td>
                        <td className="px-3 py-3 align-top">{formatDate(item.createdAt)}</td>
                        <td className="px-3 py-3 align-top">{item.scheduledFor ? formatDate(item.scheduledFor) : "n/a"}</td>
                        <td className="px-3 py-3 align-top">{item.mediaAssetId ?? "text-only"}</td>
                        <td className="px-3 py-3 align-top">
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge variant="outline">{item.status}</Badge>
                            {item.status === "draft" || item.status === "scheduled" ? (
                              <>
                                <Button variant="outline" size="sm" onClick={() => void pushNow([item.id])} disabled={busy}>
                                  Push Now
                                </Button>
                                <Button variant="destructive" size="sm" onClick={() => void unschedule([item.id])} disabled={busy}>
                                  Unschedule
                                </Button>
                              </>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No persisted post-tool artifacts yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
