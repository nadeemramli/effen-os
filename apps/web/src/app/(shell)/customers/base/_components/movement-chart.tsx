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

const GRID = "var(--border)";
const MUTED = "var(--muted-foreground)";
const NEW = "var(--success)";
const REACTIVATED = "var(--info)";
const LAPSED = "var(--destructive)";
const NET = "var(--foreground)";

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
