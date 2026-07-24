import type {
  Order,
  OrderItem,
  OrderStateEvent,
} from "@/lib/domain/types";
import type { SourceType } from "@/lib/domain/enums";
import { DEMO_NOW, daysAgo, hoursAgo } from "../clock";
import { intBetween, mulberry32, pickWeighted } from "../prng";
import { CUSTOMERS } from "./customers";
import { VARIANT_BY_SKU } from "./catalog";
import { STORES } from "./org";

/**
 * ~930 generated orders over 35 days + hand-authored hero orders.
 * All daily actuals (Command Centre, Reports, Prophit) are derived from
 * these orders, so aggregate numbers agree with the order table by
 * construction. Seeded drivers of yesterday's contribution miss:
 *  - Shopee source stale → no Shopee orders in the last ~26h
 *  - VER-TON-100 stocked out → Verdana volume down for ~12 days
 *  - Meta CPM spike lives in campaigns.ts (spend up, revenue flat)
 */

const rng = mulberry32(0x0bde5);

const GENERATOR_START_ID = 200;

/** Hero order numbers the generator must skip. */
const RESERVED = new Set([
  1042, 1036, 1029, 1011, 998, 987, // stalled Ninja Van shipments (6)
  1101, 1096, // payment exceptions
  1104, 1100, // notification failures
  1107, // address issue
  1095, // automation failure
  1063, 955, 870, 820, // returns
  1110, // recent draft
]);

const oid = (n: number) => `ORD-${String(n).padStart(4, "0")}`;

/* ---------- store daily volume model ---------- */

const STORE_SKUS: Record<string, string[]> = {
  "ST-lip-woo": ["LPD-OM3-60", "LPD-OM3-120", "LPD-KRL-30", "LPD-KRL-60", "LPD-D3K-60", "LPD-BND-DUO"],
  "ST-lip-shopee": ["LPD-OM3-60", "LPD-OM3-120", "LPD-D3K-60"],
  "ST-lip-tiktok": ["LPD-OM3-60", "LPD-D3K-60"],
  "ST-lip-wa": ["LPD-OM3-60", "LPD-OM3-120", "LPD-KRL-30", "LPD-KRL-60", "LPD-D3K-60"],
  "ST-ver-woo": ["VER-TON-100", "VER-SER-30", "VER-SER-50", "VER-CLE-150"],
  "ST-ver-lazada": ["VER-TON-100", "VER-SER-30", "VER-CLE-150"],
  "ST-nara-woo": ["NARA-DRP-10", "NARA-DRP-30", "NARA-BN-250", "NARA-CB-6"],
  "ST-sol-woo": ["SOL-DIF-01", "SOL-CAN-200", "SOL-CAN-400"],
};

function dailyVolume(storeId: string, d: number): number {
  const base: Record<string, number> = {
    "ST-lip-woo": 7,
    "ST-lip-shopee": 3,
    "ST-lip-tiktok": 2,
    "ST-lip-wa": 2,
    "ST-ver-woo": 4,
    "ST-ver-lazada": 2,
    "ST-nara-woo": 3.5,
    "ST-sol-woo": 2.5,
  };
  let v = base[storeId] ?? 0;
  if (storeId === "ST-lip-shopee" && d <= 1) v = 0; // token expired — orders missing
  if (storeId.startsWith("ST-ver") && d <= 11) v *= 0.7; // toner stockout drag
  if (d === 0) v *= 0.4; // partial day: the demo clock is 09:00
  const trend = 0.96 + (0.08 * (34 - d)) / 34;
  const noise = 0.75 + rng() * 0.5;
  return Math.round(v * trend * noise);
}

const CAMPAIGN_POOL: Record<string, [string, number][]> = {
  "BRD-lipidri": [
    ["CMP-0003", 4],
    ["CMP-0001", 3],
    ["CMP-0002", 1.5],
    ["CMP-0004", 1],
  ],
  "BRD-verdana": [
    ["CMP-0005", 2],
    ["CMP-0006", 2],
  ],
  "BRD-nara": [["CMP-0007", 1]],
};

/* ---------- item + money helpers ---------- */

function buildItems(storeId: string, d: number): OrderItem[] {
  let skus = STORE_SKUS[storeId]!;
  if (d <= 11) skus = skus.filter((s) => s !== "VER-TON-100"); // stocked out
  const lineCount = pickWeighted(rng, [
    [1, 6],
    [2, 3],
    [3, 1],
  ]);
  const chosen = new Set<string>();
  const items: OrderItem[] = [];
  for (let i = 0; i < lineCount; i++) {
    const sku = skus[intBetween(rng, 0, skus.length - 1)]!;
    if (chosen.has(sku)) continue;
    chosen.add(sku);
    const entry = VARIANT_BY_SKU[sku]!;
    const qty = pickWeighted(rng, [
      [1, 7],
      [2, 2.5],
      [3, 0.5],
    ]);
    const unit = entry.variant.prices[0]!.amount;
    const discount = rng() < 0.18 ? Math.round(unit * qty * 0.1) : 0;
    items.push({
      variantId: entry.variant.id,
      sku,
      nameSnapshot: `${entry.product.name} — ${entry.variant.name}`,
      quantity: qty,
      unitPrice: unit,
      discount,
      lineTotal: unit * qty - discount,
    });
  }
  return items;
}

function moneyFor(items: OrderItem[], market: "MY" | "SG") {
  const subtotal = items.reduce((s, it) => s + it.unitPrice * it.quantity, 0);
  const discountTotal = items.reduce((s, it) => s + it.discount, 0);
  const net = subtotal - discountTotal;
  const freeShipAt = market === "SG" ? 8000 : 15000;
  const shippingTotal = net >= freeShipAt ? 0 : market === "SG" ? 500 : 900;
  return { subtotal, discountTotal, shippingTotal, taxTotal: 0, grandTotal: net + shippingTotal };
}

function paymentMethodFor(sourceType: SourceType, brandId: string): Order["paymentMethod"] {
  if (sourceType === "shopee" || sourceType === "lazada" || sourceType === "tiktok_shop") return "marketplace";
  if (sourceType === "whatsapp") return rng() < 0.55 ? "cod" : "chip";
  return brandId === "BRD-verdana" || brandId === "BRD-solstice" ? "stripe" : "chip";
}

/* ---------- state model by age ---------- */

function statesForAge(order: Order, ageDays: number) {
  const cod = order.paymentMethod === "cod";
  if (ageDays >= 6) {
    const roll = rng();
    if (roll < 0.03) {
      order.orderStatus = "cancelled";
      order.paymentStatus = cod ? "unpaid" : "refunded";
      order.fulfillmentStatus = "unfulfilled";
      order.shipmentStatus = "not_shipped";
      order.notificationStatus = "delivered";
      return;
    }
    order.orderStatus = "completed";
    order.paymentStatus = cod ? "cod_collected" : "paid";
    order.fulfillmentStatus = "fulfilled";
    order.shipmentStatus = "delivered";
    order.notificationStatus = "delivered";
    return;
  }
  if (ageDays >= 3) {
    order.orderStatus = "approved";
    order.paymentStatus = cod ? "cod_pending" : "paid";
    order.fulfillmentStatus = "fulfilled";
    order.shipmentStatus = rng() < 0.6 ? "delivered" : "in_transit";
    if (order.shipmentStatus === "delivered") {
      order.orderStatus = "completed";
      if (cod) order.paymentStatus = "cod_collected";
    }
    order.notificationStatus = "delivered";
    return;
  }
  if (ageDays >= 1) {
    order.orderStatus = "approved";
    order.paymentStatus = cod ? "cod_pending" : "paid";
    order.fulfillmentStatus = pickWeighted(rng, [
      ["packed", 4],
      ["handed_over", 4],
      ["picking", 2],
    ]);
    order.shipmentStatus =
      order.fulfillmentStatus === "handed_over"
        ? pickWeighted(rng, [
            ["in_transit", 6],
            ["out_for_delivery", 2],
            ["label_created", 2],
          ])
        : "not_shipped";
    order.notificationStatus = "sent";
    return;
  }
  // < 24h
  order.orderStatus = pickWeighted(rng, [
    ["approved", 6],
    ["pending_review", 3],
  ]);
  order.paymentStatus =
    order.orderStatus === "pending_review"
      ? cod
        ? "unpaid"
        : "pending_verification"
      : cod
        ? "cod_pending"
        : "paid";
  order.fulfillmentStatus = order.orderStatus === "approved" ? pickWeighted(rng, [["unfulfilled", 4], ["picking", 4], ["packed", 2]]) : "unfulfilled";
  order.shipmentStatus = "not_shipped";
  order.notificationStatus = order.orderStatus === "approved" ? "sent" : "queued";
}

/* ---------- event synthesis ---------- */

const events: OrderStateEvent[] = [];
let evtSeq = 0;

function ev(
  order: Order,
  atIso: string,
  actorType: OrderStateEvent["actorType"],
  actorName: string,
  dimension: OrderStateEvent["dimension"],
  toState: string | null,
  message: string,
  reasonCode: string | null = null,
  fromState: string | null = null,
) {
  events.push({
    id: `EVT-${String(++evtSeq).padStart(5, "0")}`,
    orderId: order.id,
    at: atIso,
    actorType,
    actorName,
    dimension,
    fromState,
    toState,
    reasonCode,
    message,
  });
}

const SOURCE_CONNECTOR: Record<string, string> = {
  woocommerce: "WooCommerce connector",
  shopee: "Shopee connector",
  lazada: "Lazada connector",
  tiktok_shop: "TikTok Shop connector",
  whatsapp: "WhatsApp intake",
  fighter: "Fighter connector",
  manual: "Manual entry",
};

function baselineEvents(order: Order, ageDays: number, full: boolean) {
  const placed = new Date(order.placedAt).getTime();
  const h = (offsetH: number) => new Date(placed + offsetH * 3_600_000).toISOString();
  const connector = SOURCE_CONNECTOR[order.sourceType] ?? "Connector";
  ev(order, order.placedAt, "connector", connector, "order", "draft", `Order received from ${connector.replace(" connector", "")} (${order.sourceOrderId ?? order.id}).`);
  if (order.orderStatus === "cancelled") {
    ev(order, h(2), "user", "Ida", "order", "cancelled", "Cancelled on customer request before fulfilment.", "CUSTOMER_REQUEST", "pending_review");
    return;
  }
  if (!full) {
    if (order.paymentStatus === "paid" || order.paymentStatus === "cod_collected")
      ev(order, h(0.2), "connector", "Payment gateway", "payment", order.paymentStatus === "paid" ? "paid" : "cod_collected", "Payment confirmed.");
    if (order.shipmentStatus === "delivered")
      ev(order, h(ageDays >= 6 ? 70 : 48), "courier", order.courier === "jnt" ? "J&T" : "Ninja Van", "shipment", "delivered", "Parcel delivered.");
    return;
  }
  if (order.paymentStatus !== "unpaid" && order.paymentStatus !== "pending_verification") {
    ev(order, h(0.2), "connector", "Payment gateway", "payment", order.paymentMethod === "cod" ? "cod_pending" : "paid", order.paymentMethod === "cod" ? "COD terms accepted at checkout." : "Payment captured by gateway.");
  }
  if (order.orderStatus === "approved" || order.orderStatus === "completed") {
    ev(order, h(0.4), "rule", "Auto-approval rule R-12", "order", "approved", "Passed fraud, duplicate, and stock checks — auto-approved.", "AUTO_APPROVED", "pending_review");
  }
  if (["packed", "handed_over", "fulfilled"].includes(order.fulfillmentStatus)) {
    ev(order, h(5), "user", "Jun Wei (Demo)", "fulfillment", "packed", "Picked and packed at KL fulfilment centre.");
  }
  if (order.fulfillmentStatus === "handed_over" || order.fulfillmentStatus === "fulfilled") {
    const courier = order.courier === "jnt" ? "J&T" : "Ninja Van";
    ev(order, h(8), "courier", courier, "shipment", "label_created", `AWB ${order.trackingNumber} created.`);
    if (order.shipmentStatus !== "label_created" && order.shipmentStatus !== "not_shipped") {
      ev(order, h(12), "courier", courier, "shipment", "in_transit", "Picked up — arrived at origin hub.");
    }
    if (order.shipmentStatus === "out_for_delivery") {
      ev(order, h(30), "courier", courier, "shipment", "out_for_delivery", "Out for delivery.");
    }
    if (order.shipmentStatus === "delivered") {
      ev(order, h(46), "courier", courier, "shipment", "delivered", "Parcel delivered — POD captured.");
    }
  }
  if (order.notificationStatus === "sent" || order.notificationStatus === "delivered") {
    ev(order, h(0.6), "system", "Notification service", "notification", "sent", "Order confirmation sent via WhatsApp template.");
    if (order.notificationStatus === "delivered") {
      ev(order, h(0.7), "system", "Notification service", "notification", "delivered", "WhatsApp delivery receipt received.");
    }
  }
}

/* ---------- customer picking ---------- */

const brandPools: Record<string, string[]> = {};
const firstOrderSeen = new Set<string>();
const tailCustomers = CUSTOMERS.filter((c) => !c.id.startsWith("CUS-000"));

function pickCustomer(brandId: string, market: "MY" | "SG"): string {
  const pool = (brandPools[brandId] ??= []);
  if (pool.length > 8 && rng() < 0.55) {
    return pool[intBetween(rng, 0, pool.length - 1)]!;
  }
  const marketPool = tailCustomers.filter((c) => c.primaryMarket === market);
  const cust = marketPool[intBetween(rng, 0, marketPool.length - 1)]!;
  pool.push(cust.id);
  return cust.id;
}

/* ---------- generation loop ---------- */

const orders: Order[] = [];
let counter = GENERATOR_START_ID;

function nextId(): string {
  while (RESERVED.has(counter)) counter++;
  return oid(counter++);
}

for (let d = 34; d >= 0; d--) {
  for (const store of STORES) {
    const n = dailyVolume(store.id, d);
    for (let k = 0; k < n; k++) {
      const items = buildItems(store.id, d);
      if (items.length === 0) continue;
      const money = moneyFor(items, store.market);
      // Today's orders land before the 09:00 demo clock; other days spread 9am–10pm.
      const hour = d === 0 ? intBetween(rng, 0, 8) : intBetween(rng, 9, 22);
      const placedAt = daysAgo(d, hour);
      if (new Date(placedAt).getTime() > DEMO_NOW.getTime()) continue;
      const customerId = pickCustomer(store.brandId, store.market);
      const pm = paymentMethodFor(store.sourceType, store.brandId);
      const order: Order = {
        id: nextId(),
        workspaceId: "WS-effen",
        brandId: store.brandId,
        storeId: store.id,
        legalEntityId: store.legalEntityId,
        customerId,
        sourceType: store.sourceType,
        sourceOrderId:
          store.sourceType === "woocommerce"
            ? `#W${intBetween(rng, 20000, 49999)}`
            : store.sourceType === "shopee"
              ? `SP${intBetween(rng, 100000, 999999)}D`
              : store.sourceType === "lazada"
                ? `LZ${intBetween(rng, 100000, 999999)}`
                : store.sourceType === "tiktok_shop"
                  ? `TT${intBetween(rng, 100000, 999999)}`
                  : null,
        integrationId:
          store.sourceType === "woocommerce"
            ? "INT-woo"
            : store.sourceType === "shopee"
              ? "INT-shopee"
              : store.sourceType === "lazada"
                ? "INT-lazada"
                : store.sourceType === "tiktok_shop"
                  ? "INT-tiktok"
                  : null,
        campaignId:
          store.channelType === "website" && CAMPAIGN_POOL[store.brandId] && rng() < 0.6
            ? pickWeighted(rng, CAMPAIGN_POOL[store.brandId]!)
            : store.sourceType === "shopee" && rng() < 0.3
              ? "CMP-0008"
              : null,
        currency: store.currency,
        market: store.market,
        items,
        ...money,
        refundedTotal: 0,
        orderStatus: "approved",
        paymentStatus: "paid",
        fulfillmentStatus: "unfulfilled",
        shipmentStatus: "not_shipped",
        notificationStatus: "none",
        returnStatus: "none",
        exceptionStatus: "none",
        paymentMethod: pm,
        courier: null,
        trackingNumber: null,
        ownerId: null,
        slaRisk: null,
        nextAction: null,
        placedAt,
        isNewCustomer: !firstOrderSeen.has(customerId),
        isDraft: false,
      };
      firstOrderSeen.add(customerId);
      statesForAge(order, d);
      if (order.fulfillmentStatus !== "unfulfilled" && order.fulfillmentStatus !== "picking") {
        order.courier = store.market === "SG" ? "ninja_van" : rng() < 0.7 ? "ninja_van" : "jnt";
        order.trackingNumber = `${order.courier === "jnt" ? "JT" : "NV"}MY${intBetween(rng, 10000000, 99999999)}`;
      }
      if (order.orderStatus === "pending_review") {
        order.ownerId = "USR-ida";
        order.nextAction = order.paymentStatus === "pending_verification" ? "Verify payment reference" : "Review and approve";
      }
      if (order.orderStatus === "cancelled" && !order.refundedTotal && order.paymentStatus === "refunded") {
        order.refundedTotal = order.grandTotal;
      }
      orders.push(order);
      baselineEvents(order, d, d <= 6);
    }
  }
}

/* ---------- hero orders ---------- */

function hero(partial: Partial<Order> & Pick<Order, "id" | "storeId" | "customerId" | "items" | "placedAt">): Order {
  const store = STORES.find((s) => s.id === partial.storeId)!;
  const money = moneyFor(partial.items, store.market);
  const base: Order = {
    workspaceId: "WS-effen",
    brandId: store.brandId,
    legalEntityId: store.legalEntityId,
    sourceType: store.sourceType,
    sourceOrderId: null,
    integrationId: store.sourceType === "woocommerce" ? "INT-woo" : null,
    campaignId: null,
    currency: store.currency,
    market: store.market,
    ...money,
    refundedTotal: 0,
    orderStatus: "approved",
    paymentStatus: "paid",
    fulfillmentStatus: "fulfilled",
    shipmentStatus: "in_transit",
    notificationStatus: "delivered",
    returnStatus: "none",
    exceptionStatus: "none",
    paymentMethod: "chip",
    courier: "ninja_van",
    trackingNumber: null,
    ownerId: null,
    slaRisk: null,
    nextAction: null,
    isNewCustomer: false,
    isDraft: false,
    ...partial,
  } as Order;
  return base;
}

const item = (sku: string, qty: number, discount = 0): OrderItem => {
  const entry = VARIANT_BY_SKU[sku]!;
  const unit = entry.variant.prices[0]!.amount;
  return {
    variantId: entry.variant.id,
    sku,
    nameSnapshot: `${entry.product.name} — ${entry.variant.name}`,
    quantity: qty,
    unitPrice: unit,
    discount,
    lineTotal: unit * qty - discount,
  };
};

const HEROES: Order[] = [];

/** ORD-1042 — the golden thread. RM 214.00: 2× LPD-OM3-60 (RM99) + RM16 shipping (East MY surcharge). */
const ord1042 = hero({
  id: "ORD-1042",
  storeId: "ST-lip-wa",
  customerId: "CUS-0007",
  items: [item("LPD-OM3-60", 2)],
  placedAt: hoursAgo(67),
  sourceOrderId: "WA-CHAT-8812",
  campaignId: "CMP-0003",
  paymentMethod: "chip",
  courier: "ninja_van",
  trackingNumber: "NVMY55231042",
  orderStatus: "approved",
  paymentStatus: "paid",
  fulfillmentStatus: "handed_over",
  shipmentStatus: "in_transit",
  notificationStatus: "delivered",
  returnStatus: "none",
  exceptionStatus: "shipment_exception",
  ownerId: "USR-ida",
  slaRisk: "high",
  nextAction: "Escalate with Ninja Van — no movement for 52h",
});
ord1042.shippingTotal = 1600;
ord1042.grandTotal = ord1042.subtotal - ord1042.discountTotal + ord1042.shippingTotal;
HEROES.push(ord1042);

/** Five more stalled Ninja Van shipments (same webhook-gap incident). */
const stalledSpec: [number, string, string, string, number][] = [
  [1036, "ST-lip-woo", "CUS-0104", "LPD-OM3-120", 70],
  [1029, "ST-ver-woo", "CUS-0117", "VER-SER-30", 74],
  [1011, "ST-lip-woo", "CUS-0131", "LPD-D3K-60", 78],
  [998, "ST-nara-woo", "CUS-0142", "NARA-DRP-30", 82],
  [987, "ST-lip-woo", "CUS-0156", "LPD-KRL-30", 86],
];
for (const [n, storeId, customerId, sku, hoursOld] of stalledSpec) {
  HEROES.push(
    hero({
      id: oid(n),
      storeId,
      customerId,
      items: [item(sku, 1)],
      placedAt: hoursAgo(hoursOld),
      trackingNumber: `NVMY552310${n % 100}`,
      fulfillmentStatus: "handed_over",
      shipmentStatus: "in_transit",
      exceptionStatus: "shipment_exception",
      ownerId: "USR-jun",
      slaRisk: "medium",
      nextAction: "Escalate with Ninja Van — no movement >48h",
      paymentMethod: storeId === "ST-ver-woo" ? "stripe" : "chip",
    }),
  );
}

/** Payment exceptions. */
HEROES.push(
  hero({
    id: "ORD-1101",
    storeId: "ST-ver-woo",
    customerId: "CUS-0121",
    items: [item("VER-SER-50", 1), item("VER-CLE-150", 1)],
    placedAt: hoursAgo(14),
    paymentMethod: "stripe",
    orderStatus: "pending_review",
    paymentStatus: "failed",
    fulfillmentStatus: "unfulfilled",
    shipmentStatus: "not_shipped",
    notificationStatus: "sent",
    exceptionStatus: "payment_exception",
    courier: null,
    trackingNumber: null,
    ownerId: "USR-ida",
    slaRisk: "high",
    nextAction: "Contact customer — card declined twice",
  }),
  hero({
    id: "ORD-1096",
    storeId: "ST-lip-wa",
    customerId: "CUS-0138",
    items: [item("LPD-KRL-60", 1)],
    placedAt: hoursAgo(19),
    paymentMethod: "chip",
    orderStatus: "pending_review",
    paymentStatus: "pending_verification",
    fulfillmentStatus: "unfulfilled",
    shipmentStatus: "not_shipped",
    notificationStatus: "sent",
    exceptionStatus: "payment_exception",
    courier: null,
    trackingNumber: null,
    ownerId: "USR-ida",
    slaRisk: "medium",
    nextAction: "Verify bank-transfer reference from chat",
  }),
);

/** Notification failures. */
HEROES.push(
  hero({
    id: "ORD-1104",
    storeId: "ST-lip-woo",
    customerId: "CUS-0146",
    items: [item("LPD-OM3-60", 1)],
    placedAt: hoursAgo(9),
    fulfillmentStatus: "picking",
    shipmentStatus: "not_shipped",
    notificationStatus: "failed",
    exceptionStatus: "none",
    courier: null,
    trackingNumber: null,
    nextAction: "Resend confirmation — template rejected",
  }),
  hero({
    id: "ORD-1100",
    storeId: "ST-nara-woo",
    customerId: "CUS-0151",
    items: [item("NARA-DRP-10", 2)],
    placedAt: hoursAgo(15),
    fulfillmentStatus: "packed",
    shipmentStatus: "not_shipped",
    notificationStatus: "failed",
    exceptionStatus: "none",
    courier: "jnt",
    trackingNumber: "JTMY88110042",
    nextAction: "Resend confirmation — WhatsApp number unreachable",
  }),
);

/** Address issue. */
HEROES.push(
  hero({
    id: "ORD-1107",
    storeId: "ST-lip-shopee",
    customerId: "CUS-0161",
    items: [item("LPD-OM3-60", 1)],
    placedAt: hoursAgo(30),
    sourceOrderId: "SP771233D",
    integrationId: "INT-shopee",
    paymentMethod: "marketplace",
    orderStatus: "approved",
    paymentStatus: "paid",
    fulfillmentStatus: "on_hold",
    shipmentStatus: "not_shipped",
    notificationStatus: "sent",
    exceptionStatus: "address_issue",
    courier: null,
    trackingNumber: null,
    ownerId: "USR-jun",
    slaRisk: "medium",
    nextAction: "Confirm postcode with buyer — courier rejected address",
  }),
);

/** Automation failure. */
HEROES.push(
  hero({
    id: "ORD-1095",
    storeId: "ST-lip-woo",
    customerId: "CUS-0166",
    items: [item("LPD-BND-DUO", 1)],
    placedAt: hoursAgo(21),
    orderStatus: "pending_review",
    paymentStatus: "paid",
    fulfillmentStatus: "unfulfilled",
    shipmentStatus: "not_shipped",
    notificationStatus: "queued",
    exceptionStatus: "automation_failed",
    courier: null,
    trackingNumber: null,
    ownerId: "USR-jun",
    slaRisk: "medium",
    nextAction: "Bundle split rule failed — allocate component SKUs manually",
  }),
);

/** Returns. */
HEROES.push(
  hero({
    id: "ORD-1063",
    storeId: "ST-ver-woo",
    customerId: "CUS-0171",
    items: [item("VER-SER-30", 1)],
    placedAt: hoursAgo(60),
    paymentMethod: "stripe",
    orderStatus: "completed",
    paymentStatus: "paid",
    fulfillmentStatus: "fulfilled",
    shipmentStatus: "delivered",
    notificationStatus: "delivered",
    returnStatus: "requested",
    exceptionStatus: "none",
    trackingNumber: "NVMY55201063",
    ownerId: "USR-ida",
    slaRisk: "low",
    nextAction: "Review return request — 'texture changed' complaint",
  }),
  hero({
    id: "ORD-0955",
    storeId: "ST-lip-woo",
    customerId: "CUS-0176",
    items: [item("LPD-OM3-120", 1)],
    placedAt: daysAgo(9, 15),
    orderStatus: "completed",
    paymentStatus: "paid",
    fulfillmentStatus: "fulfilled",
    shipmentStatus: "delivered",
    notificationStatus: "delivered",
    returnStatus: "received",
    exceptionStatus: "none",
    trackingNumber: "NVMY55190955",
    ownerId: "USR-jun",
    nextAction: "Inspect returned unit, then refund",
  }),
  hero({
    id: "ORD-0870",
    storeId: "ST-ver-lazada",
    customerId: "CUS-0181",
    items: [item("VER-CLE-150", 2)],
    placedAt: daysAgo(14, 11),
    sourceOrderId: "LZ441870",
    integrationId: "INT-lazada",
    paymentMethod: "marketplace",
    orderStatus: "completed",
    paymentStatus: "refunded",
    fulfillmentStatus: "fulfilled",
    shipmentStatus: "delivered",
    notificationStatus: "delivered",
    returnStatus: "refunded",
    exceptionStatus: "none",
    trackingNumber: "NVMY55140870",
  }),
  hero({
    id: "ORD-0820",
    storeId: "ST-sol-woo",
    customerId: "CUS-0189",
    items: [item("SOL-CAN-200", 1)],
    placedAt: daysAgo(17, 16),
    paymentMethod: "stripe",
    orderStatus: "completed",
    paymentStatus: "paid",
    fulfillmentStatus: "fulfilled",
    shipmentStatus: "delivered",
    notificationStatus: "delivered",
    returnStatus: "rejected",
    exceptionStatus: "none",
    trackingNumber: "NVSG33120820",
  }),
);
const ord0870 = HEROES.find((o) => o.id === "ORD-0870")!;
ord0870.refundedTotal = ord0870.grandTotal;

/** Aina's two earlier orders (outside the 35-day generation window). */
HEROES.push(
  hero({
    id: "ORD-0087",
    storeId: "ST-lip-woo",
    customerId: "CUS-0007",
    items: [item("LPD-OM3-60", 1)],
    placedAt: daysAgo(93, 20),
    campaignId: "CMP-0001",
    orderStatus: "completed",
    paymentStatus: "paid",
    fulfillmentStatus: "fulfilled",
    shipmentStatus: "delivered",
    notificationStatus: "delivered",
    trackingNumber: "NVMY55010087",
    isNewCustomer: true,
  }),
  hero({
    id: "ORD-0152",
    storeId: "ST-lip-wa",
    customerId: "CUS-0007",
    items: [item("LPD-OM3-60", 1), item("LPD-D3K-60", 1)],
    placedAt: daysAgo(47, 13),
    sourceOrderId: "WA-CHAT-7710",
    orderStatus: "completed",
    paymentStatus: "cod_collected",
    fulfillmentStatus: "fulfilled",
    shipmentStatus: "delivered",
    notificationStatus: "delivered",
    paymentMethod: "cod",
    trackingNumber: "NVMY55040152",
  }),
);

/** Recent draft (as if saved from the order wizard). */
HEROES.push(
  hero({
    id: "ORD-1110",
    storeId: "ST-lip-wa",
    customerId: "CUS-0002",
    items: [item("LPD-KRL-30", 1)],
    placedAt: hoursAgo(1.2),
    orderStatus: "draft",
    paymentStatus: "unpaid",
    fulfillmentStatus: "unfulfilled",
    shipmentStatus: "not_shipped",
    notificationStatus: "none",
    exceptionStatus: "none",
    paymentMethod: "cod",
    courier: null,
    trackingNumber: null,
    ownerId: "USR-ida",
    nextAction: "Complete customer address, then submit for review",
    isDraft: true,
  }),
);

/* ---------- hero timelines ---------- */

function heroEvents() {
  const o = ord1042;
  ev(o, hoursAgo(67), "connector", "WhatsApp intake", "order", "draft", "Chat order captured by Ida from WhatsApp conversation WA-CHAT-8812.");
  ev(o, hoursAgo(66.8), "user", "Ida", "order", "pending_review", "Draft completed — 2× Omega-3 60s, delivery to Petaling Jaya.", null, "draft");
  ev(o, hoursAgo(66.5), "connector", "Chip gateway", "payment", "paid", "FPX payment RM214.00 captured (ref CHIP-DEMO-90412).");
  ev(o, hoursAgo(66.4), "rule", "Auto-approval rule R-12", "order", "approved", "Passed fraud, duplicate, and stock checks — auto-approved.", "AUTO_APPROVED", "pending_review");
  ev(o, hoursAgo(64), "system", "Notification service", "notification", "delivered", "Order confirmation delivered on WhatsApp.");
  ev(o, hoursAgo(58), "user", "Jun Wei (Demo)", "fulfillment", "packed", "Packed at KL fulfilment centre — 1 parcel, 0.4 kg.");
  ev(o, hoursAgo(56), "courier", "Ninja Van", "shipment", "label_created", "AWB NVMY55231042 created.");
  ev(o, hoursAgo(52), "courier", "Ninja Van", "shipment", "in_transit", "Picked up — arrived at Shah Alam origin hub. Last scan received.");
  ev(o, hoursAgo(4), "rule", "SLA watchdog W-3", "system", null, "No courier movement for 48h — exception raised and assigned to Ida.", "COURIER_NO_MOVEMENT_48H");
  ev(o, hoursAgo(3.8), "system", "Fullkit", "system", null, "Linked to Ninja Van webhook gap incident (21 Jul, 05:00–09:30) — see integration health.");

  for (const [n, , , , hoursOld] of stalledSpec) {
    const so = HEROES.find((x) => x.id === oid(n))!;
    ev(so, hoursAgo(hoursOld), "connector", SOURCE_CONNECTOR[so.sourceType] ?? "Connector", "order", "draft", "Order received.");
    ev(so, hoursAgo(hoursOld - 1), "rule", "Auto-approval rule R-12", "order", "approved", "Auto-approved.", "AUTO_APPROVED");
    ev(so, hoursAgo(hoursOld - 10), "courier", "Ninja Van", "shipment", "in_transit", "Picked up — origin hub scan. Last scan received.");
    ev(so, hoursAgo(4), "rule", "SLA watchdog W-3", "system", null, "No courier movement for 48h — exception raised.", "COURIER_NO_MOVEMENT_48H");
  }

  const o1101 = HEROES.find((x) => x.id === "ORD-1101")!;
  ev(o1101, hoursAgo(14), "connector", "WooCommerce connector", "order", "draft", "Order received from Verdana Web Store (#W48122).");
  ev(o1101, hoursAgo(13.9), "connector", "Stripe gateway", "payment", "failed", "Card declined (insufficient funds). Attempt 1 of 2.", "CARD_DECLINED");
  ev(o1101, hoursAgo(13.5), "connector", "Stripe gateway", "payment", "failed", "Card declined on retry. No further automatic retries.", "CARD_DECLINED");
  ev(o1101, hoursAgo(13.4), "rule", "Payment exception rule R-21", "system", null, "Payment exception raised — assigned to Sales/CS queue.", "PAYMENT_RETRY_EXHAUSTED");

  const o1096 = HEROES.find((x) => x.id === "ORD-1096")!;
  ev(o1096, hoursAgo(19), "connector", "WhatsApp intake", "order", "draft", "Chat order captured (WA-CHAT-8853).");
  ev(o1096, hoursAgo(18.5), "user", "Ida", "payment", "pending_verification", "Customer sent bank-transfer slip — awaiting verification against Chip settlement feed.");

  const o1104 = HEROES.find((x) => x.id === "ORD-1104")!;
  ev(o1104, hoursAgo(9), "connector", "WooCommerce connector", "order", "draft", "Order received (#W48160).");
  ev(o1104, hoursAgo(8.9), "connector", "Chip gateway", "payment", "paid", "Payment captured.");
  ev(o1104, hoursAgo(8.8), "rule", "Auto-approval rule R-12", "order", "approved", "Auto-approved.", "AUTO_APPROVED");
  ev(o1104, hoursAgo(8.7), "system", "Notification service", "notification", "failed", "WhatsApp template rejected — health-category template pending re-approval.", "TEMPLATE_REJECTED");

  const o1100 = HEROES.find((x) => x.id === "ORD-1100")!;
  ev(o1100, hoursAgo(15), "connector", "WooCommerce connector", "order", "draft", "Order received (#W48141).");
  ev(o1100, hoursAgo(14.8), "connector", "Chip gateway", "payment", "paid", "Payment captured.");
  ev(o1100, hoursAgo(14.7), "system", "Notification service", "notification", "failed", "WhatsApp number unreachable — customer may have changed numbers.", "RECIPIENT_UNREACHABLE");

  const o1107 = HEROES.find((x) => x.id === "ORD-1107")!;
  ev(o1107, hoursAgo(30), "connector", "Shopee connector", "order", "draft", "Order received from Shopee (SP771233D) — last sync before token expiry.");
  ev(o1107, hoursAgo(29.5), "rule", "Address validation rule R-8", "system", null, "Postcode failed courier serviceability check.", "ADDRESS_UNSERVICEABLE");
  ev(o1107, hoursAgo(28), "user", "Jun Wei (Demo)", "fulfillment", "on_hold", "Held pending address confirmation with buyer via Shopee chat.");

  const o1095 = HEROES.find((x) => x.id === "ORD-1095")!;
  ev(o1095, hoursAgo(21), "connector", "WooCommerce connector", "order", "draft", "Order received (#W48119) — contains bundle LPD-BND-DUO.");
  ev(o1095, hoursAgo(20.9), "connector", "Chip gateway", "payment", "paid", "Payment captured.");
  ev(o1095, hoursAgo(20.8), "rule", "Bundle split rule R-30", "system", null, "Failed to allocate component SKUs — bundle mapping missing for MetaCatalog import.", "RULE_EXECUTION_FAILED");

  const o1063 = HEROES.find((x) => x.id === "ORD-1063")!;
  ev(o1063, hoursAgo(60), "connector", "WooCommerce connector", "order", "draft", "Order received (#W48001).");
  ev(o1063, hoursAgo(36), "courier", "Ninja Van", "shipment", "delivered", "Parcel delivered.");
  ev(o1063, hoursAgo(8), "connector", "WhatsApp intake", "return", "requested", "Customer requested return — 'serum texture changed'. Photos attached in chat.", "PRODUCT_COMPLAINT");

  const o0955 = HEROES.find((x) => x.id === "ORD-0955")!;
  ev(o0955, daysAgo(9, 15), "connector", "WooCommerce connector", "order", "draft", "Order received.");
  ev(o0955, daysAgo(7, 12), "courier", "Ninja Van", "shipment", "delivered", "Parcel delivered.");
  ev(o0955, daysAgo(4, 10), "user", "Ida", "return", "approved", "Return approved — unopened, buyer's remorse.", "BUYER_REMORSE");
  ev(o0955, daysAgo(1, 16), "courier", "Ninja Van", "return", "received", "Return parcel received at warehouse.");

  const o1110 = HEROES.find((x) => x.id === "ORD-1110")!;
  ev(o1110, hoursAgo(1.2), "user", "Ida", "order", "draft", "Draft created from order form — customer address incomplete.");

  const o0087 = HEROES.find((x) => x.id === "ORD-0087")!;
  ev(o0087, daysAgo(93, 20), "connector", "WooCommerce connector", "order", "draft", "First order — acquired via Meta campaign CMP-0001.");
  ev(o0087, daysAgo(91, 14), "courier", "Ninja Van", "shipment", "delivered", "Parcel delivered.");
  const o0152 = HEROES.find((x) => x.id === "ORD-0152")!;
  ev(o0152, daysAgo(47, 13), "connector", "WhatsApp intake", "order", "draft", "Repeat chat order captured by Ida.");
  ev(o0152, daysAgo(45, 12), "courier", "Ninja Van", "shipment", "delivered", "Parcel delivered — COD RM184.00 collected.");
}
heroEvents();

export const ORDERS: Order[] = [...orders, ...HEROES].sort(
  (a, b) => (a.placedAt < b.placedAt ? 1 : -1),
);
export const ORDER_EVENTS: OrderStateEvent[] = events;

/* ---------- recompute customer aggregates from orders ---------- */

{
  const byCustomer = new Map<string, Order[]>();
  for (const o of ORDERS) {
    if (o.isDraft || o.orderStatus === "cancelled") continue;
    const list = byCustomer.get(o.customerId) ?? [];
    list.push(o);
    byCustomer.set(o.customerId, list);
  }
  for (const c of CUSTOMERS) {
    const list = (byCustomer.get(c.id) ?? []).sort((a, b) => (a.placedAt < b.placedAt ? -1 : 1));
    c.lifetimeOrders = list.length;
    c.netRevenue = list.reduce((s, o) => s + o.grandTotal - o.refundedTotal, 0);
    c.contributionLtv = Math.round(c.netRevenue * 0.34);
    c.lastOrderAt = list.length ? list[list.length - 1]!.placedAt : null;
    c.repeatState = list.length >= 4 ? "loyal" : list.length >= 2 ? "repeat" : "first_time";
    const returns = list.filter((o) => o.returnStatus !== "none").length;
    c.returnRate = list.length ? returns / list.length : 0;
    for (const o of list) {
      if (!c.brandIds.includes(o.brandId)) c.brandIds.push(o.brandId);
    }
    if (list.length > 0 && c.lifecycleState === "provisional") c.lifecycleState = "active";
  }
}
