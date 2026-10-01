/**
 * Brand-kit import payload (Slice 1). Pure: callers hand in file bytes;
 * scripts/creative/import-brand-kit.ts does the filesystem walk.
 *
 * Idempotency: manifest_sha256 hashes the sorted (path, sha256) list plus
 * tokens/guidelines, so re-importing an unchanged folder is a no-op in
 * public.creative_import_brand_kit, and identical bytes under different
 * names collapse to one raw asset. Supplied SHA-256 manifests (from the
 * original ZIPs) are VERIFIED, never trusted blindly. Kits always import
 * as drafts; provenance/completeness are recorded, not promoted.
 */
import { canonicalJson, sha256Hex } from "./hash";
import type { BrandTokens, KitProvenance } from "./types";

export interface KitFile {
  path: string; // relative to the brand folder, forward slashes
  bytes: Uint8Array;
}

export type AssetRole = "packshot" | "logo" | "reference" | "evidence" | "archive" | "other";

export interface KitAsset {
  sha256: string;
  source_path: string;
  filename: string;
  mime_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  role: AssetRole;
  origin: "owner_supplied" | "website" | "fixture";
  storage_ref: string | null;
}

export interface KitPayload {
  brand_slug: string;
  provenance: KitProvenance;
  completeness: "detailed" | "incomplete";
  manifest_sha256: string;
  source_root: string;
  tokens: BrandTokens;
  guidelines_md: string | null;
  assets: KitAsset[];
}

export interface KitImportReport {
  payload: KitPayload;
  verified: number; // files whose supplied checksum matched
  unverified: string[]; // media without a supplied checksum
  mismatches: Array<{ path: string; expected: string; actual: string }>;
  duplicates: Array<{ sha256: string; paths: string[] }>;
  skipped: string[];
  warnings: string[];
}

const MEDIA = /\.(png|jpe?g|webp|svg|pdf|zip)$/i;

export function mimeOf(path: string): string {
  const ext = path.toLowerCase().split(".").pop() ?? "";
  return (
    { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf", zip: "application/zip" } as Record<string, string>
  )[ext] ?? "application/octet-stream";
}

export function roleOf(path: string): AssetRole {
  const p = path.toLowerCase();
  if (p.endsWith(".zip")) return "archive";
  if (p.startsWith("raw-materials/")) return "packshot";
  if (/(^|\/)logo/.test(p)) return "logo";
  if (p.startsWith("evidence/")) return "evidence";
  if (p.startsWith("sources/") || p.startsWith("references/")) return "reference";
  return "other";
}

/** PNG IHDR width/height, or null when not a PNG. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } | null {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24 || !sig.every((b, i) => bytes[i] === b)) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: dv.getUint32(16), height: dv.getUint32(20) };
}

/** Parse `sha256sum`-style lines: "<hex>  <path>" (also "<hex> *<path>"). */
export function parseChecksums(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().match(/^([0-9a-fA-F]{64})\s+\*?(.+)$/);
    if (m) out.set(m[2].trim().replace(/^\.\//, ""), m[1].toLowerCase());
  }
  return out;
}

export async function buildKitPayload(opts: {
  brandSlug: string;
  sourceRoot: string;
  files: KitFile[];
  provenance?: KitProvenance;
  origin?: KitAsset["origin"];
}): Promise<KitImportReport> {
  const dec = new TextDecoder();
  const byPath = new Map(opts.files.map((f) => [f.path, f]));
  const warnings: string[] = [];

  let tokens: BrandTokens = {};
  const tokFile = byPath.get("tokens.json");
  if (tokFile) {
    try {
      tokens = JSON.parse(dec.decode(tokFile.bytes)) as BrandTokens;
    } catch {
      warnings.push("tokens.json is not valid JSON — imported without tokens");
    }
  }
  const guide = ["guidelines.md", "brand-guidelines.md", "GUIDELINES.md"].map((p) => byPath.get(p)).find(Boolean);
  const guidelines = guide ? dec.decode(guide.bytes) : null;

  // every supplied checksum file in the folder, keyed by path relative to the brand root
  const expected = new Map<string, string>();
  for (const f of opts.files) {
    if (/(^|\/)(SHA256SUMS|.*\.sha256(\.txt)?|.*sha256.*manifest.*\.txt)$/i.test(f.path)) {
      const dir = f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/") + 1) : "";
      for (const [p, h] of parseChecksums(dec.decode(f.bytes))) expected.set(dir + p, h);
    }
  }

  const assets: KitAsset[] = [];
  const mismatches: KitImportReport["mismatches"] = [];
  const unverified: string[] = [];
  const skipped: string[] = [];
  const shaPaths = new Map<string, string[]>();
  let verified = 0;
  for (const f of [...opts.files].sort((a, b) => a.path.localeCompare(b.path))) {
    if (!MEDIA.test(f.path)) {
      if (f.path !== "tokens.json" && f.path !== guide?.path) skipped.push(f.path);
      continue;
    }
    const sha = await sha256Hex(f.bytes);
    const exp = expected.get(f.path);
    if (exp && exp !== sha) {
      mismatches.push({ path: f.path, expected: exp, actual: sha });
      continue; // a corrupted or substituted file is never imported
    }
    if (exp) verified += 1;
    else unverified.push(f.path);
    shaPaths.set(sha, [...(shaPaths.get(sha) ?? []), f.path]);
    const dims = pngSize(f.bytes);
    assets.push({
      sha256: sha,
      source_path: f.path,
      filename: f.path.split("/").pop()!,
      mime_type: mimeOf(f.path),
      byte_size: f.bytes.byteLength,
      width: dims?.width ?? null,
      height: dims?.height ?? null,
      role: roleOf(f.path),
      origin: opts.origin ?? "owner_supplied",
      storage_ref: null, // set by the GCS upload step (blocked until the bucket exists)
    });
  }

  const packshots = assets.filter((a) => a.role === "packshot").length;
  const detailed = !!guidelines && Object.keys(tokens.colors ?? {}).length > 0;
  if (packshots === 0) warnings.push("no packshots under raw-materials/ — brand is not eligible for production");
  if (!detailed) warnings.push("guidelines.md and/or tokens.colors missing — kit marked incomplete");

  const manifest_sha256 = await sha256Hex(
    canonicalJson({ assets: assets.map((a) => [a.source_path, a.sha256]), tokens, guidelines: guidelines ?? null }),
  );
  return {
    payload: {
      brand_slug: opts.brandSlug,
      provenance: opts.provenance ?? (detailed ? "website_derived" : "historical_identity"),
      completeness: detailed ? "detailed" : "incomplete",
      manifest_sha256,
      source_root: opts.sourceRoot,
      tokens,
      guidelines_md: guidelines,
      assets,
    },
    verified,
    unverified,
    mismatches,
    duplicates: [...shaPaths].filter(([, ps]) => ps.length > 1).map(([sha256, paths]) => ({ sha256, paths })),
    skipped,
    warnings,
  };
}
