"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  Cable,
  CheckCircle2,
  ClipboardList,
  Megaphone,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartCard } from "@/components/charts/chart-card";
import {
  ChartLegend,
  PlanVsActualByBrand,
  ContributionTrend,
} from "@/components/charts/commercial-charts";
import { MetricCard } from "@/components/metrics/metric-card";
import { PageBody } from "@/components/shell/page-header";
import { FreshnessBadge } from "@/components/status/freshness-badge";
import { useActivePersona, useSession } from "@/hooks/use-session";
import { formatMoney, formatPercent, formatRatio } from "@/lib/domain/money";
import { sumRows } from "@/lib/domain/metrics";
import { ROLE_LABELS } from "@/lib/rbac/matrix";
import { dateKey } from "@/lib/seed/clock";
import { useAppStore } from "@/lib/store/provider";
import { cn } from "@/lib/utils";
import { formatDate, formatRelative } from "@/lib/utils/dates";

const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
const word = (n: number) => WORDS[n] ?? String(n);

const SEVERITY_TONE: Record<string, string> = {
  critical: "text-destructive",
  high: "text-destructive",
  medium: "text-warning",
  low: "text-muted-foreground",
};

export default function CommandCenterPage() {
  const session = useSession();
  const persona = useActivePersona();
  const brands = useAppStore((s) => s.brands);
  const orders = useAppStore((s) => s.orders);
  const integrations = useAppStore((s) => s.integrations);
  const recommendations = useAppStore((s) => s.recommendations);
  const workItems = useAppStore((s) => s.workItems);
  const dailyRows = useAppStore((s) => s.dailyRows);
  const dailyPlan = useAppStore((s) => s.dailyPlan);
  const dqIssues = useAppStore((s) => s.dqIssues);
  const adAccounts = useAppStore((s) => s.adAccounts);
  const personas = useAppStore((s) => s.personas);
  const products = useAppStore((s) => s.products);

  const pending = recommendations.filter((r) => r.status === "pending");
  const staleSources = integrations.filter((i) => i.status === "stale");

  const brandName = (id: string) => brands.find((b) => b.id === id)?.name ?? id;
  const personaName = (id: string | null) =>
    personas.find((p) => p.id === id)?.name ?? "Unassigned";

  /* ---------- scoped commercial numbers ---------- */
  const days = session.dateRange === "today" ? 1 : session.dateRange === "7d" ? 7 : 30;
  const keys = useMemo(
    () => new Set(Array.from({ length: days }, (_, i) => dateKey(i))),
    [days],
  );
  const scopedRows = dailyRows.filter(
    (r) => keys.has(r.date) && (session.brandId === "all" || r.brandId === session.brandId),
  );
  const totals = sumRows(scopedRows);
  const scopedPlan = dailyPlan.filter(
    (p) => keys.has(p.date) && (session.brandId === "all" || p.brandId === session.brandId),
  );
  const planContribution = scopedPlan.reduce((s, p) => s + p.expectedContribution, 0);
  const contributionVariance =
    planContribution > 0 ? (totals.contribution - planContribution) / planContribution : 0;

  /* ---------- yesterday (for the briefing line) ---------- */
  const yKey = dateKey(1);
  const yPlanRows = dailyPlan.filter((p) => p.date === yKey);
  const yActual = yPlanRows.reduce((s, p) => s + p.actualContribution, 0);
  const yExpected = yPlanRows.reduce((s, p) => s + p.expectedContribution, 0);
  const contributionBelowPlan = yActual < yExpected;

  /* ---------- attention strip ---------- */
  const exceptionOrders = orders.filter((o) => o.exceptionStatus !== "none");
  const stalledShipments = orders.filter(
    (o) => o.exceptionStatus === "shipment_exception",
  );
  const paymentExceptions = orders.filter((o) => o.exceptionStatus === "payment_exception");
  const stockRisk = products.flatMap((p) =>
    p.variants.filter((v) => v.onHand - v.reserved <= 0 || v.onHand - v.reserved < v.reorderPoint / 2),
  );
  const pacingRisk = 1; // CMP-0003 — surfaced via diagnosis DIA-0001

  const attention = [
    {
      icon: ClipboardList,
      label: "Order exceptions",
      count: exceptionOrders.length,
      detail: `${stalledShipments.length} stalled shipments · ${paymentExceptions.length} payment`,
      href: "/orders?view=exceptions",
      tone: "destructive" as const,
    },
    {
      icon: Cable,
      label: "Failed syncs",
      count: staleSources.length,
      detail: staleSources.map((s) => s.provider).join(" · ") || "All sources healthy",
      href: "/integrations",
      tone: "warning" as const,
    },
    {
      icon: Megaphone,
      label: "Ad pacing risk",
      count: pacingRisk,
      detail: "CMP-0003 spend +35%, MER 2.1 vs 3.0",
      href: "/marketing?campaign=CMP-0003",
      tone: "warning" as const,
    },
    {
      icon: Boxes,
      label: "Stock risk",
      count: stockRisk.length,
      detail: "VER-TON-100 stocked out · low cover on 2 SKUs",
      href: "/catalog/products?filter=stock-risk",
      tone: "warning" as const,
    },
    {
      icon: Sparkles,
      label: "Approvals waiting",
      count: pending.length,
      detail: "Prophit recommendations awaiting a decision",
      href: "/prophit",
      tone: "ai" as const,
    },
  ];

  /* ---------- charts ---------- */
  const brandChart = brands.map((b) => {
    const actual = scopedRows.filter((r) => r.brandId === b.id).reduce((s, r) => s + r.contribution, 0);
    const plan = scopedPlan.filter((p) => p.brandId === b.id).reduce((s, p) => s + p.expectedContribution, 0);
    return { brand: b.name.replace(" (Demo)", ""), plan, actual };
  });

  // Trend starts at D-1: today is partial and would show a misleading dip.
  const trend = Array.from({ length: 30 }, (_, i) => {
    const k = dateKey(30 - i);
    const rows = dailyPlan.filter(
      (p) => p.date === k && (session.brandId === "all" || p.brandId === session.brandId),
    );
    return {
      date: formatDate(rows[0]?.date ?? k),
      actual: rows.reduce((s, p) => s + p.actualContribution, 0),
      plan: rows.reduce((s, p) => s + p.expectedContribution, 0),
    };
  });

  /* ---------- work queue ---------- */
  const myWork = workItems.filter((w) => w.status === "open");
  const mine = myWork.filter((w) => w.ownerId === persona.id);
  const queue = mine.length > 0 ? mine : myWork;

  /* ---------- data trust ---------- */
  const healthy = integrations.filter((i) => i.status === "healthy").length;
  const openDq = dqIssues.filter((i) => i.status !== "resolved");
  const unmappedCount =
    adAccounts.filter((a) => a.status === "unmapped").length +
    openDq.filter((i) => i.category === "mapping").length;
  const reconciliationIssues = openDq.filter((i) => i.category === "reconciliation").length;

  return (
    <PageBody>
      {/* ---------- morning briefing (composed from live state) ---------- */}
      <section aria-label="Morning briefing">
        <p className="max-w-3xl text-balance text-xl font-medium leading-relaxed tracking-tight">
          Good morning{persona.name === "Nadeem" ? "" : `, ${persona.name.split(" ")[0]}`}.{" "}
          <Link href="/prophit" className="rounded text-ai underline decoration-ai/40 underline-offset-4 outline-none hover:decoration-ai focus-visible:ring-2 focus-visible:ring-ring">
            {word(pending.length)} item{pending.length === 1 ? "" : "s"} need{pending.length === 1 ? "s" : ""} a decision
          </Link>
          ,{" "}
          <Link href="/data-health" className="rounded text-warning underline decoration-warning/40 underline-offset-4 outline-none hover:decoration-warning focus-visible:ring-2 focus-visible:ring-ring">
            {word(staleSources.length).toLowerCase()} source{staleSources.length === 1 ? " is" : "s are"} stale
          </Link>
          , and yesterday&apos;s contribution is{" "}
          <Link href="/reports/commercial-overview" className={cn("rounded underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring", contributionBelowPlan ? "text-destructive decoration-destructive/40 hover:decoration-destructive" : "text-success decoration-success/40 hover:decoration-success")}>
            {contributionBelowPlan ? "below" : "on"} plan
          </Link>
          {contributionBelowPlan && (
            <span className="text-muted-foreground">
              {" "}
              ({formatMoney(yActual, "MYR", { compact: true })} vs {formatMoney(yExpected, "MYR", { compact: true })})
            </span>
          )}
          .
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Composed from live prototype state · viewing as {ROLE_LABELS[session.role]} · demo clock 23 Jul 2026, 09:00 MYT
        </p>
      </section>

      {/* ---------- attention strip ---------- */}
      <section aria-label="Needs attention" className="grid grid-cols-2 gap-3 xl:grid-cols-5">
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
                  a.tone === "ai" && "text-ai",
                )}
                aria-hidden
              />
              <span
                className={cn(
                  "tnum text-xl font-semibold",
                  a.count === 0 && "text-muted-foreground",
                )}
              >
                {a.count}
              </span>
            </div>
            <div className="mt-1.5 text-sm font-medium">{a.label}</div>
            <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{a.detail}</div>
          </Link>
        ))}
      </section>

      {/* ---------- commercial scorecard ---------- */}
      <section aria-label="Commercial scorecard" className="grid grid-cols-2 gap-3 lg:grid-cols-4 2xl:grid-cols-7">
        <MetricCard
          metricKey="net_revenue"
          value={formatMoney(totals.netRevenue, "MYR", { compact: true })}
          hint={session.dateRange === "today" ? "Today to 09:00" : `Last ${days} days`}
        />
        <MetricCard
          metricKey="contribution"
          value={formatMoney(totals.contribution, "MYR", { compact: true })}
          delta={{
            text: `${formatPercent(contributionVariance, 1, true)} vs plan`,
            tone: contributionVariance >= 0 ? "success" : "destructive",
          }}
        />
        <MetricCard metricKey="ad_spend" value={formatMoney(totals.adSpend, "MYR", { compact: true })} />
        <MetricCard
          metricKey="blended_mer"
          value={totals.adSpend > 0 ? formatRatio(totals.netRevenue / totals.adSpend) : "—"}
        />
        <MetricCard metricKey="orders" value={totals.orders.toLocaleString()} />
        <MetricCard
          metricKey="new_customer_mix"
          value={totals.orders > 0 ? formatPercent(totals.newCustomerOrders / totals.orders, 0) : "—"}
        />
        <MetricCard
          metricKey="target_variance"
          value={formatPercent(contributionVariance, 1, true)}
          delta={{
            text: contributionVariance >= 0 ? "on or above plan" : "below plan",
            tone: contributionVariance >= 0 ? "success" : "destructive",
          }}
        />
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard
          title="Contribution vs plan by brand"
          subtitle={
            session.dateRange === "today"
              ? "Today to 09:00 — partial day against a full-day plan"
              : `Last ${days} days, actual vs plan`
          }
          right={<ChartLegend items={[{ label: "Plan", color: "var(--muted-foreground)" }, { label: "Actual", color: "var(--chart-1)" }]} />}
        >
          <PlanVsActualByBrand data={brandChart} currencyLabel="RM" />
        </ChartCard>
        <ChartCard
          title="Daily contribution, 30 days"
          subtitle="Contribution after marketing vs the Prophit daily expectation"
          right={<ChartLegend items={[{ label: "Plan", color: "var(--muted-foreground)" }, { label: "Actual", color: "var(--chart-1)" }]} />}
        >
          <ContributionTrend data={trend} currencyLabel="RM" />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* ---------- my work ---------- */}
        <Card className="xl:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium">
              {mine.length > 0 ? `My work — ${persona.name}` : "Open work queue"}
            </CardTitle>
            <Badge variant="outline" className="tnum text-xs">
              {queue.length}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-0 divide-y">
            {queue.slice(0, 6).map((w) => (
              <div key={w.id} className="flex items-start gap-2.5 py-2.5 first:pt-0 last:pb-0">
                <AlertTriangle className={cn("mt-0.5 size-3.5 shrink-0", SEVERITY_TONE[w.severity])} aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{w.title}</div>
                  <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                    <span>{personaName(w.ownerId)}</span>
                    <span>·</span>
                    <span className="tnum">due {formatRelative(w.dueAt)}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{w.nextAction}</div>
                </div>
                <Button asChild variant="ghost" size="sm" className="h-7 shrink-0 px-2 text-xs">
                  <Link
                    href={
                      w.entityRef.startsWith("order:")
                        ? `/orders/${w.entityRef.split(":")[1]}`
                        : w.entityRef.startsWith("recommendation:")
                          ? "/prophit"
                          : w.entityRef.startsWith("integration:")
                            ? `/integrations/${w.entityRef.split(":")[1]}`
                            : "/command-center"
                    }
                  >
                    Open
                  </Link>
                </Button>
              </div>
            ))}
            {queue.length === 0 && (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <CheckCircle2 className="size-4 text-success" aria-hidden />
                Nothing waiting on you.
              </div>
            )}
          </CardContent>
        </Card>

        {/* ---------- ranked recommendations ---------- */}
        <Card className="xl:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
              <Sparkles className="size-4 text-ai" aria-hidden />
              Prophit recommendations
            </CardTitle>
            <Button asChild variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
              <Link href="/prophit">
                All <ArrowRight className="size-3" aria-hidden />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-0 divide-y">
            {[...pending]
              .sort((a, b) => b.expectedContributionImpact - a.expectedContributionImpact)
              .slice(0, 4)
              .map((r) => (
                <Link key={r.id} href="/prophit" className="block py-2.5 outline-none first:pt-0 last:pb-0 focus-visible:ring-2 focus-visible:ring-ring">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-medium">{r.title}</span>
                    <span className="tnum shrink-0 text-sm font-semibold text-success">
                      +{formatMoney(r.expectedContributionImpact, r.currency, { compact: true })}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="tnum">{Math.round(r.confidence * 100)}% confidence</span>
                    <span>·</span>
                    <span className={cn(r.risk === "high" ? "text-destructive" : r.risk === "medium" ? "text-warning" : undefined)}>
                      {r.risk} risk
                    </span>
                    <span>·</span>
                    <span>{personaName(r.ownerId)}</span>
                    <span>·</span>
                    <span className="tnum">expires {formatRelative(r.expiresAt)}</span>
                  </div>
                </Link>
              ))}
          </CardContent>
        </Card>

        {/* ---------- data trust ---------- */}
        <Card className="xl:col-span-1">
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm font-medium">Data trust</CardTitle>
            <Button asChild variant="ghost" size="sm" className="h-7 gap-1 px-2 text-xs">
              <Link href="/data-health">
                Data health <ArrowRight className="size-3" aria-hidden />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Source coverage</span>
              <span className="tnum font-medium">
                {healthy}/{integrations.length} healthy
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Reconciliation</span>
              <span className={cn("tnum font-medium", reconciliationIssues > 0 && "text-warning")}>
                {reconciliationIssues > 0 ? `${reconciliationIssues} open exceptions` : "clean"}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Unmapped records</span>
              <span className={cn("tnum font-medium", unmappedCount > 0 && "text-warning")}>
                {unmappedCount}
              </span>
            </div>
            <div className="space-y-1.5 border-t pt-2">
              {[...integrations]
                .sort((a, b) => (a.status === "stale" ? -1 : 1) - (b.status === "stale" ? -1 : 1))
                .slice(0, 5)
                .map((i) => (
                  <div key={i.id} className="flex items-center justify-between gap-2 text-xs">
                    <Link href={`/integrations/${i.id}`} className="truncate text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                      {i.name}
                    </Link>
                    <FreshnessBadge lastSuccessAt={i.lastSuccessAt} slaMinutes={i.freshnessSlaMinutes} />
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* brand scope note */}
      {session.brandId !== "all" && (
        <p className="text-xs text-muted-foreground">
          Scoped to {brandName(session.brandId)} — switch to “All brands” in the top bar for the full picture.
        </p>
      )}
    </PageBody>
  );
}
