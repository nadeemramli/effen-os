"use client";

import Link from "next/link";
import { ClipboardCheck, Sparkles, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { tonePill } from "@/components/status/status-pill";
import { EmptyState } from "@/components/states";
import { SHIP_ISSUE_LABELS, type ShipReadinessRow } from "@/lib/supabase/live";
import { relative } from "../_lib/format";
import { useFulfilmentFloor } from "../_lib/fulfilment-floor";

const label = (code: string) => SHIP_ISSUE_LABELS[code] ?? code;

function ReadinessRow({ row, aiSuggested, kind }: { row: ShipReadinessRow; aiSuggested: boolean; kind: "red" | "yellow" | "staged" }) {
  const codes = kind === "yellow" ? row.warnings : row.issues;
  return (
    <li className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
      <Link href={`/orders/${row.id}`} className="text-sm font-medium text-info underline-offset-2 hover:underline">
        #{row.order_number}
      </Link>
      {kind === "staged"
        ? tonePill({ label: "corrected · staged", tone: "info" })
        : kind === "yellow"
          ? tonePill({ label: "bounce risk", tone: "warning" })
          : tonePill({ label: "not ship-ready", tone: "warning" })}
      {aiSuggested && (
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-info">
          <Sparkles className="size-3" aria-hidden />
          AI fix suggested
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
        {kind === "staged"
          ? "Fixed in Fullkit — reaches the courier when write propagation is enabled"
          : codes.map(label).join(" · ")}
        {kind === "red" && Object.keys(row.suggestions ?? {}).length > 0 && " — fix suggested on the order page"}
      </span>
      <span className="tnum shrink-0 text-[11px] text-muted-foreground">{relative(row.placed_at)}</span>
    </li>
  );
}

/** Summary tiles + red lane (blocks the gate) + yellow lane (bounce predictors) + staged corrections. */
export function ReadinessLanes() {
  const { readiness, aiOrderIds } = useFulfilmentFloor();
  const red = readiness.rows.filter((r) => r.issues.length > 0);
  const yellow = readiness.rows.filter((r) => r.issues.length === 0 && r.warnings.length > 0);
  const staged = readiness.rows.filter((r) => r.issues.length === 0 && r.correction_status === "staged");
  const passing = Math.max(0, readiness.checked - readiness.flagged);

  const tiles = [
    { label: "Checked (14d)", value: readiness.checked, hint: "pre-ship orders graded by the gate" },
    { label: "Passing", value: passing, hint: "address validates, ready for courier" },
    { label: "Need fixing", value: readiness.flagged, hint: "blocked until the address is corrected" },
    { label: "Corrected · staged", value: readiness.corrected, hint: "fixed in Fullkit, awaiting write propagation" },
  ];

  const lanes: { key: string; title: string; icon: typeof ClipboardCheck; tone: string; rows: ShipReadinessRow[]; kind: "red" | "yellow" | "staged"; empty: string }[] = [
    { key: "red", title: "Blocked — not ship-ready", icon: TriangleAlert, tone: "text-destructive", rows: red, kind: "red", empty: "Every checked order passes the gate." },
    { key: "yellow", title: "Bounce risk — ships, but likely to return", icon: TriangleAlert, tone: "text-warning", rows: yellow, kind: "yellow", empty: "No bounce predictors on the current orders." },
    { key: "staged", title: "Corrected in Fullkit — staged", icon: ClipboardCheck, tone: "text-info", rows: staged, kind: "staged", empty: "No staged corrections." },
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-md border px-3 py-2">
            <div className="text-[11px] text-muted-foreground">{t.label}</div>
            <div className="tnum text-base font-semibold">{t.value.toLocaleString()}</div>
            <div className="text-[11px] text-muted-foreground">{t.hint}</div>
          </div>
        ))}
      </div>
      {lanes.map((lane) => (
        <Card key={lane.key}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <lane.icon className={`size-4 ${lane.tone}`} aria-hidden />
              {lane.title}
            </CardTitle>
            <Badge variant="outline" className="tnum text-xs">{lane.rows.length}</Badge>
          </CardHeader>
          <CardContent>
            {lane.rows.length === 0 ? (
              <EmptyState title="Lane clear" description={lane.empty} />
            ) : (
              <ul className="divide-y">
                {lane.rows.map((r) => (
                  <ReadinessRow key={r.id} row={r} aiSuggested={aiOrderIds.has(r.id)} kind={lane.kind} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      ))}
    </>
  );
}
