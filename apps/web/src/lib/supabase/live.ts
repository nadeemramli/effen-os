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
}

export interface LiveOrdersPage {
  rows: LiveOrderRow[];
  total: number;
}

export async function fetchLiveOrdersPage(q: LiveOrdersQuery): Promise<LiveOrdersPage> {
  let query = getSupabase()
    .from("orders_read")
    .select(
      "id, integration_id, brand_id, source_order_id, order_number, source_status, currency_code, total, customer, items, raw, placed_at, updated_at_source, synced_at",
      { count: "exact" },
    );
  if (q.brandId !== null) query = query.eq("brand_id", q.brandId);
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
  return { rows: (data ?? []) as LiveOrderRow[], total: count ?? 0 };
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
  first_order_at: string | null;
  last_order_at: string | null;
  revenue_by_currency: Record<string, number> | null;
  total_count: number;
}

export async function fetchLiveCustomers(q: {
  page: number;
  pageSize: number;
  search: string;
  brandId: number | null;
  activity: string | null;
  countries?: string[] | null;
  repeat?: string | null;
  tier?: string | null;
}): Promise<{ rows: LiveCustomerRow[]; total: number }> {
  const { data, error } = await getSupabase().rpc("live_customers", {
    p_page: q.page,
    p_page_size: q.pageSize,
    p_search: q.search,
    p_brand_id: q.brandId,
    p_activity: q.activity,
    p_countries: q.countries && q.countries.length > 0 ? q.countries : null,
    p_repeat: q.repeat ?? null,
    p_tier: q.tier ?? null,
  });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as LiveCustomerRow[];
  return { rows, total: rows[0]?.total_count ?? 0 };
}

export interface LiveCustomerDetail {
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
}

export async function fetchLiveCustomerDetail(identityKey: string): Promise<LiveCustomerDetail | null> {
  const { data, error } = await getSupabase().rpc("live_customer_detail", {
    p_identity_key: identityKey,
  });
  if (error) throw new Error(error.message);
  return (data ?? null) as LiveCustomerDetail | null;
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
  city_missing: "city missing",
};

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
  aliases: { integration_id: number; alias: string }[];
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
