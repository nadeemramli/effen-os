import { cn } from "@/lib/utils";
import type { LiveOrderRow } from "@/lib/supabase/live";

// "return" is not an exception word: returned parcels have their own lane.
export const NV_EXCEPTION_WORDS = ["fail", "exception", "damaged", "lost", "on hold", "reschedule"];

/** "Automated Failed Delivery Management - Max Delivery Attempt" → "Max delivery attempt". */
export function shortReason(reason: string): string {
  const r = reason
    .replace(/^Automated Failed Delivery Management\s*-\s*/i, "")
    .replace(/^Force success reason:\s*/i, "")
    .replace(/_/g, " ")
    .trim();
  return r.length > 0 ? r.charAt(0).toUpperCase() + r.slice(1).toLowerCase() : "Unknown";
}

export function relative(iso: string | null): string {
  if (!iso) return "—";
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 60) return `${Math.max(min, 1)}m ago`;
  const hours = Math.round(min / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function cnStage(stage: string, count: number): string {
  return cn(
    "tnum mt-0.5 text-base font-semibold",
    stage === "exception" && count > 0 && "text-warning",
    stage === "held" && count > 0 && "text-info",
  );
}

export function skuSummary(o: LiveOrderRow): string {
  const first = o.items?.[0];
  if (!first) return "—";
  const more = (o.items?.length ?? 0) > 1 ? ` +${o.items.length - 1}` : "";
  return `${first.sku ?? first.name ?? "item"} ×${first.quantity}${more}`;
}

export function orderSearchHref(o: LiveOrderRow): string {
  return `/orders?q=${encodeURIComponent(o.order_number ?? o.source_order_id)}`;
}
