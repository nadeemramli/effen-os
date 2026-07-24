import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AudioWaveform,
  BadgeDollarSign,
  Boxes,
  Cable,
  ClipboardList,
  Factory,
  Gauge,
  Megaphone,
  Package,
  Palette,
  PlugZap,
  Settings,
  ShieldCheck,
  Sparkles,
  Tags,
  Truck,
  Users,
  Zap,
} from "lucide-react";
import type { RoleKey } from "@/lib/domain/enums";
import type { PermissionKey } from "@/lib/rbac/matrix";
import { ROLE_PERMISSIONS } from "@/lib/rbac/matrix";

/**
 * Single route registry — sidebar, breadcrumbs, global search targets,
 * RBAC nav filtering, and next-module pages all derive from this.
 */

export interface RouteDef {
  key: string;
  label: string;
  path: string;
  icon: LucideIcon;
  group: "Command Centre" | "Commerce" | "Growth" | "Merchandise" | "Control" | "Platform";
  status: "live" | "next-module";
  /** Permission that gates seeing this item; undefined = everyone. */
  permission?: PermissionKey;
  nextModule?: {
    summary: string;
    workflow: string[];
    unlocks: string[];
  };
}

export const ROUTES: RouteDef[] = [
  {
    key: "command-center",
    label: "Command Centre",
    path: "/command-center",
    icon: Gauge,
    group: "Command Centre",
    status: "live",
  },
  {
    key: "orders",
    label: "Orders",
    path: "/orders",
    icon: ClipboardList,
    group: "Commerce",
    status: "live",
    permission: "orders.view",
  },
  {
    key: "customers",
    label: "Customers",
    path: "/customers",
    icon: Users,
    group: "Commerce",
    status: "live",
    permission: "customers.view",
  },
  {
    key: "fulfilment",
    label: "Fulfilment",
    path: "/fulfilment",
    icon: Truck,
    group: "Commerce",
    status: "live",
    permission: "orders.view",
  },
  {
    key: "automations",
    label: "Automations",
    path: "/automations",
    icon: Zap,
    group: "Commerce",
    status: "live",
    permission: "orders.view",
  },
  {
    key: "marketing",
    label: "Marketing",
    path: "/marketing",
    icon: Megaphone,
    group: "Growth",
    status: "live",
    permission: "marketing.view",
  },
  {
    key: "prophit",
    label: "Prophit",
    path: "/prophit",
    icon: Sparkles,
    group: "Growth",
    status: "live",
    permission: "recommendations.view",
  },
  {
    key: "creative",
    label: "Creative",
    path: "/creative",
    icon: Palette,
    group: "Growth",
    status: "next-module",
    permission: "marketing.view",
    nextModule: {
      summary:
        "The Creative Loop (S2): a creative calendar and supply pipeline that connects demand planning to production capacity, asset lineage, and per-creative performance.",
      workflow: [
        "Creative demand plan derives required asset volume from the media plan",
        "Briefs move through production stages with owner and due date",
        "Launched assets bind to campaigns/ads for lineage",
        "Performance loops back: fatigue flags and winning-angle synthesis feed the next brief",
      ],
      unlocks: [
        "Meta / TikTok creative-level insights (already read-connected)",
        "Asset storage (GCS) and review flow",
        "Iteratus idea radar import",
      ],
    },
  },
  {
    key: "catalog",
    label: "Brands & Catalog",
    path: "/catalog/brands",
    icon: Tags,
    group: "Merchandise",
    status: "live",
    permission: "catalog.view",
  },
  {
    key: "inventory",
    label: "Inventory",
    path: "/inventory",
    icon: Boxes,
    group: "Merchandise",
    status: "live",
    permission: "catalog.view",
  },
  {
    key: "production",
    label: "Production",
    path: "/production",
    icon: Factory,
    group: "Merchandise",
    status: "next-module",
    permission: "catalog.view",
    nextModule: {
      summary:
        "Demand-to-production planning (P5/MRP): BOMs, raw-material balance, work orders, batches, and yield — for brands that manufacture rather than trade.",
      workflow: [
        "Demand forecast converts to a master production schedule",
        "MRP explodes BOMs into raw-material requirements vs on-hand",
        "Work orders track batches, yield, and QC holds",
        "Finished goods receipt lands stock into sellable inventory",
      ],
      unlocks: [
        "BOM and inventory_items schema (raw material / packaging / WIP / finished good)",
        "Supplier lead-time records",
        "Batch/lot control with shelf life",
      ],
    },
  },
  {
    key: "finance",
    label: "Finance",
    path: "/finance",
    icon: BadgeDollarSign,
    group: "Control",
    status: "next-module",
    permission: "finance.fees.view",
    nextModule: {
      summary:
        "Commerce reconciliation and contribution control (P6): settlements vs orders, gateway fee audit, commission runs, and the SQL Accounting export bridge. Not a ledger — SQL Accounting stays authoritative.",
      workflow: [
        "Daily: settlement files match against payment records; exceptions queue to Finance",
        "Weekly: commission runs prepared, approved, exported",
        "Monthly: cost versions update COGS; contribution restates with an audit trail",
        "Every export to SQL Accounting is batch-controlled and reversible",
      ],
      unlocks: [
        "Chip / Stripe settlement file ingestion (partially connected)",
        "HitPay + Billplz connections",
        "SQL Accounting journal export mapping",
      ],
    },
  },
  {
    key: "reports",
    label: "Reports",
    path: "/reports",
    icon: Activity,
    group: "Control",
    status: "live",
    permission: "reports.view",
  },
  {
    key: "integrations",
    label: "Integrations",
    path: "/integrations",
    icon: Cable,
    group: "Platform",
    status: "live",
    permission: "integrations.view",
  },
  {
    key: "data-health",
    label: "Data Health",
    path: "/data-health",
    icon: AudioWaveform,
    group: "Platform",
    status: "live",
    permission: "dq.view",
  },
  {
    key: "setup",
    label: "Setup (Live)",
    path: "/setup/connections",
    icon: PlugZap,
    group: "Platform",
    status: "live",
    permission: "settings.manage",
  },
  {
    key: "audit",
    label: "Audit",
    path: "/audit",
    icon: ShieldCheck,
    group: "Platform",
    status: "next-module",
    permission: "audit.view",
    nextModule: {
      summary:
        "The full audit trail: who did what, when, from where — across user actions, rule executions, connector writes, and exports. Read-only and immutable.",
      workflow: [
        "Every material action already lands an audit event (see actions in this demo)",
        "Filter by actor, entity, action type, and time",
        "Export evidence packs for finance or compliance review",
      ],
      unlocks: ["Long-term audit storage & retention policy", "SIEM forwarding (optional)"],
    },
  },
  {
    key: "settings",
    label: "Settings",
    path: "/settings",
    icon: Settings,
    group: "Platform",
    status: "next-module",
    permission: "settings.manage",
    nextModule: {
      summary:
        "Workspace administration: members and roles, brand scopes, saved-view defaults, notification templates, feature flags, and environment controls (Demo / Shadow / Live).",
      workflow: [
        "Invite-only membership with role + brand scoping",
        "Template and sender-profile management per brand",
        "Feature flags gate rollout of write actions per brand",
        "Mode promotion (Demo → Shadow → Live) requires HQ approval and is audited",
      ],
      unlocks: ["Supabase auth (invite-only)", "Memberships + RLS policies", "Feature-flag service"],
    },
  },
];

export const ROUTE_GROUPS = [
  "Command Centre",
  "Commerce",
  "Growth",
  "Merchandise",
  "Control",
  "Platform",
] as const;

export function visibleRoutes(role: RoleKey): RouteDef[] {
  const perms = ROLE_PERMISSIONS[role];
  return ROUTES.filter((r) => !r.permission || perms.includes(r.permission));
}

export function routeForPath(pathname: string): RouteDef | undefined {
  return ROUTES.find(
    (r) => pathname === r.path || (r.key === "catalog" && pathname.startsWith("/catalog")),
  ) ?? ROUTES.find((r) => pathname.startsWith(r.path) && r.path !== "/");
}

export { Package as FallbackIcon };
