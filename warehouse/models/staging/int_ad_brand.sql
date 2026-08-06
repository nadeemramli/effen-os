-- Brand resolution waterfall, ad grain. Auto-detection first (URL token
-- match), then evidence (page's dominant brand), then campaign-name
-- tokens, then the account register. brand_resolution_method records
-- which rule won so coverage is auditable; nulls surface in
-- dq_unclassified_signals rather than being dropped.
with catalog_ads as (
  select a.*, c.destination_url, c.destination_domain, c.page_id
  from {{ ref('stg_meta_ads') }} a
  left join {{ ref('stg_meta_ad_creatives') }} c using (creative_id)
),

-- Ads present in insights but absent from Meta's ads catalog (very old
-- ads): no URL/page signal exists, but name tokens still apply.
insight_only_ads as (
  select
    i.ad_id,
    any_value(i.account_id) as account_id,
    any_value(i.campaign_id) as campaign_id,
    cast(null as string) as adset_id,
    any_value(i.ad_name) as ad_name,
    cast(null as string) as effective_status,
    cast(null as string) as creative_id,
    cast(null as string) as market,
    cast(null as string) as target_countries,
    cast(null as string) as destination_url,
    cast(null as string) as destination_domain,
    cast(null as string) as page_id
  from {{ ref('stg_meta_ads_insights') }} i
  left join {{ ref('stg_meta_ads') }} a using (ad_id)
  where a.ad_id is null
  group by i.ad_id
),

ads as (
  select ca.*, coalesce(cmp.name, '') as campaign_name
  from catalog_ads ca
  left join {{ source('raw', 'meta_campaigns') }} cmp
    on cmp.id = ca.campaign_id
  union all
  select io.*, coalesce(cmp.name, '') as campaign_name
  from insight_only_ads io
  left join {{ source('raw', 'meta_campaigns') }} cmp
    on cmp.id = io.campaign_id
),

aliases as (
  select * from {{ ref('brand_aliases') }}
),

-- Rule 1: destination URL contains a brand token
url_match as (
  select ads.ad_id, any_value(al.brand_slug) as brand_slug
  from ads
  join aliases al on regexp_contains(lower(ads.destination_url), al.token)
  group by ads.ad_id
),

-- Rule 2: the page's dominant URL-resolved brand (covers URL-less ads;
-- a page inherits the brand its other ads link to)
page_brand as (
  select page_id, brand_slug
  from (
    select
      ads.page_id,
      um.brand_slug,
      row_number() over (
        partition by ads.page_id order by count(*) desc
      ) as rn
    from ads
    join url_match um using (ad_id)
    where ads.page_id is not null
    group by ads.page_id, um.brand_slug
  )
  where rn = 1
),

-- Rule 3: campaign's dominant URL-resolved brand (campaigns are
-- single-brand in practice — generic ad names like "Ads_3" inherit
-- their campaign's brand)
campaign_brand as (
  select campaign_id, brand_slug
  from (
    select
      ads.campaign_id,
      coalesce(um.brand_slug, pb.brand_slug) as brand_slug,
      row_number() over (
        partition by ads.campaign_id order by count(*) desc
      ) as rn
    from ads
    left join url_match um using (ad_id)
    left join page_brand pb using (page_id)
    where ads.campaign_id is not null
      and coalesce(um.brand_slug, pb.brand_slug) is not null
    group by ads.campaign_id, brand_slug
  )
  where rn = 1
),

-- Rule 4: ad or campaign name contains a brand token
name_match as (
  select ads.ad_id, any_value(al.brand_slug) as brand_slug
  from ads
  join aliases al on regexp_contains(
    lower(concat(coalesce(ads.ad_name, ''), ' ', ads.campaign_name)),
    al.token
  )
  group by ads.ad_id
)

select
  ads.ad_id,
  ads.campaign_id,
  ads.account_id,
  ads.market,
  ads.destination_domain,
  ads.page_id,
  coalesce(um.brand_slug, pb.brand_slug, cb.brand_slug, nm.brand_slug,
    am.brand_slug) as brand_slug,
  case
    when um.brand_slug is not null then 'url'
    when pb.brand_slug is not null then 'page_evidence'
    when cb.brand_slug is not null then 'campaign_evidence'
    when nm.brand_slug is not null then 'name_token'
    when am.brand_slug is not null then 'account_register'
  end as brand_resolution_method
from ads
left join url_match um using (ad_id)
left join page_brand pb using (page_id)
left join campaign_brand cb using (campaign_id)
left join name_match nm using (ad_id)
left join {{ ref('stg_ad_account_map') }} am using (account_id)
