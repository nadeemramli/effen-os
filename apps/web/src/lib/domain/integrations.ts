/**
 * Presentation vocabulary for the live `integration_connections` register.
 * Shared by Settings → Integrations, Data health and the Command Center so the
 * same status reads the same everywhere.
 */

export const CATEGORY_ORDER = [
  "commerce",
  "logistics",
  "ads",
  "marketplace",
  "payments",
  "cdp",
  "analytics",
  "accounting",
] as const;

export const CATEGORY_LABEL: Record<string, string> = {
  commerce: "Commerce",
  logistics: "Couriers",
  ads: "Advertising",
  marketplace: "Marketplaces",
  payments: "Payments",
  cdp: "CDP",
  analytics: "Analytics",
  accounting: "Accounting",
};

export const STATUS_META: Record<string, { label: string; className: string }> = {
  healthy: { label: "Healthy", className: "border-success/30 bg-success/10 text-success" },
  degraded: { label: "Degraded", className: "border-warning/30 bg-warning/10 text-warning" },
  stale: { label: "Stale", className: "border-destructive/30 bg-destructive/10 text-destructive" },
  disconnected: { label: "Disconnected", className: "border-destructive/30 bg-destructive/10 text-destructive" },
  pending_setup: { label: "Pending setup", className: "text-muted-foreground" },
};

export function statusMeta(status: string): { label: string; className: string } {
  return STATUS_META[status] ?? { label: status.replace(/_/g, " "), className: "text-muted-foreground" };
}

export function categoryRank(category: string): number {
  const i = (CATEGORY_ORDER as readonly string[]).indexOf(category);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

export function slaLabel(minutes: number): string {
  return minutes >= 60 ? `${Math.round(minutes / 60)}h` : `${minutes}m`;
}

/** Which Setup surface configures a provider, if any. */
export function setupHrefFor(provider: string): string | null {
  switch (provider) {
    case "WooCommerce":
    case "WhatsApp":
    case "Ninja Van":
    case "OpenRouter":
      return "/settings/setup/connections";
    case "Shopee":
    case "TikTok":
    case "Lazada":
      return "/inventory/marketplaces";
    default:
      return null;
  }
}

/** Scalar config entries worth showing on a connection card (never secrets — those live in Vault). */
export function describeConfig(config: Record<string, unknown> | null): { key: string; value: string }[] {
  if (!config) return [];
  return Object.entries(config)
    .filter(([, v]) => ["string", "number", "boolean"].includes(typeof v))
    .map(([key, v]) => ({ key: key.replace(/_/g, " "), value: String(v) }))
    .sort((a, b) => a.key.localeCompare(b.key));
}
