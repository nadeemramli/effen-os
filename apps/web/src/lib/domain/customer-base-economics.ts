/**
 * Customer Base companion series — mirrors public.live_customer_base_economics.
 * The server returns per-period source lines (revenue by currency, MYR cost
 * lines, warehouse ad spend with dated WHT, the acquisition denominator). The
 * browser composes nCAC / ROAS / CM3 with the SAME arithmetic the Profit page
 * uses, so the two never disagree, and withholds a cell whenever a source is
 * missing — never a fabricated zero.
 */

import { FX_TO_MYR } from "@/lib/domain/metrics";
import type { MovementGrain } from "@/lib/domain/lifecycle";

/** What the movement chart can show. `movement` is the reconciled flow chart itself. */
export const BASE_METRICS = ["movement", "ncac", "spend", "roas", "revenue", "cm3"] as const;
export type BaseMetric = (typeof BASE_METRICS)[number];
export type EconMetric = Exclude<BaseMetric, "movement">;

export const BASE_METRIC_LABELS: Record<BaseMetric, string> = {
  movement: "Movement",
  ncac: "nCAC",
  spend: "Ad spend",
  roas: "ROAS",
  revenue: "Revenue",
  cm3: "CM3",
};

/** Chart title per metric — the same register as the movement title. */
export const BASE_METRIC_TITLES: Record<BaseMetric, string> = {
  movement: "Movement — additions above, lapses below, net as a line",
  ncac: "nCAC — ad spend net of WHT per new customer (first accepted order)",
  spend: "Ad spend — warehouse facts, all platforms, gross of WHT",
  roas: "ROAS — recognized revenue ÷ ad spend (blended, not provider-attributed)",
  revenue: "Revenue — recognized orders (processing + completed), MYR",
  cm3: "CM3 — revenue − COGS − fulfilment − ads − WHT, before fixed costs",
};

export const BASE_METRIC_DEFINITIONS: Record<EconMetric, string> = {
  ncac:
    "Warehouse ad spend in the period (all platforms, minus WHT on Meta at the Finance rule effective that day) ÷ customers whose first accepted order fell in the period — the same accepted denominator as econ-v1 nCAC. Withheld when the period has no spend rows or no lifecycle refresh.",
  spend:
    "Warehouse ad spend (ADR-0003) summed over the period, gross of WHT; brand via the dbt attribution waterfall, market via targeting geo. Once a brand or market is selected, unattributed spend drops out — the tooltip shows the WHT and banned-account share.",
  roas:
    "Recognized revenue in the period ÷ gross ad spend in the same period. Blended, so it includes repeat orders and unpaid channels; the provider's own purchase-value ROAS is in the tooltip for comparison only. Withheld when there is no spend.",
  revenue:
    "Recognized order revenue (processing + completed) by MYT business day, from the order mirror. SGD rows are converted at the app's fixed display rate for the bar; the tooltip keeps them separate.",
  cm3:
    "Revenue − COGS (pack-expanded units × unit cost) − delivery − returns (Ninja Van RTS parcels, unlinked ones allocated by order share) − COD fees − ad spend − WHT, under the dated cost rules. Same arithmetic as the Profit page; withheld below 90% SKU-mapping coverage. Not net profit.",
};

export interface EconomicsSpend {
  gross: number;
  wht: number;
  net: number;
  purchases: number;
  purchase_value: number;
  fact_rows: number;
  banned: number;
  non_myr_rows: number;
}

export interface EconomicsPeriod {
  period_start: string;
  period_end: string;
  orders: number;
  cod_orders: number;
  base_units: number;
  unmapped_lines: number;
  /** MYR rows only; other currencies are in `revenue_by_currency`. */
  revenue_myr: number;
  revenue_by_currency: Record<string, number>;
  cogs_myr: number;
  delivery_myr: number;
  cod_myr: number;
  rts_parcels: number;
  returns_myr: number;
  /** Null when the period has no warehouse spend rows for the scope. */
  spend: EconomicsSpend | null;
  /** Null when no lifecycle policy has a completed refresh. */
  new_accepted: number | null;
  new_customers: number | null;
}

export interface EconomicsRules {
  effective_from: string;
  unit_cost_myr: number;
  delivery_my_west: number;
  delivery_my_east: number;
  delivery_sg_myr: number;
  cod_fee: number;
  wht_rate: number;
  note: string | null;
}

export interface CustomerBaseEconomics {
  status: "ok";
  grain: MovementGrain;
  from: string;
  to: string;
  scope: { type: string; brand_id: number | null; brand_slug: string | null; integration_ids: number[] | null; markets: string[] | null };
  policy_version: number | null;
  rules: EconomicsRules | null;
  commerce_refreshed_at: string | null;
  ads_as_of: string | null;
  rts_allocated: boolean;
  periods: EconomicsPeriod[];
}

export type Withhold = "no_spend_data" | "no_lifecycle" | "no_new_customers" | "coverage_below_90" | "no_revenue";

export const WITHHOLD_LABELS: Record<Withhold, string> = {
  no_spend_data: "No warehouse spend rows for this period and scope",
  no_lifecycle: "Lifecycle contract has no completed refresh — no acquisition denominator",
  no_new_customers: "No first accepted orders in the period — nCAC undefined",
  coverage_below_90: "SKU-mapping coverage below 90% — margin lines withheld",
  no_revenue: "No recognized revenue in the period",
};

/** House rule shared with the Profit page: no margin math on thin data. */
export const COVERAGE_GATE = 0.9;

export interface MetricCell {
  value: number | null;
  reason: Withhold | null;
}

export interface DerivedPeriod {
  period_start: string;
  raw: EconomicsPeriod;
  /** All currencies converted to MYR at the display rate (SGD ×3.3, as on Profit). */
  revenueMyr: number;
  mixedCurrency: boolean;
  coverage: number;
  cm2: number;
  cm3: number;
  cells: Record<EconMetric, MetricCell>;
  /** Provider-reported purchase value ÷ spend — attribution, shown for comparison only. */
  platformRoas: number | null;
}

/** Revenue across currencies in MYR — the same conversion as the Profit page's pnl(). */
export function revenueToMYR(byCurrency: Record<string, number>): number {
  return Object.entries(byCurrency).reduce((s, [ccy, v]) => s + Number(v) * (FX_TO_MYR[ccy] ?? 1), 0);
}

export function derivePeriod(p: EconomicsPeriod): DerivedPeriod {
  const revenueMyr = revenueToMYR(p.revenue_by_currency);
  const currencies = Object.keys(p.revenue_by_currency).filter((c) => Number(p.revenue_by_currency[c]) !== 0);
  const mixedCurrency = currencies.some((c) => c !== "MYR");
  const mapped = Number(p.base_units);
  const unmapped = Number(p.unmapped_lines);
  const coverage = mapped + unmapped > 0 ? mapped / (mapped + unmapped) : 0;
  const spend = p.spend;
  const cm2 = revenueMyr - Number(p.cogs_myr) - Number(p.delivery_myr) - Number(p.returns_myr) - Number(p.cod_myr);
  const cm3 = cm2 - (spend ? Number(spend.gross) + Number(spend.wht) : 0);
  const gated = coverage >= COVERAGE_GATE && revenueMyr > 0;

  const cells: Record<EconMetric, MetricCell> = {
    ncac: !spend
      ? { value: null, reason: "no_spend_data" }
      : p.new_accepted === null
        ? { value: null, reason: "no_lifecycle" }
        : p.new_accepted <= 0
          ? { value: null, reason: "no_new_customers" }
          : { value: Number(spend.net) / p.new_accepted, reason: null },
    spend: spend ? { value: Number(spend.gross), reason: null } : { value: null, reason: "no_spend_data" },
    roas: !spend || Number(spend.gross) <= 0
      ? { value: null, reason: "no_spend_data" }
      : revenueMyr <= 0
        ? { value: null, reason: "no_revenue" }
        : { value: revenueMyr / Number(spend.gross), reason: null },
    revenue: revenueMyr > 0 ? { value: revenueMyr, reason: null } : { value: null, reason: "no_revenue" },
    cm3: !gated
      ? { value: null, reason: revenueMyr <= 0 ? "no_revenue" : "coverage_below_90" }
      : !spend
        ? { value: null, reason: "no_spend_data" }
        : { value: cm3, reason: null },
  };

  return {
    period_start: p.period_start,
    raw: p,
    revenueMyr,
    mixedCurrency,
    coverage,
    cm2,
    cm3,
    cells,
    platformRoas: spend && Number(spend.gross) > 0 ? Number(spend.purchase_value) / Number(spend.gross) : null,
  };
}

/** Map of period_start → derived row, for joining onto the movement periods. */
export function deriveEconomics(e: CustomerBaseEconomics | null): Map<string, DerivedPeriod> {
  const m = new Map<string, DerivedPeriod>();
  for (const p of e?.periods ?? []) m.set(p.period_start, derivePeriod(p));
  return m;
}

export function isRatioMetric(m: EconMetric): boolean {
  return m === "roas";
}

/** Compact MYR label for axes and cards, e.g. RM 1.2M / RM 84.3k / RM 215. */
export function rmCompact(v: number): string {
  const abs = Math.abs(v);
  const s = abs >= 1_000_000 ? `${(abs / 1_000_000).toFixed(1)}M` : abs >= 10_000 ? `${(abs / 1000).toFixed(1)}k` : abs >= 1000 ? `${(abs / 1000).toFixed(2)}k` : abs.toFixed(0);
  return `${v < 0 ? "−" : ""}RM ${s}`;
}

/** Full MYR with thousands separators for tooltips and tables. */
export function rmFull(v: number, digits = 0): string {
  return `${v < 0 ? "−" : ""}RM ${Math.abs(v).toLocaleString("en-MY", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function formatMetric(m: EconMetric, v: number | null, compact = false): string {
  if (v === null) return "—";
  if (isRatioMetric(m)) return `${v.toFixed(2)}×`;
  if (m === "ncac") return compact ? rmCompact(v) : rmFull(v, 2);
  return compact ? rmCompact(v) : rmFull(v);
}
