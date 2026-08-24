"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Bell,
  Building2,
  CalendarRange,
  ChevronDown,
  KeyRound,
  LogOut,
  Moon,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
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
import { fetchLiveBrands, fetchWooConnections, type LiveBrand } from "@/lib/supabase/live";
import { ModePill } from "./mode-pill";
import { GlobalSearch } from "./global-search";
import { ChangePasswordDialog } from "@/components/auth/change-password-dialog";
import { canSeeSettings, visibleRoutes } from "@/lib/nav/routes";

export function TopBar() {
  const router = useRouter();
  const { theme, setTheme } = useTheme();
  const [searchOpen, setSearchOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);

  const session = useAppStore((s) => s.session);
  const brands = useAppStore((s) => s.brands);
  const workspace = useAppStore((s) => s.workspace);
  const integrations = useAppStore((s) => s.integrations);
  const notifications = useAppStore((s) => s.notifications);
  const setBrand = useAppStore((s) => s.setBrand);
  const setLiveBrand = useAppStore((s) => s.setLiveBrand);
  const setLiveMarkets = useAppStore((s) => s.setLiveMarkets);
  const setDateRange = useAppStore((s) => s.setDateRange);
  const setRole = useAppStore((s) => s.setRole);
  const markRead = useAppStore((s) => s.markNotificationsRead);
  const resetDemoData = useAppStore((s) => s.resetDemoData);
  const persona = useActivePersona();

  // Live scope: with a real session the brand switcher and freshness badge
  // read the live workspace, not the synthetic seed.
  const isLive = session.authEmail !== null;
  const [liveBrands, setLiveBrands] = useState<LiveBrand[]>([]);
  // "checking" until the connections fetch resolves; "unknown" if it fails —
  // the pill must never claim "All fresh" before it has actually checked.
  const [liveStale, setLiveStale] = useState<number | "checking" | "unknown">("checking");
  const [liveMarketOptions, setLiveMarketOptions] = useState<string[]>([]);
  useEffect(() => {
    if (!isLive) return;
    void (async () => {
      try {
        const [b, c] = await Promise.all([fetchLiveBrands(), fetchWooConnections()]);
        setLiveBrands(b.filter((x) => x.status === "active"));
        // A configured connection is stale when its last success is older than
        // 3× its freshness SLA (matching freshnessOf's "stale" band).
        setLiveMarketOptions(
          [...new Set(c.map((x) => x.config?.country_code).filter((m): m is string => !!m))].sort(),
        );
        const configured = c.filter((x) => x.status !== "pending_setup");
        setLiveStale(
          configured.filter(
            (x) =>
              !x.last_success_at ||
              Date.now() - new Date(x.last_success_at).getTime() > 3 * 15 * 60_000,
          ).length,
        );
      } catch {
        setLiveStale("unknown");
      }
    })();
  }, [isLive]);

  const staleCount: number | "checking" | "unknown" = isLive
    ? liveStale
    : integrations.filter((i) => i.status === "stale").length;
  const unread = isLive ? 0 : notifications.filter((n) => !n.read).length;
  const canCreateOrder = visibleRoutes(session.role).some((r) => r.key === "orders");

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b bg-background px-4">
      {/* workspace + brand scope */}
      <div className="flex min-w-0 items-center gap-2">
        <Building2 className="hidden size-4 shrink-0 text-muted-foreground lg:block" aria-hidden />
        <span className="hidden max-w-44 truncate text-sm font-medium 2xl:inline">
          {workspace.name}
        </span>
        {isLive ? (
          <Select
            value={session.liveBrandId === null ? "all" : String(session.liveBrandId)}
            onValueChange={(v) => setLiveBrand(v === "all" ? null : Number(v))}
          >
            <SelectTrigger className="h-8 w-36 text-sm xl:w-44" aria-label="Brand scope (live)">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All brands</SelectItem>
              {liveBrands.map((b) => (
                <SelectItem key={b.id} value={String(b.id)}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {isLive ? (
          /* market checklist — view all countries or any combination */
          <DropdownMenu>
            <DropdownMenuTrigger
              className="inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Market scope"
            >
              {session.liveMarkets.length === 0 || session.liveMarkets.length === liveMarketOptions.length
                ? "All markets"
                : session.liveMarkets.join(" + ")}
              <ChevronDown className="size-3 opacity-60" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              <DropdownMenuLabel>Markets</DropdownMenuLabel>
              {liveMarketOptions.map((m) => {
                const checked = session.liveMarkets.length === 0 || session.liveMarkets.includes(m);
                return (
                  <DropdownMenuCheckboxItem
                    key={m}
                    checked={checked}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={(next) => {
                      const current =
                        session.liveMarkets.length === 0 ? [...liveMarketOptions] : [...session.liveMarkets];
                      const updated = next ? [...new Set([...current, m])] : current.filter((x) => x !== m);
                      // Everything checked (or nothing left) collapses back to "all".
                      setLiveMarkets(
                        updated.length === 0 || updated.length === liveMarketOptions.length ? [] : updated,
                      );
                    }}
                  >
                    {m === "MY" ? "Malaysia (MY)" : m === "SG" ? "Singapore (SG)" : m}
                  </DropdownMenuCheckboxItem>
                );
              })}
              <DropdownMenuSeparator />
              <p className="px-2 pb-1.5 text-xs text-muted-foreground">
                Store market for orders and spend; billing country for customers.
              </p>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
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
        )}
      </div>

      {/* date range: quick presets + custom picker */}
      <div className="flex shrink-0 items-center gap-1.5">
        <CalendarRange className="hidden size-4 text-muted-foreground lg:block" aria-hidden />
        <ToggleGroup
          type="single"
          value={session.dateRange}
          onValueChange={(v) => v && v !== "custom" && setDateRange(v as typeof session.dateRange)}
          className="h-8"
          aria-label="Date range"
        >
          <ToggleGroupItem value="today" className="h-8 px-2 text-xs">
            Today
          </ToggleGroupItem>
          <ToggleGroupItem value="7d" className="h-8 px-2 text-xs">
            7d
          </ToggleGroupItem>
          <ToggleGroupItem value="30d" className="h-8 px-2 text-xs">
            30d
          </ToggleGroupItem>
          <ToggleGroupItem value="90d" className="hidden h-8 px-2 text-xs sm:flex">
            90d
          </ToggleGroupItem>
          <ToggleGroupItem value="1y" className="hidden h-8 px-2 text-xs sm:flex">
            1y
          </ToggleGroupItem>
        </ToggleGroup>
        <CustomRangePopover />
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
          href={isLive ? "/settings/setup/connections" : "/settings/data-health"}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
            typeof staleCount !== "number"
              ? "border-border bg-muted/40 text-muted-foreground"
              : staleCount > 0
                ? "border-warning/30 bg-warning/12 text-warning"
                : "border-success/25 bg-success/12 text-success",
          )}
          aria-label={
            typeof staleCount !== "number"
              ? "Data freshness: checking"
              : `Data freshness: ${staleCount} stale sources`
          }
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              typeof staleCount !== "number"
                ? "bg-muted-foreground/50"
                : staleCount > 0
                  ? "bg-warning"
                  : "bg-success",
            )}
            aria-hidden
          />
          {staleCount === "checking"
            ? "Checking…"
            : staleCount === "unknown"
              ? "Freshness unknown"
              : staleCount > 0
                ? `${staleCount} stale`
                : "All fresh"}
        </Link>

        {isLive ? (
          <span
            className="inline-flex h-7 items-center gap-1.5 rounded-full border border-info/30 bg-info/12 px-2.5 text-xs font-medium text-info"
            title="Reads mirror the connected live sources (WooCommerce, Meta, WhatsApp, Ninja Van). Writes to external systems are not enabled yet."
          >
            <span className="size-1.5 rounded-full bg-info" aria-hidden />
            Live · read-only
          </span>
        ) : (
          <ModePill />
        )}

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
            {/* Ad accounts are connected in Airbyte (one OAuth source per
                account), not in Fullkit — the pipeline ingests and the
                register mirrors the source list. */}
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
            {isLive ? (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                No live notifications yet — alerting arrives with the work-item layer.
                Sync health lives on Setup → Store connections.
              </p>
            ) : (
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
            )}
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
            {session.authEmail && (
              <>
                <DropdownMenuLabel>
                  Signed in
                  <span className="block truncate text-xs font-normal text-muted-foreground">
                    {session.authEmail} · {ROLE_LABELS[session.role]}
                  </span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
              </>
            )}
            {!session.roleLocked ? (
              <>
                <DropdownMenuLabel className="flex items-center justify-between">
                  {session.authEmail ? "Impersonate role" : "Demo role switcher"}
                  <Badge variant="outline" className="text-[10px] font-normal text-ai border-ai/30">
                    {session.authEmail ? "HQ admin tool" : "prototype only"}
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
              </>
            ) : (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">
                Your role is set by your workspace membership.
              </p>
            )}
            <DropdownMenuSeparator />
            {canSeeSettings(session.role) && (
              <DropdownMenuItem onSelect={() => router.push("/settings")}>
                <Settings className="size-4" />
                Settings
              </DropdownMenuItem>
            )}
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
            {session.authEmail && (
              <>
                <DropdownMenuItem onSelect={() => setPwOpen(true)}>
                  <KeyRound className="size-4" />
                  Change password
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    void import("@/lib/supabase/client").then(({ getSupabase }) =>
                      getSupabase().auth.signOut(),
                    );
                  }}
                >
                  <LogOut className="size-4" />
                  Sign out
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <ChangePasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
    </header>
  );
}

/**
 * Custom date-range picker: two date inputs applied as an inclusive range.
 * Chip shows the active range when dateRange === "custom"; presets in the
 * toggle group clear it implicitly.
 */
function CustomRangePopover() {
  const session = useAppStore((s) => s.session);
  const setCustomRange = useAppStore((s) => s.setCustomRange);
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(session.customRange?.from ?? "");
  const [to, setTo] = useState(session.customRange?.to ?? "");
  const active = session.dateRange === "custom" && session.customRange !== null;
  const valid = from !== "" && to !== "" && from <= to;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={
          active
            ? "tnum inline-flex h-8 items-center rounded-md border border-info/40 bg-info/10 px-2 text-xs text-info"
            : "inline-flex h-8 items-center rounded-md border px-2 text-xs text-muted-foreground hover:bg-accent/40"
        }
        aria-label="Custom date range"
      >
        {active ? `${session.customRange!.from} → ${session.customRange!.to}` : "Custom"}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 space-y-3">
        <p className="text-xs font-medium">Custom range (inclusive, MYT)</p>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <label htmlFor="range-from" className="text-[11px] text-muted-foreground">From</label>
            <input
              id="range-from"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              className="h-8 w-full rounded-md border bg-background px-2 text-xs"
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="range-to" className="text-[11px] text-muted-foreground">To</label>
            <input
              id="range-to"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              className="h-8 w-full rounded-md border bg-background px-2 text-xs"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!valid}
            onClick={() => {
              setCustomRange({ from, to });
              setOpen(false);
            }}
          >
            Apply
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Ranges over 400 days are capped by the data layer; demo surfaces approximate custom ranges by span.
        </p>
      </PopoverContent>
    </Popover>
  );
}
