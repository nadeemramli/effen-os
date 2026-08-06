-- Ad catalog across all per-account tables: the bridge from insights
-- (ad_id) to creative content, plus targeting-geo market. Market comes
-- from Meta's targeting truth, never from account/campaign naming
-- (EFFEN naming is inconsistent by design — fast iteration).
with unioned as (
  {{ union_meta_stream('ads',
    'id, account_id, campaign_id, adset_id, name, effective_status,
     creative, targeting') }}
),

ads as (
  select
    id as ad_id,
    account_id,
    campaign_id,
    adset_id,
    name as ad_name,
    effective_status,
    json_value(creative, '$.id') as creative_id,
    json_value_array(targeting, '$.geo_locations.countries') as target_countries
  from unioned
)

select
  * except (target_countries),
  case
    when array_length(target_countries) = 1 then target_countries[offset(0)]
    when array_length(target_countries) > 1 then 'MULTI'
  end as market,
  array_to_string(target_countries, ',') as target_countries
from ads
