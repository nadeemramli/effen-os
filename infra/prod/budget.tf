resource "google_billing_budget" "monthly" {
  billing_account = var.billing_account
  display_name    = "effen-growth monthly guardrail"

  budget_filter {
    projects = ["projects/${data.google_project.this.number}"]
  }

  amount {
    specified_amount {
      # Must match the billing account currency exactly
      currency_code = "MYR"
      units         = tostring(var.budget_amount)
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
  }
}

data "google_project" "this" {
  project_id = var.project_id
}
