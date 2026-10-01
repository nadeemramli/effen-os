/**
 * Deterministic poster composition, method `compose-svg-v1` (ADR-0010 §7).
 *
 * The product is never redrawn: the authentic packshot is placed as an
 * <image> by reference, scaled with preserved aspect ratio, and tagged with
 * its SHA-256 so QA can prove which bytes were used. All text is live SVG
 * text (editable, re-typesettable). The same inputs always produce the
 * same bytes, so output SHA-256 de-duplication is meaningful.
 *
 * AI may supply a supporting BACKGROUND (`generated:<href>`); it never
 * supplies the packshot or the label.
 */
import { FORMAT_SIZES, type CopyOption, type FormatKey, type LayoutKey } from "./recipe";
import type { BrandTokens } from "./types";
import type { VariantSpec } from "./planner";

export const COMPOSE_METHOD_VERSION = "compose-svg-v1";

export interface AssetRef {
  sha256: string;
  href: string; // gs:// signed URL, data: URI, or fixture path
  width: number;
  height: number;
}

export interface ComposeInput {
  spec: VariantSpec;
  format: FormatKey;
  tokens: BrandTokens;
  packshot: AssetRef;
  logo?: AssetRef | null;
  /** resolved href for `generated:` backgrounds */
  backgroundHref?: string | null;
  disclaimer?: string | null;
  /** fixture output is watermarked so it can never pass for production */
  fixtureWatermark?: boolean;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TextBlock {
  slot: "headline" | "subhead" | "badge" | "cta" | "disclaimer";
  text: string;
  lines: string[];
  fontSize: number;
  box: Box;
  fits: boolean;
  color: string;
  claimId: number | null;
  fixture: boolean;
}

export interface ComposeResult {
  svg: string;
  width: number;
  height: number;
  format: FormatKey;
  packshotBox: Box;
  packshotSha256: string;
  backgroundColor: string;
  texts: TextBlock[];
  safeMargin: number;
}

const DEFAULT_COLORS = { primary: "#1F4E79", secondary: "#E8EEF4", accent: "#F2A93B", background: "#FFFFFF", text: "#111111" };

export function color(tokens: BrandTokens, key: string): string {
  const c = tokens.colors?.[key] ?? (DEFAULT_COLORS as Record<string, string>)[key];
  return c && /^#[0-9a-fA-F]{6}$/.test(c) ? c.toUpperCase() : DEFAULT_COLORS.primary;
}

export function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** Average glyph advance for a bold sans at 1px, a conservative estimate. */
const ADVANCE = 0.56;

/** Greedy word wrap, shrinking the font until it fits `maxLines` or `minSize`. */
export function fitText(text: string, box: Box, maxLines: number, startSize: number, minSize: number) {
  for (let size = startSize; size >= minSize; size -= 2) {
    const perLine = Math.max(1, Math.floor(box.w / (size * ADVANCE)));
    const lines = wrap(text, perLine);
    const height = lines.length * size * 1.15;
    if (lines.length <= maxLines && height <= box.h && lines.every((l) => l.length <= perLine)) {
      return { lines, fontSize: size, fits: true };
    }
  }
  const perLine = Math.max(1, Math.floor(box.w / (minSize * ADVANCE)));
  return { lines: wrap(text, perLine), fontSize: minSize, fits: false };
}

function wrap(text: string, perLine: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= perLine || !cur) cur = next;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

interface Regions {
  text: Box;
  packshot: Box;
  badge: Box;
  cta: Box;
  logo: Box;
  disclaimer: Box;
}

function regions(layout: LayoutKey, W: number, H: number, m: number): Regions {
  const inner = { x: m, y: m, w: W - 2 * m, h: H - 2 * m };
  const logo = { x: inner.x, y: inner.y, w: 200, h: 70 };
  const disclaimer = { x: inner.x, y: H - m - 40, w: inner.w, h: 40 };
  if (layout === "hero_center") {
    return {
      logo,
      text: { x: inner.x, y: inner.y + 90, w: inner.w, h: H * 0.24 },
      packshot: { x: W * 0.22, y: inner.y + 90 + H * 0.26, w: W * 0.56, h: H * 0.42 },
      badge: { x: W - m - 230, y: inner.y, w: 230, h: 80 },
      cta: { x: W / 2 - 220, y: H - m - 40 - 100, w: 440, h: 88 },
      disclaimer,
    };
  }
  const textLeft = layout === "hero_right";
  const half = inner.w * 0.5;
  return {
    logo,
    text: { x: textLeft ? inner.x : inner.x + half + 20, y: inner.y + 110, w: half - 20, h: H * 0.42 },
    packshot: { x: textLeft ? inner.x + half : inner.x, y: inner.y + 90, w: half, h: H - 2 * m - 230 },
    badge: { x: textLeft ? inner.x : inner.x + half + 20, y: inner.y + 110 + H * 0.44, w: 280, h: 80 },
    cta: { x: textLeft ? inner.x : inner.x + half + 20, y: H - m - 40 - 110, w: Math.min(half - 20, 420), h: 88 },
    disclaimer,
  };
}

/** Fit an asset of (aw, ah) inside box, centred, aspect preserved. */
export function containBox(box: Box, aw: number, ah: number): Box {
  const s = Math.min(box.w / aw, box.h / ah);
  const w = aw * s;
  const h = ah * s;
  return { x: round(box.x + (box.w - w) / 2), y: round(box.y + (box.h - h) / 2), w: round(w), h: round(h) };
}

const round = (n: number) => Math.round(n * 100) / 100;

export function composePoster(input: ComposeInput): ComposeResult {
  const { spec, tokens } = input;
  const { width: W, height: H } = FORMAT_SIZES[input.format];
  const m = Math.round(W * 0.06);
  const R = regions(spec.layout, W, H, m);
  const emphasis = color(tokens, spec.palette);
  const ink = color(tokens, "text");
  const font = escapeXml(tokens.fonts?.heading ?? "Inter, Arial, Helvetica, sans-serif");
  const bodyFont = escapeXml(tokens.fonts?.body ?? tokens.fonts?.heading ?? "Inter, Arial, Helvetica, sans-serif");

  // background
  let bgColor = color(tokens, "background");
  let bg = "";
  const defs: string[] = [];
  if (spec.background.startsWith("solid:")) {
    bgColor = color(tokens, spec.background.slice(6));
    bg = `<rect width="${W}" height="${H}" fill="${bgColor}"/>`;
  } else if (spec.background.startsWith("gradient:")) {
    const [a, b] = spec.background.slice(9).split("-");
    bgColor = color(tokens, a);
    defs.push(
      `<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${color(tokens, a)}"/><stop offset="1" stop-color="${color(tokens, b)}"/></linearGradient>`,
    );
    bg = `<rect width="${W}" height="${H}" fill="url(#bg)"/>`;
  } else if (spec.background.startsWith("generated:")) {
    bg = `<rect width="${W}" height="${H}" fill="${bgColor}"/>` +
      (input.backgroundHref
        ? `<image href="${escapeXml(input.backgroundHref)}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice" data-role="generated-background"/>`
        : "");
  } else {
    bg = `<rect width="${W}" height="${H}" fill="${bgColor}"/>`;
  }
  // text colour flips to white on dark grounds
  const textColor = luminance(bgColor) < 0.4 ? "#FFFFFF" : ink;

  const texts: TextBlock[] = [];
  const parts: string[] = [];
  const addText = (
    slot: TextBlock["slot"],
    opt: CopyOption | null,
    box: Box,
    maxLines: number,
    start: number,
    min: number,
    fill: string,
    weight: number,
    family: string,
    anchor: "start" | "middle" = "start",
  ) => {
    if (!opt || !opt.text.trim()) return;
    const f = fitText(opt.text, box, maxLines, start, min);
    texts.push({ slot, text: opt.text, lines: f.lines, fontSize: f.fontSize, box, fits: f.fits, color: fill, claimId: opt.claim_id, fixture: !!opt.fixture });
    const x = anchor === "middle" ? box.x + box.w / 2 : box.x;
    const tspans = f.lines
      .map((l, i) => `<tspan x="${round(x)}" dy="${i === 0 ? 0 : round(f.fontSize * 1.15)}">${escapeXml(l)}</tspan>`)
      .join("");
    const y = maxLines === 1 ? box.y + box.h / 2 + f.fontSize * 0.35 : box.y + f.fontSize;
    parts.push(
      `<text data-slot="${slot}" x="${round(x)}" y="${round(y)}" font-family="${family}" font-size="${f.fontSize}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${tspans}</text>`,
    );
  };

  const center = spec.layout === "hero_center";
  // copy flows top-down: each block starts where the previous one ended
  const headlineBox = { ...R.text, h: R.text.h * (spec.subhead ? 0.66 : 1) };
  addText("headline", spec.headline, headlineBox, 3, center ? 84 : 76, 40, textColor, 800, font, center ? "middle" : "start");
  const used = (t: TextBlock | undefined) => (t ? t.lines.length * t.fontSize * 1.15 : 0);
  let cursorY = R.text.y + used(texts.find((t) => t.slot === "headline")) + 28;
  if (spec.subhead) {
    const sub = { x: R.text.x, y: cursorY, w: R.text.w, h: R.text.y + R.text.h - cursorY };
    addText("subhead", spec.subhead, sub, 3, 40, 26, textColor, 500, bodyFont, center ? "middle" : "start");
    cursorY = sub.y + used(texts.find((t) => t.slot === "subhead")) + 36;
  }
  if (spec.badge) {
    const badge = center ? R.badge : { ...R.badge, y: Math.min(cursorY, R.cta.y - R.badge.h - 30) };
    parts.push(`<rect data-slot="badge-bg" x="${badge.x}" y="${round(badge.y)}" width="${badge.w}" height="${badge.h}" rx="40" fill="${color(tokens, "accent")}"/>`);
    addText("badge", spec.badge, { x: badge.x + 20, y: badge.y + 12, w: badge.w - 40, h: badge.h - 20 }, 1, 34, 22, "#111111", 800, font, "middle");
  }
  parts.push(`<rect data-slot="cta-bg" x="${R.cta.x}" y="${R.cta.y}" width="${R.cta.w}" height="${R.cta.h}" rx="44" fill="${emphasis}"/>`);
  addText("cta", spec.cta, { x: R.cta.x + 24, y: R.cta.y + 18, w: R.cta.w - 48, h: R.cta.h - 28 }, 1, 38, 24, luminance(emphasis) < 0.4 ? "#FFFFFF" : "#111111", 700, font, "middle");
  if (input.disclaimer) {
    addText("disclaimer", { text: input.disclaimer, claim_id: null }, R.disclaimer, 2, 20, 14, textColor, 400, bodyFont);
  }

  const pb = containBox(R.packshot, input.packshot.width, input.packshot.height);
  const packshot = `<image data-role="packshot" data-asset-sha256="${input.packshot.sha256}" href="${escapeXml(input.packshot.href)}" x="${pb.x}" y="${pb.y}" width="${pb.w}" height="${pb.h}" preserveAspectRatio="xMidYMid meet"/>`;
  const logo = input.logo
    ? (() => {
        const lb = containBox(R.logo, input.logo.width, input.logo.height);
        return `<image data-role="logo" data-asset-sha256="${input.logo.sha256}" href="${escapeXml(input.logo.href)}" x="${lb.x}" y="${lb.y}" width="${lb.w}" height="${lb.h}" preserveAspectRatio="xMidYMid meet"/>`;
      })()
    : "";
  const watermark = input.fixtureWatermark
    ? `<text data-role="fixture-watermark" x="${W / 2}" y="${H / 2}" font-family="Arial" font-size="${Math.round(W / 12)}" font-weight="800" fill="#D0021B" fill-opacity="0.18" text-anchor="middle" transform="rotate(-30 ${W / 2} ${H / 2})">FIXTURE — NOT FOR LAUNCH</text>`
    : "";

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" data-method="${COMPOSE_METHOD_VERSION}">` +
    (defs.length ? `<defs>${defs.join("")}</defs>` : "") +
    bg +
    packshot +
    logo +
    parts.join("") +
    watermark +
    `</svg>`;

  return { svg, width: W, height: H, format: input.format, packshotBox: pb, packshotSha256: input.packshot.sha256, backgroundColor: bgColor, texts, safeMargin: m };
}

/** WCAG relative luminance of #RRGGBB. */
export function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
