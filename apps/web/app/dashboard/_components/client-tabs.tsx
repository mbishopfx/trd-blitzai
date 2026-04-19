"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { getClientWorkspaceNav, isActivePath } from "./dashboard-nav";

interface ClientTabsProps {
  clientId: string;
}

export function ClientTabs({ clientId }: ClientTabsProps) {
  const pathname = usePathname();
  const tabs = getClientWorkspaceNav(clientId);

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
            </Button>
          ))}
        </nav>
        <ScrollBar orientation="horizontal" />
      </ScrollArea>
    </div>
  );
}
