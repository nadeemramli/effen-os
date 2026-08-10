// nv-submit — consumes the fulfilment gate's green lane (ADR-0006).
//
// Generate pass: order_fulfilment rows at gate_passed whose hold window has
// elapsed (eligible_at <= now) on fulfilment-enabled stores get a full NV
// order-create payload built (corrections overlaid) and logged to
// nv_submissions with an idempotency key. SHADOW MODE MAKES NO HTTP CALL —
// the payload is evidence for the ADR-0006 exit gate. The live branch
// (getToken/createOrder) exists but is unreachable until an hq_admin flips
// set_fulfilment_mode(id, 'live').
//
// Compare pass: NV webhooks carry no recipient data and no brand link
// (verified 2026-08-08), so shadow rows are scored against Woo as ground
// truth — Fighter shipping an order flips its Woo status:
//   completed → matched · cancelled/refunded/failed → mismatched ·
//   still open after 7 days → unmatched. A direct nv_shipments.order_ref
//   join is attempted opportunistically for tracking propagation.
//
// sync_runs rows ('NV:' prefix, against the pilot store connection) only
// when something happened or failed; cadence health = cron.job_run_details.

import { createClient } from "npm:@supabase/supabase-js@2";
import { buildOrderPayload, idempotencyKey } from "./nv-client.ts";

const GENERATE_BATCH = 50;
const UNMATCHED_AFTER_DAYS = 7;
const WOO_DEAD_STATUSES = ["cancelled", "refunded", "failed", "trash"];

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

  const { data: stores } = await supabase
    .from("integration_connections").select("*").eq("provider", "WooCommerce");
  const enabled = new Map(
    (stores ?? [])
      .filter((s) => ["shadow", "live"].includes(s.config?.fulfilment_mode))
      .map((s) => [s.id as number, s]),
  );
  if (enabled.size === 0) return json({ skipped: "no fulfilment-enabled stores" });
  const pilot = [...enabled.values()][0];

  let generated = 0;
  let compared = 0;
  let errors = 0;
  const notes: string[] = [];

  try {
    // ---------- generate pass ----------
    const { data: due, error: dueError } = await supabase
      .from("order_fulfilment")
      .select("id, order_read_id, integration_id")
      .eq("stage", "gate_passed")
      .lte("eligible_at", new Date().toISOString())
      .in("integration_id", [...enabled.keys()])
      .limit(GENERATE_BATCH);
    if (dueError) throw new Error(dueError.message);

    for (const f of due ?? []) {
      const conn = enabled.get(f.integration_id)!;
      const mode: "shadow" | "live" = conn.config.fulfilment_mode;

      const { data: order } = await supabase
        .from("orders_read")
        .select("id, workspace_id, integration_id, source_order_id, order_number, total, currency_code, customer, items, raw")
        .eq("id", f.order_read_id)
        .single();
      if (!order) continue;

      const { data: correction } = await supabase
        .from("order_corrections")
        .select("corrected, status")
        .eq("order_read_id", order.id)
        .in("status", ["staged", "applied"])
        .maybeSingle();

      const payload = buildOrderPayload(order, correction, conn);
      const { data: sub, error: subError } = await supabase
        .from("nv_submissions")
        .upsert({
          workspace_id: order.workspace_id,
          integration_id: order.integration_id,
          order_read_id: order.id,
          mode,
          idempotency_key: idempotencyKey(order),
          payload,
        }, { onConflict: "idempotency_key", ignoreDuplicates: true })
        .select("id")
        .maybeSingle();
      if (subError) {
        errors += 1;
        continue;
      }

      // Live mode would submit here (getToken + createOrder + response
      // handling). Unreachable until set_fulfilment_mode(..., 'live');
      // shadow logs and moves on.
      const { data: subRow } = sub
        ? { data: sub }
        : await supabase.from("nv_submissions").select("id")
            .eq("idempotency_key", idempotencyKey(order)).single();

      await supabase.from("order_fulfilment")
        .update({
          stage: "shadow_logged",
          nv_submission_id: subRow?.id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", f.id);
      generated += 1;
    }

    // ---------- compare pass (shadow, Woo ground truth) ----------
    const { data: open } = await supabase
      .from("nv_submissions")
      .select("id, order_read_id, created_at")
      .eq("mode", "shadow")
      .eq("status", "generated")
      .limit(500);

    for (const s of open ?? []) {
      const { data: order } = await supabase
        .from("orders_read")
        .select("id, order_number, source_order_id, source_status")
        .eq("id", s.order_read_id)
        .single();
      if (!order) continue;

      const daysOpen = (Date.now() - new Date(s.created_at).getTime()) / 86_400_000;
      let status: string | null = null;
      const compare: Record<string, unknown> = {
        matched_by: "woo_status",
        woo_status: order.source_status,
        days_open: Math.round(daysOpen * 10) / 10,
      };

      if (order.source_status === "completed") {
        status = "matched";
      } else if (WOO_DEAD_STATUSES.includes(order.source_status)) {
        status = "mismatched"; // passed the gate, then died at source — live mode needs NV cancel here
      } else if (daysOpen > UNMATCHED_AFTER_DAYS) {
        status = "unmatched";
      }
      if (!status) continue;

      // Opportunistic tracking link — works only if refs ever align.
      const { data: shipment } = await supabase
        .from("nv_shipments")
        .select("id, tracking_id")
        .eq("order_ref", order.order_number ?? order.source_order_id)
        .maybeSingle();
      if (shipment) {
        compare.tracking_id = shipment.tracking_id;
      }

      await supabase.from("nv_submissions")
        .update({
          status,
          compare,
          matched_shipment_id: shipment?.id ?? null,
          compared_at: new Date().toISOString(),
        })
        .eq("id", s.id);
      if (shipment) {
        await supabase.from("order_fulfilment")
          .update({ tracking_id: shipment.tracking_id, updated_at: new Date().toISOString() })
          .eq("order_read_id", s.order_read_id);
      }
      compared += 1;
    }
  } catch (err) {
    await supabase.from("sync_runs").insert({
      workspace_id: pilot.workspace_id,
      integration_id: pilot.id,
      status: "failed",
      finished_at: new Date().toISOString(),
      error_count: 1,
      reason_code: "NV_SUBMIT_ERROR",
      message: `NV: ${(err as Error).message.slice(0, 400)}`,
    });
    return json({ error: (err as Error).message }, 500);
  }

  if (generated + compared + errors > 0) {
    await supabase.from("sync_runs").insert({
      workspace_id: pilot.workspace_id,
      integration_id: pilot.id,
      status: errors > 0 ? "partial" : "success",
      finished_at: new Date().toISOString(),
      records_read: (generated + compared),
      records_written: generated,
      error_count: errors,
      message: `NV: ${generated} shadow payloads, ${compared} compared${notes.length ? " — " + notes.join("; ") : ""}`,
    });
  }

  return json({ generated, compared, errors });
});
