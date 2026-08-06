# One-time bootstrap: creates the GCP project, enables APIs, and creates the
# Terraform state bucket. Runs with YOUR user credentials (gcloud ADC) and
# LOCAL state — everything after this lives in infra/prod with GCS state.
#
#   gcloud auth application-default login   # as the EFFEN org account
#   terraform init && terraform apply

terraform {
  required_version = ">= 1.9"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

variable "org_id" {
  description = "GCP organization id (gcloud organizations list)"
  type        = string
}

variable "billing_account" {
  description = "Billing account id, format XXXXXX-XXXXXX-XXXXXX (gcloud billing accounts list)"
  type        = string
}

variable "project_id" {
  description = "Globally-unique project id for the growth data platform"
  type        = string
  default     = "effen-growth-prod"
}

variable "region" {
  type    = string
  default = "asia-southeast1"
}

provider "google" {
  region = var.region
}

resource "google_project" "growth" {
  name            = "EFFEN Growth Data Platform"
  project_id      = var.project_id
  org_id          = var.org_id
  billing_account = var.billing_account
}

resource "google_project_service" "apis" {
  for_each = toset([
    "bigquery.googleapis.com",
    "storage.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "sts.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "serviceusage.googleapis.com",
    "orgpolicy.googleapis.com",
    "billingbudgets.googleapis.com",
    "secretmanager.googleapis.com",
  ])
  project            = google_project.growth.project_id
  service            = each.value
  disable_on_destroy = false
}

resource "google_storage_bucket" "tfstate" {
  project                     = google_project.growth.project_id
  name                        = "${var.project_id}-tfstate"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  versioning {
    enabled = true
  }
  depends_on = [google_project_service.apis]
}

output "project_id" {
  value = google_project.growth.project_id
}

output "state_bucket" {
  value = google_storage_bucket.tfstate.name
}
