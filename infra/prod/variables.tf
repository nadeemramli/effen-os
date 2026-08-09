variable "project_id" {
  type    = string
  default = "effen-growth-prod"
}

variable "region" {
  type    = string
  default = "asia-southeast1"
}

variable "billing_account" {
  description = "Billing account id, for the budget alert"
  type        = string
}

variable "budget_amount" {
  description = "Monthly budget alert threshold, in the billing account's currency (MYR)"
  type        = number
  default     = 130 # ~USD 30
}

variable "meta_backfill_mode" {
  description = "True while historical backfills run: Meta connections have no cron schedule; the sequential runner drives them one at a time. Flip to false to restore staggered nightly waves."
  type        = bool
  default     = false
}

variable "github_repo" {
  description = "GitHub repo allowed to authenticate via Workload Identity Federation"
  type        = string
  default     = "nadeemramli/effen-os"
}
