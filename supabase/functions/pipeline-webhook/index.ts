// pipeline-webhook — Airbyte notification receiver + dbt report endpoint.
//
// Deployed with verify_jwt = false: Airbyte Cloud and GitHub Actions call it
// directly. Airbyte webhooks carry no signature, so the URL carries a token
// (?token=...) issued by set_airbyte_connection and kept in Vault; the dbt
// report step sends the same token in X-Pipeline-Token. Mismatch → 401.
//
//   POST /pipeline-webhook?token=T             Airbyte notification (any event row)
//   POST /pipeline-webhook?token=T&stage=dbt   dbt workflow report (see .github/workflows/dbt.yml)
//
// Everything lands in pipeline_runs with the raw payload kept; Airbyte
// connections auto-register in airbyte_connections by id/name. The Airbyte
// payload shape is not formally versioned, so parsing is defensive: the
// structured `data` block is used when present, otherwise the event is
// classified from `text`. Observation only — nothing here retries or fixes.

import { createClient } from "npm:@supabase/supabase-js@2";

function supa() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

interface AirbyteData {
  workspace?: { id?: string; name?: string; url?: string };
  connection?: { id?: string; name?: string; url?: string };
  source?: { id?: string; name?: string };
  destination?: { id?: string; name?: string };
  jobId?: number | string;
  startedAt?: string;
  finishedAt?: string;
  bytesEmitted?: number;
  bytesCommitted?: number;
  recordsEmitted?: number;
  recordsCommitted?: number;
  durationInSeconds?: number;
  success?: boolean;
  errorMessage?: string;
  [key: string]: unknown;
}

interface AirbytePayload {
  text?: string;
  data?: AirbyteData;
  [key: string]: unknown;
}

type EventType = "sync" | "schema_change" | "schema_change_breaking" | "repeated_failures" | "disabled" | "test" | "unknown";
type Status = "success" | "failed" | "warning" | "info";

function classify(p: AirbytePayload): { event_type: EventType; status: Status } {
  const text = (typeof p.text === "string" ? p.text : "").toLowerCase();
  if (p.data && typeof p.data.success === "boolean") {
    return { event_type: "sync", status: p.data.success ? "success" : "failed" };
  }
  if (text.includes("test")) return { event_type: "test", status: "info" };
  if (text.includes("breaking")) return { event_type: "schema_change_breaking", status: "warning" };
  if (text.includes("schema")) return { event_type: "schema_change", status: "info" };
  if (text.includes("has been disabled") || text.includes("was disabled") || text.includes("automatically disabled")) {
    return { event_type: "disabled", status: "failed" };
  }
  if (text.includes("will be disabled") || text.includes("repeated failures")) return { event_type: "repeated_failures", status: "warning" };
  if (text.includes("succeeded") || text.includes("successful")) return { event_type: "sync", status: "success" };
  if (text.includes("failed") || text.includes("failure")) return { event_type: "sync", status: "failed" };
  return { event_type: "unknown", status: "info" };
}

/** Terraform key from the connection name ("meta-ads <key> -> bigquery.raw"). */
function keyFromName(name: string | undefined): string | null {
  if (!name) return null;
  const m = name.match(/^meta-ads (.+?) -> /);
  if (m) return m[1];
  if (name.startsWith("supabase")) return "supabase_to_bq";
  return null;
}

function isoOrNull(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function workspaceId(): Promise<number> {
  const { data } = await supa().from("workspaces").select("id").order("id").limit(1).single();
  return (data as { id: number }).id;
}

async function handleAirbyte(payload: AirbytePayload): Promise<Response> {
  const supabase = supa();
  const ws = await workspaceId();
  const { event_type, status } = classify(payload);
  const d = payload.data ?? {};
  const connectionId = typeof d.connection?.id === "string" && /^[0-9a-f-]{36}$/i.test(d.connection.id) ? d.connection.id : null;
  const connectionName = typeof d.connection?.name === "string" ? d.connection.name : null;
  const key = keyFromName(connectionName ?? undefined);
  const now = new Date().toISOString();

  // Registry: learn the Airbyte connection id from its name, or register an
  // unknown connection so it shows up as "observed but not expected".
  if (connectionId || key) {
    let existing: { id: number; key: string } | null = null;
    if (connectionId) {
      const { data } = await supabase.from("airbyte_connections").select("id, key").eq("connection_id", connectionId).maybeSingle();
      existing = (data as { id: number; key: string } | null) ?? null;
    }
    if (!existing && key) {
      const { data } = await supabase.from("airbyte_connections").select("id, key").eq("key", key).maybeSingle();
      existing = (data as { id: number; key: string } | null) ?? null;
    }
    const patch: Record<string, unknown> = { updated_at: now };
    if (connectionId) patch.connection_id = connectionId;
    if (connectionName) patch.name = connectionName;
    if (event_type === "sync") {
      patch.last_job_at = isoOrNull(d.finishedAt) ?? now;
      patch.last_status = status;
      if (status === "success") patch.last_success_at = isoOrNull(d.finishedAt) ?? now;
    }
    if (event_type === "disabled") patch.last_status = "disabled";
    if (existing) {
      await supabase.from("airbyte_connections").update(patch).eq("id", existing.id);
    } else {
      await supabase.from("airbyte_connections").insert({
        workspace_id: ws,
        key: key ?? `unregistered_${(connectionId ?? "unknown").slice(0, 8)}`,
        kind: key === "supabase_to_bq" ? "supabase" : "meta",
        active: false,
        ...patch,
      });
    }
  }

  const externalId = d.jobId !== undefined && d.jobId !== null ? String(d.jobId) : null;
  const row = {
    workspace_id: ws,
    stage: "airbyte",
    connection_key: key,
    connection_id: connectionId,
    external_id: externalId,
    event_type,
    status,
    started_at: isoOrNull(d.startedAt),
    finished_at: isoOrNull(d.finishedAt) ?? (event_type === "sync" ? now : null),
    records: typeof d.recordsCommitted === "number" ? d.recordsCommitted : typeof d.recordsEmitted === "number" ? d.recordsEmitted : null,
    bytes: typeof d.bytesCommitted === "number" ? d.bytesCommitted : typeof d.bytesEmitted === "number" ? d.bytesEmitted : null,
    error: status === "failed" ? (typeof d.errorMessage === "string" ? d.errorMessage : payload.text ?? null) : null,
    summary: typeof d.durationInSeconds === "number" ? { duration_s: d.durationInSeconds } : null,
    raw: payload,
    received_via: "webhook",
    updated_at: now,
  };
  const write = externalId
    ? supabase.from("pipeline_runs").upsert(row, { onConflict: "stage,external_id" })
    : supabase.from("pipeline_runs").insert(row);
  const { error } = await write;
  if (error) return new Response(`ledger write failed: ${error.message}`, { status: 500 });

  // Connection register: the webhook itself is the proof of life.
  const patch: Record<string, unknown> = {};
  if (status === "success" || event_type === "test") {
    patch.status = "healthy";
    patch.last_success_at = now;
  } else if (status === "failed") {
    patch.last_failure_at = now;
  }
  if (Object.keys(patch).length > 0) {
    await supabase.from("integration_connections").update(patch).eq("provider", "Airbyte");
  }

  return new Response(JSON.stringify({ received: true, event_type, status, connection: key ?? connectionName ?? null }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

interface DbtReport {
  external_id?: string | number;
  status?: string;
  started_at?: string;
  finished_at?: string;
  url?: string;
  error?: string;
  summary?: Record<string, unknown>;
}

async function handleDbt(report: DbtReport): Promise<Response> {
  const supabase = supa();
  const ws = await workspaceId();
  const now = new Date().toISOString();
  const status = report.status === "success" ? "success" : report.status === "cancelled" ? "cancelled" : "failed";
  const externalId = report.external_id !== undefined && report.external_id !== null ? String(report.external_id) : null;
  const summary = { ...(report.summary ?? {}), ...(report.url ? { url: report.url } : {}) };
  const row = {
    workspace_id: ws,
    stage: "dbt",
    external_id: externalId,
    event_type: "build",
    status,
    started_at: isoOrNull(report.started_at),
    finished_at: isoOrNull(report.finished_at) ?? now,
    error: report.error ?? (status === "failed" ? "dbt build failed — see the GitHub Actions run" : null),
    summary,
    raw: report,
    received_via: "ci",
    updated_at: now,
  };
  const write = externalId
    ? supabase.from("pipeline_runs").upsert(row, { onConflict: "stage,external_id" })
    : supabase.from("pipeline_runs").insert(row);
  const { error } = await write;
  if (error) return new Response(`ledger write failed: ${error.message}`, { status: 500 });
  return new Response(JSON.stringify({ received: true, stage: "dbt", status }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const { data: secrets } = await supa().rpc("get_airbyte_secrets");
  const expected: string | null = secrets?.[0]?.webhook_token ?? null;
  if (!expected) return new Response("not configured", { status: 503 });

  const url = new URL(req.url);
  const presented = url.searchParams.get("token") ?? req.headers.get("x-pipeline-token") ?? "";
  if (!constantTimeEqual(presented, expected)) return new Response("invalid token", { status: 401 });

  const rawBody = await req.text();
  let payload: Record<string, unknown>;
  try {
    payload = rawBody.trim() ? JSON.parse(rawBody) : {};
  } catch {
    // Airbyte's test ping may be plain text; keep it as an event rather than dropping it.
    payload = { text: rawBody.slice(0, 2000) };
  }

  const stage = url.searchParams.get("stage") ?? "airbyte";
  if (stage === "dbt") return handleDbt(payload as DbtReport);
  return handleAirbyte(payload as AirbytePayload);
});
