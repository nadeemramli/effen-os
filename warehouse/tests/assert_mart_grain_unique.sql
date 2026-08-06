-- The mart contract is ONE row per date × platform × account × campaign
-- (ADR-0003); the Supabase upsert keys on exactly that grain. A duplicate
-- here means the dedupe/aggregation regressed and spend would
-- double-count downstream — fail hard.
select date, platform, account_id, campaign_id, count(*) as n
from {{ ref('mart_ads_daily') }}
group by date, platform, account_id, campaign_id
having count(*) > 1
