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
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

const ACTIVITY_OPTIONS = [
  { key: "any", label: "Any activity" },
  { key: "new", label: "New (first order < 30d)" },
  { key: "active", label: "Active (< 30d)" },
  { key: "at_risk", label: "At risk (30–90d)" },
  { key: "dormant", label: "Dormant (> 90d)" },
] as const;

function repeatState(orders: number): string {
  return orders >= 5 ? "loyal" : orders > 1 ? "repeat" : "first-time";
}

function lifecycle(last: string | null): { label: string; cls?: string } {
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
  const [brand, setBrand] = useQueryState("brand", parseAsString.withDefault("any"));
  const [activity, setActivity] = useQueryState("activity", parseAsString.withDefault("any"));
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
        brandId: brand === "any" ? null : Number(brand),
        activity: activity === "any" ? null : activity,
      });
      setRows(result.rows);
      setTotal(result.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page, q, brand, activity]);

  useEffect(() => {
    // Server-side query re-runs on any filter/page change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtersActive = q !== "" || brand !== "any" || activity !== "any";

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
          const lc = lifecycle(row.original.last_order_at);
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
        id: "last",
        header: "Last order",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="tnum text-muted-foreground">{relative(row.original.last_order_at)}</span>
        ),
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
        <Select value={brand} onValueChange={(v) => { void setBrand(v === "any" ? null : v); void setPage(null); }}>
          <SelectTrigger className="h-8 w-40 text-xs" aria-label="Brand"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">All brands</SelectItem>
            {brands.map((b) => (
              <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={activity} onValueChange={(v) => { void setActivity(v === "any" ? null : v); void setPage(null); }}>
          <SelectTrigger className="h-8 w-48 text-xs" aria-label="Activity"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ACTIVITY_OPTIONS.map((a) => (
              <SelectItem key={a.key} value={a.key}>{a.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filtersActive && (
          <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs text-muted-foreground"
            onClick={() => { setSearchDraft(""); void setQ(null); void setBrand(null); void setActivity(null); void setPage(null); }}>
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
