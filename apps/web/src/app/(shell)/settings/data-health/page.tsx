"use client";

import Link from "next/link";
import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LiveGuard } from "@/components/auth/live-guard";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { FreshnessBadge } from "@/components/status/freshness-badge";
import { tonePill } from "@/components/status/status-pill";
import { ErrorState, RefreshChip, SkeletonCards, SkeletonTable } from "@/components/states";
import { useLiveQuery } from "@/hooks/use-live-query";
import { slaLabel, statusMeta } from "@/lib/domain/integrations";
import { EVENT_LABEL, RUN_STATUS_TONE, STAGE_LABEL, type PipelineRuns } from "@/lib/domain/pipeline";
import { RouteGuard } from "@/lib/rbac/guard";
import {
  fetchIntegrationConnections,
  fetchPipelineRuns,
  fetchRecentFailedRuns,
  integrationFreshness,
  type IntegrationFreshness,
} from "@/lib/supabase/live";
import { formatDateTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

const FRESHNESS_RANK: Record<IntegrationFreshness, number> = { stale: 0, aging: 1, fresh: 2, pending: 3 };

/**
 * What can honestly be said about data trust today: per-connection freshness
 * against its SLA (real clock), every non-success sync run in the last 24
 * hours, and the ads-pipeline ledger (Airbyte → dbt → mart-sync) fed by the
 * pipeline webhook, the Airbyte poller and the dbt report step. There is no
 * governed data-quality issue register yet, and the page says so rather than
 * scoring one.
 */
function DataHealthInner() {
  const q = useLiveQuery(async () => {
    const [rows, failed, pipeline] = await Promise.all([
      fetchIntegrationConnections(),
      fetchRecentFailedRuns(24, 50),
      fetchPipelineRuns(48, 80).catch((e: Error) => ({ error: e.message })),
    ]);
    return { rows, failed, pipeline, fetchedAt: Date.now() };
  }, []);
  const rows = useMemo(() => q.data?.rows ?? [], [q.data]);
  const failed = q.data?.failed ?? [];
  const fetchedAt = q.data?.fetchedAt ?? 0;
  const pipeline = q.data?.pipeline && !("error" in q.data.pipeline) ? (q.data.pipeline as PipelineRuns) : null;
  const pipelineError = q.data?.pipeline && "error" in q.data.pipeline ? q.data.pipeline.error : null;

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

  const ab = pipeline?.summary.airbyte ?? null;
  const dbt = pipeline?.summary.dbt ?? null;
  const observed = (ab?.observed ?? 0) > 0;
  const staleConnections = (pipeline?.connections ?? []).filter((c) => c.active && (!c.last_success_at || new Date(c.last_success_at).getTime() < fetchedAt - 26 * 3_600_000));

  return (
    <PageBody className="max-w-none">
      <PageHeader
        title="Data health"
        description="How much the numbers can be trusted right now — source freshness against SLA, failed runs in the last 24 hours, and the ads-pipeline ledger, all from live tables."
      >
        <div className="flex items-center gap-2">
          {q.refreshing && <RefreshChip />}
          <Link href="/settings/automations" className="text-sm text-info underline-offset-2 hover:underline">
            Automations
          </Link>
          <Link href="/settings/setup/connections" className="text-sm text-info underline-offset-2 hover:underline">
            Connections
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

          {/* ---------- ads pipeline ledger ---------- */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Ads pipeline — Airbyte → dbt → mart-sync</CardTitle>
              <p className="text-xs text-muted-foreground">
                Airbyte notifications and the 30-minute poller feed the Airbyte rows; the dbt workflow reports its build; mart-sync logs its own runs. Late waves are expected to land the next cycle.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              {pipelineError ? (
                <p className="text-sm text-muted-foreground">Pipeline ledger unavailable: {pipelineError}</p>
              ) : !pipeline ? null : (
                <>
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <div className="rounded-md border px-3 py-2">
                      <div className="text-[11px] text-muted-foreground">Airbyte connections succeeded, 26h</div>
                      <div className={cn("tnum mt-0.5 text-base font-semibold", observed && (ab?.stale ?? 0) > 0 && "text-warning")}>
                        {observed ? `${ab?.succeeded_26h}/${ab?.expected}` : "—"}
                      </div>
                      <div className="text-[11px] text-muted-foreground">{observed ? `${ab?.failed_24h} failed 24h` : "no notifications received yet"}</div>
                    </div>
                    <div className="rounded-md border px-3 py-2">
                      <div className="text-[11px] text-muted-foreground">Last Airbyte completion</div>
                      <div className="mt-1">
                        {ab?.last_complete_at ? <FreshnessBadge lastSuccessAt={ab.last_complete_at} slaMinutes={26 * 60} realClock /> : <span className="text-xs text-muted-foreground">none recorded</span>}
                      </div>
                    </div>
                    <div className="rounded-md border px-3 py-2">
                      <div className="text-[11px] text-muted-foreground">dbt build</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {dbt?.last_status ? (
                          <>
                            {tonePill({ label: dbt.last_status, tone: dbt.last_status === "success" ? "success" : "destructive" })}
                            <span className="tnum text-[11px] text-muted-foreground">
                              {dbt.tests_failed ?? 0} failed · {dbt.tests_warned ?? 0} warned
                            </span>
                          </>
                        ) : (
                          <span className="text-xs text-muted-foreground">no report yet — add the GitHub secrets</span>
                        )}
                      </div>
                    </div>
                    <div className="rounded-md border px-3 py-2">
                      <div className="text-[11px] text-muted-foreground">mart-sync → ad_daily_facts</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        {pipeline.summary.mart.last_sync_at ? (
                          <FreshnessBadge lastSuccessAt={pipeline.summary.mart.last_sync_at} slaMinutes={26 * 60} realClock />
                        ) : (
                          <span className="text-xs text-muted-foreground">never</span>
                        )}
                        {pipeline.summary.mart.last_status && (
                          <span className="text-[11px] text-muted-foreground">last run {pipeline.summary.mart.last_status}</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {observed && staleConnections.length > 0 && (
                    <div>
                      <div className="mb-1 text-xs font-medium text-warning">
                        {staleConnections.length} active connection{staleConnections.length === 1 ? "" : "s"} without a success in 26h
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {staleConnections.map((c) => (
                          <span key={c.key} className="rounded border border-warning/30 bg-warning/10 px-1.5 py-0.5 font-mono text-[10px] text-warning" title={c.last_status ?? undefined}>
                            {c.key}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {pipeline.runs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No pipeline runs recorded in the last 48 hours. Connect the Airbyte webhook in Setup → Connections and add the dbt report secrets to start the ledger.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[860px] text-sm">
                        <thead>
                          <tr className="border-b text-left text-xs text-muted-foreground">
                            <th className="pb-2 font-medium">Finished</th>
                            <th className="pb-2 font-medium">Stage</th>
                            <th className="pb-2 font-medium">Connection</th>
                            <th className="pb-2 font-medium">Event</th>
                            <th className="pb-2 font-medium">Status</th>
                            <th className="pb-2 text-right font-medium">Records</th>
                            <th className="pb-2 font-medium">Via</th>
                            <th className="pb-2 font-medium">Detail</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pipeline.runs.map((r) => (
                            <tr key={r.id} className="border-b last:border-0">
                              <td className="tnum py-2 pr-3 text-xs">{formatDateTime(r.finished_at ?? r.started_at ?? r.received_at)}</td>
                              <td className="py-2 pr-3 text-xs">{STAGE_LABEL[r.stage]}</td>
                              <td className="py-2 pr-3 font-mono text-[11px]">{r.connection_key ?? (r.stage === "dbt" ? "dbt build" : "—")}</td>
                              <td className="py-2 pr-3 text-xs text-muted-foreground">{EVENT_LABEL[r.event_type] ?? r.event_type}</td>
                              <td className="py-2 pr-3">{tonePill({ label: r.status, tone: RUN_STATUS_TONE[r.status] ?? "neutral" })}</td>
                              <td className="tnum py-2 pr-3 text-right text-xs">{r.records === null ? "—" : r.records.toLocaleString()}</td>
                              <td className="py-2 pr-3 text-[11px] text-muted-foreground">{r.received_via}</td>
                              <td className="max-w-96 py-2 text-xs text-muted-foreground">
                                {r.error ?? (r.stage === "dbt" && r.summary ? `${String(r.summary.models_ok ?? 0)} models · ${String(r.summary.tests_ok ?? 0)} tests ok` : "")}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>

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
                  <li>
                    Airbyte&apos;s own run state is mirrored here only once the notification webhook is connected; until then only its downstream effect in ad_daily_facts is visible.
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
