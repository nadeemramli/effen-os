import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFixtureContext, FIXTURE_TOKENS, type FixtureContext } from "../fixtures";
import { MemoryJobQueue } from "../memory-queue";
import { planBatch, type BatchPlan } from "../planner";
import { createImageProvider, FixtureImageProvider, ProviderUnavailableError, type ImageProvider } from "../providers";
import type { CopyOption, RecipeSpec } from "../recipe";
import { runTick, type GenerationContext, type WorkerDeps } from "../worker";

/** Machinery-only context: copy carries claim ids so QA can pass; no real claims. */
async function cleanSetup(opts: { budget?: number; cost?: number; maxAttempts?: number } = {}) {
  const fx = await buildFixtureContext();
  let id = 100;
  const approve = (o: CopyOption): CopyOption =>
    o.text.startsWith("[Fixture offer") ? { text: `Save ${id}%`, claim_id: id++ } : { text: o.text.replace("[Fixture", "[Test-approved"), claim_id: id++ };
  const r = fx.recipe;
  const recipe: RecipeSpec = {
    ...r,
    base: { ...r.base, headline: approve(r.base.headline), subhead: approve(r.base.subhead!), badge: approve(r.base.badge!), cta: approve(r.base.cta) },
    options: { ...r.options, headline: r.options.headline.map(approve), subhead: r.options.subhead.map(approve), badge: r.options.badge.map(approve), cta: r.options.cta.map(approve) },
  };
  const hyps = fx.hypotheses.map((h) => ({
    ...h,
    changes: Object.fromEntries(Object.entries(h.changes).map(([k, vs]) => [k, vs!.map((v) => (typeof v === "string" ? v : recipe.options.headline.find((x) => x.text === approve(v).text) ?? approve(v)))])),
  }));
  const plan = await planBatch({ recipe, recipeVersionId: 1, manifestSha256: fx.manifestSha256, exploreHypotheses: hyps, estimatedCostPerCandidate: opts.cost ?? 0.05, maxAttempts: opts.maxAttempts ?? 3 });
  const claimIds = new Set<number>();
  for (const f of plan.families) for (const v of f.variants) for (const o of [v.spec.headline, v.spec.subhead, v.spec.badge, v.spec.cta]) if (o?.claim_id) claimIds.add(o.claim_id);
  const ctx: GenerationContext = {
    manifestSha256: fx.manifestSha256,
    tokens: FIXTURE_TOKENS,
    assets: new Map(fx.packshots.map((p) => [p.sha256, p])),
    approvedClaimIds: claimIds,
    disclaimer: null,
    maxCostPerCandidate: null,
    fixture: false,
  };
  return { fx, plan, ctx, budget: opts.budget ?? 100 };
}

function deps(queue: MemoryJobQueue, ctx: GenerationContext, provider: ImageProvider = new FixtureImageProvider(), workerId = "w1"): WorkerDeps {
  const blobs = new Map<string, Uint8Array>();
  return {
    workerId,
    queue,
    loadContext: async () => ctx,
    store: { put: async (bytes, _t, sha) => (blobs.set(sha, bytes), `mem://${sha}`) },
    provider,
  };
}

const newQueue = (plan: BatchPlan, budget: number, now?: () => number) =>
  new MemoryJobQueue(plan, { budget, contextManifestId: 1, provider: "fixture", model: "fixture-bg-v1", now });

function reviewAll(q: MemoryJobQueue) {
  for (const c of q.candidates) if (c.generation_status === "generated" && c.qa_status === "passed" && c.review_status === "pending") q.review(c.id, "approved");
}

test("pilot runs 5 → 20 → 100 with review gates and no duplicates", async () => {
  const { plan, ctx, budget } = await cleanSetup();
  const q = newQueue(plan, budget);
  const d = deps(q, ctx);
  await runTick(d, 50);
  assert.equal(q.batch.status, "awaiting_review");
  assert.equal(q.candidates.filter((c) => c.generation_status === "generated").length, 5);
  assert.ok(q.candidates.filter((c) => c.generation_status !== "queued").every((c) => c.slot_index < 5));
  assert.ok(q.candidates.slice(0, 5).every((c) => c.qa_status === "passed"), JSON.stringify(q.candidates.slice(0, 5).map((c) => c.qa.filter((x) => !x.passed))));
  assert.throws(() => q.advanceStage(), /creative_stage_unreviewed: 5/);
  reviewAll(q);
  q.advanceStage();
  await runTick(d, 50);
  assert.equal(q.batch.stage_limit, 20);
  reviewAll(q);
  q.advanceStage();
  while ((q.batch.status as string) === "running") await runTick(d, 25);
  assert.equal(q.batch.status, "completed");
  const outputs = q.candidates.map((c) => c.output_sha256);
  assert.equal(new Set(outputs).size, 100, "100 distinct output files");
  assert.equal(q.candidates.filter((c) => c.generation_status === "duplicate").length, 0);
});

test("budget reservation pauses the batch before overspending, then resumes", async () => {
  const { plan, ctx } = await cleanSetup({ cost: 1 });
  const q = newQueue(plan, 3.5);
  const d = deps(q, ctx);
  const r = await runTick(d, 10);
  assert.equal(r.claimed, 3);
  assert.equal(q.batch.status, "paused_budget");
  assert.ok(q.batch.spent + q.batch.reserved <= 3.5);
  assert.equal((await runTick(d, 10)).claimed, 0, "paused batch claims nothing");
  q.resume(10);
  await runTick(d, 10);
  assert.equal(q.batch.status, "awaiting_review");
});

test("a crashed worker's lease expires, counts as an attempt and its reservation is booked", async () => {
  const { plan, ctx } = await cleanSetup({ cost: 1 });
  let clock = 1_000_000;
  const q = newQueue(plan, 100, () => clock);
  const claimed = await q.claim("crashy", 1, 60); // claims but never reports
  assert.equal(claimed.length, 1);
  clock += 61_000;
  const d = deps(q, ctx, new FixtureImageProvider(), "w2");
  await runTick(d, 10);
  const job = q.jobs.find((j) => j.id === claimed[0].job_id)!;
  assert.equal(job.attempts, 2);
  assert.equal(job.status, "succeeded");
  assert.equal(q.batch.spent, 1, "the crashed call's reservation is booked as spent (fixture completions cost 0)");
  assert.equal(q.batch.reserved, 0);
  await assert.rejects(q.complete(job.id, "crashy", { output_sha256: "x".repeat(64), output_ref: "", provider: "", model: "", prompt: "", config: {}, cost_amount: 0 }));
});

test("provider failures retry up to max_attempts then fail the candidate", async () => {
  const { plan, ctx } = await cleanSetup({ maxAttempts: 2 });
  // make every slot need a generated background so the provider is called
  for (const f of plan.families) for (const v of f.variants) v.spec.background = "generated:test texture";
  const q = newQueue(plan, 100);
  const broken: ImageProvider = { id: "broken", model: "x", estimateCost: () => 0.01, generateBackground: async () => { throw new Error("HTTP 503"); } };
  const d = deps(q, ctx, broken);
  const r1 = await runTick(d, 5);
  assert.equal(r1.failed, 5);
  assert.ok(q.candidates.slice(0, 5).every((c) => c.generation_status === "queued"));
  await runTick(d, 5);
  assert.ok(q.candidates.slice(0, 5).every((c) => c.generation_status === "failed"));
  assert.equal(q.batch.status, "awaiting_review");
  assert.equal(q.batch.reserved, 0);
});

test("per-candidate cost cap is enforced before the provider is called", async () => {
  const { plan, ctx } = await cleanSetup();
  for (const f of plan.families) for (const v of f.variants) v.spec.background = "generated:test";
  const q = newQueue(plan, 100);
  let calls = 0;
  const pricey: ImageProvider = { id: "pricey", model: "x", estimateCost: () => 2, generateBackground: async () => { calls++; throw new Error("unreachable"); } };
  const r = await runTick(deps(q, { ...ctx, maxCostPerCandidate: 0.5 }, pricey), 5);
  assert.equal(calls, 0);
  assert.equal(r.failed, 5);
  assert.match(r.errors[0], /exceeds per-candidate cap/);
});

test("fixture output is watermarked and fails QA, so it cannot be approved", async () => {
  const fx: FixtureContext = await buildFixtureContext();
  const plan = await planBatch({ recipe: fx.recipe, recipeVersionId: null, manifestSha256: fx.manifestSha256, exploreHypotheses: fx.hypotheses, estimatedCostPerCandidate: 0 });
  const q = newQueue(plan, 0);
  const ctx: GenerationContext = { manifestSha256: fx.manifestSha256, tokens: FIXTURE_TOKENS, assets: new Map(fx.packshots.map((p) => [p.sha256, p])), approvedClaimIds: new Set(), disclaimer: null, maxCostPerCandidate: null, fixture: true };
  const r = await runTick(deps(q, ctx), 5);
  assert.equal(r.qaFailed, 5);
  assert.throws(() => q.review(q.candidates[0].id, "approved"), /creative_bad_state/);
});

test("unconfigured or unadapted providers fail with the precise blocked step", () => {
  assert.throws(() => createImageProvider({ image_provider: null, image_model: null, provider_data_approved: false }), ProviderUnavailableError);
  assert.throws(() => createImageProvider({ image_provider: "acme", image_model: "m1", provider_data_approved: false }), /provider_data_approved is false/);
  assert.throws(() => createImageProvider({ image_provider: "acme", image_model: "m1", provider_data_approved: true }), /no adapter implemented for "acme"/);
  assert.equal(createImageProvider({ image_provider: "fixture", image_model: "fixture-bg-v1", provider_data_approved: false }).id, "fixture");
});
