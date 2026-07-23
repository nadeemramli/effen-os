import type { AdAccount, Campaign, CampaignDaily } from "@/lib/domain/types";
import { dateKey, hoursAgo } from "../clock";
import { mulberry32 } from "../prng";

/**
 * 30-day daily series per campaign. CMP-0003 carries the "Meta CPM spike"
 * driver of yesterday's contribution miss: spend rises ~35% over the final
 * 4 days while platform revenue stays flat.
 */

const rng = mulberry32(0xad5e);

function series(
  baseSpend: number, // minor units / day
  baseRoas: number,
  ordersPerDay: number,
  opts: { spikeFromDay?: number; spikeFactor?: number; decayRoas?: number } = {},
): CampaignDaily[] {
  const out: CampaignDaily[] = [];
  for (let d = 29; d >= 0; d--) {
    const wave = 1 + 0.18 * Math.sin((29 - d) / 4.1) + (rng() - 0.5) * 0.22;
    let spend = baseSpend * wave;
    let roas = baseRoas * (1 + (rng() - 0.5) * 0.18);
    if (opts.spikeFromDay !== undefined && d <= opts.spikeFromDay) {
      spend *= opts.spikeFactor ?? 1.35;
      roas *= opts.decayRoas ?? 0.72;
    }
    // Today is a partial day: the demo clock is 09:00, so pace spend and
    // results to the elapsed fraction of the day.
    const paceFactor = d === 0 ? 9 / 24 : 1;
    const revenue = spend * roas;
    const orders = Math.max(0, Math.round(ordersPerDay * wave * (roas / baseRoas) * paceFactor));
    out.push({
      date: dateKey(d),
      spend: Math.round(spend * paceFactor),
      platformRevenue: Math.round(revenue * paceFactor),
      fullkitOrders: orders,
      newCustomers: Math.round(orders * (0.5 + rng() * 0.25)),
    });
  }
  return out;
}

export const AD_ACCOUNTS: AdAccount[] = [
  {
    id: "ACC-meta-lip",
    platform: "meta",
    externalId: "act_238000001",
    name: "Lipidri MY — Meta",
    brandId: "BRD-lipidri",
    legalEntityId: "LE-my",
    market: "MY",
    currency: "MYR",
    purpose: "Prospecting + retention for Lipidri MY",
    ownerId: "USR-farah",
    scopes: ["ads_read", "insights.read"],
    status: "connected",
    lastSyncAt: hoursAgo(1.1),
  },
  {
    id: "ACC-meta-ver",
    platform: "meta",
    externalId: "act_238000002",
    name: "Verdana — Meta",
    brandId: "BRD-verdana",
    legalEntityId: "LE-my",
    market: "MY",
    currency: "MYR",
    purpose: "Verdana always-on",
    ownerId: "USR-farah",
    scopes: ["ads_read", "insights.read"],
    status: "connected",
    lastSyncAt: hoursAgo(1.1),
  },
  {
    id: "ACC-meta-nuro",
    platform: "meta",
    externalId: "act_238000003",
    name: "EFFEN — NuroKids (unmapped)",
    brandId: null,
    legalEntityId: null,
    market: "MY",
    currency: "MYR",
    purpose: "Upcoming brand — awaiting brand mapping",
    ownerId: null,
    scopes: ["ads_read"],
    status: "unmapped",
    lastSyncAt: hoursAgo(1.1),
  },
  {
    id: "ACC-google-effen",
    platform: "google",
    externalId: "512-330-0001",
    name: "EFFEN — Google Ads",
    brandId: "BRD-lipidri",
    legalEntityId: "LE-my",
    market: "MY",
    currency: "MYR",
    purpose: "Brand search + PMax across MY brands",
    ownerId: "USR-farah",
    scopes: ["adwords.readonly"],
    status: "connected",
    lastSyncAt: hoursAgo(2.3),
  },
  {
    id: "ACC-tiktok-effen",
    platform: "tiktok",
    externalId: "TT-ADV-900001",
    name: "EFFEN — TikTok Ads",
    brandId: "BRD-verdana",
    legalEntityId: "LE-my",
    market: "MY",
    currency: "MYR",
    purpose: "Verdana + Nara creator content",
    ownerId: "USR-farah",
    scopes: ["ads.read"],
    status: "connected",
    lastSyncAt: hoursAgo(3.8),
  },
];

export const CAMPAIGNS: Campaign[] = [
  {
    id: "CMP-0001",
    name: "Lipidri MY — Prospecting Advantage+",
    platform: "meta",
    accountId: "ACC-meta-lip",
    brandId: "BRD-lipidri",
    market: "MY",
    currency: "MYR",
    objective: "Purchase",
    status: "active",
    targetMer: 3.0,
    daily: series(38000, 3.4, 9),
    children: [
      { id: "ADS-0001a", name: "Broad — Advantage+ audience", level: "ad_set", status: "active", spend: 2100000, platformRevenue: 7300000 },
      { id: "ADS-0001b", name: "Lookalike 2% — purchasers", level: "ad_set", status: "active", spend: 890000, platformRevenue: 2600000 },
      { id: "AD-0001c", name: "UGC — 'Doctor dad' hook v3", level: "ad", status: "active", spend: 1400000, platformRevenue: 5200000, creative: "UGC video 0:42", landingPage: "/pages/omega3-family", productSku: "LPD-OM3-60" },
    ],
    productSkus: ["LPD-OM3-60", "LPD-OM3-120", "LPD-BND-DUO"],
  },
  {
    id: "CMP-0002",
    name: "Lipidri MY — Retargeting",
    platform: "meta",
    accountId: "ACC-meta-lip",
    brandId: "BRD-lipidri",
    market: "MY",
    currency: "MYR",
    objective: "Purchase",
    status: "active",
    targetMer: 5.0,
    daily: series(12000, 5.6, 4),
    children: [
      { id: "ADS-0002a", name: "Viewed 30d — no purchase", level: "ad_set", status: "active", spend: 260000, platformRevenue: 1500000 },
    ],
    productSkus: ["LPD-OM3-60", "LPD-KRL-30"],
  },
  {
    id: "CMP-0003",
    name: "Lipidri MY — Always-On Advantage+",
    platform: "meta",
    accountId: "ACC-meta-lip",
    brandId: "BRD-lipidri",
    market: "MY",
    currency: "MYR",
    objective: "Purchase",
    status: "active",
    targetMer: 3.0,
    daily: series(52000, 3.1, 13, { spikeFromDay: 3, spikeFactor: 1.35, decayRoas: 0.7 }),
    children: [
      { id: "ADS-0003a", name: "Always-on — broad", level: "ad_set", status: "active", spend: 3900000, platformRevenue: 10800000 },
      { id: "AD-0003b", name: "Static — 'RM99 starter' offer", level: "ad", status: "active", spend: 1200000, platformRevenue: 3300000, creative: "Static carousel", landingPage: "/pages/starter", productSku: "LPD-OM3-60" },
    ],
    productSkus: ["LPD-OM3-60", "LPD-D3K-60"],
  },
  {
    id: "CMP-0004",
    name: "Lipidri — Brand Search MY",
    platform: "google",
    accountId: "ACC-google-effen",
    brandId: "BRD-lipidri",
    market: "MY",
    currency: "MYR",
    objective: "Search",
    status: "active",
    targetMer: 8.0,
    daily: series(6500, 9.2, 3),
    children: [
      { id: "ADS-0004a", name: "Exact — lipidri", level: "ad_set", status: "active", spend: 130000, platformRevenue: 1250000 },
    ],
    productSkus: ["LPD-OM3-60"],
  },
  {
    id: "CMP-0005",
    name: "Verdana — Performance Max MY",
    platform: "google",
    accountId: "ACC-google-effen",
    brandId: "BRD-verdana",
    market: "MY",
    currency: "MYR",
    objective: "PMax",
    status: "active",
    targetMer: 2.8,
    daily: series(18000, 2.9, 6),
    children: [
      { id: "ADS-0005a", name: "Asset group — routine set", level: "ad_set", status: "active", spend: 540000, platformRevenue: 1550000 },
    ],
    productSkus: ["VER-SER-30", "VER-CLE-150", "VER-TON-100"],
  },
  {
    id: "CMP-0006",
    name: "Verdana — TikTok Spark Ads",
    platform: "tiktok",
    accountId: "ACC-tiktok-effen",
    brandId: "BRD-verdana",
    market: "MY",
    currency: "MYR",
    objective: "Purchase",
    status: "active",
    targetMer: 2.5,
    daily: series(14000, 2.6, 5),
    children: [
      { id: "AD-0006a", name: "Spark — 'toner routine' creator", level: "ad", status: "active", spend: 420000, platformRevenue: 1090000, creative: "Creator video 0:31", productSku: "VER-TON-100" },
    ],
    productSkus: ["VER-TON-100", "VER-SER-30"],
  },
  {
    id: "CMP-0007",
    name: "Nara — Creator Collabs",
    platform: "tiktok",
    accountId: "ACC-tiktok-effen",
    brandId: "BRD-nara",
    market: "MY",
    currency: "MYR",
    objective: "Purchase",
    status: "active",
    targetMer: 2.0,
    daily: series(5200, 1.1, 2),
    children: [
      { id: "AD-0007a", name: "Collab — office coffee skit", level: "ad", status: "active", spend: 156000, platformRevenue: 171000, creative: "Creator video 0:58", productSku: "NARA-DRP-10" },
    ],
    productSkus: ["NARA-DRP-10", "NARA-DRP-30"],
  },
  {
    id: "CMP-0008",
    name: "Lipidri — Shopee Search Ads",
    platform: "shopee_ads",
    accountId: "ACC-meta-lip",
    brandId: "BRD-lipidri",
    market: "MY",
    currency: "MYR",
    objective: "Marketplace search",
    status: "active",
    targetMer: 4.0,
    daily: series(4200, 4.4, 2),
    children: [
      { id: "ADS-0008a", name: "Keyword — fish oil", level: "ad_set", status: "active", spend: 126000, platformRevenue: 560000 },
    ],
    productSkus: ["LPD-OM3-60", "LPD-OM3-120"],
  },
];

export const CAMPAIGN_BY_ID = Object.fromEntries(CAMPAIGNS.map((c) => [c.id, c]));
