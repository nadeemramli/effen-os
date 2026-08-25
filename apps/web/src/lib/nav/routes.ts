import type { LucideIcon } from "lucide-react";
import {
  Activity,
  AudioWaveform,
  BadgeDollarSign,
  Ban,
  Boxes,
  Cable,
  ChartNoAxesCombined,
  CircleCheck,
  ClipboardCheck,
  ClipboardList,
  CopyX,
  CreditCard,
  Factory,
  FilePen,
  FileSpreadsheet,
  FileText,
  FileUp,
  Gauge,
  GitBranch,
  List,
  ListChecks,
  MapPin,
  Megaphone,
  MessageSquareText,
  Package,
  PackageCheck,
  PackagePlus,
  Palette,
  PlugZap,
  ScanSearch,
  SearchCheck,
  NotebookPen,
  Settings,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Tags,
  TrendingUp,
  Truck,
  Undo2,
  Users,
  Warehouse,
  Zap,
} from "lucide-react";
import type { RoleKey } from "@/lib/domain/enums";
import type { PermissionKey } from "@/lib/rbac/matrix";
import { ROLE_PERMISSIONS } from "@/lib/rbac/matrix";
import { ORDER_VIEWS, orderView } from "@/lib/domain/order-views";
import { COHORTS } from "@/lib/domain/cohorts";

/**
 * Single route registry — sidebar, breadcrumbs, global search targets,
 * RBAC nav filtering, and next-module pages all derive from this.
 *
 * Two registries, deliberately separate. ROUTES is the daily work: the
 * sidebar shows it, and every entry answers "what needs attention now".
 * SETTINGS_ROUTES is configuration and evidence — reached through the
 * profile menu, not the sidebar, because you go there when something needs
 * changing rather than as part of the day.
 *
 * A route may carry `children`. When the current URL belongs to such a
 * section, the primary sidebar collapses to an icon rail and a secondary
 * sidebar lists the children. Children are queues and work surfaces — never
 * configuration, which stays in SETTINGS_ROUTES.
 */

export type NextModuleCopy = {
  summary: string;
  workflow: string[];
  unlocks: string[];
};

export interface ChildRouteDef {
  /** Globally unique across parents, children and settings. */
  key: string;
  label: string;
  /** Pathname only — query/hash below. */
  path: string;
  /** Query-string views (`?view=`, `?segment=`) share the parent's pathname. */
  query?: Record<string, string>;
  /** Fragment on the target page (e.g. a card id). */
  hash?: string;
  /** Active when the URL carries no sibling's query keys. */
  isDefault?: boolean;
  icon?: LucideIcon;
  /** Caption in the secondary nav; ungrouped children render first. */
  group?: string;
  status: "live" | "next-module";
  /** ANDed with the parent's permission. */
  permission?: PermissionKey;
  /** Count from useQueueCounts(); renders a skeleton until known, never "0". */
  badge?: "queue-count";
  /** Target lives in another section — the nav marks it as a jump. */
  crossSection?: boolean;
  /** Second line under the label. */
  blurb?: string;
  nextModule?: NextModuleCopy;
}

export interface RouteDef {
  key: string;
  label: string;
  path: string;
  icon: LucideIcon;
  group: "Command Centre" | "Commerce" | "Growth" | "Merchandise" | "Control";
  status: "live" | "next-module";
  /** Permission that gates seeing this item; undefined = everyone. */
  permission?: PermissionKey;
  nextModule?: NextModuleCopy;
  children?: ChildRouteDef[];
  /** Ordered captions for `children[].group`. */
  childGroups?: readonly string[];
}

/* ------------------------------------------------------------ children */

const ORDER_QUEUE_ICONS: Record<string, LucideIcon> = {
  all: List,
  draft: FilePen,
  qc: SearchCheck,
  "needs-payment": CreditCard,
  "to-fulfil": PackageCheck,
  completed: CircleCheck,
  "cancelled-refunded": Ban,
};

function orderQueue(key: string): ChildRouteDef {
  const v = orderView(key);
  return {
    key: `orders-view-${v.key}`,
    label: v.label,
    path: "/orders",
    query: { view: v.key },
    isDefault: v.key === "all",
    icon: ORDER_QUEUE_ICONS[v.key],
    group: "Queues",
    status: "live",
    // Archive queues (completed / cancelled / all) have no count selector: a
    // full scan of the order mirror is too slow for a nav badge.
    badge: v.count ? "queue-count" : undefined,
  };
}

// Queue order follows the working day: what needs doing first, the archive last.
const ORDER_CHILDREN: ChildRouteDef[] = [
  {
    key: "orders-new",
    label: "Make order",
    path: "/orders/new",
    icon: PackagePlus,
    group: "Make order",
    status: "live",
    permission: "orders.create",
  },
  {
    key: "orders-import-new",
    label: "New batch",
    path: "/orders/import/new",
    icon: FileUp,
    group: "Bulk orders",
    status: "next-module",
    nextModule: {
      summary:
        "Upload a versioned order template; every row is validated, de-duplicated and dry-run before a single order is created.",
      workflow: [
        "Pick the template version; the importer validates each field against it",
        "Payment method, courier, brand and store are per row — not one choice for the whole batch",
        "Preview shows valid / duplicate / rejected rows; a dry run creates nothing",
        "Commit with an idempotency key so a retried upload never double-creates",
        "Rejected rows come back as a downloadable file with row and field reasons",
      ],
      unlocks: [
        "import_batches + import_rows tables and an upload bucket",
        "Woo order-create write path (gated by ADR-0006)",
      ],
    },
  },
  {
    key: "orders-import",
    label: "All batches",
    path: "/orders/import",
    icon: FileSpreadsheet,
    group: "Bulk orders",
    status: "next-module",
    nextModule: {
      summary:
        "Every import run: who uploaded what, how many rows became orders, and the rejection file for the rest.",
      workflow: [
        "One row per import run with received / valid / duplicate / rejected / created / later-cancelled counts",
        "Every created order keeps its source connector and import-run id",
        "Re-download the original file or the rejection file; retry only the failed rows",
      ],
      unlocks: ["import_batches + import_rows tables", "Storage retention policy for uploaded files"],
    },
  },
  {
    key: "orders-drafts",
    label: "Drafts",
    path: "/orders/drafts",
    icon: NotebookPen,
    group: "Make order",
    status: "live",
    badge: "queue-count",
    blurb: "Manual orders saved in Fullkit; confirm into QC",
  },
  orderQueue("draft"),
  orderQueue("qc"),
  orderQueue("needs-payment"),
  orderQueue("to-fulfil"),
  {
    key: "orders-view-in-transit",
    label: "In transit",
    path: "/fulfilment",
    hash: "in-transit",
    icon: Truck,
    group: "Queues",
    status: "live",
    badge: "queue-count",
    crossSection: true,
  },
  {
    key: "orders-view-returned",
    label: "Returned",
    path: "/fulfilment/returns",
    icon: Undo2,
    group: "Queues",
    status: "live",
    badge: "queue-count",
    crossSection: true,
  },
  orderQueue("completed"),
  orderQueue("cancelled-refunded"),
  orderQueue("all"),
];

// Keep the nav honest: every ORDER_VIEWS entry must have a nav slot.
for (const v of ORDER_VIEWS) {
  if (!ORDER_CHILDREN.some((c) => c.key === `orders-view-${v.key}`)) {
    throw new Error(`Order view "${v.key}" has no nav entry`);
  }
}


const CUSTOMER_CHILDREN: ChildRouteDef[] = [
  {
    key: "customers-all",
    label: "All customers",
    path: "/customers",
    isDefault: true,
    icon: Users,
    status: "live",
  },
  {
    key: "customers-base",
    label: "Customer base",
    path: "/customers/base",
    icon: ChartNoAxesCombined,
    status: "live",
    blurb: "Active base: new, reactivated, lapsed, net movement",
  },
  {
    key: "customers-dispatch",
    label: "Dispatch",
    path: "/customers/dispatch",
    icon: MessageSquareText,
    status: "live",
    blurb: "Contact decisions and shadow transport; nothing sent",
  },
  // Cohort workspaces: real routes with their own header numbers and
  // follow-up actions. The same populations remain reachable as starter
  // segments on All customers (`?segment=`).
  ...Object.values(COHORTS).map<ChildRouteDef>((c) => ({
    key: `customers-cohort-${c.key}`,
    label: c.label,
    path: c.path,
    icon: c.icon,
    group: "Cohorts",
    status: "live",
    blurb: c.blurb,
  })),
];

const FULFILMENT_CHILDREN: ChildRouteDef[] = [
  { key: "fulfilment-overview", label: "Overview", path: "/fulfilment", isDefault: true, icon: GitBranch, group: "Floor", status: "live" },
  { key: "fulfilment-readiness", label: "Ship-readiness", path: "/fulfilment/readiness", icon: ClipboardCheck, group: "Floor", status: "live" },
  { key: "fulfilment-exceptions", label: "Exceptions", path: "/fulfilment/exceptions", icon: ShieldAlert, group: "Floor", status: "live" },
  { key: "fulfilment-returns", label: "Returns", path: "/fulfilment/returns", icon: Undo2, group: "Floor", status: "live" },
  {
    key: "fulfilment-awb",
    label: "AWB Manager",
    path: "/fulfilment/awb",
    icon: Truck,
    group: "Courier",
    status: "live",
    blurb: "Shadow: push, AWB, print, handover, pickup as separate facts",
  },
  {
    key: "fulfilment-delivery-notes",
    label: "Delivery notes",
    path: "/fulfilment/delivery-notes",
    icon: FileText,
    group: "Courier",
    status: "next-module",
    nextModule: {
      summary: "Printable delivery notes and packing slips per order or per manifest, with brand-specific sender details.",
      workflow: [
        "Generate from an order, a pick list, or a courier manifest",
        "Brand sender name, logo and return address come from the brand profile",
        "Print in bulk; every print lands on the order timeline",
      ],
      unlocks: ["Brand sender profiles (Settings → General)", "Label / cloud print integration"],
    },
  },
  {
    key: "fulfilment-bulk-status",
    label: "Bulk tracking",
    path: "/fulfilment/bulk-status",
    icon: ListChecks,
    group: "Courier",
    status: "next-module",
    nextModule: {
      summary: "Paste or upload tracking ids or order numbers and get their current courier status in one table.",
      workflow: [
        "Paste tracking ids / order numbers or upload a sheet",
        "Statuses resolve from the Ninja Van read-side (J&T once connected)",
        "Export the result or push failures into the exceptions queue",
      ],
      unlocks: ["J&T tracking read-side", "Bulk lookup RPC over nv_shipments"],
    },
  },
  {
    key: "fulfilment-pickup-locations",
    label: "Pickup locations",
    path: "/fulfilment/pickup-locations",
    icon: Warehouse,
    group: "Courier",
    status: "next-module",
    nextModule: {
      summary: "Warehouses and drop-off points the couriers collect from, per brand and per courier.",
      workflow: [
        "Register pickup addresses with contact and operating hours",
        "Pick the location per brand / courier / order at booking time",
        "Courier-side pickup ids are stored so bookings reference the right place",
      ],
      unlocks: ["Courier pickup-location APIs (Ninja Van, J&T)", "Book courier write path"],
    },
  },
  {
    key: "fulfilment-duplicates",
    label: "Duplicate orders",
    path: "/fulfilment/duplicates",
    icon: CopyX,
    group: "Checks",
    status: "next-module",
    nextModule: {
      summary:
        "Flag orders that look like duplicates — same customer identity, address and items within a short window — before they ship twice.",
      workflow: [
        "Candidates from customer identity keys (phone / address) plus item overlap within 72h",
        "Review side by side; merge, cancel one, or mark as intentional",
        "Decisions are audited and feed the identity model",
      ],
      unlocks: ["order_identity_key across every store", "Cancel write path (gated by ADR-0006)"],
    },
  },
  {
    key: "fulfilment-fraud",
    label: "Fraud checker",
    path: "/fulfilment/fraud",
    icon: ScanSearch,
    group: "Checks",
    status: "next-module",
    nextModule: {
      summary:
        "Risk signals per order: COD refusal history, returns-to-sender, blocked phones and addresses, and order velocity.",
      workflow: [
        "Score at intake from RTS history, COD refusal rate and identity clusters",
        "Hold high-risk orders in the fulfilment gate for review",
        "Reviewer decisions tune the thresholds; every hold is on the order timeline",
      ],
      unlocks: [
        "RTS + COD outcome history per identity (nv_returns, customer risk)",
        "Hold / release write path in the fulfilment gate",
      ],
    },
  },
  {
    key: "fulfilment-postcodes",
    label: "Postcode finder",
    path: "/fulfilment/postcodes",
    icon: MapPin,
    group: "Checks",
    status: "next-module",
    nextModule: {
      summary:
        "Look up any Malaysian postcode to its state and courier serviceability, and fix mismatches before booking.",
      workflow: [
        "Search by postcode or town; see state, courier coverage and lead time",
        "Ship-readiness already flags postcode/state mismatches from the same table",
        "Apply the correction to the order address in one click",
      ],
      unlocks: [
        "my_postcode_ranges exists — needs the lookup page and courier coverage columns",
        "Courier serviceability feeds",
      ],
    },
  },
];

/* --------------------------------------------------------------- routes */

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
    children: ORDER_CHILDREN,
    childGroups: ["Make order", "Bulk orders", "Queues"],
  },
  {
    key: "customers",
    label: "Customers",
    path: "/customers",
    icon: Users,
    group: "Commerce",
    status: "live",
    permission: "customers.view",
    children: CUSTOMER_CHILDREN,
    childGroups: ["Cohorts"],
  },
  {
    key: "fulfilment",
    label: "Fulfilment",
    path: "/fulfilment",
    icon: Truck,
    group: "Commerce",
    status: "live",
    permission: "orders.view",
    children: FULFILMENT_CHILDREN,
    childGroups: ["Floor", "Courier", "Checks"],
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
    childGroups: ["Customer economics"],
    children: [
      { key: "profit-overview", label: "Contribution overview", path: "/profit", isDefault: true, icon: TrendingUp, status: "live", blurb: "CM2 / CM3 on the commerce spine" },
      { key: "profit-customer-economics", label: "Customer economics", path: "/profit/customer-economics", icon: Users, group: "Customer economics", status: "live", blurb: "First-order contribution, LTV by horizon, repeat" },
      { key: "profit-acquisition-efficiency", label: "Acquisition efficiency", path: "/profit/acquisition-efficiency", icon: BadgeDollarSign, group: "Customer economics", status: "live", blurb: "nCAC, paid share, FOP" },
      { key: "profit-cohorts-payback", label: "Cohorts & payback", path: "/profit/cohorts-payback", icon: Gauge, group: "Customer economics", status: "live", blurb: "LTV:nCAC by cohort and horizon" },
      { key: "profit-definitions-coverage", label: "Definitions & coverage", path: "/profit/definitions-coverage", icon: ClipboardList, group: "Customer economics", status: "live", blurb: "Formulas, provisional decisions, suppression" },
    ],
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
    childGroups: ["Registry"],
    children: [
      { key: "inventory-overview", label: "Stock signals", path: "/inventory", isDefault: true, icon: Boxes, status: "live", blurb: "On hand, cover and mapping queue" },
      { key: "inventory-registry", label: "Items & locations", path: "/inventory/registry", icon: Warehouse, group: "Registry", status: "live", blurb: "Item master and logical locations (S3 rule)" },
      { key: "inventory-pack-configurations", label: "Pack configurations", path: "/inventory/pack-configurations", icon: Package, group: "Registry", status: "live", blurb: "Versioned pack master per sellable variant" },
      { key: "inventory-marketplaces", label: "Marketplaces", path: "/inventory/marketplaces", icon: Cable, group: "Registry", status: "live", blurb: "Account registry, cutover mode, listing mapping" },
    ],
  },
  {
    key: "production",
    label: "Production",
    path: "/production",
    icon: Factory,
    group: "Merchandise",
    status: "live",
    permission: "catalog.view",
    children: [
      { key: "production-overview", label: "Pipeline", path: "/production", isDefault: true, icon: Factory, status: "live", blurb: "Stages, materials, inbound, ledger" },
      { key: "production-observations", label: "WhatsApp observations", path: "/production/observations", icon: MessageSquareText, status: "live", blurb: "Factory updates as evidence; review links, never moves stock" },
    ],
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

export interface SettingsRouteDef extends Omit<RouteDef, "group" | "children" | "childGroups"> {
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

/* ---------------------------------------------------------------- helpers */

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

export function visibleChildren(route: RouteDef, role: RoleKey): ChildRouteDef[] {
  const perms = ROLE_PERMISSIONS[role];
  return (route.children ?? []).filter((c) => !c.permission || perms.includes(c.permission));
}

/** Longest-prefix top-level route for a pathname. */
export function parentRouteForPath(pathname: string): RouteDef | undefined {
  return [...ROUTES]
    .sort((a, b) => b.path.length - a.path.length)
    .find((r) => pathname === r.path || pathname.startsWith(`${r.path}/`));
}

/** What the secondary sidebar renders for one section. */
export interface NavSection {
  key: string;
  label: string;
  icon: LucideIcon;
  rootPath: string;
  groups: readonly string[];
  /** Already RBAC-filtered. */
  children: ChildRouteDef[];
}

/**
 * The section that owns `pathname`, or null for leaf routes (Marketing,
 * Finance…). Settings is a synthetic section: it is not in ROUTES, but on
 * /settings/* the same secondary sidebar lists SETTINGS_ROUTES.
 */
export function sectionForPath(pathname: string, role: RoleKey): NavSection | null {
  if (pathname === "/settings" || pathname.startsWith("/settings/")) {
    const items = visibleSettingsRoutes(role);
    if (items.length === 0) return null;
    return {
      key: "settings",
      label: "Settings",
      icon: Settings,
      rootPath: "/settings",
      groups: SETTINGS_GROUPS,
      children: items.map<ChildRouteDef>((r) => ({
        key: r.key,
        label: r.label,
        path: r.path,
        icon: r.icon,
        group: r.group,
        status: r.status,
        blurb: r.blurb,
        nextModule: r.nextModule,
      })),
    };
  }
  const parent = parentRouteForPath(pathname);
  if (!parent?.children) return null;
  const perms = ROLE_PERMISSIONS[role];
  if (parent.permission && !perms.includes(parent.permission)) return null;
  const children = visibleChildren(parent, role);
  if (children.length === 0) return null;
  return {
    key: parent.key,
    label: parent.label,
    icon: parent.icon,
    rootPath: parent.path,
    groups: parent.childGroups ?? [],
    children,
  };
}

export function hrefFor(c: ChildRouteDef): string {
  const qs = c.query ? `?${new URLSearchParams(c.query).toString()}` : "";
  const hash = c.hash ? `#${c.hash}` : "";
  return `${c.path}${qs}${hash}`;
}

/** Key lookup across parents, children and settings — NextModulePage uses this. */
export function routeByKey(key: string): RouteDef | ChildRouteDef | SettingsRouteDef | undefined {
  return (
    ROUTES.find((r) => r.key === key) ??
    ROUTES.flatMap((r) => r.children ?? []).find((c) => c.key === key) ??
    SETTINGS_ROUTES.find((r) => r.key === key)
  );
}

export function routeForPath(
  pathname: string,
): RouteDef | ChildRouteDef | SettingsRouteDef | undefined {
  // Query-string children are views of the parent, not routes: exclude them.
  const childRoutes = ROUTES.flatMap((r) => (r.children ?? []).filter((c) => !c.query));
  const all: Array<RouteDef | ChildRouteDef | SettingsRouteDef> = [
    ...ROUTES,
    ...childRoutes,
    ...SETTINGS_ROUTES,
  ];
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
