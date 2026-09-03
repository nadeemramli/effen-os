{{ config(severity='warn') }}

-- Completeness contract for the ads pipeline: every ACTIVE ad account that
-- spent in the last week must have insights for D-2 (D-1 is allowed to lag a
-- cycle for late Airbyte waves). A row here names an account whose Airbyte
-- connection stalled, lost its token, or was disabled. Warn-level until the
-- mart-sync gate (plan: event-driven chaining) can refuse an incomplete mart.

with active as (
  select cast(account_id as string) as account_id, name
  from {{ source('raw', 'supabase_ad_accounts_read') }}
  where is_active and account_status = 'ACTIVE'
),

recent as (
  select
    cast(account_id as string) as account_id,
    max(date) as max_date,
    sum(spend) as spend_7d
  from {{ ref('stg_meta_ads_insights') }}
  where date >= date_sub(current_date(), interval 8 day)
  group by account_id
)

select a.account_id, a.name, r.max_date, r.spend_7d
from active a
join recent r using (account_id)
where r.spend_7d > 0
  and r.max_date < date_sub(current_date(), interval 2 day)
