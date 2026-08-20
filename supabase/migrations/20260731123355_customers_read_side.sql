-- Customer 360 read-model (Slice 2). Identities are resolved from the live
-- order mirror: phone digits first (the primary identity in MY/SG commerce),
-- e-mail fallback. Lives in the PRIVATE schema because materialized views
-- cannot carry RLS — all access goes through membership-checked RPCs below.
-- Refreshed every 15 minutes by pg_cron, offset from the woo-sync schedule.

create materialized view private.customers_read as
with base as (
  select
    workspace_id,
    coalesce(
      nullif(regexp_replace(coalesce(customer->>'phone', ''), '[^0-9]', '', 'g'), ''),
      nullif(lower(coalesce(customer->>'email', '')), '')
    ) as identity_key,
    nullif(customer->>'name', '') as name,
    nullif(customer->>'phone', '') as phone,
    nullif(lower(customer->>'email'), '') as email,
    nullif(customer->>'city', '') as city,
    nullif(customer->>'country', '') as country,
    brand_id,
    currency_code,
    total::numeric as total,
    source_status,
    placed_at
  from public.orders_read
  where customer is not null
),
keyed as (select * from base where identity_key is not null),
per_ccy as (
  select identity_key, currency_code,
         sum(total) filter (where source_status in ('processing', 'completed')) as revenue
  from keyed
  group by 1, 2
),
ccy_agg as (
  select identity_key,
         jsonb_object_agg(currency_code, round(revenue, 2)) filter (where revenue is not null) as revenue_by_currency
  from per_ccy
  group by 1
),
grouped as (
  select
    identity_key,
    min(workspace_id) as workspace_id,
    (array_agg(name order by placed_at desc nulls last) filter (where name is not null))[1] as display_name,
    (array_agg(phone order by placed_at desc nulls last) filter (where phone is not null))[1] as phone,
    (array_agg(email order by placed_at desc nulls last) filter (where email is not null))[1] as email,
    (array_agg(city order by placed_at desc nulls last) filter (where city is not null))[1] as city,
    (array_agg(country order by placed_at desc nulls last) filter (where country is not null))[1] as country,
    array_agg(distinct brand_id) filter (where brand_id is not null) as brand_ids,
    count(*)::bigint as total_orders,
    (count(*) filter (where source_status in ('processing', 'completed')))::bigint as recognized_orders,
    min(placed_at) as first_order_at,
    max(placed_at) as last_order_at
  from keyed
  group by identity_key
)
select g.*, c.revenue_by_currency
from grouped g
left join ccy_agg c using (identity_key);

create unique index customers_read_identity_idx on private.customers_read (identity_key);
create index customers_read_last_order_idx on private.customers_read (last_order_at desc);

-- Same identity expression over orders_read, so a customer's order history
-- resolves via an index instead of a scan.
create index orders_read_identity_expr_idx on public.orders_read ((
  coalesce(
    nullif(regexp_replace(coalesce(customer->>'phone', ''), '[^0-9]', '', 'g'), ''),
    nullif(lower(coalesce(customer->>'email', '')), '')
  )
));

-- Refresh cadence: concurrent (readers never block) on the quarter-hour +7,
-- after each woo-sync tick has landed.
select cron.schedule(
  'customers-read-refresh',
  '7,22,37,52 * * * *',
  $$refresh materialized view concurrently private.customers_read$$
);

-- ---------- membership-gated accessors ----------

create or replace function public.live_customers(
  p_page integer default 1,
  p_page_size integer default 50,
  p_search text default '',
  p_brand_id bigint default null,
  p_activity text default null -- new | active | at_risk | dormant
)
returns table (
  identity_key text,
  display_name text,
  phone text,
  email text,
  city text,
  country text,
  brand_ids bigint[],
  total_orders bigint,
  recognized_orders bigint,
  first_order_at timestamptz,
  last_order_at timestamptz,
  revenue_by_currency jsonb,
  total_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_needle text := nullif(trim(p_search), '');
begin
  if not private.is_workspace_member((select min(id) from public.workspaces)) then
    raise exception 'Not a workspace member';
  end if;
  return query
  select c.identity_key, c.display_name, c.phone, c.email, c.city, c.country,
         c.brand_ids, c.total_orders, c.recognized_orders,
         c.first_order_at, c.last_order_at, c.revenue_by_currency,
         count(*) over ()::bigint as total_count
  from private.customers_read c
  where (p_brand_id is null or c.brand_ids @> array[p_brand_id])
    and (v_needle is null
         or c.display_name ilike '%' || v_needle || '%'
         or c.phone ilike '%' || v_needle || '%'
         or c.email ilike '%' || v_needle || '%'
         or c.identity_key ilike '%' || regexp_replace(v_needle, '[^0-9a-z@._-]', '', 'gi') || '%')
    and (p_activity is null
         or (p_activity = 'new'     and c.first_order_at > now() - interval '30 days' and c.total_orders = 1)
         or (p_activity = 'active'  and c.last_order_at  > now() - interval '30 days')
         or (p_activity = 'at_risk' and c.last_order_at <= now() - interval '30 days' and c.last_order_at > now() - interval '90 days')
         or (p_activity = 'dormant' and c.last_order_at <= now() - interval '90 days'))
  order by c.last_order_at desc
  limit greatest(p_page_size, 1)
  offset (greatest(p_page, 1) - 1) * greatest(p_page_size, 1);
end;
$$;

revoke execute on function public.live_customers(integer, integer, text, bigint, text) from public, anon;
grant execute on function public.live_customers(integer, integer, text, bigint, text) to authenticated;

create or replace function public.live_customer_detail(p_identity_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile jsonb;
  v_orders jsonb;
  v_wa bigint;
begin
  if not private.is_workspace_member((select min(id) from public.workspaces)) then
    raise exception 'Not a workspace member';
  end if;

  select to_jsonb(c) into v_profile from private.customers_read c where c.identity_key = p_identity_key;
  if v_profile is null then
    return null;
  end if;

  select coalesce(jsonb_agg(o order by o.placed_at desc), '[]'::jsonb) into v_orders
  from (
    select r.id, r.integration_id, r.brand_id, r.order_number, r.source_order_id,
           r.source_status, r.currency_code, r.total, r.items, r.placed_at
    from public.orders_read r
    where coalesce(
        nullif(regexp_replace(coalesce(r.customer->>'phone', ''), '[^0-9]', '', 'g'), ''),
        nullif(lower(coalesce(r.customer->>'email', '')), '')
      ) = p_identity_key
    order by r.placed_at desc
    limit 100
  ) o;

  select count(*) into v_wa
  from public.wa_conversations wc
  where regexp_replace(wc.wa_contact, '[^0-9]', '', 'g') = p_identity_key;

  return jsonb_build_object('profile', v_profile, 'orders', v_orders, 'wa_conversations', v_wa);
end;
$$;

revoke execute on function public.live_customer_detail(text) from public, anon;
grant execute on function public.live_customer_detail(text) to authenticated;
