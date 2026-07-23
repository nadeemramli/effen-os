import type { StateDimension } from "./enums";

/**
 * Single source of truth for status presentation.
 * Tone maps to the five semantic roles + neutral; components never
 * hardcode status colors.
 */

export type StatusTone =
  | "neutral"
  | "success"
  | "warning"
  | "destructive"
  | "info"
  | "ai";

export interface StatusMeta {
  label: string;
  tone: StatusTone;
}

type StatusMap = Record<string, StatusMeta>;

export const ORDER_STATUS_MAP: StatusMap = {
  draft: { label: "Draft", tone: "neutral" },
  pending_review: { label: "Pending review", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  completed: { label: "Completed", tone: "success" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  rejected: { label: "Rejected", tone: "destructive" },
};

export const PAYMENT_STATUS_MAP: StatusMap = {
  unpaid: { label: "Unpaid", tone: "neutral" },
  pending_verification: { label: "Verifying", tone: "warning" },
  paid: { label: "Paid", tone: "success" },
  cod_pending: { label: "COD pending", tone: "info" },
  cod_collected: { label: "COD collected", tone: "success" },
  failed: { label: "Payment failed", tone: "destructive" },
  partially_refunded: { label: "Part-refunded", tone: "warning" },
  refunded: { label: "Refunded", tone: "neutral" },
};

export const FULFILLMENT_STATUS_MAP: StatusMap = {
  unfulfilled: { label: "Unfulfilled", tone: "neutral" },
  picking: { label: "Picking", tone: "info" },
  packed: { label: "Packed", tone: "info" },
  handed_over: { label: "Handed over", tone: "success" },
  fulfilled: { label: "Fulfilled", tone: "success" },
  on_hold: { label: "On hold", tone: "warning" },
};

export const SHIPMENT_STATUS_MAP: StatusMap = {
  not_shipped: { label: "Not shipped", tone: "neutral" },
  label_created: { label: "Label created", tone: "info" },
  in_transit: { label: "In transit", tone: "info" },
  out_for_delivery: { label: "Out for delivery", tone: "info" },
  delivered: { label: "Delivered", tone: "success" },
  delivery_failed: { label: "Delivery failed", tone: "destructive" },
  returned_to_sender: { label: "Returned to sender", tone: "warning" },
};

export const NOTIFICATION_STATUS_MAP: StatusMap = {
  none: { label: "No messages", tone: "neutral" },
  queued: { label: "Queued", tone: "neutral" },
  sent: { label: "Sent", tone: "info" },
  delivered: { label: "Msg delivered", tone: "success" },
  failed: { label: "Msg failed", tone: "destructive" },
};

export const RETURN_STATUS_MAP: StatusMap = {
  none: { label: "No return", tone: "neutral" },
  requested: { label: "Return requested", tone: "warning" },
  approved: { label: "Return approved", tone: "info" },
  in_transit: { label: "Return in transit", tone: "info" },
  received: { label: "Return received", tone: "info" },
  refunded: { label: "Return refunded", tone: "neutral" },
  rejected: { label: "Return rejected", tone: "destructive" },
};

export const EXCEPTION_STATUS_MAP: StatusMap = {
  none: { label: "No exception", tone: "neutral" },
  payment_exception: { label: "Payment exception", tone: "destructive" },
  fulfilment_exception: { label: "Fulfilment exception", tone: "destructive" },
  shipment_exception: { label: "Shipment exception", tone: "destructive" },
  automation_failed: { label: "Automation failed", tone: "destructive" },
  address_issue: { label: "Address issue", tone: "warning" },
};

export const DIMENSION_MAPS: Record<StateDimension, StatusMap> = {
  order: ORDER_STATUS_MAP,
  payment: PAYMENT_STATUS_MAP,
  fulfillment: FULFILLMENT_STATUS_MAP,
  shipment: SHIPMENT_STATUS_MAP,
  notification: NOTIFICATION_STATUS_MAP,
  return: RETURN_STATUS_MAP,
};

export const DIMENSION_LABELS: Record<StateDimension, string> = {
  order: "Order",
  payment: "Payment",
  fulfillment: "Fulfilment",
  shipment: "Shipment",
  notification: "Notification",
  return: "Return",
};

export function statusMeta(dimension: StateDimension, value: string): StatusMeta {
  return DIMENSION_MAPS[dimension][value] ?? { label: value, tone: "neutral" };
}

/** Badge classes per tone — subtle wash + readable text in both themes. */
export const TONE_CLASSES: Record<StatusTone, string> = {
  neutral: "bg-muted text-muted-foreground border-transparent",
  success: "bg-success/12 text-success border-success/25",
  warning: "bg-warning/12 text-warning border-warning/25",
  destructive: "bg-destructive/12 text-destructive border-destructive/25",
  info: "bg-info/12 text-info border-info/25",
  ai: "bg-ai/12 text-ai border-ai/25",
};

export const TONE_DOT_CLASSES: Record<StatusTone, string> = {
  neutral: "bg-muted-foreground",
  success: "bg-success",
  warning: "bg-warning",
  destructive: "bg-destructive",
  info: "bg-info",
  ai: "bg-ai",
};
