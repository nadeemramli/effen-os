"use client";

import Link from "next/link";
import { ArrowRight, FileBarChart, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { useSession } from "@/hooks/use-session";
import { RouteGuard } from "@/lib/rbac/guard";
import { ROLE_LABELS } from "@/lib/rbac/matrix";
import { useAppStore } from "@/lib/store/provider";
import { formatRelative } from "@/lib/utils/dates";

function ReportsInner() {
  const session = useSession();
  const reports = useAppStore((s) => s.reports);
  const integrations = useAppStore((s) => s.integrations);
  const metricDefinitions = useAppStore((s) => s.metricDefinitions);

  return (
    <PageBody className="max-w-4xl">
      <PageHeader
        title="Reports"
        description="Governed library — every report declares its definitions, grain, lineage, freshness, and export permission."
      />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {reports.map((r) => {
          const sources = r.sourceIntegrationIds
            .map((id) => integrations.find((i) => i.id === id))
            .filter(Boolean);
          const stale = sources.some((s) => s!.status === "stale");
          const lastSync = sources
            .map((s) => s!.lastSuccessAt)
            .filter(Boolean)
            .sort()
            .at(-1);
          const canExport = r.exportRoles.includes(session.role);
          const degraded = r.metricKeys.some(
            (k) => metricDefinitions.find((m) => m.key === k)?.quality === "degraded",
          );
          return (
            <Link
              key={r.slug}
              href={`/reports/${r.slug}`}
              className="group rounded-lg border bg-card p-4 outline-none transition-colors hover:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <FileBarChart className="size-4 text-info" aria-hidden />
                  <span className="text-sm font-semibold">{r.name}</span>
                </div>
                <ArrowRight className="size-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">{r.description}</p>
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
                <Badge variant="outline" className="text-[10px]">grain: {r.grain}</Badge>
                <Badge variant="outline" className="text-[10px] text-muted-foreground">{sources.length} sources</Badge>
                {stale && <Badge variant="outline" className="border-warning/30 bg-warning/10 text-[10px] text-warning">stale source</Badge>}
                {degraded && <Badge variant="outline" className="border-warning/30 bg-warning/10 text-[10px] text-warning">degraded metric</Badge>}
                {lastSync && <span className="tnum text-muted-foreground">freshest {formatRelative(lastSync)}</span>}
                <span className="ml-auto flex items-center gap-1 text-muted-foreground">
                  {canExport ? "export allowed" : (<><Lock className="size-3" aria-hidden /> export: {r.exportRoles.map((x) => ROLE_LABELS[x]).join(", ")}</>)}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </PageBody>
  );
}

export default function ReportsPage() {
  return (
    <RouteGuard permission="reports.view">
      <ReportsInner />
    </RouteGuard>
  );
}
