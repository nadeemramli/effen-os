"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FreshnessBadge } from "@/components/status/freshness-badge";
import { useAppStore } from "@/lib/store/provider";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { fetchLiveBrands, type LiveBrand } from "@/lib/supabase/live";
import { cn } from "@/lib/utils";

/**
 * Campaign explorer over the warehouse pipeline (ADR-0003): campaign-grain
 * rows from ad_daily_facts with dbt brand attribution and targeting-geo
 * market. Renders its own card when live data exists; otherwise renders the
 * fallback (the demo explorer) so demo mode is unaffected.
 */

interface CampaignRow {
  campaign_id: string;
  campaign_name: string | null;
  brand_slug: string | null;
  market: string | null;
  platform: string;
  accounts: number;
  spend: number;
  purchases: number | null;
  purchase_value: number | null;
  last_active: string;
  is_banned_account: boolean;
}

interface GrowthCampaigns {
  as_of: string | null;
  window_days: number;
  total_campaigns: number;
  rows: CampaignRow[];
}

export function LiveCampaignExplorer({ fallback }: { fallback: React.ReactNode }) {
  const [data, setData] = useState<{ campaigns: GrowthCampaigns; brands: LiveBrand[] } | null>(null);
  const liveBrandId = useAppStore((s) => s.session.liveBrandId);
  const liveMarkets = useAppStore((s) => s.session.liveMarkets);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    void (async () => {
      const { data: session } = await getSupabase().auth.getSession();
      if (!session.session) return;
      const [res, brands] = await Promise.all([
        getSupabase().rpc("live_growth_campaigns", { p_days: 30, p_limit: 60 }),
        fetchLiveBrands(),
      ]);
      const campaigns = res.data as GrowthCampaigns | null;
      if (!res.error && campaigns && campaigns.rows.length > 0) {
        setData({ campaigns, brands });
      }
    })();
  }, []);

  if (!data) return <>{fallback}</>;
  const { campaigns, brands } = data;

  const scopeSlug = liveBrandId === null ? null : (brands.find((b) => b.id === liveBrandId)?.slug ?? null);
  const rows = campaigns.rows.filter(
    (r) =>
      (scopeSlug === null || r.brand_slug === scopeSlug) &&
      (liveMarkets.length === 0 || liveMarkets.includes(r.market ?? "")),
  );
  if (rows.length === 0) return <>{fallback}</>;

  const brandLabel = (slug: string | null) =>
    slug === null ? "—" : (brands.find((b) => b.slug === slug)?.name ?? slug);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          Campaign explorer — warehouse, last {campaigns.window_days} days
          <FreshnessBadge lastSuccessAt={campaigns.as_of} slaMinutes={26 * 60} />
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Top {rows.length} of {campaigns.total_campaigns.toLocaleString()} campaigns by spend. Brand via the
          attribution waterfall; market via Meta targeting geo. Purchases and value are platform-reported.
        </p>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="pb-2 font-medium">Campaign</th>
                <th className="pb-2 font-medium">Brand / market</th>
                <th className="pb-2 text-right font-medium">Spend</th>
                <th className="pb-2 text-right font-medium">Purchases</th>
                <th className="pb-2 text-right font-medium">CPP</th>
                <th className="pb-2 text-right font-medium">Platform ROAS</th>
                <th className="pb-2 text-right font-medium">Last active</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const purch = Number(r.purchases ?? 0);
                const value = Number(r.purchase_value ?? 0);
                const spend = Number(r.spend);
                const roas = spend > 0 && value > 0 ? value / spend : null;
                return (
                  <tr key={`${r.campaign_id}·${r.brand_slug}·${r.market}`} className="border-b last:border-0">
                    <td className="max-w-80 py-2">
                      <div className="truncate font-medium">{r.campaign_name ?? r.campaign_id}</div>
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="uppercase">{r.platform}</span>
                        {r.is_banned_account && (
                          <Badge variant="outline" className="border-warning/30 bg-warning/10 text-[10px] text-warning">
                            banned acc history
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="py-2 text-muted-foreground">
                      {brandLabel(r.brand_slug)} · {r.market ?? "?"}
                    </td>
                    <td className="tnum py-2 text-right">RM {Math.round(spend).toLocaleString()}</td>
                    <td className="tnum py-2 text-right">{purch > 0 ? purch.toLocaleString() : "—"}</td>
                    <td className="tnum py-2 text-right">{purch > 0 ? `RM ${(spend / purch).toFixed(0)}` : "—"}</td>
                    <td className={cn("tnum py-2 text-right font-medium", roas !== null && (roas >= 2 ? "text-success" : "text-destructive"))}>
                      {roas !== null ? roas.toFixed(2) : "—"}
                    </td>
                    <td className="tnum py-2 text-right text-xs text-muted-foreground">{r.last_active}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
