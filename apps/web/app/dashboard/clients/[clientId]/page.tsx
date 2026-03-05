"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ClientTabs } from "../../_components/client-tabs";
import { useDashboardContext } from "../../_components/dashboard-context";
import styles from "../../_components/dashboard.module.css";

interface ClientDetail {
  id: string;
  organizationId: string;
  name: string;
  timezone: string;
  websiteUrl: string | null;
  primaryLocationLabel: string | null;
  createdAt: string;
}

interface BlitzRunRecord {
  id: string;
  status: "created" | "running" | "completed" | "failed" | "partially_completed" | "rolled_back";
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdBy: string;
}

interface IntegrationRecord {
  id: string;
  provider: "gbp" | "ga4" | "google_ads" | "ghl";
  providerAccountId: string;
  scopes: string[];
  tokenExpiresAt: string | null;
  isActive: boolean;
  connectedAt: string;
}

interface DetailPayload {
  client: ClientDetail;
  workerStatus: "active" | "idle" | "error";
  latestRun: BlitzRunRecord | null;
  latestRunActionSummary: {
    attempted: number;
    executed: number;
    failed: number;
    pending: number;
    rolledBack: number;
    skipped: number;
  };
  recentRuns: BlitzRunRecord[];
}

function formatDate(value: string | null): string {
  if (!value) return "N/A";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function ClientOverviewPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const { request } = useDashboardContext();

  const [payload, setPayload] = useState<DetailPayload | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);

    void Promise.all([
      request<DetailPayload>(`/api/v1/clients/${clientId}`),
      request<{ integrations: IntegrationRecord[] }>(`/api/v1/clients/${clientId}/integrations`)
    ])
      .then(([detail, integrationPayload]) => {
        setPayload(detail);
        setIntegrations(integrationPayload.integrations);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [clientId, request]);

  const workerBadgeClass = useMemo(() => {
    if (!payload) return styles.statusIdle;
    if (payload.workerStatus === "active") return styles.statusActive;
    if (payload.workerStatus === "error") return styles.statusError;
    return styles.statusIdle;
  }, [payload]);

  return (
    <>
      <section className={styles.hero}>
        <h2 className={styles.heroTitle}>{payload?.client.name ?? "Client Workspace"}</h2>
        <p className={styles.heroSubtitle}>
          Monitor live Blitz worker state, integration health, and the most recent run for this GBP client.
        </p>
        <ClientTabs clientId={clientId} />
        {error ? <span className={`${styles.badge} ${styles.statusError}`}>{error}</span> : null}
      </section>

      <section className={styles.grid}>
        <article className={`${styles.card} ${styles.col4}`}>
          <header className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Worker Status</h3>
          </header>
          <p className={styles.statValue}>{payload?.workerStatus ?? (loading ? "..." : "idle")}</p>
          <span className={`${styles.badge} ${workerBadgeClass}`}>Blitz Worker {payload?.workerStatus ?? "idle"}</span>
        </article>

        <article className={`${styles.card} ${styles.col4}`}>
          <header className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Latest Run</h3>
          </header>
          <p className={styles.statValue}>{payload?.latestRun?.status ?? "No runs"}</p>
          <p className={styles.statLabel}>Started: {formatDate(payload?.latestRun?.startedAt ?? null)}</p>
        </article>

        <article className={`${styles.card} ${styles.col4}`}>
          <header className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Connected Integrations</h3>
          </header>
          <p className={styles.statValue}>{integrations.length}</p>
          <p className={styles.statLabel}>GBP / GA4 / Google Ads connectors</p>
        </article>

        <article className={`${styles.card} ${styles.col6}`}>
          <header className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Client Profile</h3>
          </header>
          {payload ? (
            <div className={styles.stack}>
              <p className={styles.empty}>Timezone: {payload.client.timezone}</p>
              <p className={styles.empty}>Primary Location: {payload.client.primaryLocationLabel ?? "N/A"}</p>
              <p className={styles.empty}>
                Website: {payload.client.websiteUrl ? <a className={styles.link} href={payload.client.websiteUrl}>{payload.client.websiteUrl}</a> : "N/A"}
              </p>
              <p className={styles.empty}>Created: {formatDate(payload.client.createdAt)}</p>
            </div>
          ) : (
            <p className={styles.empty}>{loading ? "Loading client profile..." : "No client data."}</p>
          )}
        </article>

        <article className={`${styles.card} ${styles.col6}`}>
          <header className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Latest Run Action Summary</h3>
          </header>
          {payload?.latestRun ? (
            <div className={styles.kpiRow}>
              <span className={styles.badge}>Attempted {payload.latestRunActionSummary.attempted}</span>
              <span className={styles.badge}>Executed {payload.latestRunActionSummary.executed}</span>
              <span className={styles.badge}>Failed {payload.latestRunActionSummary.failed}</span>
              <span className={styles.badge}>Pending {payload.latestRunActionSummary.pending}</span>
              <span className={styles.badge}>Rolled Back {payload.latestRunActionSummary.rolledBack}</span>
              <span className={styles.badge}>Skipped {payload.latestRunActionSummary.skipped}</span>
            </div>
          ) : (
            <p className={styles.empty}>No run executed yet. Start one from Blitz Worker.</p>
          )}
        </article>

        <article className={`${styles.card} ${styles.col12}`}>
          <header className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Recent Runs</h3>
          </header>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Run ID</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Started</th>
                  <th>Completed</th>
                  <th>Triggered By</th>
                </tr>
              </thead>
              <tbody>
                {payload?.recentRuns?.map((run) => (
                  <tr key={run.id}>
                    <td>
                      <Link className={styles.link} href={`/dashboard/clients/${clientId}/blitz?runId=${encodeURIComponent(run.id)}`}>
                        {run.id}
                      </Link>
                    </td>
                    <td>{run.status}</td>
                    <td>{formatDate(run.createdAt)}</td>
                    <td>{formatDate(run.startedAt)}</td>
                    <td>{formatDate(run.completedAt)}</td>
                    <td>{run.createdBy}</td>
                  </tr>
                ))}
                {!loading && (!payload || payload.recentRuns.length === 0) ? (
                  <tr>
                    <td colSpan={6}>
                      <p className={styles.empty}>No runs yet for this client.</p>
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
