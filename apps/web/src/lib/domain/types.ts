/**
 * Fullkit typed domain models.
 * Naming follows the Schema Blueprint (docs/Fullkit Schema Blueprint.md).
 * Money is integer minor units (sen / cents) — see money.ts.
 * All timestamps are ISO strings offset from the demo clock (lib/seed/clock.ts).
 */

import type {
  ActorType,
  AdPlatform,
  ChannelType,
  CurrencyCode,
  ExceptionStatus,
  FreshnessState,
  FulfillmentStatus,
  IntegrationStatus,
  MarketCode,
  NotificationStatus,
  OrderStatus,
  PaymentStatus,
  QualityGrade,
  RecommendationStatus,
  ReturnStatus,
  ReviewState,
  RoleKey,
  Severity,
  ShipmentStatus,
  SourceType,
  StateDimension,
  SyncDirection,
} from "./enums";

/* ---------- organization ---------- */

export interface Workspace {
  id: string;
  name: string;
  timezone: string;
  baseCurrency: CurrencyCode;
}

export interface LegalEntity {
  id: string;
  name: string;
  registrationNumber: string;
  country: MarketCode;
  defaultCurrency: CurrencyCode;
}

export interface Brand {
  id: string;
  name: string;
  slug: string;
  legalEntityId: string;
  markets: MarketCode[];
  currencies: CurrencyCode[];
  domains: string[];
  status: "active" | "upcoming";
  isDemo: boolean;
  category: string;
  senderPolicy: string;
  claimsPolicy: string;
  rules: string[];
}

export interface StoreChannel {
  id: string;
  brandId: string;
  legalEntityId: string;
  name: string;
  channelType: ChannelType;
  sourceType: SourceType;
  market: MarketCode;
  currency: CurrencyCode;
  domain?: string;
}

export interface Persona {
  id: string;
  name: string;
  role: RoleKey;
  title: string;
  initials: string;
}

/* ---------- customers ---------- */

export interface CustomerIdentity {
  id: string;
  type: "phone" | "email" | "shopee_handle" | "tiktok_handle" | "whatsapp";
  value: string;
  isPrimary: boolean;
  isVerified: boolean;
  sourceIntegrationId: string | null;
}

export interface CustomerConsent {
  channel: "whatsapp" | "email" | "sms";
  purpose: "marketing" | "transactional";
  status: "granted" | "revoked" | "unknown";
  capturedAt: string | null;
}

export interface Customer {
  id: string;
  displayName: string;
  brandIds: string[];
  primaryMarket: MarketCode;
  identities: CustomerIdentity[];
  consents: CustomerConsent[];
  addresses: {
    id: string;
    label: string;
    recipient: string;
    line1: string;
    city: string;
    state: string;
    postcode: string;
    country: MarketCode;
    isDefault: boolean;
  }[];
  lifecycleState: "new" | "active" | "at_risk" | "dormant" | "provisional";
  valueTier: "vip" | "high" | "mid" | "low";
  repeatState: "first_time" | "repeat" | "loyal";
  firstSeenAt: string;
  lastOrderAt: string | null;
  lifetimeOrders: number;
  netRevenue: number; // minor units, MYR-normalized for display per currency of orders
  contributionLtv: number;
  codRiskScore: number; // 0..100
  returnRate: number; // 0..1
  serviceRisk: "none" | "open_case" | "escalated";
  ownerId: string | null;
  sourceConfidence: number; // identity-resolution confidence 0..1
  notes: string[];
  segments: string[];
  objections: string[];
}

/* ---------- catalog & inventory ---------- */

export interface VariantPrice {
  market: MarketCode;
  currency: CurrencyCode;
  amount: number;
  effectiveFrom: string;
}

export interface ProductVariant {
  id: string;
  sku: string;
  name: string;
  aliases: string[];
  barcode: string | null;
  prices: VariantPrice[];
  cogs: number; // minor units in brand base currency
  onHand: number;
  reserved: number;
  reorderPoint: number;
}

export interface Product {
  id: string;
  brandId: string;
  name: string;
  category: string;
  description: string;
  status: "active" | "discontinued";
  reviewState: ReviewState;
  version: number;
  ownerId: string;
  effectiveFrom: string;
  variants: ProductVariant[];
  bundleOf: { variantId: string; quantity: number }[] | null;
  approvedClaims: string[];
  prohibitedClaims: string[];
  faqs: { q: string; a: string }[];
  usage: string;
  warnings: string[];
  targetCustomer: string;
  objectionHandling: { objection: string; response: string }[];
  mappings: { system: string; externalId: string; status: "mapped" | "unmapped" }[];
}

/* ---------- orders ---------- */

export interface OrderItem {
  variantId: string;
  sku: string;
  nameSnapshot: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
}

export interface OrderStateEvent {
  id: string;
  orderId: string;
  at: string;
  actorType: ActorType;
  actorName: string;
  dimension: StateDimension | "note" | "system";
  fromState: string | null;
  toState: string | null;
  reasonCode: string | null;
  message: string;
}

export interface Order {
  id: string; // display id e.g. ORD-1042
  workspaceId: string;
  brandId: string;
  storeId: string;
  legalEntityId: string;
  customerId: string;
  sourceType: SourceType;
  sourceOrderId: string | null;
  integrationId: string | null;
  campaignId: string | null;
  currency: CurrencyCode;
  market: MarketCode;
  items: OrderItem[];
  subtotal: number;
  discountTotal: number;
  shippingTotal: number;
  taxTotal: number;
  grandTotal: number;
  refundedTotal: number;
  orderStatus: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  shipmentStatus: ShipmentStatus;
  notificationStatus: NotificationStatus;
  returnStatus: ReturnStatus;
  exceptionStatus: ExceptionStatus;
  paymentMethod: "chip" | "stripe" | "hitpay" | "billplz" | "cod" | "marketplace";
  courier: "ninja_van" | "jnt" | null;
  trackingNumber: string | null;
  ownerId: string | null;
  slaRisk: Severity | null;
  nextAction: string | null;
  placedAt: string;
  isNewCustomer: boolean;
  isDraft: boolean;
}

/* ---------- marketing ---------- */

export interface CampaignDaily {
  date: string; // yyyy-mm-dd
  spend: number;
  platformRevenue: number;
  fullkitOrders: number;
  newCustomers: number;
}

export interface AdEntity {
  id: string;
  name: string;
  level: "ad_set" | "ad";
  status: "active" | "paused";
  spend: number;
  platformRevenue: number;
  creative?: string;
  landingPage?: string;
  productSku?: string;
}

export interface Campaign {
  id: string;
  name: string;
  platform: AdPlatform;
  accountId: string;
  brandId: string;
  market: MarketCode;
  currency: CurrencyCode;
  objective: string;
  status: "active" | "paused" | "ended";
  targetMer: number; // e.g. 3.0
  daily: CampaignDaily[];
  children: AdEntity[];
  productSkus: string[];
}

export interface AdAccount {
  id: string;
  platform: AdPlatform;
  externalId: string;
  name: string;
  brandId: string | null; // null = unmapped
  legalEntityId: string | null;
  market: MarketCode;
  currency: CurrencyCode;
  purpose: string;
  ownerId: string | null;
  scopes: string[];
  status: "connected" | "token_expired" | "unmapped";
  lastSyncAt: string;
}

/* ---------- integrations & data health ---------- */

export interface SyncRun {
  id: string;
  integrationId: string;
  startedAt: string;
  finishedAt: string | null;
  status: "success" | "partial" | "failed" | "running";
  recordsRead: number;
  recordsWritten: number;
  errorCount: number;
  reasonCode: string | null;
  message: string | null;
}

export interface Integration {
  id: string;
  name: string;
  provider: string;
  category:
    | "commerce"
    | "ads"
    | "marketplace"
    | "payments"
    | "logistics"
    | "cdp"
    | "analytics"
    | "accounting";
  environment: "production" | "sandbox";
  direction: SyncDirection;
  readScopes: string[];
  writeScopes: string[];
  brandScope: string[]; // brand ids, empty = workspace-wide
  ownerId: string;
  status: IntegrationStatus;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  freshnessSlaMinutes: number;
  syncCheckpoint: string | null;
  errorCount24h: number;
  credentialRotatesAt: string | null;
  notes: string;
}

export interface DataQualityIssue {
  id: string;
  title: string;
  detail: string;
  severity: Severity;
  category:
    | "freshness"
    | "mapping"
    | "reconciliation"
    | "sync_failure"
    | "definition";
  integrationId: string | null;
  entityRef: string | null;
  ownerId: string | null;
  status: "open" | "acknowledged" | "resolved";
  openedAt: string;
}

export interface MetricDefinition {
  key: string;
  name: string;
  formula: string;
  grain: string;
  sourceIntegrationIds: string[];
  freshness: FreshnessState;
  quality: QualityGrade;
  caveat: string | null;
}

/* ---------- prophit ---------- */

export interface BusinessTarget {
  id: string;
  brandId: string;
  metricKey: string;
  period: string;
  targetValue: number;
  owner: string;
  scenario: "base" | "stretch";
}

export interface DailyPlanPoint {
  date: string;
  brandId: string;
  expectedContribution: number;
  actualContribution: number;
  expectedRevenue: number;
  actualRevenue: number;
  adSpend: number;
}

export interface Diagnosis {
  id: string;
  title: string;
  brandId: string;
  variance: string;
  drivers: { rank: number; driver: string; impact: number; evidence: string }[];
  confidence: number; // 0..1
  methodologyVersion: string;
}

export interface Recommendation {
  id: string;
  title: string;
  summary: string;
  brandId: string;
  diagnosisId: string | null;
  proposedAction: string;
  expectedContributionImpact: number; // minor units
  currency: CurrencyCode;
  confidence: number;
  risk: Severity;
  riskNote: string;
  reversibility: "reversible" | "partially_reversible" | "irreversible";
  dependencies: string[];
  ownerId: string;
  dueAt: string;
  expiresAt: string;
  status: RecommendationStatus;
  automationLevel: "L0" | "L1" | "L2";
  evidence: string[];
  source: "prophit_read_side";
  relatedEntityRefs: string[];
}

export interface DecisionRecord {
  id: string;
  recommendationId: string;
  recommendationTitle: string;
  decision: "approved" | "rejected" | "scheduled" | "evidence_requested" | "expired";
  decidedBy: string;
  decidedAt: string;
  rationale: string;
  outcome: OutcomeRecord | null;
}

export interface OutcomeRecord {
  measuredAt: string;
  expectedImpact: number;
  measuredImpact: number;
  attributionConfidence: number;
  note: string;
}

/* ---------- workflow ---------- */

export interface WorkItem {
  id: string;
  title: string;
  entityRef: string; // e.g. "order:ORD-1042"
  ownerId: string;
  severity: Severity;
  dueAt: string;
  nextAction: string;
  status: "open" | "done";
}

export interface AuditEvent {
  id: string;
  at: string;
  actorId: string;
  actorName: string;
  action: string;
  entityRef: string;
  detail: string;
}

export interface AppNotification {
  id: string;
  at: string;
  title: string;
  detail: string;
  severity: Severity;
  href: string | null;
  read: boolean;
}

/* ---------- automation ---------- */

export interface AutomationRule {
  id: string; // e.g. R-12
  name: string;
  trigger: string;
  description: string;
  category: "order_review" | "payment" | "address" | "bundle" | "sla" | "lifecycle";
  priority: number;
  status: "active" | "paused";
  ownerId: string;
  brandScope: string[]; // empty = all brands
}

export interface NotificationTemplateInfo {
  id: string; // e.g. T-02
  name: string;
  channel: "whatsapp" | "email";
  purpose: "transactional" | "marketing";
  status: "approved" | "pending_review" | "rejected";
  codVariant: boolean;
  brandIds: string[]; // empty = all brands
  note: string | null;
}

/* ---------- creative (S2) ---------- */

export interface CreativeBrief {
  id: string; // CRE-0001
  title: string;
  brandId: string;
  stage: "idea" | "brief" | "production" | "review" | "live";
  format: string; // e.g. "UGC video", "Static carousel"
  angle: string;
  campaignId: string | null;
  adId: string | null;
  ownerId: string;
  dueAt: string;
  fatigueReplacement: boolean;
  claimsCheck: "not_required" | "pending" | "passed";
  note: string | null;
}

/* ---------- production (P5) ---------- */

export interface BomLine {
  material: string;
  uom: string;
  perUnit: number;
  onHand: number;
}

export interface WorkOrder {
  id: string; // WO-0008
  brandId: string;
  sku: string;
  productName: string;
  quantity: number;
  stage: "planned" | "materials" | "production" | "qc" | "fg_received";
  batchNo: string;
  expiryDate: string;
  yieldPct: number | null;
  qcState: "pending" | "passed" | "hold";
  qcReason: string | null;
  blockedBy: string | null;
  dueAt: string;
  bom: BomLine[];
}

/* ---------- finance / commission (P6) ---------- */

export type CommissionTier = "junior" | "senior";

export interface ChannelPull {
  channel: "Fighter" | "Shopee" | "Lazada" | "TikTok";
  state: "processed" | "processing_required" | "pending" | "blocked";
  note: string | null;
}

/** One person's monthly statement, mirroring the operational P&L structure:
 *  Sales (package) + COD + Sabah/Sarawak postage − product/delivery/return/
 *  COD/marketing costs = profit → tiered commission. Money in minor units. */
export interface CommissionStatement {
  id: string; // COM-2607-HAI
  period: string;
  personName: string; // synthetic
  tier: CommissionTier;
  salesPackage: number;
  cod: number;
  ssPostage: number;
  productCost: number;
  deliveryCost: number;
  returnCost: number;
  codCost: number;
  marketingCost: number;
  status: "processing" | "pending_approval" | "approved" | "released";
  channels: ChannelPull[];
}

/* ---------- reports ---------- */

export interface ReportDefinition {
  slug: string;
  name: string;
  description: string;
  grain: string;
  metricKeys: string[];
  sourceIntegrationIds: string[];
  exportRoles: RoleKey[];
  status: "governed" | "draft";
}
