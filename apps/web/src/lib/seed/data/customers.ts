import type { Customer } from "@/lib/domain/types";
import { daysAgo } from "../clock";
import { intBetween, mulberry32, pick, pickWeighted } from "../prng";

/**
 * ~480 synthetic customers. Contact details are deliberately fake:
 * phones use the +60 12-000 XXXX / +65 8000 XXXX zero-blocks and all
 * emails end in @example.com. Hero customers (CUS-0001..0009) are
 * hand-authored; the long tail is generated.
 */

const MY_FIRST = ["Aina", "Amirul", "Siti", "Hafiz", "Nurul", "Farid", "Zara", "Iqbal", "Melissa", "Kai Xin", "Wei Ming", "Li Ying", "Jason", "Priya", "Arun", "Devi", "Syafiq", "Aisyah", "Daniel", "Hui Ling", "Azlan", "Kavitha", "Marcus", "Nadia", "Shalini", "Zulkifli", "Grace", "Harith", "Yasmin", "Vincent"] as const;
const MY_LAST = ["Rahman", "Tan", "Lim", "Abdullah", "Wong", "Lee", "Ismail", "Ng", "Krishnan", "Chong", "Hassan", "Yusof", "Cheah", "Pillai", "Osman", "Teoh", "Raj", "Aziz", "Loh", "Kamal"] as const;
const SG_FIRST = ["Clarissa", "Ryan", "Xin Yi", "Aloysius", "Sherlyn", "Dinesh", "Nurin", "Benjamin", "Hazel", "Farhan"] as const;
const SG_LAST = ["Goh", "Chua", "Koh", "Seah", "Tay", "Menon", "Rashid", "Ong", "Low", "Yeo"] as const;

const CITIES_MY = [
  { city: "Petaling Jaya", state: "Selangor", postcode: "47301" },
  { city: "Shah Alam", state: "Selangor", postcode: "40150" },
  { city: "Kuala Lumpur", state: "WP Kuala Lumpur", postcode: "50480" },
  { city: "Johor Bahru", state: "Johor", postcode: "80100" },
  { city: "George Town", state: "Pulau Pinang", postcode: "10200" },
  { city: "Ipoh", state: "Perak", postcode: "30100" },
  { city: "Kota Kinabalu", state: "Sabah", postcode: "88000" },
  { city: "Kuching", state: "Sarawak", postcode: "93100" },
] as const;
const CITIES_SG = [
  { city: "Singapore", state: "Central", postcode: "049483" },
  { city: "Singapore", state: "East", postcode: "469001" },
  { city: "Singapore", state: "North", postcode: "730001" },
] as const;

const rng = mulberry32(0xc057);

function phoneMY(n: number): string {
  return `+60 12-000 ${String(n % 10000).padStart(4, "0")}`;
}
function phoneSG(n: number): string {
  return `+65 8000 ${String(n % 10000).padStart(4, "0")}`;
}

function makeCustomer(idx: number, market: "MY" | "SG"): Customer {
  const first = market === "MY" ? pick(rng, MY_FIRST) : pick(rng, SG_FIRST);
  const last = market === "MY" ? pick(rng, MY_LAST) : pick(rng, SG_LAST);
  const name = `${first} ${last}`;
  const id = `CUS-${String(idx).padStart(4, "0")}`;
  const phone = market === "MY" ? phoneMY(idx) : phoneSG(idx);
  const email = `${first.toLowerCase().replace(/\s+/g, ".")}.${last.toLowerCase()}${idx}@example.com`;
  const loc = market === "MY" ? pick(rng, CITIES_MY) : pick(rng, CITIES_SG);
  const consentGranted = rng() > 0.25;
  return {
    id,
    displayName: name,
    brandIds: [],
    primaryMarket: market,
    identities: [
      { id: `${id}-ph`, type: "phone", value: phone, isPrimary: true, isVerified: true, sourceIntegrationId: "INT-woo" },
      { id: `${id}-em`, type: "email", value: email, isPrimary: false, isVerified: rng() > 0.3, sourceIntegrationId: "INT-woo" },
    ],
    consents: [
      { channel: "whatsapp", purpose: "marketing", status: consentGranted ? "granted" : "revoked", capturedAt: daysAgo(intBetween(rng, 10, 200)) },
      { channel: "email", purpose: "transactional", status: "granted", capturedAt: daysAgo(intBetween(rng, 10, 200)) },
    ],
    addresses: [
      {
        id: `${id}-ad1`,
        label: "Home",
        recipient: name,
        line1: `${intBetween(rng, 1, 88)}, Jalan Demo ${intBetween(rng, 1, 12)}/${intBetween(rng, 1, 9)}`,
        city: loc.city,
        state: loc.state,
        postcode: loc.postcode,
        country: market,
        isDefault: true,
      },
    ],
    lifecycleState: pickWeighted(rng, [
      ["active", 5],
      ["new", 3],
      ["at_risk", 1.2],
      ["dormant", 0.8],
    ]),
    valueTier: pickWeighted(rng, [
      ["low", 4],
      ["mid", 4],
      ["high", 1.6],
      ["vip", 0.4],
    ]),
    repeatState: "first_time", // recomputed after order generation
    firstSeenAt: daysAgo(intBetween(rng, 3, 320)),
    lastOrderAt: null,
    lifetimeOrders: 0,
    netRevenue: 0,
    contributionLtv: 0,
    codRiskScore: intBetween(rng, 2, 35),
    returnRate: 0,
    serviceRisk: "none",
    ownerId: null,
    sourceConfidence: 0.8 + rng() * 0.19,
    notes: [],
    segments: [],
    objections: [],
  };
}

/* ---------- hand-authored heroes ---------- */

const HEROES: Customer[] = [
  {
    id: "CUS-0007",
    displayName: "Aina Rahman",
    brandIds: ["BRD-lipidri"],
    primaryMarket: "MY",
    identities: [
      { id: "CUS-0007-ph", type: "phone", value: "+60 12-000 0107", isPrimary: true, isVerified: true, sourceIntegrationId: "INT-woo" },
      { id: "CUS-0007-wa", type: "whatsapp", value: "+60 12-000 0107", isPrimary: false, isVerified: true, sourceIntegrationId: null },
      { id: "CUS-0007-em", type: "email", value: "aina.rahman7@example.com", isPrimary: false, isVerified: true, sourceIntegrationId: "INT-woo" },
      { id: "CUS-0007-sh", type: "shopee_handle", value: "aina.r_demo", isPrimary: false, isVerified: false, sourceIntegrationId: "INT-shopee" },
    ],
    consents: [
      { channel: "whatsapp", purpose: "marketing", status: "granted", capturedAt: daysAgo(88) },
      { channel: "whatsapp", purpose: "transactional", status: "granted", capturedAt: daysAgo(120) },
      { channel: "email", purpose: "marketing", status: "revoked", capturedAt: daysAgo(30) },
    ],
    addresses: [
      { id: "CUS-0007-ad1", label: "Home", recipient: "Aina Rahman", line1: "12, Jalan Demo 4/2", city: "Petaling Jaya", state: "Selangor", postcode: "47301", country: "MY", isDefault: true },
    ],
    lifecycleState: "active",
    valueTier: "high",
    repeatState: "repeat",
    firstSeenAt: daysAgo(120),
    lastOrderAt: daysAgo(2, 14),
    lifetimeOrders: 3,
    netRevenue: 0, // recomputed from orders
    contributionLtv: 0,
    codRiskScore: 8,
    returnRate: 0,
    serviceRisk: "open_case",
    ownerId: "USR-ida",
    sourceConfidence: 0.97,
    notes: [
      "Prefers WhatsApp; buys Omega-3 roughly every 45 days.",
      "Asked about krill oil on last conversation — follow up after current shipment lands.",
    ],
    segments: ["Replenishment due", "WhatsApp engaged", "Omega-3 buyers"],
    objections: ["Worried about fishy aftertaste (handled — enteric coating)"],
  },
  {
    id: "CUS-0002",
    displayName: "Melissa Chong",
    brandIds: ["BRD-verdana"],
    primaryMarket: "MY",
    identities: [
      { id: "CUS-0002-ph", type: "phone", value: "+60 12-000 0102", isPrimary: true, isVerified: true, sourceIntegrationId: "INT-woo" },
      { id: "CUS-0002-em", type: "email", value: "melissa.chong2@example.com", isPrimary: false, isVerified: true, sourceIntegrationId: "INT-woo" },
      { id: "CUS-0002-tk", type: "tiktok_handle", value: "mel.c_demo", isPrimary: false, isVerified: false, sourceIntegrationId: "INT-tiktok" },
    ],
    consents: [
      { channel: "whatsapp", purpose: "marketing", status: "unknown", capturedAt: null },
      { channel: "email", purpose: "marketing", status: "granted", capturedAt: daysAgo(60) },
    ],
    addresses: [
      { id: "CUS-0002-ad1", label: "Home", recipient: "Melissa Chong", line1: "8, Jalan Demo 9/3", city: "Kuala Lumpur", state: "WP Kuala Lumpur", postcode: "50480", country: "MY", isDefault: true },
    ],
    lifecycleState: "active",
    valueTier: "mid",
    repeatState: "repeat",
    firstSeenAt: daysAgo(95),
    lastOrderAt: null,
    lifetimeOrders: 0,
    netRevenue: 0,
    contributionLtv: 0,
    codRiskScore: 5,
    returnRate: 0,
    serviceRisk: "none",
    ownerId: null,
    sourceConfidence: 0.92,
    notes: ["Came in via TikTok Spark ad; waiting on toner restock."],
    segments: ["Toner waitlist", "Routine builders"],
    objections: [],
  },
  {
    id: "CUS-0003",
    displayName: "Ryan Goh",
    brandIds: ["BRD-solstice"],
    primaryMarket: "SG",
    identities: [
      { id: "CUS-0003-ph", type: "phone", value: "+65 8000 0103", isPrimary: true, isVerified: true, sourceIntegrationId: "INT-woo" },
      { id: "CUS-0003-em", type: "email", value: "ryan.goh3@example.com", isPrimary: false, isVerified: true, sourceIntegrationId: "INT-woo" },
    ],
    consents: [
      { channel: "email", purpose: "marketing", status: "granted", capturedAt: daysAgo(40) },
      { channel: "whatsapp", purpose: "transactional", status: "granted", capturedAt: daysAgo(40) },
    ],
    addresses: [
      { id: "CUS-0003-ad1", label: "Home", recipient: "Ryan Goh", line1: "Blk 123 Demo Avenue 4, #08-12", city: "Singapore", state: "East", postcode: "469001", country: "SG", isDefault: true },
    ],
    lifecycleState: "new",
    valueTier: "mid",
    repeatState: "first_time",
    firstSeenAt: daysAgo(12),
    lastOrderAt: null,
    lifetimeOrders: 0,
    netRevenue: 0,
    contributionLtv: 0,
    codRiskScore: 3,
    returnRate: 0,
    serviceRisk: "none",
    ownerId: null,
    sourceConfidence: 0.95,
    notes: [],
    segments: ["SG new customers"],
    objections: [],
  },
];

/* ---------- generated long tail ---------- */

const generated: Customer[] = [];
for (let i = 100; i < 560; i++) {
  const market = i % 9 === 0 ? "SG" : "MY";
  generated.push(makeCustomer(i, market));
}

export const CUSTOMERS: Customer[] = [...HEROES, ...generated];
export const CUSTOMER_BY_ID = Object.fromEntries(CUSTOMERS.map((c) => [c.id, c]));
