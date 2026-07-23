"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  CalendarClock,
  ChevronRight,
  Sparkles,
  Timer,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChartCard } from "@/components/charts/chart-card";
import { VarianceBars } from "@/components/charts/commercial-charts";
import { ImpactPreviewDialog } from "@/components/dialogs/impact-preview-dialog";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { useRepo } from "@/hooks/use-repo";
import { usePermission, useSession } from "@/hooks/use-session";
import type { Recommendation } from "@/lib/domain/types";
import { formatMoney, formatPercent } from "@/lib/domain/money";
import { RouteGuard } from "@/lib/rbac/guard";
import { dateKey } from "@/lib/seed/clock";
import { useAppStore } from "@/lib/store/provider";
import { formatDate, formatRelative } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

const CHAIN = [
  "Target", "Expectation", "Actual", "Variance", "Diagnosis",
  "Recommendation", "Approval", "Action", "Outcome",
] as const;

const RISK_TONE: Record<string, string> = {
  low: "text-muted-foreground",
  medium: "text-warning",
  high: "text-destructive",
  critical: "text-destructive",
};

function ProphitInner() {
  const repo = useRepo();
  const session = useSession();
  const canDecide = usePermission("recommendations.decide");
  const recommendations = useAppStore((s) => s.recommendations);
  const diagnoses = useAppStore((s) => s.diagnoses);
  const decisions = useAppStore((s) => s.decisions);
  const targets = useAppStore((s) => s.targets);
  const brands = useAppStore((s) => s.brands);
  const personas = useAppStore((s) => s.personas);
  const dailyPlan = useAppStore((s) => s.dailyPlan);
  const prophitIntegration = useAppStore((s) => s.integrations.find((i) => i.id === "INT-prophit"));

  const [selected, setSelected] = useState<Recommendation | null>(null);
  const [decideAction, setDecideAction] = useState<"approved" | "rejected" | null>(null);
  const [assignee, setAssignee] = useState("USR-ida");

  const pending = recommendations
    .filter((r) => r.status === "pending")
    .filter((r) => session.brandId === "all" || r.brandId === session.brandId)
    .sort((a, b) => b.expectedContributionImpact - a.expectedContributionImpact);

  const personaName = (id: string | null) => personas.find((p) => p.id === id)?.name ?? "Unassigned";
  const brandName = (id: string) => brands.find((b) => b.id === id)?.name.replace(" (Demo)", "") ?? id;

  /* portfolio scoreboard: month-to-date actual vs prorated target */
  const mtdStart = "2026-07-01";
  const scoreboard = targets.map((t) => {
    const rows = dailyPlan.filter((p) => p.brandId === t.brandId && p.date >= mtdStart && p.date <= dateKey(1));
    const actual = rows.reduce((s, r) => s + r.actualContribution, 0);
    const daysElapsed = 22;
    const prorated = Math.round((t.targetValue * daysElapsed) / 31);
    return { target: t, actual, prorated, variance: prorated > 0 ? (actual - prorated) / prorated : 0 };
  });

  // Today is a partial day — it would show a misleading plunge, so start at D-1.
  const varianceData = useMemo(
    () =>
      Array.from({ length: 30 }, (_, i) => {
        const k = dateKey(30 - i);
        const rows = dailyPlan.filter(
          (p) => p.date === k && (session.brandId === "all" || p.brandId === session.brandId),
        );
        return {
          date: formatDate(`${k}T12:00:00+08:00`),
          variance: rows.reduce((s, p) => s + (p.actualContribution - p.expectedContribution), 0),
        };
      }),
    [dailyPlan, session.brandId],
  );

  async function decide(rec: Recommendation, decision: "approved" | "rejected", rationale: string) {
    await repo.decideRecommendation(rec.id, decision, rationale);
    toast.success(decision === "approved" ? `Approved — action created for ${personaName(rec.ownerId)}` : "Rejected and recorded", {
      description: "Decision history and the Command Centre counter updated.",
    });
    setSelected(null);
  }

  return (
    <PageBody className="max-w-none">
      <PageHeader
        title="Prophit"
        description="A decision chain, not a dashboard: every number ends in a decision with an owner and a measured outcome."
      >
        <Badge variant="outline" className="gap-1 border-ai/30 bg-ai/10 text-ai">
          <Sparkles className="size-3" aria-hidden />
          Prophit / Growth Engine — read-side import
        </Badge>
      </PageHeader>

      {/* decision chain strip */}
      <div className="flex flex-wrap items-center gap-1 rounded-lg border bg-card px-3 py-2.5">
        {CHAIN.map((stage, i) => (
          <span key={stage} className="flex items-center gap-1">
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[11px] font-medium",
                stage === "Recommendation" || stage === "Approval"
                  ? "bg-ai/12 text-ai"
                  : "text-muted-foreground",
              )}
            >
              {stage}
              {stage === "Recommendation" && ` (${pending.length})`}
              {stage === "Outcome" && ` (${decisions.filter((d) => d.outcome).length})`}
            </span>
            {i < CHAIN.length - 1 && <ChevronRight className="size-3 text-muted-foreground/50" aria-hidden />}
          </span>
        ))}
        {prophitIntegration && (
          <span className="ml-auto text-[11px] text-muted-foreground">
            feed synced {formatRelative(prophitIntegration.lastSuccessAt ?? "")}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* scoreboard */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Portfolio scoreboard — July targets</CardTitle>
            <p className="text-xs text-muted-foreground">Month-to-date contribution vs prorated target (22 of 31 days).</p>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">Brand · market</th>
                  <th className="pb-2 text-right font-medium">MTD actual</th>
                  <th className="pb-2 text-right font-medium">Prorated target</th>
                  <th className="pb-2 text-right font-medium">Variance</th>
                </tr>
              </thead>
              <tbody>
                {scoreboard.map(({ target, actual, prorated, variance }) => (
                  <tr key={target.id} className="border-b last:border-0">
                    <td className="py-2">
                      {brandName(target.brandId)} · MY
                      <span className="ml-1.5 text-[11px] text-muted-foreground">({target.scenario})</span>
                    </td>
                    <td className="tnum py-2 text-right">{formatMoney(actual, "MYR", { compact: true })}</td>
                    <td className="tnum py-2 text-right text-muted-foreground">{formatMoney(prorated, "MYR", { compact: true })}</td>
                    <td className={cn("tnum py-2 text-right font-medium", variance >= 0 ? "text-success" : "text-destructive")}>
                      {formatPercent(variance, 1, true)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Owner sets targets in the planning cycle; Solstice SG has no July target yet (brand ramping).
            </p>
          </CardContent>
        </Card>

        <ChartCard
          title="Daily variance to plan, 30 days"
          subtitle="Contribution actual − expectation · green above plan, red below · excludes today (partial day)"
        >
          <VarianceBars data={varianceData} currencyLabel="RM" />
        </ChartCard>
      </div>

      {/* diagnoses */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Ranked diagnoses</CardTitle>
          <p className="text-xs text-muted-foreground">Why the variance exists — drivers ranked by estimated impact, with evidence and confidence.</p>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {diagnoses.map((d) => (
            <div key={d.id} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <span className="text-sm font-medium">{d.title}</span>
                <span className="tnum shrink-0 rounded bg-ai/12 px-1.5 py-0.5 text-[10px] font-medium text-ai">
                  {(d.confidence * 100).toFixed(0)}%
                </span>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">{brandName(d.brandId)} · {d.variance} · {d.methodologyVersion}</div>
              <ol className="mt-2 space-y-2">
                {d.drivers.map((dr) => (
                  <li key={dr.rank} className="text-xs">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium">{dr.rank}. {dr.driver}</span>
                      <span className="tnum shrink-0 text-destructive">{formatMoney(dr.impact, "MYR", { compact: true })}</span>
                    </div>
                    <p className="mt-0.5 text-muted-foreground">{dr.evidence}</p>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* recommendations */}
      <section aria-label="Pending recommendations" className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">
            Recommendations awaiting a decision <span className="tnum text-muted-foreground">({pending.length})</span>
          </h2>
          {!canDecide && (
            <span className="text-xs text-muted-foreground">Your role can view but not decide — switch to HQ, Marketing, or Operations.</span>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {pending.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => setSelected(r)}
              className="rounded-lg border border-ai/25 bg-card p-4 text-left outline-none transition-colors hover:border-ai/50 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Sparkles className="size-3.5 shrink-0 text-ai" aria-hidden />
                    <span className="truncate text-sm font-medium">{r.title}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{r.summary}</p>
                </div>
                <span className="tnum shrink-0 text-base font-semibold text-success">
                  +{formatMoney(r.expectedContributionImpact, r.currency, { compact: true })}
                </span>
              </div>
              <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                <span>{brandName(r.brandId)}</span>
                <span className="tnum">{(r.confidence * 100).toFixed(0)}% confidence</span>
                <span className={RISK_TONE[r.risk]}>{r.risk} risk · {r.reversibility.replace(/_/g, " ")}</span>
                <span className="flex items-center gap-1"><UserRound className="size-3" aria-hidden />{personaName(r.ownerId)}</span>
                <span className="flex items-center gap-1"><CalendarClock className="size-3" aria-hidden />due {formatRelative(r.dueAt)}</span>
                <span className="flex items-center gap-1 text-warning"><Timer className="size-3" aria-hidden />expires {formatRelative(r.expiresAt)}</span>
              </div>
            </button>
          ))}
          {pending.length === 0 && (
            <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground lg:col-span-2">
              No pending recommendations in this scope. Decided items move to the history below; the feed refreshes from the Growth Engine read-side.
            </p>
          )}
        </div>
      </section>

      {/* decision history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Decision history & outcomes</CardTitle>
          <p className="text-xs text-muted-foreground">Every decision keeps its rationale; approved actions get measured outcomes.</p>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="pb-2 font-medium">Recommendation</th>
                <th className="pb-2 font-medium">Decision</th>
                <th className="pb-2 font-medium">By</th>
                <th className="pb-2 font-medium">Rationale</th>
                <th className="pb-2 text-right font-medium">Outcome (expected → measured)</th>
              </tr>
            </thead>
            <tbody>
              {decisions.map((d) => (
                <tr key={d.id} className="border-b align-top last:border-0">
                  <td className="max-w-56 py-2 pr-3">{d.recommendationTitle}</td>
                  <td className="py-2 pr-3">
                    <span
                      className={cn(
                        "capitalize",
                        d.decision === "approved" && "text-success",
                        d.decision === "rejected" && "text-destructive",
                        d.decision === "expired" && "text-warning",
                      )}
                    >
                      {d.decision.replace("_", " ")}
                    </span>
                    <div className="tnum text-[11px] text-muted-foreground">{formatRelative(d.decidedAt)}</div>
                  </td>
                  <td className="py-2 pr-3">{personaName(d.decidedBy)}</td>
                  <td className="max-w-64 py-2 pr-3 text-xs text-muted-foreground">{d.rationale}</td>
                  <td className="tnum py-2 text-right">
                    {d.outcome ? (
                      <div>
                        <span className="text-muted-foreground">{formatMoney(d.outcome.expectedImpact, "MYR", { compact: true })}</span>
                        {" → "}
                        <span className={d.outcome.measuredImpact >= d.outcome.expectedImpact ? "text-success" : "text-warning"}>
                          {formatMoney(d.outcome.measuredImpact, "MYR", { compact: true })}
                        </span>
                        <div className="text-[11px] text-muted-foreground">
                          {(d.outcome.attributionConfidence * 100).toFixed(0)}% attribution confidence
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">{d.decision === "approved" || d.decision === "scheduled" ? "measuring…" : "—"}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* ---------- detail drawer ---------- */}
      <Sheet open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2 pr-6">
                  <Sparkles className="size-4 shrink-0 text-ai" aria-hidden />
                  {selected.title}
                </SheetTitle>
                <SheetDescription>{selected.summary}</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 px-4 pb-6">
                <div className="rounded-lg border p-3">
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">Proposed action</div>
                  <p className="text-sm">{selected.proposedAction}</p>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div><dt className="text-xs text-muted-foreground">Expected contribution impact</dt><dd className="tnum font-semibold text-success">+{formatMoney(selected.expectedContributionImpact, selected.currency)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Confidence</dt><dd className="tnum">{(selected.confidence * 100).toFixed(0)}%</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Risk</dt><dd className={cn("capitalize", RISK_TONE[selected.risk])}>{selected.risk} — {selected.riskNote}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Reversibility</dt><dd className="capitalize">{selected.reversibility.replace(/_/g, " ")}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Owner</dt><dd>{personaName(selected.ownerId)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Due / expires</dt><dd className="tnum">{formatRelative(selected.dueAt)} / {formatRelative(selected.expiresAt)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Automation level</dt><dd>{selected.automationLevel} — recommend only, human executes</dd></div>
                  <div><dt className="text-xs text-muted-foreground">Source</dt><dd>Growth Engine read-side feed</dd></div>
                </dl>
                {selected.dependencies.length > 0 && (
                  <div>
                    <div className="mb-1 text-xs font-medium text-muted-foreground">Dependencies</div>
                    <ul className="list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                      {selected.dependencies.map((dep) => (<li key={dep}>{dep}</li>))}
                    </ul>
                  </div>
                )}
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Evidence</div>
                  <ul className="space-y-1">
                    {selected.evidence.map((e) => (
                      <li key={e} className="rounded bg-muted px-2 py-1.5 text-xs text-muted-foreground">{e}</li>
                    ))}
                  </ul>
                </div>
                {selected.relatedEntityRefs.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {selected.relatedEntityRefs.map((ref) => {
                      const [kind, id] = ref.split(":");
                      const href =
                        kind === "order" ? `/orders/${id}`
                        : kind === "campaign" ? `/marketing?campaign=${id}`
                        : kind === "integration" ? `/integrations/${id}`
                        : kind === "product" ? "/catalog/products"
                        : kind === "dq" ? "/data-health"
                        : "/prophit";
                      return (
                        <Link key={ref} href={href} className="rounded border px-2 py-0.5 text-[11px] text-info underline-offset-2 hover:underline">
                          {ref} <ArrowRight className="inline size-3" aria-hidden />
                        </Link>
                      );
                    })}
                  </div>
                )}

                {canDecide ? (
                  <div className="space-y-2.5 border-t pt-4">
                    <div className="flex gap-2">
                      <Button className="flex-1" onClick={() => setDecideAction("approved")}>Approve</Button>
                      <Button variant="outline" className="flex-1 text-destructive" onClick={() => setDecideAction("rejected")}>Reject</Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <Select value={assignee} onValueChange={setAssignee}>
                        <SelectTrigger className="h-8 flex-1 text-xs" aria-label="Reassign owner"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {personas.map((p) => (<SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>))}
                        </SelectContent>
                      </Select>
                      <Button
                        variant="outline" size="sm" className="h-8"
                        onClick={async () => {
                          await repo.assignRecommendation(selected.id, assignee);
                          toast.success(`Owner set to ${personaName(assignee)}`);
                        }}
                      >
                        Assign
                      </Button>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline" size="sm" className="h-8 flex-1 text-xs"
                        onClick={async () => {
                          await repo.decideRecommendation(selected.id, "scheduled", "Scheduled for the next planning cycle.");
                          toast.success("Scheduled — moved to decision history");
                          setSelected(null);
                        }}
                      >
                        Schedule for later
                      </Button>
                      <Button
                        variant="outline" size="sm" className="h-8 flex-1 text-xs"
                        onClick={async () => {
                          await repo.decideRecommendation(selected.id, "evidence_requested", "More evidence requested from the Growth Engine.");
                          toast.info("Evidence requested", { description: "The Growth Engine will attach more evidence on the next sync." });
                          setSelected(null);
                        }}
                      >
                        Request more evidence
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p className="border-t pt-4 text-xs text-muted-foreground">
                    Your demo role can inspect but not decide. Deciding requires HQ Admin, Marketing/Growth, or Operations.
                  </p>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* approve / reject impact previews */}
      {selected && (
        <>
          <ImpactPreviewDialog
            open={decideAction === "approved"}
            onOpenChange={(o) => !o && setDecideAction(null)}
            title={`Approve: ${selected.title}?`}
            description="Approval creates an execution work item for the owner and moves this into decision history."
            impact={[
              { label: "Expected contribution", value: `+${formatMoney(selected.expectedContributionImpact, selected.currency)}`, tone: "success" },
              { label: "Action owner", value: personaName(selected.ownerId) },
              { label: "Pending decisions", value: `${pending.length} → ${pending.length - 1}` },
            ]}
            externalDestination={selected.dependencies[0]?.includes("write access") || selected.dependencies[0]?.includes("Ads Manager") ? "Execution is manual — Fullkit has no ad-platform write access." : "None in Demo mode."}
            reversibility={selected.reversibility.replace(/_/g, " ")}
            auditNote="Recorded as recommendation.approved with your rationale; outcome measurement starts at execution."
            confirmLabel="Approve"
            requireNote
            notePlaceholder="Why approve? (recorded)"
            onConfirm={(note) => decide(selected, "approved", note)}
          />
          <ImpactPreviewDialog
            open={decideAction === "rejected"}
            onOpenChange={(o) => !o && setDecideAction(null)}
            title={`Reject: ${selected.title}?`}
            description="Rejection is recorded with rationale so the Growth Engine can learn from it."
            impact={[
              { label: "Expected contribution foregone", value: formatMoney(selected.expectedContributionImpact, selected.currency), tone: "warning" },
              { label: "Pending decisions", value: `${pending.length} → ${pending.length - 1}` },
            ]}
            externalDestination="None — rejection only updates Fullkit records."
            reversibility="The recommendation can be re-issued by the Growth Engine with new evidence."
            auditNote="Recorded as recommendation.rejected with your rationale."
            confirmLabel="Reject"
            requireNote
            notePlaceholder="Why reject? (required, recorded)"
            destructive
            onConfirm={(note) => decide(selected, "rejected", note)}
          />
        </>
      )}
    </PageBody>
  );
}

export default function ProphitPage() {
  return (
    <RouteGuard permission="recommendations.view">
      <ProphitInner />
    </RouteGuard>
  );
}
