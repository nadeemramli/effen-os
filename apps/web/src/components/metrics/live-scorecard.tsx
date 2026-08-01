"use client";

import { useEffect, useState } from "react";
import { MetricCard } from "@/components/metrics/metric-card";
import { useAppStore } from "@/lib/store/provider";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  fetchLiveBrands,
  fetchLivePlanBaseline,
  fetchLiveScorecard,
  type LiveBrand,
  type LivePlanBaselineRow,
  type LiveScorecardRow,
} from "@/lib/supabase/live";

/**
 * The original seven-card commercial scorecard, fed by the live mirror when a
 * real session exists (the demo scorecard is the signed-out fallback). Cards
 * whose sources are not yet connected say so instead of faking numbers.
 * Windows follow the top bar's Today / 7d / 30d toggle; brand and market
 * scope follow the live switchers.
 */

interface AdFact {
  account_ref: number;
  date: string;
  spend: number | null;
}
interface AdAccount {
  id: number;
  brand_id: number | null;
  market: string | null;
}

type State =
  | { kind: "checking" }
  | { kind: "no-session" }
  | { kind: "ready"; rows: LiveScorecardRow[]; brands: LiveBrand[]; facts: AdFact[]; accounts: AdAccount[]; baseline: LivePlanBaselineRow[] }
  | { kind: "error"; message: string };

/** ISO date N days back — the lower bound for a spend window. */
function cutoffDate(windowDays: number): string {
  return new Date(Date.now() - windowDays * 86_400_000).toISOString().slice(0, 10);
}

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

export function LiveScorecard({ fallback }: { fallback: React.ReactNode }) {
  const [state, setState] = useState<State>({ kind: "checking" });
  const liveBrandId = useAppStore((s) => s.session.liveBrandId);
  const liveMarkets = useAppStore((s) => s.session.liveMarkets);
  const dateRange = useAppStore((s) => s.session.dateRange);

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
        const [rows, brands, facts, accounts, baseline] = await Promise.all([
          fetchLiveScorecard(),
          fetchLiveBrands(),
          getSupabase().from("ad_daily_facts").select("account_ref, date, spend").then((r) => (r.data ?? []) as AdFact[]),
          getSupabase().from("ad_accounts_read").select("id, brand_id, market").then((r) => (r.data ?? []) as AdAccount[]),
          fetchLivePlanBaseline(),
        ]);
        setState({ kind: "ready", rows, brands: brands.filter((b) => b.status === "active"), facts, accounts, baseline });
      } catch (e) {
        setState({ kind: "error", message: (e as Error).message });
      }
    })();
  }, []);

  if (state.kind === "no-session" || state.kind === "error") return <>{fallback}</>;
  if (state.kind === "checking") {
    return (
      <section aria-label="Commercial scorecard" className="grid grid-cols-2 gap-3 lg:grid-cols-4 2xl:grid-cols-7">
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg border bg-muted/30" />
        ))}
      </section>
    );
  }

  const win = dateRange === "today" ? "today" : dateRange === "7d" ? "d7" : "d30";
  const windowDays = dateRange === "today" ? 1 : dateRange === "7d" ? 7 : 30;

  // Top-bar brand + market scope applies everywhere.
  const rows = state.rows.filter(
    (r) =>
      r.win === win &&
      (liveBrandId === null || r.brand_id === liveBrandId) &&
      (liveMarkets.length === 0 || liveMarkets.includes(r.market)),
  );
  const byCcy: Record<string, number> = {};
  let orders = 0;
  for (const r of rows) {
    orders += Number(r.orders);
    byCcy[r.currency_code] = (byCcy[r.currency_code] ?? 0) + Number(r.revenue);
  }

  // Ad spend for the same window and scope (Meta facts, all MYR-billed).
  const accountById = new Map(state.accounts.map((a) => [a.id, a]));
  const cutoff = cutoffDate(windowDays);
  let adSpend = 0;
  for (const f of state.facts) {
    const acc = accountById.get(f.account_ref);
    if (!acc) continue;
    if (liveBrandId !== null && acc.brand_id !== liveBrandId) continue;
    if (liveMarkets.length > 0 && !liveMarkets.includes(acc.market ?? "")) continue;
    if (f.date >= cutoff) adSpend += Number(f.spend ?? 0);
  }

  // Baseline expectation for the same window and scope.
  const baseRows = state.baseline.filter(
    (r) =>
      r.win === win &&
      (liveBrandId === null || r.brand_id === liveBrandId) &&
      (liveMarkets.length === 0 || liveMarkets.includes(r.market)),
  );
  const expByCcy: Record<string, number> = {};
  let expOrders = 0;
  for (const r of baseRows) {
    expOrders += Number(r.expected_orders);
    expByCcy[r.currency_code] = (expByCcy[r.currency_code] ?? 0) + Number(r.expected_revenue);
  }

  const ccyKeys = Object.keys(byCcy);
  const singleCcyRevenue = ccyKeys.length === 1 ? byCcy[ccyKeys[0]!]! : null;
  const mer =
    adSpend > 0 && singleCcyRevenue !== null && ccyKeys[0] === "MYR"
      ? (singleCcyRevenue / adSpend).toFixed(2)
      : null;

  const windowHint = dateRange === "today" ? "Today (MYT) · live mirror" : `Last ${windowDays} days · live mirror`;

  return (
    <section aria-label="Commercial scorecard (live)" className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 2xl:grid-cols-7">
        <MetricCard
          metricKey="net_revenue"
          value={ccyLine(byCcy)}
          hint={`${windowHint} · recognized = processing + completed`}
        />
        <MetricCard
          metricKey="contribution"
          value="—"
          hint="Arrives when COGS + fee sources connect"
        />
        <MetricCard
          metricKey="ad_spend"
          value={adSpend > 0 ? money("MYR", adSpend) : "—"}
          hint={adSpend > 0 ? "Meta · seeded accounts · billed in MYR" : "Meta daily sync pending token"}
        />
        <MetricCard
          metricKey="blended_mer"
          value={mer ?? "—"}
          hint={mer ? "MYR revenue ÷ Meta spend" : "Needs single-currency scope — pick a market"}
        />
        <MetricCard metricKey="orders" value={orders.toLocaleString()} hint={windowHint} />
        <MetricCard
          metricKey="new_customer_mix"
          value="—"
          hint="Derives once identity windowing lands"
        />
        {(() => {
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
