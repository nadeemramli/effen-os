"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { ROUTE_GROUPS, visibleRoutes } from "@/lib/nav/routes";
import { useSession } from "@/hooks/use-session";
import { Badge } from "@/components/ui/badge";

export function Sidebar() {
  const pathname = usePathname();
  const { role } = useSession();
  const routes = visibleRoutes(role);

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-4">
        <div className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <span className="text-sm font-semibold">F</span>
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold tracking-tight">Fullkit</div>
          <div className="truncate text-[11px] leading-tight text-muted-foreground">
            Commerce command centre
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-4 overflow-y-auto px-3 py-4" aria-label="Primary">
        {ROUTE_GROUPS.map((group) => {
          const items = routes.filter((r) => r.group === group);
          if (items.length === 0) return null;
          return (
            <div key={group}>
              {group !== "Command Centre" && (
                <div className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
                  {group}
                </div>
              )}
              <ul className="space-y-0.5">
                {items.map((r) => {
                  const active =
                    pathname === r.path ||
                    (r.key === "catalog" && pathname.startsWith("/catalog")) ||
                    (r.path !== "/" && r.key !== "catalog" && pathname.startsWith(`${r.path}/`));
                  return (
                    <li key={r.key}>
                      <Link
                        href={r.path}
                        aria-current={active ? "page" : undefined}
                        className={cn(
                          "group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm outline-none transition-colors",
                          "focus-visible:ring-2 focus-visible:ring-ring",
                          active
                            ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                            : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                        )}
                      >
                        <r.icon className="size-4 shrink-0" aria-hidden />
                        <span className="flex-1 truncate">{r.label}</span>
                        {r.status === "next-module" && (
                          <Badge
                            variant="outline"
                            className="h-4 rounded px-1 text-[10px] font-normal text-muted-foreground"
                          >
                            Next
                          </Badge>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-sidebar-border px-4 py-3">
        <p className="text-[11px] leading-snug text-muted-foreground">
          Prototype on synthetic data. No live systems are connected.
        </p>
      </div>
    </aside>
  );
}
