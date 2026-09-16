"use client";

import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { MovementGrain, MovementMeasure, MovementPeriod } from "@/lib/domain/lifecycle";
import {
  BASE_METRIC_LABELS,
  WITHHOLD_LABELS,
  formatMetric,
  rmFull,
  type DerivedPeriod,
  type EconMetric,
} from "@/lib/domain/customer-base-economics";

const GRID = "var(--border)";
const MUTED = "var(--muted-foreground)";
const NEW = "var(--success)";
const REACTIVATED = "var(--info)";
const LAPSED = "var(--destructive)";
const NET = "var(--foreground)";

/** One colour per metric, held constant across the chart, tooltip and table. */
export const METRIC_COLORS: Record<EconMetric, string> = {
  ncac: "var(--destructive)",
  spend: "var(--warning)",
  roas: "var(--info)",
  revenue: "var(--chart-1)",
  cm3: "var(--success)",
};

export function periodLabel(p: MovementPeriod, grain: MovementGrain): string {
  const d = new Date(`${p.period_start}T00:00:00Z`);
  if (grain === "month") return d.toLocaleDateString("en-MY", { month: "short", year: "2-digit", timeZone: "UTC" });
  return d.toLocaleDateString("en-MY", { day: "numeric", month: "short", timeZone: "UTC" });
}

function n(v: number): string {
  return v.toLocaleString();
}

function Tip({ active, payload, label }: { active?: boolean; payload?: Array<{ payload: MovementPeriod }>; label?: string }) {
  const p = payload?.[0]?.payload;
  if (!active || !p) return null;
  const rows: Array<[string, string, string?]> = [
    ["New", n(p.new_customers), NEW],
    ["Reactivated", n(p.reactivated), REACTIVATED],
    ["Lapsed", `−${n(p.lapsed)}`, LAPSED],
    ["Net change", `${p.net_active_change >= 0 ? "+" : "−"}${n(Math.abs(p.net_active_change))}`, NET],
    ["Net rate", p.rate_applicable && p.net_active_rate !== null ? `${(p.net_active_rate * 100).toFixed(1)}%` : "n/a (opening 0)"],
    ["Opening → closing", `${n(p.opening_active)} → ${n(p.closing_active)}`],
  ];
  return (
    <div className="rounded-md border bg-popover px-2.5 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium">
        {label}
        {!p.is_complete && <span className="ml-1 text-muted-foreground">(in progress)</span>}
      </div>
      {rows.map(([k, v, c]) => (
        <div key={k} className="flex items-center gap-2">
          {c && <span className="size-2 rounded-full" style={{ background: c }} aria-hidden />}
          <span className="text-muted-foreground">{k}</span>
          <span className="tnum ml-auto pl-3 font-medium text-foreground">{v}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Diverging movement chart: new + reactivated above zero, lapsed below, net
 * active change as a line. Clicking a bar opens the exact population.
 */
export function MovementChart({
  periods,
  grain,
  onSelect,
}: {
  periods: MovementPeriod[];
  grain: MovementGrain;
  onSelect: (period: MovementPeriod, measure: MovementMeasure) => void;
}) {
  const data = periods.map((p) => ({ ...p, label: periodLabel(p, grain), lapsed_neg: -p.lapsed }));
  const summary = periods.length
    ? `${periods.length} ${grain === "month" ? "months" : "weeks"}: ${n(periods.reduce((a, p) => a + p.new_customers, 0))} new, ${n(periods.reduce((a, p) => a + p.reactivated, 0))} reactivated, ${n(periods.reduce((a, p) => a + p.lapsed, 0))} lapsed`
    : "No periods";

  return (
    <div className="h-72 w-full" role="img" aria-label={`Customer movement. ${summary}`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={0} stackOffset="sign">
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: GRID }} tick={{ fontSize: 11, fill: MUTED }} interval="preserveStartEnd" />
          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: MUTED }} width={44} tickFormatter={(v: number) => n(v)} />
          <ReferenceLine y={0} stroke={MUTED} />
          <Tooltip content={<Tip />} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
          <Bar dataKey="new_customers" name="New" stackId="flow" fill={NEW} onClick={(d: { payload?: MovementPeriod }) => d.payload && onSelect(d.payload, "new")} cursor="pointer" />
          <Bar dataKey="reactivated" name="Reactivated" stackId="flow" fill={REACTIVATED} onClick={(d: { payload?: MovementPeriod }) => d.payload && onSelect(d.payload, "reactivated")} cursor="pointer" />
          <Bar dataKey="lapsed_neg" name="Lapsed" stackId="flow" fill={LAPSED} onClick={(d: { payload?: MovementPeriod }) => d.payload && onSelect(d.payload, "lapsed")} cursor="pointer" />
          <Line type="monotone" dataKey="net_active_change" name="Net change" stroke={NET} strokeWidth={1.5} dot={{ r: 2 }} activeDot={{ r: 3 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------- Economics companion (nCAC · ad spend · ROAS · revenue · CM3) ---------- */

interface EconDatum {
  label: string;
  period: MovementPeriod;
  derived: DerivedPeriod | null;
  value: number | null;
}

function pctOf(part: number, whole: number): string {
  return whole > 0 ? `${((part / whole) * 100).toFixed(0)}%` : "—";
}

/** Per-metric breakdown rows, so every bar can be traced back to its source lines. */
function econRows(metric: EconMetric, d: DerivedPeriod): Array<[string, string]> {
  const r = d.raw;
  const s = r.spend;
  const ccy = Object.entries(r.revenue_by_currency).filter(([, v]) => Number(v) !== 0);
  const revenueRows: Array<[string, string]> = ccy.length > 1 || (ccy.length === 1 && ccy[0]![0] !== "MYR")
    ? ccy.map(([c, v]) => [`Revenue ${c}`, `${c === "MYR" ? "RM" : c} ${Number(v).toLocaleString("en-MY", { maximumFractionDigits: 0 })}`] as [string, string])
    : [];
  switch (metric) {
    case "ncac":
      return [
        ["Spend gross", s ? rmFull(s.gross) : "—"],
        ["WHT (Meta)", s ? rmFull(s.wht) : "—"],
        ["Spend net", s ? rmFull(s.net) : "—"],
        ["New (first accepted)", r.new_accepted === null ? "—" : n(r.new_accepted)],
        ["New (first delivered)", r.new_customers === null ? "—" : n(r.new_customers)],
      ];
    case "spend":
      return [
        ["Gross", s ? rmFull(s.gross) : "—"],
        ["WHT (Meta)", s ? rmFull(s.wht) : "—"],
        ["Net", s ? rmFull(s.net) : "—"],
        ["Banned accounts", s ? rmFull(s.banned) : "—"],
        ["Provider purchases", s ? n(s.purchases) : "—"],
        ["Fact rows", s ? n(s.fact_rows) : "—"],
      ];
    case "roas":
      return [
        ["Revenue (MYR)", rmFull(d.revenueMyr)],
        ...revenueRows,
        ["Spend gross", s ? rmFull(s.gross) : "—"],
        ["Provider ROAS", d.platformRoas === null ? "—" : `${d.platformRoas.toFixed(2)}× (attribution)`],
      ];
    case "revenue":
      return [
        ...revenueRows,
        ["Orders", n(r.orders)],
        ["of which COD", `${n(r.cod_orders)} (${pctOf(r.cod_orders, r.orders)})`],
        ["Revenue / order", r.orders > 0 ? rmFull(d.revenueMyr / r.orders) : "—"],
      ];
    case "cm3":
      return [
        ["Revenue", rmFull(d.revenueMyr)],
        ...revenueRows,
        ["COGS", `−${rmFull(r.cogs_myr)}`],
        ["Delivery", `−${rmFull(r.delivery_myr)}`],
        ["Returns", `−${rmFull(r.returns_myr)} (${Number(r.rts_parcels).toFixed(0)} RTS)`],
        ["COD fees", `−${rmFull(r.cod_myr)}`],
        ["CM2", rmFull(d.cm2)],
        ["Ads + WHT", s ? `−${rmFull(s.gross + s.wht)}` : "—"],
        ["CM3 margin", d.cells.cm3.value !== null && d.revenueMyr > 0 ? pctOf(d.cm3, d.revenueMyr) : "—"],
        ["SKU coverage", `${(d.coverage * 100).toFixed(1)}%`],
      ];
  }
}

function EconTip({ active, payload, label, metric }: { active?: boolean; payload?: Array<{ payload: EconDatum }>; label?: string; metric: EconMetric }) {
  const d = payload?.[0]?.payload;
  if (!active || !d) return null;
  const cell = d.derived?.cells[metric];
  return (
    <div className="rounded-md border bg-popover px-2.5 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium">
        {label}
        {!d.period.is_complete && <span className="ml-1 text-muted-foreground">(in progress)</span>}
      </div>
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full" style={{ background: METRIC_COLORS[metric] }} aria-hidden />
        <span className="text-muted-foreground">{BASE_METRIC_LABELS[metric]}</span>
        <span className="tnum ml-auto pl-3 font-medium text-foreground">{cell ? formatMetric(metric, cell.value) : "—"}</span>
      </div>
      {cell?.reason && <div className="mt-0.5 max-w-56 text-muted-foreground">Withheld: {WITHHOLD_LABELS[cell.reason]}</div>}
      {!d.derived && <div className="mt-0.5 max-w-56 text-muted-foreground">No economics row for this period.</div>}
      {d.derived && (
        <div className="mt-1.5 space-y-0.5 border-t pt-1.5">
          {econRows(metric, d.derived).map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <span className="text-muted-foreground">{k}</span>
              <span className="tnum ml-auto pl-3 text-foreground">{v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The selected economics metric per movement period, on the same x-axis as
 * the movement chart. Withheld periods leave a gap rather than a zero; the
 * tooltip says why. Negative CM3 is drawn in the destructive tone.
 */
export function EconomicsChart({
  periods,
  grain,
  metric,
  economics,
}: {
  periods: MovementPeriod[];
  grain: MovementGrain;
  metric: EconMetric;
  economics: Map<string, DerivedPeriod>;
}) {
  const data: EconDatum[] = periods.map((p) => {
    const derived = economics.get(p.period_start) ?? null;
    return { label: periodLabel(p, grain), period: p, derived, value: derived?.cells[metric].value ?? null };
  });
  const shown = data.filter((d) => d.value !== null);
  const withheld = data.length - shown.length;
  const summary = shown.length
    ? `${BASE_METRIC_LABELS[metric]} across ${data.length} ${grain === "month" ? "months" : "weeks"}: ${formatMetric(metric, shown[0]!.value, true)} to ${formatMetric(metric, shown[shown.length - 1]!.value, true)}${withheld ? `, ${withheld} withheld` : ""}`
    : `${BASE_METRIC_LABELS[metric]}: no period has a value in range`;
  const color = METRIC_COLORS[metric];
  const hasNegative = shown.some((d) => (d.value ?? 0) < 0);

  return (
    <div className="h-72 w-full" role="img" aria-label={summary}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={0}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: GRID }} tick={{ fontSize: 11, fill: MUTED }} interval="preserveStartEnd" />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: MUTED }}
            width={metric === "roas" ? 44 : 64}
            tickFormatter={(v: number) => formatMetric(metric, v, true)}
          />
          {hasNegative && <ReferenceLine y={0} stroke={MUTED} />}
          {metric === "roas" && <ReferenceLine y={1} stroke={MUTED} strokeDasharray="4 3" label={{ value: "1.0× break-even on spend", position: "insideTopRight", fontSize: 10, fill: MUTED }} />}
          <Tooltip content={<EconTip metric={metric} />} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
          <Bar dataKey="value" name={BASE_METRIC_LABELS[metric]} fill={color} isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.period.period_start} fill={(d.value ?? 0) < 0 ? LAPSED : color} fillOpacity={d.period.is_complete ? 1 : 0.55} />
            ))}
          </Bar>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Stock, kept separate from flow so the base is never stacked with additions. */
export function BaseTrendChart({ periods, grain }: { periods: MovementPeriod[]; grain: MovementGrain }) {
  const data = periods.map((p) => ({ ...p, label: periodLabel(p, grain) }));
  const last = periods[periods.length - 1];
  return (
    <div
      className="h-56 w-full"
      role="img"
      aria-label={`Active base trend. ${last ? `Closing ${n(last.closing_active)}, of which ${n(last.at_risk_closing)} at risk` : "No periods"}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: GRID }} tick={{ fontSize: 11, fill: MUTED }} interval="preserveStartEnd" />
          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: MUTED }} width={44} tickFormatter={(v: number) => n(v)} />
          <Tooltip
            content={({ active, payload, label }) => {
              const p = payload?.[0]?.payload as MovementPeriod | undefined;
              if (!active || !p) return null;
              return (
                <div className="rounded-md border bg-popover px-2.5 py-2 text-xs shadow-md">
                  <div className="mb-1 font-medium">{label}</div>
                  <div className="flex gap-2"><span className="text-muted-foreground">Closing active</span><span className="tnum ml-auto font-medium">{n(p.closing_active)}</span></div>
                  <div className="flex gap-2"><span className="text-muted-foreground">of which at risk</span><span className="tnum ml-auto font-medium">{n(p.at_risk_closing)}</span></div>
                  <div className="flex gap-2"><span className="text-muted-foreground">Opening active</span><span className="tnum ml-auto font-medium">{n(p.opening_active)}</span></div>
                </div>
              );
            }}
          />
          <Line type="monotone" dataKey="closing_active" name="Closing active" stroke={NET} strokeWidth={1.5} dot={false} />
          <Line type="monotone" dataKey="at_risk_closing" name="At risk" stroke="var(--warning)" strokeWidth={1.5} dot={false} strokeDasharray="4 3" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
