/**
 * Production generation worker entry (ADR-0010 §7) — PROPOSED target:
 * a Cloud Run job on a schedule, never a web request. Not deployed.
 *
 * Wires the runtime-agnostic core (apps/web/src/lib/creative-lab/worker.ts)
 * to the proposed Supabase RPCs with the service-role key, and to GCS for
 * immutable outputs. Blocked steps, surfaced instead of faked:
 *   - creative schema not applied            → RPC 404s
 *   - GCS media bucket not provisioned       → BlobStore throws
 *   - image provider not chosen / no adapter → ProviderUnavailableError
 */
import { createImageProvider } from "../../apps/web/src/lib/creative-lab/providers.ts";
import { runTick, type BlobStore, type JobQueue } from "../../apps/web/src/lib/creative-lab/worker.ts";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");

async function rpc<T>(fn: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: key!, authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${fn}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
}

const queue: JobQueue = {
  claim: (workerId, limit, leaseSeconds) => rpc("creative_claim_jobs", { p_worker: workerId, p_limit: limit, p_lease_seconds: leaseSeconds }),
  complete: (jobId, workerId, result) => rpc("creative_complete_job", { p_job_id: jobId, p_worker: workerId, p_result: result }),
  fail: (jobId, workerId, error, cost) => rpc("creative_fail_job", { p_job_id: jobId, p_worker: workerId, p_error: error, p_cost: cost }),
  recordQa: async (candidateId, checks) => {
    await rpc("creative_record_qa", { p_candidate_id: candidateId, p_checks: checks });
  },
};

const store: BlobStore = {
  put: async () => {
    throw new Error("BLOCKED: GCS creative media bucket not provisioned (ADR-0010 release step R3)");
  },
};

const provider = createImageProvider({
  image_provider: process.env.CREATIVE_IMAGE_PROVIDER ?? null,
  image_model: process.env.CREATIVE_IMAGE_MODEL ?? null,
  provider_data_approved: process.env.CREATIVE_PROVIDER_DATA_APPROVED === "true",
});

const report = await runTick({
  workerId: `worker-${process.env.HOSTNAME ?? "local"}-${process.pid}`,
  queue,
  store,
  provider,
  loadContext: async () => {
    throw new Error("BLOCKED: context loader needs creative_context_for_worker RPC + GCS signed URLs (ADR-0010 release step R3)");
  },
});
console.log(JSON.stringify(report));
