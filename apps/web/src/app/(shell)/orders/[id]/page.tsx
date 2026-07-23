"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { ArrowLeft, ExternalLink, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { ImpactPreviewDialog } from "@/components/dialogs/impact-preview-dialog";
import { PageBody } from "@/components/shell/page-header";
import { MoneyCell } from "@/components/tables/cells";
import { FreshnessBadge } from "@/components/status/freshness-badge";
import { SixStateStrip } from "@/components/status/six-state-strip";
import { EvidenceTimeline } from "@/components/timeline/evidence-timeline";
import { EmptyState } from "@/components/states";
import { useRepo } from "@/hooks/use-repo";
import { usePermission, useSession } from "@/hooks/use-session";
import { formatMoney } from "@/lib/domain/money";
import { RouteGuard } from "@/lib/rbac/guard";
import { useAppStore } from "@/lib/store/provider";
import { formatDateTime, formatRelative } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

function OrderDetailInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const repo = useRepo();
  const session = useSession();

  const order = useAppStore((s) => s.orders.find((o) => o.id === params.id));
  const allEvents = useAppStore((s) => s.orderEvents);
  const events = useMemo(
    () => allEvents.filter((e) => e.orderId === params.id),
    [allEvents, params.id],
  );
  const customer = useAppStore((s) => s.customers.find((c) => c.id === order?.customerId));
  const brand = useAppStore((s) => s.brands.find((b) => b.id === order?.brandId));
  const store = useAppStore((s) => s.stores.find((st) => st.id === order?.storeId));
  const personas = useAppStore((s) => s.personas);
  const campaign = useAppStore((s) => s.campaigns.find((c) => c.id === order?.campaignId));
  const integration = useAppStore((s) => s.integrations.find((i) => i.id === order?.integrationId));
  const courierIntegration = useAppStore((s) =>
    s.integrations.find((i) => (order?.courier === "jnt" ? i.id === "INT-jnt" : i.id === "INT-ninja-van")),
  );

  const canAssign = usePermission("orders.assign");
  const canApprove = usePermission("orders.approve");
  const canCancel = usePermission("orders.cancel");
  const canNotify = usePermission("orders.notify");
  const canSeeFees = usePermission("finance.fees.view");

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignee, setAssignee] = useState<string>("USR-ida");
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");
  const [cancelOpen, setCancelOpen] = useState(false);
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);

  const phone = useMemo(
    () => customer?.identities.find((i) => i.type === "phone")?.value,
    [customer],
  );

  if (!order) {
    return (
      <PageBody className="max-w-3xl">
        <EmptyState
          title="Order not found"
          description={`No order with ID “${params.id}” exists in the seeded dataset. If this came from a Shopee link, the stale Shopee sync may not have imported it yet.`}
          action={{ label: "Back to orders", href: "/orders" }}
        />
      </PageBody>
    );
  }

  const owner = personas.find((p) => p.id === order.ownerId);
  const isOpenOrder = order.orderStatus !== "completed" && order.orderStatus !== "cancelled";
  const gatewayFee = order.paymentMethod === "marketplace"
    ? Math.round((order.grandTotal - order.refundedTotal) * 0.1)
    : order.paymentMethod === "cod"
      ? 500
      : Math.round((order.grandTotal - order.refundedTotal) * 0.025) + 100;

  return (
    <PageBody className="max-w-none">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon" className="size-7" aria-label="Back to orders">
              <Link href="/orders"><ArrowLeft className="size-4" /></Link>
            </Button>
            <h1 className="text-lg font-semibold tracking-tight">{order.id}</h1>
            {order.isDraft && <Badge variant="outline">Draft</Badge>}
            {order.exceptionStatus !== "none" && (
              <Badge variant="outline" className="border-destructive/30 bg-destructive/10 text-destructive">
                <ShieldAlert className="size-3" aria-hidden />
                {order.exceptionStatus.replace(/_/g, " ")}
              </Badge>
            )}
            <Badge variant="outline" className="border-ai/30 bg-ai/10 text-ai capitalize">{session.mode} mode</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {brand?.name} · {store?.name} · {order.sourceType.replace("_", " ")}
            {order.sourceOrderId && ` · ${order.sourceOrderId}`} · placed {formatRelative(order.placedAt)}
          </p>
          <p className="mt-0.5 text-sm">
            <span className="text-muted-foreground">Owner: </span>
            {owner ? owner.name : <span className="text-muted-foreground">unassigned</span>}
            {order.nextAction && (
              <>
                <span className="text-muted-foreground"> · Next: </span>
                <span className="text-warning">{order.nextAction}</span>
              </>
            )}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_290px]">
        <div className="min-w-0 space-y-4">
          {/* six states */}
          <Card>
            <CardHeader><CardTitle className="text-sm font-medium">States</CardTitle></CardHeader>
            <CardContent><SixStateStrip order={order} /></CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* customer */}
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm font-medium">Customer</CardTitle>
                {customer && (
                  <Button asChild variant="ghost" size="sm" className="h-7 px-2 text-xs">
                    <Link href={`/customers/${customer.id}`}>Customer 360</Link>
                  </Button>
                )}
              </CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                <div className="font-medium">{customer?.displayName}</div>
                <div className="tnum text-muted-foreground">{phone}</div>
                <div className="text-muted-foreground">
                  {customer?.addresses.find((a) => a.isDefault)?.line1},{" "}
                  {customer?.addresses.find((a) => a.isDefault)?.city},{" "}
                  {customer?.addresses.find((a) => a.isDefault)?.postcode}{" "}
                  {customer?.addresses.find((a) => a.isDefault)?.country}
                </div>
                <div className="flex gap-2 pt-1 text-xs text-muted-foreground">
                  <span className="tnum">{customer?.lifetimeOrders ?? 0} lifetime orders</span>
                  <span>·</span>
                  <span className="capitalize">{customer?.repeatState.replace("_", " ")}</span>
                  {order.isNewCustomer && (<><span>·</span><span className="text-info">first order</span></>)}
                </div>
              </CardContent>
            </Card>

            {/* payment */}
            <Card>
              <CardHeader><CardTitle className="text-sm font-medium">Payment</CardTitle></CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Method</span><span className="capitalize">{order.paymentMethod}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">State</span><span className="capitalize">{order.paymentStatus.replace(/_/g, " ")}</span></div>
                {canSeeFees ? (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Est. gateway/commission fee</span>
                    <MoneyCell minor={gatewayFee} currency={order.currency} />
                  </div>
                ) : (
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Fees</span><span>visible to Finance role</span>
                  </div>
                )}
                {order.refundedTotal > 0 && (
                  <div className="flex justify-between text-destructive">
                    <span>Refunded</span>
                    <MoneyCell minor={order.refundedTotal} currency={order.currency} />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* items + amounts */}
          <Card>
            <CardHeader><CardTitle className="text-sm font-medium">Items & amounts</CardTitle></CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">Item</th>
                    <th className="pb-2 font-medium">SKU</th>
                    <th className="pb-2 text-right font-medium">Qty</th>
                    <th className="pb-2 text-right font-medium">Unit</th>
                    <th className="pb-2 text-right font-medium">Line</th>
                  </tr>
                </thead>
                <tbody>
                  {order.items.map((it) => (
                    <tr key={it.sku} className="border-b last:border-0">
                      <td className="py-2">{it.nameSnapshot}</td>
                      <td className="py-2">
                        <Link href={`/catalog/products?sku=${it.sku}`} className="tnum text-info underline-offset-2 hover:underline">
                          {it.sku}
                        </Link>
                      </td>
                      <td className="tnum py-2 text-right">{it.quantity}</td>
                      <td className="py-2 text-right"><MoneyCell minor={it.unitPrice} currency={order.currency} /></td>
                      <td className="py-2 text-right"><MoneyCell minor={it.lineTotal} currency={order.currency} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3 ml-auto max-w-56 space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><MoneyCell minor={order.subtotal} currency={order.currency} /></div>
                {order.discountTotal > 0 && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><MoneyCell minor={-order.discountTotal} currency={order.currency} /></div>
                )}
                <div className="flex justify-between"><span className="text-muted-foreground">Shipping</span><MoneyCell minor={order.shippingTotal} currency={order.currency} /></div>
                <Separator />
                <div className="flex justify-between font-medium"><span>Total</span><MoneyCell minor={order.grandTotal} currency={order.currency} /></div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* fulfilment & shipment */}
            <Card>
              <CardHeader><CardTitle className="text-sm font-medium">Fulfilment & shipment</CardTitle></CardHeader>
              <CardContent className="space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Fulfilment</span><span className="capitalize">{order.fulfillmentStatus.replace(/_/g, " ")}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Courier</span><span>{order.courier === "ninja_van" ? "Ninja Van" : order.courier === "jnt" ? "J&T Express" : "—"}</span></div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tracking</span>
                  <span className="tnum">{order.trackingNumber ?? "—"}</span>
                </div>
                <div className="flex justify-between"><span className="text-muted-foreground">Shipment</span><span className="capitalize">{order.shipmentStatus.replace(/_/g, " ")}</span></div>
                {order.exceptionStatus === "shipment_exception" && (
                  <p className="mt-1 rounded-md border border-destructive/25 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                    No courier movement for over 48h — linked to the Ninja Van webhook gap on 21 Jul.
                  </p>
                )}
              </CardContent>
            </Card>

            {/* source & integration health */}
            <Card>
              <CardHeader><CardTitle className="text-sm font-medium">Source & integration health</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Source system</span><span className="capitalize">{order.sourceType.replace("_", " ")}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Source ID</span><span className="tnum">{order.sourceOrderId ?? "—"}</span></div>
                {campaign && (
                  <div className="flex justify-between gap-2">
                    <span className="text-muted-foreground">Attributed campaign</span>
                    <Link href={`/marketing?campaign=${campaign.id}`} className="truncate text-info underline-offset-2 hover:underline">
                      {campaign.name}
                    </Link>
                  </div>
                )}
                {integration && (
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/integrations/${integration.id}`} className="text-muted-foreground underline-offset-2 hover:underline">
                      {integration.name}
                    </Link>
                    <FreshnessBadge lastSuccessAt={integration.lastSuccessAt} slaMinutes={integration.freshnessSlaMinutes} />
                  </div>
                )}
                {order.courier && courierIntegration && (
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/integrations/${courierIntegration.id}`} className="text-muted-foreground underline-offset-2 hover:underline">
                      {courierIntegration.name}
                    </Link>
                    <FreshnessBadge lastSuccessAt={courierIntegration.lastSuccessAt} slaMinutes={courierIntegration.freshnessSlaMinutes} />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* evidence timeline */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Evidence timeline</CardTitle>
              <p className="text-xs text-muted-foreground">
                Every user, system, connector, rule, and courier event — one object, one timeline.
              </p>
            </CardHeader>
            <CardContent><EvidenceTimeline events={events} /></CardContent>
          </Card>
        </div>

        {/* ---------- action rail ---------- */}
        <div className="space-y-3">
          <Card>
            <CardHeader><CardTitle className="text-sm font-medium">Actions</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {canAssign && isOpenOrder && (
                <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => setAssignOpen(true)}>
                  Assign owner
                </Button>
              )}
              {canApprove && order.orderStatus === "pending_review" && (
                <Button size="sm" className="w-full justify-start" onClick={() => setApproveOpen(true)}>
                  Review & approve
                </Button>
              )}
              {canNotify && (order.notificationStatus === "failed" || order.notificationStatus === "queued") && (
                <Button
                  variant="outline" size="sm" className="w-full justify-start"
                  onClick={async () => {
                    await repo.resendOrderNotification(order.id);
                    toast.success("Confirmation re-sent", { description: "WhatsApp template T-02 · recorded in the timeline" });
                  }}
                >
                  Resend confirmation
                </Button>
              )}
              {order.exceptionStatus === "shipment_exception" && (
                <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => setEscalateOpen(true)}>
                  Escalate with courier
                </Button>
              )}
              <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => setNoteOpen(true)}>
                Add note
              </Button>
              {canCancel && isOpenOrder && !order.isDraft && (
                <Button variant="outline" size="sm" className="w-full justify-start text-destructive" onClick={() => setCancelOpen(true)}>
                  Cancel order
                </Button>
              )}
              {order.isDraft && (
                <p className="rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
                  Draft orders are completed from the order form. Fulfilment actions unlock after review.
                </p>
              )}
              {!isOpenOrder && (
                <p className="rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
                  This order is {order.orderStatus}. Only notes remain available; refunds are handled from the return record.
                </p>
              )}
              {!canAssign && !canApprove && !canCancel && (
                <p className="rounded-md bg-muted px-2 py-1.5 text-xs text-muted-foreground">
                  Your demo role can view this order but not act on it. Switch to Sales/CS, Operations, or HQ Admin.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-sm font-medium">Scope</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 text-xs text-muted-foreground">
              <div className="flex justify-between"><span>Brand</span><span className="text-foreground">{brand?.name.replace(" (Demo)", "")}</span></div>
              <div className="flex justify-between"><span>Market</span><span className="text-foreground">{order.market}</span></div>
              <div className="flex justify-between"><span>Store</span><span className="text-foreground">{store?.name}</span></div>
              <div className="flex justify-between"><span>Channel</span><span className="text-foreground capitalize">{store?.channelType}</span></div>
              <div className="flex justify-between"><span>Currency</span><span className="text-foreground">{order.currency}</span></div>
              <div className="flex justify-between"><span>Legal entity</span><span className="text-foreground">{order.legalEntityId === "LE-my" ? "EFFEN International Sdn Bhd" : "EFFEN Commerce Pte Ltd (Demo)"}</span></div>
              <div className="flex justify-between"><span>Placed</span><span className="tnum text-foreground">{formatDateTime(order.placedAt)}</span></div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ---------- dialogs ---------- */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Assign owner</DialogTitle>
            <DialogDescription>The owner is accountable for the next action on {order.id}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="assignee">Assignee</Label>
            <Select value={assignee} onValueChange={setAssignee}>
              <SelectTrigger id="assignee"><SelectValue /></SelectTrigger>
              <SelectContent>
                {personas.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name} — {p.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>Cancel</Button>
            <Button
              onClick={async () => {
                await repo.assignOrder(order.id, assignee);
                setAssignOpen(false);
                toast.success(`Assigned to ${personas.find((p) => p.id === assignee)?.name}`);
              }}
            >
              Assign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add note</DialogTitle>
            <DialogDescription>Notes land on the evidence timeline and in the audit trail.</DialogDescription>
          </DialogHeader>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="e.g. Customer confirmed availability for redelivery on Friday." />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteOpen(false)}>Cancel</Button>
            <Button
              disabled={!note.trim()}
              onClick={async () => {
                await repo.addOrderNote(order.id, note.trim());
                setNote("");
                setNoteOpen(false);
                toast.success("Note added to the timeline");
              }}
            >
              Add note
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ImpactPreviewDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        title={`Approve ${order.id}?`}
        description="Approval releases the order to fulfilment."
        impact={[
          { label: "Order state", value: "pending review → approved", tone: "success" },
          { label: "Fulfilment", value: "joins the pick queue" },
          { label: "Stock", value: `${order.items.reduce((s, i) => s + i.quantity, 0)} units reserved` },
        ]}
        externalDestination="None in Demo mode — in Live mode this would notify the fulfilment centre."
        reversibility="Reversible until packing starts."
        auditNote="Recorded as order.approved with your demo persona."
        confirmLabel="Approve order"
        onConfirm={async () => {
          await repo.approveOrder(order.id);
          toast.success(`${order.id} approved`);
        }}
      />

      <ImpactPreviewDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={`Cancel ${order.id}?`}
        description="Cancellation stops fulfilment and releases reserved stock."
        impact={[
          { label: "Order state", value: `${order.orderStatus.replace(/_/g, " ")} → cancelled`, tone: "destructive" },
          { label: "Payment", value: order.paymentStatus === "paid" ? "refund case opens for Finance" : "no charge captured" },
          { label: "Contribution impact", value: `−${formatMoney(order.grandTotal, order.currency)}`, tone: "destructive" },
        ]}
        externalDestination="None in Demo mode — in Live mode the source store and customer would be notified."
        reversibility="Not reversible. A new order must be created instead."
        auditNote="Recorded as order.cancelled with your rationale."
        confirmLabel="Cancel order"
        requireNote
        notePlaceholder="Reason for cancellation (required)"
        destructive
        onConfirm={async (reason) => {
          await repo.cancelOrder(order.id, reason);
          toast.success(`${order.id} cancelled`);
        }}
      />

      <ImpactPreviewDialog
        open={escalateOpen}
        onOpenChange={setEscalateOpen}
        title="Escalate with Ninja Van?"
        description="Opens a trace request with the courier account manager for this AWB."
        impact={[
          { label: "Trace request", value: order.trackingNumber ?? "—" },
          { label: "Customer", value: "proactive delay notice (approved template)" },
          { label: "SLA clock", value: "pauses while the trace is open" },
        ]}
        externalDestination="None in Demo mode — in Live mode this raises a ticket in the Ninja Van portal."
        reversibility="Reversible — the trace can be withdrawn."
        auditNote="Recorded as a timeline note with reason code COURIER_ESCALATED."
        confirmLabel="Escalate"
        onConfirm={async () => {
          await repo.addOrderNote(
            order.id,
            `Escalated to Ninja Van account manager — trace opened for ${order.trackingNumber}. Proactive delay notice sent to customer.`,
          );
          toast.success("Escalated with Ninja Van", { description: "Trace request recorded on the timeline" });
        }}
      />

      <div className="flex justify-start">
        <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => router.push("/orders")}>
          <ExternalLink className="size-3.5 rotate-180" aria-hidden /> Back to orders
        </Button>
      </div>
    </PageBody>
  );
}

export default function OrderDetailPage() {
  return (
    <RouteGuard permission="orders.view">
      <OrderDetailInner />
    </RouteGuard>
  );
}
