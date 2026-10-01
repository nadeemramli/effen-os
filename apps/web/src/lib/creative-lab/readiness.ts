/**
 * Readiness view model: what stands between a brand and an eligible
 * production batch, in plain language. Missing owner decisions are listed
 * precisely; nothing here invents a default for them.
 */
import type { BrandReadinessRow, MissingConfigKey } from "./types";

export const MISSING_CONFIG_LABELS: Record<MissingConfigKey, { label: string; blocks: "generation" | "launch" | "analysis" }> = {
  image_provider_model: { label: "Image provider and model", blocks: "generation" },
  batch_budget: { label: "Per-batch spend ceiling", blocks: "generation" },
  reviewers: { label: "Named reviewers", blocks: "generation" },
  provider_data_approval: { label: "Approval to send private assets to the provider", blocks: "generation" },
  analysis_provider_model: { label: "Poster-analysis provider and model", blocks: "analysis" },
  approved_copy: { label: "Approved product claims / copy", blocks: "launch" },
  approved_offer: { label: "Approved offer", blocks: "launch" },
  target_economics: { label: "Target CPA or ROAS", blocks: "launch" },
  media_test_budget: { label: "Experiment / media-test budget", blocks: "launch" },
};

export type ReadinessStage = "no_kit" | "kit_draft" | "no_packshots" | "needs_config" | "ready";

export interface ReadinessView {
  stage: ReadinessStage;
  blockers: string[];
  canGenerate: boolean;
  canLaunch: boolean;
  hasPerformanceData: boolean;
}

export function readinessOf(r: BrandReadinessRow): ReadinessView {
  const blockers: string[] = [];
  if (r.kit_status === "none") blockers.push("Brand kit not imported");
  else if (r.kit_status !== "approved") blockers.push(`Brand kit v${r.kit_version} is ${r.kit_status} (${r.kit_provenance ?? "unknown provenance"}, ${r.kit_completeness ?? "unknown"}) — owner approval required`);
  if (r.kit_status !== "none" && r.packshots === 0) blockers.push("No authentic packshots in the kit");
  const genMissing = r.missing_config.filter((k) => MISSING_CONFIG_LABELS[k].blocks === "generation");
  for (const k of r.missing_config) blockers.push(`Missing: ${MISSING_CONFIG_LABELS[k].label}`);
  const stage: ReadinessStage =
    r.kit_status === "none" ? "no_kit" : r.kit_status !== "approved" ? "kit_draft" : r.packshots === 0 ? "no_packshots" : genMissing.length ? "needs_config" : "ready";
  return {
    stage,
    blockers,
    canGenerate: stage === "ready",
    canLaunch: stage === "ready" && r.missing_config.length === 0,
    hasPerformanceData: r.image_fact_rows > 0,
  };
}
