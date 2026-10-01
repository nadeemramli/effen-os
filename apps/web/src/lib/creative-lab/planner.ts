/**
 * Batch planner, method `batch-plan-v1` (ADR-0010 §7).
 *
 * Turns one approved recipe into N candidates organised as families of
 * `familySize`, split across three lanes by a configurable mix (default
 * 60 exploit / 30 adjacent / 10 explore → 12 / 6 / 2 families of five).
 *
 *   exploit   keep the winning structure; vary ONE copy factor per family
 *   adjacent  keep the copy; vary ONE structural factor per family
 *   explore   a stated new hypothesis; vary two or more factors together
 *
 * Every family records what changed and what was held fixed, so a later
 * result can be read against a controlled difference. Resizes are
 * `formats` of the same candidate, never extra slots. Identical specs are
 * never two candidates (input_sha256 is unique per batch, also enforced
 * in SQL).
 *
 * Slot order is the pilot order: slot k belongs to family k mod F, so the
 * first 5 slots span lanes, the first 20 touch every family once, and the
 * cumulative 5 → 20 → 100 gates each see the broadest spread available.
 *
 * Pools smaller than a family need are NOT padded with invented values:
 * the planner reports a shortfall with the factor that ran out.
 */
import { canonicalJson, sha256Hex } from "./hash";
import {
  COPY_FACTORS,
  STRUCTURAL_FACTORS,
  type CopyOption,
  type Factor,
  type FormatKey,
  type LayoutKey,
  type RecipeSpec,
} from "./recipe";
import type { Lane } from "./types";

export const PLAN_METHOD_VERSION = "batch-plan-v1";

export interface PlanMix {
  exploit: number;
  adjacent: number;
  explore: number;
}

export const DEFAULT_MIX: PlanMix = { exploit: 60, adjacent: 30, explore: 10 };
export const DEFAULT_STAGES = [5, 20, 100];

export interface ExploreHypothesis {
  hypothesis: string;
  /** factor → values to combine; at least two factors */
  changes: Partial<Record<Factor, (string | CopyOption)[]>>;
}

export interface PlanInput {
  recipe: RecipeSpec;
  recipeVersionId: number | null;
  manifestSha256: string;
  count?: number; // default 100
  familySize?: number; // default 5
  mix?: PlanMix;
  stages?: number[];
  exploreHypotheses?: ExploreHypothesis[];
  estimatedCostPerCandidate: number;
  maxAttempts?: number;
}

export interface VariantSpec {
  recipe_version_id: number | null;
  family_index: number;
  lane: Lane;
  layout: LayoutKey;
  background: string;
  palette: string;
  packshot_sha256: string;
  headline: CopyOption;
  subhead: CopyOption | null;
  badge: CopyOption | null;
  cta: CopyOption;
  formats: FormatKey[];
  changed: Partial<Record<Factor, string>>;
}

export interface PlannedVariant {
  slot_index: number;
  input_sha256: string;
  spec: VariantSpec;
}

export interface PlannedFamily {
  index: number;
  lane: Lane;
  hypothesis: string;
  /** factors held at a non-base value for the whole family (fixed within it) */
  context: Partial<Record<Factor, string>>;
  changed_factors: Factor[];
  fixed_factors: Factor[];
  variants: PlannedVariant[];
}

export interface Shortfall {
  family_index: number;
  lane: Lane;
  factor: string;
  needed: number;
  available: number;
}

export interface BatchPlan {
  method_version: string;
  mix: PlanMix;
  stages: number[];
  family_size: number;
  requested: number;
  planned: number;
  estimated_cost_per_candidate: number;
  estimated_total_cost: number;
  max_attempts: number;
  families: PlannedFamily[];
  shortfalls: Shortfall[];
}

/** Largest-remainder split of `families` across lanes by percentage mix. */
export function familiesPerLane(families: number, mix: PlanMix): Record<Lane, number> {
  const total = mix.exploit + mix.adjacent + mix.explore;
  if (total <= 0) throw new Error("plan mix must be positive");
  const lanes: Lane[] = ["exploit", "adjacent", "explore"];
  const raw = lanes.map((l) => (families * mix[l]) / total);
  const out = raw.map(Math.floor);
  let left = families - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, rem: r - Math.floor(r) })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const o of order) {
    if (left <= 0) break;
    out[o.i] += 1;
    left -= 1;
  }
  return { exploit: out[0], adjacent: out[1], explore: out[2] };
}

const optionKey = (v: string | CopyOption | null): string =>
  v == null ? "∅" : typeof v === "string" ? v : v.text;

function baseSpec(r: RecipeSpec, recipeVersionId: number | null, familyIndex: number, lane: Lane): VariantSpec {
  return {
    recipe_version_id: recipeVersionId,
    family_index: familyIndex,
    lane,
    layout: r.base.layout,
    background: r.base.background,
    palette: r.base.palette,
    packshot_sha256: r.base.packshot_sha256,
    headline: r.base.headline,
    subhead: r.base.subhead,
    badge: r.base.badge,
    cta: r.base.cta,
    formats: [...r.formats],
    changed: {},
  };
}

function poolFor(r: RecipeSpec, f: Factor): (string | CopyOption)[] {
  const base = r.base[f === "packshot" ? "packshot_sha256" : f] as string | CopyOption | null;
  const seen = new Set([optionKey(base)]);
  const out: (string | CopyOption)[] = [];
  for (const v of r.options[f] as (string | CopyOption)[]) {
    const k = optionKey(v);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(v);
    }
  }
  return out;
}

/** Identity of what will actually render — `changed` is bookkeeping, not content. */
function contentKey(s: VariantSpec): string {
  return canonicalJson({ ...s, changed: undefined, family_index: undefined, lane: undefined });
}

function applyFactor(spec: VariantSpec, f: Factor, v: string | CopyOption, base?: string | CopyOption | null): VariantSpec {
  const changed = { ...spec.changed };
  // setting a factor back to the recipe's base value is not a change
  if (base !== undefined && optionKey(base) === optionKey(v)) delete changed[f];
  else changed[f] = optionKey(v);
  const next = { ...spec, changed };
  switch (f) {
    case "packshot":
      next.packshot_sha256 = v as string;
      break;
    case "layout":
      next.layout = v as LayoutKey;
      break;
    case "background":
      next.background = v as string;
      break;
    case "palette":
      next.palette = v as string;
      break;
    default:
      next[f] = v as CopyOption;
  }
  return next;
}

export async function planBatch(input: PlanInput): Promise<BatchPlan> {
  const count = input.count ?? 100;
  const size = input.familySize ?? 5;
  const mix = input.mix ?? DEFAULT_MIX;
  const stages = (input.stages ?? DEFAULT_STAGES).filter((s) => s > 0 && s <= count);
  if (count % size !== 0) throw new Error(`count ${count} must be a multiple of family size ${size}`);
  if (!stages.includes(count)) stages.push(count);
  const r = input.recipe;
  const perLane = familiesPerLane(count / size, mix);

  // varied factors per lane, rotating; fixed factors are never varied
  const exploitFactors = COPY_FACTORS.filter((f) => !r.fixed.includes(f) && poolFor(r, f).length > 0);
  const adjacentFactors = STRUCTURAL_FACTORS.filter((f) => !r.fixed.includes(f) && poolFor(r, f).length > 0);

  type Draft = Omit<PlannedFamily, "variants"> & { specs: VariantSpec[] };
  const drafts: Draft[] = [];
  const shortfalls: Shortfall[] = [];
  const usedSpecs = new Set<string>();
  const cursor = new Map<Factor, number>();


  const pushFamily = (lane: Lane, hypothesis: string, changed: Factor[], specs: VariantSpec[], context: Partial<Record<Factor, string>> = {}) => {
    const index = drafts.length;
    const unique: VariantSpec[] = [];
    for (const s of specs) {
      const key = contentKey(s);
      if (usedSpecs.has(key)) continue;
      usedSpecs.add(key);
      unique.push({ ...s, family_index: index, lane });
    }
    if (unique.length < size) {
      shortfalls.push({ family_index: index, lane, factor: changed.join("+"), needed: size, available: unique.length });
    }
    drafts.push({
      index,
      lane,
      hypothesis,
      context,
      changed_factors: changed,
      fixed_factors: (["headline", "subhead", "badge", "cta", "background", "layout", "packshot", "palette"] as Factor[]).filter(
        (f) => !changed.includes(f),
      ),
      specs: unique.slice(0, size),
    });
  };

  /**
   * Single-factor families. The k-th family on factor f varies f; from the
   * second family on f, one OTHER factor of the same lane is held at a
   * different context value for the whole family (fixed within it), so
   * families on the same factor are distinct tests rather than repeats,
   * and the recipe's base value of f becomes a legitimate variant again.
   * A factor whose pool cannot fill a family on its own (e.g. 3 layouts)
   * is crossed with a second factor and BOTH are declared as changed.
   */
  const usesOf = new Map<Factor, number>();
  const keyOf = contentKey;
  const baseValue = (f: Factor) => r.base[f === "packshot" ? "packshot_sha256" : f] as string | CopyOption | null;
  const singleFactorFamilies = (lane: Lane, factors: Factor[], n: number) => {
    for (let i = 0; i < n; i++) {
      if (factors.length === 0) {
        shortfalls.push({ family_index: drafts.length, lane, factor: "no variable factor with options", needed: size, available: 0 });
        drafts.push({ index: drafts.length, lane, hypothesis: "unplannable", changed_factors: [], fixed_factors: [], context: {}, specs: [] });
        continue;
      }
      const f = factors[i % factors.length];
      const k = usesOf.get(f) ?? 0;
      usesOf.set(f, k + 1);
      const others = factors.filter((g) => g !== f);
      const pool = poolFor(r, f);
      const start = cursor.get(f) ?? 0;
      const rotated = pool.map((_, j) => pool[(start + j) % pool.length]);
      const bv = baseValue(f);

      // Build the family under one context; returns unique specs (≤ size).
      const build = (ctxFactor: Factor | null, ctxValue: string | CopyOption | null) => {
        let base = baseSpec(r, input.recipeVersionId, 0, lane);
        const context: Partial<Record<Factor, string>> = {};
        if (ctxFactor && ctxValue != null) {
          base = applyFactor(base, ctxFactor, ctxValue);
          context[ctxFactor] = optionKey(ctxValue);
        }
        const values = ctxFactor && bv != null ? [...rotated, bv] : rotated;
        let changed: Factor[] = [f];
        let grid: VariantSpec[] = values.map((v) => applyFactor(base, f, v, bv));
        if (values.length < size && others.length > 0) {
          // cross with a second factor rather than pad with invented values
          const g = others.find((x) => x !== ctxFactor) ?? others[0];
          const gv = [baseValue(g), ...poolFor(r, g)].filter((x): x is string | CopyOption => x != null);
          changed = [f, g];
          // diagonal order spreads the family over both factors
          const cells: VariantSpec[] = [];
          for (let d = 0; d < values.length + gv.length; d++) {
            for (let a = 0; a <= d; a++) {
              const b = d - a;
              if (a < values.length && b < gv.length) cells.push(applyFactor(applyFactor(base, f, values[a], bv), g, gv[b], baseValue(g)));
            }
          }
          grid = cells;
        }
        const specs: VariantSpec[] = [];
        let used = 0;
        for (const sp of grid) {
          if (specs.length >= size) break;
          used += 1;
          const key = keyOf(sp);
          if (usedSpecs.has(key) || specs.some((x) => keyOf(x) === key)) continue;
          specs.push(sp);
        }
        return { specs, changed, context, used };
      };

      // preferred context rotates with k; if it collides with earlier
      // families, search other contexts deterministically before reporting
      // a shortfall
      const tries: Array<[Factor | null, string | CopyOption | null]> = [];
      if (k === 0) tries.push([null, null]);
      for (let o = 0; o < others.length; o++) {
        const g = others[(k - 1 + o + others.length) % others.length];
        const gp = poolFor(r, g);
        for (let q = 0; q < gp.length; q++) tries.push([g, gp[(Math.floor(Math.max(k - 1, 0) / others.length) + q) % gp.length]]);
      }
      if (tries.length === 0) tries.push([null, null]);
      let best = build(tries[0][0], tries[0][1]);
      for (const [g, v] of tries.slice(1)) {
        if (best.specs.length >= size) break;
        const alt = build(g, v);
        if (alt.specs.length > best.specs.length) best = alt;
      }
      const { specs, changed, context, used } = best;
      cursor.set(f, (start + Math.min(used, pool.length)) % Math.max(pool.length, 1));
      const ctx = Object.entries(context).map(([g, v]) => `${g} held at "${v}"`).join(", ");
      const what = changed.join(" × ");
      const why =
        (lane === "exploit"
          ? `Hold the winning ${r.base.layout} structure; does a different ${what} move results?`
          : `Hold approved copy; does a different ${what} widen reach without losing efficiency?`) + (ctx ? ` (${ctx})` : "");
      pushFamily(lane, why, changed, specs, context);
    }
  };

  singleFactorFamilies("exploit", exploitFactors, perLane.exploit);
  singleFactorFamilies("adjacent", adjacentFactors, perLane.adjacent);

  const hyps = input.exploreHypotheses ?? [];
  for (let i = 0; i < perLane.explore; i++) {
    const h = hyps[i];
    if (!h || Object.keys(h.changes).length < 2) {
      shortfalls.push({ family_index: drafts.length, lane: "explore", factor: "explore hypothesis (≥2 factors) not supplied", needed: size, available: 0 });
      drafts.push({ index: drafts.length, lane: "explore", hypothesis: h?.hypothesis ?? "missing hypothesis", changed_factors: [], fixed_factors: [], context: {}, specs: [] });
      continue;
    }
    const factors = Object.keys(h.changes) as Factor[];
    // full combination grid of the hypothesis' factors, sampled evenly so
    // the family spans the space instead of clustering on the first value
    let grid: VariantSpec[] = [baseSpec(r, input.recipeVersionId, 0, "explore")];
    for (const f of factors) {
      grid = grid.flatMap((g) => h.changes[f]!.map((v) => applyFactor(g, f, v, r.base[f === "packshot" ? "packshot_sha256" : f] as string | CopyOption | null)));
    }
    const specs: VariantSpec[] = [];
    for (let k = 0; k < Math.min(size, grid.length); k++) {
      specs.push(grid[Math.floor((k * grid.length) / Math.min(size, grid.length))]);
    }
    pushFamily("explore", h.hypothesis, factors, specs);
  }

  // interleave lanes for the pilot order: E E A E X E A ...
  const order = interleave(drafts);
  const families: PlannedFamily[] = [];
  const perFamily = new Map<number, PlannedVariant[]>();
  for (const d of drafts) perFamily.set(d.index, []);
  let slot = 0;
  for (let v = 0; v < size; v++) {
    for (const d of order) {
      const spec = d.specs[v];
      if (!spec) continue;
      perFamily.get(d.index)!.push({
        slot_index: slot++,
        input_sha256: await sha256Hex(canonicalJson({ manifest: input.manifestSha256, spec })),
        spec,
      });
    }
  }
  for (const d of drafts) {
    families.push({
      index: d.index,
      lane: d.lane,
      hypothesis: d.hypothesis,
      context: d.context,
      changed_factors: d.changed_factors,
      fixed_factors: d.fixed_factors,
      variants: perFamily.get(d.index)!,
    });
  }
  const planned = slot;
  return {
    method_version: PLAN_METHOD_VERSION,
    mix,
    stages: stages.map((s) => Math.min(s, planned)).filter((s, i, a) => s > 0 && a.indexOf(s) === i),
    family_size: size,
    requested: count,
    planned,
    estimated_cost_per_candidate: input.estimatedCostPerCandidate,
    estimated_total_cost: planned * input.estimatedCostPerCandidate,
    max_attempts: input.maxAttempts ?? 3,
    families,
    shortfalls,
  };
}

function interleave<T extends { lane: Lane }>(families: T[]): T[] {
  const lanes: Record<Lane, T[]> = { exploit: [], adjacent: [], explore: [] };
  for (const f of families) lanes[f.lane].push(f);
  const total = families.length;
  const out: T[] = [];
  // weighted round-robin keeps each prefix close to the overall mix
  const taken: Record<Lane, number> = { exploit: 0, adjacent: 0, explore: 0 };
  while (out.length < total) {
    let best: Lane | null = null;
    let bestDeficit = -Infinity;
    for (const l of ["explore", "adjacent", "exploit"] as Lane[]) {
      if (taken[l] >= lanes[l].length) continue;
      const deficit = ((out.length + 1) * lanes[l].length) / total - taken[l];
      if (deficit > bestDeficit) {
        bestDeficit = deficit;
        best = l;
      }
    }
    out.push(lanes[best!][taken[best!]++]);
  }
  return out;
}

/** Plan → the jsonb payload public.creative_create_batch expects. */
export function toBatchPayload(plan: BatchPlan) {
  return {
    method_version: plan.method_version,
    mix: plan.mix,
    stages: plan.stages,
    estimated_cost_per_candidate: plan.estimated_cost_per_candidate,
    max_attempts: plan.max_attempts,
    families: plan.families
      .filter((f) => f.variants.length > 0)
      .map((f) => ({
        index: f.index,
        lane: f.lane,
        hypothesis: f.hypothesis,
        context: f.context,
        changed_factors: f.changed_factors,
        fixed_factors: f.fixed_factors,
        variants: f.variants.map((v) => ({ slot_index: v.slot_index, input_sha256: v.input_sha256, spec: v.spec })),
      })),
  };
}
