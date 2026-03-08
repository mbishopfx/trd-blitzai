"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useDashboardContext } from "./dashboard-context";
import styles from "./dashboard.module.css";

interface NavItem {
  href: string;
  label: string;
  detail: string;
}

type UiTheme = "dark" | "light";
type RailIcon = "home" | "search" | "user";

interface RailNavItem {
  href: string;
  label: string;
  icon: RailIcon;
}

const railNav: RailNavItem[] = [
  {
    href: "/dashboard",
    label: "Home",
    icon: "home"
  },
  {
    href: "/dashboard/clients",
    label: "Search",
    icon: "search"
  },
  {
    href: "/dashboard/blitz",
    label: "User",
    icon: "user"
  }
];

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

function HomeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.iconGlyph}>
      <path d="M3.8 10.5 12 3.8l8.2 6.7" />
      <path d="M6.5 9.5v9.1a1.2 1.2 0 0 0 1.2 1.2h3.8v-5.3a.5.5 0 0 1 .5-.5h0a.5.5 0 0 1 .5.5v5.3h3.8a1.2 1.2 0 0 0 1.2-1.2V9.5" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.iconGlyph}>
      <circle cx="10.5" cy="10.5" r="5.5" />
      <path d="m15.1 15.1 5.1 5.1" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.iconGlyph}>
      <circle cx="12" cy="7.4" r="3.4" />
      <path d="M5 20.2c.7-3.6 3.4-5.7 7-5.7s6.3 2.1 7 5.7" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.iconGlyph}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.8v2.3M12 18.9v2.3M21.2 12h-2.3M5.1 12H2.8M18.5 5.5l-1.6 1.6M7.1 16.9l-1.6 1.6M18.5 18.5l-1.6-1.6M7.1 7.1 5.5 5.5" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={styles.iconGlyph}>
      <path d="M15.9 3.6a8.8 8.8 0 1 0 4.5 15.7 8.1 8.1 0 0 1-4.5-15.7Z" />
    </svg>
  );
}

function renderRailIcon(icon: RailIcon) {
  switch (icon) {
    case "home":
      return <HomeIcon />;
    case "search":
      return <SearchIcon />;
    case "user":
      return <UserIcon />;
    default:
      return null;
  }
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
  const [theme, setTheme] = useState<UiTheme>("dark");
  const [themeToggleBump, setThemeToggleBump] = useState(false);
  const toggleTimerRef = useRef<number | null>(null);

  const selectedOrg = organizations.find((org) => org.id === selectedOrgId) ?? null;
  const clientId = useMemo(() => extractClientId(pathname), [pathname]);
  const railActiveIndex = useMemo(() => {
    const index = railNav.findIndex((item) => isActivePath(pathname, item.href));
    return index < 0 ? 0 : index;
  }, [pathname]);

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
        href: `/dashboard/clients/${clientId}/post-tool`,
        label: "Post Tool",
        detail: "Single post or spawn 3 with QR + TinyURL"
      },
      {
        href: `/dashboard/clients/${clientId}/content`,
        label: "Content Ops",
        detail: "Review drafts, approvals, and schedule queue"
      },
      {
        href: `/dashboard/clients/${clientId}/qna`,
        label: "Q&A Ops",
        detail: "Seed packs and operator validation"
      },
      {
        href: `/dashboard/clients/${clientId}/review-engine`,
        label: "Review Engine",
        detail: "Request/reply automation and queues"
      },
      {
        href: `/dashboard/clients/${clientId}/actions-needed`,
        label: "Actions Needed",
        detail: "Approve or manually complete risky changes"
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

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const savedTheme = window.localStorage.getItem("trd-blitz-theme");
    if (savedTheme === "dark" || savedTheme === "light") {
      setTheme(savedTheme);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("trd-blitz-theme", theme);
  }, [theme]);

  useEffect(() => {
    return () => {
      if (toggleTimerRef.current) {
        window.clearTimeout(toggleTimerRef.current);
      }
    };
  }, []);

  const onToggleTheme = () => {
    if (toggleTimerRef.current) {
      window.clearTimeout(toggleTimerRef.current);
    }
    setThemeToggleBump(true);
    setTheme((current) => (current === "dark" ? "light" : "dark"));
    toggleTimerRef.current = window.setTimeout(() => {
      setThemeToggleBump(false);
      toggleTimerRef.current = null;
    }, 520);
  };

  return (
    <div className={styles.shell} data-theme={theme}>
      <div className={styles.shellNoise} aria-hidden />
      <div className={styles.shellAmbient} aria-hidden />
      <aside className={styles.sidebar}>
        <div className={styles.brand}>
          <h1 className={styles.brandTitle}>TRD Blitz AI</h1>
          <p className={styles.brandSub}>Autonomous GBP Orchestration</p>
        </div>

        <div className={styles.iconRailWrap}>
          <nav className={styles.iconRail} aria-label="Primary navigation">
            <div
              className={styles.iconRailIndicator}
              style={
                {
                  "--active-index": String(railActiveIndex)
                } as CSSProperties
              }
              aria-hidden
            >
              <span className={styles.ringGlow} />
              <span className={styles.ringClip}>
                <span className={styles.ringSpin} />
              </span>
              <span className={styles.ringPlate} />
            </div>

            {railNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-label={item.label}
                title={item.label}
                className={`${styles.iconButton} ${isActivePath(pathname, item.href) ? styles.iconButtonActive : ""}`}
              >
                {renderRailIcon(item.icon)}
              </Link>
            ))}

            <button
              type="button"
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              onClick={onToggleTheme}
              className={`${styles.iconButton} ${styles.themeToggleButton} ${themeToggleBump ? styles.themeToggleBump : ""}`}
            >
              <span className={styles.themeIconSun}>
                <SunIcon />
              </span>
              <span className={styles.themeIconMoon}>
                <MoonIcon />
              </span>
            </button>
          </nav>
        </div>

        <div className={styles.liveStream}>
          <span className={styles.liveDot} />
          <span className={styles.liveText}>Live Worker Stream Online</span>
          <span className={styles.liveBars} aria-hidden>
            <i />
            <i />
            <i />
            <i />
          </span>
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
                  <span className={styles.streamChip}>
                    <span className={styles.streamDot} />
                    Stream synced
                  </span>
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
