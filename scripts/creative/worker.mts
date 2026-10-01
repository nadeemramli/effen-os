/**
 * Generation worker entry (ADR-0010 §7). Target: a Cloud Run job on a
 * schedule — never a web request. Not deployed yet.
 *
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   service role (RPCs only)
 *   CREATIVE_MEDIA_BUCKET                      GCS bucket for immutable media
 *   CREATIVE_WORKER_LIMIT (default 5)          jobs per tick
 *
 * Per job it reads the immutable context (public.creative_worker_context),
 * resolves the brand's configured provider (OpenAI or fixture) with the key
 * from Vault (public.creative_get_provider_key — never an env var on this
 * path), embeds the authentic packshot bytes, composes, stores the output
 * by SHA-256 in GCS, and reports through the lease-checked RPCs. Budget is
 * reserved by creative_claim_jobs before any paid call.
 *
 * GCS access uses the Cloud Run service identity via the metadata server.
 * Outside GCP (or without CREATIVE_MEDIA_BUCKET) media I/O fails with a
 * precise BLOCKED error and the job is retried/failed — nothing is faked.
 */
import type { AssetRef } from "../../apps/web/src/lib/creative-lab/compose.ts";
import { createImageProvider, type ProviderConfig } from "../../apps/web/src/lib/creative-lab/providers.ts";
import type { BrandTokens } from "../../apps/web/src/lib/creative-lab/types.ts";
import { runTick, type BlobStore, type GenerationContext, type JobQueue } from "../../apps/web/src/lib/creative-lab/worker.ts";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
const bucket = process.env.CREATIVE_MEDIA_BUCKET ?? null;

async function rpc<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: key!, authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${(await res.text()).slice(0, 300)}`);
  return (await res.json()) as T;
}

/* ---------- GCS via the Cloud Run identity ---------- */

let gcsToken: { value: string; expires: number } | null = null;
async function gcsAccessToken(): Promise<string> {
  if (gcsToken && gcsToken.expires > Date.now() + 60_000) return gcsToken.value;
  const res = await fetch("http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token", {
    headers: { "Metadata-Flavor": "Google" },
  }).catch(() => null);
  if (!res?.ok) throw new Error("BLOCKED: no GCP service identity (run as the Cloud Run job, ADR-0010 release step R3)");
  const j = (await res.json()) as { access_token: string; expires_in: number };
  gcsToken = { value: j.access_token, expires: Date.now() + j.expires_in * 1000 };
  return gcsToken.value;
}

function parseGs(ref: string): { bucket: string; object: string } {
  const m = ref.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!m) throw new Error(`not a gs:// ref: ${ref}`);
  return { bucket: m[1], object: m[2] };
}

async function readAsset(ref: string): Promise<Uint8Array> {
  const { bucket: b, object } = parseGs(ref);
  const res = await fetch(`https://storage.googleapis.com/storage/v1/b/${b}/o/${encodeURIComponent(object)}?alt=media`, {
    headers: { authorization: `Bearer ${await gcsAccessToken()}` },
  });
  if (!res.ok) throw new Error(`gcs read ${ref}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

const EXT: Record<string, string> = { "image/png": "png", "image/svg+xml": "svg", "image/jpeg": "jpg", "image/webp": "webp" };

const store: BlobStore = {
  async put(bytes, contentType, sha256) {
    if (!bucket) throw new Error("BLOCKED: CREATIVE_MEDIA_BUCKET not set (ADR-0010 release step R3)");
    const object = `creative/sha256/${sha256}.${EXT[contentType] ?? "bin"}`;
    // ifGenerationMatch=0: content-addressed objects are written once, never overwritten
    const res = await fetch(
      `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&ifGenerationMatch=0&name=${encodeURIComponent(object)}`,
      { method: "POST", headers: { authorization: `Bearer ${await gcsAccessToken()}`, "content-type": contentType }, body: bytes },
    );
    if (!res.ok && res.status !== 412) throw new Error(`gcs write ${object}: ${res.status}`); // 412 = already stored
    return `gs://${bucket}/${object}`;
  },
};

/* ---------- context + provider per manifest ---------- */

interface RawContext {
  manifest_sha256: string;
  tokens: BrandTokens;
  assets: Array<{ sha256: string; storage_ref: string | null; mime_type: string | null; width: number | null; height: number | null }>;
  approved_claim_ids: number[];
  max_cost_per_candidate: number | null;
  image_provider: string | null;
  image_model: string | null;
  provider_data_approved: boolean;
  provider_pricing: ProviderConfig["provider_pricing"];
}

const contexts = new Map<number, { raw: RawContext; ctx: GenerationContext }>();
const keys = new Map<string, string | null>();

async function loadContext(manifestId: number): Promise<GenerationContext> {
  const hit = contexts.get(manifestId);
  if (hit) return hit.ctx;
  const raw = await rpc<RawContext>("creative_worker_context", { p_context_manifest_id: manifestId });
  const assets = new Map<string, AssetRef>();
  for (const a of raw.assets) {
    if (!a.storage_ref) throw new Error(`BLOCKED: asset ${a.sha256.slice(0, 12)} has no storage_ref — upload kit media to GCS first (R3/R5)`);
    if (!a.width || !a.height) throw new Error(`asset ${a.sha256.slice(0, 12)} has no dimensions`);
    // embed the authentic bytes so the output is self-contained and its hash covers the packshot
    const bytes = await readAsset(a.storage_ref);
    const b64 = Buffer.from(bytes).toString("base64");
    assets.set(a.sha256, { sha256: a.sha256, href: `data:${a.mime_type ?? "image/png"};base64,${b64}`, width: a.width, height: a.height });
  }
  const ctx: GenerationContext = {
    manifestSha256: raw.manifest_sha256,
    tokens: raw.tokens ?? {},
    assets,
    approvedClaimIds: new Set(raw.approved_claim_ids ?? []),
    disclaimer: null,
    maxCostPerCandidate: raw.max_cost_per_candidate,
    fixture: raw.image_provider === "fixture",
  };
  contexts.set(manifestId, { raw, ctx });
  if (raw.image_provider && raw.image_provider !== "fixture" && !keys.has(raw.image_provider)) {
    keys.set(raw.image_provider, await rpc<string | null>("creative_get_provider_key", { p_provider: raw.image_provider }));
  }
  return ctx;
}

const queue: JobQueue = {
  claim: (workerId, limit, leaseSeconds) => rpc("creative_claim_jobs", { p_worker: workerId, p_limit: limit, p_lease_seconds: leaseSeconds }),
  complete: (jobId, workerId, result) => rpc("creative_complete_job", { p_job_id: jobId, p_worker: workerId, p_result: result }),
  fail: (jobId, workerId, error, cost) => rpc("creative_fail_job", { p_job_id: jobId, p_worker: workerId, p_error: error, p_cost: cost }),
  recordQa: async (candidateId, checks) => {
    await rpc("creative_record_qa", { p_candidate_id: candidateId, p_checks: checks });
  },
};

const report = await runTick(
  {
    workerId: `worker-${process.env.HOSTNAME ?? "local"}-${process.pid}`,
    queue,
    store,
    loadContext,
    provider: (_ctx, job) => {
      const raw = contexts.get(job.context_manifest_id)!.raw;
      return createImageProvider(
        {
          image_provider: raw.image_provider,
          image_model: raw.image_model,
          provider_data_approved: raw.provider_data_approved,
          provider_pricing: raw.provider_pricing,
        },
        { apiKey: raw.image_provider ? keys.get(raw.image_provider) : null },
      );
    },
  },
  Number(process.env.CREATIVE_WORKER_LIMIT ?? 5),
);
// errors are reported per job; never print keys or context
console.log(JSON.stringify(report));
