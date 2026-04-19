"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Bot, Gauge, Link2, Sparkles, Workflow } from "lucide-react";
import { ClientTabs } from "../../_components/client-tabs";
import { useDashboardContext } from "../../_components/dashboard-context";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";

interface ClientDetail {
  id: string;
  organizationId: string;
  name: string;
  timezone: string;
  websiteUrl: string | null;
  primaryLocationLabel: string | null;
  createdAt: string;
}

interface BlitzRunRecord {
  id: string;
  status: "created" | "running" | "completed" | "failed" | "partially_completed" | "rolled_back";
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdBy: string;
}

interface IntegrationRecord {
  id: string;
  provider: "gbp" | "ga4" | "google_ads" | "search_console" | "ghl";
  providerAccountId: string;
  scopes: string[];
  tokenExpiresAt: string | null;
  isActive: boolean;
  connectedAt: string;
}

interface DetailPayload {
  client: ClientDetail;
  workerStatus: "active" | "idle" | "error";
  latestRun: BlitzRunRecord | null;
  latestRunActionSummary: {
    attempted: number;
    executed: number;
    failed: number;
    pending: number;
    rolledBack: number;
    skipped: number;
  };
  recentRuns: BlitzRunRecord[];
}

function formatDate(value: string | null): string {
  if (!value) {
    return "N/A";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function ClientOverviewPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const { request } = useDashboardContext();

  const [payload, setPayload] = useState<DetailPayload | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [syncingAttribution, setSyncingAttribution] = useState(false);

  useEffect(() => {
    setLoading(true);
    setError(null);

    void Promise.all([
      request<DetailPayload>(`/api/v1/clients/${clientId}`),
      request<{ integrations: IntegrationRecord[] }>(`/api/v1/clients/${clientId}/integrations`)
    ])
      .then(([detail, integrationPayload]) => {
        setPayload(detail);
        setIntegrations(integrationPayload.integrations);
      })
      .catch((requestError) => {
        setError(requestError instanceof Error ? requestError.message : String(requestError));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [clientId, request]);

  const workerVariant = useMemo(() => {
    if (!payload || payload.workerStatus === "idle") {
      return "outline" as const;
    }

    if (payload.workerStatus === "error") {
      return "destructive" as const;
    }

    return "secondary" as const;
  }, [payload]);

  const syncAttribution = async () => {
    setSyncingAttribution(true);
    setError(null);
    setStatus(null);

    try {
      const result = await request<{ summary: { rowCount: number; channels: string[] } }>(
        `/api/v1/clients/${clientId}/attribution/sync`,
        {
          method: "POST",
          body: { window: "30d" }
        }
      );

      setStatus(`Attribution synced: ${result.summary.rowCount} rows across ${result.summary.channels.join(", ")}.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setSyncingAttribution(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>{payload?.client.name ?? "Client Workspace"}</CardTitle>
          <CardDescription>
            Monitor worker health, recent runs, integrations, attribution, and Apify-powered SEO intelligence from one workspace.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant={workerVariant}>
              <Gauge data-icon="inline-start" />
              Blitz Worker {payload?.workerStatus ?? (loading ? "loading" : "idle")}
            </Badge>
            <Badge variant="outline">{integrations.length} integrations</Badge>
            {payload?.client.primaryLocationLabel ? (
              <Badge variant="outline">{payload.client.primaryLocationLabel}</Badge>
            ) : null}
          </div>

          <ClientTabs clientId={clientId} />

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void syncAttribution()} disabled={syncingAttribution}>
              <Sparkles data-icon="inline-start" />
              {syncingAttribution ? "Syncing Attribution..." : "Sync Attribution"}
            </Button>
            <Button render={<Link href={`/dashboard/clients/${clientId}/blitz`} />} variant="outline">
              <Workflow data-icon="inline-start" />
              Open Blitz Worker
            </Button>
            <Button render={<Link href={`/dashboard/clients/${clientId}/apify`} />} variant="ghost">
              <Bot data-icon="inline-start" />
              Open Apify SEO
            </Button>
          </div>

          {status ? (
            <Alert>
              <AlertTitle>Attribution sync complete</AlertTitle>
              <AlertDescription>{status}</AlertDescription>
            </Alert>
          ) : null}

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Workspace issue</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Worker Status</CardDescription>
            <CardTitle>{payload?.workerStatus ?? (loading ? "..." : "idle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              The latest blitz run determines whether this workspace is active, idle, or needs investigation.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Latest Run</CardDescription>
            <CardTitle>{payload?.latestRun?.status ?? "No runs"}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Started: {formatDate(payload?.latestRun?.startedAt ?? null)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Connected Integrations</CardDescription>
            <CardTitle>{integrations.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              GBP, GA4, Google Ads, Search Console, and future channels surface here.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Apify SEO Lane</CardDescription>
            <CardTitle>{payload?.client.websiteUrl ? "Ready" : "Partial"}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Brand-ranking and AI SEO scans are enabled. Website crawl depth improves once the client URL is set.
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Client Profile</CardTitle>
            <CardDescription>Workspace metadata that feeds blitz automation and external SEO scans.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm text-muted-foreground">
            <div>
              <p className="font-medium text-foreground">Timezone</p>
              <p>{payload?.client.timezone ?? "Loading..."}</p>
            </div>
            <div>
              <p className="font-medium text-foreground">Primary Location</p>
              <p>{payload?.client.primaryLocationLabel ?? "Not set"}</p>
            </div>
            <div>
              <p className="font-medium text-foreground">Website</p>
              {payload?.client.websiteUrl ? (
                <a
                  className="inline-flex items-center gap-2 text-foreground underline underline-offset-4"
                  href={payload.client.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Link2 className="size-4" />
                  {payload.client.websiteUrl}
                </a>
              ) : (
                <p>Not set</p>
              )}
            </div>
            <div>
              <p className="font-medium text-foreground">Created</p>
              <p>{payload ? formatDate(payload.client.createdAt) : "Loading..."}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Latest Run Action Summary</CardTitle>
            <CardDescription>Fast read on how the most recent blitz run performed.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Badge variant="secondary">Attempted {payload?.latestRunActionSummary.attempted ?? 0}</Badge>
            <Badge variant="secondary">Executed {payload?.latestRunActionSummary.executed ?? 0}</Badge>
            <Badge variant="outline">Pending {payload?.latestRunActionSummary.pending ?? 0}</Badge>
            <Badge variant={payload?.latestRunActionSummary.failed ? "destructive" : "outline"}>
              Failed {payload?.latestRunActionSummary.failed ?? 0}
            </Badge>
            <Badge variant="outline">Rolled Back {payload?.latestRunActionSummary.rolledBack ?? 0}</Badge>
            <Badge variant="outline">Skipped {payload?.latestRunActionSummary.skipped ?? 0}</Badge>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Recent Runs</CardTitle>
          <CardDescription>Jump directly into run-specific blitz details from the workspace timeline.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Run ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Completed</TableHead>
                <TableHead>Triggered By</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {payload?.recentRuns?.length ? (
                payload.recentRuns.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell>
                      <Button
                        render={<Link href={`/dashboard/clients/${clientId}/blitz?runId=${encodeURIComponent(run.id)}`} />}
                        variant="link"
                        size="sm"
                        className="h-auto px-0"
                      >
                        {run.id}
                      </Button>
                    </TableCell>
                    <TableCell>{run.status}</TableCell>
                    <TableCell>{formatDate(run.createdAt)}</TableCell>
                    <TableCell>{formatDate(run.startedAt)}</TableCell>
                    <TableCell>{formatDate(run.completedAt)}</TableCell>
                    <TableCell>{run.createdBy}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No runs yet for this client.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
