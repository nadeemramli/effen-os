// creative-mart-sync — serving copy of the creative read contract
// (ADR-0010). PROPOSED: not deployed, no cron. Needs, in order:
//   1. creative schema applied (done 2026-10-01: migrations 20261001111055…112644);
//   2. dbt creative models enabled (var creative_media_enabled) and built;
//   3. sa-mart-sync granted read on the two new marts (it already reads
//      marts.*; no new credential).
//
// Reads marts.mart_creative_image_daily and marts.mart_creative_ad_daily
// over the same 40-day restatement window as mart-sync (late conversions
// revise outcomes) and upserts through the service-role-only RPCs
// creative_upsert_image_facts / creative_upsert_ad_facts. The campaign
// mart and mart-sync are untouched.

import { createClient } from "npm:@supabase/supabase-js@2";

const BQ_PROJECT = "effen-growth-prod";
const WINDOW_DAYS = 40;
const BATCH = 500;

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
type Row = Record<string, any>;

// BigQuery REST cell → JS value (repeated fields arrive as [{v: …}])
// deno-lint-ignore no-explicit-any
function cell(v: any): any {
  return Array.isArray(v) ? v.map((x) => cell(x?.v)) : v;
}

async function query(token: string, sql: string): Promise<Row[]> {
  const rows: Row[] = [];
  let pageToken: string | undefined;
  let jobId: string | undefined;
  do {
    const url = jobId
      ? `https://bigquery.googleapis.com/bigquery/v2/projects/${BQ_PROJECT}/queries/${jobId}?maxResults=10000&location=asia-southeast1${pageToken ? `&pageToken=${pageToken}` : ""}`
      : `https://bigquery.googleapis.com/bigquery/v2/projects/${BQ_PROJECT}/queries`;
    const res = await fetch(url, {
      method: jobId ? "GET" : "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: jobId ? undefined : JSON.stringify({ query: sql, useLegacySql: false, maxResults: 10000, timeoutMs: 60000 }),
    });
    if (!res.ok) throw new Error(`bigquery: ${res.status} ${await res.text()}`);
    const data = await res.json();
    if (!data.jobComplete) throw new Error("bigquery: job not complete");
    jobId = data.jobReference.jobId;
    pageToken = data.pageToken;
    const fields: string[] = (data.schema?.fields ?? []).map((f: { name: string }) => f.name);
    for (const r of data.rows ?? []) {
      const row: Row = {};
      fields.forEach((name, i) => (row[name] = cell(r.f[i].v)));
      rows.push(row);
    }
  } while (pageToken);
  return rows;
}

const IMAGE_SQL = `
  select cast(date as string) date, platform, account_id, image_hash, brand_slug, market,
    currency_code, campaign_objective, attribution_setting, account_timezone, ads, ad_ids,
    cast(spend as float64) spend, impressions, clicks, purchases,
    cast(purchase_value as float64) purchase_value, any_banned_account, data_maturity,
    cast(ingested_at as string) ingested_at
  from \`${BQ_PROJECT}.marts.mart_creative_image_daily\`
  where date >= date_sub(current_date(), interval ${WINDOW_DAYS} day)`;

const AD_SQL = `
  select cast(date as string) date, platform, account_id, campaign_id, adset_id, ad_id,
    creative_id, creative_format, binding_status, image_hash, brand_slug, market, currency_code,
    campaign_objective, attribution_setting, cast(spend as float64) spend, impressions, clicks,
    purchases, cast(purchase_value as float64) purchase_value, data_maturity,
    cast(ingested_at as string) ingested_at
  from \`${BQ_PROJECT}.marts.mart_creative_ad_daily\`
  where date >= date_sub(current_date(), interval ${WINDOW_DAYS} day)`;

Deno.serve(async () => {
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const keyJson = JSON.parse(new TextDecoder().decode(b64ToBytes(Deno.env.get("BQ_SA_KEY_B64")!)));
    const token = await googleAccessToken(keyJson);
    const out: Record<string, number> = {};
    for (const [name, sql, rpc] of [
      ["image", IMAGE_SQL, "creative_upsert_image_facts"],
      ["ad", AD_SQL, "creative_upsert_ad_facts"],
    ] as const) {
      const rows = await query(token, sql);
      let n = 0;
      for (let i = 0; i < rows.length; i += BATCH) {
        const { data, error } = await supabase.rpc(rpc, { p_rows: rows.slice(i, i + BATCH) });
        if (error) throw new Error(`${rpc}: ${error.message}`);
        n += Number(data ?? 0);
      }
      out[name] = n;
    }
    return Response.json({ ok: true, upserted: out });
  } catch (e) {
    return Response.json({ ok: false, error: String(e) }, { status: 500 });
  }
});
