"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard } from "@/components/charts/chart-card";
import { contributionBlocked, monthLabel, pct, rm, type EconCohort, type Horizon } from "@/lib/domain/customer-economics";
import { Cell, EconShell } from "../_components/econ-shell";

const SHOWN: Horizon[] = [30, 60, 90];
const COLORS = ["var(--foreground)", "var(--info)", "var(--success)", "var(--warning)", "var(--destructive)", "var(--muted-foreground)"];

function h(c: EconCohort, days: Horizon) {
  return c.horizons.find((x) => x.days === days) ?? null;
}

/** LTV per customer by horizon for the newest cohorts that have any matured horizon. */
function ltvCurves(cohorts: EconCohort[]) {
  const usable = cohorts.filter((c) => !contributionBlocked(c) && c.horizons.some((x) => x.matured && x.ltv_per_customer !== null)).slice(0, 6);
  const rows = [0, 30, 60, 90, 180, 365].map((days) => {
    const row: Record<string, number | string | null> = { days };
    for (const c of usable) row[c.cohort_month] = h(c, days as Horizon)?.ltv_per_customer ?? null;
    return row;
  });
  return { usable, rows };
}

function tipFormatter(v: unknown, name: unknown): [string, string] {
  return [v === null || v === undefined ? "immature" : rm(Number(v), 2), monthLabel(String(name))];
}

export default function CustomerEconomicsPage() {
  return (
    <EconShell
      title="Customer economics"
      description="What a newly acquired customer is worth over time: first-order contribution, contribution LTV by observed horizon, and repeat behaviour. Contribution = revenue − COGS − delivery − COD − expected returns; fixed costs excluded."
    >
      {(econ) => {
        const { usable, rows } = ltvCurves(econ.cohorts);
        return (
          <>
            <ChartCard title="Contribution LTV per customer" subtitle="Newest cohorts with a matured horizon · MYR · published only where every customer has reached the horizon">
              {usable.length === 0 ? (
                <p className="py-10 text-center text-xs text-muted-foreground">No cohort in scope has a publishable LTV curve (currency mixed, coverage below threshold, or no matured horizon).</p>
              ) : (
                <div className="h-64 w-full" role="img" aria-label={`LTV per customer by horizon for ${usable.length} cohorts`}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke="var(--border)" vertical={false} />
                      <XAxis dataKey="days" tickLine={false} axisLine={{ stroke: "var(--border)" }} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickFormatter={(d: number) => `${d}d`} />
                      <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} width={52} tickFormatter={(v: number) => rm(v)} />
                      <Tooltip formatter={tipFormatter} labelFormatter={(d) => `${d} days`} contentStyle={{ fontSize: 12 }} />
                      {usable.map((c, i) => (
                        <Line key={c.cohort_month} type="monotone" dataKey={c.cohort_month} name={c.cohort_month} stroke={COLORS[i % COLORS.length]} strokeWidth={1.5} dot={{ r: 2 }} connectNulls={false} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </ChartCard>

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Cohort</th>
                    <th className="px-3 py-2 text-right font-medium">Customers</th>
                    <th className="px-3 py-2 text-right font-medium" title="First-order revenue ÷ accepted customers (order currency)">1st-order revenue / cust.</th>
                    <th className="px-3 py-2 text-right font-medium" title="First-order contribution ÷ accepted customers (MYR)">1st-order contribution / cust.</th>
                    {SHOWN.map((d) => (
                      <th key={d} className="px-3 py-2 text-right font-medium">LTV {d}d</th>
                    ))}
                    <th className="px-3 py-2 text-right font-medium">Repeat 90d</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {econ.cohorts.map((c) => {
                    const blocked = contributionBlocked(c);
                    return (
                      <tr key={c.cohort_month}>
                        <td className="px-3 py-1.5 font-medium">{monthLabel(c.cohort_month)}</td>
                        <td className="tnum px-3 py-1.5 text-right">
                          {c.customers_accepted.toLocaleString()}
                          {c.customers_delivered !== c.customers_accepted && <span className="text-muted-foreground"> · {c.customers_delivered.toLocaleString()} delivered</span>}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <Cell value={c.customers_accepted > 0 ? (c.first_order.revenue / c.customers_accepted).toFixed(0) : null} title="Order currency; not converted" />
                        </td>
                        <td className="px-3 py-1.5 text-right"><Cell value={rm(c.first_order.contribution_per_customer, 2)} reason={blocked ?? (c.first_order.contribution_per_customer === null ? "currency_mixed" : null)} /></td>
                        {SHOWN.map((d) => {
                          const x = h(c, d);
                          return (
                            <td key={d} className="px-3 py-1.5 text-right">
                              <Cell value={x?.ltv_per_customer === null || x?.ltv_per_customer === undefined ? null : rm(x.ltv_per_customer, 2)} reason={blocked ?? (x && !x.matured ? "immature" : null)} />
                            </td>
                          );
                        })}
                        <td className="px-3 py-1.5 text-right"><Cell value={pct(h(c, 90)?.repeat_rate)} reason={h(c, 90)?.matured ? null : "immature"} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Revenue per customer is shown in the order currency and never converted. LTV rows are MYR contribution and appear only for MYR-only scopes with cost coverage ≥ 90 % and identity coverage ≥ 95 %; “immature” means not every customer of the month has reached that horizon.
            </p>
          </>
        );
      }}
    </EconShell>
  );
}
