"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { LIFECYCLE_STATE_LABELS, lifecycleTone, type CustomerLifecycleStates } from "@/lib/domain/lifecycle";

/** Served lifecycle lookup for one page of rows; `null` while it loads. */
export type LifecycleLookup = CustomerLifecycleStates | { status: "error" } | null;

/**
 * Governed lifecycle state from live_customer_lifecycle_states — the browser
 * never derives active/at-risk/lapsed from dates. Skeleton while loading,
 * an honest dash when the contract cannot answer.
 */
export function LifecycleCell({ lookup, identityKey }: { lookup: LifecycleLookup; identityKey: string }) {
  if (lookup === null) return <Skeleton className="h-3.5 w-12" aria-label="Loading lifecycle" />;
  if (lookup.status !== "ok") {
    return (
      <span className="text-muted-foreground" title={lookup.status === "error" ? "Lifecycle lookup failed" : `Lifecycle ${lookup.reason === "no_policy" ? "policy not set" : "not computed yet"}`}>
        —
      </span>
    );
  }
  const s = lookup.states[identityKey];
  if (!s || s.state === null) {
    return <span className="text-muted-foreground" title="No qualifying purchase under the lifecycle policy">no purchase</span>;
  }
  return (
    <span className={lifecycleTone(s.state)} title={s.since ? `Since ${new Date(s.since).toLocaleDateString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })}` : undefined}>
      {LIFECYCLE_STATE_LABELS[s.state]}
    </span>
  );
}
