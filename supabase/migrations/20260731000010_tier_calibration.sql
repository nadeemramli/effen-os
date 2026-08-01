-- Calibrate value tiers to the actual customer-value distribution
-- (p75 = RM229, p95 = RM595, p99 = RM932, max = RM2,940 as of 2026-07-31):
-- vip >= 900 (~top 1%), high >= 600 (~top 5%), mid >= 230 (~top 25%).
-- Signature unchanged — body-only replace of the tier clauses.
create or replace function public.live_customers(
  p_page integer default 1,
  p_page_size integer default 50,
  p_search text default '',
  p_brand_id bigint default null,
  p_activity text default null,
  p_countries text[] default null,
  p_repeat text default null,
  p_tier text default null
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
  with scored as (
    select c.*,
           (select coalesce(sum(v.value::numeric), 0)
            from jsonb_each_text(coalesce(c.revenue_by_currency, '{}'::jsonb)) v) as revenue_total
    from private.customers_read c
  )
  select c.identity_key, c.display_name, c.phone, c.email, c.city, c.country,
         c.brand_ids, c.total_orders, c.recognized_orders,
         c.first_order_at, c.last_order_at, c.revenue_by_currency,
         count(*) over ()::bigint as total_count
  from scored c
  where (p_brand_id is null or c.brand_ids @> array[p_brand_id])
    and (p_countries is null or upper(coalesce(c.country, '')) = any(p_countries))
    and (v_needle is null
         or c.display_name ilike '%' || v_needle || '%'
         or c.phone ilike '%' || v_needle || '%'
         or c.email ilike '%' || v_needle || '%'
         or c.identity_key ilike '%' || regexp_replace(v_needle, '[^0-9a-z@._-]', '', 'gi') || '%')
    and (p_activity is null
         or (p_activity = 'new'         and c.first_order_at > now() - interval '30 days' and c.total_orders = 1)
         or (p_activity = 'active'      and c.last_order_at  > now() - interval '30 days')
         or (p_activity = 'at_risk'     and c.last_order_at <= now() - interval '30 days' and c.last_order_at > now() - interval '90 days')
         or (p_activity = 'dormant'     and c.last_order_at <= now() - interval '90 days')
         or (p_activity = 'provisional' and c.last_order_at is null))
    and (p_repeat is null
         or (p_repeat = 'first_time' and c.total_orders = 1)
         or (p_repeat = 'repeat'     and c.total_orders between 2 and 4)
         or (p_repeat = 'loyal'      and c.total_orders >= 5))
    and (p_tier is null
         or (p_tier = 'vip'  and c.revenue_total >= 900)
         or (p_tier = 'high' and c.revenue_total >= 600 and c.revenue_total < 900)
         or (p_tier = 'mid'  and c.revenue_total >= 230 and c.revenue_total < 600)
         or (p_tier = 'low'  and c.revenue_total < 230))
  order by c.last_order_at desc nulls last
  limit greatest(p_page_size, 1)
  offset (greatest(p_page, 1) - 1) * greatest(p_page_size, 1);
end;
$$;
