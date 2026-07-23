"use client";

import { cn } from "@/lib/utils";
import { formatRelative, freshnessOf } from "@/lib/utils/dates";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  lastSuccessAt: string | null;
  slaMinutes: number;
  className?: string;
}

const TONE = {
  fresh: "bg-success/12 text-success border-success/25",
  aging: "bg-warning/12 text-warning border-warning/25",
  stale: "bg-destructive/12 text-destructive border-destructive/25",
};

export function FreshnessBadge({ lastSuccessAt, slaMinutes, className }: Props) {
  const state = freshnessOf(lastSuccessAt, slaMinutes);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex h-5 items-center gap-1 rounded-full border px-2 text-[11px] font-medium tnum",
            TONE[state],
            className,
          )}
        >
          {lastSuccessAt ? formatRelative(lastSuccessAt) : "never"}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {state === "fresh"
          ? `Within the ${slaMinutes >= 60 ? `${Math.round(slaMinutes / 60)}h` : `${slaMinutes}m`} freshness SLA`
          : state === "aging"
            ? "Older than the freshness SLA — monitor"
            : "Well past the freshness SLA — data from this source is stale"}
      </TooltipContent>
    </Tooltip>
  );
}
