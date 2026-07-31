"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, PackageCheck, RefreshCw, Truck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { LiveGuard } from "@/components/auth/live-guard";
import { EmptyState } from "@/components/states";
import { fetchNvNetwork, type LiveNvShipment } from "@/lib/supabase/live";
import { cn } from "@/lib/utils";

/* The live parcel network from the Ninja Van webhook mirror. Pick/pack/handover
 * queues return when Fullkit creates consignments itself (Slice 3) — today
 * Fighter creates them, so parcels carry Fighter references and per-order
 * linkage lands with the Fighter bridge or the NV order-details API. */

const EXCEPTION_WORDS = ["fail", "exception", "damaged", "lost", "on hold", "reschedule", "return"];

function bucket(status: string | null, terminal: boolean): "delivered" | "exception" | "transit" {
  const s = (status ?? "").toLowerCase();
  if (s.includes("delivered") || (terminal && s.includes("completed"))) return "delivered";
  if (EXCEPTION_WORDS.some((w) => s.includes(w))) return "exception";
  return "transit";
}

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-MY", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kuala_Lumpur" });
}

function FulfilmentInner() {
  const [data, setData] = useState<Awaited<ReturnType<typeof fetchNvNetwork>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    setLoading(true);
    fetchNvNetwork()
      .then(setData)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reload, []);

  if (loading && !data) {
    return (
      <PageBody className="flex min-h-96 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" aria-label="Loading parcels" />
      </PageBody>
    );
  }

  const shipments = data?.shipments ?? [];
  const byStatus = new Map<string, LiveNvShipment[]>();
  let delivered = 0, exceptions = 0, transit = 0;
  for (const s of shipments) {
    const key = s.status ?? "Unknown";
    byStatus.set(key, [...(byStatus.get(key) ?? []), s]);
    const b = bucket(s.status, s.is_terminal);
    if (b === "delivered") delivered += 1;
    else if (b === "exception") exceptions += 1;
    else transit += 1;
  }

  return (
    <PageBody className="max-w-6xl">
      <PageHeader
        title="Fulfilment"
        description="Live parcel network from the Ninja Van webhook mirror — every brand, every market, from webhook connection onward."
      >
        <Button variant="outline" size="sm" className="gap-1.5" onClick={reload} disabled={loading}>
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} aria-hidden /> Refresh
        </Button>
      </PageHeader>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Could not load the parcel mirror: {error}
        </div>
      ) : shipments.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="No parcels captured yet"
          description="Capture starts from webhook registration — parcels appear here as Ninja Van reports movement. There is no history backfill."
        />
      ) : (
        <>
          {/* network summary */}
          <section aria-label="Parcel summary" className="grid grid-cols-3 gap-3">
            {[
              { icon: Truck, label: "In network", value: transit, tone: "text-info" },
              { icon: PackageCheck, label: "Delivered", value: delivered, tone: "text-success" },
              { icon: AlertTriangle, label: "Exceptions", value: exceptions, tone: exceptions > 0 ? "text-warning" : "text-muted-foreground" },
            ].map((c) => (
              <div key={c.label} className="rounded-lg border bg-card p-3">
                <div className="flex items-center justify-between">
                  <c.icon className={cn("size-4", c.tone)} aria-hidden />
                  <span className="tnum text-xl font-semibold">{c.value}</span>
                </div>
                <div className="mt-1 text-sm font-medium">{c.label}</div>
              </div>
            ))}
          </section>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            {/* by status */}
            <Card className="xl:col-span-2">
              <CardHeader><CardTitle className="text-sm font-medium">Parcels by status</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {[...byStatus.entries()]
                  .sort(([, a], [, b]) => b.length - a.length)
                  .map(([status, rows]) => (
                    <div key={status}>
                      <div className="mb-1 flex items-baseline justify-between">
                        <span className="text-sm font-medium">{status}</span>
                        <Badge variant="outline" className="tnum text-xs">{rows.length}</Badge>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                        {rows.slice(0, 8).map((s) => (
                          <span key={s.id} className="tnum text-xs text-muted-foreground">
                            {s.tracking_id}
                          </span>
                        ))}
                        {rows.length > 8 && (
                          <span className="text-xs text-muted-foreground">+{rows.length - 8} more</span>
                        )}
                      </div>
                    </div>
                  ))}
              </CardContent>
            </Card>

            {/* recent events */}
            <Card>
              <CardHeader><CardTitle className="text-sm font-medium">Latest movements</CardTitle></CardHeader>
              <CardContent className="space-y-0 divide-y">
                {(data?.recentEvents ?? []).slice(0, 12).map((ev) => (
                  <div key={ev.id} className="py-1.5 first:pt-0 last:pb-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-xs font-medium">{ev.status ?? "—"}</span>
                      <span className="tnum shrink-0 text-[11px] text-muted-foreground">{fmt(ev.event_at)}</span>
                    </div>
                    <span className="tnum text-[11px] text-muted-foreground">{ev.tracking_id}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Parcels reference Fighter&apos;s consignment ids, so per-order and per-customer linkage arrives with the
            Fighter bridge or Ninja Van&apos;s order-details API — every captured parcel back-links the moment a mapping
            exists. Pick / pack / handover queues return when Fullkit creates consignments itself (Slice 3 write pilot).
          </p>
        </>
      )}
    </PageBody>
  );
}

export default function FulfilmentPage() {
  return (
    <LiveGuard>
      <FulfilmentInner />
    </LiveGuard>
  );
}
