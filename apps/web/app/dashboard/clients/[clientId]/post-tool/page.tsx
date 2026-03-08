"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ClientTabs } from "../../../_components/client-tabs";
import { useDashboardContext } from "../../../_components/dashboard-context";
import styles from "../../../_components/dashboard.module.css";

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
  const [singleUrl, setSingleUrl] = useState("");
  const [spawn3Selection, setSpawn3Selection] = useState<string[]>([]);
  const [submitPreview, setSubmitPreview] = useState<QueueResponse | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = () => {
    setBusy(true);
    setError(null);
    setStatus(null);

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
      void load();
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
      setStatus(`Pushed ${payload.pushedCount} artifact(s) for immediate dispatch.`);
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className={styles.hero}>
        <h2 className={styles.heroTitle}>Isolated GBP Post Tool</h2>
        <p className={styles.heroSubtitle}>
          Queue single manual posts or spawn a 3-post sequence one day apart. This uses the same TinyURL + QR media pipeline as the Blitz post worker.
        </p>
        <ClientTabs clientId={clientId} />
        <div className={styles.kpiRow}>
          <span className={styles.badge}>Sitemap URLs {sitemapUrls.length}</span>
          <span className={styles.badge}>Queued URLs {queuedLandingUrls.length}</span>
          <span className={styles.badge}>Due Now {dueScheduledCount}</span>
          <span className={styles.badge}>Allowed Assets {allowedAssets.length}</span>
        </div>
        {scheduledDispatcherExpected ? (
          <span className={`${styles.badge} ${styles.statusIdle}`}>
            Posts dispatch automatically from the Railway worker scheduler. Use Push Now to force immediate dispatch eligibility.
          </span>
        ) : null}
        {status ? <span className={`${styles.badge} ${styles.statusActive}`}>{status}</span> : null}
        {error ? <span className={`${styles.badge} ${styles.statusError}`}>{error}</span> : null}
      </section>

      <section className={styles.grid}>
        <article className={`${styles.card} ${styles.col6}`}>
          <header className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Run Config</h3>
          </header>
          <div className={styles.stack}>
            <label className={styles.field}>
              <span className={styles.label}>Mode</span>
              <select
                className={styles.select}
                value={mode}
                onChange={(event) => setMode(event.target.value === "spawn3" ? "spawn3" : "single")}
                disabled={busy}
              >
                <option value="single">Single Post</option>
                <option value="spawn3">Spawn 3 (1 day apart)</option>
              </select>
            </label>

            <label className={styles.field}>
              <span className={styles.label}>Tone / Generation Profile</span>
              <input
                className={styles.input}
                value={toneOverride}
                onChange={(event) => setToneOverride(event.target.value)}
                placeholder="professional-local-expert"
                disabled={busy}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.label}>System Message (Optional)</span>
              <textarea
                className={styles.textarea}
                value={systemMessage}
                onChange={(event) => setSystemMessage(event.target.value)}
                placeholder="Provide any specific writing rules or campaign instruction for this run."
                disabled={busy}
              />
            </label>

            {mode === "single" ? (
              <label className={styles.field}>
                <span className={styles.label}>Landing URL</span>
                <select className={styles.select} value={singleUrl} onChange={(event) => setSingleUrl(event.target.value)} disabled={busy}>
                  {sitemapUrls.map((url) => (
                    <option key={url} value={url}>
                      {url}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <label className={styles.field}>
                <span className={styles.label}>Landing URLs (Pick 3)</span>
                <select
                  className={styles.select}
                  multiple
                  size={12}
                  value={spawn3Selection}
                  onChange={(event) => {
                    const values = Array.from(event.target.selectedOptions).map((option) => option.value);
                    setSpawn3Selection(values.slice(0, 3));
                  }}
                  disabled={busy}
                >
                  {sitemapUrls.map((url) => (
                    <option key={url} value={url}>
                      {url}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <div className={styles.inlineActions}>
              <button type="button" className={styles.buttonSecondary} onClick={load} disabled={busy}>
                Refresh Sources
              </button>
              <button type="button" className={styles.buttonPrimary} onClick={() => void submit()} disabled={busy}>
                Queue Post Tool Run
              </button>
              {submitPreview?.created.length ? (
                <button
                  type="button"
                  className={styles.buttonGhost}
                  onClick={() => void pushNow(submitPreview.created.map((entry) => entry.id))}
                  disabled={busy}
                >
                  Push Latest Now
                </button>
              ) : null}
            </div>
          </div>
        </article>

        <article className={`${styles.card} ${styles.col6}`}>
          <header className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Validation + Queue Safety</h3>
          </header>
          <div className={styles.stack}>
            <p className={styles.cardHint}>Sitemap: {sitemapUrl ?? "Not set"}</p>
            <p className={styles.cardHint}>Default URL: {defaultPostUrl ?? "Not set"}</p>
            <p className={styles.cardHint}>Selected URLs: {effectiveSelection.length}</p>
            <p className={styles.cardHint}>Duplicate protected URLs currently queued/recent: {queuedLandingUrls.length}</p>
            {effectiveSelection.map((url) => (
              <span key={url} className={`${styles.badge} ${queuedSet.has(url.toLowerCase()) ? styles.statusError : styles.statusIdle}`}>
                {url}
              </span>
            ))}
            {warnings.length ? (
              <pre className={styles.codeBlock}>{warnings.join("\n")}</pre>
            ) : (
              <p className={styles.empty}>No discovery warnings.</p>
            )}
          </div>
        </article>

        <article className={`${styles.card} ${styles.col12}`}>
          <header className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Latest Queue Result</h3>
          </header>
          {submitPreview ? (
            <div className={styles.stack}>
              <div className={styles.kpiRow}>
                <span className={styles.badge}>Mode {submitPreview.mode}</span>
                <span className={styles.badge}>Queued {submitPreview.scheduledCount}</span>
              </div>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Artifact</th>
                      <th>Landing URL</th>
                      <th>Scheduled</th>
                      <th>Asset</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {submitPreview.created.map((item) => (
                      <tr key={item.id}>
                        <td>{item.id}</td>
                        <td>{item.landingUrl}</td>
                        <td>{formatDate(item.scheduledFor)}</td>
                        <td>{item.mediaAssetId ?? "text-only"}</td>
                        <td>
                          <div className={styles.inlineActions}>
                            <span>{item.status}</span>
                            <button
                              type="button"
                              className={styles.buttonGhost}
                              onClick={() => void pushNow([item.id])}
                              disabled={busy}
                            >
                              Push Now
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {submitPreview.warnings.length ? <pre className={styles.codeBlock}>{submitPreview.warnings.join("\n")}</pre> : null}
            </div>
          ) : (
            <p className={styles.empty}>No newly queued result in this session.</p>
          )}
        </article>

        <article className={`${styles.card} ${styles.col12}`}>
          <header className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Persisted Post Tool Queue</h3>
          </header>
          {persistedArtifacts.length ? (
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Artifact</th>
                    <th>Landing URL</th>
                    <th>Created</th>
                    <th>Scheduled</th>
                    <th>Asset</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {persistedArtifacts.map((item) => (
                    <tr key={item.id}>
                      <td>{item.id}</td>
                      <td>{item.landingUrl ?? "n/a"}</td>
                      <td>{formatDate(item.createdAt)}</td>
                      <td>{item.scheduledFor ? formatDate(item.scheduledFor) : "n/a"}</td>
                      <td>{item.mediaAssetId ?? "text-only"}</td>
                      <td>
                        <div className={styles.inlineActions}>
                          <span>{item.status}</span>
                          {item.status === "draft" || item.status === "scheduled" ? (
                            <button
                              type="button"
                              className={styles.buttonGhost}
                              onClick={() => void pushNow([item.id])}
                              disabled={busy}
                            >
                              Push Now
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className={styles.empty}>No persisted post-tool artifacts yet.</p>
          )}
        </article>
      </section>
    </>
  );
}
