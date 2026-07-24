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
  config: { base_url?: string | null; brand_slug?: string | null };
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
