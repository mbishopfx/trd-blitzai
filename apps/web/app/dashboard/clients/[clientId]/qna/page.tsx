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

function qaPairsToEditorJson(value: QaPair[]): string {
  return JSON.stringify(value, null, 2);
}

function buildQaBody(title: string, qaPairs: QaPair[]): string {
  const header = `# GBP Q&A Seed Pack\n\nBusiness: ${title}\n\nManual seeding pack for GBP Q&A.`;
  const rows = qaPairs.map((pair, index) => `## Q${index + 1}\nQuestion: ${pair.question}\nAnswer: ${pair.answer}`);
  return `${header}\n\n${rows.join("\n\n")}`.trim();
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
  const [qaEditor, setQaEditor] = useState("[]");

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

  useEffect(() => {
    setQaEditor(qaPairsToEditorJson(qaPairs));
  }, [selected?.id, qaPairs]);

  const patchArtifact = async (inputPatch: {
    status?: "draft" | "published" | "failed";
    metadata?: Record<string, unknown>;
    title?: string | null;
    body?: string;
    publishedAt?: string;
  }) => {
    if (!selected) {
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await request(`/api/v1/clients/${clientId}/content-artifacts/${selected.id}`, {
        method: "PATCH",
        body: inputPatch
      });
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
    try {
      const parsed = JSON.parse(qaEditor) as unknown;
      const nextQaPairs = toQaPairs(parsed);
      if (!nextQaPairs.length) {
        setError("Q&A editor JSON must include at least one valid question/answer pair.");
        return;
      }
      const nextMetadata = {
        ...selected.metadata,
        qaPairs: nextQaPairs,
        operatorUpdatedAt: new Date().toISOString(),
        operatorWorkflowStatus: "edited"
      };
      await patchArtifact({
        metadata: nextMetadata,
        body: buildQaBody(selected.title ?? "Business", nextQaPairs)
      });
      setStatus("Saved Q&A edits.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid JSON in Q&A editor.");
    }
  };

  const approvePack = async () => {
    if (!selected) {
      return;
    }
    const nextMetadata = {
      ...selected.metadata,
      operatorApprovedAt: new Date().toISOString(),
      operatorWorkflowStatus: "approved_for_manual_seed"
    };
    await patchArtifact({
      status: "draft",
      metadata: nextMetadata
    });
    setStatus("Approved Q&A pack for manual GBP seeding.");
  };

  const markSeeded = async () => {
    if (!selected) {
      return;
    }
    const nextMetadata = {
      ...selected.metadata,
      operatorUpdatedAt: new Date().toISOString(),
      operatorWorkflowStatus: "seeded_to_gbp"
    };
    await patchArtifact({
      status: "published",
      metadata: nextMetadata,
      publishedAt: new Date().toISOString()
    });
    setStatus("Marked Q&A pack as seeded in GBP.");
  };

  const rejectPack = async () => {
    if (!selected) {
      return;
    }
    const reason = window.prompt("Optional rejection reason:", "")?.trim() ?? "";
    const nextMetadata = {
      ...selected.metadata,
      operatorUpdatedAt: new Date().toISOString(),
      operatorWorkflowStatus: "rejected",
      rejectionReason: reason || null
    };
    await patchArtifact({
      status: "failed",
      metadata: nextMetadata
    });
    setStatus("Rejected Q&A pack.");
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
          <button type="button" className={styles.buttonSecondary} onClick={() => void saveEdits()} disabled={busy || !selected}>
            Save Edits
          </button>
          <button type="button" className={styles.buttonSecondary} onClick={() => void approvePack()} disabled={busy || !selected}>
            Approve Pack
          </button>
          <button type="button" className={styles.buttonPrimary} onClick={() => void markSeeded()} disabled={busy || !selected}>
            Mark Seeded
          </button>
          <button type="button" className={styles.buttonGhost} onClick={() => void rejectPack()} disabled={busy || !selected}>
            Reject
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
              <label className={styles.field}>
                <span className={styles.label}>Q&A Editor JSON</span>
                <textarea className={styles.textarea} value={qaEditor} onChange={(event) => setQaEditor(event.target.value)} />
              </label>
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
