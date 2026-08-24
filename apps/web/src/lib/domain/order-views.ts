/**
 * Saved views over the live order mirror. Shared by the Orders page (pill
 * row + query) and the Orders section nav (queue items + count badges) so the
 * two can never drift apart.
 *
 * Every view is an honest slice of `orders_read.source_status` (Woo's own
 * status vocabulary) or a placed_at window. Shipment-level queues (in transit,
 * returned) are NOT here — those are Ninja Van facts and live in Fulfilment.
 */

/**
 * Shape returned by `public.live_order_queue_counts` (see live.ts). Only the
 * open statuses are counted — archive queues (completed, cancelled, refunded,
 * all) would need a full scan of the mirror and carry no badge.
 */
export interface OrderQueueCounts {
  by_status: Record<string, number>;
  new_24h: number;
  /** Courier-wide parcel counts — not brand-scoped (parcels are Fighter-booked). */
  courier: { in_transit: number; returned_14d: number };
  computed_at: string;
}

export interface OrderView {
  key: string;
  label: string;
  /** `source_status in (...)`; null = every status. */
  statusIn: string[] | null;
  /** `placed_at >= now() - N hours`; null = any age. */
  sinceHours: number | null;
  /** Picks this view's count out of the grouped RPC result; absent = no badge (archive queue). */
  count?: (c: OrderQueueCounts) => number;
}

function sum(c: OrderQueueCounts, keys: string[]): number {
  return keys.reduce((n, k) => n + (c.by_status[k] ?? 0), 0);
}

export const ORDER_VIEWS: OrderView[] = [
  { key: "all", label: "All", statusIn: null, sinceHours: null },
  { key: "draft", label: "Draft", statusIn: ["checkout-draft"], sinceHours: null, count: (c) => sum(c, ["checkout-draft"]) },
  { key: "new", label: "New (24h)", statusIn: null, sinceHours: 24, count: (c) => c.new_24h },
  { key: "needs-payment", label: "Needs payment", statusIn: ["pending", "on-hold", "failed"], sinceHours: null, count: (c) => sum(c, ["pending", "on-hold", "failed"]) },
  { key: "to-fulfil", label: "To fulfil", statusIn: ["processing"], sinceHours: null, count: (c) => sum(c, ["processing"]) },
  { key: "completed", label: "Completed", statusIn: ["completed"], sinceHours: null },
  { key: "cancelled-refunded", label: "Cancelled / refunded", statusIn: ["cancelled", "refunded"], sinceHours: null },
];

export function orderView(key: string): OrderView {
  return ORDER_VIEWS.find((v) => v.key === key) ?? ORDER_VIEWS[0]!;
}
