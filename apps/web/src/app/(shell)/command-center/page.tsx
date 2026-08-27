"use client";

import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Cable,
  CheckCircle2,
  ClipboardCheck,
  FilePen,
  Truck,
  Undo2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LiveScorecard } from "@/components/metrics/live-scorecard";
import { PageBody } from "@/components/shell/page-header";
import { FreshnessBadge } from "@/components/status/freshness-badge";
import { ErrorState, InlineCount } from "@/components/states";
import { useLiveQuery } from "@/hooks/use-live-query";
import { useActivePersona, useSession } from "@/hooks/use-session";
import { workItemActionLabel, type WorkItem } from "@/lib/domain/cohorts";
import { statusMeta } from "@/lib/domain/integrations";
import type { OrderQueueCounts } from "@/lib/domain/order-views";
import { ROLE_LABELS } from "@/lib/rbac/matrix";
import { useAppStore } from "@/lib/store/provider";
import {
  fetchIntegrationConnections,
  fetchLiveBrands,
  fetchOpenWorkItems,
  fetchOrderQueueCounts,
  fetchShadowReport,
  fetchWooConnections,
  integrationFreshness,
  type LiveBrand,
  type LiveIntegration,
  type ShadowReport,
} from "@/lib/supabase/live";
import { formatDateTime } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";
import { DemoCommandCenter } from "./_components/demo-command-center";

const SEVERITY_TONE: Record<string, string> = {
  critical: "text-destructive",
  high: "text-destructive",
  medium: "text-warning",
  low: "text-muted-foreground",
};

interface Snapshot {
  integrations: LiveIntegration[];
  brands: LiveBrand[];
  counts: OrderQueueCounts | null;
  /** null = the follow-up query failed (shown as unavailable, never as "nothing waiting"). */
  workItems: WorkItem[] | null;
  shadow: ShadowReport | null;
  fetchedAt: number;
}

function workItemHref(w: WorkItem): string {
  if (w.entity_ref.startsWith("customer:")) return `/customers/${encodeURIComponent(w.entity_ref.slice("customer:".length))}`;
  if (w.entity_ref.startsWith("order:")) return `/orders/${w.entity_ref.slice("order:".length)}`;
  return "/customers/base";
}

/**
 * Landing page over the live mirror: what needs attention now (QC, drafts,
 * courier, sources), the commercial scorecard, open follow-ups, connection
 * trust and the courier shadow gate. Every count comes from a server RPC or
 * table read; while a query is in flight the slot shows a skeleton, never 0.
 * Builds without Supabase (demo mode) render the seeded prototype instead.
 */
export default function CommandCenterPage() {
  const session = useSession();
  const isLive = session.authEmail !== null;
  if (!isLive) return <DemoCommandCenter />;
  return <LiveCommandCenter />;
}

function LiveCommandCenter() {
  const session = useSession();
  const persona = useActivePersona();
  const liveBrandId = useAppStore((s) => s.session.liveBrandId);
  const liveMarkets = useAppStore((s) => s.session.liveMarkets);

  const q = useLiveQuery<Snapshot>(async () => {
    const woo = await fetchWooConnections();
    const integrationIn =
      liveMarkets.length > 0
        ? woo.filter((c) => liveMarkets.includes(c.config?.country_code ?? "")).map((c) => c.id)
        : null;
    const [integrations, brands, counts, workItems, shadow] = await Promise.all([
      fetchIntegrationConnections(),
      fetchLiveBrands(),
      fetchOrderQueueCounts({ brandId: liveBrandId, integrationIn }),
      fetchOpenWorkItems(6).catch(() => null),
      fetchShadowReport(14).catch(() => null),
    ]);
    return { integrations, brands, counts, workItems, shadow, fetchedAt: Date.now() };
  }, [liveBrandId, liveMarkets]);

  const d = q.data;
  const counts = d?.counts ?? null;
  const graded = (d?.integrations ?? []).map((i) => ({ ...i, freshness: integrationFreshness(i, d?.fetchedAt ?? 0) }));
  const configured = graded.filter((i) => i.freshness !== "pending");
  const attentionSources = d
    ? configured.filter((i) => i.freshness !== "fresh" || i.status === "degraded" || i.status === "disconnected")
    : null;
  const healthy = configured.filter((i) => i.freshness === "fresh" && i.status === "healthy").length;
  const brandName = liveBrandId === null ? null : (d?.brands.find((b) => b.id === liveBrandId)?.name ?? `brand #${liveBrandId}`);
  const scopeLabel = [brandName, liveMarkets.length > 0 ? liveMarkets.join(" + ") : null].filter(Boolean).join(" · ");

  const firstName = persona.name.split(" ")[0] ?? persona.name;
  const n = (v: number | null | undefined) => (d && v !== null && v !== undefined ? v : null);

  const attention = [
    {
      icon: ClipboardCheck,
      label: "New / QC",
      count: n(counts?.qc.open),
      detail: counts ? `${counts.qc.new} new · ${counts.qc.needs_customer_info} need customer info · ${counts.qc.on_hold} on hold` : "explicit QC state per order",
      href: "/orders?view=qc",
      tone: "warning" as const,
    },
    {
      icon: FilePen,
      label: "Checkout drafts",
      count: n(counts?.drafts),
      detail: "Fullkit drafts awaiting confirmation",
      href: "/orders/drafts",
      tone: "neutral" as const,
    },
    {
      icon: Truck,
      label: "In transit",
      count: n(counts?.courier.in_transit),
      detail: "courier-wide parcels, Fighter-booked",
      href: "/fulfilment",
      tone: "neutral" as const,
    },
    {
      icon: Undo2,
      label: "Returned, 14d",
      count: n(counts?.courier.returned_14d),
      detail: "RTS with carrier evidence",
      href: "/fulfilment/returns",
      tone: "destructive" as const,
    },
    {
      icon: Cable,
      label: "Sources needing attention",
      count: attentionSources ? attentionSources.length : null,
      detail: attentionSources && attentionSources.length > 0
        ? attentionSources.slice(0, 3).map((s) => s.provider).join(" · ") + (attentionSources.length > 3 ? " · …" : "")
        : d ? `${healthy}/${configured.length} configured sources fresh` : "freshness against each SLA",
      href: "/settings/integrations",
      tone: "warning" as const,
    },
  ];

  return (
    <PageBody>
      <section aria-label="Briefing">
        <p className="max-w-3xl text-balance text-xl font-medium leading-relaxed tracking-tight">
          Good morning, {firstName}.{" "}
          <Link href="/orders?view=qc" className="rounded text-warning underline decoration-warning/40 underline-offset-4 outline-none hover:decoration-warning focus-visible:ring-2 focus-visible:ring-ring">
            <InlineCount value={n(counts?.qc.open)} width="w-8" /> order{counts?.qc.open === 1 ? "" : "s"} in New / QC
          </Link>
          ,{" "}
          <Link href="/settings/integrations" className="rounded text-info underline decoration-info/40 underline-offset-4 outline-none hover:decoration-info focus-visible:ring-2 focus-visible:ring-ring">
            <InlineCount value={attentionSources ? attentionSources.length : null} width="w-6" /> source{attentionSources?.length === 1 ? "" : "s"} need{attentionSources?.length === 1 ? "s" : ""} attention
          </Link>
          , and{" "}
          <Link href="/fulfilment" className="rounded underline decoration-foreground/30 underline-offset-4 outline-none hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring">
            <InlineCount value={n(counts?.courier.in_transit)} width="w-10" /> parcel{counts?.courier.in_transit === 1 ? "" : "s"} in transit
          </Link>
          .
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>Live mirror · viewing as {ROLE_LABELS[session.role]}</span>
          {scopeLabel && <span>· scoped to {scopeLabel}</span>}
          {counts && (
            <>
              <span>· counts as of</span>
              <FreshnessBadge lastSuccessAt={counts.computed_at} slaMinutes={15} realClock />
            </>
          )}
        </p>
      </section>

      {q.error && !d && (
        <ErrorState title="Could not load the live overview" description={q.error} retry={() => void q.reload()} />
      )}
      {q.error && d && (
        <p className="rounded-md border border-destructive/25 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Refresh failed — showing the previous snapshot. {q.error}
        </p>
      )}

      <section aria-label="Needs attention" className={cn("grid grid-cols-2 gap-3 xl:grid-cols-5", q.refreshing && "opacity-70")}>
        {attention.map((a) => (
          <Link
            key={a.label}
            href={a.href}
            className="group rounded-lg border bg-card p-3 outline-none transition-colors hover:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex items-center justify-between">
              <a.icon
                className={cn(
                  "size-4",
                  a.tone === "destructive" && "text-destructive",
                  a.tone === "warning" && "text-warning",
                  a.tone === "neutral" && "text-muted-foreground",
                )}
                aria-hidden
              />
              <span className={cn("tnum text-xl font-semibold", a.count === 0 && "text-muted-foreground")}>
                <InlineCount value={a.count} width="w-8" />
              </span>
            </div>
            <div className="mt-1.5 text-sm font-medium">{a.label}</div>
            <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{a.detail}</div>
          </Link>
        ))}
      </section>

      <LiveScorecard
        fallback={
          <p className="rounded-md border px-3 py-2 text-xs text-muted-foreground">
            The commercial scorecard needs the Supabase environment variables — this build has none.
          </p>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium">Open follow-ups</CardTitle>
            <Badge variant="outline" className="tnum text-xs">
              <InlineCount value={d ? (d.workItems ? d.workItems.length : "?") : null} width="w-4" />
            </Badge>
          </CardHeader>
          <CardContent className="space-y-0 divide-y">
            {!d ? (
              <p className="py-4 text-sm text-muted-foreground">Loading…</p>
            ) : d.workItems === null ? (
              <p className="py-4 text-sm text-muted-foreground">Follow-ups unavailable — the work-item query failed.</p>
            ) : d.workItems.length === 0 ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <CheckCircle2 className="size-4 text-success" aria-hidden />
                No open follow-ups. Cohort workspaces create them.
              </div>
            ) : (
              d.workItems.map((w) => (
                <div key={w.id} className="flex items-start gap-2.5 py-2.5 first:pt-0 last:pb-0">
                  <AlertTriangle className={cn("mt-0.5 size-3.5 shrink-0", SEVERITY_TONE[w.severity] ?? "text-muted-foreground")} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{w.title}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                      <span>{workItemActionLabel(w.next_action)}</span>
                      {w.due_at && (
                        <>
                          <span>·</span>
                          <span className="tnum">due {formatDateTime(w.due_at)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <Button asChild variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs">
                    <Link href={workItemHref(w)}>Open</Link>
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card className="xl:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium">Data trust</CardTitle>
            <Button asChild variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
              <Link href="/settings/data-health">
                Data health <ArrowRight className="size-3" aria-hidden />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Configured sources fresh</span>
              <span className="tnum font-medium">
                {d ? `${healthy}/${configured.length}` : <InlineCount value={null} width="w-10" />}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Pending setup</span>
              <span className="tnum font-medium text-muted-foreground">
                {d ? graded.length - configured.length : <InlineCount value={null} width="w-6" />}
              </span>
            </div>
            <div className="space-y-1.5 border-t pt-2">
              {(attentionSources && attentionSources.length > 0 ? attentionSources : configured)
                .slice(0, 5)
                .map((i) => (
                  <div key={i.id} className="flex items-center justify-between gap-2 text-xs">
                    <Link href={`/settings/integrations/${i.id}`} className="truncate text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                      {i.name}
                    </Link>
                    {i.status === "degraded" || i.status === "disconnected" ? (
                      <span className={cn("rounded-full border px-2 py-0.5 text-[11px]", statusMeta(i.status).className)}>{statusMeta(i.status).label}</span>
                    ) : (
                      <FreshnessBadge lastSuccessAt={i.last_success_at} slaMinutes={i.freshness_sla_minutes} realClock />
                    )}
                  </div>
                ))}
              {d && configured.length === 0 && (
                <p className="text-xs text-muted-foreground">No configured sources yet.</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="xl:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium">Courier shadow gate</CardTitle>
            <Button asChild variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
              <Link href="/settings/automations">
                Automations <ArrowRight className="size-3" aria-hidden />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {!d ? (
              <p className="py-2 text-muted-foreground">Loading…</p>
            ) : d.shadow === null ? (
              <p className="py-2 text-muted-foreground">Shadow report unavailable.</p>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Coverage, 14 days</span>
                  <span className={cn("tnum font-medium", (d.shadow.coverage_pct ?? 0) >= 99 ? "text-success" : "text-warning")}>
                    {d.shadow.coverage_pct === null ? "—" : `${d.shadow.coverage_pct.toFixed(1)}%`}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Matched / mismatched / unmatched</span>
                  <span className="tnum font-medium">
                    {d.shadow.totals.matched ?? 0} / {d.shadow.totals.mismatched ?? 0} / {d.shadow.totals.unmatched ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Open payloads</span>
                  <span className="tnum font-medium">{d.shadow.open}</span>
                </div>
                <p className="border-t pt-2 text-[11px] text-muted-foreground">
                  ADR-0006 exit: ≥99% agreement for two consecutive weeks before any consignment is booked by Fullkit.
                  Fighter books today.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </PageBody>
  );
}
