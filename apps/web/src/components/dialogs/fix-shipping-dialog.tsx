"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  acceptAiSuggestion,
  rejectAiSuggestion,
  saveOrderCorrection,
  type AiSuggestion,
} from "@/lib/supabase/live";

/**
 * Fix-in-OS: operators correct shipping details here instead of wp-admin.
 * The correction is recorded in Fullkit and audited — it does NOT write to
 * WooCommerce or Ninja Van. Propagation to the courier label arrives with
 * the first Slice 3 write (write-back-to-Woo), and applies to every
 * correction already staged.
 *
 * AI proposals (address-suggest, suggest-only by policy — ADR-0006) render
 * as per-field "Use AI" buttons that only fill the draft; the admin always
 * clicks Record. Saving with an AI value in the draft closes the suggestion
 * as accepted through one atomic RPC.
 */

export interface ShippingFields {
  name: string;
  phone: string;
  address_1: string;
  postcode: string;
  city: string;
  state: string;
}

const FIELDS: { key: keyof ShippingFields; label: string; placeholder?: string }[] = [
  { key: "name", label: "Recipient name" },
  { key: "phone", label: "Phone", placeholder: "+60…" },
  { key: "address_1", label: "Address" },
  { key: "postcode", label: "Postcode" },
  { key: "city", label: "City" },
  { key: "state", label: "State", placeholder: "SGR / Selangor" },
];

export function FixShippingDialog({
  open,
  onOpenChange,
  orderId,
  orderLabel,
  current,
  suggestions,
  issues,
  aiSuggestion,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: number;
  orderLabel: string;
  current: ShippingFields;
  suggestions?: Record<string, string>;
  issues?: string[];
  aiSuggestion?: AiSuggestion | null;
  onSaved?: () => void;
}) {
  const [draft, setDraft] = useState<ShippingFields>(current);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [aiDismissed, setAiDismissed] = useState(false);

  // Re-seed when a different order opens the dialog.
  const [seededFor, setSeededFor] = useState(orderId);
  if (seededFor !== orderId) {
    setSeededFor(orderId);
    setDraft(current);
    setNote("");
    setAiDismissed(false);
  }

  const ai = !aiDismissed && aiSuggestion && aiSuggestion.payload.fields ? aiSuggestion : null;
  const aiFields = ai?.payload.fields ?? {};
  const changed = FIELDS.filter((f) => (draft[f.key] ?? "").trim() !== (current[f.key] ?? "").trim());

  const save = async () => {
    if (changed.length === 0) {
      toast.info("No changes to record");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, string> = {};
      for (const f of changed) payload[f.key] = draft[f.key].trim();
      // The suggestion is "accepted" only if the saved draft actually uses
      // at least one AI value; a hand-typed fix leaves it to supersession.
      const usedAi = ai && Object.entries(aiFields).some(([k, v]) => payload[k] === v?.trim());
      if (usedAi && ai) {
        await acceptAiSuggestion(ai.id, payload, note || undefined);
      } else {
        await saveOrderCorrection(orderId, payload, note || undefined);
      }
      toast.success(`${orderLabel} corrected`, {
        description: "Recorded in Fullkit and audited · staged until write propagation is enabled.",
      });
      onOpenChange(false);
      onSaved?.();
    } catch (e) {
      toast.error("Could not save the correction", { description: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const dismissAi = async () => {
    if (!ai) return;
    setAiDismissed(true);
    try {
      await rejectAiSuggestion(ai.id);
      toast.info("AI suggestion dismissed");
      onSaved?.();
    } catch (e) {
      toast.error("Could not dismiss the suggestion", { description: (e as Error).message });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Fix shipping details — {orderLabel}</DialogTitle>
          <DialogDescription>
            Correct the details here rather than in the store admin. The fix is recorded and audited in
            Fullkit; it reaches the courier label once write propagation is enabled.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {issues && issues.length > 0 && (
            <p className="rounded-md border border-warning/25 bg-warning/10 px-2.5 py-2 text-xs text-warning">
              Flagged: {issues.join(" · ")}
            </p>
          )}
          {ai && (
            <div className="rounded-md border border-info/25 bg-info/10 px-2.5 py-2 text-xs">
              <div className="flex items-center gap-1.5 font-medium text-info">
                <Sparkles className="size-3.5" aria-hidden />
                AI suggested fix · confidence {Math.round((ai.payload.confidence ?? 0) * 100)}% — always verify before recording
              </div>
              {ai.payload.rationale && <p className="mt-1 text-muted-foreground">{ai.payload.rationale}</p>}
              <div className="mt-1.5 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="text-[11px] font-medium text-info underline-offset-2 hover:underline"
                  onClick={() =>
                    setDraft((d) => {
                      const next = { ...d };
                      for (const [k, v] of Object.entries(aiFields)) {
                        if (v) next[k as keyof ShippingFields] = v;
                      }
                      return next;
                    })
                  }
                >
                  Apply all AI fields
                </button>
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
                  onClick={dismissAi}
                >
                  Dismiss suggestion
                </button>
              </div>
            </div>
          )}
          {FIELDS.map((f) => {
            const suggestion =
              f.key === "phone" ? suggestions?.phone_normalized : f.key === "postcode" ? suggestions?.postcode : undefined;
            const aiValue = ai ? aiFields[f.key] : undefined;
            return (
              <div key={f.key} className="space-y-1">
                <Label htmlFor={`fix-${f.key}`} className="text-xs">{f.label}</Label>
                <Input
                  id={`fix-${f.key}`}
                  value={draft[f.key] ?? ""}
                  placeholder={f.placeholder}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  className="h-8 text-sm"
                />
                {suggestion && suggestion !== draft[f.key] && (
                  <button
                    type="button"
                    className="text-[11px] text-info underline-offset-2 hover:underline"
                    onClick={() => setDraft((d) => ({ ...d, [f.key]: suggestion }))}
                  >
                    Use suggested: {suggestion}
                  </button>
                )}
                {aiValue && aiValue !== draft[f.key] && (
                  <button
                    type="button"
                    className="flex items-center gap-1 text-[11px] text-info underline-offset-2 hover:underline"
                    onClick={() => setDraft((d) => ({ ...d, [f.key]: aiValue }))}
                  >
                    <Sparkles className="size-3" aria-hidden />
                    Use AI: {aiValue}
                  </button>
                )}
              </div>
            );
          })}
          <div className="space-y-1">
            <Label htmlFor="fix-note" className="text-xs">Note (optional)</Label>
            <Textarea
              id="fix-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. confirmed new address with buyer on WhatsApp"
              className="min-h-16 text-sm"
            />
          </div>
        </div>

        <DialogFooter className="sm:justify-between">
          <span className="text-[11px] text-muted-foreground">
            {changed.length === 0 ? "No changes yet" : `${changed.length} field${changed.length === 1 ? "" : "s"} changed`}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving || changed.length === 0}>
              {saving ? "Saving…" : "Record correction"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
