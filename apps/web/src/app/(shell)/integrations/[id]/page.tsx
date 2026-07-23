"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, KeyRound, RefreshCcw, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PageBody } from "@/components/shell/page-header";
import { FreshnessBadge } from "@/components/status/freshness-badge";
import { EmptyState } from "@/components/states";
import { useRepo } from "@/hooks/use-repo";
import { usePermission } from "@/hooks/use-session";
import { RouteGuard } from "@/lib/rbac/guard";
import { useAppStore } from "@/lib/store/provider";
import { formatDateTime, formatRelative } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

function IntegrationDetailInner() {
  const params = useParams<{ id: string }>();
  const repo = useRepo();
  const canRetry = usePermission("integrations.retry");

  const integration = useAppStore((s) => s.integrations.find((i) => i.id === params.id));
  const allRuns = useAppStore((s) => s.syncRuns);
  const runs = useMemo(
    () =>
      allRuns
        .filter((r) => r.integrationId === params.id)
        .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)),
    [allRuns, params.id],
  );
  const allDqIssues = useAppStore((s) => s.dqIssues);
  const dqIssues = useMemo(
    () => allDqIssues.filter((i) => i.integrationId === params.id && i.status !== "resolved"),
    [allDqIssues, params.id],
  );
  const brands = useAppStore((s) => s.brands);
  const personas = useAppStore((s) => s.personas);
  const [reauthOpen, setReauthOpen] = useState(false);

  if (!integration) {
    return (
      <PageBody className="max-w-3xl">
        <EmptyState
          title="Connection not found"
          description="No integration with this ID exists in the prototype."
          action={{ label: "All integrations", href: "/integrations" }}
        />
      </PageBody>
    );
  }

  const owner = personas.find((p) => p.id === integration.ownerId);

  return (
    <PageBody className="max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon" className="size-7" aria-label="Back to integrations">
              <Link href="/integrations"><ArrowLeft className="size-4" /></Link>
            </Button>
            <h1 className="text-lg font-semibold tracking-tight">{integration.name}</h1>
            <Badge
              variant="outline"
              className={cn(
                "capitalize",
                integration.status === "healthy" && "border-success/30 bg-success/10 text-success",
                integration.status === "degraded" && "border-warning/30 bg-warning/10 text-warning",
                integration.status === "stale" && "border-destructive/30 bg-destructive/10 text-destructive",
              )}
            >
              {integration.status}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {integration.provider} · {integration.environment} · {integration.direction.replace("_", " + ")} · owner {owner?.name}
          </p>
        </div>
        <div className="flex gap-2">
          {integration.status === "stale" && integration.id === "INT-shopee" && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setReauthOpen(true)}>
              <KeyRound className="size-3.5" aria-hidden /> Re-authorize
            </Button>
          )}
          {canRetry ? (
            <Button
              size="sm"
              className="gap-1.5"
              onClick={async () => {
                await repo.retrySync(integration.id);
                const failsAgain = integration.id === "INT-shopee";
                if (failsAgain) {
                  toast.error("Retry failed — credentials expired", { description: "Re-authorization by the seller-centre owner is required. The failed run is recorded below." });
                } else {
                  toast.success("Sync completed", { description: "Checkpoint advanced; freshness updated." });
                }
              }}
            >
              <RefreshCcw className="size-3.5" aria-hidden /> Retry sync
            </Button>
          ) : (
            <Button size="sm" variant="outline" disabled title="Requires Operations or HQ role">
              Retry sync — Operations only
            </Button>
          )}
        </div>
      </div>

      {integration.notes && (
        <p className={cn(
          "rounded-md border px-3 py-2 text-sm",
          integration.status === "stale"
            ? "border-destructive/25 bg-destructive/10 text-destructive"
            : "border-border bg-muted/40 text-muted-foreground",
        )}>
          {integration.notes}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Connection</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Brand scope</span>
              <span className="text-right">{integration.brandScope.length === 0 ? "Workspace-wide" : integration.brandScope.map((b) => brands.find((x) => x.id === b)?.name.replace(" (Demo)", "")).join(", ")}</span>
            </div>
            <div className="flex justify-between"><span className="text-muted-foreground">Environment</span><span>{integration.environment}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Direction</span><span className="capitalize">{integration.direction.replace("_", " + ")}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Freshness SLA</span>
              <span className="tnum">{integration.freshnessSlaMinutes >= 60 ? `${Math.round(integration.freshnessSlaMinutes / 60)}h` : `${integration.freshnessSlaMinutes}m`}</span>
            </div>
            <div className="flex items-center justify-between"><span className="text-muted-foreground">Last success</span>
              <FreshnessBadge lastSuccessAt={integration.lastSuccessAt} slaMinutes={integration.freshnessSlaMinutes} />
            </div>
            <div className="flex justify-between"><span className="text-muted-foreground">Last failure</span>
              <span className="tnum">{integration.lastFailureAt ? formatRelative(integration.lastFailureAt) : "none recorded"}</span>
            </div>
            <div className="flex justify-between"><span className="text-muted-foreground">Credential rotation</span>
              <span className="tnum">{integration.credentialRotatesAt ? formatRelative(integration.credentialRotatesAt) : "n/a"}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Scopes</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Read</div>
              <div className="flex flex-wrap gap-1">
                {integration.readScopes.length > 0 ? integration.readScopes.map((s) => (
                  <span key={s} className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">{s}</span>
                )) : <span className="text-xs text-muted-foreground">none</span>}
              </div>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">Write</div>
              <div className="flex flex-wrap gap-1">
                {integration.writeScopes.length > 0 ? integration.writeScopes.map((s) => (
                  <span key={s} className="rounded border border-warning/30 bg-warning/10 px-1.5 py-0.5 font-mono text-[10px] text-warning">{s}</span>
                )) : <span className="text-xs text-muted-foreground">none — read-only connection</span>}
              </div>
            </div>
            <p className="border-t pt-2 text-[11px] text-muted-foreground">
              Credentials live in the server-side secrets manager. Fullkit never displays tokens or keys.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Sync state</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Checkpoint</div>
              <div className="tnum mt-0.5 text-xs">{integration.syncCheckpoint ?? "—"}</div>
            </div>
            <div className="flex justify-between pt-1"><span className="text-muted-foreground">Errors (24h)</span>
              <span className={cn("tnum", integration.errorCount24h > 0 && "text-warning")}>{integration.errorCount24h}</span>
            </div>
            {dqIssues.length > 0 && (
              <div className="space-y-1 border-t pt-2">
                <div className="text-xs font-medium text-muted-foreground">Open data-quality issues</div>
                {dqIssues.map((i) => (
                  <Link key={i.id} href="/data-health" className="flex items-start gap-1.5 text-xs text-warning underline-offset-2 hover:underline">
                    <ShieldAlert className="mt-0.5 size-3 shrink-0" aria-hidden /> {i.id}: {i.title}
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Sync history</CardTitle>
          <p className="text-xs text-muted-foreground">Reason-coded — a failed run never advances the checkpoint.</p>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="pb-2 font-medium">Started</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 text-right font-medium">Read</th>
                <th className="pb-2 text-right font-medium">Written</th>
                <th className="pb-2 text-right font-medium">Errors</th>
                <th className="pb-2 font-medium">Reason</th>
                <th className="pb-2 font-medium">Message</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="tnum py-2 pr-3 text-xs">{formatDateTime(r.startedAt)}</td>
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
                  <td className="tnum py-2 pr-3 text-right text-xs">{r.recordsRead.toLocaleString()}</td>
                  <td className="tnum py-2 pr-3 text-right text-xs">{r.recordsWritten.toLocaleString()}</td>
                  <td className={cn("tnum py-2 pr-3 text-right text-xs", r.errorCount > 0 && "text-warning")}>{r.errorCount}</td>
                  <td className="py-2 pr-3">
                    {r.reasonCode ? (
                      <span className="rounded border border-warning/25 bg-warning/10 px-1.5 py-0.5 font-mono text-[10px] text-warning">{r.reasonCode}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="max-w-64 py-2 text-xs text-muted-foreground">{r.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* re-authorize explainer */}
      <Dialog open={reauthOpen} onOpenChange={setReauthOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Re-authorize Shopee MY</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  Shopee tokens can only be re-issued by the seller-centre <span className="font-medium text-foreground">owner account</span> via
                  Shopee&apos;s own consent screen — Fullkit cannot do this on the owner&apos;s behalf, in any mode.
                </p>
                <p className="text-muted-foreground">
                  In production this button sends the owner (Jun Wei) a secure re-consent link and tracks completion.
                  In this demo, no external call is made.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReauthOpen(false)}>Close</Button>
            <Button
              onClick={() => {
                setReauthOpen(false);
                toast.info("Re-consent link queued for the connection owner", { description: "Tracked as a work item for Jun Wei (Demo)." });
              }}
            >
              Send re-consent link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageBody>
  );
}

export default function IntegrationDetailPage() {
  return (
    <RouteGuard permission="integrations.view">
      <IntegrationDetailInner />
    </RouteGuard>
  );
}
