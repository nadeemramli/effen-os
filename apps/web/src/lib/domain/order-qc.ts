/**
 * Order QC vocabulary — mirrors public.order_qc / order_qc_events (program
 * plan Phase 4, R17–R19). The database enforces the transition table; this
 * module only names things and decides what the UI offers.
 */

export const QC_STATES = ["new", "in_review", "needs_customer_info", "on_hold", "approved", "rejected", "cancelled"] as const;
export type QcState = (typeof QC_STATES)[number];

export const QC_OPEN_STATES: QcState[] = ["new", "in_review", "needs_customer_info", "on_hold"];

export const QC_STATE_LABELS: Record<QcState, string> = {
  new: "New",
  in_review: "In review",
  needs_customer_info: "Needs customer info",
  on_hold: "On hold",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled at source",
};

export const QC_STATE_TONES: Record<QcState, "neutral" | "success" | "warning" | "destructive" | "info"> = {
  new: "info",
  in_review: "info",
  needs_customer_info: "warning",
  on_hold: "warning",
  approved: "success",
  rejected: "destructive",
  cancelled: "neutral",
};

/** Reason codes v1 — one per QC checklist row (plan §4). */
export const QC_REASON_CODES = [
  { code: "recipient_identity", label: "Recipient identity unclear" },
  { code: "phone_invalid", label: "Phone invalid" },
  { code: "email_missing", label: "E-mail missing" },
  { code: "address_incomplete", label: "Address incomplete" },
  { code: "postcode_state_mismatch", label: "Postcode / state mismatch" },
  { code: "product_unmapped", label: "Product unmapped" },
  { code: "quantity_bundle", label: "Quantity / bundle check" },
  { code: "stock_shortage", label: "Stock shortage" },
  { code: "payment_cod_unresolved", label: "Payment / COD unresolved" },
  { code: "duplicate_risk", label: "Duplicate risk" },
  { code: "courier_unserviceable", label: "Courier unserviceable" },
  { code: "consent_contact", label: "Consent / contact" },
] as const;
export type QcReasonCode = (typeof QC_REASON_CODES)[number]["code"];

export function reasonLabel(code: string): string {
  return QC_REASON_CODES.find((r) => r.code === code)?.label ?? code;
}

/** Ship-readiness issue keys → the reason code a reviewer would most likely pick. */
export const READINESS_TO_REASON: Record<string, QcReasonCode> = {
  phone: "phone_invalid",
  postcode: "postcode_state_mismatch",
  state: "postcode_state_mismatch",
  address: "address_incomplete",
  name: "recipient_identity",
};

export const QC_ACTIONS = ["start_review", "request_information", "correct_and_revalidate", "hold", "assign", "approve", "reject", "enrolled", "source_cancelled"] as const;
export type QcAction = (typeof QC_ACTIONS)[number];

export const QC_ACTION_LABELS: Record<QcAction, string> = {
  start_review: "Started review",
  request_information: "Requested information",
  correct_and_revalidate: "Corrected & revalidated",
  hold: "Put on hold",
  assign: "Assigned",
  approve: "Approved",
  reject: "Rejected",
  enrolled: "Entered QC",
  source_cancelled: "Cancelled at source",
};

/** Which commands the UI offers per state; the server enforces the same table. */
export const QC_ALLOWED: Record<QcState, QcAction[]> = {
  new: ["start_review", "request_information", "correct_and_revalidate", "hold", "assign", "approve", "reject"],
  in_review: ["request_information", "correct_and_revalidate", "hold", "assign", "approve", "reject"],
  needs_customer_info: ["start_review", "correct_and_revalidate", "hold", "assign", "approve", "reject"],
  on_hold: ["start_review", "request_information", "correct_and_revalidate", "assign", "approve", "reject"],
  approved: [],
  rejected: [],
  cancelled: [],
};

export interface OrderQc {
  id: number;
  workspace_id: number;
  source: "woo" | "draft";
  order_read_id: number | null;
  draft_id: number | null;
  qc_state: QcState;
  reason_codes: string[];
  owner_membership_id: number | null;
  due_at: string | null;
  last_contact_attempt_at: string | null;
  reservation_state: string;
  fulfilment_release_state: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface OrderQcEvent {
  id: number;
  order_qc_id: number;
  action: QcAction | string;
  from_state: QcState | null;
  to_state: QcState;
  reason_codes: string[];
  note: string | null;
  actor_membership_id: number | null;
  actor_label: string;
  version: number;
  created_at: string;
}

export interface WorkspaceMember {
  membership_id: number;
  display_name: string;
  role_key: string;
}

/* ---------- drafts ---------- */

export interface DraftItem {
  sku: string | null;
  name: string | null;
  quantity: number;
  unit_price: number;
}

export interface OrderDraft {
  id: number;
  workspace_id: number;
  integration_id: number;
  brand_id: number | null;
  currency_code: string;
  customer: { name?: string; phone?: string; email?: string };
  shipping: { address_1?: string; address_2?: string; city?: string; state?: string; postcode?: string };
  items: DraftItem[];
  payment_method: "cod" | "online";
  note: string | null;
  total: number;
  status: "draft" | "confirmed" | "discarded";
  idempotency_key: string;
  created_by_membership_id: number | null;
  confirmed_at: string | null;
  discarded_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export function draftTotal(items: DraftItem[]): number {
  return items.reduce((s, i) => s + Number(i.quantity) * Number(i.unit_price), 0);
}
