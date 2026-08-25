/**
 * Customer economics vocabulary — mirrors public.live_brand_customer_economics
 * (program plan Phase 5, R10 / R20–R22). Metric version econ-v1, provisional
 * under owner decisions D3–D7. The browser never recomputes a metric: it
 * renders what the server publishes, including nulls and suppression reasons.
 */

export const ECON_HORIZONS = [0, 30, 60, 90, 180, 365] as const;
export type Horizon = (typeof ECON_HORIZONS)[number];

export type SuppressionReason =
  | "no_spend_data"
  | "currency_mixed"
  | "cost_coverage_below_90"
  | "identity_coverage_below_95"
  | "no_return_evidence";

export const SUPPRESSION_LABELS: Record<SuppressionReason, string> = {
  no_spend_data: "No Meta spend rows for this month and scope",
  currency_mixed: "Scope mixes currencies (SG revenue is SGD, cost rules are MYR) — no FX in v1",
  cost_coverage_below_90: "SKU cost coverage below 90 %",
  identity_coverage_below_95: "Identity coverage below 95 %",
  no_return_evidence: "No carrier return evidence for this month — expected return cost not applied",
};

export interface EconHorizon {
  days: Horizon;
  matured: boolean;
  orders: number;
  revenue: number;
  /** MYR; null when immature or currency-mixed. */
  contribution: number | null;
  ltv_per_customer: number | null;
  /** Ratio; null when nCAC or LTV is unavailable. */
  ltv_ncac: number | null;
  repeat_rate: number | null;
  returns_evidence: boolean;
}

export interface EconCohort {
  cohort_month: string;
  customers_accepted: number;
  customers_delivered: number;
  month_orders: number | null;
  spend: { gross: number; wht: number; net: number; banned: number; purchases: number; fact_rows: number } | null;
  paid_share: number | null;
  ncac: { accepted: number | null; delivered: number | null; paid: number | null; cpa_platform: number | null };
  first_order: {
    revenue: number;
    cogs: number;
    delivery: number;
    cod: number;
    returns_expected: number | null;
    contribution: number | null;
    contribution_per_customer: number | null;
    fop: number | null;
  };
  horizons: EconHorizon[];
  payback:
    | { status: "reached"; horizon_days: Horizon }
    | { status: "immature"; matured_through_days: number }
    | { status: "not_reached" }
    | { status: "unavailable" };
  coverage: {
    identity: number | null;
    cost: number | null;
    spend: boolean;
    currency_mixed: boolean;
    currencies: number;
    returns_evidence: boolean;
  };
  suppressed: SuppressionReason[];
}

export type CustomerEconomics =
  | {
      status: "ok";
      metric_version: "econ-v1";
      scope: { brand_id: number | null; countries: string[] | null; months: number; from_month: string };
      computed_at: string;
      horizons: Horizon[];
      rules: {
        effective_from: string;
        unit_cost_myr: number;
        delivery_my_west: number;
        delivery_my_east: number;
        delivery_sg_myr: number;
        cod_fee: number;
        wht_rate: number;
      };
      definitions: Record<string, string>;
      decisions: string[];
      cohorts: EconCohort[];
    }
  | { status: "unavailable"; reason: "not_computed"; metric_version: "econ-v1" };

/** Contribution-based cells are suppressed by these reasons; nCAC cells only by spend. */
export const CONTRIBUTION_BLOCKERS: SuppressionReason[] = ["currency_mixed", "cost_coverage_below_90", "identity_coverage_below_95"];

export function contributionBlocked(c: EconCohort): SuppressionReason | null {
  return c.suppressed.find((s) => CONTRIBUTION_BLOCKERS.includes(s)) ?? null;
}

export function ncacBlocked(c: EconCohort): SuppressionReason | null {
  return c.suppressed.includes("no_spend_data") ? "no_spend_data" : null;
}

export function monthLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-MY", { month: "short", year: "2-digit", timeZone: "UTC" });
}

export function rm(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined) return "—";
  const abs = Math.abs(v);
  const s = abs >= 10_000 ? `${(abs / 1000).toFixed(1)}k` : abs.toFixed(digits);
  return `${v < 0 ? "−" : ""}RM ${s}`;
}

export function pct(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined ? "—" : `${(v * 100).toFixed(digits)}%`;
}

export function ratio(v: number | null | undefined): string {
  return v === null || v === undefined ? "—" : `${v.toFixed(2)}×`;
}
