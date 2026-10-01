/**
 * Markdown reconstruction SOP renderer, `poster-sop-v1`.
 *
 * NOTE: the handover's 03-poster-sop-template.md was not available in the
 * build environment. The section order below follows the handover prompt
 * (evidence → observation → reconstruction → fixed/variable factors →
 * QA → review) and must be reconciled with that template before the
 * first SOP is approved (ADR-0010 open item).
 */
import type { PosterAnalysis } from "./analysis";
import type { RecipeSpec } from "./recipe";

export const SOP_TEMPLATE_VERSION = "poster-sop-v1";

export interface SopEvidence {
  brand: string;
  market: string;
  cohort: string;
  window: string;
  method_version: string;
  rank: number | null;
  spend: number;
  currency: string;
  purchases: number;
  roas: number | null;
  shrunk_roas: number | null;
  maturing_share: number;
  snapshot_id: number | null;
  fixture: boolean;
}

const fmt = (n: number | null, d = 2) => (n == null ? "—" : n.toFixed(d));

export function renderSop(recipe: RecipeSpec, analysis: PosterAnalysis, evidence: SopEvidence): string {
  const lines: string[] = [];
  lines.push(`# Poster SOP — ${recipe.name}`);
  lines.push("");
  lines.push(`> Template ${SOP_TEMPLATE_VERSION} · status **draft** until reviewed · source image \`${analysis.image.sha256.slice(0, 12)}…\``);
  if (evidence.fixture) lines.push(`>`, `> **FIXTURE EVIDENCE — not real ad results. Do not approve.**`);
  lines.push("");
  lines.push("## 1. Evidence (observational)");
  lines.push("");
  lines.push(`| Field | Value |`, `|---|---|`);
  lines.push(`| Brand / market | ${evidence.brand} / ${evidence.market} |`);
  lines.push(`| Comparable cohort | ${evidence.cohort} |`);
  lines.push(`| Window | ${evidence.window} |`);
  lines.push(`| Ranking method | ${evidence.method_version} (provisional thresholds) |`);
  lines.push(`| Rank in cohort | ${evidence.rank ?? "not ranked"} |`);
  lines.push(`| Spend | ${fmt(evidence.spend)} ${evidence.currency} |`);
  lines.push(`| Platform-attributed purchases | ${evidence.purchases} |`);
  lines.push(`| ROAS (raw / shrunk) | ${fmt(evidence.roas)} / ${fmt(evidence.shrunk_roas)} |`);
  lines.push(`| Spend still maturing | ${(evidence.maturing_share * 100).toFixed(0)}% |`);
  lines.push(`| Snapshot | ${evidence.snapshot_id ?? "unsaved"} |`);
  lines.push("");
  lines.push("This poster performed well **in its cohort and window**. That is a reason to study it, not proof that its structure caused the result.");
  lines.push("");
  lines.push("## 2. What the poster shows");
  lines.push("");
  lines.push(`- Layout: **${analysis.layout.archetype}** — ${analysis.layout.grid_notes}`);
  lines.push(`- Product: ${analysis.product.visible ? `${analysis.product.count} pack(s), ${analysis.product.placement}, ~${analysis.product.share_of_canvas_pct}% of canvas, label ${analysis.product.label_legible ? "legible" : "not legible"}` : "not visible"}`);
  lines.push(`- Reading order: ${analysis.hierarchy.join(" → ")}`);
  for (const t of analysis.text) lines.push(`- ${t.role} (~${t.approx_size_pct}% height): “${t.text}”`);
  lines.push(`- Palette: ${analysis.palette.map((p) => `${p.hex} (${p.role})`).join(", ")}`);
  lines.push(`- Offer present: ${analysis.offer_present ? "yes" : "no"} · People: ${analysis.people_present ? "yes" : "no"}`);
  if (analysis.claims_seen.length) {
    lines.push(`- Claims seen (verify against approved claims before reuse): ${analysis.claims_seen.map((c) => `“${c}”`).join("; ")}`);
  }
  lines.push("");
  lines.push("## 3. Reconstruction steps");
  lines.push("");
  lines.push(`1. Canvas: ${recipe.formats.join(", ")} (resizes are the same candidate, not new concepts).`);
  lines.push(`2. Background: \`${recipe.base.background}\` from the approved brand kit tokens.`);
  lines.push(`3. Place the authentic packshot \`${recipe.base.packshot_sha256.slice(0, 12)}…\` unaltered (scale only, aspect preserved; never redraw or regenerate the label).`);
  lines.push(`4. Layout \`${recipe.base.layout}\`: headline block opposite/above the pack per the archetype.`);
  lines.push(`5. Headline (max ${recipe.text_limits.headline_max_lines} lines): “${recipe.base.headline.text}”${recipe.base.headline.claim_id ? ` [claim ${recipe.base.headline.claim_id}]` : " [UNAPPROVED]"}`);
  if (recipe.base.subhead) lines.push(`6. Subhead: “${recipe.base.subhead.text}”`);
  if (recipe.base.badge) lines.push(`7. Badge/offer: “${recipe.base.badge.text}”`);
  lines.push(`8. CTA in \`${recipe.base.palette}\`: “${recipe.base.cta.text}”`);
  lines.push("");
  lines.push("## 4. Fixed and variable factors");
  lines.push("");
  lines.push(`- **Fixed:** ${recipe.fixed.join(", ") || "none"}`);
  const variable = (Object.keys(recipe.options) as (keyof RecipeSpec["options"])[]).filter((k) => recipe.options[k].length > 0 && !recipe.fixed.includes(k));
  lines.push(`- **Variable:** ${variable.map((k) => `${k} (${recipe.options[k].length})`).join(", ") || "none"}`);
  lines.push("");
  lines.push("## 5. QA before review");
  lines.push("");
  lines.push("- Dimensions match the format; packshot bytes match the context manifest; packshot fully in frame.");
  lines.push("- Text fits its block; nothing inside the safe margin; headline contrast ≥ 4.5:1.");
  lines.push("- Every headline/subhead/badge/CTA traces to an approved claim id; no fixture copy.");
  lines.push("");
  lines.push("## 6. Review");
  lines.push("");
  lines.push("A configured reviewer approves or rejects this SOP and recipe version. Generated candidates are reviewed individually; approval of the SOP does not approve any candidate.");
  if (recipe.source_notes.length) {
    lines.push("", "## Source notes", "", ...recipe.source_notes.map((n) => `- ${n}`));
  }
  return lines.join("\n") + "\n";
}
