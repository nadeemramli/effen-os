"use client";

import { useCallback, useMemo, useState } from "react";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { EmptyState, ErrorState, SkeletonTable } from "@/components/states";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLiveQuery } from "@/hooks/use-live-query";
import { useSession } from "@/hooks/use-session";
import { buildFixtureContext, FIXTURE_TOKENS } from "@/lib/creative-lab/fixtures";
import { MemoryJobQueue, type MemCandidate } from "@/lib/creative-lab/memory-queue";
import { planBatch, type BatchPlan, type PlannedFamily } from "@/lib/creative-lab/planner";
import { FixtureImageProvider } from "@/lib/creative-lab/providers";
import { useLabSource } from "@/lib/creative-lab/ui/source";
import { runTick, type TickReport } from "@/lib/creative-lab/worker";
import { RouteGuard } from "@/lib/rbac/guard";
import { fetchCreativeBatches } from "@/lib/supabase/creative-lab";
import { FixtureBanner, NotProvisioned, Pill } from "../_components/lab-banners";

const LANE_TONE = { exploit: "good", adjacent: "warn", explore: "bad" } as const;

interface FixtureRun {
  plan: BatchPlan;
  queue: MemoryJobQueue;
  outputs: Map<string, string>; // sha → svg
  manifestSha256: string;
  reports: TickReport[];
}

async function startFixtureRun(): Promise<FixtureRun> {
  const fx = await buildFixtureContext();
  const plan = await planBatch({
    recipe: fx.recipe,
    recipeVersionId: null,
    manifestSha256: fx.manifestSha256,
    exploreHypotheses: fx.hypotheses,
    estimatedCostPerCandidate: 0,
  });
  const queue = new MemoryJobQueue(plan, { budget: 0, contextManifestId: 0, provider: "fixture", model: "fixture-bg-v1" });
  const outputs = new Map<string, string>();
  const report = await runTick(
    {
      workerId: "browser-fixture",
      queue,
      provider: new FixtureImageProvider(),
      store: {
        put: async (bytes, type, sha) => {
          const text = new TextDecoder().decode(bytes);
          if (type === "image/svg+xml") outputs.set(sha, text);
          return `fixture://${sha}`;
        },
      },
      loadContext: async () => ({
        manifestSha256: fx.manifestSha256,
        tokens: FIXTURE_TOKENS,
        assets: new Map(fx.packshots.map((p) => [p.sha256, p])),
        approvedClaimIds: new Set<number>(),
        disclaimer: null,
        maxCostPerCandidate: 0,
        fixture: true,
      }),
    },
    25,
  );
  return { plan, queue, outputs, manifestSha256: fx.manifestSha256, reports: [report] };
}

const genTone = (s: MemCandidate["generation_status"]) => (s === "generated" ? "good" : s === "failed" ? "bad" : s === "duplicate" ? "warn" : "muted");

function CandidateSheet({ run, candidate, onClose }: { run: FixtureRun; candidate: MemCandidate | null; onClose: () => void }) {
  const family = candidate ? run.plan.families.find((f) => f.index === candidate.family_index) : null;
  const svg = candidate?.output_sha256 ? run.outputs.get(candidate.output_sha256) : null;
  return (
    <Sheet open={!!candidate} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {candidate && family && (
          <>
            <SheetHeader>
              <SheetTitle>Slot {candidate.slot_index} · family {family.index}</SheetTitle>
              <SheetDescription>{family.hypothesis}</SheetDescription>
            </SheetHeader>
            <div className="space-y-4 px-4 pb-6 text-xs">
              {svg && (
                // eslint-disable-next-line @next/next/no-img-element -- local fixture SVG data URI
                <img alt={`Candidate slot ${candidate.slot_index}`} className="w-full rounded border" src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} />
              )}
              <div className="flex flex-wrap gap-1.5">
                <Pill tone={genTone(candidate.generation_status)}>generation: {candidate.generation_status}</Pill>
                <Pill tone={candidate.qa_status === "passed" ? "good" : candidate.qa_status === "failed" ? "bad" : "muted"}>QA: {candidate.qa_status}</Pill>
                <Pill>review: {candidate.review_status}</Pill>
                <Pill>export: not exported</Pill>
                <Pill>launch: not launched</Pill>
              </div>
              <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">Context manifest</dt>
                <dd className="break-all font-mono">{run.manifestSha256}</dd>
                <dt className="text-muted-foreground">Input SHA-256</dt>
                <dd className="break-all font-mono">{candidate.input_sha256}</dd>
                <dt className="text-muted-foreground">Output SHA-256</dt>
                <dd className="break-all font-mono">{candidate.output_sha256 ?? "—"}</dd>
                <dt className="text-muted-foreground">Provider / cost</dt>
                <dd>fixture / {candidate.cost_amount ?? 0} USD</dd>
                <dt className="text-muted-foreground">Changed vs recipe</dt>
                <dd>{Object.entries(candidate.spec.changed).map(([k, v]) => `${k} = ${v.length > 40 ? v.slice(0, 12) + "…" : v}`).join("; ") || "base recipe"}</dd>
                <dt className="text-muted-foreground">Family varies</dt>
                <dd>{family.changed_factors.join(" × ")}</dd>
                <dt className="text-muted-foreground">Held fixed</dt>
                <dd>{family.fixed_factors.join(", ")}</dd>
                <dt className="text-muted-foreground">Formats</dt>
                <dd>{candidate.spec.formats.join(", ")} (resizes of one candidate)</dd>
              </dl>
              <div>
                <div className="mb-1 font-medium">QA checks</div>
                <ul className="space-y-0.5">
                  {candidate.qa.map((q) => (
                    <li key={q.key} className={q.passed ? "" : "text-destructive"}>
                      {q.passed ? "✓" : "✗"} {q.key}
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-muted-foreground">Fixture copy and the fixture watermark fail QA by design, so a fixture candidate can never reach approval.</p>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function FamilyRow({ f, run, onOpen }: { f: PlannedFamily; run: FixtureRun; onOpen: (c: MemCandidate) => void }) {
  const cands = run.queue.candidates.filter((c) => c.family_index === f.index).sort((a, b) => a.slot_index - b.slot_index);
  return (
    <TableRow className="align-top">
      <TableCell className="tnum">{f.index}</TableCell>
      <TableCell>
        <Pill tone={LANE_TONE[f.lane]}>{f.lane}</Pill>
      </TableCell>
      <TableCell className="max-w-[420px] whitespace-normal text-xs">{f.hypothesis}</TableCell>
      <TableCell className="whitespace-normal text-xs">{f.changed_factors.join(" × ")}</TableCell>
      <TableCell>
        <div className="flex gap-1">
          {cands.map((c) => {
            const svg = c.output_sha256 ? run.outputs.get(c.output_sha256) : null;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onOpen(c)}
                className="relative h-14 w-11 overflow-hidden rounded border bg-muted text-[10px] text-muted-foreground hover:ring-2 hover:ring-primary"
                title={`slot ${c.slot_index}: ${c.generation_status}`}
              >
                {svg ? (
                  // eslint-disable-next-line @next/next/no-img-element -- local fixture SVG data URI
                  <img alt="" className="size-full object-cover" src={`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`} />
                ) : (
                  <span className="tnum">{c.slot_index}</span>
                )}
              </button>
            );
          })}
        </div>
      </TableCell>
    </TableRow>
  );
}

function FixtureBatches() {
  const [run, setRun] = useState<FixtureRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<MemCandidate | null>(null);
  const start = useCallback(async () => {
    setBusy(true);
    try {
      setRun(await startFixtureRun());
    } finally {
      setBusy(false);
    }
  }, []);
  const counts = useMemo(() => {
    if (!run) return null;
    const c = run.queue.candidates;
    return {
      generated: c.filter((x) => x.generation_status === "generated").length,
      queued: c.filter((x) => x.generation_status === "queued").length,
      qaFailed: c.filter((x) => x.qa_status === "failed").length,
    };
  }, [run]);

  return (
    <>
      <FixtureBanner what="The plan, queue and composition below run in your browser with the zero-cost fixture provider and placeholder packshots. Nothing is stored or sent anywhere." />
      {!run ? (
        <EmptyState
          title="Plan a 100-candidate Adipocyde batch (fixture)"
          description="20 families of five — 60 exploit / 30 adjacent / 10 explore — then run the first pilot stage of 5 through the worker, composition and QA."
          action={{ label: busy ? "Running…" : "Plan and run pilot stage", onClick: () => void start() }}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
            {[
              ["Planned", `${run.plan.planned} in ${run.plan.families.length} families`],
              ["Pilot gates", run.plan.stages.join(" → ")],
              ["Batch status", `${run.queue.batch.status} (≤ slot ${run.queue.batch.stage_limit - 1})`],
              ["Generated", String(counts!.generated)],
              ["QA failed", `${counts!.qaFailed} (fixture by design)`],
              ["Spent / budget", `${run.queue.batch.spent} / ${run.queue.batch.budget} USD`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border bg-card px-3 py-2.5">
                <div className="text-[11px] text-muted-foreground">{k}</div>
                <div className="tnum mt-0.5 text-sm font-semibold">{v}</div>
              </div>
            ))}
          </div>
          {run.plan.shortfalls.length > 0 && (
            <ErrorState title="Plan shortfall" description={run.plan.shortfalls.map((s) => `family ${s.family_index}: ${s.factor} ${s.available}/${s.needed}`).join("; ")} />
          )}
          <div className="rounded-lg border bg-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Lane</TableHead>
                  <TableHead>Hypothesis</TableHead>
                  <TableHead>Varies</TableHead>
                  <TableHead>Candidates (click for lineage)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {run.plan.families.map((f) => (
                  <FamilyRow key={f.index} f={f} run={run} onOpen={setOpen} />
                ))}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">
            The next gate (20, then 100) opens only when every candidate in the current stage is terminal and every QA-passed one has a
            named reviewer&apos;s decision. Generation, QA, review, export and launch are separate states; nothing here publishes or spends media budget.
          </p>
          <CandidateSheet run={run} candidate={open} onClose={() => setOpen(null)} />
        </>
      )}
    </>
  );
}

function LiveBatches() {
  const session = useSession();
  const brandId = session.liveBrandId;
  const q = useLiveQuery(() => (brandId == null ? Promise.resolve(null) : fetchCreativeBatches(brandId)), [brandId]);
  if (brandId == null) return <EmptyState title="Choose a brand" description="Pick one brand in the top bar." />;
  if (q.error) return q.error.includes("not available") ? <NotProvisioned /> : <ErrorState title="Batches failed to load" description={q.error} retry={() => void q.reload()} />;
  if (q.loading || !q.data) return <SkeletonTable rows={4} />;
  if (q.data.length === 0) return <EmptyState title="No batches yet" description="A batch can start once the brand is ready on the readiness page." />;
  return (
    <div className="rounded-lg border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Batch</TableHead>
            <TableHead>Market</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Stage</TableHead>
            <TableHead className="text-right">Generated</TableHead>
            <TableHead className="text-right">QA passed</TableHead>
            <TableHead className="text-right">Approved</TableHead>
            <TableHead className="text-right">Exported</TableHead>
            <TableHead className="text-right">Launched</TableHead>
            <TableHead className="text-right">Spent / budget</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {q.data.map(({ batch: b, counts: c }) => (
            <TableRow key={b.id}>
              <TableCell className="tnum">#{b.id}</TableCell>
              <TableCell>{b.market}</TableCell>
              <TableCell>
                <Pill tone={b.status === "paused_budget" ? "bad" : b.status === "awaiting_review" ? "warn" : "muted"}>{b.status.replace("_", " ")}</Pill>
              </TableCell>
              <TableCell className="tnum text-right">
                {b.stage_limit}/{b.requested_count}
              </TableCell>
              <TableCell className="tnum text-right">{c.generated}</TableCell>
              <TableCell className="tnum text-right">{c.qa_passed}</TableCell>
              <TableCell className="tnum text-right">{c.approved}</TableCell>
              <TableCell className="tnum text-right">{c.exported}</TableCell>
              <TableCell className="tnum text-right">{c.launched}</TableCell>
              <TableCell className="tnum text-right">
                {b.spent_amount} / {b.budget_amount} {b.budget_currency}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function BatchesInner() {
  const source = useLabSource();
  return (
    <PageBody className="max-w-none">
      <PageHeader
        title="Poster lab — batches"
        description="Planned candidate batches built from a reviewed recipe and an immutable context manifest: authentic packshots composited with editable text, piloted 5 → 20 → 100 under a spend ceiling, every candidate traceable to its inputs."
      />
      {source === "fixture" ? <FixtureBatches /> : <LiveBatches />}
    </PageBody>
  );
}

export default function BatchesPage() {
  return (
    <RouteGuard permission="marketing.view">
      <BatchesInner />
    </RouteGuard>
  );
}
