/**
 * Image ranking, method `image-rank-v1` (ADR-0010 §6).
 *
 * Input: per image × cohort totals (public.creative_image_leaderboard).
 * Output: rankings WITHIN each comparability cohort only, plus every
 * ineligible image with the reasons it was not ranked.
 *
 * What this is: a screening of observational platform-attributed results
 * to choose which posters to study. What it is not: proof that the poster
 * caused the result, or a significance test. Thresholds are PROVISIONAL
 * configuration, labelled as such in the UI, and recorded with every
 * snapshot via `method_version` + `params`.
 *
 * Small-sample protection: ROAS and purchase rate are shrunk toward the
 * cohort's pooled value with `priorSpend` of pseudo-spend (a gamma-Poisson
 * style posterior mean). An image with 1 purchase on tiny spend cannot
 * top the table by luck.
 */
import type { CohortKey, ImageLeaderboardRow } from "./types";

export const RANKING_METHOD_VERSION = "image-rank-v1";

export interface RankingParams {
  /** Minimum spend in the cohort currency before an image is ranked. PROVISIONAL. */
  minSpend: number;
  /** Minimum platform-attributed purchases. PROVISIONAL. */
  minPurchases: number;
  /** Max share of spend still inside the late-conversion window. */
  maxMaturingShare: number;
  /** Pseudo-spend pulling small samples toward the cohort mean. */
  priorSpend: number;
  /** Shrunk ROAS ≥ cohort ROAS × (1 + leaderUplift) → "leader" tier. PROVISIONAL. */
  leaderUplift: number;
  /** Exclude banned-account history from ranking (kept visible). */
  excludeBanned: boolean;
}

/** Labelled provisional defaults — never presented as significance thresholds. */
export const PROVISIONAL_RANKING_PARAMS: RankingParams = {
  minSpend: 300,
  minPurchases: 5,
  maxMaturingShare: 0.25,
  priorSpend: 500,
  leaderUplift: 0.2,
  excludeBanned: false,
};

export type IneligibleReason =
  | "below_min_spend"
  | "below_min_purchases"
  | "immature_data"
  | "banned_account_excluded"
  | "unknown_currency"
  | "unknown_cohort_field"
  | "zero_spend";

export type Tier = "leader" | "contender" | "below_cohort";

export interface RankedImage {
  row: ImageLeaderboardRow;
  cohortId: string;
  rank: number;
  tier: Tier;
  roas: number;
  cpa: number | null;
  shrunkRoas: number;
  shrunkPurchaseRate: number;
  /** shrunk ROAS / cohort ROAS */
  indexVsCohort: number;
}

export interface IneligibleImage {
  row: ImageLeaderboardRow;
  cohortId: string;
  reasons: IneligibleReason[];
}

export interface CohortRanking {
  cohortId: string;
  cohort: CohortKey;
  pooledSpend: number;
  pooledPurchases: number;
  pooledValue: number;
  pooledRoas: number | null;
  ranked: RankedImage[];
  ineligible: IneligibleImage[];
}

export interface RankingResult {
  methodVersion: string;
  params: RankingParams;
  cohorts: CohortRanking[];
}

export function cohortIdOf(k: CohortKey): string {
  return [k.market, k.currency_code, k.campaign_objective, k.attribution_setting, k.account_timezone].join(" | ");
}

function cohortOf(r: ImageLeaderboardRow): CohortKey {
  return {
    market: r.market,
    currency_code: r.currency_code,
    campaign_objective: r.campaign_objective,
    attribution_setting: r.attribution_setting,
    account_timezone: r.account_timezone,
  };
}

function ineligibility(r: ImageLeaderboardRow, p: RankingParams): IneligibleReason[] {
  const reasons: IneligibleReason[] = [];
  const spend = r.spend ?? 0;
  if (spend <= 0) reasons.push("zero_spend");
  if (r.currency_code === "UNKNOWN") reasons.push("unknown_currency");
  if ([r.market, r.campaign_objective, r.attribution_setting].includes("UNKNOWN")) {
    reasons.push("unknown_cohort_field");
  }
  if (spend > 0 && spend < p.minSpend) reasons.push("below_min_spend");
  if ((r.purchases ?? 0) < p.minPurchases) reasons.push("below_min_purchases");
  if (spend > 0 && r.maturing_spend / spend > p.maxMaturingShare) reasons.push("immature_data");
  if (p.excludeBanned && r.any_banned_account) reasons.push("banned_account_excluded");
  return reasons;
}

export function rankImages(
  rows: readonly ImageLeaderboardRow[],
  params: RankingParams = PROVISIONAL_RANKING_PARAMS,
): RankingResult {
  const byCohort = new Map<string, ImageLeaderboardRow[]>();
  for (const r of rows) {
    const id = cohortIdOf(cohortOf(r));
    const list = byCohort.get(id);
    if (list) list.push(r);
    else byCohort.set(id, [r]);
  }

  const cohorts: CohortRanking[] = [];
  for (const [cohortId, members] of byCohort) {
    // pooled baseline uses every image in the cohort, eligible or not, so the
    // prior reflects the cohort and not only its winners
    const pooledSpend = sum(members.map((m) => m.spend ?? 0));
    const pooledPurchases = sum(members.map((m) => m.purchases ?? 0));
    const pooledValue = sum(members.map((m) => m.purchase_value ?? 0));
    const pooledRoas = pooledSpend > 0 ? pooledValue / pooledSpend : null;
    const pooledRate = pooledSpend > 0 ? pooledPurchases / pooledSpend : 0;

    const ranked: RankedImage[] = [];
    const ineligible: IneligibleImage[] = [];
    for (const r of members) {
      const reasons = ineligibility(r, params);
      if (reasons.length > 0 || pooledRoas === null) {
        ineligible.push({ row: r, cohortId, reasons: reasons.length ? reasons : ["zero_spend"] });
        continue;
      }
      const spend = r.spend;
      const value = r.purchase_value ?? 0;
      const purchases = r.purchases ?? 0;
      const k = params.priorSpend;
      const shrunkRoas = (value + k * pooledRoas) / (spend + k);
      const shrunkPurchaseRate = (purchases + k * pooledRate) / (spend + k);
      const indexVsCohort = pooledRoas > 0 ? shrunkRoas / pooledRoas : 0;
      ranked.push({
        row: r,
        cohortId,
        rank: 0,
        tier: "contender",
        roas: value / spend,
        cpa: purchases > 0 ? spend / purchases : null,
        shrunkRoas,
        shrunkPurchaseRate,
        indexVsCohort,
      });
    }
    ranked.sort(
      (a, b) =>
        b.shrunkRoas - a.shrunkRoas ||
        b.row.spend - a.row.spend ||
        a.row.image_hash.localeCompare(b.row.image_hash),
    );
    ranked.forEach((x, i) => {
      x.rank = i + 1;
      x.tier = x.indexVsCohort >= 1 + params.leaderUplift ? "leader" : x.indexVsCohort >= 1 ? "contender" : "below_cohort";
    });
    cohorts.push({
      cohortId,
      cohort: cohortOf(members[0]),
      pooledSpend,
      pooledPurchases,
      pooledValue,
      pooledRoas,
      ranked,
      ineligible,
    });
  }
  cohorts.sort((a, b) => b.pooledSpend - a.pooledSpend || a.cohortId.localeCompare(b.cohortId));
  return { methodVersion: RANKING_METHOD_VERSION, params, cohorts };
}

function sum(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}
