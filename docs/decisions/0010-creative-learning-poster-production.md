# ADR-0010 — Creative learning and poster production: contracts and architecture

**Date:** 2026-10-01 · **Status: Accepted in part.** The Supabase schema (R2) is applied to the effen-os project, and OpenAI is the chosen provider (owner decision, 2026-10-01). The warehouse marts, the media bucket, the sync and the worker are not yet released. Code is on branch `claude/intelligent-hopper-yaocg6`.

## Context

Fullkit needs a creative learning loop. Each step of the loop is listed below.

1. Filter EFFEN's owned static-image ads and rank comparable performance.
2. Inspect the actual poster pixels.
3. Turn the winners into reviewed reconstruction SOPs and structured recipes.
4. Generate 100 diverse candidates per eligible brand. Candidates use authentic product images and versioned brand kits.
5. Bind launched variants back to their ad results.
6. Revise a reviewed playbook from those results.

The handover prompt is the scope. Its `01-system-spec.md` and `03-poster-sop-template.md` live at `/Users/ramli/Desktop/creative/fullkit-handover/`. The per-brand creative library lives at `/Users/ramli/Desktop/creative/<brand>/`. **None of these were available in the cloud build environment.** This ADR was therefore written from the following sources, and must be reconciled with the full spec before acceptance (open item O1):

- the handover prompt;
- [[P2 - Creative Intelligence and Supply]];
- [[S2 - Creative Loop]];
- [[0003-ads-ingestion-airbyte-gcp|ADR-0003]];
- the code.

### What exists (audited at `31dc629`)

- **Ads path (ADR-0003).** Airbyte lands Meta data as `raw.meta_<account>_<stream>`, with one connection per account (`infra/prod/airbyte.tf`). The streams are `ads_insights` (incremental), plus `ads`, `ad_creatives`, `campaigns` and `ad_account` (full refresh). The `images` and `videos` streams are **not** synced.
- **Insights staging.** `stg_meta_ads_insights` is ad × day, latest extraction wins. It reads only `actions[].value` for `omni_purchase`, which is the account's default attribution. It does not select `attribution_setting`.
- **Creative staging.** `stg_meta_ad_creatives` projects only these columns: destination URL/domain, `page_id`, `instagram_actor_id` and `url_tags`. **No media field is projected:** no `image_hash`, `image_url`, `thumbnail_url`, `video_id`, `object_type`, `asset_feed_spec` images, or carousel children. The repository has no reference to any of them anywhere.
- **Ad → creative bridge.** `stg_meta_ads` provides the ad-to-creative link (`creative.id`). It has no uniqueness test. `int_ad_brand` can repeat an `ad_id`.
- **Campaign mart.** `mart_ads_daily` is campaign grain. `mart-sync` copies it into `public.ad_daily_facts`.
- **Account context.** The `ad_account` stream, which carries the account timezone and currency, is landed but unused.
- **Supabase.** RLS uses `private.is_workspace_member` / `private.has_role`. `membership_brand_scopes` exists but nothing enforces it. Supabase has no creative tables, no storage buckets and no job queue. `/creative` is a seeded prototype.

## Decision

### 1. Authority split — unchanged from ADR-0003

- **BigQuery** is the analytical authority for delivery facts.
- **Supabase** holds the operational state and the read-serving copies.
- **GCS** holds immutable media, addressed by SHA-256.

The browser never reads Meta, BigQuery, GCS credentials or `creative.*` tables directly. Generation runs in a durable worker and is never a web request.

### 2. Reconcile P2's "Cloud SQL" target with Supabase

P2 and S2 describe a `creative.*` namespace in Cloud SQL. In practice the operational database is Supabase Postgres, and every operational domain already lives there. **We implement P2/S2's logical `creative` namespace as a physical `creative` schema in Supabase.** The rules for that schema are:

- No table grants to `anon` or `authenticated`.
- RLS is enabled with no policies, so access is deny-by-default.
- Every read and write goes through a `public.creative_*` `SECURITY DEFINER` RPC. Each RPC checks the caller's role and **brand scope**.

Moving to a separate database later is a deployment change, not a contract change.

### 3. Brand scope becomes enforced (creative only)

`private.creative_member_for_brand(brand, roles)` defines who can see a brand:

- `hq_admin` sees every brand.
- A member with **no** `membership_brand_scopes` rows keeps today's workspace-wide view.
- A member **with** scope rows sees only those brands.

Role access is as follows:

| Action | Roles |
|---|---|
| Read | `hq_admin`, `marketing_growth`, `analyst` |
| Write | `hq_admin`, `marketing_growth` |
| Kit approval, owner configuration, budget resume | `hq_admin` |
| Reviews | A **named reviewer** in `brand_runtime_config.reviewer_membership_ids`. Role alone is not enough. |
| Worker and sync RPCs | `service_role` only |

### 4. Identity model (distinct, never conflated)

| Concept | Identity | Where |
|---|---|---|
| Ad execution | `(platform, ad_id)` | `mart_creative_ad_daily`, `creative.ad_daily_facts` |
| Creative configuration | `creative_id` (+ derived `creative_format`) | `stg_meta_creative_media` |
| Platform image | `(account_id, image_hash)`. Meta's hash is per account. | `mart_creative_image_daily`, `creative.platform_image_refs` |
| Exact image version | `sha256` of the bytes | `creative.raw_assets` (a single-bytes row shared by many refs) |
| Concept / family | `candidate_families` (hypothesis, changed/fixed factors, held context) | |
| Recipe | `recipe_versions` (structured `spec` + Markdown `sop_md`, `spec_sha256`) | |
| Variant | `candidates` (`input_sha256` unique per batch, `output_sha256`) | |
| Experiment / launch | `launch_bindings` (`(platform, ad_id)` unique → candidate) | |

Two images with the same bytes are de-duplicated by SHA-256. This does not lose lineage, because every `platform_image_refs` row and every ad keeps its own identity.

### 5. Creative read contract (warehouse) — separate from `mart_ads_daily`

New dbt models are listed below. They are tagged `creative` and gated by `var('creative_media_enabled')`, which is **off by default**, so the nightly build is unaffected until release step R1.

- **`union_meta_stream_columns` macro.** This is a drift-tolerant union. Optional columns that are absent from an account's table become typed NULLs, so a missing column does not fail the model. It also records `_source_table`.
- **`stg_meta_creative_media`.** One row per `creative_id`. Format precedence is `dynamic` (asset_feed_spec) > `carousel` > `video` > `single_image` > `existing_post` > `unknown`.
  - `image_hash` and `image_url` are populated **only** for `single_image`.
  - A video's `thumbnail_url` is carried as `preview_thumbnail_url` and is never a poster.
- **`int_creative_ad_binding`.** One row per `ad_id`. An ad seen with more than one creative becomes `conflicting_creative` and is bound to nothing, rather than guessed.
- **Context models.** `stg_meta_delivery_context` provides `attribution_setting` per ad × day. `stg_meta_account_context` provides the account timezone and currency. `stg_meta_campaign_context` provides the objective. Each is unique on its key.
- **`mart_creative_ad_daily`.** One row per date × ad. It is built from the same deduplicated insight rows as `mart_ads_daily`, so it **sums to it exactly per day × account**. It carries:
  - binding status, format and exact image;
  - cohort context: market, currency, objective, attribution and timezone;
  - `data_maturity` (`maturing` within 7 days).
- **`mart_creative_image_daily`.** One row per date × account × image_hash × cohort, built from **bound single-image ads only**. Summing ads that each map to one image is conservation, not allocation. Carousel, dynamic and video totals are never credited to a child image.
- **Tests:**
  - grain uniqueness;
  - uniqueness of every join key (fan-out guard);
  - spend, purchase and value conservation against `mart_ads_daily`;
  - the image mart equals the bound single-image slice of the ad mart;
  - no poster identity on non-single-image creatives.

Serving uses `creative.image_daily_facts` and `creative.ad_daily_facts`, which the proposed `creative-mart-sync` edge function upserts over a 40-day restatement window. Late conversions revise rows in place.

### 6. Ranking — `image-rank-v1` (observational screening)

Ranking happens only **within a comparability cohort**: market × currency × objective × attribution setting × timezone.

- **Ineligible rows** are listed with reasons and never dropped. The reasons are: unknown cohort field, below minimum spend, below minimum purchases, more than 25% of spend still maturing, or zero spend.
- **Shrinkage.** ROAS and purchase rate are shrunk toward the pooled cohort value with 500 pseudo-spend.
- **Tiers:** `leader` (≥ 1.2× cohort), `contender` and `below_cohort`.

All thresholds are **provisional configuration** and are labelled that way in the UI and the SOP. They are not significance tests. A performance snapshot stores the server-computed aggregates together with `method_version` and `params`. Ranking is a deterministic function of those inputs.

### 7. Production design

- **Analysis.** `poster-analysis-v1` is an observation of the actual pixels: layout, product placement, text, palette, hierarchy, and the claims seen. It is saved as a draft and must be reviewed before a recipe can cite it.
- **Recipe and SOP.** A recipe is a structured spec: base factors, option pools, fixed factors, formats and text limits. Copy references approved claim ids. The SOP is Markdown rendered from the recipe, the analysis and the evidence.
- **Context manifest.** This is immutable and identified by its SHA-256. It references:
  - an **approved** kit version (drafts are refused);
  - the exact raw-asset SHA-256s;
  - approved claims;
  - an approved recipe version and its spec hash;
  - the performance snapshot and its rows hash;
  - the playbook version.
- **Composition (`compose-svg-v1`).** Composition is deterministic.
  - The authentic packshot is placed by reference, aspect-preserved and tagged with its SHA-256. It is never redrawn.
  - All text is live SVG text.
  - AI may only supply a `generated:` *supporting background*. It never supplies the packshot or the label.
- **QA (`poster-qa-v1`).** The checks are:
  - dimensions;
  - packshot is authentic and in frame;
  - text fit;
  - safe zone;
  - headline contrast ≥ 4.5;
  - every text traces to an approved claim id;
  - the candidate is not a fixture.

  QA never approves anything.
- **Providers.** OpenAI is the creative-lab provider (owner decision, 2026-10-01). The other adapter is the zero-cost deterministic **fixture**. See `apps/web/src/lib/creative-lab/openai.ts`.
  - **Backgrounds** use `POST /v1/images/generations`. The request carries a text prompt only: no packshot or brand asset is sent, and the product is never generated.
  - **Poster analysis** uses `POST /v1/responses` with an `input_image` and a strict JSON schema. It *does* send the poster bytes, so it requires `provider_data_approved`. The model cannot set the image identity or `observed_by`; our side sets them.
  - **The key** lives in Supabase Vault (`CREATIVE_OPENAI_API_KEY`).
    - An HQ admin stores it from `/creative/lab/readiness` through `creative_set_provider_key`. It is write-only from the browser.
    - Rotation updates the secret in place.
    - Only the service role reads it, through `creative_get_provider_key`.
    - It is never in an env var on the worker path, never logged, and redacted from error text.
  - **Models and prices** are owner configuration (`brand_runtime_config.image_model`, `analysis_model`, `provider_pricing`) and are never defaulted.
    - The batch reserves `image_estimate_per_call` before each call.
    - Actual cost is computed from the response's token usage × the owner-entered rates. Without rates, the estimate is booked and labelled `configured_estimate`.
  - **Retries.** 408, 409, 429, 5xx and network errors are retryable. Retries stay bounded by `max_attempts`, and a failed call books no cost.
  - **Gates.** `ProviderUnavailableError` still names the exact blocked step when any of these is missing: provider or model, data approval, key, or pricing. Readiness lists `provider_credentials` and `provider_pricing` as generation blockers.

### 8. 100-candidate batches — `batch-plan-v1`

- **Structure.** A configurable mix, by default 60 exploit / 30 adjacent / 10 explore, gives 20 families of five via largest-remainder allocation.
  - **Exploit** families vary one *copy* factor.
  - **Adjacent** families vary one *structural* factor.
  - **Explore** families vary two or more factors under a stated hypothesis.
- **Repeat families.** A family that reuses a factor holds a different context value fixed for the whole family. A factor whose pool cannot fill a family on its own is crossed with a second factor, and both are declared.
- **Shortfalls.** When pools run out, the planner **reports a shortfall** instead of inventing copy.
- **Distinctness.** Resizes are `formats` of the same candidate, not separate slots. Identical rendered content is never two candidates. This is enforced by a content hash and `unique (batch_id, input_sha256)`.
- **Pilot order.** Slot order interleaves lanes. The first 20 slots touch every family once, so the cumulative gates **5 → 20 → 100** see the widest possible spread.

**Durable jobs.** Each job is a `creative.generation_jobs` row.

- Claims use `FOR UPDATE SKIP LOCKED` with a lease. The estimated cost is reserved against `batches.budget_amount` **before** the provider call.
- If a batch cannot afford its next job, it moves to `paused_budget` and does not overspend. Only an `hq_admin` can resume it, after raising the budget.
- An expired lease (a crashed worker) counts as an attempt. Its reservation is booked as spent, on the assumption that the provider charged.
- Retries are bounded by `max_attempts`, after which the job is `dead` and the candidate is `failed`.
- A stale lease owner cannot complete a job. Repeat completions are no-ops.
- Identical output bytes produce a `duplicate` candidate.

Generation, QA, review, export and launch are **separate status columns**.

- A stage advances only when every candidate in it is terminal and each QA-passed candidate has a named reviewer's decision.
- Only approved candidates can be exported.
- Only exported candidates can be launch-bound, and binding requires a manual or P3 receipt.
- Fullkit **never** publishes ads or spends media budget.

### 9. Learning loop

`creative_batch_outcomes` reads the bound ads' facts exactly as they are, including maturity, with no allocation.

- A learning record captures that evidence server-side at the time it is recorded. Its confidence is one of `observational`, `directional` or `tested`.
- A named reviewer must review a learning record before a playbook version can cite it.
- Publishing a playbook supersedes the previous version and links back to it as its parent.

## Slice 0 — field-coverage audit and the one-ad proof

**Code-level findings** come from the audit above. Today's creative staging cannot map an ad to image bytes, because no media field is projected. The raw `ad_creatives` stream should already carry `image_hash`, `image_url`, `thumbnail_url`, `video_id`, `object_type`, `asset_feed_spec` and `object_story_spec`. If so, **no new integration is required** for identity. Bytes come from `image_url` (a signed, expiring Meta CDN URL) or, later, from the Airbyte `images` stream.

**Live audit: blocked in this environment** (no BigQuery credentials). `warehouse/analyses/creative_media_field_audit.sql` is a read-only console script that uses only TEMP tables. It reads every account table through `TO_JSON`, so absent columns cannot fail it. It answers six questions:

- **Q1:** which media columns exist, and in how many account tables, with type conflicts;
- **Q2:** creative-format mix and media-field fill rates;
- **Q3:** the last-90-day spend share by format and by binding status, which shows how much spend can be tied to one exact image;
- **Q4:** cardinality probes, which must all be 0;
- **Q5:** the attribution settings and account timezones actually present;
- **Q6:** **the proof row** — the top-spend single-image ad → creative → image_hash → fetchable URL, with `creatives_per_ad = 1`.

The archiver (release step R3) completes the proof by fetching those bytes and recording their SHA-256 in `platform_image_refs` / `raw_assets`.

## Release plan (each step needs the established project authorisation)

| Step | Change | Risk / reversibility | Evidence to collect |
|---|---|---|---|
| R1 | Run the field audit. Then `dbt build --select tag:creative --vars '{creative_media_enabled: true}'`, and flip the default once green. | New views and tables only. `mart_ads_daily` is untouched. Revert by switching the var off. | Q1–Q6 output; all `tag:creative` tests green. |
| R2 ✅ | **Applied 2026-10-01** as migrations `20261001111055` → `20261001112644` and `20261001113238` (`creative_lab_v1_*`). The annotated source is `supabase/reference/creative_lab_v1.sql`. | Additive only: schema `creative` plus 33 `public.creative_*` RPCs. Rollback is `drop schema creative cascade` and dropping `public.creative_*` and `private.creative_*`. | Contract suite passes on both the reference and the replayed applied files (`scripts/creative/test-sql.sh [--applied]`). Live checks: 24 tables with RLS and no user grants; anon cannot execute anything; 8 RPCs are service-role only; a read-only smoke test as HQ admin returns all 15 brands with their missing decisions. Advisors show only the accepted classes (see register). |
| R3 | `terraform apply` of `infra/prod/creative.tf` (validated offline, not applied). It reuses the private landing bucket under `creative/` and creates `sa-creative-worker` with create and read access to that prefix only (no delete or overwrite), plus a Secret Manager slot for the Supabase service-role key. Then build the worker image and set `creative_worker_image`. Then build the archiver: `image_url` → SHA-256 → `gs://…/creative/sha256/<hash>`. | New infrastructure. The data is private brand material. | The one-ad proof stored as bytes with its SHA-256; one fixture-provider tick end to end. |
| R4 | Deploy `creative-mart-sync` and add a cron after `mart-sync`. No IAM change is needed, because `sa-mart-sync` already reads the whole `marts` dataset. Blocked on R1. | Read-only into BigQuery; writes only creative serving tables. | Row counts match the marts for the window. |
| R5 | Import brand kits with `scripts/creative/import-brand-kit.mts --root <creative> --all` (dry run, then `--apply`). Kits land as DRAFT; the owner approves each one. | Metadata and hashes only; bytes go through R3. | Checksum verification report; 33 PNGs across 5 brands, as reported. |
| R6 | The OpenAI adapter is built and tested with a mocked transport. The owner, on `/creative/lab/readiness`, stores the OpenAI key and sets the image and vision model ids, price estimates or rates, batch ceiling, reviewers, data approval, claims and offer, target economics and media budget. Then run the Cloud Run job. | Paid calls start here, bounded by the batch budget. `api.openai.com` is not reachable from the build sandbox, so the first live call happens in the owner's environment. | One `analyze-poster.mts` call on a real Adipocyde poster; then a pilot of 5 for Adipocyde MY, then 20, then 100. |

**Rough cost basis for R6 (for the owner's decision; not configured).** About 100 candidates per batch. Only `generated:` backgrounds call a paid model, and the fixture plan uses them in 2 of 100 slots. Brand-colour backgrounds cost nothing. So batch cost ≈ (slots with generated backgrounds × per-image price) + analysis calls. The ceiling is enforced by the reservation logic regardless of the estimate.

## Consequences

- The loop is verifiably **machinery-complete on fixtures**:
  - SQL contract tests on a Postgres 16 harness;
  - 39 TypeScript tests;
  - a no-paid-call pipeline that composes and QA-checks posters;
  - a navigable fixture UI.
- It is **not live**. It becomes live only after R1–R6, once real launched variants have matured performance.
- `creative.*` is the first place `membership_brand_scopes` is enforced. Other domains are unchanged.
- The prototype `/creative` board stays as it is. The poster lab lives under `/creative/lab/*`.

## Open items

- **O1.** Reconcile with `01-system-spec.md` (acceptance contract) and `03-poster-sop-template.md`. The SOP section order is provisional.
- **O2.** Airbyte Meta source settings live in the UI, not Terraform. These settings are the attribution windows, `action_breakdowns` and thumbnail fetching. Confirm whether `attribution_setting` is landed (Q5). Add `images` and `videos` streams only if Q1 shows `image_url` is missing or unusable.
- **O3.** Owner decisions are surfaced on `/creative/lab/readiness`, where an HQ admin edits them; they are versioned and audited, and never defaulted.
  - **Decided:** the provider is OpenAI.
  - **Still open:** the image and vision model ids and their prices; per-brand batch budget and currency; reviewers; approved claims and offer; target CPA/ROAS; media-test budget; and data approval for sending posters to OpenAI.
- **O5.** The Supabase MCP asks for user confirmation on statements it considers destructive. That prompt cannot reach a remote session, so such a migration times out instead of running. Key rotation was therefore written as `vault.update_secret` (in place) rather than delete-and-create. Future migrations that genuinely need a destructive statement should be applied from the dashboard or a local session.
- **O4.** Which 7 of the 15 brand folders are the "detailed website-derived drafts" is not recorded in the repo. The importer infers completeness from `guidelines.md` + `tokens.colors` and never promotes a kit.
