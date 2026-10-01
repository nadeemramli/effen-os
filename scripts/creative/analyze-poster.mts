/**
 * Poster analysis CLI (Slice 3) — one PAID OpenAI call per image.
 *
 *   OPENAI_API_KEY=… pnpm dlx tsx scripts/creative/analyze-poster.mts \
 *     --image poster.png --model <vision model> --estimate 0.02 --data-approved \
 *     [--rates 5,15] [--out analysis.json] \
 *     [--save --brand-id 1 --raw-asset-id 42]   # needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *
 * Refuses to run without --data-approved (the poster bytes go to OpenAI)
 * and without --estimate (cost is always booked). Output is a DRAFT
 * poster-analysis-v1: a human reviews it before any recipe may cite it.
 * The key is read from the environment of the machine running this — it is
 * never written to disk or printed.
 */
import { readFile, writeFile } from "node:fs/promises";
import { sha256Hex } from "../../apps/web/src/lib/creative-lab/hash.ts";
import { mimeOf, pngSize } from "../../apps/web/src/lib/creative-lab/kit.ts";
import { createPosterAnalyzer } from "../../apps/web/src/lib/creative-lab/providers.ts";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
function fail(msg: string): never {
  console.error(msg);
  process.exit(2);
}

const image = opt("image") ?? fail("--image <png|jpg> is required");
const model = opt("model") ?? fail("--model <vision model id> is required (owner decision; not defaulted)");
const estimate = Number(opt("estimate") ?? fail("--estimate <cost per call> is required"));
if (!flag("data-approved")) fail("refusing: pass --data-approved to confirm this poster may be sent to OpenAI");
const [textIn, textOut] = (opt("rates") ?? "").split(",").map((x) => (x ? Number(x) : undefined));

const bytes = new Uint8Array(await readFile(image));
const dims = pngSize(bytes) ?? { width: Number(opt("width") ?? 0), height: Number(opt("height") ?? 0) };
if (!dims.width || !dims.height) fail("could not read dimensions (PNG) — pass --width/--height for other formats");
const sha256 = await sha256Hex(bytes);

const analyzer = createPosterAnalyzer(
  {
    analysis_provider: "openai",
    analysis_model: model,
    provider_data_approved: true,
    provider_pricing: { currency: opt("currency") ?? "USD", image_estimate_per_call: estimate, analysis_estimate_per_call: estimate, text_input_per_mtok: textIn, text_output_per_mtok: textOut },
  },
  { apiKey: process.env.OPENAI_API_KEY },
);

const result = await analyzer.analyze({ bytes, mimeType: mimeOf(image), sha256, width: dims.width, height: dims.height });
const out = { status: "draft", ...result };
if (opt("out")) await writeFile(opt("out")!, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ sha256, cost: result.cost, layout: result.analysis.layout, claims_seen: result.analysis.claims_seen }, null, 2));

if (flag("save")) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) fail("--save needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  const res = await fetch(`${url}/rest/v1/rpc/creative_save_poster_analysis`, {
    method: "POST",
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      p_brand_id: Number(opt("brand-id") ?? fail("--brand-id required with --save")),
      p_raw_asset_id: Number(opt("raw-asset-id") ?? fail("--raw-asset-id required with --save")),
      p_snapshot_id: opt("snapshot-id") ? Number(opt("snapshot-id")) : null,
      p_analysis: result.analysis,
      p_provider: "openai",
      p_model: model,
      p_prompt_sha256: result.promptSha256,
    }),
  });
  console.log("saved:", res.status, await res.text());
}
