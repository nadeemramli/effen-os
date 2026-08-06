# Airbyte-as-code: BigQuery destination + Supabase Postgres source +
# connection. Meta/TikTok sources are created in the Airbyte UI (OAuth
# consent) and imported into state afterwards — see infra/README.md.

variable "airbyte_client_id" {
  type      = string
  sensitive = true
}

variable "airbyte_client_secret" {
  type      = string
  sensitive = true
}

variable "airbyte_organization_id" {
  type = string
}

variable "airbyte_workspace_id" {
  type = string
}

variable "airbyte_loader_key_path" {
  description = "Path to the sa-airbyte-loader service-account key JSON (minted via gcloud, never stored in the repo)"
  type        = string
  default     = "~/airbyte-loader-key.json"
}

variable "supabase_reader_password" {
  type      = string
  sensitive = true
}

provider "airbyte" {
  client_id     = var.airbyte_client_id
  client_secret = var.airbyte_client_secret
}

resource "airbyte_destination_bigquery" "warehouse" {
  name         = "bigquery-raw"
  workspace_id = var.airbyte_workspace_id

  configuration = {
    project_id       = var.project_id
    dataset_id       = google_bigquery_dataset.raw.dataset_id
    dataset_location = var.region
    credentials_json = file(pathexpand(var.airbyte_loader_key_path))
    loading_method = {
      batched_standard_inserts = {}
    }
  }
}

# Supabase read-models via the Supavisor SESSION pooler (IPv4) with
# cursor-based incremental — not CDC, not the direct IPv6 host (ADR-0003).
resource "airbyte_source_postgres" "supabase" {
  name         = "supabase-effen-os"
  workspace_id = var.airbyte_workspace_id

  configuration = {
    host     = "aws-0-ap-southeast-1.pooler.supabase.com"
    port     = 5432
    database = "postgres"
    username = "airbyte_reader.wwgtjjekhehaepbxyrij"
    password = var.supabase_reader_password
    schemas  = ["public"]
    ssl_mode = {
      require = {}
    }
    tunnel_method = {
      no_tunnel = {}
    }
    replication_method = {
      scan_changes_with_user_defined_cursor = {}
    }
  }
}

# orders_read is the only large table (~121k rows) -> incremental on
# synced_at; the rest are small and simplest as full refresh. Tables land
# as raw.supabase_<table>.
resource "airbyte_connection" "supabase_to_bq" {
  name           = "supabase -> bigquery.raw"
  source_id      = airbyte_source_postgres.supabase.source_id
  destination_id = airbyte_destination_bigquery.warehouse.destination_id
  prefix         = "supabase_"

  schedule = {
    schedule_type   = "cron"
    cron_expression = "0 0 20 * * ? UTC" # 04:00 MYT daily
  }

  configurations = {
    streams = [
      {
        name         = "orders_read"
        sync_mode    = "incremental_append"
        cursor_field = ["synced_at"]
      },
      { name = "ad_accounts_read", sync_mode = "full_refresh_overwrite" },
      { name = "ad_daily_facts", sync_mode = "full_refresh_overwrite" },
      { name = "nv_shipments", sync_mode = "full_refresh_overwrite" },
      { name = "brands", sync_mode = "full_refresh_overwrite" },
    ]
  }
}

# Meta ads. The facebook-marketing SOURCE is created in the Airbyte UI
# (OAuth consent by the Business Manager admin) and deliberately NOT
# managed by Terraform — Airbyte owns the OAuth credential lifecycle.
# Only the connection is code. One source carries ALL Meta ad-account
# ids (edit the account list in the UI to scale); currently: #5 Azman.
locals {
  meta_source_id = "d5a9bd5e-51ee-4593-9caf-a231c90cea76"
}

# ads_insights = daily ad-grain facts (spend, impressions, clicks,
# actions). Meta restates up to ~28 days back; the connector re-reads a
# lookback window, so incremental_append yields duplicate day-rows whose
# latest version wins in dbt staging.
resource "airbyte_connection" "meta_to_bq" {
  name           = "meta-ads -> bigquery.raw"
  source_id      = local.meta_source_id
  destination_id = airbyte_destination_bigquery.warehouse.destination_id
  prefix         = "meta_"

  schedule = {
    schedule_type   = "cron"
    cron_expression = "0 0 19 * * ? UTC" # 03:00 MYT daily
  }

  configurations = {
    streams = [
      { name = "ads_insights", sync_mode = "incremental_append" },
      { name = "campaigns", sync_mode = "full_refresh_overwrite" },
      { name = "ad_account", sync_mode = "full_refresh_overwrite" },
      # Ad-grain brand resolution: ads bridges ad_id -> creative_id;
      # ad_creatives carries destination URL + page/IG identity, which
      # the dbt brand waterfall maps to brand_slug (shared ad accounts
      # make account-level mapping insufficient).
      { name = "ads", sync_mode = "full_refresh_overwrite" },
      { name = "ad_creatives", sync_mode = "full_refresh_overwrite" },
    ]
  }
}
