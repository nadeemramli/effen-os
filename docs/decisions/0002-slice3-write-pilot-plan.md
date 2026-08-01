# ADR-0002 — Slice 3 write pilot: prerequisites, stakeholders, and phased plan

**Date:** 2026-08-01 · **Status: DRAFT — for stakeholder review. Nothing in
this plan is active.** Fullkit remains read-only against every external
system; the Live pill in the app states exactly that.

## Why this ADR exists

Moving fulfilment operations from Fighter to Fullkit (Slice 3: Fullkit
creates Ninja Van consignments, operates pick/pack, writes tracking back to
the stores) is not a code decision. It touches the NV commercial
relationship, Fighter's contract and daily warehouse routine, COD money
flow, and customer communications. This document maps everything the
decision needs so the stakeholder session can be short and concrete.

## Current operating reality (as wired on 2026-08-01)

- **Woo storefronts (8)** are the order source of truth. Fullkit mirrors
  them read-only via the REST API (15-minute cron; 121k orders, all brands).
- **Fighter** is the operating OMS: it ingests store orders through its own
  WordPress-side integration, runs pick/pack, creates NV consignments
  (references `FIGHTER-nnnnnnn`), and handles day-to-day shipping ops.
- **Ninja Van** events now also stream into Fullkit (webhook read-side, all
  brands). Parcels cannot yet be linked to individual orders because their
  references are Fighter-internal.
- **Fullkit writes to nothing external.** All action buttons are visibly
  disabled pending this ADR.

## No WordPress plugin is required

Fighter's store integration is a plugin because that is Fighter's
architecture. Fullkit is API-first by design:

| Need | Mechanism | Plugin? |
|---|---|---|
| Order reads (live today) | Woo REST API, read-only keys | No |
| Real-time order events (optional upgrade) | **Native Woo webhooks** (Settings → Advanced → Webhooks; HMAC-signed; same receiver pattern as wa-webhook/nv-webhook) | No |
| Order writes, notes, tracking-number write-back (Slice 3) | Woo REST API, write-scoped key (pilot store only) | No |
| NV consignment creation (Slice 3) | NV API (credentials already validated) | No |

Nothing is installed on the storefronts; blast radius stays server-side.
A plugin would only be needed for on-site concerns (checkout modification,
cart-abandonment capture, server-side pixels) — all out of Slice 3 scope.

## Stakeholders and the access each decision needs

| Area | What is needed | Who (to fill in) |
|---|---|---|
| Ninja Van account (MY, and SG if separate) | Approval to create orders via API under the EFFEN shipper account; account-manager request to enable the order-details/lookup API (also unblocks read-side parcel↔order linkage retroactively) | |
| Fighter | Contract/ops owner; confirmation Fighter can be scoped **per brand** (stop creating consignments for the pilot brand only); export path for historical consignment data | |
| Woo stores | wp-admin owner issues ONE write-scoped REST key for the pilot store only | |
| Warehouse floor | The people picking/packing in Fighter's UI today — training window on the Fullkit floor | |
| Finance | COD remittance reconciliation continuity (NV statements); sign-off on pilot timing | |
| CS / notifications | Confirm which system messages customers today (order confirmations, tracking links) and how continuity is kept during the pilot | |

## Phased plan — each phase has an explicit exit gate

**Phase 0 — now (no approvals needed).** Read-side keeps maturing: parcel
capture continues account-wide; daily reconciliation report
(Woo orders ↔ Fighter-refs ↔ NV parcels, counts by brand/day) built inside
Fullkit so drift is measurable before anything changes.

**Phase 1 — Shadow writes (no external effect).** For the pilot brand,
Fullkit *generates* the NV consignment payload for every eligible order —
built, validated, stored, **never sent** — and diffs daily against what
Fighter actually created (weight, address, COD amount, service type).
*Exit gate: ≥99% payload match sustained for 2 weeks.* This proves Fullkit
ships correctly before it ships anything.

**Phase 2 — Assisted pilot (one brand, real writes, human-gated).**
Stakeholder switch: Fighter stops creating consignments for the pilot brand.
Fullkit creates real NV orders **only on explicit per-order approval** in
the Fulfilment floor; tracking number written back to the Woo order; every
action gets an execution receipt and audit event. Rollback is same-day:
re-enable Fighter for the brand. *Exit gate: 2–4 weeks of clean daily
reconciliation and COD continuity confirmed by Finance.*

**Phase 3 — Autonomous with exception gates.** Consignments auto-create on
payment confirmation; approvals remain for exceptions (address issues, COD
over threshold). Expand brand-by-brand, each expansion repeating Phase 2's
gate.

## Prerequisites checklist before Phase 2 can start

- [ ] NV: stakeholder approval for API order creation under the shipper account
- [ ] NV: pickup address / service levels / COD settings confirmed per brand
- [ ] Fighter: per-brand off-switch confirmed and named operator
- [ ] Woo: write-scoped REST key for the pilot store, stored in Vault
- [ ] Fullkit build: approval UI, idempotent NV adapter with retry + receipts, reconciliation view, rollback runbook (built during Phase 1)
- [ ] People: named approver role; warehouse training done; CS notification continuity plan written
- [ ] Finance: pilot start aligned to a COD remittance boundary

## Risk register

| Risk | Mitigation |
|---|---|
| Double consignments (Fighter + Fullkit both create) | Per-brand exclusivity switch is a hard precondition; daily reconciliation catches any overlap same-day |
| COD money-flow disruption | Pilot starts at a remittance boundary; Finance owns the go signal |
| Customer notification gap | Continuity plan required before Phase 2; whichever system messages customers keeps doing so until explicitly migrated |
| Loss of Fighter history | Export Fighter consignment history before any contract change |
| Warehouse disruption | Pilot brand chosen for low volume; Fighter rollback stays warm |

## Suggested pilot brand

**Cavernosil MY** — youngest brand, lowest volume (~4.3k orders total,
brand launched Jun 2026), single market, single storefront. Small enough
that a bad day is recoverable by hand; real enough to prove the loop.

## Agenda for the stakeholder session (the six questions)

1. Which pilot brand? (proposal: Cavernosil MY)
2. Who owns the NV relationship, and do they authorize API order creation?
3. Can Fighter scope down per brand, and who operates that switch?
4. Which system messages customers today, and how is continuity kept?
5. Who reconciles COD, on what cadence, from which statement?
6. Who holds the approval role in Fullkit during the pilot?

When these are answered, this ADR gets accepted with the blanks filled and
Phase 1 starts — which requires **no external access at all**.
