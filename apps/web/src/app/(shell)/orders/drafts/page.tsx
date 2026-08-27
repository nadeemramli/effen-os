"use client";

import { useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EmptyState, ErrorState, InlineCount, RefreshChip, SkeletonTable } from "@/components/states";
import { tonePill } from "@/components/status/status-pill";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { LiveGuard } from "@/components/auth/live-guard";
import { RouteGuard } from "@/lib/rbac/guard";
import { usePermission } from "@/hooks/use-session";
import { useLiveQuery } from "@/hooks/use-live-query";
import { QC_STATE_LABELS, QC_STATE_TONES, type OrderDraft } from "@/lib/domain/order-qc";
import { confirmOrderDraft, discardOrderDraft, fetchOrderDrafts, fetchWooConnections } from "@/lib/supabase/live";
import { DraftDialog, money, storeLabel } from "../_components/draft-dialog";
import { maskPhone } from "@/lib/utils/mask";

type Tab = "draft" | "confirmed" | "discarded";

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-MY", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" });
}

/**
 * Manual orders as server-side drafts (R19). Saving is idempotent, confirming
 * freezes the draft and enrols it in New / QC. No stock is reserved, no
 * courier is booked and nothing is written to the store: the store order is
 * created only when the write path is enabled.
 */
export default function OrderDraftsPage() {
  return (
    <LiveGuard>
      <RouteGuard permission="orders.view">
        <DraftsInner />
      </RouteGuard>
    </LiveGuard>
  );
}

function DraftsInner() {
  const canCreate = usePermission("orders.create");
  const [tab, setTab] = useState<Tab>("draft");
  const [editing, setEditing] = useState<OrderDraft | "new" | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const conns = useLiveQuery(fetchWooConnections, []);
  const drafts = useLiveQuery(() => fetchOrderDrafts({ status: tab }), [tab]);
  const connById = useMemo(() => new Map((conns.data ?? []).map((c) => [c.id, c])), [conns.data]);

  const confirm = async (d: OrderDraft) => {
    setBusyId(d.id);
    try {
      const res = await confirmOrderDraft(d.id, d.version);
      toast.success(res.changed ? "Draft confirmed — now in New / QC" : "Already confirmed", {
        description: "No store order exists yet; it is created when the write path is enabled.",
      });
      await drafts.reload();
    } catch (e) {
      toast.error("Could not confirm", { description: (e as Error).message });
    } finally {
      setBusyId(null);
    }
  };

  const discard = async (d: OrderDraft) => {
    setBusyId(d.id);
    try {
      await discardOrderDraft(d.id, null);
      toast.success("Draft discarded");
      await drafts.reload();
    } catch (e) {
      toast.error("Could not discard", { description: (e as Error).message });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <PageBody>
      <PageHeader title="Drafts" description="Manual orders saved in Fullkit. Confirm sends a draft into New / QC; the store order is created only when the write path is enabled.">
        {canCreate && (
          <Button size="sm" onClick={() => setEditing("new")}>
            <Plus className="size-3.5" aria-hidden /> New draft
          </Button>
        )}
      </PageHeader>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup type="single" value={tab} onValueChange={(v) => v && setTab(v as Tab)} variant="outline" size="sm">
          <ToggleGroupItem value="draft">Open</ToggleGroupItem>
          <ToggleGroupItem value="confirmed">Confirmed</ToggleGroupItem>
          <ToggleGroupItem value="discarded">Discarded</ToggleGroupItem>
        </ToggleGroup>
        <span className="tnum text-xs text-muted-foreground">
          <InlineCount value={drafts.data ? drafts.data.length : null} width="w-6" /> shown{drafts.refreshing && <RefreshChip className="ml-2" />}
        </span>
      </div>

      {drafts.error ? (
        <ErrorState title="Could not load drafts" description={drafts.error} retry={() => void drafts.reload()} />
      ) : drafts.loading ? (
        <SkeletonTable rows={4} />
      ) : (drafts.data ?? []).length === 0 ? (
        <EmptyState
          title={tab === "draft" ? "No open drafts" : `No ${tab} drafts`}
          description={tab === "draft" ? "Start one with New draft. Drafts persist server-side and are safe to leave half-done." : "Nothing here for the selected tab."}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {(drafts.data ?? []).map((d) => (
            <Card key={d.id}>
              <CardHeader className="flex flex-row items-start justify-between space-y-0">
                <div>
                  <CardTitle className="text-sm font-medium">
                    Draft #{d.id} · {storeLabel(connById.get(d.integration_id))}
                  </CardTitle>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {d.customer.name ?? "No name"} · {d.customer.phone ? maskPhone(d.customer.phone, false) : "no phone"} · updated {when(d.updated_at)}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {tonePill({ label: d.status, tone: d.status === "confirmed" ? "success" : d.status === "discarded" ? "neutral" : "info" })}
                  {d.order_qc && tonePill({ label: `QC: ${QC_STATE_LABELS[d.order_qc.qc_state]}`, tone: QC_STATE_TONES[d.order_qc.qc_state] })}
                </div>
              </CardHeader>
              <CardContent className="space-y-2 text-xs">
                <ul className="space-y-0.5">
                  {d.items.map((it, i) => (
                    <li key={i} className="flex justify-between gap-2">
                      <span>{it.quantity} × {it.name ?? it.sku}{it.sku && it.name ? <span className="text-muted-foreground"> · {it.sku}</span> : null}</span>
                      <span className="tnum">{money(d.currency_code, Number(it.quantity) * Number(it.unit_price))}</span>
                    </li>
                  ))}
                </ul>
                <div className="flex items-center justify-between border-t pt-2">
                  <span className="text-muted-foreground">
                    {d.payment_method.toUpperCase()} · {[d.shipping.address_1, d.shipping.postcode, d.shipping.city].filter(Boolean).join(", ") || "no address"}
                  </span>
                  <span className="tnum font-medium">{money(d.currency_code, Number(d.total))}</span>
                </div>
                {d.note && <p className="text-muted-foreground">Note: {d.note}</p>}
                {d.status === "draft" && canCreate && (
                  <div className="flex gap-1.5 pt-1">
                    <Button size="sm" variant="outline" className="h-7" disabled={busyId !== null} onClick={() => setEditing(d)}>Edit</Button>
                    <Button size="sm" className="h-7" disabled={busyId !== null} onClick={() => void confirm(d)}>
                      {busyId === d.id && <Loader2 className="size-3 animate-spin" aria-hidden />} Confirm into QC
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-muted-foreground" disabled={busyId !== null} onClick={() => void discard(d)} aria-label="Discard draft">
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  </div>
                )}
                {d.status === "confirmed" && (
                  <p className="text-[11px] text-muted-foreground">
                    Confirmed {d.confirmed_at ? when(d.confirmed_at) : ""}. Awaiting the store write path — no stock reserved, no courier booked.
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {editing !== null && (
        <DraftDialog
          draft={editing === "new" ? null : editing}
          connections={conns.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void drafts.reload();
          }}
        />
      )}
    </PageBody>
  );
}

