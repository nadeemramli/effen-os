import type {
  Brand,
  LegalEntity,
  Persona,
  StoreChannel,
  Workspace,
} from "@/lib/domain/types";

export const WORKSPACE: Workspace = {
  id: "WS-effen",
  name: "EFFEN International Sdn Bhd",
  timezone: "Asia/Kuala_Lumpur",
  baseCurrency: "MYR",
};

export const LEGAL_ENTITIES: LegalEntity[] = [
  {
    id: "LE-my",
    name: "EFFEN International Sdn Bhd",
    registrationNumber: "202501000001 (DEMO)",
    country: "MY",
    defaultCurrency: "MYR",
  },
  {
    id: "LE-sg",
    name: "EFFEN Commerce Pte Ltd (Demo)",
    registrationNumber: "202500002D (DEMO)",
    country: "SG",
    defaultCurrency: "SGD",
  },
];

export const BRANDS: Brand[] = [
  {
    id: "BRD-lipidri",
    name: "Lipidri MY",
    slug: "lipidri-my",
    legalEntityId: "LE-my",
    markets: ["MY"],
    currencies: ["MYR"],
    domains: ["lipidri.example"],
    status: "active",
    isDemo: false,
    category: "Health supplements",
    senderPolicy:
      "WhatsApp sender: dedicated Lipidri number. Health vertical — templates require compliance review before send.",
    claimsPolicy:
      "Substantiated-claims gate: only claims on the approved list may appear in ads, chat replies, or product pages. Therapeutic claims are prohibited.",
    rules: [
      "COD allowed up to RM300 per order",
      "No discount stacking above 20%",
      "Chat orders require payment verification before fulfilment",
    ],
  },
  {
    id: "BRD-verdana",
    name: "Verdana Botanics (Demo)",
    slug: "verdana-botanics",
    legalEntityId: "LE-my",
    markets: ["MY"],
    currencies: ["MYR"],
    domains: ["verdana.example"],
    status: "active",
    isDemo: true,
    category: "Skincare",
    senderPolicy: "Shared EFFEN sender pool. Standard templates.",
    claimsPolicy: "Cosmetic claims only; no medicinal claims.",
    rules: ["Free shipping above RM120", "COD not offered"],
  },
  {
    id: "BRD-nara",
    name: "Nara Coffee Co. (Demo)",
    slug: "nara-coffee",
    legalEntityId: "LE-my",
    markets: ["MY"],
    currencies: ["MYR"],
    domains: ["naracoffee.example"],
    status: "active",
    isDemo: true,
    category: "F&B — coffee",
    senderPolicy: "Shared EFFEN sender pool.",
    claimsPolicy: "Food-grade claims only; roast dates must be accurate.",
    rules: ["Subscription orders ship on Mondays"],
  },
  {
    id: "BRD-solstice",
    name: "Solstice Living (Demo)",
    slug: "solstice-living",
    legalEntityId: "LE-sg",
    markets: ["SG"],
    currencies: ["SGD"],
    domains: ["solsticeliving.example"],
    status: "active",
    isDemo: true,
    category: "Home & living",
    senderPolicy: "Email-first brand; WhatsApp transactional only.",
    claimsPolicy: "No safety claims beyond certified lab results.",
    rules: ["SG deliveries via Ninja Van SG only"],
  },
];

export const STORES: StoreChannel[] = [
  { id: "ST-lip-woo", brandId: "BRD-lipidri", legalEntityId: "LE-my", name: "Lipidri Web Store", channelType: "website", sourceType: "woocommerce", market: "MY", currency: "MYR", domain: "lipidri.example" },
  { id: "ST-lip-shopee", brandId: "BRD-lipidri", legalEntityId: "LE-my", name: "Lipidri Shopee MY", channelType: "marketplace", sourceType: "shopee", market: "MY", currency: "MYR" },
  { id: "ST-lip-tiktok", brandId: "BRD-lipidri", legalEntityId: "LE-my", name: "Lipidri TikTok Shop", channelType: "marketplace", sourceType: "tiktok_shop", market: "MY", currency: "MYR" },
  { id: "ST-lip-wa", brandId: "BRD-lipidri", legalEntityId: "LE-my", name: "Lipidri WhatsApp CS", channelType: "conversation", sourceType: "whatsapp", market: "MY", currency: "MYR" },
  { id: "ST-ver-woo", brandId: "BRD-verdana", legalEntityId: "LE-my", name: "Verdana Web Store", channelType: "website", sourceType: "woocommerce", market: "MY", currency: "MYR", domain: "verdana.example" },
  { id: "ST-ver-lazada", brandId: "BRD-verdana", legalEntityId: "LE-my", name: "Verdana Lazada MY", channelType: "marketplace", sourceType: "lazada", market: "MY", currency: "MYR" },
  { id: "ST-nara-woo", brandId: "BRD-nara", legalEntityId: "LE-my", name: "Nara Web Store", channelType: "website", sourceType: "woocommerce", market: "MY", currency: "MYR", domain: "naracoffee.example" },
  { id: "ST-sol-woo", brandId: "BRD-solstice", legalEntityId: "LE-sg", name: "Solstice Web Store", channelType: "website", sourceType: "woocommerce", market: "SG", currency: "SGD", domain: "solsticeliving.example" },
];

export const PERSONAS: Persona[] = [
  { id: "USR-nadeem", name: "Nadeem", role: "hq_admin", title: "HQ Admin", initials: "ND" },
  { id: "USR-ida", name: "Ida", role: "sales_cs", title: "Customer Service Lead", initials: "ID" },
  { id: "USR-farah", name: "Farah Aziz (Demo)", role: "marketing_growth", title: "Growth Marketer", initials: "FA" },
  { id: "USR-jun", name: "Jun Wei (Demo)", role: "operations", title: "Operations", initials: "JW" },
  { id: "USR-mei", name: "Mei Ling (Demo)", role: "finance", title: "Finance", initials: "ML" },
  { id: "USR-arif", name: "Arif Hakim (Demo)", role: "analyst", title: "Analyst", initials: "AH" },
];

export const PERSONA_BY_ID = Object.fromEntries(PERSONAS.map((p) => [p.id, p]));
