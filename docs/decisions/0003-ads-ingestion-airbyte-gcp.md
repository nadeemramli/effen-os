# ADR-0003 — Ads data ingestion: Airbyte → GCP warehouse; Fullkit serves a synced mart

**Date:** 2026-08-01 · **Status: Accepted (direction set by Nadeem; contract
details to finalize)**

## Decision

1. **Meta / TikTok (and later Google) ads data is ingested by Airbyte into a
   GCP warehouse (BigQuery)** — not by Fullkit edge functions. Airbyte holds
   the platform credentials and handles incremental syncs, rate limits, and
   schema drift for the accounts that still have API access.
2. **GCS (Cloud Storage) is the landing/archive layer and source of truth
   for marketing files** — banned-account CSV exports, creative assets, and
   any platform export that can no longer be fetched by API. Raw files stay
   immutable so every downstream table is replayable.
3. **Banned ad accounts are first-class citizens.** Their history enters via
   CSV export → GCS → BigQuery load, into the SAME mart as API-sourced rows,
   flagged by source. Rationale: platform bans kill API access (10+ EFFEN
   accounts are already DISABLED and unqueryable), and banned-account spend
   is real acquisition cost that must survive in the record.
4. **Transformations live in the warehouse** (SQL/dbt) because the EFFEN
   schema is unique: numbered media-buyer accounts mapped to brands, MY/SG
   market split, account bans/replacements merged into continuous
   brand-level series.
5. **Fullkit consumes a governed mart, not the pipeline.** The app never
   queries platforms and does not care whether a row came from Airbyte or a
   CSV — it reads the contract below.

## The data contract (what Fullkit reads)

`mart_ads_daily` — one row per date × platform × account × campaign:

| column | notes |
|---|---|
| date | platform-reported day |
| platform | meta / tiktok / google |
| account_id, account_name | platform account |
| brand_slug, market | EFFEN mapping (the "unique schema" output) |
| campaign_id, campaign_name | nullable for account-grain rows |
| spend, currency_code | platform-reported |
| impressions, clicks, purchases, purchase_value | nullable where the export lacks them |
| source | `api` \| `csv_export` |
| is_banned_account | boolean |
| ingested_at | provenance timestamp |

Optionally later: `mart_creatives` (creative id, asset GCS URL, status,
linked campaign) for the Creative module.

## How Fullkit connects

**Serving copy in Supabase, not direct BigQuery queries from the app.**
A scheduled sync (edge function with a BigQuery read-only service account,
or a warehouse-side reverse-ETL push) upserts `mart_ads_daily` into the
existing `ad_daily_facts` / `ad_accounts_read` tables daily. Reasons:

- The app keeps one backend, RLS keeps authorizing reads, and the existing
  UI (Marketing panel, scorecard ad-spend card) already reads these tables —
  the swap is invisible to the frontend.
- Operational UI queries stay millisecond-fast and free of per-query
  BigQuery cost/latency; BigQuery remains the analytical home.

Schema deltas needed on the Fullkit side (additive only): campaign grain,
`purchase_value`, `source`, `is_banned_account`, `platform` on the facts
table. The UI surfaces provenance per its freshness discipline — including
a visible "banned-account history via export" note in Marketing.

## What this supersedes

- The planned `meta-sync` edge function and the Meta system-user token are
  **no longer needed for facts ingestion** (Airbyte owns platform access).
  The 120 connector-seeded daily facts remain as interim data until the
  pipeline lands, then are overwritten by the mart sync.
- Marketing/TikTok/Google rows in `integration_connections` will point at
  the warehouse pipeline as their source system (freshness = mart sync
  recency, surfaced in Data Health).

## Open items to finalize the contract

1. Confirm warehouse choice (BigQuery assumed) and region
   (`asia-southeast1` suggested, matching Supabase).
2. Airbyte Cloud vs self-hosted (cost/ownership call).
3. Who owns the brand/market mapping table the transformations use — it
   should mirror Fullkit's `brands` + `ad_accounts_read` mapping (Fullkit
   can publish it to BigQuery so mapping is governed in one place).
4. A read-only service account (or reverse-ETL push credential) for the
   mart sync into Supabase.
5. CSV export convention for banned accounts (bucket path, filename with
   account id + date range, column dialect per platform export version).

## Note on "GSC"

This ADR interprets the source-of-truth bucket as **GCS (Google Cloud
Storage)**. If Google **Search Console** data is also wanted later, it is
simply another Airbyte source into the same warehouse — no architectural
change.
