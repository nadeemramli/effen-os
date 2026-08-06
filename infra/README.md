# infra — Growth data platform (Terraform)

Provisions ADR-0003's warehouse layer: BigQuery datasets, GCS landing
bucket, service accounts, GitHub-Actions WIF, budget guardrail, and
(phase 3) Airbyte sources/connections. Companion analysis + owner
checklist: `docs/ops/growth-data-platform-plan.md`.

## Layout

- `bootstrap/` — one-time, local state: creates the project, enables
  APIs, creates the Terraform state bucket.
- `prod/` — everything else; state in GCS (`effen-growth-prod-tfstate`).

## First-time runbook

```sh
# 1. Auth as the EFFEN org account (NOT any older gcloud login)
gcloud auth login
gcloud auth application-default login

# 2. Find ids
gcloud organizations list          # -> org_id
gcloud billing accounts list       # -> billing_account

# 3. Bootstrap (creates project + state bucket, local state)
cd infra/bootstrap
terraform init
terraform apply \
  -var org_id=ORG_ID \
  -var billing_account=XXXXXX-XXXXXX-XXXXXX

# 4. Main stack
cd ../prod
cp terraform.tfvars.example terraform.tfvars   # fill in billing_account
terraform init
terraform apply
```

If `project_id` isn't `effen-growth-prod` (global collision), pass
`-var project_id=...` in step 3, edit the backend bucket in
`prod/main.tf`, and set it in `prod/terraform.tfvars`.

## Service-account keys (minted outside Terraform)

The org-policy exception in `iam.tf` allows key creation on this project
only. Mint keys with gcloud so material never enters Terraform state:

```sh
gcloud iam service-accounts keys create airbyte-loader-key.json \
  --iam-account sa-airbyte-loader@effen-growth-prod.iam.gserviceaccount.com
gcloud iam service-accounts keys create mart-sync-key.json \
  --iam-account sa-mart-sync@effen-growth-prod.iam.gserviceaccount.com
```

- `~/airbyte-loader-key.json` → read by Terraform (`file()` in
  airbyte.tf) on every plan — KEEP it at that path, chmod 600. It
  lives outside the repo.
- `mart-sync-key.json` → Supabase edge function secret
  (`supabase secrets set BQ_SA_KEY=...`); delete the local copy after
  installing.

`sa-dbt` needs no key — GitHub Actions impersonates it via WIF
(`github` pool, repo-restricted to `nadeemramli/effen-os`).

## Still manual / later phases

- BigQuery daily query quota cap: set in console (IAM & Admin → Quotas →
  BigQuery "Query usage per day") — consumer quota overrides via
  Terraform are flaky; revisit.
- Phase 3: uncomment `airbyte.tf` + the provider in `main.tf` once the
  Airbyte application credential exists; Meta/TikTok sources are created
  in the Airbyte UI (OAuth) then `terraform import`ed.
- Phase 4+: dbt project in `warehouse/`, CSV load convention, mart-sync
  edge function (tracked in docs/ops/growth-data-platform-plan.md §5).
