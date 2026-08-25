"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { tonePill } from "@/components/status/status-pill";
import { usePermission } from "@/hooks/use-session";
import { useLiveQuery } from "@/hooks/use-live-query";
import {
  QC_ACTION_LABELS,
  QC_ALLOWED,
  QC_REASON_CODES,
  QC_STATE_LABELS,
  QC_STATE_TONES,
  READINESS_TO_REASON,
  reasonLabel,
  type OrderQc,
  type OrderQcEvent,
  type QcAction,
  type WorkspaceMember,
} from "@/lib/domain/order-qc";
import {
  fetchOrderQc,
  fetchWorkspaceMembers,
  qcApprove,
  qcAssign,
  qcCorrectAndRevalidate,
  qcEnrol,
  qcHold,
  qcReject,
  qcReleaseToFulfilment,
  qcRequestInformation,
  qcStartReview,
} from "@/lib/supabase/live";

type Mode = "request_information" | "hold" | "reject" | "assign" | "approve" | "correct_and_revalidate" | null;

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-MY", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kuala_Lumpur" });
}

/**
 * New / QC review panel for one mirrored order. Reads the explicit QC record
 * (never inferred from source status), offers only the transitions the
 * server allows for the current state, and sends the version it loaded so a
 * concurrent change is rejected rather than overwritten. Approval clears QC
 * only: it never implies reservation, courier, AWB or handover.
 */
export function QcPanel({
  orderReadId,
  sourceStatus,
  readinessIssues,
  hasCorrection,
  onChanged,
}: {
  orderReadId: number;
  sourceStatus: string;
  /** Ship-readiness issue keys, to pre-tick matching reason codes. */
  readinessIssues?: string[];
  /** A staged shipping correction exists (from the fix dialog). */
  hasCorrection?: boolean;
  onChanged?: () => void;
}) {
  const canReview = usePermission("orders.assign");
  const canDecide = usePermission("orders.approve");
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState<QcAction | "enrol" | null>(null);
  const state = useLiveQuery(() => fetchOrderQc(orderReadId), [orderReadId]);
  const qc = state.data?.qc ?? null;
  const events = state.data?.events ?? [];
  const eligible = ["pending", "on-hold", "processing"].includes(sourceStatus);

  const run = async (action: QcAction | "enrol", fn: () => Promise<unknown>, success: string) => {
    setBusy(action);
    try {
      await fn();
      toast.success(success);
      setMode(null);
      await state.reload();
      onChanged?.();
    } catch (e) {
      toast.error("QC action failed", { description: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const allowed = qc ? QC_ALLOWED[qc.qc_state] : [];
  const can = (a: QcAction) => allowed.includes(a) && (["approve", "reject", "hold", "correct_and_revalidate"].includes(a) ? canDecide : canReview);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-sm font-medium">New / QC</CardTitle>
        {qc && tonePill({ label: QC_STATE_LABELS[qc.qc_state], tone: QC_STATE_TONES[qc.qc_state] })}
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        {state.error ? (
          <p className="text-muted-foreground">Could not load QC: {state.error}</p>
        ) : state.loading ? (
          <div className="space-y-1.5" role="status" aria-label="Loading QC">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : !qc ? (
          <>
            <p className="text-muted-foreground">
              {eligible
                ? "Not in QC. Open orders from the last 7 days enrol automatically; older ones can be enrolled by hand."
                : `Not in QC: only open orders (pending, on-hold, processing) are reviewed; this one is ${sourceStatus}.`}
            </p>
            {eligible && canReview && (
              <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void run("enrol", () => qcEnrol(orderReadId), "Enrolled in QC")}>
                {busy === "enrol" && <Loader2 className="size-3.5 animate-spin" aria-hidden />} Enrol in QC
              </Button>
            )}
          </>
        ) : (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">Owner</dt>
              <dd><OwnerName id={qc.owner_membership_id} /></dd>
              <dt className="text-muted-foreground">Due</dt>
              <dd className="tnum">{fmt(qc.due_at)}</dd>
              <dt className="text-muted-foreground">Last contact</dt>
              <dd className="tnum">{fmt(qc.last_contact_attempt_at)}</dd>
              <dt className="text-muted-foreground">Reasons</dt>
              <dd className="flex flex-wrap gap-1">
                {qc.reason_codes.length === 0 ? "—" : qc.reason_codes.map((c) => <Badge key={c} variant="outline" className="h-5 px-1.5 font-normal">{reasonLabel(c)}</Badge>)}
              </dd>
              <dt className="text-muted-foreground">Reservation</dt>
              <dd>{qc.reservation_state.replace("_", " ")}</dd>
              <dt className="text-muted-foreground">Release</dt>
              <dd>{qc.fulfilment_release_state.replace("_", " ")}</dd>
            </dl>

            {allowed.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {can("start_review") && (
                  <Button size="sm" variant="outline" className="h-7" disabled={busy !== null} onClick={() => void run("start_review", () => qcStartReview(qc.id, null, qc.version), "Review started")}>
                    {busy === "start_review" && <Loader2 className="size-3 animate-spin" aria-hidden />} Start review
                  </Button>
                )}
                {can("request_information") && <Button size="sm" variant="outline" className="h-7" disabled={busy !== null} onClick={() => setMode("request_information")}>Request info</Button>}
                {can("correct_and_revalidate") && <Button size="sm" variant="outline" className="h-7" disabled={busy !== null} onClick={() => setMode("correct_and_revalidate")}>Revalidate</Button>}
                {can("assign") && <Button size="sm" variant="outline" className="h-7" disabled={busy !== null} onClick={() => setMode("assign")}>Assign</Button>}
                {can("hold") && <Button size="sm" variant="outline" className="h-7" disabled={busy !== null} onClick={() => setMode("hold")}>Hold</Button>}
                {can("approve") && <Button size="sm" className="h-7" disabled={busy !== null} onClick={() => setMode("approve")}>Approve</Button>}
                {can("reject") && <Button size="sm" variant="destructive" className="h-7" disabled={busy !== null} onClick={() => setMode("reject")}>Reject</Button>}
              </div>
            )}
            {qc.qc_state === "approved" && qc.fulfilment_release_state !== "released" && canDecide && (
              <Button size="sm" variant="outline" className="h-7" disabled={busy !== null} onClick={() => void run("approve", () => qcReleaseToFulfilment(qc.id, null, qc.version), "Released to fulfilment (no stock movement, no courier call)")}>
                Release to fulfilment
              </Button>
            )}
            {allowed.length === 0 && <p className="text-muted-foreground">Terminal QC state; no further QC actions.{qc.qc_state === "approved" && qc.fulfilment_release_state === "released" && " Released to fulfilment."}</p>}
            {!canReview && allowed.length > 0 && <p className="text-muted-foreground">Your role can view QC but not act on it.</p>}

            <ul className="space-y-1 border-t pt-2 text-[11px] text-muted-foreground">
              {events.slice(0, 8).map((ev) => (
                <li key={ev.id} className="flex justify-between gap-2">
                  <span>
                    <span className="text-foreground">{QC_ACTION_LABELS[ev.action as QcAction] ?? ev.action}</span>
                    {ev.reason_codes.length > 0 && ` · ${ev.reason_codes.map(reasonLabel).join(", ")}`}
                    {ev.note && ` · ${ev.note}`}
                    {" · "}{ev.actor_label}
                  </span>
                  <span className="tnum shrink-0">{fmt(ev.created_at)}</span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground">
              Approval clears QC only — it never books a courier, reserves stock or changes the store status. Version {qc.version}.
            </p>

            <QcActionDialog
              mode={mode}
              qc={qc}
              busy={busy !== null}
              defaultReasons={(readinessIssues ?? []).map((i) => READINESS_TO_REASON[i]).filter(Boolean)}
              hasCorrection={hasCorrection ?? false}
              onClose={() => setMode(null)}
              onSubmit={(payload) => {
                if (mode === "request_information")
                  void run("request_information", () => qcRequestInformation(qc.id, payload.reasons, payload.note, payload.channel, qc.version), "Information requested — logged as an internal task, nothing sent");
                else if (mode === "hold") void run("hold", () => qcHold(qc.id, payload.reasons, payload.note, qc.version), "Order on hold");
                else if (mode === "reject") void run("reject", () => qcReject(qc.id, payload.reasons, payload.note, qc.version), "Order rejected");
                else if (mode === "approve") void run("approve", () => qcApprove(qc.id, payload.note, qc.version), "Order approved (QC only)");
                else if (mode === "assign") void run("assign", () => qcAssign(qc.id, payload.owner, payload.dueAt, qc.version), "Assigned");
                else if (mode === "correct_and_revalidate") void run("correct_and_revalidate", () => qcCorrectAndRevalidate(qc.id, null, payload.note, qc.version), "Back in review");
              }}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function OwnerName({ id }: { id: number | null }) {
  const members = useLiveQuery(fetchWorkspaceMembers, []);
  if (id === null) return <span className="text-muted-foreground">unassigned</span>;
  const m = members.data?.find((x) => x.membership_id === id);
  return <span>{m?.display_name ?? `member ${id}`}</span>;
}

interface Payload {
  reasons: string[];
  note: string | null;
  channel: "whatsapp_manual" | "call";
  owner: number | null;
  dueAt: string | null;
}

const TITLES: Record<NonNullable<Mode>, { title: string; description: string; submit: string; reasons: boolean }> = {
  request_information: { title: "Request information", description: "Logs an internal task for a person to contact the customer. Nothing is sent by Fullkit.", submit: "Log request", reasons: true },
  hold: { title: "Put on hold", description: "Freezes QC and, when a fulfilment pipeline row exists, holds it before courier submission.", submit: "Hold", reasons: true },
  reject: { title: "Reject order", description: "Ends QC. The store status is not changed; the fulfilment pipeline is held so nothing ships.", submit: "Reject", reasons: true },
  approve: { title: "Approve", description: "Clears QC only. Reservation, courier, AWB and handover stay separate steps.", submit: "Approve", reasons: false },
  assign: { title: "Assign", description: "Owner and due time for this review.", submit: "Assign", reasons: false },
  correct_and_revalidate: { title: "Corrected — revalidate", description: "Records that the details were corrected (use the fix dialog for the shipping fields) and puts the order back in review.", submit: "Back to review", reasons: false },
};

function QcActionDialog({
  mode,
  qc,
  busy,
  defaultReasons,
  hasCorrection,
  onClose,
  onSubmit,
}: {
  mode: Mode;
  qc: OrderQc;
  busy: boolean;
  defaultReasons: string[];
  hasCorrection: boolean;
  onClose: () => void;
  onSubmit: (p: Payload) => void;
}) {
  const [reasons, setReasons] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [channel, setChannel] = useState<"whatsapp_manual" | "call">("whatsapp_manual");
  const [owner, setOwner] = useState<string>(qc.owner_membership_id ? String(qc.owner_membership_id) : "none");
  const [due, setDue] = useState("");
  const [seeded, setSeeded] = useState<Mode>(null);
  const members = useLiveQuery(fetchWorkspaceMembers, []);

  if (!mode) return null;
  const meta = TITLES[mode];
  // Seed reasons once per opened mode from the current record + readiness issues.
  if (seeded !== mode) {
    setSeeded(mode);
    setReasons(Array.from(new Set([...qc.reason_codes, ...defaultReasons])));
    setNote("");
  }
  const needsReasons = meta.reasons && reasons.length === 0;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{meta.title}</DialogTitle>
          <DialogDescription>{meta.description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          {meta.reasons && (
            <fieldset className="grid grid-cols-2 gap-1.5">
              <legend className="mb-1 text-xs text-muted-foreground">Reason codes</legend>
              {QC_REASON_CODES.map((r) => (
                <label key={r.code} className="flex items-center gap-2 text-xs">
                  <Checkbox checked={reasons.includes(r.code)} onCheckedChange={(c) => setReasons((rs) => (c ? [...rs, r.code] : rs.filter((x) => x !== r.code)))} />
                  {r.label}
                </label>
              ))}
            </fieldset>
          )}
          {mode === "request_information" && (
            <div className="grid gap-1.5">
              <Label htmlFor="qc-channel">Channel (a person does this)</Label>
              <Select value={channel} onValueChange={(v) => setChannel(v as "whatsapp_manual" | "call")}>
                <SelectTrigger id="qc-channel"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="whatsapp_manual">WhatsApp (manual)</SelectItem>
                  <SelectItem value="call">Call</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
          {mode === "assign" && (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="qc-owner">Owner</Label>
                <Select value={owner} onValueChange={setOwner}>
                  <SelectTrigger id="qc-owner"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Unassigned</SelectItem>
                    {(members.data ?? []).map((m: WorkspaceMember) => (
                      <SelectItem key={m.membership_id} value={String(m.membership_id)}>{m.display_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="qc-due">Due</Label>
                <Input id="qc-due" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
              </div>
            </div>
          )}
          {mode === "correct_and_revalidate" && !hasCorrection && (
            <p className="text-xs text-warning">No staged correction on this order yet — use the fix dialog first if the shipping details were wrong.</p>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="qc-note">Note (audit log)</Label>
            <Textarea id="qc-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why — no customer message text here." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant={mode === "reject" ? "destructive" : "default"}
            disabled={busy || needsReasons}
            onClick={() =>
              onSubmit({
                reasons,
                note: note.trim() || null,
                channel,
                owner: owner === "none" ? null : Number(owner),
                dueAt: due ? new Date(due).toISOString() : null,
              })
            }
          >
            {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden />} {meta.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function isOverdue(iso: string | null): boolean {
  return iso ? new Date(iso).getTime() < Date.now() : false;
}

/** Compact cell for the Orders list. */
export function QcCell({ qc }: { qc: OrderQc | Pick<OrderQc, "qc_state" | "reason_codes" | "owner_membership_id" | "due_at"> | null | undefined }) {
  if (!qc) return <span className="text-[11px] text-muted-foreground">—</span>;
  const overdue = isOverdue(qc.due_at);
  return (
    <span className="flex flex-col items-start gap-0.5">
      {tonePill({ label: QC_STATE_LABELS[qc.qc_state], tone: QC_STATE_TONES[qc.qc_state] })}
      {(qc.reason_codes.length > 0 || overdue) && (
        <span className="text-[11px] text-muted-foreground">
          {qc.reason_codes.length > 0 && `${qc.reason_codes.length} reason${qc.reason_codes.length > 1 ? "s" : ""}`}
          {overdue && <span className="text-destructive"> · overdue</span>}
        </span>
      )}
    </span>
  );
}

export type { OrderQcEvent };
