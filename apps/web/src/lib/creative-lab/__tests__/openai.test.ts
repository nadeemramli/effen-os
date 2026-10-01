import assert from "node:assert/strict";
import { test } from "node:test";
import { buildFixtureContext, FIXTURE_TOKENS } from "../fixtures";
import { MemoryJobQueue } from "../memory-queue";
import {
  imageCost,
  OpenAIError,
  OpenAIImageProvider,
  OpenAIPosterAnalyzer,
  openAiImageSize,
  textCost,
  type FetchLike,
  type ProviderPricing,
} from "../openai";
import { planBatch } from "../planner";
import { createImageProvider, createPosterAnalyzer, ProviderUnavailableError } from "../providers";
import { runTick } from "../worker";

const KEY = "sk-test-NOT-A-REAL-KEY-0123456789";
const PRICING: ProviderPricing = { currency: "USD", image_estimate_per_call: 0.06, analysis_estimate_per_call: 0.02 };
const RATES: ProviderPricing = { ...PRICING, text_input_per_mtok: 5, text_output_per_mtok: 15, image_input_per_mtok: 8, image_output_per_mtok: 30 };
const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

interface Captured {
  url: string;
  init: RequestInit;
  body: Record<string, unknown>;
}

function fakeFetch(respond: (c: Captured) => { status: number; json: unknown }, log: Captured[] = []): FetchLike {
  return async (url, init) => {
    const c = { url, init, body: JSON.parse(String(init.body)) };
    log.push(c);
    const r = respond(c);
    return new Response(JSON.stringify(r.json), { status: r.status, headers: { "content-type": "application/json" } });
  };
}

test("size maps any canvas to a size every GPT Image model accepts", () => {
  assert.equal(openAiImageSize(1080, 1350), "1024x1536");
  assert.equal(openAiImageSize(1080, 1080), "1024x1024");
  assert.equal(openAiImageSize(1920, 1080), "1536x1024");
});

test("image request: text prompt only, bearer key, decoded PNG, cost from token usage", async () => {
  const log: Captured[] = [];
  const p = new OpenAIImageProvider({
    apiKey: KEY,
    model: "image-model-under-test",
    pricing: RATES,
    fetch: fakeFetch(() => ({
      status: 200,
      json: { data: [{ b64_json: PNG_1PX }], usage: { input_tokens: 100, output_tokens: 4000, input_tokens_details: { text_tokens: 100, image_tokens: 0 } } },
    }), log),
  });
  const r = await p.generateBackground({ prompt: "soft botanical texture, no product, no text", width: 1080, height: 1350, seed: "s", palette: [] });
  assert.equal(log.length, 1);
  assert.equal(log[0].url, "https://api.openai.com/v1/images/generations");
  assert.equal((log[0].init.headers as Record<string, string>).Authorization, `Bearer ${KEY}`);
  assert.deepEqual(Object.keys(log[0].body).sort(), ["model", "n", "prompt", "size"], "no brand asset or extra fields are sent");
  assert.equal(log[0].body.size, "1024x1536");
  assert.deepEqual([...r.bytes.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(r.costAmount, 0.1205); // (100×5 + 4000×30) / 1e6
  assert.equal(r.costBasis, "token_usage");
});

test("missing rates or usage book the owner's per-call estimate, labelled as such", () => {
  assert.deepEqual(imageCost({ output_tokens: 10 }, PRICING), { amount: 0.06, currency: "USD", basis: "configured_estimate" });
  assert.deepEqual(imageCost(undefined, RATES), { amount: 0.06, currency: "USD", basis: "configured_estimate" });
  assert.deepEqual(textCost({ input_tokens: 2000, output_tokens: 500 }, RATES), { amount: 0.0175, currency: "USD", basis: "token_usage" });
  assert.equal(textCost({}, PRICING).amount, 0.02);
});

test("errors are classified for retry and never carry the key", async () => {
  const mk = (status: number) =>
    new OpenAIImageProvider({
      apiKey: KEY,
      model: "m",
      pricing: PRICING,
      fetch: fakeFetch(() => ({ status, json: { error: { message: `bad key ${KEY} rejected` } } })),
    });
  for (const [status, retryable] of [[429, true], [500, true], [503, true], [400, false], [401, false]] as const) {
    await assert.rejects(mk(status).generateBackground({ prompt: "x", width: 1, height: 1, seed: "", palette: [] }), (e: unknown) => {
      assert.ok(e instanceof OpenAIError);
      assert.equal(e.status, status);
      assert.equal(e.retryable, retryable);
      assert.ok(!e.message.includes(KEY), "key redacted");
      return true;
    });
  }
  const network = new OpenAIImageProvider({ apiKey: KEY, model: "m", pricing: PRICING, fetch: async () => { throw new TypeError("fetch failed"); } });
  await assert.rejects(network.generateBackground({ prompt: "x", width: 1, height: 1, seed: "", palette: [] }), (e: unknown) => e instanceof OpenAIError && e.retryable);
});

const OBSERVED = {
  layout: { archetype: "hero_right", grid_notes: "copy left half, pack right half" },
  product: { visible: true, count: 1, placement: "right, centred", share_of_canvas_pct: 30, label_legible: true },
  text: [{ role: "headline", text: "Verbatim headline", approx_size_pct: 6 }],
  palette: [{ hex: "#FFFFFF", role: "background" }],
  hierarchy: ["headline", "pack", "cta"],
  offer_present: false,
  claims_seen: [],
  people_present: false,
  notes: "",
};

test("poster analysis: image as data URL, strict schema, identity fields set by us", async () => {
  const log: Captured[] = [];
  const a = new OpenAIPosterAnalyzer({
    apiKey: KEY,
    model: "vision-model-under-test",
    pricing: RATES,
    fetch: fakeFetch(() => ({
      status: 200,
      json: {
        output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify({ ...OBSERVED, image: { sha256: "spoofed" } }) }] }],
        usage: { input_tokens: 1500, output_tokens: 400 },
      },
    }), log),
  });
  const sha = "a".repeat(64);
  const r = await a.analyze({ bytes: Uint8Array.from(atob(PNG_1PX), (c) => c.charCodeAt(0)), mimeType: "image/png", sha256: sha, width: 1080, height: 1350 });
  assert.equal(log[0].url, "https://api.openai.com/v1/responses");
  const content = (log[0].body.input as Array<{ content: Array<Record<string, string>> }>)[0].content;
  assert.equal(content[1].type, "input_image");
  assert.ok(content[1].image_url.startsWith("data:image/png;base64,iVBOR"));
  const fmt = (log[0].body.text as { format: Record<string, unknown> }).format;
  assert.equal(fmt.type, "json_schema");
  assert.equal(fmt.strict, true);
  assert.equal(r.analysis.image.sha256, sha, "model cannot spoof the image identity");
  assert.deepEqual(r.analysis.observed_by, { kind: "provider", provider: "openai", model: "vision-model-under-test" });
  assert.equal(r.cost.amount, 0.0135);
  assert.match(r.promptSha256, /^[0-9a-f]{64}$/);
});

test("poster analysis: refusals and invalid observations fail loudly", async () => {
  const mk = (json: unknown) => new OpenAIPosterAnalyzer({ apiKey: KEY, model: "m", pricing: PRICING, fetch: fakeFetch(() => ({ status: 200, json })) });
  const img = { bytes: new Uint8Array([1]), mimeType: "image/png", sha256: "b".repeat(64), width: 10, height: 10 };
  await assert.rejects(mk({ output: [{ type: "message", content: [{ type: "refusal", refusal: "no" }] }] }).analyze(img), /refused/);
  await assert.rejects(
    mk({ output_text: JSON.stringify({ ...OBSERVED, palette: [{ hex: "white", role: "background" }] }) }).analyze(img),
    /failed validation: palette\[0\]\.hex/,
  );
});

test("factory gates: key, pricing and data approval are all required for OpenAI", () => {
  const base = { image_provider: "openai", image_model: "m", provider_data_approved: true, provider_pricing: PRICING };
  assert.throws(() => createImageProvider(base), /no API key/);
  assert.throws(() => createImageProvider({ ...base, provider_pricing: {} }, { apiKey: KEY }), /image_estimate_per_call/);
  assert.throws(() => createImageProvider({ ...base, provider_data_approved: false }, { apiKey: KEY }), ProviderUnavailableError);
  assert.equal(createImageProvider(base, { apiKey: KEY }).id, "openai");
  const an = { analysis_provider: "openai", analysis_model: "v", provider_data_approved: false, provider_pricing: PRICING };
  assert.throws(() => createPosterAnalyzer(an, { apiKey: KEY }), /poster images may not be sent/);
  assert.equal(createPosterAnalyzer({ ...an, provider_data_approved: true }, { apiKey: KEY }).model, "v");
});

test("worker books OpenAI's actual cost, and a 503 is retried within budget", async () => {
  const fx = await buildFixtureContext();
  const plan = await planBatch({ recipe: fx.recipe, recipeVersionId: 1, manifestSha256: fx.manifestSha256, exploreHypotheses: fx.hypotheses, estimatedCostPerCandidate: 0.06, maxAttempts: 2 });
  for (const f of plan.families) for (const v of f.variants) v.spec.background = "generated:test texture";
  const q = new MemoryJobQueue(plan, { budget: 10, contextManifestId: 1, provider: "openai", model: "m" });
  let calls = 0;
  const provider = new OpenAIImageProvider({
    apiKey: KEY,
    model: "m",
    pricing: RATES,
    fetch: fakeFetch(() => {
      calls += 1;
      return calls === 1
        ? { status: 503, json: { error: { message: "overloaded" } } }
        : { status: 200, json: { data: [{ b64_json: PNG_1PX }], usage: { input_tokens: 100, output_tokens: 2000 } } };
    }),
  });
  const ctx = { manifestSha256: fx.manifestSha256, tokens: FIXTURE_TOKENS, assets: new Map(fx.packshots.map((p) => [p.sha256, p])), approvedClaimIds: new Set<number>(), disclaimer: null, maxCostPerCandidate: 0.1, fixture: false };
  const deps = { workerId: "w", queue: q, loadContext: async () => ctx, store: { put: async (_b: Uint8Array, _t: string, sha: string) => `mem://${sha}` }, provider: () => provider };
  const t1 = await runTick(deps, 5);
  assert.equal(t1.failed, 1);
  assert.match(t1.errors[0], /openai 503: overloaded/);
  await runTick(deps, 5);
  assert.equal(q.batch.status, "awaiting_review");
  // 5 successful calls × (100×5 + 2000×30)/1e6 = 5 × 0.0605; the 503 cost nothing
  assert.equal(q.batch.spent, 0.3025);
  assert.equal(q.batch.reserved, 0);
});
