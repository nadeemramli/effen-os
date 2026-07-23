import type { AppStore } from "@/lib/store";
import type { ConnectAdAccountInput, Repository } from "./types";

/**
 * Default repository: reads and writes the seeded in-memory store.
 * The acting persona is resolved from the current demo role so audit
 * entries carry a human owner.
 */
export class MockRepository implements Repository {
  readonly kind = "mock" as const;

  constructor(private store: AppStore) {}

  get mode() {
    return this.store.getState().session.mode;
  }

  private actor() {
    const s = this.store.getState();
    const persona = s.personas.find((p) => p.role === s.session.role);
    return { id: persona?.id ?? "USR-nadeem", name: persona?.name ?? "Nadeem" };
  }

  async getOrder(id: string) {
    return this.store.getState().orders.find((o) => o.id === id) ?? null;
  }
  async getOrderEvents(orderId: string) {
    return this.store
      .getState()
      .orderEvents.filter((e) => e.orderId === orderId)
      .sort((a, b) => (a.at < b.at ? -1 : 1));
  }
  async getCustomer(id: string) {
    return this.store.getState().customers.find((c) => c.id === id) ?? null;
  }
  async getIntegration(id: string) {
    return this.store.getState().integrations.find((i) => i.id === id) ?? null;
  }
  async getSyncRuns(integrationId: string) {
    return this.store
      .getState()
      .syncRuns.filter((r) => r.integrationId === integrationId)
      .sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  }

  async assignOrder(orderId: string, ownerId: string) {
    this.store.getState().assignOrder(orderId, ownerId, this.actor().name);
  }
  async addOrderNote(orderId: string, note: string) {
    this.store.getState().addOrderNote(orderId, note, this.actor().name);
  }
  async resendOrderNotification(orderId: string) {
    this.store.getState().resendNotification(orderId, this.actor().name);
  }
  async approveOrder(orderId: string) {
    this.store.getState().approveOrder(orderId, this.actor().name);
  }
  async cancelOrder(orderId: string, reason: string) {
    this.store.getState().cancelOrder(orderId, reason, this.actor().name);
  }
  async submitDraftOrder(order: Parameters<Repository["submitDraftOrder"]>[0], events: Parameters<Repository["submitDraftOrder"]>[1]) {
    this.store.getState().submitDraftOrder(order, events, this.actor().name);
  }

  async decideRecommendation(
    recId: string,
    decision: "approved" | "rejected" | "scheduled" | "evidence_requested",
    rationale: string,
  ) {
    const a = this.actor();
    this.store.getState().decideRecommendation(recId, decision, rationale, a.id, a.name);
  }
  async assignRecommendation(recId: string, ownerId: string) {
    this.store.getState().assignRecommendation(recId, ownerId, this.actor().name);
  }

  async acknowledgeDqIssue(id: string) {
    this.store.getState().acknowledgeDqIssue(id, this.actor().name);
  }
  async retrySync(integrationId: string) {
    this.store.getState().retrySync(integrationId, this.actor().name);
  }
  async connectAdAccount(input: ConnectAdAccountInput) {
    this.store.getState().connectAdAccount(input);
  }
  async completeWorkItem(id: string) {
    this.store.getState().completeWorkItem(id, this.actor().name);
  }
}
