"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { LiveGuard } from "@/components/auth/live-guard";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { FreshnessBadge } from "@/components/status/freshness-badge";
import { ErrorState, RefreshChip, SkeletonCards } from "@/components/states";
import { useLiveQuery } from "@/hooks/use-live-query";
import { CATEGORY_LABEL, categoryRank, statusMeta } from "@/lib/domain/integrations";
import { RouteGuard } from "@/lib/rbac/guard";
import { fetchIntegrationConnections, integrationFreshness, type LiveIntegration } from "@/lib/supabase/live";
import { formatDateTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

/**
 * Live register of every connection (`integration_connections`), grouped by
 * category. Read-only here; configuration happens on the Setup surfaces.
 * Freshness is measured against the snapshot's fetch time, never the demo
 * clock — these timestamps are real.
 */
function IntegrationsInner() {
  const q = useLiveQuery(async () => ({ rows: await fetchIntegrationConnections(), fetchedAt: Date.now() }), []);
  const rows = useMemo(() => q.data?.rows ?? [], [q.data]);
  const fetchedAt = q.data?.fetchedAt ?? 0;

  const groups = useMemo(() => {
    const map = new Map<string, LiveIntegration[]>();
    for (const i of rows) {
      const list = map.get(i.category) ?? [];
      list.push(i);
      map.set(i.category, list);
    }
    return [...map.entries()].sort(([a], [b]) => categoryRank(a) - categoryRank(b));
  }, [rows]);

  const summary = useMemo(() => {
    const configured = rows.filter((i) => i.status !== "pending_setup");
    const attention = configured.filter((i) => {
      const f = integrationFreshness(i, fetchedAt);
      return f === "aging" || f === "stale" || i.status === "degraded";
    }).length;
    return {
      total: rows.length,
      healthy: rows.filter((i) => i.status === "healthy").length,
      attention,
      pending: rows.length - configured.length,
    };
  }, [rows, fetchedAt]);

  return (
    <PageBody className="max-w-none">
      <PageHeader
        title="Integrations"
        description={
          q.data
            ? `${summary.total} connections · ${summary.healthy} healthy · ${summary.attention} need attention · ${summary.pending} pending setup`
            : "Live register of every connection — reading…"
        }
      >
        <div className="flex items-center gap-2">
          {q.refreshing && <RefreshChip />}
          <Link href="/settings/setup/connections" className="text-sm text-info underline-offset-2 hover:underline">
            Configure connections
          </Link>
          <Link href="/settings/automations" className="text-sm text-info underline-offset-2 hover:underline">
            Automations
          </Link>
        </div>
      </PageHeader>

      {q.error && !q.data ? (
        <ErrorState title="Could not load the connection register" description={q.error} retry={() => void q.reload()} />
      ) : q.loading ? (
        <SkeletonCards count={6} />
      ) : (
        groups.map(([category, list]) => (
          <section key={category} aria-label={CATEGORY_LABEL[category] ?? category}>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {CATEGORY_LABEL[category] ?? category}
            </h2>
            <div className={cn("grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3", q.refreshing && "opacity-70")}>
              {list.map((i) => {
                const status = statusMeta(i.status);
                const freshness = integrationFreshness(i, fetchedAt);
                return (
                  <Link
                    key={i.id}
                    href={`/settings/integrations/${i.id}`}
                    className={cn(
                      "rounded-lg border bg-card p-3.5 outline-none transition-colors hover:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring",
                      freshness === "stale" && i.status !== "pending_setup" && "border-destructive/40",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{i.name}</div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">
                          {i.provider} · {i.environment} · {i.direction.replace("_", " + ")}
                        </div>
                      </div>
                      <Badge variant="outline" className={cn("shrink-0 text-[10px]", status.className)}>
                        {status.label}
                      </Badge>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
                      <div className="flex items-center justify-between gap-2">
                        <dt className="text-muted-foreground">Last success</dt>
                        <dd>
                          {i.status === "pending_setup" && !i.last_success_at ? (
                            <span className="text-muted-foreground">not connected</span>
                          ) : (
                            <FreshnessBadge lastSuccessAt={i.last_success_at} slaMinutes={i.freshness_sla_minutes} realClock />
                          )}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Errors 24h</dt>
                        <dd className={cn("tnum", i.error_count_24h > 0 ? "text-warning" : "")}>{i.error_count_24h}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Last failure</dt>
                        <dd className="tnum text-muted-foreground">
                          {i.last_failure_at ? formatDateTime(i.last_failure_at) : "none"}
                        </dd>
                      </div>
                      <div className="flex min-w-0 justify-between gap-2">
                        <dt className="shrink-0 text-muted-foreground">Checkpoint</dt>
                        <dd className="tnum truncate text-muted-foreground" title={i.sync_checkpoint ?? undefined}>
                          {i.sync_checkpoint ?? "—"}
                        </dd>
                      </div>
                    </dl>
                    {i.status !== "healthy" && i.notes && (
                      <p className="mt-2 line-clamp-2 text-[11px] text-muted-foreground">{i.notes}</p>
                    )}
                  </Link>
                );
              })}
            </div>
          </section>
        ))
      )}
    </PageBody>
  );
}

export default function IntegrationsPage() {
  return (
    <LiveGuard>
      <RouteGuard permission="integrations.view">
        <IntegrationsInner />
      </RouteGuard>
    </LiveGuard>
  );
}
