"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useDashboardContext } from "../_components/dashboard-context";
import styles from "../_components/dashboard.module.css";

interface ClientRecord {
  id: string;
  name: string;
  timezone: string;
  primaryLocationLabel: string | null;
}

interface BlitzRunRecord {
  id: string;
  status: "created" | "running" | "completed" | "failed" | "partially_completed" | "rolled_back";
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

function formatDate(value: string | null): string {
  if (!value) return "N/A";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function BlitzRunsPage() {
  const { selectedOrgId, request } = useDashboardContext();
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [latestRunsByClient, setLatestRunsByClient] = useState<Record<string, BlitzRunRecord | null>>({});
  const [targetClientId, setTargetClientId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadBlitzIndex = () => {
    if (!selectedOrgId) {
      setClients([]);
      setLatestRunsByClient({});
      return;
    }

    setError(null);
    void request<{ clients: ClientRecord[] }>(`/api/v1/orgs/${selectedOrgId}/clients`)
      .then(async (clientsPayload) => {
        setClients(clientsPayload.clients);
        if (!targetClientId && clientsPayload.clients[0]) {
          setTargetClientId(clientsPayload.clients[0].id);
        }

        const runLookups = await Promise.all(
          clientsPayload.clients.map(async (client) => {
            try {
              const payload = await request<{ runs: BlitzRunRecord[] }>(`/api/v1/clients/${client.id}/blitz-runs?limit=1`);
              return [client.id, payload.runs[0] ?? null] as const;
            } catch {
              return [client.id, null] as const;
            }
          })
        );

        const map: Record<string, BlitzRunRecord | null> = {};
        for (const [clientId, run] of runLookups) {
          map[clientId] = run;
        }
        setLatestRunsByClient(map);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  };

  useEffect(loadBlitzIndex, [request, selectedOrgId]);

  const runSummary = useMemo(() => {
    const values = Object.values(latestRunsByClient).filter((run): run is BlitzRunRecord => Boolean(run));
    return {
      total: values.length,
      running: values.filter((run) => run.status === "running" || run.status === "created").length,
      failed: values.filter((run) => run.status === "failed").length
    };
  }, [latestRunsByClient]);

  const startQuickRun = async () => {
    if (!targetClientId) {
      setError("Select a client first.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await request(`/api/v1/clients/${targetClientId}/blitz-runs`, {
        method: "POST",
        body: {
          triggeredBy: "dashboard-blitz-page",
          policySnapshot: {
            source: "global-blitz-page"
          }
        }
      });
      loadBlitzIndex();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className={styles.hero}>
        <h2 className={styles.heroTitle}>Global Blitz Run Monitor</h2>
        <p className={styles.heroSubtitle}>
          One view for current worker activity across all seeded clients. Launch runs here or drill into each client’s dedicated Blitz page.
        </p>
        <div className={styles.kpiRow}>
          <span className={styles.badge}>Clients with runs: {runSummary.total}</span>
          <span className={styles.badge}>Workers active: {runSummary.running}</span>
          <span className={styles.badge}>Latest failures: {runSummary.failed}</span>
        </div>
        <div className={styles.inlineActions}>
          <label className={styles.field}>
            <span className={styles.label}>Quick launch client</span>
            <select
              className={styles.select}
              value={targetClientId}
              onChange={(event) => setTargetClientId(event.target.value)}
            >
              {!clients.length ? <option value="">No clients</option> : null}
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className={styles.buttonPrimary} onClick={() => void startQuickRun()} disabled={busy}>
            {busy ? "Launching..." : "Launch Blitz"}
          </button>
          <button type="button" className={styles.buttonGhost} onClick={loadBlitzIndex}>
            Refresh
          </button>
        </div>
        {error ? <span className={`${styles.badge} ${styles.statusError}`}>{error}</span> : null}
      </section>

      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h3 className={styles.cardTitle}>Latest Run Per Client</h3>
        </header>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Client</th>
                <th>Location</th>
                <th>Latest Status</th>
                <th>Run ID</th>
                <th>Started</th>
                <th>Completed</th>
                <th>Workspace</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => {
                const run = latestRunsByClient[client.id] ?? null;
                return (
                  <tr key={client.id}>
                    <td>{client.name}</td>
                    <td>{client.primaryLocationLabel ?? "N/A"}</td>
                    <td>{run?.status ?? "No runs"}</td>
                    <td>{run?.id ?? "-"}</td>
                    <td>{formatDate(run?.startedAt ?? null)}</td>
                    <td>{formatDate(run?.completedAt ?? null)}</td>
                    <td>
                      <Link href={`/dashboard/clients/${client.id}/blitz`} className={styles.link}>
                        Open
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {!clients.length ? (
                <tr>
                  <td colSpan={7}>
                    <p className={styles.empty}>No clients found for this organization.</p>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
