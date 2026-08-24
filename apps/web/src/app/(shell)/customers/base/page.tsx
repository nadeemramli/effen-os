"use client";

import { useEffect, useMemo, useState } from "react";
import { Info, Table2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { EmptyState, ErrorState, RefreshChip } from "@/components/states";
import { FreshnessBadge } from "@/components/status/freshness-badge";
import { LiveGuard } from "@/components/auth/live-guard";
import { RouteGuard } from "@/lib/rbac/guard";
import { useCustomerBase } from "@/hooks/use-customer-base";
import {
  MOVEMENT_MEASURE_LABELS,
  movementReconciles,
  type MovementMeasure,
  type MovementPeriod,
} from "@/lib/domain/lifecycle";
import { fetchLiveBrands, type LiveBrand } from "@/lib/supabase/live";
import { cn } from "@/lib/utils";
import { BaseTrendChart, MovementChart, periodLabel } from "./_components/movement-chart";
import { PopulationSheet, type PopulationTarget } from "./_components/population-sheet";

/** A refresh older than a day plus slack is stale; the daily job runs at 01:30 MYT. */
const FRESHNESS_SLA_MINUTES = 26 * 60;
/** Below this share of orders with a resolvable identity, the numbers are qualified. */
const IDENTITY_COVERAGE_FLOOR = 0.95;

function n(v: number): string {
  return v.toLocaleString();
}

function pct(v: number | null): string {
  return v === null ? "n/a" : `${v >= 0 ? "+" : "−"}${(Math.abs(v) * 100).toFixed(1)}%`;
}

function MovementCard({
  label,
  value,
  sub,
  tone,
  onClick,
  definition,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "success" | "info" | "destructive" | "neutral";
  onClick?: () => void;
  definition: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-muted-foreground">{label}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="rounded text-muted-foreground/70 hover:text-foreground" aria-label={`Definition of ${label}`}>
              <Info className="size-3.5" aria-hidden />
            </span>
          </TooltipTrigger>
          <TooltipContent className="max-w-xs text-xs">{definition}</TooltipContent>
        </Tooltip>
      </div>
      <div
        className={cn(
          "tnum mt-1 text-2xl font-semibold tracking-tight",
          tone === "success" && "text-success",
          tone === "info" && "text-info",
          tone === "destructive" && "text-destructive",
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div>}
    </>
  );
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className="rounded-xl border bg-card px-4 py-3 text-left outline-none transition-colors hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-ring"
    >
      {body}
    </button>
  ) : (
    <Card className="gap-0 px-4 py-3">{body}</Card>
  );
}

function CustomerBaseInner() {
  const { movement, loading, refreshing, error, reload, integrationIn, brandId, controls } = useCustomerBase();
  const [brands, setBrands] = useState<LiveBrand[]>([]);
  const [target, setTarget] = useState<PopulationTarget | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    void fetchLiveBrands().then((b) => setBrands(b.filter((x) => x.status === "active")));
  }, []);

  const ok = movement?.status === "ok" ? movement : null;
  const periods = useMemo(() => ok?.periods ?? [], [ok]);
  // Cards describe the latest period in range; a partial period is labelled as such.
  const focus: MovementPeriod | null = periods.length ? periods[periods.length - 1]! : null;
  const identityShare = ok ? ok.coverage.orders_with_identity / Math.max(ok.coverage.orders_total, 1) : 1;
  const lowCoverage = ok !== null && identityShare < IDENTITY_COVERAGE_FLOOR;
  const reconciles = periods.every(movementReconciles);

  const scopeLabel = [
    brandId ? (brands.find((b) => b.id === brandId)?.name ?? `brand ${brandId}`) : "All brands",
    integrationIn ? `${integrationIn.length} store${integrationIn.length === 1 ? "" : "s"}` : "all markets",
  ].join(" · ");

  const open = (period: MovementPeriod, measure: MovementMeasure) => setTarget({ period, measure });

  return (
    <PageBody className="max-w-none">
      <PageHeader
        title="Customer base"
        description="Is the active customer file growing or shrinking, and where does the movement come from? Governed lifecycle facts — the browser only renders them."
      >
        <div className="flex flex-wrap items-center gap-2">
          {refreshing && <RefreshChip />}
          <ToggleGroup type="single" value={controls.grain} onValueChange={(v) => v && controls.setGrain(v as "month" | "week")} className="h-8">
            <ToggleGroupItem value="month" className="h-8 px-2 text-xs">Month</ToggleGroupItem>
            <ToggleGroupItem value="week" className="h-8 px-2 text-xs">Week</ToggleGroupItem>
          </ToggleGroup>
          <ToggleGroup type="single" value={controls.range.key} onValueChange={(v) => v && controls.setRange(v)} className="h-8">
            {controls.presets.map((p) => (
              <ToggleGroupItem key={p.key} value={p.key} className="h-8 px-2 text-xs">{p.label}</ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Button size="sm" variant={showTable ? "secondary" : "outline"} className="gap-1.5" onClick={() => setShowTable((s) => !s)} aria-pressed={showTable}>
            <Table2 className="size-3.5" aria-hidden /> Table
          </Button>
        </div>
      </PageHeader>

      {error ? (
        <ErrorState title="Could not load the customer base" description={`Nothing here is confirmed. ${error}`} retry={() => void reload()} />
      ) : loading || !movement ? (
        <div className="space-y-5" role="status" aria-label="Loading customer base">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-xl" />
        </div>
      ) : movement.status === "unavailable" ? (
        <EmptyState
          title={movement.reason === "no_policy" ? "No lifecycle policy published" : "Customer base not computed yet"}
          description={
            movement.reason === "no_policy"
              ? "A versioned lifecycle policy has to exist before any movement can be reported."
              : `The lifecycle contract has not completed a refresh${movement.policy ? ` for policy v${movement.policy.version}` : ""}. Numbers appear after the first nightly run — nothing is shown until then.`
          }
        />
      ) : ok ? (
        <div className={cn("space-y-5", refreshing && "pointer-events-none opacity-60")} aria-busy={refreshing || undefined}>
          {/* scope + trust strip */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <span>
              Scope <span className="font-medium text-foreground">{scopeLabel}</span> · acquisition lens (each customer counts under the brand/store of their first accepted order)
            </span>
            <span>
              Policy <span className="font-medium text-foreground">v{ok.policy.version}</span>
              <Badge variant="outline" className={cn("ml-1 h-4 px-1 text-[10px] font-normal", ok.policy.status === "provisional" && "border-warning/40 text-warning")}>
                {ok.policy.status}
              </Badge>
              {" "}· lapse after {ok.policy.threshold_days}d, at risk from day {ok.policy.at_risk_days}
            </span>
            <span className="ml-auto flex items-center gap-1.5">
              Computed <FreshnessBadge lastSuccessAt={ok.computed_at} slaMinutes={FRESHNESS_SLA_MINUTES} realClock />
            </span>
          </div>

          {lowCoverage && (
            <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              Only {(identityShare * 100).toFixed(1)}% of orders resolve to a customer identity; movement counts understate the base. Treat the numbers as qualified.
            </p>
          )}
          {!reconciles && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Reconciliation check failed for at least one period (closing ≠ opening + new + reactivated − lapsed). Do not act on these numbers; the refresh needs review.
            </p>
          )}

          {focus ? (
            <>
              <div className="text-xs text-muted-foreground">
                Cards: <span className="font-medium text-foreground">{periodLabel(focus, controls.grain)}</span>
                {!focus.is_complete && <span> — period in progress; closing figures move until it ends.</span>}
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <MovementCard label={MOVEMENT_MEASURE_LABELS.opening} value={n(focus.opening_active)} sub="active or at risk at period start" definition="Customers whose lifecycle state was active or at risk at the period's first instant (Asia/Kuala_Lumpur)." onClick={() => open(focus, "opening")} />
                <MovementCard label={MOVEMENT_MEASURE_LABELS.new} value={n(focus.new_customers)} sub={`${n(focus.new_accepted)} accepted-new`} tone="success" definition="First delivered (or store-completed) qualifying purchase in the period. The sub-line counts first accepted orders instead — the acquisition lens." onClick={() => open(focus, "new")} />
                <MovementCard label={MOVEMENT_MEASURE_LABELS.reactivated} value={n(focus.reactivated)} sub="lapsed → active" tone="info" definition="Customers who were lapsed and made a qualifying purchase in the period. A transition, not a standing tag." onClick={() => open(focus, "reactivated")} />
                <MovementCard label={MOVEMENT_MEASURE_LABELS.lapsed} value={n(focus.lapsed)} sub={`${n(focus.at_risk_closing)} at risk at close`} tone="destructive" definition="Customers who crossed the lapse threshold during the period. They remain customers; lapse is a state, not deletion." onClick={() => open(focus, "lapsed")} />
                <MovementCard label={MOVEMENT_MEASURE_LABELS.closing} value={n(focus.closing_active)} sub={`${n(focus.retained)} retained from opening`} definition="Active or at-risk customers at the period's end (or now, for a period in progress). Equals opening + new + reactivated − lapsed ± corrections." onClick={() => open(focus, "closing")} />
                <MovementCard
                  label="Net active rate"
                  value={pct(focus.net_active_rate)}
                  sub={focus.rate_applicable ? `${focus.net_active_change >= 0 ? "+" : "−"}${n(Math.abs(focus.net_active_change))} net` : "opening base is zero"}
                  tone={focus.rate_applicable ? (focus.net_active_change >= 0 ? "success" : "destructive") : "neutral"}
                  definition="(new + reactivated − lapsed) ÷ opening active base. Not applicable when the opening base is zero — never shown as 0%."
                />
              </div>
            </>
          ) : (
            <EmptyState title="No periods in range" description="The selected range holds no computed periods for this scope." />
          )}

          <div className="grid gap-4 xl:grid-cols-5">
            <Card className="xl:col-span-3">
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-medium">Movement — additions above, lapses below, net as a line</CardTitle>
                <span className="text-[11px] text-muted-foreground">click a bar to open the exact population</span>
              </CardHeader>
              <CardContent>
                {showTable ? <PeriodTable periods={periods} grain={controls.grain} onSelect={open} /> : <MovementChart periods={periods} grain={controls.grain} onSelect={open} />}
              </CardContent>
            </Card>
            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle className="text-sm font-medium">Active base — stock, kept apart from flow</CardTitle>
              </CardHeader>
              <CardContent>
                <BaseTrendChart periods={periods} grain={controls.grain} />
              </CardContent>
            </Card>
          </div>

          <DefinitionPanel movement={ok} />
        </div>
      ) : null}

      <PopulationSheet target={target} grain={controls.grain} brandId={brandId} integrationIn={integrationIn} brands={brands} onClose={() => setTarget(null)} />
    </PageBody>
  );
}

function PeriodTable({ periods, grain, onSelect }: { periods: MovementPeriod[]; grain: "month" | "week"; onSelect: (p: MovementPeriod, m: MovementMeasure) => void }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <caption className="sr-only">Customer base movement by period</caption>
        <thead className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="py-1.5 pr-2 font-medium">Period</th>
            <th className="py-1.5 pr-2 text-right font-medium">Opening</th>
            <th className="py-1.5 pr-2 text-right font-medium">New</th>
            <th className="py-1.5 pr-2 text-right font-medium">Reactivated</th>
            <th className="py-1.5 pr-2 text-right font-medium">Lapsed</th>
            <th className="py-1.5 pr-2 text-right font-medium">Retained</th>
            <th className="py-1.5 pr-2 text-right font-medium">Closing</th>
            <th className="py-1.5 pr-2 text-right font-medium">Net</th>
            <th className="py-1.5 text-right font-medium">Rate</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {periods.map((p) => (
            <tr key={p.period_start} className={cn(!p.is_complete && "text-muted-foreground")}>
              <td className="py-1.5 pr-2">{periodLabel(p, grain)}{!p.is_complete && " *"}</td>
              <td className="tnum py-1.5 pr-2 text-right"><button type="button" className="underline-offset-2 hover:underline" onClick={() => onSelect(p, "opening")}>{n(p.opening_active)}</button></td>
              <td className="tnum py-1.5 pr-2 text-right"><button type="button" className="underline-offset-2 hover:underline" onClick={() => onSelect(p, "new")}>{n(p.new_customers)}</button></td>
              <td className="tnum py-1.5 pr-2 text-right"><button type="button" className="underline-offset-2 hover:underline" onClick={() => onSelect(p, "reactivated")}>{n(p.reactivated)}</button></td>
              <td className="tnum py-1.5 pr-2 text-right"><button type="button" className="underline-offset-2 hover:underline" onClick={() => onSelect(p, "lapsed")}>{n(p.lapsed)}</button></td>
              <td className="tnum py-1.5 pr-2 text-right"><button type="button" className="underline-offset-2 hover:underline" onClick={() => onSelect(p, "retained")}>{n(p.retained)}</button></td>
              <td className="tnum py-1.5 pr-2 text-right"><button type="button" className="underline-offset-2 hover:underline" onClick={() => onSelect(p, "closing")}>{n(p.closing_active)}</button></td>
              <td className="tnum py-1.5 pr-2 text-right">{p.net_active_change >= 0 ? "+" : "−"}{n(Math.abs(p.net_active_change))}</td>
              <td className="tnum py-1.5 text-right">{pct(p.net_active_rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-muted-foreground">* period in progress</p>
    </div>
  );
}

function DefinitionPanel({ movement }: { movement: Extract<ReturnType<typeof useCustomerBase>["movement"], { status: "ok" }> }) {
  const c = movement.coverage;
  const reasons = Object.entries(c.orders_excluded_by_reason).filter(([k]) => k !== "qualifies").sort(([, a], [, b]) => b - a);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">Definition, freshness and coverage</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-xs md:grid-cols-3">
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Policy v{movement.policy.version} ({movement.policy.status})</p>
          <p>Qualifying event: <span className="font-medium">{movement.policy.qualifying_event.replaceAll("_", " ")}</span></p>
          <p>Lapse method: {movement.policy.lapse_method} · threshold {movement.policy.threshold_days} days · at risk from day {movement.policy.at_risk_days}</p>
          <p>Valid from {movement.policy.valid_from} · business day {movement.timezone}</p>
          {movement.policy.note && <p className="text-muted-foreground">{movement.policy.note}</p>}
          <p className="text-muted-foreground">Reconciliation: closing = opening + new + reactivated − lapsed ± corrections. Corrections are {c.identity_corrections_tracked ? "tracked" : "not tracked yet (always 0)"}.</p>
        </div>
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Coverage</p>
          <p className="tnum">Orders {n(c.orders_total)} · with identity {n(c.orders_with_identity)} ({((c.orders_with_identity / Math.max(c.orders_total, 1)) * 100).toFixed(1)}%)</p>
          <p className="tnum">Qualifying for lifecycle {n(c.orders_qualifying_lifecycle)} · for acquisition {n(c.orders_qualifying_acceptance)}</p>
          <p className="tnum">Customers {n(c.customers_total)} · with a qualifying purchase {n(c.customers_with_lifecycle_purchase)}</p>
          <p className="tnum">Delivery evidence: {Object.entries(c.delivered_evidence).map(([k, v]) => `${k.replaceAll("_", " ")} ${n(v)}`).join(" · ")}</p>
        </div>
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Excluded orders</p>
          <ul className="space-y-0.5">
            {reasons.map(([k, v]) => (
              <li key={k} className="flex justify-between gap-2"><span>{k.replaceAll("_", " ")}</span><span className="tnum">{n(v)}</span></li>
            ))}
          </ul>
          <p className="pt-1 text-muted-foreground">{c.note}</p>
        </div>
      </CardContent>
    </Card>
  );
}

export default function CustomerBasePage() {
  return (
    <LiveGuard>
      <RouteGuard permission="customers.view">
        <CustomerBaseInner />
      </RouteGuard>
    </LiveGuard>
  );
}
