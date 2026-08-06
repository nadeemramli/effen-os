"use client";

import { cn } from "@/lib/utils";
import { formatRelative, freshnessOf } from "@/lib/utils/dates";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface Props {
  lastSuccessAt: string | null;
  slaMinutes: number;
  className?: string;
  /**
   * Measure against the real wall clock instead of the frozen demo clock.
   * Live (warehouse/pipeline) surfaces must set this — their timestamps are
   * real, and the demo clock renders them as nonsense like "in 14d".
   */
  realClock?: boolean;
}

function realRelative(iso: string): string {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hours = Math.round(min / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function realFreshness(lastSuccessAt: string | null, slaMinutes: number): keyof typeof TONE {
  if (!lastSuccessAt) return "stale";
  const ageMin = (Date.now() - new Date(lastSuccessAt).getTime()) / 60_000;
  if (ageMin <= slaMinutes) return "fresh";
  if (ageMin <= slaMinutes * 3) return "aging";
  return "stale";
}

const TONE = {
  fresh: "bg-success/12 text-success border-success/25",
  aging: "bg-warning/12 text-warning border-warning/25",
  stale: "bg-destructive/12 text-destructive border-destructive/25",
};

export function FreshnessBadge({ lastSuccessAt, slaMinutes, className, realClock = false }: Props) {
  const state = realClock ? realFreshness(lastSuccessAt, slaMinutes) : freshnessOf(lastSuccessAt, slaMinutes);
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
          {lastSuccessAt ? (realClock ? realRelative(lastSuccessAt) : formatRelative(lastSuccessAt)) : "never"}
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
