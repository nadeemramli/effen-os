"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ClipboardCheck, Loader2, PackageCheck, ShieldAlert, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { tonePill } from "@/components/status/status-pill";
import { EmptyState } from "@/components/states";
import { LiveGuard } from "@/components/auth/live-guard";
import {
  fetchLiveBrands,
  fetchLiveOrdersPage,
  fetchNvNetwork,
  fetchShipReadiness,
  fetchWooConnections,
  SHIP_ISSUE_LABELS,
  type LiveBrand,
  type LiveNvShipment,
  type LiveOrderRow,
  type LiveWooConnection,
  type ShipReadinessRow,
} from "@/lib/supabase/live";
import { useAppStore } from "@/lib/store/provider";

/* Original pick → pack → handover layout, live-fed:
 * - To pick        = Woo `processing` orders (paid, awaiting fulfilment)
 * - Picking        = Fighter's internal stage — no live signal until Slice 3
 * - Packed/ready   = Ninja Van parcels at "Pending Pickup"
 * - Exceptions     = Woo on-hold/failed orders + NV exception parcels
 * Handover manifests become actionable in the Slice 3 write pilot. */

const NV_EXCEPTION_WORDS = ["fail", "exception", "damaged", "lost", "on hold", "reschedule", "return"];

function relative(iso: string | null): string {
  if (!iso) return "—";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 60) return `${Math.max(min, 1)}m ago`;
  const hours = Math.round(min / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function skuSummary(o: LiveOrderRow): string {
  const first = o.items?.[0];
  if (!first) return "—";
  const more = (o.items?.length ?? 0) > 1 ? ` +${o.items.length - 1}` : "";
  return `${first.sku ?? first.name ?? "item"} ×${first.quantity}${more}`;
}

function FulfilmentInner() {
  const liveBrandId = useAppStore((s) => s.session.liveBrandId);
  const liveMarkets = useAppStore((s) => s.session.liveMarkets);

  const [toPick, setToPick] = useState<{ rows: LiveOrderRow[]; total: number }>({ rows: [], total: 0 });
  const [holds, setHolds] = useState<{ rows: LiveOrderRow[]; total: number }>({ rows: [], total: 0 });
  const [network, setNetwork] = useState<Awaited<ReturnType<typeof fetchNvNetwork>> | null>(null);
  const [readiness, setReadiness] = useState<{ rows: ShipReadinessRow[]; checked: number; flagged: number }>({ rows: [], checked: 0, flagged: 0 });
  const [brands, setBrands] = useState<LiveBrand[]>([]);
  const [connections, setConnections] = useState<LiveWooConnection[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const conns = await fetchWooConnections();
      setConnections(conns);
      const integrationIn =
        liveMarkets.length > 0
          ? conns.filter((c) => liveMarkets.includes(c.config?.country_code ?? "")).map((c) => c.id)
          : null;
      const base = { page: 1, pageSize: 8, brandId: liveBrandId, integrationId: null, integrationIn, currency: null, sinceHours: null, search: "" };
      const [pick, hold, nv, b, ready] = await Promise.all([
        fetchLiveOrdersPage({ ...base, status: "processing" }),
        fetchLiveOrdersPage({ ...base, status: null, statusIn: ["on-hold", "failed"] }),
        fetchNvNetwork(),
        fetchLiveBrands(),
        fetchShipReadiness(14),
      ]);
      setToPick(pick);
      setHolds(hold);
      setNetwork(nv);
      setBrands(b);
      setReadiness(ready);
    } finally {
      setLoading(false);
    }
  }, [liveBrandId, liveMarkets]);

  useEffect(() => {
    // Server-side queues re-run on scope change.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  const brandName = (id: number | null) => brands.find((b) => b.id === id)?.name ?? "—";

  const pendingPickup = useMemo(
    () => (network?.shipments ?? []).filter((s) => (s.status ?? "").toLowerCase().includes("pending pickup")),
    [network],
  );
  const nvExceptions = useMemo(
    () =>
      (network?.shipments ?? []).filter((s) =>
        NV_EXCEPTION_WORDS.some((w) => (s.status ?? "").toLowerCase().includes(w)),
      ),
    [network],
  );

  const nextAction = (o: LiveOrderRow) =>
    o.source_status === "on-hold" ? "Review hold — verify payment or release" :
    o.source_status === "failed" ? "Follow up failed payment with buyer" : "—";

  if (loading && !network) {
    return (
      <PageBody className="flex min-h-96 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading fulfilment floor" />
      </PageBody>
    );
  }

  const QUEUES: {
    title: string;
    icon: typeof ClipboardCheck;
    hint: string;
    count: number;
    rows: { key: string; primary: string; href: string | null; secondary: string; meta: string }[];
    note?: string;
  }[] = [
    {
      title: "To pick",
      icon: ClipboardCheck,
      hint: "Approved orders waiting for a picker",
      count: toPick.total,
      rows: toPick.rows.map((o) => ({
        key: String(o.id),
        primary: `#${o.order_number ?? o.source_order_id}`,
        href: `/orders?q=${encodeURIComponent(o.order_number ?? o.source_order_id)}`,
        secondary: `${brandName(o.brand_id)} · ${skuSummary(o)}`,
        meta: relative(o.placed_at),
      })),
    },
    {
      title: "Picking",
      icon: PackageCheck,
      hint: "Packing creates the AWB label",
      count: 0,
      rows: [],
      note: "Fighter runs pick/pack today — this stage reports live when Fullkit operates the floor (Slice 3).",
    },
    {
      title: "Packed — ready for handover",
      icon: Truck,
      hint: "Hand over via the courier manifest",
      count: pendingPickup.length,
      rows: pendingPickup.slice(0, 8).map((s: LiveNvShipment) => ({
        key: String(s.id),
        primary: s.tracking_id,
        href: null,
        secondary: s.order_ref ?? "—",
        meta: relative(s.last_event_at),
      })),
    },
  ];

  return (
    <PageBody className="max-w-none">
      <PageHeader
        title="Fulfilment"
        description="Pick → pack → handover for the KL fulfilment centre. Every move lands on the order's evidence timeline."
      >
        <div className="flex gap-2">
          {(["ninja_van", "jnt"] as const).map((c) => {
            const count = c === "ninja_van" ? pendingPickup.length : 0;
            return (
              <Button
                key={c}
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled
                title="Handover booking is a write action — arrives with the Slice 3 pilot. Fighter closes today's manifests."
              >
                <Truck className="size-3.5" aria-hidden />
                {c === "jnt" ? "J&T" : "Ninja Van"} manifest
                <Badge variant="secondary" className="tnum ml-1 h-4 px-1 text-[10px]">{count}</Badge>
              </Button>
            );
          })}
        </div>
      </PageHeader>

      <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
        Live read-only floor: order queues mirror the stores, parcel stages mirror Ninja Van. Pick/pack/handover
        actions arrive with the Slice 3 write pilot.
        {readiness.checked > 0 && (
          <>
            {" "}<span className="font-medium text-foreground">
              Ship-readiness gate: {(readiness.checked - readiness.flagged).toLocaleString()} of {readiness.checked.toLocaleString()} pre-ship
              orders (14d) pass validation · {readiness.flagged.toLocaleString()} need fixing below.
            </span>
          </>
        )}
      </p>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {QUEUES.map((q) => (
          <Card key={q.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <q.icon className="size-4 text-muted-foreground" aria-hidden />
                {q.title}
              </CardTitle>
              <Badge variant="outline" className="tnum text-xs">{q.count}</Badge>
            </CardHeader>
            <CardContent className="space-y-0 divide-y">
              <p className="pb-2 text-[11px] text-muted-foreground">{q.hint}</p>
              {q.rows.map((r) => (
                <div key={r.key} className="flex items-center gap-2.5 py-2 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      {r.href ? (
                        <Link href={r.href} className="text-sm font-medium text-info underline-offset-2 hover:underline">
                          {r.primary}
                        </Link>
                      ) : (
                        <span className="tnum text-sm font-medium">{r.primary}</span>
                      )}
                      <span className="truncate text-[11px] text-muted-foreground">{r.secondary}</span>
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      <span className="tnum">{r.meta}</span>
                    </div>
                  </div>
                </div>
              ))}
              {q.rows.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">{q.note ?? "Queue clear."}</p>
              )}
              {q.count > q.rows.length && q.rows.length > 0 && (
                <p className="pt-2 text-[11px] text-muted-foreground">
                  +{q.count - q.rows.length} more — see{" "}
                  <Link href="/orders?status=processing" className="text-info underline-offset-2 hover:underline">Orders</Link>.
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* exceptions */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <ShieldAlert className="size-4 text-destructive" aria-hidden />
            Fulfilment exceptions
          </CardTitle>
          <Badge variant="outline" className="tnum text-xs">{holds.total + nvExceptions.length + readiness.flagged}</Badge>
        </CardHeader>
        <CardContent>
          {holds.total + nvExceptions.length + readiness.flagged === 0 ? (
            <EmptyState title="No exceptions" description="Holds, address issues, and automation failures appear here." />
          ) : (
            <ul className="divide-y">
              {holds.rows.map((o) => (
                <li key={o.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                  <Link
                    href={`/orders?q=${encodeURIComponent(o.order_number ?? o.source_order_id)}`}
                    className="text-sm font-medium text-info underline-offset-2 hover:underline"
                  >
                    #{o.order_number ?? o.source_order_id}
                  </Link>
                  {tonePill(
                    o.source_status === "on-hold"
                      ? { label: "On hold", tone: "warning" }
                      : { label: "Payment failed", tone: "destructive" },
                  )}
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{nextAction(o)}</span>
                  <span className="tnum shrink-0 text-[11px] text-muted-foreground">{relative(o.placed_at)}</span>
                </li>
              ))}
              {readiness.rows.map((r) => (
                <li key={`sr-${r.id}`} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                  <Link href={`/orders/${r.id}`} className="text-sm font-medium text-info underline-offset-2 hover:underline">
                    #{r.order_number}
                  </Link>
                  {tonePill({ label: "not ship-ready", tone: "warning" })}
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {r.issues.map((i) => SHIP_ISSUE_LABELS[i] ?? i).join(" · ")}
                    {Object.keys(r.suggestions ?? {}).length > 0 && " — fix suggested on the order page"}
                  </span>
                  <span className="tnum shrink-0 text-[11px] text-muted-foreground">{relative(r.placed_at)}</span>
                </li>
              ))}
              {nvExceptions.map((s) => (
                <li key={`nv-${s.id}`} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                  <span className="tnum text-sm font-medium">{s.tracking_id}</span>
                  {tonePill({ label: s.status ?? "Exception", tone: "warning" })}
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    Courier-reported exception — check the parcel in the Ninja Van dashboard
                  </span>
                  <span className="tnum shrink-0 text-[11px] text-muted-foreground">{relative(s.last_event_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </PageBody>
  );
}

export default function FulfilmentPage() {
  return (
    <LiveGuard>
      <FulfilmentInner />
    </LiveGuard>
  );
}
