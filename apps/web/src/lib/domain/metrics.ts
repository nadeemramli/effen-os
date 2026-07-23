import type { Campaign, Order } from "./types";

/**
 * All commercial math lives here and only here — Command Centre, Reports,
 * and Prophit call the same functions so numbers can never disagree.
 * Amounts are integer minor units. Cross-currency totals are normalized
 * to MYR at a fixed demo rate.
 */

export const FX_TO_MYR: Record<string, number> = { MYR: 1, SGD: 3.3 };

export function toMYR(minor: number, currency: string): number {
  return Math.round(minor * (FX_TO_MYR[currency] ?? 1));
}

export interface OrderCosts {
  cogs: number;
  fulfilment: number;
  fees: number;
}

export function isCommercial(order: Order): boolean {
  return !order.isDraft && order.orderStatus !== "cancelled" && order.orderStatus !== "rejected";
}

export function orderNetRevenue(order: Order): number {
  return order.grandTotal - order.refundedTotal;
}

/** Cost model (demo constants, documented in the contribution metric definition). */
export function orderCosts(order: Order, cogsByVariantId: Record<string, number>): OrderCosts {
  const cogs = order.items.reduce(
    (s, it) => s + (cogsByVariantId[it.variantId] ?? 0) * it.quantity,
    0,
  );
  const fulfilment = order.market === "SG" ? 1000 : 1500;
  const net = orderNetRevenue(order);
  let fees = 0;
  if (order.paymentMethod === "marketplace") fees = Math.round(net * 0.1);
  else if (order.paymentMethod === "cod") fees = 500;
  else fees = Math.round(net * 0.025) + 100;
  return { cogs, fulfilment, fees };
}

export function orderContribution(order: Order, cogsByVariantId: Record<string, number>): number {
  const { cogs, fulfilment, fees } = orderCosts(order, cogsByVariantId);
  return orderNetRevenue(order) - cogs - fulfilment - fees;
}

export interface DailyCommercialRow {
  date: string;
  brandId: string;
  netRevenue: number; // MYR minor units
  contribution: number; // MYR minor units
  orders: number;
  newCustomerOrders: number;
  newCustomerRevenue: number;
  adSpend: number; // MYR minor units
}

/** Aggregate orders + campaign spend into a day × brand grid (MYR-normalized). */
export function dailyCommercial(
  orders: Order[],
  campaigns: Campaign[],
  cogsByVariantId: Record<string, number>,
): DailyCommercialRow[] {
  const map = new Map<string, DailyCommercialRow>();
  const row = (date: string, brandId: string): DailyCommercialRow => {
    const key = `${date}|${brandId}`;
    let r = map.get(key);
    if (!r) {
      r = { date, brandId, netRevenue: 0, contribution: 0, orders: 0, newCustomerOrders: 0, newCustomerRevenue: 0, adSpend: 0 };
      map.set(key, r);
    }
    return r;
  };
  for (const o of orders) {
    if (!isCommercial(o)) continue;
    const date = new Date(new Date(o.placedAt).getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
    const r = row(date, o.brandId);
    const net = toMYR(orderNetRevenue(o), o.currency);
    r.netRevenue += net;
    r.contribution += toMYR(orderContribution(o, cogsByVariantId), o.currency);
    r.orders += 1;
    if (o.isNewCustomer) {
      r.newCustomerOrders += 1;
      r.newCustomerRevenue += net;
    }
  }
  for (const c of campaigns) {
    for (const d of c.daily) {
      row(d.date, c.brandId).adSpend += toMYR(d.spend, c.currency);
    }
  }
  // Contribution at day grain is contribution AFTER marketing:
  // order economics (net revenue − COGS − fulfilment − fees) minus ad spend.
  for (const r of map.values()) {
    r.contribution -= r.adSpend;
  }
  return [...map.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function sumRows(rows: DailyCommercialRow[]) {
  return rows.reduce(
    (acc, r) => ({
      netRevenue: acc.netRevenue + r.netRevenue,
      contribution: acc.contribution + r.contribution,
      orders: acc.orders + r.orders,
      newCustomerOrders: acc.newCustomerOrders + r.newCustomerOrders,
      newCustomerRevenue: acc.newCustomerRevenue + r.newCustomerRevenue,
      adSpend: acc.adSpend + r.adSpend,
    }),
    { netRevenue: 0, contribution: 0, orders: 0, newCustomerOrders: 0, newCustomerRevenue: 0, adSpend: 0 },
  );
}

export function blendedMer(netRevenue: number, adSpend: number): number | null {
  return adSpend > 0 ? netRevenue / adSpend : null;
}

export function aMer(newCustomerRevenue: number, adSpend: number): number | null {
  return adSpend > 0 ? newCustomerRevenue / adSpend : null;
}
