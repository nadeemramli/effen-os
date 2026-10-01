/**
 * Poster analysis schema (ADR-0010 §7). An analysis is an OBSERVATION of
 * actual poster pixels — produced by a configured vision provider or a
 * human — saved as a draft and reviewed before any recipe may cite it.
 * It records what is visible, never why it performed: performance is
 * attached separately as an evidence snapshot.
 */
import type { LayoutKey } from "./recipe";

export interface PosterAnalysis {
  schema_version: "poster-analysis-v1";
  observed_by: { kind: "human" | "provider" | "fixture"; provider?: string; model?: string };
  image: { sha256: string; width: number; height: number };
  layout: { archetype: LayoutKey | "other"; grid_notes: string };
  product: {
    visible: boolean;
    count: number;
    placement: string; // e.g. "right half, bottom-aligned"
    share_of_canvas_pct: number;
    label_legible: boolean;
  };
  text: Array<{ role: "headline" | "subhead" | "badge" | "cta" | "disclaimer" | "other"; text: string; approx_size_pct: number }>;
  palette: Array<{ hex: string; role: "background" | "text" | "accent" | "product" }>;
  hierarchy: string[]; // reading order, first → last
  offer_present: boolean;
  claims_seen: string[]; // verbatim, to be checked against approved claims
  people_present: boolean;
  notes: string;
}

export interface AnalysisIssue {
  path: string;
  message: string;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

export function validatePosterAnalysis(a: PosterAnalysis): AnalysisIssue[] {
  const out: AnalysisIssue[] = [];
  if (a.schema_version !== "poster-analysis-v1") out.push({ path: "schema_version", message: "unsupported" });
  if (!/^[0-9a-f]{64}$/.test(a.image.sha256)) out.push({ path: "image.sha256", message: "must be the analysed bytes' SHA-256" });
  if (a.image.width <= 0 || a.image.height <= 0) out.push({ path: "image", message: "dimensions required" });
  if (a.product.share_of_canvas_pct < 0 || a.product.share_of_canvas_pct > 100) {
    out.push({ path: "product.share_of_canvas_pct", message: "0–100" });
  }
  a.palette.forEach((p, i) => {
    if (!HEX.test(p.hex)) out.push({ path: `palette[${i}].hex`, message: "#RRGGBB" });
  });
  if (a.hierarchy.length === 0) out.push({ path: "hierarchy", message: "record the reading order" });
  if (a.observed_by.kind === "provider" && (!a.observed_by.provider || !a.observed_by.model)) {
    out.push({ path: "observed_by", message: "provider analyses must name provider and model" });
  }
  return out;
}
