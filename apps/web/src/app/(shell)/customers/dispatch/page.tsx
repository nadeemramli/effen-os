"use client";

import { useState } from "react";
import { Loader2, Plus, ShieldOff } from "lucide-react";
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
import { BLOCK_REASON_LABELS, DISPATCH_PURPOSES, DISPATCH_STATUS_META, type DispatchRequest, type DispatchTemplate } from "@/lib/domain/fulfilment-states";
import { cancelDispatchRequest, createDispatchRequest, fetchDispatchRequests, fetchDispatchTemplates } from "@/lib/supabase/live";

type Tab = "all" | "blocked" | "shadow_logged" | "cancelled";

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString("en-MY", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" }) : "—";
}

/**
 * Dispatch — Fullkit-owned contact decisions (intake plan §5). Every row is a
 * decision with its eligibility; the Strive transport is shadow-only, so the
 * envelope shows what would be sent and `sent` is always false.
 */
export default function DispatchPage() {
  return (
    <LiveGuard>
      <RouteGuard permission="customers.view">
        <DispatchInner />
      </RouteGuard>
    </LiveGuard>
  );
}

function DispatchInner() {
  const canAct = usePermission("customers.followup");
  const [tab, setTab] = useState<Tab>("all");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const requests = useLiveQuery(() => fetchDispatchRequests({ status: tab }), [tab]);
  const templates = useLiveQuery(fetchDispatchTemplates, []);

  const cancel = async (r: DispatchRequest) => {
    setBusy(r.id);
    try {
      await cancelDispatchRequest(r.id, null);
      toast.success("Dispatch request cancelled");
      await requests.reload();
    } catch (e) {
      toast.error("Could not cancel", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  return (
    <PageBody>
      <PageHeader title="Dispatch" description="Contact decisions Fullkit owns: purpose, channel, template version, eligibility and outcome. Strive is the transport and runs in shadow — nothing here has been sent.">
        {canAct && (
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="size-3.5" aria-hidden /> Draft request
          </Button>
        )}
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs">
        <ShieldOff className="size-3.5 text-muted-foreground" aria-hidden />
        <Badge variant="outline" className="h-5 font-normal">transport: strive · shadow</Badge>
        <span className="text-muted-foreground">No consent source, verified template or verified endpoint exists yet, so every request is blocked at decision time and recorded for review. A person still makes any contact by hand.</span>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup type="single" value={tab} onValueChange={(v) => v && setTab(v as Tab)} variant="outline" size="sm">
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="blocked">Blocked</ToggleGroupItem>
          <ToggleGroupItem value="shadow_logged">Shadow logged</ToggleGroupItem>
          <ToggleGroupItem value="cancelled">Cancelled</ToggleGroupItem>
        </ToggleGroup>
        <span className="tnum text-xs text-muted-foreground"><InlineCount value={requests.data ? requests.data.length : null} width="w-6" /> shown{requests.refreshing && <RefreshChip className="ml-2" />}</span>
      </div>

      {requests.error ? (
        <ErrorState title="Could not load dispatch requests" description={requests.error} retry={() => void requests.reload()} />
      ) : requests.loading ? (
        <SkeletonTable rows={5} />
      ) : (requests.data ?? []).length === 0 ? (
        <EmptyState title="No dispatch requests" description="QC “request information” and manual drafts land here with their eligibility decision." />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Customer / order</th>
                <th className="px-3 py-2 font-medium">Purpose · channel</th>
                <th className="px-3 py-2 font-medium">Template</th>
                <th className="px-3 py-2 font-medium">Decision</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(requests.data ?? []).map((r) => (
                <tr key={r.id}>
                  <td className="tnum px-3 py-1.5">{when(r.created_at)}</td>
                  <td className="px-3 py-1.5">
                    <a href={`/customers/${encodeURIComponent(r.identity_key)}`} className="text-info underline-offset-2 hover:underline">{r.recipient_masked ?? r.identity_key}</a>
                    {r.order_read_id && <div className="text-[11px] text-muted-foreground"><a href={`/orders/${r.order_read_id}`} className="hover:underline">order #{r.order_read_id}</a> · {r.trigger_event}</div>}
                  </td>
                  <td className="px-3 py-1.5">{r.purpose.replace(/_/g, " ")} · {r.channel}<div className="text-[11px] text-muted-foreground">priority {r.priority} · {r.model}</div></td>
                  <td className="px-3 py-1.5">{r.template_key ? `${r.template_key} v${r.template_version}` : "—"}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex flex-wrap gap-1">
                      {r.block_reasons.length === 0 ? <span className="text-success">eligible</span> : r.block_reasons.map((b) => (
                        <Badge key={b} variant="outline" className="h-5 px-1.5 font-normal text-muted-foreground" title={BLOCK_REASON_LABELS[b] ?? b}>{b.replace(/_/g, " ")}</Badge>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-1.5">{tonePill(DISPATCH_STATUS_META[r.status])}{r.transport_ref && <div className="tnum text-[11px] text-muted-foreground">{r.transport_ref} · sent: false</div>}</td>
                  <td className="px-3 py-1.5">
                    {canAct && (r.status === "blocked" || r.status === "shadow_logged") && (
                      <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px] text-muted-foreground" disabled={busy !== null} onClick={() => void cancel(r)}>
                        {busy === r.id ? <Loader2 className="size-3 animate-spin" aria-hidden /> : "Cancel"}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <DraftDialog templates={templates.data ?? []} onClose={() => setOpen(false)} onCreated={() => { setOpen(false); void requests.reload(); }} />
      )}
    </PageBody>
  );
}

function DraftDialog({ templates, onClose, onCreated }: { templates: DispatchTemplate[]; onClose: () => void; onCreated: () => void }) {
  const [identity, setIdentity] = useState("");
  const [purpose, setPurpose] = useState<string>(DISPATCH_PURPOSES[0].value);
  const [channel, setChannel] = useState<"whatsapp" | "email" | "call">("whatsapp");
  const [template, setTemplate] = useState<string>("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const tpl = templates.find((t) => `${t.key}@${t.version}` === template);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await createDispatchRequest({
        identityKey: identity.trim(),
        model: "order",
        purpose,
        channel,
        templateKey: tpl?.key ?? null,
        templateVersion: tpl?.version ?? 1,
        variables: {},
        orderReadId: null,
        triggerEvent: "manual",
        note: note.trim() || null,
      });
      toast[res.created ? "success" : "info"](res.created ? `Recorded as ${res.request.status}` : "Already recorded", {
        description: res.request.block_reasons.length ? `Blocked: ${res.request.block_reasons.map((b) => b.replace(/_/g, " ")).join(", ")}` : "Shadow logged; nothing sent.",
      });
      onCreated();
    } catch (e) {
      toast.error("Could not record the request", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Draft a dispatch request</DialogTitle>
          <DialogDescription>Records the decision and what would be sent. Nothing is transmitted; the request is blocked until consent, template and transport are verified.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <div className="grid gap-1.5"><Label htmlFor="dr-id">Customer identity key</Label><Input id="dr-id" value={identity} onChange={(e) => setIdentity(e.target.value)} placeholder="phone-keyed, e-mail-keyed or a:… address key" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="dr-purpose">Purpose</Label>
              <Select value={purpose} onValueChange={setPurpose}>
                <SelectTrigger id="dr-purpose"><SelectValue /></SelectTrigger>
                <SelectContent>{DISPATCH_PURPOSES.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="dr-channel">Channel</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as typeof channel)}>
                <SelectTrigger id="dr-channel"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="whatsapp">WhatsApp (Strive)</SelectItem>
                  <SelectItem value="email">E-mail</SelectItem>
                  <SelectItem value="call">Call (manual work item)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="dr-template">Template</Label>
            <Select value={template} onValueChange={setTemplate}>
              <SelectTrigger id="dr-template"><SelectValue placeholder="No template" /></SelectTrigger>
              <SelectContent>
                {templates.filter((t) => t.channel === channel || channel === "call").map((t) => (
                  <SelectItem key={`${t.key}@${t.version}`} value={`${t.key}@${t.version}`}>{t.key} v{t.version} · {t.status}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {tpl && <p className="text-[11px] text-muted-foreground">{tpl.body_preview}</p>}
          </div>
          <div className="grid gap-1.5"><Label htmlFor="dr-note">Note (audit)</Label><Textarea id="dr-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy || identity.trim() === ""}>{busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Record decision</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
