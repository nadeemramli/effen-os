"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  WORK_ITEM_ACTIONS,
  WORK_ITEM_SEVERITIES,
  workItemActionLabel,
  type WorkItem,
  type WorkItemAction,
  type WorkItemSeverity,
  type WorkItemSource,
} from "@/lib/domain/cohorts";
import { closeWorkItem, createCustomerWorkItem } from "@/lib/supabase/live";
import { cn } from "@/lib/utils";

export interface FollowUpTarget {
  identityKey: string;
  displayName: string | null;
}

/**
 * Create an internal follow-up (work item) for one customer. The command is
 * audited and idempotent server-side: one open item per customer × action.
 * Nothing is sent to the customer — "WhatsApp (manual)" means a person does it.
 */
export function FollowUpDialog({
  target,
  source,
  defaultAction = "call",
  onClose,
  onCreated,
}: {
  target: FollowUpTarget | null;
  source: WorkItemSource;
  defaultAction?: WorkItemAction;
  onClose: () => void;
  onCreated: (item: WorkItem, created: boolean) => void;
}) {
  const [action, setAction] = useState<WorkItemAction>(defaultAction);
  const [severity, setSeverity] = useState<WorkItemSeverity>("medium");
  const [due, setDue] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!target) return;
    setBusy(true);
    try {
      const res = await createCustomerWorkItem({
        identityKey: target.identityKey,
        nextAction: action,
        severity,
        // Date-only input → start of the working day in Kuala Lumpur.
        dueAt: due ? `${due}T09:00:00+08:00` : null,
        note: note.trim() || null,
        source,
      });
      if (res.created) toast.success("Follow-up logged", { description: `${workItemActionLabel(action)} · ${severity}` });
      else toast.info("Already open", { description: `An open ${workItemActionLabel(action).toLowerCase()} follow-up exists for this customer.` });
      onCreated(res.work_item, res.created);
      setNote("");
      setDue("");
      onClose();
    } catch (e) {
      toast.error("Could not log the follow-up", { description: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const hint = WORK_ITEM_ACTIONS.find((a) => a.value === action)?.hint;

  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Log a follow-up</DialogTitle>
          <DialogDescription>
            {target?.displayName ?? "This customer"} · internal work item, recorded in the audit log. Nothing is sent to the customer.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="fu-action">Next action</Label>
            <Select value={action} onValueChange={(v) => setAction(v as WorkItemAction)}>
              <SelectTrigger id="fu-action"><SelectValue /></SelectTrigger>
              <SelectContent>
                {WORK_ITEM_ACTIONS.map((a) => (
                  <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="fu-severity">Severity</Label>
              <Select value={severity} onValueChange={(v) => setSeverity(v as WorkItemSeverity)}>
                <SelectTrigger id="fu-severity"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WORK_ITEM_SEVERITIES.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="fu-due">Due</Label>
              <Input id="fu-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="fu-note">Note (audit log only)</Label>
            <Textarea id="fu-note" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why this follow-up; no customer message text here." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Log follow-up
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const SEVERITY_TONE: Record<WorkItemSeverity, string> = {
  low: "text-muted-foreground",
  medium: "",
  high: "text-warning",
};

function dueLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const overdue = d.getTime() < Date.now();
  return `${overdue ? "overdue " : "due "}${d.toLocaleDateString("en-MY", { day: "numeric", month: "short", timeZone: "Asia/Kuala_Lumpur" })}`;
}

/** One open follow-up with Done / Drop; closing is audited too. */
export function OpenWorkItem({ item, canClose, onClosed, compact = false }: { item: WorkItem; canClose: boolean; onClosed: (item: WorkItem) => void; compact?: boolean }) {
  const [busy, setBusy] = useState<"done" | "dropped" | null>(null);
  const close = async (outcome: "done" | "dropped") => {
    setBusy(outcome);
    try {
      const res = await closeWorkItem({ id: item.id, outcome });
      onClosed(res.work_item);
      toast.success(outcome === "done" ? "Follow-up done" : "Follow-up dropped");
    } catch (e) {
      toast.error("Could not close the follow-up", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const due = dueLabel(item.due_at);
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", compact ? "text-[11px]" : "text-xs")}>
      <Badge variant="outline" className={cn("h-5 gap-1 px-1.5 font-normal", SEVERITY_TONE[item.severity])}>
        {workItemActionLabel(item.next_action)}
        {due && <span className={cn("tnum", due.startsWith("overdue") && "text-destructive")}>· {due}</span>}
      </Badge>
      {canClose && (
        <>
          <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[11px]" disabled={busy !== null} onClick={() => void close("done")}>
            {busy === "done" ? <Loader2 className="size-3 animate-spin" aria-hidden /> : "Done"}
          </Button>
          <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[11px] text-muted-foreground" disabled={busy !== null} onClick={() => void close("dropped")}>
            {busy === "dropped" ? <Loader2 className="size-3 animate-spin" aria-hidden /> : "Drop"}
          </Button>
        </>
      )}
    </div>
  );
}
