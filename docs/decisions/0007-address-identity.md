# ADR-0007 — Address-based identity resolution & address clustering

**Date:** 2026-08-08 · **Status: accepted (live)**

## Identity priority: phone → address → e-mail

The identity key over `orders_read` becomes, in order:

1. **Canonical phone digits** — `norm_phone()`: strip to digits, then
   canonicalize MY (`^(60)?0?1[0-9]{8,9}$` → `60…`) and SG
   (`^(65)?[89][0-9]{7}$` → `65…`) mobile formats. Market is inferred from
   the digits themselves — the expression must stay IMMUTABLE for the
   `orders_read` expression index, so no config lookup is allowed.
   Unmatched numbers keep the raw digit strip, so no order that had a
   phone identity loses one. No `+` prefix: keys appear in
   `/customers/<key>` URLs, and digit-only keys match the digit-stripped
   E.164 `wa_conversations` join (which previously missed orders stored
   with local `01…` numbers).
2. **Normalized address key** — `'a:' || md5(norm_address(...))` over the
   shipping-first/billing-fallback raw address. Used when the order has no
   phone. This is the durable identity signal for marketplace ingestion
   (TikTok Shop / Shopee mask phone and e-mail with virtual identifiers).
3. **Lowercased e-mail** — unchanged fallback.

At rollout the switch merged ~8,200 fragmented identities (77,116 →
68,910), almost all local-vs-country-prefixed phone formats.

`norm_address()` lowercases, maps punctuation to spaces, canonicalizes
MY/SG abbreviations at word boundaries (jln→jalan, tmn→taman, lrg→lorong,
kg/kpg→kampung, blk/block→blok, psn→persiaran, apt→apartment,
kondo→kondominium, "no 12"→"12"), collapses whitespace, and appends
postcode digits. **Digits are never dropped** — unit numbers survive,
which is what keeps condo/office blocks from over-clustering. Quality
gate (same rule as ship-readiness): normalized street must be ≥10 chars
and contain a digit, else the address contributes nothing to identity or
clustering.

**Corrections do not re-key identity.** `identity_key(customer, raw)`
reads only `orders_read` columns so it can back the expression index and
so MV identity always equals the indexed expression. An
`order_corrections` fix therefore can't move an order between
identities — accepted; corrections *do* feed the cluster address key
below, which is computed at MV time.

## Address clustering — linking, never merging

Per identity, `address_key` = the normalized key of the **latest order's
gate-passing address** (correction-overlaid, matching the address the UI
shows). Identities sharing an `address_key` form a cluster;
`shared_address_count` is the cluster size (NULL when the identity has no
valid address — the CASE guard stops address-less identities forming one
giant fake cluster).

This is deliberately a **linking layer, not a merge**: a reseller rotates
phone numbers and e-mails but ships to one address, so their identities
converge in a cluster — while a household at one address stays two
customers. Merging on address was rejected (spouses, offices, condo
neighbours omitting unit numbers would collapse into one customer, and
one address typo would split a real customer in two).

**Classification:** the reseller branch gains
`shared_address_count >= 3`. N=2 is overwhelmingly a household; 3+
distinct identities at one normalized address is a stock-drop signal.
The raw count is a filterable column (and a "Shared address" starter
segment, `>= 2`), so the threshold can be second-guessed without a
migration.

**Surfaces:** customer detail gets a "Same address" card listing sibling
profiles (via `live_customer_detail.address_siblings`, capped at 20) and
an `×N at address` header badge; the customers list shows an `×N addr`
chip, a `shared_address_count` filter field, and a CSV column. The
order page's Customer 360 link now asks the server for the key
(`order_identity_key(order_id)`) — the resolution expression lives in
exactly one place, `public.identity_key()`.

**CSV export (2026-08-17):** the customers page exports through
`live_customers_export` — customer row + latest delivery address in one
RPC row, ≤1000 rows/page (PostgREST `max_rows`), ordered
`last_order_at desc, identity_key`, with a function-level 30s
`statement_timeout`. Addresses come from `private.latest_address(key)`
(one probe on `orders_read_identity_expr_idx`), shared with
`live_customer_addresses`. The earlier client-side pattern — page
`live_customers`, then hydrate 5,000 keys per `live_customer_addresses`
call — timed out cold (57014 under `authenticated`'s 8s) and, when warm,
was silently truncated to 1,000 address rows. Measured after: 7.2k
filtered rows or the 20k cap in ~10s (4 pages in flight). Remaining cost
is cold heap I/O per identity on `orders_read`; if exports grow, add a
`(identity_key(customer, raw), placed_at desc)` index or carry the latest
address on `private.customers_read` (then export is a pure MV read, at the
price of ≤15-min-stale corrections).

## Consequences

- Old `/customers/<key>` bookmarks break where keys changed (detail RPC
  returns null → the existing not-found state). Accepted.
- Address typo fragmentation remains: two spellings of one address are
  two clusters. The abbreviation canonicalization narrows this; nothing
  more is attempted.
- A 3-adult household can read as a reseller *candidate* — the cluster
  surfaces it, a human decides.
- The postcode/country splice bug in address reads was fixed in passing:
  both now prefer raw shipping over the billing-derived projection, so a
  ship-elsewhere order no longer exports a billing postcode under a
  shipping street.
- Migration: `20260808104454_address_identity_and_clusters.sql` (applied
  remotely in four parts, `address_identity_*`, because the MV rebuild
  exceeds the migration client's timeout — the MV was created `WITH NO
  DATA` and populated by a one-shot server-side refresh).
