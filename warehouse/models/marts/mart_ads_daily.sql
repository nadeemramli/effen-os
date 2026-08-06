-- The governed ads contract (ADR-0003): one row per
-- date × platform × account × campaign. Fullkit's mart sync reads this
-- and nothing else. CSV-export history for banned accounts will UNION in
-- here with source='csv_export' once the loader lands.
{{ config(
    partition_by={'field': 'date', 'data_type': 'date'},
    cluster_by=['platform', 'account_id']
) }}

with api_facts as (
  select
    i.date,
    'meta' as platform,
    i.account_id,
    coalesce(any_value(m.account_name), any_value(i.account_name)) as account_name,
    -- Ad-grain waterfall (url -> page evidence -> name token -> account
    -- register); campaigns are single-brand in practice, mixed-brand
    -- campaigns are a known accepted edge (docs/ops plan).
    any_value(b.brand_slug) as brand_slug,
    any_value(b.brand_resolution_method) as brand_resolution_method,
    -- Market = Meta targeting-geo truth; account register only as fallback
    coalesce(any_value(b.market), any_value(m.market)) as market,
    i.campaign_id,
    any_value(i.campaign_name) as campaign_name,
    sum(i.spend) as spend,
    coalesce(any_value(m.currency_code), any_value(i.currency_code)) as currency_code,
    sum(i.impressions) as impressions,
    sum(i.clicks) as clicks,
    sum(i.purchases) as purchases,
    sum(i.purchase_value) as purchase_value,
    'api' as source,
    coalesce(any_value(m.is_banned_account), false) as is_banned_account,
    max(i.ingested_at) as ingested_at
  from {{ ref('stg_meta_ads_insights') }} i
  left join {{ ref('int_ad_brand') }} b using (ad_id)
  left join {{ ref('stg_ad_account_map') }} m on m.account_id = i.account_id
  group by i.date, i.account_id, i.campaign_id
)

select * from api_facts
