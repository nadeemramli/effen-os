{{ config(enabled=var('creative_media_enabled', false), tags=['creative']) }}
-- Metric conservation against the governed contract: per day and
-- account, the creative ad-grain mart must carry exactly the spend,
-- purchases and purchase value of mart_ads_daily. Any gap means the
-- creative contract gained or lost delivery somewhere.
with c as (
  select date, account_id, sum(spend) as spend,
    sum(coalesce(purchases, 0)) as purchases,
    sum(coalesce(purchase_value, 0)) as purchase_value
  from {{ ref('mart_creative_ad_daily') }}
  group by 1, 2
),
g as (
  select date, account_id, sum(spend) as spend,
    sum(coalesce(purchases, 0)) as purchases,
    sum(coalesce(purchase_value, 0)) as purchase_value
  from {{ ref('mart_ads_daily') }}
  where platform = 'meta'
  group by 1, 2
)
select coalesce(c.date, g.date) as date, coalesce(c.account_id, g.account_id) as account_id,
  c.spend as creative_spend, g.spend as governed_spend,
  c.purchases as creative_purchases, g.purchases as governed_purchases
from c
full outer join g on c.date = g.date and c.account_id = g.account_id
where abs(coalesce(c.spend, 0) - coalesce(g.spend, 0)) > 0.005
   or coalesce(c.purchases, 0) != coalesce(g.purchases, 0)
   or abs(coalesce(c.purchase_value, 0) - coalesce(g.purchase_value, 0)) > 0.005
