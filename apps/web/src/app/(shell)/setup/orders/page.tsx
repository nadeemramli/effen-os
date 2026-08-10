"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Database } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { LiveGuard } from "@/components/auth/live-guard";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { EmptyState, SkeletonTable } from "@/components/states";
import {
  fetchLiveBrands,
  fetchLiveOrders,
  type LiveBrand,
  type LiveOrderRow,
} from "@/lib/supabase/live";
import { cn } from "@/lib/utils";

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-MY", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kuala_Lumpur" });
}

function LiveOrdersInner() {
  const [orders, setOrders] = useState<LiveOrderRow[]>([]);
  const [brands, setBrands] = useState<LiveBrand[]>([]);
  const [brandFilter, setBrandFilter] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<LiveOrderRow | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [o, b] = await Promise.all([
        fetchLiveOrders(brandFilter === "all" ? null : Number(brandFilter), 200),
        fetchLiveBrands(),
      ]);
      setOrders(o);
      setBrands(b);
    } finally {
      setLoading(false);
    }
  }, [brandFilter]);

  useEffect(() => {
    // Fetch-on-mount/filter-change; every setState happens after an await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const brandName = (id: number | null) => brands.find((b) => b.id === id)?.name ?? "unmapped";

  return (
    <PageBody className="max-w-5xl">
      <PageHeader
        title="Mirrored orders (live read-side)"
        description="Real WooCommerce orders synced into orders_read. The source store stays authoritative — this is the mirror the app will read from."
      >
        <div className="flex items-center gap-2">
          <Select value={brandFilter} onValueChange={setBrandFilter}>
            <SelectTrigger className="h-8 w-44 text-xs" aria-label="Brand filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All brands</SelectItem>
              {brands.filter((b) => b.status === "active").map((b) => (
                <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Link href="/setup/connections" className="inline-flex items-center gap-1 text-sm text-info underline-offset-2 hover:underline">
            <ArrowLeft className="size-3.5" aria-hidden /> Connections
          </Link>
        </div>
      </PageHeader>

      {loading ? (
        <SkeletonTable rows={8} cols={8} />
      ) : orders.length === 0 ? (
        <EmptyState
          icon={Database}
          title="No mirrored orders yet"
          description="Connect a store in Setup → Store connections and run a sync — the first run backfills the store's full order history and rows appear here within seconds."
          action={{ label: "Store connections", href: "/setup/connections" }}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="px-3 py-2 font-medium">Order</th>
                <th className="px-3 py-2 font-medium">Brand</th>
                <th className="px-3 py-2 font-medium">Customer</th>
                <th className="px-3 py-2 font-medium">Items</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
                <th className="px-3 py-2 font-medium">Source status</th>
                <th className="px-3 py-2 font-medium">Placed</th>
                <th className="px-3 py-2 font-medium">Synced</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="cursor-pointer border-b last:border-0 hover:bg-accent/40" onClick={() => setDetail(o)}>
                  <td className="tnum px-3 py-2 font-medium">#{o.order_number ?? o.source_order_id}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{brandName(o.brand_id)}</td>
                  <td className="px-3 py-2">{o.customer?.name || "—"}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {(o.items ?? []).slice(0, 2).map((i) => `${i.sku ?? i.name} ×${i.quantity}`).join(", ")}
                    {(o.items?.length ?? 0) > 2 && ` +${o.items.length - 2}`}
                  </td>
                  <td className="tnum px-3 py-2 text-right">{o.currency_code} {Number(o.total).toFixed(2)}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className={cn("text-[10px] capitalize", o.source_status === "completed" ? "border-success/30 text-success" : o.source_status === "cancelled" || o.source_status === "failed" ? "border-destructive/30 text-destructive" : "text-muted-foreground")}>
                      {o.source_status}
                    </Badge>
                  </td>
                  <td className="tnum px-3 py-2 text-xs text-muted-foreground">{fmt(o.placed_at)}</td>
                  <td className="tnum px-3 py-2 text-xs text-muted-foreground">{fmt(o.synced_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Sheet open={detail !== null} onOpenChange={(o) => !o && setDetail(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {detail && (
            <>
              <SheetHeader>
                <SheetTitle>#{detail.order_number ?? detail.source_order_id} — {brandName(detail.brand_id)}</SheetTitle>
                <SheetDescription>
                  {detail.customer?.name} · {detail.customer?.phone ?? "no phone"} · {detail.customer?.city ?? ""}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-3 px-4 pb-6">
                <table className="w-full text-xs">
                  <thead><tr className="border-b text-left text-muted-foreground"><th className="pb-1 font-medium">Item</th><th className="pb-1 text-right font-medium">Qty</th><th className="pb-1 text-right font-medium">Total</th></tr></thead>
                  <tbody>
                    {(detail.items ?? []).map((i, idx) => (
                      <tr key={idx} className="border-b last:border-0">
                        <td className="py-1.5">{i.name ?? i.sku ?? "—"}</td>
                        <td className="tnum py-1.5 text-right">{i.quantity}</td>
                        <td className="tnum py-1.5 text-right">{i.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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

export default function LiveOrdersPage() {
  return (
    <LiveGuard>
      <LiveOrdersInner />
    </LiveGuard>
  );
}
