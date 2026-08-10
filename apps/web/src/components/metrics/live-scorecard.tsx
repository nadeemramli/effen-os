"use client";

import { useEffect, useState } from "react";
import { MetricCard, MetricCardSkeleton } from "@/components/metrics/metric-card";
import { useAppStore } from "@/lib/store/provider";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  fetchCommerceRange,
  fetchGrowthAds,
  fetchLiveBrands,
  fetchLivePlanBaseline,
  fetchLiveScorecard,
  fetchLiveUnitEconomics,
  type GrowthAds,
  type LiveBrand,
  type LiveCommerceRangeRow,
  type LivePlanBaselineRow,
  type LiveScorecardRow,
  type LiveUnitEconRow,
} from "@/lib/supabase/live";
import { rangeBounds, rangeLabel } from "@/lib/store";

/**
 * The original seven-card commercial scorecard, fed by the live mirror when a
 * real session exists (the demo scorecard is the signed-out fallback). Cards
 * whose sources are not yet connected say so instead of faking numbers.
 * Classic windows (Today / 7d / 30d) use the fixed-window RPCs and their
 * 4-week baseline; extended windows (90d / 12 months / custom) use the
 * range RPC — baseline and item-level contribution honestly bow out there.
 * Ad spend always comes from the warehouse trend (server-aggregated — the
 * old raw ad_daily_facts select silently truncated at 1,000 rows).
 */

type State =
  | { kind: "checking" }
  | { kind: "no-session" }
  | {
      kind: "ready";
      rows: LiveScorecardRow[];
      brands: LiveBrand[];
      baseline: LivePlanBaselineRow[];
      econ: LiveUnitEconRow[];
      ads: GrowthAds | null;
      commerce: LiveCommerceRangeRow[];
    }
  | { kind: "error"; message: string };

function money(currency: string, n: number): string {
  const compact = n >= 100_000 ? `${(n / 1000).toFixed(0)}k` : n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(0);
  return `${currency === "MYR" ? "RM" : currency === "SGD" ? "S$" : currency} ${compact}`;
}

function ccyLine(byCcy: Record<string, number>): string {
  const parts = Object.entries(byCcy)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([c, v]) => money(c, v));
  return parts.length > 0 ? parts.join(" + ") : "—";
}

const CLASSIC = new Set(["today", "7d", "30d"]);

export function LiveScorecard({ fallback }: { fallback: React.ReactNode }) {
  const [state, setState] = useState<State>({ kind: "checking" });
  const liveBrandId = useAppStore((s) => s.session.liveBrandId);
  const liveMarkets = useAppStore((s) => s.session.liveMarkets);
  const dateRange = useAppStore((s) => s.session.dateRange);
  const customRange = useAppStore((s) => s.session.customRange);

  const classic = CLASSIC.has(dateRange);
  const bounds = rangeBounds(dateRange, customRange);

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ kind: "no-session" });
      return;
    }
    void (async () => {
      const { data } = await getSupabase().auth.getSession();
      if (!data.session) {
        setState({ kind: "no-session" });
        return;
      }
      try {
        const [rows, brands, baseline, econ, ads, commerce] = await Promise.all([
          fetchLiveScorecard(),
          fetchLiveBrands(),
          fetchLivePlanBaseline(),
          fetchLiveUnitEconomics(),
          fetchGrowthAds(400).catch(() => null),
          classic
            ? Promise.resolve([] as LiveCommerceRangeRow[])
            : fetchCommerceRange(bounds.from, bounds.to).catch(() => [] as LiveCommerceRangeRow[]),
        ]);
        setState({ kind: "ready", rows, brands: brands.filter((b) => b.status === "active"), baseline, econ, ads, commerce });
      } catch (e) {
        setState({ kind: "error", message: (e as Error).message });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateRange, customRange]);

  if (state.kind === "no-session" || state.kind === "error") return <>{fallback}</>;
  if (state.kind === "checking") {
    return (
      <section
        aria-label="Commercial scorecard"
        role="status"
        className="grid grid-cols-2 gap-3 lg:grid-cols-4 2xl:grid-cols-7"
      >
        {Array.from({ length: 7 }, (_, i) => (
          <MetricCardSkeleton key={i} />
        ))}
      </section>
    );
  }

  const win = dateRange === "today" ? "today" : dateRange === "7d" ? "d7" : "d30";
  const scopeSlug =
    liveBrandId === null ? null : (state.brands.find((b) => b.id === liveBrandId)?.slug ?? null);

  // Revenue + orders: classic windows from the fixed-window RPC (baseline
  // pairing), extended windows from the range RPC.
  const byCcy: Record<string, number> = {};
  let orders = 0;
  if (classic) {
    for (const r of state.rows) {
      if (r.win !== win) continue;
      if (liveBrandId !== null && r.brand_id !== liveBrandId) continue;
      if (liveMarkets.length > 0 && !liveMarkets.includes(r.market)) continue;
      orders += Number(r.orders);
      byCcy[r.currency_code] = (byCcy[r.currency_code] ?? 0) + Number(r.revenue);
    }
  } else {
    for (const r of state.commerce) {
      if (liveBrandId !== null && r.brand_id !== liveBrandId) continue;
      if (liveMarkets.length > 0 && !liveMarkets.includes(r.market)) continue;
      orders += Number(r.orders);
      byCcy[r.currency_code] = (byCcy[r.currency_code] ?? 0) + Number(r.revenue);
    }
  }

  // Ad spend from the warehouse trend, scoped and windowed (server-side
  // aggregates — no row caps). Brand scope maps through the slug.
  let adSpend = 0;
  for (const t of state.ads?.trend ?? []) {
    if (t.date < bounds.from || t.date > bounds.to) continue;
    if (scopeSlug !== null && t.brand_slug !== scopeSlug) continue;
    if (liveMarkets.length > 0 && !liveMarkets.includes(t.market ?? "")) continue;
    adSpend += Number(t.spend);
  }

  // Baseline expectation exists for classic windows only.
  const expByCcy: Record<string, number> = {};
  let expOrders = 0;
  if (classic) {
    for (const r of state.baseline) {
      if (r.win !== win) continue;
      if (liveBrandId !== null && r.brand_id !== liveBrandId) continue;
      if (liveMarkets.length > 0 && !liveMarkets.includes(r.market)) continue;
      expOrders += Number(r.expected_orders);
      expByCcy[r.currency_code] = (expByCcy[r.currency_code] ?? 0) + Number(r.expected_revenue);
    }
  }

  const ccyKeys = Object.keys(byCcy);
  const singleCcyRevenue = ccyKeys.length === 1 ? byCcy[ccyKeys[0]!]! : null;
  const mer =
    adSpend > 0 && singleCcyRevenue !== null && ccyKeys[0] === "MYR"
      ? (singleCcyRevenue / adSpend).toFixed(2)
      : null;

  const windowHint = `${rangeLabel(dateRange, customRange)} · live mirror`;

  return (
    <section aria-label="Commercial scorecard (live)" className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 2xl:grid-cols-7">
        <MetricCard
          metricKey="net_revenue"
          value={ccyLine(byCcy)}
          hint={`${windowHint} · recognized = processing + completed`}
        />
        {(() => {
          if (!classic) {
            return (
              <MetricCard
                metricKey="contribution"
                value="—"
                hint="Item-level contribution computes on Today / 7d / 30d windows"
              />
            );
          }
          // Product contribution = item revenue − COGS, from confirmed SKU
          // mappings and effective-dated costs. Shown only when coverage is
          // honest (≥90% of units costed, per currency, currencies unmerged).
          const econRows = state.econ.filter(
            (r) =>
              r.win === win &&
              (liveBrandId === null || r.brand_id === liveBrandId) &&
              (liveMarkets.length === 0 || liveMarkets.includes(r.market)),
          );
          const byC: Record<string, { rev: number; cogs: number; units: number; costed: number }> = {};
          for (const r of econRows) {
            const e = (byC[r.currency_code] ??= { rev: 0, cogs: 0, units: 0, costed: 0 });
            e.rev += Number(r.revenue);
            e.cogs += Number(r.cogs);
            e.units += Number(r.units);
            e.costed += Number(r.costed_units);
          }
          const totUnits = Object.values(byC).reduce((s, e) => s + e.units, 0);
          const totCosted = Object.values(byC).reduce((s, e) => s + e.costed, 0);
          if (totUnits === 0) {
            return <MetricCard metricKey="contribution" value="—" hint="No recognized items in this window" />;
          }
          if (totCosted === 0) {
            return <MetricCard metricKey="contribution" value="—" hint="Map store SKUs & set variant costs in Catalog to unlock" />;
          }
          const pct = `${((totCosted / totUnits) * 100).toFixed(0)}%`;
          const allCovered = Object.values(byC).every((e) => e.units === 0 || e.costed / e.units >= 0.9);
          if (!allCovered) {
            return <MetricCard metricKey="contribution" value="—" hint={`COGS coverage ${pct} — finish mappings & costs in Catalog`} />;
          }
          const contrib = Object.fromEntries(Object.entries(byC).map(([c, e]) => [c, e.rev - e.cogs]));
          return (
            <MetricCard
              metricKey="contribution"
              value={ccyLine(contrib)}
              hint={`Item revenue − COGS · coverage ${pct} · before fees & shipping`}
            />
          );
        })()}
        <MetricCard
          metricKey="ad_spend"
          value={adSpend > 0 ? money("MYR", adSpend) : "—"}
          hint={adSpend > 0 ? "Warehouse pipeline · all connected ad accounts" : "No spend in this window/scope"}
        />
        <MetricCard
          metricKey="blended_mer"
          value={mer ?? "—"}
          hint={mer ? "MYR revenue ÷ warehouse ad spend" : "Needs single-currency scope — pick a market"}
        />
        <MetricCard metricKey="orders" value={orders.toLocaleString()} hint={windowHint} />
        <MetricCard
          metricKey="new_customer_mix"
          value="—"
          hint="Derives once identity windowing lands"
        />
        {(() => {
          if (!classic) {
            return <MetricCard metricKey="target_variance" value="—" hint="Baseline covers Today / 7d / 30d windows only" />;
          }
          // Revenue variance when the scope is single-currency; orders variance otherwise.
          const singleExp = ccyKeys.length === 1 ? expByCcy[ccyKeys[0]!] : undefined;
          const revBased = singleExp !== undefined && singleExp > 0 && singleCcyRevenue !== null;
          const expected = revBased ? singleExp! : expOrders;
          const actual = revBased ? singleCcyRevenue! : orders;
          if (!expected || expected <= 0) {
            return <MetricCard metricKey="target_variance" value="—" hint="Baseline needs 4 weeks of history for this scope" />;
          }
          const v = (actual - expected) / expected;
          const pct = `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`;
          return (
            <MetricCard
              metricKey="target_variance"
              value={pct}
              delta={{
                text: v >= 0 ? "on or above baseline" : "below baseline",
                tone: v >= 0 ? "success" : "destructive",
              }}
              hint={`${revBased ? "Revenue" : "Orders"} vs 4-week same-weekday baseline · statistical, not a target${win === "today" ? " · partial day vs full-day baseline" : ""}`}
            />
          );
        })()}
      </div>
      <p className="text-[11px] text-muted-foreground">
        Live mirror of the connected stores · currencies never merged (no FX policy governed) · platform
        attribution is not incrementality.
      </p>
    </section>
  );
}
