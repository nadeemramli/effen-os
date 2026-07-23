"use client";

import Link from "next/link";
import { parseAsString, useQueryState } from "nuqs";
import { useMemo } from "react";
import { ChevronDown, ChevronRight, Info, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartLegend, SpendRevenueTrend } from "@/components/charts/commercial-charts";
import { MetricCard } from "@/components/metrics/metric-card";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { MoneyCell } from "@/components/tables/cells";
import { FreshnessBadge } from "@/components/status/freshness-badge";
import { useSession } from "@/hooks/use-session";
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

      {/* attribution caveat — always visible */}
      <p className="flex items-start gap-2 rounded-md border border-info/25 bg-info/10 px-3 py-2 text-xs text-info">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        Platform-attributed revenue is each platform&apos;s own claim. It is not accounting revenue and not proven
        incrementality — platforms overlap and self-attribute. Fullkit orders and contribution are the commercial truth.
      </p>

      {/* account coverage */}
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

      {/* scorecard */}
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

      <ChartCard
        title="Spend vs platform-attributed revenue, 30 days"
        subtitle="MYR-normalized across all connected accounts"
        right={<ChartLegend items={[{ label: "Platform revenue", color: "var(--chart-1)" }, { label: "Ad spend", color: "var(--chart-2)" }]} />}
      >
        <SpendRevenueTrend data={trendData} currencyLabel="RM" />
      </ChartCard>

      {/* campaign explorer */}
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
                    <Link key={sku} href={`/catalog/products?sku=${sku}`} className={cn("rounded border px-1.5 py-0.5 font-mono text-[10px] underline-offset-2 hover:underline", stockoutSkus.includes(sku) ? "border-destructive/30 bg-destructive/10 text-destructive" : "text-info")}>
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
