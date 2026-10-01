/**
 * Generation worker core (ADR-0010 §7). Runtime-agnostic: the production
 * entry point (scripts/creative/worker.ts → Cloud Run job, proposed) wires
 * a Supabase RPC queue, GCS blob store and a configured provider; tests
 * and fixture runs wire the in-memory queue and fixture provider.
 *
 * One tick: claim (lease + budget reservation happen in the queue) →
 * load the immutable context → optional supporting background from the
 * provider → deterministic composition → hash → store → complete → QA.
 * Any error fails the job with the cost actually incurred; the queue
 * retries up to max_attempts. A crash mid-job is recovered by lease expiry.
 */
import { composePoster, type AssetRef } from "./compose";
import { sha256Hex } from "./hash";
import type { VariantSpec } from "./planner";
import type { ImageProvider } from "./providers";
import { runPosterQa, type QaCheck } from "./qa";
import type { BrandTokens } from "./types";

export interface ClaimedJob {
  job_id: number;
  candidate_id: number;
  batch_id: number;
  slot_index: number;
  variant_spec: VariantSpec;
  context_manifest_id: number;
  provider: string;
  model: string;
}

export interface CompleteResult {
  output_sha256: string;
  output_ref: string;
  provider: string;
  model: string;
  prompt: string;
  config: Record<string, unknown>;
  cost_amount: number;
}

export interface JobQueue {
  claim(workerId: string, limit: number, leaseSeconds: number): Promise<ClaimedJob[]>;
  complete(jobId: number, workerId: string, result: CompleteResult): Promise<{ generation_status: string }>;
  fail(jobId: number, workerId: string, error: string, cost: number): Promise<{ dead: boolean }>;
  recordQa(candidateId: number, checks: QaCheck[]): Promise<void>;
}

export interface GenerationContext {
  manifestSha256: string;
  tokens: BrandTokens;
  assets: Map<string, AssetRef>; // sha256 → resolvable ref
  approvedClaimIds: Set<number>;
  disclaimer: string | null;
  maxCostPerCandidate: number | null;
  fixture: boolean;
}

export interface BlobStore {
  put(bytes: Uint8Array, contentType: string, sha256: string): Promise<string>; // returns ref
}

export interface WorkerDeps {
  workerId: string;
  queue: JobQueue;
  loadContext(manifestId: number): Promise<GenerationContext>;
  store: BlobStore;
  provider: ImageProvider;
  leaseSeconds?: number;
}

export interface TickReport {
  claimed: number;
  completed: number;
  duplicates: number;
  failed: number;
  qaFailed: number;
  errors: string[];
}

export async function runTick(deps: WorkerDeps, limit = 5): Promise<TickReport> {
  const report: TickReport = { claimed: 0, completed: 0, duplicates: 0, failed: 0, qaFailed: 0, errors: [] };
  const jobs = await deps.queue.claim(deps.workerId, limit, deps.leaseSeconds ?? 300);
  report.claimed = jobs.length;
  for (const job of jobs) {
    let cost = 0;
    try {
      const ctx = await deps.loadContext(job.context_manifest_id);
      const spec = job.variant_spec;
      const packshot = ctx.assets.get(spec.packshot_sha256);
      if (!packshot) throw new Error(`packshot ${spec.packshot_sha256} not in context manifest`);

      let backgroundHref: string | null = null;
      let prompt = "";
      if (spec.background.startsWith("generated:")) {
        prompt = `Supporting background only, no product, no text, no packaging: ${spec.background.slice(10)}`;
        const req = {
          prompt,
          width: 1080,
          height: 1350,
          seed: `${ctx.manifestSha256}:${job.slot_index}`,
          palette: Object.values(ctx.tokens.colors ?? {}).filter((x): x is string => !!x),
        };
        const est = deps.provider.estimateCost(req);
        if (ctx.maxCostPerCandidate != null && est > ctx.maxCostPerCandidate) {
          throw new Error(`estimated cost ${est} exceeds per-candidate cap ${ctx.maxCostPerCandidate}; provider not called`);
        }
        const bg = await deps.provider.generateBackground(req);
        cost += bg.costAmount;
        const bgSha = await sha256Hex(bg.bytes);
        backgroundHref = await deps.store.put(bg.bytes, bg.contentType, bgSha);
      }

      // the primary format is the candidate; other formats are resizes of it
      const format = spec.formats[0];
      const composed = composePoster({
        spec,
        format,
        tokens: ctx.tokens,
        packshot,
        logo: ctx.tokens.logo_asset_sha256 ? ctx.assets.get(ctx.tokens.logo_asset_sha256) ?? null : null,
        backgroundHref,
        disclaimer: ctx.disclaimer,
        fixtureWatermark: ctx.fixture,
      });
      const bytes = new TextEncoder().encode(composed.svg);
      const sha = await sha256Hex(bytes);
      const ref = await deps.store.put(bytes, "image/svg+xml", sha);
      const done = await deps.queue.complete(job.job_id, deps.workerId, {
        output_sha256: sha,
        output_ref: ref,
        provider: deps.provider.id,
        model: deps.provider.model,
        prompt,
        config: { compose: composed.format, layout: spec.layout, background: spec.background },
        cost_amount: cost,
      });
      if (done.generation_status === "duplicate") {
        report.duplicates += 1;
        continue;
      }
      report.completed += 1;
      const checks = runPosterQa(composed, {
        manifestAssetShas: new Set(ctx.assets.keys()),
        approvedClaimIds: ctx.approvedClaimIds,
      });
      await deps.queue.recordQa(job.candidate_id, checks);
      if (!checks.every((c) => c.passed)) report.qaFailed += 1;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      report.errors.push(`job ${job.job_id}: ${msg}`);
      report.failed += 1;
      await deps.queue.fail(job.job_id, deps.workerId, msg, cost);
    }
  }
  return report;
}
