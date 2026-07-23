/**
 * Fullkit domain enums.
 * Values are lowercase machine states (Schema Blueprint convention) —
 * UI labels live in status-maps.ts, never here.
 */

export const ORDER_STATUSES = [
  "draft",
  "pending_review",
  "approved",
  "completed",
  "cancelled",
  "rejected",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const PAYMENT_STATUSES = [
  "unpaid",
  "pending_verification",
  "paid",
  "cod_pending",
  "cod_collected",
  "failed",
  "partially_refunded",
  "refunded",
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const FULFILLMENT_STATUSES = [
  "unfulfilled",
  "picking",
  "packed",
  "handed_over",
  "fulfilled",
  "on_hold",
] as const;
export type FulfillmentStatus = (typeof FULFILLMENT_STATUSES)[number];

export const SHIPMENT_STATUSES = [
  "not_shipped",
  "label_created",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "delivery_failed",
  "returned_to_sender",
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

export const NOTIFICATION_STATUSES = [
  "none",
  "queued",
  "sent",
  "delivered",
  "failed",
] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

export const RETURN_STATUSES = [
  "none",
  "requested",
  "approved",
  "in_transit",
  "received",
  "refunded",
  "rejected",
] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

export const EXCEPTION_STATUSES = [
  "none",
  "payment_exception",
  "fulfilment_exception",
  "shipment_exception",
  "automation_failed",
  "address_issue",
] as const;
export type ExceptionStatus = (typeof EXCEPTION_STATUSES)[number];

export type StateDimension =
  | "order"
  | "payment"
  | "fulfillment"
  | "shipment"
  | "notification"
  | "return";

export const ACTOR_TYPES = ["user", "system", "connector", "rule", "courier"] as const;
export type ActorType = (typeof ACTOR_TYPES)[number];

export const ROLE_KEYS = [
  "hq_admin",
  "sales_cs",
  "marketing_growth",
  "operations",
  "finance",
  "analyst",
] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

export type OperatingMode = "demo" | "shadow" | "live";

export type CurrencyCode = "MYR" | "SGD";

export type MarketCode = "MY" | "SG";

export const CHANNEL_TYPES = [
  "website",
  "marketplace",
  "conversation",
  "manual",
] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export const SOURCE_TYPES = [
  "woocommerce",
  "fighter",
  "shopee",
  "lazada",
  "tiktok_shop",
  "whatsapp",
  "manual",
] as const;
export type SourceType = (typeof SOURCE_TYPES)[number];

export type FreshnessState = "fresh" | "aging" | "stale";

export type IntegrationStatus =
  | "healthy"
  | "degraded"
  | "stale"
  | "disconnected"
  | "pending_setup";

export type SyncDirection = "read" | "write" | "read_write";

export type Severity = "low" | "medium" | "high" | "critical";

export type RecommendationStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "scheduled"
  | "evidence_requested"
  | "expired";

export type ReviewState = "draft" | "in_review" | "approved" | "deprecated";

export type QualityGrade = "trusted" | "monitored" | "degraded";

export type AdPlatform = "meta" | "google" | "tiktok" | "shopee_ads";
