# ADR-0001 — WhatsApp & conversational AI architecture

**Date:** 2026-07-24 · **Status:** Accepted (supersedes parts of `docs/Products/AI Sales Closer.md` and the P1 Conversation Hub scope)

## Decision

1. **AI sales flows and the AI agent are built in Meta Business Manager**, on
   the WhatsApp Business Platform's native flow/agent tooling — not inside
   Fullkit. Fullkit does not build or host the closer's conversation runtime.
2. **Fullkit's conversational scope is consolidation**: ingest and unify texts
   and DMs across brands through a **WhatsApp API gateway (e.g. OpenWA-style),
   one WhatsApp API per brand**, so every conversation lands in the S1
   Customer & Order Hub — linked to the customer identity, orders, and the
   evidence timeline.
3. **Fullkit remains the governance source** the Meta-side agent is configured
   from: the product catalog's approved/prohibited claims, FAQs, usage,
   warnings, and objection handling (already first-class fields in the
   prototype's catalog) are the content that feeds the agent's knowledge and
   guardrails. The compliance gate lives in the content, wherever the agent runs.

## What this changes in the plans

- `AI Sales Closer.md`: the closer's runtime, escalation flow, and tool
  allow-list move to Meta Business Manager's side; Fullkit keeps chat-order
  intake (the "Paste chat order / AI extraction — review required" path),
  conversation history on Customer 360, and claims governance.
- `P1 Customer Revenue Engine`: the Conversation Hub becomes a read/consolidate
  surface over the per-brand gateways rather than a send-side messaging product.
- Sender policy per brand stays (1 WA API per brand ↔ the brands table's
  sender-policy field).

## Resolved 2026-07-24: official Cloud API, no unofficial gateway

The numbers are registered through Meta Business Manager's WhatsApp setup —
i.e. the **official Cloud API** (Meta-hosted). The earlier OpenWA-style
gateway idea is dropped; no unofficial WhatsApp Web automation and no
number-ban exposure.

Consolidation architecture (Slice 2 candidate, time-sensitive):

- One Meta App subscribed to all brand WABAs → single webhook endpoint
  (Supabase Edge Function, signature-verified) → `wa_conversations` /
  `wa_messages` tables keyed by brand and number.
- Inbound arrives via the `messages` webhook field; delivery/read via
  `statuses`; outbound content sent by the MBM flows/agent via echo fields —
  transcripts in Fullkit show both sides.
- **No history backfill exists in the Cloud API** — capture starts only when
  webhooks connect, so connecting early preserves history.
- Agent/flow monitoring: WABA analytics endpoints (conversation counts,
  template performance) + webhook-derived response/handoff metrics give a
  per-brand agent scoreboard inside Fullkit without rebuilding Meta tooling.

## Note

`docs/` is a copy of the Obsidian vault. This correction should be synced back
to the vault's `AI Sales Closer.md` and `P1` docs when convenient.
