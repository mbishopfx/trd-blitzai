"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Bot, Globe, MapPinned, Sparkles, Target } from "lucide-react";
import { ClientTabs } from "../../../_components/client-tabs";
import { useDashboardContext } from "../../../_components/dashboard-context";
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

type ApifyActionKey =
  | "brand_rankings"
  | "answer_engine_seo"
  | "site_crawl"
  | "local_listings";

interface ClientDetailPayload {
  client: {
    id: string;
    name: string;
    websiteUrl: string | null;
    primaryLocationLabel: string | null;
  };
}

interface ApifyRunRecord {
  id: string;
  actionKey: ApifyActionKey;
  label: string;
  status: "running" | "succeeded" | "failed";
  sourceType: "actor" | "task";
  sourceId: string;
  apifyRunId: string;
  datasetId: string | null;
  inputSummary: string[];
  summaryLines: string[];
  previewItems: Array<Record<string, unknown>>;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

const actionCards: Array<{
  key: ApifyActionKey;
  label: string;
  description: string;
  detail: string;
  icon: typeof Target;
}> = [
  {
    key: "brand_rankings",
    label: "AI Brand Rankings",
    description: "Runs Apify search workers against branded and location-aware queries.",
    detail: "Compares presence across classic results plus AI-assisted search surfaces where available.",
    icon: Target
  },
  {
    key: "answer_engine_seo",
    label: "AI SEO Analysis",
    description: "Biases the query pack toward answer-engine style prompts and AI result surfaces.",
    detail: "Useful for spotting whether the brand shows up in ChatGPT, Perplexity, and AI-overview contexts.",
    icon: Sparkles
  },
  {
    key: "site_crawl",
    label: "Site Crawl",
    description: "Uses Apify's website crawler to inspect the client's site footprint.",
    detail: "Great for verifying crawlable content depth before content or GEO work.",
    icon: Globe
  },
  {
    key: "local_listings",
    label: "Local SEO Data",
    description: "Runs a Google Maps style listing scan around the client's brand and location.",
    detail: "Good for quick local-pack visibility and listing sanity checks.",
    icon: MapPinned
  }
];

function formatDate(value: string | null): string {
  if (!value) {
    return "N/A";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function ClientApifyPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const { request } = useDashboardContext();

  const [client, setClient] = useState<ClientDetailPayload["client"] | null>(null);
  const [history, setHistory] = useState<ApifyRunRecord[]>([]);
  const [runningKey, setRunningKey] = useState<ApifyActionKey | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const latestRunByAction = useMemo(() => {
    const entries = new Map<ApifyActionKey, ApifyRunRecord>();

    for (const run of history) {
      if (!entries.has(run.actionKey)) {
        entries.set(run.actionKey, run);
      }
    }

    return entries;
  }, [history]);

  const loadPage = () => {
    setError(null);

    void Promise.all([
      request<ClientDetailPayload>(`/api/v1/clients/${clientId}`),
      request<{ runs: ApifyRunRecord[] }>(`/api/v1/clients/${clientId}/apify/actions`)
    ])
      .then(([clientPayload, runsPayload]) => {
        setClient(clientPayload.client);
        setHistory(runsPayload.runs);
      })
      .catch((requestError) => {
        setError(requestError instanceof Error ? requestError.message : String(requestError));
      });
  };

  useEffect(loadPage, [clientId, request]);

  const runAction = async (actionKey: ApifyActionKey) => {
    setRunningKey(actionKey);
    setStatus(null);
    setError(null);

    try {
      const payload = await request<{ run: ApifyRunRecord }>(`/api/v1/clients/${clientId}/apify/actions`, {
        method: "POST",
        body: { actionKey }
      });

      setHistory((current) => [payload.run, ...current.filter((run) => run.id !== payload.run.id)]);
      setStatus(`${payload.run.label} finished with ${payload.run.status}.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setRunningKey(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>{client?.name ?? "Client"} · Apify SEO Workspace</CardTitle>
          <CardDescription>
            Quick-run Apify actions for AI brand rankings, AI SEO analysis, site crawl coverage, and local listing data.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {client?.websiteUrl ? <Badge variant="secondary">{client.websiteUrl}</Badge> : <Badge variant="outline">Website missing</Badge>}
            {client?.primaryLocationLabel ? (
              <Badge variant="outline">{client.primaryLocationLabel}</Badge>
            ) : (
              <Badge variant="outline">Location missing</Badge>
            )}
          </div>

          <ClientTabs clientId={clientId} />

          {status ? (
            <Alert>
              <Bot />
              <AlertTitle>Apify run complete</AlertTitle>
              <AlertDescription>{status}</AlertDescription>
            </Alert>
          ) : null}

          {error ? (
            <Alert variant="destructive">
              <AlertTitle>Apify issue</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {actionCards.map((action) => {
          const latestRun = latestRunByAction.get(action.key) ?? null;

          return (
            <Card key={action.key} className="shadow-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <action.icon className="size-4" />
                  {action.label}
                </CardTitle>
                <CardDescription>{action.description}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">{action.detail}</p>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void runAction(action.key)} disabled={runningKey === action.key}>
                    {runningKey === action.key ? "Running..." : `Run ${action.label}`}
                  </Button>
                  {latestRun ? (
                    <Badge variant={latestRun.status === "failed" ? "destructive" : latestRun.status === "succeeded" ? "secondary" : "outline"}>
                      {latestRun.status}
                    </Badge>
                  ) : null}
                </div>

                {latestRun ? (
                  <div className="space-y-3 rounded-xl border border-border/80 bg-muted/40 p-3">
                    <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                      <span>Source: {latestRun.sourceType}</span>
                      <span>Run: {latestRun.apifyRunId}</span>
                      {latestRun.datasetId ? <span>Dataset: {latestRun.datasetId}</span> : null}
                    </div>

                    {latestRun.inputSummary.length ? (
                      <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                        {latestRun.inputSummary.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    ) : null}

                    {latestRun.summaryLines.length ? (
                      <ul className="list-disc space-y-1 pl-4 text-sm text-foreground">
                        {latestRun.summaryLines.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Recent Apify Runs</CardTitle>
          <CardDescription>
            Persisted run history from the new Apify integration, stored in Supabase/Postgres.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Action</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Apify Run ID</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Finished</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.length ? (
                history.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="font-medium">{run.label}</TableCell>
                    <TableCell>{run.status}</TableCell>
                    <TableCell>
                      {run.sourceType}:{run.sourceId}
                    </TableCell>
                    <TableCell>{run.apifyRunId}</TableCell>
                    <TableCell>{formatDate(run.createdAt)}</TableCell>
                    <TableCell>{formatDate(run.finishedAt)}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    No Apify runs yet for this client.
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
