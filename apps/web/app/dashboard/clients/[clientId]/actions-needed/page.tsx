"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ClientTabs } from "../../../_components/client-tabs";
import { useDashboardContext } from "../../../_components/dashboard-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
    <div className="space-y-6 pb-8">
      <Card className="overflow-hidden border-stone-200/80 bg-white/95 shadow-sm">
        <CardHeader className="space-y-5 p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <Badge variant="outline" className="w-fit rounded-full border-stone-200 bg-stone-50 px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-stone-600">
                Actions Needed
              </Badge>
              <div className="space-y-2">
                <CardTitle className="text-3xl font-medium tracking-tight">Actions Needed</CardTitle>
                <CardDescription className="max-w-4xl text-base leading-7">
                  Risky GBP changes are queued here for operator review before execution.
                </CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={load} disabled={loading || Boolean(busyId)}>
                Refresh
              </Button>
            </div>
          </div>

          <ClientTabs clientId={clientId} />

          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">Pending {pendingCount}</Badge>
          </div>

          {message ? (
            <Alert className="border-emerald-200 bg-emerald-50/80 text-emerald-950">
              <AlertTitle>Action update</AlertTitle>
              <AlertDescription>{message}</AlertDescription>
            </Alert>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Action issue</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-4 md:grid-cols-[minmax(0,280px)_auto] md:items-end">
            <label className="space-y-2">
              <span className="text-sm font-medium text-stone-700">Status Filter</span>
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as ActionNeededStatus | "all")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {statusOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </label>
          </div>
        </CardHeader>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
        <Card className="border-stone-200/80 bg-white/95 shadow-sm">
          <CardHeader>
            <CardTitle>Queued Tasks ({actionsNeeded.length})</CardTitle>
            <CardDescription>Review the execution plan, risk tier, and operator controls for each item.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-2xl border border-stone-200/80">
              <table className="min-w-full text-sm">
                <thead className="bg-stone-50 text-left text-xs uppercase tracking-[0.14em] text-stone-500">
                  <tr>
                    <th className="px-4 py-3">Title</th>
                    <th className="px-4 py-3">Location</th>
                    <th className="px-4 py-3">Risk</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Operations</th>
                    <th className="px-4 py-3">Created</th>
                    <th className="px-4 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-200/80">
                  {actionsNeeded.map((item) => {
                    const payload = item.payload ?? {};
                    const operations = operationSummary(payload);
                    const busy = busyId === item.id;
                    return (
                      <tr key={item.id} className="cursor-pointer align-top" onClick={() => setSelectedId(item.id)}>
                        <td className="px-4 py-4">
                          <p className="font-medium text-stone-900">{item.title}</p>
                          <p className="text-xs text-muted-foreground">{item.description ?? "No description"}</p>
                        </td>
                        <td className="px-4 py-4">{item.locationName ?? item.locationId ?? "N/A"}</td>
                        <td className="px-4 py-4">{item.riskTier}</td>
                        <td className="px-4 py-4">{item.status}</td>
                        <td className="px-4 py-4">{operations || "N/A"}</td>
                        <td className="px-4 py-4">{formatDate(item.createdAt)}</td>
                        <td className="px-4 py-4">
                          <div className="flex flex-wrap gap-2">
                            <Button size="sm" onClick={() => approve(item)} disabled={busy || item.status !== "pending"}>
                              Approve
                            </Button>
                            <Button variant="secondary" size="sm" onClick={() => updateStatus(item, "manual_completed")} disabled={busy || item.status !== "pending"}>
                              Manual Done
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => updateStatus(item, "dismissed")} disabled={busy || item.status !== "pending"}>
                              Dismiss
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!loading && actionsNeeded.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                        No actions needed for this client and filter.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        <Card className="border-stone-200/80 bg-white/95 shadow-sm">
          <CardHeader>
            <CardTitle>Operator Review</CardTitle>
            <CardDescription>Inspect the selected item and its execution payload.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedItem ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{selectedItem.provider}</Badge>
                  <Badge variant="secondary">{selectedItem.actionType}</Badge>
                  <Badge variant="secondary">{selectedItem.riskTier}</Badge>
                  <Badge variant="secondary">{selectedItem.status}</Badge>
                </div>
                <div className="space-y-1">
                  <p className="text-lg font-medium text-stone-900">{selectedItem.title}</p>
                  <p className="text-sm leading-6 text-muted-foreground">{selectedItem.description ?? "No description"}</p>
                </div>
                <div className="grid gap-3 text-sm text-stone-700">
                  <p>Location: {selectedItem.locationName ?? selectedItem.locationId ?? "N/A"}</p>
                  <p>Created: {formatDate(selectedItem.createdAt)}</p>
                  <p>Approved: {formatDate(selectedItem.approvedAt)}</p>
                  <p>Executed: {formatDate(selectedItem.executedAt)}</p>
                </div>
                <div className="overflow-x-auto rounded-2xl border border-stone-200/80">
                  <table className="min-w-full text-sm">
                    <thead className="bg-stone-50 text-left text-xs uppercase tracking-[0.14em] text-stone-500">
                      <tr>
                        <th className="px-4 py-3">Operation</th>
                        <th className="px-4 py-3">Payload</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-stone-200/80">
                      {operationDetails(selectedItem.payload).map((operation, index) => (
                        <tr key={`${selectedItem.id}-operation-${index}`}>
                          <td className="px-4 py-4">{typeof operation.kind === "string" ? operation.kind : "unknown"}</td>
                          <td className="px-4 py-4">
                            <pre className="max-h-80 overflow-auto rounded-xl bg-stone-950/95 p-4 text-xs leading-5 text-stone-100">
                              {JSON.stringify(operation, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      ))}
                      {operationDetails(selectedItem.payload).length === 0 ? (
                        <tr>
                          <td colSpan={2} className="px-4 py-4">
                            <pre className="max-h-80 overflow-auto rounded-xl bg-stone-950/95 p-4 text-xs leading-5 text-stone-100">
                              {JSON.stringify(selectedItem.payload, null, 2)}
                            </pre>
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Select a queued action to inspect its exact execution plan.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
