"use client";

import type { StateDimension } from "@/lib/domain/enums";
import {
  DIMENSION_LABELS,
  statusMeta,
  TONE_CLASSES,
  TONE_DOT_CLASSES,
  type StatusMeta,
} from "@/lib/domain/status-maps";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface StatusPillProps {
  dimension: StateDimension;
  value: string;
  /** compact renders a dot + label without the dimension prefix */
  size?: "sm" | "md";
  showDimension?: boolean;
  className?: string;
}

export function StatusPill({ dimension, value, size = "sm", showDimension = false, className }: StatusPillProps) {
  const meta = statusMeta(dimension, value);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border font-medium tnum",
            size === "sm" ? "h-5 px-2 text-[11px]" : "h-6 px-2.5 text-xs",
            TONE_CLASSES[meta.tone],
            className,
          )}
        >
          <span className={cn("size-1.5 shrink-0 rounded-full", TONE_DOT_CLASSES[meta.tone])} aria-hidden />
          {showDimension ? `${DIMENSION_LABELS[dimension]}: ${meta.label}` : meta.label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        {DIMENSION_LABELS[dimension]} state — {meta.label.toLowerCase()}
      </TooltipContent>
    </Tooltip>
  );
}

export function tonePill(meta: StatusMeta, label?: string) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1.5 rounded-full border px-2 text-[11px] font-medium",
        TONE_CLASSES[meta.tone],
      )}
    >
      <span className={cn("size-1.5 rounded-full", TONE_DOT_CLASSES[meta.tone])} aria-hidden />
      {label ?? meta.label}
    </span>
  );
}
