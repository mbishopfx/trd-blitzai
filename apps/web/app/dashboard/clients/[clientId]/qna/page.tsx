"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ClientTabs } from "../../../_components/client-tabs";
import { useDashboardContext } from "../../../_components/dashboard-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

interface ContentArtifact {
  id: string;
  title: string | null;
  body: string;
  metadata: Record<string, unknown>;
  status: "draft" | "scheduled" | "published" | "failed";
  createdAt: string;
}

interface QaPair {
  question: string;
  answer: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function toQaPairs(value: unknown): QaPair[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((entry) => {
      const record = asRecord(entry);
      const question = typeof record.question === "string" ? record.question : "";
      const answer = typeof record.answer === "string" ? record.answer : "";
      if (!question || !answer) {
        return null;
      }
      return { question, answer };
    })
    .filter((entry): entry is QaPair => Boolean(entry));
}

function qaPairsToEditorJson(value: QaPair[]): string {
  return JSON.stringify(value, null, 2);
}

function buildQaBody(title: string, qaPairs: QaPair[]): string {
  const header = `# GBP Q&A Seed Pack\n\nBusiness: ${title}\n\nManual seeding pack for GBP Q&A.`;
  const rows = qaPairs.map((pair, index) => `## Q${index + 1}\nQuestion: ${pair.question}\nAnswer: ${pair.answer}`);
  return `${header}\n\n${rows.join("\n\n")}`.trim();
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export default function ClientQnaPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const { request } = useDashboardContext();

  const [artifacts, setArtifacts] = useState<ContentArtifact[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [qaEditor, setQaEditor] = useState("[]");

  const load = () => {
    setError(null);
    void request<{ artifacts: ContentArtifact[] }>(
      `/api/v1/clients/${clientId}/content-artifacts?channel=gbp_qna_seed&phase=content&limit=100`
    )
      .then((payload) => {
        setArtifacts(payload.artifacts);
        if (!selectedId && payload.artifacts[0]) {
          setSelectedId(payload.artifacts[0].id);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  };

  useEffect(load, [clientId, request]);

  const selected = useMemo(
    () => artifacts.find((artifact) => artifact.id === selectedId) ?? artifacts[0] ?? null,
    [artifacts, selectedId]
  );
  const qaPairs = useMemo(() => toQaPairs(selected?.metadata?.qaPairs), [selected]);

  useEffect(() => {
    setQaEditor(qaPairsToEditorJson(qaPairs));
  }, [selected?.id, qaPairs]);

  const patchArtifact = async (inputPatch: {
    status?: "draft" | "published" | "failed";
    metadata?: Record<string, unknown>;
    title?: string | null;
    body?: string;
    publishedAt?: string;
  }) => {
    if (!selected) {
      return;
    }
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      await request(`/api/v1/clients/${clientId}/content-artifacts/${selected.id}`, {
        method: "PATCH",
        body: inputPatch
      });
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
    try {
      const parsed = JSON.parse(qaEditor) as unknown;
      const nextQaPairs = toQaPairs(parsed);
      if (!nextQaPairs.length) {
        setError("Q&A editor JSON must include at least one valid question/answer pair.");
        return;
      }
      const nextMetadata = {
        ...selected.metadata,
        qaPairs: nextQaPairs,
        operatorUpdatedAt: new Date().toISOString(),
        operatorWorkflowStatus: "edited"
      };
      await patchArtifact({
        metadata: nextMetadata,
        body: buildQaBody(selected.title ?? "Business", nextQaPairs)
      });
      setStatus("Saved Q&A edits.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid JSON in Q&A editor.");
    }
  };

  const approvePack = async () => {
    if (!selected) {
      return;
    }
    const nextMetadata = {
      ...selected.metadata,
      operatorApprovedAt: new Date().toISOString(),
      operatorWorkflowStatus: "approved_for_manual_seed"
    };
    await patchArtifact({
      status: "draft",
      metadata: nextMetadata
    });
    setStatus("Approved Q&A pack for manual GBP seeding.");
  };

  const markSeeded = async () => {
    if (!selected) {
      return;
    }
    const nextMetadata = {
      ...selected.metadata,
      operatorUpdatedAt: new Date().toISOString(),
      operatorWorkflowStatus: "seeded_to_gbp"
    };
    await patchArtifact({
      status: "published",
      metadata: nextMetadata,
      publishedAt: new Date().toISOString()
    });
    setStatus("Marked Q&A pack as seeded in GBP.");
  };

  const rejectPack = async () => {
    if (!selected) {
      return;
    }
    const reason = window.prompt("Optional rejection reason:", "")?.trim() ?? "";
    const nextMetadata = {
      ...selected.metadata,
      operatorUpdatedAt: new Date().toISOString(),
      operatorWorkflowStatus: "rejected",
      rejectionReason: reason || null
    };
    await patchArtifact({
      status: "failed",
      metadata: nextMetadata
    });
    setStatus("Rejected Q&A pack.");
  };

  return (
    <div className="space-y-6 pb-8">
      <Card className="overflow-hidden border-stone-200/80 bg-white/95 shadow-sm">
        <CardHeader className="space-y-5 p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <Badge variant="outline" className="w-fit rounded-full border-stone-200 bg-stone-50 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-stone-600">
                Q&A Ops
              </Badge>
              <div className="space-y-2">
                <CardTitle className="text-3xl font-medium tracking-tight">Q&A Operations</CardTitle>
                <CardDescription className="max-w-4xl text-base leading-7">
                  Review generated GBP Q&A seed packs, copy high-intent answers, and mark packs as seeded once the team applies them.
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={load} disabled={busy}>
                Refresh Seed Packs
              </Button>
              <Button variant="secondary" onClick={() => void saveEdits()} disabled={busy || !selected}>
                Save Edits
              </Button>
              <Button variant="secondary" onClick={() => void approvePack()} disabled={busy || !selected}>
                Approve Pack
              </Button>
              <Button onClick={() => void markSeeded()} disabled={busy || !selected}>
                Mark Seeded
              </Button>
              <Button variant="outline" onClick={() => void rejectPack()} disabled={busy || !selected}>
                Reject
              </Button>
            </div>
          </div>

          <ClientTabs clientId={clientId} />

          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Seed packs: {artifacts.length}</Badge>
            <Badge variant="secondary">Selected: {selected?.status ?? "none"}</Badge>
          </div>

          {status ? (
            <Alert className="border-emerald-200 bg-emerald-50/80 text-emerald-950">
              <AlertTitle>Q&A update</AlertTitle>
              <AlertDescription>{status}</AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Q&A issue</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardHeader>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.35fr)_minmax(0,0.65fr)]">
        <Card className="border-stone-200/80 bg-white/95 shadow-sm">
          <CardHeader>
            <CardTitle>Seed Packs</CardTitle>
            <CardDescription>Select a pack to inspect or edit.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {artifacts.map((artifact) => (
              <Button
                key={artifact.id}
                type="button"
                variant={selected?.id === artifact.id ? "secondary" : "outline"}
                className="w-full justify-start"
                onClick={() => setSelectedId(artifact.id)}
              >
                {(artifact.title ?? "Untitled Q&A Pack").slice(0, 72)}
              </Button>
            ))}
            {!artifacts.length ? <p className="text-sm text-muted-foreground">No generated Q&A seed packs yet.</p> : null}
          </CardContent>
        </Card>

        <Card className="border-stone-200/80 bg-white/95 shadow-sm">
          <CardHeader>
            <CardTitle>{selected?.title ?? "Q&A Seed Detail"}</CardTitle>
            <CardDescription>{selected ? `Created ${formatDate(selected.createdAt)}` : "Select a pack to inspect it."}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selected ? (
              <>
                <div className="overflow-hidden rounded-2xl border border-stone-200/80">
                  <pre className="max-h-72 overflow-auto bg-stone-950 p-4 text-xs leading-5 text-stone-100">
                    {selected.body}
                  </pre>
                </div>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-stone-700">Q&A Editor JSON</span>
                  <Textarea className="min-h-48 font-mono text-sm" value={qaEditor} onChange={(event) => setQaEditor(event.target.value)} />
                </label>
                <div className="overflow-x-auto rounded-2xl border border-stone-200/80">
                  <table className="min-w-full text-sm">
                    <thead className="bg-stone-50 text-left text-xs uppercase tracking-[0.14em] text-stone-500">
                      <tr>
                        <th className="px-4 py-3">Question</th>
                        <th className="px-4 py-3">Answer</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-200/80">
                      {qaPairs.map((pair, index) => (
                        <tr key={`${pair.question}-${index}`}>
                          <td className="px-4 py-4">{pair.question}</td>
                          <td className="px-4 py-4">{pair.answer}</td>
                        </tr>
                      ))}
                      {!qaPairs.length ? (
                        <tr>
                          <td colSpan={2} className="px-4 py-10 text-center text-sm text-muted-foreground">
                            No Q&A pairs found in this artifact.
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Select a Q&A pack to review it.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
