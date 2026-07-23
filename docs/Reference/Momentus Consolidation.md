---
title: Momentus Consolidation
description: One-page consolidation of the Momentus concept (Jun–Jul 2025) — a unified marketing-analytics platform/agency offering in four pillars. Absorbed as a research input for the Fullkit PRD; the original folder is retired.
created: 2026-07-15
tags: [reference, consolidation, fullkit, momentus, analytics, data-stack]
---

# Momentus — Concept Consolidation (One-Pager)

> Consolidated 2026-07-15 from the retired `Momentus - Unified Analytics for Improving Marketing Operation` folder (~30 notes, Jun–Jul 2025). Feeds [[PRD|the Fullkit PRD]] alongside [[Luxana Teardown]] and [[Fighter Teardown]]. Where those teardowns map the *operational* OMS side, Momentus was our own earlier blueprint for the *analytical* side — warehouse, modeling, forecasting, AI surface — and much of it is now the approved Track B / CDP plan under a different name.

## 1. What it was

**Momentus Digital** — "Unified Analytics for Improving Marketing Operation." A productized data service for e-commerce (and secondarily SaaS) brands, pitched as an end-to-end answer to siloed, untrustworthy marketing data. Tagline: *"Your Data, Activated."* Positioning references: Adasight (agency model to emulate), Triple Whale Moby (chat/agents), Statlas/Common Thread Collective (operating methodology), minimaldata.com (philosophy).

Four-pillar hierarchy (service → infrastructure → reporting → interface):

1. **Momentus Activate** (service) — white-glove instrumentation: measurement planning, event-tracking strategy, martech setup. Solves "garbage in, garbage out" before any platform work.
2. **Momentus Flow** (the engine) — the owned ELT data architecture: connect ad + store + analytics sources, land raw, transform with dbt into a single source of truth; attribution (MMM), cohort/LTV, unified performance reports, MCP exposure so LLMs can query the marts.
3. **Momentus Operate** (reporting service) — combine Flow data with accounting + inventory data for full business-operation analysis: contribution-margin P&L, forecasting, Growth Map, roadmap/consultation.
4. **Momentus Portal** (the cockpit) — client-facing app: unified dashboards, AI chat over the data ("what was my best-performing ad last week?"), proactive agent alerts. Clients bring their own LLM API keys.

## 2. Architecture (the useful core)

Classic modern-data-stack ELT, deliberately ETL-averse ("data insurance": raw is immutable and replayable; transformation logic lives in version-controlled SQL, never in the ingestion tool):

- **Ingestion**: Airbyte (Cloud ~$100/mo, or OSS with own developer-API apps to cut cost). Land to **S3 raw** (added later to avoid paying warehouse rates for landing), then **MotherDuck/DuckDB** as the OLAP warehouse. Local-first development for both compute and warehouse.
- **Transformation**: dbt with the three-schema pattern — `raw_data` (untouched, auditable) → `staging` (rename/cast/light cleaning, one model per source table, ephemeral) → `marts` (business-ready; all SCV, attribution, product logic lives here).
- **Orchestration/CI**: Dagster+ (right-size containers, per-job resources) or serverless webhook glue (Airbyte notification → trigger dbt); GitHub Actions for selective model testing. Cost discipline: incremental models as the #1 lever, filter early, no `SELECT *`, challenge refresh schedules.
- **BI**: Evidence (favored; metric-sheet pattern), Metabase, Marimo as candidates.
- **AI layer**: marts as the stable "API layer" for LLMs via MCP — instant/scheduled reporting, gap analysis, forecasting Q&A; n8n for agentic workflows; RAG stack notes (LlamaIndex + Chroma → Pinecone/Weaviate, Cohere Rerank, Ragas/Langfuse eval) for a knowledge-base layer over profitability summaries and alerts.

**Key marts blueprint** (the modeling plan, still directly reusable):

- `int_customer_identity_map` → `dim_customers` — identity stitching on email across PostHog person_id / Shopify customer_id / anonymous IDs into a `master_customer_id`; the SCV with LTV, first-touch, cohort fields.
- `fct_customer_events` — unified chronological event stream per customer (journey/bottleneck analysis).
- `fct_ads_performance` — cross-channel daily ad performance union (spend/impressions/clicks by campaign); joins creative attributes for creative analysis.
- `fct_marketing_mix_daily` — the MMM input table (daily spend per channel × revenue) feeding **Robyn (Meta)** and **Meridian (Google)** side by side.
- `fct_sales` / `fct_order_profitability` — SKU-level sales joined to time-versioned `stg_product_costs` (SKU cost with valid_from/valid_to), fulfillment and transaction fees → **contribution margin per order**; `fct_daily_expenses` for OPEX time-series. This is what upgrades marketing analytics into business intelligence.

**Sources planned**: Meta/Google/TikTok Ads; GA4, PostHog, GTM, Search Console; Shopify + WooCommerce (Shopee later via developer API; TikTok Shop not feasible then); Klaviyo; Google Sheets for manual closes; QuickBooks/Xero for accounting. Content/LIVE metrics were out of reach without third parties (Hootsuite); WhatsApp chatbot noted as an edge.

## 3. Operating methodology (Momentus Operate = CTC's playbook)

Absorbed wholesale from Common Thread Collective's "Prophit Engine" material — the same loop the approved EFFEN presentation names as the CDP end-state:

- **Forecast customer-centrically**: existing-customer revenue via cohort-specific LTV (new / reactivated / active / lapsed), new-customer revenue via a spend↔acquisition-efficiency (AMR) model with seasonality and diminishing returns; Profit Allocation Model + MMM to set and split the ad budget.
- **Growth Map** as the central operating document: 2-year P&L forecast, marketing calendar with an Event Effect Model (every planned campaign carries a revenue expectation — "Four Peaks" per year), channel media plans, **daily targets for 35+ metrics** (contribution margin first), scenario planning, actuals vs plan in real time; ties ad spend to inventory positions.
- **Plot–Pivot–Profit daily cadence**: track vs targets, communicate deviations "what / so what / now what," course-correct before hundred-dollar problems become million-dollar ones.
- A separate **Growth Forecast App** sketch: toggle Startup / Growth / Maintenance modes to switch forecasting algorithms (prototyped in a Google Sheet).

## 4. Positioning & go-to-market (as drafted then)

Growth-analytics-as-a-service: Activate (instrumentation) and Operate (value architecture/roadmap) as human services wrapping the owned Flow platform and Portal product — the Adasight agency shape. Noted risk from [[In-detail Success]]: *"stakeholders today don't fully understand how they can use data to make better decisions"* — internal data competency is the adoption bottleneck, so the plan was to succeed with data on our own business first and sell from proof. Data-as-a-product framing (DJ Patil, Luke Lin): go beyond funnel reports to proactively finding drop-off areas and growth levers. Open tasks at time of retirement: professional website (needed anyway for platform developer-API approvals), tiered free resources.

## 5. Why it's retired into Fullkit

- The four pillars map cleanly onto the current world: **Activate** → instrumentation/source-audit work already in the approved Gantt; **Flow** → Track B warehouse + CDP-as-dbt-models (identity stitching, marts); **Operate** → MER reporting / cost model / Prophit-Engine loop; **Portal** → the agent-legible MCP surface Fullkit mandates from day one.
- The delta: Momentus was aimed *outward* (sell to client brands, multi-tenant SaaS + agency). Fullkit deliberately drops the SaaS packaging and builds the same substrate for EFFEN's own five brands — the same conclusion the Fullkit thesis reaches about Fighter/Luxana ("we need their internals, not their packaging").
- Still-live artifacts worth lifting verbatim when Track B reaches them: the three-schema dbt pattern, the marts blueprint above (identity map, event stream, MMM input, order profitability), the SKU-level time-versioned cost model, the ELT cost-discipline checklist, and the Robyn + Meridian dual-MMM comparison idea.
- Reference links preserved: Robyn & Meridian docs/playbooks, Think with Google measurement-roadmap series, Evidence metric-sheet repo, Triple Whale Moby/agents, CTC growth pages, PostHog identify docs, Airbyte webhook-monitoring docs, TikTok Business API portal, martechbuilder.adasight.com, anytrack.io, Rockerbox plans.

> [!warning] Housekeeping
> The retired folder contained a **live MotherDuck read-write service-account token** in plain text (`Token Access (Cautious).md`, Jul 2025). It was deliberately **not** carried into this note and the file is deleted with the folder — but it remains in git history, so rotate/revoke that token in MotherDuck. Embedded screenshots (`Pasted image *.png`) referenced by the old notes were not carried over.

## Sources

Retired vault folder `5. Idea Vault/1. Internal Application/Momentus - Unified Analytics for Improving Marketing Operation/` — principally: General.md (pillar definitions) · Tasks In General.md (4-hierarchy pitch) · Raw Schema to Finished Data Journey.md (dbt/marts walkthrough) · Challenge - Wider Sources.md (expense/contribution-margin model) · Solves - Data Insurance.md (ELT rationale) · Challenge - Cost & Stack Management.md · Tech Related - Data Stack / LLM / Sources & Integration / BI · Momentus Operate: Business Operation Analysis, Growth Map, Forecasting (CTC) · Momentus Activate: Strategy · In-detail Success.md · Growth Forecast App.md
