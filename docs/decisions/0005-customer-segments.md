# ADR-0005 — Customer classification & the segment engine

**Date:** 2026-08-04 · **Status: accepted (live)**

## Classification

Two deterministic classes join the identity model, computed in the
`customers_read` read-model on every refresh and exposed everywhere the
customer appears. Live counts at rollout: 76,043 regular · 175 resellers ·
54 joy buyers.

**reseller** — one identity buying for many people or at trade volume:
≥4 distinct recipient names under the identity, OR ≥10 lifetime orders.
(3 distinct names was tested and rejected — spelling variants of one
person's own name trip it.)

**joy_buyer** — the competitor funnel-tester: at least one order with
suspect details AND every order COD AND ≤3 lifetime orders. Suspect
details are **word-based only**: "test/testing/tester" in name or
address, keyboard-mash runs (asdf/qwer/zxcv/sdfg/wert/xcvb), the name
pasted as the address, 4+ repeated letters in the name, disposable email
domains (test@/example/mailinator), or 7+ identical consecutive phone
digits. Address-length and repeated-digit rules were tested and
**rejected**: they false-positive on legitimate SG block addresses
("#01-337", "Blk 55") and real street numbers ("6666 jalan station").

The raw signals (`cod_orders`, `suspect_orders`, `cancelled_orders`,
`distinct_names`, `cod_share`) are columns, not just inputs — segments can
filter on them directly, so the thresholds above are a starting point the
team can second-guess without a migration.

## Segments

A segment is a **named, saved set of filter conditions** over the customer
model — `[{field, op, value}, …]`, AND-combined. The field/op vocabulary
is whitelisted server-side in `live_customers()` (never raw SQL from the
client; unknown fields match nothing). Fields cover the derived states
(lifecycle, repeat, tier, classification) and the raw numbers (orders,
revenue, COD share, suspect signals, recency in days).

Storage is the existing `saved_views` table
(`route_key = 'customers.segment'`, `params.conditions`), which makes
segments **global objects**: user-owned, optionally shared
workspace-wide, readable by any surface — the Customers page today;
dashboards, reports, and exports can consume the same rows without a new
mechanism. Owners can update/delete their own; shared segments are
read-only to others.

The Customers page replaces its five filter dropdowns with: starter
segment chips (VIP, Loyal, At risk, Resellers, Joy buyers, COD-heavy — the
same condition language, built in), the user's saved segments, and an
inline condition builder with "Save as segment". Deep-linkable via
`?segment=`.

## Consequences

- Joy buyers and resellers are now excludable from LTV/marketing math with
  one condition (`classification = regular`) — and findable for ops
  review with one chip.
- Classification thresholds live in one place (the MV definition); tuning
  them is a single migration, and the register of *why* each rule exists
  is this document.
- Segment semantics are computed at read time from current data — a
  customer drifts in and out of segments as behaviour changes; nothing is
  frozen at save time.
- Future: order-level fields (e.g. "bought SKU X"), OR-groups, and segment
  usage in dashboards/exports build on the same stored conditions without
  schema change.
