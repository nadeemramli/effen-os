"use client";

import Link from "next/link";
import { parseAsString, useQueryState } from "nuqs";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Info, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartCard, ChartCardSkeleton } from "@/components/charts/chart-card";
import { ChartLegend, SpendRevenueTrend } from "@/components/charts/commercial-charts";
import { LiveAdsPanel } from "@/components/metrics/live-ads-panel";
import { LiveCampaignExplorer } from "@/components/metrics/live-campaign-explorer";
import { MetricCard, MetricCardSkeleton } from "@/components/metrics/metric-card";
import { SkeletonTable } from "@/components/states";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { MoneyCell } from "@/components/tables/cells";
import { FreshnessBadge } from "@/components/status/freshness-badge";
import { useSession } from "@/hooks/use-session";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  fetchContributionRange,
  fetchGrowthAds,
  fetchLiveBrands,
  type GrowthAds,
  type LiveBrand,
  type LiveContribution,
  whtFor,
} from "@/lib/supabase/live";
import { rangeBounds, rangeDays as spanDays, rangeLabel } from "@/lib/store";
import { formatMoney, formatPercent, formatRatio } from "@/lib/domain/money";
import { sumRows, toMYR } from "@/lib/domain/metrics";
import { RouteGuard } from "@/lib/rbac/guard";
import { dateKey } from "@/lib/seed/clock";
import { useAppStore } from "@/lib/store/provider";
import { formatDate } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

const PLATFORM_LABEL: Record<string, string> = {
  meta: "Meta",
  google: "Google",
  tiktok: "TikTok",
  shopee_ads: "Shopee Ads",
};

function MarketingInner() {
  const session = useSession();
  const campaigns = useAppStore((s) => s.campaigns);
  const adAccounts = useAppStore((s) => s.adAccounts);
  const brands = useAppStore((s) => s.brands);
  const dailyRows = useAppStore((s) => s.dailyRows);
  const integrations = useAppStore((s) => s.integrations);
  const products = useAppStore((s) => s.products);
  const orders = useAppStore((s) => s.orders);

  const [openCampaign, setOpenCampaign] = useQueryState("campaign", parseAsString);
  const liveBrandId = useAppStore((s) => s.session.liveBrandId);
  const liveMarkets = useAppStore((s) => s.session.liveMarkets);
  const setLiveBrand = useAppStore((s) => s.setLiveBrand);

  // Warehouse-fed live surfaces (ADR-0003) — one fetch shared by the spend
  // panel, account coverage, scorecard, and trend. Explicit states so a live
  // session never silently sees demo numbers: "demo" only without a session,
  // "loading" renders skeletons, "error" keeps demo visible behind a banner.
  const [live, setLive] = useState<
    | { kind: "demo" }
    | { kind: "loading" }
    | { kind: "ready"; ads: GrowthAds; liveBrands: LiveBrand[]; contribution: LiveContribution }
    | { kind: "error"; message: string }
  >(() => (isSupabaseConfigured() ? { kind: "loading" } : { kind: "demo" }));
  const [retryKey, setRetryKey] = useState(0);

  // Platform filter (empty = all). Future sources (TikTok, Google, Shopee,
  // TikTok Shop, Lazada) appear automatically once their facts land.
  const [platformFilter, setPlatformFilter] = useState<string[]>([]);
  const [showAllAccounts, setShowAllAccounts] = useState(false);
  const UPCOMING_PLATFORMS = ["tiktok", "google", "shopee", "tiktok_shop", "lazada"];

  const bounds = rangeBounds(session.dateRange, session.customRange);
  const days = spanDays(session.dateRange, session.customRange);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let cancelled = false;
    void (async () => {
      const { data: s } = await getSupabase().auth.getSession();
      if (!s.session) {
        // Signed-out keeps the instant demo store — no skeletons, no banner.
        if (!cancelled) setLive({ kind: "demo" });
        return;
      }
      // Range changes refetch behind the current numbers; only a first load
      // (or retry after an error) drops to skeletons.
      if (!cancelled) setLive((prev) => (prev.kind === "ready" ? prev : { kind: "loading" }));
      try {
        // Warehouse window must reach back to the range start (max 400d);
        // commerce revenue/COGS come from the range RPC directly.
        const fetchDays = Math.min(
          400,
          Math.max(1, Math.round((Date.now() - new Date(bounds.from).getTime()) / 86_400_000) + 1),
        );
        const [ads, liveBrands, contribution] = await Promise.all([
          fetchGrowthAds(fetchDays),
          fetchLiveBrands(),
          fetchContributionRange(bounds.from, bounds.to).catch(
            () => ({ rules: null, rows: [] }) as LiveContribution,
          ),
        ]);
        if (cancelled) return;
        // No warehouse data at all is a legitimate demo fallback, not an error.
        setLive(ads ? { kind: "ready", ads, liveBrands, contribution } : { kind: "demo" });
      } catch (e) {
        if (!cancelled) setLive({ kind: "error", message: (e as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.dateRange, session.customRange, retryKey]);

  const growth = live.kind === "ready" ? live : null;
  const liveLoading = live.kind === "loading";
  const keys = useMemo(() => new Set(Array.from({ length: days }, (_, i) => dateKey(i))), [days]);

  const scopedCampaigns = campaigns.filter(
    (c) => session.brandId === "all" || c.brandId === session.brandId,
  );

  const campaignTotals = scopedCampaigns.map((c) => {
    const daily = c.daily.filter((d) => keys.has(d.date));
    const spend = daily.reduce((s, d) => s + d.spend, 0);
    const revenue = daily.reduce((s, d) => s + d.platformRevenue, 0);
    const fkOrders = daily.reduce((s, d) => s + d.fullkitOrders, 0);
    const newCustomers = daily.reduce((s, d) => s + d.newCustomers, 0);
    const mer = spend > 0 ? revenue / spend : 0;
    return { campaign: c, spend, revenue, fkOrders, newCustomers, mer };
  });

  const totalSpend = campaignTotals.reduce((s, c) => s + toMYR(c.spend, c.campaign.currency), 0);
  const totalPlatformRevenue = campaignTotals.reduce((s, c) => s + toMYR(c.revenue, c.campaign.currency), 0);
  const totalNewCustomers = campaignTotals.reduce((s, c) => s + c.newCustomers, 0);

  const scopedRows = dailyRows.filter(
    (r) => keys.has(r.date) && (session.brandId === "all" || r.brandId === session.brandId),
  );
  const totals = sumRows(scopedRows);

  // Excludes today (partial day) so the tail doesn't read as a crash.
  const trendData = Array.from({ length: 30 }, (_, i) => {
    const k = dateKey(30 - i);
    let spend = 0;
    let revenue = 0;
    for (const c of scopedCampaigns) {
      const d = c.daily.find((x) => x.date === k);
      if (d) {
        spend += toMYR(d.spend, c.currency);
        revenue += toMYR(d.platformRevenue, c.currency);
      }
    }
    return { date: formatDate(`${k}T12:00:00+08:00`), spend, revenue };
  });

  const attributedOrders = orders.filter(
    (o) => o.campaignId && keys.has(new Date(new Date(o.placedAt).getTime() + 8 * 3600e3).toISOString().slice(0, 10)),
  );

  // Live derivations: top-bar scope (brand slug + markets) and the session
  // date-range window applied to the warehouse blob. Real calendar dates —
  // the demo clock does not apply to warehouse data.
  const liveView = useMemo(() => {
    if (!growth) return null;
    const { ads, liveBrands, contribution } = growth;
    const scopeSlug = liveBrandId === null ? null : (liveBrands.find((b) => b.id === liveBrandId)?.slug ?? null);
    const inScope = (slug: string | null, mkt: string | null, platform?: string) =>
      (scopeSlug === null || slug === scopeSlug) &&
      (liveMarkets.length === 0 || liveMarkets.includes(mkt ?? "")) &&
      (platformFilter.length === 0 || platform === undefined || platformFilter.includes(platform));
    const trend = ads.trend.filter((t) => inScope(t.brand_slug, t.market, t.platform));
    const windowed = trend.filter((t) => t.date >= bounds.from && t.date <= bounds.to);
    const spend = windowed.reduce((s, t) => s + Number(t.spend), 0);
    const purchases = windowed.reduce((s, t) => s + Number(t.purchases ?? 0), 0);
    const purchaseValue = windowed.reduce((s, t) => s + Number(t.purchase_value ?? 0), 0);
    const impressions = windowed.reduce((s, t) => s + Number(t.impressions ?? 0), 0);
    const clicks = windowed.reduce((s, t) => s + Number(t.clicks ?? 0), 0);
    const scopeBrandIds = scopeSlug === null
      ? null
      : new Set(liveBrands.filter((b) => b.slug === scopeSlug).map((b) => b.id));
    // Revenue + full variable-cost lines from the contribution model
    // (operator P&L rules: unit cost, zone delivery, return legs, COD fee).
    const scoped = contribution.rows
      .filter((r) => scopeBrandIds === null || (r.brand_id !== null && scopeBrandIds.has(r.brand_id)))
      .filter((r) => liveMarkets.length === 0 || liveMarkets.includes(r.market));
    const netRevenue = scoped.reduce((s, r) => s + toMYR(Number(r.revenue), r.currency_code), 0);
    const fkOrders = scoped.reduce((s, r) => s + Number(r.orders), 0);
    const codOrders = scoped.reduce((s, r) => s + Number(r.cod_orders), 0);
    const cogs = scoped.reduce((s, r) => s + Number(r.cogs_myr), 0);
    const delivery = scoped.reduce((s, r) => s + Number(r.delivery_myr), 0);
    const returnsCost = scoped.reduce((s, r) => s + Number(r.returns_myr), 0);
    const codCost = scoped.reduce((s, r) => s + Number(r.cod_myr), 0);
    const rtsParcels = scoped.reduce((s, r) => s + Number(r.rts_parcels), 0);
    const mappedUnits = scoped.reduce((s, r) => s + Number(r.base_units), 0);
    const unmappedLines = scoped.reduce((s, r) => s + Number(r.unmapped_lines), 0);
    const costedCoverage = mappedUnits + unmappedLines > 0 ? mappedUnits / (mappedUnits + unmappedLines) : 0;
    // WHT per spend day on Meta spend only, at the dated Finance rule (8%
    // until Jan 2026, 0% from Feb 2026 — ad billing moved to Dubai).
    const wht = whtFor(windowed, contribution.rule_history, Number(contribution.rules?.wht_rate ?? 0.08));
    // CM2 = revenue − COGS − fulfilment (delivery, return legs, COD fees);
    // CM3 = CM2 − ads − WHT. NOT net profit — fixed costs (payroll, rent,
    // tools) are not modelled; launching email/SMS costs have no source yet.
    const cm2 = netRevenue - cogs - delivery - returnsCost - codCost;
    const cm3 = cm2 - spend - wht;
    const byDate = new Map<string, { spend: number; revenue: number }>();
    for (const t of windowed) {
      const cur = byDate.get(t.date) ?? { spend: 0, revenue: 0 };
      cur.spend += Number(t.spend);
      cur.revenue += Number(t.purchase_value ?? 0);
      byDate.set(t.date, cur);
    }
    const chart = [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date: formatDate(`${date}T12:00:00+08:00`), spend: v.spend, revenue: v.revenue }));
    const liveAccounts = ads.accounts.filter(
      (a) =>
        (scopeSlug === null || a.brands.includes(scopeSlug)) &&
        (liveMarkets.length === 0 || a.markets.some((m) => liveMarkets.includes(m))) &&
        (platformFilter.length === 0 || platformFilter.includes(a.platform)),
    );
    return {
      spend, purchases, purchaseValue, netRevenue, chart, liveAccounts, scopeSlug,
      impressions, clicks, fkOrders, codOrders,
      cogs, delivery, returnsCost, codCost, rtsParcels, wht, cm2, cm3, costedCoverage,
    };
  }, [growth, liveBrandId, liveMarkets, bounds.from, bounds.to, platformFilter]);

  // Brand performance: every brand as a row regardless of the brand scope
  // (market scope + date window still apply), so "all brands" is the mix and
  // one click focuses the whole page on a single brand.
  const brandPerf = useMemo(() => {
    if (!growth) return null;
    const { ads, liveBrands, contribution } = growth;
    const mktOk = (m: string | null) => liveMarkets.length === 0 || liveMarkets.includes(m ?? "");

    const whtFallback = Number(contribution.rules?.wht_rate ?? 0.08);
    const bySlug = new Map<string | null, { spend: number; purchases: number; value: number; wht: number }>();
    for (const t of ads.trend) {
      if (!mktOk(t.market) || t.date < bounds.from || t.date > bounds.to) continue;
      if (platformFilter.length > 0 && !platformFilter.includes(t.platform)) continue;
      const cur = bySlug.get(t.brand_slug) ?? { spend: 0, purchases: 0, value: 0, wht: 0 };
      cur.spend += Number(t.spend);
      cur.purchases += Number(t.purchases ?? 0);
      cur.value += Number(t.purchase_value ?? 0);
      cur.wht += whtFor([t], contribution.rule_history, whtFallback);
      bySlug.set(t.brand_slug, cur);
    }

    const revenueBySlug = new Map<string, number>();
    const econBySlug = new Map<string, { cogs: number; varCosts: number; units: number; unmapped: number }>();
    for (const r of contribution.rows) {
      if (!mktOk(r.market) || r.brand_id === null) continue;
      const slug = liveBrands.find((b) => b.id === r.brand_id)?.slug;
      if (!slug) continue;
      revenueBySlug.set(slug, (revenueBySlug.get(slug) ?? 0) + toMYR(Number(r.revenue), r.currency_code));
      const cur = econBySlug.get(slug) ?? { cogs: 0, varCosts: 0, units: 0, unmapped: 0 };
      cur.cogs += Number(r.cogs_myr);
      cur.varCosts += Number(r.delivery_myr) + Number(r.returns_myr) + Number(r.cod_myr);
      cur.units += Number(r.base_units);
      cur.unmapped += Number(r.unmapped_lines);
      econBySlug.set(slug, cur);
    }

    const slugs = new Set<string | null>([...bySlug.keys(), ...revenueBySlug.keys()]);
    const rows = [...slugs].map((slug) => {
      const ad = bySlug.get(slug) ?? { spend: 0, purchases: 0, value: 0, wht: 0 };
      const revenue = slug === null ? 0 : (revenueBySlug.get(slug) ?? 0);
      const brand = slug === null ? undefined : liveBrands.find((b) => b.slug === slug);
      const econ = slug === null ? undefined : econBySlug.get(slug);
      const coverage = econ && econ.units + econ.unmapped > 0 ? econ.units / (econ.units + econ.unmapped) : 0;
      const wht = ad.wht;
      // CM3 only renders on ≥90% SKU-mapping coverage — the house rule:
      // no margin math built on thin data.
      const cm3 = econ && coverage >= 0.9 && revenue > 0
        ? revenue - econ.cogs - econ.varCosts - ad.spend - wht
        : null;
      return {
        slug,
        name: slug === null ? "Unattributed" : (brand?.name ?? slug),
        brandId: brand?.id ?? null,
        registered: slug === null ? true : Boolean(brand),
        ...ad,
        revenue,
        cogs: econ?.cogs ?? null,
        varCosts: econ?.varCosts ?? null,
        cm3,
        blendedMer: ad.spend > 0 && revenue > 0 ? revenue / ad.spend : null,
        platformMer: ad.spend > 0 && ad.value > 0 ? ad.value / ad.spend : null,
      };
    }).sort((a, b) => b.spend - a.spend);

    const mix = rows.reduce(
      (m, r) => ({
        spend: m.spend + r.spend,
        purchases: m.purchases + r.purchases,
        value: m.value + r.value,
        revenue: m.revenue + r.revenue,
        cogs: m.cogs + (r.cogs ?? 0),
        varCosts: m.varCosts + (r.varCosts ?? 0),
        cm3: m.cm3 + (r.cm3 ?? 0),
      }),
      { spend: 0, purchases: 0, value: 0, revenue: 0, cogs: 0, varCosts: 0, cm3: 0 },
    );
    return { rows, mix };
  }, [growth, liveMarkets, bounds.from, bounds.to, platformFilter]);

  return (
    <PageBody className="max-w-none">
      {/* Ad accounts are connected in Airbyte (one OAuth source per account);
          Fullkit ingests and governs — it does not connect. */}
      <PageHeader
        title="Marketing"
        description="Consolidated ads view — warehouse spend and platform attribution beside Fullkit order truth. Accounts are connected in Airbyte; the register mirrors them."
      />

      {live.kind === "error" && (
        <p className="flex items-center justify-between gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <span>Live ads mirror unavailable — showing demo data. {live.message}</span>
          <button
            type="button"
            className="shrink-0 font-medium underline-offset-2 hover:underline"
            onClick={() => setRetryKey((k) => k + 1)}
          >
            Retry
          </button>
        </p>
      )}

      {/* platform scope + focused-brand chip (live mode) */}
      {growth && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-muted-foreground">Platforms:</span>
          {growth.ads.platforms.map((p) => {
            const on = platformFilter.length === 0 || platformFilter.includes(p);
            return (
              <button
                key={p}
                type="button"
                onClick={() =>
                  setPlatformFilter((cur) =>
                    cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p],
                  )
                }
                className={cn(
                  "rounded-full border px-2 py-0.5 uppercase",
                  on ? "border-info/40 bg-info/10 text-info" : "text-muted-foreground hover:bg-accent/40",
                )}
              >
                {p}
              </button>
            );
          })}
          {UPCOMING_PLATFORMS.filter((p) => !growth.ads.platforms.includes(p)).map((p) => (
            <span key={p} className="rounded-full border border-dashed px-2 py-0.5 uppercase text-muted-foreground/50" title="Not connected yet — lands automatically once its Airbyte source syncs">
              {p.replace("_", " ")} · soon
            </span>
          ))}
          {platformFilter.length > 0 && (
            <button type="button" onClick={() => setPlatformFilter([])} className="text-info underline-offset-2 hover:underline">
              clear
            </button>
          )}
          {liveBrandId !== null && (
            <button
              type="button"
              onClick={() => setLiveBrand(null)}
              className="ml-auto inline-flex items-center gap-1 rounded-full border border-info/40 bg-info/10 px-2 py-0.5 text-info"
            >
              Focused: {growth.liveBrands.find((b) => b.id === liveBrandId)?.name ?? liveBrandId}
              <X className="size-3" aria-hidden />
            </button>
          )}
        </div>
      )}

      {/* cross-brand surfaces — the mirror and brand table only make sense in
          the all-brands view; a focused brand gets the scoped surfaces below */}
      {liveBrandId === null && growth && (
        <LiveAdsPanel ads={growth.ads} brands={growth.liveBrands} platforms={platformFilter} />
      )}

      {/* brand performance — the per-brand money story + the all-brands mix */}
      {liveBrandId === null && liveLoading && (
        <Card role="status" aria-label="Loading brand performance">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Brand performance</CardTitle>
          </CardHeader>
          <CardContent>
            <SkeletonTable rows={4} cols={8} framed={false} />
          </CardContent>
        </Card>
      )}
      {liveBrandId === null && brandPerf && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Brand performance</CardTitle>
            <p className="text-xs text-muted-foreground">
              Warehouse ad spend vs Fullkit net revenue per brand — {rangeLabel(session.dateRange, session.customRange)}.
              Click a registered brand to focus every surface on it; blended MER is Fullkit revenue ÷ spend —
              the honest number, unlike platform claims.
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">Brand</th>
                    <th className="pb-2 text-right font-medium">Ad spend</th>
                    <th className="pb-2 text-right font-medium">Purchases</th>
                    <th className="pb-2 text-right font-medium">CPP</th>
                    <th className="pb-2 text-right font-medium">Platform MER</th>
                    <th className="pb-2 text-right font-medium">Fullkit revenue</th>
                    <th className="pb-2 text-right font-medium">Blended MER</th>
                    <th className="pb-2 text-right font-medium">COGS</th>
                    <th className="pb-2 text-right font-medium">Fulfilment</th>
                    <th className="pb-2 text-right font-medium">CM3*</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b bg-muted/40 font-medium">
                    <td className="py-2">All brands — mixed</td>
                    <td className="tnum py-2 text-right">RM {Math.round(brandPerf.mix.spend).toLocaleString()}</td>
                    <td className="tnum py-2 text-right">{brandPerf.mix.purchases.toLocaleString()}</td>
                    <td className="tnum py-2 text-right">
                      {brandPerf.mix.purchases > 0 ? `RM ${(brandPerf.mix.spend / brandPerf.mix.purchases).toFixed(0)}` : "—"}
                    </td>
                    <td className="tnum py-2 text-right">
                      {brandPerf.mix.spend > 0 && brandPerf.mix.value > 0 ? (brandPerf.mix.value / brandPerf.mix.spend).toFixed(2) : "—"}
                    </td>
                    <td className="tnum py-2 text-right">RM {Math.round(brandPerf.mix.revenue).toLocaleString()}</td>
                    <td className="tnum py-2 text-right">
                      {brandPerf.mix.spend > 0 && brandPerf.mix.revenue > 0 ? (brandPerf.mix.revenue / brandPerf.mix.spend).toFixed(2) : "—"}
                    </td>
                    <td className="tnum py-2 text-right">RM {Math.round(brandPerf.mix.cogs).toLocaleString()}</td>
                    <td className="tnum py-2 text-right">RM {Math.round(brandPerf.mix.varCosts).toLocaleString()}</td>
                    <td className={cn("tnum py-2 text-right", brandPerf.mix.cm3 < 0 && "text-destructive")}>
                      RM {Math.round(brandPerf.mix.cm3).toLocaleString()}
                    </td>
                  </tr>
                  {brandPerf.rows.map((r) => {
                    const focusable = r.brandId !== null;
                    const focused = liveBrandId !== null && r.brandId === liveBrandId;
                    return (
                      <tr
                        key={r.slug ?? "unattributed"}
                        className={cn(
                          "border-b last:border-0",
                          focusable && "cursor-pointer hover:bg-accent/40",
                          focused && "bg-info/10",
                        )}
                        onClick={focusable ? () => setLiveBrand(focused ? null : r.brandId) : undefined}
                      >
                        <td className="py-2">
                          <span className="font-medium">{r.name}</span>
                          {!r.registered && (
                            <Badge variant="outline" className="ml-1.5 border-warning/30 bg-warning/10 text-[10px] text-warning">
                              unregistered
                            </Badge>
                          )}
                          {focused && (
                            <Badge variant="outline" className="ml-1.5 border-info/30 bg-info/10 text-[10px] text-info">
                              focused — click to clear
                            </Badge>
                          )}
                        </td>
                        <td className="tnum py-2 text-right">RM {Math.round(r.spend).toLocaleString()}</td>
                        <td className="tnum py-2 text-right">{r.purchases > 0 ? r.purchases.toLocaleString() : "—"}</td>
                        <td className="tnum py-2 text-right">{r.purchases > 0 ? `RM ${(r.spend / r.purchases).toFixed(0)}` : "—"}</td>
                        <td className="tnum py-2 text-right">{r.platformMer !== null ? r.platformMer.toFixed(2) : "—"}</td>
                        <td className="tnum py-2 text-right">{r.revenue > 0 ? `RM ${Math.round(r.revenue).toLocaleString()}` : "—"}</td>
                        <td className={cn("tnum py-2 text-right font-medium", r.blendedMer !== null && (r.blendedMer >= 3 ? "text-success" : r.blendedMer >= 2 ? "text-warning" : "text-destructive"))}>
                          {r.blendedMer !== null ? r.blendedMer.toFixed(2) : "—"}
                        </td>
                        <td className="tnum py-2 text-right">{r.cogs !== null ? `RM ${Math.round(r.cogs).toLocaleString()}` : "—"}</td>
                        <td className="tnum py-2 text-right">{r.varCosts !== null ? `RM ${Math.round(r.varCosts).toLocaleString()}` : "—"}</td>
                        <td className={cn("tnum py-2 text-right", r.cm3 !== null && r.cm3 < 0 && "text-destructive")}>
                          {r.cm3 !== null ? `RM ${Math.round(r.cm3).toLocaleString()}` : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              *CM3 = revenue − COGS − fulfilment (zone delivery + return legs + COD fees) − ad spend − WHT on ad
              spend, per the dated Finance cost rules (unit RM7 · west RM8.50 · east RM15 · SG RM35 · COD RM5 ·
              WHT 8% on Meta spend until Jan 2026, none from Feb 2026 — ad billing moved to the Dubai entity).
              Returns: courier RTS legs costed per parcel; returned-order revenue nets out via order statuses.
              Launching email/SMS costs have no data source yet. Net profit would further remove fixed costs
              (payroll, rent, tools) — not modelled. A brand renders “—” below 90% SKU-mapping coverage.
            </p>
          </CardContent>
        </Card>
      )}


      {/* attribution caveat — always visible */}
      <p className="flex items-start gap-2 rounded-md border border-info/25 bg-info/10 px-3 py-2 text-xs text-info">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Platform-attributed revenue is each platform&apos;s own claim. It is not accounting revenue and not proven
        incrementality — platforms overlap and self-attribute. Fullkit orders and contribution are the commercial truth.
      </p>

      {/* account coverage — summary strip + scalable table (40+ accounts) */}
      {liveView ? (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-sm font-medium">Ad accounts</CardTitle>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                <span><span className="tnum font-medium text-foreground">{liveView.liveAccounts.length}</span> with spend in scope</span>
                <span><span className="tnum font-medium text-foreground">{liveView.liveAccounts.filter((a) => a.account_status === "DISABLED" || a.is_banned).length}</span> disabled/banned</span>
                <span><span className="tnum font-medium text-foreground">{liveView.liveAccounts.filter((a) => !a.registered).length}</span> unregistered</span>
                <span className="text-muted-foreground">Connected & named in Airbyte; register mirrors the source list.</span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">Account</th>
                    <th className="pb-2 font-medium">Brands</th>
                    <th className="pb-2 font-medium">Markets</th>
                    <th className="pb-2 text-right font-medium">Spend 30d</th>
                    <th className="pb-2 text-right font-medium">Last active</th>
                    <th className="pb-2 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(showAllAccounts ? liveView.liveAccounts : liveView.liveAccounts.slice(0, 8)).map((a) => (
                    <tr key={a.account_id} className="border-b last:border-0">
                      <td className="max-w-72 py-1.5">
                        <span className="block truncate font-medium">{a.name ?? a.account_id}</span>
                        <span className="text-[10px] uppercase text-muted-foreground">{a.platform}</span>
                      </td>
                      <td className="max-w-44 truncate py-1.5 text-xs text-muted-foreground">
                        {a.brands.length > 0 ? a.brands.join(", ") : "unattributed"}
                      </td>
                      <td className="py-1.5 text-xs text-muted-foreground">{a.markets.join("/") || "?"}</td>
                      <td className="tnum py-1.5 text-right">RM {Math.round(Number(a.spend)).toLocaleString()}</td>
                      <td className="tnum py-1.5 text-right text-xs text-muted-foreground">{a.last_active}</td>
                      <td className="py-1.5 text-right">
                        {a.is_banned || a.account_status === "DISABLED" ? (
                          <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-[10px] text-destructive">disabled</Badge>
                        ) : !a.registered ? (
                          <Badge variant="outline" className="border-warning/30 bg-warning/10 text-[10px] text-warning">unregistered</Badge>
                        ) : (
                          <Badge variant="outline" className="border-success/30 bg-success/10 text-[10px] text-success">active</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {liveView.liveAccounts.length > 8 && (
              <button
                type="button"
                onClick={() => setShowAllAccounts((v) => !v)}
                className="mt-2 text-xs text-info underline-offset-2 hover:underline"
              >
                {showAllAccounts ? "Show top 8" : `Show all ${liveView.liveAccounts.length} accounts`}
              </button>
            )}
          </CardContent>
        </Card>
      ) : liveLoading ? (
        <Card role="status" aria-label="Loading ad accounts">
          <CardHeader>
            <CardTitle className="text-sm font-medium">Ad accounts</CardTitle>
          </CardHeader>
          <CardContent>
            <SkeletonTable rows={5} cols={6} framed={false} />
          </CardContent>
        </Card>
      ) : (
      <section aria-label="Account coverage" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {adAccounts.map((a) => (
          <div key={a.id} className={cn("rounded-lg border bg-card p-3", a.status === "unmapped" && "border-warning/40")}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">{PLATFORM_LABEL[a.platform]}</span>
              {a.status === "connected" ? (
                <FreshnessBadge lastSuccessAt={a.lastSyncAt} slaMinutes={240} />
              ) : a.status === "unmapped" ? (
                <Badge variant="outline" className="border-warning/30 bg-warning/10 text-[10px] text-warning">unmapped</Badge>
              ) : (
                <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-[10px] text-destructive">token expired</Badge>
              )}
            </div>
            <div className="mt-1 truncate text-sm">{a.name}</div>
            <div className="tnum truncate text-[11px] text-muted-foreground">{a.externalId} · {a.currency}</div>
            {a.status === "unmapped" && (
              <p className="mt-1 text-[11px] text-warning">Spend excluded from brand scorecards until mapped.</p>
            )}
          </div>
        ))}
      </section>
      )}

      {/* scorecard — warehouse spend + Fullkit revenue when live, demo otherwise */}
      {liveView ? (
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard
            metricKey="ad_spend"
            value={formatMoney(Math.round(liveView.spend) * 100, "MYR", { compact: true })}
            hint={`${rangeLabel(session.dateRange, session.customRange)} · warehouse`}
            info={{
              title: "Ad spend",
              formula: "Sum of platform-reported spend across all connected ad accounts in the selected brand / market / platform scope and date window.",
              source: "Warehouse pipeline (Airbyte → BigQuery → dbt → mart sync)",
            }}
          />
          <MetricCard
            metricKey="ad_spend"
            label="Platform-attributed value"
            value={formatMoney(Math.round(liveView.purchaseValue) * 100, "MYR", { compact: true })}
            hint="Platform claim — see caveat"
            info={{
              title: "Platform-attributed value",
              formula: "The revenue value each ad platform claims its ads generated (Meta omni-purchase conversion value), summed over the scope and window.",
              source: "Platform conversion tracking via the warehouse pipeline",
              caveat: "A platform's own claim — not accounting revenue and not proven incrementality. Platforms overlap and self-attribute; Fullkit orders are the commercial truth.",
            }}
          />
          <MetricCard
            metricKey="orders"
            label="Platform purchases"
            value={liveView.purchases.toLocaleString()}
            hint="Platform-reported conversions"
            info={{
              title: "Platform purchases",
              formula: "Count of purchase conversions the platforms attribute to ads (Meta omni-purchase events), summed over the scope and window.",
              source: "Platform conversion tracking via the warehouse pipeline",
              caveat: "Platform-attributed, not deduplicated against Fullkit orders.",
            }}
          />
          <MetricCard
            metricKey="ad_spend"
            label="Cost per purchase"
            value={liveView.purchases > 0 ? `RM ${(liveView.spend / liveView.purchases).toFixed(0)}` : "—"}
            info={{
              title: "Cost per purchase (CPP)",
              formula: "Ad spend ÷ platform-reported purchases, over the scope and window.",
              source: "Derived from the two warehouse metrics above",
            }}
          />
          <MetricCard
            metricKey="blended_mer"
            label="Platform MER"
            value={liveView.spend > 0 && liveView.purchaseValue > 0 ? formatRatio(liveView.purchaseValue / liveView.spend) : "—"}
            hint="Platform value ÷ spend"
            info={{
              title: "Platform MER",
              formula: "Platform-attributed value ÷ ad spend. The efficiency the PLATFORMS claim.",
              source: "Derived from warehouse metrics",
              caveat: "Inflated by platform self-attribution — compare against Blended MER.",
            }}
          />
          <MetricCard
            metricKey="blended_mer"
            value={liveView.spend > 0 && liveView.netRevenue > 0 ? formatRatio(liveView.netRevenue / liveView.spend) : "—"}
            hint="Fullkit net revenue ÷ spend"
            info={{
              title: "Blended MER",
              formula: "Fullkit net revenue (recognized orders, currency-converted to MYR) ÷ warehouse ad spend, same scope and window. The honest efficiency number.",
              source: "Fullkit orders (live_scorecard) ÷ warehouse spend",
            }}
          />
          <MetricCard
            metricKey="orders"
            label="Fullkit revenue"
            value={formatMoney(Math.round(liveView.netRevenue) * 100, "MYR", { compact: true })}
            hint="Recognized orders — commercial truth"
            info={{
              title: "Fullkit revenue",
              formula: "Recognized order revenue (processing + completed) from the order tables, brand/market scoped, currency-converted to MYR — the same number the Command Centre trusts.",
              source: "Fullkit orders (live_scorecard)",
            }}
          />
          <MetricCard
            metricKey="orders"
            label="Fullkit orders"
            value={liveView.fkOrders.toLocaleString()}
            hint={`${liveView.fkOrders > 0 ? formatPercent(liveView.codOrders / liveView.fkOrders, 0) : "—"} COD`}
            info={{
              title: "Fullkit orders",
              formula: "Recognized orders (processing + completed) in the selected scope and window — the same population as Fullkit revenue. Hint shows the COD share.",
              source: "Order tables (live_contribution_range)",
            }}
          />
          <MetricCard
            metricKey="orders"
            label="AOV"
            value={liveView.fkOrders > 0 ? `RM ${(liveView.netRevenue / liveView.fkOrders).toFixed(0)}` : "—"}
            hint="Fullkit revenue ÷ orders"
            info={{
              title: "Average order value",
              formula: "Fullkit recognized revenue (MYR-converted) ÷ recognized orders, same scope and window.",
              source: "Order tables",
              caveat: "Cross-currency scopes convert SGD at the app's display rate — pick one market for a pure-currency AOV.",
            }}
          />
          <MetricCard
            metricKey="ad_spend"
            label="Cost per order"
            value={liveView.fkOrders > 0 && liveView.spend > 0 ? `RM ${(liveView.spend / liveView.fkOrders).toFixed(0)}` : "—"}
            hint="Ad spend ÷ Fullkit orders — blended"
            info={{
              title: "Cost per order (blended)",
              formula: "Warehouse ad spend ÷ Fullkit recognized orders. Blended across all orders — not per-campaign attribution; compare with CPP (platform-claimed cost per purchase).",
              source: "Warehouse spend ÷ order tables",
            }}
          />
          <MetricCard
            metricKey="ad_spend"
            label="Media: CPM"
            value={liveView.impressions > 0 ? `RM ${((liveView.spend / liveView.impressions) * 1000).toFixed(2)}` : "—"}
            hint={
              liveView.impressions > 0
                ? `CTR ${formatPercent(liveView.clicks / liveView.impressions, 2)} · CPC RM ${liveView.clicks > 0 ? (liveView.spend / liveView.clicks).toFixed(2) : "—"}`
                : "No impressions in window"
            }
            info={{
              title: "Media efficiency",
              formula: "CPM = spend ÷ impressions × 1000; CTR = clicks ÷ impressions; CPC = spend ÷ clicks — all platform-reported, over the scope and window.",
              source: "Warehouse pipeline (platform-reported delivery metrics)",
            }}
          />
          <MetricCard
            metricKey="contribution"
            label="Contribution before ads (CM2)"
            value={
              liveView.costedCoverage >= 0.9 && liveView.netRevenue > 0
                ? formatMoney(Math.round(liveView.cm2) * 100, "MYR", { compact: true })
                : "—"
            }
            hint={
              liveView.costedCoverage >= 0.9
                ? `CM2 margin ${liveView.netRevenue > 0 ? formatPercent(liveView.cm2 / liveView.netRevenue, 0) : "—"} · before ad spend`
                : `Needs ≥90% SKU-mapping coverage (now ${formatPercent(liveView.costedCoverage, 0)})`
            }
            info={{
              title: "Contribution before ads (CM2)",
              formula: `Fullkit revenue − COGS (RM ${Math.round(liveView.cogs).toLocaleString()}) − delivery (RM ${Math.round(liveView.delivery).toLocaleString()}) − returns (RM ${Math.round(liveView.returnsCost).toLocaleString()}) − COD fees (RM ${Math.round(liveView.codCost).toLocaleString()}). What each order earns after making and delivering it, before any marketing.`,
              source: "Orders + Finance cost rules + NinjaVan RTS parcels",
              caveat: "The gap between CM2 and CM3 is your total ad cost incl. WHT — CM2 is the ceiling ads can spend into before the P&L goes negative.",
            }}
          />
          <MetricCard
            metricKey="contribution"
            label="Contribution after ads (CM3)"
            value={
              liveView.costedCoverage >= 0.9 && liveView.netRevenue > 0
                ? formatMoney(Math.round(liveView.cm3) * 100, "MYR", { compact: true })
                : "—"
            }
            hint={
              liveView.costedCoverage >= 0.9
                ? `CM3 margin ${liveView.netRevenue > 0 ? formatPercent(liveView.cm3 / liveView.netRevenue, 0) : "—"} · not net profit: fixed costs excluded`
                : `Needs ≥90% SKU-mapping coverage (now ${formatPercent(liveView.costedCoverage, 0)})`
            }
            info={{
              title: "Contribution after ads (CM3)",
              formula: `Fullkit revenue − COGS (RM ${Math.round(liveView.cogs).toLocaleString()}) − delivery (RM ${Math.round(liveView.delivery).toLocaleString()}) − returns (RM ${Math.round(liveView.returnsCost).toLocaleString()} · ${Math.round(liveView.rtsParcels).toLocaleString()} RTS parcels) − COD fees (RM ${Math.round(liveView.codCost).toLocaleString()}) − ad spend (RM ${Math.round(liveView.spend).toLocaleString()}) − WHT (RM ${Math.round(liveView.wht).toLocaleString()}).`,
              source: "Orders (zone by postcode, COD by payment method) + NinjaVan RTS parcels + warehouse ad spend + Finance cost rules",
              caveat: "Launching email/SMS and other marketing costs have no data source yet. Fixed costs (payroll, rent, tools) excluded — this is contribution, not net profit. Pack sizes default to 1 until set, understating COGS. RTS parcels are Fighter-booked and mostly unlinked to orders, so their return cost is allocated across MY brands by order share.",
            }}
          />
        </section>
      ) : liveLoading ? (
        <section
          aria-label="Loading scorecard"
          role="status"
          className="grid grid-cols-2 gap-3 lg:grid-cols-4"
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <MetricCardSkeleton key={i} />
          ))}
        </section>
      ) : (
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4 2xl:grid-cols-7">
        <MetricCard metricKey="ad_spend" value={formatMoney(totalSpend, "MYR", { compact: true })} hint={`Last ${days} day${days > 1 ? "s" : ""}`} />
        <MetricCard
          metricKey="ad_spend"
          label="Platform-attributed revenue"
          value={formatMoney(totalPlatformRevenue, "MYR", { compact: true })}
          hint="Platform claim — see caveat"
        />
        <MetricCard metricKey="orders" label="Fullkit orders (attributed)" value={attributedOrders.length.toLocaleString()} hint="Orders carrying a campaign reference" />
        <MetricCard metricKey="new_customer_mix" label="New customers (platform)" value={totalNewCustomers.toLocaleString()} />
        <MetricCard metricKey="blended_mer" value={totals.adSpend > 0 ? formatRatio(totals.netRevenue / totals.adSpend) : "—"} hint="Net revenue ÷ spend" />
        <MetricCard metricKey="contribution" value={formatMoney(totals.contribution, "MYR", { compact: true })} />
        <MetricCard
          metricKey="target_variance"
          value={
            totalSpend > 0
              ? formatPercent((totalPlatformRevenue / totalSpend - 3.0) / 3.0, 0, true)
              : "—"
          }
          hint="Platform MER vs 3.0 blended target"
        />
      </section>
      )}

      {liveLoading ? (
        <ChartCardSkeleton height={224} />
      ) : (
        <ChartCard
          title={`Spend vs platform-attributed revenue — ${rangeLabel(session.dateRange, session.customRange)}`}
          subtitle={liveView ? "Warehouse pipeline — platform purchase value vs spend, MYR" : "MYR-normalized across all connected accounts"}
          right={<ChartLegend items={[{ label: "Platform revenue", color: "var(--chart-1)" }, { label: "Ad spend", color: "var(--chart-2)" }]} />}
        >
          <SpendRevenueTrend data={liveView ? liveView.chart : trendData} currencyLabel="RM" />
        </ChartCard>
      )}

      {/* campaign explorer — live warehouse table when data exists, demo otherwise */}
      <LiveCampaignExplorer platforms={platformFilter} fallback={
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Campaign explorer</CardTitle>
          <p className="text-xs text-muted-foreground">
            Campaign → ad set → ad. Expand a campaign for its creative, product, landing page, and inventory context.
          </p>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">Campaign</th>
                  <th className="pb-2 font-medium">Platform</th>
                  <th className="pb-2 font-medium">Brand / market</th>
                  <th className="pb-2 text-right font-medium">Spend</th>
                  <th className="pb-2 text-right font-medium">Platform rev</th>
                  <th className="pb-2 text-right font-medium">MER vs target</th>
                  <th className="pb-2 text-right font-medium">Fullkit orders</th>
                  <th className="pb-2 text-right font-medium">New cust.</th>
                </tr>
              </thead>
              <tbody>
                {campaignTotals
                  .sort((a, b) => b.spend - a.spend)
                  .map(({ campaign: c, spend, revenue, fkOrders, newCustomers, mer }) => {
                    const isOpen = openCampaign === c.id;
                    const merOk = mer >= c.targetMer;
                    const brand = brands.find((b) => b.id === c.brandId);
                    const fullkitAttributed = orders.filter((o) => o.campaignId === c.id).length;
                    return (
                      <CampaignRows
                        key={c.id}
                        c={c}
                        brandName={brand?.name.replace(" (Demo)", "") ?? c.brandId}
                        spend={spend}
                        revenue={revenue}
                        mer={mer}
                        merOk={merOk}
                        fkOrders={fkOrders}
                        fullkitAttributed={fullkitAttributed}
                        newCustomers={newCustomers}
                        isOpen={isOpen}
                        onToggle={() => setOpenCampaign(isOpen ? null : c.id)}
                        products={products}
                        integrations={integrations}
                      />
                    );
                  })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
      } />
    </PageBody>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function CampaignRows({
  c, brandName, spend, revenue, mer, merOk, fkOrders, fullkitAttributed, newCustomers, isOpen, onToggle, products, integrations,
}: any) {
  const stockoutSkus = c.productSkus.filter((sku: string) => {
    const v = products.flatMap((p: any) => p.variants).find((x: any) => x.sku === sku);
    return v && v.onHand - v.reserved <= 0;
  });
  return (
    <>
      <tr className="cursor-pointer border-b hover:bg-accent/40" onClick={onToggle}>
        <td className="py-2">
          <span className="flex items-center gap-1.5">
            {isOpen ? <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden /> : <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden />}
            <span className="font-medium">{c.name}</span>
            {c.id === "CMP-0003" && (
              <Badge variant="outline" className="border-warning/30 bg-warning/10 text-[10px] text-warning">CPM spike</Badge>
            )}
          </span>
        </td>
        <td className="py-2 text-muted-foreground">{PLATFORM_LABEL[c.platform]}</td>
        <td className="py-2 text-muted-foreground">{brandName} · {c.market}</td>
        <td className="py-2 text-right"><MoneyCell minor={spend} currency={c.currency} /></td>
        <td className="py-2 text-right"><MoneyCell minor={revenue} currency={c.currency} /></td>
        <td className={cn("tnum py-2 text-right font-medium", merOk ? "text-success" : "text-destructive")}>
          {mer.toFixed(2)} / {c.targetMer.toFixed(1)}
        </td>
        <td className="tnum py-2 text-right">{fkOrders.toLocaleString()}</td>
        <td className="tnum py-2 text-right">{newCustomers.toLocaleString()}</td>
      </tr>
      {isOpen && (
        <tr className="border-b bg-muted/30">
          <td colSpan={8} className="px-4 py-3">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">Ad sets & ads</div>
                <ul className="space-y-1.5">
                  {c.children.map((child: any) => (
                    <li key={child.id} className="flex items-center gap-2 text-xs">
                      <Badge variant="outline" className="w-14 justify-center text-[10px]">{child.level === "ad_set" ? "ad set" : "ad"}</Badge>
                      <span className="min-w-0 flex-1 truncate">{child.name}</span>
                      <span className="tnum text-muted-foreground">
                        RM{(child.spend / 100).toLocaleString("en-MY", { maximumFractionDigits: 0 })} → RM{(child.platformRevenue / 100).toLocaleString("en-MY", { maximumFractionDigits: 0 })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-2 text-xs">
                <div className="text-xs font-medium text-muted-foreground">Linked context</div>
                <div className="flex flex-wrap gap-1.5">
                  {c.productSkus.map((sku: string) => (
                    <Link key={sku} href={`/catalog?sku=${sku}`} className={cn("rounded border px-1.5 py-0.5 font-mono text-[10px] underline-offset-2 hover:underline", stockoutSkus.includes(sku) ? "border-destructive/30 bg-destructive/10 text-destructive" : "text-info")}>
                      {sku}{stockoutSkus.includes(sku) ? " · OUT OF STOCK" : ""}
                    </Link>
                  ))}
                </div>
                {c.children.some((ch: any) => ch.landingPage) && (
                  <div className="text-muted-foreground">
                    Landing pages: {c.children.filter((ch: any) => ch.landingPage).map((ch: any) => ch.landingPage).join(", ")} (Novomira/Woo)
                  </div>
                )}
                {c.children.some((ch: any) => ch.creative) && (
                  <div className="text-muted-foreground">
                    Creatives: {c.children.filter((ch: any) => ch.creative).map((ch: any) => ch.creative).join(", ")}
                  </div>
                )}
                <div className="text-muted-foreground">
                  Fullkit orders referencing this campaign: <span className="tnum text-foreground">{fullkitAttributed}</span>{" "}
                  <span>· customer quality visible per order in the Orders table</span>
                </div>
                {stockoutSkus.length > 0 && (
                  <p className="rounded border border-destructive/25 bg-destructive/10 px-2 py-1.5 text-destructive">
                    This campaign advertises a stocked-out SKU — see Growth recommendation REC-0033.
                  </p>
                )}
                <div className="flex items-center gap-2 text-muted-foreground">
                  Source health:{" "}
                  {(() => {
                    const integrationId = c.platform === "meta" ? "INT-meta" : c.platform === "google" ? "INT-google" : c.platform === "tiktok" ? "INT-tiktok" : "INT-shopee";
                    const i = integrations.find((x: any) => x.id === integrationId);
                    return i ? (
                      <Link href={`/integrations/${i.id}`} className="inline-flex items-center gap-1.5 text-info underline-offset-2 hover:underline">
                        {i.name}
                      </Link>
                    ) : null;
                  })()}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function MarketingPage() {
  return (
    <RouteGuard permission="marketing.view">
      <MarketingInner />
    </RouteGuard>
  );
}
