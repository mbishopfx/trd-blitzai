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
  createdAt: string;
}

interface QaPair {
  question: string;
  answer: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function toQaPairs(value: unknown): QaPair[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      const record = asRecord(entry);
      const question = typeof record.question === "string" ? record.question : "";
      const answer = typeof record.answer === "string" ? record.answer : "";
      if (!question || !answer) {
        return null;
      }
      return { question, answer };
    })
    .filter((entry): entry is QaPair => Boolean(entry));
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export default function ClientQnaPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const { request } = useDashboardContext();

  const [artifacts, setArtifacts] = useState<ContentArtifact[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const load = () => {
    setError(null);
    void request<{ artifacts: ContentArtifact[] }>(
      `/api/v1/clients/${clientId}/content-artifacts?channel=gbp_qna_seed&phase=content&limit=100`
    )
      .then((payload) => {
        setArtifacts(payload.artifacts);
        if (!selectedId && payload.artifacts[0]) {
          setSelectedId(payload.artifacts[0].id);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  useEffect(load, [clientId, request]);

  const selected = useMemo(
    () => artifacts.find((artifact) => artifact.id === selectedId) ?? artifacts[0] ?? null,
    [artifacts, selectedId]
  );
  const qaPairs = useMemo(() => toQaPairs(selected?.metadata?.qaPairs), [selected]);

  const markStatus = async (nextStatus: "draft" | "published") => {
    if (!selected) {
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const nextMetadata = {
        ...selected.metadata,
        operatorUpdatedAt: new Date().toISOString(),
        operatorWorkflowStatus: nextStatus === "published" ? "seeded_to_gbp" : "ready_for_review"
      };
      await request(`/api/v1/clients/${clientId}/content-artifacts/${selected.id}`, {
        method: "PATCH",
        body: {
          status: nextStatus,
          metadata: nextMetadata,
          publishedAt: nextStatus === "published" ? new Date().toISOString() : undefined
        }
      });
      setStatus(nextStatus === "published" ? "Marked Q&A pack as seeded." : "Moved Q&A pack back to draft.");
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className={styles.hero}>
        <h2 className={styles.heroTitle}>Q&A Operations</h2>
        <p className={styles.heroSubtitle}>
          Review generated GBP Q&A seed packs, copy high-intent answers, and mark packs as seeded once the team applies them.
        </p>
        <ClientTabs clientId={clientId} />
        <div className={styles.inlineActions}>
          <button type="button" className={styles.buttonGhost} onClick={load} disabled={busy}>
            Refresh Seed Packs
          </button>
          <button type="button" className={styles.buttonSecondary} onClick={() => void markStatus("draft")} disabled={busy || !selected}>
            Mark Draft
          </button>
          <button type="button" className={styles.buttonPrimary} onClick={() => void markStatus("published")} disabled={busy || !selected}>
            Mark Seeded
          </button>
        </div>
        {status ? <span className={`${styles.badge} ${styles.statusActive}`}>{status}</span> : null}
        {error ? <span className={`${styles.badge} ${styles.statusError}`}>{error}</span> : null}
      </section>

      <section className={styles.grid}>
        <article className={`${styles.card} ${styles.col4}`}>
          <header className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Seed Packs</h3>
          </header>
          <div className={styles.stack}>
            {artifacts.map((artifact) => (
              <button
                key={artifact.id}
                type="button"
                className={`${styles.buttonGhost} ${selected?.id === artifact.id ? styles.buttonSecondary : ""}`}
                onClick={() => setSelectedId(artifact.id)}
              >
                {(artifact.title ?? "Untitled Q&A Pack").slice(0, 72)}
              </button>
            ))}
            {!artifacts.length ? <p className={styles.empty}>No generated Q&A seed packs yet.</p> : null}
          </div>
        </article>

        <article className={`${styles.card} ${styles.col8}`}>
          <header className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>{selected?.title ?? "Q&A Seed Detail"}</h3>
            {selected ? <span className={styles.badge}>{selected.status}</span> : null}
          </header>
          {selected ? (
            <div className={styles.stack}>
              <p className={styles.cardHint}>Created {formatDate(selected.createdAt)}</p>
              <pre className={styles.codeBlock}>{selected.body}</pre>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Question</th>
                      <th>Answer</th>
                    </tr>
                  </thead>
                  <tbody>
                    {qaPairs.map((pair, index) => (
                      <tr key={`${pair.question}-${index}`}>
                        <td>{pair.question}</td>
                        <td>{pair.answer}</td>
                      </tr>
                    ))}
                    {!qaPairs.length ? (
                      <tr>
                        <td colSpan={2}>
                          <p className={styles.empty}>No Q&A pairs found in this artifact.</p>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className={styles.empty}>Select a Q&A pack to review it.</p>
          )}
        </article>
      </section>
    </>
  );
}
