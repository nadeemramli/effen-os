// address-suggest — suggest-only AI corrections for flagged shipping details.
//
// Runs after each woo-sync tick (pg_cron). Candidates come from
// ship_grades(): orders with red issues or yellow warnings, scoped by the
// OpenRouter connection's config.ai_scope ('pilot' = fulfilment-enabled
// stores only, 'all' = every store). Each candidate's graded fields are
// hashed; a suggestion is requested at most once per (order, hash) — a
// correction changes the hash, so a still-flagged order gets exactly one
// fresh look.
//
// GUARDRAIL: this function only ever writes ai_suggestions rows. Nothing
// auto-applies. A human accepts a suggestion in the fix-shipping dialog and
// that write rides save_order_correction via accept_ai_suggestion.
//
// Key: Vault OPENROUTER_API_KEY (set_ai_connection RPC), falling back to
// the OPENROUTER_API_KEY edge secret. Unconfigured → quiet skip so the
// cron stays silent until the key is pasted.
//
// Cost controls: config.batch_cap per run, config.daily_cap per 24h
// (finishes 'partial' with reason_code DAILY_CAP), per-row token/cost
// columns, provider data_collection=deny.

import { createClient } from "npm:@supabase/supabase-js@2";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const CORRECTABLE = ["name", "phone", "address_1", "postcode", "city", "state"] as const;

interface GradeRow {
  id: number;
  integration_id: number;
  market: string;
  issues: string[];
  warnings: string[];
  correction_status: string | null;
  fields: Record<string, string | null>;
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

async function inputHash(fields: Record<string, string | null>): Promise<string> {
  // Stable order — hash must not depend on JSON key ordering.
  const canonical = CORRECTABLE.map((k) => `${k}=${fields[k] ?? ""}`).join("|");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const RESPONSE_SCHEMA = {
  type: "json_schema",
  json_schema: {
    name: "address_correction",
    strict: true,
    schema: {
      type: "object",
      properties: {
        fields: {
          type: "object",
          properties: {
            name: { type: ["string", "null"] },
            phone: { type: ["string", "null"] },
            address_1: { type: ["string", "null"] },
            postcode: { type: ["string", "null"] },
            city: { type: ["string", "null"] },
            state: { type: ["string", "null"] },
          },
          required: ["name", "phone", "address_1", "postcode", "city", "state"],
          additionalProperties: false,
        },
        confidence: { type: "number" },
        rationale: { type: "string" },
      },
      required: ["fields", "confidence", "rationale"],
      additionalProperties: false,
    },
  },
};

const SYSTEM_PROMPT = `You verify and correct shipping addresses for a Malaysian/Singaporean e-commerce courier (Ninja Van). You receive the current shipping fields plus validation issue codes.

Propose corrections ONLY where the fix is confidently inferable from the given data — e.g. a postcode that contradicts the stated state/city (look up the correct postcode for that town), a phone missing its country prefix, a city misspelling, a state that doesn't match the postcode, or an address line whose parts are jumbled but present. Restructure, complete, and normalise; NEVER invent house numbers, unit numbers, or street names that are not derivable from the input. If a field is fine or unfixable, return null for it. Set confidence 0-1 for the overall proposal and a one-sentence rationale mentioning what you fixed and why. The goal is courier deliverability.`;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Optional body: { batch_cap?: number } for manual, larger runs.
  let body: { batch_cap?: number } = {};
  try {
    body = await req.json();
  } catch {
    // empty body is fine
  }

  const { data: conns } = await supabase
    .from("integration_connections").select("*").eq("provider", "OpenRouter").limit(1);
  const conn = conns?.[0];
  if (!conn) return json({ skipped: "no OpenRouter connection row" });

  const { data: vaultKey } = await supabase.rpc("get_ai_secrets");
  const apiKey: string | undefined = vaultKey?.[0]?.api_key ?? Deno.env.get("OPENROUTER_API_KEY");
  if (!apiKey) return json({ skipped: "no API key configured" });

  const model: string = conn.config?.model ?? "openai/gpt-4o-mini";
  const batchCap = Math.min(Math.max(body.batch_cap ?? conn.config?.batch_cap ?? 20, 1), 50);
  const dailyCap: number = conn.config?.daily_cap ?? 400;
  const scope: string = conn.config?.ai_scope ?? "pilot";

  // Candidates: flagged grades, pilot-scoped unless widened.
  const { data: grades, error: gradesError } = await supabase.rpc("ship_grades", { p_days: 14 });
  if (gradesError) return json({ error: gradesError.message }, 500);

  let pilotIds: Set<number> | null = null;
  if (scope === "pilot") {
    const { data: stores } = await supabase
      .from("integration_connections").select("id, config").eq("provider", "WooCommerce");
    pilotIds = new Set(
      (stores ?? [])
        .filter((s) => ["shadow", "live"].includes(s.config?.fulfilment_mode))
        .map((s) => s.id as number),
    );
  }

  const flagged = ((grades ?? []) as GradeRow[]).filter((g) =>
    (g.issues.length > 0 || g.warnings.length > 0) &&
    (pilotIds === null || pilotIds.has(g.integration_id))
  );

  // Dedupe: one suggestion per (order, input_hash).
  const { data: existing } = await supabase
    .from("ai_suggestions").select("order_read_id, input_hash");
  const seen = new Set((existing ?? []).map((e) => `${e.order_read_id}:${e.input_hash}`));

  const candidates: { grade: GradeRow; hash: string }[] = [];
  for (const g of flagged) {
    const hash = await inputHash(g.fields ?? {});
    if (!seen.has(`${g.id}:${hash}`)) candidates.push({ grade: g, hash });
  }

  if (candidates.length === 0) return json({ done: "no new candidates" });

  const { count: last24h } = await supabase
    .from("ai_suggestions")
    .select("id", { count: "exact", head: true })
    .gt("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString());
  const dailyRemaining = Math.max(dailyCap - (last24h ?? 0), 0);

  const { data: run } = await supabase
    .from("sync_runs")
    .insert({ workspace_id: conn.workspace_id, integration_id: conn.id, status: "running" })
    .select("id")
    .single();
  const finishRun = async (patch: Record<string, unknown>) => {
    if (run) {
      await supabase.from("sync_runs")
        .update({ finished_at: new Date().toISOString(), ...patch })
        .eq("id", run.id);
    }
  };

  let written = 0;
  let errors = 0;
  const batch = candidates.slice(0, Math.min(batchCap, dailyRemaining));

  for (const { grade, hash } of batch) {
    try {
      const res = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "X-Title": "Fullkit address assist",
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 600,
          provider: { data_collection: "deny" },
          usage: { include: true },
          response_format: RESPONSE_SCHEMA,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: JSON.stringify({
                market: grade.market,
                issue_codes: grade.issues,
                warning_codes: grade.warnings,
                shipping_fields: grade.fields,
              }),
            },
          ],
        }),
      });

      if (res.status === 401 || res.status === 402) {
        // Key rejected / out of credits — abort the whole run, mark degraded.
        await finishRun({
          status: "failed",
          error_count: 1,
          reason_code: "AUTH_REJECTED",
          message: `OpenRouter returned ${res.status} — check the API key and credit balance.`,
        });
        await supabase.from("integration_connections")
          .update({ status: "degraded", last_failure_at: new Date().toISOString() })
          .eq("id", conn.id);
        return json({ failed: "AUTH_REJECTED" }, 502);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status} from OpenRouter`);

      const completion = await res.json();
      const parsed = JSON.parse(completion.choices?.[0]?.message?.content ?? "{}");
      const fields: Record<string, string> = {};
      for (const k of CORRECTABLE) {
        const v = parsed.fields?.[k];
        if (typeof v === "string" && v.trim() !== "" && v.trim() !== (grade.fields?.[k] ?? "").trim()) {
          fields[k] = v.trim();
        }
      }

      // "Nothing fixable" is still an answer worth remembering (status
      // 'failed' — the hash blocks a retry; the UI only surfaces 'pending').
      const proposedAny = Object.keys(fields).length > 0;
      const { data: inserted, error: insertError } = await supabase
        .from("ai_suggestions")
        .insert({
          workspace_id: conn.workspace_id,
          order_read_id: grade.id,
          input_hash: hash,
          payload: {
            fields,
            confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
            rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
          },
          model,
          status: proposedAny ? "pending" : "failed",
          prompt_tokens: completion.usage?.prompt_tokens ?? null,
          completion_tokens: completion.usage?.completion_tokens ?? null,
          cost_usd: completion.usage?.cost ?? null,
        })
        .select("id")
        .single();
      if (insertError) throw new Error(`insert failed: ${insertError.message}`);

      if (proposedAny) {
        // Older open suggestions for the same order are stale now.
        await supabase.from("ai_suggestions")
          .update({ status: "superseded", resolved_at: new Date().toISOString() })
          .eq("order_read_id", grade.id)
          .in("status", ["pending", "shown"])
          .neq("id", inserted!.id);
        written += 1;
      }

      await new Promise((r) => setTimeout(r, 400));
    } catch (_err) {
      // Transient per-order failure: no row inserted, so the next run
      // retries it (bounded by the caps).
      errors += 1;
    }
  }

  const cappedByDaily = candidates.length > batch.length && batch.length === dailyRemaining;
  await finishRun({
    status: cappedByDaily ? "partial" : "success",
    records_read: candidates.length,
    records_written: written,
    error_count: errors,
    reason_code: cappedByDaily ? "DAILY_CAP" : null,
    message: `AI: ${written} suggestions from ${batch.length} calls (${candidates.length} candidates${cappedByDaily ? ", daily cap hit" : ""})`,
  });
  await supabase.from("integration_connections")
    .update({ status: "healthy", last_success_at: new Date().toISOString() })
    .eq("id", conn.id);

  return json({ candidates: candidates.length, called: batch.length, written, errors });
});
