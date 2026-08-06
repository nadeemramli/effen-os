# Growth data platform — stack analysis, costs, and owner checklist

**Date: 2026-08-05.** Pre-build analysis for the ingestion/warehouse layer
decided in [ADR-0003](../decisions/0003-ads-ingestion-airbyte-gcp.md)
(Airbyte → BigQuery, GCS landing, dbt transforms, mart sync back into
Supabase). This doc settles the open cost/hosting questions and lists what
Nadeem must do personally before Terraform can run. Prices verified
2026-08-05 against vendor pages; re-verify if building later than Q4 2026.

## 1. The full stack (and what each piece is for)

| Component | Role | Hosting | License cost |
|---|---|---|---|
| **Airbyte Cloud (Standard)** | Ingestion: Meta + TikTok (later Google) ads APIs; Postgres source reading Supabase read-models into BigQuery | SaaS | $10/mo minimum, volume-based |
| **BigQuery** | Analytical warehouse: raw → staging → `mart_ads_daily` etc. | GCP `asia-southeast1` | Pay-per-use, free tier covers us (below) |
| **GCS** | Landing/archive: banned-account CSV exports, creative assets, immutable raws | GCP `asia-southeast1` | ~$0.02/GB/mo |
| **dbt Core** | Transformations (brand/market mapping, ban-merge, mart contract) | Runs in GitHub Actions on cron | Free (OSS) |
| **Supabase edge function** | Reverse-ETL: `mart_ads_daily` → `ad_daily_facts` daily upsert | Existing Supabase project | Within current plan |
| **Terraform (OSS CLI)** | Declares all of the above: GCP project resources, IAM, **and** Airbyte sources/connections via the `airbytehq/airbyte` provider | Runs locally / GitHub Actions; state in a GCS bucket | Free |
| **GCP Secret Manager** | Platform tokens, Postgres read-role password | GCP | Pennies (6 active secret versions free) |
| **GitHub Actions** | CI: `terraform plan` on PR, scheduled `dbt build` | Existing repo | Free tier (2,000 min/mo private) is ample |

**Explicitly not needed:**

- **No VPS / compute VM.** With Airbyte Cloud there is nothing to host.
  dbt runs are minutes-long batch jobs (GitHub Actions), the sync is an
  edge function, Terraform is a CLI. A VM only enters the picture if we
  self-host Airbyte (rejected below on cost).
- **No dbt Cloud** ($100+/seat) — Actions cron + artifacts is enough at
  one developer.
- **No Cloud SQL yet.** The Growth Engine concept note lists Cloud SQL
  Postgres for decision state (plans/approvals/actions), but Supabase *is*
  Postgres and already holds operational state with RLS. Revisit only if
  the Growth Engine's write-side outgrows Supabase; don't provision it for
  the ingestion build.
- **No Fivetran/Stitch alternative analysis** — Airbyte is decided
  (ADR-0003); at our volumes its Cloud minimum undercuts both anyway.

## 2. The decision: Airbyte Cloud vs self-hosted

**Recommendation: Airbyte Cloud (Standard plan). This closes ADR-0003
open item #2 — record it as an amendment when accepted.**

### Volume estimate (why Cloud is nearly free for us)

Airbyte Cloud bills API sources at ~$15 per **million** rows synced
(6 credits/M rows, $2.50/credit) and database sources at ~$10/GB.

- Ads facts: date × platform × account × campaign grain. Even at 30
  accounts × ~30 campaigns × 2 platforms with daily incremental syncs,
  that's roughly 1–2k rows/day → **~30–60k rows/month → under $1/mo**.
- Supabase → BigQuery (Postgres source): `orders_read` is ~121k rows
  total; daily incremental deltas are a few MB → **~$1–3/mo**.
- Realistic bill: **the $10/mo plan minimum, occasionally $15–20** (an
  initial full-refresh backfill of a year of history is still only a few
  hundred thousand rows — single dollars, one time).

### Self-hosted comparison

| | Airbyte Cloud Standard | Self-hosted (`abctl` on GCE) |
|---|---|---|
| Money | **~$10–20/mo** | e2-standard-2 (2 vCPU/8GB, low-resource mode) ≈ **$55–60/mo** in asia-southeast1; recommended 4 vCPU/8GB+ ≈ $110/mo; + disk, egress |
| Ops | Zero: upgrades, connector fixes, OAuth refresh handled | You own upgrades, connector breakage (Meta/TikTok APIs churn), disk pressure, restarts |
| Credentials | OAuth flows in-app (easiest path for Meta) | Manual token management |
| Data locality | Airbyte Cloud data plane is US-hosted (data transits, lands in our asia-southeast1 BigQuery) | Full control |
| Break-even | — | Only wins above ~4–5M rows/mo sustained — **~100× our volume** |

Self-hosting costs 3–6× more in cash before counting maintenance time,
to solve a scale problem we don't have. The escape hatch is cheap: all
sources/connections are defined in Terraform, so migrating to self-hosted
later is re-pointing the provider at our own instance, not a rewrite.

### One connectivity detail (Supabase as source)

Airbyte Cloud connects over IPv4; Supabase direct connections are
IPv6-first. Use the **Supavisor session pooler** hostname (IPv4, free)
with **cursor-based incremental** sync (`updated_at` cursors on the
read-models) — works fine. Only CDC/logical replication would need the
direct connection (IPv4 add-on, $4/mo); we don't need CDC for
daily-grain analytics.

## 3. Whole-stack monthly cost estimate

| Item | Est. monthly |
|---|---|
| Airbyte Cloud | $10–20 |
| BigQuery storage (<10 GiB, free tier) | $0 |
| BigQuery queries (free 1 TiB/mo on-demand; ours are MBs) | $0 |
| GCS (CSVs + creative assets, say 20–50 GB) | $0.50–1 |
| Secret Manager, Scheduler, misc GCP | <$1 |
| dbt / Terraform / GitHub Actions | $0 |
| **Total** | **≈ $12–22/mo (~RM 55–100)** |

Guardrails to provision anyway (Terraform): a GCP **budget alert** at
$30/mo, and a BigQuery **custom query quota** (e.g. 100 GB/day) so a bad
`SELECT *` in a BI tool can never surprise-bill.

Growth path: costs stay flat until either (a) Google Ads + GSC sources
are added (still API-row pricing — dollars), or (b) someone points a BI
tool at BigQuery with heavy interactive querying — address then with
partitioned/clustered marts (dbt does this from day one) not pricing
changes.

## 4. What Nadeem must do (owner checklist)

Things that require your identity, cards, or platform admin access —
everything else (Terraform, dbt, schemas, CI) is repo-side work.

### Accounts & billing

- [ ] **Google Cloud org bootstrap (Workspace-specific, one-time)**:
  1. Sign into console.cloud.google.com once with the **Workspace super
     admin** — this auto-creates the GCP **Organization** for the
     domain. (Super admin isn't needed to make billing accounts — any
     domain user can by default — but only a super admin can grant the
     first Organization Administrator.)
  2. As super admin, grant your working identity **Organization
     Administrator** + **Billing Account Creator**.
  3. Create the **billing account** (card required; new customers get
     $300 credits; Malaysian billing address adds SST on invoices).
  4. Ensure 2-Step Verification is on for the admin account.
  Don't create the project by hand — Terraform will, **under the
  Organization** (not "No organization").
  ⚠ New orgs enforce `iam.disableServiceAccountKeyCreation` by
  default. GitHub Actions avoids keys via Workload Identity
  Federation, but the Supabase edge function (mart sync) needs an SA
  key JSON — Terraform will set a project-level policy override for
  that one SA, which requires the org-level rights from step 2.
- [ ] **Airbyte Cloud**: sign up at cloud.airbyte.com (use the same
  Google identity), create workspace `effen-growth`, add the card
  (Standard plan). Then create an **application/API credential**
  (Settings → Applications) — Terraform's Airbyte provider needs the
  client id/secret.
- [ ] Decide/confirm: **region `asia-southeast1`** (matches Supabase) —
  ADR-0003 open item #1.

### Platform access (the genuinely manual part)

- [ ] **Meta**: confirm you have Business Manager **admin** on the
  surviving (non-banned) ad accounts. In Airbyte Cloud the Facebook
  Marketing source authenticates via OAuth in-app — you'll click
  through the Facebook consent as that admin. List the account IDs to
  sync.
- [ ] **TikTok Ads**: confirm admin access to the TikTok for Business
  center; Airbyte's TikTok Marketing source also OAuths in-app.
- [ ] **Banned accounts**: export what history is still downloadable
  (Ads Manager → export CSV per account, widest date range available).
  Park them anywhere for now; they'll be uploaded to the GCS landing
  bucket once it exists. Note per file: platform, account id, date
  range, export date — this feeds ADR-0003 open item #5 (naming
  convention).
- [ ] **Supabase read role**: approve creating a dedicated
  `airbyte_reader` Postgres role (read-only on `orders_read`,
  `ad_accounts_read`, `ad_daily_facts`, `nv_shipments`, customers mart)
  — we'll do it as a migration; you just okay it.

### Repo/CI plumbing (one-time secrets)

- [ ] Add GitHub Actions secrets once Terraform mints the service
  accounts (we'll list exact names then): GCP workload-identity or SA
  key for `terraform`/`dbt`, Airbyte client id/secret.

### Decisions to record

- [ ] Amend ADR-0003: Cloud vs self-hosted → **Airbyte Cloud** (item
  #2), region → `asia-southeast1` (item #1), and note the Supavisor
  pooler/cursor-sync choice for the Postgres source.

## 5. Build sequence (repo-side, after checklist)

1. Bootstrap: Terraform state bucket + GCP project (`infra/`).
2. Core infra: BigQuery datasets (`raw`, `staging`, `marts`), GCS
   landing/archive buckets with immutability lifecycle, service
   accounts + IAM, budget alert, query quota.
3. Airbyte-as-code: sources (Facebook Marketing, TikTok Marketing,
   Postgres/Supabase), BigQuery destination, connections + schedules.
   OAuth consent clicks happen once in the Airbyte UI; everything else
   is in `.tf`.
4. dbt project (`warehouse/`): staging models per source, the
   brand/market mapping (published from Fullkit per ADR-0003 open item
   #3), ban-merge logic, `mart_ads_daily` matching the ADR contract,
   partitioned by date.
5. Banned-account CSV loads: GCS upload convention + external/load
   tables into the same staging layer, `source='csv_export'`.
6. Mart sync: edge function with the read-only BigQuery SA upserting
   into `ad_daily_facts` (+ additive columns: campaign grain,
   `purchase_value`, `source`, `is_banned_account`, `platform`).
7. Wire freshness into Data Health via `integration_connections`.

## Sources (pricing, verified 2026-08-05)

- Airbyte plans/minimum: airbyte.com/pricing ($10/mo Standard,
  volume-based); credit rates: hevodata.com/learn/airbyte-pricing,
  docs.airbyte.com manage-credits ($2.50/credit; API 6 credits/M rows;
  DB 4 credits/GB)
- BigQuery: cloud.google.com/bigquery/pricing ($6.25/TiB on-demand,
  free 1 TiB query + 10 GiB storage/mo; active storage ~$0.023/GiB/mo)
- Airbyte self-hosted sizing: docs.airbyte.com abctl (4 vCPU/8 GB
  recommended; 2 vCPU/8 GB low-resource mode)
- GCE: e2-standard-2 ≈ $49/mo us-central1, asia-southeast1 ~10–15%
  premium (cloudprice.net)
