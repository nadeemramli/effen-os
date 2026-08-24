---
title: Operational workspaces, Customer Base and Profit — program plan
description: Code-backed current-versus-target matrix, phased execution map, definitions and open owner decisions for maturing the Orders, Customers, Fulfilment and Profit workspaces behind the shipped secondary-sidebar shell.
created: 2026-08-25
updated: 2026-08-25
status: living
baseline_commit: 20fc8702bdf483168346adb9b353ae853802a4e7
tags: [fullkit, plans, orders, customers, customer-base, lifecycle, profit, ltv, ncac, fop, qc]
---

# Operational workspaces, Customer Base and Profit — program plan

This is the repository's single translation of the 25 Aug 2026 Obsidian plans (see the [[obsidian-source-manifest|source manifest]] for hashes). It records what the code does today, what the sources require, the gap, the gate, the phase and the acceptance test — and it is updated at the end of every slice. `docs/CURRENT_STATE.md` remains the only release-status document; nothing here is live because it is written here.

Program phase numbers are written **Phase 0–8**. `P1–P6` and `S1–S4` always mean the product and spine documents.

## 1. Baseline (commit `20fc870`)

| Area | Code-backed state now | Evidence |
|---|---|---|
| Navigation shell | Section rail + secondary sidebar for Orders (12 children), Customers (4), Fulfilment (11) and Settings; hydration-safe pin; live badges for open Orders queues via `live_order_queue_counts` v2 | `apps/web/src/lib/nav/routes.ts`, `hooks/use-sidebar-state.ts`, migrations `20260824170557/170953` |
| Orders list | Paginated Woo mirror `orders_read`; views are `source_status` / `placed_at` slices; state pills are *derived* from the single Woo status | `lib/domain/order-views.ts`, `(shell)/orders/page.tsx` |
| Order QC | **None.** No `qc_state`, reason codes, owner or work SLA on any order row. Nearest machinery: `order_fulfilment.stage` + free-text `hold_reason`, and unused Slice-1 `work_items` / `approvals` / `audit_events` | `20260808110713_fulfilment_pipeline.sql`, `20260723160501_slice1_foundation.sql` |
| Manual / bulk order | `orders/new` is demo-only (`useRepo`, seed clock); `orders/import*` are `NextModulePage` placeholders | `(shell)/orders/new/page.tsx` |
| Customer list / 360 | Live `private.customers_read` MV (15-min refresh) + `live_customers` whitelisted condition engine; saved segments; capped CSV export | ADR-0005, ADR-0007, `20260731123355`, `20260804112436`, `20260808104454` |
| Lifecycle / tier / repeat | **Ephemeral `CASE` expressions, not columns**: `activity` = `new ≤30d & 1 order`, `active ≤30d`, `at_risk ≤90d`, else `dormant`; `tier` = revenue `≥900 vip / ≥600 high / ≥230 mid`; `repeat` = `≥5 loyal / ≥2 repeat`. Duplicated in 3 migrations and 2 client files; no policy version, no history, no reactivation/lapse transitions; client uses browser clock | `20260808104454:296-307`, `customers/page.tsx:129-135,290`, `customers/[id]/page.tsx:42-54` |
| VIP / At risk / Shared address | `?segment=` query views over `live_customers` (`tier=vip`, `activity=at_risk`, `shared_address_count≥2`); no summary, movement, reason, owner or outcome | `lib/domain/customer-starters.ts` |
| Acquisition cohorts / spend → customer | **None.** `first_order_at`/`last_order_at` exist on the MV; accepted vs delivered is not distinguishable (delivery lives in `nv_shipments.order_ref ↔ order_number`). Ad spend stops at `ad_daily_facts`; nothing joins spend to customers | `20260806015240_mart_sync_schema.sql` |
| Profit | Live contribution P&L on the commerce daily spine: revenue → CM2 (COGS, delivery, returns, COD) → CM3 (ads, dated WHT), ≥90 % SKU-mapping gate; no secondary destinations | ADR-0008, `(shell)/profit/page.tsx`, `live_contribution_range` |
| LTV | One lifetime, un-horizoned client-side sum on the customer detail page, flagged `(est.)` when unmapped lines exist | `customers/[id]/page.tsx:62` |
| FX / cost versions | No FX table (client constant `FX_TO_MYR`); effective-dated `contribution_cost_rules`, variant costs and WHT rules only | `lib/domain/metrics.ts`, `20260817104948` |
| Fulfilment | Live overview / ship-readiness / exceptions / returns over one shared snapshot; courier/check tools are placeholders; NV writes shadow-only | ADR-0006, `(shell)/fulfilment/(floor)` |
| Warehouse / dbt | Meta ads only (`mart_ads_daily` → `mart-sync` → `ad_daily_facts`); 2 custom tests + schema tests; no customer marts | `warehouse/models` |
| Tooling | No frontend tests, no frontend CI job, no generated Supabase types (hand-written interfaces in `live.ts`), no `supabase/config.toml`; `dbt compile` on PR is the only CI | `.github/workflows/dbt.yml` |
| Business date | `Asia/Kuala_Lumpur` in every SQL day bucket; **client "days since" uses the browser clock** | `refresh_commerce_daily`, `customers/page.tsx:122` |

## 2. Requirement matrix

Legend — Evidence: what exists now. Gate: what must be true before the slice can be called live. Phase: program phase.

| # | Requirement | Source | Evidence now | Gap | Gate | Phase | Acceptance test |
|---|---|---|---|---|---|---|---|
| R1 | Keep the shipped shell; extend `routes.ts` children only | OW §1.1, FE §15 | Shell live | — | — | all | No second nav system; every new destination is a `ChildRouteDef` |
| R2 | A permanent destination is a work surface or governed drill-down, not a decorated filter | OW §1.4, FE §15 | Customers/Orders children are filters | Definition, reason, primary action, exit rule, receipt per surface | — | 2–5 | Each destination renders definition + count-or-unavailable + reason column |
| R3 | Versioned lifecycle policy (scope, qualifying event, exclusions, percentile/fallback, lookback, min sample, threshold days, valid_from, approver) | OW §6.2, Blueprint lifecycle contract | Hard-coded 30/90 d | Policy table + version | Owner decision D2 | 1 | Policy row exists; every snapshot cites `policy_version` |
| R4 | Daily lifecycle snapshot `active / at_risk / lapsed` per customer × date × policy | OW §5.2, S1, Blueprint | MV `activity` CASE only | Snapshot fact | R3 | 1 | Row per customer-day; no state derived from `now()` at read time |
| R5 | Transition fact `new / reactivated / at_risk / lapsed` with prior/new state and triggering order | Blueprint, P1 marts | None | Transition fact | R4 | 1 | No impossible transition (test); `reactivated` only from `lapsed` |
| R6 | Reconciled movement period: opening, new, reactivated, lapsed, retained, closing, net change, rate, corrections line | OW §6.3 | None | Period fact + RPC | R5 | 1 | `closing = opening + new + reactivated − lapsed ± corrections` (SQL test); rate `not applicable` when opening = 0 |
| R7 | Qualifying-order rule v1: delivered qualifying order for lifecycle; separate `first_accepted_order_at`; exclude test, duplicate, rejected/cancelled, fully refunded | OW §6.1 | `source_status` only; delivery via NV link | Versioned rule; accepted + delivered anchors | Owner decision D1 | 1 | Both anchors populated; exclusion counts published in reconciliation |
| R8 | Acquisition cohort: first accepted + first delivered order, brand/market/channel/first product, maturity | Blueprint, P6 §7 | None | Cohort fact | R7 | 1 | One row per customer; delivered ≥ accepted date or null |
| R9 | Spend allocation: allocated + unallocated acquisition spend per attribution/allocation version | Blueprint, P6 §7, S4 | `ad_daily_facts` only | Allocation fact | Owner decisions D3, D4 | 1 (contract) / 5 (UI) | Allocated + unallocated = source spend (test) |
| R10 | Customer economics by observed horizon (0/30/60/90/180/365): contribution LTV, repeat, payback | OW §7.2, P6 §5.7 | Lifetime LTV on detail page | Horizon fact + brand/period summary | R8, cost coverage | 1 (contract) / 5 (UI) | Horizon rows never exceed observed maturity |
| R11 | Serving RPC/views return scope, `computed_at`, policy/metric version, coverage | OW §8.3 | `live_order_queue_counts` returns `computed_at` | Standard envelope | — | 1 | Every new RPC response carries the envelope |
| R12 | Security: explicit grants + RLS as separate controls; `security_invoker` views; no service-role in browser; drill-through needs `customers.view` + scope | OW §8.3, Supabase docs | RPC pattern exists | Apply to new objects | — | 1 | Tested under `authenticated` role with a real membership |
| R13 | Customer Base page under Customers: cards, diverging movement chart, active-base trend, controls, definitions panel, drill-through, honest states | OW §6.4, FE §15 | None | Route + page | R6, R11 | 2 | Chart totals equal RPC; drill-through count equals card |
| R14 | No lifecycle categories from `Date.now()` in the browser | OW §10 Phase 0 | `lifecycleOf()` in two files | Route reads through governed contract; remove after parity | R4 | 2 | Parity test between MV `activity` and snapshot for the same day before removal |
| R15 | VIP / At risk / Shared address workspaces: rule version, why-included, count + entries/exits, composition, masked table, owner/work item, consent/suppression/frequency visibility, outcome/holdout | OW §5.3, P1 | Query filters | Summary RPCs + panels | R4; P1 dispatch gate for actions | 3 | Shared address never merges or activates; actions preview-only until Strive authority |
| R16 | Keep axes separate: profile state, lifecycle snapshot, period transition, value tier, repeat, behavioural classification, risk signal, activation eligibility | OW §5.2, S1 | Mixed in one filter list | Separate columns/dimensions | — | 1–3 | No column stores two axes; `reactivated` never a standing tag |
| R17 | Orders QC state: `qc_state ∈ new, in_review, needs_customer_info, on_hold, approved, rejected, cancelled`; reason codes; owner; due/SLA; last contact; reservation result; release result — never overwriting source states | OI §3–4, OW §4.3 | None | Workflow table + audited RPCs | Owner decision on transitions is documented (OI §3.1) | 4 | Approval never sets `in_transit`; every action writes `audit_events` with before/after |
| R18 | New/QC review panel: twelve checks, five actions with side effects; "request information" creates a shadow dispatch job only | OI §3.2–3.3, OW §4.2 | None | Panel + checks from existing readiness/identity data | Strive transport unverified | 4 | Request-information produces an audited job; nothing is sent |
| R19 | Draft / New manual order as server-side draft (no stock, no courier, idempotent, confirm into the same QC queue) | OI §2.2, FE §15 | Demo page | Server draft | ADR-0006-style write gate for confirm | 4 | Draft persists; confirm requires `orders.create` and writes `order_state_events` |
| R20 | Profit destinations: Contribution overview (keep), Customer economics, Acquisition efficiency, Cohorts & payback, Definitions & coverage | OW §7.5, FE §15 | Single page | Children + pages | R9, R10 | 5 | Ratio shown only when cohort/scope/currency/horizon/version match; else unavailable-with-reason |
| R21 | nCAC = currency per new customer (blended, paid; accepted and delivered denominators); LTV:nCAC = ratio; FOP = first-order contribution before acquisition − matched acquisition cost, fixed costs excluded; payback = earliest non-negative cumulative day, else `not reached` | OW §7.2–7.4, P6 §5.7, Blueprint | None | Governed SQL | D3–D7 | 5 | Numerator/denominator tooltips; platform CPA labelled "provider attribution" |
| R22 | Coverage suppression: identity, product cost, spend allocation, currency, order-state coverage below threshold suppresses/qualifies | P6 §5.7.7, S4 | ≥90 % SKU gate on CM3 | Extend to customer economics | — | 5 | Below-threshold cell renders reason, never a number |
| R23 | Fulfilment continuation: six independent state machines, NV push / AWB available / downloaded / printed / handover / pickup as separate events; `in_transit` only from carrier pickup | OI §4, P4 §5.5A | Shadow NV submission; NV webhook states | Explicit state columns + AWB Manager shadow | ADR-0006 exit gate; NV waybill scope | 6 | AWB print cannot set `in_transit` (test) |
| R24 | CRM: Fullkit owns decision/consent/idempotency/outcome; Strive is transport; three model-specific editors; no canvas; no send until templates/consent/authority verified | OI §5, P1 | WA receiver only | Dispatch request records, eligibility decisions | Strive endpoint/webhook facts pending | 6 | Dispatch job unique by customer × purpose × trigger × channel × template version |
| R25 | Production/inventory: two output paths; versioned pack configuration (`presentation_type`, `contained_units_per_pack`, `nominal_days_supply`, …); loose sachets are WIP; WhatsApp is evidence, approval changes stock; marketplace registry with cutover mode; reserve at accepted order, deduct at handover; `channel_publishable_qty` formula | PI §2–6, P5, S3 | Production slice 0; no pack config table; no marketplace connector (ADR-0009) | Contracts + shadow connectors | Marketplace credentials; WhatsApp feasibility; owner decisions on reservation policy | 7 | No stock movement from inference; unmapped listing cannot reserve |
| R26 | Never fake zeroes; loading → skeleton, unavailable → reason | OW §3, CURRENT_STATE rule | `InlineCount` pattern | Apply everywhere | — | all | Reviewed per page |
| R27 | Business-date semantics `Asia/Kuala_Lumpur` in SQL; client never buckets days | Baseline | SQL yes; client no | Move client "days since" to server | — | 2 | No `Date.now()` day arithmetic on lifecycle surfaces |
| R28 | Docs: `CURRENT_STATE.md` code-backed, updated per phase; old one-shot prompt historical; counts correct | Prompt §Doc sync | Counts stale (ADRs, migrations, automations) | Fix in Phase 0 | — | 0 | Census matches `ls`/registry |

Sources: OW = Operational Workspaces plan; OI = Order Intake plan; PI = Production/Inventory plan; FE = Frontend plan §15; Blueprint = Schema Blueprint lifecycle contract; P1/P4/P6, S1/S3/S4 = product/spine documents.

## 3. Dependency graph

```text
S1 orders_read (Woo mirror) ──┐
nv_shipments / nv_events ─────┤ qualifying-order rule v1 (R7)
order_corrections ────────────┘        │
                                        ▼
identity_key / customers_read ──▶ acquisition cohort (R8) ──▶ lifecycle snapshot (R4) ──▶ transitions (R5) ──▶ movement period (R6) ──▶ Customer Base (R13)
                                        │                                                                                   └──▶ cohort workspaces (R15)
ad_daily_facts (Meta via dbt) ──▶ spend allocation (R9) ──┐
contribution_cost_rules / variant costs / WHT ──▶ order contribution ──┴──▶ customer economics by horizon (R10) ──▶ Profit destinations (R20–R22)

order_fulfilment.stage + gate_issues ──▶ qc_state workflow (R17) ──▶ New/QC panel (R18) ──▶ manual draft (R19) ──▶ AWB Manager shadow (R23) ──▶ CRM dispatch (R24)
production slice 0 ──▶ pack configuration + item types ──▶ marketplace registry/read-only ──▶ reservation semantics (R25)

External gates: Strive transport facts (R18, R24) · Ninja Van waybill scope + ADR-0006 exit (R23) · marketplace partner approval / ADR-0009 (R25) · WhatsApp group feasibility (R25) · owner decisions D1–D8 (R3, R7, R9, R21)
```

## 4. Definitions selected for version 1

These are the values the implementation will encode. Where a source leaves a value open, the choice is marked **provisional** and appears in §7 for owner confirmation.

| Term | Version-1 definition | Source / status |
|---|---|---|
| Qualifying order (lifecycle) | An order whose carrier evidence shows delivery (`nv_shipments`/`nv_events` delivered, or Woo `completed` when no parcel link exists), excluding `is_test`/suspect, duplicates by `(integration_id, source_order_id)`, `cancelled`, `refunded`, `failed`, `checkout-draft` | OW §6.1; **provisional** (D1) — Woo `completed` fallback is needed because ~86 % of the corpus predates NV linkage |
| Accepted order (acquisition) | Woo `processing` or `completed` (paid/COD accepted) at `placed_at`; `first_accepted_order_at` retained separately | OW §6.1; **provisional** (D1) |
| Lifecycle states | `active` (last qualifying purchase within threshold), `at_risk` (past the at-risk boundary, before lapse), `lapsed` (past threshold), `provisional` (no qualifying purchase yet) | OW §5.2, S1 |
| Lapse threshold v1 | Fallback **60 days** labelled `provisional policy`; at-risk boundary = 2/3 of threshold (40 days); derived p80 repurchase-delay threshold published only when brand cohort ≥ 200 second purchases and stable for 2 consecutive computations | OW §6.2; **provisional** (D2) |
| Period movements | `new` first qualifying purchase in period; `reactivated` `lapsed → active` by a qualifying purchase in period; `lapsed` crossed threshold in period without later reactivation before period end; `retained` = opening customers still `active`/`at_risk` at close and not lapsed; `closing = opening + new + reactivated − lapsed ± corrections`; rate = net change ÷ opening, `not applicable` when opening = 0 | OW §6.3 |
| Business date | `Asia/Kuala_Lumpur` calendar day; period boundaries at 00:00 MYT; snapshots computed daily after the customer read-model refresh | Baseline |
| Blended nCAC | Eligible acquisition spend ÷ new customers in scope (accepted and delivered denominators both published) | P6 §5.7.2; spend inclusion **provisional** = Meta spend in `ad_daily_facts` after WHT (D3) |
| Paid nCAC | Paid-media spend ÷ paid-attributed new customers; attribution method **provisional** = platform purchase attribution share by brand/market/day (D4) |
| Contribution LTV | Cohort cumulative net revenue − COGS − fulfilment (delivery, return legs, COD) − payment/marketplace fees where known, at horizon; same cost set as CM2 plus fees; currency per brand/market with **no FX conversion in v1** (single-currency scopes only) | Blueprint vs S4 conflict resolved toward the S4 set; FX **provisional** (D7) |
| First-order contribution / FOP | First-order net revenue − COGS − fulfilment − payment/marketplace fees − expected return cost under metric policy = contribution before acquisition; − matched acquisition cost = FOP; fixed costs excluded | OW §7.3; return-cost policy **provisional** (D5) |
| Payback | Earliest observed cohort day where cumulative contribution after acquisition ≥ 0; `not reached` when horizon ends first | OW §7.2 |
| Horizons | 0, 30, 60, 90, 180, 365 days observed; only horizons ≤ cohort age are published | OW §7.4 (D6) |
| `qc_state` | `new, in_review, needs_customer_info, on_hold, approved, rejected, cancelled`; transitions per OI §3.1; approval never implies reservation success, courier, AWB, handover, pickup or delivery | OI §3–4 |
| Reason codes v1 | `recipient_identity, phone_invalid, email_missing, address_incomplete, postcode_state_mismatch, product_unmapped, quantity_bundle, stock_shortage, payment_cod_unresolved, duplicate_risk, courier_unserviceable, consent_contact` (one per QC checklist row) | OI §3.2 |

## 5. Phased execution map

Each phase ends with checks, one focused commit and an update to this file. Later phases are outlined at the level needed to keep contracts compatible; their file lists are firmed up when reached.

### Phase 0 — Audit, doc sync, execution map (this commit)
- `docs/plans/obsidian-source-manifest.md`, this plan, three link stubs; 11 repository copies synced with the 25 Aug vault addenda; `CURRENT_STATE.md` counts corrected; docs index updated.
- No product code.

### Phase 1 — Governed customer lifecycle contract (Supabase, additive) — shipped 25 Aug 2026
Files: `supabase/migrations/20260824190819_customer_lifecycle_contract.sql` (tables, policy v1, both RPCs, refresh v1), `…191711_…_v2.sql` (event-bucketed movement), `…203646_…_v3.sql` (chunked step functions + procedure), `…204429_…_v4.sql` (same-instant orders = one purchase event), `…204829_…_v5.sql` (closed statuses win over parcel evidence), `…_v6.sql` (daily incremental function + 01:30 MYT schedule), `supabase/tests/customer_lifecycle_contract.sql` (18 plain-SQL invariants), `apps/web/src/lib/domain/lifecycle.ts` (vocabulary + response types), `apps/web/src/lib/supabase/live.ts` (`fetchCustomerBaseMovement`, `fetchCustomerTransitionPopulation`).

> [!warning] Incident — 24 Aug 2026, 19:09–20:32 UTC
> The first full backfill under refresh v1 crashed the 1 GB `effen-os` instance (crash recovery, ~90 s down): the movement step cross-joined ~200k base episodes against ~200 periods with four grouping sets. Refresh v2 removed the cross join but still ran every step inside one transaction over the whole corpus; its backfill wedged the instance twice (19:18 and, after a restart, 20:15 — the one-off job re-fired because pg_cron runs a job command as a single transaction, so the in-command `cron.unschedule` rolled back with the failure). Each hang needed a manual restart from the dashboard; the second time the recovery command (terminate the session, unschedule both jobs) landed 2 minutes after the restart. No data was affected — every failed run rolled back. The backfill was then driven by hand through the v3 step functions in separately committed chunks: 282,172 orders in 20–40k batches (~1.2 ms/row for Woo rows, ~0.5 ms for Fighter rows, ~6 min total), cohort 4 s, states 53 s, movement 12 s. Two data findings surfaced and were fixed in v4/v5 (see §4). Lessons recorded in §6.
- `private.customer_lifecycle_policy` — versioned (R3); v1 seeded `provisional`: 60-day fallback, at-risk from day 40, qualifying event `delivered_or_source_completed`.
- `private.customer_qualifying_orders` — one row per `orders_read` row with `identity_key`, `qualifies_acceptance` (Woo `processing`/`completed`), `qualifies_lifecycle` (source `completed` or Ninja Van `Delivered` via `order_read_id`), `exclusion_reason`, `is_suspect` (`private.is_suspect_order`, the same heuristic as `customers_read`). Refreshed incrementally on `synced_at`.
- `private.customer_acquisition_cohort` (R8: first accepted + first delivered order, acquisition brand/store/currency/SKU, cohort months).
- `private.customer_lifecycle_state` — **state intervals** (`active`/`at_risk`/`lapsed`, `valid_from`/`valid_to`) rather than a customer × day table: point-in-time state is derivable for any instant at ~700k rows instead of ~60M (R4 satisfied by construction).
- `private.customer_lifecycle_transition` (R5), `private.customer_base_episode` (enter → exit), `private.customer_base_movement_period` (R6; week and month; scopes workspace / brand / integration / brand × integration by acquisition scope; event-exact so `closing = opening + new + reactivated − lapsed` holds on every row; `retained`, `net_active_change`, `at_risk_closing`, `new_accepted`, `is_complete`).
- Refresh = step functions (`private.lifecycle_upsert_orders(after_id, limit, since)`, `lifecycle_rebuild_cohort()`, `lifecycle_rebuild_states()`, `lifecycle_rebuild_movement(policy, grain)`, `lifecycle_finish(policy, mode, rows)`), a `procedure private.run_customer_lifecycle_refresh(full)` that COMMITs between steps for manual runs, and `private.refresh_customer_lifecycle_daily()` scheduled by pg_cron at 01:30 MYT (`customer-lifecycle-refresh-daily`): incremental on `synced_at` since the last successful log row, then a full rebuild of the derived facts (proven once through pg_cron on 24 Aug: 88 s, 1,354 orders). `private.customer_lifecycle_refresh_log` carries `coverage` and supplies `computed_at`. There is no one-off backfill job any more; backfills are driven by hand through the step functions.
- Data rules learned from the corpus: orders for one identity at the same second are one purchase event (v4); a cancelled / failed / refunded store status never qualifies even when Ninja Van reports the parcel delivered — 43 rejected-COD/refunded parcels — and NV delivery only rescues `processing` orders (v5).
- Serving RPCs (R11, R12): `public.live_customer_base_movement(p_grain, p_from, p_to, p_brand_id, p_integration_ids, p_policy_version)` → `{status, scope, grain, policy, periods[], coverage, computed_at, timezone}` with `net_active_rate = null` / `rate_applicable = false` when opening is zero, and `status: "unavailable"` with a reason before the first refresh; `public.live_customer_transition_population(...)` → masked rows (`display_name` first name + initial, `phone_masked` last 4), keyset cursor, `p_limit ≤ 200`, roles carrying `customers.view` only. Both follow the repository's SECURITY DEFINER + `private.is_workspace_member` / `private.has_role` pattern (ADR-0005) because the facts live in `private`; `search_path = ''`, explicit revoke/grant.
- Deferred to Phase 5 on purpose: `acquisition_spend_allocation` and `customer_economics_horizon` (R9, R10) — not needed by the Customer Base page and blocked on D3–D5.
- Warehouse note: the sources ask for BigQuery/dbt ownership of history. The checked-in dbt project only carries Meta ads and the customer facts live in Supabase, so the governed models are Postgres (`private`, versioned, tested); moving them to dbt is a later, owner-approved step.
- Verified: dry run of DDL + refresh + tests + RPCs inside a rolled-back transaction; applied via MCP; backfilled 282,172 orders by hand in chunks; all 18 invariants green on the full corpus (10,032 movement rows reconcile exactly; the three point-in-time cross-checks match on every month); both RPCs exercised as `authenticated` on live data (July 2026: opening 13,499 + new 4,412 + reactivated 2,050 − lapsed 4,895 = closing 15,066; the "lapsed in July" drill-through total equals the card).

### Phase 2 — Customer Base read-only page
Files: `routes.ts` (child `customers-base` → `/customers/base`, group "Analytics", `isDefault` stays on All customers), `app/(shell)/customers/base/page.tsx` + `_components/`, `hooks/use-customer-base.ts`.
- Cards, diverging movement chart (Recharts), active-base trend, grain/date/brand/market/policy/lens controls, definitions/coverage panel, drill-through drawer (masked), skeleton/empty/denied/stale/low-coverage/error states, table fallback for the chart.
- Customer list/detail read lifecycle from the served snapshot; browser `lifecycleOf()` removed after a parity check on one day's data.

### Phase 3 — Cohort workspaces
`/customers/vip`, `/customers/at-risk`, `/customers/shared-address` real routes (query-view children retired), `public.live_customer_segment_summary(...)`, work-item creation via existing `work_items` (shadow/audited), consent/suppression/frequency columns surfaced read-only; no outbound send.

### Phase 4 — Orders New/QC and Draft
`public.order_qc` (one row per `orders_read.id`: `qc_state`, `reason_codes text[]`, `owner_membership_id`, `due_at`, `last_contact_attempt_at`, `reservation_state`, `fulfilment_release_state`, version), `public.order_qc_events` (append-only), audited RPCs `qc_start_review / qc_request_information / qc_correct_and_revalidate / qc_hold / qc_assign / qc_approve / qc_reject`, "New / QC" replaces the `New (24h)` view, review panel component, `orders/drafts` server-side draft table and confirm command (no external write). Badges keep coming from `live_order_queue_counts` extended with `qc_state`.

### Phase 5 — Profit customer economics
`routes.ts` Profit children (overview default, `customer-economics`, `acquisition-efficiency`, `cohorts-payback`, `definitions-coverage`), `public.live_brand_customer_economics(...)`, pages with matched-ratio guards and coverage suppression, platform CPA comparison labelled.

### Phase 6 — Fulfilment and CRM continuation
Explicit NV submission/AWB state columns on `order_fulfilment`, AWB Manager shadow surface, dispatch-request records, Strive adapter interface with shadow transport; all behind ADR-0006 and template/consent verification.

### Phase 7 — Production, inventory, marketplace
`product_pack_configurations`, `inventory_items` (per S3 migration rule), marketplace integration registry with `cutover_mode`, read-only connectors when credentials exist, WhatsApp observation inbox; no stock movement from inference.

### Phase 8 — Hardening and handoff
Lint/typecheck/build, SQL tests, advisors, RLS role tests, browser verification, generated types workflow decision, `CURRENT_STATE.md` per-surface status, obsolete docs removed only with links preserved.

## 6. Verification standard per slice

`pnpm --filter web exec tsc --noEmit` · `pnpm --filter web lint` · `pnpm --filter web build` · SQL invariant tests executed against the project as `authenticated` with a real membership · Supabase advisors for new objects · browser check of every changed route (desktop, 1024 px) for console errors, keyboard access, no fake zeroes · chart totals reconciled to the RPC and drill-through counts.

Database jobs on this 1 GB instance: never run a whole-corpus rebuild as one transaction — split it into step functions and drive backfills by hand in committed chunks that each finish in well under a minute; keep `jit off`, parallel workers at 0 and `work_mem` bounded inside heavy functions; avoid cross joins against period grids; schedule only small incremental work. Do **not** rely on a cron job to unschedule itself — pg_cron runs the whole command as one transaction, so a failing job re-fires every tick and survives restarts; the recovery is `pg_terminate_backend` of the job session followed by `cron.unschedule`, issued within the first minute after the instance is back. A bounded-sample dry run validates logic, not scale.

## 7. Decisions requiring owner confirmation

Provisional choices in §4 proceed under these labels until confirmed; confirmation or change produces a new policy/metric version, never a silent rewrite.

| # | Decision | Provisional v1 |
|---|---|---|
| D1 | Accepted vs delivered order events | Accepted = Woo `processing`/`completed` at `placed_at`; delivered = carrier delivered evidence, Woo `completed` fallback pre-NV |
| D2 | Lapse policy scope/percentile/sample | Workspace-wide 60-day fallback, p80 per brand when ≥ 200 second purchases |
| D3 | Spend in blended nCAC | Meta spend from `ad_daily_facts` net of dated WHT only |
| D4 | Paid attribution method | Platform purchase share by brand/market/day; labelled non-incremental |
| D5 | Day-0 variable costs in FOP | COGS, delivery, COD fee, return leg expected cost from `live_nv_returns` rate; no marketplace commission yet |
| D6 | First management horizons | 30/60/90 first; 180/365 when cohorts mature |
| D7 | FX source/version | None in v1; single-currency scopes only, cross-market rows marked unavailable |
| D8 | Policy/metric publication owner | HQ admin + finance role, recorded in `audit_events` |
| D9 | VIP / at-risk actions through Strive | None in first release (preview/shadow only) |
| D10 | Saved segments as nav items | Remain inside All customers |

## 8. Slice log

| Date | Slice | Commit | Status |
|---|---|---|---|
| 2026-08-25 | Phase 0 — audit, doc sync, execution map | `6cce535` | Done |
| 2026-08-25 | Phase 1 — governed customer lifecycle contract (migrations v1–v6, backfilled, 18/18 invariants, RPCs verified) | (this commit) | Done — backend only; Customer Base page is Phase 2 |
