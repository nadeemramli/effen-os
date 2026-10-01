/**
 * No-paid-call fixture pipeline (ADR-0010 completion evidence).
 *
 *   pnpm dlx tsx scripts/creative/run-fixture-pipeline.mts --out <dir> [--stage 5|20|100]
 *
 * Exercises rank → analysis → recipe → SOP → 100-candidate plan →
 * worker (in-memory queue, fixture provider, zero cost) → composition →
 * QA for the first pilot stage, and writes every artefact to <dir>.
 * Output is watermarked FIXTURE and fails QA by design: it proves the
 * machinery, never a poster for launch.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildFixtureContext, FIXTURE_LEADERBOARD, FIXTURE_TOKENS } from "../../apps/web/src/lib/creative-lab/fixtures.ts";
import { MemoryJobQueue } from "../../apps/web/src/lib/creative-lab/memory-queue.ts";
import { planBatch, toBatchPayload } from "../../apps/web/src/lib/creative-lab/planner.ts";
import { FixtureImageProvider } from "../../apps/web/src/lib/creative-lab/providers.ts";
import { rankImages } from "../../apps/web/src/lib/creative-lab/ranking.ts";
import { renderSop } from "../../apps/web/src/lib/creative-lab/sop.ts";
import { runTick } from "../../apps/web/src/lib/creative-lab/worker.ts";

const args = process.argv.slice(2);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const out = opt("out") ?? "fixture-pipeline-out";
const stage = Number(opt("stage") ?? 5);
await mkdir(join(out, "candidates"), { recursive: true });

const ranking = rankImages(FIXTURE_LEADERBOARD);
await writeFile(join(out, "ranking.json"), JSON.stringify(ranking, null, 2));
const my = ranking.cohorts.find((c) => c.cohort.market === "MY" && c.ranked.length > 0)!;
const top = my.ranked[0];

const fx = await buildFixtureContext();
const sop = renderSop(fx.recipe, fx.analysis, {
  brand: "Adipocyde (fixture)",
  market: my.cohort.market,
  cohort: my.cohortId,
  window: `${top.row.first_date}..${top.row.last_date}`,
  method_version: ranking.methodVersion,
  rank: top.rank,
  spend: top.row.spend,
  currency: top.row.currency_code,
  purchases: top.row.purchases ?? 0,
  roas: top.roas,
  shrunk_roas: top.shrunkRoas,
  maturing_share: top.row.maturing_spend / top.row.spend,
  snapshot_id: null,
  fixture: true,
});
await writeFile(join(out, "sop.md"), sop);
await writeFile(join(out, "recipe.json"), JSON.stringify(fx.recipe, null, 2));

const plan = await planBatch({
  recipe: fx.recipe,
  recipeVersionId: null,
  manifestSha256: fx.manifestSha256,
  exploreHypotheses: fx.hypotheses,
  estimatedCostPerCandidate: 0,
});
await writeFile(join(out, "plan.json"), JSON.stringify(toBatchPayload(plan), null, 2));

const queue = new MemoryJobQueue(plan, { budget: 0, contextManifestId: 0, provider: "fixture", model: "fixture-bg-v1" });
const blobs = new Map<string, Uint8Array>();
const provider = new FixtureImageProvider();
const deps = {
  workerId: "fixture-worker",
  queue,
  provider,
  store: {
    put: async (bytes: Uint8Array, type: string, sha: string) => {
      blobs.set(sha, bytes);
      return type === "image/svg+xml" ? `data:image/svg+xml;utf8,${encodeURIComponent(new TextDecoder().decode(bytes))}` : `mem://${sha}`;
    },
  },
  loadContext: async () => ({
    manifestSha256: fx.manifestSha256,
    tokens: FIXTURE_TOKENS,
    assets: new Map(fx.packshots.map((p) => [p.sha256, p])),
    approvedClaimIds: new Set<number>(),
    disclaimer: null,
    maxCostPerCandidate: 0,
    fixture: true,
  }),
};
const reports = [];
while (queue.batch.status === "running" && queue.batch.stage_limit <= stage) {
  reports.push(await runTick(deps, 25));
  if (queue.batch.status === "awaiting_review" && queue.batch.stage_limit < stage) {
    // fixture candidates cannot be approved (QA fails by design); a fixture
    // run advances stages by recording rejections, exercising the gate only
    for (const c of queue.candidates) if (c.qa_status === "passed" && c.review_status === "pending") queue.review(c.id, "rejected");
    queue.advanceStage();
  }
}
for (const c of queue.candidates.filter((x) => x.output_sha256)) {
  const bytes = blobs.get(c.output_sha256!)!;
  await writeFile(join(out, "candidates", `slot-${String(c.slot_index).padStart(3, "0")}-${c.output_sha256!.slice(0, 10)}.svg`), bytes);
}
const summary = {
  label: "FIXTURE — machinery check only, not real ad results",
  plan: { planned: plan.planned, families: plan.families.length, stages: plan.stages, shortfalls: plan.shortfalls },
  batch: queue.batch,
  provider_calls: provider.calls,
  generated: queue.candidates.filter((c) => c.generation_status === "generated").length,
  qa_failed: queue.candidates.filter((c) => c.qa_status === "failed").length,
  qa_failures: [...new Set(queue.candidates.flatMap((c) => c.qa.filter((q) => !q.passed).map((q) => q.key)))],
  ticks: reports,
};
await writeFile(join(out, "summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, ticks: reports.length }, null, 2));
