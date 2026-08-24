"use client";

import Link from "next/link";
import { GitBranch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FULFILMENT_STAGE_LABELS } from "@/lib/supabase/live";
import { cnStage } from "../_lib/format";
import { useFulfilmentFloor } from "../_lib/fulfilment-floor";

/** Pipeline stage tiles + shadow evidence for the Synovil MY pilot. Held orders are worked on Exceptions. */
export function PipelineCard() {
  const { pipeline, shadow } = useFulfilmentFloor();
  if (pipeline.length === 0) return null;
  const held = pipeline.filter((r) => r.stage === "held").length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2 text-sm font-medium">
          <GitBranch className="size-4 text-info" aria-hidden />
          Fulfilment pipeline — Synovil MY pilot (shadow mode)
        </CardTitle>
        <Badge variant="outline" className="border-info/30 bg-info/10 text-[10px] text-info">
          writes nothing external
        </Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {(["intake", "exception", "held", "gate_passed", "shadow_logged"] as const).map((stage) => {
            const count = pipeline.filter((r) => r.stage === stage).length;
            return (
              <div key={stage} className="rounded-md border px-3 py-2">
                <div className="text-[11px] capitalize text-muted-foreground">{FULFILMENT_STAGE_LABELS[stage]}</div>
                <div className={cnStage(stage, count)}>{count}</div>
              </div>
            );
          })}
        </div>

        {held > 0 && (
          <p className="text-xs text-muted-foreground">
            {held.toLocaleString()} held — frozen until released.{" "}
            <Link href="/fulfilment/exceptions" className="text-info underline-offset-2 hover:underline">
              Review on Exceptions
            </Link>
            .
          </p>
        )}

        {shadow && (
          <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="font-medium text-foreground">Shadow evidence (14d)</span>
              <span className="tnum">
                coverage {shadow.coverage_pct !== null ? `${shadow.coverage_pct}%` : "—"} · target ≥99% for 2 weeks
              </span>
              {Object.entries(shadow.totals).map(([k, v]) => (
                <span key={k} className="tnum text-muted-foreground">{k} {v}</span>
              ))}
            </div>
            {shadow.recent_exceptions.length > 0 && (
              <ul className="mt-1.5 space-y-0.5 text-muted-foreground">
                {shadow.recent_exceptions.slice(0, 5).map((x, i) => (
                  <li key={i} className="tnum">
                    #{x.order_number} — {x.status}
                    {x.compare?.woo_status ? ` (source ${String(x.compare.woo_status)})` : ""}
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              Shadow payloads scored against Woo order outcomes (Fighter shipping flips the source status) —
              per-field payload diffs arrive with the NV order-details API. Nothing is sent to Ninja Van.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
