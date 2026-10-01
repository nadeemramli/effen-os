# Creative lab worker (ADR-0010, release step R3) — NOT YET APPLIED.
#
# Media: reuses the existing private landing bucket (ADR-0003 already names
# it the home for creative assets) under the immutable, content-addressed
# prefix creative/sha256/<hash>.<ext>. No new bucket, no public access.
#
# Identity: the generation worker runs as a Cloud Run job under
# sa-creative-worker. It may read and create objects ONLY under creative/
# (IAM condition), never delete or overwrite (the worker writes with
# ifGenerationMatch=0). It has no BigQuery access and no Meta access.
#
# Secrets: the OpenAI key is NOT here — it lives in Supabase Vault and the
# worker reads it through the service-role-only RPC creative_get_provider_key.
# The only secret the worker needs from GCP is the Supabase service-role key,
# whose VALUE is added out of band (gcloud secrets versions add), never in
# terraform state.
#
# The Cloud Run job itself is declared once a worker image exists
# (var.creative_worker_image); until then count = 0.

variable "creative_worker_image" {
  description = "Container image for scripts/creative/worker.mts (empty = job not created)"
  type        = string
  default     = ""
}

resource "google_project_service" "creative" {
  for_each = toset(["run.googleapis.com", "secretmanager.googleapis.com", "cloudscheduler.googleapis.com"])
  project  = var.project_id
  service  = each.value
  # keep APIs on if this file is removed later
  disable_on_destroy = false
}

resource "google_service_account" "creative_worker" {
  account_id   = "sa-creative-worker"
  display_name = "Creative lab generation worker (Cloud Run job)"
}

locals {
  creative_prefix_condition = "resource.name.startsWith(\"projects/_/buckets/${google_storage_bucket.landing.name}/objects/creative/\")"
}

resource "google_storage_bucket_iam_member" "creative_worker_read" {
  bucket = google_storage_bucket.landing.name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${google_service_account.creative_worker.email}"
  condition {
    title      = "creative-prefix-only"
    expression = local.creative_prefix_condition
  }
}

resource "google_storage_bucket_iam_member" "creative_worker_create" {
  bucket = google_storage_bucket.landing.name
  role   = "roles/storage.objectCreator" # create only: no delete, no overwrite
  member = "serviceAccount:${google_service_account.creative_worker.email}"
  condition {
    title      = "creative-prefix-only"
    expression = local.creative_prefix_condition
  }
}

resource "google_secret_manager_secret" "creative_supabase_service_role" {
  secret_id = "creative-worker-supabase-service-role"
  replication {
    auto {}
  }
  depends_on = [google_project_service.creative]
}

resource "google_secret_manager_secret_iam_member" "creative_worker_reads_secret" {
  secret_id = google_secret_manager_secret.creative_supabase_service_role.id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.creative_worker.email}"
}

resource "google_cloud_run_v2_job" "creative_worker" {
  count    = var.creative_worker_image == "" ? 0 : 1
  name     = "creative-worker"
  location = var.region

  template {
    task_count = 1
    template {
      service_account = google_service_account.creative_worker.email
      max_retries     = 0 # retries are the queue's job (bounded max_attempts)
      timeout         = "900s"
      containers {
        image = var.creative_worker_image
        env {
          name  = "CREATIVE_MEDIA_BUCKET"
          value = google_storage_bucket.landing.name
        }
        env {
          name  = "CREATIVE_WORKER_LIMIT"
          value = "5"
        }
        env {
          name  = "SUPABASE_URL"
          value = "https://wwgtjjekhehaepbxyrij.supabase.co"
        }
        env {
          name = "SUPABASE_SERVICE_ROLE_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.creative_supabase_service_role.secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }
  depends_on = [google_project_service.creative]
}
