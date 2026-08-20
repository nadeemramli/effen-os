# Fullkit documentation map

Start with [Current development state](CURRENT_STATE.md). It is the code-backed release-status companion for the application and distinguishes Live, Hybrid, Shadow, Demo, and Placeholder scope.

## How to read this repository

1. **Current implementation:** `CURRENT_STATE.md`, applied migrations/functions, route consumers, and accepted ADRs.
2. **Durable decisions:** `decisions/` records accepted boundaries, supersessions, and safety gates.
3. **Operating registers:** `ops/` tracks platform rollout, SKU mappings, and advisor mitigations.
4. **Target product design:** PRDs, Products, Spines, Growth Engine, architecture, and schema documents describe intended end-state capability. They are not release trackers.
5. **Evidence and research:** `Reference/` preserves source material and teardown context.

## Current and operational

- [Current development state](CURRENT_STATE.md)
- [Growth data platform plan](ops/growth-data-platform-plan.md)
- [SKU mapping register](ops/sku-mapping-register.md)
- [Supabase advisor register](ops/supabase-advisor-register.md)

## Architecture decisions

| ADR | Status on 19 Aug 2026 |
|---|---|
| [0001 — WhatsApp and conversational AI](decisions/0001-whatsapp-and-conversational-ai.md) | Accepted; official Cloud API, one receiver, agent runtime in Meta |
| [0002 — Slice 3 write pilot plan](decisions/0002-slice3-write-pilot-plan.md) | Draft; its full external-write plan is not active |
| [0003 — Ads ingestion via Airbyte/GCP](decisions/0003-ads-ingestion-airbyte-gcp.md) | Accepted; warehouse path live |
| [0004 — Merchandise COGS spine](decisions/0004-merchandise-cogs-spine.md) | Accepted and live |
| [0005 — Customer segments](decisions/0005-customer-segments.md) | Accepted and live |
| [0006 — Fulfilment shadow and AI address assist](decisions/0006-fulfilment-pipeline-shadow-and-ai-address.md) | Accepted; shadow pilot live, no external courier writes |
| [0007 — Address identity](decisions/0007-address-identity.md) | Accepted and live |
| [0008 — Commerce daily spine](decisions/0008-commerce-daily-spine.md) | Accepted and live |

ADR-0006 activates a narrow shadow phase from ADR-0002; it does not approve ADR-0002’s full write-side cutover.

## Target product and platform documents

- [Fullkit PRD](PRD.md)
- [Product portfolio PRD](<Fullkit Product Portfolio PRD.md>)
- [Technical architecture](<Fullkit Technical Architecture.md>)
- [Schema blueprint](<Fullkit Schema Blueprint.md>)
- [Frontend/UI plan](<Fullkit Frontend UI UX Plan and Fable Prompt.md>)
- [Growth Engine](<Growth Engine.md>)
- [Products](Products/) — Iteratus, P1–P6, and AI Sales Closer
- [Spines](Spines/) — S1 Customer/Order, S2 Creative, S3 Inventory, S4 Money

The product and spine documents preserve full target scope. See the product/spine maturity tables in `CURRENT_STATE.md` before treating any workflow as shipped.

## Maintenance rule

- Update `CURRENT_STATE.md` when a route changes maturity, a connector goes live, an external-write gate changes, or system authority moves.
- Add or amend an ADR when the durable boundary or safety decision changes.
- Update an operating register when rollout evidence or remediation state changes.
- Keep research/reference files historical; do not silently rewrite source evidence to match implementation.
