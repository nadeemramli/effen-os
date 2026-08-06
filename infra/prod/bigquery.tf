# Dataset layout per ADR-0003: raw (Airbyte + CSV loads, immutable-ish),
# staging (dbt intermediate), marts (governed contract incl. mart_ads_daily).
# Tables inside staging/marts are owned by dbt, not Terraform.

resource "google_bigquery_dataset" "raw" {
  dataset_id  = "raw"
  location    = var.region
  description = "Landing zone: Airbyte syncs (ads APIs, Supabase read-models) and banned-account CSV loads. Replayable, never hand-edited."
}

resource "google_bigquery_dataset" "staging" {
  dataset_id  = "staging"
  location    = var.region
  description = "dbt intermediate models. Rebuildable from raw at any time."

  default_table_expiration_ms = 7776000000 # 90 days — staging is disposable
}

resource "google_bigquery_dataset" "marts" {
  dataset_id  = "marts"
  location    = var.region
  description = "Governed marts consumed by Fullkit (mart_ads_daily contract in ADR-0003) and future BI."
}

# Dataset-scoped access for the pipeline service accounts (least privilege).
resource "google_bigquery_dataset_iam_member" "airbyte_writes_raw" {
  dataset_id = google_bigquery_dataset.raw.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = "serviceAccount:${google_service_account.airbyte_loader.email}"
}

resource "google_bigquery_dataset_iam_member" "dbt_reads_raw" {
  dataset_id = google_bigquery_dataset.raw.dataset_id
  role       = "roles/bigquery.dataViewer"
  member     = "serviceAccount:${google_service_account.dbt.email}"
}

resource "google_bigquery_dataset_iam_member" "dbt_writes_staging" {
  dataset_id = google_bigquery_dataset.staging.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = "serviceAccount:${google_service_account.dbt.email}"
}

resource "google_bigquery_dataset_iam_member" "dbt_writes_marts" {
  dataset_id = google_bigquery_dataset.marts.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = "serviceAccount:${google_service_account.dbt.email}"
}

resource "google_bigquery_dataset_iam_member" "mart_sync_reads_marts" {
  dataset_id = google_bigquery_dataset.marts.dataset_id
  role       = "roles/bigquery.dataViewer"
  member     = "serviceAccount:${google_service_account.mart_sync.email}"
}

# Airbyte's BigQuery destination keeps its internal raw/bookkeeping tables
# in a dataset named airbyte_internal. sa-airbyte-loader has no
# project-level datasets.create (least privilege), so it must pre-exist.
resource "google_bigquery_dataset" "airbyte_internal" {
  dataset_id  = "airbyte_internal"
  location    = var.region
  description = "Airbyte destination-internal raw tables. Managed by Airbyte; do not query directly."
}

resource "google_bigquery_dataset_iam_member" "airbyte_writes_internal" {
  dataset_id = google_bigquery_dataset.airbyte_internal.dataset_id
  role       = "roles/bigquery.dataEditor"
  member     = "serviceAccount:${google_service_account.airbyte_loader.email}"
}
