/**
 * Creative Learning & Poster Production — shared contracts (ADR-0010).
 *
 * These mirror the warehouse creative marts and the proposed `creative`
 * Supabase schema. Identity vocabulary, kept deliberately distinct:
 *
 *   ad execution    one platform ad (ad_id) — delivery happens here
 *   creative config the platform creative an ad points at (creative_id)
 *   image version   exact bytes (sha256); Meta's image_hash is per account
 *   concept         the idea a family of variants expresses
 *   recipe          structured, versioned reconstruction spec + SOP
 *   variant         one generated candidate (slot) inside a batch family
 *   experiment      a launched set of variants bound to ads
 *
 * Pure module: no React, no Supabase, no network.
 */

export type CreativeFormat =
  | "single_image"
  | "carousel"
  | "dynamic"
  | "video"
  | "existing_post"
  | "unknown";

export type BindingStatus =
  | "bound"
  | "ad_not_in_catalog"
  | "creative_not_in_catalog"
  | "creative_missing"
  | "conflicting_creative";

export type DataMaturity = "maturing" | "settled";

/** Comparability cohort: rows that differ on any of these are never ranked together. */
export interface CohortKey {
  market: string;
  currency_code: string;
  campaign_objective: string;
  attribution_setting: string;
  account_timezone: string;
}

/** One row of public.creative_image_leaderboard (image × cohort totals in a window). */
export interface ImageLeaderboardRow extends CohortKey {
  platform: string;
  account_id: string;
  image_hash: string;
  spend: number;
  impressions: number | null;
  clicks: number | null;
  purchases: number | null;
  purchase_value: number | null;
  max_concurrent_ads: number;
  distinct_ads: number;
  first_date: string;
  last_date: string;
  days: number;
  maturing_spend: number;
  any_banned_account: boolean;
  fetch_status: "pending" | "archived" | "failed" | "unavailable" | null;
  asset_sha256: string | null;
  asset_storage_ref: string | null;
}

export interface ImageLeaderboard {
  as_of: string | null;
  window: { from: string; to: string };
  rows: ImageLeaderboardRow[];
}

export type MissingConfigKey =
  | "image_provider_model"
  | "analysis_provider_model"
  | "batch_budget"
  | "reviewers"
  | "provider_data_approval"
  | "target_economics"
  | "media_test_budget"
  | "approved_copy"
  | "approved_offer";

export type KitStatus = "none" | "draft" | "approved" | "superseded" | "rejected";
export type KitProvenance = "website_derived" | "historical_identity" | "owner_supplied" | "fixture";

/** One row of public.creative_readiness(). */
export interface BrandReadinessRow {
  brand_id: number;
  brand_slug: string;
  brand_name: string;
  kit_version_id: number | null;
  kit_version: number | null;
  kit_status: KitStatus;
  kit_provenance: KitProvenance | null;
  kit_completeness: "detailed" | "incomplete" | null;
  packshots: number;
  kit_assets: number;
  image_fact_rows: number;
  facts_synced_at: string | null;
  missing_config: MissingConfigKey[];
  batches: number;
}

export type Lane = "exploit" | "adjacent" | "explore";

export type GenerationStatus = "queued" | "generating" | "generated" | "failed" | "duplicate";
export type QaStatus = "pending" | "passed" | "failed";
export type ReviewStatus = "pending" | "approved" | "rejected" | "changes_requested";
export type ExportStatus = "not_exported" | "exported";
export type LaunchStatus = "not_launched" | "launched";
export type BatchStatus = "running" | "awaiting_review" | "paused_budget" | "completed" | "cancelled";

/** Brand design tokens as imported from tokens.json (all optional: kits are often incomplete). */
export interface BrandTokens {
  colors?: { primary?: string; secondary?: string; accent?: string; background?: string; text?: string; [k: string]: string | undefined };
  fonts?: { heading?: string; body?: string };
  logo_asset_sha256?: string;
}
