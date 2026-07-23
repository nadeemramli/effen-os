"use client";

import type { Order } from "@/lib/domain/types";
import { DIMENSION_LABELS } from "@/lib/domain/status-maps";
import { StatusPill } from "./status-pill";

/**
 * The six independent order states, always rendered in fixed order and
 * never merged into a single badge.
 */
export function SixStateStrip({ order, dense = false }: { order: Order; dense?: boolean }) {
  const entries = [
    ["order", order.orderStatus],
    ["payment", order.paymentStatus],
    ["fulfillment", order.fulfillmentStatus],
    ["shipment", order.shipmentStatus],
    ["notification", order.notificationStatus],
    ["return", order.returnStatus],
  ] as const;

  if (dense) {
    return (
      <div className="flex flex-wrap items-center gap-1">
        {entries.map(([dim, value]) => (
          <StatusPill key={dim} dimension={dim} value={value} />
        ))}
      </div>
    );
  }

  return (
    <dl className="grid grid-cols-3 gap-x-6 gap-y-3 lg:grid-cols-6">
      {entries.map(([dim, value]) => (
        <div key={dim}>
          <dt className="mb-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {DIMENSION_LABELS[dim]}
          </dt>
          <dd>
            <StatusPill dimension={dim} value={value} size="md" />
          </dd>
        </div>
      ))}
    </dl>
  );
}
