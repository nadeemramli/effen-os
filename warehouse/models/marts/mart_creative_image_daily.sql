-- Creative read contract, exact-image grain (ADR-0010): one row per
-- date × account × image_hash × comparability cohort, SINGLE-IMAGE ADS ONLY.
--
-- Each single-image ad maps to exactly one image, so summing its ad-grain
-- metrics into the image is conservation, not allocation. Carousel,
-- dynamic and video ads are excluded by construction (their image_hash is
-- NULL upstream) — their totals are never credited to any child image.
--
-- image_hash is Meta's per-account identity. Cross-account de-duplication
-- by exact bytes (SHA-256) happens after the archiver has fetched the file
-- (creative.platform_image_refs in Supabase); launch lineage stays here at
-- ad grain in mart_creative_ad_daily.
--
-- The cohort columns (brand, market, currency, objective, attribution,
-- timezone) are part of the grain because rows that differ on them are
-- not comparable; ranking happens within a cohort, never across.
{{ config(
    enabled=var('creative_media_enabled', false),
    tags=['creative'],
    partition_by={'field': 'date', 'data_type': 'date'},
    cluster_by=['account_id', 'image_hash']
) }}

select
  date,
  platform,
  account_id,
  image_hash,
  any_value(image_key) as image_key,
  coalesce(brand_slug, 'UNRESOLVED') as brand_slug,
  coalesce(market, 'UNKNOWN') as market,
  coalesce(currency_code, 'UNKNOWN') as currency_code,
  coalesce(campaign_objective, 'UNKNOWN') as campaign_objective,
  coalesce(attribution_setting, 'UNKNOWN') as attribution_setting,
  coalesce(account_timezone, 'UNKNOWN') as account_timezone,
  count(distinct ad_id) as ads,
  count(distinct creative_id) as creatives,
  count(distinct campaign_id) as campaigns,
  array_agg(distinct ad_id order by ad_id limit 50) as ad_ids,
  sum(spend) as spend,
  sum(impressions) as impressions,
  sum(clicks) as clicks,
  sum(purchases) as purchases,
  sum(purchase_value) as purchase_value,
  logical_or(is_banned_account) as any_banned_account,
  min(data_maturity) as data_maturity,   -- 'maturing' < 'settled'
  max(ingested_at) as ingested_at
from {{ ref('mart_creative_ad_daily') }}
where creative_format = 'single_image'
  and binding_status = 'bound'
  and image_hash is not null
group by date, platform, account_id, image_hash, brand_slug, market,
  currency_code, campaign_objective, attribution_setting, account_timezone
