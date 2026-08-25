"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartCard } from "@/components/charts/chart-card";
import { contributionBlocked, monthLabel, ncacBlocked, pct, rm } from "@/lib/domain/customer-economics";
import { Cell, EconShell } from "../_components/econ-shell";

function tipFormatter(v: unknown): string {
  return v === null || v === undefined ? "withheld" : rm(Number(v), 2);
}

export default function AcquisitionEfficiencyPage() {
  return (
    <EconShell
      title="Acquisition efficiency"
      description="What a new customer costs and whether the first order pays for it. nCAC is a currency amount per new customer; FOP is first-order contribution minus matched acquisition cost. Platform CPA is provider attribution, shown for comparison only."
    >
      {(econ) => {
        const chart = [...econ.cohorts]
          .reverse()
          .map((c) => ({
            label: monthLabel(c.cohort_month),
            ncac: ncacBlocked(c) ? null : c.ncac.accepted,
            fo: contributionBlocked(c) ? null : c.first_order.contribution_per_customer,
          }));
        return (
          <>
            <ChartCard title="nCAC vs first-order contribution per customer" subtitle="MYR · blended nCAC (accepted denominator) against what the first order contributes before acquisition cost">
              <div className="h-60 w-full" role="img" aria-label="nCAC versus first-order contribution per cohort month">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chart} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2}>
                    <CartesianGrid stroke="var(--border)" vertical={false} />
                    <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--border)" }} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} width={52} tickFormatter={(v: number) => rm(v)} />
                    <Tooltip formatter={tipFormatter} contentStyle={{ fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="ncac" name="nCAC (accepted)" fill="var(--destructive)" />
                    <Bar dataKey="fo" name="1st-order contribution / customer" fill="var(--success)" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </ChartCard>

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-xs">
                <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Cohort</th>
                    <th className="px-3 py-2 text-right font-medium" title="Meta spend net of dated WHT (D3)">Spend (net)</th>
                    <th className="px-3 py-2 text-right font-medium">New customers</th>
                    <th className="px-3 py-2 text-right font-medium" title="Spend ÷ customers with a first accepted order in the month">nCAC accepted</th>
                    <th className="px-3 py-2 text-right font-medium" title="Spend ÷ customers with a delivered first order">nCAC delivered</th>
                    <th className="px-3 py-2 text-right font-medium" title="Spend ÷ (accepted × paid share); paid share = provider purchases ÷ accepted orders (D4)">nCAC paid</th>
                    <th className="px-3 py-2 text-right font-medium">Paid share</th>
                    <th className="px-3 py-2 text-right font-medium" title="Spend ÷ provider-reported purchases — provider attribution, not new customers">Platform CPA</th>
                    <th className="px-3 py-2 text-right font-medium" title="First-order contribution per customer − nCAC accepted">FOP</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {econ.cohorts.map((c) => {
                    const nb = ncacBlocked(c);
                    const cb = contributionBlocked(c);
                    return (
                      <tr key={c.cohort_month}>
                        <td className="px-3 py-1.5 font-medium">{monthLabel(c.cohort_month)}</td>
                        <td className="px-3 py-1.5 text-right">
                          <Cell value={c.spend ? rm(c.spend.net) : null} reason={nb} title={c.spend ? `gross ${rm(c.spend.gross)} · WHT ${rm(c.spend.wht)} · banned accounts ${rm(c.spend.banned)} · ${c.spend.fact_rows} fact rows` : undefined} />
                        </td>
                        <td className="tnum px-3 py-1.5 text-right">{c.customers_accepted.toLocaleString()}<span className="text-muted-foreground"> / {c.customers_delivered.toLocaleString()}</span></td>
                        <td className="px-3 py-1.5 text-right"><Cell value={rm(c.ncac.accepted, 2)} reason={nb} /></td>
                        <td className="px-3 py-1.5 text-right"><Cell value={rm(c.ncac.delivered, 2)} reason={nb} /></td>
                        <td className="px-3 py-1.5 text-right"><Cell value={rm(c.ncac.paid, 2)} reason={nb} /></td>
                        <td className="px-3 py-1.5 text-right"><Cell value={pct(c.paid_share)} reason={nb} /></td>
                        <td className="px-3 py-1.5 text-right"><Cell value={rm(c.ncac.cpa_platform, 2)} reason={nb} className="text-muted-foreground" title="Provider attribution" /></td>
                        <td className="px-3 py-1.5 text-right">
                          <Cell value={rm(c.first_order.fop, 2)} reason={nb ?? cb} className={c.first_order.fop !== null && c.first_order.fop < 0 ? "text-destructive" : "text-success"} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Spend is Meta only, from the warehouse facts, net of the dated WHT rule; banned-account spend is included and reported in the tooltip. “Paid share” and “Platform CPA” use provider-reported purchases and are labelled non-incremental. New customers are counted by first accepted order (delivered count after the slash).
            </p>
          </>
        );
      }}
    </EconShell>
  );
}
