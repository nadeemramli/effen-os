"use client";

import { Info } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { useAppStore } from "@/lib/store/provider";
import { cn } from "@/lib/utils";
import { formatRelative } from "@/lib/utils/dates";

interface MetricCardProps {
  metricKey: string;
  label?: string;
  value: string;
  /** e.g. "+4.2% vs plan" */
  delta?: { text: string; tone: "success" | "destructive" | "neutral" } | null;
  hint?: string;
  className?: string;
}

const QUALITY_TONE: Record<string, string> = {
  trusted: "text-success border-success/30 bg-success/10",
  monitored: "text-info border-info/30 bg-info/10",
  degraded: "text-warning border-warning/30 bg-warning/10",
};

/**
 * Every analytical number carries its definition, sources, freshness, and
 * quality state behind the info affordance — no bare metrics.
 */
export function MetricCard({ metricKey, label, value, delta, hint, className }: MetricCardProps) {
  const def = useAppStore((s) => s.metricDefinitions.find((m) => m.key === metricKey));
  const integrations = useAppStore((s) => s.integrations);

  return (
    <Card className={cn("gap-1.5 px-4 py-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-muted-foreground">
          {label ?? def?.name ?? metricKey}
        </span>
        <Popover>
          <PopoverTrigger
            className="rounded text-muted-foreground/70 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Definition of ${label ?? def?.name ?? metricKey}`}
          >
            <Info className="size-3.5" aria-hidden />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 text-sm">
            {def ? (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{def.name}</span>
                  <Badge variant="outline" className={cn("text-[10px]", QUALITY_TONE[def.quality])}>
                    {def.quality}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{def.formula}</p>
                <div className="text-xs">
                  <span className="text-muted-foreground">Grain: </span>
                  {def.grain}
                </div>
                <div className="text-xs">
                  <span className="text-muted-foreground">Sources: </span>
                  {def.sourceIntegrationIds
                    .map((id) => integrations.find((i) => i.id === id)?.name ?? id)
                    .join(", ")}
                </div>
                <div className="text-xs">
                  <span className="text-muted-foreground">Freshest read: </span>
                  {(() => {
                    const times = def.sourceIntegrationIds
                      .map((id) => integrations.find((i) => i.id === id)?.lastSuccessAt)
                      .filter(Boolean) as string[];
                    const latest = times.sort().at(-1);
                    return latest ? formatRelative(latest) : "n/a";
                  })()}
                </div>
                {def.caveat && (
                  <p className="rounded-md border border-warning/25 bg-warning/10 px-2 py-1.5 text-xs text-warning">
                    {def.caveat}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No governed definition registered.</p>
            )}
          </PopoverContent>
        </Popover>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="tnum text-2xl font-semibold tracking-tight">{value}</span>
        {delta && (
          <span
            className={cn(
              "tnum whitespace-nowrap text-xs font-medium",
              delta.tone === "success" && "text-success",
              delta.tone === "destructive" && "text-destructive",
              delta.tone === "neutral" && "text-muted-foreground",
            )}
          >
            {delta.text}
          </span>
        )}
      </div>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </Card>
  );
}
