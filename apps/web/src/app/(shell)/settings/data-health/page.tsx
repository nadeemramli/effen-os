"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LiveGuard } from "@/components/auth/live-guard";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { FreshnessBadge } from "@/components/status/freshness-badge";
import { ErrorState, RefreshChip, SkeletonCards, SkeletonTable } from "@/components/states";
import { useLiveQuery } from "@/hooks/use-live-query";
import { slaLabel, statusMeta } from "@/lib/domain/integrations";
import { RouteGuard } from "@/lib/rbac/guard";
import {
  fetchIntegrationConnections,
  fetchRecentFailedRuns,
  integrationFreshness,
  type IntegrationFreshness,
} from "@/lib/supabase/live";
import { formatDateTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

const FRESHNESS_RANK: Record<IntegrationFreshness, number> = { stale: 0, aging: 1, fresh: 2, pending: 3 };

/**
 * What can honestly be said about data trust today: per-connection freshness
 * against its SLA (real clock) and every non-success sync run in the last
 * 24 hours. There is no governed data-quality issue register yet, and the
 * page says so rather than scoring one.
 */
function DataHealthInner() {
  const q = useLiveQuery(async () => {
    const [rows, failed] = await Promise.all([fetchIntegrationConnections(), fetchRecentFailedRuns(24, 50)]);
    return { rows, failed, fetchedAt: Date.now() };
  }, []);
  const rows = useMemo(() => q.data?.rows ?? [], [q.data]);
  const failed = q.data?.failed ?? [];
  const fetchedAt = q.data?.fetchedAt ?? 0;

  const graded = useMemo(
    () =>
      rows
        .map((i) => ({ ...i, freshness: integrationFreshness(i, fetchedAt) }))
        .sort((a, b) => FRESHNESS_RANK[a.freshness] - FRESHNESS_RANK[b.freshness] || a.name.localeCompare(b.name)),
    [rows, fetchedAt],
  );
  const configured = graded.filter((i) => i.freshness !== "pending");
  const count = (f: IntegrationFreshness) => graded.filter((i) => i.freshness === f).length;

  const tiles = [
    { label: "Within SLA", value: `${count("fresh")}/${configured.length}`, tone: count("fresh") === configured.length ? "text-success" : "", hint: "configured sources fresh right now" },
    { label: "Aging", value: String(count("aging")), tone: count("aging") > 0 ? "text-warning" : "", hint: "past SLA, under 3× SLA" },
    { label: "Stale", value: String(count("stale")), tone: count("stale") > 0 ? "text-destructive" : "", hint: "beyond 3× SLA or never succeeded" },
    { label: "Pending setup", value: String(count("pending")), tone: "text-muted-foreground", hint: "registered, not connected" },
    { label: "Failed runs 24h", value: String(failed.length), tone: failed.length > 0 ? "text-warning" : "", hint: "non-success sync runs, all sources" },
  ];

  return (
    <PageBody className="max-w-none">
      <PageHeader
        title="Data health"
        description="How much the numbers can be trusted right now — source freshness against SLA and the last 24 hours of failed runs, from the live register."
      >
        <div className="flex items-center gap-2">
          {q.refreshing && <RefreshChip />}
          <Link href="/settings/automations" className="text-sm text-info underline-offset-2 hover:underline">
            Pipeline health
          </Link>
        </div>
      </PageHeader>

      {q.error && !q.data ? (
        <ErrorState title="Could not load data health" description={q.error} retry={() => void q.reload()} />
      ) : q.loading ? (
        <>
          <SkeletonCards count={5} />
          <SkeletonTable rows={6} cols={5} />
        </>
      ) : (
        <>
          <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-5", q.refreshing && "opacity-70")}>
            {tiles.map((t) => (
              <Card key={t.label} className="gap-1.5 px-4 py-3">
                <span className="text-xs font-medium text-muted-foreground">{t.label}</span>
                <span className={cn("tnum text-2xl font-semibold", t.tone)}>{t.value}</span>
                <p className="text-[11px] text-muted-foreground">{t.hint}</p>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Freshness by source</CardTitle>
                <p className="text-xs text-muted-foreground">Measured against each connection&apos;s own SLA at {formatDateTime(new Date(fetchedAt).toISOString())}.</p>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {graded.map((i) => (
                  <div key={i.id} className="flex items-center justify-between gap-3 text-sm">
                    <Link href={`/settings/integrations/${i.id}`} className="min-w-0 flex-1 truncate underline-offset-2 hover:underline">
                      {i.name}
                    </Link>
                    <span className="tnum text-xs text-muted-foreground">SLA {slaLabel(i.freshness_sla_minutes)}</span>
                    {i.freshness === "pending" ? (
                      <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", statusMeta(i.status).className)}>pending setup</span>
                    ) : (
                      <FreshnessBadge lastSuccessAt={i.last_success_at} slaMinutes={i.freshness_sla_minutes} realClock />
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">What is not measured yet</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>
                  No governed data-quality issue register exists, so there is no trust score, no owned issue queue and no
                  reconciliation count on this page. Anything that looks like one would be invented.
                </p>
                <ul className="list-disc space-y-1 pl-5 text-xs">
                  <li>
                    SKU mapping gaps surface in{" "}
                    <Link href="/catalog" className="text-info underline-offset-2 hover:underline">Catalog</Link> (store SKU → variant queue).
                  </li>
                  <li>
                    Courier shadow coverage and every scheduled job&apos;s last run live in{" "}
                    <Link href="/settings/automations" className="text-info underline-offset-2 hover:underline">Automations</Link>.
                  </li>
                  <li>
                    Customer-economics coverage gaps are listed per cell in{" "}
                    <Link href="/profit/definitions-coverage" className="text-info underline-offset-2 hover:underline">Profit → Definitions &amp; coverage</Link>.
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Failed and partial runs — last 24 hours</CardTitle>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {failed.length} run{failed.length === 1 ? "" : "s"} did not succeed. Reason codes come from the sync function; the checkpoint never advances on failure.
              </p>
            </CardHeader>
            <CardContent>
              {failed.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Every recorded run in the last 24 hours succeeded.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="pb-2 font-medium">Started</th>
                        <th className="pb-2 font-medium">Connection</th>
                        <th className="pb-2 font-medium">Status</th>
                        <th className="pb-2 font-medium">Reason</th>
                        <th className="pb-2 font-medium">Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {failed.map((r) => (
                        <tr key={r.id} className="border-b last:border-0">
                          <td className="tnum py-2 pr-3 text-xs">{formatDateTime(r.started_at)}</td>
                          <td className="py-2 pr-3 text-xs">
                            <Link href={`/settings/integrations/${r.integration_id}`} className="underline-offset-2 hover:underline">{r.integration_name}</Link>
                          </td>
                          <td className={cn("py-2 pr-3 text-xs font-medium capitalize", r.status === "failed" ? "text-destructive" : "text-warning")}>{r.status}</td>
                          <td className="py-2 pr-3">
                            {r.reason_code ? (
                              <span className="rounded border border-warning/25 bg-warning/10 px-1.5 py-0.5 font-mono text-[10px] text-warning">{r.reason_code}</span>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="max-w-96 py-2 text-xs text-muted-foreground">{r.message ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </PageBody>
  );
}

export default function DataHealthPage() {
  return (
    <LiveGuard>
      <RouteGuard permission="dq.view">
        <DataHealthInner />
      </RouteGuard>
    </LiveGuard>
  );
}
