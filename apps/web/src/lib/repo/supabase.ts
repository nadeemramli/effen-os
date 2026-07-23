import { NotConfiguredError } from "./errors";
import type { Repository } from "./types";

/**
 * Prepared Supabase adapter — NOT active in the prototype.
 *
 * When Fullkit connects to Supabase (Slice 1+), this class will use
 * @supabase/supabase-js with the PUBLISHABLE (anon) key only — the
 * service-role key must never reach browser code. Table mapping follows
 * the Schema Blueprint:
 *
 *   orders / order_items / order_state_events
 *   customers / customer_identities / customer_consents
 *   integration_connections / sync_runs / data_quality_issues
 *   recommendations / approvals / work_items / audit_events
 *   metric_definitions / saved_views / memberships / membership_brand_scopes
 *
 * All tables sit behind RLS; writes go through guarded RPCs with
 * idempotency keys, never direct table inserts from the browser.
 */
export class SupabaseRepository implements Repository {
  readonly kind = "supabase" as const;
  readonly mode = "shadow" as const;

  static isConfigured(): boolean {
    return Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
  }

  constructor() {
    if (!SupabaseRepository.isConfigured()) {
      throw new NotConfiguredError("SupabaseRepository");
    }
  }

  private unavailable(what: string): never {
    throw new NotConfiguredError(what);
  }

  async getOrder(): Promise<never> {
    return this.unavailable("orders read model");
  }
  async getOrderEvents(): Promise<never> {
    return this.unavailable("order_state_events read model");
  }
  async getCustomer(): Promise<never> {
    return this.unavailable("customer 360 read model");
  }
  async getIntegration(): Promise<never> {
    return this.unavailable("integration_connections");
  }
  async getSyncRuns(): Promise<never> {
    return this.unavailable("sync_runs");
  }
  async assignOrder(): Promise<never> {
    return this.unavailable("order assignment RPC");
  }
  async addOrderNote(): Promise<never> {
    return this.unavailable("order notes RPC");
  }
  async resendOrderNotification(): Promise<never> {
    return this.unavailable("notification RPC");
  }
  async approveOrder(): Promise<never> {
    return this.unavailable("order approval RPC");
  }
  async cancelOrder(): Promise<never> {
    return this.unavailable("order cancellation RPC");
  }
  async submitDraftOrder(): Promise<never> {
    return this.unavailable("draft order RPC");
  }
  async decideRecommendation(): Promise<never> {
    return this.unavailable("approvals RPC");
  }
  async assignRecommendation(): Promise<never> {
    return this.unavailable("recommendation assignment RPC");
  }
  async acknowledgeDqIssue(): Promise<never> {
    return this.unavailable("data_quality_issues RPC");
  }
  async retrySync(): Promise<never> {
    return this.unavailable("sync trigger RPC");
  }
  async connectAdAccount(): Promise<never> {
    return this.unavailable("integration connect flow (server-side OAuth)");
  }
  async completeWorkItem(): Promise<never> {
    return this.unavailable("work_items RPC");
  }
}
