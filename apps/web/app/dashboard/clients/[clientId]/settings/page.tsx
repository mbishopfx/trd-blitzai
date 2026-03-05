"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ClientTabs } from "../../../_components/client-tabs";
import { useDashboardContext } from "../../../_components/dashboard-context";
import styles from "../../../_components/dashboard.module.css";

interface OrchestrationSettings {
  clientId: string;
  organizationId: string;
  tone: string;
  objectives: string[];
  photoAssetUrls: string[];
  sitemapUrl: string | null;
  defaultPostUrl: string | null;
  reviewReplyStyle: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
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

export default function ClientOrchestrationSettingsPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const { request } = useDashboardContext();

  const [tone, setTone] = useState("professional-local-expert");
  const [objectivesText, setObjectivesText] = useState("");
  const [photoUrlsText, setPhotoUrlsText] = useState("");
  const [sitemapUrl, setSitemapUrl] = useState("");
  const [defaultPostUrl, setDefaultPostUrl] = useState("");
  const [reviewReplyStyle, setReviewReplyStyle] = useState("balanced");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadSettings = () => {
    setBusy(true);
    setError(null);
    setStatus(null);

    void request<{ settings: OrchestrationSettings }>(`/api/v1/clients/${clientId}/orchestration/settings`)
      .then((payload) => {
        setTone(payload.settings.tone);
        setObjectivesText(toLines(payload.settings.objectives));
        setPhotoUrlsText(toLines(payload.settings.photoAssetUrls));
        setSitemapUrl(payload.settings.sitemapUrl ?? "");
        setDefaultPostUrl(payload.settings.defaultPostUrl ?? "");
        setReviewReplyStyle(payload.settings.reviewReplyStyle);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setBusy(false);
      });
  };

  useEffect(loadSettings, [clientId, request]);

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

    try {
      await request<{ settings: OrchestrationSettings }>(`/api/v1/clients/${clientId}/orchestration/settings`, {
        method: "POST",
        body: {
          tone: tone.trim(),
          objectives,
          photoAssetUrls,
          sitemapUrl: sitemapUrl.trim() || null,
          defaultPostUrl: defaultPostUrl.trim() || null,
          reviewReplyStyle: reviewReplyStyle.trim(),
          metadata: {
            updatedFrom: "dashboard-client-orchestration"
          }
        }
      });

      setStatus("Orchestration settings saved. New Blitz runs and auto-reply workers will use these values.");
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
          Configure how Blitz writes, what it prioritizes, which photo URLs it can use for GBP posts, and what site URLs it should link.
        </p>
        <ClientTabs clientId={clientId} />
        <div className={styles.kpiRow}>
          <span className={styles.badge}>Tone controls AI post/reply language</span>
          <span className={styles.badge}>Objectives guide Blitz strategy</span>
          <span className={styles.badge}>Sitemap/default URLs route traffic from GBP posts</span>
        </div>
        <div className={styles.inlineActions}>
          <button type="button" className={styles.buttonPrimary} onClick={() => void saveSettings()} disabled={busy}>
            {busy ? "Saving..." : "Save Settings"}
          </button>
          <button type="button" className={styles.buttonGhost} onClick={loadSettings} disabled={busy}>
            Reload
          </button>
        </div>
        {status ? <span className={`${styles.badge} ${styles.statusActive}`}>{status}</span> : null}
        {error ? <span className={`${styles.badge} ${styles.statusError}`}>{error}</span> : null}
      </section>

      <section className={styles.grid}>
        <article className={`${styles.card} ${styles.col6}`}>
          <header className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Content and Review Voice</h3>
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
            <h3 className={styles.cardTitle}>Media and URL Routing</h3>
          </header>
          <label className={styles.field}>
            <span className={styles.label}>Photo Asset URLs (one per line)</span>
            <textarea
              className={styles.textarea}
              value={photoUrlsText}
              onChange={(event) => setPhotoUrlsText(event.target.value)}
              placeholder={"https://cdn.truerankdigital.com/client/location-1.jpg\nhttps://cdn.truerankdigital.com/client/location-2.jpg"}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Sitemap URL</span>
            <input
              className={styles.input}
              value={sitemapUrl}
              onChange={(event) => setSitemapUrl(event.target.value)}
              placeholder="https://client.com/sitemap.xml"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Default GBP Post URL</span>
            <input
              className={styles.input}
              value={defaultPostUrl}
              onChange={(event) => setDefaultPostUrl(event.target.value)}
              placeholder="https://client.com/local-offer"
            />
          </label>
        </article>
      </section>
    </>
  );
}
