-- Ad-grain daily Meta facts across ALL per-account tables (see
-- union_meta_stream), deduplicated latest-wins: the connector re-reads
-- a ~28-day lookback window each sync (Meta restates late conversions),
-- so an (ad_id, date) pair appears once per sync that covered it and
-- only the newest extraction is truth.
with unioned as (
  {{ union_meta_stream('ads_insights',
    'date_start, account_id, account_name, account_currency,
     campaign_id, campaign_name, adset_id, ad_id, ad_name, spend,
     impressions, clicks, actions, action_values,
     _airbyte_extracted_at') }}
),

deduped as (
  select
    *,
    row_number() over (
      partition by ad_id, date_start
      order by _airbyte_extracted_at desc
    ) as rn
  from unioned
)

select
  date_start as date,
  account_id,
  account_name,
  account_currency as currency_code,
  campaign_id,
  campaign_name,
  adset_id,
  ad_id,
  ad_name,
  spend,
  impressions,
  clicks,
  (
    select sum(cast(json_value(a, '$.value') as int64))
    from unnest(json_query_array(actions)) a
    where json_value(a, '$.action_type') = 'omni_purchase'
  ) as purchases,
  (
    select sum(cast(json_value(a, '$.value') as numeric))
    from unnest(json_query_array(action_values)) a
    where json_value(a, '$.action_type') = 'omni_purchase'
  ) as purchase_value,
  _airbyte_extracted_at as ingested_at
from deduped
where rn = 1
