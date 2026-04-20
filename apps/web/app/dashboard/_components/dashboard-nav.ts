"use client";

import type { LucideIcon } from "lucide-react";
import {
  BellRing,
  Bot,
  Boxes,
  ClipboardList,
  LayoutDashboard,
  MessageCircleQuestion,
  MessagesSquare,
  PenSquare,
  Settings2,
  ShieldAlert,
  Sparkles,
  Star,
  Workflow
} from "lucide-react";

export interface DashboardNavItem {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

export const platformNav: DashboardNavItem[] = [
  {
    href: "/dashboard",
    label: "Overview",
    description: "Platform health, rollout status, and workspace entry points.",
    icon: LayoutDashboard
  },
  {
    href: "/dashboard/clients",
    label: "Client Workspaces",
    description: "All managed clients, integrations, and workspace access.",
    icon: Boxes
  },
  {
    href: "/dashboard/blitz",
    label: "Blitz Runs",
    description: "Global run queue, worker state, and launch controls.",
    icon: Sparkles
  },
  {
    href: "/dashboard/incidents",
    label: "Incident Meets",
    description: "Launch code red, yellow, and green Google Meet bridges for the team.",
    icon: BellRing
  }
];

export function getClientWorkspaceNav(clientId: string): DashboardNavItem[] {
  return [
    {
      href: `/dashboard/clients/${clientId}`,
      label: "Workspace Overview",
      description: "Run status, integrations, attribution, and operating summary.",
      icon: LayoutDashboard
    },
    {
      href: `/dashboard/clients/${clientId}/apify`,
      label: "Apify SEO",
      description: "AI brand rankings, AI SEO scans, and local listing intel.",
      icon: Bot
    },
    {
      href: `/dashboard/clients/${clientId}/blitz`,
      label: "Blitz Worker",
      description: "Launch, inspect, and rollback client-specific blitz runs.",
      icon: Workflow
    },
    {
      href: `/dashboard/clients/${clientId}/content`,
      label: "Content Ops",
      description: "Draft content artifacts and schedule decisions.",
      icon: PenSquare
    },
    {
      href: `/dashboard/clients/${clientId}/post-tool`,
      label: "Post Tool",
      description: "Queue one-off GBP posts and force dispatch readiness.",
      icon: MessagesSquare
    },
    {
      href: `/dashboard/clients/${clientId}/qna`,
      label: "Q&A Ops",
      description: "Question packs, approvals, and artifact control.",
      icon: MessageCircleQuestion
    },
    {
      href: `/dashboard/clients/${clientId}/review-engine`,
      label: "Review Engine",
      description: "Review request and reply automation controls.",
      icon: Star
    },
    {
      href: `/dashboard/clients/${clientId}/actions-needed`,
      label: "Actions Needed",
      description: "High-risk work requiring manual operator approval.",
      icon: ShieldAlert
    },
    {
      href: `/dashboard/clients/${clientId}/reviews`,
      label: "Reviews",
      description: "Live review feed and generated response history.",
      icon: ClipboardList
    },
    {
      href: `/dashboard/clients/${clientId}/settings`,
      label: "Orchestration",
      description: "Tone, assets, connectors, and system preferences.",
      icon: Settings2
    }
  ];
}

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/dashboard") {
    return pathname === href;
  }

  return pathname === href || pathname.startsWith(`${href}/`);
}

export function extractClientId(pathname: string): string | null {
  const match = pathname.match(/^\/dashboard\/clients\/([^/]+)/);
  return match?.[1] ?? null;
}

export function getActiveDashboardItem(pathname: string): DashboardNavItem | null {
  const clientId = extractClientId(pathname);
  const items = clientId ? [...platformNav, ...getClientWorkspaceNav(clientId)] : platformNav;
  const matches = items.filter((item) => isActivePath(pathname, item.href));

  if (!matches.length) {
    return null;
  }

  return matches.sort((left, right) => right.href.length - left.href.length)[0];
}
