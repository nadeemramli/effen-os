/**
 * Automated poster QA, method `poster-qa-v1`. Automated checks gate what a
 * human reviewer sees; they never approve anything (approval is a human
 * decision recorded by public.creative_review_candidate).
 */
import { contrastRatio, type ComposeResult } from "./compose";
import { FORMAT_SIZES } from "./recipe";

export const QA_METHOD_VERSION = "poster-qa-v1";

export interface QaCheck {
  key: string;
  passed: boolean;
  detail?: Record<string, unknown>;
}

export interface QaContext {
  /** packshot SHA-256s the context manifest allows */
  manifestAssetShas: ReadonlySet<string>;
  /** approved claim ids for the brand/market */
  approvedClaimIds: ReadonlySet<number>;
  minContrast?: number; // WCAG AA large text = 3, body = 4.5
}

export function runPosterQa(r: ComposeResult, ctx: QaContext): QaCheck[] {
  const checks: QaCheck[] = [];
  const size = FORMAT_SIZES[r.format];
  checks.push({
    key: "dimensions",
    passed: r.width === size.width && r.height === size.height,
    detail: { width: r.width, height: r.height, expected: size },
  });

  // exactly one packshot image, the manifest's bytes, not cropped by the canvas
  const packshots = r.svg.match(/data-role="packshot"/g)?.length ?? 0;
  checks.push({
    key: "packshot_authentic",
    passed: packshots === 1 && ctx.manifestAssetShas.has(r.packshotSha256) && r.svg.includes(`data-asset-sha256="${r.packshotSha256}"`),
    detail: { packshot_sha256: r.packshotSha256, images: packshots },
  });
  const b = r.packshotBox;
  checks.push({
    key: "packshot_in_frame",
    passed: b.x >= 0 && b.y >= 0 && b.x + b.w <= r.width && b.y + b.h <= r.height && b.w > 0 && b.h > 0,
    detail: { box: b },
  });

  const overflow = r.texts.filter((t) => !t.fits).map((t) => t.slot);
  checks.push({ key: "text_fit", passed: overflow.length === 0, detail: { overflow } });

  const outside = r.texts
    .filter((t) => t.box.x < r.safeMargin - 1 || t.box.x + t.box.w > r.width - r.safeMargin + 1 || t.box.y + t.box.h > r.height - r.safeMargin + 1)
    .map((t) => t.slot);
  checks.push({ key: "safe_zone", passed: outside.length === 0, detail: { outside, margin: r.safeMargin } });

  const min = ctx.minContrast ?? 4.5;
  const headline = r.texts.find((t) => t.slot === "headline");
  const ratio = headline ? contrastRatio(headline.color, r.backgroundColor) : 0;
  checks.push({ key: "headline_contrast", passed: !!headline && ratio >= min, detail: { ratio: Math.round(ratio * 100) / 100, min } });

  // every marketing text must trace to an approved claim/copy id
  const untraced = r.texts
    .filter((t) => t.slot !== "disclaimer")
    .filter((t) => t.claimId == null || !ctx.approvedClaimIds.has(t.claimId))
    .map((t) => ({ slot: t.slot, text: t.text, fixture: t.fixture }));
  checks.push({ key: "copy_approved", passed: untraced.length === 0, detail: { untraced } });

  const fixture = r.svg.includes('data-role="fixture-watermark"') || r.texts.some((t) => t.fixture);
  checks.push({ key: "not_fixture", passed: !fixture, detail: { fixture } });
  return checks;
}

export const qaPassed = (checks: readonly QaCheck[]) => checks.every((c) => c.passed);
