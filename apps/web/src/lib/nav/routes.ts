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
  ShieldCheck,
  SlidersHorizontal,
  Tags,
  TrendingUp,
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
 *
 * Two registries, deliberately separate. ROUTES is the daily work: the
 * sidebar shows it, and every entry answers "what needs attention now".
 * SETTINGS_ROUTES is configuration and evidence — reached through the
 * profile menu, not the sidebar, because you go there when something needs
 * changing rather than as part of the day.
 */

export interface RouteDef {
  key: string;
  label: string;
  path: string;
  icon: LucideIcon;
  group: "Command Centre" | "Commerce" | "Growth" | "Merchandise" | "Control";
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
    key: "marketing",
    label: "Marketing",
    path: "/marketing",
    icon: Megaphone,
    group: "Growth",
    status: "live",
    permission: "marketing.view",
  },
  {
    key: "profit",
    label: "Profit",
    path: "/profit",
    icon: TrendingUp,
    group: "Growth",
    status: "live",
    permission: "reports.view",
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
    label: "Catalog",
    path: "/catalog",
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
];

export const ROUTE_GROUPS = [
  "Command Centre",
  "Commerce",
  "Growth",
  "Merchandise",
  "Control",
] as const;

/* ---------------------------------------------------------------- settings */

export interface SettingsRouteDef extends Omit<RouteDef, "group"> {
  group: "Workspace" | "Platform";
  /** One line under the label in the settings nav. */
  blurb: string;
}

export const SETTINGS_ROUTES: SettingsRouteDef[] = [
  {
    key: "settings-general",
    label: "General",
    path: "/settings/general",
    icon: SlidersHorizontal,
    group: "Workspace",
    status: "next-module",
    permission: "settings.manage",
    blurb: "Members, roles, brand scopes, and environment controls",
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
  {
    key: "integrations",
    label: "Integrations",
    path: "/settings/integrations",
    icon: Cable,
    group: "Platform",
    status: "live",
    permission: "integrations.view",
    blurb: "Connected sources, scopes, and sync health",
  },
  {
    key: "automations",
    label: "Automations",
    path: "/settings/automations",
    icon: Zap,
    group: "Platform",
    status: "live",
    permission: "orders.view",
    blurb: "Every rule that runs without a human",
  },
  {
    key: "data-health",
    label: "Data Health",
    path: "/settings/data-health",
    icon: AudioWaveform,
    group: "Platform",
    status: "live",
    permission: "dq.view",
    blurb: "Freshness SLAs and the owned issue queue",
  },
  {
    key: "setup",
    label: "Setup (Live)",
    path: "/settings/setup/connections",
    icon: PlugZap,
    group: "Platform",
    status: "live",
    permission: "settings.manage",
    blurb: "Real store credentials and the live catalog",
  },
  {
    key: "audit",
    label: "Audit",
    path: "/settings/audit",
    icon: ShieldCheck,
    group: "Platform",
    status: "next-module",
    permission: "audit.view",
    blurb: "Who did what, when, from where",
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
];

export const SETTINGS_GROUPS = ["Workspace", "Platform"] as const;

export function visibleRoutes(role: RoleKey): RouteDef[] {
  const perms = ROLE_PERMISSIONS[role];
  return ROUTES.filter((r) => !r.permission || perms.includes(r.permission));
}

export function visibleSettingsRoutes(role: RoleKey): SettingsRouteDef[] {
  const perms = ROLE_PERMISSIONS[role];
  return SETTINGS_ROUTES.filter((r) => !r.permission || perms.includes(r.permission));
}

/**
 * True when the role can reach any settings surface at all. Roles with no
 * settings permissions should not see the menu entry — an entry that leads
 * only to a permission-denied page is worse than no entry.
 */
export function canSeeSettings(role: RoleKey): boolean {
  return visibleSettingsRoutes(role).length > 0;
}

export function routeForPath(pathname: string): RouteDef | SettingsRouteDef | undefined {
  const all: Array<RouteDef | SettingsRouteDef> = [...ROUTES, ...SETTINGS_ROUTES];
  return (
    all.find(
      (r) => pathname === r.path || (r.key === "catalog" && pathname.startsWith("/catalog")),
    ) ??
    // Longest path first so /settings/integrations wins over a shorter prefix.
    [...all]
      .sort((a, b) => b.path.length - a.path.length)
      .find((r) => pathname.startsWith(`${r.path}/`))
  );
}

export { Package as FallbackIcon };
