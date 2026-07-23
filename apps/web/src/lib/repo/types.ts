import type { OperatingMode } from "@/lib/domain/enums";
import type {
  Customer,
  Integration,
  Order,
  OrderStateEvent,
  Recommendation,
  SyncRun,
} from "@/lib/domain/types";

/**
 * The repository contract Fullkit pages program against.
 *
 * Reads in the prototype are reactive Zustand selectors (see hooks/), so this
 * interface carries the WRITE side plus the non-reactive read shapes a
 * server-backed adapter will need. MockRepository (default) fulfils it against
 * the in-memory store; SupabaseRepository is the prepared server adapter.
 * Swapping adapters must not require touching page components.
 */
export interface Repository {
  readonly kind: "mock" | "supabase";
  readonly mode: OperatingMode;

  getOrder(id: string): Promise<Order | null>;
  getOrderEvents(orderId: string): Promise<OrderStateEvent[]>;
  getCustomer(id: string): Promise<Customer | null>;
  getIntegration(id: string): Promise<Integration | null>;
  getSyncRuns(integrationId: string): Promise<SyncRun[]>;

  assignOrder(orderId: string, ownerId: string): Promise<void>;
  addOrderNote(orderId: string, note: string): Promise<void>;
  resendOrderNotification(orderId: string): Promise<void>;
  approveOrder(orderId: string): Promise<void>;
  cancelOrder(orderId: string, reason: string): Promise<void>;
  submitDraftOrder(order: Order, events: OrderStateEvent[]): Promise<void>;

  decideRecommendation(
    recId: string,
    decision: "approved" | "rejected" | "scheduled" | "evidence_requested",
    rationale: string,
  ): Promise<void>;
  assignRecommendation(recId: string, ownerId: string): Promise<void>;

  acknowledgeDqIssue(id: string): Promise<void>;
  retrySync(integrationId: string): Promise<void>;
  connectAdAccount(input: ConnectAdAccountInput): Promise<void>;
  completeWorkItem(id: string): Promise<void>;
}

export interface ConnectAdAccountInput {
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
}

export type { Recommendation };
