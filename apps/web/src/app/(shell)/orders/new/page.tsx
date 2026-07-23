"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  MessageSquareText,
  Minus,
  Plus,
  Search,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { PageBody, PageHeader } from "@/components/shell/page-header";
import { MoneyCell } from "@/components/tables/cells";
import { useRepo } from "@/hooks/use-repo";
import { useActivePersona } from "@/hooks/use-session";
import type { Order, OrderItem, OrderStateEvent } from "@/lib/domain/types";
import { formatMoney } from "@/lib/domain/money";
import { RouteGuard } from "@/lib/rbac/guard";
import { DEMO_NOW } from "@/lib/seed/clock";
import { useAppStore } from "@/lib/store/provider";
import { cn } from "@/lib/utils";

interface CartLine {
  sku: string;
  qty: number;
}

interface ProvisionalCustomer {
  name: string;
  phone: string;
  line1: string;
  city: string;
  state: string;
  postcode: string;
}

const SAMPLE_CHAT = `Salam, nak order lipidri omega 2 botol yg 60 biji tu. Boleh COD tak?
Hantar ke: Aina Rahman, 12 Jalan Demo 4/2, 47301 Petaling Jaya, Selangor.
No fon 012-000 0107. Bila boleh sampai?`;

const STEPS = ["Cart", "Customer & delivery", "Payment & review"] as const;

function NewOrderInner() {
  const repo = useRepo();
  const persona = useActivePersona();
  const products = useAppStore((s) => s.products);
  const customers = useAppStore((s) => s.customers);
  const brands = useAppStore((s) => s.brands);
  const stores = useAppStore((s) => s.stores);
  const orders = useAppStore((s) => s.orders);
  const personas = useAppStore((s) => s.personas);

  const [step, setStep] = useState(0);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [productQuery, setProductQuery] = useState("");
  const [storeId, setStoreId] = useState("ST-lip-wa");
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [provisional, setProvisional] = useState<ProvisionalCustomer>({
    name: "", phone: "", line1: "", city: "", state: "", postcode: "",
  });
  const [useProvisional, setUseProvisional] = useState(false);
  const [conversationRef, setConversationRef] = useState("");
  const [salespersonId, setSalespersonId] = useState(persona.id);
  const [payment, setPayment] = useState<"online" | "cod">("online");
  const [shipping, setShipping] = useState<"standard" | "express">("standard");
  const [chatText, setChatText] = useState("");
  const [extracted, setExtracted] = useState(false);
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [submittedDraft, setSubmittedDraft] = useState(false);

  const store = stores.find((s) => s.id === storeId)!;
  const brand = brands.find((b) => b.id === store.brandId)!;

  const variantLookup = useMemo(
    () =>
      products.flatMap((p) =>
        p.variants.map((v) => ({
          product: p,
          variant: v,
          atp: v.onHand - v.reserved,
          price: v.prices[0]!,
        })),
      ),
    [products],
  );

  const matches = useMemo(() => {
    const needle = productQuery.trim().toLowerCase();
    if (!needle) return [];
    return variantLookup
      .filter(({ product, variant }) =>
        [product.name, variant.sku, variant.name, ...variant.aliases].join(" ").toLowerCase().includes(needle),
      )
      .slice(0, 6);
  }, [productQuery, variantLookup]);

  const customerMatches = useMemo(() => {
    const needle = customerQuery.trim().toLowerCase();
    if (needle.length < 2) return [];
    return customers
      .filter((c) =>
        [c.displayName, ...c.identities.map((i) => i.value)].join(" ").toLowerCase().includes(needle),
      )
      .slice(0, 5);
  }, [customerQuery, customers]);

  const selectedCustomer = customers.find((c) => c.id === customerId) ?? null;

  const lines: (OrderItem & { atp: number })[] = cart.map((l) => {
    const entry = variantLookup.find((v) => v.variant.sku === l.sku)!;
    const unit = entry.price.amount;
    return {
      variantId: entry.variant.id,
      sku: l.sku,
      nameSnapshot: `${entry.product.name} — ${entry.variant.name}`,
      quantity: l.qty,
      unitPrice: unit,
      discount: 0,
      lineTotal: unit * l.qty,
      atp: entry.atp,
    };
  });

  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const shippingTotal = shipping === "express" ? 1600 : subtotal >= 15000 ? 0 : 900;
  const grandTotal = subtotal + shippingTotal;

  const warnings: string[] = [];
  if (payment === "cod" && brand.id === "BRD-lipidri" && grandTotal > 30000) {
    warnings.push("Brand rule: COD is allowed up to RM300 per order for Lipidri MY — this order exceeds the limit.");
  }
  if (payment === "cod" && brand.id === "BRD-verdana") {
    warnings.push("Brand rule: Verdana Botanics does not offer COD.");
  }
  for (const l of lines) {
    if (l.atp <= 0) warnings.push(`${l.sku} has no available-to-promise stock — the order will hold at fulfilment.`);
    else if (l.quantity > l.atp) warnings.push(`${l.sku}: only ${l.atp} available to promise, ${l.quantity} requested.`);
  }
  if (store.sourceType === "whatsapp") {
    warnings.push("Chat orders require payment verification before fulfilment (brand policy).");
  }

  const customerReady = useProvisional
    ? provisional.name.trim() !== "" && provisional.phone.trim() !== "" && provisional.line1.trim() !== ""
    : customerId !== null;

  function addSku(sku: string) {
    setCart((c) => {
      const existing = c.find((l) => l.sku === sku);
      if (existing) return c.map((l) => (l.sku === sku ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { sku, qty: 1 }];
    });
    setProductQuery("");
  }

  function extractFromChat() {
    // Canned extraction over the sample message — clearly labelled, never
    // creates an order by itself. Real implementation would call a guarded
    // server-side extraction endpoint.
    const text = chatText.toLowerCase();
    let found = false;
    if (text.includes("omega") || text.includes("lipidri")) {
      const qty = /2\s*(botol|bottle|unit)/.test(text) ? 2 : 1;
      setCart([{ sku: text.includes("120") ? "LPD-OM3-120" : "LPD-OM3-60", qty }]);
      found = true;
    }
    if (text.includes("aina")) {
      const aina = customers.find((c) => c.id === "CUS-0007");
      if (aina) {
        setCustomerId(aina.id);
        setUseProvisional(false);
        setCustomerQuery(aina.displayName);
      }
    } else if (found) {
      setUseProvisional(true);
    }
    if (text.includes("cod")) setPayment("cod");
    setStoreId("ST-lip-wa");
    setConversationRef("WA-CHAT-DEMO");
    setExtracted(found);
    if (found) {
      toast.info("Fields populated from chat", {
        description: "AI extraction — every field needs human review before submission.",
      });
    } else {
      toast.warning("Nothing recognisable extracted", {
        description: "Try the sample message, or fill the form manually.",
      });
    }
  }

  async function submit(asDraft: boolean) {
    const numericIds = orders.map((o) => Number(o.id.replace("ORD-", ""))).filter((n) => !Number.isNaN(n));
    const nextId = `ORD-${String(Math.max(...numericIds) + 1).padStart(4, "0")}`;
    const at = DEMO_NOW.toISOString();
    const customer = selectedCustomer;
    const order: Order = {
      id: nextId,
      workspaceId: "WS-effen",
      brandId: brand.id,
      storeId: store.id,
      legalEntityId: store.legalEntityId,
      customerId: customer?.id ?? "CUS-PROV",
      sourceType: store.sourceType,
      sourceOrderId: conversationRef || null,
      integrationId: null,
      campaignId: null,
      currency: store.currency,
      market: store.market,
      items: lines.map(({ atp: _atp, ...item }) => item),
      subtotal,
      discountTotal: 0,
      shippingTotal,
      taxTotal: 0,
      grandTotal,
      refundedTotal: 0,
      orderStatus: asDraft ? "draft" : "pending_review",
      paymentStatus: payment === "cod" ? "unpaid" : "pending_verification",
      fulfillmentStatus: "unfulfilled",
      shipmentStatus: "not_shipped",
      notificationStatus: "none",
      returnStatus: "none",
      exceptionStatus: "none",
      paymentMethod: payment === "cod" ? "cod" : "chip",
      courier: null,
      trackingNumber: null,
      ownerId: salespersonId,
      slaRisk: null,
      nextAction: asDraft ? "Complete details, then submit for review" : "Verify payment, then approve",
      placedAt: at,
      isNewCustomer: customer ? customer.lifetimeOrders === 0 : true,
      isDraft: asDraft,
    };
    const events: OrderStateEvent[] = [
      {
        id: `EVT-N-${nextId}-1`,
        orderId: nextId,
        at,
        actorType: "user",
        actorName: persona.name,
        dimension: "order",
        fromState: null,
        toState: asDraft ? "draft" : "pending_review",
        reasonCode: null,
        message: asDraft
          ? `Draft created from the order form by ${persona.name}.`
          : `Order submitted for review by ${persona.name}${useProvisional ? " with a provisional customer" : ""}.`,
      },
    ];
    if (useProvisional) {
      events.push({
        id: `EVT-N-${nextId}-2`,
        orderId: nextId,
        at,
        actorType: "system",
        actorName: "Identity resolution",
        dimension: "system",
        fromState: null,
        toState: null,
        reasonCode: "PROVISIONAL_CUSTOMER",
        message: `Provisional customer "${provisional.name}" (${provisional.phone}) — will merge when identity resolves.`,
      });
    }
    await repo.submitDraftOrder(order, events);
    setSubmittedId(nextId);
    setSubmittedDraft(asDraft);
  }

  /* ---------- success receipt ---------- */
  if (submittedId) {
    return (
      <PageBody className="max-w-xl">
        <Card>
          <CardContent className="flex flex-col items-center py-10 text-center">
            <CheckCircle2 className="mb-3 size-10 text-success" aria-hidden />
            <h1 className="text-lg font-semibold">
              {submittedDraft ? "Draft saved" : "Submitted for review"}
            </h1>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              {submittedId} · {formatMoney(grandTotal, store.currency)} ·{" "}
              {useProvisional ? provisional.name : selectedCustomer?.displayName} ·{" "}
              {payment === "cod" ? "COD" : "online payment pending verification"}
            </p>
            <p className="mt-3 max-w-sm text-xs text-muted-foreground">
              {submittedDraft
                ? "The draft sits in the Orders list until it is completed and submitted."
                : "Review happens in the Orders queue. Payment must verify before fulfilment (brand policy)."}
            </p>
            <div className="mt-5 flex gap-2">
              <Button asChild>
                <Link href={`/orders/${submittedId}`}>Open {submittedId}</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/orders">Orders list</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </PageBody>
    );
  }

  return (
    <PageBody className="max-w-5xl">
      <PageHeader title="New order" description="Three steps: cart, customer & delivery, payment & review. Nothing ships until review approves it.">
        <Button asChild variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
          <Link href="/orders"><ArrowLeft className="size-3.5" aria-hidden /> Back</Link>
        </Button>
      </PageHeader>

      {/* stepper */}
      <ol className="flex items-center gap-2" aria-label="Order steps">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
            <span
              className={cn(
                "flex size-6 items-center justify-center rounded-full text-xs font-medium",
                i < step ? "bg-success text-success-foreground" : i === step ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              {i + 1}
            </span>
            <span className={cn("text-sm", i === step ? "font-medium" : "text-muted-foreground")}>{label}</span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-8 bg-border" aria-hidden />}
          </li>
        ))}
      </ol>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          {/* ---------- step 1: cart ---------- */}
          {step === 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Cart</CardTitle>
                <p className="text-xs text-muted-foreground">Search by product, variant, SKU, or alias. Prices come from the effective price list.</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" aria-hidden />
                  <Input
                    value={productQuery}
                    onChange={(e) => setProductQuery(e.target.value)}
                    placeholder='Try "omega", "LPD-OM3-60", or "serum"'
                    className="pl-8"
                    aria-label="Search products"
                  />
                  {matches.length > 0 && (
                    <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
                      {matches.map(({ product, variant, atp, price }) => (
                        <li key={variant.id}>
                          <button
                            type="button"
                            className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                            onClick={() => addSku(variant.sku)}
                          >
                            <span className="min-w-0 flex-1">
                              <span className="block truncate">{product.name} — {variant.name}</span>
                              <span className="tnum text-xs text-muted-foreground">{variant.sku}</span>
                            </span>
                            <span className={cn("tnum text-xs", atp <= 0 ? "text-destructive" : atp < 40 ? "text-warning" : "text-muted-foreground")}>
                              ATP {atp}
                            </span>
                            <span className="tnum text-sm">{formatMoney(price.amount, price.currency)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {lines.length === 0 ? (
                  <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                    Cart is empty — search above or paste a chat order on the right.
                  </p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {lines.map((l) => (
                      <li key={l.sku} className="flex items-center gap-3 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm">{l.nameSnapshot}</div>
                          <div className="tnum text-xs text-muted-foreground">
                            {l.sku} · ATP {l.atp}
                            {l.quantity > l.atp && <span className="text-warning"> — exceeds stock</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button variant="outline" size="icon" className="size-6" aria-label={`Decrease ${l.sku}`}
                            onClick={() => setCart((c) => c.map((x) => x.sku === l.sku ? { ...x, qty: Math.max(1, x.qty - 1) } : x))}>
                            <Minus className="size-3" />
                          </Button>
                          <span className="tnum w-6 text-center text-sm">{l.quantity}</span>
                          <Button variant="outline" size="icon" className="size-6" aria-label={`Increase ${l.sku}`}
                            onClick={() => setCart((c) => c.map((x) => x.sku === l.sku ? { ...x, qty: x.qty + 1 } : x))}>
                            <Plus className="size-3" />
                          </Button>
                        </div>
                        <MoneyCell minor={l.lineTotal} currency={store.currency} className="w-20 text-right text-sm" />
                        <Button variant="ghost" size="icon" className="size-6 text-muted-foreground" aria-label={`Remove ${l.sku}`}
                          onClick={() => setCart((c) => c.filter((x) => x.sku !== l.sku))}>
                          <Trash2 className="size-3.5" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="space-y-1.5">
                  <Label htmlFor="store">Brand / store</Label>
                  <Select value={storeId} onValueChange={setStoreId}>
                    <SelectTrigger id="store"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {stores.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {brands.find((b) => b.id === s.brandId)?.name.replace(" (Demo)", "")} — {s.name} ({s.currency})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ---------- step 2: customer ---------- */}
          {step === 1 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Customer & delivery</CardTitle>
                <p className="text-xs text-muted-foreground">Find an existing customer by phone or email, or create a provisional one — identity resolution merges later.</p>
              </CardHeader>
              <CardContent className="space-y-4">
                {!useProvisional ? (
                  <div className="space-y-3">
                    <div className="relative">
                      <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" aria-hidden />
                      <Input
                        value={customerQuery}
                        onChange={(e) => { setCustomerQuery(e.target.value); setCustomerId(null); }}
                        placeholder='Search name, phone, or email — try "Aina" or "012-000 0107"'
                        className="pl-8"
                        aria-label="Search customers"
                      />
                      {customerMatches.length > 0 && !customerId && (
                        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border bg-popover shadow-md">
                          {customerMatches.map((c) => (
                            <li key={c.id}>
                              <button
                                type="button"
                                className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                                onClick={() => { setCustomerId(c.id); setCustomerQuery(c.displayName); }}
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="block">{c.displayName}</span>
                                  <span className="tnum text-xs text-muted-foreground">
                                    {c.identities.find((i) => i.type === "phone")?.value} · {c.lifetimeOrders} orders
                                  </span>
                                </span>
                                <Badge variant="outline" className="capitalize">{c.repeatState.replace("_", " ")}</Badge>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    {selectedCustomer && (
                      <div className="rounded-md border bg-muted/40 px-3 py-2.5 text-sm">
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{selectedCustomer.displayName}</span>
                          <Link href={`/customers/${selectedCustomer.id}`} className="text-xs text-info underline-offset-2 hover:underline">
                            Customer 360
                          </Link>
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {selectedCustomer.addresses.find((a) => a.isDefault)?.line1},{" "}
                          {selectedCustomer.addresses.find((a) => a.isDefault)?.postcode}{" "}
                          {selectedCustomer.addresses.find((a) => a.isDefault)?.city} ·{" "}
                          {selectedCustomer.lifetimeOrders} lifetime orders
                        </div>
                      </div>
                    )}
                    <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setUseProvisional(true)}>
                      Customer not found? Create a provisional customer
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="border-info/30 bg-info/10 text-info">Provisional customer</Badge>
                      <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setUseProvisional(false)}>
                        Search existing instead
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="pname">Full name</Label>
                        <Input id="pname" value={provisional.name} onChange={(e) => setProvisional({ ...provisional, name: e.target.value })} placeholder="e.g. Sample Customer" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="pphone">Phone</Label>
                        <Input id="pphone" value={provisional.phone} onChange={(e) => setProvisional({ ...provisional, phone: e.target.value })} placeholder="+60 12-000 0000" />
                      </div>
                      <div className="col-span-2 space-y-1.5">
                        <Label htmlFor="pline1">Address line</Label>
                        <Input id="pline1" value={provisional.line1} onChange={(e) => setProvisional({ ...provisional, line1: e.target.value })} placeholder="Street address" />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="pcity">City</Label>
                        <Input id="pcity" value={provisional.city} onChange={(e) => setProvisional({ ...provisional, city: e.target.value })} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="ppost">Postcode</Label>
                        <Input id="ppost" value={provisional.postcode} onChange={(e) => setProvisional({ ...provisional, postcode: e.target.value })} />
                      </div>
                    </div>
                  </div>
                )}

                <Separator />
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="conv">Source conversation (optional)</Label>
                    <Input id="conv" value={conversationRef} onChange={(e) => setConversationRef(e.target.value)} placeholder="e.g. WA-CHAT-8812" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="sales">Salesperson</Label>
                    <Select value={salespersonId} onValueChange={setSalespersonId}>
                      <SelectTrigger id="sales"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {personas.map((p) => (
                          <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ---------- step 3: payment & review ---------- */}
          {step === 2 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">Payment & review</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Payment</Label>
                    <RadioGroup value={payment} onValueChange={(v) => setPayment(v as "online" | "cod")} className="gap-2">
                      <label className="flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 text-sm has-[[data-state=checked]]:border-ring">
                        <RadioGroupItem value="online" id="pay-online" className="mt-0.5" />
                        <span>
                          <span className="block font-medium">Verified online payment</span>
                          <span className="text-xs text-muted-foreground">Chip payment link — order approves after verification</span>
                        </span>
                      </label>
                      <label className="flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 text-sm has-[[data-state=checked]]:border-ring">
                        <RadioGroupItem value="cod" id="pay-cod" className="mt-0.5" />
                        <span>
                          <span className="block font-medium">Cash on delivery</span>
                          <span className="text-xs text-muted-foreground">Courier collects — subject to brand COD limits</span>
                        </span>
                      </label>
                    </RadioGroup>
                  </div>
                  <div className="space-y-2">
                    <Label>Shipping</Label>
                    <RadioGroup value={shipping} onValueChange={(v) => setShipping(v as "standard" | "express")} className="gap-2">
                      <label className="flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 text-sm has-[[data-state=checked]]:border-ring">
                        <RadioGroupItem value="standard" id="ship-std" className="mt-0.5" />
                        <span>
                          <span className="block font-medium">Standard (2–4 days)</span>
                          <span className="tnum text-xs text-muted-foreground">{subtotal >= 15000 ? "Free above RM150" : "RM9.00"}</span>
                        </span>
                      </label>
                      <label className="flex cursor-pointer items-start gap-2.5 rounded-md border p-2.5 text-sm has-[[data-state=checked]]:border-ring">
                        <RadioGroupItem value="express" id="ship-exp" className="mt-0.5" />
                        <span>
                          <span className="block font-medium">Express (next day, Klang Valley)</span>
                          <span className="tnum text-xs text-muted-foreground">RM16.00</span>
                        </span>
                      </label>
                    </RadioGroup>
                  </div>
                </div>

                {warnings.length > 0 && (
                  <div className="space-y-1.5 rounded-md border border-warning/25 bg-warning/10 p-3">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-warning">
                      <TriangleAlert className="size-3.5" aria-hidden /> Policy warnings
                    </div>
                    <ul className="list-inside list-disc space-y-0.5 text-xs text-warning">
                      {warnings.map((w) => (<li key={w}>{w}</li>))}
                    </ul>
                  </div>
                )}

                <div className="rounded-md border p-3 text-sm">
                  <div className="mb-2 text-xs font-medium text-muted-foreground">Review</div>
                  <div className="space-y-1">
                    <div className="flex justify-between"><span className="text-muted-foreground">Customer</span><span>{useProvisional ? `${provisional.name} (provisional)` : selectedCustomer?.displayName ?? "—"}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Store</span><span>{store.name}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Items</span><span className="tnum">{lines.reduce((s, l) => s + l.quantity, 0)} units · {lines.length} lines</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><MoneyCell minor={subtotal} currency={store.currency} /></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Shipping</span><MoneyCell minor={shippingTotal} currency={store.currency} /></div>
                    <Separator className="my-1.5" />
                    <div className="flex justify-between font-medium"><span>Total</span><MoneyCell minor={grandTotal} currency={store.currency} /></div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* nav buttons */}
          <div className="flex justify-between">
            <Button variant="outline" size="sm" disabled={step === 0} onClick={() => setStep((s) => s - 1)} className="gap-1.5">
              <ArrowLeft className="size-3.5" aria-hidden /> Back
            </Button>
            {step < 2 ? (
              <Button
                size="sm"
                className="gap-1.5"
                disabled={step === 0 ? lines.length === 0 : !customerReady}
                onClick={() => setStep((s) => s + 1)}
              >
                Continue <ArrowRight className="size-3.5" aria-hidden />
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => submit(true)}>Save draft</Button>
                <Button size="sm" disabled={lines.length === 0 || !customerReady} onClick={() => submit(false)}>
                  Submit for review
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* ---------- paste chat order ---------- */}
        <div className="space-y-3">
          <Card className="border-ai/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
                <MessageSquareText className="size-4 text-ai" aria-hidden />
                Paste chat order
              </CardTitle>
              <Badge variant="outline" className="w-fit border-ai/30 bg-ai/10 text-[10px] text-ai">
                <Sparkles className="size-3" aria-hidden /> AI extraction — review required
              </Badge>
            </CardHeader>
            <CardContent className="space-y-2.5">
              <Textarea
                value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                rows={6}
                placeholder="Paste a WhatsApp message here…"
                aria-label="Chat message to extract"
              />
              <div className="flex gap-2">
                <Button variant="outline" size="sm" className="flex-1 text-xs" onClick={() => setChatText(SAMPLE_CHAT)}>
                  Load sample message
                </Button>
                <Button size="sm" className="flex-1 gap-1 text-xs" disabled={!chatText.trim()} onClick={extractFromChat}>
                  <Sparkles className="size-3" aria-hidden /> Extract fields
                </Button>
              </div>
              <p className="text-[11px] leading-snug text-muted-foreground">
                Extraction only fills the form fields on the left. Nothing is created until a human
                reviews every field and submits. Confidence-flagged fields stay editable.
              </p>
              {extracted && (
                <div className="rounded-md border border-ai/25 bg-ai/5 px-2.5 py-2 text-xs">
                  <div className="mb-1 font-medium text-ai">Extracted (review each)</div>
                  <ul className="space-y-0.5 text-muted-foreground">
                    <li>Items: {cart.map((c) => `${c.qty}× ${c.sku}`).join(", ") || "—"} <span className="text-ai">(0.91)</span></li>
                    <li>Customer: {selectedCustomer ? `matched ${selectedCustomer.displayName}` : "provisional"} <span className="text-ai">({selectedCustomer ? "0.88" : "0.55"})</span></li>
                    <li>Payment: {payment === "cod" ? "COD requested" : "not stated"} <span className="text-ai">(0.83)</span></li>
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </PageBody>
  );
}

export default function NewOrderPage() {
  return (
    <RouteGuard permission="orders.create">
      <NewOrderInner />
    </RouteGuard>
  );
}
