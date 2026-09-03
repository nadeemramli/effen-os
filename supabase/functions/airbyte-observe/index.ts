// airbyte-observe — polls the Airbyte public API as the backup to webhook
// notifications (pg_cron every 30 minutes, verify_jwt = true with the
// publishable key like the other scheduled functions).
//
//   connections → airbyte_connections (id, name, status, schedule)
//   sync jobs updated in the last 48h → pipeline_runs (stage 'airbyte')
//
// Quiet until set_airbyte_connection has stored an API application client
// id/secret and the workspace id. Read-only against Airbyte; it never
// triggers, cancels or reconfigures a sync. Every poll logs a sync_runs row
// on the Airbyte connection so the register shows freshness and failures.

import { createClient } from "npm:@supabase/supabase-js@2";

const API = "https://api.airbyte.com/v1";

function supa() {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
}

interface Secrets {
  webhook_token: string | null;
  client_id: string | null;
  client_secret: string | null;
  workspace_id: string | null;
}

interface ApiConnection {
  connectionId: string;
  name: string;
  sourceId?: string;
  status?: string;
  schedule?: { scheduleType?: string; cronExpression?: string | null };
}

interface ApiJob {
  jobId: number;
  status: "pending" | "running" | "incomplete" | "failed" | "succeeded" | "cancelled";
  jobType: string;
  startTime?: string;
  lastUpdatedAt?: string;
  duration?: string;
  bytesSynced?: number;
  rowsSynced?: number;
  connectionId: string;
}

const STATUS_MAP: Record<ApiJob["status"], string> = {
  pending: "pending",
  running: "running",
  incomplete: "incomplete",
  failed: "failed",
  succeeded: "success",
  cancelled: "cancelled",
};
const TERMINAL = new Set(["failed", "succeeded", "cancelled", "incomplete"]);

function keyFromName(name: string | undefined): string | null {
  if (!name) return null;
  const m = name.match(/^meta-ads (.+?) -> /);
  if (m) return m[1];
  if (name.startsWith("supabase")) return "supabase_to_bq";
  return null;
}

/** ISO-8601 duration (PT8H6M12S) → seconds; null when unparseable. */
function durationSeconds(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = iso.match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!m) return null;
  return Number(m[1] ?? 0) * 86400 + Number(m[2] ?? 0) * 3600 + Number(m[3] ?? 0) * 60 + Number(m[4] ?? 0);
}

async function accessToken(s: Secrets): Promise<string> {
  const res = await fetch(`${API}/applications/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: s.client_id, client_secret: s.client_secret, "grant-type": "client_credentials", grant_type: "client_credentials" }),
  });
  if (!res.ok) throw new Error(`airbyte token: ${res.status} ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("airbyte token: no access_token in response");
  return json.access_token;
}

async function paged<T>(url: string, token: string, maxPages = 5): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = url;
  for (let i = 0; i < maxPages && next; i++) {
    const res: Response = await fetch(next, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (!res.ok) throw new Error(`airbyte api ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { data?: T[]; next?: string | null };
    out.push(...(json.data ?? []));
    next = json.next ?? null;
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("method not allowed", { status: 405 });
  const supabase = supa();

  const { data: secretRows } = await supabase.rpc("get_airbyte_secrets");
  const s = (secretRows?.[0] as Secrets | undefined) ?? { webhook_token: null, client_id: null, client_secret: null, workspace_id: null };
  if (!s.client_id || !s.client_secret || !s.workspace_id) {
    return new Response(JSON.stringify({ skipped: "not_configured" }), { status: 200, headers: { "Content-Type": "application/json" } });
  }

  const { data: conn } = await supabase.from("integration_connections").select("id, workspace_id").eq("provider", "Airbyte").maybeSingle();
  if (!conn) return new Response("no connection row", { status: 500 });
  const ws = (conn as { workspace_id: number }).workspace_id;
  const integrationId = (conn as { id: number }).id;
  const startedAt = new Date().toISOString();

  const { data: runRow } = await supabase
    .from("sync_runs")
    .insert({ workspace_id: ws, integration_id: integrationId, started_at: startedAt, status: "running", records_read: 0, records_written: 0, error_count: 0 })
    .select("id")
    .single();
  const runId = (runRow as { id: number } | null)?.id ?? null;

  try {
    const token = await accessToken(s);

    // ---- connections → registry ----
    const connections = await paged<ApiConnection>(`${API}/connections?workspaceIds=${encodeURIComponent(s.workspace_id)}&limit=100`, token);
    const now = new Date().toISOString();
    const keyByConnectionId = new Map<string, string>();
    for (const c of connections) {
      const key = keyFromName(c.name);
      const schedule = c.schedule?.cronExpression ?? c.schedule?.scheduleType ?? null;
      const patch = { connection_id: c.connectionId, source_id: c.sourceId ?? null, name: c.name, schedule, updated_at: now };
      let matched = false;
      if (key) {
        const { data } = await supabase.from("airbyte_connections").update(patch).eq("key", key).select("id");
        matched = (data?.length ?? 0) > 0;
        if (matched) keyByConnectionId.set(c.connectionId, key);
      }
      if (!matched) {
        const { data } = await supabase.from("airbyte_connections").update(patch).eq("connection_id", c.connectionId).select("key");
        if ((data?.length ?? 0) > 0) {
          keyByConnectionId.set(c.connectionId, (data![0] as { key: string }).key);
        } else {
          const fallbackKey = key ?? `unregistered_${c.connectionId.slice(0, 8)}`;
          await supabase.from("airbyte_connections").insert({
            workspace_id: ws,
            key: fallbackKey,
            kind: fallbackKey === "supabase_to_bq" ? "supabase" : "meta",
            active: c.status === "active",
            ...patch,
          });
          keyByConnectionId.set(c.connectionId, fallbackKey);
        }
      }
    }

    // ---- sync jobs (48h) → ledger ----
    const since = new Date(Date.now() - 48 * 3_600_000).toISOString();
    const jobs = await paged<ApiJob>(
      `${API}/jobs?workspaceIds=${encodeURIComponent(s.workspace_id)}&jobType=sync&limit=100&orderBy=${encodeURIComponent("updatedAt|DESC")}&updatedAtStart=${encodeURIComponent(since)}`,
      token,
    );
    let written = 0;
    const latestByConnection = new Map<string, ApiJob>();
    for (const j of jobs) {
      const status = STATUS_MAP[j.status] ?? "info";
      const terminal = TERMINAL.has(j.status);
      const row = {
        workspace_id: ws,
        stage: "airbyte",
        connection_key: keyByConnectionId.get(j.connectionId) ?? null,
        connection_id: j.connectionId,
        external_id: String(j.jobId),
        event_type: "sync",
        status,
        started_at: j.startTime ?? null,
        finished_at: terminal ? (j.lastUpdatedAt ?? null) : null,
        records: typeof j.rowsSynced === "number" ? j.rowsSynced : null,
        bytes: typeof j.bytesSynced === "number" ? j.bytesSynced : null,
        summary: { duration_s: durationSeconds(j.duration), api_status: j.status },
        received_via: "poll",
        updated_at: now,
      };
      const { error } = await supabase.from("pipeline_runs").upsert(row, { onConflict: "stage,external_id" });
      if (!error) written += 1;
      const prev = latestByConnection.get(j.connectionId);
      if (!prev || (j.lastUpdatedAt ?? "") > (prev.lastUpdatedAt ?? "")) latestByConnection.set(j.connectionId, j);
    }
    for (const [connectionId, j] of latestByConnection) {
      const patch: Record<string, unknown> = { last_job_at: j.lastUpdatedAt ?? j.startTime ?? now, last_status: STATUS_MAP[j.status] ?? j.status, updated_at: now };
      if (j.status === "succeeded") patch.last_success_at = j.lastUpdatedAt ?? now;
      await supabase.from("airbyte_connections").update(patch).eq("connection_id", connectionId);
    }

    const finished = new Date().toISOString();
    if (runId) {
      await supabase.from("sync_runs").update({
        finished_at: finished, status: "success", records_read: jobs.length, records_written: written,
        message: `Airbyte: ${connections.length} connections, ${jobs.length} jobs (48h), ${written} ledger rows`,
      }).eq("id", runId);
    }
    await supabase.from("integration_connections").update({ status: "healthy", last_success_at: finished, sync_checkpoint: finished }).eq("id", integrationId);
    return new Response(JSON.stringify({ connections: connections.length, jobs: jobs.length, written }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    const message = (e as Error).message;
    const finished = new Date().toISOString();
    if (runId) {
      await supabase.from("sync_runs").update({ finished_at: finished, status: "failed", error_count: 1, reason_code: message.includes("token") ? "AUTH_REJECTED" : "AIRBYTE_API", message: message.slice(0, 500) }).eq("id", runId);
    }
    await supabase.from("integration_connections").update({ status: "degraded", last_failure_at: finished }).eq("id", integrationId);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
