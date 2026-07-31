"use client";

import { useEffect, useState } from "react";
import { useAppStore } from "@/lib/store/provider";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import { fetchLiveBrands, type LiveBrand } from "@/lib/supabase/live";

/**
 * Live Meta spend over the ad_daily_facts mirror. Renders only when a real
 * Supabase session exists and facts are present; otherwise renders nothing
 * and the demo surfaces below stand alone. Spend is platform-reported and
 * attribution is NOT incrementality — the caption says so.
 */

interface AccountRow {
  id: number;
  name: string | null;
  business_name: string | null;
  account_status: string | null;
  brand_id: number | null;
  market: string | null;
  is_active: boolean;
}

interface FactRow {
  account_ref: number;
  date: string;
  spend: number | null;
  purchases: number | null;
}

export function LiveAdsPanel() {
  const [data, setData] = useState<{ accounts: AccountRow[]; facts: FactRow[]; brands: LiveBrand[] } | null>(null);
  const liveBrandId = useAppStore((s) => s.session.liveBrandId);
  const liveMarkets = useAppStore((s) => s.session.liveMarkets);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    void (async () => {
      const { data: session } = await getSupabase().auth.getSession();
      if (!session.session) return;
      const [a, f, b] = await Promise.all([
        getSupabase().from("ad_accounts_read").select("id, name, business_name, account_status, brand_id, market, is_active"),
        getSupabase().from("ad_daily_facts").select("account_ref, date, spend, purchases"),
        fetchLiveBrands(),
      ]);
      if (!a.error && !f.error && (f.data?.length ?? 0) > 0) {
        setData({ accounts: a.data as AccountRow[], facts: f.data as FactRow[], brands: b });
      }
    })();
  }, []);

  if (!data) return null;

  // Top-bar live brand + market scope: keep only matching accounts (and their facts).
  const scopedAccounts = data.accounts.filter(
    (a) =>
      (liveBrandId === null || a.brand_id === liveBrandId) &&
      (liveMarkets.length === 0 || liveMarkets.includes(a.market ?? "")),
  );
  const scopedIds = new Set(scopedAccounts.map((a) => a.id));
  const scopedFacts = data.facts.filter((f) => scopedIds.has(f.account_ref));

  const accountById = new Map(scopedAccounts.map((a) => [a.id, a]));
  const brandName = (id: number | null) =>
    id === null ? "Unmapped accounts" : data.brands.find((b) => b.id === id)?.name ?? String(id);

  const byBrand = new Map<string, { spend: number; purchases: number; accounts: Set<number> }>();
  let totalSpend = 0;
  let knownPurchases = 0;
  let purchasesMissing = false;
  for (const f of scopedFacts) {
    const acc = accountById.get(f.account_ref);
    const key = brandName(acc?.brand_id ?? null);
    const cur = byBrand.get(key) ?? { spend: 0, purchases: 0, accounts: new Set<number>() };
    cur.spend += Number(f.spend ?? 0);
    if (f.purchases === null) purchasesMissing = true;
    else cur.purchases += Number(f.purchases);
    cur.accounts.add(f.account_ref);
    byBrand.set(key, cur);
    totalSpend += Number(f.spend ?? 0);
    knownPurchases += Number(f.purchases ?? 0);
  }

  const activeAccounts = scopedAccounts.filter((a) => a.is_active).length;
  const seededAccounts = new Set(scopedFacts.map((f) => f.account_ref)).size;
  if (scopedFacts.length === 0) return null;

  return (
    <section aria-label="Live Meta spend" className="space-y-2 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Meta — live mirror, last 30 days</h2>
        <span className="tnum text-sm">
          RM {Math.round(totalSpend).toLocaleString()} spend · {knownPurchases.toLocaleString()} platform-reported purchases
        </span>
      </div>
      <div className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2 xl:grid-cols-4">
        {[...byBrand.entries()]
          .sort(([, a], [, b]) => b.spend - a.spend)
          .map(([name, v]) => (
            <div key={name} className="flex items-baseline justify-between gap-2">
              <span className="truncate text-xs text-muted-foreground">
                {name} · {v.accounts.size} acc
              </span>
              <span className="tnum whitespace-nowrap">
                RM {Math.round(v.spend).toLocaleString()} · CPP{" "}
                {v.purchases > 0 ? `RM ${(v.spend / v.purchases).toFixed(0)}` : "—"}
              </span>
            </div>
          ))}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {seededAccounts} of {activeAccounts} active accounts seeded so far (registry holds the full EFFEN estate;
        the rest land when the daily Meta sync connects). Platform attribution is not incrementality.
        {purchasesMissing && " Some days report no purchase data — conversion tracking gap flagged in Data Health."}
      </p>
    </section>
  );
}
