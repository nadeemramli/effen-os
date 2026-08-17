// nv-webhook — Ninja Van tracking event receiver.
//
// Deployed with verify_jwt = false because Ninja Van calls this endpoint
// directly. Security is Ninja Van's webhook model instead: every POST carries
// X-Ninjavan-Hmac-Sha256, a base64 HMAC-SHA256 of the raw body keyed with the
// API Client Key. Unsigned or mis-signed requests are rejected 401.
//
// Events land append-only in nv_events (event_key dedupes webhook retries)
// and roll up into nv_shipments, one row per tracking id with the latest
// status. Order linkage stays loose — nv_shipments.order_ref joins to
// orders_read.order_number in views, never at ingest time.

import { createClient } from "npm:@supabase/supabase-js@2";

const TERMINAL_STATUSES = new Set([
  "completed",
  "delivered",
  "returned to sender",
  "cancelled",
]);

function supa() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

async function validSignature(rawBody: string, header: string | null, clientKey: string): Promise<boolean> {
  if (!header) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(clientKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));
  if (expected.length !== header.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ header.charCodeAt(i);
  return diff === 0;
}

interface NvEvent {
  id?: string;
  tracking_id?: string;
  tracking_ref_no?: string;
  shipper_order_ref_no?: string;
  status?: string;
  previous_status?: string;
  timestamp?: string;
  [key: string]: unknown;
}

async function ingestEvent(workspaceId: number, ev: NvEvent): Promise<boolean> {
  const supabase = supa();
  const trackingId = ev.tracking_id ?? ev.tracking_ref_no;
  if (!trackingId) return false;

  const status = ev.status ?? null;
  const eventAt = ev.timestamp ? new Date(ev.timestamp).toISOString() : new Date().toISOString();
  const orderRef = ev.shipper_order_ref_no ?? ev.tracking_ref_no ?? null;

  const { data: shipment, error: upsertErr } = await supabase
    .from("nv_shipments")
    .upsert(
      {
        workspace_id: workspaceId,
        tracking_id: trackingId,
        ...(orderRef ? { order_ref: orderRef } : {}),
      },
      { onConflict: "tracking_id" },
    )
    .select("id, last_event_at")
    .single();
  if (upsertErr || !shipment) return false;

  const eventKey = ev.id ?? `${trackingId}:${status ?? "?"}:${eventAt}`;
  const { error: evErr } = await supabase.from("nv_events").upsert(
    {
      workspace_id: workspaceId,
      shipment_id: shipment.id,
      event_key: eventKey,
      status,
      previous_status: ev.previous_status ?? null,
      event_at: eventAt,
      raw: ev,
    },
    { onConflict: "event_key", ignoreDuplicates: true },
  );
  if (evErr) return false;

  // Advance the rollup only for events at or after the newest we have seen —
  // webhook deliveries can arrive out of order. Compare instants, not
  // strings: PostgREST returns "+00:00" and toISOString() ends in ".000Z",
  // so a lexical compare let stale events overwrite terminal statuses.
  // (Durable RTS facts — rts_at / rts_reason / on_rts_leg — are maintained
  // by the nv_events_rts_trg trigger, independent of this rollup.)
  if (!shipment.last_event_at || Date.parse(shipment.last_event_at) <= Date.parse(eventAt)) {
    await supabase
      .from("nv_shipments")
      .update({
        status,
        is_terminal: status ? TERMINAL_STATUSES.has(status.toLowerCase()) : false,
        last_event_at: eventAt,
        raw: ev,
      })
      .eq("id", shipment.id);
  }
  return true;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }

  const supabase = supa();
  const { data: secrets } = await supabase.rpc("get_nv_secrets");
  const clientKey: string | null = secrets?.[0]?.client_key ?? null;
  if (!clientKey) {
    return new Response("not configured", { status: 503 });
  }

  const rawBody = await req.text();
  const signed = await validSignature(rawBody, req.headers.get("x-ninjavan-hmac-sha256"), clientKey);
  if (!signed) {
    return new Response("invalid signature", { status: 401 });
  }

  let payload: NvEvent | NvEvent[];
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("bad payload", { status: 400 });
  }

  const { data: conn } = await supabase
    .from("integration_connections")
    .select("id, workspace_id")
    .eq("provider", "Ninja Van")
    .maybeSingle();
  if (!conn) return new Response("no connection row", { status: 500 });

  const events = Array.isArray(payload) ? payload : [payload];
  let ingested = 0;
  for (const ev of events) {
    if (await ingestEvent(conn.workspace_id, ev)) ingested += 1;
  }

  await supabase
    .from("integration_connections")
    .update({ status: "healthy", last_success_at: new Date().toISOString() })
    .eq("id", conn.id);

  return new Response(JSON.stringify({ received: true, ingested }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
