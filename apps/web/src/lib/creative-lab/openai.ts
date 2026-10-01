/**
 * OpenAI adapters (ADR-0010 §7, owner decision 2026-10-01: OpenAI is the
 * creative-lab provider).
 *
 *   OpenAIImageProvider   POST /v1/images/generations — SUPPORTING
 *                         BACKGROUNDS ONLY. The request carries a text prompt;
 *                         no packshot or brand asset is sent, and the product
 *                         is never generated (it is composited unaltered).
 *   OpenAIPosterAnalyzer  POST /v1/responses with an input_image and a strict
 *                         JSON schema — observes an owned poster's pixels into
 *                         poster-analysis-v1. Sends the poster bytes, so it
 *                         requires provider_data_approved.
 *
 * Runs only in the worker / CLI with the key from Vault
 * (public.creative_get_provider_key, service role). Never imported into a
 * page that could ship the key to a browser. Model names and prices are
 * owner configuration (creative.brand_runtime_config); nothing is defaulted.
 * Cost is computed from the response's token usage × owner-entered rates;
 * where a rate is missing the owner's per-call estimate is booked and the
 * result is marked `cost_basis: "configured_estimate"`.
 */
import type { PosterAnalysis } from "./analysis";
import { validatePosterAnalysis } from "./analysis";
import { canonicalJson, sha256Hex } from "./hash";
import type { BackgroundRequest, BackgroundResult, ImageProvider } from "./providers";

export const OPENAI_BASE_URL = "https://api.openai.com/v1";

export interface ProviderPricing {
  currency: string;
  /** Upper-bound estimate per image call; reserved against the batch budget before calling. */
  image_estimate_per_call: number;
  /** Estimate per poster-analysis call. */
  analysis_estimate_per_call?: number;
  image_input_per_mtok?: number;
  image_output_per_mtok?: number;
  text_input_per_mtok?: number;
  text_output_per_mtok?: number;
  source?: string;
  as_of?: string;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface OpenAIOptions {
  apiKey: string;
  model: string;
  pricing: ProviderPricing;
  fetch?: FetchLike;
  baseUrl?: string;
  timeoutMs?: number;
  /** Optional quality passthrough (owner configuration); omitted when unset. */
  quality?: string;
}

export class OpenAIError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(`openai ${status}: ${message}`);
    this.name = "OpenAIError";
  }
}

export interface UsageCost {
  amount: number;
  currency: string;
  basis: "token_usage" | "configured_estimate";
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4;

/** Images API usage → cost. Falls back to the per-call estimate when rates or usage are absent. */
export function imageCost(usage: unknown, p: ProviderPricing): UsageCost {
  const u = usage as
    | { input_tokens?: number; output_tokens?: number; input_tokens_details?: { text_tokens?: number; image_tokens?: number } }
    | undefined;
  if (u && p.image_output_per_mtok != null && p.text_input_per_mtok != null && u.output_tokens != null) {
    const text = u.input_tokens_details?.text_tokens ?? u.input_tokens ?? 0;
    const image = u.input_tokens_details?.image_tokens ?? 0;
    const amount =
      (text * p.text_input_per_mtok + image * (p.image_input_per_mtok ?? 0) + u.output_tokens * p.image_output_per_mtok) / 1e6;
    return { amount: round4(amount), currency: p.currency, basis: "token_usage" };
  }
  return { amount: p.image_estimate_per_call, currency: p.currency, basis: "configured_estimate" };
}

/** Responses API usage → cost (vision input counts as input tokens). */
export function textCost(usage: unknown, p: ProviderPricing): UsageCost {
  const u = usage as { input_tokens?: number; output_tokens?: number } | undefined;
  if (u && u.input_tokens != null && u.output_tokens != null && p.text_input_per_mtok != null && p.text_output_per_mtok != null) {
    return {
      amount: round4((u.input_tokens * p.text_input_per_mtok + u.output_tokens * p.text_output_per_mtok) / 1e6),
      currency: p.currency,
      basis: "token_usage",
    };
  }
  return { amount: p.analysis_estimate_per_call ?? p.image_estimate_per_call, currency: p.currency, basis: "configured_estimate" };
}

/** The three sizes every GPT Image model accepts; the compositor covers the canvas. */
export function openAiImageSize(width: number, height: number): "1024x1024" | "1024x1536" | "1536x1024" {
  const r = width / height;
  if (r < 0.85) return "1024x1536";
  if (r > 1.18) return "1536x1024";
  return "1024x1024";
}

async function call(opts: OpenAIOptions, path: string, body: unknown): Promise<Record<string, unknown>> {
  const doFetch = opts.fetch ?? (globalThis.fetch as FetchLike);
  let res: Response;
  try {
    res = await doFetch(`${opts.baseUrl ?? OPENAI_BASE_URL}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 180_000),
    });
  } catch (e) {
    // network / timeout: retryable, and never echo request details
    throw new OpenAIError(0, e instanceof Error ? e.name : "network error", true);
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    json = {};
  }
  if (!res.ok) {
    const err = (json.error as { message?: string; type?: string } | undefined) ?? {};
    const msg = (err.message ?? err.type ?? res.statusText ?? "error").slice(0, 300).replaceAll(opts.apiKey, "[redacted]");
    throw new OpenAIError(res.status, msg, res.status === 408 || res.status === 409 || res.status === 429 || res.status >= 500);
  }
  return json;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export class OpenAIImageProvider implements ImageProvider {
  readonly id = "openai";
  readonly model: string;
  constructor(private readonly opts: OpenAIOptions) {
    this.model = opts.model;
  }
  estimateCost(): number {
    return this.opts.pricing.image_estimate_per_call;
  }
  async generateBackground(req: BackgroundRequest): Promise<BackgroundResult & { usage: unknown; costBasis: UsageCost["basis"] }> {
    const body: Record<string, unknown> = {
      model: this.model,
      prompt: req.prompt,
      size: openAiImageSize(req.width, req.height),
      n: 1,
    };
    if (this.opts.quality) body.quality = this.opts.quality;
    const json = await call(this.opts, "/images/generations", body);
    const b64 = (json.data as Array<{ b64_json?: string }> | undefined)?.[0]?.b64_json;
    if (!b64) throw new OpenAIError(200, "response carried no image data", false);
    const cost = imageCost(json.usage, this.opts.pricing);
    return {
      bytes: b64ToBytes(b64),
      contentType: "image/png",
      provider: this.id,
      model: this.model,
      prompt: req.prompt,
      costAmount: cost.amount,
      costCurrency: cost.currency,
      usage: json.usage ?? null,
      costBasis: cost.basis,
    };
  }
}

/* ------------------------------------------------------------------ analysis */

export const ANALYSIS_PROMPT = `You are documenting an advertising poster for a reconstruction SOP.
Describe ONLY what is visible in the image. Do not guess why it performed, do not judge quality,
and do not invent text: copy every visible word verbatim (keep the original language).
- layout.archetype: hero_right (copy left, product right), hero_left (product left, copy right),
  hero_center (copy above/below a centred product) or other.
- product: visible packs, where they sit, approximate share of the canvas (0-100), whether the label is legible.
- text: every distinct text block with its role and approximate cap height as % of image height.
- palette: up to 6 dominant colours as #RRGGBB with their role.
- hierarchy: the reading order of elements, first to last.
- claims_seen: any health, efficacy, price or guarantee statement, verbatim.
- notes: anything a designer needs to rebuild the layout faithfully.`;

/** Strict JSON schema for the model-observed part of poster-analysis-v1. */
export const ANALYSIS_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["layout", "product", "text", "palette", "hierarchy", "offer_present", "claims_seen", "people_present", "notes"],
  properties: {
    layout: {
      type: "object",
      additionalProperties: false,
      required: ["archetype", "grid_notes"],
      properties: {
        archetype: { type: "string", enum: ["hero_right", "hero_left", "hero_center", "other"] },
        grid_notes: { type: "string" },
      },
    },
    product: {
      type: "object",
      additionalProperties: false,
      required: ["visible", "count", "placement", "share_of_canvas_pct", "label_legible"],
      properties: {
        visible: { type: "boolean" },
        count: { type: "integer" },
        placement: { type: "string" },
        share_of_canvas_pct: { type: "number" },
        label_legible: { type: "boolean" },
      },
    },
    text: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["role", "text", "approx_size_pct"],
        properties: {
          role: { type: "string", enum: ["headline", "subhead", "badge", "cta", "disclaimer", "other"] },
          text: { type: "string" },
          approx_size_pct: { type: "number" },
        },
      },
    },
    palette: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["hex", "role"],
        properties: {
          hex: { type: "string" },
          role: { type: "string", enum: ["background", "text", "accent", "product"] },
        },
      },
    },
    hierarchy: { type: "array", items: { type: "string" } },
    offer_present: { type: "boolean" },
    claims_seen: { type: "array", items: { type: "string" } },
    people_present: { type: "boolean" },
    notes: { type: "string" },
  },
} as const;

export interface PosterImageInput {
  bytes: Uint8Array;
  mimeType: string;
  sha256: string;
  width: number;
  height: number;
}

export interface AnalysisResult {
  analysis: PosterAnalysis;
  promptSha256: string;
  usage: unknown;
  cost: UsageCost;
}

export class OpenAIPosterAnalyzer {
  readonly id = "openai";
  readonly model: string;
  constructor(private readonly opts: OpenAIOptions) {
    this.model = opts.model;
  }
  estimateCost(): number {
    return this.opts.pricing.analysis_estimate_per_call ?? this.opts.pricing.image_estimate_per_call;
  }
  async analyze(img: PosterImageInput): Promise<AnalysisResult> {
    const body = {
      model: this.model,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: ANALYSIS_PROMPT },
            { type: "input_image", image_url: `data:${img.mimeType};base64,${bytesToB64(img.bytes)}`, detail: "high" },
          ],
        },
      ],
      text: { format: { type: "json_schema", name: "poster_analysis", strict: true, schema: ANALYSIS_JSON_SCHEMA } },
    };
    const json = await call(this.opts, "/responses", body);
    const output = (json.output as Array<{ type?: string; content?: Array<{ type?: string; text?: string; refusal?: string }> }>) ?? [];
    const parts = output.flatMap((o) => o.content ?? []);
    const refusal = parts.find((c) => c.type === "refusal");
    if (refusal) throw new OpenAIError(200, `model refused: ${String(refusal.refusal ?? "").slice(0, 200)}`, false);
    const text = (json.output_text as string | undefined) ?? parts.find((c) => c.type === "output_text")?.text;
    if (!text) throw new OpenAIError(200, "response carried no output_text", false);
    let observed: Omit<PosterAnalysis, "schema_version" | "observed_by" | "image">;
    try {
      observed = JSON.parse(text);
    } catch {
      throw new OpenAIError(200, "output_text is not JSON", false);
    }
    // identity fields come from our side, never from the model
    const analysis: PosterAnalysis = {
      ...observed,
      schema_version: "poster-analysis-v1",
      observed_by: { kind: "provider", provider: this.id, model: this.model },
      image: { sha256: img.sha256, width: img.width, height: img.height },
    };
    const issues = validatePosterAnalysis(analysis);
    if (issues.length) {
      throw new OpenAIError(200, `analysis failed validation: ${issues.map((i) => `${i.path} ${i.message}`).join("; ")}`, false);
    }
    return {
      analysis,
      promptSha256: await sha256Hex(canonicalJson({ prompt: ANALYSIS_PROMPT, schema: ANALYSIS_JSON_SCHEMA, model: this.model })),
      usage: json.usage ?? null,
      cost: textCost(json.usage, this.opts.pricing),
    };
  }
}
