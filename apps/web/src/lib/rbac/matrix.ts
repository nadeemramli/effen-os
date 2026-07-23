import type { RoleKey } from "@/lib/domain/enums";

/**
 * Least-privilege demo matrix. The role switcher is a prototype device —
 * production authorization combines role × workspace × brand × action ×
 * environment behind RLS, per the Technical Architecture doc.
 */

export type PermissionKey =
  | "orders.view"
  | "orders.create"
  | "orders.assign"
  | "orders.approve"
  | "orders.cancel"
  | "orders.notify"
  | "customers.view"
  | "customers.pii.view"
  | "marketing.view"
  | "recommendations.view"
  | "recommendations.decide"
  | "recommendations.assign"
  | "catalog.view"
  | "reports.view"
  | "reports.export"
  | "finance.fees.view"
  | "integrations.view"
  | "integrations.connect"
  | "integrations.retry"
  | "dq.view"
  | "dq.acknowledge"
  | "audit.view"
  | "settings.manage";

const ALL: PermissionKey[] = [
  "orders.view", "orders.create", "orders.assign", "orders.approve", "orders.cancel", "orders.notify",
  "customers.view", "customers.pii.view",
  "marketing.view",
  "recommendations.view", "recommendations.decide", "recommendations.assign",
  "catalog.view",
  "reports.view", "reports.export",
  "finance.fees.view",
  "integrations.view", "integrations.connect", "integrations.retry",
  "dq.view", "dq.acknowledge",
  "audit.view", "settings.manage",
];

export const ROLE_PERMISSIONS: Record<RoleKey, PermissionKey[]> = {
  hq_admin: ALL,
  sales_cs: [
    "orders.view", "orders.create", "orders.assign", "orders.notify",
    "customers.view", "customers.pii.view",
    "recommendations.view",
  ],
  marketing_growth: [
    "marketing.view",
    "recommendations.view", "recommendations.decide", "recommendations.assign",
    "customers.view",
    "catalog.view",
    "reports.view", "reports.export",
    "integrations.view", "integrations.connect",
    "dq.view",
  ],
  operations: [
    "orders.view", "orders.assign", "orders.approve", "orders.cancel", "orders.notify",
    "customers.view",
    "recommendations.view", "recommendations.decide",
    "catalog.view",
    "reports.view",
    "integrations.view", "integrations.retry",
    "dq.view", "dq.acknowledge",
  ],
  finance: [
    "orders.view",
    "finance.fees.view",
    "reports.view", "reports.export",
    "integrations.view",
    "dq.view", "dq.acknowledge",
    "audit.view",
    "recommendations.view",
  ],
  analyst: [
    "marketing.view",
    "customers.view",
    "recommendations.view",
    "catalog.view",
    "reports.view", "reports.export",
    "dq.view",
  ],
};

export function can(role: RoleKey, permission: PermissionKey): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export const ROLE_LABELS: Record<RoleKey, string> = {
  hq_admin: "HQ Admin",
  sales_cs: "Sales / CS",
  marketing_growth: "Marketing / Growth",
  operations: "Operations",
  finance: "Finance",
  analyst: "Analyst",
};

/** Why a role lacks access — shown on PermissionDenied states. */
export const PERMISSION_EXPLAINERS: Partial<Record<PermissionKey, string>> = {
  "orders.view": "Order operations are limited to HQ, Sales/CS, Operations, and Finance.",
  "marketing.view": "Ad platform data is limited to HQ, Marketing/Growth, and Analyst roles.",
  "recommendations.decide": "Only recommendation owners and HQ can approve or reject decisions.",
  "finance.fees.view": "Gateway fees and settlement detail are limited to Finance and HQ.",
  "integrations.view": "Integration credentials and health are limited to owning roles.",
  "customers.pii.view": "Unmasked contact details are limited to HQ and Sales/CS.",
  "audit.view": "The audit trail is limited to HQ and Finance.",
  "settings.manage": "Workspace settings are limited to HQ admins.",
};
