/**
 * Customer lifecycle vocabulary — the governed contract behind Customer Base
 * (program plan Phase 1). Every value here mirrors what the database
 * computes; the browser never derives lifecycle state from dates itself.
 */

/** Point-in-time lifecycle state under one policy version. */
export const LIFECYCLE_STATES = ["active", "at_risk", "lapsed", "provisional"] as const;
export type LifecycleState = (typeof LIFECYCLE_STATES)[number];

/** Period movements — transitions, never standing tags. */
export const LIFECYCLE_TRANSITIONS = ["new", "reactivated", "at_risk", "lapsed"] as const;
export type LifecycleTransition = (typeof LIFECYCLE_TRANSITIONS)[number];

/** Measures a Customer Base card or chart segment can drill into. */
export const MOVEMENT_MEASURES = ["opening", "new", "reactivated", "lapsed", "retained", "closing"] as const;
export type MovementMeasure = (typeof MOVEMENT_MEASURES)[number];

export type MovementGrain = "week" | "month";

export const LIFECYCLE_STATE_LABELS: Record<LifecycleState, string> = {
  active: "Active",
  at_risk: "At risk",
  lapsed: "Lapsed",
  provisional: "Provisional",
};

export const MOVEMENT_MEASURE_LABELS: Record<MovementMeasure, string> = {
  opening: "Opening active base",
  new: "New customers",
  reactivated: "Reactivated",
  lapsed: "Lapsed",
  retained: "Retained active",
  closing: "Closing active base",
};

export interface LifecyclePolicy {
  version: number;
  status: "provisional" | "approved" | "superseded";
  qualifying_event: string;
  lapse_method: "fallback" | "percentile";
  threshold_days: number;
  at_risk_days: number;
  valid_from: string;
  note: string | null;
}

export interface MovementPeriod {
  period_start: string;
  period_end: string;
  is_complete: boolean;
  opening_active: number;
  new_customers: number;
  reactivated: number;
  lapsed: number;
  retained: number;
  closing_active: number;
  corrections: number;
  net_active_change: number;
  /** Null when the opening base is zero — render "not applicable", never 0 %. */
  net_active_rate: number | null;
  rate_applicable: boolean;
  at_risk_closing: number;
  /** Customers whose first accepted order fell in the period (acquisition lens). */
  new_accepted: number;
}

export interface MovementCoverage {
  orders_total: number;
  orders_with_identity: number;
  orders_qualifying_acceptance: number;
  orders_qualifying_lifecycle: number;
  orders_excluded_by_reason: Record<string, number>;
  delivered_evidence: Record<string, number>;
  customers_total: number;
  customers_with_lifecycle_purchase: number;
  identity_corrections_tracked: boolean;
  note: string;
}

export type CustomerBaseMovement =
  | {
      status: "ok";
      scope: { type: "workspace" | "brand" | "integration" | "brand_integration"; brand_id: number | null; integration_ids: number[] | null; lens: "acquisition" };
      grain: MovementGrain;
      from: string;
      to: string;
      policy: LifecyclePolicy;
      periods: MovementPeriod[];
      coverage: MovementCoverage;
      computed_at: string;
      timezone: "Asia/Kuala_Lumpur";
    }
  | { status: "unavailable"; reason: "no_policy" | "not_computed"; policy?: Pick<LifecyclePolicy, "version" | "status"> };

export interface TransitionPopulationRow {
  identity_key: string;
  display_name: string | null;
  phone_masked: string | null;
  occurred_at: string;
  entry_kind: "new" | "reactivated";
  exited_at: string | null;
  acquisition_brand_id: number | null;
  acquisition_integration_id: number | null;
  first_accepted_at: string | null;
  first_delivered_at: string | null;
  lifecycle_orders: number;
  last_qualifying_at: string | null;
  total_orders: number | null;
  classification: string | null;
}

export interface TransitionPopulation {
  status: "ok";
  measure: MovementMeasure;
  grain: MovementGrain;
  period_start: string;
  policy_version: number;
  total_count: number;
  rows: TransitionPopulationRow[];
  next_cursor: string | null;
  masked: true;
}

/** The reconciliation identity every period must satisfy; used by the page's self-check. */
export function movementReconciles(p: MovementPeriod): boolean {
  return p.closing_active === p.opening_active + p.new_customers + p.reactivated - p.lapsed + p.corrections;
}
