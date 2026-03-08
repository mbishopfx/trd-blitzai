"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./dashboard.module.css";

interface ClientTabsProps {
  clientId: string;
}

const tabs = [
  { key: "overview", label: "Overview", href: (id: string) => `/dashboard/clients/${id}` },
  { key: "blitz", label: "Blitz Worker", href: (id: string) => `/dashboard/clients/${id}/blitz` },
  { key: "content", label: "Content Ops", href: (id: string) => `/dashboard/clients/${id}/content` },
  { key: "post-tool", label: "Post Tool", href: (id: string) => `/dashboard/clients/${id}/post-tool` },
  { key: "qna", label: "Q&A Ops", href: (id: string) => `/dashboard/clients/${id}/qna` },
  { key: "review-engine", label: "Review Engine", href: (id: string) => `/dashboard/clients/${id}/review-engine` },
  { key: "actions-needed", label: "Actions Needed", href: (id: string) => `/dashboard/clients/${id}/actions-needed` },
  { key: "reviews", label: "Reviews", href: (id: string) => `/dashboard/clients/${id}/reviews` },
  { key: "settings", label: "Orchestration", href: (id: string) => `/dashboard/clients/${id}/settings` }
] as const;

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ClientTabs({ clientId }: ClientTabsProps) {
  const pathname = usePathname();

  return (
    <nav className={styles.tabs} aria-label="Client tabs">
      {tabs.map((tab) => {
        const href = tab.href(clientId);
        return (
          <Link key={tab.key} href={href} className={`${styles.tabLink} ${isActive(pathname, href) ? styles.tabLinkActive : ""}`}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
