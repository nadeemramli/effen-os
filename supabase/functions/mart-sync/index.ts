// mart-sync — upserts marts.mart_ads_daily (BigQuery) into ad_daily_facts.
//
// ADR-0003 last mile: Fullkit serves warehouse truth; the app never
// queries platforms. Auth to BigQuery is the sa-mart-sync service-account
// key (read-only on marts), provided as Edge Function secret
// BQ_SA_KEY_B64 (base64 of the key JSON).
//
// Modes (query params):
//   default          — rolling window: last 40 days (covers Meta's ~28d
//                      restatement window with margin)
//   ?mode=full       — entire mart; also deletes source='legacy_seed'
//                      rows afterwards (the interim connector-seeded
//                      facts this pipeline supersedes)
//
// Every run writes a sync_runs row against the "Meta Ads" connection
// (integration_connections id 3) and updates its freshness fields —
// Data Health reads mart recency from there.

import { createClient } from "npm:@supabase/supabase-js@2";

const BQ_PROJECT = "effen-growth-prod";
const MART = "`effen-growth-prod.marts.mart_ads_daily`";
const CONNECTION_ID = 3; // integration_connections: Meta Ads
const WINDOW_DAYS = 40;
const UPSERT_BATCH = 500;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === "string"
    ? new TextEncoder().encode(data)
    : data;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function googleAccessToken(
  keyJson: { client_email: string; private_key: string },
): Promise<string> {
  const pem = keyJson.private_key
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s/g, "");
  const key = await crypto.subtle.importKey(
    "pkcs8",
    b64ToBytes(pem),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({
    iss: keyJson.client_email,
    scope: "https://www.googleapis.com/auth/bigquery.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      key,
      new TextEncoder().encode(`${header}.${claims}`),
    ),
  );
  const jwt = `${header}.${claims}.${b64url(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`google token: ${res.status} ${await res.text()}`);
  return (await res.json()).access_token;
}

// deno-lint-ignore no-explicit-any
type MartRow = Record<string, any>;

async function queryMart(token: string, fullSync: boolean): Promise<MartRow[]> {
  const where = fullSync
    ? ""
    : `where date >= date_sub(current_date(), interval ${WINDOW_DAYS} day)`;
  const query = `
    select cast(date as string) date, platform, account_id, account_name,
      brand_slug, brand_resolution_method, market, campaign_id,
      campaign_name, cast(spend as float64) spend, currency_code,
      impressions, clicks, purchases, cast(purchase_value as float64)
      purchase_value, source, is_banned_account,
      cast(unix_millis(ingested_at) as int64) ingested_ms
    from ${MART} ${where}`;

  const rows: MartRow[] = [];
  let pageToken: string | undefined;
  let jobId: string | undefined;
  do {
    const url = jobId
      ? `https://bigquery.googleapis.com/bigquery/v2/projects/${BQ_PROJECT}/queries/${jobId}?maxResults=10000&location=asia-southeast1${
        pageToken ? `&pageToken=${pageToken}` : ""
      }`
      : `https://bigquery.googleapis.com/bigquery/v2/projects/${BQ_PROJECT}/queries`;
    const res = await fetch(url, {
      method: jobId ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: jobId ? undefined : JSON.stringify({
        query,
        useLegacySql: false,
        maxResults: 10000,
        timeoutMs: 60000,
      }),
    });
    if (!res.ok) throw new Error(`bigquery: ${res.status} ${await res.text()}`);
    const data = await res.json();
    if (!data.jobComplete) throw new Error("bigquery: job not complete");
    jobId = data.jobReference.jobId;
    pageToken = data.pageToken;
    const fields: string[] = (data.schema?.fields ?? []).map(
      (f: { name: string }) => f.name,
    );
    for (const r of data.rows ?? []) {
      const row: MartRow = {};
      fields.forEach((name, i) => (row[name] = r.f[i].v));
      rows.push(row);
    }
  } while (pageToken);
  return rows;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const fullSync = url.searchParams.get("mode") === "full";

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: conn } = await supabase
    .from("integration_connections")
    .select("id, workspace_id")
    .eq("id", CONNECTION_ID)
    .single();
  if (!conn) {
    return new Response(JSON.stringify({ error: "connection row missing" }), {
      status: 500,
      headers: CORS_HEADERS,
    });
  }

  const { data: run } = await supabase
    .from("sync_runs")
    .insert({
      workspace_id: conn.workspace_id,
      integration_id: conn.id,
      status: "running",
      records_read: 0,
      records_written: 0,
      error_count: 0,
    })
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
    const keyB64 = Deno.env.get("BQ_SA_KEY_B64");
    if (!keyB64) throw new Error("BQ_SA_KEY_B64 secret not set");
    const keyJson = JSON.parse(new TextDecoder().decode(b64ToBytes(keyB64)));

    const token = await googleAccessToken(keyJson);
    const martRows = await queryMart(token, fullSync);

    // account_ref lookup: platform account id -> register row id
    const { data: accounts } = await supabase
      .from("ad_accounts_read")
      .select("id, account_id");
    const refByAccountId = new Map(
      (accounts ?? []).map((a) => [String(a.account_id), a.id]),
    );

    const now = new Date().toISOString();
    const upserts = martRows.map((r) => ({
      date: r.date,
      platform: r.platform,
      account_id: r.account_id,
      account_ref: refByAccountId.get(String(r.account_id)) ?? null,
      campaign_id: r.campaign_id ?? "",
      campaign_name: r.campaign_name,
      brand_slug: r.brand_slug,
      market: r.market,
      spend: Number(r.spend ?? 0),
      impressions: r.impressions === null ? null : Number(r.impressions),
      clicks: r.clicks === null ? null : Number(r.clicks),
      purchases: r.purchases === null ? null : Number(r.purchases),
      purchase_value: r.purchase_value === null
        ? null
        : Number(r.purchase_value),
      source: r.source,
      is_banned_account: r.is_banned_account === "true" ||
        r.is_banned_account === true,
      workspace_id: conn.workspace_id,
      captured_at: now,
      mart_synced_at: now,
    }));

    let written = 0;
    for (let i = 0; i < upserts.length; i += UPSERT_BATCH) {
      const batch = upserts.slice(i, i + UPSERT_BATCH);
      const { error } = await supabase
        .from("ad_daily_facts")
        .upsert(batch, {
          onConflict: "date,platform,account_id,campaign_id",
        });
      if (error) throw new Error(`upsert: ${error.message}`);
      written += batch.length;
    }

    let legacyDeleted = 0;
    if (fullSync) {
      const { count, error } = await supabase
        .from("ad_daily_facts")
        .delete({ count: "exact" })
        .eq("source", "legacy_seed");
      if (error) throw new Error(`legacy delete: ${error.message}`);
      legacyDeleted = count ?? 0;
    }

    await supabase
      .from("integration_connections")
      .update({ status: "healthy", last_success_at: now, sync_checkpoint: now })
      .eq("id", conn.id);

    await finishRun({
      status: "success",
      records_read: martRows.length,
      records_written: written,
      message: `mode=${fullSync ? "full" : "window"} legacy_deleted=${legacyDeleted}`,
    });

    return new Response(
      JSON.stringify({
        ok: true,
        mode: fullSync ? "full" : "window",
        read: martRows.length,
        written,
        legacyDeleted,
      }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from("integration_connections")
      .update({ last_failure_at: new Date().toISOString() })
      .eq("id", CONNECTION_ID);
    await finishRun({
      status: "error",
      error_count: 1,
      reason_code: "mart_sync_failed",
      message,
    });
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
