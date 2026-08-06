-- Brand/market mapping for ad accounts, governed in Fullkit (ADR-0003):
-- one row per platform account id with the EFFEN attribution needed by
-- mart_ads_daily. Meta reports account_id without the act_ prefix.
select
  replace(a.account_id, 'act_', '') as account_id,
  a.name as account_name,
  a.provider as platform,
  a.market,
  a.currency_code,
  b.slug as brand_slug,
  lower(coalesce(a.account_status, '')) in ('disabled', 'banned', '2', '101')
    as is_banned_account
from {{ source('raw', 'supabase_ad_accounts_read') }} a
left join {{ source('raw', 'supabase_brands') }} b on b.id = a.brand_id
