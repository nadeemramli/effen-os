{{ config(enabled=var('creative_media_enabled', false), tags=['creative']) }}
-- Every model mart_creative_ad_daily joins to must be unique on its join
-- key; this is what makes the ad-grain contract fan-out free.
select 'int_creative_ad_binding' as model, ad_id as key, count(*) as n
from {{ ref('int_creative_ad_binding') }} group by ad_id having count(*) > 1
union all
select 'stg_meta_creative_media', creative_id, count(*)
from {{ ref('stg_meta_creative_media') }} group by creative_id having count(*) > 1
union all
select 'stg_meta_delivery_context', concat(ad_id, '@', cast(date as string)), count(*)
from {{ ref('stg_meta_delivery_context') }} group by ad_id, date having count(*) > 1
union all
select 'stg_meta_campaign_context', campaign_id, count(*)
from {{ ref('stg_meta_campaign_context') }} group by campaign_id having count(*) > 1
union all
select 'stg_meta_account_context', account_id, count(*)
from {{ ref('stg_meta_account_context') }} group by account_id having count(*) > 1
union all
select 'stg_ad_account_map', account_id, count(*)
from {{ ref('stg_ad_account_map') }} group by account_id having count(*) > 1
