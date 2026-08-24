"use client";

import Link from "next/link";
import { ClipboardCheck, PackageCheck, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { LiveNvShipment } from "@/lib/supabase/live";
import { orderSearchHref, relative, skuSummary } from "../_lib/format";
import { useFulfilmentFloor } from "../_lib/fulfilment-floor";

interface QueueRow {
  key: string;
  primary: string;
  href: string | null;
  secondary: string;
  meta: string;
}

interface Queue {
  id?: string;
  title: string;
  icon: typeof ClipboardCheck;
  hint: string;
  count: number;
  rows: QueueRow[];
  note?: string;
  /** Where the rest of the queue lives when only the first rows are shown. */
  more?: { href: string; label: string };
}

function parcelRow(s: LiveNvShipment): QueueRow {
  return {
    key: String(s.id),
    primary: s.tracking_id,
    href: null,
    secondary: s.order_ref ?? "—",
    meta: relative(s.last_event_at),
  };
}

/** Pick → pack → handover → in transit, live-fed. */
export function QueuesGrid() {
  const { toPick, pendingPickup, inTransit, brandName } = useFulfilmentFloor();

  const queues: Queue[] = [
    {
      title: "To pick",
      icon: ClipboardCheck,
      hint: "Approved orders waiting for a picker",
      count: toPick.total,
      rows: toPick.rows.map((o) => ({
        key: String(o.id),
        primary: `#${o.order_number ?? o.source_order_id}`,
        href: orderSearchHref(o),
        secondary: `${brandName(o.brand_id)} · ${skuSummary(o)}`,
        meta: relative(o.placed_at),
      })),
      more: { href: "/orders?view=to-fulfil", label: "Orders · To fulfil" },
    },
    {
      title: "Picking",
      icon: PackageCheck,
      hint: "Packing creates the AWB label",
      count: 0,
      rows: [],
      note: "Fighter runs pick/pack today — this stage reports live when Fullkit operates the floor (Slice 3).",
    },
    {
      title: "Packed — ready for handover",
      icon: Truck,
      hint: "Hand over via the courier manifest",
      count: pendingPickup.length,
      rows: pendingPickup.slice(0, 8).map(parcelRow),
    },
    {
      id: "in-transit",
      title: "In transit",
      icon: Truck,
      hint: "Ninja Van parcels moving — courier-wide, not brand-scoped",
      count: inTransit.length,
      rows: inTransit.slice(0, 8).map(parcelRow),
      note: "No parcels in transit in the current network snapshot.",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {queues.map((q) => (
        <Card key={q.title} id={q.id} className={q.id ? "scroll-mt-5" : undefined}>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="flex items-center gap-2 text-sm font-medium">
              <q.icon className="size-4 text-muted-foreground" aria-hidden />
              {q.title}
            </CardTitle>
            <Badge variant="outline" className="tnum text-xs">{q.count}</Badge>
          </CardHeader>
          <CardContent className="space-y-0 divide-y">
            <p className="pb-2 text-[11px] text-muted-foreground">{q.hint}</p>
            {q.rows.map((r) => (
              <div key={r.key} className="flex items-center gap-2.5 py-2 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    {r.href ? (
                      <Link href={r.href} className="text-sm font-medium text-info underline-offset-2 hover:underline">
                        {r.primary}
                      </Link>
                    ) : (
                      <span className="tnum text-sm font-medium">{r.primary}</span>
                    )}
                    <span className="truncate text-[11px] text-muted-foreground">{r.secondary}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    <span className="tnum">{r.meta}</span>
                  </div>
                </div>
              </div>
            ))}
            {q.rows.length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">{q.note ?? "Queue clear."}</p>
            )}
            {q.count > q.rows.length && q.rows.length > 0 && (
              <p className="pt-2 text-[11px] text-muted-foreground">
                +{q.count - q.rows.length} more
                {q.more && (
                  <>
                    {" "}— see{" "}
                    <Link href={q.more.href} className="text-info underline-offset-2 hover:underline">{q.more.label}</Link>
                  </>
                )}
                .
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
