"use client";

import Link from "next/link";
import { parseAsString, useQueryState } from "nuqs";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Info, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartLegend, SpendRevenueTrend } from "@/components/charts/commercial-charts";
import { LiveAdsPanel } from "@/components/metrics/live-ads-panel";
import { LiveCampaignExplorer } from "@/components/metrics/live-campaign-explorer";
import { MetricCard } from "@/components/metrics/metric-card";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { MoneyCell } from "@/components/tables/cells";
import { FreshnessBadge } from "@/components/status/freshness-badge";
import { useSession } from "@/hooks/use-session";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import {
  fetchGrowthAds,
  fetchLiveBrands,
  fetchLiveScorecard,
  type GrowthAds,
  type LiveBrand,
  type LiveScorecardRow,
} from "@/lib/supabase/live";
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
  // panel, account coverage, scorecard, and trend. Demo store renders when
  // absent.
  const [growth, setGrowth] = useState<{
    ads: GrowthAds;
    liveBrands: LiveBrand[];
    scorecard: LiveScorecardRow[];
  } | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    void (async () => {
      const { data: s } = await getSupabase().auth.getSession();
      if (!s.session) return;
      try {
        const [ads, liveBrands, scorecard] = await Promise.all([
          fetchGrowthAds(30),
          fetchLiveBrands(),
          fetchLiveScorecard().catch(() => [] as LiveScorecardRow[]),
        ]);
        if (ads) setGrowth({ ads, liveBrands, scorecard });
      } catch (e) {
        // Live surfaces degrade to the demo store; never a blank page.
        console.warn("growth ads fetch failed", e);
      }
    })();
  }, []);

  const days = session.dateRange === "today" ? 1 : session.dateRange === "7d" ? 7 : 30;
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
    const { ads, liveBrands, scorecard } = growth;
    const scopeSlug = liveBrandId === null ? null : (liveBrands.find((b) => b.id === liveBrandId)?.slug ?? null);
    const inScope = (slug: string | null, mkt: string | null) =>
      (scopeSlug === null || slug === scopeSlug) &&
      (liveMarkets.length === 0 || liveMarkets.includes(mkt ?? ""));
    const cutoff = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
    const trend = ads.trend.filter((t) => inScope(t.brand_slug, t.market));
    const windowed = trend.filter((t) => t.date >= cutoff);
    const spend = windowed.reduce((s, t) => s + Number(t.spend), 0);
    const purchases = windowed.reduce((s, t) => s + Number(t.purchases ?? 0), 0);
    const purchaseValue = windowed.reduce((s, t) => s + Number(t.purchase_value ?? 0), 0);
    const win = days === 1 ? "today" : days === 7 ? "d7" : "d30";
    const scopeBrandIds = scopeSlug === null
      ? null
      : new Set(liveBrands.filter((b) => b.slug === scopeSlug).map((b) => b.id));
    const netRevenue = scorecard
      .filter((r) => r.win === win)
      .filter((r) => scopeBrandIds === null || (r.brand_id !== null && scopeBrandIds.has(r.brand_id)))
      .filter((r) => liveMarkets.length === 0 || liveMarkets.includes(r.market))
      .reduce((s, r) => s + toMYR(Number(r.revenue), r.currency_code), 0);
    const byDate = new Map<string, { spend: number; revenue: number }>();
    for (const t of trend) {
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
        (liveMarkets.length === 0 || a.markets.some((m) => liveMarkets.includes(m))),
    );
    return { spend, purchases, purchaseValue, netRevenue, chart, liveAccounts };
  }, [growth, liveBrandId, liveMarkets, days]);

  // Brand performance: every brand as a row regardless of the brand scope
  // (market scope + date window still apply), so "all brands" is the mix and
  // one click focuses the whole page on a single brand.
  const brandPerf = useMemo(() => {
    if (!growth) return null;
    const { ads, liveBrands, scorecard } = growth;
    const cutoff = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
    const win = days === 1 ? "today" : days === 7 ? "d7" : "d30";
    const mktOk = (m: string | null) => liveMarkets.length === 0 || liveMarkets.includes(m ?? "");

    const bySlug = new Map<string | null, { spend: number; purchases: number; value: number }>();
    for (const t of ads.trend) {
      if (!mktOk(t.market) || t.date < cutoff) continue;
      const cur = bySlug.get(t.brand_slug) ?? { spend: 0, purchases: 0, value: 0 };
      cur.spend += Number(t.spend);
      cur.purchases += Number(t.purchases ?? 0);
      cur.value += Number(t.purchase_value ?? 0);
      bySlug.set(t.brand_slug, cur);
    }

    const revenueBySlug = new Map<string, number>();
    for (const r of scorecard) {
      if (r.win !== win || !mktOk(r.market) || r.brand_id === null) continue;
      const slug = liveBrands.find((b) => b.id === r.brand_id)?.slug;
      if (!slug) continue;
      revenueBySlug.set(slug, (revenueBySlug.get(slug) ?? 0) + toMYR(Number(r.revenue), r.currency_code));
    }

    const slugs = new Set<string | null>([...bySlug.keys(), ...revenueBySlug.keys()]);
    const rows = [...slugs].map((slug) => {
      const ad = bySlug.get(slug) ?? { spend: 0, purchases: 0, value: 0 };
      const revenue = slug === null ? 0 : (revenueBySlug.get(slug) ?? 0);
      const brand = slug === null ? undefined : liveBrands.find((b) => b.slug === slug);
      return {
        slug,
        name: slug === null ? "Unattributed" : (brand?.name ?? slug),
        brandId: brand?.id ?? null,
        registered: slug === null ? true : Boolean(brand),
        ...ad,
        revenue,
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
      }),
      { spend: 0, purchases: 0, value: 0, revenue: 0 },
    );
    return { rows, mix };
  }, [growth, liveMarkets, days]);

  return (
    <PageBody className="max-w-none">
      <PageHeader
        title="Marketing"
        description="Consolidated Meta, Google, and TikTok view — spend and platform attribution beside Fullkit order truth."
      >
        <Button asChild size="sm" className="gap-1.5">
          <Link href="/marketing/accounts/new"><Plus className="size-3.5" aria-hidden /> Connect ad account</Link>
        </Button>
      </PageHeader>

      {/* live warehouse spend mirror — renders only with a real session + data */}
      {growth && <LiveAdsPanel ads={growth.ads} brands={growth.liveBrands} />}

      {/* attribution caveat — always visible */}
      <p className="flex items-start gap-2 rounded-md border border-info/25 bg-info/10 px-3 py-2 text-xs text-info">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Platform-attributed revenue is each platform&apos;s own claim. It is not accounting revenue and not proven
        incrementality — platforms overlap and self-attribute. Fullkit orders and contribution are the commercial truth.
      </p>

      {/* account coverage — live warehouse accounts (incl. unregistered) or demo */}
      {liveView ? (
        <section aria-label="Account coverage" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {liveView.liveAccounts.slice(0, 10).map((a) => (
            <div
              key={a.account_id}
              className={cn("rounded-lg border bg-card p-3", !a.registered && "border-warning/40")}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">Meta</span>
                {a.is_banned ? (
                  <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-[10px] text-destructive">banned</Badge>
                ) : a.registered ? (
                  <Badge variant="outline" className="border-success/30 bg-success/10 text-[10px] text-success">registered</Badge>
                ) : (
                  <Badge variant="outline" className="border-warning/30 bg-warning/10 text-[10px] text-warning">unregistered</Badge>
                )}
              </div>
              <div className="mt-1 truncate text-sm">{a.name ?? a.account_id}</div>
              <div className="tnum truncate text-[11px] text-muted-foreground">
                {a.brands.length > 0 ? a.brands.join(", ") : "unattributed"} · {a.markets.join("/") || "?"}
              </div>
              <div className="tnum mt-0.5 text-[11px] text-muted-foreground">
                RM {Math.round(Number(a.spend)).toLocaleString()} 30d · last {a.last_active}
              </div>
              {!a.registered && (
                <p className="mt-1 text-[11px] text-warning">Not in the Fullkit register yet.</p>
              )}
            </div>
          ))}
          {liveView.liveAccounts.length > 10 && (
            <div className="flex items-center justify-center rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
              +{liveView.liveAccounts.length - 10} more accounts in the pipeline
            </div>
          )}
        </section>
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
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
          <MetricCard
            metricKey="ad_spend"
            value={formatMoney(Math.round(liveView.spend) * 100, "MYR", { compact: true })}
            hint={`Last ${days} day${days > 1 ? "s" : ""} · warehouse`}
          />
          <MetricCard
            metricKey="ad_spend"
            label="Platform-attributed value"
            value={formatMoney(Math.round(liveView.purchaseValue) * 100, "MYR", { compact: true })}
            hint="Platform claim — see caveat"
          />
          <MetricCard
            metricKey="orders"
            label="Platform purchases"
            value={liveView.purchases.toLocaleString()}
            hint="Platform-reported conversions"
          />
          <MetricCard
            metricKey="ad_spend"
            label="Cost per purchase"
            value={liveView.purchases > 0 ? `RM ${(liveView.spend / liveView.purchases).toFixed(0)}` : "—"}
          />
          <MetricCard
            metricKey="blended_mer"
            label="Platform MER"
            value={liveView.spend > 0 && liveView.purchaseValue > 0 ? formatRatio(liveView.purchaseValue / liveView.spend) : "—"}
            hint="Platform value ÷ spend"
          />
          <MetricCard
            metricKey="blended_mer"
            value={liveView.spend > 0 && liveView.netRevenue > 0 ? formatRatio(liveView.netRevenue / liveView.spend) : "—"}
            hint="Fullkit net revenue ÷ spend"
          />
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

      <ChartCard
        title="Spend vs platform-attributed revenue, 30 days"
        subtitle={liveView ? "Warehouse pipeline — platform purchase value vs spend, MYR" : "MYR-normalized across all connected accounts"}
        right={<ChartLegend items={[{ label: "Platform revenue", color: "var(--chart-1)" }, { label: "Ad spend", color: "var(--chart-2)" }]} />}
      >
        <SpendRevenueTrend data={liveView ? liveView.chart : trendData} currencyLabel="RM" />
      </ChartCard>

      {/* brand performance — the per-brand money story + the all-brands mix */}
      {brandPerf && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Brand performance</CardTitle>
            <p className="text-xs text-muted-foreground">
              Warehouse ad spend vs Fullkit net revenue per brand, last {days} day{days > 1 ? "s" : ""}.
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
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* campaign explorer — live warehouse table when data exists, demo otherwise */}
      <LiveCampaignExplorer fallback={
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
                    This campaign advertises a stocked-out SKU — see Prophit recommendation REC-0033.
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
