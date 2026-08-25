import type { OrderDraft, OrderQc, OrderQcEvent, WorkspaceMember } from "@/lib/domain/order-qc";
import type { CohortKey, CohortSummary, WorkItem, WorkItemAction, WorkItemSeverity, WorkItemSource } from "@/lib/domain/cohorts";
import type { CustomerBaseMovement, CustomerLifecycleStates, MovementGrain, MovementMeasure, TransitionPopulation } from "@/lib/domain/lifecycle";
import type { OrderQueueCounts } from "@/lib/domain/order-views";
import { getSupabase } from "./client";

/**
 * Typed accessors for the LIVE Supabase workspace (Slice 1/2 data) — used by
 * the Setup pages. Distinct from the mock repository on purpose: these
 * surfaces are explicitly labeled "live" in the UI and never mix with the
 * seeded demo dataset.
 */

export interface LiveWooConnection {
  id: number;
  workspace_id: number;
  name: string;
  status: string;
  secret_ref: string;
  sync_checkpoint: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  error_count_24h: number;
  config: { base_url?: string | null; brand_slug?: string | null; country_code?: string | null };
  notes: string | null;
}

export interface LiveSyncRun {
  id: number;
  integration_id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  records_read: number;
  records_written: number;
  reason_code: string | null;
  message: string | null;
}

export interface LiveBrand {
  id: number;
  workspace_id: number;
  name: string;
  slug: string;
  category: string | null;
  is_demo: boolean;
  status: string;
  default_legal_entity_id: number | null;
}

export interface LiveProduct {
  id: number;
  workspace_id: number;
  brand_id: number;
  name: string;
  category: string | null;
  status: string;
}

export interface LiveVariant {
  id: number;
  workspace_id: number;
  product_id: number;
  sku: string;
  name: string;
  price: number;
  currency_code: string;
  cost: number | null;
  stock_on_hand: number;
  status: string;
}

export async function fetchWooConnections(): Promise<LiveWooConnection[]> {
  const { data, error } = await getSupabase()
    .from("integration_connections")
    .select("id, workspace_id, name, status, secret_ref, sync_checkpoint, last_success_at, last_failure_at, error_count_24h, config, notes")
    .eq("provider", "WooCommerce")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as LiveWooConnection[];
}

export async function fetchRecentRuns(integrationIds: number[]): Promise<LiveSyncRun[]> {
  if (integrationIds.length === 0) return [];
  const { data, error } = await getSupabase()
    .from("sync_runs")
    .select("*")
    .in("integration_id", integrationIds)
    .order("started_at", { ascending: false })
    .limit(20);
  if (error) throw new Error(error.message);
  return (data ?? []) as LiveSyncRun[];
}

export async function fetchOrdersReadCount(integrationId: number): Promise<number> {
  const { count, error } = await getSupabase()
    .from("orders_read")
    .select("id", { count: "exact", head: true })
    .eq("integration_id", integrationId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function saveWooConnection(input: {
  connectionId: number;
  baseUrl: string;
  consumerKey: string;
  consumerSecret: string;
}): Promise<void> {
  const { error } = await getSupabase().rpc("set_woo_connection", {
    p_connection_id: input.connectionId,
    p_base_url: input.baseUrl,
    p_consumer_key: input.consumerKey,
    p_consumer_secret: input.consumerSecret,
  });
  if (error) throw new Error(error.message);
}

export async function triggerSync(connectionId?: number, maxPages = 30): Promise<unknown> {
  const { data, error } = await getSupabase().functions.invoke("woo-sync", {
    body: connectionId ? { connection_id: connectionId, max_pages: maxPages } : { max_pages: maxPages },
  });
  if (error) throw new Error(error.message);
  return data;
}

/* ---------- WhatsApp Cloud API ---------- */

export interface LiveWaConnection {
  id: number;
  workspace_id: number;
  status: string;
  last_success_at: string | null;
  notes: string | null;
}

export interface LiveWaNumber {
  id: number;
  phone_number_id: string;
  display_number: string | null;
  brand_id: number | null;
  first_seen_at: string;
}

export async function fetchWaConnection(): Promise<LiveWaConnection | null> {
  const { data, error } = await getSupabase()
    .from("integration_connections")
    .select("id, workspace_id, status, last_success_at, notes")
    .eq("provider", "WhatsApp")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as LiveWaConnection | null;
}

export async function fetchWaNumbers(): Promise<LiveWaNumber[]> {
  const { data, error } = await getSupabase()
    .from("wa_numbers")
    .select("id, phone_number_id, display_number, brand_id, first_seen_at")
    .order("first_seen_at");
  if (error) throw new Error(error.message);
  return (data ?? []) as LiveWaNumber[];
}

export async function fetchWaCounts(): Promise<{ conversations: number; messages: number }> {
  const supabase = getSupabase();
  const [c, m] = await Promise.all([
    supabase.from("wa_conversations").select("id", { count: "exact", head: true }),
    supabase.from("wa_messages").select("id", { count: "exact", head: true }),
  ]);
  return { conversations: c.count ?? 0, messages: m.count ?? 0 };
}

/** Stores secrets in Vault; returns the verify token for the Meta dashboard. */
export async function saveWaConnection(appSecret: string, accessToken: string): Promise<string> {
  const { data, error } = await getSupabase().rpc("set_wa_connection", {
    p_app_secret: appSecret,
    p_access_token: accessToken,
  });
  if (error) throw new Error(error.message);
  return data as string;
}

export async function mapWaNumber(numberId: number, brandId: number): Promise<void> {
  const { error } = await getSupabase().rpc("map_wa_number", {
    p_number_id: numberId,
    p_brand_id: brandId,
  });
  if (error) throw new Error(error.message);
}

/* ---------- mirrored orders (read-side) ---------- */

export interface LiveOrderRow {
  id: number;
  integration_id: number;
  brand_id: number | null;
  source_order_id: string;
  order_number: string | null;
  source_status: string;
  currency_code: string;
  total: number;
  customer: { name?: string; email?: string | null; phone?: string | null; city?: string | null; postcode?: string | null; country?: string | null };
  items: { sku: string | null; name: string | null; quantity: number; total: string }[];
  raw: unknown;
  placed_at: string | null;
  updated_at_source?: string | null;
  synced_at: string;
  /** Explicit QC record (embedded); null = not enrolled. */
  order_qc?: Pick<OrderQc, "id" | "qc_state" | "reason_codes" | "owner_membership_id" | "due_at" | "version"> | null;
}

export async function fetchLiveOrders(brandId: number | null, limit = 100): Promise<LiveOrderRow[]> {
  let query = getSupabase()
    .from("orders_read")
    .select("id, integration_id, brand_id, source_order_id, order_number, source_status, currency_code, total, customer, items, raw, placed_at, synced_at")
    .order("placed_at", { ascending: false })
    .limit(limit);
  if (brandId !== null) query = query.eq("brand_id", brandId);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as LiveOrderRow[];
}

/** Server-side paginated + filtered orders query for the main Orders surface. */
export interface LiveOrdersQuery {
  page: number; // 1-based
  pageSize: number;
  brandId: number | null;
  integrationId: number | null;
  /** Market scope: restrict to these connections (top-bar country checklist). */
  integrationIn?: number[] | null;
  status: string | null;
  statusIn?: string[] | null; // saved-view status slices; ignored when `status` set
  currency: string | null;
  sinceHours: number | null;
  search: string;
  /** Saved-view QC slice: inner-join order_qc and keep these states. */
  qcStateIn?: string[] | null;
}

export interface LiveOrdersPage {
  rows: LiveOrderRow[];
  total: number;
}

export async function fetchLiveOrdersPage(q: LiveOrdersQuery): Promise<LiveOrdersPage> {
  let query = getSupabase()
    .from("orders_read")
    .select(
      `id, integration_id, brand_id, source_order_id, order_number, source_status, currency_code, total, customer, items, raw, placed_at, updated_at_source, synced_at, order_qc${q.qcStateIn && q.qcStateIn.length > 0 ? "!inner" : ""}(id, qc_state, reason_codes, owner_membership_id, due_at, version)`,
      { count: "exact" },
    );
  if (q.brandId !== null) query = query.eq("brand_id", q.brandId);
  if (q.qcStateIn && q.qcStateIn.length > 0) query = query.in("order_qc.qc_state", q.qcStateIn);
  if (q.integrationId !== null) query = query.eq("integration_id", q.integrationId);
  else if (q.integrationIn && q.integrationIn.length > 0) query = query.in("integration_id", q.integrationIn);
  if (q.status) query = query.eq("source_status", q.status);
  else if (q.statusIn && q.statusIn.length > 0) query = query.in("source_status", q.statusIn);
  if (q.currency) query = query.eq("currency_code", q.currency);
  if (q.sinceHours !== null) {
    query = query.gte("placed_at", new Date(Date.now() - q.sinceHours * 3_600_000).toISOString());
  }
  const needle = q.search.trim().replace(/[,()%]/g, "");
  if (needle) {
    query = query.or(
      [
        `order_number.ilike.%${needle}%`,
        `source_order_id.ilike.%${needle}%`,
        `customer->>name.ilike.%${needle}%`,
        `customer->>phone.ilike.%${needle}%`,
        `customer->>email.ilike.%${needle}%`,
      ].join(","),
    );
  }
  const from = (q.page - 1) * q.pageSize;
  const { data, error, count } = await query
    .order("placed_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .range(from, from + q.pageSize - 1);
  if (error) throw new Error(error.message);
  // order_qc is one-to-one (unique FK): PostgREST returns an object, but normalise
  // defensively so an array shape can never hide the QC state.
  const rows = ((data ?? []) as unknown as Array<LiveOrderRow & { order_qc?: unknown }>).map((r) => ({
    ...r,
    order_qc: Array.isArray(r.order_qc) ? ((r.order_qc[0] as LiveOrderRow["order_qc"]) ?? null) : ((r.order_qc as LiveOrderRow["order_qc"]) ?? null),
  }));
  return { rows, total: count ?? 0 };
}

/* ---------- Command Centre scorecard ---------- */

export interface LiveScorecardRow {
  win: "today" | "yesterday" | "d7" | "d30";
  brand_id: number | null;
  market: string;
  currency_code: string;
  orders: number;
  revenue: number;
}

/** Recognized revenue (processing + completed) per MYT window × brand × currency. */
export async function fetchLiveScorecard(): Promise<LiveScorecardRow[]> {
  const { data, error } = await getSupabase().rpc("live_scorecard");
  if (error) throw new Error(error.message);
  return (data ?? []) as LiveScorecardRow[];
}

export interface LivePlanBaselineRow {
  win: "today" | "yesterday" | "d7" | "d30";
  brand_id: number | null;
  market: string;
  currency_code: string;
  expected_revenue: number;
  expected_orders: number;
}

/** Statistical expectation: 4-week same-weekday average per brand × market × currency. */
export async function fetchLivePlanBaseline(): Promise<LivePlanBaselineRow[]> {
  const { data, error } = await getSupabase().rpc("live_plan_baseline");
  if (error) throw new Error(error.message);
  return (data ?? []) as LivePlanBaselineRow[];
}

/* ---------- Customer 360 read-side ---------- */

export interface LiveCustomerRow {
  identity_key: string;
  display_name: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  country: string | null;
  brand_ids: number[] | null;
  total_orders: number;
  recognized_orders: number;
  cod_orders: number;
  suspect_orders: number;
  cancelled_orders: number;
  distinct_names: number;
  first_order_at: string | null;
  last_order_at: string | null;
  revenue_by_currency: Record<string, number> | null;
  revenue_total: number;
  classification: "regular" | "reseller" | "joy_buyer";
  /** 'a:'||md5(normalized latest address); null when no order passes the address quality gate. */
  address_key: string | null;
  /** Profiles (this one included) whose latest address normalizes to the same key. Null without an address_key. */
  shared_address_count: number | null;
  total_count: number;
}

/** One declarative filter condition — fields/ops whitelisted server-side. */
export interface SegmentCondition {
  field: string;
  op: "eq" | "in" | "gte" | "lte";
  value: string | number | string[];
}

export async function fetchLiveCustomers(q: {
  page: number;
  pageSize: number;
  search: string;
  brandId: number | null;
  countries?: string[] | null;
  conditions?: SegmentCondition[] | null;
}): Promise<{ rows: LiveCustomerRow[]; total: number }> {
  const { data, error } = await getSupabase().rpc("live_customers", {
    p_page: q.page,
    p_page_size: q.pageSize,
    p_search: q.search,
    p_brand_id: q.brandId,
    p_countries: q.countries && q.countries.length > 0 ? q.countries : null,
    p_conditions: q.conditions && q.conditions.length > 0 ? q.conditions : null,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as LiveCustomerRow[];
  return { rows, total: rows[0]?.total_count ?? 0 };
}

/* ---------- customer segments (saved, shareable, global) ---------- */

export interface CustomerSegment {
  id: number;
  name: string;
  user_id: string;
  is_shared: boolean;
  params: { conditions: SegmentCondition[] };
}

export async function fetchSegments(): Promise<CustomerSegment[]> {
  const { data, error } = await getSupabase()
    .from("saved_views")
    .select("id, name, user_id, is_shared, params")
    .eq("route_key", "customers.segment")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as CustomerSegment[];
}

export async function saveSegment(name: string, conditions: SegmentCondition[], isShared: boolean): Promise<void> {
  const supabase = getSupabase();
  const [{ data: session }, ws] = await Promise.all([
    supabase.auth.getSession(),
    supabase.from("workspaces").select("id").limit(1).single(),
  ]);
  const userId = session.session?.user.id;
  if (!userId || !ws.data) throw new Error("No session or workspace");
  const { error } = await supabase.from("saved_views").insert({
    workspace_id: ws.data.id,
    user_id: userId,
    route_key: "customers.segment",
    name,
    params: { conditions },
    is_shared: isShared,
  });
  if (error) throw new Error(error.message);
}

export async function deleteSegment(id: number): Promise<void> {
  const { error } = await getSupabase().from("saved_views").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

/** One CSV export row: customer profile + latest delivery address (correction-overlaid). */
export interface CustomerExportRow extends Omit<LiveCustomerRow, "total_count"> {
  address_1: string | null;
  address_2: string | null;
  addr_city: string | null;
  addr_state: string | null;
  postcode: string | null;
  addr_country: string | null;
  address_order_number: string | null;
  address_placed_at: string | null;
  address_corrected: boolean | null;
}

/** Hard ceiling PostgREST applies to any set-returning response (project `max_rows`). */
export const CUSTOMER_EXPORT_PAGE_SIZE = 1000;

/**
 * One page of the customer CSV export — same filter semantics as
 * fetchLiveCustomers, address joined server-side (live_customers_export RPC).
 * Pages are ≤1000 rows (PostgREST max_rows); order is deterministic
 * (last_order_at desc, identity_key), so pages never overlap. Set
 * withAddress=false when no address column is picked to skip the per-row probe.
 */
export async function fetchCustomerExportPage(q: {
  page: number;
  search: string;
  brandId: number | null;
  countries?: string[] | null;
  conditions?: SegmentCondition[] | null;
  withAddress: boolean;
}): Promise<CustomerExportRow[]> {
  const { data, error } = await getSupabase().rpc("live_customers_export", {
    p_page: q.page,
    p_page_size: CUSTOMER_EXPORT_PAGE_SIZE,
    p_search: q.search,
    p_brand_id: q.brandId,
    p_countries: q.countries && q.countries.length > 0 ? q.countries : null,
    p_conditions: q.conditions && q.conditions.length > 0 ? q.conditions : null,
    p_with_address: q.withAddress,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as CustomerExportRow[];
}

export interface CustomerAddress {
  name: string | null;
  phone: string | null;
  address_1: string | null;
  address_2: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
  order_number: string | null;
  placed_at: string | null;
  /** True when a Fullkit shipping correction (staged/applied) overlays the source values. */
  corrected: boolean;
}

/** Another profile whose latest order ships to the same normalized address. */
export interface AddressSibling {
  identity_key: string;
  display_name: string | null;
  total_orders: number;
  revenue_total: number;
  classification: "regular" | "reseller" | "joy_buyer";
  last_order_at: string | null;
}

export interface LiveCustomerDetail {
  /** Latest order's delivery address, correction-overlaid. Null when no orders. */
  address: CustomerAddress | null;
  /** Profiles sharing this customer's normalized address — reseller/drop-point signal, never merged. */
  address_siblings: AddressSibling[];
  profile: Omit<LiveCustomerRow, "total_count"> & { workspace_id: number };
  orders: {
    id: number;
    integration_id: number;
    brand_id: number | null;
    order_number: string | null;
    source_order_id: string;
    source_status: string;
    currency_code: string;
    total: number;
    items: { sku: string | null; name: string | null; quantity: number; total: string }[];
    placed_at: string | null;
  }[];
  wa_conversations: number;
  /** Variable-cost rollup over ALL recognized orders (not just the 100 above).
   * Costs are MYR (fighter-era orders use their actual recorded costs; the
   * rest use contribution_cost_rules); revenue stays by currency. */
  contribution: {
    orders: number;
    revenue_by_currency: Record<string, number>;
    cogs_myr: number;
    delivery_myr: number;
    cod_myr: number;
    actual_cost_orders: number;
    unmapped_lines: number;
  };
  /** Status × payment split over ALL orders — COD share and return rate. */
  risk: {
    total_orders: number;
    cod_orders: number;
    returned_orders: number;
    cancelled_orders: number;
    cod_returned_orders: number;
  };
}

export async function fetchLiveCustomerDetail(identityKey: string): Promise<LiveCustomerDetail | null> {
  const { data, error } = await getSupabase().rpc("live_customer_detail", {
    p_identity_key: identityKey,
  });
  if (error) throw new Error(error.message);
  return (data ?? null) as LiveCustomerDetail | null;
}

/** Server-side identity key for an order — the one place the resolution expression lives. */
export async function fetchOrderIdentityKey(orderId: number): Promise<string | null> {
  const { data, error } = await getSupabase().rpc("order_identity_key", { p_order_id: orderId });
  if (error) throw new Error(error.message);
  return (data as string | null) ?? null;
}

/* ---------- ship-readiness validation gate (read-only) ---------- */

export interface ShipReadinessRow {
  id: number;
  order_number: string;
  brand_id: number | null;
  market: string;
  placed_at: string | null;
  source_status: string;
  issues: string[];
  /** Yellow lane: bounce predictors that don't block the gate (AI-suggest triggers). */
  warnings: string[];
  suggestions: Record<string, string>;
  correction_status: "staged" | "applied" | null;
  total_checked: number;
  total_flagged: number;
  total_corrected: number;
}

/** Red-lane orders (unresolved issues) plus corrected-but-unpropagated ones. */
export async function fetchShipReadiness(
  days = 14,
): Promise<{ rows: ShipReadinessRow[]; checked: number; flagged: number; corrected: number }> {
  const { data, error } = await getSupabase().rpc("live_ship_readiness", { p_days: days });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as ShipReadinessRow[];
  return {
    rows,
    checked: rows[0]?.total_checked ?? 0,
    flagged: rows[0]?.total_flagged ?? 0,
    corrected: rows[0]?.total_corrected ?? 0,
  };
}

/* ---------- fix-in-OS: shipping corrections (internal write, audited) ---------- */

export interface OrderCorrection {
  order_read_id: number;
  corrected: Record<string, string>;
  original: Record<string, string>;
  status: "staged" | "applied" | "rejected";
  note: string | null;
  corrected_by: string | null;
  corrected_at: string;
}

export async function fetchOrderCorrection(orderId: number): Promise<OrderCorrection | null> {
  const { data, error } = await getSupabase()
    .from("order_corrections")
    .select("order_read_id, corrected, original, status, note, corrected_by, corrected_at")
    .eq("order_read_id", orderId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as OrderCorrection | null;
}

/** Records the operator's fix in Fullkit. Does NOT touch Woo or Ninja Van. */
export async function saveOrderCorrection(
  orderId: number,
  corrected: Record<string, string>,
  note?: string,
): Promise<void> {
  const { error } = await getSupabase().rpc("save_order_correction", {
    p_order_id: orderId,
    p_corrected: corrected,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
}

export const SHIP_ISSUE_LABELS: Record<string, string> = {
  name_incomplete: "name incomplete",
  phone_invalid: "phone invalid",
  postcode_format: "postcode format",
  address_incomplete: "address incomplete",
  address_too_short: "address too short",
  postcode_state_mismatch: "postcode ≠ state",
  city_missing: "city missing",
  // yellow warnings
  address_no_street_keyword: "no street name",
  address_no_unit: "no unit/house no.",
};

/* ---------- fulfilment pipeline (ADR-0006, Synovil MY pilot) ---------- */

export interface FulfilmentPipelineRow {
  order_read_id: number;
  integration_id: number;
  brand_id: number | null;
  order_number: string;
  customer_name: string | null;
  city: string | null;
  postcode: string | null;
  total: number;
  currency_code: string;
  stage: string;
  gate_issues: string[];
  gate_warnings: string[];
  eligible_at: string | null;
  held_by: string | null;
  held_at: string | null;
  hold_reason: string | null;
  tracking_id: string | null;
  placed_at: string | null;
  updated_at: string;
}

export const FULFILMENT_STAGE_LABELS: Record<string, string> = {
  intake: "intake",
  exception: "exception",
  gate_passed: "gate passed",
  held: "held",
  ready_to_submit: "ready to submit",
  shadow_logged: "shadow logged",
  submitted: "submitted",
  in_transit: "in transit",
  delivered: "delivered",
  failed: "failed",
  cancelled: "cancelled",
};

/** Pipeline rows for fulfilment-enabled (pilot) stores; held rows always included. */
export async function fetchFulfilmentPipeline(days = 14): Promise<FulfilmentPipelineRow[]> {
  const { data, error } = await getSupabase().rpc("live_fulfilment_pipeline", { p_days: days });
  if (error) throw new Error(error.message);
  return (data ?? []) as FulfilmentPipelineRow[];
}

/** Freezes an order before courier submission. Frozen until explicitly released. */
export async function holdFulfilmentOrder(orderId: number, reason?: string): Promise<void> {
  const { error } = await getSupabase().rpc("hold_fulfilment_order", {
    p_order_read_id: orderId,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(error.message);
}

/** Releases a held order back into the gate — re-graded with a fresh hold window. */
export async function releaseFulfilmentOrder(orderId: number): Promise<void> {
  const { error } = await getSupabase().rpc("release_fulfilment_order", {
    p_order_read_id: orderId,
  });
  if (error) throw new Error(error.message);
}

/** One order's pipeline row (null when the store isn't fulfilment-enabled). */
export async function fetchFulfilmentForOrder(orderId: number): Promise<{
  stage: string;
  gate_issues: string[];
  gate_warnings: string[];
  eligible_at: string | null;
  held_by: string | null;
  held_at: string | null;
  hold_reason: string | null;
  released_by: string | null;
  released_at: string | null;
  tracking_id: string | null;
} | null> {
  const { data, error } = await getSupabase()
    .from("order_fulfilment")
    .select("stage, gate_issues, gate_warnings, eligible_at, held_by, held_at, hold_reason, released_by, released_at, tracking_id")
    .eq("order_read_id", orderId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

/* ---------- AI address assist (suggest-only, ADR-0006) ---------- */

export interface AiSuggestion {
  id: number;
  order_read_id: number;
  payload: {
    fields: Partial<Record<"name" | "phone" | "address_1" | "postcode" | "city" | "state", string>>;
    confidence: number;
    rationale: string;
  };
  model: string;
  status: "pending" | "shown" | "accepted" | "rejected" | "superseded" | "failed";
  created_at: string;
}

/** Latest open AI proposal for an order, if any. */
export async function fetchAiSuggestion(orderId: number): Promise<AiSuggestion | null> {
  const { data, error } = await getSupabase()
    .from("ai_suggestions")
    .select("id, order_read_id, payload, model, status, created_at")
    .eq("order_read_id", orderId)
    .in("status", ["pending", "shown"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as AiSuggestion | null;
}

/** Order ids with an open AI proposal — powers the "AI fix suggested" hints. */
export async function fetchAiSuggestedOrderIds(): Promise<Set<number>> {
  const { data, error } = await getSupabase()
    .from("ai_suggestions")
    .select("order_read_id")
    .in("status", ["pending", "shown"]);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((r) => r.order_read_id as number));
}

/** Records the admin's (possibly edited) fix AND closes the suggestion, atomically. */
export async function acceptAiSuggestion(
  suggestionId: number,
  corrected: Record<string, string>,
  note?: string,
): Promise<void> {
  const { error } = await getSupabase().rpc("accept_ai_suggestion", {
    p_suggestion_id: suggestionId,
    p_corrected: corrected,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function rejectAiSuggestion(suggestionId: number, reason?: string): Promise<void> {
  const { error } = await getSupabase().rpc("reject_ai_suggestion", {
    p_suggestion_id: suggestionId,
    p_reason: reason ?? null,
  });
  if (error) throw new Error(error.message);
}

export interface LiveAiConnection {
  id: number;
  status: string;
  last_success_at: string | null;
  config: { model?: string; batch_cap?: number; daily_cap?: number; ai_scope?: string } | null;
  notes: string | null;
}

export async function fetchAiConnection(): Promise<LiveAiConnection | null> {
  const { data, error } = await getSupabase()
    .from("integration_connections")
    .select("id, status, last_success_at, config, notes")
    .eq("provider", "OpenRouter")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data ?? null) as LiveAiConnection | null;
}

/** Stores the OpenRouter API key in Vault (hq_admin only, audited). */
export async function setAiConnection(apiKey: string): Promise<void> {
  const { error } = await getSupabase().rpc("set_ai_connection", { p_api_key: apiKey });
  if (error) throw new Error(error.message);
}

/* ---------- NV shadow submission report (ADR-0006 exit-gate evidence) ---------- */

export interface ShadowReport {
  totals: Record<string, number>;
  coverage_pct: number | null;
  open: number;
  daily: { day: string; shadow: number; matched: number; mismatched: number }[];
  recent_exceptions: { order_number: string; status: string; compare: Record<string, unknown> | null; created_at: string }[];
}

export async function fetchShadowReport(days = 14): Promise<ShadowReport> {
  const { data, error } = await getSupabase().rpc("live_shadow_report", { p_days: days });
  if (error) throw new Error(error.message);
  return (data ?? { totals: {}, coverage_pct: null, open: 0, daily: [], recent_exceptions: [] }) as ShadowReport;
}

/* ---------- Ninja Van shipment read-side ---------- */

export interface LiveNvShipment {
  id: number;
  tracking_id: string;
  order_ref: string | null;
  status: string | null;
  is_terminal: boolean;
  last_event_at: string | null;
}

export interface LiveNvEvent {
  id: number;
  status: string | null;
  previous_status: string | null;
  event_at: string | null;
}

/** Network overview for the live Fulfilment surface. */
export async function fetchNvNetwork(): Promise<{
  shipments: LiveNvShipment[];
  recentEvents: { id: number; status: string | null; event_at: string | null; tracking_id: string }[];
}> {
  const supabase = getSupabase();
  const [s, e] = await Promise.all([
    supabase
      .from("nv_shipments")
      .select("id, tracking_id, order_ref, status, is_terminal, last_event_at")
      .order("last_event_at", { ascending: false })
      .limit(1000),
    supabase
      .from("nv_events")
      .select("id, status, event_at, shipment_id")
      .order("event_at", { ascending: false })
      .limit(30),
  ]);
  if (s.error) throw new Error(s.error.message);
  const shipments = (s.data ?? []) as LiveNvShipment[];
  const byId = new Map(shipments.map((x) => [x.id, x.tracking_id]));
  const recentEvents = ((e.data ?? []) as { id: number; status: string | null; event_at: string | null; shipment_id: number }[]).map(
    (ev) => ({ id: ev.id, status: ev.status, event_at: ev.event_at, tracking_id: byId.get(ev.shipment_id) ?? "—" }),
  );
  return { shipments, recentEvents };
}

/** Loose linkage: Ninja Van's shipper order ref ↔ the store's order number. */
export async function fetchNvShipmentForOrder(orderNumber: string): Promise<{ shipment: LiveNvShipment; events: LiveNvEvent[] } | null> {
  const { data: shipment, error } = await getSupabase()
    .from("nv_shipments")
    .select("id, tracking_id, order_ref, status, is_terminal, last_event_at")
    .eq("order_ref", orderNumber)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!shipment) return null;
  const { data: events } = await getSupabase()
    .from("nv_events")
    .select("id, status, previous_status, event_at")
    .eq("shipment_id", shipment.id)
    .order("event_at", { ascending: false })
    .limit(20);
  return { shipment: shipment as LiveNvShipment, events: (events ?? []) as LiveNvEvent[] };
}

/* ---------- brands & catalog ---------- */

export async function fetchLiveBrands(): Promise<LiveBrand[]> {
  const { data, error } = await getSupabase()
    .from("brands")
    .select("id, workspace_id, name, slug, category, is_demo, status, default_legal_entity_id")
    .order("name");
  if (error) throw new Error(error.message);
  return (data ?? []) as LiveBrand[];
}

export async function fetchLegalEntities(): Promise<{ id: number; legal_name: string }[]> {
  const { data, error } = await getSupabase().from("legal_entities").select("id, legal_name");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function createLiveBrand(input: {
  workspaceId: number;
  name: string;
  slug: string;
  category: string;
  legalEntityId: number | null;
}): Promise<void> {
  const { error } = await getSupabase().from("brands").insert({
    workspace_id: input.workspaceId,
    name: input.name,
    slug: input.slug,
    category: input.category || null,
    default_legal_entity_id: input.legalEntityId,
    is_demo: false,
    status: "active",
  });
  if (error) throw new Error(error.message);
}

export async function updateLiveBrand(
  id: number,
  patch: Partial<Pick<LiveBrand, "name" | "slug" | "category" | "status" | "is_demo">>,
): Promise<void> {
  const { error } = await getSupabase().from("brands").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function fetchLiveCatalog(): Promise<{ products: LiveProduct[]; variants: LiveVariant[] }> {
  const supabase = getSupabase();
  const [p, v] = await Promise.all([
    supabase.from("products").select("id, workspace_id, brand_id, name, category, status").order("name"),
    supabase.from("product_variants").select("id, workspace_id, product_id, sku, name, price, currency_code, cost, stock_on_hand, status").order("sku"),
  ]);
  if (p.error) throw new Error(p.error.message);
  if (v.error) throw new Error(v.error.message);
  return { products: (p.data ?? []) as LiveProduct[], variants: (v.data ?? []) as LiveVariant[] };
}

export async function createLiveProduct(input: {
  workspaceId: number;
  brandId: number;
  name: string;
  category: string;
}): Promise<number> {
  const { data, error } = await getSupabase()
    .from("products")
    .insert({
      workspace_id: input.workspaceId,
      brand_id: input.brandId,
      name: input.name,
      category: input.category || null,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return data.id as number;
}

export async function createLiveVariant(input: {
  workspaceId: number;
  productId: number;
  sku: string;
  name: string;
  price: number;
  currency: string;
  cost: number | null;
  stock: number;
}): Promise<void> {
  const { error } = await getSupabase().from("product_variants").insert({
    workspace_id: input.workspaceId,
    product_id: input.productId,
    sku: input.sku,
    name: input.name,
    price: input.price,
    currency_code: input.currency,
    cost: input.cost,
    stock_on_hand: input.stock,
  });
  if (error) throw new Error(error.message);
}

export async function updateLiveVariant(
  id: number,
  patch: Partial<Pick<LiveVariant, "price" | "cost" | "stock_on_hand" | "name" | "status">>,
): Promise<void> {
  const { error } = await getSupabase().from("product_variants").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Merchandise: COGS spine (aliases, effective-dated costs, unit econ) ─────

export interface MerchVariant {
  id: number;
  sku: string;
  name: string;
  price: number | null;
  currency_code: string | null;
  cost: number | null;
  cost_currency: string | null;
  cost_effective_from: string | null;
  aliases: {
    integration_id: number;
    alias: string;
    store_name: string | null;
    store_price: number | null;
    store_status: string | null;
  }[];
  units_14d: number;
  units_30d: number;
  units_90d: number;
  last_sold_at: string | null;
}

export interface MerchProduct {
  id: number;
  brand_id: number;
  name: string;
  category: string | null;
  status: string;
  variants: MerchVariant[];
}

export async function fetchLiveMerchandise(): Promise<MerchProduct[]> {
  const { data, error } = await getSupabase().rpc("live_merchandise");
  if (error) throw new Error(error.message);
  return (data ?? []) as MerchProduct[];
}

export interface SkuMappingRow {
  integration_id: number;
  brand_id: number | null;
  market: string;
  currency_code: string | null;
  store_sku: string;
  item_name: string | null;
  units: number;
  orders: number;
  last_sold_at: string | null;
  published: boolean;
  store_price: number | null;
  store_status: string | null;
}

export async function fetchSkuMappingQueue(): Promise<SkuMappingRow[]> {
  const { data, error } = await getSupabase().rpc("live_sku_mapping_queue");
  if (error) throw new Error(error.message);
  return (data ?? []) as SkuMappingRow[];
}

export async function mapVariantAlias(integrationId: number, alias: string, variantId: number): Promise<void> {
  const { error } = await getSupabase().rpc("map_variant_alias", {
    p_integration_id: integrationId,
    p_alias: alias,
    p_variant_id: variantId,
  });
  if (error) throw new Error(error.message);
}

export async function saveVariantCost(
  variantId: number,
  cost: number,
  currency: string,
  effectiveFrom?: string,
  note?: string,
): Promise<void> {
  const params: Record<string, unknown> = {
    p_variant_id: variantId,
    p_cost: cost,
    p_currency: currency,
  };
  if (effectiveFrom) params.p_effective_from = effectiveFrom;
  if (note) params.p_note = note;
  const { error } = await getSupabase().rpc("save_variant_cost", params);
  if (error) throw new Error(error.message);
}

export interface LiveUnitEconRow {
  win: string;
  brand_id: number | null;
  market: string;
  currency_code: string;
  revenue: number;
  orders: number;
  units: number;
  mapped_units: number;
  costed_units: number;
  cogs: number;
}

export async function fetchLiveUnitEconomics(): Promise<LiveUnitEconRow[]> {
  const { data, error } = await getSupabase().rpc("live_unit_economics");
  if (error) throw new Error(error.message);
  return (data ?? []) as LiveUnitEconRow[];
}

// ── Commerce over an arbitrary date range ───────────────────────────────────

export interface LiveCommerceRangeRow {
  brand_id: number | null;
  market: string;
  currency_code: string;
  revenue: number;
  orders: number;
  units: number;
  costed_units: number;
  cogs: number;
}

/** Recognized revenue/orders/units/COGS for an inclusive MYT date range (max 400 days). */
export async function fetchCommerceRange(from: string, to: string): Promise<LiveCommerceRangeRow[]> {
  const { data, error } = await getSupabase().rpc("live_commerce_range", { p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return (data ?? []) as LiveCommerceRangeRow[];
}

// ── Full variable-cost contribution model (CM2/CM3) ─────────────────────────

export interface ContributionRules {
  effective_from: string;
  unit_cost_myr: number;
  delivery_my_west: number;
  delivery_my_east: number;
  delivery_sg_myr: number;
  cod_fee: number;
  wht_rate: number;
  note: string | null;
}

export interface ContributionRow {
  brand_id: number | null;
  market: string;
  currency_code: string;
  orders: number;
  cod_orders: number;
  east_orders: number;
  revenue: number;
  base_units: number;
  unmapped_lines: number;
  /** May be fractional: unlinked RTS parcels are allocated by order share. */
  rts_parcels: number;
  /** Cost lines are MYR (rules are MYR; the operator sheets convert SG the same way). */
  cogs_myr: number;
  delivery_myr: number;
  returns_myr: number;
  cod_myr: number;
}

export interface LiveContribution {
  rules: ContributionRules | null;
  rows: ContributionRow[];
  /** Freshness of the commerce_daily spine the rows were summed from (null when empty). */
  refreshed_at?: string | null;
  /** RTS parcels tied to an order → counted on their brand exactly. */
  rts_linked_parcels?: number;
  /** RTS parcels with no order link → allocated across MY brand rows by order share. */
  rts_unlinked_parcels?: number;
  rts_allocated?: boolean;
  /** Every cost rule with effective_from ≤ range end, ascending — apply per day. */
  rule_history?: ContributionRules[];
}

/** WHT applies to Meta spend only (decided 2026-08-17): the Malaysian entity's
 * withholding on foreign platform invoices; other platforms never carried it. */
export const WHT_PLATFORMS = new Set(["meta"]);

/** Rate of the rule effective on `dateIso` (YYYY-MM-DD); `fallback` when no rule covers it. */
export function whtRateOn(history: ContributionRules[] | undefined, dateIso: string, fallback: number): number {
  let rate: number | null = null;
  for (const r of history ?? []) {
    if (r.effective_from <= dateIso) rate = Number(r.wht_rate);
    else break;
  }
  return rate ?? fallback;
}

/** WHT amount for a set of daily spend rows: Σ Meta spend × the rate effective that day. */
export function whtFor(
  rows: { date: string; platform: string; spend: number | string }[],
  history: ContributionRules[] | undefined,
  fallback: number,
): number {
  let wht = 0;
  for (const r of rows) {
    if (!WHT_PLATFORMS.has(r.platform)) continue;
    wht += Number(r.spend) * whtRateOn(history, r.date, fallback);
  }
  return wht;
}

/** Human summary of the WHT schedule, e.g. "8% on Meta spend until 31 Jan 2026 · 0% from 1 Feb 2026". */
export function whtSchedule(history: ContributionRules[] | undefined, fallback: number): string {
  const rules = (history ?? []).filter((r, i, arr) => i === 0 || Number(r.wht_rate) !== Number(arr[i - 1].wht_rate));
  if (rules.length === 0) return `${Math.round(fallback * 100)}% on Meta spend`;
  const fmt = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-MY", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return rules
    .map((r, i) => `${Math.round(Number(r.wht_rate) * 100)}%${i === 0 ? " on Meta spend" : ""} ${i === rules.length - 1 ? `from ${fmt(r.effective_from)}` : `until ${fmt(rules[i + 1].effective_from)}`}`)
    .join(" · ");
}

/* ---------- Ninja Van returns (RTS) ---------- */

export interface NvReturnRow {
  id: number;
  tracking_id: string;
  order_ref: string | null;
  rts_at: string;
  rts_reason: string | null;
  on_rts_leg: boolean;
  brand_id: number | null;
  order_read_id: number | null;
  order_number: string | null;
}

export interface NvReturns {
  window_days: number;
  summary: {
    returned: number;
    linked: number;
    /** Parcels currently on the return leg that have not reached the sender yet. */
    in_return_transit: number;
    avg_days_to_rts: number | null;
  };
  by_reason: { reason: string; n: number }[];
  by_day: { day: string; n: number }[];
  rows: NvReturnRow[];
}

/** Returned-to-sender parcels from the NV webhook feed (durable rts_at, not the rollup status). */
export async function fetchNvReturns(days = 14): Promise<NvReturns> {
  const { data, error } = await getSupabase().rpc("live_nv_returns", { p_days: days });
  if (error) throw new Error(error.message);
  return data as NvReturns;
}

/** Revenue + full variable-cost lines per brand × market for an inclusive MYT range (max 400 days). */
export async function fetchContributionRange(from: string, to: string): Promise<LiveContribution> {
  const { data, error } = await getSupabase().rpc("live_contribution_range", { p_from: from, p_to: to });
  if (error) throw new Error(error.message);
  return (data ?? { rules: null, rows: [] }) as LiveContribution;
}

// ── Growth ads (warehouse pipeline, ADR-0003) ───────────────────────────────

export interface GrowthAdsRow {
  brand_slug: string | null;
  market: string | null;
  platform: string;
  spend: number;
  purchases: number | null;
  purchase_value: number | null;
  impressions: number | null;
  clicks: number | null;
  accounts: number;
  banned_spend: number | null;
}

export interface GrowthTrendPoint {
  date: string;
  brand_slug: string | null;
  market: string | null;
  platform: string;
  spend: number;
  purchases: number | null;
  purchase_value: number | null;
  impressions: number | null;
  clicks: number | null;
}

export interface GrowthAccount {
  account_id: string;
  platform: string;
  name: string | null;
  account_status: string | null;
  registered: boolean;
  brands: string[];
  markets: string[];
  spend: number;
  purchases: number | null;
  last_active: string;
  is_banned: boolean;
}

export interface GrowthAds {
  as_of: string | null;
  window_days: number;
  total: {
    spend: number;
    purchases: number;
    purchase_value: number;
    accounts: number;
    campaigns: number;
    non_myr_rows: number;
  };
  /** Distinct platform values present in the facts (e.g. ["meta"]). */
  platforms: string[];
  rows: GrowthAdsRow[];
  trend: GrowthTrendPoint[];
  accounts: GrowthAccount[];
}

/** Warehouse-attributed ads facts (brand via dbt waterfall, market via targeting geo). Null when no live data. */
export async function fetchGrowthAds(days = 30): Promise<GrowthAds | null> {
  const { data, error } = await getSupabase().rpc("live_growth_ads", { p_days: days });
  if (error) throw new Error(error.message);
  const g = data as GrowthAds | null;
  return g && g.rows.length > 0 ? g : null;
}

// ── Production pipeline (P5 slice 0) ────────────────────────────────────────

export interface ProductionMaterial {
  id: number;
  kind: "product" | "packaging";
  name: string;
  uom: string;
  qty: number;
  note: string | null;
}

export interface ProductionInbound {
  id: number;
  qty_units: number;
  freight: "sea" | "air" | "sea_air";
  eta: string | null;
  status: string;
  note: string | null;
}

export interface ProductionEntry {
  field: string;
  old_qty: number;
  new_qty: number;
  delta: number;
  source: "manual" | "inbound_arrival";
  note: string | null;
  actor: string;
  at: string;
}

export interface LiveProductionItem {
  id: number;
  product_id: number | null;
  name: string;
  dosage_form: "capsule" | "sachet" | "other";
  base_uom: string;
  raw_material_units: number;
  premix_units: number;
  in_progress_units: number;
  ready_units: number;
  status: string;
  updated_at: string;
  backlog_units: number;
  net_position: number;
  daily_usage: number;
  days_cover: number | null;
  rts_units_30d: number;
  rts_parcels_30d: number;
  refund_units_30d: number;
  incoming_units: number;
  next_eta: string | null;
  incoming: ProductionInbound[];
  materials: ProductionMaterial[];
  entries: ProductionEntry[];
}

export interface LiveProduction {
  items: LiveProductionItem[];
  unmapped_backlog_qty: number;
  variants_missing_pack: { id: number; sku: string; name: string }[];
}

export async function fetchLiveProduction(): Promise<LiveProduction> {
  const { data, error } = await getSupabase().rpc("live_production");
  if (error) throw new Error(error.message);
  return (data ?? { items: [], unmapped_backlog_qty: 0, variants_missing_pack: [] }) as LiveProduction;
}

export async function saveProductionItem(input: {
  name: string;
  dosageForm: string;
  baseUom?: string;
  productId?: number | null;
  itemId?: number | null;
}): Promise<number> {
  const { data, error } = await getSupabase().rpc("save_production_item", {
    p_name: input.name,
    p_dosage_form: input.dosageForm,
    p_base_uom: input.baseUom ?? "bottle",
    p_product_id: input.productId ?? null,
    p_item_id: input.itemId ?? null,
  });
  if (error) throw new Error(error.message);
  return data as number;
}

export async function setProductionStage(
  itemId: number,
  field: string,
  qty: number,
  note?: string,
): Promise<void> {
  const { error } = await getSupabase().rpc("set_production_stage", {
    p_item_id: itemId,
    p_field: field,
    p_qty: qty,
    p_note: note ?? null,
  });
  if (error) throw new Error(error.message);
}

export async function saveProductionMaterial(input: {
  itemId: number;
  kind: string;
  name: string;
  uom: string;
  qty: number;
  note?: string;
  materialId?: number | null;
}): Promise<number> {
  const { data, error } = await getSupabase().rpc("save_production_material", {
    p_item_id: input.itemId,
    p_kind: input.kind,
    p_name: input.name,
    p_uom: input.uom,
    p_qty: input.qty,
    p_note: input.note ?? null,
    p_material_id: input.materialId ?? null,
  });
  if (error) throw new Error(error.message);
  return data as number;
}

export async function deleteProductionMaterial(materialId: number): Promise<void> {
  const { error } = await getSupabase().rpc("delete_production_material", { p_material_id: materialId });
  if (error) throw new Error(error.message);
}

export async function saveProductionInbound(input: {
  itemId: number;
  qtyUnits: number;
  freight: string;
  eta?: string | null;
  note?: string;
  inboundId?: number | null;
}): Promise<number> {
  const { data, error } = await getSupabase().rpc("save_production_inbound", {
    p_item_id: input.itemId,
    p_qty_units: input.qtyUnits,
    p_freight: input.freight,
    p_eta: input.eta ?? null,
    p_note: input.note ?? null,
    p_inbound_id: input.inboundId ?? null,
  });
  if (error) throw new Error(error.message);
  return data as number;
}

export async function cancelProductionInbound(inboundId: number): Promise<void> {
  const { error } = await getSupabase().rpc("cancel_production_inbound", { p_inbound_id: inboundId });
  if (error) throw new Error(error.message);
}

export async function markInboundArrived(inboundId: number): Promise<void> {
  const { error } = await getSupabase().rpc("mark_inbound_arrived", { p_inbound_id: inboundId });
  if (error) throw new Error(error.message);
}

export async function setVariantUnitsPerPack(variantId: number, units: number): Promise<void> {
  const { error } = await getSupabase().rpc("set_variant_units_per_pack", {
    p_variant_id: variantId,
    p_units: units,
  });
  if (error) throw new Error(error.message);
}

// ── Automations registry health ─────────────────────────────────────────────

export type AutomationHealth = Record<string, Record<string, unknown>>;

export async function fetchAutomationHealth(): Promise<AutomationHealth> {
  const { data, error } = await getSupabase().rpc("live_automation_health");
  if (error) throw new Error(error.message);
  return (data ?? {}) as AutomationHealth;
}

/* ---------- Orders section nav: per-queue counts ---------- */

/**
 * One grouped RPC for the queue badges (see supabase/migrations/*_order_queue_counts*.sql).
 * Returns null when the function is not deployed, so the nav simply shows no
 * badges rather than failing the shell.
 */
export async function fetchOrderQueueCounts(q: {
  brandId: number | null;
  integrationIn: number[] | null;
}): Promise<OrderQueueCounts | null> {
  const { data, error } = await getSupabase().rpc("live_order_queue_counts", {
    p_brand_id: q.brandId,
    p_integration_ids: q.integrationIn,
  });
  if (error) {
    if (error.code === "PGRST202" || error.code === "42883") return null;
    throw new Error(error.message);
  }
  return data as OrderQueueCounts;
}

/* ---------- Customer lifecycle contract (program plan Phase 1) ---------- */

/**
 * Reconciled customer-base movement for the Customer Base page. Scope follows
 * the top bar: brand and/or the integrations behind the selected markets.
 * Returns `{ status: "unavailable", reason }` rather than zeros when the
 * contract has not been computed yet.
 */
export async function fetchCustomerBaseMovement(q: {
  grain: MovementGrain;
  from: string | null;
  to: string | null;
  brandId: number | null;
  integrationIn: number[] | null;
  policyVersion?: number | null;
}): Promise<CustomerBaseMovement> {
  const { data, error } = await getSupabase().rpc("live_customer_base_movement", {
    p_grain: q.grain,
    p_from: q.from,
    p_to: q.to,
    p_brand_id: q.brandId,
    p_integration_ids: q.integrationIn,
    p_policy_version: q.policyVersion ?? null,
  });
  if (error) throw new Error(error.message);
  return data as CustomerBaseMovement;
}

/** Exact masked population behind one movement measure; keyset-paginated. */
export async function fetchCustomerTransitionPopulation(q: {
  grain: MovementGrain;
  periodStart: string;
  measure: MovementMeasure;
  brandId: number | null;
  integrationIn: number[] | null;
  policyVersion?: number | null;
  cursor?: string | null;
  limit?: number;
}): Promise<TransitionPopulation> {
  const { data, error } = await getSupabase().rpc("live_customer_transition_population", {
    p_grain: q.grain,
    p_period_start: q.periodStart,
    p_measure: q.measure,
    p_brand_id: q.brandId,
    p_integration_ids: q.integrationIn,
    p_policy_version: q.policyVersion ?? null,
    p_cursor: q.cursor ?? null,
    p_limit: q.limit ?? 50,
  });
  if (error) throw new Error(error.message);
  return data as TransitionPopulation;
}

/** Governed point-in-time lifecycle state for up to 500 identities (policy-versioned). */
export async function fetchCustomerLifecycleStates(identityKeys: string[]): Promise<CustomerLifecycleStates> {
  if (identityKeys.length === 0) return { status: "ok", states: {} };
  const { data, error } = await getSupabase().rpc("live_customer_lifecycle_states", {
    p_identity_keys: identityKeys.slice(0, 500),
  });
  if (error) throw new Error(error.message);
  return data as CustomerLifecycleStates;
}

/* ---------- cohort workspaces (Phase 3) ---------- */

/** Header numbers for one cohort under the top-bar scope; rule + version come from the server. */
export async function fetchCustomerSegmentSummary(q: {
  cohort: CohortKey;
  brandId: number | null;
  countries?: string[] | null;
}): Promise<CohortSummary> {
  const { data, error } = await getSupabase().rpc("live_customer_segment_summary", {
    p_cohort: q.cohort,
    p_brand_id: q.brandId,
    p_countries: q.countries && q.countries.length > 0 ? q.countries : null,
  });
  if (error) throw new Error(error.message);
  return data as CohortSummary;
}

/** Work items attached to these customers (RLS: workspace members). Open first. */
export async function fetchCustomerWorkItems(identityKeys: string[]): Promise<WorkItem[]> {
  if (identityKeys.length === 0) return [];
  const { data, error } = await getSupabase()
    .from("work_items")
    .select("id, workspace_id, title, entity_ref, owner_membership_id, severity, next_action, due_at, status, created_at")
    .in("entity_ref", identityKeys.map((k) => `customer:${k}`))
    .order("status", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as WorkItem[];
}

/**
 * Audited, idempotent follow-up: one open item per customer × action. The
 * server returns the existing item (created: false) on a repeat.
 */
export async function createCustomerWorkItem(q: {
  identityKey: string;
  nextAction: WorkItemAction;
  severity: WorkItemSeverity;
  dueAt: string | null;
  note: string | null;
  source: WorkItemSource;
}): Promise<{ created: boolean; work_item: WorkItem }> {
  const { data, error } = await getSupabase().rpc("create_customer_work_item", {
    p_identity_key: q.identityKey,
    p_next_action: q.nextAction,
    p_severity: q.severity,
    p_due_at: q.dueAt,
    p_note: q.note,
    p_source: q.source,
  });
  if (error) throw new Error(error.message);
  return data as { created: boolean; work_item: WorkItem };
}

export async function closeWorkItem(q: { id: number; outcome: "done" | "dropped"; note?: string | null }): Promise<{ changed: boolean; work_item: WorkItem }> {
  const { data, error } = await getSupabase().rpc("close_work_item", {
    p_work_item_id: q.id,
    p_outcome: q.outcome,
    p_note: q.note ?? null,
  });
  if (error) throw new Error(error.message);
  return data as { changed: boolean; work_item: WorkItem };
}

/* ---------- Orders New/QC and drafts (Phase 4) ---------- */

export async function fetchOrderQc(orderReadId: number): Promise<{ qc: OrderQc | null; events: OrderQcEvent[] }> {
  const supabase = getSupabase();
  const { data: qc, error } = await supabase.from("order_qc").select("*").eq("order_read_id", orderReadId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!qc) return { qc: null, events: [] };
  const { data: events, error: e2 } = await supabase
    .from("order_qc_events")
    .select("*")
    .eq("order_qc_id", (qc as OrderQc).id)
    .order("created_at", { ascending: false });
  if (e2) throw new Error(e2.message);
  return { qc: qc as OrderQc, events: (events ?? []) as OrderQcEvent[] };
}

export async function fetchWorkspaceMembers(): Promise<WorkspaceMember[]> {
  const { data, error } = await getSupabase().rpc("live_workspace_members");
  if (error) throw new Error(error.message);
  return (data ?? []) as WorkspaceMember[];
}

async function qcRpc(fn: string, args: Record<string, unknown>): Promise<{ qc: OrderQc } & Record<string, unknown>> {
  const { data, error } = await getSupabase().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data as { qc: OrderQc } & Record<string, unknown>;
}

/** Idempotent: returns the existing record when the order is already in QC. */
export const qcEnrol = (orderReadId: number) => qcRpc("qc_enrol", { p_order_read_id: orderReadId });
export const qcStartReview = (qcId: number, note: string | null, expectedVersion: number) =>
  qcRpc("qc_start_review", { p_qc_id: qcId, p_note: note, p_expected_version: expectedVersion });
/** Creates an internal work item as the shadow dispatch job; `sent` is always false. */
export const qcRequestInformation = (qcId: number, reasonCodes: string[], note: string | null, channel: "whatsapp_manual" | "call", expectedVersion: number) =>
  qcRpc("qc_request_information", { p_qc_id: qcId, p_reason_codes: reasonCodes, p_note: note, p_channel: channel, p_expected_version: expectedVersion }) as Promise<{ qc: OrderQc; dispatch_job_id: number | null; sent: false }>;
export const qcCorrectAndRevalidate = (qcId: number, corrected: Record<string, string> | null, note: string | null, expectedVersion: number) =>
  qcRpc("qc_correct_and_revalidate", { p_qc_id: qcId, p_corrected: corrected, p_note: note, p_expected_version: expectedVersion });
export const qcHold = (qcId: number, reasonCodes: string[], note: string | null, expectedVersion: number) =>
  qcRpc("qc_hold", { p_qc_id: qcId, p_reason_codes: reasonCodes, p_note: note, p_expected_version: expectedVersion }) as Promise<{ qc: OrderQc; pipeline_held: boolean }>;
export const qcAssign = (qcId: number, ownerMembershipId: number | null, dueAt: string | null, expectedVersion: number) =>
  qcRpc("qc_assign", { p_qc_id: qcId, p_owner_membership_id: ownerMembershipId, p_due_at: dueAt, p_expected_version: expectedVersion });
export const qcApprove = (qcId: number, note: string | null, expectedVersion: number) =>
  qcRpc("qc_approve", { p_qc_id: qcId, p_note: note, p_expected_version: expectedVersion });
export const qcReject = (qcId: number, reasonCodes: string[], note: string | null, expectedVersion: number) =>
  qcRpc("qc_reject", { p_qc_id: qcId, p_reason_codes: reasonCodes, p_note: note, p_expected_version: expectedVersion }) as Promise<{ qc: OrderQc; pipeline_held: boolean }>;

/* drafts */

export async function fetchOrderDrafts(q: { status: "draft" | "confirmed" | "discarded" | "all"; limit?: number }): Promise<Array<OrderDraft & { order_qc: Pick<OrderQc, "id" | "qc_state" | "version"> | null }>> {
  let query = getSupabase()
    .from("order_drafts")
    .select("*, order_qc(id, qc_state, version)")
    .order("updated_at", { ascending: false })
    .limit(q.limit ?? 100);
  if (q.status !== "all") query = query.eq("status", q.status);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  // One-to-one embed; normalise defensively (see fetchLiveOrdersPage).
  return ((data ?? []) as unknown as Array<OrderDraft & { order_qc?: unknown }>).map((d) => ({
    ...d,
    order_qc: ((Array.isArray(d.order_qc) ? d.order_qc[0] : d.order_qc) ?? null) as Pick<OrderQc, "id" | "qc_state" | "version"> | null,
  }));
}

export async function saveOrderDraft(q: {
  id: number | null;
  integrationId: number | null;
  customer: OrderDraft["customer"];
  shipping: OrderDraft["shipping"];
  items: OrderDraft["items"];
  paymentMethod: OrderDraft["payment_method"];
  note: string | null;
  idempotencyKey: string | null;
  expectedVersion: number | null;
}): Promise<OrderDraft> {
  const { data, error } = await getSupabase().rpc("save_order_draft", {
    p_id: q.id,
    p_integration_id: q.integrationId,
    p_customer: q.customer,
    p_shipping: q.shipping,
    p_items: q.items,
    p_payment_method: q.paymentMethod,
    p_note: q.note,
    p_currency_code: null,
    p_idempotency_key: q.idempotencyKey,
    p_expected_version: q.expectedVersion,
  });
  if (error) throw new Error(error.message);
  return (data as { draft: OrderDraft }).draft;
}

export async function confirmOrderDraft(id: number, expectedVersion: number): Promise<{ draft: OrderDraft; qc: OrderQc; changed: boolean }> {
  const { data, error } = await getSupabase().rpc("confirm_order_draft", { p_id: id, p_expected_version: expectedVersion });
  if (error) throw new Error(error.message);
  return data as { draft: OrderDraft; qc: OrderQc; changed: boolean };
}

export async function discardOrderDraft(id: number, note: string | null): Promise<{ draft: OrderDraft; changed: boolean }> {
  const { data, error } = await getSupabase().rpc("discard_order_draft", { p_id: id, p_note: note });
  if (error) throw new Error(error.message);
  return data as { draft: OrderDraft; changed: boolean };
}
