/**
 * Production / inventory / marketplace registries — mirror the
 * production_inventory_marketplace_v1 migration (program plan Phase 7, R25).
 * Registries and evidence only: no stock level is changed from here.
 */

export type Tone = "neutral" | "success" | "warning" | "destructive" | "info";

export interface InventoryLocation {
  id: number;
  key: string;
  name: string;
  location_type: string;
  factory: string | null;
  authority_system: "none" | "fullkit" | "external_wms" | "fighter";
  status: string;
}

export interface InventoryItem {
  id: number;
  item_type: "raw_material" | "bulk_compound" | "wip" | "packaging" | "finished_good" | "fulfilment_material";
  name: string;
  uom: string;
  variant_id: number | null;
  sku: string | null;
  stock_on_hand: number | null;
  units_per_pack: number | null;
  status: string;
}

export const PRESENTATION_TYPES = ["capsule_bottle", "sachet_box", "bundle", "other"] as const;
export type PresentationType = (typeof PRESENTATION_TYPES)[number];
export const CONTAINED_UNIT_TYPES = ["capsule", "sachet", "bottle", "box", "unit"] as const;
export type ContainedUnitType = (typeof CONTAINED_UNIT_TYPES)[number];

export interface PackConfiguration {
  id: number;
  variant_id: number;
  sku: string;
  variant_name: string | null;
  product: string | null;
  version: number;
  presentation_type: PresentationType;
  sellable_uom: string;
  contained_unit_type: ContainedUnitType;
  contained_units_per_pack: number;
  content_per_unit: string | null;
  recommended_units_per_day: number | null;
  nominal_days_supply: number | null;
  packaging_bom_version: string | null;
  effective_from: string;
  effective_to: string | null;
  status: "draft" | "approved" | "superseded" | "rejected";
  note: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface InventoryRegistry {
  status: "ok";
  migration_rule: string;
  locations: InventoryLocation[];
  items: InventoryItem[];
  pack_configurations: PackConfiguration[];
  publishable: { formula: string; inputs_available: false; missing: string[]; note: string };
}

export const PACK_STATUS_TONE: Record<PackConfiguration["status"], Tone> = { draft: "info", approved: "success", superseded: "neutral", rejected: "destructive" };

/* ---------- marketplace ---------- */

export type CutoverMode = "disconnected" | "read_only" | "shadow" | "pilot_write" | "live";
export const CUTOVER_TONE: Record<CutoverMode, Tone> = { disconnected: "neutral", read_only: "info", shadow: "info", pilot_write: "warning", live: "success" };
export const APPROVAL_TONE: Record<string, Tone> = { not_submitted: "neutral", in_progress: "warning", submitted: "info", approved: "success", rejected: "destructive" };

export interface MarketplaceAccount {
  id: number;
  integration_id: number | null;
  integration_name: string | null;
  integration_status: string | null;
  platform: "shopee" | "tiktok_shop" | "lazada";
  account_label: string;
  account_ref: string | null;
  legal_entity_id: number | null;
  legal_entity: string | null;
  brand_id: number | null;
  market: string;
  currency_code: string;
  timezone: string;
  scopes_requested: string[];
  scopes_granted: string[];
  approval_state: "not_submitted" | "in_progress" | "submitted" | "approved" | "rejected";
  app_state: string | null;
  webhook_subscribed: boolean;
  polling_cursor: string | null;
  capabilities: Record<string, boolean>;
  authority: Record<string, string>;
  cutover_mode: CutoverMode;
  last_success_at: string | null;
  last_failure_at: string | null;
  reconciliation_status: string;
  notes: string | null;
  listings: number;
  unmapped_listings: number;
  updated_at: string;
}

export interface MarketplaceListing {
  id: number;
  account_id: number;
  listing_id: string;
  variation_id: string | null;
  source_sku: string | null;
  title: string | null;
  variant_id: number | null;
  inventory_item_id: number | null;
  mapping_status: "unmapped" | "mapped" | "ambiguous" | "bundle";
  first_seen_at: string;
  last_seen_at: string;
}

export interface MarketplaceRegistry {
  status: "ok";
  posture: string;
  onboarding_register: string;
  accounts: MarketplaceAccount[];
  listings: MarketplaceListing[];
  connector: { built: false; reason: string };
}

export const PLATFORM_LABELS: Record<MarketplaceAccount["platform"], string> = { shopee: "Shopee", tiktok_shop: "TikTok Shop", lazada: "Lazada" };

/* ---------- WhatsApp observations ---------- */

export type ObservationState = "received" | "linked" | "unlinked_review" | "accepted" | "rejected";
export const OBSERVATION_TONE: Record<ObservationState, Tone> = { received: "neutral", linked: "info", unlinked_review: "warning", accepted: "success", rejected: "destructive" };

export interface WaObservation {
  id: number;
  thread_ref: string | null;
  sender_ref: string | null;
  message_at: string | null;
  received_at: string;
  text: string | null;
  media: number;
  parser_version: string;
  parsed: Record<string, unknown>;
  confidence: number | null;
  state: ObservationState;
  production_item_id: number | null;
  batch_ref: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
}

export interface WaObservations {
  status: "ok";
  connection: { status: string; last_success_at: string | null; notes: string | null } | null;
  numbers: number;
  feasibility_gate: string;
  summary: Record<string, number> | null;
  rows: WaObservation[];
}
