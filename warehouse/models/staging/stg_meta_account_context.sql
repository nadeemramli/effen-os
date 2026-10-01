-- Ad-account reporting timezone and currency as Meta reports them
-- (ADR-0010). Insights `date_start` is the account-timezone day; this is
-- what makes that explicit downstream. One row per account.
{{ config(enabled=var('creative_media_enabled', false), tags=['creative']) }}

with unioned as (
  {{ union_meta_stream_columns('ad_account',
      required=['account_id'],
      optional=['timezone_name', 'currency', '_airbyte_extracted_at']) }}
)

select
  replace(cast(account_id as string), 'act_', '') as account_id,
  timezone_name as account_timezone,
  currency as platform_currency_code
from unioned
qualify row_number() over (
  partition by replace(cast(account_id as string), 'act_', '')
  order by _airbyte_extracted_at desc nulls last
) = 1
