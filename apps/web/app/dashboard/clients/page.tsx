"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Building2, Globe, Sparkles, Workflow } from "lucide-react";
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

interface ClientRecord {
  id: string;
  organizationId: string;
  name: string;
  timezone: string;
  websiteUrl: string | null;
  primaryLocationLabel: string | null;
  createdAt: string;
  pendingReviewReplyCount: number;
}

interface OAuthStartResponse {
  authUrl: string;
  redirectUri: string;
}

interface SitemapAutofillResponse {
  summary: {
    total: number;
    updated: number;
    skipped: number;
    failed: number;
  };
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function ClientsPage() {
  const { selectedOrgId, request } = useDashboardContext();
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [autofillStatus, setAutofillStatus] = useState<string | null>(null);
  const [seedQueryState, setSeedQueryState] = useState<{
    oauthConnected: boolean;
    seededClients: string | null;
    refreshedClients: string | null;
    seededSkipped: string | null;
    seedError: string | null;
  }>({
    oauthConnected: false,
    seededClients: null,
    refreshedClients: null,
    seededSkipped: null,
    seedError: null
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const params = new URLSearchParams(window.location.search);
    setSeedQueryState({
      oauthConnected: params.get("gbp_connected") === "true",
      seededClients: params.get("seeded_clients"),
      refreshedClients: params.get("refreshed_clients"),
      seededSkipped: params.get("seeded_skipped"),
      seedError: params.get("gbp_seed_error")
    });
  }, []);

  const seedStatusLabel = useMemo(() => {
    if (!seedQueryState.oauthConnected) {
      return null;
    }

    if (seedQueryState.seedError) {
      return `OAuth connected, but seeding returned an error: ${seedQueryState.seedError}`;
    }

    return `OAuth connected. Seeded ${seedQueryState.seededClients ?? "0"} new clients, refreshed ${
      seedQueryState.refreshedClients ?? "0"
    } existing clients, skipped ${seedQueryState.seededSkipped ?? "0"}.`;
  }, [seedQueryState]);

  const workspaceStats = useMemo(
    () => ({
      websites: clients.filter((client) => Boolean(client.websiteUrl)).length,
      locations: clients.filter((client) => Boolean(client.primaryLocationLabel)).length,
      clientsNeedingReplies: clients.filter((client) => client.pendingReviewReplyCount > 0).length,
      totalPendingReviewReplies: clients.reduce((sum, client) => sum + (client.pendingReviewReplyCount ?? 0), 0)
    }),
    [clients]
  );

  const loadClients = () => {
    if (!selectedOrgId) {
      setClients([]);
      return;
    }

    setLoading(true);
    setError(null);

    void request<{ clients: ClientRecord[] }>(`/api/v1/orgs/${selectedOrgId}/clients`)
      .then((payload) => {
        setClients(payload.clients);
      })
      .catch((requestError) => {
        setError(requestError instanceof Error ? requestError.message : String(requestError));
      })
      .finally(() => {
        setLoading(false);
      });
  };

  useEffect(loadClients, [request, selectedOrgId]);

  const startOAuthSeed = async () => {
    if (!selectedOrgId) {
      setError("Select an organization before starting OAuth.");
      return;
    }

    setBusy(true);
    setError(null);
    setAutofillStatus(null);

    try {
      const oauthStart = await request<OAuthStartResponse>(
        `/api/v1/gbp/oauth/start?seedMode=true&returnPath=${encodeURIComponent("/dashboard/clients")}`
      );

      window.location.assign(oauthStart.authUrl);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
      setBusy(false);
    }
  };

  const autofillSitemaps = async () => {
    if (!selectedOrgId) {
      setError("Select an organization before auto-filling sitemaps.");
      return;
    }

    setBusy(true);
    setError(null);
    setAutofillStatus(null);

    try {
      const payload = await request<SitemapAutofillResponse>(`/api/v1/orgs/${selectedOrgId}/clients/sitemaps/autofill`, {
        method: "POST",
        body: {
          overwrite: false
        }
      });

      setAutofillStatus(
        `Sitemap autofill finished. Updated ${payload.summary.updated}/${payload.summary.total}, skipped ${payload.summary.skipped}, failed ${payload.summary.failed}.`
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setBusy(false);
    }
  };

  const deleteClient = async (client: ClientRecord) => {
    const confirmed = window.confirm(
      `Delete ${client.name} from TRD AI Blitz? This only removes it from the platform, not from Google Business Profile.`
    );

    if (!confirmed) {
      return;
    }

    setBusy(true);
    setError(null);

    try {
      await request(`/api/v1/clients/${client.id}`, { method: "DELETE" });
      loadClients();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Client Workspace Index</CardTitle>
          <CardDescription>
            Seed Google Business Profile clients, manage workspace access, and jump directly into blitz or Apify SEO lanes.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void startOAuthSeed()} disabled={busy}>
              <Building2 data-icon="inline-start" />
              {busy ? "Starting OAuth..." : "Connect Google + Seed Clients"}
            </Button>
            <Button variant="outline" onClick={() => void autofillSitemaps()} disabled={busy}>
              <Globe data-icon="inline-start" />
              Auto-fill Sitemaps
            </Button>
            <Button variant="ghost" onClick={loadClients} disabled={loading}>
              Refresh Client List
            </Button>
          </div>

          {seedStatusLabel ? (
            <Alert variant={seedQueryState.seedError ? "destructive" : "default"}>
              <Sparkles />
              <AlertTitle>Seed result</AlertTitle>
              <AlertDescription>{seedStatusLabel}</AlertDescription>
            </Alert>
          ) : null}

          {autofillStatus ? (
            <Alert>
              <Workflow />
              <AlertTitle>Sitemap autofill</AlertTitle>
              <AlertDescription>{autofillStatus}</AlertDescription>
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

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Seeded Clients</CardDescription>
            <CardTitle>{loading ? "..." : clients.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Managed workspaces under the current organization.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Websites Ready</CardDescription>
            <CardTitle>{workspaceStats.websites}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Clients that can support website crawl and brand-ranking scans.</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Review Alerts</CardDescription>
            <CardTitle>{workspaceStats.totalPendingReviewReplies}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {workspaceStats.clientsNeedingReplies} client workspace{workspaceStats.clientsNeedingReplies === 1 ? "" : "s"} currently need review replies.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Seeded Clients</CardTitle>
          <CardDescription>
            Every row opens a dedicated workspace with blitz controls and Apify-powered SEO actions.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {clients.length ? (
            <div className="flex flex-col gap-3">
              {clients.map((client) => (
                <div
                  key={client.id}
                  className="rounded-2xl border border-border/80 bg-card/85 p-4 shadow-sm"
                >
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_auto] xl:items-start">
                    <div className="space-y-3">
                      <div>
                        <p className="text-base font-semibold">{client.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {client.primaryLocationLabel ?? "Primary location not set"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="secondary">{client.timezone}</Badge>
                        <Badge variant="outline">
                          Created {formatDate(client.createdAt)}
                        </Badge>
                        {client.pendingReviewReplyCount > 0 ? (
                          <Badge variant="destructive">
                            {client.pendingReviewReplyCount} review alert{client.pendingReviewReplyCount === 1 ? "" : "s"}
                          </Badge>
                        ) : null}
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                      <div className="rounded-xl border border-border/80 bg-muted/35 p-3">
                        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                          Website
                        </p>
                        <p className="mt-2 break-all text-sm">
                          {client.websiteUrl ?? "Missing website URL"}
                        </p>
                      </div>
                      <div className="rounded-xl border border-border/80 bg-muted/35 p-3">
                        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                          Workspace status
                        </p>
                        {client.pendingReviewReplyCount > 0 ? (
                          <p className="mt-2 text-sm text-foreground">
                            {client.pendingReviewReplyCount} live review repl{client.pendingReviewReplyCount === 1 ? "y is" : "ies are"} waiting in this workspace.
                          </p>
                        ) : (
                          <p className="mt-2 text-sm text-muted-foreground">
                            Blitz controls and Apify SEO workspace are ready from this row.
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 xl:min-w-[170px]">
                      <Button
                        render={<Link href={`/dashboard/clients/${client.id}`} />}
                        variant="outline"
                        size="sm"
                        className="w-full"
                      >
                        Open Workspace
                      </Button>
                      <Button
                        render={<Link href={`/dashboard/clients/${client.id}/apify`} />}
                        variant="ghost"
                        size="sm"
                        className="w-full"
                      >
                        <Sparkles data-icon="inline-start" />
                        Apify SEO
                      </Button>
                      <Button variant="destructive" size="sm" className="w-full" onClick={() => void deleteClient(client)}>
                        Remove Client
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty className="border border-dashed border-border/80">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Building2 />
                </EmptyMedia>
                <EmptyTitle>No seeded clients yet</EmptyTitle>
                <EmptyDescription>
                  Connect Google and seed clients to start using the redesigned workspace system.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
