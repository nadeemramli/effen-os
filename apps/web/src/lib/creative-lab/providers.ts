/**
 * Provider adapters (ADR-0010 §7). Model choice and prices are owner
 * configuration (creative.brand_runtime_config); keys live in Vault.
 * Asking for a provider that is unconfigured, unapproved, keyless or
 * unadapted fails with the precise blocked step instead of silently
 * falling back or fabricating output.
 *
 * Adapters: fixture (zero cost, deterministic) and openai (owner decision
 * 2026-10-01; see openai.ts).
 */
import { OpenAIImageProvider, OpenAIPosterAnalyzer, type FetchLike, type ProviderPricing } from "./openai";

export interface BackgroundRequest {
  prompt: string;
  width: number;
  height: number;
  seed: string;
  palette: string[];
}

export interface BackgroundResult {
  bytes: Uint8Array;
  contentType: string;
  provider: string;
  model: string;
  prompt: string;
  costAmount: number;
  costCurrency: string;
}

export interface ImageProvider {
  readonly id: string;
  readonly model: string;
  /** Upper bound per call, checked against the per-candidate cap BEFORE calling. */
  estimateCost(req: BackgroundRequest): number;
  generateBackground(req: BackgroundRequest): Promise<BackgroundResult>;
}

export class ProviderUnavailableError extends Error {
  constructor(public readonly provider: string, public readonly blockedStep: string) {
    super(`provider "${provider}" unavailable: ${blockedStep}`);
    this.name = "ProviderUnavailableError";
  }
}

/** Deterministic SVG gradient keyed by seed. Never calls a network. */
export class FixtureImageProvider implements ImageProvider {
  readonly id = "fixture";
  readonly model = "fixture-bg-v1";
  calls = 0;
  estimateCost(): number {
    return 0;
  }
  async generateBackground(req: BackgroundRequest): Promise<BackgroundResult> {
    this.calls += 1;
    let h = 0;
    for (const ch of req.seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    const [a, b] = [req.palette[0] ?? "#E8EEF4", req.palette[1] ?? "#FFFFFF"];
    const angle = h % 360;
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${req.width}" height="${req.height}">` +
      `<defs><linearGradient id="g" gradientTransform="rotate(${angle} .5 .5)"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>` +
      `<rect width="100%" height="100%" fill="url(#g)"/>` +
      `<circle cx="${(h % 7) * 140 + 120}" cy="${(h % 5) * 180 + 160}" r="${200 + (h % 120)}" fill="#FFFFFF" fill-opacity="0.18"/></svg>`;
    return {
      bytes: new TextEncoder().encode(svg),
      contentType: "image/svg+xml",
      provider: this.id,
      model: this.model,
      prompt: req.prompt,
      costAmount: 0,
      costCurrency: "USD",
    };
  }
}

export interface ProviderConfig {
  image_provider: string | null;
  image_model: string | null;
  provider_data_approved: boolean;
  /** Owner-entered prices (creative.brand_runtime_config.provider_pricing). */
  provider_pricing?: Partial<ProviderPricing> | null;
}

export interface ProviderSecrets {
  /** From Vault via public.creative_get_provider_key (service role only). */
  apiKey?: string | null;
  fetch?: FetchLike;
  quality?: string;
}

function requirePricing(provider: string, p: Partial<ProviderPricing> | null | undefined): ProviderPricing {
  if (!p || typeof p.image_estimate_per_call !== "number" || !p.currency) {
    throw new ProviderUnavailableError(provider, "provider_pricing.image_estimate_per_call/currency not set — budget reservation needs an owner-entered estimate");
  }
  return p as ProviderPricing;
}

function requireKey(provider: string, key: string | null | undefined): string {
  if (!key) {
    throw new ProviderUnavailableError(provider, "no API key — worker: an HQ admin stores it in Vault (Poster lab → readiness); CLI: set OPENAI_API_KEY");
  }
  return key;
}

/** Real adapters. The image request sends only a text prompt (no brand assets). */
const ADAPTERS: Record<string, (cfg: ProviderConfig, s: ProviderSecrets) => ImageProvider> = {
  openai: (cfg, s) =>
    new OpenAIImageProvider({
      apiKey: requireKey("openai", s.apiKey),
      model: cfg.image_model!,
      pricing: requirePricing("openai", cfg.provider_pricing),
      fetch: s.fetch,
      quality: s.quality,
    }),
};

export function createImageProvider(cfg: ProviderConfig, secrets: ProviderSecrets = {}): ImageProvider {
  if (!cfg.image_provider || !cfg.image_model) {
    throw new ProviderUnavailableError("(unset)", "owner has not configured image_provider/image_model in creative.brand_runtime_config");
  }
  if (cfg.image_provider === "fixture") return new FixtureImageProvider();
  if (!cfg.provider_data_approved) {
    throw new ProviderUnavailableError(cfg.image_provider, "provider_data_approved is false: private brand assets may not be sent to this provider");
  }
  const make = ADAPTERS[cfg.image_provider];
  if (!make) {
    throw new ProviderUnavailableError(cfg.image_provider, `no adapter implemented for "${cfg.image_provider}" — add one in providers.ts with a no-network fixture test before enabling paid calls`);
  }
  return make(cfg, secrets);
}

export interface AnalyzerConfig {
  analysis_provider: string | null;
  analysis_model: string | null;
  provider_data_approved: boolean;
  provider_pricing?: Partial<ProviderPricing> | null;
}

/** Poster analysis sends the poster's bytes to the provider: data approval is mandatory. */
export function createPosterAnalyzer(cfg: AnalyzerConfig, secrets: ProviderSecrets = {}): OpenAIPosterAnalyzer {
  if (!cfg.analysis_provider || !cfg.analysis_model) {
    throw new ProviderUnavailableError("(unset)", "owner has not configured analysis_provider/analysis_model");
  }
  if (cfg.analysis_provider !== "openai") {
    throw new ProviderUnavailableError(cfg.analysis_provider, `no analysis adapter for "${cfg.analysis_provider}"`);
  }
  if (!cfg.provider_data_approved) {
    throw new ProviderUnavailableError("openai", "provider_data_approved is false: poster images may not be sent to OpenAI");
  }
  return new OpenAIPosterAnalyzer({
    apiKey: requireKey("openai", secrets.apiKey),
    model: cfg.analysis_model,
    pricing: requirePricing("openai", cfg.provider_pricing),
    fetch: secrets.fetch,
  });
}
