"use client";

import { useEffect, useState } from "react";
import { MetricCard } from "@/components/metrics/metric-card";
import { useAppStore } from "@/lib/store/provider";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  fetchLiveBrands,
  fetchLiveScorecard,
  type LiveBrand,
  type LiveScorecardRow,
} from "@/lib/supabase/live";

/**
 * Commercial scorecard over the LIVE orders_read mirror. Renders only when a
 * real Supabase session exists (RLS authorizes the aggregate); otherwise the
 * caller's fallback (the demo scorecard) stays. Currencies are never merged —
 * MYR and SGD figures sit side by side until an FX policy is governed.
 */

type State =
  | { kind: "checking" }
  | { kind: "no-session" }
  | { kind: "ready"; rows: LiveScorecardRow[]; brands: LiveBrand[] }
  | { kind: "error"; message: string };

function money(currency: string, n: number): string {
  const compact = n >= 100_000 ? `${(n / 1000).toFixed(0)}k` : n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : n.toFixed(0);
  return `${currency === "MYR" ? "RM" : currency === "SGD" ? "S$" : currency} ${compact}`;
}

function sumBy(rows: LiveScorecardRow[], win: string): { orders: number; byCcy: Record<string, number> } {
  const scoped = rows.filter((r) => r.win === win);
  const byCcy: Record<string, number> = {};
  let orders = 0;
  for (const r of scoped) {
    orders += Number(r.orders);
    byCcy[r.currency_code] = (byCcy[r.currency_code] ?? 0) + Number(r.revenue);
  }
  return { orders, byCcy };
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
        const [rows, brands] = await Promise.all([fetchLiveScorecard(), fetchLiveBrands()]);
        setState({ kind: "ready", rows, brands: brands.filter((b) => b.status === "active") });
      } catch (e) {
        setState({ kind: "error", message: (e as Error).message });
      }
    })();
  }, []);

  if (state.kind === "no-session" || state.kind === "error") return <>{fallback}</>;
  if (state.kind === "checking") {
    return (
      <section aria-label="Commercial scorecard" className="grid grid-cols-2 gap-3 lg:grid-cols-4 2xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg border bg-muted/30" />
        ))}
      </section>
    );
  }

  // Top-bar live brand + market scope apply to every window.
  const rows = state.rows.filter(
    (r) =>
      (liveBrandId === null || r.brand_id === liveBrandId) &&
      (liveMarkets.length === 0 || liveMarkets.includes(r.market)),
  );
  const today = sumBy(rows, "today");
  const yesterday = sumBy(rows, "yesterday");
  const d7 = sumBy(rows, "d7");
  const d30 = sumBy(rows, "d30");

  const ordersDelta =
    yesterday.orders > 0
      ? `${today.orders >= yesterday.orders ? "+" : ""}${(((today.orders - yesterday.orders) / yesterday.orders) * 100).toFixed(0)}% vs yesterday`
      : "no yesterday baseline";

  /* per-brand 7-day revenue, native currency */
  const brandLines = state.brands
    .filter((b) => liveBrandId === null || b.id === liveBrandId)
    .map((b) => {
      const byCcy: Record<string, number> = {};
      let orders = 0;
      for (const r of rows.filter((r) => r.win === "d7" && r.brand_id === b.id)) {
        orders += Number(r.orders);
        byCcy[r.currency_code] = (byCcy[r.currency_code] ?? 0) + Number(r.revenue);
      }
      return { name: b.name, orders, line: ccyLine(byCcy) };
    })
    .filter((b) => b.orders > 0)
    .sort((a, b) => b.orders - a.orders);

  return (
    <section aria-label="Commercial scorecard (live)" className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard
          metricKey="net_revenue"
          label="Recognized revenue — today"
          value={ccyLine(today.byCcy)}
          hint="processing + completed · MYT day · live mirror"
        />
        <MetricCard
          metricKey="orders"
          label="Orders — today"
          value={today.orders.toLocaleString()}
          delta={{
            text: ordersDelta,
            tone: today.orders >= yesterday.orders ? "success" : "destructive",
          }}
          hint={`yesterday: ${yesterday.orders.toLocaleString()} orders · ${ccyLine(yesterday.byCcy)}`}
        />
        <MetricCard
          metricKey="net_revenue"
          label="Recognized revenue — 7 days"
          value={ccyLine(d7.byCcy)}
          hint={`${d7.orders.toLocaleString()} orders`}
        />
        <MetricCard
          metricKey="net_revenue"
          label="Recognized revenue — 30 days"
          value={ccyLine(d30.byCcy)}
          hint={`${d30.orders.toLocaleString()} orders`}
        />
      </div>
      {brandLines.length > 0 && (
        <div className="grid grid-cols-2 gap-x-6 gap-y-1 rounded-lg border bg-card px-4 py-3 text-sm lg:grid-cols-4">
          {brandLines.map((b) => (
            <div key={b.name} className="flex items-baseline justify-between gap-2">
              <span className="truncate text-xs text-muted-foreground">{b.name} · 7d</span>
              <span className="tnum whitespace-nowrap text-sm font-medium">{b.line}</span>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        Live mirror of the connected WooCommerce stores · recognized = processing + completed at source ·
        currencies shown separately (no FX policy governed yet) · ad spend, contribution, and plan variance
        return when their live sources connect.
      </p>
    </section>
  );
}
