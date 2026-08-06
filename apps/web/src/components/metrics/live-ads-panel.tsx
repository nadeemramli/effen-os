"use client";

import { useAppStore } from "@/lib/store/provider";
import type { GrowthAds, LiveBrand } from "@/lib/supabase/live";
import { FreshnessBadge } from "@/components/status/freshness-badge";

/**
 * Live ads spend from the warehouse pipeline (ADR-0003): Airbyte → BigQuery
 * → dbt → ad_daily_facts. Brand × market grain via the dbt attribution
 * waterfall (brand from destination URL / page / campaign evidence, market
 * from Meta targeting geo) — NOT the account register, so unregistered
 * accounts and unattributed spend stay visible. Data is fetched once by the
 * Marketing page and shared across its live surfaces.
 */
export function LiveAdsPanel({ ads, brands }: { ads: GrowthAds; brands: LiveBrand[] }) {
  const liveBrandId = useAppStore((s) => s.session.liveBrandId);
  const liveMarkets = useAppStore((s) => s.session.liveMarkets);

  const scopeSlug = liveBrandId === null ? null : (brands.find((b) => b.id === liveBrandId)?.slug ?? null);
  const rows = ads.rows.filter(
    (r) =>
      (scopeSlug === null || r.brand_slug === scopeSlug) &&
      (liveMarkets.length === 0 || liveMarkets.includes(r.market ?? "")),
  );
  if (rows.length === 0) return null;

  const brandLabel = (slug: string | null) => {
    if (slug === null) return "Unattributed";
    return brands.find((b) => b.slug === slug)?.name ?? slug;
  };
  const registered = new Set(brands.map((b) => b.slug));

  const spend = rows.reduce((s, r) => s + Number(r.spend), 0);
  const purchases = rows.reduce((s, r) => s + Number(r.purchases ?? 0), 0);
  const purchaseValue = rows.reduce((s, r) => s + Number(r.purchase_value ?? 0), 0);
  const bannedSpend = rows.reduce((s, r) => s + Number(r.banned_spend ?? 0), 0);
  const unattributed = rows.filter((r) => r.brand_slug === null).reduce((s, r) => s + Number(r.spend), 0);

  return (
    <section aria-label="Live ads spend (warehouse)" className="space-y-2 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          Ads — warehouse mirror, last {ads.window_days} days
          <FreshnessBadge lastSuccessAt={ads.as_of} slaMinutes={26 * 60} realClock />
        </h2>
        <span className="tnum text-sm">
          RM {Math.round(spend).toLocaleString()} spend · {purchases.toLocaleString()} purchases · platform ROAS{" "}
          {spend > 0 && purchaseValue > 0 ? (purchaseValue / spend).toFixed(2) : "—"}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((r) => {
          const rSpend = Number(r.spend);
          const rPurch = Number(r.purchases ?? 0);
          const key = `${r.brand_slug ?? "unattributed"}·${r.market ?? "?"}`;
          const unregisteredBrand = r.brand_slug !== null && !registered.has(r.brand_slug);
          return (
            <div key={key} className="flex items-baseline justify-between gap-2">
              <span className="truncate text-xs text-muted-foreground">
                {brandLabel(r.brand_slug)} · {r.market ?? "?"} · {r.accounts} acc
                {unregisteredBrand && <span className="text-warning"> · unregistered</span>}
              </span>
              <span className="tnum whitespace-nowrap">
                RM {Math.round(rSpend).toLocaleString()} · CPP{" "}
                {rPurch > 0 ? `RM ${(rSpend / rPurch).toFixed(0)}` : "—"}
              </span>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {ads.total.accounts} accounts · {ads.total.campaigns.toLocaleString()} campaigns via the warehouse
        pipeline. Brand from the dbt attribution waterfall, market from Meta targeting geo.
        {unattributed > 0 &&
          ` RM ${Math.round(unattributed).toLocaleString()} unattributed — queued for brand-token review.`}
        {bannedSpend > 0 &&
          ` RM ${Math.round(bannedSpend).toLocaleString()} from banned-account history.`}{" "}
        Platform attribution is not incrementality.
      </p>
    </section>
  );
}
