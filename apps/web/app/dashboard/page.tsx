"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useDashboardContext } from "./_components/dashboard-context";
import styles from "./_components/dashboard.module.css";

interface ClientRecord {
  id: string;
  name: string;
  timezone: string;
  websiteUrl: string | null;
  primaryLocationLabel: string | null;
  createdAt: string;
}

export default function DashboardOverviewPage() {
  const { selectedOrgId, organizations, request } = useDashboardContext();
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedOrgId) {
      setClients([]);
      return;
    }

    setLoading(true);
    setError(null);
    void request<{ clients: ClientRecord[] }>(`/api/v1/orgs/${selectedOrgId}/clients`)
      .then((payload) => {
        setClients(payload.clients);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [request, selectedOrgId]);

  const selectedOrg = useMemo(
    () => organizations.find((org) => org.id === selectedOrgId) ?? null,
    [organizations, selectedOrgId]
  );

  return (
    <>
      <section className={styles.hero}>
        <h2 className={styles.heroTitle}>Agency Control Plane</h2>
        <p className={styles.heroSubtitle}>
          Manage seeded GBP clients, run Blitz orchestration workflows, control autonomous review replies, and tune
          per-client content strategy from dedicated pages.
        </p>
        <div className={styles.inlineActions}>
          <Link href="/dashboard/clients" className={styles.buttonPrimary}>
            Open Clients
          </Link>
          <Link href="/dashboard/blitz" className={styles.buttonSecondary}>
            Open Blitz Runs
          </Link>
        </div>
      </section>

      <section className={styles.grid}>
        <article className={`${styles.card} ${styles.col4}`}>
          <header className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Organization</h3>
            <span className={`${styles.badge} ${styles.statusIdle}`}>{selectedOrg ? "Selected" : "Missing"}</span>
          </header>
          <p className={styles.statValue}>{selectedOrg?.name ?? "No organization"}</p>
          <p className={styles.statLabel}>{selectedOrg?.slug ?? "Create or select an org to begin"}</p>
        </article>

        <article className={`${styles.card} ${styles.col4}`}>
          <header className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Seeded Clients</h3>
            <span className={`${styles.badge} ${styles.statusActive}`}>Live</span>
          </header>
          <p className={styles.statValue}>{loading ? "..." : clients.length}</p>
          <p className={styles.statLabel}>Connected GBP locations under this organization</p>
        </article>

        <article className={`${styles.card} ${styles.col4}`}>
          <header className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Platform State</h3>
          </header>
          <p className={styles.statValue}>{error ? "Issue" : "Healthy"}</p>
          <p className={styles.statLabel}>{error ? error : "API routes and dashboard context loaded"}</p>
        </article>

        <article className={`${styles.card} ${styles.col12}`}>
          <header className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>What Is Automated</h3>
          </header>
          <div className={styles.kpiRow}>
            <span className={styles.badge}>GBP client discovery and seeding</span>
            <span className={styles.badge}>Blitz protocol run orchestration</span>
            <span className={styles.badge}>Run/action audit timeline</span>
            <span className={styles.badge}>Autonomous review reply workers</span>
            <span className={styles.badge}>Per-client tone/objective/photo/sitemap controls</span>
            <span className={styles.badge}>Attribution panel (GBP + GA4 + Ads)</span>
          </div>
        </article>
      </section>
    </>
  );
}
