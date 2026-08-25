"use client";

import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EmptyState, ErrorState, RefreshChip, SkeletonTable } from "@/components/states";
import { FreshnessBadge } from "@/components/status/freshness-badge";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { LiveGuard } from "@/components/auth/live-guard";
import { RouteGuard } from "@/lib/rbac/guard";
import { MONTH_PRESETS, useCustomerEconomics } from "@/hooks/use-customer-economics";
import { SUPPRESSION_LABELS, type CustomerEconomics, type SuppressionReason } from "@/lib/domain/customer-economics";
import { cn } from "@/lib/utils";

/** Nightly refresh → stale after 26 h. */
const FRESHNESS_SLA_MINUTES = 26 * 60;

export type EconOk = Extract<CustomerEconomics, { status: "ok" }>;

/**
 * Frame for every customer-economics page: guards, header, the scope + trust
 * strip (metric version, provisional decisions, freshness), and the cohort
 * window toggle. Children receive the served payload only when it is `ok`.
 */
export function EconShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: (econ: EconOk) => React.ReactNode;
}) {
  return (
    <LiveGuard>
      <RouteGuard permission="reports.view">
        <EconInner title={title} description={description}>{children}</EconInner>
      </RouteGuard>
    </LiveGuard>
  );
}

function EconInner({ title, description, children }: { title: string; description: string; children: (econ: EconOk) => React.ReactNode }) {
  const state = useCustomerEconomics();
  const { econ, unavailable, months, setMonths, markets, brandId } = state;

  return (
    <PageBody>
      <PageHeader title={title} description={description}>
        <ToggleGroup type="single" value={String(months)} onValueChange={(v) => v && setMonths(Number(v))} variant="outline" size="sm" aria-label="Cohort window">
          {MONTH_PRESETS.map((m) => (
            <ToggleGroupItem key={m} value={String(m)}>{m} mo</ToggleGroupItem>
          ))}
        </ToggleGroup>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="h-5 font-normal">econ-v1 · provisional (D3–D7)</Badge>
        <span>
          Scope: {brandId === null ? "all brands" : "one brand"} · {markets.length === 0 ? "all markets" : markets.join(", ")} · acquisition cohorts by first accepted order
        </span>
        {econ && (
          <span className="inline-flex items-center gap-1">
            Computed <FreshnessBadge lastSuccessAt={econ.computed_at} slaMinutes={FRESHNESS_SLA_MINUTES} realClock />
          </span>
        )}
        {state.refreshing && <RefreshChip />}
      </div>

      {state.error ? (
        <ErrorState title="Could not load customer economics" description={state.error} retry={() => void state.reload()} />
      ) : state.loading ? (
        <SkeletonTable rows={6} />
      ) : unavailable ? (
        <EmptyState title="Customer economics not computed yet" description="The nightly economics rebuild has not run. Nothing is estimated in its place." />
      ) : econ && econ.cohorts.length === 0 ? (
        <EmptyState title="No cohorts in scope" description="No customers were acquired under this brand / market selection in the window." />
      ) : econ ? (
        children(econ)
      ) : null}
    </PageBody>
  );
}

/** A metric cell that shows the number, or the reason it is withheld — never a fake zero. */
export function Cell({ value, reason, className, title }: { value: string | null; reason?: SuppressionReason | "immature" | null; className?: string; title?: string }) {
  if (value !== null && !reason) return <span className={cn("tnum", className)} title={title}>{value}</span>;
  const label = reason === "immature" ? "Horizon not reached by every customer in the cohort yet" : reason ? SUPPRESSION_LABELS[reason] : "Not available";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn("cursor-help text-muted-foreground", className)} aria-label={label}>
          {reason === "immature" ? "immature" : "—"}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs">{label}</TooltipContent>
    </Tooltip>
  );
}

export function ReasonList({ reasons }: { reasons: SuppressionReason[] }) {
  if (reasons.length === 0) return <span className="text-success">none</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {reasons.map((r) => (
        <Badge key={r} variant="outline" className="h-5 px-1.5 font-normal text-muted-foreground" title={SUPPRESSION_LABELS[r]}>
          {r.replace(/_/g, " ")}
        </Badge>
      ))}
    </span>
  );
}
