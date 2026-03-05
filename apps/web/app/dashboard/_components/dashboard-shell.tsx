"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState, type ReactNode } from "react";
import { useDashboardContext } from "./dashboard-context";
import styles from "./dashboard.module.css";

interface NavItem {
  href: string;
  label: string;
  detail: string;
}

const primaryNav: NavItem[] = [
  {
    href: "/dashboard",
    label: "Overview",
    detail: "Platform health and onboarding"
  },
  {
    href: "/dashboard/clients",
    label: "Clients",
    detail: "Seeded locations and account control"
  },
  {
    href: "/dashboard/blitz",
    label: "Blitz Runs",
    detail: "Launch and monitor orchestration"
  }
];

function isActivePath(pathname: string, href: string): boolean {
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function extractClientId(pathname: string): string | null {
  const match = pathname.match(/^\/dashboard\/clients\/([^/]+)/);
  return match?.[1] ?? null;
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

  const selectedOrg = organizations.find((org) => org.id === selectedOrgId) ?? null;
  const clientId = useMemo(() => extractClientId(pathname), [pathname]);

  const clientNav = useMemo<NavItem[]>(() => {
    if (!clientId) {
      return [];
    }

    return [
      {
        href: `/dashboard/clients/${clientId}`,
        label: "Client Overview",
        detail: "Worker status and integration health"
      },
      {
        href: `/dashboard/clients/${clientId}/blitz`,
        label: "Blitz Worker",
        detail: "Runs, actions, and rollback"
      },
      {
        href: `/dashboard/clients/${clientId}/reviews`,
        label: "Reviews",
        detail: "Live reviews and auto-replies"
      },
      {
        href: `/dashboard/clients/${clientId}/settings`,
        label: "Orchestration",
        detail: "Tone, objectives, photos, sitemap"
      }
    ];
  }, [clientId]);

  const onSignIn = async () => {
    setAuthError(null);
    try {
      await signIn(email.trim(), password);
      setPassword("");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <h1 className={styles.brandTitle}>TRD Blitz AI</h1>
          <p className={styles.brandSub}>Autonomous GBP Orchestration</p>
        </div>

        <div className={styles.navSection}>
          <p className={styles.navTitle}>Platform</p>
          {primaryNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.navLink} ${isActivePath(pathname, item.href) ? styles.navLinkActive : ""}`}
            >
              <span className={styles.navLabel}>{item.label}</span>
              <span className={styles.navDetail}>{item.detail}</span>
            </Link>
          ))}
        </div>

        {clientNav.length > 0 ? (
          <div className={styles.navSection}>
            <p className={styles.navTitle}>Client Workspace</p>
            {clientNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`${styles.navLink} ${isActivePath(pathname, item.href) ? styles.navLinkActive : ""}`}
              >
                <span className={styles.navLabel}>{item.label}</span>
                <span className={styles.navDetail}>{item.detail}</span>
              </Link>
            ))}
          </div>
        ) : null}

        <div className={styles.sidebarFooter}>
          <p className={styles.muted}>Org: {selectedOrg?.name ?? "No org selected"}</p>
          <p className={styles.muted}>Role: {role}</p>
          <p className={styles.muted}>Auth: {session?.user.email ?? (supabaseEnabled ? "Signed out" : "Bypass mode")}</p>
        </div>
      </aside>

      <main className={styles.main}>
        <div className={styles.mainInner}>
          <section className={styles.topbar}>
            <div className={styles.topbarRow}>
              <label className={styles.field}>
                <span className={styles.label}>Organization</span>
                <select
                  className={styles.select}
                  value={selectedOrgId}
                  onChange={(event) => setSelectedOrgId(event.target.value)}
                  disabled={isBusy}
                >
                  {organizations.length === 0 ? <option value="">No organizations</option> : null}
                  {organizations.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className={styles.field}>
                <span className={styles.label}>Role Header</span>
                <select className={styles.select} value={role} onChange={(event) => setRole(event.target.value as typeof role)}>
                  <option value="owner">owner</option>
                  <option value="admin">admin</option>
                  <option value="operator">operator</option>
                  <option value="analyst">analyst</option>
                  <option value="client_viewer">client_viewer</option>
                </select>
              </label>

              <label className={styles.field}>
                <span className={styles.label}>API Key (Optional)</span>
                <input
                  className={styles.input}
                  placeholder="blitz_xxx"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                />
              </label>
            </div>

            {supabaseEnabled ? (
              session ? (
                <div className={styles.topbarRow}>
                  <span className={`${styles.badge} ${styles.statusActive}`}>Signed in as {session.user.email}</span>
                  <button type="button" className={styles.buttonGhost} onClick={() => void signOut()}>
                    Sign out
                  </button>
                </div>
              ) : (
                <div className={styles.topbarRow}>
                  <label className={styles.field}>
                    <span className={styles.label}>Email</span>
                    <input
                      className={styles.input}
                      autoComplete="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="owner@agency.com"
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.label}>Password</span>
                    <input
                      className={styles.input}
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                  </label>
                  <button type="button" className={styles.buttonPrimary} onClick={() => void onSignIn()}>
                    Sign in
                  </button>
                  {authError ? <span className={`${styles.badge} ${styles.statusError}`}>{authError}</span> : null}
                </div>
              )
            ) : (
              <div className={styles.topbarRow}>
                <span className={`${styles.badge} ${styles.statusIdle}`}>
                  Supabase browser auth is disabled. Requests use role headers.
                </span>
              </div>
            )}
          </section>

          {children}
        </div>
      </main>
    </div>
  );
}
