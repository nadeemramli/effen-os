"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartCard, ChartCardSkeleton } from "@/components/charts/chart-card";
import {
  ChartLegend,
  ContributionBridge,
  MarginTrend,
  type BridgeStep,
  type MarginDatum,
} from "@/components/charts/commercial-charts";
import { MetricCard, MetricCardSkeleton } from "@/components/metrics/metric-card";
import { ErrorState, RefreshChip, SkeletonTable } from "@/components/states";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { LiveGuard } from "@/components/auth/live-guard";
import { useLiveQuery } from "@/hooks/use-live-query";
import { useSession } from "@/hooks/use-session";
import {
  fetchContributionRange,
  fetchGrowthAds,
  fetchLiveBrands,
  type ContributionRow,
  type GrowthAds,
  type LiveBrand,
  type LiveContribution,
} from "@/lib/supabase/live";
import { rangeBounds, rangeDays, rangeLabel } from "@/lib/store";
import { formatMoney, formatPercent } from "@/lib/domain/money";
import { FX_TO_MYR, toMYR } from "@/lib/domain/metrics";
import { RouteGuard } from "@/lib/rbac/guard";
import { useAppStore } from "@/lib/store/provider";
import { formatDateTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

/* ---------- period buckets for the trend ---------- */

type Bucket = { key: string; label: string; from: string; to: string };

const MS_DAY = 86_400_000;
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const noon = (iso: string) => Date.parse(`${iso}T12:00:00Z`);
const shortDay = (iso: string) =>
  new Date(noon(iso)).toLocaleDateString("en-MY", { day: "numeric", month: "short", timeZone: "UTC" });
const shortMonth = (iso: string) =>
  new Date(noon(iso)).toLocaleDateString("en-MY", { month: "short", year: "2-digit", timeZone: "UTC" });

/**
 * Split an inclusive ISO date range into ≤ ~14 buckets: days for ≤14d,
 * ISO weeks (Mon–Sun) for ≤98d, calendar months beyond. Each bucket is one
 * live_contribution_range call, so the trend costs at most 14 cheap sums.
 */
function bucketRange(from: string, to: string): Bucket[] {
  const span = Math.round((noon(to) - noon(from)) / MS_DAY) + 1;
  const out: Bucket[] = [];
  if (span <= 14) {
    for (let t = noon(from); t <= noon(to); t += MS_DAY) {
      const d = isoDay(t);
      out.push({ key: d, label: shortDay(d), from: d, to: d });
    }
    return out;
  }
  if (span <= 98) {
    let cur = noon(from);
    while (cur <= noon(to)) {
      const dow = (new Date(cur).getUTCDay() + 6) % 7; // Mon=0
      const weekEnd = Math.min(cur + (6 - dow) * MS_DAY, noon(to));
      const a = isoDay(cur), b = isoDay(weekEnd);
      out.push({ key: a, label: `wk ${shortDay(a)}`, from: a, to: b });
      cur = weekEnd + MS_DAY;
    }
    return out;
  }
  let cur = noon(from);
  while (cur <= noon(to)) {
    const d = new Date(cur);
    const monthEnd = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0, 12);
    const a = isoDay(cur), b = isoDay(Math.min(monthEnd, noon(to)));
    out.push({ key: a, label: shortMonth(a), from: a, to: b });
    cur = monthEnd + MS_DAY;
  }
  return out;
}

/* ---------- P&L arithmetic (identical to Marketing — numbers never disagree) ---------- */

interface PnL {
  orders: number;
  codOrders: number;
  revenue: number;
  cogs: number;
  delivery: number;
  returns: number;
  cod: number;
  rtsParcels: number;
  spend: number;
  wht: number;
  cm2: number;
  cm3: number;
  coverage: number;
  mappedUnits: number;
  unmappedLines: number;
}

function pnl(rows: ContributionRow[], spend: number, whtRate: number): PnL {
  const sum = (f: (r: ContributionRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const revenue = sum((r) => toMYR(Number(r.revenue), r.currency_code));
  const cogs = sum((r) => Number(r.cogs_myr));
  const delivery = sum((r) => Number(r.delivery_myr));
  const returns = sum((r) => Number(r.returns_myr));
  const cod = sum((r) => Number(r.cod_myr));
  const mappedUnits = sum((r) => Number(r.base_units));
  const unmappedLines = sum((r) => Number(r.unmapped_lines));
  const wht = spend * whtRate;
  // CM2 = revenue − COGS − fulfilment (delivery, return legs, COD fees);
  // CM3 = CM2 − ads − WHT. NOT net profit — fixed costs are not modelled.
  const cm2 = revenue - cogs - delivery - returns - cod;
  const cm3 = cm2 - spend - wht;
  return {
    orders: sum((r) => Number(r.orders)),
    codOrders: sum((r) => Number(r.cod_orders)),
    revenue, cogs, delivery, returns, cod,
    rtsParcels: sum((r) => Number(r.rts_parcels)),
    spend, wht, cm2, cm3,
    coverage: mappedUnits + unmappedLines > 0 ? mappedUnits / (mappedUnits + unmappedLines) : 0,
    mappedUnits, unmappedLines,
  };
}

/** House rule: no margin math on thin data — CM lines need ≥90% SKU-mapping coverage. */
const COVERAGE_GATE = 0.9;
const rm = (v: number) => formatMoney(Math.round(v) * 100, "MYR", { compact: true });
/** Whole-ringgit table cell — cents are noise at P&L altitude. */
const rmFull = (v: number) => `RM${Math.round(Math.abs(v)).toLocaleString("en-MY")}`;
const rmSigned = (v: number, full = false) => `${v < 0 ? "−" : ""}${full ? rmFull(v) : rm(Math.abs(v))}`;

type Data = {
  contribution: LiveContribution;
  ads: GrowthAds | null;
  brands: LiveBrand[];
  buckets: { bucket: Bucket; contribution: LiveContribution }[];
};

function ProfitInner() {
  const session = useSession();
  const liveBrandId = useAppStore((s) => s.session.liveBrandId);
  const liveMarkets = useAppStore((s) => s.session.liveMarkets);

  const bounds = rangeBounds(session.dateRange, session.customRange);
  const days = rangeDays(session.dateRange, session.customRange);
  const label = rangeLabel(session.dateRange, session.customRange);

  const { data, error, loading, refreshing, reload } = useLiveQuery<Data>(async () => {
    const buckets = bucketRange(bounds.from, bounds.to);
    // Warehouse ad window must reach the range start (max 400d).
    const fetchDays = Math.min(400, Math.max(1, Math.round((Date.now() - noon(bounds.from)) / MS_DAY) + 1));
    const [contribution, ads, brands, ...perBucket] = await Promise.all([
      fetchContributionRange(bounds.from, bounds.to),
      fetchGrowthAds(fetchDays).catch(() => null),
      fetchLiveBrands(),
      ...buckets.map((b) => fetchContributionRange(b.from, b.to).catch(() => ({ rules: null, rows: [] }) as LiveContribution)),
    ]);
    return { contribution, ads, brands, buckets: buckets.map((bucket, i) => ({ bucket, contribution: perBucket[i] })) };
  }, [bounds.from, bounds.to]);

  const view = useMemo(() => {
    if (!data) return null;
    const { contribution, ads, brands } = data;
    const whtRate = Number(contribution.rules?.wht_rate ?? 0.08);
    const scopeSlug = liveBrandId === null ? null : (brands.find((b) => b.id === liveBrandId)?.slug ?? null);
    const scopeBrandIds = scopeSlug === null ? null : new Set(brands.filter((b) => b.slug === scopeSlug).map((b) => b.id));
    const rowOk = (r: ContributionRow) =>
      (scopeBrandIds === null || (r.brand_id !== null && scopeBrandIds.has(r.brand_id))) &&
      (liveMarkets.length === 0 || liveMarkets.includes(r.market));
    const adOk = (slug: string | null, mkt: string | null) =>
      (scopeSlug === null || slug === scopeSlug) && (liveMarkets.length === 0 || liveMarkets.includes(mkt ?? ""));

    // Ad spend from the warehouse trend, windowed to the range and scope.
    const trend = (ads?.trend ?? []).filter((t) => adOk(t.brand_slug, t.market));
    const spendIn = (from: string, to: string) =>
      trend.filter((t) => t.date >= from && t.date <= to).reduce((s, t) => s + Number(t.spend), 0);

    const rows = contribution.rows.filter(rowOk);
    const total = pnl(rows, spendIn(bounds.from, bounds.to), whtRate);

    // Brand × market table — every combination in the window, scope still applies.
    const bySlug = new Map<string, LiveBrand>();
    for (const b of brands) bySlug.set(b.slug, b);
    const spendByKey = new Map<string, number>();
    for (const t of trend) {
      if (t.date < bounds.from || t.date > bounds.to) continue;
      const brand = t.brand_slug ? bySlug.get(t.brand_slug) : undefined;
      const k = `${brand?.id ?? "null"}|${t.market ?? "—"}`;
      spendByKey.set(k, (spendByKey.get(k) ?? 0) + Number(t.spend));
    }
    const groups = new Map<string, { brandId: number | null; market: string; rows: ContributionRow[] }>();
    for (const r of rows) {
      const k = `${r.brand_id ?? "null"}|${r.market}`;
      const g = groups.get(k) ?? { brandId: r.brand_id, market: r.market, rows: [] };
      g.rows.push(r);
      groups.set(k, g);
    }
    const table = [...groups.entries()]
      .map(([k, g]) => {
        const p = pnl(g.rows, spendByKey.get(k) ?? 0, whtRate);
        const brand = g.brandId === null ? null : brands.find((b) => b.id === g.brandId);
        return { key: k, brand: brand?.name ?? (g.brandId === null ? "Unattributed" : `Brand ${g.brandId}`), market: g.market, ...p };
      })
      .sort((a, b) => b.revenue - a.revenue);
    const unattributedSpend = [...spendByKey.entries()]
      .filter(([k]) => !groups.has(k))
      .reduce((s, [, v]) => s + v, 0);

    // Trend by bucket (scope applied per bucket).
    const trendData: MarginDatum[] = data.buckets.map(({ bucket, contribution: c }) => {
      const p = pnl(c.rows.filter(rowOk), spendIn(bucket.from, bucket.to), Number(c.rules?.wht_rate ?? whtRate));
      const gated = p.coverage >= COVERAGE_GATE && p.revenue > 0;
      return {
        label: bucket.label,
        revenue: Math.round(p.revenue) * 100,
        cm2: gated ? Math.round(p.cm2) * 100 : null,
        cm3: gated ? Math.round(p.cm3) * 100 : null,
      };
    });

    const bridge: BridgeStep[] = [
      { label: "Revenue", value: Math.round(total.revenue) * 100, kind: "total" },
      { label: "COGS", value: Math.round(total.cogs) * 100, kind: "cost" },
      { label: "Delivery", value: Math.round(total.delivery) * 100, kind: "cost" },
      { label: "Returns", value: Math.round(total.returns) * 100, kind: "cost" },
      { label: "COD fees", value: Math.round(total.cod) * 100, kind: "cost" },
      { label: "CM2", value: Math.round(total.cm2) * 100, kind: "subtotal" },
      { label: "Ad spend", value: Math.round(total.spend) * 100, kind: "cost" },
      { label: "WHT", value: Math.round(total.wht) * 100, kind: "cost" },
      { label: "CM3", value: Math.round(total.cm3) * 100, kind: "subtotal" },
    ];

    const currencies = new Set(rows.map((r) => r.currency_code));
    return {
      total, table, trendData, bridge, unattributedSpend, whtRate,
      gated: total.coverage >= COVERAGE_GATE && total.revenue > 0,
      mixedCurrency: currencies.size > 1,
      adsMissing: ads === null,
      rules: contribution.rules,
      refreshedAt: contribution.refreshed_at ?? null,
      rtsLinked: Number(contribution.rts_linked_parcels ?? 0),
      rtsUnlinked: Number(contribution.rts_unlinked_parcels ?? 0),
    };
  }, [data, liveBrandId, liveMarkets, bounds.from, bounds.to]);

  const gateHint = view && !view.gated
    ? view.total.revenue === 0
      ? "No recognized orders in this window"
      : `Needs ≥90% SKU-mapping coverage (now ${formatPercent(view.total.coverage, 0)})`
    : null;

  return (
    <PageBody className="max-w-none">
      <PageHeader
        title="Profit"
        description={`Contribution P&L · ${label} · MYR · CM3 = revenue − COGS − fulfilment − ads − WHT — not net profit`}
      >
        {refreshing && <RefreshChip />}
        {view?.refreshedAt && (
          <Badge variant="outline" className="h-6 gap-1 text-xs font-normal text-muted-foreground">
            Orders as of {formatDateTime(view.refreshedAt)}
          </Badge>
        )}
        <Badge variant="outline" className="h-6 text-xs font-normal">Live · read-only</Badge>
      </PageHeader>

      {error ? (
        <ErrorState title="Could not load the P&L" description={error} retry={reload} />
      ) : loading || !view ? (
        <>
          <section aria-label="Loading P&L" role="status" className="grid grid-cols-2 gap-3 lg:grid-cols-4 2xl:grid-cols-7">
            {Array.from({ length: 7 }).map((_, i) => <MetricCardSkeleton key={i} />)}
          </section>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCardSkeleton /><ChartCardSkeleton />
          </div>
          <SkeletonTable rows={6} />
        </>
      ) : (
        <>
          {view.adsMissing && (
            <p className="rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-xs text-warning">
              Warehouse ad spend is unavailable right now — CM3 below equals CM2 until it returns.
            </p>
          )}

          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4 2xl:grid-cols-7">
            <MetricCard
              metricKey="revenue"
              label="Net revenue"
              value={rm(view.total.revenue)}
              hint={`${view.total.orders.toLocaleString()} orders · ${view.total.orders > 0 ? formatPercent(view.total.codOrders / view.total.orders, 0) : "—"} COD`}
              info={{
                title: "Net revenue",
                formula: "Order totals for recognized orders (processing + completed) in the window and scope, MYT business days.",
                source: "Order tables (live_contribution_range)",
                caveat: view.mixedCurrency ? `Mixed currencies converted at the app's display rate (SGD ×${FX_TO_MYR.SGD}) — pick one market for a pure-currency P&L.` : undefined,
              }}
            />
            <MetricCard
              metricKey="contribution"
              label="COGS"
              value={view.total.revenue > 0 ? rm(view.total.cogs) : "—"}
              hint={`${formatPercent(view.total.coverage, 0)} SKU coverage · RM ${view.rules?.unit_cost_myr ?? 7}/unit`}
              info={{
                title: "Cost of goods",
                formula: "Pack-expanded units × Finance unit cost rule. Unmapped SKUs contribute no units, so low coverage understates COGS — hence the ≥90% gate on CM lines.",
                source: "Order items × variant aliases × pack sizes × contribution_cost_rules",
              }}
            />
            <MetricCard
              metricKey="contribution"
              label="Fulfilment"
              value={view.total.revenue > 0 ? rm(view.total.delivery + view.total.returns + view.total.cod) : "—"}
              hint={`Delivery ${rm(view.total.delivery)} · returns ${rm(view.total.returns)} · COD ${rm(view.total.cod)}`}
              info={{
                title: "Fulfilment cost",
                formula: `One parcel per recognized order at the zone rate (west RM ${view.rules?.delivery_my_west ?? 8.5} · east RM ${view.rules?.delivery_my_east ?? 15} · SG RM ${view.rules?.delivery_sg_myr ?? 35}); returns = Ninja Van returned-to-sender parcels × blended zone rate (${Math.round(view.total.rtsParcels).toLocaleString()} parcels in window: ${view.rtsLinked.toLocaleString()} linked to an order, ${view.rtsUnlinked.toLocaleString()} allocated to MY brands by order share); COD = COD orders × RM ${view.rules?.cod_fee ?? 5}.`,
                source: "Orders (zone by postcode, COD by payment method) + Ninja Van RTS events (first \"Returned to Sender\" per parcel) + Finance cost rules",
                caveat: "Parcels are Fighter-booked, so most carry no store order: their return cost is allocated across MY brands by order share until Fullkit books Ninja Van itself. SG returns have no courier feed yet.",
              }}
            />
            <MetricCard
              metricKey="contribution"
              label="Contribution before ads (CM2)"
              value={view.gated ? rmSigned(view.total.cm2) : "—"}
              hint={view.gated ? `CM2 margin ${formatPercent(view.total.cm2 / view.total.revenue, 0)}` : gateHint ?? ""}
              info={{
                title: "Contribution before ads (CM2)",
                formula: "Net revenue − COGS − delivery − returns − COD fees. What each order earns after making and delivering it, before any marketing.",
                source: "Orders + Finance cost rules + NinjaVan RTS parcels",
                caveat: "CM2 is the ceiling ads can spend into before the P&L goes negative.",
              }}
            />
            <MetricCard
              metricKey="ad_spend"
              label="Ad spend + WHT"
              value={rm(view.total.spend + view.total.wht)}
              hint={`Spend ${rm(view.total.spend)} · WHT ${formatPercent(view.whtRate, 0)} = ${rm(view.total.wht)}`}
              info={{
                title: "Advertising cost",
                formula: "Warehouse ad spend (all platforms) in the window and scope, plus withholding tax at the Finance rate on foreign-platform spend.",
                source: "Warehouse pipeline (ADR-0003) + contribution_cost_rules",
                caveat: view.unattributedSpend > 0 ? `${rm(view.unattributedSpend)} of spend has no matching brand × market row and is counted only in the total.` : undefined,
              }}
            />
            <MetricCard
              metricKey="contribution"
              label="Contribution after ads (CM3)"
              value={view.gated ? rmSigned(view.total.cm3) : "—"}
              hint={view.gated ? `CM3 margin ${formatPercent(view.total.cm3 / view.total.revenue, 0)} · before fixed costs` : gateHint ?? ""}
              info={{
                title: "Contribution after ads (CM3)",
                formula: "CM2 − ad spend − WHT. The closest thing to operating profit the data can support today.",
                source: "Orders + cost rules + RTS parcels + warehouse ad spend",
                caveat: "Fixed costs (payroll, rent, tools), payment-gateway fees, marketplace commissions and email/SMS costs are not modelled — this is contribution, not net profit.",
              }}
            />
            <MetricCard
              metricKey="contribution"
              label="Ads share of CM2"
              value={view.gated && view.total.cm2 > 0 ? formatPercent((view.total.spend + view.total.wht) / view.total.cm2, 0) : "—"}
              hint={view.gated && view.total.cm2 > 0 ? "of the pre-ads margin spent on ads" : gateHint ?? "CM2 not positive"}
              info={{
                title: "Ads share of CM2",
                formula: "(Ad spend + WHT) ÷ CM2. Above 100% means marketing consumed more than the orders earned after variable costs.",
                source: "Derived from the cards to the left",
              }}
            />
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard
              title="Contribution bridge"
              subtitle={view.gated ? `Revenue to CM3 · ${label} · MYR` : `Revenue and costs · ${label} · CM lines gated: ${gateHint}`}
            >
              <ContributionBridge steps={view.bridge} currencyLabel="RM " />
            </ChartCard>
            <ChartCard
              title="Margin by period"
              subtitle={days <= 14 ? "Daily" : days <= 98 ? "Weekly (Mon–Sun)" : "Monthly"}
              right={<ChartLegend items={[{ label: "Revenue", color: "var(--chart-1)" }, { label: "CM2", color: "var(--chart-2)" }, { label: "CM3", color: "var(--success)" }]} />}
            >
              <MarginTrend data={view.trendData} currencyLabel="RM " />
            </ChartCard>
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-sm font-medium">P&L by brand × market</CardTitle>
              <span className="text-xs text-muted-foreground">CM lines render per row only at ≥90% SKU coverage</span>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b [&>th]:px-3 [&>th]:py-2 [&>th]:text-right [&>th:first-child]:text-left [&>th:nth-child(2)]:text-left">
                    <th>Brand</th><th>Market</th><th>Orders</th><th>Revenue</th><th>COGS</th><th>Delivery</th><th>Returns</th><th>COD</th>
                    <th>CM2</th><th>Ads + WHT</th><th>CM3</th><th>CM3 %</th><th>Coverage</th>
                  </tr>
                </thead>
                <tbody>
                  {view.table.length === 0 && (
                    <tr><td colSpan={13} className="px-3 py-8 text-center text-muted-foreground">No recognized orders in this window and scope.</td></tr>
                  )}
                  {view.table.map((r) => {
                    const ok = r.coverage >= COVERAGE_GATE && r.revenue > 0;
                    return (
                      <tr key={r.key} className="border-b last:border-0 [&>td]:px-3 [&>td]:py-2 [&>td]:text-right [&>td:first-child]:text-left [&>td:nth-child(2)]:text-left tnum">
                        <td className="font-medium text-foreground">{r.brand}</td>
                        <td>{r.market}</td>
                        <td>{r.orders.toLocaleString()}</td>
                        <td>{rmFull(r.revenue)}</td>
                        <td>{rmFull(r.cogs)}</td>
                        <td>{rmFull(r.delivery)}</td>
                        <td>{rmFull(r.returns)}</td>
                        <td>{rmFull(r.cod)}</td>
                        <td className={cn(ok && r.cm2 < 0 && "text-destructive")}>{ok ? rmSigned(r.cm2, true) : "—"}</td>
                        <td>{rmFull(r.spend + r.wht)}</td>
                        <td className={cn("font-medium", ok && (r.cm3 < 0 ? "text-destructive" : "text-success"))}>{ok ? rmSigned(r.cm3, true) : "—"}</td>
                        <td>{ok ? formatPercent(r.cm3 / r.revenue, 0) : "—"}</td>
                        <td className={cn(r.coverage < COVERAGE_GATE && "text-warning")}>{formatPercent(r.coverage, 0)}</td>
                      </tr>
                    );
                  })}
                  {view.unattributedSpend > 0 && (
                    <tr className="border-t [&>td]:px-3 [&>td]:py-2 [&>td]:text-right [&>td:first-child]:text-left [&>td:nth-child(2)]:text-left tnum text-muted-foreground">
                      <td className="italic">Ads without a matching brand × market</td>
                      <td>—</td><td /><td /><td /><td /><td /><td /><td />
                      <td>{rmFull(view.unattributedSpend * (1 + view.whtRate))}</td>
                      <td colSpan={3} className="text-left italic">counted in the total CM3 only</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm font-medium">How this is computed</CardTitle></CardHeader>
            <CardContent className="grid gap-4 text-xs text-muted-foreground md:grid-cols-2">
              <div className="space-y-1.5">
                <p className="font-medium text-foreground">Modelled (live)</p>
                <p>Revenue and orders from the order mirror (recognized = processing + completed), MYT business days. COGS = pack-expanded units × RM {view.rules?.unit_cost_myr ?? 7}. Delivery: one parcel per order at west RM {view.rules?.delivery_my_west ?? 8.5} / east RM {view.rules?.delivery_my_east ?? 15} / SG RM {view.rules?.delivery_sg_myr ?? 35}. Returns: NinjaVan RTS parcels × blended zone rate. COD: RM {view.rules?.cod_fee ?? 5} per COD order. Ads: warehouse spend, all platforms, plus {formatPercent(view.whtRate, 0)} WHT. Rules effective {view.rules?.effective_from ?? "—"}{view.rules?.note ? ` — ${view.rules.note}` : ""}.</p>
                <p>Same arithmetic as the <Link href="/marketing" className="text-info underline-offset-2 hover:underline">Marketing</Link> CM cards and the Customer 360 contribution card, so the three never disagree.</p>
              </div>
              <div className="space-y-1.5">
                <p className="font-medium text-foreground">Out of scope by design</p>
                <p>This is contribution, not net profit. Fixed costs (payroll, rent, tools) live with Finance and are not modelled here. Payment-gateway fees and marketplace commissions will be added when a marketplace is connected and settlement data lands.</p>
                <ul className="list-disc space-y-1 pl-4">
                  <li>Returns count Ninja Van &quot;Returned to Sender&quot; parcels; most are Fighter-booked with no store order, so their cost is allocated to MY brands by order share (labelled in the Fulfilment card). SG returns have no courier feed.</li>
                  <li>Pack sizes default to 1 until set, which understates COGS.</li>
                  <li>SGD is converted at a fixed display rate (×{FX_TO_MYR.SGD}); pick one market for a pure-currency P&L.</li>
                  <li>Cost rules are edited in SQL today (<code>save_contribution_rules</code>).</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </PageBody>
  );
}

export default function ProfitPage() {
  return (
    <RouteGuard permission="reports.view">
      <LiveGuard>
        <ProfitInner />
      </LiveGuard>
    </RouteGuard>
  );
}
