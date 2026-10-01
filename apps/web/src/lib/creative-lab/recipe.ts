/**
 * Structured poster recipe (ADR-0010 §7). A recipe is the machine half of
 * a reviewed reconstruction: the Markdown SOP (sop.ts) is the human half.
 *
 * Factors are the vocabulary the planner varies and the learning loop
 * reasons about. A recipe declares which factors are FIXED (brand rules,
 * packshot authenticity) and the candidate values for the VARIABLE ones.
 * Copy values must come from approved claims/copy — the recipe references
 * them, it does not invent them.
 */

export const FACTORS = [
  "headline",
  "subhead",
  "badge",
  "cta",
  "background",
  "layout",
  "packshot",
  "palette",
] as const;
export type Factor = (typeof FACTORS)[number];

export const COPY_FACTORS: readonly Factor[] = ["headline", "subhead", "badge", "cta"];
export const STRUCTURAL_FACTORS: readonly Factor[] = ["background", "layout", "packshot", "palette"];

export type LayoutKey = "hero_right" | "hero_left" | "hero_center";
export const LAYOUTS: readonly LayoutKey[] = ["hero_right", "hero_left", "hero_center"];

/** Output formats. A resize is the SAME candidate in another format, never a new concept. */
export type FormatKey = "1:1" | "4:5" | "9:16";
export const FORMAT_SIZES: Record<FormatKey, { width: number; height: number }> = {
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
};

/** Background spec: brand colour fills, or a provider-generated supporting image. */
export type BackgroundKey = `solid:${string}` | `gradient:${string}-${string}` | `generated:${string}`;

/** One approved text the recipe may use, with its source claim id. */
export interface CopyOption {
  text: string;
  claim_id: number | null; // null only for fixture copy, which QA flags
  fixture?: boolean;
}

export interface RecipeSpec {
  name: string;
  base: {
    layout: LayoutKey;
    background: BackgroundKey;
    palette: string; // token colour key used for emphasis (e.g. "primary")
    packshot_sha256: string;
    headline: CopyOption;
    subhead: CopyOption | null;
    badge: CopyOption | null;
    cta: CopyOption;
  };
  /** Candidate values for variable factors (beyond the base). */
  options: {
    headline: CopyOption[];
    subhead: CopyOption[];
    badge: CopyOption[];
    cta: CopyOption[];
    background: BackgroundKey[];
    layout: LayoutKey[];
    packshot: string[]; // packshot sha256s (authentic assets only)
    palette: string[];
  };
  fixed: Factor[];
  formats: FormatKey[];
  text_limits: { headline_max_lines: number; subhead_max_lines: number };
  /** Observations from the source analysis this recipe reconstructs. */
  source_notes: string[];
}

export interface RecipeIssue {
  path: string;
  message: string;
}

export function validateRecipe(r: RecipeSpec): RecipeIssue[] {
  const issues: RecipeIssue[] = [];
  if (!r.name.trim()) issues.push({ path: "name", message: "required" });
  if (!/^[0-9a-f]{64}$/.test(r.base.packshot_sha256)) {
    issues.push({ path: "base.packshot_sha256", message: "must be the SHA-256 of an imported packshot" });
  }
  for (const s of r.options.packshot) {
    if (!/^[0-9a-f]{64}$/.test(s)) issues.push({ path: "options.packshot", message: `not a sha256: ${s}` });
  }
  if (!LAYOUTS.includes(r.base.layout)) issues.push({ path: "base.layout", message: "unknown layout" });
  if (r.formats.length === 0) issues.push({ path: "formats", message: "at least one output format" });
  if (!r.base.headline.text.trim()) issues.push({ path: "base.headline", message: "required" });
  if (!r.fixed.includes("packshot") && r.options.packshot.length === 0) {
    issues.push({ path: "options.packshot", message: "packshot must be fixed or offer authentic alternatives" });
  }
  for (const f of r.fixed) {
    if (!FACTORS.includes(f)) issues.push({ path: "fixed", message: `unknown factor ${f}` });
  }
  return issues;
}
