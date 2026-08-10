# ADR-0006 — Fulfilment pipeline: stage model, shadow NV submission, AI address assist

**Date:** 2026-08-08 · **Status: accepted (shadow mode live; no external
writes)**

## Why this ADR exists

ADR-0002 mapped what retiring Fighter needs; this ADR activates its Phase 1
(shadow) for one store and fixes the gap that makes retirement risky today:
the ship gate passes orders on phone + postcode shape while Ninja Van
bounces parcels on *address* quality ("Inaccurate Address" recovery emails,
2-working-day return-to-sender window). Fullkit still writes to nothing
external — shadow mode generates and logs the exact NV payload it *would*
send, then scores it against the consignment Fighter actually created.

## Decisions

**Pilot store: Synovil MY** (`WOO_SYNOVIL_MY`). This supersedes ADR-0002's
Cavernosil MY suggestion — the pilot choice is operational, not
architectural, and ops chose Synovil. Per-store enablement is data, not
code: `integration_connections.config.fulfilment_mode ∈ off | shadow |
live` (absent = off), flipped only by the hq_admin RPC
`set_fulfilment_mode` (audited).

**Stage model.** Pilot-store orders get an operational row in
`order_fulfilment`: `intake → gate_passed | exception → (held) →
shadow_logged → in_transit → delivered`, driven by a 5-minute pg_cron tick
(`fulfilment_gate_tick()`), not by hand. Corrections re-enter the gate on
the next tick.

**Stage 2 is auto-pass with a hold window, not mandatory approval.** Admins
do not review clean orders today; pretending they will invites a rubber
stamp. A clean order becomes submittable only after `eligible_at`
(`config.hold_minutes`, default 20) — a guaranteed intervention window in
which **Hold order** freezes it indefinitely. Held orders are frozen until
released, then re-graded fresh.

**The gate now grades address substance, not just format.** New red rules:
`postcode_state_mismatch` (MY postcode outside the state's published
range), `address_too_short` (no substance). New *yellow* warnings that do
not block but summon the AI: missing street keyword (jalan/taman/lorong…),
missing unit/lot number. Yellow exists because these patterns predict
bounces but false-positive too often to hard-block (the ADR-0005 lesson:
length/repetition rules burned legitimate SG addresses).

**AI address assist is suggest-only, permanently.** An edge function
(`address-suggest`, OpenRouter, model in config) runs after each woo-sync
over flagged orders and stores a proposed fix + confidence + rationale in
`ai_suggestions`. Nothing auto-applies: an admin accepts a suggestion in
the fix-shipping dialog, and acceptance routes through the existing
`save_order_correction` allowlist, so audit, original snapshot, and
re-grading are inherited. This squares with ADR-0002's rejection of
semantic auto-correction — the human stays the writer; the model drafts.

**Shadow submission.** `nv-submit` (cron) builds the full NV order-create
payload for green, unheld, past-window pilot orders, logs it to
`nv_submissions` with an idempotency key (`FK-{integration_id}-{source_order_id}`),
and makes **no HTTP call** in shadow mode. A compare pass matches shadow
payloads to real `nv_shipments` (normalized-phone, then postcode+name
heuristics) and records per-field diffs. `live_shadow_report()` is the
evidence surface.

## Exit gate for going live (unchanged from ADR-0002)

≥99% of shadow payloads matched with zero material field diffs for **two
consecutive weeks**, measured by `live_shadow_report()`. Material = phone,
postcode, address line, COD amount.

## Live-flip runbook (when the gate is met)

1. Fighter scope-down confirmed for Synovil MY (stops creating consignments
   for that brand) — contractual/ops step from ADR-0002's stakeholder table.
2. Verify current NV API paths + credentials against NV docs (endpoints are
   config: `NV_API_BASE`, country path). Shadow mode never validated them.
3. `select set_fulfilment_mode(<synovil_my_connection_id>, 'live');`
4. Watch `nv_submissions.status` (`submitted/accepted/rejected`) and the
   automations page health line; `set_fulfilment_mode(..., 'shadow')` is
   the instant rollback.

## Known limits / risks accepted

- `nv_shipments.raw` is the latest webhook event and may not carry
  recipient phone/address; match fidelity degrades to time/brand/COD
  heuristics until NV grants the order-details API (already on ADR-0002's
  ask list — it also fixes parcel↔order linkage retroactively).
- Customer PII (name, phone, address) leaves the perimeter to OpenRouter
  for flagged orders only; batch/daily caps and per-row cost are recorded
  in `ai_suggestions`; requests send data-collection-off headers.
- Billing vs shipping: Woo orders can carry a distinct shipping block; the
  grader and payload builder prefer `raw->shipping` per field, falling back
  to billing, and `state` joins the correctable-field allowlist.
