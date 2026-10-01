/**
 * In-memory JobQueue with the SAME semantics as the proposed SQL RPCs
 * (creative_claim_jobs / complete_job / fail_job / record_qa /
 * advance_stage in supabase/reference/creative_lab_v1.sql). Used by tests
 * and the no-paid-call fixture pipeline; supabase/tests/creative_lab.sql
 * is the authority on the real behaviour.
 */
import type { BatchPlan, VariantSpec } from "./planner";
import type { QaCheck } from "./qa";
import type { BatchStatus, GenerationStatus, QaStatus, ReviewStatus } from "./types";
import type { ClaimedJob, CompleteResult, JobQueue } from "./worker";

/** numeric(14,4) semantics: money never accumulates float dust */
const r4 = (n: number) => Math.round(n * 1e4) / 1e4;

export interface MemCandidate {
  id: number;
  slot_index: number;
  family_index: number;
  spec: VariantSpec;
  input_sha256: string;
  generation_status: GenerationStatus;
  qa_status: QaStatus;
  review_status: ReviewStatus;
  output_sha256: string | null;
  output_ref: string | null;
  cost_amount: number | null;
  duplicate_of: number | null;
  qa: QaCheck[];
}

interface MemJob {
  id: number;
  candidate_id: number;
  status: "queued" | "leased" | "succeeded" | "dead";
  attempts: number;
  max_attempts: number;
  estimated_cost: number;
  reserved_cost: number;
  lease_owner: string | null;
  lease_expires_at: number | null;
  last_error: string | null;
}

export interface MemBatch {
  id: number;
  status: BatchStatus;
  stages: number[];
  stage_limit: number;
  requested: number;
  budget: number;
  reserved: number;
  spent: number;
  context_manifest_id: number;
  provider: string;
  model: string;
}

export class MemoryJobQueue implements JobQueue {
  batch: MemBatch;
  candidates: MemCandidate[] = [];
  jobs: MemJob[] = [];
  now: () => number;

  constructor(plan: BatchPlan, opts: { budget: number; contextManifestId: number; provider: string; model: string; now?: () => number }) {
    this.now = opts.now ?? (() => Date.now());
    const seen = new Set<string>();
    let id = 1;
    for (const f of plan.families) {
      for (const v of f.variants) {
        if (seen.has(v.input_sha256)) throw new Error("duplicate input_sha256 in plan");
        seen.add(v.input_sha256);
        this.candidates.push({
          id,
          slot_index: v.slot_index,
          family_index: f.index,
          spec: v.spec,
          input_sha256: v.input_sha256,
          generation_status: "queued",
          qa_status: "pending",
          review_status: "pending",
          output_sha256: null,
          output_ref: null,
          cost_amount: null,
          duplicate_of: null,
          qa: [],
        });
        this.jobs.push({
          id,
          candidate_id: id,
          status: "queued",
          attempts: 0,
          max_attempts: plan.max_attempts,
          estimated_cost: plan.estimated_cost_per_candidate,
          reserved_cost: 0,
          lease_owner: null,
          lease_expires_at: null,
          last_error: null,
        });
        id++;
      }
    }
    this.candidates.sort((a, b) => a.slot_index - b.slot_index);
    const requested = this.candidates.length;
    this.batch = {
      id: 1,
      status: "running",
      stages: plan.stages,
      stage_limit: Math.min(plan.stages[0] ?? requested, requested),
      requested,
      budget: opts.budget,
      reserved: 0,
      spent: 0,
      context_manifest_id: opts.contextManifestId,
      provider: opts.provider,
      model: opts.model,
    };
  }

  private cand(id: number) {
    return this.candidates.find((c) => c.id === id)!;
  }

  private refresh() {
    const b = this.batch;
    if (b.status !== "running") return;
    const open = this.jobs.some((j) => {
      const c = this.cand(j.candidate_id);
      return c.slot_index < b.stage_limit && (j.status === "queued" || j.status === "leased");
    });
    if (!open) b.status = b.stage_limit >= b.requested ? "completed" : "awaiting_review";
  }

  async claim(workerId: string, limit: number, leaseSeconds: number): Promise<ClaimedJob[]> {
    const b = this.batch;
    for (const j of this.jobs) {
      if (j.status === "leased" && j.lease_expires_at! < this.now()) {
        b.spent = r4(b.spent + j.reserved_cost);
        b.reserved = r4(Math.max(b.reserved - j.reserved_cost, 0));
        j.reserved_cost = 0;
        j.lease_owner = null;
        j.lease_expires_at = null;
        j.last_error = "lease_expired";
        const dead = j.attempts >= j.max_attempts;
        j.status = dead ? "dead" : "queued";
        this.cand(j.candidate_id).generation_status = dead ? "failed" : "queued";
        if (dead) this.refresh();
      }
    }
    const out: ClaimedJob[] = [];
    const ready = this.jobs
      .filter((j) => j.status === "queued" && this.cand(j.candidate_id).slot_index < b.stage_limit)
      .sort((x, y) => this.cand(x.candidate_id).slot_index - this.cand(y.candidate_id).slot_index)
      .slice(0, Math.max(limit, 0));
    for (const j of ready) {
      if (b.status !== "running") continue;
      if (r4(b.spent + b.reserved + j.estimated_cost) > b.budget) {
        b.status = "paused_budget";
        continue;
      }
      b.reserved = r4(b.reserved + j.estimated_cost);
      j.status = "leased";
      j.attempts += 1;
      j.reserved_cost = j.estimated_cost;
      j.lease_owner = workerId;
      j.lease_expires_at = this.now() + leaseSeconds * 1000;
      const c = this.cand(j.candidate_id);
      c.generation_status = "generating";
      out.push({
        job_id: j.id,
        candidate_id: c.id,
        batch_id: b.id,
        slot_index: c.slot_index,
        variant_spec: c.spec,
        context_manifest_id: b.context_manifest_id,
        provider: b.provider,
        model: b.model,
      });
    }
    return out;
  }

  async complete(jobId: number, workerId: string, r: CompleteResult) {
    const j = this.jobs.find((x) => x.id === jobId)!;
    const c = this.cand(j.candidate_id);
    if (j.status === "succeeded" && c.output_sha256 === r.output_sha256) return { generation_status: c.generation_status };
    if (j.status !== "leased" || j.lease_owner !== workerId) throw new Error("creative_stale_lease");
    const dup = this.candidates.find((o) => o.id !== c.id && o.output_sha256 === r.output_sha256);
    this.batch.spent = r4(this.batch.spent + r.cost_amount);
    this.batch.reserved = r4(Math.max(this.batch.reserved - j.reserved_cost, 0));
    j.status = "succeeded";
    j.reserved_cost = 0;
    j.lease_owner = null;
    c.generation_status = dup ? "duplicate" : "generated";
    c.duplicate_of = dup?.id ?? null;
    c.output_sha256 = r.output_sha256;
    c.output_ref = r.output_ref;
    c.cost_amount = r.cost_amount;
    this.refresh();
    return { generation_status: c.generation_status };
  }

  async fail(jobId: number, workerId: string, error: string, cost: number) {
    const j = this.jobs.find((x) => x.id === jobId)!;
    if (j.status !== "leased" || j.lease_owner !== workerId) throw new Error("creative_stale_lease");
    const dead = j.attempts >= j.max_attempts;
    this.batch.spent = r4(this.batch.spent + cost);
    this.batch.reserved = r4(Math.max(this.batch.reserved - j.reserved_cost, 0));
    j.status = dead ? "dead" : "queued";
    j.reserved_cost = 0;
    j.lease_owner = null;
    j.lease_expires_at = null;
    j.last_error = error;
    this.cand(j.candidate_id).generation_status = dead ? "failed" : "queued";
    this.refresh();
    return { dead };
  }

  async recordQa(candidateId: number, checks: QaCheck[]) {
    const c = this.cand(candidateId);
    if (c.generation_status !== "generated") throw new Error("creative_bad_state");
    c.qa = checks;
    c.qa_status = checks.every((x) => x.passed) ? "passed" : "failed";
  }

  /** Human decision (the UI/RPC owns who may do this). */
  review(candidateId: number, decision: Exclude<ReviewStatus, "pending">) {
    const c = this.cand(candidateId);
    if (c.generation_status !== "generated" || c.qa_status !== "passed") throw new Error("creative_bad_state");
    c.review_status = decision;
  }

  advanceStage() {
    const b = this.batch;
    if (b.status !== "awaiting_review") throw new Error(`creative_bad_state: batch is ${b.status}`);
    const pending = this.candidates.filter(
      (c) =>
        c.slot_index < b.stage_limit &&
        (c.generation_status === "queued" ||
          c.generation_status === "generating" ||
          (c.generation_status === "generated" && (c.qa_status === "pending" || (c.qa_status === "passed" && c.review_status === "pending")))),
    ).length;
    if (pending > 0) throw new Error(`creative_stage_unreviewed: ${pending}`);
    const next = b.stages.find((s) => s > b.stage_limit) ?? b.requested;
    b.stage_limit = Math.min(next, b.requested);
    b.status = "running";
  }

  resume(newBudget: number) {
    if (this.batch.status !== "paused_budget") throw new Error("creative_bad_state");
    this.batch.budget = Math.max(this.batch.budget, newBudget);
    this.batch.status = "running";
  }

  /** test helper: simulate a crashed worker */
  expireLease(jobId: number) {
    const j = this.jobs.find((x) => x.id === jobId)!;
    j.lease_expires_at = this.now() - 1;
  }
}
