{{ config(enabled=var('creative_media_enabled', false), tags=['creative']) }}
-- mart_creative_ad_daily is ONE row per date × ad. A duplicate means a
-- join fanned out and every metric on that ad-day is double-counted.
select date, ad_id, count(*) as n
from {{ ref('mart_creative_ad_daily') }}
group by date, ad_id
having count(*) > 1
