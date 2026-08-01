"use client";

import { useRouter } from "next/navigation";
import { parseAsInteger, parseAsString, useQueryState } from "nuqs";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable } from "@/components/tables/data-table";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { LiveGuard } from "@/components/auth/live-guard";
import {
  fetchLiveBrands,
  fetchLiveCustomers,
  type LiveBrand,
  type LiveCustomerRow,
} from "@/lib/supabase/live";
import { maskPhone } from "@/lib/utils/mask";
import { useAppStore } from "@/lib/store/provider";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

function repeatState(orders: number): string {
  return orders >= 5 ? "loyal" : orders > 1 ? "repeat" : "first-time";
}

function lifecycleOf(last: string | null): { label: string; cls?: string } {
  if (!last) return { label: "—" };
  const days = (Date.now() - new Date(last).getTime()) / 86_400_000;
  if (days <= 30) return { label: "active" };
  if (days <= 90) return { label: "at risk", cls: "text-warning" };
  return { label: "dormant", cls: "text-muted-foreground" };
}

function revenueLine(byCcy: Record<string, number> | null): string {
  if (!byCcy) return "—";
  const parts = Object.entries(byCcy)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([c, v]) => `${c === "MYR" ? "RM" : c === "SGD" ? "S$" : c} ${Number(v) >= 10_000 ? `${(Number(v) / 1000).toFixed(1)}k` : Number(v).toFixed(0)}`);
  return parts.join(" + ") || "—";
}

function relative(iso: string | null): string {
  if (!iso) return "never";
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.round(days / 30)}mo ago`;
  return `${(days / 365).toFixed(1)}y ago`;
}

function CustomersInner() {
  const router = useRouter();
  const [q, setQ] = useQueryState("q", parseAsString.withDefault(""));
  // Brand + market scope come from the top bar's live controls, like every live surface.
  const liveBrandId = useAppStore((s) => s.session.liveBrandId);
  const liveMarkets = useAppStore((s) => s.session.liveMarkets);
  const [lifecycle, setLifecycle] = useQueryState("lifecycle", parseAsString.withDefault("any"));
  const [repeat, setRepeat] = useQueryState("repeat", parseAsString.withDefault("any"));
  const [tier, setTier] = useQueryState("tier", parseAsString.withDefault("any"));
  const [consent, setConsent] = useQueryState("consent", parseAsString.withDefault("any"));
  const [risk, setRisk] = useQueryState("risk", parseAsString.withDefault("any"));
  const [page, setPage] = useQueryState("page", parseAsInteger.withDefault(1));

  const [brands, setBrands] = useState<LiveBrand[]>([]);
  const [rows, setRows] = useState<LiveCustomerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState(q);

  const brandById = useMemo(() => new Map(brands.map((b) => [b.id, b])), [brands]);

  useEffect(() => {
    void fetchLiveBrands().then((b) =>
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBrands(b.filter((x) => x.status === "active")),
    );
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchLiveCustomers({
        page,
        pageSize: PAGE_SIZE,
        search: q,
        brandId: liveBrandId,
        activity: lifecycle === "any" ? null : lifecycle,
        countries: liveMarkets,
        repeat: repeat === "any" ? null : repeat,
        tier: tier === "any" ? null : tier,
      });
      setRows(result.rows);
      setTotal(result.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page, q, liveBrandId, liveMarkets, lifecycle, repeat, tier]);

  useEffect(() => {
    // Server-side query re-runs on any filter/page change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtersActive = q !== "" || lifecycle !== "any" || repeat !== "any" || tier !== "any" || consent !== "any" || risk !== "any";

  const columns = useMemo<ColumnDef<LiveCustomerRow, unknown>[]>(
    () => [
      {
        id: "name",
        header: "Customer",
        enableSorting: false,
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.display_name ?? "Unknown"}</div>
            <div className="tnum text-[11px] text-muted-foreground">
              {row.original.phone ? maskPhone(row.original.phone, false) : row.original.email ?? "—"}
            </div>
          </div>
        ),
      },
      {
        id: "location",
        header: "Location",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {[row.original.city, row.original.country].filter(Boolean).join(", ") || "—"}
          </span>
        ),
      },
      {
        id: "brands",
        header: "Brands",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {(row.original.brand_ids ?? []).map((id) => brandById.get(id)?.name ?? id).join(", ") || "—"}
          </span>
        ),
      },
      {
        id: "lifecycle",
        header: "Lifecycle",
        enableSorting: false,
        cell: ({ row }) => {
          const lc = lifecycleOf(row.original.last_order_at);
          return <span className={cn("capitalize", lc.cls)}>{lc.label}</span>;
        },
      },
      {
        id: "repeat",
        header: "Repeat",
        enableSorting: false,
        cell: ({ row }) => <span className="capitalize">{repeatState(Number(row.original.total_orders))}</span>,
      },
      {
        id: "orders",
        header: "Orders",
        enableSorting: false,
        cell: ({ row }) => <span className="tnum">{row.original.total_orders}</span>,
      },
      {
        id: "revenue",
        header: "Recognized revenue",
        enableSorting: false,
        cell: ({ row }) => <span className="tnum">{revenueLine(row.original.revenue_by_currency)}</span>,
      },
      {
        id: "tier",
        header: "Tier",
        enableSorting: false,
        cell: ({ row }) => {
          const total = Object.values(row.original.revenue_by_currency ?? {}).reduce((s, v) => s + Number(v), 0);
          const tier = total >= 3000 ? "vip" : total >= 1000 ? "high" : total >= 300 ? "mid" : "low";
          return <span className="text-xs uppercase">{tier}</span>;
        },
      },
      {
        id: "last",
        header: "Last order",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="tnum text-muted-foreground">{relative(row.original.last_order_at)}</span>
        ),
      },
      {
        id: "risk",
        header: "Risk",
        enableSorting: false,
        cell: () => <span className="text-[11px] text-muted-foreground">—</span>,
      },
    ],
    [brandById],
  );

  return (
    <PageBody className="max-w-none">
      <PageHeader
        title="Customers"
        description={`Live mirror · ${total.toLocaleString()} identities resolved from order history (phone-first, e-mail fallback) · contact details masked by default`}
      />

      <div className="flex flex-wrap items-center gap-2">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void setQ(searchDraft || null);
            void setPage(null);
          }}
        >
          <Input
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Search name, phone, email…"
            className="h-8 w-64 text-sm"
            aria-label="Search customers"
          />
        </form>
        <Select value={lifecycle} onValueChange={(v) => { void setLifecycle(v === "any" ? null : v); void setPage(null); }}>
          <SelectTrigger className="h-8 w-36 text-xs" aria-label="Lifecycle"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any lifecycle</SelectItem>
            {["new", "active", "at_risk", "dormant", "provisional"].map((s) => (
              <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={repeat} onValueChange={(v) => { void setRepeat(v === "any" ? null : v); void setPage(null); }}>
          <SelectTrigger className="h-8 w-32 text-xs" aria-label="Repeat state"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any repeat</SelectItem>
            <SelectItem value="first_time">First-time</SelectItem>
            <SelectItem value="repeat">Repeat</SelectItem>
            <SelectItem value="loyal">Loyal</SelectItem>
          </SelectContent>
        </Select>
        <Select value={tier} onValueChange={(v) => { void setTier(v === "any" ? null : v); void setPage(null); }}>
          <SelectTrigger className="h-8 w-28 text-xs" aria-label="Value tier"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any tier</SelectItem>
            {["vip", "high", "mid", "low"].map((t) => (
              <SelectItem key={t} value={t}>{t.toUpperCase()}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={consent} onValueChange={(v) => { void setConsent(v === "any" ? null : v); }}>
          <SelectTrigger className="h-8 w-44 text-xs" aria-label="Marketing consent"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any WA consent</SelectItem>
            <SelectItem value="granted" disabled>WA marketing granted — source pending</SelectItem>
            <SelectItem value="revoked" disabled>WA marketing revoked — source pending</SelectItem>
          </SelectContent>
        </Select>
        <Select value={risk} onValueChange={(v) => { void setRisk(v === "any" ? null : v); }}>
          <SelectTrigger className="h-8 w-32 text-xs" aria-label="Risk"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any risk</SelectItem>
            <SelectItem value="service" disabled>Service risk — source pending</SelectItem>
            <SelectItem value="cod" disabled>COD risk — source pending</SelectItem>
          </SelectContent>
        </Select>
        {filtersActive && (
          <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs text-muted-foreground"
            onClick={() => { setSearchDraft(""); void setQ(null); void setLifecycle(null); void setRepeat(null); void setTier(null); void setConsent(null); void setRisk(null); void setPage(null); }}>
            <X className="size-3" aria-hidden /> Clear
          </Button>
        )}
      </div>

      {loading && rows.length === 0 ? (
        <div className="flex justify-center py-12"><Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading customers" /></div>
      ) : error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Could not load the customer read-model: {error}
        </div>
      ) : (
        <>
          <div className={cn(loading && "pointer-events-none opacity-60")}>
            <DataTable
              columns={columns}
              data={rows}
              pageSize={PAGE_SIZE}
              rowKey={(c) => c.identity_key}
              onRowClick={(c) => router.push(`/customers/${encodeURIComponent(c.identity_key)}`)}
              emptyTitle="No customers match"
              emptyDescription="Identities are resolved from the live order mirror and refresh every 15 minutes."
            />
          </div>
          <div className="flex items-center justify-between px-1">
            <span className="tnum text-xs text-muted-foreground">
              {total.toLocaleString()} identities · page {Math.min(page, pageCount)} of {pageCount.toLocaleString()} ·
              refreshed every 15 min from orders_read
            </span>
            <div className="flex gap-1">
              <Button variant="outline" size="icon" className="size-7" disabled={page <= 1 || loading}
                onClick={() => void setPage(page - 1 <= 1 ? null : page - 1)} aria-label="Previous page">
                <ChevronLeft className="size-3.5" />
              </Button>
              <Button variant="outline" size="icon" className="size-7" disabled={page >= pageCount || loading}
                onClick={() => void setPage(page + 1)} aria-label="Next page">
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        </>
      )}
    </PageBody>
  );
}

export default function CustomersPage() {
  return (
    <LiveGuard>
      <CustomersInner />
    </LiveGuard>
  );
}
