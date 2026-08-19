---
title: Fullkit current development state
description: Code-backed status of Fullkit surfaces, data paths, write boundaries, and known gaps.
updated: 2026-08-19
status: living
source_commit: 2972255845552a1b45fc365df4d4f9ffd11eec5e
tags: [fullkit, status, implementation, operations]
---

# Fullkit current development state

This is the release-status companion to the product and architecture documents. It describes what exists on `main` at commit `29722558` (18 Aug 2026). When this document conflicts with a proposal, the implementation hierarchy at the end of this page wins.

## Status vocabulary

| Status | Meaning |
|---|---|
| Live | Reads real operational or warehouse data. Any write is guarded by the authenticated workspace role and the relevant RLS/RPC policy. |
| Hybrid | A route combines real data with deterministic prototype content; the boundary must be visible in the UI. |
| Shadow | Fullkit computes and records the intended action but does not call the external write API. |
| Demo | Deterministic seeded state only; actions mutate browser state and do not reach real systems. |
| Placeholder | The route exists to preserve information architecture but its workflow is not implemented. |

## Surface status

| Area | Current status | What is implemented now | Boundary / next step |
|---|---|---|---|
| Command Centre | Hybrid | Live commercial scorecard can replace its scorecard when a real session is present. | Morning briefing, work queue, plan charts, and recommendations still come from the demo store. |
| Orders | Live read side | Paginated Woo order mirror, brand/market/store/status/currency/age filters, detail pages, identity link, evidence context, and 15-minute mirror expectations. | New-order creation and several legacy actions still use the prototype repository; Fighter remains operational authority. |
| Customers | Live | Resolved identities, Customer 360, contribution LTV and risk, address-cluster/reseller signals, saved segments, and filtered CSV export. | Export is intentionally capped at 20,000 rows and carries a personal-data warning. |
| Fulfilment | Live read + shadow write | Live order queues, Ninja Van tracking, ship-readiness checks, corrections, holds/releases, AI address suggestions, shadow payloads, and return-to-sender lane. | Pick/pack/handover stays in Fighter. Live Ninja Van consignment creation is off until the ADR-0006 exit gate passes. |
| Automations | Live registry | One registry documents cron, webhook, SQL, Airbyte, dbt, mart-sync, identity, cost, and fulfilment automations with available health evidence. | WhatsApp inbound is deployed but awaits the Meta app connection; several finance/activation automations remain planned. |
| Marketing | Live with demo fallback | Meta account coverage, campaign facts, spend, Fullkit revenue/orders, custom date ranges, brand/market/platform scope, CM2, and CM3. | Platform attribution is not incrementality. Google and TikTok appear as unconnected placeholders. |
| Profit | Live read-only | Contribution P&L on the commerce daily spine, period trend, brand × market view, COGS, fulfilment, ads, dated WHT, and coverage gates. | This is contribution, not net profit; fixed costs and several finance feeds remain absent. |
| Catalog and Inventory | Live | Products/variants, Woo product mirror, SKU mapping queue, pack sizes, governed unit costs, unit economics, on-hand/cover/stock signals. | Mapping and coverage warnings remain explicit; stock authority is not yet a full WMS. |
| Production | Live controlled write | Per-product raw material → premix → in-progress → in-stock counters, append-only ledger, computed backlog, material/inbound management, arrival posting, and days of cover. | BOM/MRP, work orders, lots/expiry, locations, reservations, and automated stock deduction are deferred. |
| Finance | Demo | Commission review/release flow and SQL Accounting handoff are represented in seeded state. | Live contribution rules exist in the backend, but the full finance control UI and accounting integrations are not live. |
| Creative and Reports | Demo | Implemented prototype screens and interactions. | Governed live read models are still required. |
| Integrations and Data Health | Mixed prototype | Route surfaces and repository contracts exist; live connection setup is available under Setup. | Most operational views here still use the prototype repository. |
| Audit and Settings | Placeholder | Navigation and intended workflows are documented in-app. | Implement immutable audit browsing, member/role administration, feature flags, and mode promotion. |

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
Meta accounts + Supabase read models
              │
              ▼
          Airbyte Cloud
              │
              ▼
            BigQuery ──dbt build/test──▶ governed ad marts
                                             │
                                             ▼
                                  Supabase mart-sync/read RPCs
                                             │
                                             ▼
                                      Marketing / Profit
```

The dbt GitHub workflow compiles warehouse changes on pull requests and runs the build on its scheduled or manual path. Business windows use Asia/Kuala_Lumpur dates.

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
- **Demo controls:** the UI operating-mode switch remains a prototype control on seeded surfaces and does not grant external-write authority.

## Source-of-truth order

Use this order when documents disagree:

1. Applied migrations and deployed edge-function behavior under `supabase/`.
2. Live application reads/writes in `apps/web/src/lib/supabase/live.ts` and their route consumers.
3. Accepted ADRs in `docs/decisions/`.
4. This current-state document.
5. The PRD, product notes, technical architecture, schema blueprint, and UI plan, which describe target scope or historical intent.

Update this page whenever a surface changes status, an external-write gate changes, or a data authority moves. Record durable architecture/authority decisions in an ADR as well.
