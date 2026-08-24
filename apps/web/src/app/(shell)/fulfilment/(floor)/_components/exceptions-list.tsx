"use client";

import Link from "next/link";
import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { tonePill } from "@/components/status/status-pill";
import { EmptyState } from "@/components/states";
import { releaseFulfilmentOrder, type LiveOrderRow } from "@/lib/supabase/live";
import { orderSearchHref, relative } from "../_lib/format";
import { useFulfilmentFloor } from "../_lib/fulfilment-floor";

const nextAction = (o: LiveOrderRow) =>
  o.source_status === "on-hold" ? "Review hold — verify payment or release" :
  o.source_status === "failed" ? "Follow up failed payment with buyer" : "—";

/** Woo holds + pipeline holds (with Release) + courier-reported exceptions. Ship-readiness has its own lane. */
export function ExceptionsList() {
  const { holds, pipeline, nvExceptions, readiness, reload } = useFulfilmentFloor();
  const [releasing, setReleasing] = useState<number | null>(null);
  const pipelineHeld = pipeline.filter((r) => r.stage === "held");
  const total = holds.total + pipelineHeld.length + nvExceptions.length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <ShieldAlert className="size-4 text-destructive" aria-hidden />
          Fulfilment exceptions
        </CardTitle>
        <Badge variant="outline" className="tnum text-xs">{total}</Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {readiness.flagged > 0 && (
          <p className="text-xs text-muted-foreground">
            {readiness.flagged.toLocaleString()} orders are not ship-ready —{" "}
            <Link href="/fulfilment/readiness" className="text-info underline-offset-2 hover:underline">
              fix them on Ship-readiness
            </Link>
            .
          </p>
        )}
        {total === 0 ? (
          <EmptyState title="No exceptions" description="Holds, courier exceptions, and automation failures appear here." />
        ) : (
          <ul className="divide-y">
            {holds.rows.map((o) => (
              <li key={o.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                <Link href={orderSearchHref(o)} className="text-sm font-medium text-info underline-offset-2 hover:underline">
                  #{o.order_number ?? o.source_order_id}
                </Link>
                {tonePill(
                  o.source_status === "on-hold"
                    ? { label: "On hold", tone: "warning" }
                    : { label: "Payment failed", tone: "destructive" },
                )}
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{nextAction(o)}</span>
                <span className="tnum shrink-0 text-[11px] text-muted-foreground">{relative(o.placed_at)}</span>
              </li>
            ))}
            {pipelineHeld.map((r) => (
              <li key={`held-${r.order_read_id}`} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                <Link href={`/orders/${r.order_read_id}`} className="text-sm font-medium text-info underline-offset-2 hover:underline">
                  #{r.order_number}
                </Link>
                {tonePill({ label: "Held", tone: "info" })}
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {r.held_by ?? "—"}{r.hold_reason ? ` · ${r.hold_reason}` : ""} — frozen until released
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={releasing === r.order_read_id}
                  onClick={async () => {
                    setReleasing(r.order_read_id);
                    try {
                      await releaseFulfilmentOrder(r.order_read_id);
                      toast.success(`#${r.order_number} released`, { description: "Re-graded on the next gate tick." });
                      await reload();
                    } catch (e) {
                      toast.error("Release failed", { description: (e as Error).message });
                    } finally {
                      setReleasing(null);
                    }
                  }}
                >
                  Release
                </Button>
              </li>
            ))}
            {nvExceptions.map((s) => (
              <li key={`nv-${s.id}`} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                <span className="tnum text-sm font-medium">{s.tracking_id}</span>
                {tonePill({ label: s.status ?? "Exception", tone: "warning" })}
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  Courier-reported exception — check the parcel in the Ninja Van dashboard
                </span>
                <span className="tnum shrink-0 text-[11px] text-muted-foreground">{relative(s.last_event_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
