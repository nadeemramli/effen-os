-- Ad catalog: the bridge from insights (ad_id) to creative content, plus
-- targeting-geo market. Market comes from Meta's targeting truth, never
-- from account/campaign naming (EFFEN naming is inconsistent by design —
-- fast iteration). Single-country ads get that code; multi-country test
-- ads get 'MULTI'.
with ads as (
  select
    id as ad_id,
    account_id,
    campaign_id,
    adset_id,
    name as ad_name,
    effective_status,
    json_value(creative, '$.id') as creative_id,
    json_value_array(targeting, '$.geo_locations.countries') as target_countries
  from {{ source('raw', 'meta_ads') }}
)

select
  * except (target_countries),
  case
    when array_length(target_countries) = 1 then target_countries[offset(0)]
    when array_length(target_countries) > 1 then 'MULTI'
  end as market,
  array_to_string(target_countries, ',') as target_countries
from ads
