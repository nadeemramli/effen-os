/**
 * FIXTURES — synthetic data that proves the machinery only.
 *
 * Nothing here is a real ad result, a real Adipocyde claim or a real
 * packshot. Every fixture object carries `fixture: true` (or a FIXTURE
 * label) and composed output is watermarked "FIXTURE — NOT FOR LAUNCH";
 * QA's `not_fixture` and `copy_approved` checks fail on it by design, so a
 * fixture candidate can never be approved through the normal path.
 */
import { sha256Hex } from "./hash";
import type { AssetRef } from "./compose";
import type { ExploreHypothesis } from "./planner";
import type { CopyOption, RecipeSpec } from "./recipe";
import type { PosterAnalysis } from "./analysis";
import type { BrandTokens, ImageLeaderboardRow } from "./types";

export const FIXTURE_LABEL = "Fixture data — machinery check only, not real ad results";

const copy = (text: string): CopyOption => ({ text, claim_id: null, fixture: true });

export const FIXTURE_TOKENS: BrandTokens = {
  colors: { primary: "#0F5132", secondary: "#D1E7DD", accent: "#FFC107", background: "#F8F9F4", text: "#14211A" },
  fonts: { heading: "Inter, Arial, Helvetica, sans-serif", body: "Inter, Arial, Helvetica, sans-serif" },
};

/** A neutral bottle silhouette, plainly labelled as a placeholder. */
export function fixturePackshotSvg(label: string, tint: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900" viewBox="0 0 600 900">` +
    `<rect x="210" y="40" width="180" height="90" rx="16" fill="#2B2B2B"/>` +
    `<rect x="120" y="120" width="360" height="740" rx="60" fill="${tint}" stroke="#2B2B2B" stroke-width="8"/>` +
    `<rect x="150" y="330" width="300" height="300" rx="20" fill="#FFFFFF"/>` +
    `<text x="300" y="440" font-family="Arial" font-size="34" font-weight="800" text-anchor="middle" fill="#B00020">FIXTURE</text>` +
    `<text x="300" y="490" font-family="Arial" font-size="26" text-anchor="middle" fill="#333">${label}</text>` +
    `<text x="300" y="540" font-family="Arial" font-size="20" text-anchor="middle" fill="#666">replace with raw-materials PNG</text>` +
    `</svg>`
  );
}

export interface FixtureContext {
  packshots: AssetRef[];
  recipe: RecipeSpec;
  analysis: PosterAnalysis;
  hypotheses: ExploreHypothesis[];
  manifestSha256: string;
}

export async function buildFixtureContext(): Promise<FixtureContext> {
  const packshots: AssetRef[] = [];
  for (const [label, tint] of [
    ["front", "#CFE8D8"],
    ["angle", "#BFDCCB"],
    ["pair", "#E3F1E8"],
  ] as const) {
    const svg = fixturePackshotSvg(label, tint);
    const sha = await sha256Hex(svg);
    packshots.push({ sha256: sha, href: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`, width: 600, height: 900 });
  }
  const recipe: RecipeSpec = {
    name: "adipocyde-fixture-hero-right",
    base: {
      layout: "hero_right",
      background: "solid:background",
      palette: "primary",
      packshot_sha256: packshots[0].sha256,
      headline: copy("[Fixture headline] Proof-led benefit statement"),
      subhead: copy("[Fixture subhead] Supporting reason to believe"),
      badge: copy("[Fixture offer]"),
      cta: copy("Shop now"),
    },
    options: {
      headline: [
        copy("[Fixture] Benefit headline B"),
        copy("[Fixture] Ingredient-led headline C"),
        copy("[Fixture] Routine-led headline D"),
        copy("[Fixture] Question headline E?"),
        copy("[Fixture] Social-proof headline F"),
        copy("[Fixture] Outcome headline G"),
      ],
      subhead: [copy("[Fixture] Subhead B"), copy("[Fixture] Subhead C"), copy("[Fixture] Subhead D"), copy("[Fixture] Subhead E"), copy("[Fixture] Subhead F")],
      badge: [copy("[Fixture offer B]"), copy("[Fixture offer C]"), copy("[Fixture offer D]"), copy("[Fixture offer E]"), copy("[Fixture offer F]")],
      cta: [copy("Buy now"), copy("Order today"), copy("Learn more"), copy("Get yours"), copy("Try it")],
      background: ["solid:secondary", "gradient:secondary-background", "gradient:background-secondary", "solid:accent", "generated:soft botanical texture"],
      layout: ["hero_left", "hero_center"],
      packshot: packshots.map((p) => p.sha256),
      palette: ["accent", "text", "secondary"],
    },
    fixed: [],
    formats: ["4:5", "1:1"],
    text_limits: { headline_max_lines: 3, subhead_max_lines: 3 },
    source_notes: ["Fixture recipe: structure only, no Adipocyde claims."],
  };
  const analysis: PosterAnalysis = {
    schema_version: "poster-analysis-v1",
    observed_by: { kind: "fixture" },
    image: { sha256: await sha256Hex("fixture-top-poster"), width: 1080, height: 1350 },
    layout: { archetype: "hero_right", grid_notes: "two-column: copy left 50%, pack right 50%, CTA bottom-left" },
    product: { visible: true, count: 1, placement: "right half, vertically centred", share_of_canvas_pct: 32, label_legible: true },
    text: [
      { role: "headline", text: "[Fixture headline]", approx_size_pct: 6 },
      { role: "cta", text: "Shop now", approx_size_pct: 3 },
    ],
    palette: [
      { hex: "#F8F9F4", role: "background" },
      { hex: "#14211A", role: "text" },
      { hex: "#0F5132", role: "accent" },
    ],
    hierarchy: ["headline", "pack", "offer badge", "CTA"],
    offer_present: true,
    claims_seen: [],
    people_present: false,
    notes: "Fixture analysis.",
  };
  // the 20th-family explore hypotheses: ≥2 factors each, stated up front
  const hypotheses: ExploreHypothesis[] = [
    {
      hypothesis: "A centred pack with a question headline reads as editorial rather than advertorial",
      changes: { layout: ["hero_center"], headline: recipe.options.headline.slice(3, 6), background: ["solid:secondary", "gradient:secondary-background"] },
    },
    {
      hypothesis: "Multiple-pack composition with an offer-first hierarchy raises perceived value",
      changes: { packshot: packshots.slice(1).map((p) => p.sha256), badge: recipe.options.badge.slice(0, 3), palette: ["accent"] },
    },
  ];
  return { packshots, recipe, analysis, hypotheses, manifestSha256: await sha256Hex("fixture-context-manifest") };
}

const row = (r: Partial<ImageLeaderboardRow> & Pick<ImageLeaderboardRow, "image_hash" | "spend" | "purchases" | "purchase_value">): ImageLeaderboardRow => ({
  platform: "meta",
  account_id: "fixture-acc-1",
  market: "MY",
  currency_code: "MYR",
  campaign_objective: "OUTCOME_SALES",
  attribution_setting: "7d_click_1d_view",
  account_timezone: "Asia/Kuala_Lumpur",
  impressions: Math.round(r.spend * 90),
  clicks: Math.round(r.spend * 1.6),
  max_concurrent_ads: 2,
  distinct_ads: 3,
  first_date: "2026-07-01",
  last_date: "2026-09-20",
  days: 60,
  maturing_spend: 0,
  any_banned_account: false,
  fetch_status: "pending",
  asset_sha256: null,
  asset_storage_ref: null,
  ...r,
});

/** FIXTURE leaderboard for Adipocyde: two cohorts, edge cases included. */
export const FIXTURE_LEADERBOARD: ImageLeaderboardRow[] = [
  row({ image_hash: "fx01a7c3", spend: 4200, purchases: 61, purchase_value: 13420 }),
  row({ image_hash: "fx02b8d4", spend: 3900, purchases: 44, purchase_value: 9240 }),
  row({ image_hash: "fx03c9e5", spend: 2600, purchases: 29, purchase_value: 6670 }),
  row({ image_hash: "fx04dae6", spend: 1800, purchases: 15, purchase_value: 2850 }),
  // tiny spend, spectacular ROAS → shrinkage must keep it from leading
  row({ image_hash: "fx05ebf7", spend: 140, purchases: 3, purchase_value: 1650, distinct_ads: 1 }),
  // mostly inside the late-conversion window → immature
  row({ image_hash: "fx06fc08", spend: 900, purchases: 9, purchase_value: 2300, maturing_spend: 620, last_date: "2026-09-29" }),
  // SG cohort: never ranked against MY
  row({ image_hash: "fx07ad19", account_id: "fixture-acc-sg", market: "SG", currency_code: "SGD", account_timezone: "Asia/Singapore", spend: 1300, purchases: 17, purchase_value: 2900 }),
  row({ image_hash: "fx08be2a", account_id: "fixture-acc-sg", market: "SG", currency_code: "SGD", account_timezone: "Asia/Singapore", spend: 700, purchases: 6, purchase_value: 1100 }),
  // attribution setting unknown → not comparable
  row({ image_hash: "fx09cf3b", attribution_setting: "UNKNOWN", spend: 2000, purchases: 25, purchase_value: 5000 }),
];
