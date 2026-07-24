import type { AutomationRule, NotificationTemplateInfo } from "@/lib/domain/types";

/**
 * Post-purchase automation rules and message templates. The rule IDs match
 * the actors already stamped throughout the order evidence timelines
 * (R-12 auto-approval, W-3 SLA watchdog, …) so run counts on the
 * Automations page are computed from the same events the order pages show.
 */

export const AUTOMATION_RULES: AutomationRule[] = [
  {
    id: "R-12",
    name: "Auto-approval",
    trigger: "order_created",
    description:
      "Approves incoming orders that pass fraud, duplicate, and stock checks; anything else stays in review.",
    category: "order_review",
    priority: 10,
    status: "active",
    ownerId: "USR-jun",
    brandScope: [],
  },
  {
    id: "R-8",
    name: "Address validation",
    trigger: "order_created",
    description:
      "Checks postcode serviceability against courier coverage; unserviceable addresses hold the order with reason ADDRESS_UNSERVICEABLE.",
    category: "address",
    priority: 20,
    status: "active",
    ownerId: "USR-jun",
    brandScope: [],
  },
  {
    id: "R-21",
    name: "Payment retry exhausted",
    trigger: "payment_failed",
    description:
      "After the gateway's automatic retries are exhausted, raises a payment exception and assigns it to the Sales/CS queue.",
    category: "payment",
    priority: 30,
    status: "active",
    ownerId: "USR-ida",
    brandScope: [],
  },
  {
    id: "R-30",
    name: "Bundle split",
    trigger: "order_approved",
    description:
      "Explodes bundle SKUs into component SKUs for fulfilment. Fails when a bundle mapping is missing (see ORD-1095).",
    category: "bundle",
    priority: 40,
    status: "active",
    ownerId: "USR-jun",
    brandScope: ["BRD-lipidri"],
  },
  {
    id: "W-3",
    name: "SLA watchdog — courier movement",
    trigger: "hourly schedule",
    description:
      "Raises a shipment exception when a parcel has no courier scan for 48 hours; assigns to the owning team.",
    category: "sla",
    priority: 50,
    status: "active",
    ownerId: "USR-jun",
    brandScope: [],
  },
  {
    id: "R-44",
    name: "Replenishment nudge",
    trigger: "order_delivered + 40 days",
    description:
      "Queues a WhatsApp replenishment reminder for consumable SKUs (subject to marketing consent). Currently paused pending template T-09 re-approval.",
    category: "lifecycle",
    priority: 60,
    status: "paused",
    ownerId: "USR-farah",
    brandScope: ["BRD-lipidri"],
  },
];

export const NOTIFICATION_TEMPLATES: NotificationTemplateInfo[] = [
  {
    id: "T-02",
    name: "Order confirmation",
    channel: "whatsapp",
    purpose: "transactional",
    status: "approved",
    codVariant: true,
    brandIds: [],
    note: null,
  },
  {
    id: "T-05",
    name: "Tracking number sent",
    channel: "whatsapp",
    purpose: "transactional",
    status: "approved",
    codVariant: false,
    brandIds: [],
    note: null,
  },
  {
    id: "T-14",
    name: "Delivery delay notice",
    channel: "whatsapp",
    purpose: "transactional",
    status: "approved",
    codVariant: false,
    brandIds: [],
    note: "Used by REC-0025 (East Malaysia monsoon backlog) and the stalled-shipment escalation.",
  },
  {
    id: "T-09",
    name: "Health-category confirmation (Lipidri)",
    channel: "whatsapp",
    purpose: "transactional",
    status: "pending_review",
    codVariant: true,
    brandIds: ["BRD-lipidri"],
    note: "Rejected by WhatsApp health-vertical review; resubmitted with claims-gated copy. ORD-1104's failed confirmation traces here.",
  },
  {
    id: "T-11",
    name: "COD collection reminder",
    channel: "whatsapp",
    purpose: "transactional",
    status: "approved",
    codVariant: true,
    brandIds: [],
    note: null,
  },
  {
    id: "T-20",
    name: "Replenishment reminder",
    channel: "whatsapp",
    purpose: "marketing",
    status: "approved",
    codVariant: false,
    brandIds: ["BRD-lipidri"],
    note: "Marketing purpose — suppressed automatically for customers without WhatsApp marketing consent.",
  },
];
