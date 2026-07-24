import { createStore } from "zustand/vanilla";
import type { OperatingMode, RoleKey, Severity } from "@/lib/domain/enums";
import type {
  AppNotification,
  AuditEvent,
  Order,
  OrderStateEvent,
  Recommendation,
} from "@/lib/domain/types";
import { DEMO_NOW } from "@/lib/seed/clock";
import { assertSeedInvariants, composeSeedSnapshot, type SeedSnapshot } from "@/lib/seed";

/**
 * Client-side prototype state. Entities are seeded deterministically; every
 * mutating action also appends an audit event (and, for orders, a state
 * event) so "no dead buttons" and "everything is auditable" hold together.
 */

export type DateRangeKey = "today" | "7d" | "30d";

export interface SessionState {
  role: RoleKey;
  mode: OperatingMode;
  brandId: string | "all";
  dateRange: DateRangeKey;
  /** Signed-in Supabase user email (null in open demo mode). */
  authEmail: string | null;
  /** True when the role comes from a real membership and must not be switched
   *  (non-admins); hq_admin keeps the switcher as an impersonation tool. */
  roleLocked: boolean;
}

export interface AppState extends SeedSnapshot {
  session: SessionState;
  /** Sequence for runtime-created ids (audit/events/orders). */
  seq: number;

  setRole: (role: RoleKey) => void;
  setAuthSession: (auth: { email: string | null; role?: RoleKey; roleLocked?: boolean }) => void;
  setMode: (mode: OperatingMode) => void;
  setBrand: (brandId: string | "all") => void;
  setDateRange: (r: DateRangeKey) => void;
  markNotificationsRead: () => void;
  pushNotification: (n: Omit<AppNotification, "id" | "at" | "read">) => void;
  resetDemoData: () => void;

  assignOrder: (orderId: string, ownerId: string, actorName: string) => void;
  addOrderNote: (orderId: string, note: string, actorName: string) => void;
  resendNotification: (orderId: string, actorName: string) => void;
  cancelOrder: (orderId: string, reason: string, actorName: string) => void;
  approveOrder: (orderId: string, actorName: string) => void;
  submitDraftOrder: (order: Order, events: OrderStateEvent[], actorName: string) => void;

  decideRecommendation: (
    recId: string,
    decision: "approved" | "rejected" | "scheduled" | "evidence_requested",
    rationale: string,
    actorId: string,
    actorName: string,
  ) => void;
  assignRecommendation: (recId: string, ownerId: string, actorName: string) => void;

  advanceFulfillment: (
    orderId: string,
    to: "picking" | "packed" | "handed_over",
    actorName: string,
  ) => void;
  advanceCreative: (briefId: string, actorName: string) => void;
  advanceWorkOrder: (workOrderId: string, actorName: string) => void;
  setWorkOrderQc: (workOrderId: string, state: "passed" | "hold", reason: string | null, actorName: string) => void;
  decideCommission: (statementId: string, to: "approved" | "released", actorName: string) => void;
  adjustStock: (sku: string, delta: number, reason: string, actorName: string) => void;
  toggleAutomationRule: (ruleId: string, actorName: string) => void;
  acknowledgeDqIssue: (id: string, actorName: string) => void;
  retrySync: (integrationId: string, actorName: string) => void;
  connectAdAccount: (input: {
    platform: "meta" | "google" | "tiktok";
    accountName: string;
    externalId: string;
    brandId: string;
    legalEntityId: string;
    market: "MY" | "SG";
    currency: "MYR" | "SGD";
    purpose: string;
    ownerId: string;
    scopes: string[];
  }) => void;
  completeWorkItem: (id: string, actorName: string) => void;
}

let runtimeClock = DEMO_NOW.getTime();
/** Runtime action timestamps tick forward a few seconds per action so
 *  ordering is stable without touching the real clock. */
function nextActionTime(): string {
  runtimeClock += 15_000;
  return new Date(runtimeClock).toISOString();
}

export function createAppStore() {
  assertSeedInvariants();
  const seed = composeSeedSnapshot();

  return createStore<AppState>()((set, get) => {
    const audit = (
      actorId: string,
      actorName: string,
      action: string,
      entityRef: string,
      detail: string,
    ): AuditEvent => ({
      id: `AUD-R${String(get().seq).padStart(4, "0")}`,
      at: nextActionTime(),
      actorId,
      actorName,
      action,
      entityRef,
      detail,
    });

    const withAudit = (
      state: AppState,
      actorName: string,
      action: string,
      entityRef: string,
      detail: string,
    ) => ({
      seq: state.seq + 1,
      auditEvents: [
        audit(
          state.personas.find((p) => p.name === actorName)?.id ?? "system",
          actorName,
          action,
          entityRef,
          detail,
        ),
        ...state.auditEvents,
      ],
    });

    const orderEvent = (
      state: AppState,
      orderId: string,
      actorName: string,
      dimension: OrderStateEvent["dimension"],
      toState: string | null,
      message: string,
      reasonCode: string | null = null,
    ): OrderStateEvent => ({
      id: `EVT-R${String(state.seq).padStart(4, "0")}`,
      orderId,
      at: nextActionTime(),
      actorType: "user",
      actorName,
      dimension,
      fromState: null,
      toState,
      reasonCode,
      message,
    });

    const patchOrder = (orders: Order[], id: string, patch: Partial<Order>) =>
      orders.map((o) => (o.id === id ? { ...o, ...patch } : o));

    return {
      ...seed,
      session: {
        role: "hq_admin",
        mode: "demo",
        brandId: "all",
        dateRange: "7d",
        authEmail: null,
        roleLocked: false,
      },
      seq: 1,

      setRole: (role) => set((s) => ({ session: { ...s.session, role } })),
      setAuthSession: ({ email, role, roleLocked }) =>
        set((s) => ({
          session: {
            ...s.session,
            authEmail: email,
            role: role ?? s.session.role,
            roleLocked: roleLocked ?? s.session.roleLocked,
          },
        })),
      setMode: (mode) => set((s) => ({ session: { ...s.session, mode } })),
      setBrand: (brandId) => set((s) => ({ session: { ...s.session, brandId } })),
      setDateRange: (dateRange) => set((s) => ({ session: { ...s.session, dateRange } })),

      markNotificationsRead: () =>
        set((s) => ({ notifications: s.notifications.map((n) => ({ ...n, read: true })) })),

      pushNotification: (n) =>
        set((s) => ({
          seq: s.seq + 1,
          notifications: [
            { ...n, id: `NTF-R${String(s.seq).padStart(4, "0")}`, at: nextActionTime(), read: false },
            ...s.notifications,
          ],
        })),

      resetDemoData: () => {
        const fresh = composeSeedSnapshot();
        set((s) => ({ ...fresh, session: s.session, seq: 1 }));
      },

      assignOrder: (orderId, ownerId, actorName) =>
        set((s) => {
          const owner = s.personas.find((p) => p.id === ownerId);
          return {
            orders: patchOrder(s.orders, orderId, { ownerId }),
            orderEvents: [
              ...s.orderEvents,
              orderEvent(s, orderId, actorName, "system", null, `Assigned to ${owner?.name ?? ownerId}.`),
            ],
            ...withAudit(s, actorName, "order.assigned", `order:${orderId}`, `Assigned to ${owner?.name ?? ownerId}`),
          };
        }),

      addOrderNote: (orderId, note, actorName) =>
        set((s) => ({
          orderEvents: [
            ...s.orderEvents,
            orderEvent(s, orderId, actorName, "note", null, note),
          ],
          ...withAudit(s, actorName, "order.note_added", `order:${orderId}`, note.slice(0, 80)),
        })),

      resendNotification: (orderId, actorName) =>
        set((s) => ({
          orders: patchOrder(s.orders, orderId, { notificationStatus: "sent" }),
          orderEvents: [
            ...s.orderEvents,
            orderEvent(s, orderId, actorName, "notification", "sent", "Confirmation re-sent via WhatsApp template T-02."),
          ],
          ...withAudit(s, actorName, "order.notification_resent", `order:${orderId}`, "Resent WhatsApp confirmation"),
        })),

      cancelOrder: (orderId, reason, actorName) =>
        set((s) => ({
          orders: patchOrder(s.orders, orderId, { orderStatus: "cancelled", nextAction: null }),
          orderEvents: [
            ...s.orderEvents,
            orderEvent(s, orderId, actorName, "order", "cancelled", `Cancelled: ${reason}`, "MANUAL_CANCELLATION"),
          ],
          ...withAudit(s, actorName, "order.cancelled", `order:${orderId}`, reason),
        })),

      approveOrder: (orderId, actorName) =>
        set((s) => ({
          orders: patchOrder(s.orders, orderId, {
            orderStatus: "approved",
            exceptionStatus: "none",
            nextAction: null,
          }),
          orderEvents: [
            ...s.orderEvents,
            orderEvent(s, orderId, actorName, "order", "approved", "Manually reviewed and approved."),
          ],
          ...withAudit(s, actorName, "order.approved", `order:${orderId}`, "Manual approval after review"),
        })),

      submitDraftOrder: (order, events, actorName) =>
        set((s) => ({
          orders: [order, ...s.orders],
          orderEvents: [...s.orderEvents, ...events],
          ...withAudit(s, actorName, "order.draft_created", `order:${order.id}`, `Draft ${order.id} created via order form`),
        })),

      decideRecommendation: (recId, decision, rationale, actorId, actorName) =>
        set((s) => {
          const rec = s.recommendations.find((r) => r.id === recId);
          if (!rec) return s;
          const statusMap: Record<string, Recommendation["status"]> = {
            approved: "approved",
            rejected: "rejected",
            scheduled: "scheduled",
            evidence_requested: "evidence_requested",
          };
          const decidedAt = nextActionTime();
          const newWorkItems =
            decision === "approved"
              ? [
                  {
                    id: `WRK-R${String(s.seq).padStart(4, "0")}`,
                    title: `Execute: ${rec.title}`,
                    entityRef: `recommendation:${rec.id}`,
                    ownerId: rec.ownerId,
                    severity: rec.risk === "high" ? ("high" as Severity) : ("medium" as Severity),
                    dueAt: rec.dueAt,
                    nextAction: rec.proposedAction.split(";")[0] ?? rec.proposedAction,
                    status: "open" as const,
                  },
                ]
              : [];
          return {
            recommendations: s.recommendations.map((r) =>
              r.id === recId ? { ...r, status: statusMap[decision] ?? r.status } : r,
            ),
            decisions: [
              {
                id: `DEC-R${String(s.seq).padStart(4, "0")}`,
                recommendationId: recId,
                recommendationTitle: rec.title,
                decision,
                decidedBy: actorId,
                decidedAt,
                rationale,
                outcome: null,
              },
              ...s.decisions,
            ],
            workItems: [
              ...newWorkItems,
              ...s.workItems.map((w) =>
                w.entityRef === `recommendation:${recId}` ? { ...w, status: "done" as const } : w,
              ),
            ],
            ...withAudit(s, actorName, `recommendation.${decision}`, `recommendation:${recId}`, rationale || rec.title),
          };
        }),

      assignRecommendation: (recId, ownerId, actorName) =>
        set((s) => {
          const owner = s.personas.find((p) => p.id === ownerId);
          return {
            recommendations: s.recommendations.map((r) => (r.id === recId ? { ...r, ownerId } : r)),
            ...withAudit(s, actorName, "recommendation.assigned", `recommendation:${recId}`, `Owner → ${owner?.name ?? ownerId}`),
          };
        }),

      advanceCreative: (briefId, actorName) =>
        set((s) => {
          const order = ["idea", "brief", "production", "review", "live"] as const;
          const brief = s.creativeBriefs.find((b) => b.id === briefId);
          if (!brief || brief.stage === "live") return s;
          const next = order[order.indexOf(brief.stage) + 1]!;
          return {
            creativeBriefs: s.creativeBriefs.map((b) =>
              b.id === briefId ? { ...b, stage: next } : b,
            ),
            ...withAudit(s, actorName, `creative.${next}`, `creative:${briefId}`, `${brief.title} → ${next}`),
          };
        }),

      advanceWorkOrder: (workOrderId, actorName) =>
        set((s) => {
          const order = ["planned", "materials", "production", "qc", "fg_received"] as const;
          const wo = s.workOrders.find((w) => w.id === workOrderId);
          if (!wo || wo.stage === "fg_received") return s;
          const next = order[order.indexOf(wo.stage) + 1]!;
          return {
            workOrders: s.workOrders.map((w) =>
              w.id === workOrderId
                ? { ...w, stage: next, blockedBy: null, yieldPct: next === "fg_received" ? w.yieldPct ?? 97.5 : w.yieldPct }
                : w,
            ),
            ...withAudit(s, actorName, `work_order.${next}`, `wo:${workOrderId}`, `${wo.id} (${wo.sku}) → ${next}`),
          };
        }),

      setWorkOrderQc: (workOrderId, state, reason, actorName) =>
        set((s) => ({
          workOrders: s.workOrders.map((w) =>
            w.id === workOrderId ? { ...w, qcState: state, qcReason: reason } : w,
          ),
          ...withAudit(s, actorName, `work_order.qc_${state}`, `wo:${workOrderId}`, reason ?? `QC ${state}`),
        })),

      decideCommission: (statementId, to, actorName) =>
        set((s) => ({
          commissionStatements: s.commissionStatements.map((c) =>
            c.id === statementId ? { ...c, status: to } : c,
          ),
          ...withAudit(s, actorName, `commission.${to}`, `commission:${statementId}`, `Statement ${to}`),
        })),

      advanceFulfillment: (orderId, to, actorName) =>
        set((s) => {
          const order = s.orders.find((o) => o.id === orderId);
          if (!order) return s;
          const patch: Partial<Order> = { fulfillmentStatus: to };
          const events: OrderStateEvent[] = [];
          if (to === "picking") {
            events.push(orderEvent(s, orderId, actorName, "fulfillment", "picking", "Pick started at KL fulfilment centre."));
          }
          if (to === "packed") {
            patch.courier = order.courier ?? (order.market === "SG" ? "ninja_van" : "ninja_van");
            patch.trackingNumber =
              order.trackingNumber ?? `NVMY777${String(10000 + s.seq).slice(-5)}`;
            patch.shipmentStatus = order.shipmentStatus === "not_shipped" ? "label_created" : order.shipmentStatus;
            events.push(
              orderEvent(s, orderId, actorName, "fulfillment", "packed", "Packed and weight-checked."),
              orderEvent(s, orderId, actorName, "shipment", "label_created", `AWB ${patch.trackingNumber} created at pack station.`),
            );
          }
          if (to === "handed_over") {
            patch.nextAction = null;
            events.push(
              orderEvent(s, orderId, actorName, "fulfillment", "handed_over", `Handed to ${order.courier === "jnt" ? "J&T" : "Ninja Van"} on today's manifest. Awaiting first courier scan.`),
            );
          }
          return {
            orders: patchOrder(s.orders, orderId, patch),
            orderEvents: [...s.orderEvents, ...events],
            ...withAudit(s, actorName, `fulfilment.${to}`, `order:${orderId}`, events[0]?.message ?? to),
          };
        }),

      adjustStock: (sku, delta, reason, actorName) =>
        set((s) => {
          let applied = false;
          const products = s.products.map((p) => {
            if (!p.variants.some((v) => v.sku === sku)) return p;
            applied = true;
            return {
              ...p,
              variants: p.variants.map((v) =>
                v.sku === sku ? { ...v, onHand: Math.max(0, v.onHand + delta) } : v,
              ),
            };
          });
          if (!applied) return s;
          return {
            products,
            ...withAudit(
              s,
              actorName,
              "inventory.adjusted",
              `sku:${sku}`,
              `${delta > 0 ? "+" : ""}${delta} units · ${reason}`,
            ),
          };
        }),

      toggleAutomationRule: (ruleId, actorName) =>
        set((s) => {
          const rule = s.automationRules.find((r) => r.id === ruleId);
          if (!rule) return s;
          const next = rule.status === "active" ? "paused" : "active";
          return {
            automationRules: s.automationRules.map((r) =>
              r.id === ruleId ? { ...r, status: next as "active" | "paused" } : r,
            ),
            ...withAudit(s, actorName, `automation.${next}`, `rule:${ruleId}`, `${rule.name} ${next}`),
          };
        }),

      acknowledgeDqIssue: (id, actorName) =>
        set((s) => ({
          dqIssues: s.dqIssues.map((i) => (i.id === id ? { ...i, status: "acknowledged" as const } : i)),
          ...withAudit(s, actorName, "dq.acknowledged", `dq:${id}`, "Issue acknowledged"),
        })),

      retrySync: (integrationId, actorName) =>
        set((s) => {
          const integration = s.integrations.find((i) => i.id === integrationId);
          if (!integration) return s;
          const at = nextActionTime();
          // A retry cannot fix expired credentials — it fails with the same
          // reason, which is itself informative in the sync history.
          const willSucceed = integration.status !== "stale" || integrationId === "INT-rudderstack";
          const run = {
            id: `SYN-R${String(s.seq).padStart(4, "0")}`,
            integrationId,
            startedAt: at,
            finishedAt: at,
            status: willSucceed ? ("success" as const) : ("failed" as const),
            recordsRead: willSucceed ? 132 : 0,
            recordsWritten: willSucceed ? 132 : 0,
            errorCount: willSucceed ? 0 : 1,
            reasonCode: willSucceed ? null : "AUTH_TOKEN_EXPIRED",
            message: willSucceed
              ? "Manual retry completed. Checkpoint advanced."
              : "Manual retry failed — credentials expired. Re-authorization required.",
          };
          return {
            syncRuns: [run, ...s.syncRuns],
            integrations: s.integrations.map((i) =>
              i.id === integrationId && willSucceed
                ? { ...i, status: "healthy" as const, lastSuccessAt: at, errorCount24h: 0 }
                : i,
            ),
            ...withAudit(s, actorName, "integration.retry_sync", `integration:${integrationId}`, run.message),
          };
        }),

      connectAdAccount: (input) =>
        set((s) => {
          const at = nextActionTime();
          const accId = `ACC-R${String(s.seq).padStart(4, "0")}`;
          const intId = `INT-R${String(s.seq).padStart(4, "0")}`;
          return {
            adAccounts: [
              {
                id: accId,
                platform: input.platform,
                externalId: input.externalId,
                name: input.accountName,
                brandId: input.brandId,
                legalEntityId: input.legalEntityId,
                market: input.market,
                currency: input.currency,
                purpose: input.purpose,
                ownerId: input.ownerId,
                scopes: input.scopes,
                status: "connected" as const,
                lastSyncAt: at,
              },
              ...s.adAccounts,
            ],
            integrations: [
              ...s.integrations.map((i) => i),
              {
                id: intId,
                name: `${input.accountName} (new)`,
                provider: input.platform === "meta" ? "Meta" : input.platform === "google" ? "Google" : "TikTok",
                category: "ads" as const,
                environment: "production" as const,
                direction: "read" as const,
                readScopes: input.scopes,
                writeScopes: [],
                brandScope: [input.brandId],
                ownerId: input.ownerId,
                status: "healthy" as const,
                lastSuccessAt: at,
                lastFailureAt: null,
                freshnessSlaMinutes: 240,
                syncCheckpoint: "initial sync complete — 90 days of history",
                errorCount24h: 0,
                credentialRotatesAt: null,
                notes: "Connected via the account wizard in this demo session.",
              },
            ],
            ...withAudit(
              s,
              s.personas.find((p) => p.id === input.ownerId)?.name ?? "Demo user",
              "integration.connected",
              `integration:${intId}`,
              `Connected ${input.accountName} (${input.externalId}) — read-only scopes`,
            ),
          };
        }),

      completeWorkItem: (id, actorName) =>
        set((s) => ({
          workItems: s.workItems.map((w) => (w.id === id ? { ...w, status: "done" as const } : w)),
          ...withAudit(s, actorName, "work_item.completed", `work:${id}`, "Marked done"),
        })),
    };
  });
}

export type AppStore = ReturnType<typeof createAppStore>;
