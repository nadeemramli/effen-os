/**
 * The demo profile — what the seed becomes on the public, reviewer-facing
 * deployment (NEXT_PUBLIC_FULLKIT_MODE=demo).
 *
 * Two transforms, both applied to the composed snapshot rather than to the
 * seed modules themselves. That matters: the internal app keeps its real
 * brand and people names, which is what makes its demo surfaces useful to
 * staff. Only the demo build sees this.
 *
 *   1. Identity — real business names are replaced with fictional ones.
 *      Customer PII in the seed is already synthetic by construction
 *      (+60 12-000 zero-blocks, @example.com, .example domains); the gap
 *      this closes is *business* identity: the workspace, the brands, the
 *      products, and two real colleagues.
 *
 *   2. Epoch — every timestamp is rolled forward by a whole number of days
 *      so the dataset always ends today. The seed is authored against a
 *      fixed DEMO_NOW, but pages compute relative time from the real clock,
 *      so an unshifted demo shows its newest order ageing one day per day.
 *      On a product whose whole claim is order ingestion, that reads as
 *      broken sync.
 *
 * The shift is deliberately in whole days. Daily rows and plan points are
 * keyed by yyyy-mm-dd and were derived from the same orders at module load;
 * shifting both by the same whole-day offset keeps them aligned and keeps
 * day-boundary semantics intact. A partial-day offset would desynchronise
 * order timestamps from the day buckets built over them.
 *
 * assertSeedInvariants() runs against the unshifted module-level data and is
 * unaffected.
 */

import { DEMO_NOW } from "./clock";

const MS_DAY = 86_400_000;

/**
 * Longest first — "EFFEN International Sdn Bhd" must match before "EFFEN".
 * Applied with word boundaries so short tokens like "Ida" cannot corrupt
 * unrelated prose.
 */
const SUBSTITUTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bEFFEN International Sdn Bhd\b/g, "Meridian Commerce Sdn Bhd"],
  [/\bEFFEN Commerce Pte Ltd\b/g, "Meridian Retail Pte Ltd"],
  [/\bEFFEN\b/g, "Meridian"],
  [/\bLipidri\b/g, "Verdalis"],
  [/\blipidri\b/g, "verdalis"],
  [/\bSynovil\b/g, "Calidra"],
  [/\bsynovil\b/g, "calidra"],
  [/\bAdipocyde\b/g, "Nolvera"],
  [/\badipocyde\b/g, "nolvera"],
  [/\bNuroKids\b/g, "Brightly Kids"],
  [/\bNovomira\b/g, "Pagewright"],
  [/\bNadeem\b/g, "Adam Rahim"],
  [/\bIda\b/g, "Nurul Aziz"],
];

/** Keys whose values are identifiers, never display text. */
function isIdKey(key: string): boolean {
  return key === "id" || key === "slug" || key.endsWith("Id") || key.endsWith("Ids");
}

/**
 * Identifier tokens like "BRD-lipidri" or "ST-lip-shopee". These appear as
 * bare array members (brandScope: ["BRD-lipidri"]) where the key gives no
 * clue, so the value itself has to be recognised — otherwise renaming the
 * brand silently breaks every lookup that joins on the id.
 */
const ID_TOKEN = /^[A-Z]{2,5}-\S*$/;

function isIdValue(value: string): boolean {
  return !value.includes(" ") && ID_TOKEN.test(value);
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** Whole days between the authored seed epoch and today. Never negative. */
export function demoDayShift(now: Date = new Date()): number {
  const days = Math.floor((now.getTime() - DEMO_NOW.getTime()) / MS_DAY);
  return days > 0 ? days : 0;
}

function shiftIso(value: string, days: number): string {
  const t = new Date(value);
  if (Number.isNaN(t.getTime())) return value;
  return new Date(t.getTime() + days * MS_DAY).toISOString();
}

function shiftDateKey(value: string, days: number): string {
  const t = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(t.getTime())) return value;
  return new Date(t.getTime() + days * MS_DAY).toISOString().slice(0, 10);
}

function rename(value: string): string {
  let out = value;
  for (const [pattern, replacement] of SUBSTITUTIONS) out = out.replace(pattern, replacement);
  return out;
}

function transformString(value: string, key: string, days: number): string {
  if (ISO_TIMESTAMP.test(value)) return days ? shiftIso(value, days) : value;
  if (DATE_KEY.test(value)) return days ? shiftDateKey(value, days) : value;
  if (isIdKey(key) || isIdValue(value)) return value;
  return rename(value);
}

function walk(node: unknown, key: string, days: number): unknown {
  if (typeof node === "string") return transformString(node, key, days);
  if (Array.isArray(node)) return node.map((item) => walk(item, key, days));
  if (node && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      out[k] = walk(v, k, days);
    }
    return out;
  }
  return node;
}

/**
 * Apply the demo profile to a composed snapshot. Call only in demo mode —
 * the caller decides, so this module stays testable without env vars.
 */
export function applyDemoProfile<T>(snapshot: T, now: Date = new Date()): T {
  return walk(snapshot, "", demoDayShift(now)) as T;
}

/**
 * Every real EFFEN identifier, whether or not the seed currently uses it.
 *
 * Deliberately a superset of the substitution table above, and deliberately
 * maintained by hand. Checking the transform against its own table would be
 * a tautology — it would pass by construction. The value of this list is the
 * term that is *missing* from the table: add a fixture naming a real brand
 * and the build fails until the substitution is written.
 *
 * Add a term here whenever a real brand, entity, or colleague enters the
 * seed. Cavernosil has no fixture today but is a real brand (ADR-0002).
 */
const REAL_TERMS: readonly string[] = [
  "EFFEN",
  "Lipidri",
  "Synovil",
  "Adipocyde",
  "Cavernosil",
  "NuroKids",
  "Novomira",
  "Nadeem",
  "Ida",
];

const REAL_TERM_PATTERNS = REAL_TERMS.map((t) => new RegExp(`\\b${t}\\b`, "i"));

/**
 * Find real-identity leaks in a demo snapshot, for the build-time check.
 *
 * Identifier keys and identifier-shaped values are exempt: ids such as
 * `BRD-lipidri` and `USR-nadeem` survive renaming on purpose, because
 * `orders/new/page.tsx` and `lib/repo/mock.ts` hardcode them. They are never
 * rendered and never appear in a URL. Everything else is display text and
 * must be clean.
 *
 * Returns the offending strings, deduplicated.
 */
export function findDemoLeaks(snapshot: unknown): string[] {
  const leaks = new Set<string>();

  const visit = (node: unknown, key: string): void => {
    if (typeof node === "string") {
      if (isIdKey(key) || isIdValue(node)) return;
      if (REAL_TERM_PATTERNS.some((p) => p.test(node))) leaks.add(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, key);
      return;
    }
    if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node as Record<string, unknown>)) visit(v, k);
    }
  };

  visit(snapshot, "");
  return [...leaks];
}
