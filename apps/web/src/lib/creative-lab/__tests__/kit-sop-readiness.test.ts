import assert from "node:assert/strict";
import { test } from "node:test";
import { validatePosterAnalysis } from "../analysis";
import { buildFixtureContext } from "../fixtures";
import { sha256Hex } from "../hash";
import { buildKitPayload, parseChecksums, pngSize } from "../kit";
import { readinessOf } from "../readiness";
import { validateRecipe } from "../recipe";
import { renderSop } from "../sop";
import type { BrandReadinessRow } from "../types";

function fakePng(w: number, h: number, salt: number): Uint8Array {
  const b = new Uint8Array(40);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const dv = new DataView(b.buffer);
  dv.setUint32(16, w);
  dv.setUint32(20, h);
  b[39] = salt;
  return b;
}
const enc = (s: string) => new TextEncoder().encode(s);

test("pngSize reads IHDR and rejects non-PNG", () => {
  assert.deepEqual(pngSize(fakePng(1200, 1500, 1)), { width: 1200, height: 1500 });
  assert.equal(pngSize(enc("not a png at all, definitely")), null);
});

test("checksum manifests parse sha256sum formats", () => {
  const m = parseChecksums(`${"a".repeat(64)}  raw-materials/a.png\n${"B".repeat(64)} *./b.png\njunk`);
  assert.equal(m.get("raw-materials/a.png"), "a".repeat(64));
  assert.equal(m.get("b.png"), "b".repeat(64));
});

test("kit import verifies supplied checksums, dedupes bytes, stays draft-shaped and idempotent", async () => {
  const a = fakePng(1000, 1000, 1);
  const b = fakePng(800, 1200, 2);
  const sums = `${await sha256Hex(a)}  front.png\n${"0".repeat(64)}  side.png\n`;
  const files = [
    { path: "tokens.json", bytes: enc(JSON.stringify({ colors: { primary: "#112233" } })) },
    { path: "guidelines.md", bytes: enc("# Guidelines") },
    { path: "raw-materials/front.png", bytes: a },
    { path: "raw-materials/side.png", bytes: b },
    { path: "raw-materials/front-copy.png", bytes: a },
    { path: "raw-materials/SHA256SUMS", bytes: enc(sums) },
    { path: "notes.txt", bytes: enc("x") },
  ];
  const r = await buildKitPayload({ brandSlug: "adipocyde", sourceRoot: "creative/adipocyde", files });
  assert.equal(r.verified, 1);
  assert.deepEqual(r.mismatches.map((m) => m.path), ["raw-materials/side.png"]);
  assert.ok(!r.payload.assets.some((x) => x.source_path === "raw-materials/side.png"), "mismatched file never imported");
  assert.equal(r.duplicates.length, 1);
  assert.equal(r.payload.completeness, "detailed");
  assert.equal(r.payload.provenance, "website_derived");
  assert.ok(r.payload.assets.every((x) => x.role === "packshot" && x.storage_ref === null));
  assert.equal(r.payload.assets[0].width, 1000);
  const again = await buildKitPayload({ brandSlug: "adipocyde", sourceRoot: "creative/adipocyde", files: [...files].reverse() });
  assert.equal(again.payload.manifest_sha256, r.payload.manifest_sha256);
});

test("a kit without guidelines/tokens or packshots is incomplete and says why", async () => {
  const r = await buildKitPayload({ brandSlug: "synovil", sourceRoot: "creative/synovil", files: [{ path: "sources/site.png", bytes: fakePng(10, 10, 3) }] });
  assert.equal(r.payload.completeness, "incomplete");
  assert.equal(r.payload.provenance, "historical_identity");
  assert.ok(r.warnings.some((w) => w.includes("no packshots")));
  assert.equal(r.payload.assets[0].role, "reference");
});

test("fixture analysis and recipe validate; SOP carries evidence and fixture warning", async () => {
  const fx = await buildFixtureContext();
  assert.deepEqual(validatePosterAnalysis(fx.analysis), []);
  assert.deepEqual(validateRecipe(fx.recipe), []);
  const md = renderSop(fx.recipe, fx.analysis, {
    brand: "Adipocyde", market: "MY", cohort: "MY | MYR | OUTCOME_SALES", window: "2026-07-01..2026-09-20",
    method_version: "image-rank-v1", rank: 1, spend: 4200, currency: "MYR", purchases: 61, roas: 3.2, shrunk_roas: 3.0,
    maturing_share: 0, snapshot_id: null, fixture: true,
  });
  assert.match(md, /FIXTURE EVIDENCE — not real ad results/);
  assert.match(md, /not proof that its structure caused the result/);
  assert.match(md, /never redraw or regenerate the label/);
  assert.match(md, /\[UNAPPROVED\]/);
});

test("readiness lists every missing owner decision and never treats drafts as ready", () => {
  const base: BrandReadinessRow = {
    brand_id: 1, brand_slug: "adipocyde", brand_name: "Adipocyde", kit_version_id: 3, kit_version: 1, kit_status: "draft",
    kit_provenance: "website_derived", kit_completeness: "detailed", packshots: 9, kit_assets: 12, image_fact_rows: 0,
    facts_synced_at: null, missing_config: ["image_provider_model", "batch_budget", "target_economics"], batches: 0,
  };
  const v = readinessOf(base);
  assert.equal(v.stage, "kit_draft");
  assert.equal(v.canGenerate, false);
  assert.ok(v.blockers.some((b) => b.includes("owner approval required")));
  assert.ok(v.blockers.includes("Missing: Per-batch spend ceiling"));
  assert.equal(readinessOf({ ...base, kit_status: "approved" }).stage, "needs_config");
  const ready = readinessOf({ ...base, kit_status: "approved", missing_config: ["target_economics"] });
  assert.equal(ready.canGenerate, true);
  assert.equal(ready.canLaunch, false);
});
