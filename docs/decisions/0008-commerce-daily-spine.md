# ADR-0008 — Commerce daily spine & the Profit page

**Date:** 2026-08-17 · **Status: accepted (live)**

## Context

`orders_read` reached 280k rows with the fighter history import. Every
range P&L (`live_contribution_range`, used by Marketing and now Profit)
re-scanned orders per call: a 30-day window cost ~6s and a 1-year window
timed out under `authenticated`'s 8s statement_timeout — silently, because
Marketing caught the error and rendered "—". Two causes, measured in prod:

1. `raw->>'payment_method'` (COD flag) detoasts the whole Woo order blob —
   916MB of TOAST behind a 256MB shared_buffers instance, ~5 pages/order.
2. Even on the heap alone, a year is ~118k random reads on this compute
   tier: ~20–26s. No index fixes I/O volume.

## Decision

- **`orders_read.payment_method`** — trigger-maintained denormalised
  column (`orders_read_denorm_trg`), backfilled in 20k-id batches.
  Anything that needs "is COD" reads the column, never `raw`.
- **`private.commerce_daily`** — one row per MYT day × store × brand ×
  currency: orders, COD orders, east-zone orders, revenue, pack-expanded
  units, unmapped line qty, `refreshed_at`. Market is joined from
  `integration_connections` at read time (a config change re-labels
  history); zone is fixed at refresh time (postcode).
- **Refresh:** `private.refresh_commerce_daily(from,to)` recomputes an
  inclusive day range; `refresh_commerce_daily_recent()` recomputes every
  day touched by orders synced in the last 30 min plus today/yesterday.
  Cron `commerce-daily-refresh` every 15 min (`:03,:18,:33,:48`). Late
  status changes on old orders re-aggregate their day only.
- **`live_contribution_range` v3** sums the spine (SECURITY DEFINER with the
  workspace gate, since it reads `private.*`; 30s ceiling). Same JSON shape
  plus `refreshed_at`. Cost rules, RTS parcels and every formula are
  unchanged, so Marketing's CM cards, Customer 360's contribution card and
  Profit read the same numbers.
- **Profit page** (`/profit`, was the demo "Prophit" route) — contribution
  P&L over the global date range and brand/market scope: seven cards
  (revenue → COGS → fulfilment → CM2 → ads+WHT → CM3 → ads share of CM2),
  a revenue→CM3 bridge, revenue/CM2/CM3 by day/week/month (≤14 bucket
  calls), a brand × market table, and an explicit "not yet modelled" list.
  CM lines keep the ≥90% SKU-coverage gate.

Measured after: 1-year contribution 25.8s → 0.13s; the Profit page loads
1y in ~4s including the ad warehouse call and 12 monthly buckets.
Reconciled: spine orders/revenue == recognized orders in `orders_read`.

## Consequences

- Freshness for range P&L is now ≤15 min (badge on the page: "Orders as
  of …"). Today's live counts elsewhere (scorecard `live_scorecard`,
  `live_unit_economics`) still read `orders_read` directly.
- `live_commerce_range` (scorecard extended windows, variant-cost COGS)
  still scans orders; move it to the spine if it starts to time out.
- Not yet modelled, needed to get from CM3 to net profit: fixed costs /
  opex (needs a monthly input table + form), payment-gateway fees and
  marketplace commissions (settlement files or fee rules), email/SMS
  spend, SG returns (no courier feed), a governed FX table (SGD ×3.3 is a
  display constant), and a Finance UI for `save_contribution_rules`.
- After any future bulk import: `vacuum (analyze) public.orders_read`,
  then `select private.refresh_commerce_daily(<from>, <to>)` in monthly
  chunks — the cron only sees `synced_at` within its lookback.
