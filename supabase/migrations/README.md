# Migrations

These files are the readable record of the operational schema. The authoritative
ledger is `supabase_migrations.schema_migrations` in the project itself.

## Filename versions are the applied versions

A filename's numeric prefix is the version the migration was **actually recorded
under when it ran**, not a sequence number chosen when the file was written.
This is what lets the Supabase CLI recognise the schema as already applied — the
CLI matches on the version prefix alone, so the descriptive half of the name is
free to differ from the recorded name.

Until 21 Aug 2026 these files used hand-assigned sequence numbers
(`20260820000002_…`) that matched nothing in the ledger. Every file therefore
looked unapplied, and `supabase db push` against a live project would have tried
to replay all 65 of them onto a complete schema — including
`live_woo_domains_and_demo_purge`. The prefixes were rewritten to the real
applied versions; no SQL changed and the database was not touched.

The old numbering also implied an order that was not the order things ran:
`address_identity_and_clusters` actually ran before `ship_readiness_v3`, and
`address_suggest_cron` ran mid-sequence rather than last. A fresh `db reset`
would have replayed them wrongly. Real timestamps sort correctly.

## How a migration gets here

Migrations are applied out of band — the Supabase MCP `apply_migration` tool or
the dashboard — which assigns the version. The file is then committed here under
that same version. Write the file after applying, not before, so the prefix can
be the true one.

Do not run `supabase db push` against a live project without first checking
`supabase migration list` and confirming that what it wants to push is genuinely
absent from the ledger.

## Known gaps

Three recorded versions have no file of their own. All four address-identity
migrations are kept together in `20260808104454_address_identity_and_clusters.sql`,
which carries the earliest of the four versions:

| Recorded version | Recorded name |
| --- | --- |
| 20260808104539 | `address_identity_index` |
| 20260808104957 | `address_identity_customers_read` |
| 20260808105044 | `address_identity_rpcs` |

Files with no counterpart in the ledger are the dangerous direction; this one is
harmless, because nothing will try to replay them.

## Comments are not stored

The ledger keeps only the SQL that ran. The reasoning in these files — measured
timings, why an index's column order is load-bearing, what was ruled out — exists
only here. Several files are byte-identical to the recorded statements; the ones
that are larger differ by comments alone.
