/**
 * Creative Lab read/write contracts against the creative schema
 * (supabase/migrations/*_creative_lab_v1_*.sql, ADR-0010). Every call is an RPC;
 * the browser never reads creative.* tables, BigQuery or Meta directly.
 *
 * On a project without the schema the RPCs do not exist; callers get a
 * `CreativeNotProvisionedError` and render that state — never fixtures
 * dressed up as live data.
 */
import type { BrandReadinessRow, ImageLeaderboard } from "@/lib/creative-lab/types";
import { getSupabase } from "./client";

export class CreativeNotProvisionedError extends Error {
  constructor(fn: string) {
    super(`${fn} is not available: the creative schema (ADR-0010) has not been applied to this project`);
    this.name = "CreativeNotProvisionedError";
  }
}

async function creativeRpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await getSupabase().rpc(fn, args);
  if (error) {
    // PostgREST: PGRST202 = function not found in the schema cache
    if (error.code === "PGRST202" || /could not find the function/i.test(error.message)) {
      throw new CreativeNotProvisionedError(fn);
    }
    throw new Error(error.message);
  }
  return data as T;
}

export const fetchCreativeReadiness = () => creativeRpc<BrandReadinessRow[]>("creative_readiness");

export const fetchImageLeaderboard = (brandId: number, market: string | null, from: string, to: string) =>
  creativeRpc<ImageLeaderboard>("creative_image_leaderboard", { p_brand_id: brandId, p_market: market, p_from: from, p_to: to });

export interface ImageEvidence {
  platform_ref: { account_id: string; image_hash: string; fetch_status: string; fetched_at: string | null } | null;
  asset: { sha256: string; storage_ref: string | null; width: number | null; height: number | null } | null;
  same_bytes_refs: Array<{ account_id: string; image_hash: string }>;
  daily: Array<Record<string, unknown>>;
  ads: Array<{ ad_id: string; campaign_id: string | null; creative_id: string | null; first_date: string; last_date: string; spend: number; purchases: number | null; purchase_value: number | null }>;
  analyses: Array<Record<string, unknown>>;
}

export const fetchImageEvidence = (brandId: number, accountId: string, imageHash: string) =>
  creativeRpc<ImageEvidence>("creative_image_evidence", { p_brand_id: brandId, p_account_id: accountId, p_image_hash: imageHash });

export interface CreativeBatchSummary {
  batch: { id: number; brand_id: number; market: string; status: string; stage_limit: number; requested_count: number; budget_amount: number; budget_currency: string; reserved_amount: number; spent_amount: number; provider: string; model: string; created_at: string; version: number };
  counts: Record<"generated" | "failed" | "duplicate" | "qa_passed" | "approved" | "exported" | "launched", number>;
}

export const fetchCreativeBatches = (brandId: number) => creativeRpc<CreativeBatchSummary[]>("creative_batches", { p_brand_id: brandId });

export const fetchCandidateLineage = (candidateId: number) =>
  creativeRpc<Record<string, unknown>>("creative_candidate_lineage", { p_candidate_id: candidateId });

/* ---------- provider key + owner decisions ---------- */

export interface ProviderStatus {
  provider: string;
  key_set: boolean;
  set_at: string | null;
}

export const fetchProviderStatus = () => creativeRpc<ProviderStatus[]>("creative_provider_status");

/** HQ admin only. The key goes straight to Vault; it is never returned to any client. */
export const setProviderKey = (provider: "openai", apiKey: string) =>
  creativeRpc<{ provider: string; key_set: boolean }>("creative_set_provider_key", { p_provider: provider, p_api_key: apiKey });

export interface RuntimeConfig {
  brand_id: number;
  version: number; // 0 = never configured
  image_provider: string | null;
  image_model: string | null;
  analysis_provider: string | null;
  analysis_model: string | null;
  batch_budget_amount: number | null;
  budget_currency: string | null;
  max_cost_per_candidate: number | null;
  reviewer_membership_ids: number[];
  target_cpa: number | null;
  target_roas: number | null;
  economics_currency: string | null;
  media_test_budget_amount: number | null;
  provider_data_approved: boolean;
  provider_pricing: Record<string, number | string>;
  updated_at?: string;
  missing_config: string[];
}

export const fetchRuntimeConfig = (brandId: number) =>
  creativeRpc<RuntimeConfig>("creative_runtime_config", { p_brand_id: brandId });

/** HQ admin only; optimistic concurrency on `version` (0 → first write, no check). */
export const setRuntimeConfig = (brandId: number, patch: Record<string, unknown>, version: number) =>
  creativeRpc<{ changed: boolean; version: number }>("creative_set_runtime_config", {
    p_brand_id: brandId,
    p_patch: patch,
    p_expected_version: version > 0 ? version : null,
  });
