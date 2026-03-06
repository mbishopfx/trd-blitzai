"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ClientTabs } from "../../../_components/client-tabs";
import { useDashboardContext } from "../../../_components/dashboard-context";
import styles from "../../../_components/dashboard.module.css";

interface ContentArtifact {
  id: string;
  title: string | null;
  body: string;
  metadata: Record<string, unknown>;
  status: "draft" | "scheduled" | "published" | "failed";
  scheduledFor: string | null;
  createdAt: string;
}

type StatusFilter = "all" | "draft" | "scheduled" | "published" | "failed";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "N/A";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function parseSnippet(metadata: Record<string, unknown>): string {
  return typeof metadata.snippet === "string" ? metadata.snippet : "";
}

export default function ClientContentOpsPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const { request } = useDashboardContext();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("draft");
  const [artifacts, setArtifacts] = useState<ContentArtifact[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [snippet, setSnippet] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = () => {
    setError(null);
    void request<{ artifacts: ContentArtifact[] }>(
      `/api/v1/clients/${clientId}/content-artifacts?channel=gbp&phase=content&status=${encodeURIComponent(statusFilter)}&limit=200`
    )
      .then((payload) => {
        setArtifacts(payload.artifacts);
        if (!selectedId && payload.artifacts[0]) {
          setSelectedId(payload.artifacts[0].id);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  useEffect(load, [clientId, request, statusFilter]);

  const selected = useMemo(
    () => artifacts.find((artifact) => artifact.id === selectedId) ?? artifacts[0] ?? null,
    [artifacts, selectedId]
  );

  useEffect(() => {
    if (!selected) {
      setTitle("");
      setBody("");
      setSnippet("");
      return;
    }
    setTitle(selected.title ?? "");
    setBody(selected.body ?? "");
    setSnippet(parseSnippet(asRecord(selected.metadata)));
  }, [selected]);

  const patchArtifact = async (
    patch: {
      title?: string | null;
      body?: string;
      status?: "draft" | "scheduled" | "published" | "failed";
      scheduledFor?: string | null;
      metadata?: Record<string, unknown>;
    },
    successMessage: string
  ) => {
    if (!selected) {
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await request(`/api/v1/clients/${clientId}/content-artifacts/${selected.id}`, {
        method: "PATCH",
        body: patch
      });
      setMessage(successMessage);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const saveEdits = async () => {
    if (!selected) {
      return;
    }
    const nextMetadata = {
      ...asRecord(selected.metadata),
      snippet,
      operatorWorkflowStatus: "edited",
      operatorUpdatedAt: new Date().toISOString()
    };
    await patchArtifact(
      {
        title: title.trim() || null,
        body,
        metadata: nextMetadata
      },
      "Content edits saved."
    );
  };

  const approveAndQueue = async (useRecommendedTime: boolean) => {
    if (!selected) {
      return;
    }
    const metadata = asRecord(selected.metadata);
    const recommended = typeof metadata.recommendedScheduledFor === "string" ? metadata.recommendedScheduledFor : null;
    const scheduledFor = useRecommendedTime && recommended ? recommended : new Date().toISOString();
    const nextMetadata = {
      ...metadata,
      snippet,
      operatorWorkflowStatus: "approved_for_dispatch",
      operatorApprovedAt: new Date().toISOString()
    };
    await patchArtifact(
      {
        title: title.trim() || null,
        body,
        status: "scheduled",
        scheduledFor,
        metadata: nextMetadata
      },
      `Artifact queued for dispatch (${useRecommendedTime && recommended ? "recommended time" : "now"}).`
    );
  };

  const rejectDraft = async () => {
    if (!selected) {
      return;
    }
    const reason = window.prompt("Optional rejection reason:", "")?.trim() ?? "";
    const nextMetadata = {
      ...asRecord(selected.metadata),
      snippet,
      operatorWorkflowStatus: "rejected",
      operatorRejectedAt: new Date().toISOString(),
      operatorRejectionReason: reason || null
    };
    await patchArtifact(
      {
        status: "failed",
        metadata: nextMetadata
      },
      "Artifact rejected."
    );
  };

  return (
    <>
      <section className={styles.hero}>
        <h2 className={styles.heroTitle}>Content Operations</h2>
        <p className={styles.heroSubtitle}>
          Review GEO post drafts, edit copy/snippets, and queue approved items into scheduled dispatch.
        </p>
        <ClientTabs clientId={clientId} />
        <div className={styles.topbarRow}>
          <label className={styles.field} style={{ maxWidth: 220 }}>
            <span className={styles.label}>Status Filter</span>
            <select
              className={styles.select}
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
            >
              <option value="draft">draft</option>
              <option value="scheduled">scheduled</option>
              <option value="published">published</option>
              <option value="failed">failed</option>
              <option value="all">all</option>
            </select>
          </label>
          <button type="button" className={styles.buttonSecondary} onClick={load} disabled={busy}>
            Refresh
          </button>
          <span className={styles.badge}>Items {artifacts.length}</span>
        </div>
        {message ? <span className={`${styles.badge} ${styles.statusActive}`}>{message}</span> : null}
        {error ? <span className={`${styles.badge} ${styles.statusError}`}>{error}</span> : null}
      </section>

      <section className={styles.grid}>
        <article className={`${styles.card} ${styles.col4}`}>
          <header className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Draft Queue</h3>
          </header>
          <div className={styles.stack}>
            {artifacts.map((artifact) => (
              <button
                key={artifact.id}
                type="button"
                className={`${styles.buttonGhost} ${selected?.id === artifact.id ? styles.buttonSecondary : ""}`}
                onClick={() => setSelectedId(artifact.id)}
              >
                {(artifact.title ?? "Untitled Artifact").slice(0, 72)}
              </button>
            ))}
            {!artifacts.length ? <p className={styles.empty}>No content artifacts found for this filter.</p> : null}
          </div>
        </article>

        <article className={`${styles.card} ${styles.col8}`}>
          <header className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>{selected?.title ?? "Content Detail"}</h3>
            {selected ? <span className={styles.badge}>{selected.status}</span> : null}
          </header>
          {selected ? (
            <div className={styles.stack}>
              <p className={styles.cardHint}>Created {formatDate(selected.createdAt)}</p>
              <p className={styles.cardHint}>Scheduled {formatDate(selected.scheduledFor)}</p>
              <label className={styles.field}>
                <span className={styles.label}>Title</span>
                <input className={styles.input} value={title} onChange={(event) => setTitle(event.target.value)} />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Snippet (GBP Summary)</span>
                <textarea className={styles.textarea} value={snippet} onChange={(event) => setSnippet(event.target.value)} />
              </label>
              <label className={styles.field}>
                <span className={styles.label}>Long Form Draft</span>
                <textarea className={styles.textarea} value={body} onChange={(event) => setBody(event.target.value)} />
              </label>
              <div className={styles.inlineActions}>
                <button type="button" className={styles.buttonSecondary} onClick={() => void saveEdits()} disabled={busy}>
                  Save Edits
                </button>
                <button type="button" className={styles.buttonPrimary} onClick={() => void approveAndQueue(false)} disabled={busy}>
                  Approve + Queue Now
                </button>
                <button type="button" className={styles.buttonPrimary} onClick={() => void approveAndQueue(true)} disabled={busy}>
                  Approve + Queue Recommended
                </button>
                <button type="button" className={styles.buttonGhost} onClick={() => void rejectDraft()} disabled={busy}>
                  Reject
                </button>
              </div>
              <pre className={styles.codeBlock}>{JSON.stringify(selected.metadata, null, 2)}</pre>
            </div>
          ) : (
            <p className={styles.empty}>Select a content artifact to review it.</p>
          )}
        </article>
      </section>
    </>
  );
}
