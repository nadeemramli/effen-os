import type { DailyPlanPoint } from "@/lib/domain/types";
import { dailyCommercial, type DailyCommercialRow } from "@/lib/domain/metrics";
import { dateKey } from "./clock";
import { BRANDS, LEGAL_ENTITIES, PERSONAS, STORES, WORKSPACE } from "./data/org";
import { PRODUCTS } from "./data/catalog";
import { CUSTOMERS } from "./data/customers";
import { ORDERS, ORDER_EVENTS } from "./data/orders";
import { AD_ACCOUNTS, CAMPAIGNS } from "./data/campaigns";
import { INTEGRATIONS, SYNC_RUNS } from "./data/integrations";
import { BUSINESS_TARGETS, DECISIONS, DIAGNOSES, RECOMMENDATIONS } from "./data/prophit";
import {
  AUDIT_EVENTS,
  DQ_ISSUES,
  METRIC_DEFINITIONS,
  NOTIFICATIONS,
  REPORTS,
  WORK_ITEMS,
} from "./data/governance";
import { AUTOMATION_RULES, NOTIFICATION_TEMPLATES } from "./data/automation";

export const COGS_BY_VARIANT: Record<string, number> = Object.fromEntries(
  PRODUCTS.flatMap((p) => p.variants.map((v) => [v.id, v.cogs])),
);

/* ---------- derived daily commercial grid + plan ---------- */

const DAILY_ROWS: DailyCommercialRow[] = dailyCommercial(ORDERS, CAMPAIGNS, COGS_BY_VARIANT);

function buildPlan(): DailyPlanPoint[] {
  // Plan = trailing average over the "normal" window (days 13..34 back —
  // before the toner stockout and Meta CPM spike), nudged up 6%. Computed
  // from the same orders the rest of the app shows.
  const points: DailyPlanPoint[] = [];
  for (const brand of BRANDS) {
    const rows = DAILY_ROWS.filter((r) => r.brandId === brand.id);
    const baseline = rows.filter((r) => r.date >= dateKey(34) && r.date <= dateKey(13));
    const avg = (f: (r: DailyCommercialRow) => number) =>
      baseline.length ? baseline.reduce((s, r) => s + f(r), 0) / baseline.length : 0;
    const expContribution = Math.round(avg((r) => r.contribution) * 1.06);
    const expRevenue = Math.round(avg((r) => r.netRevenue) * 1.06);
    for (let d = 30; d >= 0; d--) {
      const date = dateKey(d);
      const actual = rows.find((r) => r.date === date);
      points.push({
        date,
        brandId: brand.id,
        expectedContribution: expContribution,
        actualContribution: actual?.contribution ?? 0,
        expectedRevenue: expRevenue,
        actualRevenue: actual?.netRevenue ?? 0,
        adSpend: actual?.adSpend ?? 0,
      });
    }
  }
  return points;
}

const DAILY_PLAN = buildPlan();

/* ---------- snapshot ---------- */

export interface SeedSnapshot {
  workspace: typeof WORKSPACE;
  legalEntities: typeof LEGAL_ENTITIES;
  brands: typeof BRANDS;
  stores: typeof STORES;
  personas: typeof PERSONAS;
  products: typeof PRODUCTS;
  customers: typeof CUSTOMERS;
  orders: typeof ORDERS;
  orderEvents: typeof ORDER_EVENTS;
  campaigns: typeof CAMPAIGNS;
  adAccounts: typeof AD_ACCOUNTS;
  integrations: typeof INTEGRATIONS;
  syncRuns: typeof SYNC_RUNS;
  targets: typeof BUSINESS_TARGETS;
  diagnoses: typeof DIAGNOSES;
  recommendations: typeof RECOMMENDATIONS;
  decisions: typeof DECISIONS;
  dailyRows: DailyCommercialRow[];
  dailyPlan: DailyPlanPoint[];
  automationRules: typeof AUTOMATION_RULES;
  notificationTemplates: typeof NOTIFICATION_TEMPLATES;
  metricDefinitions: typeof METRIC_DEFINITIONS;
  dqIssues: typeof DQ_ISSUES;
  workItems: typeof WORK_ITEMS;
  auditEvents: typeof AUDIT_EVENTS;
  notifications: typeof NOTIFICATIONS;
  reports: typeof REPORTS;
}

export function composeSeedSnapshot(): SeedSnapshot {
  return structuredClone({
    workspace: WORKSPACE,
    legalEntities: LEGAL_ENTITIES,
    brands: BRANDS,
    stores: STORES,
    personas: PERSONAS,
    products: PRODUCTS,
    customers: CUSTOMERS,
    orders: ORDERS,
    orderEvents: ORDER_EVENTS,
    campaigns: CAMPAIGNS,
    adAccounts: AD_ACCOUNTS,
    integrations: INTEGRATIONS,
    syncRuns: SYNC_RUNS,
    targets: BUSINESS_TARGETS,
    diagnoses: DIAGNOSES,
    recommendations: RECOMMENDATIONS,
    decisions: DECISIONS,
    dailyRows: DAILY_ROWS,
    dailyPlan: DAILY_PLAN,
    automationRules: AUTOMATION_RULES,
    notificationTemplates: NOTIFICATION_TEMPLATES,
    metricDefinitions: METRIC_DEFINITIONS,
    dqIssues: DQ_ISSUES,
    workItems: WORK_ITEMS,
    auditEvents: AUDIT_EVENTS,
    notifications: NOTIFICATIONS,
    reports: REPORTS,
  });
}

/* ---------- invariants behind the scripted opening line ---------- */

export function assertSeedInvariants(): void {
  const pending = RECOMMENDATIONS.filter((r) => r.status === "pending").length;
  if (pending !== 4) {
    throw new Error(`Seed invariant broken: expected 4 pending recommendations, got ${pending}`);
  }
  const stale = INTEGRATIONS.filter((i) => i.status === "stale").length;
  if (stale !== 2) {
    throw new Error(`Seed invariant broken: expected 2 stale integrations, got ${stale}`);
  }
  const yesterday = dateKey(1);
  const plan = DAILY_PLAN.filter((p) => p.date === yesterday);
  const actual = plan.reduce((s, p) => s + p.actualContribution, 0);
  const expected = plan.reduce((s, p) => s + p.expectedContribution, 0);
  if (!(actual < expected)) {
    throw new Error(
      `Seed invariant broken: yesterday's contribution (${actual}) should be below plan (${expected})`,
    );
  }
  const ids = new Set<string>();
  for (const o of ORDERS) {
    if (ids.has(o.id)) throw new Error(`Duplicate order id ${o.id}`);
    ids.add(o.id);
  }
}
