// woo-sync — pulls WooCommerce orders into the orders_read mirror.
//
// One integration_connections row per brand site (provider = 'WooCommerce').
// A connection participates only when BOTH are true:
//   - config.base_url is set (https store URL)
//   - Edge Function secrets `${secret_ref}_KEY` / `${secret_ref}_SECRET` exist
//     (a READ-ONLY WooCommerce REST key created on that site)
// Unconfigured connections are skipped silently (status stays pending_setup),
// so the cron schedule is quiet until a brand is activated.
//
// Every attempted sync writes a reason-coded sync_runs row; the checkpoint
// (max date_modified_gmt) only advances on success.

import { createClient } from "npm:@supabase/supabase-js@2";

const PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 10; // bounds run time; checkpoint carries the rest
const HARD_MAX_PAGES = 30; // manual backfill runs may raise up to this

interface WooOrder {
  id: number;
  number: string;
  status: string;
  currency: string;
  total: string;
  date_created_gmt: string;
  date_modified_gmt: string;
  billing?: {
    first_name?: string;
    last_name?: string;
    email?: string;
    phone?: string;
    city?: string;
    postcode?: string;
    country?: string;
  };
  line_items?: { sku?: string; name?: string; quantity?: number; total?: string }[];
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Optional body: { connection_id?: number, max_pages?: number } — used by
  // the setup UI's "Sync now" for targeted runs and faster backfills.
  let body: { connection_id?: number; max_pages?: number } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }
  const maxPages = Math.min(Math.max(body.max_pages ?? DEFAULT_MAX_PAGES, 1), HARD_MAX_PAGES);

  let query = supabase.from("integration_connections").select("*").eq("provider", "WooCommerce");
  if (body.connection_id) query = query.eq("id", body.connection_id);
  const { data: connections, error: connError } = await query;
  if (connError) {
    return json({ error: connError.message }, 500);
  }

  const { data: brands } = await supabase.from("brands").select("id, slug");
  const brandBySlug = new Map((brands ?? []).map((b) => [b.slug as string, b.id as number]));

  const results: Record<string, unknown>[] = [];

  for (const conn of connections ?? []) {
    const baseUrl: string | null = conn.config?.base_url ?? null;
    // Secrets: Vault (written by the setup UI via set_woo_connection) first,
    // Edge Function env secrets as a fallback for manually-managed keys.
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
      const checkpoint: string = conn.sync_checkpoint ?? "2020-01-01T00:00:00";
      const auth = "Basic " + btoa(`${key}:${secret}`);
      let page = 1;
      let read = 0;
      let written = 0;
      let maxModified = checkpoint;

      while (page <= maxPages) {
        const url = new URL(`${baseUrl.replace(/\/$/, "")}/wp-json/wc/v3/orders`);
        url.searchParams.set("modified_after", checkpoint);
        url.searchParams.set("orderby", "modified");
        url.searchParams.set("order", "asc");
        url.searchParams.set("per_page", String(PAGE_SIZE));
        url.searchParams.set("page", String(page));

        const res = await fetch(url, { headers: { Authorization: auth } });
        if (res.status === 401 || res.status === 403) {
          await finishRun({
            status: "failed",
            error_count: 1,
            reason_code: "AUTH_REJECTED",
            message: `Store returned ${res.status} — check the REST key permissions (Read) and that the key belongs to this site.`,
          });
          await supabase
            .from("integration_connections")
            .update({ status: "degraded", last_failure_at: new Date().toISOString() })
            .eq("id", conn.id);
          results.push({ connection: conn.name, failed: "AUTH_REJECTED" });
          throw new Error("handled");
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} from store`);
        }

        const orders = (await res.json()) as WooOrder[];
        read += orders.length;

        if (orders.length > 0) {
          const rows = orders.map((o) => ({
            workspace_id: conn.workspace_id,
            integration_id: conn.id,
            brand_id: brandBySlug.get(conn.config?.brand_slug) ?? null,
            source_order_id: String(o.id),
            order_number: o.number,
            source_status: o.status,
            currency_code: o.currency,
            total: o.total,
            customer: {
              name: [o.billing?.first_name, o.billing?.last_name].filter(Boolean).join(" "),
              email: o.billing?.email ?? null,
              phone: o.billing?.phone ?? null,
              city: o.billing?.city ?? null,
              postcode: o.billing?.postcode ?? null,
              country: o.billing?.country ?? null,
            },
            items: (o.line_items ?? []).map((li) => ({
              sku: li.sku ?? null,
              name: li.name ?? null,
              quantity: li.quantity ?? 0,
              total: li.total ?? "0",
            })),
            raw: o,
            placed_at: o.date_created_gmt ? `${o.date_created_gmt}Z` : null,
            updated_at_source: o.date_modified_gmt ? `${o.date_modified_gmt}Z` : null,
            synced_at: new Date().toISOString(),
          }));
          const { error: upsertError } = await supabase
            .from("orders_read")
            .upsert(rows, { onConflict: "integration_id,source_order_id" });
          if (upsertError) throw new Error(`upsert failed: ${upsertError.message}`);
          written += rows.length;
          for (const o of orders) {
            if (o.date_modified_gmt > maxModified) maxModified = o.date_modified_gmt;
          }
        }

        if (orders.length < PAGE_SIZE) break;
        page += 1;
      }

      await finishRun({
        status: "success",
        records_read: read,
        records_written: written,
        message: `Synced ${written} orders. Checkpoint advanced to ${maxModified}.`,
      });
      await supabase
        .from("integration_connections")
        .update({
          status: "healthy",
          last_success_at: new Date().toISOString(),
          sync_checkpoint: maxModified,
          error_count_24h: 0,
        })
        .eq("id", conn.id);
      results.push({ connection: conn.name, success: true, read, written });
    } catch (err) {
      if ((err as Error).message !== "handled") {
        await finishRun({
          status: "failed",
          error_count: 1,
          reason_code: "FETCH_FAILED",
          message: (err as Error).message.slice(0, 500),
        });
        await supabase
          .from("integration_connections")
          .update({
            status: "degraded",
            last_failure_at: new Date().toISOString(),
            error_count_24h: (conn.error_count_24h ?? 0) + 1,
          })
          .eq("id", conn.id);
        results.push({ connection: conn.name, failed: (err as Error).message });
      }
    }
  }

  return json({ results });
});
