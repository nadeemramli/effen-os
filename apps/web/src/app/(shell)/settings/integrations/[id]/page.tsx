"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Loader2, RefreshCcw, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LiveGuard } from "@/components/auth/live-guard";
import { PageBody } from "@/components/shell/page-header";
import { FreshnessBadge } from "@/components/status/freshness-badge";
import { EmptyState, ErrorState, RefreshChip, SkeletonCards, SkeletonTable } from "@/components/states";
import { useLiveQuery } from "@/hooks/use-live-query";
import { usePermission } from "@/hooks/use-session";
import { describeConfig, setupHrefFor, slaLabel, statusMeta } from "@/lib/domain/integrations";
import { RouteGuard } from "@/lib/rbac/guard";
import {
  fetchIntegrationConnection,
  fetchSyncRunsFor,
  triggerSync,
  type LiveIntegration,
  type LiveSyncRun,
} from "@/lib/supabase/live";
import { formatDateTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

/**
 * One connection from the live register with its reason-coded sync history.
 * The only action here is a manual WooCommerce sync (the same edge function
 * the 15-minute job calls); every other provider is configured on its Setup
 * surface and has no browser-triggered run.
 */
function IntegrationDetailInner() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const validId = Number.isInteger(id) && id > 0;
  const canRetry = usePermission("integrations.retry");
  const canConnect = usePermission("integrations.connect");
  const [syncing, setSyncing] = useState(false);

  const q = useLiveQuery(async () => {
    if (!validId) return { connection: null as LiveIntegration | null, runs: [] as LiveSyncRun[] };
    const [connection, runs] = await Promise.all([fetchIntegrationConnection(id), fetchSyncRunsFor(id, 50)]);
    return { connection, runs };
  }, [id, validId]);

  if (q.error && !q.data) {
    return (
      <PageBody className="max-w-3xl">
        <ErrorState title="Could not load this connection" description={q.error} retry={() => void q.reload()} />
      </PageBody>
    );
  }
  if (q.loading) {
    return (
      <PageBody className="max-w-5xl">
        <SkeletonCards count={3} />
        <SkeletonTable rows={5} cols={6} />
      </PageBody>
    );
  }
  const integration = q.data?.connection ?? null;
  const runs = q.data?.runs ?? [];
  if (!integration) {
    return (
      <PageBody className="max-w-3xl">
        <EmptyState
          title="Connection not found"
          description={`No connection with id ${params.id} exists in the live register.`}
          action={{ label: "All integrations", href: "/settings/integrations" }}
        />
      </PageBody>
    );
  }

  const status = statusMeta(integration.status);
  const setupHref = setupHrefFor(integration.provider);
  const configRows = describeConfig(integration.config);
  const isWoo = integration.provider === "WooCommerce";

  async function handleSync() {
    if (!integration) return;
    setSyncing(true);
    try {
      const result = (await triggerSync(integration.id)) as { results?: Record<string, unknown>[] };
      const summary = (result.results ?? [])
        .map((r) => `${r.connection}: ${r.success ? `${r.written} orders` : (r.skipped ?? r.failed)}`)
        .join(" · ");
      toast.info("Sync finished", { description: summary || "No pages attempted." });
      await q.reload();
    } catch (e) {
      toast.error("Sync failed to start", { description: (e as Error).message });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <PageBody className="max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon" className="size-7" aria-label="Back to integrations">
              <Link href="/settings/integrations"><ArrowLeft className="size-4" /></Link>
            </Button>
            <h1 className="truncate text-lg font-semibold tracking-tight">{integration.name}</h1>
            <Badge variant="outline" className={cn("shrink-0", status.className)}>{status.label}</Badge>
            {q.refreshing && <RefreshChip />}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {integration.provider} · {integration.environment} · {integration.direction.replace("_", " + ")} · {integration.category}
          </p>
        </div>
        <div className="flex gap-2">
          {setupHref && canConnect && (
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <Link href={setupHref}><Settings2 className="size-3.5" aria-hidden /> Configure</Link>
            </Button>
          )}
          {isWoo &&
            (canRetry ? (
              <Button size="sm" className="gap-1.5" disabled={syncing || integration.status === "pending_setup"} onClick={() => void handleSync()}>
                {syncing ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <RefreshCcw className="size-3.5" aria-hidden />}
                Sync now
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled title="Requires Operations or HQ role">
                Sync now — Operations only
              </Button>
            ))}
        </div>
      </div>

      {integration.notes && (
        <p
          className={cn(
            "rounded-md border px-3 py-2 text-sm",
            integration.status === "stale" || integration.status === "disconnected"
              ? "border-destructive/25 bg-destructive/10 text-destructive"
              : integration.status === "degraded"
                ? "border-warning/25 bg-warning/10 text-warning"
                : "border-border bg-muted/40 text-muted-foreground",
          )}
        >
          {integration.notes}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Connection</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Environment</span><span>{integration.environment}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Direction</span><span className="capitalize">{integration.direction.replace("_", " + ")}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Freshness SLA</span><span className="tnum">{slaLabel(integration.freshness_sla_minutes)}</span></div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Last success</span>
              {integration.last_success_at || integration.status !== "pending_setup" ? (
                <FreshnessBadge lastSuccessAt={integration.last_success_at} slaMinutes={integration.freshness_sla_minutes} realClock />
              ) : (
                <span className="text-xs text-muted-foreground">not connected</span>
              )}
            </div>
            <div className="flex justify-between"><span className="text-muted-foreground">Last failure</span>
              <span className="tnum">{integration.last_failure_at ? formatDateTime(integration.last_failure_at) : "none recorded"}</span>
            </div>
            <div className="flex justify-between"><span className="text-muted-foreground">Credential rotation</span>
              <span className="tnum">{integration.credential_rotates_at ? formatDateTime(integration.credential_rotates_at) : "not scheduled"}</span>
            </div>
            <div className="flex justify-between"><span className="text-muted-foreground">Secret</span>
              <span className="text-xs">{integration.config && "secret_ref" in integration.config ? "in Vault" : integration.status === "pending_setup" ? "not stored" : "server-side"}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Scopes</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Read</div>
              <div className="flex flex-wrap gap-1">
                {integration.read_scopes.length > 0 ? integration.read_scopes.map((s) => (
                  <span key={s} className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">{s}</span>
                )) : <span className="text-xs text-muted-foreground">none</span>}
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Write</div>
              <div className="flex flex-wrap gap-1">
                {integration.write_scopes.length > 0 ? integration.write_scopes.map((s) => (
                  <span key={s} className="rounded border border-warning/30 bg-warning/10 px-1.5 py-0.5 font-mono text-[10px] text-warning">{s}</span>
                )) : <span className="text-xs text-muted-foreground">none — read-only connection</span>}
              </div>
            </div>
            <p className="border-t pt-2 text-[11px] text-muted-foreground">
              Credentials live in Supabase Vault. Fullkit never displays tokens or keys.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Sync state</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Checkpoint</div>
              <div className="tnum mt-0.5 break-all text-xs">{integration.sync_checkpoint ?? "—"}</div>
            </div>
            <div className="flex justify-between pt-1"><span className="text-muted-foreground">Errors (24h)</span>
              <span className={cn("tnum", integration.error_count_24h > 0 && "text-warning")}>{integration.error_count_24h}</span>
            </div>
            {configRows.length > 0 && (
              <div className="space-y-1 border-t pt-2">
                <div className="text-xs font-medium text-muted-foreground">Configuration</div>
                {configRows.map((c) => (
                  <div key={c.key} className="flex justify-between gap-2 text-xs">
                    <span className="text-muted-foreground">{c.key}</span>
                    <span className="tnum truncate" title={c.value}>{c.value}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Sync history</CardTitle>
          <p className="text-xs text-muted-foreground">
            Last {runs.length} runs, reason-coded — a failed run never advances the checkpoint.
          </p>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No sync runs recorded for this connection{isWoo ? "" : " — this provider is ingested by webhook or scheduled job, not a per-connection sync"}.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">Started</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 text-right font-medium">Read</th>
                    <th className="pb-2 text-right font-medium">Written</th>
                    <th className="pb-2 font-medium">Reason</th>
                    <th className="pb-2 font-medium">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="tnum py-2 pr-3 text-xs">{formatDateTime(r.started_at)}</td>
                      <td className="py-2 pr-3">
                        <span className={cn(
                          "text-xs font-medium capitalize",
                          r.status === "success" && "text-success",
                          r.status === "partial" && "text-warning",
                          r.status === "failed" && "text-destructive",
                        )}>
                          {r.status}
                        </span>
                      </td>
                      <td className="tnum py-2 pr-3 text-right text-xs">{Number(r.records_read ?? 0).toLocaleString()}</td>
                      <td className="tnum py-2 pr-3 text-right text-xs">{Number(r.records_written ?? 0).toLocaleString()}</td>
                      <td className="py-2 pr-3">
                        {r.reason_code ? (
                          <span className="rounded border border-warning/25 bg-warning/10 px-1.5 py-0.5 font-mono text-[10px] text-warning">{r.reason_code}</span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="max-w-80 py-2 text-xs text-muted-foreground">{r.message ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </PageBody>
  );
}

export default function IntegrationDetailPage() {
  return (
    <LiveGuard>
      <RouteGuard permission="integrations.view">
        <IntegrationDetailInner />
      </RouteGuard>
    </LiveGuard>
  );
}
