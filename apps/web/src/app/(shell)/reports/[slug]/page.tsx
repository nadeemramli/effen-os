"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import { ArrowLeft, Download, Info, Lock } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartCard } from "@/components/charts/chart-card";
import { ChartLegend, ContributionTrend } from "@/components/charts/commercial-charts";
import { PageBody } from "@/components/shell/page-header";
import { FreshnessBadge } from "@/components/status/freshness-badge";
import { EmptyState } from "@/components/states";
import { useSession } from "@/hooks/use-session";
import { formatMoney, formatPercent, formatRatio } from "@/lib/domain/money";
import { orderContribution, sumRows, toMYR } from "@/lib/domain/metrics";
import { RouteGuard } from "@/lib/rbac/guard";
import { ROLE_LABELS } from "@/lib/rbac/matrix";
import { COGS_BY_VARIANT } from "@/lib/seed";
import { dateKey } from "@/lib/seed/clock";
import { useAppStore } from "@/lib/store/provider";
import { formatDate } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

function downloadCsv(filename: string, headers: string[], rows: (string | number)[][]) {
  const csv = [headers.join(","), ...rows.map((r) => r.map((c) => (typeof c === "string" && c.includes(",") ? `"${c}"` : c)).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function ReportDetailInner() {
  const params = useParams<{ slug: string }>();
  const session = useSession();
  const report = useAppStore((s) => s.reports.find((r) => r.slug === params.slug));
  const metricDefinitions = useAppStore((s) => s.metricDefinitions);
  const integrations = useAppStore((s) => s.integrations);
  const dailyRows = useAppStore((s) => s.dailyRows);
  const dailyPlan = useAppStore((s) => s.dailyPlan);
  const brands = useAppStore((s) => s.brands);
  const orders = useAppStore((s) => s.orders);
  const customers = useAppStore((s) => s.customers);
  const campaigns = useAppStore((s) => s.campaigns);
  const products = useAppStore((s) => s.products);

  const days = session.dateRange === "today" ? 1 : session.dateRange === "7d" ? 7 : 30;
  const keys = useMemo(() => new Set(Array.from({ length: days }, (_, i) => dateKey(i))), [days]);
  const scopedOrders = useMemo(
    () =>
      orders.filter((o) => {
        if (o.isDraft || o.orderStatus === "cancelled") return false;
        if (session.brandId !== "all" && o.brandId !== session.brandId) return false;
        const k = new Date(new Date(o.placedAt).getTime() + 8 * 3600e3).toISOString().slice(0, 10);
        return keys.has(k);
      }),
    [orders, session.brandId, keys],
  );

  if (!report) {
    return (
      <PageBody className="max-w-3xl">
        <EmptyState title="Report not found" description="This report slug is not in the governed library." action={{ label: "Report library", href: "/reports" }} />
      </PageBody>
    );
  }

  const canExport = report.exportRoles.includes(session.role);
  const defs = report.metricKeys.map((k) => metricDefinitions.find((m) => m.key === k)).filter(Boolean);
  const sources = report.sourceIntegrationIds.map((id) => integrations.find((i) => i.id === id)).filter(Boolean);

  /* ---------- per-report content ---------- */
  let body: React.ReactNode = null;
  let exportRows: { headers: string[]; rows: (string | number)[][] } | null = null;

  if (report.slug === "commercial-overview") {
    const byBrand = brands.map((b) => {
      const rows = dailyRows.filter((r) => keys.has(r.date) && r.brandId === b.id);
      const t = sumRows(rows);
      const plan = dailyPlan.filter((p) => keys.has(p.date) && p.brandId === b.id).reduce((s, p) => s + p.expectedContribution, 0);
      return { brand: b, ...t, plan, variance: plan > 0 ? (t.contribution - plan) / plan : 0 };
    });
    exportRows = {
      headers: ["brand", "net_revenue_myr", "contribution_myr", "ad_spend_myr", "blended_mer", "variance_vs_plan"],
      rows: byBrand.map((r) => [r.brand.name, r.netRevenue / 100, r.contribution / 100, r.adSpend / 100, r.adSpend ? (r.netRevenue / r.adSpend).toFixed(2) : "", (r.variance * 100).toFixed(1) + "%"]),
    };
    const trend = Array.from({ length: 30 }, (_, i) => {
      const k = dateKey(30 - i); // excludes today (partial day)
      const rows = dailyPlan.filter((p) => p.date === k && (session.brandId === "all" || p.brandId === session.brandId));
      return { date: formatDate(`${k}T12:00+08:00`), actual: rows.reduce((s, p) => s + p.actualContribution, 0), plan: rows.reduce((s, p) => s + p.expectedContribution, 0) };
    });
    body = (
      <>
        <ChartCard title="Contribution vs plan, 30 days" right={<ChartLegend items={[{ label: "Plan", color: "var(--muted-foreground)" }, { label: "Actual", color: "var(--chart-1)" }]} />}>
          <ContributionTrend data={trend} currencyLabel="RM" />
        </ChartCard>
        <Card>
          <CardContent className="pt-4">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-muted-foreground">
                <th className="pb-2 font-medium">Brand</th><th className="pb-2 text-right font-medium">Net revenue</th>
                <th className="pb-2 text-right font-medium">Contribution</th><th className="pb-2 text-right font-medium">Ad spend</th>
                <th className="pb-2 text-right font-medium">Blended MER</th><th className="pb-2 text-right font-medium">Vs plan</th>
              </tr></thead>
              <tbody>
                {byBrand.map((r) => (
                  <tr key={r.brand.id} className="border-b last:border-0">
                    <td className="py-2">{r.brand.name.replace(" (Demo)", "")}</td>
                    <td className="tnum py-2 text-right">{formatMoney(r.netRevenue, "MYR", { compact: true })}</td>
                    <td className="tnum py-2 text-right">{formatMoney(r.contribution, "MYR", { compact: true })}</td>
                    <td className="tnum py-2 text-right">{formatMoney(r.adSpend, "MYR", { compact: true })}</td>
                    <td className="tnum py-2 text-right">{r.adSpend > 0 ? formatRatio(r.netRevenue / r.adSpend) : "—"}</td>
                    <td className={cn("tnum py-2 text-right font-medium", r.variance >= 0 ? "text-success" : "text-destructive")}>{formatPercent(r.variance, 1, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Drill through: <Link href="/orders" className="text-info underline-offset-2 hover:underline">orders</Link> ·{" "}
              <Link href="/marketing" className="text-info underline-offset-2 hover:underline">campaigns</Link> ·{" "}
              <Link href="/prophit" className="text-info underline-offset-2 hover:underline">variance diagnosis</Link>
            </p>
          </CardContent>
        </Card>
      </>
    );
  } else if (report.slug === "order-fulfilment") {
    const total = scopedOrders.length;
    const exceptions = scopedOrders.filter((o) => o.exceptionStatus !== "none");
    const byCourier = ["ninja_van", "jnt"].map((c) => {
      const co = scopedOrders.filter((o) => o.courier === c);
      const delivered = co.filter((o) => o.shipmentStatus === "delivered").length;
      const stalled = co.filter((o) => o.exceptionStatus === "shipment_exception").length;
      return { courier: c === "jnt" ? "J&T Express" : "Ninja Van", orders: co.length, delivered, stalled };
    });
    exportRows = {
      headers: ["courier", "orders", "delivered", "stalled"],
      rows: byCourier.map((r) => [r.courier, r.orders, r.delivered, r.stalled]),
    };
    body = (
      <Card>
        <CardContent className="space-y-4 pt-4">
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Orders in scope", value: total.toLocaleString() },
              { label: "Exception rate", value: total ? formatPercent(exceptions.length / total, 1) : "—" },
              { label: "Open returns", value: String(scopedOrders.filter((o) => ["requested", "approved", "in_transit", "received"].includes(o.returnStatus)).length) },
            ].map((m) => (
              <div key={m.label} className="rounded-lg border px-3 py-2.5">
                <div className="text-[11px] text-muted-foreground">{m.label}</div>
                <div className="tnum mt-0.5 text-lg font-semibold">{m.value}</div>
              </div>
            ))}
          </div>
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground">
              <th className="pb-2 font-medium">Courier</th><th className="pb-2 text-right font-medium">Orders</th>
              <th className="pb-2 text-right font-medium">Delivered</th><th className="pb-2 text-right font-medium">Stalled &gt;48h</th>
            </tr></thead>
            <tbody>
              {byCourier.map((r) => (
                <tr key={r.courier} className="border-b last:border-0">
                  <td className="py-2">{r.courier}</td>
                  <td className="tnum py-2 text-right">{r.orders}</td>
                  <td className="tnum py-2 text-right">{r.delivered}</td>
                  <td className={cn("tnum py-2 text-right", r.stalled > 0 && "font-medium text-destructive")}>{r.stalled}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-muted-foreground">
            The 6 stalled Ninja Van parcels trace to the 21 Jul webhook gap — drill through:{" "}
            <Link href="/orders?view=sla-risk" className="text-info underline-offset-2 hover:underline">SLA-risk orders</Link> ·{" "}
            <Link href="/integrations/INT-ninja-van" className="text-info underline-offset-2 hover:underline">Ninja Van connection</Link>
          </p>
        </CardContent>
      </Card>
    );
  } else if (report.slug === "marketing-consolidation") {
    const rows = campaigns
      .filter((c) => session.brandId === "all" || c.brandId === session.brandId)
      .map((c) => {
        const daily = c.daily.filter((d) => keys.has(d.date));
        const spend = daily.reduce((s, d) => s + d.spend, 0);
        const rev = daily.reduce((s, d) => s + d.platformRevenue, 0);
        return { c, spend, rev, mer: spend > 0 ? rev / spend : 0 };
      })
      .sort((a, b) => b.spend - a.spend);
    exportRows = {
      headers: ["campaign", "platform", "spend", "platform_revenue", "platform_mer", "target_mer"],
      rows: rows.map((r) => [r.c.name, r.c.platform, r.spend / 100, r.rev / 100, r.mer.toFixed(2), r.c.targetMer]),
    };
    body = (
      <Card>
        <CardContent className="pt-4">
          <p className="mb-3 flex items-start gap-2 rounded-md border border-info/25 bg-info/10 px-3 py-2 text-xs text-info">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Platform-attributed revenue is not accounting revenue or proven incrementality.
          </p>
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground">
              <th className="pb-2 font-medium">Campaign</th><th className="pb-2 font-medium">Platform</th>
              <th className="pb-2 text-right font-medium">Spend</th><th className="pb-2 text-right font-medium">Platform rev</th>
              <th className="pb-2 text-right font-medium">MER / target</th>
            </tr></thead>
            <tbody>
              {rows.map(({ c, spend, rev, mer }) => (
                <tr key={c.id} className="border-b last:border-0">
                  <td className="max-w-64 truncate py-2 pr-2">
                    <Link href={`/marketing?campaign=${c.id}`} className="text-info underline-offset-2 hover:underline">{c.name}</Link>
                  </td>
                  <td className="py-2 capitalize text-muted-foreground">{c.platform.replace("_", " ")}</td>
                  <td className="tnum py-2 text-right">{formatMoney(spend, c.currency, { compact: true })}</td>
                  <td className="tnum py-2 text-right">{formatMoney(rev, c.currency, { compact: true })}</td>
                  <td className={cn("tnum py-2 text-right font-medium", mer >= c.targetMer ? "text-success" : "text-destructive")}>
                    {mer.toFixed(2)} / {c.targetMer.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    );
  } else if (report.slug === "customer-cohorts") {
    const withOrders = customers.filter((c) => c.lifetimeOrders > 0 && (session.brandId === "all" || c.brandIds.includes(session.brandId)));
    const repeatMix = ["first_time", "repeat", "loyal"].map((state) => ({
      state,
      count: withOrders.filter((c) => c.repeatState === state).length,
    }));
    const scoped = sumRows(dailyRows.filter((r) => keys.has(r.date) && (session.brandId === "all" || r.brandId === session.brandId)));
    exportRows = {
      headers: ["repeat_state", "customers"],
      rows: repeatMix.map((r) => [r.state, r.count]),
    };
    body = (
      <Card>
        <CardContent className="space-y-4 pt-4">
          <p className="rounded-md border border-warning/25 bg-warning/10 px-3 py-2 text-xs text-warning">
            Identity data is degraded: RudderStack profiles are 14h stale (DQ-0002). Repeat and new-customer figures may restate when the sync recovers.
          </p>
          <div className="grid grid-cols-3 gap-3">
            {repeatMix.map((r) => (
              <div key={r.state} className="rounded-lg border px-3 py-2.5">
                <div className="text-[11px] capitalize text-muted-foreground">{r.state.replace("_", " ")} customers</div>
                <div className="tnum mt-0.5 text-lg font-semibold">{r.count.toLocaleString()}</div>
                <div className="text-[11px] text-muted-foreground">{formatPercent(r.count / Math.max(withOrders.length, 1), 0)} of buyers</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border px-3 py-2.5">
              <div className="text-[11px] text-muted-foreground">New-customer order mix (period)</div>
              <div className="tnum mt-0.5 text-lg font-semibold">{scoped.orders ? formatPercent(scoped.newCustomerOrders / scoped.orders, 0) : "—"}</div>
            </div>
            <div className="rounded-lg border px-3 py-2.5">
              <div className="text-[11px] text-muted-foreground">New-customer revenue share</div>
              <div className="tnum mt-0.5 text-lg font-semibold">{scoped.netRevenue ? formatPercent(scoped.newCustomerRevenue / scoped.netRevenue, 0) : "—"}</div>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Drill through: <Link href="/customers" className="text-info underline-offset-2 hover:underline">Customer 360 list</Link>
          </p>
        </CardContent>
      </Card>
    );
  } else if (report.slug === "product-contribution") {
    const bySku = new Map<string, { name: string; qty: number; revenue: number; contribution: number; currency: "MYR" | "SGD" }>();
    for (const o of scopedOrders) {
      const orderContrib = orderContribution(o, COGS_BY_VARIANT);
      const orderNet = o.grandTotal - o.refundedTotal;
      for (const it of o.items) {
        const cur = bySku.get(it.sku) ?? { name: it.nameSnapshot, qty: 0, revenue: 0, contribution: 0, currency: o.currency };
        cur.qty += it.quantity;
        cur.revenue += toMYR(it.lineTotal, o.currency);
        cur.contribution += orderNet > 0 ? Math.round(toMYR(orderContrib, o.currency) * (it.lineTotal / orderNet)) : 0;
        bySku.set(it.sku, cur);
      }
    }
    const rows = [...bySku.entries()].sort((a, b) => b[1].contribution - a[1].contribution);
    const variantBySku = new Map(products.flatMap((p) => p.variants.map((v) => [v.sku, v] as const)));
    exportRows = {
      headers: ["sku", "units", "revenue_myr", "contribution_myr", "atp"],
      rows: rows.map(([sku, r]) => [sku, r.qty, r.revenue / 100, r.contribution / 100, (variantBySku.get(sku)?.onHand ?? 0) - (variantBySku.get(sku)?.reserved ?? 0)]),
    };
    body = (
      <Card>
        <CardContent className="pt-4">
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-muted-foreground">
              <th className="pb-2 font-medium">SKU</th><th className="pb-2 text-right font-medium">Units</th>
              <th className="pb-2 text-right font-medium">Revenue (MYR)</th><th className="pb-2 text-right font-medium">Contribution (pre-mktg)</th>
              <th className="pb-2 text-right font-medium">ATP</th><th className="pb-2 font-medium">Constraint</th>
            </tr></thead>
            <tbody>
              {rows.map(([sku, r]) => {
                const v = variantBySku.get(sku);
                const atp = v ? v.onHand - v.reserved : 0;
                const constrained = v && (atp <= 0 || atp < v.reorderPoint);
                return (
                  <tr key={sku} className="border-b last:border-0">
                    <td className="py-2">
                      <Link href={`/catalog/products?sku=${sku}`} className="tnum text-info underline-offset-2 hover:underline">{sku}</Link>
                      <div className="max-w-56 truncate text-[11px] text-muted-foreground">{r.name}</div>
                    </td>
                    <td className="tnum py-2 text-right">{r.qty}</td>
                    <td className="tnum py-2 text-right">{formatMoney(r.revenue, "MYR", { compact: true })}</td>
                    <td className="tnum py-2 text-right">{formatMoney(r.contribution, "MYR", { compact: true })}</td>
                    <td className={cn("tnum py-2 text-right", atp <= 0 ? "font-medium text-destructive" : "")}>{atp}</td>
                    <td className="py-2 text-xs">
                      {atp <= 0 ? <span className="text-destructive">stocked out — demand lost</span>
                        : constrained ? <span className="text-warning">low cover</span>
                        : <span className="text-muted-foreground">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted-foreground">
            VER-TON-100 shows no period sales because it has been stocked out — the constraint, not demand. See{" "}
            <Link href="/prophit" className="text-info underline-offset-2 hover:underline">REC-0033</Link>.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <PageBody className="max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon" className="size-7" aria-label="Report library">
              <Link href="/reports"><ArrowLeft className="size-4" /></Link>
            </Button>
            <h1 className="text-lg font-semibold tracking-tight">{report.name}</h1>
            <Badge variant="outline" className="text-[10px] text-muted-foreground">governed</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{report.description}</p>
        </div>
        {canExport ? (
          <Button
            size="sm" variant="outline" className="gap-1.5"
            onClick={() => {
              if (exportRows) {
                downloadCsv(`fullkit-${report.slug}.csv`, exportRows.headers, exportRows.rows);
                toast.success("CSV exported", { description: "Synthetic demo data — clearly not production figures." });
              }
            }}
          >
            <Download className="size-3.5" aria-hidden /> Export CSV
          </Button>
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="size-3.5" aria-hidden />
            Export limited to {report.exportRoles.map((r) => ROLE_LABELS[r]).join(", ")}
          </span>
        )}
      </div>

      {/* governance panel */}
      <Card>
        <CardHeader><CardTitle className="text-sm font-medium">Definitions, lineage & freshness</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Metric definitions</div>
            <ul className="space-y-1.5">
              {defs.map((d) => (
                <li key={d!.key} className="text-xs">
                  <span className="font-medium">{d!.name}</span>
                  <span className={cn("ml-1.5 rounded px-1 py-px text-[10px]", d!.quality === "degraded" ? "bg-warning/12 text-warning" : d!.quality === "trusted" ? "bg-success/12 text-success" : "bg-info/12 text-info")}>{d!.quality}</span>
                  <span className="block text-muted-foreground">{d!.formula}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Grain & filters</div>
            <p className="text-xs">{report.grain}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Scoped by top-bar controls: brand = {session.brandId === "all" ? "all brands" : session.brandId}, range = {session.dateRange}.
            </p>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Source lineage</div>
            <ul className="space-y-1">
              {sources.map((s) => (
                <li key={s!.id} className="flex items-center justify-between gap-2 text-xs">
                  <Link href={`/integrations/${s!.id}`} className="underline-offset-2 hover:underline">{s!.name}</Link>
                  <FreshnessBadge lastSuccessAt={s!.lastSuccessAt} slaMinutes={s!.freshnessSlaMinutes} />
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      {body}
    </PageBody>
  );
}

export default function ReportDetailPage() {
  return (
    <RouteGuard permission="reports.view">
      <ReportDetailInner />
    </RouteGuard>
  );
}
