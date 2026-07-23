"use client";

import { useRouter } from "next/navigation";
import { parseAsString, useQueryState } from "nuqs";
import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, X } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable } from "@/components/tables/data-table";
import { MoneyCell } from "@/components/tables/cells";
import { StatusPill } from "@/components/status/status-pill";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { RouteGuard } from "@/lib/rbac/guard";
import type { Order } from "@/lib/domain/types";
import { useActivePersona, useSession } from "@/hooks/use-session";
import { useAppStore } from "@/lib/store/provider";
import { hoursSince, formatRelative } from "@/lib/utils/dates";
import { cn } from "@/lib/utils";

/* ---------- saved views ---------- */

interface SavedView {
  key: string;
  label: string;
  predicate: (o: Order, ctx: { personaId: string }) => boolean;
}

const SAVED_VIEWS: SavedView[] = [
  { key: "my-work", label: "My work", predicate: (o, { personaId }) => o.ownerId === personaId && o.orderStatus !== "completed" && o.orderStatus !== "cancelled" },
  { key: "unassigned", label: "Unassigned", predicate: (o) => !o.ownerId && (o.exceptionStatus !== "none" || o.orderStatus === "pending_review") },
  { key: "new", label: "New", predicate: (o) => hoursSince(o.placedAt) <= 24 && !o.isDraft },
  { key: "sla-risk", label: "SLA risk", predicate: (o) => o.slaRisk === "high" || o.slaRisk === "critical" || o.exceptionStatus === "shipment_exception" },
  { key: "payment-exception", label: "Payment exception", predicate: (o) => o.exceptionStatus === "payment_exception" || o.paymentStatus === "failed" || o.paymentStatus === "pending_verification" },
  { key: "fulfilment-exception", label: "Fulfilment exception", predicate: (o) => o.exceptionStatus === "fulfilment_exception" || o.exceptionStatus === "shipment_exception" || o.exceptionStatus === "address_issue" || o.fulfillmentStatus === "on_hold" },
  { key: "failed-automation", label: "Failed automation", predicate: (o) => o.exceptionStatus === "automation_failed" || o.notificationStatus === "failed" },
  { key: "in-transit", label: "In transit", predicate: (o) => o.shipmentStatus === "in_transit" || o.shipmentStatus === "out_for_delivery" },
  { key: "returns", label: "Returns", predicate: (o) => o.returnStatus !== "none" },
  { key: "exceptions", label: "All exceptions", predicate: (o) => o.exceptionStatus !== "none" },
  { key: "all", label: "All", predicate: () => true },
];

const AGE_OPTIONS = [
  { key: "any", label: "Any age" },
  { key: "24h", label: "< 24h" },
  { key: "3d", label: "< 3 days" },
  { key: "7d", label: "< 7 days" },
] as const;

function OrdersInner() {
  const router = useRouter();
  const session = useSession();
  const persona = useActivePersona();
  const orders = useAppStore((s) => s.orders);
  const customers = useAppStore((s) => s.customers);
  const brands = useAppStore((s) => s.brands);
  const stores = useAppStore((s) => s.stores);
  const personas = useAppStore((s) => s.personas);

  const [view, setView] = useQueryState("view", parseAsString.withDefault("all"));
  const [q, setQ] = useQueryState("q", parseAsString.withDefault(""));
  const [storeId, setStoreId] = useQueryState("store", parseAsString.withDefault("any"));
  const [source, setSource] = useQueryState("source", parseAsString.withDefault("any"));
  const [payState, setPayState] = useQueryState("pay", parseAsString.withDefault("any"));
  const [shipState, setShipState] = useQueryState("ship", parseAsString.withDefault("any"));
  const [gateway, setGateway] = useQueryState("gateway", parseAsString.withDefault("any"));
  const [courier, setCourier] = useQueryState("courier", parseAsString.withDefault("any"));
  const [owner, setOwner] = useQueryState("owner", parseAsString.withDefault("any"));
  const [age, setAge] = useQueryState("age", parseAsString.withDefault("any"));
  const [currency, setCurrency] = useQueryState("ccy", parseAsString.withDefault("any"));

  const customerById = useMemo(() => new Map(customers.map((c) => [c.id, c])), [customers]);
  const storeById = useMemo(() => new Map(stores.map((s) => [s.id, s])), [stores]);
  const brandById = useMemo(() => new Map(brands.map((b) => [b.id, b])), [brands]);
  const personaById = useMemo(() => new Map(personas.map((p) => [p.id, p])), [personas]);

  const activeView = SAVED_VIEWS.find((v) => v.key === view) ?? SAVED_VIEWS[SAVED_VIEWS.length - 1]!;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return orders.filter((o) => {
      if (session.brandId !== "all" && o.brandId !== session.brandId) return false;
      if (!activeView.predicate(o, { personaId: persona.id })) return false;
      if (storeId !== "any" && o.storeId !== storeId) return false;
      if (source !== "any" && o.sourceType !== source) return false;
      if (payState !== "any" && o.paymentStatus !== payState) return false;
      if (shipState !== "any" && o.shipmentStatus !== shipState) return false;
      if (gateway !== "any" && o.paymentMethod !== gateway) return false;
      if (courier !== "any" && o.courier !== courier) return false;
      if (owner !== "any" && o.ownerId !== (owner === "none" ? null : owner)) return false;
      if (currency !== "any" && o.currency !== currency) return false;
      if (age !== "any") {
        const h = hoursSince(o.placedAt);
        if (age === "24h" && h > 24) return false;
        if (age === "3d" && h > 72) return false;
        if (age === "7d" && h > 168) return false;
      }
      if (needle) {
        const c = customerById.get(o.customerId);
        const hay = [
          o.id,
          o.sourceOrderId ?? "",
          c?.displayName ?? "",
          ...(c?.identities.map((i) => i.value) ?? []),
          ...o.items.map((i) => i.sku),
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [orders, session.brandId, activeView, persona.id, storeId, source, payState, shipState, gateway, courier, owner, currency, age, q, customerById]);

  const filtersActive =
    q !== "" || storeId !== "any" || source !== "any" || payState !== "any" || shipState !== "any" ||
    gateway !== "any" || courier !== "any" || owner !== "any" || age !== "any" || currency !== "any";

  const columns = useMemo<ColumnDef<Order, unknown>[]>(
    () => [
      {
        id: "id",
        header: "Order",
        accessorKey: "id",
        cell: ({ row }) => (
          <div>
            <span className="font-medium">{row.original.id}</span>
            {row.original.isDraft && (
              <span className="ml-1.5 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">draft</span>
            )}
            <div className="text-[11px] text-muted-foreground">{row.original.sourceOrderId ?? row.original.sourceType}</div>
          </div>
        ),
      },
      {
        id: "customer",
        header: "Customer",
        accessorFn: (o) => customerById.get(o.customerId)?.displayName ?? o.customerId,
        cell: ({ row }) => {
          const c = customerById.get(row.original.customerId);
          return (
            <div>
              <div>{c?.displayName ?? row.original.customerId}</div>
              {row.original.isNewCustomer && <div className="text-[11px] text-info">new customer</div>}
            </div>
          );
        },
      },
      {
        id: "store",
        header: "Brand / store",
        accessorFn: (o) => storeById.get(o.storeId)?.name ?? o.storeId,
        cell: ({ row }) => {
          const st = storeById.get(row.original.storeId);
          const b = brandById.get(row.original.brandId);
          return (
            <div>
              <div>{b?.name.replace(" (Demo)", "") ?? row.original.brandId}</div>
              <div className="text-[11px] text-muted-foreground">{st?.name ?? row.original.storeId}</div>
            </div>
          );
        },
      },
      {
        id: "items",
        header: "Items",
        enableSorting: false,
        cell: ({ row }) => {
          const items = row.original.items;
          return (
            <div className="max-w-44">
              <div className="tnum truncate">{items[0]?.sku}{items[0] && ` ×${items[0].quantity}`}</div>
              {items.length > 1 && (
                <div className="text-[11px] text-muted-foreground">+{items.length - 1} more line{items.length > 2 ? "s" : ""}</div>
              )}
            </div>
          );
        },
      },
      {
        id: "states",
        header: "States",
        enableSorting: false,
        cell: ({ row }) => {
          const o = row.original;
          return (
            <div className="flex max-w-80 flex-wrap gap-1">
              <StatusPill dimension="order" value={o.orderStatus} />
              <StatusPill dimension="payment" value={o.paymentStatus} />
              <StatusPill dimension="fulfillment" value={o.fulfillmentStatus} />
              <StatusPill dimension="shipment" value={o.shipmentStatus} />
              {o.notificationStatus === "failed" && <StatusPill dimension="notification" value={o.notificationStatus} />}
              {o.returnStatus !== "none" && <StatusPill dimension="return" value={o.returnStatus} />}
            </div>
          );
        },
      },
      {
        id: "amount",
        header: "Amount",
        accessorKey: "grandTotal",
        cell: ({ row }) => <MoneyCell minor={row.original.grandTotal} currency={row.original.currency} />,
      },
      {
        id: "owner",
        header: "Owner",
        accessorFn: (o) => (o.ownerId ? personaById.get(o.ownerId)?.name ?? o.ownerId : ""),
        cell: ({ row }) =>
          row.original.ownerId ? (
            <span>{personaById.get(row.original.ownerId)?.name ?? row.original.ownerId}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "age",
        header: "Age",
        accessorFn: (o) => -new Date(o.placedAt).getTime(),
        cell: ({ row }) => (
          <span className="tnum text-muted-foreground">{formatRelative(row.original.placedAt)}</span>
        ),
      },
      {
        id: "next",
        header: "Next action",
        enableSorting: false,
        cell: ({ row }) =>
          row.original.nextAction ? (
            <span className="block max-w-52 truncate text-warning">{row.original.nextAction}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
    ],
    [customerById, storeById, brandById, personaById],
  );

  return (
    <PageBody className="max-w-none">
      <PageHeader
        title="Orders"
        description={`${filtered.length.toLocaleString()} orders in view (full 35-day operational window — use the Age filter to narrow) · states shown separately, never merged`}
      >
        <Button asChild size="sm" className="gap-1.5">
          <Link href="/orders/new">
            <Plus className="size-3.5" aria-hidden /> New order
          </Link>
        </Button>
      </PageHeader>

      {/* saved views */}
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Saved views">
        {SAVED_VIEWS.map((v) => (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={view === v.key}
            className={cn(
              "h-7 rounded-full border px-3 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
              view === v.key
                ? "border-transparent bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
            onClick={() => setView(v.key)}
          >
            {v.label}
          </button>
        ))}
      </div>

      {/* filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value || null)}
          placeholder="Search order, customer, phone, SKU…"
          className="h-8 w-64 text-sm"
          aria-label="Search orders"
        />
        <Select value={storeId} onValueChange={(v) => setStoreId(v === "any" ? null : v)}>
          <SelectTrigger className="h-8 w-40 text-xs" aria-label="Store"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any store</SelectItem>
            {stores
              .filter((s) => session.brandId === "all" || s.brandId === session.brandId)
              .map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Select value={source} onValueChange={(v) => setSource(v === "any" ? null : v)}>
          <SelectTrigger className="h-8 w-36 text-xs" aria-label="Channel"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any channel</SelectItem>
            {["woocommerce", "shopee", "lazada", "tiktok_shop", "whatsapp", "manual"].map((s) => (
              <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={payState} onValueChange={(v) => setPayState(v === "any" ? null : v)}>
          <SelectTrigger className="h-8 w-40 text-xs" aria-label="Payment state"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any payment state</SelectItem>
            {["unpaid", "pending_verification", "paid", "cod_pending", "cod_collected", "failed", "refunded"].map((s) => (
              <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={shipState} onValueChange={(v) => setShipState(v === "any" ? null : v)}>
          <SelectTrigger className="h-8 w-40 text-xs" aria-label="Shipment state"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any shipment state</SelectItem>
            {["not_shipped", "label_created", "in_transit", "out_for_delivery", "delivered", "delivery_failed"].map((s) => (
              <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={gateway} onValueChange={(v) => setGateway(v === "any" ? null : v)}>
          <SelectTrigger className="h-8 w-32 text-xs" aria-label="Gateway"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any gateway</SelectItem>
            {["chip", "stripe", "cod", "marketplace"].map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={courier} onValueChange={(v) => setCourier(v === "any" ? null : v)}>
          <SelectTrigger className="h-8 w-32 text-xs" aria-label="Courier"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any courier</SelectItem>
            <SelectItem value="ninja_van">Ninja Van</SelectItem>
            <SelectItem value="jnt">J&T</SelectItem>
          </SelectContent>
        </Select>
        <Select value={owner} onValueChange={(v) => setOwner(v === "any" ? null : v)}>
          <SelectTrigger className="h-8 w-36 text-xs" aria-label="Assignee"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any assignee</SelectItem>
            <SelectItem value="none">Unassigned</SelectItem>
            {personas.map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={age} onValueChange={(v) => setAge(v === "any" ? null : v)}>
          <SelectTrigger className="h-8 w-28 text-xs" aria-label="Age"><SelectValue /></SelectTrigger>
          <SelectContent>
            {AGE_OPTIONS.map((a) => (
              <SelectItem key={a.key} value={a.key}>{a.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={currency} onValueChange={(v) => setCurrency(v === "any" ? null : v)}>
          <SelectTrigger className="h-8 w-28 text-xs" aria-label="Currency"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="any">MYR + SGD</SelectItem>
            <SelectItem value="MYR">MYR</SelectItem>
            <SelectItem value="SGD">SGD</SelectItem>
          </SelectContent>
        </Select>
        {filtersActive && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1 text-xs text-muted-foreground"
            onClick={() => {
              setQ(null); setStoreId(null); setSource(null); setPayState(null); setShipState(null);
              setGateway(null); setCourier(null); setOwner(null); setAge(null); setCurrency(null);
            }}
          >
            <X className="size-3" aria-hidden /> Clear filters
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        rowKey={(o) => o.id}
        onRowClick={(o) => router.push(`/orders/${o.id}`)}
        emptyTitle="No orders match"
        emptyDescription={
          view === "my-work"
            ? `Nothing is assigned to ${persona.name} in this scope. Switch role or view to see more.`
            : "Adjust the saved view or filters. If you expected marketplace orders here, check the Shopee connection — it is currently stale."
        }
      />
    </PageBody>
  );
}

export default function OrdersPage() {
  return (
    <RouteGuard permission="orders.view">
      <OrdersInner />
    </RouteGuard>
  );
}
