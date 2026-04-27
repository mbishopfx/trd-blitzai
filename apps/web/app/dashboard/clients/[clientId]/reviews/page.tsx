"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { generateReviewReply, hasReviewComment } from "@trd-aiblitz/integrations-gbp/src/review-reply";
import { ClientTabs } from "../../../_components/client-tabs";
import { useDashboardContext } from "../../../_components/dashboard-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

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

interface OrchestrationSettings {
  tone: string;
  reviewReplyStyle: string;
}

function reviewHasText(comment: string): boolean {
  return hasReviewComment(comment);
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
  const [settings, setSettings] = useState<OrchestrationSettings | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [customerFirstName, setCustomerFirstName] = useState("Test Customer");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [technicianName, setTechnicianName] = useState("Tech 1");
  const [servicePerformed, setServicePerformed] = useState("Service Visit");
  const [city, setCity] = useState("");
  const [reviewUrl, setReviewUrl] = useState("");
  const [sendSms, setSendSms] = useState(true);
  const [sendEmail, setSendEmail] = useState(false);

  const loadReviewsWorkspace = () => {
    setLoading(true);
    setError(null);
    setStatusNote(null);

    void Promise.all([
      request<ReviewsPayload>(`/api/v1/clients/${clientId}/reviews?limit=100`),
      request<{ settings: OrchestrationSettings }>(`/api/v1/clients/${clientId}/orchestration/settings`)
    ])
      .then(([reviewsPayload, settingsPayload]) => {
        setPayload(reviewsPayload);
        setSettings(settingsPayload.settings);

        const drafts: Record<string, string> = {};
        for (const review of reviewsPayload.reviews) {
          if (review.replyComment) {
            drafts[review.reviewId] = review.replyComment;
          } else if (!reviewHasText(review.comment)) {
            drafts[review.reviewId] = generateReviewReply({
              review: {
                name: review.reviewName,
                starRating: review.starRating,
                comment: ""
              },
              businessName: reviewsPayload.location.locationTitle,
              brandVoice: settingsPayload.settings.tone
            });
          } else {
            drafts[review.reviewId] = "";
          }
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
  const metrics = useMemo(
    () => ({
      queued: payload?.reviews.filter((review) => review.hasReply).length ?? 0,
      sent: payload?.reviews.length ?? 0,
      ratingOnly: payload?.reviews.filter((review) => !review.hasReply && !reviewHasText(review.comment)).length ?? 0,
      manualReviews: pendingReviews.length
    }),
    [payload, pendingReviews]
  );

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
    setStatusNote(null);
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

      setStatusNote(
        `Queued ${payload.queued} review request artifact(s). Duplicates skipped: ${payload.duplicatesSkipped}.`
      );
      loadReviewsWorkspace();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 pb-8">
      <Card className="overflow-hidden border-stone-200/80 bg-white/95 shadow-sm">
        <CardHeader className="space-y-5 p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <Badge variant="outline" className="w-fit rounded-full border-stone-200 bg-stone-50 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-stone-600">
                Review Engine
              </Badge>
              <div className="space-y-2">
                <CardTitle className="text-3xl font-medium tracking-tight">Review Orchestration</CardTitle>
                <CardDescription className="max-w-4xl text-base leading-7">
                  Pull live GBP reviews, auto-reply to pending ratings, and manually override replies where needed.
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={loadReviewsWorkspace} disabled={loading}>
                Refresh Reviews
              </Button>
            </div>
          </div>

          <ClientTabs clientId={clientId} />

          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Pending replies: {pendingReviews.length}</Badge>
            <Badge variant="secondary">Tone: {settings?.tone ?? "-"}</Badge>
            <Badge variant="secondary">Style: {settings?.reviewReplyStyle ?? "-"}</Badge>
            <Badge variant="secondary">Auto replies: disabled</Badge>
            {payload ? <Badge variant="secondary">Location: {payload.location.locationTitle}</Badge> : null}
          </div>

          {statusNote ? (
            <Alert className="border-emerald-200 bg-emerald-50/80 text-emerald-950">
              <AlertTitle>Review update</AlertTitle>
              <AlertDescription>{statusNote}</AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Review issue</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardHeader>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <Card className="border-stone-200/80 bg-white/95 shadow-sm">
          <CardHeader>
            <CardTitle>Queue Health</CardTitle>
            <CardDescription>Current dispatch health and manual reply exposure.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-stone-200/80 bg-stone-50/70 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-stone-500">Scheduled</p>
                <p className="mt-2 text-2xl font-semibold">{metrics.queued}</p>
              </div>
              <div className="rounded-2xl border border-stone-200/80 bg-stone-50/70 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-stone-500">Published</p>
                <p className="mt-2 text-2xl font-semibold">{metrics.sent}</p>
              </div>
              <div className="rounded-2xl border border-stone-200/80 bg-stone-50/70 p-4">
                <p className="text-xs uppercase tracking-[0.14em] text-stone-500">Rating-only</p>
                <p className="mt-2 text-2xl font-semibold">{metrics.ratingOnly}</p>
              </div>
              <div className="rounded-2xl border border-red-200 bg-red-50/70 p-4 text-red-950">
                <p className="text-xs uppercase tracking-[0.14em]">Manual replies</p>
                <p className="mt-2 text-2xl font-semibold">{metrics.manualReviews}</p>
              </div>
            </div>
            <p className="text-sm leading-6 text-muted-foreground">
              Worker dispatches `review_request_sms` and `review_request_email` artifacts through Twilio and SendGrid.
            </p>
          </CardContent>
        </Card>

        <Card className="border-stone-200/80 bg-white/95 shadow-sm">
          <CardHeader>
            <CardTitle>Trigger Test Review Request</CardTitle>
            <CardDescription>Generate a manual review request through the same webhook the workspace uses.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium text-stone-700">Customer First Name</span>
                <Input value={customerFirstName} onChange={(event) => setCustomerFirstName(event.target.value)} />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-stone-700">Technician Name</span>
                <Input value={technicianName} onChange={(event) => setTechnicianName(event.target.value)} />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-stone-700">Service Performed</span>
                <Input value={servicePerformed} onChange={(event) => setServicePerformed(event.target.value)} />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-stone-700">City</span>
                <Input value={city} onChange={(event) => setCity(event.target.value)} />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-stone-700">Customer Phone (SMS)</span>
                <Input value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-stone-700">Customer Email</span>
                <Input value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} />
              </label>
            </div>
            <label className="space-y-2">
              <span className="text-sm font-medium text-stone-700">Google Review URL</span>
              <Input value={reviewUrl} onChange={(event) => setReviewUrl(event.target.value)} placeholder="https://g.page/r/.../review" />
            </label>
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-stone-50 px-4 py-2 text-sm text-stone-700">
                <input type="checkbox" checked={sendSms} onChange={(event) => setSendSms(event.target.checked)} />
                SMS
              </label>
              <label className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-stone-50 px-4 py-2 text-sm text-stone-700">
                <input type="checkbox" checked={sendEmail} onChange={(event) => setSendEmail(event.target.checked)} />
                Email
              </label>
            </div>
            <Button onClick={() => void queueTest()} disabled={busy}>
              {busy ? "Queueing..." : "Queue Test Request"}
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="border-stone-200/80 bg-white/95 shadow-sm">
        <CardHeader>
          <CardTitle>Live GBP Reviews</CardTitle>
          <CardDescription>Auto-reply workers run against this list. Drafts are editable inline.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-2xl border border-stone-200/80">
            <table className="min-w-full text-sm">
              <thead className="bg-stone-50 text-left text-xs uppercase tracking-[0.14em] text-stone-500">
                <tr>
                  <th className="px-4 py-3">Reviewer</th>
                  <th className="px-4 py-3">Rating</th>
                  <th className="px-4 py-3">Review</th>
                  <th className="px-4 py-3">Current Reply</th>
                  <th className="px-4 py-3">Draft/Manual Reply</th>
                  <th className="px-4 py-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200/80">
                {payload?.reviews.map((review) => (
                  <tr key={review.reviewId} className="align-top">
                    <td className="px-4 py-4">
                      <p className="font-medium text-stone-900">{review.reviewerName}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(review.updatedAt ?? review.createdAt)}</p>
                    </td>
                    <td className="px-4 py-4">{review.rating || review.starRating}</td>
                    <td className="px-4 py-4">
                      {reviewHasText(review.comment) ? review.comment : <span className="text-muted-foreground">No review text</span>}
                    </td>
                    <td className="px-4 py-4">{review.replyComment ?? <span className="text-muted-foreground">No reply yet</span>}</td>
                    <td className="px-4 py-4">
                      <Textarea
                        className="min-h-28"
                        value={replyDrafts[review.reviewId] ?? ""}
                        disabled={!reviewHasText(review.comment)}
                        onChange={(event) =>
                          setReplyDrafts((current) => ({
                            ...current,
                            [review.reviewId]: event.target.value
                          }))
                        }
                      />
                    </td>
                    <td className="px-4 py-4">
                      {reviewHasText(review.comment) ? (
                        <Button size="sm" onClick={() => void postManualReply(review.reviewId)} disabled={busy}>
                          Post Reply
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Rating-only review. Google does not allow API replies.
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
                {!loading && (!payload || payload.reviews.length === 0) ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                      No reviews returned for this client/location yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
