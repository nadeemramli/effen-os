---
title: P2 - Creative Intelligence and Supply
description: Product requirements for Fullkit's creative calendar, demand planning, production capacity, asset lineage, approvals, launch handoff and learning loop.
created: 2026-07-16
updated: 2026-07-16
status: proposed
tags: [fullkit, p2, creative, production, s2, growth-engine]
---

# P2 - Creative Intelligence and Supply

> [!summary] Product decision
> P2 is the operating system that converts the commercial plan into a reliable supply of approved, deployable and measurable creative. It owns the creative calendar, demand orders, briefs, production capacity, jobs, assets, approvals and lineage. [[Iteratus - Trends and Ideas]] only hands P2 evidence-backed idea cards; it does not own P2's calendar or production queue.

Portfolio context: [[Fullkit Product Portfolio PRD]]. Infrastructure context: [[PRD]], [[Fullkit Technical Architecture]], [[Fullkit Schema Blueprint]], [[S2 - Creative Loop]] and [[Growth Engine]].

## 1. Thesis and users

Creative is a supply-planning problem, not an asset-count contest. Growth targets, marketing moments, product priorities, formats, audience coverage, evergreen supply, expected activation, decay and producer capacity determine what P2 must deliver.

Primary users:

- Head of marketing or Growth Operator planning commercial moments
- Creative strategist turning demand and evidence into briefs
- Creative lead allocating internal and external capacity
- Designers, editors, creators and UGC producers executing jobs
- Reviewers responsible for brand, claims, rights and final approval
- Media buyers receiving immutable launch-ready asset versions
- Analysts evaluating concept, production and commercial outcomes

The initial operating capacity targets are **50 posters per week** and **10-20 raw videos per week**. These are throughput constraints, not success metrics. P2 must also measure originality, activation, learning, useful life, production cost and incremental contribution.

## 2. Standalone versus stitched boundary

P2 is a standalone bounded product strongly stitched to S2 and P3, and lightly stitched to Iteratus.

| Relationship | P2 responsibility | Other owner |
|---|---|---|
| Iteratus handoff | Accept, reject, defer, combine or request evidence for an idea card | Iteratus owns source snapshots, trend observations and idea-card ranking |
| Growth planning | Turn an approved creative demand order into calendar commitments and capacity | Growth Engine owns business targets, marketing moments, scenarios and demand calculation |
| Creative truth | Own concepts accepted for production, briefs, jobs, assets, rights, approvals and lineage | S2 exposes the governed shared contract |
| Production tools | Record prompts, inputs, outputs, cost and provenance | Canva, CapCut, Higgsfield, Flow and model providers execute generation/editing |
| Media launch | Supply an approved immutable asset package and receive launch bindings | P3 owns platform build, launch, budget and delivery state |
| Performance | Consume governed outcome observations and create learning/iteration tasks | BigQuery/Growth Engine owns reconciled performance and contribution metrics |

“Standalone” initially means a separate logical domain, permissions, queues and release boundary inside the Fullkit monorepo and Cloud SQL cluster. The MVP may use `app.creative_*` physical tables; it does not require a separate database or repository.

## 3. Scope

P2 includes:

- Creative calendar connected to Growth Engine marketing moments
- Creative demand orders by brand, product, market, moment, persona, message and format
- Iteratus idea-card intake and decision history
- Concept and brief development with evidence and requirements
- Internal, freelance, agency and AI-tool capacity planning
- Production jobs, assignments, dependencies, due dates and SLA
- Tool-run provenance for Canva, CapCut, Higgsfield, Flow and model providers
- Asset, raw-source, derivative and variant lineage
- Brand, claims, rights, originality and technical review
- Immutable launch packages and P3 launch bindings
- Performance feedback, creative learning records and iteration/replacement tasks

## 4. Non-goals

- Scraping or replacing Foreplay and Kalodata; that belongs to Iteratus connectors and permitted exports
- Owning the media-platform campaign state, budgets or delivery
- Treating a generated file as approved merely because a tool completed
- Storing only flattened final files while losing raw sources, prompts, parents or rights
- Declaring “winning ads” from platform spend alone
- Building Canva, CapCut, Higgsfield or Flow equivalents
- Letting AI publish customer-facing assets without explicit policy and approval

## 5. Complete workflow

### 5.1 Plan and demand intake

1. Growth Engine publishes an approved creative demand order linked to a business target, scenario, marketing moment and model run.
2. P2 expands the order into required coverage: products, personas, messages, formats, markets, languages, placements, due dates and expected volume.
3. P2 nets the requirement against reusable evergreen assets, scheduled work and expected decay.
4. The creative lead accepts the order, negotiates scope or returns a capacity exception to Growth Engine.
5. Accepted demand becomes dated calendar commitments with an accountable owner.

### 5.2 Idea-card intake

1. Iteratus sends a versioned idea card with evidence, source provenance, pattern, audience, angle, relevance window and confidence.
2. P2 records the card as an external intake; it does not copy the external creative into the reusable asset library.
3. A strategist accepts, rejects, defers or combines the idea.
4. An accepted idea may inform a concept or brief, but the resulting work must pass originality, claims and usage-rights review.
5. The decision and eventual outcome return to Iteratus as learning signals.

### 5.3 Briefing and capacity

1. A strategist creates a concept and versioned brief linked to demand, idea evidence and the marketing moment.
2. The brief defines objective, audience, single-minded proposition, claim boundaries, mandatory elements, formats, variants, CTA, landing destination and measurement plan.
3. P2 estimates effort by discipline and compares it with producer and vendor capacity.
4. Jobs are split into raw-source, poster, video, copy, edit, localization and adaptation tasks where necessary.
5. Assignments receive owner, due date, review path, cost budget and dependency state.

### 5.4 Production and provenance

1. Producers work in the appropriate external tools.
2. Each import or generation run records the provider, tool version where available, operator, prompt/configuration, input assets, output files, timestamps and cost.
3. Raw footage, source files, rendered masters and platform variants remain related through explicit parent-child lineage.
4. Every asset receives a stable Fullkit ID and content checksum; replacing a file creates a new version.
5. Rights, talent consent, licensed media, expiry and market restrictions attach to the relevant source or asset.

### 5.5 Review and approval

1. Automated checks may flag dimensions, duration, audio, missing labels, duplicate content, claim risk or rights expiry.
2. Human reviewers assess creative quality, brand fit, factual claims, originality, technical readiness and legal/usage rights.
3. Rejection creates a reason-coded revision task; approval names the exact immutable asset version.
4. Approval is role- and risk-based. Sensitive claims, material AI-generated likenesses and uncertain rights require specialist approval.
5. An approved launch package includes asset version, copy version, permitted products/markets/channels, destination requirements and expiry.

### 5.6 Launch handoff and learning

1. P3 accepts a launch package and returns platform campaign/ad/creative IDs through a launch binding.
2. Governed delivery and commercial outcomes land in BigQuery at asset, concept, message, format, product, audience and moment grains where matching quality permits.
3. Growth Engine classifies activation, outlier, decay, evergreen, marginal efficiency and contribution with stated methodology and confidence.
4. P2 creates iteration, localization, refresh, replacement or retirement tasks.
5. A learning record states what was tried, observed, inferred and what should change next. Correlation is not presented as causal proof.

## 6. Operational schema proposal

Use `creative` as the logical ownership namespace. Per [[Fullkit Technical Architecture]], the MVP may implement these as `app.creative_*` physical tables and split the schema only when roles, scale or release isolation justify it. Shared organization, catalog, integration, audit and event tables remain canonical under [[Fullkit Schema Blueprint]].

### Planning, concepts and briefs

| Table | Grain | Key fields |
|---|---|---|
| `creative.calendar_items` | One dated creative commitment | `id`, `workspace_id`, `brand_id`, `growth_marketing_moment_id`, `title`, `start_at`, `due_at`, `status`, `owner_membership_id`, `priority` |
| `creative.demand_orders` | One versioned creative requirement | `id`, `growth_demand_ref`, `business_target_ref`, `scenario_ref`, `model_run_ref`, `brand_id`, `market`, `required_by`, `status`, `requested_units`, `accepted_units`, `capacity_exception_reason` |
| `creative.demand_order_lines` | One product x persona x message x format requirement | `demand_order_id`, `product_id`, `persona_key`, `message_key`, `format_key`, `placement_key`, `language`, `required_qty`, `expected_activation_rate` |
| `creative.idea_intakes` | One version of an Iteratus idea-card handoff | `id`, `iteratus_idea_id`, `iteratus_version`, `evidence_ref`, `received_at`, `decision`, `decision_reason`, `decided_by`, `decided_at` |
| `creative.concepts` | One addressable creative concept | `id`, `brand_id`, `name`, `hypothesis`, `audience`, `angle`, `message`, `status`, `origin_type`, `origin_ref` |
| `creative.concept_sources` | One concept-to-evidence relation | `concept_id`, `source_type`, `source_ref`, `evidence_role`, `provenance_snapshot_ref` |
| `creative.briefs` | One brief identity | `id`, `concept_id`, `demand_order_id`, `calendar_item_id`, `owner_membership_id`, `status`, `current_version_id` |
| `creative.brief_versions` | One immutable brief revision | `id`, `brief_id`, `version`, `objective`, `proposition`, `requirements`, `claim_boundaries`, `cta`, `destination_ref`, `measurement_plan`, `created_by`, `created_at` |
| `creative.claim_refs` | One approved knowledge/claim/policy reference | `id`, `brief_version_id`, `knowledge_item_ref`, `policy_version_ref`, `market`, `valid_until`, `status` |

### Capacity and production

| Table | Grain | Key fields |
|---|---|---|
| `creative.resources` | One internal producer, vendor or tool capacity resource | `id`, `resource_type`, `membership_id`, `vendor_ref`, `discipline`, `status`, `default_cost_rate` |
| `creative.capacity_periods` | One resource x period x discipline capacity | `resource_id`, `period_start`, `period_end`, `capacity_units`, `committed_units`, `unavailable_units` |
| `creative.production_jobs` | One deliverable job | `id`, `brief_id`, `demand_line_id`, `job_type`, `format_key`, `quantity`, `status`, `priority`, `due_at`, `cost_budget`, `parent_job_id` |
| `creative.job_assignments` | One resource assignment interval | `id`, `production_job_id`, `resource_id`, `assigned_units`, `assigned_at`, `started_at`, `completed_at`, `status` |
| `creative.tool_runs` | One external production/generation execution | `id`, `production_job_id`, `integration_id`, `provider`, `tool_name`, `model_or_version`, `operator_id`, `prompt_or_config_ref`, `input_manifest`, `output_manifest`, `cost_amount`, `status`, timestamps |

### Assets, approvals and launch

| Table | Grain | Key fields |
|---|---|---|
| `creative.assets` | One logical creative asset | `id`, `concept_id`, `production_job_id`, `asset_type`, `title`, `status`, `current_version_id` |
| `creative.asset_versions` | One immutable file/content version | `id`, `asset_id`, `version`, `storage_ref`, `content_checksum`, `mime_type`, `duration_ms`, `dimensions`, `language`, `copy_text`, `created_by`, `created_at` |
| `creative.asset_relations` | One directed lineage edge | `parent_asset_version_id`, `child_asset_version_id`, `relation_type`, `tool_run_id` |
| `creative.usage_rights` | One rights grant/restriction | `id`, `subject_type`, `subject_id`, `right_type`, `markets`, `channels`, `valid_from`, `valid_to`, `evidence_ref`, `status` |
| `creative.reviews` | One reviewer assessment | `id`, `asset_version_id`, `review_type`, `reviewer_id`, `decision`, `reason_codes`, `notes`, `created_at` |
| `creative.approvals` | One formal approval decision | `id`, `asset_version_id`, `approval_scope`, `approved_by`, `conditions`, `valid_until`, `status`, `decided_at` |
| `creative.launch_packages` | One immutable approved handoff | `id`, `brief_id`, `asset_version_id`, `copy_version_ref`, `allowed_markets`, `allowed_channels`, `destination_ref`, `expires_at`, `status` |
| `creative.launch_bindings` | One launch package x platform entity | `id`, `launch_package_id`, `p3_activation_ref`, `channel`, `ad_account_ref`, `campaign_ref`, `ad_ref`, `bound_at`, `status` |
| `creative.iteration_tasks` | One requested change/refresh | `id`, `source_asset_version_id`, `reason_type`, `evidence_ref`, `requested_change`, `priority`, `due_at`, `status` |
| `creative.learning_records` | One reviewed creative learning | `id`, `concept_id`, `observation_window`, `methodology_version`, `evidence_refs`, `finding`, `confidence`, `decision`, `reviewed_by` |

All mutations also emit `domain_events`, write `audit_events`, and use the transactional outbox. Large media belongs in object storage; Cloud SQL holds metadata, checksums, rights and lineage.

## 7. BigQuery marts

| Model | Grain | Purpose |
|---|---|---|
| `dim_creative_asset` | Current conformed asset version | Searchable attributes, lineage, rights and approval state |
| `fct_creative_demand` | Demand line x plan version | Required, accepted, scheduled, delivered and launched quantity |
| `fct_creative_capacity_daily` | Date x resource x discipline | Capacity, committed work, throughput and bottlenecks |
| `fct_creative_production_job` | Production job | Cycle time, revisions, cost, due-date performance and output |
| `fct_creative_launch_daily` | Date x launch binding | Delivery, spend and governed commercial outcomes |
| `fct_creative_daily` | Date x asset x channel x market | Activation, age, decay, revenue/contribution proxies and data confidence |
| `fct_creative_portfolio_health` | Date x brand x product/message/format | Coverage, concentration, evergreen share, rotation, decay and replacement need |
| `fct_creative_concept_outcome` | Concept x observation window | Aggregated outcome, creative cost and inference confidence |
| `fct_creative_production_economics` | Job or concept x period | Production cost per approved, launched, activated and outlier creative |
| `fct_iteratus_idea_outcome` | Idea-card version | Acceptance, production, launch and validated-learning result returned to Iteratus |

The governed `fct_creative_daily` and campaign facts are built from normalized ad-platform data. P2 does not calculate commercial truth from screenshots or vendor dashboards.

## 8. APIs and events

### Commands

- `POST /creative/demand-orders/{id}/accept`
- `POST /creative/idea-intakes`
- `POST /creative/idea-intakes/{id}/decide`
- `POST /creative/briefs` and `POST /creative/briefs/{id}/versions`
- `POST /creative/production-jobs` and assignment/start/complete commands
- `POST /creative/tool-runs`
- `POST /creative/assets/{id}/versions`
- `POST /creative/assets/{version}/review` and `/approve`
- `POST /creative/launch-packages`
- `POST /creative/launch-bindings`
- `POST /creative/iteration-tasks`

### Read APIs

- Calendar, demand coverage and capacity views
- Brief, concept, job and lineage views
- Rights and approval eligibility
- Launch-ready package manifest
- Governed outcome and learning summary

### Domain events

`creative_demand_requested`, `creative_demand_accepted`, `creative_capacity_exception_raised`, `idea_card_received`, `idea_card_decided`, `creative_brief_approved`, `production_job_assigned`, `production_job_completed`, `asset_version_created`, `creative_review_failed`, `asset_version_approved`, `launch_package_ready`, `creative_launched`, `creative_decay_detected`, `creative_iteration_requested`, and `creative_learning_validated`.

Every command requires workspace/brand scope, actor, correlation ID and idempotency key where retries are possible.

## 9. AI boundary

AI may:

- Cluster evidence and propose concepts, hooks, variations and brief drafts
- Detect missing format/product/persona coverage
- Estimate effort and propose capacity allocation
- Suggest technical, brand, claim, rights and originality review flags
- Generate production instructions or tool prompts
- Summarize governed performance and propose iteration hypotheses

AI may not:

- Mark an asset approved, rights-cleared or factually substantiated
- Publish to an ad platform or website
- Treat vendor tool output as provenance-free owned work
- Retrieve unrestricted warehouse data or platform credentials
- Claim causal performance without the approved measurement method
- Change demand, budget or production commitments outside approved limits

AI receives curated brief, knowledge, policy, rights and governed outcome context through Fullkit APIs. Tool calls use strict schemas, and sensitive claims, rights decisions, final approval and launch remain human-gated.

## 10. KPIs

### Supply and speed

- Required versus accepted versus delivered creative units
- Calendar coverage and on-time delivery rate
- Brief-to-first-draft, draft-to-approved and approved-to-launched cycle time
- Producer/vendor capacity utilization and blocked time
- Weekly posters and raw videos delivered against the 50 and 10-20 capacity targets

### Quality and learning

- Distinct concepts and raw source packages, not only derivative count
- Brief approval, revision and rejection rates by reason
- Approved-to-launched and launched-to-activated rates
- Activation, outlier, evergreen, decay and rotation measures
- Product, persona, message, format, placement and moment coverage
- Iteratus idea acceptance and validated-learning rates

### Economics

- Cost per approved, launched, activated and outlier creative
- Incremental contribution after creative-production cost where measurable
- Rework and late-delivery cost
- Useful life and contribution concentration by concept family

## 11. Dependencies and risks

| Dependency/risk | Control |
|---|---|
| Growth demand is not versioned or changes silently | Require target, scenario, model-run and demand-order references |
| Foreplay/Kalodata access or terms change | Preserve permitted export/API provenance; never make production depend synchronously on them |
| Tool-generated files lose prompts, parents or ownership evidence | Mandatory tool-run and asset-lineage manifests |
| High volume becomes a vanity metric | Pair throughput with originality, launch, activation, learning and contribution |
| Media IDs fail to map back to assets | P3 launch package contract and required platform-entity binding |
| Creative “winner” inference is platform-biased | Use governed metrics, methodology version and confidence; separate correlation from incrementality |
| Rights or claims expire after launch | Time-bounded rights/approval, expiry alerts and P3 stop requests |
| Review becomes the bottleneck | Role-based review queues, SLA, capacity visibility and reason-coded rework |
| AI homogenizes output | Track source diversity, concept families, originality review and performance concentration |

## 12. Staged MVP

### Stage 0 - Instrument existing work

- Establish canonical creative, concept, asset and launch IDs.
- Import the current calendar and active asset library.
- Require P3 launch bindings and preserve raw/source lineage.
- Build the first read-only `fct_creative_daily`.

### Stage 1 - Calendar, demand and asset lineage

- Ship demand orders, calendar, briefs, jobs, asset versions and approvals.
- Capture 50-poster and 10-20-raw-video weekly capacity without treating it as success.
- Connect Iteratus idea-card intake and P3 launch package handoff.

### Stage 2 - Capacity and production integrations

- Add resource capacity, assignments, vendor cost and tool-run manifests.
- Integrate selected Canva/CapCut/Higgsfield/Flow workflows through export/import or APIs where permitted.
- Add rights, claims and technical review gates.

### Stage 3 - Governed creative intelligence

- Add portfolio health, activation, decay, evergreen and production-economics views.
- Let Growth Engine create versioned creative demand from approved scenarios.
- Generate AI-assisted briefs and iteration proposals with evidence.

### Stage 4 - Bounded automation

- Automatically create safe replacement/localization tasks within approved plans.
- Draft production/tool jobs and P3 launch requests, retaining human approval.
- Evaluate every automated recommendation against delivery, learning, policy and commercial outcomes.

## 13. MVP acceptance criteria

- Every launched creative resolves to a brief, concept, immutable asset version, approval and P3 launch binding.
- Every demand order shows required, accepted, scheduled, delivered and launched coverage.
- Producer capacity and due-date risk are visible before work is committed.
- Iteratus can hand off an idea card without owning or blocking P2 production.
- P2 performance views reconcile to governed BigQuery ad and order facts.
- An operator can trace a creative from commercial target to production cost and observed outcome without a spreadsheet join.
