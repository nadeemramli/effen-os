/**
 * Creative Lab read/write contracts against the PROPOSED creative schema
 * (supabase/proposed/creative_lab_v1.sql, ADR-0010). Every call is an RPC;
 * the browser never reads creative.* tables, BigQuery or Meta directly.
 *
 * Until the migration is applied the RPCs do not exist; callers get a
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
