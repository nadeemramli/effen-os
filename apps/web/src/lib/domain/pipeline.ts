/**
 * Ads-pipeline observability (Airbyte → dbt → mart-sync): the shapes served
 * by `live_pipeline_runs` and the vocabulary shared by Data health, the
 * Automations registry and the Airbyte setup card.
 */

export type PipelineStage = "airbyte" | "dbt" | "mart_sync";

export type PipelineRunStatus =
  | "pending"
  | "running"
  | "incomplete"
  | "success"
  | "failed"
  | "cancelled"
  | "warning"
  | "info";

export interface PipelineRun {
  id: number;
  stage: PipelineStage;
  connection_key: string | null;
  connection_name: string | null;
  event_type: "sync" | "schema_change" | "schema_change_breaking" | "repeated_failures" | "disabled" | "test" | "build" | "unknown";
  status: PipelineRunStatus;
  started_at: string | null;
  finished_at: string | null;
  records: number | null;
  error: string | null;
  summary: Record<string, unknown> | null;
  received_via: "webhook" | "poll" | "ci";
  received_at: string;
}

export interface AirbyteConnectionRow {
  key: string;
  name: string | null;
  kind: "meta" | "supabase";
  active: boolean;
  connection_id: string | null;
  schedule: string | null;
  last_job_at: string | null;
  last_status: string | null;
  last_success_at: string | null;
}

export interface PipelineSummary {
  airbyte: {
    expected: number;
    succeeded_26h: number;
    stale: number;
    observed: number;
    failed_24h: number;
    last_complete_at: string | null;
  };
  dbt: {
    last_status: string | null;
    last_finished_at: string | null;
    tests_failed: number | null;
    tests_warned: number | null;
    models_failed: number | null;
    last_success_at: string | null;
  } | null;
  mart: { last_sync_at: string | null; last_status: string | null };
}

export interface PipelineRuns {
  since: string;
  runs: PipelineRun[];
  connections: AirbyteConnectionRow[];
  summary: PipelineSummary;
}

export const STAGE_LABEL: Record<PipelineStage, string> = {
  airbyte: "Airbyte",
  dbt: "dbt",
  mart_sync: "mart-sync",
};

export const RUN_STATUS_TONE: Record<PipelineRunStatus, "success" | "warning" | "destructive" | "info" | "neutral"> = {
  pending: "neutral",
  running: "info",
  incomplete: "warning",
  success: "success",
  failed: "destructive",
  cancelled: "neutral",
  warning: "warning",
  info: "info",
};

export const EVENT_LABEL: Record<PipelineRun["event_type"], string> = {
  sync: "sync",
  schema_change: "schema change",
  schema_change_breaking: "breaking schema change",
  repeated_failures: "repeated failures",
  disabled: "connection disabled",
  test: "test ping",
  build: "build",
  unknown: "notification",
};
