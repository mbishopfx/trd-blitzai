"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import {
  BadgeCheck,
  Building2,
  KeyRound,
  ShieldCheck,
  Sparkles,
  UserCircle2
} from "lucide-react";
import { useDashboardContext } from "./dashboard-context";
import {
  extractClientId,
  getActiveDashboardItem,
  getClientWorkspaceNav,
  isActivePath,
  platformNav
} from "./dashboard-nav";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger
} from "@/components/ui/sidebar";

const roleOptions = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "operator", label: "Operator" },
  { value: "analyst", label: "Analyst" },
  { value: "client_viewer", label: "Client Viewer" }
] as const;

function WorkspaceSection({
  label,
  pathname,
  items
}: {
  label: string;
  pathname: string;
  items: ReturnType<typeof getClientWorkspaceNav> | typeof platformNav;
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.href}>
              <SidebarMenuButton
                render={<Link href={item.href} />}
                isActive={isActivePath(pathname, item.href)}
                tooltip={item.label}
              >
                <item.icon />
                <span>{item.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const {
    supabaseEnabled,
    session,
    organizations,
    selectedOrgId,
    role,
    apiKey,
    isBusy,
    setSelectedOrgId,
    setRole,
    setApiKey,
    signIn,
    signOut
  } = useDashboardContext();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);

  const clientId = useMemo(() => extractClientId(pathname), [pathname]);
  const activeItem = useMemo(() => getActiveDashboardItem(pathname), [pathname]);
  const selectedOrg = useMemo(
    () => organizations.find((organization) => organization.id === selectedOrgId) ?? null,
    [organizations, selectedOrgId]
  );
  const clientWorkspaceNav = useMemo(
    () => (clientId ? getClientWorkspaceNav(clientId) : []),
    [clientId]
  );

  const onSignIn = async () => {
    setAuthError(null);
    try {
      await signIn(email.trim(), password);
      setPassword("");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error));
    }
  };

  const onSignOut = async () => {
    setAuthError(null);
    try {
      await signOut();
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <SidebarProvider defaultOpen>
      <Sidebar variant="inset" collapsible="offcanvas" className="border-r border-sidebar-border/80">
        <SidebarHeader className="gap-3 border-b border-sidebar-border/80">
          <div className="rounded-xl border border-sidebar-border/80 bg-sidebar-accent/40 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-sidebar-foreground">
              <Sparkles className="text-sidebar-primary" />
              <span>TRD AI Blitz</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-sidebar-foreground/70">
              Light, operator-first workspace for client dashboards, blitz automation, and SEO intelligence.
            </p>
          </div>

          <FieldGroup>
            <Field>
              <FieldLabel>Organization</FieldLabel>
              <Select value={selectedOrgId || undefined} onValueChange={(value) => setSelectedOrgId(value ?? "")}>
                <SelectTrigger className="w-full bg-background">
                  <SelectValue placeholder="Select an organization" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {organizations.map((organization) => (
                      <SelectItem key={organization.id} value={organization.id}>
                        {organization.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                {selectedOrg ? selectedOrg.slug : "Workspace scope follows the selected organization."}
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel>Role</FieldLabel>
              <Select value={role} onValueChange={(value) => value && setRole(value as typeof role)}>
                <SelectTrigger className="w-full bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {roleOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel>API Key Override</FieldLabel>
              <Input
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="blitz_..."
              />
              <FieldDescription>
                Optional when you want key-based routing instead of browser-session auth.
              </FieldDescription>
            </Field>
          </FieldGroup>
        </SidebarHeader>

        <SidebarContent>
          <WorkspaceSection label="Platform" pathname={pathname} items={platformNav} />
          {clientWorkspaceNav.length ? (
            <>
              <SidebarSeparator />
              <WorkspaceSection label="Client Workspace" pathname={pathname} items={clientWorkspaceNav} />
            </>
          ) : null}
        </SidebarContent>

        <SidebarFooter className="border-t border-sidebar-border/80">
          {!supabaseEnabled ? (
            <Alert>
              <ShieldCheck />
              <AlertTitle>Local mode</AlertTitle>
              <AlertDescription>
                Supabase browser auth is not configured. The dashboard still works with API keys and fallback headers.
              </AlertDescription>
            </Alert>
          ) : session?.user ? (
            <div className="rounded-xl border border-sidebar-border/80 bg-background p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <BadgeCheck className="text-emerald-600" />
                <span>{session.user.email ?? "Authenticated"}</span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Requests will use the current browser session token unless an API key override is set.
              </p>
              <Button variant="outline" size="sm" className="mt-3 w-full" onClick={() => void onSignOut()}>
                Sign Out
              </Button>
            </div>
          ) : (
            <FieldGroup>
              <Field>
                <FieldLabel>Email</FieldLabel>
                <Input
                  autoComplete="email"
                  placeholder="operator@truerankdigital.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel>Password</FieldLabel>
                <Input
                  autoComplete="current-password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>
              <Button
                className="w-full"
                onClick={() => void onSignIn()}
                disabled={!email.trim() || !password || isBusy}
              >
                Sign In
              </Button>
            </FieldGroup>
          )}

          {authError ? (
            <Alert variant="destructive">
              <KeyRound />
              <AlertTitle>Auth issue</AlertTitle>
              <AlertDescription>{authError}</AlertDescription>
            </Alert>
          ) : null}
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="bg-[radial-gradient(circle_at_top_left,_rgba(245,245,244,0.96),_rgba(240,240,238,0.92)_55%,_rgba(234,234,231,0.94))]">
        <header className="sticky top-0 z-20 border-b border-border/70 bg-background/90 backdrop-blur">
          <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 py-4 lg:px-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <SidebarTrigger className="mt-0.5" />
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="font-heading text-lg font-semibold tracking-tight">
                      {activeItem?.label ?? "Dashboard"}
                    </h1>
                    {selectedOrg ? (
                      <Badge variant="secondary">
                        <Building2 data-icon="inline-start" />
                        {selectedOrg.name}
                      </Badge>
                    ) : null}
                    <Badge variant="outline">
                      <UserCircle2 data-icon="inline-start" />
                      {role.replace("_", " ")}
                    </Badge>
                  </div>
                  <p className="max-w-3xl text-sm text-muted-foreground">
                    {activeItem?.description ??
                      "Operate client workspaces, workers, and search intelligence from one clean command surface."}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={session?.user ? "secondary" : "outline"}>
                  {session?.user ? "Authenticated" : supabaseEnabled ? "Signed out" : "Fallback auth"}
                </Badge>
                <Badge variant={apiKey.trim() ? "secondary" : "outline"}>
                  {apiKey.trim() ? "API key set" : "Browser token mode"}
                </Badge>
              </div>
            </div>
          </div>
        </header>

        <div className="mx-auto flex w-full max-w-[1600px] flex-1 px-4 py-4 lg:px-6 lg:py-6">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  );
}
