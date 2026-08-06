terraform {
  required_version = ">= 1.9"

  # Bucket name comes from infra/bootstrap output; edit if project_id differs.
  backend "gcs" {
    bucket = "effen-growth-prod-tfstate"
    prefix = "prod"
  }

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
    airbyte = {
      source  = "airbytehq/airbyte"
      version = "~> 0.13"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region

  # billingbudgets + orgpolicy APIs require an explicit quota project;
  # ADC's quota_project_id alone is not honored for them.
  user_project_override = true
  billing_project       = var.project_id
}
