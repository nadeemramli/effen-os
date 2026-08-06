-- Governance queue: all spend the brand waterfall could not classify,
-- keyed by the best available signal (domain > page > ad name), weighted
-- by spend so review is prioritized. Destined to surface in Fullkit
-- (Data Health) via the mart sync; a new brand or alias token clears its
-- rows on the next run. Built from the insights side so ads missing from
-- Meta's catalog are counted too.
select
  coalesce(
    b.destination_domain,
    'page:' || b.page_id,
    'ad_name:' || i.ad_name,
    'no_signal'
  ) as signal,
  count(distinct i.ad_id) as ads,
  round(sum(i.spend), 2) as spend,
  min(i.date) as first_seen,
  max(i.date) as last_seen
from {{ ref('stg_meta_ads_insights') }} i
left join {{ ref('int_ad_brand') }} b using (ad_id)
where b.brand_slug is null
group by signal
order by spend desc
