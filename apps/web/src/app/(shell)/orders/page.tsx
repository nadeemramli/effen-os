"use client";

import Link from "next/link";
import { parseAsInteger, parseAsString, useQueryState } from "nuqs";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { DataTable } from "@/components/tables/data-table";
import { tonePill } from "@/components/status/status-pill";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { LiveGuard } from "@/components/auth/live-guard";
import {
  fetchLiveBrands,
  fetchLiveOrdersPage,
  fetchNvShipmentForOrder,
  fetchWooConnections,
  type LiveBrand,
  type LiveNvEvent,
  type LiveNvShipment,
  type LiveOrderRow,
  type LiveWooConnection,
} from "@/lib/supabase/live";
import type { StatusMeta } from "@/lib/domain/status-maps";
import { useAppStore } from "@/lib/store/provider";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

/* ---------- state discipline over Woo's single source status ----------
 * The six-state separation (order / payment / fulfilment / shipment /
 * notification / return) survives, but honestly: each pill below is DERIVED
 * from the store's source_status and labeled per dimension. Shipment state
 * arrives separately from the Ninja Van read-side when a tracking id links.
 */
const WOO_STATE_PILLS: Record<string, { dim: string; meta: StatusMeta }[]> = {
  pending: [
    { dim: "order", meta: { label: "Awaiting payment", tone: "warning" } },
    { dim: "payment", meta: { label: "Unpaid", tone: "neutral" } },
  ],
  "on-hold": [
    { dim: "order", meta: { label: "On hold", tone: "warning" } },
    { dim: "payment", meta: { label: "Verifying", tone: "warning" } },
  ],
  processing: [
    { dim: "payment", meta: { label: "Paid", tone: "success" } },
    { dim: "fulfilment", meta: { label: "To fulfil", tone: "info" } },
  ],
  completed: [
    { dim: "order", meta: { label: "Completed", tone: "success" } },
    { dim: "payment", meta: { label: "Paid", tone: "success" } },
    { dim: "fulfilment", meta: { label: "Fulfilled", tone: "success" } },
  ],
  cancelled: [{ dim: "order", meta: { label: "Cancelled", tone: "neutral" } }],
  refunded: [{ dim: "payment", meta: { label: "Refunded", tone: "neutral" } }],
  failed: [{ dim: "payment", meta: { label: "Payment failed", tone: "destructive" } }],
  "checkout-draft": [{ dim: "order", meta: { label: "Draft checkout", tone: "neutral" } }],
};

function statePills(sourceStatus: string) {
  return (
    WOO_STATE_PILLS[sourceStatus] ?? [
      { dim: "order", meta: { label: sourceStatus, tone: "neutral" as const } },
    ]
  );
}

/* ---------- saved views = honest status slices over the live mirror ---------- */
const SAVED_VIEWS: { key: string; label: string; statusIn: string[] | null; sinceHours: number | null }[] = [
  { key: "all", label: "All", statusIn: null, sinceHours: null },
  { key: "new", label: "New (24h)", statusIn: null, sinceHours: 24 },
  { key: "needs-payment", label: "Needs payment", statusIn: ["pending", "on-hold", "failed"], sinceHours: null },
  { key: "to-fulfil", label: "To fulfil", statusIn: ["processing"], sinceHours: null },
  { key: "completed", label: "Completed", statusIn: ["completed"], sinceHours: null },
  { key: "cancelled-refunded", label: "Cancelled / refunded", statusIn: ["cancelled", "refunded"], sinceHours: null },
];

const AGE_OPTIONS = [
  { key: "any", label: "Any age", hours: null },
  { key: "24h", label: "< 24h", hours: 24 },
  { key: "3d", label: "< 3 days", hours: 72 },
  { key: "7d", label: "< 7 days", hours: 168 },
  { key: "30d", label: "< 30 days", hours: 720 },
] as const;

const SOURCE_STATUSES = ["pending", "on-hold", "processing", "completed", "cancelled", "refunded", "failed"];

function fmtRelativeNow(iso: string | null): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.round(Math.abs(diffMs) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hours = Math.round(min / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kuala_Lumpur" });
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-MY", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kuala_Lumpur" });
}

/** Store label from the connection name: "WooCommerce — Synovil MY (synovil.com)" → "synovil.com". */
function storeLabel(conn: LiveWooConnection | undefined): string {
  if (!conn) return "—";
  const m = conn.name.match(/\(([^)]+)\)/);
  return m?.[1] ?? conn.name;
}

function OrdersInner() {
  const [view, setView] = useQueryState("view", parseAsString.withDefault("all"));
  const [q, setQ] = useQueryState("q", parseAsString.withDefault(""));
  // Brand scope comes from the top bar's live switcher, like every live surface.
  const liveBrandId = useAppStore((s) => s.session.liveBrandId);
  const [store, setStore] = useQueryState("store", parseAsString.withDefault("any"));
  const [status, setStatus] = useQueryState("status", parseAsString.withDefault("any"));
  const [currency, setCurrency] = useQueryState("ccy", parseAsString.withDefault("any"));
  const [age, setAge] = useQueryState("age", parseAsString.withDefault("any"));
  const [page, setPage] = useQueryState("page", parseAsInteger.withDefault(1));

  const [brands, setBrands] = useState<LiveBrand[]>([]);
  const [connections, setConnections] = useState<LiveWooConnection[]>([]);
  const [rows, setRows] = useState<LiveOrderRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<LiveOrderRow | null>(null);
  const [nv, setNv] = useState<{ shipment: LiveNvShipment; events: LiveNvEvent[] } | null | "loading">(null);
  const [searchDraft, setSearchDraft] = useState(q);

  const activeView = SAVED_VIEWS.find((v) => v.key === view) ?? SAVED_VIEWS[0]!;
  const brandById = useMemo(() => new Map(brands.map((b) => [b.id, b])), [brands]);
  const connById = useMemo(() => new Map(connections.map((c) => [c.id, c])), [connections]);

  useEffect(() => {
    // Reference data once on mount; every setState happens after an await.
    void (async () => {
      const [b, c] = await Promise.all([fetchLiveBrands(), fetchWooConnections()]);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBrands(b.filter((x) => x.status === "active"));
      setConnections(c);
    })();
  }, []);

  const ageHours = AGE_OPTIONS.find((a) => a.key === age)?.hours ?? null;

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchLiveOrdersPage({
        page,
        pageSize: PAGE_SIZE,
        brandId: liveBrandId,
        integrationId: store === "any" ? null : Number(store),
        status: status === "any" ? null : status,
        statusIn: status === "any" ? activeView.statusIn : null,
        currency: currency === "any" ? null : currency,
        sinceHours: ageHours ?? activeView.sinceHours,
        search: q,
      });
      setRows(result.rows);
      setTotal(result.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [page, liveBrandId, store, status, currency, ageHours, q, activeView]);

  useEffect(() => {
    // Server-side query re-runs on any filter/page change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const openDetail = useCallback((o: LiveOrderRow) => {
    setDetail(o);
    setNv("loading");
    const ref = o.order_number ?? o.source_order_id;
    fetchNvShipmentForOrder(ref)
      .then((res) => setNv(res))
      .catch(() => setNv(null));
  }, []);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filtersActive = q !== "" || store !== "any" || status !== "any" || currency !== "any" || age !== "any";

  const columns = useMemo<ColumnDef<LiveOrderRow, unknown>[]>(
    () => [
      {
        id: "order",
        header: "Order",
        enableSorting: false,
        cell: ({ row }) => (
          <div>
            <span className="font-medium">#{row.original.order_number ?? row.original.source_order_id}</span>
            <div className="text-[11px] text-muted-foreground">{storeLabel(connById.get(row.original.integration_id))}</div>
          </div>
        ),
      },
      {
        id: "customer",
        header: "Customer",
        enableSorting: false,
        cell: ({ row }) => {
          const c = row.original.customer;
          return (
            <div>
              <div>{c?.name || "—"}</div>
              <div className="text-[11px] text-muted-foreground">{[c?.city, c?.country].filter(Boolean).join(", ")}</div>
            </div>
          );
        },
      },
      {
        id: "brand",
        header: "Brand",
        enableSorting: false,
        cell: ({ row }) => (
          <span>{row.original.brand_id ? brandById.get(row.original.brand_id)?.name ?? "—" : "unmapped"}</span>
        ),
      },
      {
        id: "items",
        header: "Items",
        enableSorting: false,
        cell: ({ row }) => {
          const items = row.original.items ?? [];
          return (
            <div className="max-w-48">
              <div className="tnum truncate">
                {items[0] ? `${items[0].sku ?? items[0].name ?? "item"} ×${items[0].quantity}` : "—"}
              </div>
              {items.length > 1 && (
                <div className="text-[11px] text-muted-foreground">+{items.length - 1} more line{items.length > 2 ? "s" : ""}</div>
              )}
            </div>
          );
        },
      },
      {
        id: "states",
        header: "States",
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex max-w-80 flex-wrap gap-1">
            {statePills(row.original.source_status).map((p, i) => (
              <span key={i}>{tonePill(p.meta)}</span>
            ))}
          </div>
        ),
      },
      {
        id: "amount",
        header: "Amount",
        enableSorting: false,
        cell: ({ row }) => (
          <span className="tnum">
            {row.original.currency_code} {Number(row.original.total).toFixed(2)}
          </span>
        ),
      },
      {
        id: "placed",
        header: "Placed",
        enableSorting: false,
        cell: ({ row }) => <span className="tnum text-muted-foreground">{fmtRelativeNow(row.original.placed_at)}</span>,
      },
      {
        id: "synced",
        header: "Synced",
        enableSorting: false,
        cell: ({ row }) => <span className="tnum text-[11px] text-muted-foreground">{fmtRelativeNow(row.original.synced_at)}</span>,
      },
    ],
    [brandById, connById],
  );

  return (
    <PageBody className="max-w-none">
      <PageHeader
        title="Orders"
        description={`Live mirror · ${total.toLocaleString()} orders in view across ${connections.length} connected stores · source stays authoritative · states derived per dimension, never merged`}
      >
        <Button asChild size="sm" className="gap-1.5">
          <Link href="/orders/new">
            <Plus className="size-3.5" aria-hidden /> New order
          </Link>
        </Button>
      </PageHeader>

      {/* saved views */}
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Saved views">
        {SAVED_VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={view === v.key}
            className={cn(
              "h-7 rounded-full border px-3 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              view === v.key
                ? "border-transparent bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
            onClick={() => {
              void setView(v.key);
              void setStatus(null);
              void setPage(null);
            }}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* filters */}
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
            placeholder="Search order #, customer, phone, email…"
            className="h-8 w-64 text-sm"
            aria-label="Search orders"
          />
        </form>
        <Select value={store} onValueChange={(v) => { void setStore(v === "any" ? null : v); void setPage(null); }}>
          <SelectTrigger className="h-8 w-44 text-xs" aria-label="Store"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any store</SelectItem>
            {connections.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>{storeLabel(c)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={(v) => { void setStatus(v === "any" ? null : v); void setPage(null); }}>
          <SelectTrigger className="h-8 w-40 text-xs" aria-label="Source status"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any source status</SelectItem>
            {SOURCE_STATUSES.map((s) => (
              <SelectItem key={s} value={s} className="capitalize">{s.replace("-", " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={currency} onValueChange={(v) => { void setCurrency(v === "any" ? null : v); void setPage(null); }}>
          <SelectTrigger className="h-8 w-28 text-xs" aria-label="Currency"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">MYR + SGD</SelectItem>
            <SelectItem value="MYR">MYR</SelectItem>
            <SelectItem value="SGD">SGD</SelectItem>
          </SelectContent>
        </Select>
        <Select value={age} onValueChange={(v) => { void setAge(v === "any" ? null : v); void setPage(null); }}>
          <SelectTrigger className="h-8 w-28 text-xs" aria-label="Age"><SelectValue /></SelectTrigger>
          <SelectContent>
            {AGE_OPTIONS.map((a) => (
              <SelectItem key={a.key} value={a.key}>{a.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filtersActive && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 text-xs text-muted-foreground"
            onClick={() => {
              setSearchDraft("");
              void setQ(null); void setStore(null);
              void setStatus(null); void setCurrency(null); void setAge(null); void setPage(null);
            }}
          >
            <X className="size-3" aria-hidden /> Clear filters
          </Button>
        )}
      </div>

      {loading && rows.length === 0 ? (
        <div className="flex justify-center py-12"><Loader2 className="size-5 animate-spin text-muted-foreground" aria-label="Loading orders" /></div>
      ) : error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Could not load the live orders mirror: {error}
        </div>
      ) : (
        <>
          <div className={cn(loading && "pointer-events-none opacity-60")}>
            <DataTable
              columns={columns}
              data={rows}
              pageSize={PAGE_SIZE}
              rowKey={(o) => String(o.id)}
              onRowClick={openDetail}
              emptyTitle="No orders match"
              emptyDescription="Adjust the saved view or filters. New orders appear within the 15-minute sync window; use Setup → Store connections → Sync now to pull immediately."
            />
          </div>
          {/* server-side pagination */}
          <div className="flex items-center justify-between px-1">
            <span className="tnum text-xs text-muted-foreground">
              {total.toLocaleString()} orders · page {Math.min(page, pageCount)} of {pageCount.toLocaleString()}
            </span>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="icon"
                className="size-7"
                disabled={page <= 1 || loading}
                onClick={() => void setPage(page - 1 <= 1 ? null : page - 1)}
                aria-label="Previous page"
              >
                <ChevronLeft className="size-3.5" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="size-7"
                disabled={page >= pageCount || loading}
                onClick={() => void setPage(page + 1)}
                aria-label="Next page"
              >
                <ChevronRight className="size-3.5" />
              </Button>
            </div>
          </div>
        </>
      )}

      {/* live order detail */}
      <Sheet open={detail !== null} onOpenChange={(o) => { if (!o) { setDetail(null); setNv(null); } }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {detail && (
            <>
              <SheetHeader>
                <SheetTitle>
                  #{detail.order_number ?? detail.source_order_id} · {detail.brand_id ? brandById.get(detail.brand_id)?.name : "unmapped"}
                </SheetTitle>
                <SheetDescription>
                  {detail.customer?.name || "Unknown customer"} · {detail.customer?.phone ?? "no phone"} ·{" "}
                  {[detail.customer?.city, detail.customer?.country].filter(Boolean).join(", ") || "no address"}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4 px-4 pb-6">
                <div className="flex flex-wrap gap-1">
                  {statePills(detail.source_status).map((p, i) => (
                    <span key={i}>{tonePill(p.meta, `${p.dim}: ${p.meta.label}`)}</span>
                  ))}
                </div>

                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="pb-1 font-medium">Item</th>
                      <th className="pb-1 text-right font-medium">Qty</th>
                      <th className="pb-1 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail.items ?? []).map((i, idx) => (
                      <tr key={idx} className="border-b last:border-0">
                        <td className="py-1.5">{i.name ?? i.sku ?? "—"}</td>
                        <td className="tnum py-1.5 text-right">{i.quantity}</td>
                        <td className="tnum py-1.5 text-right">{i.total}</td>
                      </tr>
                    ))}
                    <tr>
                      <td className="pt-2 font-medium">Grand total</td>
                      <td />
                      <td className="tnum pt-2 text-right font-medium">
                        {detail.currency_code} {Number(detail.total).toFixed(2)}
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* shipment (Ninja Van read-side) */}
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Shipment</div>
                  {nv === "loading" ? (
                    <div className="text-xs text-muted-foreground">Checking Ninja Van mirror…</div>
                  ) : nv ? (
                    <div className="rounded-md border p-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="tnum font-medium">{nv.shipment.tracking_id}</span>
                        {nv.shipment.status && tonePill({ label: nv.shipment.status, tone: nv.shipment.is_terminal ? "success" : "info" })}
                      </div>
                      <ul className="mt-2 space-y-1">
                        {nv.events.map((ev) => (
                          <li key={ev.id} className="flex justify-between text-muted-foreground">
                            <span>{ev.status ?? "—"}</span>
                            <span className="tnum">{fmtDateTime(ev.event_at)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      No Ninja Van events linked to this order yet — tracking appears here once the courier webhook
                      reports a parcel with this order reference.
                    </div>
                  )}
                </div>

                {/* provenance */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <span className="text-muted-foreground">Source</span>
                  <span>{storeLabel(connById.get(detail.integration_id))} · WooCommerce</span>
                  <span className="text-muted-foreground">Source order id</span>
                  <span className="tnum">{detail.source_order_id}</span>
                  <span className="text-muted-foreground">Source status</span>
                  <span className="capitalize">{detail.source_status}</span>
                  <span className="text-muted-foreground">Placed</span>
                  <span className="tnum">{fmtDateTime(detail.placed_at)}</span>
                  <span className="text-muted-foreground">Last modified (source)</span>
                  <span className="tnum">{fmtDateTime(detail.updated_at_source ?? null)}</span>
                  <span className="text-muted-foreground">Synced</span>
                  <span className="tnum">{fmtDateTime(detail.synced_at)}</span>
                </div>

                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Raw source payload</div>
                  <pre className="max-h-96 overflow-auto rounded-md border bg-muted/40 p-2 text-[10px] leading-relaxed">
                    {JSON.stringify(detail.raw, null, 2)}
                  </pre>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </PageBody>
  );
}

export default function OrdersPage() {
  return (
    <LiveGuard>
      <OrdersInner />
    </LiveGuard>
  );
}
