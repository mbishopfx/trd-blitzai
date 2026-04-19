"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, CircleAlert, Rocket, Sparkles, Workflow } from "lucide-react";
import { useDashboardContext } from "../_components/dashboard-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";

interface ClientRecord {
  id: string;
  name: string;
  timezone: string;
  primaryLocationLabel: string | null;
}

interface BlitzRunRecord {
  id: string;
  status: "created" | "running" | "completed" | "failed" | "partially_completed" | "rolled_back";
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

function formatDate(value: string | null): string {
  if (!value) return "N/A";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function getRunStatusBadge(status: BlitzRunRecord["status"] | null) {
  if (!status) {
    return (
      <Badge variant="outline" className="border-border/80 text-muted-foreground">
        No runs
      </Badge>
    );
  }

  if (status === "running" || status === "created") {
    return (
      <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-700">
        {status}
      </Badge>
    );
  }

  if (status === "failed" || status === "rolled_back") {
    return (
      <Badge variant="outline" className="border-red-300 bg-red-50 text-red-700">
        {status}
      </Badge>
    );
  }

  if (status === "partially_completed") {
    return (
      <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-700">
        {status}
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="border-slate-300 bg-slate-50 text-slate-700">
      {status}
    </Badge>
  );
}

export default function BlitzRunsPage() {
  const { selectedOrgId, request } = useDashboardContext();
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [latestRunsByClient, setLatestRunsByClient] = useState<Record<string, BlitzRunRecord | null>>({});
  const [targetClientId, setTargetClientId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const loadBlitzIndex = useCallback(async () => {
    if (!selectedOrgId) {
      setClients([]);
      setLatestRunsByClient({});
      setTargetClientId("");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const clientsPayload = await request<{ clients: ClientRecord[] }>(`/api/v1/orgs/${selectedOrgId}/clients`);
      const nextClients = clientsPayload.clients;

      setClients(nextClients);
      setTargetClientId((current) =>
        current && nextClients.some((client) => client.id === current) ? current : (nextClients[0]?.id ?? "")
      );

      const runLookups = await Promise.all(
        nextClients.map(async (client) => {
          try {
            const payload = await request<{ runs: BlitzRunRecord[] }>(`/api/v1/clients/${client.id}/blitz-runs?limit=1`);
            return [client.id, payload.runs[0] ?? null] as const;
          } catch {
            return [client.id, null] as const;
          }
        })
      );

      setLatestRunsByClient(Object.fromEntries(runLookups));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [request, selectedOrgId]);

  useEffect(() => {
    void loadBlitzIndex();
  }, [loadBlitzIndex]);

  const runSummary = useMemo(() => {
    const values = Object.values(latestRunsByClient).filter((run): run is BlitzRunRecord => Boolean(run));
    return {
      total: values.length,
      running: values.filter((run) => run.status === "running" || run.status === "created").length,
      failed: values.filter((run) => run.status === "failed").length
    };
  }, [latestRunsByClient]);

  const startQuickRun = async () => {
    if (!targetClientId) {
      setError("Select a client first.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await request(`/api/v1/clients/${targetClientId}/blitz-runs`, {
        method: "POST",
        body: {
          triggeredBy: "dashboard-blitz-page",
          policySnapshot: {
            source: "global-blitz-page"
          }
        }
      });
      await loadBlitzIndex();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <Card className="border-border/80 bg-card/95 shadow-sm">
        <CardHeader className="gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-2">
              <CardTitle>Global Blitz Run Monitor</CardTitle>
              <CardDescription className="max-w-3xl">
                One clean control plane for worker activity across seeded clients. Launch a new blitz run here or jump
                into a client workspace for deeper debugging.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">Tracked runs: {runSummary.total}</Badge>
              <Badge variant="secondary">Workers active: {runSummary.running}</Badge>
              <Badge variant="outline">Latest failures: {runSummary.failed}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FieldGroup className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-end">
            <Field>
              <FieldLabel>Quick launch client</FieldLabel>
              <Select value={targetClientId || undefined} onValueChange={(value) => setTargetClientId(value ?? "")}>
                <SelectTrigger className="w-full bg-background">
                  <SelectValue placeholder="Select a client workspace" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {clients.length ? (
                      clients.map((client) => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.name}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="__empty" disabled>
                        No clients found
                      </SelectItem>
                    )}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                Start a blitz run without leaving the global queue view.
              </FieldDescription>
            </Field>

            <Button onClick={() => void startQuickRun()} disabled={busy || !targetClientId}>
              <Rocket data-icon="inline-start" />
              {busy ? "Launching..." : "Launch Blitz"}
            </Button>

            <Button variant="outline" onClick={() => void loadBlitzIndex()} disabled={loading}>
              <Sparkles data-icon="inline-start" />
              {loading ? "Refreshing..." : "Refresh"}
            </Button>
          </FieldGroup>

          {error ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>Queue issue</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Client Workspaces</CardDescription>
            <CardTitle>{loading ? "..." : clients.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Clients available inside the current organization for blitz queue control.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Active Workers</CardDescription>
            <CardTitle>{runSummary.running}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Workflow className="text-foreground" />
              <span>Runs in `created` or `running` state.</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Failure Watch</CardDescription>
            <CardTitle>{runSummary.failed}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <CircleAlert className={runSummary.failed ? "text-destructive" : "text-muted-foreground"} />
              <span>Latest per-client failures or rolled back runs requiring attention.</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Platform State</CardDescription>
            <CardTitle>{error ? "Needs attention" : "Healthy"}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Activity className={error ? "text-destructive" : "text-emerald-600"} />
              <span>{error ?? "Global queue, worker state, and launch controls are responding."}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Latest Run Per Client</CardTitle>
          <CardDescription>
            Review the newest recorded run for every client and jump straight into the corresponding workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {clients.length ? (
            <div className="overflow-hidden rounded-xl border border-border/80">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Run ID</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Completed</TableHead>
                    <TableHead>Workspace</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clients.map((client) => {
                    const run = latestRunsByClient[client.id] ?? null;

                    return (
                      <TableRow key={client.id}>
                        <TableCell className="font-medium">{client.name}</TableCell>
                        <TableCell>{client.primaryLocationLabel ?? "Not set"}</TableCell>
                        <TableCell>{getRunStatusBadge(run?.status ?? null)}</TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">{run?.id ?? "-"}</TableCell>
                        <TableCell>{formatDate(run?.startedAt ?? null)}</TableCell>
                        <TableCell>{formatDate(run?.completedAt ?? null)}</TableCell>
                        <TableCell>
                          <Button
                            render={<Link href={`/dashboard/clients/${client.id}/blitz`} />}
                            variant="ghost"
                            size="sm"
                          >
                            Open
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <Empty className="border border-dashed border-border/80">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Workflow />
                </EmptyMedia>
                <EmptyTitle>No clients found</EmptyTitle>
                <EmptyDescription>
                  Select an organization with seeded clients to populate the global blitz queue.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
