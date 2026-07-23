"use client";

import { useState } from "react";
import { CircleDot } from "lucide-react";
import type { OperatingMode } from "@/lib/domain/enums";
import { useAppStore } from "@/lib/store/provider";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const MODE_META: Record<OperatingMode, { label: string; className: string; blurb: string }> = {
  demo: {
    label: "Demo",
    className: "bg-ai/12 text-ai border-ai/30",
    blurb: "Synthetic data only. Actions change prototype state and are audited, but never reach any external system.",
  },
  shadow: {
    label: "Shadow",
    className: "bg-info/12 text-info border-info/30",
    blurb: "Reads mirror live sources; writes are recorded but not sent. Used to verify behaviour before going live.",
  },
  live: {
    label: "Live",
    className: "bg-warning/12 text-warning border-warning/30",
    blurb: "Writes reach external systems. Requires HQ approval per brand and is fully audited.",
  },
};

export function ModePill() {
  const mode = useAppStore((s) => s.session.mode);
  const setMode = useAppStore((s) => s.setMode);
  const [confirming, setConfirming] = useState<OperatingMode | null>(null);
  const meta = MODE_META[mode];

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring",
            meta.className,
          )}
          aria-label={`Operating mode: ${meta.label}`}
        >
          <CircleDot className="size-3" aria-hidden />
          {meta.label}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuLabel>Operating mode</DropdownMenuLabel>
          <p className="px-2 pb-2 text-xs text-muted-foreground">{meta.blurb}</p>
          <DropdownMenuSeparator />
          {(Object.keys(MODE_META) as OperatingMode[]).map((m) => (
            <DropdownMenuItem
              key={m}
              onSelect={() => {
                if (m === mode) return;
                if (m === "demo") setMode(m);
                else setConfirming(m);
              }}
            >
              <span className="flex-1">{MODE_META[m].label}</span>
              {m === mode && <span className="text-xs text-muted-foreground">current</span>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirming !== null} onOpenChange={(o) => !o && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Switch to {confirming ? MODE_META[confirming].label : ""} mode?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>{confirming ? MODE_META[confirming].blurb : ""}</p>
                <p className="text-muted-foreground">
                  In this prototype, no external connection exists in any mode — the pill changes so
                  you can see how Fullkit communicates scope. The switch is audited.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay in {meta.label}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirming) setMode(confirming);
                setConfirming(null);
              }}
            >
              Switch mode
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
