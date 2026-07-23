"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * Shared Recharts pieces. One axis per chart, hairline grid, direct labels
 * where series ≤ 4, and a quiet custom tooltip. Colors come from the theme
 * chart tokens; deltas use the semantic success/destructive roles because
 * they encode state, not series identity.
 */

const GRID = "var(--border)";
const MUTED = "var(--muted-foreground)";

export function currencyShort(minor: number): string {
  const v = minor / 100;
  if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
  return v.toFixed(0);
}

interface TooltipRow {
  name: string;
  value: string;
  color?: string;
}

function ChartTip({
  active,
  label,
  rows,
}: {
  active?: boolean;
  label?: string;
  rows: TooltipRow[];
}) {
  if (!active || rows.length === 0) return null;
  return (
    <div className="rounded-md border bg-popover px-2.5 py-2 text-xs shadow-md">
      {label && <div className="mb-1 font-medium">{label}</div>}
      {rows.map((r) => (
        <div key={r.name} className="flex items-center gap-2">
          {r.color && <span className="size-2 rounded-full" style={{ background: r.color }} aria-hidden />}
          <span className="text-muted-foreground">{r.name}</span>
          <span className="tnum ml-auto pl-3 font-medium text-foreground">{r.value}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------- today vs plan by brand (grouped bars) ---------- */

export interface BrandPlanDatum {
  brand: string;
  plan: number; // minor units
  actual: number;
}

export function PlanVsActualByBrand({ data, currencyLabel }: { data: BrandPlanDatum[]; currencyLabel: string }) {
  return (
    <div className="h-56 w-full" role="img" aria-label="Contribution versus plan by brand">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 18, right: 8, left: 0, bottom: 0 }} barGap={2}>
          <CartesianGrid stroke={GRID} strokeDasharray="0" vertical={false} />
          <XAxis dataKey="brand" tickLine={false} axisLine={{ stroke: GRID }} tick={{ fontSize: 11, fill: MUTED }} />
          <YAxis
            tickFormatter={currencyShort}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fill: MUTED }}
            width={42}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
            content={({ active, payload, label }) => (
              <ChartTip
                active={active}
                label={String(label ?? "")}
                rows={(payload ?? []).map((p) => ({
                  name: p.name === "plan" ? "Plan" : "Actual",
                  value: `${currencyLabel}${((p.value as number) / 100).toLocaleString("en-MY", { maximumFractionDigits: 0 })}`,
                  color: p.name === "plan" ? "var(--muted-foreground)" : "var(--chart-1)",
                }))}
              />
            )}
          />
          <Bar dataKey="plan" name="plan" fill="var(--muted-foreground)" opacity={0.35} radius={[4, 4, 0, 0]} maxBarSize={34} />
          <Bar dataKey="actual" name="actual" fill="var(--chart-1)" radius={[4, 4, 0, 0]} maxBarSize={34}>
            <LabelList
              dataKey="actual"
              position="top"
              formatter={(v) => (typeof v === "number" ? currencyShort(v) : "")}
              className="tnum"
              style={{ fontSize: 10, fill: MUTED }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------- daily trend with plan reference ---------- */

export interface TrendDatum {
  date: string; // short label
  actual: number;
  plan?: number;
}

export function ContributionTrend({ data, currencyLabel }: { data: TrendDatum[]; currencyLabel: string }) {
  return (
    <div className="h-56 w-full" role="img" aria-label="Daily contribution against plan">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="date" tickLine={false} axisLine={{ stroke: GRID }} tick={{ fontSize: 11, fill: MUTED }} interval="preserveStartEnd" minTickGap={28} />
          <YAxis tickFormatter={currencyShort} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: MUTED }} width={42} />
          <Tooltip
            content={({ active, payload, label }) => (
              <ChartTip
                active={active}
                label={String(label ?? "")}
                rows={(payload ?? []).map((p) => ({
                  name: p.dataKey === "plan" ? "Plan" : "Actual",
                  value: `${currencyLabel}${((p.value as number) / 100).toLocaleString("en-MY", { maximumFractionDigits: 0 })}`,
                  color: p.dataKey === "plan" ? "var(--muted-foreground)" : "var(--chart-1)",
                }))}
              />
            )}
          />
          <Line type="monotone" dataKey="plan" stroke="var(--muted-foreground)" strokeDasharray="4 4" strokeWidth={1.5} dot={false} />
          <Line type="monotone" dataKey="actual" stroke="var(--chart-1)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------- variance bars (state-encoded: above/below plan) ---------- */

export interface VarianceDatum {
  date: string;
  variance: number; // minor units, actual − plan
}

export function VarianceBars({ data, currencyLabel }: { data: VarianceDatum[]; currencyLabel: string }) {
  return (
    <div className="h-56 w-full" role="img" aria-label="Daily variance to plan">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="date" tickLine={false} axisLine={{ stroke: GRID }} tick={{ fontSize: 11, fill: MUTED }} interval="preserveStartEnd" minTickGap={28} />
          <YAxis tickFormatter={currencyShort} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: MUTED }} width={46} />
          <ReferenceLine y={0} stroke={GRID} />
          <Tooltip
            cursor={{ fill: "var(--muted)", opacity: 0.4 }}
            content={({ active, payload, label }) => (
              <ChartTip
                active={active}
                label={String(label ?? "")}
                rows={(payload ?? []).map((p) => {
                  const v = p.value as number;
                  return {
                    name: v >= 0 ? "Above plan" : "Below plan",
                    value: `${v >= 0 ? "+" : "−"}${currencyLabel}${Math.abs(v / 100).toLocaleString("en-MY", { maximumFractionDigits: 0 })}`,
                    color: v >= 0 ? "var(--success)" : "var(--destructive)",
                  };
                })}
              />
            )}
          />
          <Bar dataKey="variance" radius={[3, 3, 0, 0]} maxBarSize={18}>
            {data.map((d) => (
              <Cell key={d.date} fill={d.variance >= 0 ? "var(--success)" : "var(--destructive)"} opacity={0.85} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------- spend vs platform revenue (marketing) ---------- */

export interface SpendRevDatum {
  date: string;
  spend: number;
  revenue: number;
}

export function SpendRevenueTrend({ data, currencyLabel }: { data: SpendRevDatum[]; currencyLabel: string }) {
  return (
    <div className="h-56 w-full" role="img" aria-label="Daily ad spend and platform-attributed revenue">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="date" tickLine={false} axisLine={{ stroke: GRID }} tick={{ fontSize: 11, fill: MUTED }} interval="preserveStartEnd" minTickGap={28} />
          <YAxis tickFormatter={currencyShort} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: MUTED }} width={42} />
          <Tooltip
            content={({ active, payload, label }) => (
              <ChartTip
                active={active}
                label={String(label ?? "")}
                rows={(payload ?? []).map((p) => ({
                  name: p.dataKey === "spend" ? "Ad spend" : "Platform revenue",
                  value: `${currencyLabel}${((p.value as number) / 100).toLocaleString("en-MY", { maximumFractionDigits: 0 })}`,
                  color: p.dataKey === "spend" ? "var(--chart-2)" : "var(--chart-1)",
                }))}
              />
            )}
          />
          <Line type="monotone" dataKey="revenue" stroke="var(--chart-1)" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="spend" stroke="var(--chart-2)" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Legend row for multi-series charts (identity never by color alone in tooltips + labels). */
export function ChartLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className="size-2 rounded-full" style={{ background: i.color }} aria-hidden />
          {i.label}
        </span>
      ))}
    </div>
  );
}
