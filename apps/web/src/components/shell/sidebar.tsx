"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { ROUTE_GROUPS, visibleRoutes, type RouteDef } from "@/lib/nav/routes";
import { useSession } from "@/hooks/use-session";
import { useHydrated, type SidebarPin } from "@/hooks/use-sidebar-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface SidebarProps {
  /** Icon rail (true) or full width (false). */
  collapsed: boolean;
  /** Top-level route whose children the secondary sidebar is showing. */
  activeSectionKey: string | null;
  pinned: SidebarPin;
  onTogglePin: () => void;
}

/**
 * Primary navigation. Collapses to an icon rail when a section with children
 * is active (the secondary sidebar takes over the detail) — see
 * useSidebarState for the auto/pin rules.
 */
export function Sidebar({ collapsed, activeSectionKey, pinned, onTogglePin }: SidebarProps) {
  const pathname = usePathname();
  const { role } = useSession();
  const routes = visibleRoutes(role);
  // Animate width only after hydration: a persisted pin must snap into place, not slide.
  const hydrated = useHydrated();

  const isActive = (r: RouteDef) =>
    r.key === activeSectionKey ||
    pathname === r.path ||
    (r.key === "catalog" && pathname.startsWith("/catalog")) ||
    (r.path !== "/" && r.key !== "catalog" && pathname.startsWith(`${r.path}/`));

  // Exactly one `aria-current="page"` in the DOM: when a section is open the
  // secondary sidebar's child holds it, and the section item is a "location".
  const ariaCurrent = (r: RouteDef): "page" | "location" | undefined => {
    if (!isActive(r)) return undefined;
    return r.key === activeSectionKey ? "location" : "page";
  };

  return (
    <aside
      data-collapsed={collapsed || undefined}
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar",
        hydrated && "transition-[width] duration-200 ease-out",
        collapsed ? "w-14" : "w-60",
      )}
    >
      <div
        className={cn(
          "flex h-14 items-center gap-2.5 border-b border-sidebar-border",
          collapsed ? "justify-center px-0" : "px-4",
        )}
      >
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <span className="text-sm font-semibold">F</span>
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold tracking-tight">Fullkit</div>
            <div className="truncate text-[11px] leading-tight text-muted-foreground">
              Commerce command centre
            </div>
          </div>
        )}
      </div>

      <nav
        className={cn("flex-1 overflow-y-auto py-4", collapsed ? "space-y-2 px-2" : "space-y-4 px-3")}
        aria-label="Primary"
      >
        {ROUTE_GROUPS.map((group, gi) => {
          const items = routes.filter((r) => r.group === group);
          if (items.length === 0) return null;
          return (
            <div key={group}>
              {group !== "Command Centre" &&
                (collapsed ? (
                  gi > 0 && <Separator className="mx-auto mb-2 w-6" />
                ) : (
                  <div className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
                    {group}
                  </div>
                ))}
              <ul className="space-y-0.5">
                {items.map((r) => {
                  const active = isActive(r);
                  const next = r.status === "next-module";
                  const link = (
                    <Link
                      href={r.path}
                      aria-current={ariaCurrent(r)}
                      aria-label={collapsed ? r.label : undefined}
                      className={cn(
                        "group flex items-center rounded-md text-sm outline-none transition-colors",
                        "focus-visible:ring-2 focus-visible:ring-ring",
                        collapsed ? "mx-auto size-9 justify-center" : "gap-2.5 px-2 py-1.5",
                        active
                          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                          : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                      )}
                    >
                      <r.icon className="size-4 shrink-0" aria-hidden />
                      {!collapsed && (
                        <>
                          <span className="flex-1 truncate">{r.label}</span>
                          {next && (
                            <Badge
                              variant="outline"
                              className="h-4 rounded px-1 text-[10px] font-normal text-muted-foreground"
                            >
                              Next
                            </Badge>
                          )}
                        </>
                      )}
                    </Link>
                  );
                  return (
                    <li key={r.key}>
                      {collapsed ? (
                        <Tooltip>
                          <TooltipTrigger asChild>{link}</TooltipTrigger>
                          <TooltipContent side="right">
                            {r.label}
                            {next && " · Next"}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        link
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <div
        className={cn(
          "flex items-center gap-2 border-t border-sidebar-border",
          collapsed ? "justify-center px-0 py-2" : "px-3 py-2",
        )}
      >
        {!collapsed && (
          <p className="min-w-0 flex-1 text-[11px] leading-snug text-muted-foreground">
            Prototype on synthetic data. No live systems are connected.
          </p>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="shrink-0 text-muted-foreground"
              aria-pressed={pinned !== null}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              onClick={onTogglePin}
            >
              {collapsed ? <PanelLeftOpen className="size-4" aria-hidden /> : <PanelLeftClose className="size-4" aria-hidden />}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">
            {collapsed ? "Expand" : "Collapse"}
            {pinned === null ? " (auto by section)" : " (pinned)"}
          </TooltipContent>
        </Tooltip>
      </div>
    </aside>
  );
}
