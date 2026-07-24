import type { CommissionStatement, CreativeBrief, WorkOrder } from "@/lib/domain/types";
import { daysAgo, daysFromNow } from "../clock";

/* =========================================================================
 * Creative Loop (S2) — briefs tied to the seeded campaigns and the
 * creative-fatigue diagnosis (DIA-0001: AD-0003b CTR 1.8% → 0.9%).
 * ========================================================================= */

export const CREATIVE_BRIEFS: CreativeBrief[] = [
  {
    id: "CRE-0009",
    title: "Replace 'RM99 starter' static — fatigue",
    brandId: "BRD-lipidri",
    stage: "production",
    format: "Static carousel ×3",
    angle: "Price-anchor refresh with family-supply framing",
    campaignId: "CMP-0003",
    adId: "AD-0003b",
    ownerId: "USR-farah",
    dueAt: daysFromNow(2),
    fatigueReplacement: true,
    claimsCheck: "passed",
    note: "Direct replacement for the fatigued static flagged in DIA-0001. Claims-gated copy already approved.",
  },
  {
    id: "CRE-0010",
    title: "UGC v4 — 'Doctor dad' follow-up",
    brandId: "BRD-lipidri",
    stage: "review",
    format: "UGC video 0:45",
    angle: "Continuation of the winning v3 hook with new opening 3s",
    campaignId: "CMP-0001",
    adId: "AD-0001c",
    ownerId: "USR-farah",
    dueAt: daysFromNow(1),
    fatigueReplacement: false,
    claimsCheck: "pending",
    note: "Awaiting claims check — script mentions 'heart health', must map to an approved claim before launch.",
  },
  {
    id: "CRE-0011",
    title: "Toner restock announcement",
    brandId: "BRD-verdana",
    stage: "brief",
    format: "Creator video 0:30",
    angle: "Back-in-stock urgency for waitlisted customers",
    campaignId: "CMP-0006",
    adId: null,
    ownerId: "USR-farah",
    dueAt: daysFromNow(4),
    fatigueReplacement: false,
    claimsCheck: "not_required",
    note: "Blocked narrative-wise on REC-0033 (restock decision) — do not launch before stock lands.",
  },
  {
    id: "CRE-0012",
    title: "Office-gifting angle test",
    brandId: "BRD-nara",
    stage: "idea",
    format: "Creator video 0:45",
    angle: "Rebrief from paused Creator Collabs (REC-0034)",
    campaignId: "CMP-0007",
    adId: null,
    ownerId: "USR-farah",
    dueAt: daysFromNow(7),
    fatigueReplacement: false,
    claimsCheck: "not_required",
    note: null,
  },
  {
    id: "CRE-0008",
    title: "Brand search RSA refresh",
    brandId: "BRD-lipidri",
    stage: "live",
    format: "Responsive search ad copy",
    angle: "Sitelink + callout refresh for brand queries",
    campaignId: "CMP-0004",
    adId: "ADS-0004a",
    ownerId: "USR-farah",
    dueAt: daysAgo(3),
    fatigueReplacement: false,
    claimsCheck: "passed",
    note: "Launched — monitoring CTR vs previous copy set.",
  },
];

/** Weekly creative demand vs pipeline supply (creative capacity plan). */
export const CREATIVE_DEMAND = {
  requiredPerWeek: 6,
  inPipeline: CREATIVE_BRIEFS.filter((b) => b.stage !== "live").length,
  note: "Demand derives from the media plan: always-on campaigns need ~2 fresh assets/week each to hold frequency below fatigue thresholds.",
};

/* =========================================================================
 * Production / MRP (P5) — supplement bottling for Lipidri, roasting for
 * Nara. BOMs are illustrative but structurally correct.
 * ========================================================================= */

const OM3_BOM = [
  { material: "Omega-3 softgel bulk (1000mg)", uom: "softgel", perUnit: 60, onHand: 180000 },
  { material: "120cc HDPE bottle + cap", uom: "pc", perUnit: 1, onHand: 4200 },
  { material: "Lipidri OM3 label (MY)", uom: "pc", perUnit: 1, onHand: 3900 },
  { material: "Shipper carton (24 btl)", uom: "carton", perUnit: 1 / 24, onHand: 260 },
];

export const WORK_ORDERS: WorkOrder[] = [
  {
    id: "WO-0007",
    brandId: "BRD-lipidri",
    sku: "LPD-OM3-60",
    productName: "Lipidri Omega-3 60s",
    quantity: 2400,
    stage: "fg_received",
    batchNo: "LOM3-2607A",
    expiryDate: "2028-06-30",
    yieldPct: 98.4,
    qcState: "passed",
    qcReason: null,
    blockedBy: null,
    dueAt: daysAgo(6),
    bom: OM3_BOM,
  },
  {
    id: "WO-0008",
    brandId: "BRD-lipidri",
    sku: "LPD-OM3-60",
    productName: "Lipidri Omega-3 60s",
    quantity: 3000,
    stage: "production",
    batchNo: "LOM3-2607B",
    expiryDate: "2028-07-31",
    yieldPct: null,
    qcState: "pending",
    qcReason: null,
    blockedBy: null,
    dueAt: daysFromNow(3),
    bom: OM3_BOM,
  },
  {
    id: "WO-0009",
    brandId: "BRD-lipidri",
    sku: "LPD-KRL-30",
    productName: "Lipidri Krill Oil 30s",
    quantity: 1500,
    stage: "planned",
    batchNo: "LKRL-2608A",
    expiryDate: "2028-08-31",
    yieldPct: null,
    qcState: "pending",
    qcReason: null,
    blockedBy: "Krill softgel bulk PO-2219 arrives in 9 days — 45,000 softgels required, 12,000 on hand",
    dueAt: daysFromNow(12),
    bom: [
      { material: "Krill oil softgel bulk (500mg)", uom: "softgel", perUnit: 30, onHand: 12000 },
      { material: "60cc amber bottle + cap", uom: "pc", perUnit: 1, onHand: 2100 },
      { material: "Lipidri KRL label (MY)", uom: "pc", perUnit: 1, onHand: 2400 },
    ],
  },
  {
    id: "WO-0010",
    brandId: "BRD-nara",
    sku: "NARA-BN-250",
    productName: "Nara Whole Beans 250g",
    quantity: 400,
    stage: "qc",
    batchNo: "RST-2607-14",
    expiryDate: "2026-10-23",
    yieldPct: 84.1,
    qcState: "hold",
    qcReason: "Roast profile variance on second tray — cupping review before bagging.",
    blockedBy: null,
    dueAt: daysFromNow(1),
    bom: [
      { material: "Green beans — seasonal lot (kg)", uom: "kg", perUnit: 0.3, onHand: 240 },
      { material: "250g valve bag", uom: "pc", perUnit: 1, onHand: 900 },
      { material: "Roast-date sticker", uom: "pc", perUnit: 1, onHand: 1100 },
    ],
  },
];

/* =========================================================================
 * Finance / commission (P6) — statements mirror the operational P&L
 * (sales + COD + Sabah/Sarawak postage − product/delivery/return/COD/
 * marketing). Names are synthetic. Amounts in minor units (sen).
 * Seeded to exercise every tier branch:
 *   Hakim (junior):   RM18,540.60 profit → 3% bracket
 *   Aisyah (junior):  RM8,204.10 profit  → below threshold, RM0
 *   Farid (senior):   RM72,309.40 profit → 5% + RM1,000 × 2
 *   Zana (junior):    channels still processing → statement not ready
 * ========================================================================= */

const CHANNELS_DONE: CommissionStatement["channels"] = [
  { channel: "Fighter", state: "processed", note: null },
  { channel: "Shopee", state: "processed", note: "Settlement file processed to net proceeds before totalling." },
  { channel: "Lazada", state: "processed", note: null },
  { channel: "TikTok", state: "processed", note: "Ads + Shop file processed to net." },
];

export const COMMISSION_STATEMENTS: CommissionStatement[] = [
  {
    id: "COM-2607-HKM",
    period: "July 2026 (MTD)",
    personName: "Hakim (Demo)",
    tier: "junior",
    salesPackage: 6842000,
    cod: 1218000,
    ssPostage: 96000,
    productCost: 2461000,
    codCost: 231000,
    deliveryCost: 782400,
    returnCost: 118000,
    marketingCost: 2709540,
    status: "pending_approval",
    channels: CHANNELS_DONE,
  },
  {
    id: "COM-2607-ASY",
    period: "July 2026 (MTD)",
    personName: "Aisyah (Demo)",
    tier: "junior",
    salesPackage: 2716000,
    cod: 449000,
    ssPostage: 38000,
    productCost: 981000,
    codCost: 92000,
    deliveryCost: 331590,
    returnCost: 46000,
    marketingCost: 932000,
    status: "pending_approval",
    channels: CHANNELS_DONE,
  },
  {
    id: "COM-2607-FRD",
    period: "July 2026 (MTD)",
    personName: "Farid Imran (Demo)",
    tier: "senior",
    salesPackage: 24870000,
    cod: 3924000,
    ssPostage: 262000,
    productCost: 8946000,
    codCost: 771000,
    deliveryCost: 2716060,
    returnCost: 411000,
    marketingCost: 8981000,
    status: "pending_approval",
    channels: CHANNELS_DONE,
  },
  {
    id: "COM-2607-ZNA",
    period: "July 2026 (MTD)",
    personName: "Zana (Demo)",
    tier: "junior",
    salesPackage: 4318000,
    cod: 764000,
    ssPostage: 51000,
    productCost: 1562000,
    codCost: 143000,
    deliveryCost: 501200,
    returnCost: 63000,
    marketingCost: 1544000,
    status: "processing",
    channels: [
      { channel: "Fighter", state: "processed", note: null },
      { channel: "Shopee", state: "processing_required", note: "Awaiting settlement file — Shopee sync is stale (token expired)." },
      { channel: "Lazada", state: "processed", note: null },
      { channel: "TikTok", state: "pending", note: "Shop file not yet exported." },
    ],
  },
];
