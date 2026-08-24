"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { SETTINGS_GROUPS, visibleSettingsRoutes } from "@/lib/nav/routes";
import { useSession } from "@/hooks/use-session";
import { Badge } from "@/components/ui/badge";

/**
 * The settings shell. Configuration and evidence surfaces live here rather
 * than in the sidebar: you come looking for them when something needs
 * changing, not as part of the working day.
 *
 * The nav is filtered by the same RBAC matrix as the sidebar, so a role that
 * cannot reach any of these never sees the entry that leads here.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { role } = useSession();
  const routes = visibleSettingsRoutes(role);

  return (
    <div className="mx-auto flex w-full max-w-[1400px] gap-6 p-5">
      <nav className="w-56 shrink-0" aria-label="Settings">
        <h1 className="px-2 pb-3 text-lg font-semibold tracking-tight">Settings</h1>
        <div className="space-y-4">
          {SETTINGS_GROUPS.map((group) => {
            const items = routes.filter((r) => r.group === group);
            if (items.length === 0) return null;
            return (
              <div key={group}>
                <div className="mb-1 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
                  {group}
                </div>
                <ul className="space-y-0.5">
                  {items.map((r) => {
                    const active = pathname === r.path || pathname.startsWith(`${r.path}/`);
                    return (
                      <li key={r.key}>
                        <Link
                          href={r.path}
                          aria-current={active ? "page" : undefined}
                          className={cn(
                            "group flex items-start gap-2.5 rounded-md px-2 py-1.5 text-sm outline-none transition-colors",
                            "focus-visible:ring-2 focus-visible:ring-ring",
                            active
                              ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                              : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
                          )}
                        >
                          <r.icon className="mt-0.5 size-4 shrink-0" aria-hidden />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center gap-1.5">
                              <span className="truncate">{r.label}</span>
                              {r.status === "next-module" && (
                                <Badge
                                  variant="outline"
                                  className="h-4 rounded px-1 text-[10px] font-normal text-muted-foreground"
                                >
                                  Next
                                </Badge>
                              )}
                            </span>
                            <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground/70">
                              {r.blurb}
                            </span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </nav>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
