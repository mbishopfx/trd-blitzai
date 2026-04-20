"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { getClientWorkspaceNav, isActivePath } from "./dashboard-nav";
import { useDashboardContext } from "./dashboard-context";

interface ClientTabsProps {
  clientId: string;
}

export function ClientTabs({ clientId }: ClientTabsProps) {
  const pathname = usePathname();
  const { request } = useDashboardContext();
  const tabs = getClientWorkspaceNav(clientId);
  const [pendingReviewReplyCount, setPendingReviewReplyCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void request<{ pendingReviewReplyCount: number }>(`/api/v1/clients/${clientId}/workspace-alerts`)
      .then((payload) => {
        if (!cancelled) {
          setPendingReviewReplyCount(payload.pendingReviewReplyCount ?? 0);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPendingReviewReplyCount(0);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [clientId, request]);

  return (
    <div className="rounded-xl border border-border/80 bg-card/95 shadow-sm">
      <ScrollArea className="w-full whitespace-nowrap">
        <nav aria-label="Client workspace navigation" className="flex gap-2 p-2">
          {tabs.map((tab) => (
            <Button
              key={tab.href}
              render={<Link href={tab.href} />}
              variant={isActivePath(pathname, tab.href) ? "secondary" : "ghost"}
              size="sm"
              className="justify-start"
            >
              <tab.icon data-icon="inline-start" />
              {tab.label}
              {tab.href.endsWith("/actions-needed") && pendingReviewReplyCount > 0 ? (
                <Badge variant="destructive" className="ml-1 min-w-6 justify-center px-1.5 text-[10px]">
                  {pendingReviewReplyCount}
                </Badge>
              ) : null}
            </Button>
          ))}
        </nav>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}
