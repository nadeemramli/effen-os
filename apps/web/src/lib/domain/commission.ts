import type { CommissionStatement, CommissionTier } from "./types";

/**
 * EFFEN commission structure (from Finance's captured workflow, Jul 2026).
 *
 * Junior:            profit < RM10,000            → 0
 *                    RM10,000 – RM29,999.99       → 3% of profit
 *                    RM30,000+                    → 5% of profit + RM1,000
 *                                                   for every full RM30,000
 * Senior/Manager:    profit < RM40,000            → 0
 *                    RM40,000+                    → 5% of profit + RM1,000
 *                                                   for every full RM30,000
 *
 * ASSUMPTION (flagged for Finance to confirm): rates apply to the WHOLE
 * profit once a bracket is reached (not marginal), and the RM1,000 kicker
 * counts every full RM30,000 of total profit.
 */

export function totalSales(s: CommissionStatement): number {
  return s.salesPackage + s.cod + s.ssPostage;
}

export function totalCost(s: CommissionStatement): number {
  return s.productCost + s.deliveryCost + s.returnCost + s.codCost + s.marketingCost;
}

export function statementProfit(s: CommissionStatement): number {
  return totalSales(s) - totalCost(s);
}

/** Commission in minor units from profit in minor units. */
export function commissionFor(tier: CommissionTier, profitMinor: number): number {
  const profit = profitMinor / 100;
  const kicker = 1000 * Math.floor(profit / 30000);
  if (tier === "junior") {
    if (profit < 10000) return 0;
    if (profit < 30000) return Math.round(profit * 0.03 * 100);
    return Math.round((profit * 0.05 + kicker) * 100);
  }
  if (profit < 40000) return 0;
  return Math.round((profit * 0.05 + kicker) * 100);
}

export function commissionRateLabel(tier: CommissionTier, profitMinor: number): string {
  const profit = profitMinor / 100;
  if (tier === "junior") {
    if (profit < 10000) return "below RM10,000 threshold";
    if (profit < 30000) return "3% bracket";
    return `5% + RM1,000 × ${Math.floor(profit / 30000)}`;
  }
  if (profit < 40000) return "below RM40,000 threshold";
  return `5% + RM1,000 × ${Math.floor(profit / 30000)}`;
}
