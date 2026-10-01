import assert from "node:assert/strict";
import { test } from "node:test";
import { FIXTURE_LEADERBOARD } from "../fixtures";
import { PROVISIONAL_RANKING_PARAMS, rankImages } from "../ranking";

test("cohorts never mix markets, currencies or attribution settings", () => {
  const r = rankImages(FIXTURE_LEADERBOARD);
  const ids = r.cohorts.map((c) => c.cohortId);
  assert.equal(ids.length, 3);
  for (const c of r.cohorts) {
    const keys = new Set([...c.ranked, ...c.ineligible].map((x) => x.cohortId));
    assert.equal(keys.size, 1);
    for (const x of [...c.ranked, ...c.ineligible]) {
      assert.equal(x.row.market, c.cohort.market);
      assert.equal(x.row.currency_code, c.cohort.currency_code);
      assert.equal(x.row.attribution_setting, c.cohort.attribution_setting);
    }
  }
});

test("unknown attribution is ineligible, not ranked", () => {
  const r = rankImages(FIXTURE_LEADERBOARD);
  const unk = r.cohorts.find((c) => c.cohort.attribution_setting === "UNKNOWN")!;
  assert.equal(unk.ranked.length, 0);
  assert.deepEqual(unk.ineligible[0].reasons, ["unknown_cohort_field"]);
});

test("small samples and immature data are listed with reasons", () => {
  const my = rankImages(FIXTURE_LEADERBOARD).cohorts.find((c) => c.cohort.market === "MY" && c.cohort.attribution_setting !== "UNKNOWN")!;
  const reasons = Object.fromEntries(my.ineligible.map((x) => [x.row.image_hash, x.reasons]));
  assert.deepEqual(reasons.fx05ebf7, ["below_min_spend", "below_min_purchases"]);
  assert.deepEqual(reasons.fx06fc08, ["immature_data"]);
  assert.deepEqual(my.ranked.map((x) => x.rank), [1, 2, 3, 4]);
});

test("shrinkage pulls a lucky tiny-spend image toward its cohort; thresholds keep it unranked", () => {
  const loose = { ...PROVISIONAL_RANKING_PARAMS, minSpend: 0, minPurchases: 0, maxMaturingShare: 1 };
  const my = rankImages(FIXTURE_LEADERBOARD, loose).cohorts.find((c) => c.cohort.market === "MY" && c.cohort.attribution_setting !== "UNKNOWN")!;
  const lucky = my.ranked.find((x) => x.row.image_hash === "fx05ebf7")!;
  const solid = my.ranked.find((x) => x.row.image_hash === "fx01a7c3")!;
  assert.ok(lucky.roas > 11, "raw ROAS is spectacular on 3 purchases");
  assert.ok(lucky.shrunkRoas < lucky.roas / 2, "most of the gap is attributed to noise");
  assert.ok(solid.roas - solid.shrunkRoas < 0.1, "a large sample barely moves");
  const strict = rankImages(FIXTURE_LEADERBOARD).cohorts.find((c) => c.cohortId === my.cohortId)!;
  assert.ok(!strict.ranked.some((x) => x.row.image_hash === "fx05ebf7"));
});

test("pooled baseline includes ineligible rows; tiers are relative to the cohort", () => {
  const my = rankImages(FIXTURE_LEADERBOARD).cohorts.find((c) => c.cohort.market === "MY" && c.cohort.attribution_setting !== "UNKNOWN")!;
  assert.equal(my.pooledSpend, 4200 + 3900 + 2600 + 1800 + 140 + 900);
  assert.equal(my.ranked.at(-1)!.tier, "below_cohort");
  assert.ok(my.ranked.every((x, i, a) => i === 0 || a[i - 1].shrunkRoas >= x.shrunkRoas));
});

test("ranking is deterministic and records its method", () => {
  const a = rankImages(FIXTURE_LEADERBOARD);
  const b = rankImages([...FIXTURE_LEADERBOARD].reverse());
  assert.equal(a.methodVersion, "image-rank-v1");
  assert.deepEqual(
    a.cohorts.map((c) => c.ranked.map((x) => x.row.image_hash)),
    b.cohorts.map((c) => c.ranked.map((x) => x.row.image_hash)),
  );
});
