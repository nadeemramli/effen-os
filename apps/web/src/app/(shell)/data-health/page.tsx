"use client";

import Link from "next/link";
import { useState } from "react";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { FreshnessBadge } from "@/components/status/freshness-badge";
import { useRepo } from "@/hooks/use-repo";
import { usePermission } from "@/hooks/use-session";
import { RouteGuard } from "@/lib/rbac/guard";
import { useAppStore } from "@/lib/store/provider";
import { freshnessOf } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

function DataHealthInner() {
  const repo = useRepo();
  const canAck = usePermission("dq.acknowledge");
  const integrations = useAppStore((s) => s.integrations);
  const dqIssues = useAppStore((s) => s.dqIssues);
  const metricDefinitions = useAppStore((s) => s.metricDefinitions);
  const adAccounts = useAppStore((s) => s.adAccounts);
  const personas = useAppStore((s) => s.personas);
  const [severityFilter, setSeverityFilter] = useState("any");

  const freshCount = integrations.filter((i) => freshnessOf(i.lastSuccessAt, i.freshnessSlaMinutes) === "fresh").length;
  const openIssues = dqIssues.filter((i) => i.status !== "resolved");
  const criticalOpen = openIssues.filter((i) => i.severity === "critical" || i.severity === "high").length;
  const reconIssues = openIssues.filter((i) => i.category === "reconciliation").length;
  const mappingIssues = openIssues.filter((i) => i.category === "mapping").length;
  const unmappedAccounts = adAccounts.filter((a) => a.status === "unmapped").length;
  const trustedMetrics = metricDefinitions.filter((m) => m.quality === "trusted").length;
  const degradedMetrics = metricDefinitions.filter((m) => m.quality === "degraded").length;

  // Simple composite trust score, explained in the UI.
  const trustScore = Math.max(
    0,
    Math.round(
      100 -
        (integrations.length - freshCount) * 6 -
        criticalOpen * 8 -
        (openIssues.length - criticalOpen) * 2 -
        degradedMetrics * 4,
    ),
  );

  const filteredIssues = openIssues
    .filter((i) => severityFilter === "any" || i.severity === severityFilter)
    .sort((a, b) => SEVERITY_ORDER[a.severity]! - SEVERITY_ORDER[b.severity]!);

  return (
    <PageBody className="max-w-none">
      <PageHeader
        title="Data health"
        description="How much the numbers can be trusted right now — freshness, mappings, reconciliation, and owned issues."
      />

      {/* trust score + panels */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Card className="gap-1.5 px-4 py-3">
          <span className="text-xs font-medium text-muted-foreground">Overall trust score</span>
          <div className="flex items-baseline gap-2">
            <span className={cn("tnum text-2xl font-semibold", trustScore >= 80 ? "text-success" : trustScore >= 60 ? "text-warning" : "text-destructive")}>
              {trustScore}
            </span>
            <span className="text-xs text-muted-foreground">/ 100</span>
          </div>
          <p className="text-[11px] text-muted-foreground">Penalises stale sources, open issues, degraded metrics.</p>
        </Card>
        <Card className="gap-1.5 px-4 py-3">
          <span className="text-xs font-medium text-muted-foreground">Source freshness</span>
          <span className="tnum text-2xl font-semibold">{freshCount}/{integrations.length}</span>
          <p className="text-[11px] text-muted-foreground">within SLA · 2 stale (Shopee, RudderStack)</p>
        </Card>
        <Card className="gap-1.5 px-4 py-3">
          <span className="text-xs font-medium text-muted-foreground">Unmapped records</span>
          <span className={cn("tnum text-2xl font-semibold", mappingIssues + unmappedAccounts > 0 && "text-warning")}>
            {mappingIssues + unmappedAccounts}
          </span>
          <p className="text-[11px] text-muted-foreground">ad accounts, listings, catalog mappings</p>
        </Card>
        <Card className="gap-1.5 px-4 py-3">
          <span className="text-xs font-medium text-muted-foreground">Reconciliation</span>
          <span className={cn("tnum text-2xl font-semibold", reconIssues > 0 && "text-warning")}>{reconIssues}</span>
          <p className="text-[11px] text-muted-foreground">open exceptions (Chip settlement, COGS version)</p>
        </Card>
        <Card className="gap-1.5 px-4 py-3">
          <span className="text-xs font-medium text-muted-foreground">Metric definitions</span>
          <span className="tnum text-2xl font-semibold">{metricDefinitions.length}</span>
          <p className="text-[11px] text-muted-foreground">{trustedMetrics} trusted · {degradedMetrics} degraded (identity lag)</p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {/* freshness by source */}
        <Card>
          <CardHeader><CardTitle className="text-sm font-medium">Freshness by source</CardTitle></CardHeader>
          <CardContent className="space-y-1.5">
            {[...integrations]
              .sort((a, b) => {
                const order = { stale: 0, aging: 1, fresh: 2 } as const;
                return order[freshnessOf(a.lastSuccessAt, a.freshnessSlaMinutes)] - order[freshnessOf(b.lastSuccessAt, b.freshnessSlaMinutes)];
              })
              .map((i) => (
                <div key={i.id} className="flex items-center justify-between gap-3 text-sm">
                  <Link href={`/integrations/${i.id}`} className="min-w-0 flex-1 truncate underline-offset-2 hover:underline">
                    {i.name}
                  </Link>
                  <span className="tnum text-xs text-muted-foreground">
                    SLA {i.freshnessSlaMinutes >= 60 ? `${Math.round(i.freshnessSlaMinutes / 60)}h` : `${i.freshnessSlaMinutes}m`}
                  </span>
                  <FreshnessBadge lastSuccessAt={i.lastSuccessAt} slaMinutes={i.freshnessSlaMinutes} />
                </div>
              ))}
          </CardContent>
        </Card>

        {/* metric definition coverage */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Metric definition coverage</CardTitle>
            <p className="text-xs text-muted-foreground">Every governed metric, its quality grade, and current caveat.</p>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {metricDefinitions.map((m) => (
              <div key={m.key} className="flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <span>{m.name}</span>
                  {m.caveat && <p className="truncate text-[11px] text-muted-foreground">{m.caveat}</p>}
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "shrink-0 text-[10px]",
                    m.quality === "trusted" && "border-success/30 bg-success/10 text-success",
                    m.quality === "monitored" && "border-info/30 bg-info/10 text-info",
                    m.quality === "degraded" && "border-warning/30 bg-warning/10 text-warning",
                  )}
                >
                  {m.quality}
                </Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* issue queue */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-sm font-medium">Owned issue queue</CardTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">{openIssues.length} open — every issue has an owner and a severity.</p>
          </div>
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="h-8 w-32 text-xs" aria-label="Severity filter"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="any">Any severity</SelectItem>
              {["critical", "high", "medium", "low"].map((s) => (
                <SelectItem key={s} value={s}>{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent className="divide-y">
          {filteredIssues.map((issue) => (
            <div key={issue.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <ShieldAlert
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  issue.severity === "critical" || issue.severity === "high" ? "text-destructive" : issue.severity === "medium" ? "text-warning" : "text-muted-foreground",
                )}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{issue.title}</span>
                  <Badge variant="outline" className="text-[10px] capitalize">{issue.severity}</Badge>
                  <Badge variant="outline" className="text-[10px] capitalize text-muted-foreground">{issue.category.replace("_", " ")}</Badge>
                  {issue.status === "acknowledged" && (
                    <Badge variant="outline" className="border-info/30 bg-info/10 text-[10px] text-info">acknowledged</Badge>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{issue.detail}</p>
                <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                  <span>{issue.id}</span>
                  <span>owner: {personas.find((p) => p.id === issue.ownerId)?.name ?? "unassigned"}</span>
                  {issue.integrationId && (
                    <Link href={`/integrations/${issue.integrationId}`} className="text-info underline-offset-2 hover:underline">
                      {issue.integrationId}
                    </Link>
                  )}
                </div>
              </div>
              {issue.status === "open" &&
                (canAck ? (
                  <Button
                    variant="outline" size="sm" className="h-7 shrink-0 text-xs"
                    onClick={async () => {
                      await repo.acknowledgeDqIssue(issue.id);
                      toast.success(`${issue.id} acknowledged`);
                    }}
                  >
                    Acknowledge
                  </Button>
                ) : (
                  <span className="shrink-0 text-[11px] text-muted-foreground">ack: Ops/Finance</span>
                ))}
              {issue.status === "acknowledged" && (
                <CheckCircle2 className="size-4 shrink-0 text-info" aria-label="Acknowledged" />
              )}
            </div>
          ))}
          {filteredIssues.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">No open issues at this severity.</p>
          )}
        </CardContent>
      </Card>
    </PageBody>
  );
}

export default function DataHealthPage() {
  return (
    <RouteGuard permission="dq.view">
      <DataHealthInner />
    </RouteGuard>
  );
}
