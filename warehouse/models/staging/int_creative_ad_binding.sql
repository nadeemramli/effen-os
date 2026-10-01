-- One row per ad_id → its creative (ADR-0010). The bridge is enforced
-- here rather than assumed: an ad_id seen with more than one creative_id
-- across account tables is NOT resolved by picking one; it is bound to
-- nothing and flagged, so its spend stays visible at ad grain without
-- being credited to a guessed image.
{{ config(enabled=var('creative_media_enabled', false), tags=['creative']) }}

select
  ad_id,
  if(count(distinct creative_id) = 1, any_value(creative_id), null) as creative_id,
  case
    when count(distinct creative_id) = 0 then 'creative_missing'
    when count(distinct creative_id) > 1 then 'conflicting_creative'
    else 'bound'
  end as ad_binding_status,
  any_value(adset_id) as adset_id,
  any_value(effective_status) as effective_status,
  any_value(market) as targeting_market,
  any_value(target_countries) as target_countries
from {{ ref('stg_meta_ads') }}
group by ad_id
