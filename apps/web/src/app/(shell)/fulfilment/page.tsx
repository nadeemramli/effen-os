"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ClipboardCheck, PackageCheck, ShieldAlert, Truck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ImpactPreviewDialog } from "@/components/dialogs/impact-preview-dialog";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { StatusPill } from "@/components/status/status-pill";
import { EmptyState } from "@/components/states";
import { useActivePersona, usePermission, useSession } from "@/hooks/use-session";
import type { Order } from "@/lib/domain/types";
import { RouteGuard } from "@/lib/rbac/guard";
import { useAppStore } from "@/lib/store/provider";
import { formatRelative } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

function skuSummary(o: Order): string {
  const first = o.items[0];
  if (!first) return "—";
  const more = o.items.length > 1 ? ` +${o.items.length - 1}` : "";
  return `${first.sku} ×${first.quantity}${more}`;
}

function FulfilmentInner() {
  const session = useSession();
  const persona = useActivePersona();
  const canAct = usePermission("orders.approve");
  const orders = useAppStore((s) => s.orders);
  const brands = useAppStore((s) => s.brands);
  const advanceFulfillment = useAppStore((s) => s.advanceFulfillment);
  const [manifestOpen, setManifestOpen] = useState<"ninja_van" | "jnt" | null>(null);

  const scoped = useMemo(
    () =>
      orders.filter(
        (o) =>
          (session.brandId === "all" || o.brandId === session.brandId) &&
          !o.isDraft &&
          o.orderStatus === "approved",
      ),
    [orders, session.brandId],
  );

  const toPick = scoped.filter((o) => o.fulfillmentStatus === "unfulfilled");
  const picking = scoped.filter((o) => o.fulfillmentStatus === "picking");
  const packed = scoped.filter((o) => o.fulfillmentStatus === "packed");
  const exceptions = useMemo(
    () =>
      orders.filter(
        (o) =>
          (session.brandId === "all" || o.brandId === session.brandId) &&
          (o.fulfillmentStatus === "on_hold" ||
            o.exceptionStatus === "fulfilment_exception" ||
            o.exceptionStatus === "address_issue" ||
            o.exceptionStatus === "automation_failed"),
      ),
    [orders, session.brandId],
  );

  const brandName = (id: string) => brands.find((b) => b.id === id)?.name.replace(" (Demo)", "") ?? id;
  const manifestOrders = packed.filter((o) => (o.courier ?? "ninja_van") === manifestOpen);

  const QUEUES: { title: string; icon: typeof ClipboardCheck; rows: Order[]; action: { label: string; to: "picking" | "packed" } | null; hint: string }[] = [
    { title: "To pick", icon: ClipboardCheck, rows: toPick, action: { label: "Start pick", to: "picking" }, hint: "Approved orders waiting for a picker" },
    { title: "Picking", icon: PackageCheck, rows: picking, action: { label: "Mark packed", to: "packed" }, hint: "Packing creates the AWB label" },
    { title: "Packed — ready for handover", icon: Truck, rows: packed, action: null, hint: "Hand over via the courier manifest" },
  ];

  return (
    <PageBody className="max-w-none">
      <PageHeader
        title="Fulfilment"
        description="Pick → pack → handover for the KL fulfilment centre. Every move lands on the order's evidence timeline."
      >
        <div className="flex gap-2">
          {(["ninja_van", "jnt"] as const).map((c) => {
            const count = packed.filter((o) => (o.courier ?? "ninja_van") === c).length;
            return (
              <Button
                key={c}
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={!canAct || count === 0}
                onClick={() => setManifestOpen(c)}
              >
                <Truck className="size-3.5" aria-hidden />
                {c === "jnt" ? "J&T" : "Ninja Van"} manifest
                <Badge variant="secondary" className="tnum ml-1 h-4 px-1 text-[10px]">{count}</Badge>
              </Button>
            );
          })}
        </div>
      </PageHeader>

      {!canAct && (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Your role can view the floor but not act — pick/pack/handover needs Operations or HQ Admin.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {QUEUES.map((q) => (
          <Card key={q.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="flex items-center gap-2 text-sm font-medium">
                <q.icon className="size-4 text-muted-foreground" aria-hidden />
                {q.title}
              </CardTitle>
              <Badge variant="outline" className="tnum text-xs">{q.rows.length}</Badge>
            </CardHeader>
            <CardContent className="space-y-0 divide-y">
              <p className="pb-2 text-[11px] text-muted-foreground">{q.hint}</p>
              {q.rows.slice(0, 8).map((o) => (
                <div key={o.id} className="flex items-center gap-2.5 py-2 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <Link href={`/orders/${o.id}`} className="text-sm font-medium text-info underline-offset-2 hover:underline">
                        {o.id}
                      </Link>
                      <span className="truncate text-[11px] text-muted-foreground">
                        {brandName(o.brandId)} · {skuSummary(o)}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="tnum">{formatRelative(o.placedAt)}</span>
                      {o.paymentStatus === "cod_pending" && <StatusPill dimension="payment" value="cod_pending" />}
                      {o.trackingNumber && <span className="tnum">{o.trackingNumber}</span>}
                    </div>
                  </div>
                  {q.action && canAct && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 text-xs"
                      onClick={() => {
                        advanceFulfillment(o.id, q.action!.to, persona.name);
                        toast.success(`${o.id} → ${q.action!.to}`, {
                          description: "Recorded on the order's evidence timeline.",
                        });
                      }}
                    >
                      {q.action.label}
                    </Button>
                  )}
                </div>
              ))}
              {q.rows.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">Queue clear.</p>
              )}
              {q.rows.length > 8 && (
                <p className="pt-2 text-[11px] text-muted-foreground">
                  +{q.rows.length - 8} more — see{" "}
                  <Link href="/orders?view=all" className="text-info underline-offset-2 hover:underline">Orders</Link>.
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* exceptions */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <ShieldAlert className="size-4 text-destructive" aria-hidden />
            Fulfilment exceptions
          </CardTitle>
          <Badge variant="outline" className="tnum text-xs">{exceptions.length}</Badge>
        </CardHeader>
        <CardContent>
          {exceptions.length === 0 ? (
            <EmptyState title="No exceptions" description="Holds, address issues, and automation failures appear here." />
          ) : (
            <ul className="divide-y">
              {exceptions.map((o) => (
                <li key={o.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
                  <Link href={`/orders/${o.id}`} className="text-sm font-medium text-info underline-offset-2 hover:underline">{o.id}</Link>
                  <StatusPill dimension="fulfillment" value={o.fulfillmentStatus} />
                  <span className={cn("text-xs", o.exceptionStatus !== "none" ? "text-warning" : "text-muted-foreground")}>
                    {o.exceptionStatus !== "none" ? o.exceptionStatus.replace(/_/g, " ") : "on hold"}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{o.nextAction}</span>
                  <span className="tnum shrink-0 text-[11px] text-muted-foreground">{formatRelative(o.placedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* manifest handover */}
      <ImpactPreviewDialog
        open={manifestOpen !== null}
        onOpenChange={(o) => !o && setManifestOpen(null)}
        title={`Hand over ${manifestOrders.length} parcels to ${manifestOpen === "jnt" ? "J&T" : "Ninja Van"}?`}
        description="Closes today's manifest for this courier and records the handover on every order."
        impact={[
          { label: "Parcels", value: String(manifestOrders.length) },
          { label: "Fulfilment state", value: "packed → handed over", tone: "success" },
          { label: "Shipment state", value: "awaits first courier scan" },
        ]}
        externalDestination="None in Demo mode — in Live mode this books the pickup via the courier API (write scope)."
        reversibility="Reversible until the courier collects."
        auditNote="Each order gets a fulfilment.handed_over event with your persona."
        confirmLabel="Confirm handover"
        onConfirm={() => {
          for (const o of manifestOrders) {
            advanceFulfillment(o.id, "handed_over", persona.name);
          }
          toast.success(`${manifestOrders.length} parcels handed over`, {
            description: "Manifest recorded; shipment states await courier scans.",
          });
        }}
      />
    </PageBody>
  );
}

export default function FulfilmentPage() {
  return (
    <RouteGuard permission="orders.view">
      <FulfilmentInner />
    </RouteGuard>
  );
}
