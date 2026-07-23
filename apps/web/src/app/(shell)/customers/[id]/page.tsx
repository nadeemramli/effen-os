"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useMemo } from "react";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageBody } from "@/components/shell/page-header";
import { StatusPill } from "@/components/status/status-pill";
import { EmptyState } from "@/components/states";
import { FreshnessBadge } from "@/components/status/freshness-badge";
import { usePermission } from "@/hooks/use-session";
import { formatMoney } from "@/lib/domain/money";
import { RouteGuard } from "@/lib/rbac/guard";
import { useAppStore } from "@/lib/store/provider";
import { formatDate, formatRelative } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";
import { maskEmail, maskPhone } from "@/lib/utils/mask";

const IDENTITY_LABEL: Record<string, string> = {
  phone: "Phone",
  email: "Email",
  whatsapp: "WhatsApp",
  shopee_handle: "Shopee",
  tiktok_handle: "TikTok",
};

function CustomerDetailInner() {
  const params = useParams<{ id: string }>();
  const canSeePii = usePermission("customers.pii.view");

  const customer = useAppStore((s) => s.customers.find((c) => c.id === params.id));
  const allOrders = useAppStore((s) => s.orders);
  const orders = useMemo(
    () => allOrders.filter((o) => o.customerId === params.id),
    [allOrders, params.id],
  );
  const events = useAppStore((s) => s.orderEvents);
  const brands = useAppStore((s) => s.brands);
  const products = useAppStore((s) => s.products);
  const personas = useAppStore((s) => s.personas);
  const rudderstack = useAppStore((s) => s.integrations.find((i) => i.id === "INT-rudderstack"));

  const sortedOrders = useMemo(
    () => [...orders].sort((a, b) => (a.placedAt < b.placedAt ? 1 : -1)),
    [orders],
  );

  const purchasedSkus = useMemo(() => {
    const counts = new Map<string, { qty: number; last: string }>();
    for (const o of sortedOrders) {
      for (const it of o.items) {
        const cur = counts.get(it.sku) ?? { qty: 0, last: o.placedAt };
        counts.set(it.sku, { qty: cur.qty + it.quantity, last: cur.last > o.placedAt ? cur.last : o.placedAt });
      }
    }
    return [...counts.entries()].sort((a, b) => b[1].qty - a[1].qty);
  }, [sortedOrders]);

  const conversationEvents = useMemo(
    () =>
      events
        .filter(
          (e) =>
            sortedOrders.some((o) => o.id === e.orderId) &&
            (e.actorType === "user" || e.dimension === "note" || e.actorName.includes("WhatsApp")),
        )
        .sort((a, b) => (a.at < b.at ? 1 : -1))
        .slice(0, 8),
    [events, sortedOrders],
  );

  if (!customer) {
    return (
      <PageBody className="max-w-3xl">
        <EmptyState
          title="Customer not found"
          description="No resolved identity with this ID. If it came from a marketplace, identity stitching may not have processed it — check RudderStack freshness in Data Health."
          action={{ label: "Back to customers", href: "/customers" }}
        />
      </PageBody>
    );
  }

  const owner = personas.find((p) => p.id === customer.ownerId);
  const currency = customer.primaryMarket === "SG" ? "SGD" : "MYR";
  const daysSinceLast = customer.lastOrderAt
    ? Math.round((Date.parse("2026-07-23T09:00:00+08:00") - Date.parse(customer.lastOrderAt)) / 86400000)
    : null;
  const replenishmentDue =
    customer.brandIds.includes("BRD-lipidri") && daysSinceLast !== null && daysSinceLast >= 35;

  return (
    <PageBody className="max-w-none">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon" className="size-7" aria-label="Back to customers">
              <Link href="/customers"><ArrowLeft className="size-4" /></Link>
            </Button>
            <h1 className="text-lg font-semibold tracking-tight">{customer.displayName}</h1>
            <Badge variant="outline" className="capitalize">{customer.lifecycleState.replace("_", " ")}</Badge>
            <Badge variant="outline" className="uppercase">{customer.valueTier}</Badge>
            {customer.serviceRisk !== "none" && (
              <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning capitalize">
                {customer.serviceRisk.replace("_", " ")}
              </Badge>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {customer.id} · {customer.primaryMarket} · first seen {formatRelative(customer.firstSeenAt)} · owner:{" "}
            {owner?.name ?? "unassigned"}
          </p>
        </div>
      </div>

      {/* value strip */}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        {[
          { label: "Lifetime orders", value: String(customer.lifetimeOrders) },
          { label: "Net revenue", value: formatMoney(customer.netRevenue, currency, { compact: true }) },
          { label: "Contribution LTV", value: formatMoney(customer.contributionLtv, currency, { compact: true }) },
          { label: "Last order", value: customer.lastOrderAt ? formatRelative(customer.lastOrderAt) : "never" },
          { label: "Repeat state", value: customer.repeatState.replace("_", " ") },
          { label: "COD / return risk", value: `${customer.codRiskScore} · ${Math.round(customer.returnRate * 100)}%` },
        ].map((m) => (
          <div key={m.label} className="rounded-lg border bg-card px-3 py-2.5">
            <div className="text-[11px] text-muted-foreground">{m.label}</div>
            <div className="tnum mt-0.5 text-base font-semibold capitalize">{m.value}</div>
          </div>
        ))}
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          {/* order timeline */}
          <Card>
            <CardHeader><CardTitle className="text-sm font-medium">Orders</CardTitle></CardHeader>
            <CardContent>
              {sortedOrders.length === 0 ? (
                <p className="text-sm text-muted-foreground">No orders linked to this identity yet.</p>
              ) : (
                <ul className="divide-y">
                  {sortedOrders.map((o) => (
                    <li key={o.id} className="py-2.5 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/orders/${o.id}`} className="font-medium text-info underline-offset-2 hover:underline">
                          {o.id}
                        </Link>
                        <span className="text-xs text-muted-foreground">
                          {brands.find((b) => b.id === o.brandId)?.name.replace(" (Demo)", "")} · {o.sourceType.replace("_", " ")} · {formatDate(o.placedAt)}
                        </span>
                        <span className="tnum ml-auto text-sm font-medium">
                          {formatMoney(o.grandTotal, o.currency)}
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        <StatusPill dimension="order" value={o.orderStatus} />
                        <StatusPill dimension="payment" value={o.paymentStatus} />
                        <StatusPill dimension="shipment" value={o.shipmentStatus} />
                        {o.returnStatus !== "none" && <StatusPill dimension="return" value={o.returnStatus} />}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* conversation & activity */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Conversation & activity</CardTitle>
              <p className="text-xs text-muted-foreground">Human touches and chat intake events across this customer&apos;s orders.</p>
            </CardHeader>
            <CardContent>
              {conversationEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No conversation events recorded.</p>
              ) : (
                <ul className="space-y-2.5">
                  {conversationEvents.map((e) => (
                    <li key={e.id} className="flex gap-2.5 text-sm">
                      <span className="tnum shrink-0 pt-0.5 text-[11px] text-muted-foreground">{formatRelative(e.at)}</span>
                      <span className="min-w-0">
                        <span className="font-medium">{e.actorName}</span>{" "}
                        <span className="text-muted-foreground">on</span>{" "}
                        <Link href={`/orders/${e.orderId}`} className="text-info underline-offset-2 hover:underline">{e.orderId}</Link>
                        <span className="block text-muted-foreground">{e.message}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* purchased products */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Purchased products & replenishment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {replenishmentDue && (
                <p className="rounded-md border border-info/25 bg-info/10 px-2.5 py-2 text-xs text-info">
                  Replenishment cue: Omega-3 buyers reorder every ~45 days on average — last order was {daysSinceLast} days ago.
                </p>
              )}
              {purchasedSkus.length === 0 ? (
                <p className="text-sm text-muted-foreground">No purchases yet.</p>
              ) : (
                <ul className="divide-y">
                  {purchasedSkus.map(([sku, info]) => {
                    const product = products.find((p) => p.variants.some((v) => v.sku === sku));
                    return (
                      <li key={sku} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0 text-sm">
                        <Link href={`/catalog/products?sku=${sku}`} className="tnum text-info underline-offset-2 hover:underline">{sku}</Link>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">{product?.name}</span>
                        <span className="tnum text-xs text-muted-foreground">×{info.qty} · last {formatRelative(info.last)}</span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          {/* identity */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-sm font-medium">
                Resolved identity
                <span className="tnum text-xs font-normal text-muted-foreground">
                  confidence {(customer.sourceConfidence * 100).toFixed(0)}%
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {customer.identities.map((i) => (
                <div key={i.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">{IDENTITY_LABEL[i.type] ?? i.type}</span>
                  <span className="tnum flex items-center gap-1.5">
                    {i.type === "email" ? maskEmail(i.value, canSeePii) : i.type === "phone" || i.type === "whatsapp" ? maskPhone(i.value, canSeePii) : i.value}
                    {i.isVerified && <ShieldCheck className="size-3.5 text-success" aria-label="verified" />}
                  </span>
                </div>
              ))}
              {!canSeePii && (
                <p className="pt-1 text-[11px] text-muted-foreground">
                  Contact details are masked for your role — Sales/CS and HQ see them in full.
                </p>
              )}
              <p className="border-t pt-2 text-[11px] text-muted-foreground">
                Phone-keyed identity via RudderStack Profiles. Merges keep auditable provenance.
              </p>
            </CardContent>
          </Card>

          {/* consent */}
          <Card>
            <CardHeader><CardTitle className="text-sm font-medium">Consent & suppression</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {customer.consents.map((c, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="capitalize text-muted-foreground">{c.channel} · {c.purpose}</span>
                  <span
                    className={cn(
                      "text-xs font-medium",
                      c.status === "granted" ? "text-success" : c.status === "revoked" ? "text-destructive" : "text-muted-foreground",
                    )}
                  >
                    {c.status}
                  </span>
                </div>
              ))}
              <p className="border-t pt-2 text-[11px] text-muted-foreground">
                Revoked or unknown consent suppresses marketing sends automatically; transactional messages still deliver.
              </p>
            </CardContent>
          </Card>

          {/* segments / objections */}
          <Card>
            <CardHeader><CardTitle className="text-sm font-medium">Segments & journeys</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {customer.segments.length > 0 ? (
                  customer.segments.map((s) => <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>)
                ) : (
                  <span className="text-sm text-muted-foreground">No segment memberships.</span>
                )}
              </div>
              {customer.objections.length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">Objections raised</div>
                  <ul className="list-inside list-disc text-xs text-muted-foreground">
                    {customer.objections.map((o) => (<li key={o}>{o}</li>))}
                  </ul>
                </div>
              )}
              {customer.notes.length > 0 && (
                <div>
                  <div className="mb-1 text-xs font-medium text-muted-foreground">CS notes</div>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {customer.notes.map((n) => (<li key={n} className="rounded bg-muted px-2 py-1">{n}</li>))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>

          {/* provenance */}
          <Card>
            <CardHeader><CardTitle className="text-sm font-medium">Data provenance</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-xs text-muted-foreground">
              <div className="flex items-center justify-between gap-2">
                <span>RudderStack Profiles</span>
                {rudderstack && (
                  <FreshnessBadge lastSuccessAt={rudderstack.lastSuccessAt} slaMinutes={rudderstack.freshnessSlaMinutes} />
                )}
              </div>
              <p>
                Traits and stitching are 14h stale (sync issue DQ-0002) — recent behaviour may be missing.
                Orders come directly from source connectors and are current.
              </p>
              <Link href="/data-health" className="text-info underline-offset-2 hover:underline">
                View data health
              </Link>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageBody>
  );
}

export default function CustomerDetailPage() {
  return (
    <RouteGuard permission="customers.view">
      <CustomerDetailInner />
    </RouteGuard>
  );
}
