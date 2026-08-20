-- Market (country) dimension across the live read-side. Each Woo connection
-- is a country-specific storefront, so orders carry their market via
-- integration_id; customers carry billing country; ad accounts are marked
-- from their names (SG accounts say so). The top bar's market checklist
-- filters every live surface through these.

-- 1. Country on the Woo connections (site domain is authoritative).
update public.integration_connections
set config = jsonb_set(config, '{country_code}',
      to_jsonb(case when config->>'base_url' like '%sg.com' then 'SG' else 'MY' end))
where provider = 'WooCommerce' and config ? 'base_url';

-- 2. Market on ad accounts, inferred from account names.
alter table public.ad_accounts_read add column if not exists market text;
update public.ad_accounts_read
set market = case when name ilike '%sg%' then 'SG' else 'MY' end;

-- 3. Scorecard gains the market dimension (return type changes → drop first).
drop function if exists public.live_scorecard();
create function public.live_scorecard()
returns table (win text, brand_id bigint, market text, currency_code text, orders bigint, revenue numeric)
language sql
stable
set search_path = ''
as $$
  with tz as (select (now() at time zone 'Asia/Kuala_Lumpur')::date as today)
  select w.win, o.brand_id,
         coalesce(ic.config->>'country_code', '—') as market,
         o.currency_code, count(*)::bigint, sum(o.total)::numeric
  from public.orders_read o
  join public.integration_connections ic on ic.id = o.integration_id
  cross join tz
  cross join lateral (values
    ('today',     tz.today,      tz.today + 1),
    ('yesterday', tz.today - 1,  tz.today),
    ('d7',        tz.today - 6,  tz.today + 1),
    ('d30',       tz.today - 29, tz.today + 1)
  ) as w(win, from_d, to_d)
  where o.source_status in ('processing', 'completed')
    and o.placed_at is not null
    and (o.placed_at at time zone 'Asia/Kuala_Lumpur')::date >= w.from_d
    and (o.placed_at at time zone 'Asia/Kuala_Lumpur')::date < w.to_d
  group by w.win, o.brand_id, market, o.currency_code;
$$;

revoke execute on function public.live_scorecard() from public, anon;
grant execute on function public.live_scorecard() to authenticated, service_role;

-- 4. Customers gain a billing-country filter (new signature → drop the old
-- overload so PostgREST resolution stays unambiguous).
drop function if exists public.live_customers(integer, integer, text, bigint, text);
create function public.live_customers(
  p_page integer default 1,
  p_page_size integer default 50,
  p_search text default '',
  p_brand_id bigint default null,
  p_activity text default null,
  p_countries text[] default null
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
    and (p_countries is null or upper(coalesce(c.country, '')) = any(p_countries))
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

revoke execute on function public.live_customers(integer, integer, text, bigint, text, text[]) from public, anon;
grant execute on function public.live_customers(integer, integer, text, bigint, text, text[]) to authenticated;
