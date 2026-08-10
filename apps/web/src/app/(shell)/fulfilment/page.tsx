"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ClipboardCheck, GitBranch, PackageCheck, ShieldAlert, Sparkles, Truck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { tonePill } from "@/components/status/status-pill";
import { EmptyState, ErrorState, InlineCount, RefreshChip } from "@/components/states";
import { LiveGuard } from "@/components/auth/live-guard";
import { useLiveQuery } from "@/hooks/use-live-query";
import {
  fetchAiSuggestedOrderIds,
  fetchFulfilmentPipeline,
  fetchLiveBrands,
  fetchLiveOrdersPage,
  fetchNvNetwork,
  fetchShadowReport,
  fetchShipReadiness,
  fetchWooConnections,
  FULFILMENT_STAGE_LABELS,
  releaseFulfilmentOrder,
  SHIP_ISSUE_LABELS,
  type FulfilmentPipelineRow,
  type LiveBrand,
  type LiveNvShipment,
  type LiveOrderRow,
  type ShipReadinessRow,
} from "@/lib/supabase/live";
import { useAppStore } from "@/lib/store/provider";
import { cn } from "@/lib/utils";

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

function cnStage(stage: string, count: number): string {
  return cn(
    "tnum mt-0.5 text-base font-semibold",
    stage === "exception" && count > 0 && "text-warning",
    stage === "held" && count > 0 && "text-info",
  );
}

function skuSummary(o: LiveOrderRow): string {
  const first = o.items?.[0];
  if (!first) return "—";
  const more = (o.items?.length ?? 0) > 1 ? ` +${o.items.length - 1}` : "";
  return `${first.sku ?? first.name ?? "item"} ×${first.quantity}${more}`;
}

/** Mirrors a queue Card (header + row list) while the floor snapshot loads. */
function QueueCardSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-5 w-8 rounded-full" />
      </CardHeader>
      <CardContent className="space-y-3">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="space-y-1.5">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function FulfilmentInner() {
  const liveBrandId = useAppStore((s) => s.session.liveBrandId);
  const liveMarkets = useAppStore((s) => s.session.liveMarkets);

  const [releasing, setReleasing] = useState<number | null>(null);

  // One floor snapshot per scope; scope changes refetch with the stale floor
  // dimmed, and a failed fetch surfaces instead of rendering a clean floor.
  const { data, error, loading, refreshing, reload } = useLiveQuery(async () => {
    const conns = await fetchWooConnections();
    const integrationIn =
      liveMarkets.length > 0
        ? conns.filter((c) => liveMarkets.includes(c.config?.country_code ?? "")).map((c) => c.id)
        : null;
    const base = { page: 1, pageSize: 8, brandId: liveBrandId, integrationId: null, integrationIn, currency: null, sinceHours: null, search: "" };
    const [pick, hold, nv, b, ready, pipe, shadowReport, aiIds] = await Promise.all([
      fetchLiveOrdersPage({ ...base, status: "processing" }),
      fetchLiveOrdersPage({ ...base, status: null, statusIn: ["on-hold", "failed"] }),
      fetchNvNetwork(),
      fetchLiveBrands(),
      fetchShipReadiness(14),
      fetchFulfilmentPipeline(14).catch(() => [] as FulfilmentPipelineRow[]),
      fetchShadowReport(14).catch(() => null),
      fetchAiSuggestedOrderIds().catch(() => new Set<number>()),
    ]);
    return { toPick: pick, holds: hold, network: nv, brands: b, readiness: ready, pipeline: pipe, shadow: shadowReport, aiOrderIds: aiIds };
  }, [liveBrandId, liveMarkets]);

  const toPick = data?.toPick ?? { rows: [] as LiveOrderRow[], total: 0 };
  const holds = data?.holds ?? { rows: [] as LiveOrderRow[], total: 0 };
  const network = data?.network ?? null;
  const readiness = data?.readiness ?? { rows: [] as ShipReadinessRow[], checked: 0, flagged: 0, corrected: 0 };
  const brands = data?.brands ?? ([] as LiveBrand[]);
  const pipeline = data?.pipeline ?? ([] as FulfilmentPipelineRow[]);
  const shadow = data?.shadow ?? null;
  const aiOrderIds = data?.aiOrderIds ?? new Set<number>();

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
        <div className="flex items-center gap-2">
          {refreshing && <RefreshChip />}
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
                <Badge variant="secondary" className="tnum ml-1 h-4 px-1 text-[10px]">
                  <InlineCount value={loading ? null : count} width="w-3" />
                </Badge>
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
              orders (14d) pass validation · {readiness.flagged.toLocaleString()} need fixing below
              {readiness.corrected > 0 && ` · ${readiness.corrected.toLocaleString()} corrected in Fullkit, staged`}.
            </span>
          </>
        )}
      </p>

      {error ? (
        <ErrorState
          title="Could not load the fulfilment floor"
          description={`Queues and exceptions are unavailable right now — nothing here is confirmed clear. ${error}`}
          retry={() => void reload()}
        />
      ) : loading ? (
        <div className="space-y-5" role="status" aria-label="Loading fulfilment floor">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <QueueCardSkeleton key={i} />
            ))}
          </div>
          <QueueCardSkeleton rows={4} />
        </div>
      ) : (
        <div
          className={cn("space-y-5", refreshing && "pointer-events-none opacity-60")}
          aria-busy={refreshing || undefined}
        >
      {pipeline.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <GitBranch className="size-4 text-info" aria-hidden />
              Fulfilment pipeline — Synovil MY pilot (shadow mode)
            </CardTitle>
            <Badge variant="outline" className="border-info/30 bg-info/10 text-[10px] text-info">
              writes nothing external
            </Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {(["intake", "exception", "held", "gate_passed", "shadow_logged"] as const).map((stage) => {
                const count = pipeline.filter((r) => r.stage === stage).length;
                return (
                  <div key={stage} className="rounded-md border px-3 py-2">
                    <div className="text-[11px] capitalize text-muted-foreground">{FULFILMENT_STAGE_LABELS[stage]}</div>
                    <div className={cnStage(stage, count)}>{count}</div>
                  </div>
                );
              })}
            </div>

            {pipeline.some((r) => r.stage === "held") && (
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">Held orders — frozen until released</div>
                <ul className="divide-y">
                  {pipeline.filter((r) => r.stage === "held").map((r) => (
                    <li key={r.order_read_id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                      <Link href={`/orders/${r.order_read_id}`} className="text-sm font-medium text-info underline-offset-2 hover:underline">
                        #{r.order_number}
                      </Link>
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                        {r.held_by ?? "—"}{r.hold_reason ? ` · ${r.hold_reason}` : ""}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={releasing === r.order_read_id}
                        onClick={async () => {
                          setReleasing(r.order_read_id);
                          try {
                            await releaseFulfilmentOrder(r.order_read_id);
                            toast.success(`#${r.order_number} released`, { description: "Re-graded on the next gate tick." });
                            await reload();
                          } catch (e) {
                            toast.error("Release failed", { description: (e as Error).message });
                          } finally {
                            setReleasing(null);
                          }
                        }}
                      >
                        Release
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {shadow && (
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span className="font-medium text-foreground">Shadow evidence (14d)</span>
                  <span className="tnum">
                    coverage {shadow.coverage_pct !== null ? `${shadow.coverage_pct}%` : "—"} · target ≥99% for 2 weeks
                  </span>
                  {Object.entries(shadow.totals).map(([k, v]) => (
                    <span key={k} className="tnum text-muted-foreground">{k} {v}</span>
                  ))}
                </div>
                {shadow.recent_exceptions.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 text-muted-foreground">
                    {shadow.recent_exceptions.slice(0, 5).map((x, i) => (
                      <li key={i} className="tnum">
                        #{x.order_number} — {x.status}
                        {x.compare?.woo_status ? ` (source ${String(x.compare.woo_status)})` : ""}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Shadow payloads scored against Woo order outcomes (Fighter shipping flips the source status) —
                  per-field payload diffs arrive with the NV order-details API. Nothing is sent to Ninja Van.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

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
                  {r.issues.length === 0
                    ? tonePill({ label: "corrected · staged", tone: "info" })
                    : tonePill({ label: "not ship-ready", tone: "warning" })}
                  {aiOrderIds.has(r.id) && (
                    <span className="flex shrink-0 items-center gap-1 text-[11px] text-info">
                      <Sparkles className="size-3" aria-hidden />
                      AI fix suggested
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {r.issues.length === 0
                      ? "Fixed in Fullkit — reaches the courier when write propagation is enabled"
                      : r.issues.map((i) => SHIP_ISSUE_LABELS[i] ?? i).join(" · ")}
                    {r.issues.length > 0 && Object.keys(r.suggestions ?? {}).length > 0 && " — fix suggested on the order page"}
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
        </div>
      )}
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
