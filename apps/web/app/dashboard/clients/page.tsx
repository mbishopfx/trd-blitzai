"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useDashboardContext } from "../_components/dashboard-context";
import styles from "../_components/dashboard.module.css";

interface ClientRecord {
  id: string;
  organizationId: string;
  name: string;
  timezone: string;
  websiteUrl: string | null;
  primaryLocationLabel: string | null;
  createdAt: string;
}

interface OAuthStartResponse {
  authUrl: string;
  redirectUri: string;
}

interface SitemapAutofillResponse {
  summary: {
    total: number;
    updated: number;
    skipped: number;
    failed: number;
  };
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function ClientsPage() {
  const { selectedOrgId, request } = useDashboardContext();
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [autofillStatus, setAutofillStatus] = useState<string | null>(null);
  const [seedQueryState, setSeedQueryState] = useState<{
    oauthConnected: boolean;
    seededClients: string | null;
    refreshedClients: string | null;
    seededSkipped: string | null;
    seedError: string | null;
  }>({
    oauthConnected: false,
    seededClients: null,
    refreshedClients: null,
    seededSkipped: null,
    seedError: null
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    setSeedQueryState({
      oauthConnected: params.get("gbp_connected") === "true",
      seededClients: params.get("seeded_clients"),
      refreshedClients: params.get("refreshed_clients"),
      seededSkipped: params.get("seeded_skipped"),
      seedError: params.get("gbp_seed_error")
    });
  }, []);

  const seedStatusLabel = useMemo(() => {
    if (!seedQueryState.oauthConnected) {
      return null;
    }
    if (seedQueryState.seedError) {
      return `OAuth connected, but seeding returned an error: ${seedQueryState.seedError}`;
    }
    return `OAuth connected. Seeded ${seedQueryState.seededClients ?? "0"} new clients, refreshed ${seedQueryState.refreshedClients ?? "0"} existing clients, skipped ${seedQueryState.seededSkipped ?? "0"}.`;
  }, [seedQueryState]);

  const loadClients = () => {
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
  };

  useEffect(loadClients, [request, selectedOrgId]);

  const startOAuthSeed = async () => {
    if (!selectedOrgId) {
      setError("Select an organization before starting OAuth");
      return;
    }

    setBusy(true);
    setError(null);
    setAutofillStatus(null);

    try {
      const oauthStart = await request<OAuthStartResponse>(
        `/api/v1/gbp/oauth/start?seedMode=true&returnPath=${encodeURIComponent("/dashboard/clients")}`
      );

      window.location.assign(oauthStart.authUrl);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const deleteClient = async (client: ClientRecord) => {
    const confirmed = window.confirm(
      `Delete ${client.name} from Blitz platform? This only removes it from TRD Blitz and does not remove it from Google Business Profile.`
    );
    if (!confirmed) {
      return;
    }

    setBusy(true);
    setError(null);
    setAutofillStatus(null);
    try {
      await request(`/api/v1/clients/${client.id}`, {
        method: "DELETE"
      });
      loadClients();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const autofillSitemaps = async () => {
    if (!selectedOrgId) {
      setError("Select an organization before auto-filling sitemaps");
      return;
    }

    setBusy(true);
    setError(null);
    setAutofillStatus(null);
    try {
      const payload = await request<SitemapAutofillResponse>(`/api/v1/orgs/${selectedOrgId}/clients/sitemaps/autofill`, {
        method: "POST",
        body: {
          overwrite: false
        }
      });
      setAutofillStatus(
        `Sitemap autofill finished. Updated ${payload.summary.updated}/${payload.summary.total}, skipped ${payload.summary.skipped}, failed ${payload.summary.failed}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className={styles.hero}>
        <h2 className={styles.heroTitle}>Client Workspace Index</h2>
        <p className={styles.heroSubtitle}>
          This tab lists every seeded GBP client. Click any client to open its dedicated orchestration workspace.
        </p>
        <div className={styles.inlineActions}>
          <button type="button" className={styles.buttonPrimary} onClick={() => void startOAuthSeed()} disabled={busy}>
            {busy ? "Starting OAuth..." : "Connect Google + Seed Clients"}
          </button>
          <button type="button" className={styles.buttonSecondary} onClick={() => void autofillSitemaps()} disabled={busy}>
            Auto-fill Sitemaps
          </button>
          <button type="button" className={styles.buttonGhost} onClick={loadClients} disabled={loading}>
            Refresh Client List
          </button>
        </div>
        {seedStatusLabel ? (
          <span className={`${styles.badge} ${seedQueryState.seedError ? styles.statusError : styles.statusActive}`}>
            {seedStatusLabel}
          </span>
        ) : null}
        {autofillStatus ? <span className={`${styles.badge} ${styles.statusActive}`}>{autofillStatus}</span> : null}
        {error ? <span className={`${styles.badge} ${styles.statusError}`}>{error}</span> : null}
      </section>

      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h3 className={styles.cardTitle}>Seeded Clients ({clients.length})</h3>
          <p className={styles.cardHint}>Each row maps to a managed GBP location</p>
        </header>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Client</th>
                <th>Primary Location</th>
                <th>Timezone</th>
                <th>Website</th>
                <th>Created</th>
                <th>Workspace</th>
                <th>Platform Control</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                <tr key={client.id}>
                  <td>
                    <strong>{client.name}</strong>
                    <br />
                    <span className={styles.muted}>{client.id}</span>
                  </td>
                  <td>{client.primaryLocationLabel ?? "Not synced"}</td>
                  <td>{client.timezone}</td>
                  <td>
                    {client.websiteUrl ? (
                      <a href={client.websiteUrl} target="_blank" rel="noreferrer" className={styles.link}>
                        {client.websiteUrl}
                      </a>
                    ) : (
                      <span className={styles.muted}>N/A</span>
                    )}
                  </td>
                  <td>{formatDate(client.createdAt)}</td>
                  <td>
                    <Link className={styles.link} href={`/dashboard/clients/${client.id}`}>
                      Open
                    </Link>
                  </td>
                  <td>
                    <button type="button" className={styles.buttonDanger} disabled={busy} onClick={() => void deleteClient(client)}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && clients.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <p className={styles.empty}>No clients found. Run "Connect Google + Seed Clients" to import your GBP locations.</p>
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
