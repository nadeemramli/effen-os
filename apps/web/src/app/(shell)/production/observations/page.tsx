"use client";

import { useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EmptyState, ErrorState, InlineCount, RefreshChip, SkeletonTable } from "@/components/states";
import { tonePill } from "@/components/status/status-pill";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { LiveGuard } from "@/components/auth/live-guard";
import { RouteGuard } from "@/lib/rbac/guard";
import { usePermission } from "@/hooks/use-session";
import { useLiveQuery } from "@/hooks/use-live-query";
import { OBSERVATION_TONE, type WaObservation } from "@/lib/domain/inventory-registry";
import { fetchLiveProduction, fetchWaObservations, reviewWaObservation } from "@/lib/supabase/live";

type Tab = "all" | "unlinked_review" | "linked" | "accepted" | "rejected";

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("en-MY", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" }) : "—";
}

/**
 * Factory WhatsApp updates as immutable evidence (plan §5.3). Review links an
 * observation to a production item; it never creates a stock movement — that
 * needs a structured milestone through the S3 command path.
 */
export default function ObservationsPage() {
  return (
    <LiveGuard>
      <RouteGuard permission="catalog.view">
        <ObservationsInner />
      </RouteGuard>
    </LiveGuard>
  );
}

function ObservationsInner() {
  const canReview = usePermission("orders.approve");
  const [tab, setTab] = useState<Tab>("all");
  const [reviewing, setReviewing] = useState<WaObservation | null>(null);
  const obs = useLiveQuery(() => fetchWaObservations(tab === "all" ? null : tab, 200), [tab]);
  const d = obs.data;
  const total = d?.summary ? Object.values(d.summary).reduce((s, n) => s + n, 0) : null;

  return (
    <PageBody>
      <PageHeader title="WhatsApp observations" description="Every inbound factory message becomes evidence exactly once. Reviewing links it to a production item; stock never moves from an observation." />
      <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs">
        <ShieldAlert className="size-3.5 text-muted-foreground" aria-hidden />
        <Badge variant="outline" className="h-5 font-normal">WhatsApp Cloud API: {d?.connection?.status ?? "—"}</Badge>
        <Badge variant="outline" className="h-5 font-normal">{d?.numbers ?? 0} numbers · parser: none</Badge>
        <span className="text-muted-foreground">{d?.feasibility_gate ?? ""}</span>
        {obs.refreshing && <RefreshChip />}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup type="single" value={tab} onValueChange={(v) => v && setTab(v as Tab)} variant="outline" size="sm">
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="unlinked_review">Needs review</ToggleGroupItem>
          <ToggleGroupItem value="linked">Linked</ToggleGroupItem>
          <ToggleGroupItem value="accepted">Accepted</ToggleGroupItem>
          <ToggleGroupItem value="rejected">Rejected</ToggleGroupItem>
        </ToggleGroup>
        <span className="tnum text-xs text-muted-foreground"><InlineCount value={total} width="w-6" /> observations</span>
      </div>
      {obs.error ? (
        <ErrorState title="Could not load observations" description={obs.error} retry={() => void obs.reload()} />
      ) : obs.loading ? (
        <SkeletonTable rows={5} />
      ) : (d?.rows ?? []).length === 0 ? (
        <EmptyState
          title="No observations yet"
          description={d?.connection?.status === "healthy" ? "No inbound messages have arrived on the connected numbers." : "The WhatsApp Cloud API connection is pending the Meta app; group feasibility (plan §5.2) is unverified. Nothing is inferred in the meantime."}
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr><th className="px-3 py-2 font-medium">Received</th><th className="px-3 py-2 font-medium">Thread / sender</th><th className="px-3 py-2 font-medium">Message</th><th className="px-3 py-2 font-medium">Parsed</th><th className="px-3 py-2 font-medium">State</th><th className="px-3 py-2 font-medium"></th></tr>
            </thead>
            <tbody className="divide-y">
              {(d?.rows ?? []).map((o) => (
                <tr key={o.id}>
                  <td className="tnum px-3 py-1.5">{when(o.received_at)}</td>
                  <td className="px-3 py-1.5"><div>{o.thread_ref ?? "—"}</div><div className="tnum text-[11px] text-muted-foreground">{o.sender_ref ?? "—"}</div></td>
                  <td className="max-w-md px-3 py-1.5">{o.text ?? <span className="text-muted-foreground">(no text)</span>}{o.media > 0 && <span className="text-muted-foreground"> · {o.media} media</span>}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{o.parser_version === "none" ? "not parsed" : JSON.stringify(o.parsed)}</td>
                  <td className="px-3 py-1.5">{tonePill({ label: o.state.replace(/_/g, " "), tone: OBSERVATION_TONE[o.state] })}{o.production_item_id && <div className="text-[11px] text-muted-foreground">item {o.production_item_id}{o.batch_ref ? ` · ${o.batch_ref}` : ""}</div>}</td>
                  <td className="px-3 py-1.5">{canReview && o.state === "unlinked_review" && <Button size="sm" variant="outline" className="h-6 px-1.5 text-[11px]" onClick={() => setReviewing(o)}>Review</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {reviewing && <ReviewDialog obs={reviewing} onClose={() => setReviewing(null)} onDone={() => { setReviewing(null); void obs.reload(); }} />}
    </PageBody>
  );
}

function ReviewDialog({ obs, onClose, onDone }: { obs: WaObservation; onClose: () => void; onDone: () => void }) {
  const prod = useLiveQuery(fetchLiveProduction, []);
  const [state, setState] = useState<"linked" | "accepted" | "rejected">("linked");
  const [item, setItem] = useState<string>("");
  const [batch, setBatch] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const items = prod.data?.items ?? [];

  const submit = async () => {
    setBusy(true);
    try {
      await reviewWaObservation({ id: obs.id, state, productionItemId: item ? Number(item) : null, batchRef: batch.trim() || null, note: note.trim() || null });
      toast.success(`Observation ${state}`, { description: "No stock movement was created." });
      onDone();
    } catch (e) {
      toast.error("Could not review", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Review observation #{obs.id}</DialogTitle>
          <DialogDescription>Link the message to a production item and batch. Accepting records the linkage only — stock changes need a structured milestone.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <blockquote className="rounded-md bg-muted/40 p-2 text-xs">{obs.text ?? "(no text)"}</blockquote>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5"><Label htmlFor="ob-state">Decision</Label>
              <Select value={state} onValueChange={(v) => setState(v as typeof state)}><SelectTrigger id="ob-state"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="linked">Link to item</SelectItem><SelectItem value="accepted">Accept (no stock)</SelectItem><SelectItem value="rejected">Reject</SelectItem></SelectContent></Select></div>
            <div className="grid gap-1.5"><Label htmlFor="ob-item">Production item</Label>
              <Select value={item} onValueChange={setItem}><SelectTrigger id="ob-item"><SelectValue placeholder={items.length ? "Pick" : "No production items"} /></SelectTrigger>
                <SelectContent>{items.map((it) => <SelectItem key={it.id} value={String(it.id)}>{it.name}</SelectItem>)}</SelectContent></Select></div>
          </div>
          <div className="grid gap-1.5"><Label htmlFor="ob-batch">Batch reference</Label><Input id="ob-batch" value={batch} onChange={(e) => setBatch(e.target.value)} /></div>
          <div className="grid gap-1.5"><Label htmlFor="ob-note">Note (audit)</Label><Textarea id="ob-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy || (state !== "rejected" && !item)}>{busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Record</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
