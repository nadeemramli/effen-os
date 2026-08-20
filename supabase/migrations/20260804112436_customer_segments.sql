-- Customer classification + segment engine.
--
-- Two new deterministic classes on the identity model:
--   reseller  — ≥4 distinct recipient names under one identity (buying for
--               others) OR ≥10 lifetime orders.
--   joy_buyer — competitor funnel-testers: at least one order with
--               test/gibberish details AND every order COD AND ≤3 orders.
--               Detail heuristics are word-based (test/tester, keyboard-mash
--               runs, name pasted as address, disposable email, 7+ repeated
--               phone digits) — deliberately NOT address-length rules, which
--               false-positive on legitimate SG block addresses.
-- Signals are exposed as columns so segments can filter on the raw numbers,
-- not just the label. Segments themselves are saved_views rows
-- (route_key = 'customers.segment', shareable workspace-wide).
-- See docs/decisions/0005-customer-segments.md.

-- ── Rebuild the identity read-model with signal columns ─────────────────────
drop materialized view if exists private.customers_read;
create materialized view private.customers_read as
with base as (
  select o.workspace_id,
    coalesce(
      nullif(regexp_replace(coalesce(o.customer->>'phone', ''), '[^0-9]', '', 'g'), ''),
      nullif(lower(coalesce(o.customer->>'email', '')), '')
    ) as identity_key,
    nullif(o.customer->>'name', '') as name,
    nullif(o.customer->>'phone', '') as phone,
    nullif(lower(o.customer->>'email'), '') as email,
    nullif(o.customer->>'city', '') as city,
    nullif(o.customer->>'country', '') as country,
    o.brand_id,
    o.currency_code,
    o.total::numeric as total,
    o.source_status,
    o.placed_at,
    (o.raw->>'payment_method' = 'cod') as is_cod,
    (
      coalesce(o.customer->>'name', '') ~* '\mtest(ing|er)?\M'
      or coalesce(o.raw->'billing'->>'address_1', '') ~* '\mtest(ing|er)?\M'
      or (nullif(trim(coalesce(o.customer->>'name', '')), '') is not null
          and lower(trim(o.customer->>'name')) = lower(trim(coalesce(o.raw->'billing'->>'address_1', ''))))
      or coalesce(o.customer->>'name', '') ~* 'asdf|qwer|zxcv|sdfg|wert|xcvb'
      or coalesce(o.raw->'billing'->>'address_1', '') ~* 'asdf|qwer|zxcv|sdfg|wert|xcvb'
      or coalesce(o.customer->>'name', '') ~* '([a-z])\1\1\1'
      or coalesce(o.customer->>'email', '') ~* '(^test@|@(test|example|mailinator)\.)'
      or regexp_replace(coalesce(o.customer->>'phone', ''), '[^0-9]', '', 'g') ~ '(\d)\1{6,}'
    ) as suspect
  from public.orders_read o
  where o.customer is not null
),
keyed as (
  select * from base where identity_key is not null
),
per_ccy as (
  select identity_key, currency_code,
         sum(total) filter (where source_status in ('processing', 'completed')) as revenue
  from keyed
  group by identity_key, currency_code
),
ccy_agg as (
  select identity_key,
         jsonb_object_agg(currency_code, round(revenue, 2)) filter (where revenue is not null) as revenue_by_currency
  from per_ccy
  group by identity_key
),
grouped as (
  select identity_key,
    min(workspace_id) as workspace_id,
    (array_agg(name order by placed_at desc nulls last) filter (where name is not null))[1] as display_name,
    (array_agg(phone order by placed_at desc nulls last) filter (where phone is not null))[1] as phone,
    (array_agg(email order by placed_at desc nulls last) filter (where email is not null))[1] as email,
    (array_agg(city order by placed_at desc nulls last) filter (where city is not null))[1] as city,
    (array_agg(country order by placed_at desc nulls last) filter (where country is not null))[1] as country,
    array_agg(distinct brand_id) filter (where brand_id is not null) as brand_ids,
    count(*) as total_orders,
    count(*) filter (where source_status in ('processing', 'completed')) as recognized_orders,
    count(*) filter (where is_cod) as cod_orders,
    count(*) filter (where suspect) as suspect_orders,
    count(*) filter (where source_status in ('cancelled', 'failed', 'refunded')) as cancelled_orders,
    count(distinct lower(trim(name))) filter (where name is not null) as distinct_names,
    min(placed_at) as first_order_at,
    max(placed_at) as last_order_at
  from keyed
  group by identity_key
),
final as (
  select g.*, c.revenue_by_currency,
    coalesce((select sum(v.value::numeric) from jsonb_each_text(coalesce(c.revenue_by_currency, '{}'::jsonb)) v), 0) as revenue_total
  from grouped g
  left join ccy_agg c using (identity_key)
)
select f.*,
  case
    when f.suspect_orders > 0 and f.cod_orders = f.total_orders and f.total_orders <= 3 then 'joy_buyer'
    when f.distinct_names >= 4 or f.total_orders >= 10 then 'reseller'
    else 'regular'
  end as classification
from final f;

create unique index customers_read_identity_key_uidx on private.customers_read (identity_key);
create index customers_read_classification_idx on private.customers_read (classification);
create index customers_read_last_order_idx on private.customers_read (last_order_at desc nulls last);

-- ── live_customers v2: whitelisted declarative conditions ───────────────────
-- p_conditions: [{field, op, value}, …], AND-combined. Fields and ops are
-- whitelisted in the CASE below — never raw SQL from the client. An unknown
-- field matches nothing (safe default).
drop function if exists public.live_customers(integer, integer, text, bigint, text, text[], text, text);
create function public.live_customers(
  p_page integer default 1,
  p_page_size integer default 50,
  p_search text default '',
  p_brand_id bigint default null,
  p_countries text[] default null,
  p_conditions jsonb default null
)
returns table(
  identity_key text, display_name text, phone text, email text, city text, country text,
  brand_ids bigint[], total_orders bigint, recognized_orders bigint,
  cod_orders bigint, suspect_orders bigint, cancelled_orders bigint, distinct_names bigint,
  first_order_at timestamptz, last_order_at timestamptz,
  revenue_by_currency jsonb, revenue_total numeric, classification text,
  total_count bigint
)
language plpgsql stable security definer set search_path to ''
as $function$
declare
  v_needle text := nullif(trim(p_search), '');
begin
  if not private.is_workspace_member((select min(id) from public.workspaces)) then
    raise exception 'Not a workspace member';
  end if;
  return query
  select c.identity_key, c.display_name, c.phone, c.email, c.city, c.country,
         c.brand_ids, c.total_orders, c.recognized_orders,
         c.cod_orders, c.suspect_orders, c.cancelled_orders, c.distinct_names,
         c.first_order_at, c.last_order_at,
         c.revenue_by_currency, c.revenue_total, c.classification,
         count(*) over ()::bigint as total_count
  from private.customers_read c
  where (p_brand_id is null or c.brand_ids @> array[p_brand_id])
    and (p_countries is null or upper(coalesce(c.country, '')) = any(p_countries))
    and (v_needle is null
         or c.display_name ilike '%' || v_needle || '%'
         or c.phone ilike '%' || v_needle || '%'
         or c.email ilike '%' || v_needle || '%'
         or c.identity_key ilike '%' || regexp_replace(v_needle, '[^0-9a-z@._-]', '', 'gi') || '%')
    and (p_conditions is null or jsonb_typeof(p_conditions) <> 'array' or not exists (
      select 1
      from jsonb_array_elements(p_conditions) as cond
      cross join lateral (
        select case cond->>'field'
          when 'total_orders' then c.total_orders::numeric
          when 'recognized_orders' then c.recognized_orders::numeric
          when 'cod_orders' then c.cod_orders::numeric
          when 'suspect_orders' then c.suspect_orders::numeric
          when 'cancelled_orders' then c.cancelled_orders::numeric
          when 'distinct_names' then c.distinct_names::numeric
          when 'revenue_total' then c.revenue_total
          when 'cod_share' then case when c.total_orders > 0 then round(100.0 * c.cod_orders / c.total_orders, 1) else 0 end
          when 'last_order_days' then case when c.last_order_at is null then null else extract(epoch from now() - c.last_order_at) / 86400 end
          when 'first_order_days' then case when c.first_order_at is null then null else extract(epoch from now() - c.first_order_at) / 86400 end
          else null
        end as num_val
      ) nv
      where not (
        case cond->>'field'
          when 'activity' then (cond->>'value') = (
            case
              when c.last_order_at is null then 'provisional'
              when c.first_order_at > now() - interval '30 days' and c.total_orders = 1 then 'new'
              when c.last_order_at > now() - interval '30 days' then 'active'
              when c.last_order_at > now() - interval '90 days' then 'at_risk'
              else 'dormant'
            end)
          when 'repeat' then (cond->>'value') = (
            case when c.total_orders >= 5 then 'loyal' when c.total_orders >= 2 then 'repeat' else 'first_time' end)
          when 'tier' then (cond->>'value') = (
            case when c.revenue_total >= 900 then 'vip' when c.revenue_total >= 600 then 'high' when c.revenue_total >= 230 then 'mid' else 'low' end)
          when 'classification' then (cond->>'value') = c.classification
          when 'country' then upper(coalesce(c.country, '')) in (
            select upper(x.value) from jsonb_array_elements_text(coalesce(cond->'value', '[]'::jsonb)) x)
          else nv.num_val is not null and (
            case cond->>'op'
              when 'gte' then nv.num_val >= (cond->>'value')::numeric
              when 'lte' then nv.num_val <= (cond->>'value')::numeric
              when 'eq'  then nv.num_val = (cond->>'value')::numeric
              else false
            end)
        end)
    ))
  order by c.last_order_at desc nulls last
  limit greatest(p_page_size, 1)
  offset (greatest(p_page, 1) - 1) * greatest(p_page_size, 1);
end;
$function$;

revoke all on function public.live_customers(integer, integer, text, bigint, text[], jsonb) from public, anon;
grant execute on function public.live_customers(integer, integer, text, bigint, text[], jsonb) to authenticated, service_role;

-- ── Segments live in saved_views; owners can now update/delete their own ────
drop policy if exists own_views_update on public.saved_views;
create policy own_views_update on public.saved_views
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists own_views_delete on public.saved_views;
create policy own_views_delete on public.saved_views
  for delete to authenticated
  using (user_id = (select auth.uid()));
