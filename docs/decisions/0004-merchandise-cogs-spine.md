# ADR-0004 — Merchandise: COGS spine (SKU mappings, effective-dated costs)

**Date:** 2026-08-02 · **Status: accepted (live)**

## Context

Contribution, LTV, and commission all need cost-of-goods per order line.
Three facts shape the design:

1. **Stores sell under per-store Woo SKUs** (`lip04`, `adipocyde6`,
   `cave04sg` — 41 distinct all-time), while the canonical catalog
   (`products` / `product_variants`, 8 products / 35 variants across the four
   brands) is what unit economics should key on.
2. **Costs change over time** (production batches, freight). Margin on a
   March order must use March's cost, not today's.
3. **No FX policy exists yet** (Finance decision pending). SGD revenue and
   MYR costs must not be silently converted.

## Decision

- **`variant_aliases`** maps (store, store SKU) → canonical variant.
  Mappings are **human-confirmed in the OS** — never inferred — because a
  wrong mapping corrupts COGS silently. The confirm UI narrows options
  deterministically (store's currency only) and preselects only exact name
  matches. Same three-lane philosophy as the ship-readiness gate.
- **`variant_costs`** holds effective-dated cost rows per variant
  (`unique (variant_id, effective_from)`). An order line's COGS is the cost
  row with the greatest `effective_from` ≤ the order's placed date (MYT).
  Writes go through `save_variant_cost` (HQ admin / finance, audited).
- **Currency-match rule:** COGS pairs with revenue **only in the same
  currency**. SG variants need SGD costs (Finance decides the conversion
  basis); until then SG margin reads "—", never a guessed number.
- **`live_unit_economics()`** exposes, per scorecard window × brand ×
  market × currency: item revenue, units, mapped units, costed units, COGS.
  The Command Centre contribution card renders **only at ≥90% costed-unit
  coverage per currency** and always states its coverage; below that it
  shows "—" with the reason. Contribution here = *item revenue − COGS,
  before fees and shipping* (fee model is a separate Finance input).

## Consequences

- Mapping 41 store SKUs + entering ~35 costs is a one-time human task in
  Catalog → Products; new promo SKUs appear in the same queue as they occur.
- Velocity/sold columns (Inventory, Catalog) count **only mapped** lines,
  and say so — coverage is visible, not assumed.
- LTV (lifetime contribution per customer) and commission math become
  derivable once coverage is real; commission additionally needs its scheme
  defined by Finance (basis, rates, who).
- Physical stock (on-hand / ATP / cover) stays "—" until stocktake capture
  or a Fighter export lands; Production shows an honest empty state until a
  production source exists. Batch-level costing can later write
  `variant_costs` rows from FG receipts without changing this model.

## Amendment 2026-08-02 — the channel plane is now a real mirror

The two-plane model is explicit: **commercial truth** (canonical catalog,
finance/admin-owned, created in Fullkit) vs **channel truth**
(`woo_products_read`, marketer-owned in WordPress, mirrored read-only from
each store's Woo products API hourly by the `woo-products-sync` edge
function — full refresh, deletions tracked, health in `sync_runs` with a
"Products:" prefix). Products are no longer born in Fighter; Fullkit is the
canonical birthplace, marketers publish in Woo, and the mapping queue —
now fed by the published catalogs, not just sold lines — surfaces new
store SKUs before their first sale. Confirmed mappings additionally carry
the store's live published price, so canonical-vs-store **price drift** is
a visible badge/count in Catalog, not a surprise in margin math.

Data corrections landed with the mirror, all derived from observed order
lines: Adipocyde SG variants re-priced in SGD (98 / 147 / 130 — the brand
runs its own ladder, not the siblings' 79/110/130), and 12 promo/limited
variants added (Anniversary 8/9-bottle, Raya Haji/Ramadan promos, free-gift
and tumbler bundles) so every real store SKU has a canonical home. First
mirror run: 41 published products across the 8 stores, exactly matching
the historically-sold SKU set.
