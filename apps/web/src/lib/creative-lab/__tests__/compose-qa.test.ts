import assert from "node:assert/strict";
import { test } from "node:test";
import { composePoster, contrastRatio, fitText } from "../compose";
import { buildFixtureContext, FIXTURE_TOKENS } from "../fixtures";
import { sha256Hex } from "../hash";
import { planBatch } from "../planner";
import { qaPassed, runPosterQa } from "../qa";

async function firstSpec() {
  const fx = await buildFixtureContext();
  const p = await planBatch({ recipe: fx.recipe, recipeVersionId: 1, manifestSha256: fx.manifestSha256, exploreHypotheses: fx.hypotheses, estimatedCostPerCandidate: 0 });
  return { fx, spec: p.families[0].variants[0].spec };
}

test("composition is byte-deterministic", async () => {
  const { fx, spec } = await firstSpec();
  const a = composePoster({ spec, format: "4:5", tokens: FIXTURE_TOKENS, packshot: fx.packshots[0] });
  const b = composePoster({ spec, format: "4:5", tokens: FIXTURE_TOKENS, packshot: fx.packshots[0] });
  assert.equal(await sha256Hex(a.svg), await sha256Hex(b.svg));
});

test("packshot is placed by reference with its sha and aspect ratio preserved", async () => {
  const { fx, spec } = await firstSpec();
  const r = composePoster({ spec, format: "1:1", tokens: FIXTURE_TOKENS, packshot: fx.packshots[0] });
  assert.equal(r.svg.match(/data-role="packshot"/g)!.length, 1);
  assert.ok(r.svg.includes(`data-asset-sha256="${fx.packshots[0].sha256}"`));
  assert.ok(Math.abs(r.packshotBox.w / r.packshotBox.h - 600 / 900) < 0.01);
});

test("text is escaped and editable", async () => {
  const { fx, spec } = await firstSpec();
  const r = composePoster({ spec: { ...spec, headline: { text: `Fish & <Chips> "now"`, claim_id: 1 } }, format: "4:5", tokens: FIXTURE_TOKENS, packshot: fx.packshots[0] });
  for (const piece of ["Fish", "&amp;", "&lt;Chips&gt;", "&quot;now&quot;"]) assert.ok(r.svg.includes(piece), piece);
  assert.ok(!r.svg.includes("<Chips>"));
  assert.ok(r.svg.includes('<text data-slot="headline"'));
});

test("fitText shrinks, then reports overflow", () => {
  const box = { x: 0, y: 0, w: 400, h: 200 };
  assert.equal(fitText("Short", box, 2, 80, 30).fits, true);
  const long = fitText("word ".repeat(80), box, 2, 80, 30);
  assert.equal(long.fits, false);
  assert.equal(long.fontSize, 30);
});

test("QA fails fixture copy and watermark by design", async () => {
  const { fx, spec } = await firstSpec();
  const r = composePoster({ spec, format: "4:5", tokens: FIXTURE_TOKENS, packshot: fx.packshots[0], fixtureWatermark: true });
  const checks = runPosterQa(r, { manifestAssetShas: new Set(fx.packshots.map((p) => p.sha256)), approvedClaimIds: new Set() });
  const failed = checks.filter((c) => !c.passed).map((c) => c.key).sort();
  assert.deepEqual(failed, ["copy_approved", "not_fixture"]);
});

test("QA passes approved copy and rejects a packshot outside the manifest", async () => {
  const { fx, spec } = await firstSpec();
  const approved = { ...spec, headline: { text: "Approved headline", claim_id: 11 }, subhead: { text: "Approved reason", claim_id: 12 }, badge: { text: "Offer", claim_id: 13 }, cta: { text: "Shop now", claim_id: 14 } };
  const r = composePoster({ spec: approved, format: "4:5", tokens: FIXTURE_TOKENS, packshot: fx.packshots[0] });
  const ok = runPosterQa(r, { manifestAssetShas: new Set([fx.packshots[0].sha256]), approvedClaimIds: new Set([11, 12, 13, 14]) });
  assert.ok(qaPassed(ok), JSON.stringify(ok.filter((c) => !c.passed)));
  const bad = runPosterQa(r, { manifestAssetShas: new Set([fx.packshots[1].sha256]), approvedClaimIds: new Set([11, 12, 13, 14]) });
  assert.equal(bad.find((c) => c.key === "packshot_authentic")!.passed, false);
});

test("contrast ratio matches WCAG reference values", () => {
  assert.equal(Math.round(contrastRatio("#000000", "#FFFFFF")), 21);
  assert.equal(Math.round(contrastRatio("#777777", "#FFFFFF") * 10) / 10, 4.5);
});
