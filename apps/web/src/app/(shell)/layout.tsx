"use client";

import { Suspense } from "react";
import { Sidebar } from "@/components/shell/sidebar";
import { SecondarySidebar } from "@/components/shell/secondary-sidebar";
import { TopBar } from "@/components/shell/top-bar";
import { useSidebarState } from "@/hooks/use-sidebar-state";
import { useQueueCounts } from "@/hooks/use-queue-counts";

/**
 * Shell: primary rail, optional section sidebar, then the content column.
 * DOM order matches visual order so keyboard focus walks left to right.
 */
export default function ShellLayout({ children }: { children: React.ReactNode }) {
  const { section, collapsed, pinned, togglePin } = useSidebarState();
  // Only the Orders section carries count badges; everywhere else this is a no-op.
  const counts = useQueueCounts(section?.key === "orders");

  return (
    <div className="flex h-dvh min-w-[1024px] overflow-hidden">
      <Sidebar
        collapsed={collapsed}
        activeSectionKey={section?.key ?? null}
        pinned={pinned}
        onTogglePin={togglePin}
      />
      {section && (
        <Suspense
          fallback={<aside className="w-56 shrink-0 border-r border-sidebar-border bg-sidebar/60" aria-hidden />}
        >
          <SecondarySidebar section={section} counts={counts} />
        </Suspense>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-y-auto" id="main">
          {children}
        </main>
      </div>
    </div>
  );
}
