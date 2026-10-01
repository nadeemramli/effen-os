-- Creative read contract, ad grain (ADR-0010): one row per date × ad.
--
-- This is a SEPARATE contract from mart_ads_daily (ADR-0003), which stays
-- untouched. Metrics come from the same deduplicated stg_meta_ads_insights
-- rows, so per day this table sums to exactly mart_ads_daily
-- (assert_creative_ad_daily_conserves_spend). Every join below is to a
-- model that is unique on its key, so no metric can fan out:
--   int_creative_ad_binding   1 row / ad_id
--   stg_meta_creative_media   1 row / creative_id
--   stg_meta_delivery_context 1 row / (ad_id, date)
--   stg_meta_campaign_context 1 row / campaign_id
--   stg_meta_account_context  1 row / account_id
--   ad_brand (below)          1 row / ad_id
-- Late conversions: the connector re-reads ~28 days and latest extraction
-- wins, so recent rows are revised; `data_maturity` says which are still
-- moving. Never rank on `maturing` rows without saying so.
{{ config(
    enabled=var('creative_media_enabled', false),
    tags=['creative'],
    partition_by={'field': 'date', 'data_type': 'date'},
    cluster_by=['account_id', 'creative_format']
) }}

with ad_brand as (
  -- int_ad_brand can repeat an ad_id; collapse it and keep the evidence
  select
    ad_id,
    any_value(brand_slug) as brand_slug,
    any_value(brand_resolution_method) as brand_resolution_method,
    count(distinct brand_slug) as brand_candidates
  from {{ ref('int_ad_brand') }}
  group by ad_id
)

select
  i.date,
  'meta' as platform,
  i.account_id,
  ac.account_timezone,
  i.campaign_id,
  cc.campaign_objective,
  coalesce(b.adset_id, i.adset_id) as adset_id,
  i.ad_id,
  i.ad_name,
  b.creative_id,
  case
    when b.ad_id is null then 'ad_not_in_catalog'
    when b.ad_binding_status != 'bound' then b.ad_binding_status
    when cm.creative_id is null then 'creative_not_in_catalog'
    else 'bound'
  end as binding_status,
  coalesce(cm.creative_format, 'unknown') as creative_format,
  cm.image_hash,
  if(cm.image_hash is not null, concat(i.account_id, ':', cm.image_hash), null) as image_key,
  cm.preview_thumbnail_url,
  ab.brand_slug,
  ab.brand_resolution_method,
  coalesce(ab.brand_candidates, 0) as brand_candidates,
  -- Market = Meta targeting truth; account register only as fallback,
  -- same rule as mart_ads_daily. NULL stays NULL (never assumed MY).
  coalesce(b.targeting_market, m.market) as market,
  coalesce(m.currency_code, i.currency_code) as currency_code,
  dc.attribution_setting,
  i.spend,
  i.impressions,
  i.clicks,
  i.purchases,
  i.purchase_value,
  coalesce(m.is_banned_account, false) as is_banned_account,
  if(i.date > date_sub(current_date(), interval 7 day), 'maturing', 'settled') as data_maturity,
  i.ingested_at
from {{ ref('stg_meta_ads_insights') }} i
left join {{ ref('int_creative_ad_binding') }} b using (ad_id)
left join {{ ref('stg_meta_creative_media') }} cm on cm.creative_id = b.creative_id
left join {{ ref('stg_meta_delivery_context') }} dc on dc.ad_id = i.ad_id and dc.date = i.date
left join {{ ref('stg_meta_campaign_context') }} cc on cc.campaign_id = i.campaign_id
left join {{ ref('stg_meta_account_context') }} ac on ac.account_id = i.account_id
left join ad_brand ab on ab.ad_id = i.ad_id
left join {{ ref('stg_ad_account_map') }} m on m.account_id = i.account_id
