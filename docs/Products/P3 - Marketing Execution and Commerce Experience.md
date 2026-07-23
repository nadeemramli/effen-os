---
title: P3 - Marketing Execution and Commerce Experience
description: Product requirements for Fullkit media execution, cross-account control, owned-site experience, launch governance and conversion measurement.
created: 2026-07-16
updated: 2026-07-16
status: proposed
tags: [fullkit, p3, marketing, media, website, commerce]
---

# P3 - Marketing Execution and Commerce Experience

> [!summary] Product decision
> P3 owns two connected modules: **Media Operations** and **Owned Commerce Experience**. It turns approved plans and P2 launch packages into governed media and website execution. Initially it stitches Novomira and WooCommerce instead of building a page builder. Canonical orders remain in S1; canonical spend and performance facts remain in governed BigQuery models.

Portfolio context: [[Fullkit Product Portfolio PRD]]. Infrastructure context: [[PRD]], [[Fullkit Technical Architecture]], [[Fullkit Schema Blueprint]], [[S1 - Customer and Order Hub]], [[S2 - Creative Loop]], [[S4 - Money]] and [[Growth Engine]].

## 1. Thesis and users

Marketing execution should be one controlled path from approved commercial intent to platform state, conversion destination and measured outcome. Consolidating multiple accounts is not enough; P3 must preserve plan, asset, offer, landing-page and platform lineage so the Growth Engine can explain what happened.

Primary users:

- Growth Operator or head of marketing approving allocation and interventions
- Media buyers building and operating Meta, Google and TikTok campaigns
- Brand and product marketers coordinating launches
- Web merchandisers publishing and testing owned-site experiences
- Creative team handing over approved assets and receiving launch status
- Analysts reconciling spend, traffic, conversion and contribution
- Finance reviewers tracing platform spend into S4/P6

## 2. Standalone versus stitched boundary

P3 is a focused operating product using shared S1, S2 and S4 contracts.

| Area | P3 owns | Stitched authority |
|---|---|---|
| Media execution | Versioned media plans, channel allocations, platform build specifications, activation requests, approval state and execution receipts | Ad platforms own delivered platform state; normalized BigQuery facts own analytical truth |
| Creative use | Selection and platform binding of an approved P2 launch package | P2/S2 owns asset, rights, approval and creative lineage |
| Website experience | Site/page specifications, versions, generation/publish jobs, experiments and campaign-page bindings | Novomira executes generation initially; WooCommerce remains storefront/checkout runtime |
| Conversion | Tracking contract and source lineage | S1 owns accepted customers and orders |
| Money | Budget intent, spend evidence references and pacing controls | S4 owns reconciled spend/invoice/card/cost truth; P6 owns its review and close workflow |
| Diagnosis | Execution alerts and proposed actions | Growth Engine owns governed variance, diagnosis, recommendation and approval methodology |

P3 does not create a second copy of an ad platform, website checkout or data warehouse. Provider payloads remain behind adapters, and the P3 UI composes desired state, observed state and governed outcomes.

## 3. Scope

### Media Operations

- Conformed workspace-to-platform account structure across brands, markets and legal entities
- Versioned media plans and allocations linked to Growth Engine targets/scenarios
- Campaign, ad-group/ad-set and ad build specifications
- P2 launch-package selection and platform creative binding
- Approval, activation, pause, budget-change and retirement workflows
- Platform command receipts, reconciliation and drift detection
- Daily account/campaign/creative reporting from governed Meta, Google and TikTok facts
- Product/account/channel consolidation and pacing views
- Performance alerts and explicit handoff to P2 for iteration

### Owned Commerce Experience

- Registry of sites, domains, stores and destination purpose
- Versioned landing-page specifications and generation runs
- Novomira and WooCommerce publish workflow
- Product, offer, campaign, creative and page bindings
- QA for content, claims, price, inventory, tracking and checkout
- Page experiments and governed conversion measurement
- Website orders entering S1 through authenticated, idempotent webhooks

## 4. Non-goals

- Rebuilding Novomira, WooCommerce or a general page builder in the first phases
- Owning marketplace storefront UX; Shopee, Lazada and TikTok Shop stay external conversion locations
- Owning WhatsApp/DM sales conversations; that belongs to [[AI Sales Closer]] and P1
- Declaring an ad a winner from platform ROAS or spend alone
- Using P3 operational tables as the canonical performance mart
- Letting AI or n8n directly mutate live campaigns without policy, approval, idempotency and receipts
- Replacing S1 order state, S4 money truth or the Growth Engine decision record

## 5. Complete workflows

### 5.1 Account consolidation and mapping

1. An integration connects an ad account with workspace, legal entity, brand, market, currency, timezone and owner.
2. External campaign/ad identifiers map to canonical P3 specifications and P2 launch packages.
3. Scheduled extracts and webhooks land provider-shaped data in BigQuery raw/staging.
4. Conformed channel, account, campaign, creative, product and destination dimensions power daily reporting.
5. Unmapped, duplicate, stale or currency-inconsistent entities enter an exception queue; they do not silently join.

### 5.2 Plan-to-launch media execution

1. Growth Engine sends an approved allocation/action referencing the business target, scenario, model run, budget limits and measurement plan.
2. The media buyer creates a versioned platform-neutral campaign specification.
3. P3 validates brand/account access, objective, dates, budget, audience policy, P2 asset approval/rights, destination readiness, inventory and tracking.
4. A preview shows intended platform mutations and estimated budget exposure.
5. The authorized approver accepts, rejects or requests changes.
6. The channel adapter creates or updates platform entities idempotently and records each provider receipt.
7. P3 reconciles desired state to observed platform state and raises drift, rejection or partial-execution exceptions.
8. The launch binding is returned to P2 and the action receipt to Growth Engine.

### 5.3 Daily control and creative response

1. Governed facts update account, campaign, creative, landing-page, order and contribution views.
2. P3 shows pacing, delivery, platform rejection, tracking and destination-health exceptions.
3. Growth Engine compares actuals with the versioned plan and creates a diagnosis/recommendation.
4. P3 may draft a pause, budget or build change; a human approves according to risk limits.
5. A creative replacement or iteration need becomes a P2 task with the performance evidence and required-by date.
6. Every action has a stop/rollback condition and a measured outcome window.

### 5.4 Website generation and publishing

1. A marketing moment, offer and P2 launch package create a versioned page specification.
2. P3 sends approved inputs to Novomira or another permitted generation tool and records its run.
3. The generated result is imported as a new page version, never an untracked overwrite.
4. QA checks product/variant mapping, price and offer validity, claims, rights, mobile rendering, forms, tracking, consent and Woo checkout.
5. An approver publishes the version to the correct site/domain/store.
6. Page, campaign, creative and offer bindings are written before traffic is sent.
7. Checkout completion creates an authenticated, idempotent S1 order event/command; P3 does not infer an order from a browser event.

### 5.5 Website experiment

1. A hypothesis defines primary metric, guardrails, population, assignment method, start/stop criteria and analysis window.
2. Approved page versions become variants and assignment is deterministic.
3. Exposure and conversion events use the RudderStack contract with experiment and variant IDs.
4. S1 confirmed orders and S4 contribution outcomes join in BigQuery.
5. Growth Engine evaluates the result with stated uncertainty; P3 promotes, retains or retires a version after approval.

### 5.6 Marketplace relationship

P3 may report marketplace media and destination performance, but marketplace checkout remains external. Marketplace orders enter S1 through source adapters. P3 must not build a fake “website order” or overwrite marketplace state.

## 6. Operational schema proposal

Use `marketing` and `web` as logical ownership namespaces. Per [[Fullkit Technical Architecture]], the MVP may implement them as prefixed `app` tables and split physical schemas only when roles, load or release isolation justify it. Shared integrations, stores, catalog, identity, orders, events and audit remain canonical under [[Fullkit Schema Blueprint]].

### Media plans and platform execution

| Table | Grain | Key fields |
|---|---|---|
| `marketing.ad_accounts` | One connected external ad account | `id`, `integration_id`, `external_account_id`, `brand_id`, `legal_entity_id`, `market`, `currency_code`, `timezone`, `status`, `owner_membership_id` |
| `marketing.media_plans` | One versioned plan identity | `id`, `growth_allocation_ref`, `business_target_ref`, `scenario_ref`, `model_run_ref`, `brand_id`, `period_start`, `period_end`, `status`, `current_version_id` |
| `marketing.media_plan_versions` | One immutable plan revision | `id`, `media_plan_id`, `version`, `objective`, `budget_amount`, `currency_code`, `constraints`, `measurement_plan_ref`, `created_by`, `approved_by`, timestamps |
| `marketing.channel_allocations` | One plan version x channel/account/objective allocation | `id`, `media_plan_version_id`, `channel`, `ad_account_id`, `objective`, `product_id`, `market`, `budget_amount`, `target_metrics`, `start_at`, `end_at` |
| `marketing.campaign_specs` | One platform-neutral campaign identity | `id`, `allocation_id`, `name`, `objective`, `buying_type`, `status`, `current_version_id` |
| `marketing.campaign_spec_versions` | One immutable campaign build revision | `id`, `campaign_spec_id`, `version`, `budget_config`, `schedule`, `optimization_config`, `tracking_config`, `created_by`, `approved_by` |
| `marketing.delivery_group_specs` | One ad set/ad group specification | `id`, `campaign_spec_version_id`, `audience_ref`, `placement_config`, `bid_config`, `conversion_event`, `destination_ref`, `status` |
| `marketing.ad_specs` | One intended ad unit | `id`, `delivery_group_spec_id`, `p2_launch_package_id`, `copy_variant_ref`, `destination_ref`, `tracking_parameters`, `status` |
| `marketing.activation_requests` | One requested platform change set | `id`, `request_type`, `object_type`, `object_id`, `desired_state`, `risk_level`, `idempotency_key`, `requested_by`, `approval_id`, `status` |
| `marketing.activation_attempts` | One provider command attempt | `id`, `activation_request_id`, `integration_id`, `attempt_number`, `request_ref`, `provider_job_id`, `response_ref`, `status`, timestamps |
| `marketing.platform_entity_mappings` | One P3 object x external platform entity | `id`, `integration_id`, `canonical_object_type`, `canonical_object_id`, `external_entity_type`, `external_entity_id`, `observed_status`, `last_seen_at` |
| `marketing.execution_receipts` | One completed/failed requested action | `id`, `activation_request_id`, `external_refs`, `executed_state`, `executed_at`, `rollback_ref`, `growth_action_ref` |
| `marketing.performance_alerts` | One material execution/performance exception | `id`, `object_type`, `object_id`, `alert_type`, `evidence_ref`, `severity`, `status`, `owner_id`, timestamps |

### Owned website experience

| Table | Grain | Key fields |
|---|---|---|
| `web.sites` | One owned site/domain/store experience | `id`, `workspace_id`, `brand_id`, `store_id`, `domain`, `platform`, `market`, `locale`, `status` |
| `web.page_specs` | One logical destination/page | `id`, `site_id`, `purpose`, `product_id`, `offer_ref`, `growth_marketing_moment_ref`, `status`, `current_version_id` |
| `web.page_versions` | One immutable content/layout version | `id`, `page_spec_id`, `version`, `content_manifest`, `layout_manifest`, `p2_launch_package_refs`, `claims_refs`, `tracking_config`, `created_by`, `approval_status` |
| `web.generation_runs` | One Novomira/model/tool execution | `id`, `page_version_id`, `integration_id`, `provider`, `input_manifest`, `output_ref`, `cost_amount`, `status`, timestamps |
| `web.qa_checks` | One check x page version | `id`, `page_version_id`, `check_type`, `result`, `evidence_ref`, `reviewed_by`, `reviewed_at` |
| `web.publish_jobs` | One version publication attempt | `id`, `page_version_id`, `site_id`, `environment`, `idempotency_key`, `requested_by`, `approved_by`, `provider_ref`, `status`, timestamps |
| `web.campaign_page_bindings` | One campaign/ad x page version binding | `id`, `campaign_or_ad_ref`, `page_version_id`, `offer_ref`, `valid_from`, `valid_to`, `status` |
| `web.experiments` | One page experiment | `id`, `site_id`, `hypothesis`, `primary_metric_ref`, `guardrails`, `assignment_method`, `start_at`, `stop_rule`, `status` |
| `web.experiment_variants` | One page version in an experiment | `id`, `experiment_id`, `page_version_id`, `allocation_weight`, `is_control` |

Provider credentials stay in the secret manager. Raw API responses belong in `source_records` or object storage, not frequently queried P3 fields.

## 7. BigQuery marts

| Model | Grain | Purpose |
|---|---|---|
| `dim_ad_account` | Current conformed account | Brand, entity, market, currency, platform and ownership |
| `dim_campaign_entity` | Canonical campaign/ad group/ad mapping | Provider mapping, plan and launch lineage |
| `fct_ad_account_daily` | Date x account | Spend, delivery, platform results, freshness and reconciliation |
| `fct_channel_daily` | Date x brand x channel x objective | Spend, orders, new customers, modeled incremental revenue/contribution and targets |
| `fct_campaign_daily` | Date x campaign | Plan, delivery, spend, commercial outcomes and marginal efficiency |
| `fct_creative_daily` | Date x P2 asset x channel | Creative delivery, activation, age, decay and outcomes |
| `fct_media_plan_vs_actual` | Date x allocation | Budget/spend, target/actual and execution variance |
| `fct_landing_page_daily` | Date x page version x traffic source | Sessions, engaged visits, checkout starts, accepted orders and contribution |
| `fct_checkout_funnel` | Date x site x source x product | View-to-checkout-to-confirmed-order stages |
| `fct_web_experiment_outcome` | Experiment x variant x observation window | Exposure, order, contribution, guardrails and uncertainty |
| `fct_tracking_quality` | Date x site/account/integration | Missing IDs, event duplication, attribution coverage and lag |

The same normalized spend fact serves P3 reporting, P6 reconciliation and Growth Engine planning. Each consumer must not build its own Meta total.

## 8. APIs and events

### Commands

- `POST /marketing/media-plans/{id}/versions`
- `POST /marketing/campaign-specs`
- `POST /marketing/activation-requests/preview`
- `POST /marketing/activation-requests/{id}/approve`
- `POST /marketing/activation-requests/{id}/execute`
- `POST /marketing/activation-requests/{id}/stop-or-rollback`
- `POST /web/page-specs` and version commands
- `POST /web/generation-runs`
- `POST /web/page-versions/{id}/qa`
- `POST /web/publish-jobs`
- `POST /web/experiments`

### Read APIs

- Consolidated account/campaign/product performance
- Desired-versus-observed platform state and drift
- Plan pacing and execution exceptions
- P2 launch-package eligibility and bindings
- Page versions, QA, publication and experiment status
- Checkout and confirmed-order conversion summaries

### Domain events

`media_plan_approved`, `campaign_build_requested`, `campaign_activation_approved`, `campaign_activation_succeeded`, `campaign_activation_failed`, `platform_state_drift_detected`, `budget_change_requested`, `creative_launch_bound`, `creative_replacement_requested`, `page_version_generated`, `page_version_approved`, `page_version_published`, `website_experiment_started`, `website_experiment_stopped`, and `website_order_received`.

P3 consumes `launch_package_ready`, `creative_approval_expiring`, `inventory_availability_changed`, `growth_action_approved`, `order_confirmed`, and governed performance-ready signals.

## 9. AI boundary

AI may:

- Draft channel allocations, campaign specifications, naming and tracking parameters
- Recommend account consolidation and flag mapping anomalies
- Explain pacing/performance using governed metrics and Growth Engine methodology
- Propose budget, pause, creative replacement and destination actions
- Draft page specifications, content structures and experiment hypotheses
- Run pre-publish consistency checks across product, offer, claims, inventory and tracking

AI may not:

- Launch, pause or materially change budget without the applicable approval policy
- Publish a page or change a checkout price/offer without approval
- Receive provider credentials in its prompt/context
- Treat platform attribution as causal truth
- Create a canonical order from an unverified browser event
- Override P2 rights/approval, S3 inventory or S4 financial constraints

AI tools call platform-neutral Fullkit commands with strict inputs and idempotency. Provider adapters hold credentials and return bounded receipts. High-impact actions require preview, named approver, exposure limit and rollback/stop condition.

## 10. KPIs

### Commercial

- Contribution and new-customer contribution by brand, channel, account, campaign, product, page and cohort
- Marginal efficiency and spend capacity at approved economic boundaries
- Conversion rate by owned website, marketplace and conversation path
- Page-version and experiment contribution lift with uncertainty

### Execution

- Plan-to-launch and approved-asset-to-launch cycle time
- On-time launch rate for marketing moments
- Budget pacing variance and recovery time
- Activation success, provider rejection and drift rates
- Percentage of active ads with complete P2 asset and page bindings

### Data and control

- Spend freshness and account coverage
- Order/spend/creative mapping completeness
- Duplicate or missing conversion-event rate
- Percentage of material actions with approval, receipt, rollback/stop condition and outcome
- Website QA pass and rollback rates

## 11. Dependencies and risks

| Dependency/risk | Control |
|---|---|
| Ad-platform API and policy changes | Thin versioned adapters, provider payload archive and contract tests |
| Multiple teams calculate different spend totals | One normalized BigQuery spend fact with reconciliation and freshness gates |
| Novomira generation becomes an untraceable black box | Persist page spec, generation run, imported version and publish receipt |
| Woo/plugin updates break checkout or tracking | Pre-publish QA, synthetic checks, versioned tracking contract and rollback |
| Platform spend is mistaken for incrementality | Growth Engine measurement method, confidence and contribution guardrails |
| Asset rights/claims expire during delivery | P2 eligibility check at launch and expiry events with stop workflow |
| AI makes expensive live changes | Strict tools, preview, exposure limits, human approval and receipts |
| Marketplace performance is forced into website logic | Preserve conversion location and source-specific order provenance |
| Account mappings drift | Daily desired/observed reconciliation and exception ownership |
| Inventory or margin cannot support promotion | Hard pre-launch gates from S3 and S4/Growth Engine |

## 12. Staged MVP

### Stage 0 - Read-only consolidation

- Connect Meta first, then Google and TikTok as needed.
- Conform account/campaign/ad/creative identifiers and build daily reporting.
- Bind active ads to P2 assets where possible.
- Reconcile marketing spend once for P3, P6 and Growth Engine.

### Stage 1 - Governed launch records

- Add media plan, campaign specification, P2 launch package and platform mapping records.
- Keep execution human/manual in platform UIs but require launch receipts and bindings.
- Add consolidated account/product reporting and exception views.

### Stage 2 - Owned-site workflow

- Registry for sites/page specs/versions.
- Connect Novomira generation and Woo publish workflow.
- Add QA, campaign-page bindings and S1 idempotent order intake.
- Run one controlled landing-page experiment.

### Stage 3 - Gated platform commands

- Add preview, approval and idempotent execution for a narrow set: create draft, pause, resume or bounded budget change.
- Reconcile desired and observed platform state.
- Connect Growth Engine approved actions and outcome windows.

### Stage 4 - Bounded AI assistance

- AI drafts campaign/page builds, anomaly explanations and safe actions.
- Low-risk, reversible changes may execute within approved limits.
- Autonomy expands only after policy, execution and commercial outcome evaluations pass.

## 13. MVP acceptance criteria

- Every active governed ad resolves to account, campaign specification, P2 launch package and destination version.
- The same daily spend total reconciles across P3, P6 and Growth Engine.
- A website checkout creates one authenticated S1 order despite webhook retries.
- Novomira/Woo publication is versioned and reversible; Fullkit does not need a page builder.
- No AI or automation can bypass approval, inventory, rights, margin or idempotency controls.
- Operators can compare plan, observed platform state and governed contribution across all connected accounts and products.
