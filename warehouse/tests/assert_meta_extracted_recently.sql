{{ config(severity='warn') }}

-- Freshness contract per Airbyte connection: any account that produced
-- insights in the last week must have been extracted within 30 hours
-- (nightly waves + margin). Uses _airbyte_extracted_at (surfaced as
-- ingested_at) so it measures the sync, not Meta's reporting date.

select
  account_id,
  max(ingested_at) as last_extracted_at
from {{ ref('stg_meta_ads_insights') }}
where date >= date_sub(current_date(), interval 8 day)
group by account_id
having max(ingested_at) < timestamp_sub(current_timestamp(), interval 30 hour)
