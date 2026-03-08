"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ClientTabs } from "../../../_components/client-tabs";
import { useDashboardContext } from "../../../_components/dashboard-context";
import styles from "../../../_components/dashboard.module.css";

interface ContentArtifact {
  id: string;
  channel: string;
  title: string | null;
  body: string;
  status: "draft" | "scheduled" | "published" | "failed";
  scheduledFor: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
}

interface ActionNeeded {
  id: string;
  actionType: string;
  riskTier: "low" | "medium" | "high" | "critical";
  status: string;
  title: string;
  createdAt: string;
  payload: Record<string, unknown>;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "N/A";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

export default function ClientReviewEnginePage() {
  const { clientId } = useParams<{ clientId: string }>();
  const { request } = useDashboardContext();

  const [artifacts, setArtifacts] = useState<ContentArtifact[]>([]);
  const [pendingActions, setPendingActions] = useState<ActionNeeded[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const [customerFirstName, setCustomerFirstName] = useState("Test Customer");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [technicianName, setTechnicianName] = useState("Tech 1");
  const [servicePerformed, setServicePerformed] = useState("Service Visit");
  const [city, setCity] = useState("");
  const [reviewUrl, setReviewUrl] = useState("");
  const [sendSms, setSendSms] = useState(true);
  const [sendEmail, setSendEmail] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);

    void Promise.all([
      request<{ artifacts: ContentArtifact[] }>(
        `/api/v1/clients/${clientId}/content-artifacts?phase=reviews&status=all&limit=250`
      ),
      request<{ actionsNeeded: ActionNeeded[] }>(
        `/api/v1/clients/${clientId}/actions-needed?status=pending&limit=200`
      )
    ])
      .then(([artifactPayload, actionsPayload]) => {
        const reviewArtifacts = artifactPayload.artifacts.filter(
          (artifact) => artifact.channel === "review_request_sms" || artifact.channel === "review_request_email"
        );
        setArtifacts(reviewArtifacts);
        setPendingActions(
          actionsPayload.actionsNeeded.filter((item) => item.actionType === "review_reply")
        );
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  };

  useEffect(load, [clientId, request]);

  const metrics = useMemo(() => {
    return {
      queued: artifacts.filter((item) => item.status === "scheduled").length,
      sent: artifacts.filter((item) => item.status === "published").length,
      failed: artifacts.filter((item) => item.status === "failed").length,
      manualReviews: pendingActions.length
    };
  }, [artifacts, pendingActions]);

  const queueTest = async () => {
    const channels: Array<"sms" | "email"> = [];
    if (sendSms) {
      channels.push("sms");
    }
    if (sendEmail) {
      channels.push("email");
    }

    if (!channels.length) {
      setError("Select at least one dispatch channel (SMS and/or Email).");
      return;
    }

    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const payload = await request<{
        queued: number;
        duplicatesSkipped: number;
      }>(`/api/v1/clients/${clientId}/review-ignition/webhook`, {
        method: "POST",
        body: {
          source: "dashboard_manual",
          eventType: "manual_test_trigger",
          customerFirstName,
          customerPhone: customerPhone.trim() || undefined,
          customerEmail: customerEmail.trim() || undefined,
          technicianName: technicianName.trim() || undefined,
          servicePerformed: servicePerformed.trim() || undefined,
          city: city.trim() || undefined,
          reviewUrl: reviewUrl.trim() || undefined,
          channels,
          metadata: {
            trigger: "review_engine_ui"
          }
        }
      });

      setStatus(
        `Queued ${payload.queued} review request artifact(s). Duplicates skipped: ${payload.duplicatesSkipped}.`
      );
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
        <h2 className={styles.heroTitle}>Review Engine</h2>
        <p className={styles.heroSubtitle}>
          Manage CRM-triggered review requests, pacing queue, and low-rating escalation workflow.
        </p>
        <ClientTabs clientId={clientId} />
        <div className={styles.inlineActions}>
          <button type="button" className={styles.buttonSecondary} onClick={load} disabled={busy || loading}>
            Refresh
          </button>
        </div>
        {status ? <span className={`${styles.badge} ${styles.statusActive}`}>{status}</span> : null}
        {error ? <span className={`${styles.badge} ${styles.statusError}`}>{error}</span> : null}
      </section>

      <section className={styles.grid}>
        <article className={`${styles.card} ${styles.col4}`}>
          <header className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Queue Health</h3>
          </header>
          <div className={styles.kpiRow}>
            <span className={styles.badge}>Scheduled {metrics.queued}</span>
            <span className={styles.badge}>Published {metrics.sent}</span>
            <span className={styles.badge}>Failed {metrics.failed}</span>
            <span className={`${styles.badge} ${styles.statusError}`}>Manual Replies {metrics.manualReviews}</span>
          </div>
          <p className={styles.cardHint}>
            Worker dispatches `review_request_sms` and `review_request_email` artifacts through Twilio/SendGrid.
          </p>
        </article>

        <article className={`${styles.card} ${styles.col8}`}>
          <header className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Trigger Test Review Request</h3>
          </header>
          <div className={styles.split}>
            <label className={styles.field}>
              <span className={styles.label}>Customer First Name</span>
              <input className={styles.input} value={customerFirstName} onChange={(event) => setCustomerFirstName(event.target.value)} />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Technician Name</span>
              <input className={styles.input} value={technicianName} onChange={(event) => setTechnicianName(event.target.value)} />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Service Performed</span>
              <input className={styles.input} value={servicePerformed} onChange={(event) => setServicePerformed(event.target.value)} />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>City</span>
              <input className={styles.input} value={city} onChange={(event) => setCity(event.target.value)} />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Customer Phone (SMS)</span>
              <input className={styles.input} value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Customer Email</span>
              <input className={styles.input} value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} />
            </label>
          </div>
          <label className={styles.field}>
            <span className={styles.label}>Google Review URL</span>
            <input className={styles.input} value={reviewUrl} onChange={(event) => setReviewUrl(event.target.value)} placeholder="https://g.page/r/.../review" />
          </label>
          <div className={styles.kpiRow}>
            <label className={styles.badge}>
              <input type="checkbox" checked={sendSms} onChange={(event) => setSendSms(event.target.checked)} /> SMS
            </label>
            <label className={styles.badge}>
              <input type="checkbox" checked={sendEmail} onChange={(event) => setSendEmail(event.target.checked)} /> Email
            </label>
          </div>
          <div className={styles.inlineActions}>
            <button type="button" className={styles.buttonPrimary} onClick={() => void queueTest()} disabled={busy}>
              {busy ? "Queueing..." : "Queue Test Request"}
            </button>
          </div>
        </article>

        <article className={`${styles.card} ${styles.col8}`}>
          <header className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Review Request Artifacts</h3>
          </header>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>Status</th>
                  <th>Scheduled</th>
                  <th>Created</th>
                  <th>Recipient</th>
                </tr>
              </thead>
              <tbody>
                {artifacts.map((artifact) => {
                  const metadata = asRecord(artifact.metadata);
                  return (
                    <tr key={artifact.id}>
                      <td>{artifact.channel}</td>
                      <td>{artifact.status}</td>
                      <td>{formatDate(artifact.scheduledFor)}</td>
                      <td>{formatDate(artifact.createdAt)}</td>
                      <td>{String(metadata.customerPhone ?? metadata.customerEmail ?? "-")}</td>
                    </tr>
                  );
                })}
                {!loading && !artifacts.length ? (
                  <tr>
                    <td colSpan={5}>
                      <p className={styles.empty}>No review request artifacts queued yet.</p>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </article>

        <article className={`${styles.card} ${styles.col4}`}>
          <header className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Manual Review Queue</h3>
          </header>
          <div className={styles.stack}>
            {pendingActions.map((action) => (
              <div key={action.id} className={styles.badge}>
                {action.riskTier.toUpperCase()} · {action.title}
                <br />
                <span className={styles.muted}>{formatDate(action.createdAt)}</span>
              </div>
            ))}
            {!pendingActions.length ? <p className={styles.empty}>No manual review actions pending.</p> : null}
          </div>
        </article>
      </section>
    </>
  );
}
