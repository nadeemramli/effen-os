# Landing bucket: banned-account CSV exports and creative assets.
# ADR-0003: raw files stay immutable so every downstream table is replayable.
# Versioning gives us recover-from-mistake; lifecycle moves cold objects to
# Nearline to keep storage cost near zero.

resource "google_storage_bucket" "landing" {
  name                        = "${var.project_id}-landing"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      age = 60
    }
    action {
      type          = "SetStorageClass"
      storage_class = "NEARLINE"
    }
  }
}

resource "google_storage_bucket_iam_member" "airbyte_staging_access" {
  bucket = google_storage_bucket.landing.name
  role   = "roles/storage.objectAdmin"
  member = "serviceAccount:${google_service_account.airbyte_loader.email}"
}

resource "google_storage_bucket_iam_member" "dbt_reads_landing" {
  bucket = google_storage_bucket.landing.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.dbt.email}"
}
