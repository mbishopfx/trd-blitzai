"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ClientTabs } from "../../../_components/client-tabs";
import { useDashboardContext } from "../../../_components/dashboard-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

interface ContentArtifact {
  id: string;
  title: string | null;
  body: string;
  metadata: Record<string, unknown>;
  status: "draft" | "scheduled" | "published" | "failed";
  scheduledFor: string | null;
  createdAt: string;
}

type StatusFilter = "all" | "draft" | "scheduled" | "published" | "failed";

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function formatDate(value: string | null): string {
  if (!value) {
    return "N/A";
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function parseSnippet(metadata: Record<string, unknown>): string {
  return typeof metadata.snippet === "string" ? metadata.snippet : "";
}

export default function ClientContentOpsPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const { request } = useDashboardContext();

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("draft");
  const [artifacts, setArtifacts] = useState<ContentArtifact[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [snippet, setSnippet] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = () => {
    setError(null);
    void request<{ artifacts: ContentArtifact[] }>(
      `/api/v1/clients/${clientId}/content-artifacts?channel=gbp&phase=content&status=${encodeURIComponent(statusFilter)}&limit=200`
    )
      .then((payload) => {
        setArtifacts(payload.artifacts);
        if (!selectedId && payload.artifacts[0]) {
          setSelectedId(payload.artifacts[0].id);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  useEffect(load, [clientId, request, statusFilter]);

  const selected = useMemo(
    () => artifacts.find((artifact) => artifact.id === selectedId) ?? artifacts[0] ?? null,
    [artifacts, selectedId]
  );

  useEffect(() => {
    if (!selected) {
      setTitle("");
      setBody("");
      setSnippet("");
      return;
    }
    setTitle(selected.title ?? "");
    setBody(selected.body ?? "");
    setSnippet(parseSnippet(asRecord(selected.metadata)));
  }, [selected]);

  const patchArtifact = async (
    patch: {
      title?: string | null;
      body?: string;
      status?: "draft" | "scheduled" | "published" | "failed";
      scheduledFor?: string | null;
      metadata?: Record<string, unknown>;
    },
    successMessage: string
  ) => {
    if (!selected) {
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await request(`/api/v1/clients/${clientId}/content-artifacts/${selected.id}`, {
        method: "PATCH",
        body: patch
      });
      setMessage(successMessage);
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
    const nextMetadata = {
      ...asRecord(selected.metadata),
      snippet,
      operatorWorkflowStatus: "edited",
      operatorUpdatedAt: new Date().toISOString()
    };
    await patchArtifact(
      {
        title: title.trim() || null,
        body,
        metadata: nextMetadata
      },
      "Content edits saved."
    );
  };

  const approveAndQueue = async (useRecommendedTime: boolean) => {
    if (!selected) {
      return;
    }
    const metadata = asRecord(selected.metadata);
    const recommended = typeof metadata.recommendedScheduledFor === "string" ? metadata.recommendedScheduledFor : null;
    const scheduledFor = useRecommendedTime && recommended ? recommended : new Date().toISOString();
    const nextMetadata = {
      ...metadata,
      snippet,
      operatorWorkflowStatus: "approved_for_dispatch",
      operatorApprovedAt: new Date().toISOString()
    };
    await patchArtifact(
      {
        title: title.trim() || null,
        body,
        status: "scheduled",
        scheduledFor,
        metadata: nextMetadata
      },
      `Artifact queued for dispatch (${useRecommendedTime && recommended ? "recommended time" : "now"}).`
    );
  };

  const rejectDraft = async () => {
    if (!selected) {
      return;
    }
    const reason = window.prompt("Optional rejection reason:", "")?.trim() ?? "";
    const nextMetadata = {
      ...asRecord(selected.metadata),
      snippet,
      operatorWorkflowStatus: "rejected",
      operatorRejectedAt: new Date().toISOString(),
      operatorRejectionReason: reason || null
    };
    await patchArtifact(
      {
        status: "failed",
        metadata: nextMetadata
      },
      "Artifact rejected."
    );
  };

  return (
    <div className="space-y-6 pb-8">
      <Card className="overflow-hidden border-stone-200/80 bg-white/95 shadow-sm">
        <CardHeader className="space-y-5 p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <Badge variant="outline" className="w-fit rounded-full border-stone-200 bg-stone-50 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-stone-600">
                Content Ops
              </Badge>
              <div className="space-y-2">
                <CardTitle className="text-3xl font-medium tracking-tight">Content Operations</CardTitle>
                <CardDescription className="max-w-4xl text-base leading-7">
                  Review GEO post drafts, edit copy and snippets, and queue approved items into scheduled dispatch.
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={load} disabled={busy}>
                Refresh
              </Button>
            </div>
          </div>

          <ClientTabs clientId={clientId} />

          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Items {artifacts.length}</Badge>
            <Badge variant="secondary">Selected {selected?.status ?? "none"}</Badge>
          </div>

          {message ? (
            <Alert className="border-emerald-200 bg-emerald-50/80 text-emerald-950">
              <AlertTitle>Content update</AlertTitle>
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Content issue</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardHeader>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.35fr)_minmax(0,0.65fr)]">
        <Card className="border-stone-200/80 bg-white/95 shadow-sm">
          <CardHeader>
            <CardTitle>Draft Queue</CardTitle>
            <CardDescription>Pick a content artifact to edit.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <label className="space-y-2">
              <span className="text-sm font-medium text-stone-700">Status Filter</span>
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="draft">draft</SelectItem>
                    <SelectItem value="scheduled">scheduled</SelectItem>
                    <SelectItem value="published">published</SelectItem>
                    <SelectItem value="failed">failed</SelectItem>
                    <SelectItem value="all">all</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </label>
            <div className="flex flex-wrap gap-2">
              {artifacts.map((artifact) => (
                <Button
                  key={artifact.id}
                  type="button"
                  variant={selected?.id === artifact.id ? "secondary" : "outline"}
                  className="w-full justify-start"
                  onClick={() => setSelectedId(artifact.id)}
                >
                  {(artifact.title ?? "Untitled Artifact").slice(0, 72)}
                </Button>
              ))}
            </div>
            {!artifacts.length ? <p className="text-sm text-muted-foreground">No content artifacts found for this filter.</p> : null}
          </CardContent>
        </Card>

        <Card className="border-stone-200/80 bg-white/95 shadow-sm">
          <CardHeader>
            <CardTitle>{selected?.title ?? "Content Detail"}</CardTitle>
            <CardDescription>{selected ? `Created ${formatDate(selected.createdAt)} | Scheduled ${formatDate(selected.scheduledFor)}` : "Select a content artifact to review it."}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selected ? (
              <>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-stone-700">Title</span>
                  <Input value={title} onChange={(event) => setTitle(event.target.value)} />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-stone-700">Snippet (GBP Summary)</span>
                  <Textarea className="min-h-28" value={snippet} onChange={(event) => setSnippet(event.target.value)} />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-stone-700">Long Form Draft</span>
                  <Textarea className="min-h-56" value={body} onChange={(event) => setBody(event.target.value)} />
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => void saveEdits()} disabled={busy}>
                    Save Edits
                  </Button>
                  <Button onClick={() => void approveAndQueue(false)} disabled={busy}>
                    Approve + Queue Now
                  </Button>
                  <Button onClick={() => void approveAndQueue(true)} disabled={busy}>
                    Approve + Queue Recommended
                  </Button>
                  <Button variant="outline" onClick={() => void rejectDraft()} disabled={busy}>
                    Reject
                  </Button>
                </div>
                <div className="overflow-hidden rounded-2xl border border-stone-200/80">
                  <pre className="max-h-80 overflow-auto bg-stone-950 p-4 text-xs leading-5 text-stone-100">
                    {JSON.stringify(selected.metadata, null, 2)}
                  </pre>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Select a content artifact to review it.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
