import type { LucideIcon } from "lucide-react";
import { Crown, MapPinned, TriangleAlert } from "lucide-react";
import type { SegmentCondition } from "@/lib/supabase/live";
import type { LifecyclePolicy } from "@/lib/domain/lifecycle";

/**
 * Cohort workspaces — the three customer populations that get a page of
 * their own (program plan Phase 3). Membership rules live in the database
 * (`live_customer_segment_summary` states the rule and its version); the
 * browser only carries the list conditions that reproduce the same set.
 */
export const COHORT_KEYS = ["vip", "at_risk", "shared_address"] as const;
export type CohortKey = (typeof COHORT_KEYS)[number];

export interface CohortDef {
  key: CohortKey;
  label: string;
  path: string;
  icon: LucideIcon;
  /** Same condition language the list uses; must match the server rule. */
  conditions: SegmentCondition[];
  /** Starter-segment key on All customers that shows the same population. */
  starter: string;
  blurb: string;
  /** What a reviewer is expected to do with a member of this cohort. */
  intent: string;
  /** Static fallback for the rule while the summary loads or is unavailable. */
  rule: string;
}

export const COHORTS: Record<CohortKey, CohortDef> = {
  vip: {
    key: "vip",
    label: "VIP",
    path: "/customers/vip",
    icon: Crown,
    conditions: [{ field: "tier", op: "eq", value: "vip" }],
    starter: "vip",
    blurb: "Highest-value customers",
    intent: "Protect the relationship: spot at-risk VIPs early, review resellers hiding in the tier, and log a follow-up before value walks.",
    rule: "Lifetime recognized revenue ≥ 900 (value-tier rule v0, unversioned)",
  },
  at_risk: {
    key: "at_risk",
    label: "At risk",
    path: "/customers/at-risk",
    icon: TriangleAlert,
    conditions: [{ field: "activity", op: "eq", value: "at_risk" }],
    starter: "at_risk",
    blurb: "Governed lifecycle state: about to lapse",
    intent: "Win-back window: the last qualifying purchase is between the at-risk and lapse thresholds. Log a call or manual WhatsApp follow-up; nothing is sent automatically.",
    rule: "Lifecycle state at_risk under the current policy",
  },
  shared_address: {
    key: "shared_address",
    label: "Shared address",
    path: "/customers/shared-address",
    icon: MapPinned,
    conditions: [{ field: "shared_address_count", op: "gte", value: 2 }],
    starter: "shared_address",
    blurb: "Identities converging on one delivery address",
    intent: "Review signal only: resellers, drop points or family clusters. Never auto-merge and never target a campaign at the cluster; log an address review instead.",
    rule: "Two or more resolved identities share one normalized delivery address",
  },
};

export function cohortForPath(pathname: string): CohortDef | null {
  return Object.values(COHORTS).find((c) => c.path === pathname) ?? null;
}

/* ---------- served summary ---------- */

export interface CohortDefinition {
  key: CohortKey;
  label: string;
  rule: string;
  rule_version: string;
  governed: boolean;
}

export interface CohortStats {
  members: number;
  lifecycle: { new: number; active: number; at_risk: number; lapsed: number; provisional: number };
  orders: number;
  /** Null when the cohort has no orders. */
  cod_share: number | null;
  revenue_total: number;
  revenue_by_currency: Record<string, number>;
  ordered_30d: number;
  resellers: number;
  /** Only for shared_address. */
  address_clusters: number | null;
  open_work_items: number;
}

export type CohortSummary =
  | {
      status: "ok";
      cohort: CohortKey;
      definition: CohortDefinition;
      scope: { brand_id: number | null; countries: string[] | null };
      policy: Pick<LifecyclePolicy, "version" | "status" | "threshold_days" | "at_risk_days">;
      computed_at: string;
      stats: CohortStats;
      consent: { status: "unavailable"; reason: "no_consent_source" };
      outbound: { enabled: false; reason: string };
    }
  | { status: "unavailable"; reason: "no_policy" | "not_computed"; definition: CohortDefinition };

/* ---------- follow-ups (work items) ---------- */

export const WORK_ITEM_ACTIONS = [
  { value: "call", label: "Call", hint: "Phone the customer" },
  { value: "whatsapp_manual", label: "WhatsApp (manual)", hint: "Message by hand from the business number; nothing is sent by Fullkit" },
  { value: "review", label: "Review account", hint: "Look before acting: orders, returns, classification" },
  { value: "address_review", label: "Address review", hint: "Check the shared-address cluster; never auto-merge" },
] as const;
export type WorkItemAction = (typeof WORK_ITEM_ACTIONS)[number]["value"];

export const WORK_ITEM_SEVERITIES = ["low", "medium", "high"] as const;
export type WorkItemSeverity = (typeof WORK_ITEM_SEVERITIES)[number];

export type WorkItemSource = CohortKey | "customer_360" | "customers";

export interface WorkItem {
  id: number;
  workspace_id: number;
  title: string;
  entity_ref: string;
  owner_membership_id: number | null;
  severity: WorkItemSeverity;
  next_action: WorkItemAction;
  due_at: string | null;
  status: "open" | "done" | "dropped";
  created_at: string;
}

export function workItemActionLabel(a: string): string {
  return WORK_ITEM_ACTIONS.find((x) => x.value === a)?.label ?? a;
}

export function entityRefForCustomer(identityKey: string): string {
  return `customer:${identityKey}`;
}
