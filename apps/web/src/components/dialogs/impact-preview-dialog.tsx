"use client";

import { useState } from "react";
import { ArrowUpRight, RotateCcw, ShieldCheck } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface ImpactLine {
  label: string;
  value: string;
  tone?: "neutral" | "success" | "warning" | "destructive";
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  impact: ImpactLine[];
  externalDestination: string;
  reversibility: string;
  auditNote: string;
  confirmLabel: string;
  requireNote?: boolean;
  notePlaceholder?: string;
  destructive?: boolean;
  onConfirm: (note: string) => void;
}

/**
 * The mandatory gate for material actions: what changes, where it goes,
 * whether it can be undone, and how it is audited — before anything happens.
 */
export function ImpactPreviewDialog({
  open,
  onOpenChange,
  title,
  description,
  impact,
  externalDestination,
  reversibility,
  auditNote,
  confirmLabel,
  requireNote = false,
  notePlaceholder,
  destructive = false,
  onConfirm,
}: Props) {
  const [note, setNote] = useState("");
  const noteMissing = requireNote && note.trim().length === 0;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setNote("");
        onOpenChange(o);
      }}
    >
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-3">
          <div className="rounded-lg border">
            <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
              Impact preview
            </div>
            <dl className="divide-y">
              {impact.map((line) => (
                <div key={line.label} className="flex items-center justify-between gap-3 px-3 py-2">
                  <dt className="text-sm text-muted-foreground">{line.label}</dt>
                  <dd
                    className={cn(
                      "tnum text-sm font-medium",
                      line.tone === "success" && "text-success",
                      line.tone === "warning" && "text-warning",
                      line.tone === "destructive" && "text-destructive",
                    )}
                  >
                    {line.value}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="grid grid-cols-1 gap-2 text-xs text-muted-foreground">
            <div className="flex items-start gap-2">
              <ArrowUpRight className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                <span className="font-medium text-foreground">External destination: </span>
                {externalDestination}
              </span>
            </div>
            <div className="flex items-start gap-2">
              <RotateCcw className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                <span className="font-medium text-foreground">Reversibility: </span>
                {reversibility}
              </span>
            </div>
            <div className="flex items-start gap-2">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                <span className="font-medium text-foreground">Audit: </span>
                {auditNote}
              </span>
            </div>
          </div>

          {requireNote && (
            <div className="space-y-1.5">
              <Label htmlFor="impact-note" className="text-xs">
                Rationale (recorded in the audit trail)
              </Label>
              <Textarea
                id="impact-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={notePlaceholder ?? "Why are you taking this action?"}
                rows={2}
              />
            </div>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            variant={destructive ? "destructive" : "default"}
            disabled={noteMissing}
            onClick={() => {
              onConfirm(note.trim());
              setNote("");
              onOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
