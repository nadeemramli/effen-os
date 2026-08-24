"use client";

import Link from "next/link";
import { Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { relative, shortReason } from "../_lib/format";
import { useFulfilmentFloor } from "../_lib/fulfilment-floor";

/** Ninja Van RTS — durable rts_at, not the rollup status. */
export function ReturnsCard() {
  const { returns } = useFulfilmentFloor();
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <Undo2 className="size-4 text-warning" aria-hidden />
          Returned to sender · last {returns?.window_days ?? 14} days
        </CardTitle>
        <Badge variant="outline" className="tnum text-xs">{returns?.summary.returned ?? "—"}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {!returns ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Ninja Van returns feed unavailable right now.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Returned", value: returns.summary.returned.toLocaleString(), hint: "RTS event received" },
                { label: "In return transit", value: returns.summary.in_return_transit.toLocaleString(), hint: "on the RTS leg now, not back yet" },
                { label: "Avg days to RTS", value: returns.summary.avg_days_to_rts != null ? String(returns.summary.avg_days_to_rts) : "—", hint: "pickup → returned" },
                { label: "Linked to an order", value: `${returns.summary.linked.toLocaleString()} / ${returns.summary.returned.toLocaleString()}`, hint: "Fighter-booked parcels carry no store order" },
              ].map((k) => (
                <div key={k.label} className="rounded-md border px-3 py-2">
                  <div className="text-[11px] text-muted-foreground">{k.label}</div>
                  <div className="tnum text-base font-semibold">{k.value}</div>
                  <div className="text-[11px] text-muted-foreground">{k.hint}</div>
                </div>
              ))}
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Why parcels came back</p>
                <ul className="space-y-1">
                  {returns.by_reason.slice(0, 5).map((r) => {
                    const share = returns.summary.returned > 0 ? r.n / returns.summary.returned : 0;
                    return (
                      <li key={r.reason} className="text-xs">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate">{shortReason(r.reason)}</span>
                          <span className="tnum shrink-0 text-muted-foreground">{r.n.toLocaleString()} · {Math.round(share * 100)}%</span>
                        </div>
                        <div className="mt-0.5 h-1 rounded bg-muted">
                          <div className="h-1 rounded bg-warning" style={{ width: `${Math.max(2, share * 100)}%` }} />
                        </div>
                      </li>
                    );
                  })}
                  {returns.by_reason.length === 0 && <li className="text-xs text-muted-foreground">No returns in the window.</li>}
                </ul>
              </div>
              <div>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Latest returned parcels</p>
                <div className="divide-y">
                  {returns.rows.slice(0, 6).map((r) => (
                    <div key={r.id} className="flex items-baseline gap-2 py-1.5 text-xs first:pt-0">
                      <span className="tnum font-medium">{r.tracking_id}</span>
                      {r.order_number ? (
                        <Link href={`/orders?q=${encodeURIComponent(r.order_number)}`} className="text-info underline-offset-2 hover:underline">
                          #{r.order_number}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">{r.order_ref ?? "—"}</span>
                      )}
                      <span className="ml-auto shrink-0 truncate text-muted-foreground" title={r.rts_reason ?? undefined}>
                        {r.rts_reason ? shortReason(r.rts_reason.split(";")[0]) : "—"}
                      </span>
                      <span className="tnum shrink-0 text-muted-foreground">{relative(r.rts_at)}</span>
                    </div>
                  ))}
                  {returns.rows.length === 0 && <p className="py-2 text-xs text-muted-foreground">Nothing returned in the window.</p>}
                </div>
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Parcels are booked by Fighter under its own refs, so most cannot be tied to a store order yet — Profit
              allocates their return cost across MY brands by order share. Order links become native once Fullkit
              books Ninja Van itself.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
