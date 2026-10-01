/**
 * Provider adapters (ADR-0010 §7). Production model choice is owner
 * configuration (creative.brand_runtime_config), so the code ships with
 * the interfaces and a deterministic, zero-cost FIXTURE adapter only.
 * Asking for any other provider fails with the precise blocked step
 * instead of silently falling back or fabricating output.
 */

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
}

/** Registry of real adapters. Empty until an owner chooses a provider. */
const ADAPTERS: Record<string, (model: string) => ImageProvider> = {};

export function createImageProvider(cfg: ProviderConfig): ImageProvider {
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
  return make(cfg.image_model);
}
