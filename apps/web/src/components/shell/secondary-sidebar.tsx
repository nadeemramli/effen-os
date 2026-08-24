"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { hrefFor, type ChildRouteDef, type NavSection } from "@/lib/nav/routes";
import { Badge } from "@/components/ui/badge";
import { InlineCount } from "@/components/states";
import type { QueueCounts } from "@/hooks/use-queue-counts";

interface SecondarySidebarProps {
  section: NavSection;
  /** Undefined = no badges at all; a `null` value = still loading. */
  counts?: QueueCounts;
}

/**
 * Section navigation: the children of the active top-level route (or the
 * settings surfaces on /settings/*). Sits between the primary rail and the
 * content column. Reads the query string, so the layout wraps it in Suspense.
 */
export function SecondarySidebar({ section, counts }: SecondarySidebarProps) {
  const pathname = usePathname();
  const params = useSearchParams();

  const queryMatches = (c: ChildRouteDef) =>
    !c.query || Object.entries(c.query).every(([k, v]) => params.get(k) === v);

  // Query keys any sibling uses (?view=, ?segment=) — the default item is only
  // active while none of them is in the URL.
  const siblingQueryKeys = new Set(section.children.flatMap((c) => Object.keys(c.query ?? {})));
  const noSiblingQuery = ![...siblingQueryKeys].some((k) => params.has(k));

  const isActive = (c: ChildRouteDef) => {
    if (c.crossSection) return false;
    if (c.isDefault) return pathname === c.path && (queryMatches(c) && c.query ? true : noSiblingQuery);
    const pathMatch = pathname === c.path || pathname.startsWith(`${c.path}/`);
    return pathMatch && Boolean(c.query ? queryMatches(c) : true);
  };

  const ungrouped = section.children.filter((c) => !c.group);
  const groups = section.groups
    .map((g) => ({ name: g, items: section.children.filter((c) => c.group === g) }))
    .filter((g) => g.items.length > 0);

  const renderItem = (c: ChildRouteDef) => {
    const active = isActive(c);
    const Icon = c.icon;
    return (
      <li key={c.key}>
        <Link
          href={hrefFor(c)}
          aria-current={active ? "page" : undefined}
          className={cn(
            "group flex items-start gap-2.5 rounded-md px-2 py-1.5 text-sm outline-none transition-colors",
            "focus-visible:ring-2 focus-visible:ring-ring",
            active
              ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
              : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
          )}
        >
          {Icon ? (
            <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
          ) : (
            <span className="mt-0.5 size-4 shrink-0" aria-hidden />
          )}
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5">
              <span className="truncate">{c.label}</span>
              {c.status === "next-module" && (
                <Badge
                  variant="outline"
                  className="h-4 rounded px-1 text-[10px] font-normal text-muted-foreground"
                >
                  Next
                </Badge>
              )}
              {c.crossSection && (
                <ArrowUpRight
                  className="size-3 shrink-0 text-muted-foreground/60"
                  aria-label="Opens in another section"
                />
              )}
              {c.badge === "queue-count" && counts !== undefined && (
                <Badge variant="outline" className="tnum ml-auto h-4 px-1 text-[10px] font-normal">
                  <InlineCount value={counts[c.key] ?? null} width="w-4" />
                </Badge>
              )}
            </span>
            {c.blurb && (
              <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground/70">
                {c.blurb}
              </span>
            )}
          </span>
        </Link>
      </li>
    );
  };

  return (
    <aside
      aria-label={`${section.label} navigation`}
      className="flex h-full w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar/60"
    >
      <Link
        href={section.rootPath}
        className="flex h-14 shrink-0 items-center gap-2 border-b border-sidebar-border px-4 text-sm font-semibold tracking-tight outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <section.icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="truncate">{section.label}</span>
      </Link>

      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4">
        {ungrouped.length > 0 && <ul className="space-y-0.5">{ungrouped.map(renderItem)}</ul>}
        {groups.map((g) => (
          <div key={g.name}>
            <div className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
              {g.name}
            </div>
            <ul className="space-y-0.5">{g.items.map(renderItem)}</ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
