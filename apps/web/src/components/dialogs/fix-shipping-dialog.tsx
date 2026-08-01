"use client";

import { useState } from "react";
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
import { saveOrderCorrection } from "@/lib/supabase/live";

/**
 * Fix-in-OS: operators correct shipping details here instead of wp-admin.
 * The correction is recorded in Fullkit and audited — it does NOT write to
 * WooCommerce or Ninja Van. Propagation to the courier label arrives with
 * the first Slice 3 write (write-back-to-Woo), and applies to every
 * correction already staged.
 */

export interface ShippingFields {
  name: string;
  phone: string;
  address_1: string;
  postcode: string;
  city: string;
}

const FIELDS: { key: keyof ShippingFields; label: string; placeholder?: string }[] = [
  { key: "name", label: "Recipient name" },
  { key: "phone", label: "Phone", placeholder: "+60…" },
  { key: "address_1", label: "Address" },
  { key: "postcode", label: "Postcode" },
  { key: "city", label: "City" },
];

export function FixShippingDialog({
  open,
  onOpenChange,
  orderId,
  orderLabel,
  current,
  suggestions,
  issues,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderId: number;
  orderLabel: string;
  current: ShippingFields;
  suggestions?: Record<string, string>;
  issues?: string[];
  onSaved?: () => void;
}) {
  const [draft, setDraft] = useState<ShippingFields>(current);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  // Re-seed when a different order opens the dialog.
  const [seededFor, setSeededFor] = useState(orderId);
  if (seededFor !== orderId) {
    setSeededFor(orderId);
    setDraft(current);
    setNote("");
  }

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
      await saveOrderCorrection(orderId, payload, note || undefined);
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
          {FIELDS.map((f) => {
            const suggestion =
              f.key === "phone" ? suggestions?.phone_normalized : f.key === "postcode" ? suggestions?.postcode : undefined;
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
