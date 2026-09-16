"use client";

import {
  Bar,
  CartesianGrid,
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
  scaleToRange,
  type DerivedPeriod,
  type EconMetric,
} from "@/lib/domain/customer-base-economics";

const GRID = "var(--border)";
const MUTED = "var(--muted-foreground)";
const NEW = "var(--success)";
const REACTIVATED = "var(--info)";
const LAPSED = "var(--destructive)";
const NET = "var(--foreground)";

/** One colour per overlaid series, held constant across toggle, chart, tooltip and table. */
export const METRIC_COLORS: Record<EconMetric, string> = {
  ncac: "var(--chart-5)",
  spend: "var(--warning)",
  roas: "var(--chart-3)",
  revenue: "var(--chart-1)",
  cm3: "var(--chart-2)",
};

/** Dash pattern per series so they stay distinguishable without colour. */
const METRIC_DASH: Record<EconMetric, string | undefined> = {
  ncac: undefined,
  spend: "6 3",
  roas: "2 3",
  revenue: undefined,
  cm3: "8 3 2 3",
};

export function periodLabel(p: MovementPeriod, grain: MovementGrain): string {
  const d = new Date(`${p.period_start}T00:00:00Z`);
  if (grain === "month") return d.toLocaleDateString("en-MY", { month: "short", year: "2-digit", timeZone: "UTC" });
  return d.toLocaleDateString("en-MY", { day: "numeric", month: "short", timeZone: "UTC" });
}

function n(v: number): string {
  return v.toLocaleString();
}

function pctOf(part: number, whole: number): string {
  return whole > 0 ? `${((part / whole) * 100).toFixed(0)}%` : "—";
}

/** Per-metric breakdown rows, so every point can be traced back to its source lines. */
function econRows(metric: EconMetric, d: DerivedPeriod): Array<[string, string]> {
  const r = d.raw;
  const s = r.spend;
  const ccy = Object.entries(r.revenue_by_currency).filter(([, v]) => Number(v) !== 0);
  const revenueRows: Array<[string, string]> =
    ccy.length > 1 || (ccy.length === 1 && ccy[0]![0] !== "MYR")
      ? ccy.map(([c, v]) => [`Revenue ${c}`, `${c === "MYR" ? "RM" : c} ${Number(v).toLocaleString("en-MY", { maximumFractionDigits: 0 })}`] as [string, string])
      : [];
  switch (metric) {
    case "ncac":
      return [
        ["Spend net of WHT", s ? rmFull(s.net) : "—"],
        ["New (first accepted)", r.new_accepted === null ? "—" : n(r.new_accepted)],
      ];
    case "spend":
      return [
        ["WHT (Meta)", s ? rmFull(s.wht) : "—"],
        ["Banned accounts", s ? rmFull(s.banned) : "—"],
      ];
    case "roas":
      return [
        ["Revenue (MYR)", rmFull(d.revenueMyr)],
        ["Spend gross", s ? rmFull(s.gross) : "—"],
        ["Provider ROAS", d.platformRoas === null ? "—" : `${d.platformRoas.toFixed(2)}× (attribution)`],
      ];
    case "revenue":
      return [...revenueRows, ["Orders", `${n(r.orders)} · COD ${pctOf(r.cod_orders, r.orders)}`]];
    case "cm3":
      return [
        ["CM2", rmFull(d.cm2)],
        ["Ads + WHT", s ? `−${rmFull(s.gross + s.wht)}` : "—"],
        ["CM3 margin", d.cells.cm3.value !== null && d.revenueMyr > 0 ? pctOf(d.cm3, d.revenueMyr) : "—"],
      ];
  }
}

interface Datum extends MovementPeriod {
  label: string;
  lapsed_neg: number;
  derived: DerivedPeriod | null;
  /** Scaled 0–100 per overlaid series, keyed `s_<metric>`; null where withheld. */
  [k: `s_${string}`]: number | null;
}

function Tip({
  active,
  payload,
  label,
  overlays,
}: {
  active?: boolean;
  payload?: Array<{ payload: Datum }>;
  label?: string;
  overlays: EconMetric[];
}) {
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
    <div className="max-w-72 rounded-md border bg-popover px-2.5 py-2 text-xs shadow-md">
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
      {overlays.map((m) => {
        const cell = p.derived?.cells[m];
        const scaled = p[`s_${m}`];
        return (
          <div key={m} className="mt-1.5 border-t pt-1.5">
            <div className="flex items-center gap-2">
              <span className="h-0.5 w-3 rounded" style={{ background: METRIC_COLORS[m] }} aria-hidden />
              <span className="text-muted-foreground">{BASE_METRIC_LABELS[m]}</span>
              <span className="tnum ml-auto pl-3 font-medium text-foreground">{cell ? formatMetric(m, cell.value) : "—"}</span>
              {scaled !== null && scaled !== undefined && <span className="tnum text-muted-foreground">({scaled.toFixed(0)})</span>}
            </div>
            {cell?.reason && <div className="mt-0.5 pl-5 text-muted-foreground">Withheld: {WITHHOLD_LABELS[cell.reason]}</div>}
            {!p.derived && <div className="mt-0.5 pl-5 text-muted-foreground">No economics row for this period.</div>}
            {p.derived && cell?.value !== null && econRows(m, p.derived).map(([k, v]) => (
              <div key={k} className="flex gap-2 pl-5">
                <span className="text-muted-foreground">{k}</span>
                <span className="tnum ml-auto pl-3 text-foreground">{v}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Diverging movement chart: new + reactivated above zero, lapsed below, net
 * active change as a line. Clicking a bar opens the exact population.
 *
 * Economics series (nCAC, ad spend, ROAS, revenue, CM3) can be overlaid as
 * lines on a second axis. Their units differ, so each is min–max scaled to
 * 0–100 within the visible range; the tooltip shows the real value and the
 * scaled position. Withheld periods leave a gap in the line.
 */
export function MovementChart({
  periods,
  grain,
  onSelect,
  overlays = [],
  economics,
}: {
  periods: MovementPeriod[];
  grain: MovementGrain;
  onSelect: (period: MovementPeriod, measure: MovementMeasure) => void;
  overlays?: EconMetric[];
  economics?: Map<string, DerivedPeriod>;
}) {
  const data: Datum[] = periods.map((p) => ({
    ...p,
    label: periodLabel(p, grain),
    lapsed_neg: -p.lapsed,
    derived: economics?.get(p.period_start) ?? null,
  }));
  for (const m of overlays) {
    const scaled = scaleToRange(data.map((d) => d.derived?.cells[m].value ?? null));
    data.forEach((d, i) => {
      d[`s_${m}`] = scaled[i]!;
    });
  }
  const summary = periods.length
    ? `${periods.length} ${grain === "month" ? "months" : "weeks"}: ${n(periods.reduce((a, p) => a + p.new_customers, 0))} new, ${n(periods.reduce((a, p) => a + p.reactivated, 0))} reactivated, ${n(periods.reduce((a, p) => a + p.lapsed, 0))} lapsed${overlays.length ? `; overlaid ${overlays.map((m) => BASE_METRIC_LABELS[m]).join(", ")} scaled 0–100` : ""}`
    : "No periods";

  return (
    <div className="h-72 w-full" role="img" aria-label={`Customer movement. ${summary}`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: overlays.length ? 4 : 8, left: 0, bottom: 0 }} barGap={0} stackOffset="sign">
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: GRID }} tick={{ fontSize: 11, fill: MUTED }} interval="preserveStartEnd" />
          <YAxis yAxisId="flow" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: MUTED }} width={44} tickFormatter={(v: number) => n(v)} />
          {overlays.length > 0 && (
            <YAxis
              yAxisId="scaled"
              orientation="right"
              domain={[0, 100]}
              ticks={[0, 50, 100]}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 10, fill: MUTED }}
              width={30}
              tickFormatter={(v: number) => (v === 0 ? "low" : v === 100 ? "high" : "")}
            />
          )}
          <ReferenceLine yAxisId="flow" y={0} stroke={MUTED} />
          <Tooltip content={<Tip overlays={overlays} />} cursor={{ fill: "var(--muted)", opacity: 0.4 }} />
          <Bar yAxisId="flow" dataKey="new_customers" name="New" stackId="flow" fill={NEW} fillOpacity={overlays.length ? 0.55 : 1} onClick={(d: { payload?: MovementPeriod }) => d.payload && onSelect(d.payload, "new")} cursor="pointer" />
          <Bar yAxisId="flow" dataKey="reactivated" name="Reactivated" stackId="flow" fill={REACTIVATED} fillOpacity={overlays.length ? 0.55 : 1} onClick={(d: { payload?: MovementPeriod }) => d.payload && onSelect(d.payload, "reactivated")} cursor="pointer" />
          <Bar yAxisId="flow" dataKey="lapsed_neg" name="Lapsed" stackId="flow" fill={LAPSED} fillOpacity={overlays.length ? 0.55 : 1} onClick={(d: { payload?: MovementPeriod }) => d.payload && onSelect(d.payload, "lapsed")} cursor="pointer" />
          <Line yAxisId="flow" type="monotone" dataKey="net_active_change" name="Net change" stroke={NET} strokeWidth={1.5} dot={{ r: 2 }} activeDot={{ r: 3 }} strokeOpacity={overlays.length ? 0.6 : 1} />
          {overlays.map((m) => (
            <Line
              key={m}
              yAxisId="scaled"
              type="monotone"
              dataKey={`s_${m}`}
              name={BASE_METRIC_LABELS[m]}
              stroke={METRIC_COLORS[m]}
              strokeWidth={2}
              strokeDasharray={METRIC_DASH[m]}
              dot={{ r: 2.5, strokeWidth: 0, fill: METRIC_COLORS[m] }}
              activeDot={{ r: 4 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
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
