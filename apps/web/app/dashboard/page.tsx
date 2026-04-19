"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Activity, Bot, Building2, Sparkles, Workflow } from "lucide-react";
import { useDashboardContext } from "./_components/dashboard-context";
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
  websiteUrl: string | null;
  primaryLocationLabel: string | null;
  createdAt: string;
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function DashboardOverviewPage() {
  const { selectedOrgId, organizations, request } = useDashboardContext();
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
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
  }, [request, selectedOrgId]);

  const selectedOrg = useMemo(
    () => organizations.find((organization) => organization.id === selectedOrgId) ?? null,
    [organizations, selectedOrgId]
  );

  const workspaceStats = useMemo(
    () => ({
      withWebsite: clients.filter((client) => Boolean(client.websiteUrl)).length,
      withLocation: clients.filter((client) => Boolean(client.primaryLocationLabel)).length
    }),
    [clients]
  );

  return (
    <div className="flex flex-col gap-6">
      <Card className="border-border/80 bg-card/95 shadow-sm">
        <CardHeader>
          <CardTitle>Operator Overview</CardTitle>
          <CardDescription>
            One clean dashboard for blitz execution, client workspaces, and the new Apify-powered SEO intelligence lane.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            <Button render={<Link href="/dashboard/clients" />}>
              <Building2 data-icon="inline-start" />
              Open Client Workspaces
            </Button>
            <Button render={<Link href="/dashboard/blitz" />} variant="outline">
              <Workflow data-icon="inline-start" />
              Open Blitz Runs
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant="secondary">AI Brand Rankings</Badge>
            <Badge variant="secondary">AI SEO Analysis</Badge>
            <Badge variant="secondary">Local SEO Data</Badge>
            <Badge variant="outline">Light shadcn workspace shell</Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader>
            <CardDescription>Organization</CardDescription>
            <CardTitle>{selectedOrg?.name ?? "No organization selected"}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              {selectedOrg?.slug ?? "Choose an organization from the sidebar to load client workspaces."}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Client Workspaces</CardDescription>
            <CardTitle>{loading ? "..." : clients.length}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              Managed clients available inside the current organization.
            </p>
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
              <span>{error ?? "Core dashboard routes and workspace context are responding."}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardDescription>Apify-Ready Profiles</CardDescription>
            <CardTitle>{workspaceStats.withWebsite}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Bot className="text-foreground" />
              <span>{workspaceStats.withLocation} clients already include a primary location for local SEO scans.</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Active Workspaces</CardTitle>
          <CardDescription>
            Quick access into the main operator flows for each seeded client.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {clients.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Website</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Workspace</TableHead>
                  <TableHead>SEO Intel</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clients.slice(0, 8).map((client) => (
                  <TableRow key={client.id}>
                    <TableCell className="font-medium">{client.name}</TableCell>
                    <TableCell>{client.primaryLocationLabel ?? "Not set"}</TableCell>
                    <TableCell>{client.websiteUrl ?? "Missing"}</TableCell>
                    <TableCell>{formatDate(client.createdAt)}</TableCell>
                    <TableCell>
                      <Button
                        render={<Link href={`/dashboard/clients/${client.id}`} />}
                        variant="outline"
                        size="sm"
                      >
                        Open
                      </Button>
                    </TableCell>
                    <TableCell>
                      <Button
                        render={<Link href={`/dashboard/clients/${client.id}/apify`} />}
                        variant="ghost"
                        size="sm"
                      >
                        <Sparkles data-icon="inline-start" />
                        Apify SEO
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <Empty className="border border-dashed border-border/80">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Building2 />
                </EmptyMedia>
                <EmptyTitle>No client workspaces yet</EmptyTitle>
                <EmptyDescription>
                  Seed clients from Google Business Profile in the client index and they will appear here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
