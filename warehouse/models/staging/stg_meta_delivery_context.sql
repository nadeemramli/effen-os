-- Comparability context that the governed mart does not carry (ADR-0010):
-- the attribution setting Meta reported for each ad × day, latest
-- extraction wins (same rule as stg_meta_ads_insights). NULL means the
-- connector did not land the field — it stays unknown, never defaulted.
{{ config(enabled=var('creative_media_enabled', false), tags=['creative']) }}

with unioned as (
  {{ union_meta_stream_columns('ads_insights',
      required=['ad_id', 'date_start', '_airbyte_extracted_at'],
      optional=['attribution_setting']) }}
)

select
  ad_id,
  date_start as date,
  attribution_setting
from unioned
qualify row_number() over (
  partition by ad_id, date_start
  order by _airbyte_extracted_at desc
) = 1
