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

variable "github_repo" {
  description = "GitHub repo allowed to authenticate via Workload Identity Federation"
  type        = string
  default     = "nadeemramli/effen-os"
}
