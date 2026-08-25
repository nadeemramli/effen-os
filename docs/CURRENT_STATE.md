---
title: Fullkit current development state
description: Code-backed status of Fullkit surfaces, data paths, write boundaries, and known gaps.
updated: 2026-08-25
status: living
source_commit: 20fc8702bdf483168346adb9b353ae853802a4e7
tags: [fullkit, status, implementation, operations]
---

# Fullkit current development state

This is the release-status companion to the product and architecture documents. It describes what exists on `main` at commit `20fc870` (25 Aug 2026). When this document conflicts with a proposal, the implementation hierarchy at the end of this page wins.

> [!note] Program in progress — 25 Aug 2026
> The operational-workspaces program (Customer Base, cohort workspaces, Orders QC, Profit customer economics, fulfilment/CRM and production continuation) is tracked in [[plans/operational-workspaces-customer-profit|the program plan]]. Nothing listed there changes a status on this page until its slice ships and this page is updated.

## Audit scope and implementation census

This classification comes from a repository-wide audit of routes, client calls, migrations, edge functions, dbt/Terraform, ADRs, automation definitions, and commit history at the source commit above. “Live” here means the checked-in code path and accepted decision are live-capable; it does not assert that every external connection or scheduled job is healthy at the moment a reader opens this file. Use Fullkit’s Automations page and the owning platform for runtime health.

| Area inspected | Inventory at the source commit |
|---|---|
| Application | 12 sidebar sections (41 section children across Orders, Customers, Fulfilment, Profit, Inventory, Production), 6 settings entries, and 55 App Router page files |
| Operational backend | 80 migration files covering 83 recorded migrations, 7 edge functions, and three plain-SQL invariant test files under `supabase/tests/` |
| Automation registry | 28 definitions: 23 live, 1 on hold, 4 planned |
| Architecture decisions | 9 ADRs; ADR-0002 remains draft, while ADR-0006 activates only its shadow pilot |
| Growth data platform | 18 warehouse files, 11 infrastructure files, and 1 GitHub Actions workflow |
| Support tooling | Fighter-history import plus an authenticated E2E session-mint helper |

## Status vocabulary

| Status | Meaning |
|---|---|
| Live | Reads real operational or warehouse data. Any write is guarded by the authenticated workspace role and the relevant RLS/RPC policy. |
| Hybrid | A route combines real data with deterministic prototype content; the boundary must be visible in the UI. |
| Shadow | Fullkit computes and records the intended action but does not call the external write API. |
| Demo | Deterministic seeded state only; actions mutate browser state and do not reach real systems. |
| Placeholder | The route exists to preserve information architecture but its workflow is not implemented. |

> [!note] Route status is not data maturity
> `apps/web/src/lib/nav/routes.ts` uses `status: "live"` to mean the interface is implemented and navigable. This document’s Live/Hybrid/Shadow/Demo classification is the authority for whether that interface uses real data or external writes.

## Surface status

| Area | Current status | What is implemented now | Boundary / next step |
|---|---|---|---|
| Command Centre | Hybrid | Live commercial scorecard can replace its scorecard when a real session is present. | Morning briefing, work queue, plan charts, and recommendations still come from the demo store. |
| Orders | Live read side + controlled QC write | Paginated Woo order mirror, brand/market/store/status/currency/age filters, detail pages, identity link, evidence context, 15-minute mirror expectations, a section sidebar whose queue badges come from one grouped RPC, and an explicit **New / QC** workflow: `order_qc` (`qc_state`, reason codes, owner, due, last contact, version) with an append-only event log, seven audited commands (start review, request information → internal work item, correct & revalidate, hold, assign, approve, reject), a review panel on the order page and a QC column on the list; open orders from the last 7 days enrol every 15 minutes, older ones by hand. **Drafts** are server-side manual orders (idempotent save, confirm into QC, discard) at `/orders/drafts`. | Approval clears QC only — it never reserves stock, books a courier or changes the store status; a separate **Release to fulfilment** (`qc_release_to_fulfilment`, approved orders only) sets `fulfilment_release_state` and the warehouse dimension, while `reservation_state` stays `not_requested` until an inventory authority exists (Phase 7). Nothing is sent to customers (request-information is a work item plus a blocked dispatch decision). A confirmed draft is not created at the store until the write path is enabled. Bulk import stays a placeholder and the `orders/new` form is still the demo prototype; Fighter remains operational authority. |
| Customers | Live (controlled write) | Resolved identities, Customer 360, contribution LTV and risk, address-cluster/reseller signals, saved segments, filtered CSV export, a **Customer base** page (`/customers/base`: opening / new / reactivated / lapsed / closing / net-rate cards, diverging movement chart, active-base trend, month/week grain, brand + market scope, policy and freshness badges, coverage banner, definitions panel, masked drill-through), and three **cohort workspaces** (`/customers/vip`, `/customers/at-risk`, `/customers/shared-address`) with served rule + version, member lists and audited internal **follow-ups** (`create_customer_work_item` / `close_work_item` over `work_items`, one open item per customer × action, every change in `audit_events`; also on Customer 360). A governed lifecycle contract (policy v1, provisional 60-day lapse) computes qualifying orders, acquisition cohorts, state intervals, transitions, reconciled weekly/monthly base movement and a per-identity current state nightly in `private.*`; the list, detail, cohort pages and the segment builder's `activity` field all read that contract (legacy `dormant` = `lapsed`). **Dispatch** (`/customers/dispatch`) lists Fullkit-owned contact decisions (`dispatch_requests`: purpose, channel, template version, eligibility, block reasons, Strive shadow envelope) created by QC request-information or by hand; Strive is registered as a `pending_setup` shadow transport. | Every dispatch request is blocked at decision time (no consent source, draft templates, unverified transport) and nothing is sent; `sent: false` is asserted by `supabase/tests/fulfilment_states.sql`. Acquisition lens only. VIP is still the unversioned `tier-v0` (revenue ≥ 900) rule and repeat state is unversioned. No consent, suppression or frequency source is connected, so cohort pages say so and nothing can be sent from Fullkit; a person makes the call or message. Intraday lifecycle threshold crossings appear after the nightly refresh. Identity merges are not historised, so the movement corrections line is always 0. Export is capped at 20,000 rows and carries a personal-data warning. |
| Fulfilment | Live read + shadow write | Overview, Ship-readiness, Exceptions and Returns pages over one shared floor snapshot: live order queues, Ninja Van tracking, ship-readiness checks, corrections, holds/releases, AI address suggestions, shadow payloads, and return-to-sender lane. **AWB Manager** (`/fulfilment/awb`, shadow) shows six independent facts per order — QC state / release, Ninja Van submission & AWB, warehouse, carrier (webhook evidence only), notification — with lanes and evidence-gated operator records (AWB downloaded / printed, handed over) and an append-only `fulfilment_state_events` log; a 15-minute sync derives `nv_state` from shadow submissions and linked shipments and `carrier_state` only from Ninja Van events with a monotonic rank. Delivery notes, Bulk tracking, Pickup locations, Duplicate orders, Fraud checker and Postcode finder remain navigable placeholders. | Fullkit creates no consignment and fetches no waybill until the ADR-0006 exit gate passes; AWB lanes are mostly empty because Fighter-booked parcels are rarely linked to orders (108 of 11,239). Warehouse picking/packing states are reserved for P4. Pick/pack/handover stays in Fighter. |
| Automations | Live registry | One registry documents cron, webhook, SQL, Airbyte, dbt, mart-sync, identity, cost, and fulfilment automations with available health evidence. | WhatsApp inbound is deployed but awaits the Meta app connection; several finance/activation automations remain planned. |
| Marketing | Live with demo fallback | Meta account coverage, campaign facts, spend, Fullkit revenue/orders, custom date ranges, brand/market/platform scope, CM2, and CM3. | Platform attribution is not incrementality. Google and TikTok appear as unconnected placeholders. |
| Profit | Live read-only | Contribution P&L on the commerce daily spine (overview), plus **customer economics** (metric version econ-v1) as section children: nCAC per new customer (accepted / delivered / paid denominators), platform CPA labelled provider attribution, first-order contribution and FOP, contribution LTV per customer by matured horizon (0/30/60/90/180/365), LTV:nCAC, payback, and a definitions & coverage page. Served by `live_brand_customer_economics` from nightly-rebuilt `private.*` economics tables; every withheld cell carries a reason. | Contribution, not net profit; fixed costs, marketplace commission and payment fees are absent. Economics are provisional under D3–D7 (Meta-only spend net of WHT, provider purchase share, expected returns only with carrier evidence, no FX so SG scopes are currency-mixed). Carrier return evidence starts Aug 2026. The lifetime LTV on Customer 360 remains a client-side sum. |
| Catalog and Inventory | Live (registries) | Products/variants, Woo product mirror, SKU mapping queue, pack sizes, governed unit costs, unit economics, on-hand/cover/stock signals, plus the Phase 7 registries as Inventory children: **Items & locations** (`inventory_items` finished goods mirroring variants 1:1, eleven logical `inventory_locations` with authority `none`, the channel-publishable formula with its missing inputs stated), **Pack configurations** (versioned `product_pack_configurations`; draft → HQ-admin approval supersedes the previous version), **Marketplaces** (`marketplace_accounts` seeded from the onboarding register with scopes, capabilities, source-of-truth map and `cutover_mode`; `marketplace_listings` mapping grain). | Identity only under the S3 rule: stock stays on `product_variants.stock_on_hand`, no levels / movements / reservations exist, and nothing is published to a channel. Seeded pack configurations are placeholders until governed capsule/sachet configurations are approved. Marketplace cutover refuses `pilot_write` / `live` (ADR-0009) and `read_only` needs an approved partner app; no connector is built. |
| Production | Live controlled write | Per-product raw material → premix → in-progress → in-stock counters, append-only ledger, computed backlog, material/inbound management, arrival posting, days of cover, and a **WhatsApp observations** inbox (`wa_observations`: every inbound factory message becomes immutable evidence once; review links it to a production item and batch reference, audited). | No parser yet (every observation is `unlinked_review`) and the inbox is empty until the WhatsApp Cloud API connection and the group-feasibility gate are resolved. Reviewing never moves stock. BOM/MRP, work orders, lots/expiry, reservations and automated stock deduction are deferred. |
| Setup | Live admin | Authenticated Woo connection management and manual sync, live brand/product/variant setup, WhatsApp Cloud API credentials and number-to-brand mapping, and OpenRouter key rotation. Secrets are write-only from the browser and stored in Vault/edge-function secrets. | HQ-admin/RLS boundaries apply. Ninja Van credentials and external-write promotion are not exposed as ordinary setup actions. |
| Finance | Demo | Commission review/release flow and SQL Accounting handoff are represented in seeded state. | Live contribution rules exist in the backend, but the full finance control UI and accounting integrations are not live. |
| Creative and Reports | Demo | Implemented prototype screens and interactions. | Governed live read models are still required. |
| Integrations and Data Health | Mixed prototype | Route surfaces and repository contracts exist; live connection setup is available under Setup. | Most operational views here still use the prototype repository. |
| Audit and Settings | Placeholder | Navigation and intended workflows are documented in-app. | Implement immutable audit browsing, member/role administration, feature flags, and mode promotion. |

## Product and spine maturity

The July product documents describe complete target products. Their current maturity is narrower:

| Product layer | Current maturity | Implemented slice | Material remainder |
|---|---|---|---|
| [[P1 - Customer Revenue Engine]] | Partial live | Customer identity/360, lifecycle and tier classification, saved segments, address/risk/contribution context, filtered export, and WhatsApp receiver/setup foundation. | Lifecycle orchestration, a live Conversation Hub, consent sources, outbound messaging, and service work queues. |
| [[P2 - Creative Intelligence and Supply]] | Demo / analytical foundation | Creative prototype UI plus Meta ad/creative metadata used for brand resolution in the warehouse. | Governed asset library, briefs, attempt lineage, test design, supply planning, and production workflow. |
| [[P3 - Marketing Execution and Commerce Experience]] | Live read analytics | Warehouse-backed Meta coverage, campaigns, media metrics, revenue, contribution, date/brand/market/platform scope. | Platform activation/writes, incrementality, Google/TikTok sources, and commerce-experience orchestration. |
| [[P4 - Commerce Operations and WMS]] | Live read + shadow pilot | Orders, corrections, ship-readiness, fulfilment stages, holds, Ninja Van tracking/returns, and shadow consignment payloads. | Woo correction write-back, live consignment creation, pick/pack/handover, reservations/ATP, and physical-stock authority. |
| [[P5 - Production Planning and MRP]] | Slice 0 live | Audited stage ledger, materials, inbound shipments, computed backlog, pack sizes, and days of cover. | BOM/MRP, work orders, capacity, batches/lots, quality, yield, costing, and automatic stock movements. |
| [[P6 - Finance Control]] | Partial backend + demo UI | Effective-dated cost/WHT rules, COGS, fulfilment and return costs, CM2/CM3, and contribution coverage gates. | Payment/settlement reconciliation, card/expense evidence, live commissions, close workflow, governed FX, and SQL Accounting export. |
| [[Iteratus - Trends and Ideas]] | Target only | No dedicated live route or operational model. | Research, scoring, opportunity workflow, and activation. |
| [[AI Sales Closer]] | Demo intake boundary | Paste-chat order extraction exists in the demo new-order flow; WhatsApp capture foundation exists. | The conversation runtime belongs in Meta per ADR-0001; live order intake, escalation, governance sync, and outcome measurement remain. |
| [[Growth Engine]] | Mixed live and demo | Live plan baseline, commercial scorecard inputs, Marketing, Profit, and governed growth marts. | Diagnosis, recommendations, approvals, activation, experiments, and measured learning loops remain demo or unimplemented. |

| Shared spine | Current maturity | Boundary |
|---|---|---|
| [[S1 - Customer and Order Hub]] | Partial live | Woo/Fighter orders, identity, addresses, segments, and customer context are live; conversations, consent, live work items, and canonical write-side order state are incomplete. |
| [[S2 - Creative Loop]] | Analytical foundation / demo | Meta creative metadata supports warehouse classification; the governed creative asset/brief/attempt/learning loop is not live. |
| [[S3 - Inventory]] | Partial live | Catalog, variants, SKU mappings, costs, production counts, backlog, and cover are live; multi-location movement, reservation/ATP, lots, and WMS authority are deferred. |
| [[S4 - Money]] | Partial live | Contribution costs, returns, ads, and dated WHT are live; payment, settlement, payout, commission, accounting, and full cash-control records are not. |

## Integration and authority matrix

| System | Direction and implemented path | Current authority / safety boundary |
|---|---|---|
| Supabase | Auth, operational mirrors, RLS, RPCs, cron, Vault-backed secrets, read models, and edge functions. | Fullkit-owned control plane. Browser uses only the publishable/anon key; service-role credentials stay server-side. |
| WooCommerce | Orders sync every 15 minutes; products/variants mirror hourly; manual sync and connection setup are available. | Storefront order source. Fullkit corrections overlay reads and staged payloads but are not written back to Woo. |
| Fighter | Historical import consolidates legacy orders; current warehouse process supplies operational comparison evidence. | Still owns today’s pick/pack/handover and Fighter-created Ninja Van consignments during the pilot. It is not a continuous governed API integration in this repository. |
| Ninja Van | HMAC-verified inbound tracking and durable return-to-sender facts are live; exact outbound payloads are logged in shadow. | Inbound evidence is live. Outbound consignment creation is on hold behind ADR-0006’s exit gate and scoped promotion. |
| Meta Ads | Per-account Airbyte reads land in BigQuery, then dbt and mart-sync publish governed facts to Supabase. | Read-only analytics. Platform attribution is evidence, not incrementality; Fullkit performs no ad-platform writes. |
| WhatsApp Cloud API | Signature-verified receiver, Vault credential setup, number mapping, conversations/messages schema. | Capture begins only after Meta connects and sends events; there is no history backfill or Fullkit outbound messaging. Agent runtime stays in Meta per ADR-0001. |
| OpenRouter | Flagged shipping details can be sent for capped, suggest-only address correction. | A human accepts or rejects every suggestion. Provider data collection is disabled; acceptance writes a Fullkit correction, not Woo/Ninja Van. |
| BigQuery and dbt | Analytical landing, staging, classification, tests, and `mart_ads_daily`; mart-sync copies the governed ads contract back to Supabase. | Analytical truth only; it never writes operational order, stock, shipment, or payment state. |
| Google/TikTok/Shopee ads and marketplaces | Domain enums and UI placeholders exist. | No checked-in live connector or governed fact path yet. |
| SQL Accounting | Demo finance handoff copy only. | No live export or accounting write integration. |

## Runtime and data paths

### Frontend and access

- `apps/web` runs Next.js 16, React 19, TypeScript, Tailwind v4, shadcn/ui, Recharts, TanStack Table, Zustand, and the Supabase browser client.
- Vercel builds/deploys the web application.
- Auth is invite-only when Supabase is configured and `NEXT_PUBLIC_FULLKIT_AUTH=required`. Membership determines role and preferences; browser access uses the publishable/anon key behind RLS.
- Live-only routes use `LiveGuard`. Unconfigured or signed-out sessions render an explicit guard rather than sample values.
- The generic `Repository` abstraction still serves older demo workflows. Real surfaces use the focused functions in `apps/web/src/lib/supabase/live.ts`; the prepared `SupabaseRepository` is not a complete swap-in backend.

### Operational path

```text
WooCommerce ──woo-sync / product-sync──▶ Supabase operational mirrors
Ninja Van ─────────HMAC webhook────────▶ shipment + event facts
Supabase pg_cron / guarded RPCs────────▶ read models, automation health, controlled writes
OpenRouter address assist──────────────▶ suggestion only ──human accept/reject──▶ correction
Shadow fulfilment──────────────────────▶ logged Ninja Van payload; no external submit
```

Operational truth lives in Supabase/Postgres migrations and edge functions. High-risk changes use role-gated commands and audited RPCs; analytics never writes operational state.

### Growth and contribution path

```text
Meta APIs ──per-account Airbyte reads──▶ BigQuery raw
                                              │
                                              ▼
                                  dbt staging/classification
                                              │
                                              ▼
                                      mart_ads_daily
                                              │
                                              ▼
                              mart-sync ──▶ Supabase ad_daily_facts
                                              │
                                              ▼
                                       Marketing / Profit

Supabase orders/ad register/NV/brands ──daily Airbyte replication──▶ BigQuery raw

Supabase commerce_daily_facts + cost/return rules ──RPCs──────────▶ Marketing / Profit
```

The checked-in dbt mart currently governs advertising facts; commerce contribution is computed from Supabase’s commerce daily spine and cost/return rules. The dbt GitHub workflow compiles warehouse changes on pull requests and runs the build on its scheduled or manual path. Business windows use Asia/Kuala_Lumpur dates.


### Checked-in automation cadence

| Job | Schedule | Notes |
|---|---|---|
| Woo order sync | Every 15 minutes | Pulls configured stores into `orders_read`. |
| Customer identity read model | Every 15 minutes, seven minutes after Woo | Concurrent refresh with a longer timeout for address normalization. |
| Commerce daily spine | Every 15 minutes, three minutes after Woo | Refreshes recent daily facts used by range contribution queries. |
| Fulfilment gate | Every 5 minutes | Grades pilot orders and respects holds. |
| Customer lifecycle contract | Daily at 01:30 MYT | `private.refresh_customer_lifecycle_daily()`: incremental qualifying-order refresh on `synced_at`, then rebuild of cohorts, state intervals, transitions and base movement under the current policy version (~90 s; first proven run 24 Aug 2026). Full backfills are driven by hand through the v3 step functions, never scheduled. |
| OpenRouter address suggestions | Every 15 minutes, five minutes after Woo | Quiet when unconfigured; capped and suggest-only. |
| Ninja Van shadow submit/compare | Every 15 minutes, ten minutes after Woo | Quiet when no store is enabled; shadow makes no external request. |
| Woo product mirror | Hourly at minute 40 | Keeps store product/variant evidence current. |
| Meta Airbyte fleet | Staggered nightly waves, 19:00–21:30 UTC | Late-wave deltas intentionally land in the next morning’s dbt/mart cycle. |
| Supabase → BigQuery replication | Daily at 20:00 UTC | Replicates selected read models and reference tables. |
| dbt | Daily at 20:30 UTC | GitHub OIDC/WIF; scheduled/manual runs execute `dbt build`. |
| BigQuery mart → Supabase | Daily at 22:00 UTC | Publishes the governed ads mart for application reads. |

These are repository-declared schedules, not proof that every runtime job is currently enabled or healthy.

## Implemented milestones reflected in code

- Woo store and product mirrors, catalog mappings, cost coverage, and unit economics.
- Fighter history import with source tagging and hot-path read models for the grown order corpus.
- Customer identity resolution by phone → address → email, plus shared-address clustering and reseller signals.
- Customer CSV export that preserves active filters, joins delivery addresses server-side, and avoids silent truncation.
- Meta ingestion through Airbyte/BigQuery/dbt, with staggered schedules and a Supabase mart mirror.
- Full variable-cost contribution model: pack-expanded COGS, zone delivery, courier return legs, COD fees, ad spend, and effective-dated Meta WHT.
- Commerce daily spine and range RPCs for fast long-window Profit and Marketing queries.
- Production slice 0: manual audited stage ledger, materials, inbound shipments, computed backlog, and coverage warnings.
- Fulfilment stage model, AI address-assist review, Ninja Van shadow submission, and durable return-to-sender facts.
- Anti-flash skeletons, refetch states, and error handling that avoid presenting fake zeros while live data loads.

## Deliberate safety boundaries and known gaps

- **Courier write gate:** ADR-0006 requires at least 99% shadow-payload agreement with zero material field differences for two consecutive weeks before live Ninja Van submission. The live path also requires a scoped pilot and a rollback to shadow.
- **Warehouse authority:** Fighter still owns pick/pack/handover today. Fullkit observes the floor and prepares the controlled pilot; it is not yet the physical-stock authority.
- **Contribution scope:** CM3 excludes payroll, rent, tools, payment-gateway fees, marketplace commissions, launching email/SMS costs, governed FX, and the SG courier-return feed.
- **Channel coverage:** current growth ingestion is Meta-led. Google/TikTok and WhatsApp business activation are not equivalent to the implemented UI placeholders.
- **Data exports:** customer exports contain personal data and are capped; they are not an unrestricted warehouse dump.
- **Corrections:** accepted shipping corrections are Fullkit overlays used for re-grading and staged payloads; Woo write-back and label propagation are planned.
- **Customer service:** conversation and consent sources, live assignments/work items, and live notifications are not connected.
- **Demo controls:** the UI operating-mode switch remains a prototype control on seeded surfaces and does not grant external-write authority.
- **Administration:** Audit and Settings are navigation placeholders; immutable audit browsing, membership administration, feature flags, and governed mode promotion are not implemented.

## Verification and CI coverage

- Vercel supplies the frontend build/deployment check for commits and pull requests; the docs PR preview passed before this audit amendment.
- Root scripts expose `pnpm lint` and `pnpm build`; the web package also exposes `pnpm check:seed` for deterministic fixture invariants.
- The only checked-in GitHub Actions workflow is dbt-specific. Pull requests touching `warehouse/**` run `dbt compile`; scheduled/manual runs execute `dbt build`.
- The repository contains two custom dbt SQL tests plus schema tests in `warehouse/models/marts/marts.yml`. `scripts/e2e/mint_session.py` prepares an authenticated browser session but is not an end-to-end test suite.
- There is no checked-in frontend unit, integration, or browser test suite and no GitHub Actions job that runs frontend lint/tests. Vercel build success therefore verifies compilation/deployment, not behavioral coverage.
- There are no generated Supabase types: every RPC/row contract is a hand-maintained interface in `apps/web/src/lib/supabase/live.ts`, and there is no `supabase/config.toml`. Migrations are applied through the Supabase MCP and filed under their recorded version (see `supabase/migrations/README.md`).
- `supabase/tests/customer_lifecycle_contract.sql` holds plain-SQL invariant tests for the lifecycle contract (reconciliation identity, disjoint state intervals, valid transitions, scope sums, accepted ≥ delivered). They run against the project after a refresh; there is no automated database test job yet.

## Source-of-truth order

Use this order when documents disagree:

1. Observed production behavior and runtime health evidence, when available.
2. Checked-in migrations and edge-function behavior under `supabase/`.
3. Live application reads/writes in `apps/web/src/lib/supabase/live.ts` and their route consumers.
4. Accepted ADRs in `docs/decisions/`.
5. This current-state document.
6. The PRD, product notes, technical architecture, schema blueprint, and UI plan, which describe target scope or historical intent.

Update this page whenever a surface changes status, an external-write gate changes, or a data authority moves. Record durable architecture/authority decisions in an ADR as well.
