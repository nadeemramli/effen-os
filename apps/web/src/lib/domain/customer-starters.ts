import type { SegmentCondition } from "@/lib/supabase/live";

/**
 * Starter segments for the Customers list pill row. VIP, At risk and Shared
 * address also have cohort workspaces (`lib/domain/cohorts.ts`) whose
 * conditions must stay identical to the entries here.
 */
export interface CustomerStarter {
  key: string;
  name: string;
  conditions: SegmentCondition[];
}

export const CUSTOMER_STARTERS: CustomerStarter[] = [
  { key: "vip", name: "VIP", conditions: [{ field: "tier", op: "eq", value: "vip" }] },
  { key: "loyal", name: "Loyal", conditions: [{ field: "repeat", op: "eq", value: "loyal" }] },
  // Governed lifecycle state (policy-versioned), not a days-since-order rule.
  { key: "at_risk", name: "At risk", conditions: [{ field: "activity", op: "eq", value: "at_risk" }] },
  { key: "resellers", name: "Resellers", conditions: [{ field: "classification", op: "eq", value: "reseller" }] },
  // Multiple identities converging on one normalized delivery address —
  // reseller / drop-point candidates that phone-first identity can't merge.
  { key: "shared_address", name: "Shared address", conditions: [{ field: "shared_address_count", op: "gte", value: 2 }] },
  { key: "joy_buyers", name: "Joy buyers", conditions: [{ field: "classification", op: "eq", value: "joy_buyer" }] },
  { key: "cod_heavy", name: "COD-heavy", conditions: [
    { field: "cod_share", op: "gte", value: 80 }, { field: "total_orders", op: "gte", value: 2 },
  ] },
  // The remarketing cut: frequent buyers whose last order is recent enough
  // to still be reachable (4+ orders, active within 6 months).
  { key: "repeat_6mo", name: "Repeat 4+ · 6 mo", conditions: [
    { field: "total_orders", op: "gte", value: 4 }, { field: "last_order_days", op: "lte", value: 180 },
  ] },
];
