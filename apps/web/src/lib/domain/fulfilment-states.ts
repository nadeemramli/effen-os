/**
 * Fulfilment state dimensions and CRM dispatch vocabulary — mirror the
 * fulfilment_crm_shadow_v1 migration (program plan Phase 6, R23 / R24).
 * Six independent facts per order; the UI may group them but never merges
 * them. carrier_state is carrier evidence only.
 */

export const NV_STATES = ["not_submitted", "shadow_generated", "submission_queued", "submitted", "processing", "pending_pickup", "awb_available", "awb_cached", "awb_printed", "cancelled", "failed"] as const;
export type NvState = (typeof NV_STATES)[number];

export const WAREHOUSE_STATES = ["not_released", "released", "picking", "picked", "packing", "packed", "ready_for_handover", "handed_over", "exception"] as const;
export type WarehouseState = (typeof WAREHOUSE_STATES)[number];

export const CARRIER_STATES = ["not_created", "pending_pickup", "driver_dispatched", "picked_up", "in_transit", "out_for_delivery", "delivered", "delivery_exception", "rejected", "rts", "returned", "cancelled"] as const;
export type CarrierState = (typeof CARRIER_STATES)[number];

export const NOTIFICATION_STATES = ["not_required", "scheduled", "shadow_logged", "sent", "delivered", "failed", "suppressed", "cancelled"] as const;
export type NotificationState = (typeof NOTIFICATION_STATES)[number];

type Tone = "neutral" | "success" | "warning" | "destructive" | "info";

export const NV_STATE_META: Record<NvState, { label: string; tone: Tone }> = {
  not_submitted: { label: "Not submitted", tone: "neutral" },
  shadow_generated: { label: "Shadow payload", tone: "info" },
  submission_queued: { label: "Queued", tone: "info" },
  submitted: { label: "Submitted", tone: "info" },
  processing: { label: "Processing", tone: "info" },
  pending_pickup: { label: "Pending pickup", tone: "info" },
  awb_available: { label: "AWB available", tone: "success" },
  awb_cached: { label: "AWB downloaded", tone: "success" },
  awb_printed: { label: "AWB printed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  failed: { label: "Failed", tone: "destructive" },
};

export const WAREHOUSE_STATE_META: Record<WarehouseState, { label: string; tone: Tone }> = {
  not_released: { label: "Not released", tone: "neutral" },
  released: { label: "Released", tone: "info" },
  picking: { label: "Picking", tone: "info" },
  picked: { label: "Picked", tone: "info" },
  packing: { label: "Packing", tone: "info" },
  packed: { label: "Packed", tone: "info" },
  ready_for_handover: { label: "Ready for handover", tone: "info" },
  handed_over: { label: "Handed over", tone: "success" },
  exception: { label: "Exception", tone: "warning" },
};

export const CARRIER_STATE_META: Record<CarrierState, { label: string; tone: Tone }> = {
  not_created: { label: "No carrier order", tone: "neutral" },
  pending_pickup: { label: "Pending pickup", tone: "info" },
  driver_dispatched: { label: "Driver dispatched", tone: "info" },
  picked_up: { label: "Picked up", tone: "info" },
  in_transit: { label: "In transit", tone: "info" },
  out_for_delivery: { label: "Out for delivery", tone: "info" },
  delivered: { label: "Delivered", tone: "success" },
  delivery_exception: { label: "Delivery exception", tone: "warning" },
  rejected: { label: "Rejected", tone: "destructive" },
  rts: { label: "Return to sender", tone: "warning" },
  returned: { label: "Returned", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export const NOTIFICATION_STATE_META: Record<NotificationState, { label: string; tone: Tone }> = {
  not_required: { label: "Not required", tone: "neutral" },
  scheduled: { label: "Scheduled", tone: "info" },
  shadow_logged: { label: "Shadow logged", tone: "info" },
  sent: { label: "Sent", tone: "success" },
  delivered: { label: "Delivered", tone: "success" },
  failed: { label: "Failed", tone: "destructive" },
  suppressed: { label: "Suppressed", tone: "warning" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export interface AwbRow {
  order_read_id: number;
  integration_id: number;
  brand_id: number | null;
  order_ref: string;
  customer_name: string | null;
  city: string | null;
  postcode: string | null;
  total: number;
  currency_code: string;
  source_status: string;
  placed_at: string | null;
  stage: string;
  gate_issues: string[];
  eligible_at: string | null;
  held_by: string | null;
  hold_reason: string | null;
  nv_state: NvState;
  warehouse_state: WarehouseState;
  carrier_state: CarrierState;
  notification_state: NotificationState;
  tracking_id: string | null;
  awb_cached_at: string | null;
  awb_cached_by: string | null;
  awb_printed_at: string | null;
  awb_printed_by: string | null;
  released_to_warehouse_at: string | null;
  handed_over_at: string | null;
  handed_over_by: string | null;
  carrier_picked_up_at: string | null;
  carrier_last_status: string | null;
  carrier_last_event_at: string | null;
  states_synced_at: string | null;
  qc_id: number | null;
  qc_state: string | null;
  fulfilment_release_state: string | null;
  qc_version: number | null;
  submission_status: string | null;
  submission_compare: string | null;
  submission_at: string | null;
}

export interface AwbManager {
  status: "ok";
  mode: "shadow";
  gate: string;
  stores: { integration_id: number; name: string; fulfilment_mode: string }[];
  synced_at: string | null;
  window_days: number;
  summary: {
    rows: number;
    by_nv_state: Record<string, number> | null;
    by_warehouse_state: Record<string, number> | null;
    by_carrier_state: Record<string, number> | null;
    released_awaiting_awb: number;
    awb_to_print: number;
    printed_awaiting_handover: number;
    handed_over_awaiting_pickup: number;
  };
  rows: AwbRow[];
}

export interface FulfilmentStateEvent {
  id: number;
  order_read_id: number;
  dimension: "nv" | "warehouse" | "carrier" | "notification" | "release";
  from_state: string | null;
  to_state: string;
  source: "operator" | "carrier" | "system" | "qc";
  actor_label: string;
  note: string | null;
  evidence: Record<string, unknown> | null;
  created_at: string;
}

/* ---------- CRM dispatch ---------- */

export type DispatchStatus = "blocked" | "shadow_logged" | "queued" | "sent" | "delivered" | "failed" | "cancelled" | "superseded";

export const DISPATCH_STATUS_META: Record<DispatchStatus, { label: string; tone: Tone }> = {
  blocked: { label: "Blocked", tone: "warning" },
  shadow_logged: { label: "Shadow logged", tone: "info" },
  queued: { label: "Queued", tone: "info" },
  sent: { label: "Sent", tone: "success" },
  delivered: { label: "Delivered", tone: "success" },
  failed: { label: "Failed", tone: "destructive" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  superseded: { label: "Superseded", tone: "neutral" },
};

export const BLOCK_REASON_LABELS: Record<string, string> = {
  no_consent_source: "No consent / suppression source is connected to Fullkit",
  no_phone: "Customer has no phone on file",
  email_adapter_unverified: "No verified e-mail adapter",
  template_unverified: "Template is a draft; not approved at the provider",
  transport_unverified: "Strive endpoint / account not verified",
  frequency_cap_24h: "Another contact was logged for this customer in the last 24 h",
};

export interface DispatchRequest {
  id: number;
  identity_key: string;
  order_read_id: number | null;
  model: "order" | "product" | "campaign";
  purpose: string;
  trigger_event: string;
  channel: "whatsapp" | "email" | "call";
  template_key: string | null;
  template_version: number | null;
  recipient_masked: string | null;
  variables: Record<string, unknown>;
  priority: number;
  eligibility: Record<string, unknown>;
  decision: "blocked" | "eligible";
  block_reasons: string[];
  status: DispatchStatus;
  transport: "strive" | "email" | "manual";
  transport_mode: "shadow" | "live";
  transport_ref: string | null;
  transport_envelope: Record<string, unknown> | null;
  note: string | null;
  created_at: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
}

export interface DispatchTemplate {
  key: string;
  version: number;
  channel: "whatsapp" | "email";
  model: "order" | "product" | "campaign";
  purpose: string;
  language: string;
  body_preview: string;
  variables: string[];
  status: "draft" | "verified" | "retired";
}

export const DISPATCH_PURPOSES = [
  { value: "qc_request_info", label: "Request missing information", model: "order" },
  { value: "order_confirmation", label: "Order confirmation", model: "order" },
  { value: "processing_ack", label: "Processing acknowledgement", model: "order" },
  { value: "in_transit", label: "On the way (tracking)", model: "order" },
  { value: "delivered_onboarding", label: "Delivered onboarding", model: "order" },
  { value: "delivery_exception", label: "Delivery exception guidance", model: "order" },
] as const;
