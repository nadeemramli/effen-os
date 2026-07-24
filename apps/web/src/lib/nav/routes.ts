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
    status: "live",
    permission: "marketing.view",
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
    status: "live",
    permission: "catalog.view",
  },
  {
    key: "finance",
    label: "Finance",
    path: "/finance",
    icon: BadgeDollarSign,
    group: "Control",
    status: "live",
    permission: "finance.fees.view",
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
