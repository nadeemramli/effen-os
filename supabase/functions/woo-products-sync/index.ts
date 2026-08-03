// woo-products-sync — mirrors each store's PUBLISHED product catalog into
// woo_products_read (the channel-truth plane; ADR-0004).
//
// Read-only, full refresh each run: stores carry tens of products, not
// thousands, so no checkpoint is needed. Variable products also pull their
// variations (line items reference variation SKUs). Rows not seen in a
// successful run are deleted so the mirror tracks deletions too.
//
// Writes sync_runs rows (message prefixed "Products:") but never touches the
// connection's sync_checkpoint or health status — those belong to the orders
// sync.

import { createClient } from "npm:@supabase/supabase-js@2";

const PAGE_SIZE = 100;
const MAX_PAGES = 10;

interface WooProduct {
  id: number;
  sku?: string;
  name?: string;
  status?: string;
  type?: string;
  price?: string;
  regular_price?: string;
  sale_price?: string;
  stock_status?: string;
  date_modified_gmt?: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function num(v: string | undefined): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: { connection_id?: number } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }

  let query = supabase.from("integration_connections").select("*").eq("provider", "WooCommerce");
  if (body.connection_id) query = query.eq("id", body.connection_id);
  const { data: connections, error: connError } = await query;
  if (connError) return json({ error: connError.message }, 500);

  const results: Record<string, unknown>[] = [];

  for (const conn of connections ?? []) {
    const baseUrl: string | null = conn.config?.base_url ?? null;
    let key: string | undefined;
    let secret: string | undefined;
    const { data: vaultSecrets } = await supabase.rpc("get_woo_secrets", {
      p_connection_id: conn.id,
    });
    if (vaultSecrets?.[0]?.consumer_key && vaultSecrets?.[0]?.consumer_secret) {
      key = vaultSecrets[0].consumer_key;
      secret = vaultSecrets[0].consumer_secret;
    } else {
      key = Deno.env.get(`${conn.secret_ref}_KEY`);
      secret = Deno.env.get(`${conn.secret_ref}_SECRET`);
    }
    if (!baseUrl || !key || !secret) {
      results.push({ connection: conn.name, skipped: !baseUrl ? "no base_url" : "secrets missing" });
      continue;
    }

    const { data: run } = await supabase
      .from("sync_runs")
      .insert({ workspace_id: conn.workspace_id, integration_id: conn.id, status: "running" })
      .select("id")
      .single();
    const finishRun = async (patch: Record<string, unknown>) => {
      if (run) {
        await supabase
          .from("sync_runs")
          .update({ finished_at: new Date().toISOString(), ...patch })
          .eq("id", run.id);
      }
    };

    try {
      const runStart = new Date().toISOString();
      const auth = "Basic " + btoa(`${key}:${secret}`);
      const api = (path: string) => `${baseUrl.replace(/\/$/, "")}/wp-json/wc/v3${path}`;
      let read = 0;
      let written = 0;

      const upsert = async (products: WooProduct[], parentId: string | null) => {
        if (products.length === 0) return;
        const rows = products.map((p) => ({
          workspace_id: conn.workspace_id,
          integration_id: conn.id,
          source_product_id: String(p.id),
          parent_product_id: parentId,
          sku: p.sku ?? null,
          name: p.name ?? null,
          status: p.status ?? null,
          type: p.type ?? (parentId ? "variation" : null),
          price: num(p.price),
          regular_price: num(p.regular_price),
          sale_price: num(p.sale_price),
          stock_status: p.stock_status ?? null,
          updated_at_source: p.date_modified_gmt ? `${p.date_modified_gmt}Z` : null,
          synced_at: new Date().toISOString(),
          raw: p,
        }));
        const { error } = await supabase
          .from("woo_products_read")
          .upsert(rows, { onConflict: "integration_id,source_product_id" });
        if (error) throw new Error(`upsert failed: ${error.message}`);
        written += rows.length;
      };

      let page = 1;
      while (page <= MAX_PAGES) {
        const url = new URL(api("/products"));
        url.searchParams.set("per_page", String(PAGE_SIZE));
        url.searchParams.set("page", String(page));
        url.searchParams.set("orderby", "id");
        url.searchParams.set("order", "asc");
        url.searchParams.set("status", "any");
        const res = await fetch(url, { headers: { Authorization: auth } });
        if (!res.ok) throw new Error(`HTTP ${res.status} from store (products)`);
        const products = (await res.json()) as WooProduct[];
        read += products.length;
        await upsert(products, null);

        // Variations carry the SKUs that order line items reference.
        for (const p of products) {
          if (p.type === "variable") {
            const vres = await fetch(api(`/products/${p.id}/variations?per_page=100`), {
              headers: { Authorization: auth },
            });
            if (vres.ok) {
              const variations = (await vres.json()) as WooProduct[];
              read += variations.length;
              await upsert(
                variations.map((v) => ({ ...v, status: v.status ?? p.status })),
                String(p.id),
              );
            }
          }
        }

        if (products.length < PAGE_SIZE) break;
        page += 1;
      }

      // The mirror tracks deletions: drop rows this run did not touch.
      const { error: delError } = await supabase
        .from("woo_products_read")
        .delete()
        .eq("integration_id", conn.id)
        .lt("synced_at", runStart);
      if (delError) throw new Error(`stale cleanup failed: ${delError.message}`);

      await finishRun({
        status: "success",
        records_read: read,
        records_written: written,
        message: `Products: mirrored ${written} published/draft items.`,
      });
      results.push({ connection: conn.name, success: true, read, written });
    } catch (err) {
      await finishRun({
        status: "failed",
        error_count: 1,
        reason_code: "FETCH_FAILED",
        message: `Products: ${(err as Error).message.slice(0, 480)}`,
      });
      results.push({ connection: conn.name, failed: (err as Error).message });
    }
  }

  return json({ results });
});
