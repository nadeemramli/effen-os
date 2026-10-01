/**
 * Brand-kit import CLI (Slice 1, ADR-0010). DRY-RUN BY DEFAULT.
 *
 *   pnpm dlx tsx scripts/creative/import-brand-kit.mts --root /path/to/creative --brand adipocyde
 *   pnpm dlx tsx scripts/creative/import-brand-kit.mts --root /path/to/creative --all --out report.json
 *
 * Reads <root>/<brand>/ (tokens.json, guidelines.md, raw-materials/*,
 * SHA256SUMS / *.sha256 manifests, sources/, evidence/), hashes every
 * media file, verifies supplied checksums and prints the payload that
 * public.creative_import_brand_kit would receive. Nothing leaves the
 * machine unless --apply is given AND SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY are set; even then only metadata + hashes are
 * sent (bytes go to GCS in a separate, not-yet-provisioned upload step)
 * and the kit lands as a DRAFT version.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { buildKitPayload, type KitFile, type KitImportReport } from "../../apps/web/src/lib/creative-lab/kit.ts";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};

async function walk(dir: string, base = dir): Promise<KitFile[]> {
  const out: KitFile[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith(".")) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p, base)));
    else out.push({ path: relative(base, p).split(sep).join("/"), bytes: new Uint8Array(await readFile(p)) });
  }
  return out;
}

async function apply(report: KitImportReport) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("--apply needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  if (report.mismatches.length) throw new Error(`refusing to apply: ${report.mismatches.length} checksum mismatches`);
  const res = await fetch(`${url}/rest/v1/rpc/creative_import_brand_kit`, {
    method: "POST",
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ p_payload: report.payload }),
  });
  if (!res.ok) throw new Error(`creative_import_brand_kit failed: ${res.status} ${await res.text()}`);
  return res.json();
}

const root = opt("root");
if (!root) {
  console.error("usage: --root <creative dir> (--brand <slug> | --all) [--out file.json] [--apply]");
  process.exit(2);
}
const brands = flag("all")
  ? (await readdir(root, { withFileTypes: true })).filter((d) => d.isDirectory() && !d.name.startsWith(".")).map((d) => d.name)
  : [opt("brand")!].filter(Boolean);
if (brands.length === 0) {
  console.error("no brand selected");
  process.exit(2);
}

const summary = [];
for (const brand of brands.sort()) {
  const files = await walk(join(root, brand));
  const report = await buildKitPayload({ brandSlug: brand, sourceRoot: `${brand}/`, files });
  const packshots = report.payload.assets.filter((a) => a.role === "packshot").length;
  const line = {
    brand,
    completeness: report.payload.completeness,
    provenance: report.payload.provenance,
    assets: report.payload.assets.length,
    packshots,
    verified: report.verified,
    unverified: report.unverified.length,
    mismatches: report.mismatches.length,
    duplicate_groups: report.duplicates.length,
    manifest_sha256: report.payload.manifest_sha256,
    warnings: report.warnings,
  };
  summary.push({ ...line, report });
  console.log(JSON.stringify(line));
  if (flag("apply")) console.log("  applied:", JSON.stringify(await apply(report)));
}
if (opt("out")) await writeFile(opt("out")!, JSON.stringify(summary, null, 2));
if (!flag("apply")) console.log("dry run — nothing was sent. Re-run with --apply to import as DRAFT kits.");
