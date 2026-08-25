"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EmptyState, ErrorState, InlineCount, RefreshChip, SkeletonTable } from "@/components/states";
import { FreshnessBadge } from "@/components/status/freshness-badge";
import { tonePill } from "@/components/status/status-pill";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { LiveGuard } from "@/components/auth/live-guard";
import { RouteGuard } from "@/lib/rbac/guard";
import { usePermission } from "@/hooks/use-session";
import { useLiveQuery } from "@/hooks/use-live-query";
import {
  CARRIER_STATE_META,
  NOTIFICATION_STATE_META,
  NV_STATE_META,
  WAREHOUSE_STATE_META,
  type AwbRow,
} from "@/lib/domain/fulfilment-states";
import { awbMarkCached, awbMarkPrinted, fetchAwbManager, fulfilmentMarkHandover } from "@/lib/supabase/live";

type Lane = "all" | "released" | "awb" | "handover" | "pickup";

const LANES: { key: Lane; label: string }[] = [
  { key: "all", label: "All in window" },
  { key: "released", label: "Released, awaiting AWB" },
  { key: "awb", label: "AWB to print" },
  { key: "handover", label: "Printed, awaiting handover" },
  { key: "pickup", label: "Handed over, awaiting pickup" },
];

function inLane(r: AwbRow, lane: Lane): boolean {
  switch (lane) {
    case "released": return r.warehouse_state !== "not_released" && !["awb_available", "awb_cached", "awb_printed"].includes(r.nv_state);
    case "awb": return r.nv_state === "awb_available" || r.nv_state === "awb_cached";
    case "handover": return r.nv_state === "awb_printed" && r.warehouse_state !== "handed_over";
    case "pickup": return r.warehouse_state === "handed_over" && ["not_created", "pending_pickup"].includes(r.carrier_state);
    default: return true;
  }
}

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("en-MY", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" }) : "—";
}

/**
 * AWB Manager — shadow. Six facts per order, kept separate: QC state, release,
 * Ninja Van submission/AWB, warehouse, carrier (webhook evidence only) and
 * notification. Fullkit creates no consignment and fetches no waybill here.
 */
export default function AwbManagerPage() {
  return (
    <LiveGuard>
      <RouteGuard permission="orders.view">
        <AwbInner />
      </RouteGuard>
    </LiveGuard>
  );
}

function AwbInner() {
  const canOperate = usePermission("orders.approve");
  const [lane, setLane] = useState<Lane>("all");
  const [days, setDays] = useState(14);
  const [busy, setBusy] = useState<number | null>(null);
  const state = useLiveQuery(() => fetchAwbManager(days), [days]);
  const rows = useMemo(() => (state.data?.rows ?? []).filter((r) => inLane(r, lane)), [state.data, lane]);

  const act = async (r: AwbRow, fn: () => Promise<unknown>, ok: string) => {
    setBusy(r.order_read_id);
    try {
      await fn();
      toast.success(ok, { description: `#${r.order_ref} · carrier state untouched` });
      await state.reload();
    } catch (e) {
      toast.error("Not recorded", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const s = state.data?.summary;

  return (
    <PageBody>
      <PageHeader title="AWB Manager" description="Push, AWB, print, handover and pickup as separate facts. Shadow mode: Fullkit records what happened and what would be sent; Fighter still books the courier.">
        <ToggleGroup type="single" value={String(days)} onValueChange={(v) => v && setDays(Number(v))} variant="outline" size="sm" aria-label="Window">
          <ToggleGroupItem value="7">7 d</ToggleGroupItem>
          <ToggleGroupItem value="14">14 d</ToggleGroupItem>
          <ToggleGroupItem value="30">30 d</ToggleGroupItem>
        </ToggleGroup>
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs">
        <ShieldAlert className="size-3.5 text-warning" aria-hidden />
        <Badge variant="outline" className="h-5 font-normal">shadow</Badge>
        <span className="text-muted-foreground">{state.data?.gate ?? "ADR-0006: no consignment is created and no waybill is fetched by Fullkit until the exit gate passes."}</span>
        {state.data && (
          <span className="ml-auto inline-flex items-center gap-2 text-muted-foreground">
            stores: {state.data.stores.map((st) => `${st.name.replace(/^WooCommerce — /, "")} · ${st.fulfilment_mode}`).join(" | ")}
            <FreshnessBadge lastSuccessAt={state.data.synced_at} slaMinutes={30} realClock />
          </span>
        )}
        {state.refreshing && <RefreshChip />}
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          { label: "In window", value: s?.rows },
          { label: "Released, awaiting AWB", value: s?.released_awaiting_awb },
          { label: "AWB to print", value: s?.awb_to_print },
          { label: "Printed, awaiting handover", value: s?.printed_awaiting_handover },
          { label: "Handed over, awaiting pickup", value: s?.handed_over_awaiting_pickup },
        ].map((t) => (
          <div key={t.label} className="rounded-lg border bg-card px-3 py-2.5">
            <div className="text-[11px] text-muted-foreground">{t.label}</div>
            <div className="tnum mt-0.5 text-base font-semibold"><InlineCount value={t.value ?? null} width="w-8" /></div>
          </div>
        ))}
      </section>

      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Lanes">
        {LANES.map((l) => (
          <button key={l.key} type="button" role="tab" aria-selected={lane === l.key} onClick={() => setLane(l.key)}
            className={`h-7 rounded-full border px-3 text-xs transition-colors ${lane === l.key ? "border-transparent bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}>
            {l.label}
          </button>
        ))}
      </div>

      {state.error ? (
        <ErrorState title="Could not load the AWB Manager" description={state.error} retry={() => void state.reload()} />
      ) : state.loading ? (
        <SkeletonTable rows={6} />
      ) : rows.length === 0 ? (
        <EmptyState title="Nothing in this lane" description={lane === "awb" ? "AWB availability needs a linked Ninja Van shipment; today parcels are Fighter-booked and rarely linked." : "No pipeline rows match the lane for the selected window."} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Order</th>
                <th className="px-3 py-2 font-medium">QC / release</th>
                <th className="px-3 py-2 font-medium">Ninja Van / AWB</th>
                <th className="px-3 py-2 font-medium">Warehouse</th>
                <th className="px-3 py-2 font-medium">Carrier (webhook)</th>
                <th className="px-3 py-2 font-medium">Notify</th>
                <th className="px-3 py-2 font-medium">Record</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.order_read_id}>
                  <td className="px-3 py-1.5">
                    <Link href={`/orders/${r.order_read_id}`} className="font-medium text-info underline-offset-2 hover:underline">#{r.order_ref}</Link>
                    <div className="text-[11px] text-muted-foreground">{r.customer_name ?? "—"} · {[r.city, r.postcode].filter(Boolean).join(" ")} · {when(r.placed_at)}</div>
                    <div className="text-[11px] text-muted-foreground">gate: {r.stage}{r.gate_issues?.length ? ` · ${r.gate_issues.join(", ")}` : ""}{r.held_by ? ` · held by ${r.held_by}` : ""}</div>
                  </td>
                  <td className="px-3 py-1.5">
                    <div>{r.qc_state ? r.qc_state.replace(/_/g, " ") : <span className="text-muted-foreground">not in QC</span>}</div>
                    <div className="text-[11px] text-muted-foreground">{r.fulfilment_release_state ?? "—"}</div>
                  </td>
                  <td className="px-3 py-1.5">
                    {tonePill(NV_STATE_META[r.nv_state])}
                    <div className="tnum text-[11px] text-muted-foreground">
                      {r.tracking_id ?? "no tracking"}{r.submission_status ? ` · shadow ${r.submission_status}` : ""}
                      {r.awb_printed_at ? ` · printed ${when(r.awb_printed_at)}` : r.awb_cached_at ? ` · cached ${when(r.awb_cached_at)}` : ""}
                    </div>
                  </td>
                  <td className="px-3 py-1.5">
                    {tonePill(WAREHOUSE_STATE_META[r.warehouse_state])}
                    <div className="text-[11px] text-muted-foreground">{r.handed_over_at ? `${when(r.handed_over_at)} · ${r.handed_over_by}` : r.released_to_warehouse_at ? `released ${when(r.released_to_warehouse_at)}` : ""}</div>
                  </td>
                  <td className="px-3 py-1.5">
                    {tonePill(CARRIER_STATE_META[r.carrier_state])}
                    <div className="text-[11px] text-muted-foreground">{r.carrier_last_status ? `${r.carrier_last_status} · ${when(r.carrier_last_event_at)}` : "no carrier evidence"}</div>
                  </td>
                  <td className="px-3 py-1.5">{tonePill(NOTIFICATION_STATE_META[r.notification_state])}</td>
                  <td className="px-3 py-1.5">
                    {canOperate ? (
                      <div className="flex flex-wrap gap-1">
                        {(r.nv_state === "awb_available") && (
                          <Button size="sm" variant="outline" className="h-6 px-1.5 text-[11px]" disabled={busy !== null} onClick={() => void act(r, () => awbMarkCached(r.order_read_id, null), "AWB recorded as downloaded")}>
                            {busy === r.order_read_id ? <Loader2 className="size-3 animate-spin" aria-hidden /> : "Downloaded"}
                          </Button>
                        )}
                        {(r.nv_state === "awb_available" || r.nv_state === "awb_cached") && (
                          <Button size="sm" variant="outline" className="h-6 px-1.5 text-[11px]" disabled={busy !== null} onClick={() => void act(r, () => awbMarkPrinted(r.order_read_id, null), "AWB recorded as printed")}>
                            {busy === r.order_read_id ? <Loader2 className="size-3 animate-spin" aria-hidden /> : "Printed"}
                          </Button>
                        )}
                        {["released", "picking", "picked", "packing", "packed", "ready_for_handover"].includes(r.warehouse_state) && (
                          <Button size="sm" variant="outline" className="h-6 px-1.5 text-[11px]" disabled={busy !== null} onClick={() => void act(r, () => fulfilmentMarkHandover(r.order_read_id, null), "Handover recorded")}>
                            {busy === r.order_read_id ? <Loader2 className="size-3 animate-spin" aria-hidden /> : "Handed over"}
                          </Button>
                        )}
                        {r.warehouse_state === "not_released" && r.qc_state === "approved" && <span className="text-[11px] text-muted-foreground">release from QC</span>}
                        {r.warehouse_state === "not_released" && r.qc_state !== "approved" && <span className="text-[11px] text-muted-foreground">—</span>}
                      </div>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">view only</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">
        Downloaded / printed / handed over are operator-recorded facts. The carrier column changes only on Ninja Van webhook events; printing an AWB or recording a handover can never produce “in transit”.
      </p>
    </PageBody>
  );
}
