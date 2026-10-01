import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFixtureContext } from "../fixtures";
import { familiesPerLane, planBatch, toBatchPayload } from "../planner";
import { COPY_FACTORS, STRUCTURAL_FACTORS } from "../recipe";

async function plan100() {
  const fx = await buildFixtureContext();
  return planBatch({
    recipe: fx.recipe,
    recipeVersionId: 1,
    manifestSha256: fx.manifestSha256,
    exploreHypotheses: fx.hypotheses,
    estimatedCostPerCandidate: 0,
  });
}

test("lane split uses largest remainder", () => {
  assert.deepEqual(familiesPerLane(20, { exploit: 60, adjacent: 30, explore: 10 }), { exploit: 12, adjacent: 6, explore: 2 });
  assert.deepEqual(familiesPerLane(7, { exploit: 60, adjacent: 30, explore: 10 }), { exploit: 4, adjacent: 2, explore: 1 });
  assert.deepEqual(familiesPerLane(1, { exploit: 0, adjacent: 0, explore: 1 }), { exploit: 0, adjacent: 0, explore: 1 });
});

test("100 candidates = 20 families of 5 at 60/30/10, no shortfall", async () => {
  const p = await plan100();
  assert.equal(p.planned, 100);
  assert.deepEqual(p.shortfalls, []);
  assert.equal(p.families.length, 20);
  assert.ok(p.families.every((f) => f.variants.length === 5));
  const lanes = p.families.reduce<Record<string, number>>((a, f) => ({ ...a, [f.lane]: (a[f.lane] ?? 0) + 5 }), {});
  assert.deepEqual(lanes, { exploit: 60, adjacent: 30, explore: 10 });
  assert.deepEqual(p.stages, [5, 20, 100]);
});

test("inputs are unique and slots are a permutation of 0..99", async () => {
  const p = await plan100();
  const v = p.families.flatMap((f) => f.variants);
  assert.equal(new Set(v.map((x) => x.input_sha256)).size, 100);
  assert.deepEqual(v.map((x) => x.slot_index).sort((a, b) => a - b), Array.from({ length: 100 }, (_, i) => i));
});

test("pilot prefixes are diverse: first 20 slots touch every family; first 5 span lanes", async () => {
  const p = await plan100();
  const bySlot = new Map(p.families.flatMap((f) => f.variants.map((v) => [v.slot_index, f] as const)));
  const first20 = new Set(Array.from({ length: 20 }, (_, i) => bySlot.get(i)!.index));
  assert.equal(first20.size, 20);
  const first5Lanes = new Set(Array.from({ length: 5 }, (_, i) => bySlot.get(i)!.lane));
  assert.ok(first5Lanes.size >= 2, `first 5 lanes: ${[...first5Lanes]}`);
});

test("changed and fixed factors are recorded and respected", async () => {
  const p = await plan100();
  for (const f of p.families) {
    assert.equal(f.changed_factors.filter((x) => f.fixed_factors.includes(x)).length, 0);
    for (const v of f.variants) {
      for (const k of Object.keys(v.spec.changed)) {
        assert.ok(f.changed_factors.includes(k as never) || k in f.context, `${k} not declared in family ${f.index}`);
      }
      for (const [k, val] of Object.entries(f.context)) assert.equal(v.spec.changed[k as never], val, "context is fixed within the family");
      assert.deepEqual(v.spec.formats, ["4:5", "1:1"], "resizes are formats, not slots");
    }
    if (f.lane === "exploit") assert.ok([...f.changed_factors, ...Object.keys(f.context)].every((x) => COPY_FACTORS.includes(x as never)));
    if (f.lane === "adjacent") assert.ok([...f.changed_factors, ...Object.keys(f.context)].every((x) => STRUCTURAL_FACTORS.includes(x as never)));
    if (f.lane === "explore") assert.ok(f.changed_factors.length >= 2);
  }
});

test("small pools report a shortfall instead of inventing values", async () => {
  const fx = await buildFixtureContext();
  const recipe = {
    ...fx.recipe,
    options: { ...fx.recipe.options, headline: fx.recipe.options.headline.slice(0, 2), subhead: [], badge: [], cta: [] },
  };
  const p = await planBatch({ recipe, recipeVersionId: 1, manifestSha256: fx.manifestSha256, exploreHypotheses: [], estimatedCostPerCandidate: 0.04 });
  assert.ok(p.shortfalls.some((s) => s.lane === "exploit" && s.factor === "headline" && s.available === 2));
  assert.ok(p.shortfalls.some((s) => s.lane === "explore"));
  assert.ok(p.planned < 100);
  assert.equal(p.estimated_total_cost, p.planned * 0.04);
  assert.ok(toBatchPayload(p).families.every((f) => f.variants.length > 0));
});

test("planning is deterministic", async () => {
  const [a, b] = [await plan100(), await plan100()];
  assert.deepEqual(a.families.flatMap((f) => f.variants.map((v) => v.input_sha256)), b.families.flatMap((f) => f.variants.map((v) => v.input_sha256)));
});
