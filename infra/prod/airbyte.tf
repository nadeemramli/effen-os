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

# Meta ads: ONE SOURCE PER AD ACCOUNT (operator's choice — per-account
# naming/status tracking in the Airbyte UI, and blast-radius isolation:
# a banned account's failing sync can't poison the others). Sources are
# created in the UI (OAuth) and NOT managed by Terraform; connections
# are code. Airbyte enforces destination stream uniqueness, so every
# connection gets a UNIQUE table prefix: raw.meta_<key>_<stream>. dbt
# auto-discovers those tables from INFORMATION_SCHEMA — adding an
# account needs a source in the UI plus one map entry here, no dbt
# changes.
#
# Map keys are permanent — renaming one destroys/recreates its
# connection and drops incremental sync state. active=false for
# banned/disabled accounts (connection exists, schedule off — their
# history arrives via the CSV-export path, ADR-0003).
locals {
  meta_sources = {
    "5_azman_lk"            = { id = "d5a9bd5e-51ee-4593-9caf-a231c90cea76", active = true }
    "9_azman_sg"            = { id = "c665b946-2c15-4dea-9f66-a075b81762c1", active = true }
    "acc_01"                = { id = "32bedcaf-f5db-47cb-9b73-ab6a68797bc3", active = true }
    "131_hazim"             = { id = "60de127e-4222-4977-a7fa-92df78ef2679", active = true }
    "147_hazim"             = { id = "924fe6c2-febc-4641-a73c-aaed22962192", active = true }
    "1060_pali"             = { id = "dac79a72-c652-4a25-9aba-368c1333ca10", active = false }
    "1061_hazim"            = { id = "f104c71c-3977-4033-ab31-6ad7185bebb3", active = true }
    "1062_haiqal"           = { id = "f37f1d74-d89c-4da2-9c85-972f49dd9c19", active = false }
    "1076_pali"             = { id = "0d56dd02-b0ab-4141-8513-e3fd9e43632f", active = false }
    "1077_pali_erxsg"       = { id = "f49c4cf3-b448-41dd-b942-12a6b2fcbb53", active = false }
    "1153_pali"             = { id = "13bbc884-228a-4516-a93b-55ae14551273", active = false }
    "1154_pali"             = { id = "e0043d82-cddb-4745-8377-a72845e8e420", active = false }
    "1300_pali"             = { id = "9aca613f-c68d-4698-a891-31e3c5a737dd", active = true }
    "1301_pali_erxsg"       = { id = "01162331-b419-4857-8bbb-6044e240507c", active = true }
    "1302_hazim"            = { id = "a40f419c-0224-48fc-bfa8-3b5c15760a2f", active = true }
    "1319_ijie_sg"          = { id = "eece8c92-06e6-41ed-8e55-a16c79bb864f", active = true }
    "1471_pali"             = { id = "21790a4c-0c43-4128-8016-d3ec32b24be4", active = true }
    "1472_pali"             = { id = "ac3587fd-5ef5-47a0-8003-8f043fb1c88e", active = true }
    "1473_pali"             = { id = "942e1351-9b45-4ac2-8237-4a9e2c17485f", active = true }
    "1474_amar_synovil_my"  = { id = "489ca20c-3e72-4afe-976e-f68e18732534", active = true }
    "1476_amar_synovil_sg"  = { id = "cfd6ca65-5289-4eca-ba84-2936067d47a2", active = true }
    "1604_amar_glycoxil_sg" = { id = "ce4b714c-5250-4626-8799-b0d7d982d47c", active = true }
    "1605_amar_glycoxil_my" = { id = "926fb43e-fc5e-4dc6-af3a-db852449aa2c", active = true }
    "1606"                  = { id = "a3a90979-a039-426b-a641-aba541f2b481", active = true }
    "2115_pali_test"        = { id = "dec94379-7cdf-48ed-a4a4-aa88ff718668", active = false }
    "2131_hazim"            = { id = "0b9b4c73-bb31-474b-9e02-75a4a7ca1abb", active = true }
    "adipocyde_my_1"        = { id = "f26171a5-1be5-45c9-b3dd-e239907ed4c0", active = true }
    "adipocyde_my_2"        = { id = "4049ab75-cb90-44b3-a427-369b480e3f9d", active = true }
    "adipocyde_sg_1"        = { id = "2fdd4f1a-0872-4c1e-b66e-a0e0b7fddfda", active = true }
    "adipocyde_sg_2"        = { id = "7b04750b-e50d-469e-b616-7b99298ee0aa", active = true }
    "glycoxil_my_1"         = { id = "e7700a26-8b35-456e-a5c0-a10230bbe8e2", active = true }
    "glycoxil_my_2"         = { id = "b4e132ee-2ee8-46f3-b3da-c7513ff19951", active = true }
    "melasma_sg"            = { id = "7c0a84af-ab9d-462f-99e1-6a95043f95c9", active = true }
    "metaponin_my"          = { id = "4db7de49-f67f-485a-a911-abff8a379d9f", active = true }
    "synovil_my_1"          = { id = "1280ad4d-cc57-47bd-933f-4583ac30d21a", active = true }
    "synovil_my_2"          = { id = "cabd4958-56c8-4a1b-8e8c-c21d6a0e0480", active = true }
    "synovil_sg_1"          = { id = "95a8de3d-494a-4b40-aac4-8f68dd4a1623", active = false }
    "synovil_sg_2"          = { id = "2e9202f4-1316-408c-9194-8bb556c0970c", active = false }
    "synovil_sg_3"          = { id = "715a3cd9-95ae-454d-b0e2-7924db1e838f", active = false }
    "synovil_sg_amir"       = { id = "5d784f12-651e-4f72-a55e-66cf054be62f", active = true }
  }
}

moved {
  from = airbyte_connection.meta_to_bq
  to   = airbyte_connection.meta["5_azman_lk"]
}

# ads_insights = daily ad-grain facts (spend, impressions, clicks,
# actions). Meta restates up to ~28 days back; the connector re-reads a
# lookback window, so incremental_append yields duplicate day-rows whose
# latest version wins in dbt staging. ads/ad_creatives feed the brand
# waterfall (URL + page identity).
#
# NOTE: 5_azman_lk's prefix changed from "meta_" to "meta_5_azman_lk_";
# its connection needs a data clear + resync after apply, and the old
# raw.meta_* tables become orphans (dbt's discovery regex excludes
# them; drop once the resync is verified).
resource "airbyte_connection" "meta" {
  for_each = local.meta_sources

  name           = "meta-ads ${each.key} -> bigquery.raw"
  source_id      = each.value.id
  destination_id = airbyte_destination_bigquery.warehouse.destination_id
  prefix         = "meta_${each.key}_"
  status         = each.value.active ? "active" : "inactive"

  # Staggered across six 30-min waves (19:00–21:30 UTC = 03:00–05:30 MYT):
  # 30 connections firing simultaneously thundering-herd Meta's per-user
  # rate limit and jobs die after hours of throttled crawling. dbt runs
  # 20:30 UTC and mart-sync 22:00 UTC — late-wave deltas land next morning,
  # which daily-grain analytics tolerates.
  schedule = {
    schedule_type = "cron"
    cron_expression = format(
      "0 %d %d * * ? UTC",
      (index(sort(keys(local.meta_sources)), each.key) % 2) * 30,
      19 + floor(index(sort(keys(local.meta_sources)), each.key) % 6 / 2),
    )
  }

  configurations = {
    streams = [
      { name = "ads_insights", sync_mode = "incremental_append" },
      { name = "campaigns", sync_mode = "full_refresh_overwrite" },
      { name = "ad_account", sync_mode = "full_refresh_overwrite" },
      { name = "ads", sync_mode = "full_refresh_overwrite" },
      { name = "ad_creatives", sync_mode = "full_refresh_overwrite" },
    ]
  }
}
