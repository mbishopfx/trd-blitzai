"use client";

import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ClientTabs } from "../../../_components/client-tabs";
import { useDashboardContext } from "../../../_components/dashboard-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

type RunStatus = "created" | "running" | "completed" | "failed" | "partially_completed" | "rolled_back";

interface BlitzRunRecord {
  id: string;
  status: RunStatus;
  startedAt: string | null;
  completedAt: string | null;
  createdBy: string;
  createdAt: string;
  policySnapshot: Record<string, unknown>;
}

interface BlitzAction {
  id: string;
  runId: string;
  phase: string;
  actionType: string;
  riskTier: string;
  policyDecision: string;
  status: "pending" | "executed" | "failed" | "rolled_back" | "skipped";
  actor: "system" | "user" | "operator";
  idempotencyKey: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: string;
  executedAt: string | null;
}

interface ProtocolSelection {
  completenessOverhaul: boolean;
  mediaFlood: boolean;
  geoContentBarrage: boolean;
  reviewIgnition: boolean;
  interactionVelocity: boolean;
  competitorBenchmarking: boolean;
  continuousAutopilot: boolean;
}

const defaultProtocolSelection: ProtocolSelection = {
  completenessOverhaul: true,
  mediaFlood: true,
  geoContentBarrage: true,
  reviewIgnition: true,
  interactionVelocity: true,
  competitorBenchmarking: true,
  continuousAutopilot: true
};

function formatDate(value: string | null): string {
  if (!value) return "N/A";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function ClientBlitzPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const searchParams = useSearchParams();
  const { request } = useDashboardContext();

  const [runs, setRuns] = useState<BlitzRunRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [actions, setActions] = useState<BlitzAction[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [triggeredBy, setTriggeredBy] = useState("dashboard-operator");
  const [rollbackReason, setRollbackReason] = useState("Manual rollback from client workspace");
  const [protocol, setProtocol] = useState<ProtocolSelection>(defaultProtocolSelection);

  const selectedRunFromQuery = searchParams.get("runId");

  const loadRuns = () => {
    setLoading(true);
    setError(null);

    void request<{ runs: BlitzRunRecord[] }>(`/api/v1/clients/${clientId}/blitz-runs?limit=25`)
      .then((payload) => {
        setRuns(payload.runs);
        const queryPreferred = selectedRunFromQuery && payload.runs.some((run) => run.id === selectedRunFromQuery);
        if (queryPreferred) {
          setSelectedRunId(selectedRunFromQuery ?? "");
          return;
        }

        if (payload.runs.length === 0) {
          setSelectedRunId("");
          return;
        }

        if (!payload.runs.some((run) => run.id === selectedRunId)) {
          setSelectedRunId(payload.runs[0].id);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(loadRuns, [clientId, request, selectedRunFromQuery]);

  useEffect(() => {
    if (!selectedRunId) {
      setActions([]);
      return;
    }

    void request<{ actions: BlitzAction[] }>(`/api/v1/blitz-runs/${selectedRunId}/actions`)
      .then((payload) => {
        setActions(payload.actions);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      });
  }, [request, selectedRunId]);

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? null,
    [runs, selectedRunId]
  );

  const startBlitzRun = async () => {
    setBusy(true);
    setError(null);

    try {
      const runPayload = await request<{ run: BlitzRunRecord }>(`/api/v1/clients/${clientId}/blitz-runs`, {
        method: "POST",
        body: {
          triggeredBy,
          policySnapshot: {
            protocol,
            source: "dashboard-client-blitz"
          }
        }
      });

      setSelectedRunId(runPayload.run.id);
      loadRuns();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const rollbackAction = async (actionId: string) => {
    setBusy(true);
    setError(null);
    try {
      await request(`/api/v1/blitz-actions/${actionId}/rollback`, {
        method: "POST",
        body: {
          reason: rollbackReason
        }
      });

      if (selectedRunId) {
        const payload = await request<{ actions: BlitzAction[] }>(`/api/v1/blitz-runs/${selectedRunId}/actions`);
        setActions(payload.actions);
      }
      loadRuns();
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
                Blitz Worker
              </Badge>
              <div className="space-y-2">
                <CardTitle className="text-3xl font-medium tracking-tight">Blitz Worker</CardTitle>
                <CardDescription className="max-w-4xl text-base leading-7">
                  Run the full Blitz protocol for this client, inspect action-level execution, and rollback reversible actions.
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void startBlitzRun()} disabled={busy}>
                {busy ? "Launching..." : "Launch Blitz Run"}
              </Button>
              <Button variant="outline" disabled={loading} onClick={loadRuns}>
                Refresh Runs
              </Button>
            </div>
          </div>

          <ClientTabs clientId={clientId} />

          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">{runs.length} runs</Badge>
            {selectedRun ? (
              <>
                <Badge variant="secondary">Status: {selectedRun.status}</Badge>
                <Badge variant="secondary">Started: {formatDate(selectedRun.startedAt)}</Badge>
                <Badge variant="secondary">Completed: {formatDate(selectedRun.completedAt)}</Badge>
              </>
            ) : null}
          </div>

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Blitz issue</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardHeader>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,0.55fr)_minmax(0,0.45fr)]">
        <Card className="border-stone-200/80 bg-white/95 shadow-sm">
          <CardHeader>
            <CardTitle>Start New Blitz Run</CardTitle>
            <CardDescription>Choose protocol controls and operator metadata before launch.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="space-y-2">
                <span className="text-sm font-medium text-stone-700">Triggered By</span>
                <Input value={triggeredBy} onChange={(event) => setTriggeredBy(event.target.value)} />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-stone-700">Rollback Reason Template</span>
                <Input value={rollbackReason} onChange={(event) => setRollbackReason(event.target.value)} />
              </label>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(protocol).map(([key, value]) => (
                <label key={key} className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-stone-50 px-4 py-2 text-sm text-stone-700">
                  <input
                    type="checkbox"
                    checked={value}
                    onChange={(event) =>
                      setProtocol((current) => ({
                        ...current,
                        [key]: event.target.checked
                      }))
                    }
                  />
                  {key}
                </label>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="border-stone-200/80 bg-white/95 shadow-sm">
          <CardHeader>
            <CardTitle>Run Selector</CardTitle>
            <CardDescription>Pick a run to inspect its action sequence.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="space-y-2">
              <span className="text-sm font-medium text-stone-700">Selected Run</span>
              <select className="w-full rounded-xl border border-stone-200 bg-white px-3 py-2 text-sm shadow-sm" value={selectedRunId} onChange={(event) => setSelectedRunId(event.target.value)}>
                {!runs.length ? <option value="">No runs available</option> : null}
                {runs.map((run) => (
                  <option key={run.id} value={run.id}>
                    {run.status} | {run.id.slice(0, 8)} | {formatDate(run.createdAt)}
                  </option>
                ))}
              </select>
            </label>
            {selectedRun ? (
              <div className="space-y-2 text-sm text-stone-700">
                <p>Created: {formatDate(selectedRun.createdAt)}</p>
                <p>Created By: {selectedRun.createdBy}</p>
                <div className="overflow-hidden rounded-2xl border border-stone-200/80">
                  <pre className="max-h-56 overflow-auto bg-stone-950 p-4 text-xs leading-5 text-stone-100">
                    {JSON.stringify(selectedRun.policySnapshot, null, 2)}
                  </pre>
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{loading ? "Loading runs..." : "No run selected."}</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="border-stone-200/80 bg-white/95 shadow-sm">
        <CardHeader>
          <CardTitle>Action Timeline</CardTitle>
          <CardDescription>Rollback is available directly from each action row.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-2xl border border-stone-200/80">
            <table className="min-w-full text-sm">
              <thead className="bg-stone-50 text-left text-xs uppercase tracking-[0.14em] text-stone-500">
                <tr>
                  <th className="px-4 py-3">Phase</th>
                  <th className="px-4 py-3">Action Type</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Risk</th>
                  <th className="px-4 py-3">Policy</th>
                  <th className="px-4 py-3">Executed</th>
                  <th className="px-4 py-3">Error</th>
                  <th className="px-4 py-3">Rollback</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-200/80">
                {actions.map((action) => (
                  <tr key={action.id}>
                    <td className="px-4 py-4">{action.phase}</td>
                    <td className="px-4 py-4">{action.actionType}</td>
                    <td className="px-4 py-4">{action.status}</td>
                    <td className="px-4 py-4">{action.riskTier}</td>
                    <td className="px-4 py-4">{action.policyDecision}</td>
                    <td className="px-4 py-4">{formatDate(action.executedAt)}</td>
                    <td className="px-4 py-4">{action.error ?? "-"}</td>
                    <td className="px-4 py-4">
                      {action.status === "executed" || action.status === "failed" ? (
                        <Button variant="destructive" size="sm" disabled={busy} onClick={() => void rollbackAction(action.id)}>
                          Rollback
                        </Button>
                      ) : (
                        <span className="text-muted-foreground">n/a</span>
                      )}
                    </td>
                  </tr>
                ))}
                {!actions.length ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-10 text-center text-sm text-muted-foreground">
                      No actions loaded for the selected run.
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
