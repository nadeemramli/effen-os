"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  Bell,
  Building2,
  CalendarRange,
  ChevronDown,
  Moon,
  Plus,
  RotateCcw,
  Search,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { RoleKey } from "@/lib/domain/enums";
import { ROLE_LABELS } from "@/lib/rbac/matrix";
import { useAppStore } from "@/lib/store/provider";
import { useActivePersona } from "@/hooks/use-session";
import { formatRelative } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";
import { ModePill } from "./mode-pill";
import { GlobalSearch } from "./global-search";
import { visibleRoutes } from "@/lib/nav/routes";

export function TopBar() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [searchOpen, setSearchOpen] = useState(false);

  const session = useAppStore((s) => s.session);
  const brands = useAppStore((s) => s.brands);
  const workspace = useAppStore((s) => s.workspace);
  const integrations = useAppStore((s) => s.integrations);
  const notifications = useAppStore((s) => s.notifications);
  const setBrand = useAppStore((s) => s.setBrand);
  const setDateRange = useAppStore((s) => s.setDateRange);
  const setRole = useAppStore((s) => s.setRole);
  const markRead = useAppStore((s) => s.markNotificationsRead);
  const resetDemoData = useAppStore((s) => s.resetDemoData);
  const persona = useActivePersona();

  const staleCount = integrations.filter((i) => i.status === "stale").length;
  const unread = notifications.filter((n) => !n.read).length;
  const canCreateOrder = visibleRoutes(session.role).some((r) => r.key === "orders");
  const canConnectAds = visibleRoutes(session.role).some((r) => r.key === "marketing");

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4">
      {/* workspace + brand scope */}
      <div className="flex min-w-0 items-center gap-2">
        <Building2 className="hidden size-4 shrink-0 text-muted-foreground lg:block" aria-hidden />
        <span className="hidden max-w-44 truncate text-sm font-medium 2xl:inline">
          {workspace.name}
        </span>
        <Select value={session.brandId} onValueChange={setBrand}>
          <SelectTrigger className="h-8 w-36 text-sm xl:w-44" aria-label="Brand scope">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All brands</SelectItem>
            {brands.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* date range */}
      <div className="flex shrink-0 items-center gap-1.5">
        <CalendarRange className="hidden size-4 text-muted-foreground lg:block" aria-hidden />
        <ToggleGroup
          type="single"
          value={session.dateRange}
          onValueChange={(v) => v && setDateRange(v as typeof session.dateRange)}
          className="h-8"
          aria-label="Date range"
        >
          <ToggleGroupItem value="today" className="h-8 px-2.5 text-xs">
            Today
          </ToggleGroupItem>
          <ToggleGroupItem value="7d" className="h-8 px-2.5 text-xs">
            7d
          </ToggleGroupItem>
          <ToggleGroupItem value="30d" className="h-8 px-2.5 text-xs">
            30d
          </ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* search */}
      <Button
        variant="outline"
        size="sm"
        className="h-8 min-w-0 flex-1 max-w-xs justify-start gap-2 text-muted-foreground"
        onClick={() => setSearchOpen(true)}
      >
        <Search className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate text-xs">
          <span className="hidden xl:inline">Order, phone, SKU, campaign, integration…</span>
          <span className="xl:hidden">Search…</span>
        </span>
        <kbd className="ml-auto hidden rounded border bg-muted px-1 text-[10px] xl:inline">⌘K</kbd>
      </Button>
      <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />

      <div className="ml-auto flex shrink-0 items-center gap-2">
        {/* freshness */}
        <Link
          href="/data-health"
          className={cn(
            "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
            staleCount > 0
              ? "border-warning/30 bg-warning/12 text-warning"
              : "border-success/25 bg-success/12 text-success",
          )}
          aria-label={`Data freshness: ${staleCount} stale sources`}
        >
          <span
            className={cn("size-1.5 rounded-full", staleCount > 0 ? "bg-warning" : "bg-success")}
            aria-hidden
          />
          {staleCount > 0 ? `${staleCount} stale` : "All fresh"}
        </Link>

        <ModePill />

        {/* create */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="h-8 gap-1.5">
              <Plus className="size-3.5" aria-hidden />
              Create
              <ChevronDown className="size-3 opacity-60" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {canCreateOrder ? (
              <DropdownMenuItem onSelect={() => router.push("/orders/new")}>
                New order
                <span className="ml-auto text-xs text-muted-foreground">draft first</span>
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem disabled>
                New order — needs Sales/CS or Operations role
              </DropdownMenuItem>
            )}
            {canConnectAds ? (
              <DropdownMenuItem onSelect={() => router.push("/marketing/accounts/new")}>
                Connect ad account
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem disabled>
                Connect ad account — needs Marketing role
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        {/* notifications */}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="icon" className="relative size-8" aria-label={`Notifications (${unread} unread)`}>
              <Bell className="size-4" aria-hidden />
              {unread > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-destructive-foreground">
                  {unread}
                </span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-96 p-0">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="text-sm font-medium">Notifications</span>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={markRead}>
                Mark all read
              </Button>
            </div>
            <ul className="max-h-96 overflow-y-auto">
              {notifications.map((n) => (
                <li key={n.id} className="border-b last:border-0">
                  <button
                    type="button"
                    className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left hover:bg-accent"
                    onClick={() => {
                      if (n.href) router.push(n.href);
                    }}
                  >
                    <span
                      className={cn(
                        "mt-1.5 size-1.5 shrink-0 rounded-full",
                        n.severity === "critical"
                          ? "bg-destructive"
                          : n.severity === "high"
                            ? "bg-warning"
                            : n.read
                              ? "bg-muted-foreground/40"
                              : "bg-info",
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block text-sm", !n.read && "font-medium")}>{n.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">{n.detail}</span>
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {formatRelative(n.at)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>

        {/* user / role */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="h-8 gap-2 px-1.5">
              <span className="flex size-6 items-center justify-center rounded-full bg-secondary text-[11px] font-semibold">
                {persona.initials}
              </span>
              <span className="hidden text-left leading-tight xl:block">
                <span className="block text-xs font-medium">{persona.name}</span>
                <span className="block text-[10px] text-muted-foreground">
                  {ROLE_LABELS[session.role]}
                </span>
              </span>
              <ChevronDown className="size-3 opacity-60" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="flex items-center justify-between">
              Demo role switcher
              <Badge variant="outline" className="text-[10px] font-normal text-ai border-ai/30">
                prototype only
              </Badge>
            </DropdownMenuLabel>
            <p className="px-2 pb-1.5 text-xs text-muted-foreground">
              Switch roles to see least-privilege navigation, fields, and actions.
            </p>
            <DropdownMenuRadioGroup
              value={session.role}
              onValueChange={(v) => {
                setRole(v as RoleKey);
                toast.info(`Viewing as ${ROLE_LABELS[v as RoleKey]}`);
              }}
            >
              {(Object.keys(ROLE_LABELS) as RoleKey[]).map((r) => (
                <DropdownMenuRadioItem key={r} value={r}>
                  {ROLE_LABELS[r]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setTheme(theme === "dark" ? "light" : "dark")}>
              {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                resetDemoData();
                toast.success("Demo data reset to the seeded state");
              }}
            >
              <RotateCcw className="size-4" />
              Reset demo data
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
