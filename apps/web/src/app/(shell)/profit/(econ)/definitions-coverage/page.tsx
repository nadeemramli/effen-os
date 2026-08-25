"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { monthLabel, pct, rm } from "@/lib/domain/customer-economics";
import { EconShell, ReasonList } from "../_components/econ-shell";

const DECISIONS: Record<string, string> = {
  D3: "Spend in blended nCAC: Meta spend from ad_daily_facts net of the dated WHT rule; banned-account spend included and reported.",
  D4: "Paid attribution: provider purchase share (purchases ÷ accepted orders, capped at 1) by brand/market/month — non-incremental.",
  D5: "Day-0 variable costs in FOP: COGS, delivery, COD fee, and the expected return leg (monthly RTS rate × delivery) only where carrier evidence exists; no marketplace commission yet.",
  D6: "Horizons: 0 / 30 / 60 / 90 / 180 / 365 days; a horizon is published only when every customer of the cohort month has reached it.",
  D7: "FX: none. Contribution is MYR-only; SG scopes (SGD revenue, MYR costs) are marked currency_mixed and contribution-based metrics are withheld.",
};

const ORDER = ["ncac_accepted", "ncac_delivered", "ncac_paid", "cpa_platform", "first_order_contribution", "fop", "ltv_per_customer", "ltv_ncac", "payback", "currency", "suppression"];

export default function DefinitionsCoveragePage() {
  return (
    <EconShell
      title="Definitions & coverage"
      description="Exactly how every number on the customer-economics pages is computed, which owner decisions it rests on, and why a given cohort cell is withheld."
    >
      {(econ) => (
        <>
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-sm font-medium">Formulas · {econ.metric_version}</CardTitle></CardHeader>
              <CardContent>
                <dl className="space-y-2 text-xs">
                  {ORDER.filter((k) => econ.definitions[k]).map((k) => (
                    <div key={k}>
                      <dt className="font-medium">{k.replace(/_/g, " ")}</dt>
                      <dd className="text-muted-foreground">{econ.definitions[k]}</dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
            <div className="space-y-4">
              <Card>
                <CardHeader><CardTitle className="text-sm font-medium">Provisional owner decisions</CardTitle></CardHeader>
                <CardContent>
                  <ul className="space-y-2 text-xs">
                    {econ.decisions.map((d) => (
                      <li key={d} className="flex gap-2">
                        <Badge variant="outline" className="h-5 shrink-0 font-normal">{d}</Badge>
                        <span className="text-muted-foreground">{DECISIONS[d] ?? "See program plan §7."}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-[11px] text-muted-foreground">Confirming or changing a decision produces a new metric version; nothing here is rewritten silently.</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-sm font-medium">Cost rules in effect</CardTitle></CardHeader>
                <CardContent className="text-xs">
                  <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
                    <dt className="text-muted-foreground">Effective from</dt><dd className="tnum">{econ.rules.effective_from}</dd>
                    <dt className="text-muted-foreground">Unit cost</dt><dd className="tnum">{rm(econ.rules.unit_cost_myr, 2)} / base unit</dd>
                    <dt className="text-muted-foreground">Delivery MY west / east</dt><dd className="tnum">{rm(econ.rules.delivery_my_west, 2)} / {rm(econ.rules.delivery_my_east, 2)}</dd>
                    <dt className="text-muted-foreground">Delivery SG</dt><dd className="tnum">{rm(econ.rules.delivery_sg_myr, 2)}</dd>
                    <dt className="text-muted-foreground">COD fee</dt><dd className="tnum">{rm(econ.rules.cod_fee, 2)}</dd>
                    <dt className="text-muted-foreground">WHT on Meta spend</dt><dd className="tnum">{pct(econ.rules.wht_rate, 0)}</dd>
                  </dl>
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Cohort</th>
                  <th className="px-3 py-2 text-right font-medium" title="Accepted orders with a resolved identity ÷ accepted orders in the month">Identity</th>
                  <th className="px-3 py-2 text-right font-medium" title="Base units with a mapped cost ÷ all units, over the cohort's observed life">SKU cost</th>
                  <th className="px-3 py-2 font-medium">Spend rows</th>
                  <th className="px-3 py-2 font-medium">Currencies</th>
                  <th className="px-3 py-2 font-medium">Return evidence</th>
                  <th className="px-3 py-2 font-medium">Withheld because</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {econ.cohorts.map((c) => (
                  <tr key={c.cohort_month}>
                    <td className="px-3 py-1.5 font-medium">{monthLabel(c.cohort_month)}</td>
                    <td className="tnum px-3 py-1.5 text-right">{pct(c.coverage.identity)}</td>
                    <td className="tnum px-3 py-1.5 text-right">{pct(c.coverage.cost)}</td>
                    <td className="px-3 py-1.5">{c.coverage.spend ? `yes · ${c.spend?.fact_rows ?? 0} rows` : "none"}</td>
                    <td className="px-3 py-1.5">{c.coverage.currencies}{c.coverage.currency_mixed && <span className="text-warning"> · mixed</span>}</td>
                    <td className="px-3 py-1.5">{c.coverage.returns_evidence ? "carrier feed" : "none this month"}</td>
                    <td className="px-3 py-1.5"><ReasonList reasons={c.suppressed} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </EconShell>
  );
}
