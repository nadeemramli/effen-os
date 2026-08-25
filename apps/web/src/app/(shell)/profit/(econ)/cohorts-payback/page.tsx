"use client";

import { tonePill } from "@/components/status/status-pill";
import { ECON_HORIZONS, contributionBlocked, monthLabel, ncacBlocked, ratio, rm, type EconCohort } from "@/lib/domain/customer-economics";
import { cn } from "@/lib/utils";
import { Cell, EconShell } from "../_components/econ-shell";

function tone(v: number | null): string {
  if (v === null) return "";
  if (v >= 1) return "bg-success/15 text-success";
  if (v >= 0.75) return "bg-warning/15 text-warning";
  return "bg-destructive/10 text-destructive";
}

function paybackPill(c: EconCohort) {
  const p = c.payback;
  if (p.status === "reached") return tonePill({ label: `paid back by ${p.horizon_days}d`, tone: "success" });
  if (p.status === "not_reached") return tonePill({ label: "not reached", tone: "destructive" });
  if (p.status === "immature") return tonePill({ label: `open · matured to ${p.matured_through_days}d`, tone: "neutral" });
  return tonePill({ label: "unavailable", tone: "neutral" });
}

export default function CohortsPaybackPage() {
  return (
    <EconShell
      title="Cohorts & payback"
      description="Contribution LTV per customer divided by blended nCAC, by cohort month and horizon. A ratio of 1.0 or more means the cohort has paid back its acquisition cost by that horizon."
    >
      {(econ) => (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Cohort</th>
                  <th className="px-3 py-2 text-right font-medium">Customers</th>
                  <th className="px-3 py-2 text-right font-medium">nCAC</th>
                  {ECON_HORIZONS.map((d) => (
                    <th key={d} className="px-3 py-2 text-right font-medium">LTV:nCAC {d}d</th>
                  ))}
                  <th className="px-3 py-2 font-medium">Payback</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {econ.cohorts.map((c) => {
                  const nb = ncacBlocked(c);
                  const cb = contributionBlocked(c);
                  return (
                    <tr key={c.cohort_month}>
                      <td className="px-3 py-1.5 font-medium">{monthLabel(c.cohort_month)}</td>
                      <td className="tnum px-3 py-1.5 text-right">{c.customers_accepted.toLocaleString()}</td>
                      <td className="px-3 py-1.5 text-right"><Cell value={rm(c.ncac.accepted, 2)} reason={nb} /></td>
                      {ECON_HORIZONS.map((d) => {
                        const x = c.horizons.find((h) => h.days === d);
                        const v = x?.ltv_ncac ?? null;
                        return (
                          <td key={d} className="px-3 py-1.5 text-right">
                            <span className={cn("inline-block rounded px-1.5 py-0.5", tone(v))}>
                              <Cell value={ratio(v)} reason={nb ?? cb ?? (x && !x.matured ? "immature" : null)} />
                            </span>
                          </td>
                        );
                      })}
                      <td className="px-3 py-1.5">{paybackPill(c)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Payback is the earliest matured horizon where LTV per customer reaches nCAC (accepted). “Not reached” means every matured horizon is below 1.0; “open” means later horizons are still maturing. Cells are withheld, not zeroed, when spend is missing, the scope mixes currencies, or coverage is below threshold.
          </p>
        </>
      )}
    </EconShell>
  );
}
