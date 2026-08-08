"use client";

import { useRouter } from "next/navigation";
import { parseAsInteger, parseAsString, useQueryState } from "nuqs";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, Download, Loader2, Plus, SlidersHorizontal, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { getSupabase } from "@/lib/supabase/client";
import {
  deleteSegment,
  fetchCustomerAddresses,
  fetchLiveBrands,
  fetchLiveCustomers,
  fetchSegments,
  saveSegment,
  type CustomerAddressRow,
  type CustomerSegment,
  type LiveBrand,
  type LiveCustomerRow,
  type SegmentCondition,
} from "@/lib/supabase/live";
import { maskPhone } from "@/lib/utils/mask";
import { useAppStore } from "@/lib/store/provider";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 50;

/* ---------- the segment field catalog (mirrors the server whitelist) ---------- */

interface FieldDef {
  field: string;
  label: string;
  type: "enum" | "number";
  options?: { value: string; label: string }[];
}

const FIELD_DEFS: FieldDef[] = [
  { field: "activity", label: "Lifecycle", type: "enum", options: [
    { value: "new", label: "New" }, { value: "active", label: "Active" },
    { value: "at_risk", label: "At risk" }, { value: "dormant", label: "Dormant" },
    { value: "provisional", label: "Provisional" },
  ] },
  { field: "repeat", label: "Repeat state", type: "enum", options: [
    { value: "first_time", label: "First-time" }, { value: "repeat", label: "Repeat" }, { value: "loyal", label: "Loyal" },
  ] },
  { field: "tier", label: "Value tier", type: "enum", options: [
    { value: "vip", label: "VIP" }, { value: "high", label: "High" }, { value: "mid", label: "Mid" }, { value: "low", label: "Low" },
  ] },
  { field: "classification", label: "Classification", type: "enum", options: [
    { value: "regular", label: "Regular" }, { value: "reseller", label: "Reseller" }, { value: "joy_buyer", label: "Joy buyer" },
  ] },
  { field: "total_orders", label: "Total orders", type: "number" },
  { field: "recognized_orders", label: "Recognized orders", type: "number" },
  { field: "revenue_total", label: "Lifetime revenue", type: "number" },
  { field: "cod_share", label: "COD share %", type: "number" },
  { field: "cod_orders", label: "COD orders", type: "number" },
  { field: "suspect_orders", label: "Suspect-detail orders", type: "number" },
  { field: "cancelled_orders", label: "Cancelled / failed orders", type: "number" },
  { field: "distinct_names", label: "Distinct recipient names", type: "number" },
  { field: "shared_address_count", label: "Profiles at same address", type: "number" },
  { field: "last_order_days", label: "Days since last order", type: "number" },
  { field: "first_order_days", label: "Days since first order", type: "number" },
];

const OPS: { value: SegmentCondition["op"]; label: string }[] = [
  { value: "gte", label: "≥" },
  { value: "lte", label: "≤" },
  { value: "eq", label: "=" },
];

/** Built-in starter segments — same condition language, not deletable. */
const STARTERS: { key: string; name: string; conditions: SegmentCondition[] }[] = [
  { key: "vip", name: "VIP", conditions: [{ field: "tier", op: "eq", value: "vip" }] },
  { key: "loyal", name: "Loyal", conditions: [{ field: "repeat", op: "eq", value: "loyal" }] },
  { key: "at_risk", name: "At risk", conditions: [{ field: "activity", op: "eq", value: "at_risk" }] },
  { key: "resellers", name: "Resellers", conditions: [{ field: "classification", op: "eq", value: "reseller" }] },
  // Multiple identities converging on one normalized delivery address —
  // reseller / drop-point candidates that phone-first identity can't merge.
  { key: "shared_address", name: "Shared address", conditions: [{ field: "shared_address_count", op: "gte", value: 2 }] },
  { key: "joy_buyers", name: "Joy buyers", conditions: [{ field: "classification", op: "eq", value: "joy_buyer" }] },
  { key: "cod_heavy", name: "COD-heavy", conditions: [
    { field: "cod_share", op: "gte", value: 80 }, { field: "total_orders", op: "gte", value: 2 },
  ] },
  // The remarketing cut: frequent buyers whose last order is recent enough
  // to still be reachable (4+ orders, active within 6 months).
  { key: "repeat_6mo", name: "Repeat 4+ · 6 mo", conditions: [
    { field: "total_orders", op: "gte", value: 4 }, { field: "last_order_days", op: "lte", value: 180 },
  ] },
];

function describeCondition(c: SegmentCondition): string {
  const def = FIELD_DEFS.find((f) => f.field === c.field);
  const label = def?.label ?? c.field;
  if (def?.type === "enum") {
    const opt = def.options?.find((o) => o.value === c.value)?.label ?? String(c.value);
    return `${label}: ${opt}`;
  }
  const op = OPS.find((o) => o.value === c.op)?.label ?? c.op;
  return `${label} ${op} ${c.value}`;
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

function lifecycleOf(row: LiveCustomerRow): { label: string; cls?: string } {
  if (!row.last_order_at) return { label: "provisional", cls: "text-muted-foreground" };
  const days = (Date.now() - new Date(row.last_order_at).getTime()) / 86_400_000;
  if (days <= 30) return { label: "active" };
  if (days <= 90) return { label: "at risk", cls: "text-warning" };
  return { label: "dormant", cls: "text-muted-foreground" };
}

function CustomersInner() {
  const router = useRouter();
  const [q, setQ] = useQueryState("q", parseAsString.withDefault(""));
  const [segmentKey, setSegmentKey] = useQueryState("segment", parseAsString);
  const [page, setPage] = useQueryState("page", parseAsInteger.withDefault(1));
  // Brand + market scope come from the top bar's live controls, like every live surface.
  const liveBrandId = useAppStore((s) => s.session.liveBrandId);
  const liveMarkets = useAppStore((s) => s.session.liveMarkets);

  const [brands, setBrands] = useState<LiveBrand[]>([]);
  const [segments, setSegments] = useState<CustomerSegment[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [conditions, setConditions] = useState<SegmentCondition[]>([]);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [rows, setRows] = useState<LiveCustomerRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState(q);

  const brandById = useMemo(() => new Map(brands.map((b) => [b.id, b])), [brands]);

  useEffect(() => {
    void fetchLiveBrands().then((b) =>
       
      setBrands(b.filter((x) => x.status === "active")),
    );
    void fetchSegments().then(setSegments).catch(() => setSegments([]));
    void getSupabase().auth.getSession().then(({ data }) => setUserId(data.session?.user.id ?? null));
  }, []);

  // The active segment (starter or saved) supplies conditions on load / URL nav.
  useEffect(() => {
    if (!segmentKey) return;
    const starter = STARTERS.find((s) => s.key === segmentKey);
    if (starter) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConditions(starter.conditions);
      return;
    }
    const saved = segments.find((s) => `s${s.id}` === segmentKey);
    if (saved) setConditions(saved.params.conditions ?? []);
  }, [segmentKey, segments]);

  const conditionsKey = JSON.stringify(conditions);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchLiveCustomers({
        page,
        pageSize: PAGE_SIZE,
        search: q,
        brandId: liveBrandId,
        countries: liveMarkets,
        conditions,
      });
      setRows(result.rows);
      setTotal(result.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, q, liveBrandId, liveMarkets, conditionsKey]);

  useEffect(() => {
    // Server-side query re-runs on any filter/page change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const applySegment = (key: string | null, conds: SegmentCondition[]) => {
    setConditions(conds);
    void setSegmentKey(key);
    void setPage(null);
  };

  const editCondition = (i: number, patch: Partial<SegmentCondition>) => {
    setConditions((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
    void setSegmentKey(null);
    void setPage(null);
  };

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

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
          const lc = lifecycleOf(row.original);
          return <span className={cn("capitalize", lc.cls)}>{lc.label}</span>;
        },
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
          const total = Number(row.original.revenue_total);
          // Thresholds calibrated to the live value distribution (p99/p95/p75).
          const t = total >= 900 ? "vip" : total >= 600 ? "high" : total >= 230 ? "mid" : "low";
          return <span className="text-xs uppercase">{t}</span>;
        },
      },
      {
        id: "classification",
        header: "Class",
        enableSorting: false,
        cell: ({ row }) => {
          const c = row.original.classification;
          const shared = Number(row.original.shared_address_count ?? 0);
          const addrChip = shared >= 2
            ? <Badge variant="outline" className="tnum text-[10px] text-muted-foreground">×{shared} addr</Badge>
            : null;
          if (c === "reseller") {
            return (
              <span className="inline-flex items-center gap-1">
                <Badge variant="outline" className="border-info/30 bg-info/10 text-[10px] text-info">reseller</Badge>
                {addrChip}
              </span>
            );
          }
          if (c === "joy_buyer") {
            return (
              <span className="inline-flex items-center gap-1">
                <Badge variant="outline" className="border-warning/30 bg-warning/10 text-[10px] text-warning">joy buyer</Badge>
                {addrChip}
              </span>
            );
          }
          return addrChip ?? <span className="text-[11px] text-muted-foreground">—</span>;
        },
      },
      {
        id: "risk",
        header: "Risk signals",
        enableSorting: false,
        cell: ({ row }) => {
          const bits: string[] = [];
          if (Number(row.original.suspect_orders) > 0) bits.push(`suspect ×${row.original.suspect_orders}`);
          if (Number(row.original.cancelled_orders) > 1) bits.push(`cancelled ×${row.original.cancelled_orders}`);
          if (Number(row.original.distinct_names) >= 4) bits.push(`${row.original.distinct_names} names`);
          return bits.length > 0
            ? <span className="text-[11px] text-warning">{bits.join(" · ")}</span>
            : <span className="text-[11px] text-muted-foreground">—</span>;
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
    ],
    [brandById],
  );

  return (
    <PageBody className="max-w-none">
      <PageHeader
        title="Customers"
        description={`Live mirror · ${total.toLocaleString()} identities resolved from order history (phone → address → e-mail) · contact details masked by default`}
      />

      {/* segments — saved filter sets, shared workspace-wide */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => applySegment(null, [])}
          className={cn(
            "rounded-full border px-2.5 py-1 text-xs transition-colors",
            conditions.length === 0 ? "border-ring bg-accent font-medium" : "text-muted-foreground hover:border-ring/60",
          )}
        >
          All customers
        </button>
        {STARTERS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => applySegment(s.key, s.conditions)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs transition-colors",
              segmentKey === s.key ? "border-ring bg-accent font-medium" : "text-muted-foreground hover:border-ring/60",
            )}
          >
            {s.name}
          </button>
        ))}
        {segments.map((s) => (
          <span
            key={s.id}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
              segmentKey === `s${s.id}` ? "border-ring bg-accent font-medium" : "text-muted-foreground hover:border-ring/60",
            )}
          >
            <button type="button" onClick={() => applySegment(`s${s.id}`, s.params.conditions ?? [])} className="inline-flex items-center gap-1">
              {s.is_shared && <Users className="size-3" aria-label="Shared segment" />}
              {s.name}
            </button>
            {s.user_id === userId && (
              <button
                type="button"
                aria-label={`Delete segment ${s.name}`}
                className="text-muted-foreground/60 hover:text-destructive"
                onClick={async () => {
                  try {
                    await deleteSegment(s.id);
                    setSegments((all) => all.filter((x) => x.id !== s.id));
                    if (segmentKey === `s${s.id}`) applySegment(null, []);
                    toast.success(`Segment "${s.name}" deleted`);
                  } catch (e) {
                    toast.error("Could not delete segment", { description: (e as Error).message });
                  }
                }}
              >
                <X className="size-3" aria-hidden />
              </button>
            )}
          </span>
        ))}
        <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => setBuilderOpen((o) => !o)}>
          <SlidersHorizontal className="size-3.5" aria-hidden />
          {builderOpen ? "Hide filters" : "Filters"}
          {conditions.length > 0 && <span className="tnum rounded-full bg-accent px-1.5">{conditions.length}</span>}
        </Button>
        <Button variant="outline" size="sm" className="ml-auto h-7 gap-1 text-xs" onClick={() => setExportOpen(true)}>
          <Download className="size-3.5" aria-hidden />
          Export CSV
          <span className="tnum text-muted-foreground">({total.toLocaleString()})</span>
        </Button>
      </div>

      {/* condition builder */}
      {builderOpen && (
        <Card>
          <CardContent className="space-y-2 pt-4">
            {conditions.map((c, i) => {
              const def = FIELD_DEFS.find((f) => f.field === c.field) ?? FIELD_DEFS[0]!;
              return (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <Select
                    value={c.field}
                    onValueChange={(field) => {
                      const nd = FIELD_DEFS.find((f) => f.field === field)!;
                      editCondition(i, {
                        field,
                        op: nd.type === "enum" ? "eq" : c.op === "eq" ? "gte" : c.op,
                        value: nd.type === "enum" ? nd.options![0]!.value : 1,
                      });
                    }}
                  >
                    <SelectTrigger className="h-8 w-52 text-xs" aria-label="Field"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {FIELD_DEFS.map((f) => (<SelectItem key={f.field} value={f.field}>{f.label}</SelectItem>))}
                    </SelectContent>
                  </Select>
                  {def.type === "number" ? (
                    <>
                      <Select value={c.op} onValueChange={(op) => editCondition(i, { op: op as SegmentCondition["op"] })}>
                        <SelectTrigger className="h-8 w-16 text-xs" aria-label="Operator"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {OPS.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
                        </SelectContent>
                      </Select>
                      <Input
                        inputMode="decimal"
                        value={String(c.value)}
                        onChange={(e) => editCondition(i, { value: e.target.value === "" ? 0 : Number(e.target.value) })}
                        className="h-8 w-24 text-xs"
                        aria-label="Value"
                      />
                    </>
                  ) : (
                    <Select value={String(c.value)} onValueChange={(v) => editCondition(i, { value: v })}>
                      <SelectTrigger className="h-8 w-44 text-xs" aria-label="Value"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {def.options!.map((o) => (<SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  )}
                  <Button
                    variant="ghost" size="icon" className="size-7 text-muted-foreground"
                    aria-label="Remove condition"
                    onClick={() => { setConditions((cs) => cs.filter((_, j) => j !== i)); void setSegmentKey(null); void setPage(null); }}
                  >
                    <X className="size-3.5" aria-hidden />
                  </Button>
                </div>
              );
            })}
            <div className="flex items-center gap-2 pt-1">
              <Button
                variant="outline" size="sm" className="h-7 gap-1 text-xs"
                onClick={() => { setConditions((cs) => [...cs, { field: "total_orders", op: "gte", value: 2 }]); void setSegmentKey(null); }}
              >
                <Plus className="size-3" aria-hidden /> Add condition
              </Button>
              {conditions.length > 0 && (
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setSaveOpen(true)}>
                  Save as segment
                </Button>
              )}
              <span className="text-[11px] text-muted-foreground">
                Conditions combine with AND · segments are stored globally and usable across the OS
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* active conditions summary (when builder is closed) */}
      {!builderOpen && conditions.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Active: {conditions.map(describeCondition).join(" AND ")}
        </p>
      )}

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
        {(q !== "" || conditions.length > 0) && (
          <Button variant="ghost" size="sm" className="h-8 gap-1 text-xs text-muted-foreground"
            onClick={() => { setSearchDraft(""); void setQ(null); applySegment(null, []); }}>
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

      <SaveSegmentDialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        conditions={conditions}
        onSaved={async (name) => {
          const fresh = await fetchSegments();
          setSegments(fresh);
          const created = fresh.find((s) => s.name === name);
          if (created) void setSegmentKey(`s${created.id}`);
        }}
      />
      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        search={q}
        brandId={liveBrandId}
        countries={liveMarkets}
        conditions={conditions}
        total={total}
      />
    </PageBody>
  );
}

/** Exportable columns: key, CSV header, and how to read it from a row. */
const EXPORT_COLUMNS: {
  key: string;
  label: string;
  group: "contact" | "address" | "commerce";
  value: (r: LiveCustomerRow, a: CustomerAddressRow | undefined) => string;
}[] = [
  { key: "name", label: "Name", group: "contact", value: (r) => r.display_name ?? "" },
  { key: "phone", label: "Phone", group: "contact", value: (r) => r.phone ?? "" },
  { key: "email", label: "Email", group: "contact", value: (r) => r.email ?? "" },
  { key: "address_1", label: "Address line 1", group: "address", value: (_r, a) => a?.address_1 ?? "" },
  { key: "address_2", label: "Address line 2", group: "address", value: (_r, a) => a?.address_2 ?? "" },
  { key: "city", label: "City", group: "address", value: (r, a) => a?.city ?? r.city ?? "" },
  { key: "state", label: "State", group: "address", value: (_r, a) => a?.state ?? "" },
  { key: "postcode", label: "Postcode", group: "address", value: (_r, a) => a?.postcode ?? "" },
  { key: "country", label: "Country", group: "address", value: (r, a) => a?.country ?? r.country ?? "" },
  { key: "total_orders", label: "Total orders", group: "commerce", value: (r) => String(r.total_orders) },
  { key: "recognized_orders", label: "Recognized orders", group: "commerce", value: (r) => String(r.recognized_orders) },
  { key: "cod_orders", label: "COD orders", group: "commerce", value: (r) => String(r.cod_orders) },
  { key: "ltv", label: "LTV (recognized, by currency)", group: "commerce", value: (r) =>
    Object.entries(r.revenue_by_currency ?? {}).map(([c, v]) => `${c} ${Number(v).toFixed(2)}`).join(" + ") },
  { key: "first_order_at", label: "First order date", group: "commerce", value: (r) => r.first_order_at?.slice(0, 10) ?? "" },
  { key: "last_order_at", label: "Last order date", group: "commerce", value: (r) => r.last_order_at?.slice(0, 10) ?? "" },
  { key: "classification", label: "Classification", group: "commerce", value: (r) => r.classification },
  { key: "shared_address_count", label: "Profiles at same address", group: "commerce", value: (r) =>
    r.shared_address_count != null ? String(r.shared_address_count) : "" },
];

const EXPORT_DEFAULTS = new Set([
  "name", "phone", "address_1", "city", "postcode", "country",
  "total_orders", "ltv", "first_order_at", "last_order_at",
]);

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function ExportDialog({
  open, onClose, search, brandId, countries, conditions, total,
}: {
  open: boolean;
  onClose: () => void;
  search: string;
  brandId: number | null;
  countries: string[];
  conditions: SegmentCondition[];
  total: number;
}) {
  const [picked, setPicked] = useState<Set<string>>(new Set(EXPORT_DEFAULTS));
  const [busy, setBusy] = useState(false);
  if (!open) return null;

  const togglePick = (key: string) =>
    setPicked((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const needsAddress = [...picked].some((k) => EXPORT_COLUMNS.find((c) => c.key === k)?.group === "address");
  const cap = 20000;

  const run = async () => {
    setBusy(true);
    try {
      // Page through the SAME filter the table shows — segment conditions,
      // search, brand and market scope all apply to the export.
      const all: LiveCustomerRow[] = [];
      let page = 1;
      for (;;) {
        const { rows: batch, total: t } = await fetchLiveCustomers({
          page, pageSize: 1000, search, brandId,
          countries: countries.length > 0 ? countries : null,
          conditions: conditions.length > 0 ? conditions : null,
        });
        all.push(...batch);
        if (all.length >= Math.min(t, cap) || batch.length === 0) break;
        page += 1;
      }
      const truncated = all.length >= cap;

      const addrByKey = new Map<string, CustomerAddressRow>();
      if (needsAddress && all.length > 0) {
        for (let i = 0; i < all.length; i += 5000) {
          const chunk = all.slice(i, i + 5000).map((r) => r.identity_key);
          const addrs = await fetchCustomerAddresses(chunk);
          for (const a of addrs) addrByKey.set(a.identity_key, a);
        }
      }

      const cols = EXPORT_COLUMNS.filter((c) => picked.has(c.key));
      const lines = [
        cols.map((c) => csvCell(c.label)).join(","),
        ...all.map((r) => cols.map((c) => csvCell(c.value(r, addrByKey.get(r.identity_key)))).join(",")),
      ];
      const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported ${all.length.toLocaleString()} customers`, {
        description: truncated ? `Capped at ${cap.toLocaleString()} rows — narrow the filter for the rest.` : undefined,
      });
      onClose();
    } catch (e) {
      toast.error("Export failed", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Export {total.toLocaleString()} customers to CSV</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          Exports exactly what the current filter shows (segment, search, brand and market scope). Pick the
          columns; addresses come from each customer&apos;s latest order, with Fullkit shipping corrections applied.
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
          {(["contact", "address", "commerce"] as const).map((group) => (
            <div key={group} className={cn("space-y-1.5", group === "commerce" && "col-span-2 grid grid-cols-2 gap-x-4 gap-y-1.5 space-y-0")}>
              {group !== "commerce" && (
                <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{group}</p>
              )}
              {EXPORT_COLUMNS.filter((c) => c.group === group).map((c) => (
                <label key={c.key} className="flex items-center gap-2 text-xs">
                  <Checkbox checked={picked.has(c.key)} onCheckedChange={() => togglePick(c.key)} />
                  {c.label}
                </label>
              ))}
            </div>
          ))}
        </div>
        <p className="rounded-md border border-warning/25 bg-warning/10 px-2 py-1.5 text-[11px] text-warning">
          Contains personal data — handle per your customer-data policy. The export is capped at 20,000 rows.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || picked.size === 0} onClick={run}>
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
            {busy ? "Exporting…" : "Export"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SaveSegmentDialog({
  open,
  onClose,
  conditions,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  conditions: SegmentCondition[];
  onSaved: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [shared, setShared] = useState(true);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Save segment</DialogTitle>
          <DialogDescription>
            {conditions.map(describeCondition).join(" AND ") || "No conditions"} — stored globally, so this
            segment can be reused on other surfaces (dashboards, exports) later.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="seg-name">Segment name</Label>
            <Input id="seg-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Dormant VIPs" />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={shared} onCheckedChange={(v) => setShared(v === true)} />
            Share with the whole workspace
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={busy || !name.trim() || conditions.length === 0}
            onClick={async () => {
              setBusy(true);
              try {
                await saveSegment(name.trim(), conditions, shared);
                await onSaved(name.trim());
                toast.success(`Segment "${name.trim()}" saved`);
                setName("");
                onClose();
              } catch (e) {
                toast.error("Could not save segment", { description: (e as Error).message });
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : "Save segment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function CustomersPage() {
  return (
    <LiveGuard>
      <CustomersInner />
    </LiveGuard>
  );
}
