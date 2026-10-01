{{ config(enabled=var('creative_media_enabled', false), tags=['creative']) }}
-- The image mart must equal the bound single-image slice of the ad mart,
-- per day and account: nothing allocated in, nothing dropped.
with img as (
  select date, account_id, sum(spend) as spend, sum(coalesce(purchases, 0)) as purchases,
    sum(ads) as ad_rows
  from {{ ref('mart_creative_image_daily') }}
  group by 1, 2
),
ad as (
  select date, account_id, sum(spend) as spend, sum(coalesce(purchases, 0)) as purchases,
    count(*) as ad_rows
  from {{ ref('mart_creative_ad_daily') }}
  where creative_format = 'single_image' and binding_status = 'bound' and image_hash is not null
  group by 1, 2
)
select coalesce(img.date, ad.date) as date, coalesce(img.account_id, ad.account_id) as account_id,
  img.spend as image_spend, ad.spend as ad_spend, img.ad_rows, ad.ad_rows as expected_ad_rows
from img
full outer join ad on img.date = ad.date and img.account_id = ad.account_id
where abs(coalesce(img.spend, 0) - coalesce(ad.spend, 0)) > 0.005
   or coalesce(img.purchases, 0) != coalesce(ad.purchases, 0)
   or coalesce(img.ad_rows, 0) != coalesce(ad.ad_rows, 0)
