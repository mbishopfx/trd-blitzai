"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ClientTabs } from "../../../_components/client-tabs";
import { useDashboardContext } from "../../../_components/dashboard-context";
import styles from "../../../_components/dashboard.module.css";

type ActionNeededStatus = "pending" | "approved" | "executed" | "failed" | "dismissed" | "manual_completed";

interface ActionNeededRecord {
  id: string;
  provider: "gbp" | "ga4" | "google_ads" | "search_console" | "ghl";
  locationName: string | null;
  locationId: string | null;
  actionType: "profile_patch" | "media_upload" | "post_publish" | "review_reply" | "hours_update" | "attribute_update";
  riskTier: "low" | "medium" | "high" | "critical";
  title: string;
  description: string | null;
  status: ActionNeededStatus;
  payload: Record<string, unknown>;
  result: Record<string, unknown>;
  approvedBy: string | null;
  approvedAt: string | null;
  executedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const statusOptions: Array<{ value: ActionNeededStatus | "all"; label: string }> = [
  { value: "pending", label: "Pending" },
  { value: "all", label: "All" },
  { value: "approved", label: "Approved" },
  { value: "executed", label: "Executed" },
  { value: "failed", label: "Failed" },
  { value: "manual_completed", label: "Manual Complete" },
  { value: "dismissed", label: "Dismissed" }
];

function formatDate(value: string | null): string {
  if (!value) {
    return "N/A";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map(String).map((entry) => entry.trim()).filter(Boolean);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function operationSummary(payload: Record<string, unknown>): string {
  const executionPlan = asRecord(payload.executionPlan);
  const operations = Array.isArray(executionPlan.operations) ? executionPlan.operations : [];
  const kinds = operations
    .map((entry) => {
      const record = asRecord(entry);
      return typeof record.kind === "string" ? record.kind : "";
    })
    .filter(Boolean);
  if (kinds.length) {
    return [...new Set(kinds)].join(", ");
  }
  const updateMask = toStringArray(payload.updateMask);
  return updateMask.join(", ");
}

function operationDetails(payload: Record<string, unknown>): Array<Record<string, unknown>> {
  const executionPlan = asRecord(payload.executionPlan);
  const operations = Array.isArray(executionPlan.operations) ? executionPlan.operations : [];
  return operations.map((entry) => asRecord(entry)).filter((entry) => Object.keys(entry).length > 0);
}

export default function ClientActionsNeededPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const { request } = useDashboardContext();

  const [statusFilter, setStatusFilter] = useState<ActionNeededStatus | "all">("pending");
  const [actionsNeeded, setActionsNeeded] = useState<ActionNeededRecord[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const pendingCount = useMemo(
    () => actionsNeeded.filter((item) => item.status === "pending").length,
    [actionsNeeded]
  );
  const selectedItem = useMemo(
    () => actionsNeeded.find((item) => item.id === selectedId) ?? actionsNeeded[0] ?? null,
    [actionsNeeded, selectedId]
  );

  const load = () => {
    setLoading(true);
    setError(null);
    void request<{ actionsNeeded: ActionNeededRecord[] }>(
      `/api/v1/clients/${clientId}/actions-needed?status=${encodeURIComponent(statusFilter)}&limit=300`
    )
      .then((payload) => {
        setActionsNeeded(payload.actionsNeeded);
        if (!selectedId && payload.actionsNeeded[0]) {
          setSelectedId(payload.actionsNeeded[0].id);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(load, [clientId, request, statusFilter]);

  const approve = async (item: ActionNeededRecord) => {
    setBusyId(item.id);
    setError(null);
    setMessage(null);
    try {
      await request(`/api/v1/clients/${clientId}/actions-needed/${item.id}/approve`, {
        method: "POST"
      });
      setMessage(`Approved and executed: ${item.title}`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  const updateStatus = async (item: ActionNeededRecord, status: "dismissed" | "manual_completed") => {
    const note = window.prompt(
      status === "manual_completed"
        ? "Optional note for manual completion:"
        : "Optional note for dismissal:",
      ""
    );

    setBusyId(item.id);
    setError(null);
    setMessage(null);
    try {
      await request(`/api/v1/clients/${clientId}/actions-needed/${item.id}`, {
        method: "PATCH",
        body: {
          status,
          note: note?.trim() ? note.trim() : undefined
        }
      });
      setMessage(
        status === "manual_completed"
          ? `Marked manual complete: ${item.title}`
          : `Dismissed: ${item.title}`
      );
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <section className={styles.hero}>
        <h2 className={styles.heroTitle}>Actions Needed</h2>
        <p className={styles.heroSubtitle}>
          Risky GBP changes are queued here for operator review before execution.
        </p>
        <ClientTabs clientId={clientId} />
        <div className={styles.topbarRow}>
          <span className={styles.badge}>Pending {pendingCount}</span>
          <label className={styles.field} style={{ maxWidth: 220 }}>
            <span className={styles.label}>Status Filter</span>
            <select
              className={styles.select}
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as ActionNeededStatus | "all")}
            >
              {statusOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button className={styles.buttonSecondary} onClick={load} disabled={loading || Boolean(busyId)}>
            Refresh
          </button>
        </div>
        {message ? <span className={`${styles.badge} ${styles.statusActive}`}>{message}</span> : null}
        {error ? <span className={`${styles.badge} ${styles.statusError}`}>{error}</span> : null}
      </section>

      <section className={styles.grid}>
        <article className={`${styles.card} ${styles.col7}`}>
          <header className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Queued Tasks ({actionsNeeded.length})</h3>
          </header>
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Location</th>
                  <th>Risk</th>
                  <th>Status</th>
                  <th>Operations</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {actionsNeeded.map((item) => {
                  const payload = item.payload ?? {};
                  const operations = operationSummary(payload);
                  const busy = busyId === item.id;
                  return (
                    <tr key={item.id} onClick={() => setSelectedId(item.id)} style={{ cursor: "pointer" }}>
                      <td>
                        <strong>{item.title}</strong>
                        <p className={styles.empty}>{item.description ?? "No description"}</p>
                      </td>
                      <td>{item.locationName ?? item.locationId ?? "N/A"}</td>
                      <td>{item.riskTier}</td>
                      <td>{item.status}</td>
                      <td>{operations || "N/A"}</td>
                      <td>{formatDate(item.createdAt)}</td>
                      <td>
                        <div className={styles.kpiRow}>
                          <button
                            className={styles.buttonPrimary}
                            disabled={busy || item.status !== "pending"}
                            onClick={() => approve(item)}
                          >
                            Approve
                          </button>
                          <button
                            className={styles.buttonSecondary}
                            disabled={busy || item.status !== "pending"}
                            onClick={() => updateStatus(item, "manual_completed")}
                          >
                            Manual Done
                          </button>
                          <button
                            className={styles.buttonGhost}
                            disabled={busy || item.status !== "pending"}
                            onClick={() => updateStatus(item, "dismissed")}
                          >
                            Dismiss
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!loading && actionsNeeded.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      <p className={styles.empty}>No actions needed for this client and filter.</p>
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </article>

        <article className={`${styles.card} ${styles.col5}`}>
          <header className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>Operator Review</h3>
          </header>
          {selectedItem ? (
            <div className={styles.stack}>
              <div className={styles.kpiRow}>
                <span className={styles.badge}>{selectedItem.provider}</span>
                <span className={styles.badge}>{selectedItem.actionType}</span>
                <span className={styles.badge}>{selectedItem.riskTier}</span>
                <span className={styles.badge}>{selectedItem.status}</span>
              </div>
              <p className={styles.empty}><strong>{selectedItem.title}</strong></p>
              <p className={styles.cardHint}>{selectedItem.description ?? "No description"}</p>
              <p className={styles.empty}>Location: {selectedItem.locationName ?? selectedItem.locationId ?? "N/A"}</p>
              <p className={styles.empty}>Created: {formatDate(selectedItem.createdAt)}</p>
              <p className={styles.empty}>Approved: {formatDate(selectedItem.approvedAt)}</p>
              <p className={styles.empty}>Executed: {formatDate(selectedItem.executedAt)}</p>
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Operation</th>
                      <th>Payload</th>
                    </tr>
                  </thead>
                  <tbody>
                    {operationDetails(selectedItem.payload).map((operation, index) => (
                      <tr key={`${selectedItem.id}-operation-${index}`}>
                        <td>{typeof operation.kind === "string" ? operation.kind : "unknown"}</td>
                        <td>
                          <pre className={styles.codeBlock}>{JSON.stringify(operation, null, 2)}</pre>
                        </td>
                      </tr>
                    ))}
                    {operationDetails(selectedItem.payload).length === 0 ? (
                      <tr>
                        <td colSpan={2}>
                          <pre className={styles.codeBlock}>{JSON.stringify(selectedItem.payload, null, 2)}</pre>
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <p className={styles.empty}>Select a queued action to inspect its exact execution plan.</p>
          )}
        </article>
      </section>
    </>
  );
}
