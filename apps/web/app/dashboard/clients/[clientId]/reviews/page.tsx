"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ClientTabs } from "../../../_components/client-tabs";
import { useDashboardContext } from "../../../_components/dashboard-context";
import styles from "../../../_components/dashboard.module.css";

interface ReviewRecord {
  reviewId: string;
  reviewName: string;
  reviewerName: string;
  rating: number;
  starRating: string;
  comment: string;
  createdAt: string | null;
  updatedAt: string | null;
  hasReply: boolean;
  replyComment: string | null;
  replyUpdatedAt: string | null;
}

interface ReviewsPayload {
  location: {
    accountName: string;
    locationName: string;
    locationTitle: string;
  };
  reviews: ReviewRecord[];
}

interface BlitzAutopilotPolicy {
  clientId: string;
  maxDailyActionsPerLocation: number;
  maxActionsPerPhase: number;
  minCooldownMinutes: number;
  denyCriticalWithoutEscalation: boolean;
  enabledActionTypes: string[];
  reviewReplyAllRatingsEnabled: boolean;
  updatedAt: string;
}

interface OrchestrationSettings {
  tone: string;
  reviewReplyStyle: string;
}

function formatDate(value: string | null): string {
  if (!value) return "N/A";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function ClientReviewsPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const { request } = useDashboardContext();

  const [payload, setPayload] = useState<ReviewsPayload | null>(null);
  const [policy, setPolicy] = useState<BlitzAutopilotPolicy | null>(null);
  const [settings, setSettings] = useState<OrchestrationSettings | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  const loadReviewsWorkspace = () => {
    setLoading(true);
    setError(null);
    setStatusNote(null);

    void Promise.all([
      request<ReviewsPayload>(`/api/v1/clients/${clientId}/reviews?limit=100`),
      request<{ policy: BlitzAutopilotPolicy }>(`/api/v1/clients/${clientId}/autopilot/policies`),
      request<{ settings: OrchestrationSettings }>(`/api/v1/clients/${clientId}/orchestration/settings`)
    ])
      .then(([reviewsPayload, policyPayload, settingsPayload]) => {
        setPayload(reviewsPayload);
        setPolicy(policyPayload.policy);
        setSettings(settingsPayload.settings);

        const drafts: Record<string, string> = {};
        for (const review of reviewsPayload.reviews) {
          drafts[review.reviewId] = review.replyComment ?? "";
        }
        setReplyDrafts(drafts);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(loadReviewsWorkspace, [clientId, request]);

  const pendingReviews = useMemo(
    () => payload?.reviews.filter((review) => !review.hasReply) ?? [],
    [payload]
  );

  const runAutoReply = async () => {
    setBusy(true);
    setError(null);
    setStatusNote(null);

    try {
      const resultPayload = await request<{
        result: { attempted: number; posted: number; skipped: number; failed: number };
      }>(`/api/v1/clients/${clientId}/reviews`, {
        method: "POST",
        body: {
          action: "auto_reply_pending",
          limit: 100
        }
      });

      setStatusNote(
        `Auto reply finished. Attempted ${resultPayload.result.attempted}, posted ${resultPayload.result.posted}, skipped ${resultPayload.result.skipped}, failed ${resultPayload.result.failed}.`
      );
      loadReviewsWorkspace();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const updateAutopilot = async (nextState: boolean) => {
    if (!policy) return;

    setBusy(true);
    setError(null);
    setStatusNote(null);
    try {
      const updated = await request<{ policy: BlitzAutopilotPolicy }>(`/api/v1/clients/${clientId}/autopilot/policies`, {
        method: "POST",
        body: {
          maxDailyActionsPerLocation: policy.maxDailyActionsPerLocation,
          maxActionsPerPhase: policy.maxActionsPerPhase,
          minCooldownMinutes: policy.minCooldownMinutes,
          denyCriticalWithoutEscalation: policy.denyCriticalWithoutEscalation,
          enabledActionTypes: policy.enabledActionTypes,
          reviewReplyAllRatingsEnabled: nextState
        }
      });
      setPolicy(updated.policy);
      setStatusNote(`Autopilot all-rating reply mode is now ${nextState ? "enabled" : "disabled"}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const postManualReply = async (reviewId: string) => {
    const comment = replyDrafts[reviewId]?.trim();
    if (!comment) {
      setError("Reply text is required before posting");
      return;
    }

    setBusy(true);
    setError(null);
    setStatusNote(null);
    try {
      await request(`/api/v1/clients/${clientId}/reviews/${encodeURIComponent(reviewId)}/reply`, {
        method: "POST",
        body: {
          comment
        }
      });
      setStatusNote(`Posted reply for review ${reviewId}.`);
      loadReviewsWorkspace();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <section className={styles.hero}>
        <h2 className={styles.heroTitle}>Review Orchestration</h2>
        <p className={styles.heroSubtitle}>
          Pull live GBP reviews, auto-reply to all pending ratings, and manually override replies where needed.
        </p>
        <ClientTabs clientId={clientId} />
        <div className={styles.kpiRow}>
          <span className={styles.badge}>Pending replies: {pendingReviews.length}</span>
          <span className={styles.badge}>Tone: {settings?.tone ?? "-"}</span>
          <span className={styles.badge}>Style: {settings?.reviewReplyStyle ?? "-"}</span>
          {payload ? <span className={styles.badge}>Location: {payload.location.locationTitle}</span> : null}
        </div>
        <div className={styles.inlineActions}>
          <button type="button" className={styles.buttonPrimary} onClick={() => void runAutoReply()} disabled={busy}>
            {busy ? "Running..." : "Auto Reply Pending Reviews"}
          </button>
          <button type="button" className={styles.buttonGhost} onClick={loadReviewsWorkspace} disabled={loading}>
            Refresh Reviews
          </button>
          <button
            type="button"
            className={policy?.reviewReplyAllRatingsEnabled ? styles.buttonSecondary : styles.buttonDanger}
            onClick={() => void updateAutopilot(!(policy?.reviewReplyAllRatingsEnabled ?? false))}
            disabled={busy || !policy}
          >
            {policy?.reviewReplyAllRatingsEnabled ? "Disable All-Rating Auto Reply" : "Enable All-Rating Auto Reply"}
          </button>
        </div>
        {statusNote ? <span className={`${styles.badge} ${styles.statusActive}`}>{statusNote}</span> : null}
        {error ? <span className={`${styles.badge} ${styles.statusError}`}>{error}</span> : null}
      </section>

      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h3 className={styles.cardTitle}>Live GBP Reviews</h3>
          <p className={styles.cardHint}>Auto-reply workers run against this list</p>
        </header>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Reviewer</th>
                <th>Rating</th>
                <th>Review</th>
                <th>Current Reply</th>
                <th>Draft/Manual Reply</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {payload?.reviews.map((review) => (
                <tr key={review.reviewId}>
                  <td>
                    <strong>{review.reviewerName}</strong>
                    <br />
                    <span className={styles.muted}>{formatDate(review.updatedAt ?? review.createdAt)}</span>
                  </td>
                  <td>{review.rating || review.starRating}</td>
                  <td>{review.comment || <span className={styles.muted}>No review text</span>}</td>
                  <td>{review.replyComment ?? <span className={styles.muted}>No reply yet</span>}</td>
                  <td>
                    <textarea
                      className={styles.textarea}
                      value={replyDrafts[review.reviewId] ?? ""}
                      onChange={(event) =>
                        setReplyDrafts((current) => ({
                          ...current,
                          [review.reviewId]: event.target.value
                        }))
                      }
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className={styles.buttonSecondary}
                      onClick={() => void postManualReply(review.reviewId)}
                      disabled={busy}
                    >
                      Post Reply
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && (!payload || payload.reviews.length === 0) ? (
                <tr>
                  <td colSpan={6}>
                    <p className={styles.empty}>No reviews returned for this client/location yet.</p>
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
