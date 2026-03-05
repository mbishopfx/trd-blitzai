"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ClientTabs } from "../../../_components/client-tabs";
import { useDashboardContext } from "../../../_components/dashboard-context";
import styles from "../../../_components/dashboard.module.css";

type RunStatus = "created" | "running" | "completed" | "failed" | "partially_completed" | "rolled_back";

interface BlitzRunRecord {
  id: string;
  status: RunStatus;
  startedAt: string | null;
  completedAt: string | null;
  createdBy: string;
  createdAt: string;
  policySnapshot: Record<string, unknown>;
}

interface BlitzAction {
  id: string;
  runId: string;
  phase: string;
  actionType: string;
  riskTier: string;
  policyDecision: string;
  status: "pending" | "executed" | "failed" | "rolled_back" | "skipped";
  actor: "system" | "user" | "operator";
  idempotencyKey: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  executedAt: string | null;
}

interface ProtocolSelection {
  completenessOverhaul: boolean;
  mediaFlood: boolean;
  geoContentBarrage: boolean;
  reviewIgnition: boolean;
  interactionVelocity: boolean;
  competitorBenchmarking: boolean;
  continuousAutopilot: boolean;
}

const defaultProtocolSelection: ProtocolSelection = {
  completenessOverhaul: true,
  mediaFlood: true,
  geoContentBarrage: true,
  reviewIgnition: true,
  interactionVelocity: true,
  competitorBenchmarking: true,
  continuousAutopilot: true
};

function formatDate(value: string | null): string {
  if (!value) return "N/A";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function ClientBlitzPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const searchParams = useSearchParams();
  const { request } = useDashboardContext();

  const [runs, setRuns] = useState<BlitzRunRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [actions, setActions] = useState<BlitzAction[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [triggeredBy, setTriggeredBy] = useState("dashboard-operator");
  const [rollbackReason, setRollbackReason] = useState("Manual rollback from client workspace");
  const [protocol, setProtocol] = useState<ProtocolSelection>(defaultProtocolSelection);

  const selectedRunFromQuery = searchParams.get("runId");

  const loadRuns = () => {
    setLoading(true);
    setError(null);

    void request<{ runs: BlitzRunRecord[] }>(`/api/v1/clients/${clientId}/blitz-runs?limit=25`)
      .then((payload) => {
        setRuns(payload.runs);
        const queryPreferred = selectedRunFromQuery && payload.runs.some((run) => run.id === selectedRunFromQuery);
        if (queryPreferred) {
          setSelectedRunId(selectedRunFromQuery ?? "");
          return;
        }

        if (payload.runs.length === 0) {
          setSelectedRunId("");
          return;
        }

        if (!payload.runs.some((run) => run.id === selectedRunId)) {
          setSelectedRunId(payload.runs[0].id);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(loadRuns, [clientId, request, selectedRunFromQuery]);

  useEffect(() => {
    if (!selectedRunId) {
      setActions([]);
      return;
    }

    void request<{ actions: BlitzAction[] }>(`/api/v1/blitz-runs/${selectedRunId}/actions`)
      .then((payload) => {
        setActions(payload.actions);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [request, selectedRunId]);

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? null,
    [runs, selectedRunId]
  );

  const startBlitzRun = async () => {
    setBusy(true);
    setError(null);

    try {
      const runPayload = await request<{ run: BlitzRunRecord }>(`/api/v1/clients/${clientId}/blitz-runs`, {
        method: "POST",
        body: {
          triggeredBy,
          policySnapshot: {
            protocol,
            source: "dashboard-client-blitz"
          }
        }
      });

      setSelectedRunId(runPayload.run.id);
      loadRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const rollbackAction = async (actionId: string) => {
    setBusy(true);
    setError(null);
    try {
      await request(`/api/v1/blitz-actions/${actionId}/rollback`, {
        method: "POST",
        body: {
          reason: rollbackReason
        }
      });

      if (selectedRunId) {
        const payload = await request<{ actions: BlitzAction[] }>(`/api/v1/blitz-runs/${selectedRunId}/actions`);
        setActions(payload.actions);
      }
      loadRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className={styles.hero}>
        <h2 className={styles.heroTitle}>Blitz Worker</h2>
        <p className={styles.heroSubtitle}>
          Run the full Blitz protocol for this client, inspect action-level execution, and rollback reversible actions.
        </p>
        <ClientTabs clientId={clientId} />
        {error ? <span className={`${styles.badge} ${styles.statusError}`}>{error}</span> : null}
      </section>

      <section className={styles.grid}>
        <article className={`${styles.card} ${styles.col6}`}>
          <header className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Start New Blitz Run</h3>
            <span className={`${styles.badge} ${styles.statusActive}`}>Autonomous Mode</span>
          </header>
          <div className={styles.split}>
            <label className={styles.field}>
              <span className={styles.label}>Triggered By</span>
              <input className={styles.input} value={triggeredBy} onChange={(event) => setTriggeredBy(event.target.value)} />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Rollback Reason Template</span>
              <input
                className={styles.input}
                value={rollbackReason}
                onChange={(event) => setRollbackReason(event.target.value)}
              />
            </label>
          </div>

          <div className={styles.kpiRow}>
            {Object.entries(protocol).map(([key, value]) => (
              <label key={key} className={styles.badge}>
                <input
                  type="checkbox"
                  checked={value}
                  onChange={(event) =>
                    setProtocol((current) => ({
                      ...current,
                      [key]: event.target.checked
                    }))
                  }
                />{" "}
                {key}
              </label>
            ))}
          </div>

          <div className={styles.inlineActions}>
            <button type="button" className={styles.buttonPrimary} disabled={busy} onClick={() => void startBlitzRun()}>
              {busy ? "Launching..." : "Launch Blitz Run"}
            </button>
            <button type="button" className={styles.buttonGhost} disabled={loading} onClick={loadRuns}>
              Refresh Runs
            </button>
          </div>
        </article>

        <article className={`${styles.card} ${styles.col6}`}>
          <header className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Run Selector</h3>
            <span className={styles.badge}>{runs.length} runs</span>
          </header>
          <label className={styles.field}>
            <span className={styles.label}>Selected Run</span>
            <select className={styles.select} value={selectedRunId} onChange={(event) => setSelectedRunId(event.target.value)}>
              {!runs.length ? <option value="">No runs available</option> : null}
              {runs.map((run) => (
                <option key={run.id} value={run.id}>
                  {run.status} | {run.id.slice(0, 8)} | {formatDate(run.createdAt)}
                </option>
              ))}
            </select>
          </label>
          {selectedRun ? (
            <div className={styles.kpiRow}>
              <span className={styles.badge}>Status: {selectedRun.status}</span>
              <span className={styles.badge}>Started: {formatDate(selectedRun.startedAt)}</span>
              <span className={styles.badge}>Completed: {formatDate(selectedRun.completedAt)}</span>
            </div>
          ) : (
            <p className={styles.empty}>{loading ? "Loading runs..." : "No run selected."}</p>
          )}
        </article>

        <article className={`${styles.card} ${styles.col12}`}>
          <header className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Action Timeline</h3>
            <p className={styles.cardHint}>Rollback is available directly from each action row</p>
          </header>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Phase</th>
                  <th>Action Type</th>
                  <th>Status</th>
                  <th>Risk</th>
                  <th>Policy</th>
                  <th>Executed</th>
                  <th>Error</th>
                  <th>Rollback</th>
                </tr>
              </thead>
              <tbody>
                {actions.map((action) => (
                  <tr key={action.id}>
                    <td>{action.phase}</td>
                    <td>{action.actionType}</td>
                    <td>{action.status}</td>
                    <td>{action.riskTier}</td>
                    <td>{action.policyDecision}</td>
                    <td>{formatDate(action.executedAt)}</td>
                    <td>{action.error ?? "-"}</td>
                    <td>
                      {action.status === "executed" || action.status === "failed" ? (
                        <button
                          type="button"
                          className={styles.buttonDanger}
                          disabled={busy}
                          onClick={() => void rollbackAction(action.id)}
                        >
                          Rollback
                        </button>
                      ) : (
                        <span className={styles.muted}>n/a</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!actions.length ? (
                  <tr>
                    <td colSpan={8}>
                      <p className={styles.empty}>No actions loaded for the selected run.</p>
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
