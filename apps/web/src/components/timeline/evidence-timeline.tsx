"use client";

import type { LucideIcon } from "lucide-react";
import { Bot, Cable, MessageSquare, Truck, User, Zap } from "lucide-react";
import type { ActorType } from "@/lib/domain/enums";
import type { OrderStateEvent } from "@/lib/domain/types";
import { cn } from "@/lib/utils";
import { formatDateTime } from "@/lib/utils/dates";

const ACTOR_META: Record<ActorType, { icon: LucideIcon; label: string; className: string }> = {
  user: { icon: User, label: "User", className: "text-info bg-info/12 border-info/25" },
  system: { icon: Bot, label: "System", className: "text-muted-foreground bg-muted border-transparent" },
  connector: { icon: Cable, label: "Connector", className: "text-ai bg-ai/12 border-ai/25" },
  rule: { icon: Zap, label: "Rule", className: "text-warning bg-warning/12 border-warning/25" },
  courier: { icon: Truck, label: "Courier", className: "text-success bg-success/12 border-success/25" },
};

/**
 * One object, one timeline: every user, system, connector, rule, and courier
 * event about an order in strict chronological order.
 */
export function EvidenceTimeline({ events }: { events: OrderStateEvent[] }) {
  const sorted = [...events].sort((a, b) => (a.at < b.at ? -1 : 1));
  if (sorted.length === 0) {
    return <p className="text-sm text-muted-foreground">No events recorded yet.</p>;
  }
  return (
    <ol className="relative space-y-0">
      {sorted.map((e, idx) => {
        const meta = e.dimension === "note"
          ? { icon: MessageSquare, label: "Note", className: "text-info bg-info/12 border-info/25" }
          : ACTOR_META[e.actorType];
        const Icon = meta.icon;
        return (
          <li key={e.id} className="relative flex gap-3 pb-4 last:pb-0">
            {idx < sorted.length - 1 && (
              <span className="absolute left-[13px] top-7 h-[calc(100%-16px)] w-px bg-border" aria-hidden />
            )}
            <span
              className={cn(
                "z-10 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border",
                meta.className,
              )}
              aria-hidden
            >
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="text-sm font-medium">{e.actorName}</span>
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {meta.label}
                </span>
                <span className="tnum ml-auto shrink-0 text-[11px] text-muted-foreground">
                  {formatDateTime(e.at)}
                </span>
              </div>
              <p className="mt-0.5 text-sm text-muted-foreground">{e.message}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {e.toState && (
                  <span className="rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {e.dimension} → {e.toState}
                  </span>
                )}
                {e.reasonCode && (
                  <span className="rounded border border-warning/25 bg-warning/10 px-1.5 py-0.5 font-mono text-[10px] text-warning">
                    {e.reasonCode}
                  </span>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
