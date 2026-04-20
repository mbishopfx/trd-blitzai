"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  BadgeCheck,
  Building2,
  KeyRound,
  PanelLeft,
  ShieldCheck,
  Sparkles,
  UserCircle2,
  X
} from "lucide-react";
import { useDashboardContext } from "./dashboard-context";
import {
  extractClientId,
  getActiveDashboardItem,
  getClientWorkspaceNav,
  isActivePath,
  platformNav,
  type DashboardNavItem
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
import { cn } from "@/lib/utils";

const roleOptions = [
  { value: "owner", label: "Owner" },
  { value: "admin", label: "Admin" },
  { value: "operator", label: "Operator" },
  { value: "analyst", label: "Analyst" },
  { value: "client_viewer", label: "Client Viewer" }
] as const;

function DrawerSection({
  label,
  pathname,
  items,
  onNavigate
}: {
  label: string;
  pathname: string;
  items: DashboardNavItem[];
  onNavigate: () => void;
}) {
  return (
    <section className="px-3 py-3">
      <p className="px-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-sidebar-foreground/55">
        {label}
      </p>
      <div className="mt-2 space-y-1.5">
        {items.map((item) => {
          const active = isActivePath(pathname, item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "group flex rounded-2xl border px-3 py-3 transition-all",
                active
                  ? "border-stone-300 bg-white text-foreground shadow-[0_8px_24px_rgba(15,23,42,0.08)]"
                  : "border-transparent text-sidebar-foreground/80 hover:border-stone-200 hover:bg-white/80 hover:text-foreground"
              )}
            >
              <item.icon className={cn("mt-0.5 size-4 shrink-0", active ? "text-foreground" : "text-sidebar-foreground/60")} />
              <div className="ml-3 min-w-0">
                <p className="text-sm font-medium">{item.label}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.description}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
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
  const [menuOpen, setMenuOpen] = useState(false);

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

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

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
    <div className="relative flex min-h-svh w-full bg-[radial-gradient(circle_at_top_left,_rgba(245,245,244,0.96),_rgba(240,240,238,0.92)_55%,_rgba(234,234,231,0.94))]">
      {menuOpen ? (
        <button
          type="button"
          aria-label="Close navigation menu"
          className="fixed inset-0 z-20 bg-stone-950/12 backdrop-blur-[1px]"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <aside
        aria-hidden={!menuOpen}
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-[min(24rem,calc(100vw-1rem))] max-w-full flex-col border-r border-stone-200/80 bg-[rgba(246,246,244,0.98)] text-sidebar-foreground shadow-[0_18px_50px_rgba(15,23,42,0.14)] transition-transform duration-200 ease-out",
          menuOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col pt-24">
          <div className="px-4 pb-4">
            <div className="rounded-2xl border border-stone-200/80 bg-white/85 p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-semibold text-sidebar-foreground">
                  <Sparkles className="text-sidebar-primary" />
                  <span>TRD AI Blitz</span>
                </div>
                <Button variant="ghost" size="icon-sm" onClick={() => setMenuOpen(false)}>
                  <X />
                  <span className="sr-only">Close menu</span>
                </Button>
              </div>
              <p className="mt-2 text-xs leading-5 text-sidebar-foreground/70">
                Operator-first workspace for client dashboards, blitz automation, and SEO intelligence.
              </p>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="px-4 pb-4">
              <div className="rounded-2xl border border-stone-200/80 bg-white/80 p-4 shadow-sm">
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
              </div>
            </div>

            <DrawerSection
              label="Platform"
              pathname={pathname}
              items={platformNav}
              onNavigate={() => setMenuOpen(false)}
            />
            {clientWorkspaceNav.length ? (
              <DrawerSection
                label="Client Workspace"
                pathname={pathname}
                items={clientWorkspaceNav}
                onNavigate={() => setMenuOpen(false)}
              />
            ) : null}
          </div>

          <div className="border-t border-stone-200/80 px-4 py-4">
            {!supabaseEnabled ? (
              <Alert>
                <ShieldCheck />
                <AlertTitle>Local mode</AlertTitle>
                <AlertDescription>
                  Supabase browser auth is not configured. The dashboard still works with API keys and fallback headers.
                </AlertDescription>
              </Alert>
            ) : session?.user ? (
              <div className="rounded-2xl border border-stone-200/80 bg-white/85 p-4 shadow-sm">
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
              <div className="rounded-2xl border border-stone-200/80 bg-white/85 p-4 shadow-sm">
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
              </div>
            )}

            {authError ? (
              <Alert variant="destructive" className="mt-3">
                <KeyRound />
                <AlertTitle>Auth issue</AlertTitle>
                <AlertDescription>{authError}</AlertDescription>
              </Alert>
            ) : null}
          </div>
        </div>
      </aside>

      <div className="relative z-10 flex min-h-svh w-full flex-1 flex-col">
        <header className="sticky top-0 z-40 border-b border-border/70 bg-background/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 py-4 lg:px-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-0.5 shrink-0"
                  onClick={() => setMenuOpen((open) => !open)}
                >
                  <PanelLeft data-icon="inline-start" />
                  {menuOpen ? "Hide menu" : "Menu"}
                </Button>
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
      </div>
    </div>
  );
}
