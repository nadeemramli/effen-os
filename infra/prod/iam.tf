# Service accounts, the org-policy key exception, and GitHub Actions WIF.

resource "google_service_account" "airbyte_loader" {
  account_id   = "sa-airbyte-loader"
  display_name = "Airbyte Cloud BigQuery destination"
}

resource "google_service_account" "dbt" {
  account_id   = "sa-dbt"
  display_name = "dbt runs (GitHub Actions via WIF)"
}

resource "google_service_account" "mart_sync" {
  account_id   = "sa-mart-sync"
  display_name = "Supabase edge function: marts -> ad_daily_facts"
}

# Job-level permission (running queries/load jobs) is project-scoped;
# data access stays dataset-scoped in bigquery.tf.
resource "google_project_iam_member" "job_users" {
  for_each = {
    airbyte   = google_service_account.airbyte_loader.email
    dbt       = google_service_account.dbt.email
    mart_sync = google_service_account.mart_sync.email
  }
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = "serviceAccount:${each.value}"
}

# New orgs enforce iam.disableServiceAccountKeyCreation. Airbyte Cloud's
# BigQuery destination and the Supabase edge function both authenticate
# with SA key JSON, so this project gets an exception. Keys themselves are
# minted with gcloud (see infra/README.md), NOT terraform, to keep key
# material out of state.
resource "google_org_policy_policy" "allow_sa_keys" {
  name   = "projects/${var.project_id}/policies/iam.disableServiceAccountKeyCreation"
  parent = "projects/${var.project_id}"

  spec {
    rules {
      enforce = "FALSE"
    }
  }
}

# New orgs enforce the key ban via BOTH the legacy constraint above and
# this managed constraint; each needs its own project-level exception.
resource "google_org_policy_policy" "allow_sa_keys_managed" {
  name   = "projects/${var.project_id}/policies/iam.managed.disableServiceAccountKeyCreation"
  parent = "projects/${var.project_id}"

  spec {
    rules {
      enforce = "FALSE"
    }
  }
}

# Keyless auth for GitHub Actions (terraform plan + dbt build).
resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
}

resource "google_iam_workload_identity_pool_provider" "github" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-oidc"
  display_name                       = "GitHub OIDC"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
  }

  attribute_condition = "assertion.repository == \"${var.github_repo}\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "github_impersonates_dbt" {
  service_account_id = google_service_account.dbt.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repo}"
}
