"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Loader2, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PageBody } from "@/components/shell/page-header";
import { tonePill } from "@/components/status/status-pill";
import { EmptyState } from "@/components/states";
import { LiveGuard } from "@/components/auth/live-guard";
import { getSupabase } from "@/lib/supabase/client";
import {
  fetchLiveBrands,
  fetchNvShipmentForOrder,
  fetchShipReadiness,
  fetchWooConnections,
  SHIP_ISSUE_LABELS,
  type LiveBrand,
  type LiveNvEvent,
  type LiveNvShipment,
  type LiveOrderRow,
  type LiveWooConnection,
  type ShipReadinessRow,
} from "@/lib/supabase/live";
import type { StatusMeta } from "@/lib/domain/status-maps";
import { cn } from "@/lib/utils";

/* Original order-detail layout, fed by the live orders_read mirror. Actions
 * stay visible but disabled until the Slice 3 write pilot. */

const WOO_STATES: Record<string, { dim: string; meta: StatusMeta }[]> = {
  pending: [
    { dim: "Order", meta: { label: "Awaiting payment", tone: "warning" } },
    { dim: "Payment", meta: { label: "Unpaid", tone: "neutral" } },
  ],
  "on-hold": [
    { dim: "Order", meta: { label: "On hold", tone: "warning" } },
    { dim: "Payment", meta: { label: "Verifying", tone: "warning" } },
  ],
  processing: [
    { dim: "Order", meta: { label: "Confirmed", tone: "success" } },
    { dim: "Payment", meta: { label: "Paid", tone: "success" } },
    { dim: "Fulfilment", meta: { label: "To fulfil", tone: "info" } },
  ],
  completed: [
    { dim: "Order", meta: { label: "Completed", tone: "success" } },
    { dim: "Payment", meta: { label: "Paid", tone: "success" } },
    { dim: "Fulfilment", meta: { label: "Fulfilled", tone: "success" } },
  ],
  cancelled: [{ dim: "Order", meta: { label: "Cancelled", tone: "neutral" } }],
  refunded: [{ dim: "Payment", meta: { label: "Refunded", tone: "neutral" } }],
  failed: [{ dim: "Payment", meta: { label: "Payment failed", tone: "destructive" } }],
};

function nextActionFor(status: string): string | null {
  if (status === "pending") return "Verify payment reference";
  if (status === "on-hold") return "Review hold — verify payment or release";
  if (status === "failed") return "Follow up failed payment with buyer";
  return null;
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-MY", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kuala_Lumpur" });
}

function relative(iso: string | null): string {
  if (!iso) return "—";
  const h = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000);
  if (h < 1) return "just now";
  if (h < 48) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function identityKeyOf(o: LiveOrderRow): string | null {
  const phone = (o.customer?.phone ?? "").replace(/[^0-9]/g, "");
  if (phone) return phone;
  const email = (o.customer?.email ?? "").toLowerCase();
  return email || null;
}

interface WooRaw {
  payment_method_title?: string;
  shipping_total?: string;
  discount_total?: string;
}

function OrderDetailInner() {
  const params = useParams<{ id: string }>();
  const [order, setOrder] = useState<LiveOrderRow | null | "loading">("loading");
  const [brands, setBrands] = useState<LiveBrand[]>([]);
  const [connections, setConnections] = useState<LiveWooConnection[]>([]);
  const [nv, setNv] = useState<{ shipment: LiveNvShipment; events: LiveNvEvent[] } | null>(null);
  const [readiness, setReadiness] = useState<ShipReadinessRow | null | "unknown">("unknown");

  useEffect(() => {
    // Fetch-on-mount; every setState happens after an await.
    void (async () => {
      const [{ data }, b, c] = await Promise.all([
        getSupabase()
          .from("orders_read")
          .select("id, integration_id, brand_id, source_order_id, order_number, source_status, currency_code, total, customer, items, raw, placed_at, updated_at_source, synced_at")
          .eq("id", Number(params.id))
          .maybeSingle(),
        fetchLiveBrands(),
        fetchWooConnections(),
      ]);
      const row = (data ?? null) as LiveOrderRow | null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOrder(row);
      setBrands(b);
      setConnections(c);
      if (row) {
        const ref = row.order_number ?? row.source_order_id;
        fetchNvShipmentForOrder(ref).then(setNv).catch(() => setNv(null));
        if (["pending", "on-hold", "processing"].includes(row.source_status)) {
          // Membership check against the flagged list; absence = ship-ready.
          fetchShipReadiness(30)
            .then((r) => setReadiness(r.rows.find((x) => x.id === row.id) ?? null))
            .catch(() => setReadiness("unknown"));
        }
      }
    })();
  }, [params.id]);

  const conn = useMemo(
    () => (order && order !== "loading" ? connections.find((c) => c.id === order.integration_id) : undefined),
    [order, connections],
  );

  if (order === "loading") {
    return (
      <PageBody className="flex min-h-96 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading order" />
      </PageBody>
    );
  }

  if (!order) {
    return (
      <PageBody className="max-w-3xl">
        <EmptyState
          title="Order not found"
          description="No mirrored order with this id. New orders land within the 15-minute sync window."
          action={{ label: "Back to orders", href: "/orders" }}
        />
      </PageBody>
    );
  }

  const brand = brands.find((b) => b.id === order.brand_id);
  const raw = (order.raw ?? {}) as WooRaw;
  const states = WOO_STATES[order.source_status] ?? [{ dim: "Order", meta: { label: order.source_status, tone: "neutral" as const } }];
  const nextAction = nextActionFor(order.source_status);
  const storeLabel = conn?.name.match(/\(([^)]+)\)/)?.[1] ?? "—";
  const market = conn?.config?.country_code ?? "—";
  const idKey = identityKeyOf(order);
  const isException = order.source_status === "failed" || order.source_status === "on-hold";
  const shippingTotal = Number(raw.shipping_total ?? 0);
  const discountTotal = Number(raw.discount_total ?? 0);
  const itemsTotal = (order.items ?? []).reduce((s, i) => s + Number(i.total ?? 0), 0);

  const timeline: { at: string | null; actor: string; label: string; tone?: string }[] = [
    { at: order.placed_at, actor: storeLabel, label: "Order placed at source" },
    ...(nv?.events ?? []).slice().reverse().map((ev) => ({
      at: ev.event_at, actor: "Ninja Van", label: ev.status ?? "movement",
    })),
    { at: order.updated_at_source ?? null, actor: storeLabel, label: `Source status → ${order.source_status}` },
    { at: order.synced_at, actor: "woo-sync connector", label: "Mirrored into Fullkit", tone: "text-muted-foreground" },
  ];

  return (
    <PageBody className="max-w-none">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon" className="size-7" aria-label="Back to orders">
              <Link href="/orders"><ArrowLeft className="size-4" /></Link>
            </Button>
            <h1 className="text-lg font-semibold tracking-tight">#{order.order_number ?? order.source_order_id}</h1>
            {isException && (
              <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
                <ShieldAlert className="size-3" aria-hidden />
                {order.source_status === "failed" ? "payment exception" : "on hold"}
              </Badge>
            )}
            <Badge variant="outline" className="border-info/30 bg-info/10 text-info">Live · read-only</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {brand?.name ?? "unmapped"} · {storeLabel} · woocommerce · {order.source_order_id} · placed {relative(order.placed_at)}
          </p>
          <p className="mt-0.5 text-sm">
            <span className="text-muted-foreground">Owner: </span>
            <span className="text-muted-foreground">unassigned — work-item layer arrives with Slice 3</span>
            {nextAction && (
              <>
                <span className="text-muted-foreground"> · Next: </span>
                <span className="text-warning">{nextAction}</span>
              </>
            )}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_290px]">
        <div className="min-w-0 space-y-4">
          {/* six states */}
          <Card>
            <CardHeader><CardTitle className="text-sm font-medium">States</CardTitle></CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5">
                {states.map((s, i) => (
                  <span key={i}>{tonePill(s.meta, `${s.dim}: ${s.meta.label}`)}</span>
                ))}
                {nv?.shipment && tonePill({ label: `Shipment: ${nv.shipment.status ?? "in network"}`, tone: nv.shipment.is_terminal ? "success" : "info" })}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Derived per dimension from the source status — never merged. Shipment state joins from the
                Ninja Van mirror once parcel↔order linkage lands.
              </p>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* customer */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-medium">Customer</CardTitle>
                {idKey && (
                  <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
                    <Link href={`/customers/${encodeURIComponent(idKey)}`}>Customer 360</Link>
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                <div className="font-medium">{order.customer?.name || "Unknown"}</div>
                <div className="tnum text-muted-foreground">{order.customer?.phone ?? "—"}</div>
                <div className="text-muted-foreground">
                  {[order.customer?.city, order.customer?.country].filter(Boolean).join(", ") || "—"}
                </div>
                <div className="pt-1 text-xs text-muted-foreground">{order.customer?.email ?? ""}</div>
              </CardContent>
            </Card>

            {/* payment */}
            <Card>
              <CardHeader><CardTitle className="text-sm font-medium">Payment</CardTitle></CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Method</span><span>{raw.payment_method_title ?? "—"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">State</span><span className="capitalize">{order.source_status.replace(/-/g, " ")}</span></div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Gateway/commission fees</span><span>arrive with the payments read-side</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* items + amounts */}
          <Card>
            <CardHeader><CardTitle className="text-sm font-medium">Items & amounts</CardTitle></CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">Item</th>
                    <th className="pb-2 font-medium">SKU</th>
                    <th className="pb-2 text-right font-medium">Qty</th>
                    <th className="pb-2 text-right font-medium">Line</th>
                  </tr>
                </thead>
                <tbody>
                  {(order.items ?? []).map((it, i) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2">{it.name ?? "—"}</td>
                      <td className="tnum py-2">{it.sku ?? "—"}</td>
                      <td className="tnum py-2 text-right">{it.quantity}</td>
                      <td className="tnum py-2 text-right">{order.currency_code} {Number(it.total).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3 ml-auto max-w-56 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Items</span><span className="tnum">{order.currency_code} {itemsTotal.toFixed(2)}</span></div>
                {discountTotal > 0 && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="tnum">−{order.currency_code} {discountTotal.toFixed(2)}</span></div>
                )}
                <div className="flex justify-between"><span className="text-muted-foreground">Shipping</span><span className="tnum">{order.currency_code} {shippingTotal.toFixed(2)}</span></div>
                <Separator />
                <div className="flex justify-between font-medium"><span>Total</span><span className="tnum">{order.currency_code} {Number(order.total).toFixed(2)}</span></div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* fulfilment & shipment */}
            <Card>
              <CardHeader><CardTitle className="text-sm font-medium">Fulfilment & shipment</CardTitle></CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                {["pending", "on-hold", "processing"].includes(order.source_status) && readiness !== "unknown" && (
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-muted-foreground">Ship-readiness</span>
                    {readiness === null ? (
                      tonePill({ label: "Ship-ready", tone: "success" })
                    ) : (
                      <span className="flex flex-col items-end gap-1">
                        <span className="flex flex-wrap justify-end gap-1">
                          {readiness.issues.map((i) => (
                            <span key={i}>{tonePill({ label: SHIP_ISSUE_LABELS[i] ?? i, tone: "warning" })}</span>
                          ))}
                        </span>
                        {Object.entries(readiness.suggestions ?? {}).map(([k, v]) => (
                          <span key={k} className="tnum text-[11px] text-muted-foreground">suggested {k.replace("_", " ")}: {v}</span>
                        ))}
                      </span>
                    )}
                  </div>
                )}
                <div className="flex justify-between"><span className="text-muted-foreground">Fulfilment</span><span>{order.source_status === "completed" ? "Fulfilled" : order.source_status === "processing" ? "To fulfil (Fighter operates)" : "—"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Courier</span><span>{nv ? "Ninja Van" : "—"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Tracking</span><span className="tnum">{nv?.shipment.tracking_id ?? "—"}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Shipment</span><span>{nv?.shipment.status ?? "—"}</span></div>
                {!nv && (
                  <p className="mt-1 rounded-md border bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
                    Parcels currently carry Fighter consignment ids — tracking links here once the Fighter
                    bridge or NV order-details API provides the mapping.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* source & integration health */}
            <Card>
              <CardHeader><CardTitle className="text-sm font-medium">Source & integration health</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Source system</span><span>WooCommerce</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Source ID</span><span className="tnum">{order.source_order_id}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Store</span><span>{storeLabel}</span></div>
                <div className="flex items-center justify-between gap-2">
                  <Link href="/setup/connections" className="text-muted-foreground underline-offset-2 hover:underline">
                    {conn?.name ?? "connection"}
                  </Link>
                  {conn && tonePill(
                    conn.last_success_at && Date.now() - new Date(conn.last_success_at).getTime() < 45 * 60_000
                      ? { label: "fresh", tone: "success" }
                      : { label: "aging", tone: "warning" },
                  )}
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Last modified at source</span><span className="tnum">{fmtDateTime(order.updated_at_source ?? null)}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* evidence timeline */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Evidence timeline</CardTitle>
              <p className="text-xs text-muted-foreground">
                Every user, system, connector, rule, and courier event — one object, one timeline.
              </p>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {timeline
                  .filter((t) => t.at)
                  .sort((a, b) => new Date(a.at!).getTime() - new Date(b.at!).getTime())
                  .map((t, i) => (
                    <li key={i} className="flex items-start gap-2.5">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-info" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <div className={cn("text-sm", t.tone)}>{t.label}</div>
                        <div className="text-xs text-muted-foreground">{t.actor}</div>
                      </div>
                      <span className="tnum shrink-0 text-xs text-muted-foreground">{fmtDateTime(t.at)}</span>
                    </li>
                  ))}
              </ul>
            </CardContent>
          </Card>
        </div>

        {/* ---------- action rail ---------- */}
        <div className="space-y-3">
          <Card>
            <CardHeader><CardTitle className="text-sm font-medium">Actions</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {["Assign owner", "Resend confirmation", "Add note"].map((a) => (
                <Button key={a} variant="outline" size="sm" className="w-full justify-start" disabled>
                  {a}
                </Button>
              ))}
              <Button variant="outline" size="sm" className="w-full justify-start text-destructive" disabled>
                Cancel order
              </Button>
              <p className="rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
                Live mode is read-only — the source store stays authoritative. Actions unlock with the
                Slice 3 write pilot (approval-gated, audited).
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm font-medium">Scope</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 text-xs text-muted-foreground">
              <div className="flex justify-between"><span>Brand</span><span className="text-foreground">{brand?.name ?? "unmapped"}</span></div>
              <div className="flex justify-between"><span>Market</span><span className="text-foreground">{market}</span></div>
              <div className="flex justify-between"><span>Store</span><span className="text-foreground">{storeLabel}</span></div>
              <div className="flex justify-between"><span>Channel</span><span className="text-foreground">website</span></div>
              <div className="flex justify-between"><span>Currency</span><span className="text-foreground">{order.currency_code}</span></div>
              <div className="flex justify-between"><span>Legal entity</span><span className="text-foreground">{market === "SG" ? "EFFEN Commerce Pte Ltd" : "EFFEN International Sdn Bhd"}</span></div>
              <div className="flex justify-between"><span>Placed</span><span className="tnum text-foreground">{fmtDateTime(order.placed_at)}</span></div>
              <div className="flex justify-between"><span>Synced</span><span className="tnum text-foreground">{fmtDateTime(order.synced_at)}</span></div>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageBody>
  );
}

export default function OrderDetailPage() {
  return (
    <LiveGuard>
      <OrderDetailInner />
    </LiveGuard>
  );
}
