-- Customer CSV export: server-side join, deterministic paging, own timeout.
--
-- Why: the browser export paged live_customers (full-MV window count per
-- page) and then hydrated addresses via live_customer_addresses in 5,000-key
-- batches. Measured in prod (166k identities, 280k orders): the address batch
-- took 7.5s cold → 57014 statement timeout under authenticated's 8s cap, and
-- when warm PostgREST's max_rows=1000 silently truncated 5,000 keys to 1,000
-- rows (blank addresses). Ordering had no tiebreak, so offset pages could
-- duplicate/skip identities.
--
-- Fix: private.latest_address(identity_key) does one index probe per key on
-- orders_read_identity_expr_idx (~0.02ms); live_customers_export returns
-- customer + address in one row, ≤1000 rows/page (PostgREST max_rows), no
-- window count (client already knows total), tiebreak on identity_key, and
-- a function-level 30s statement_timeout (honored by the REST API).

-- ── private.latest_address: latest order's delivery address, correction-overlaid
create or replace function private.latest_address(p_identity_key text)
returns table (
  name text, phone text,
  address_1 text, address_2 text, city text, state text,
  postcode text, country text, order_number text, placed_at timestamptz,
  corrected boolean
)
language sql
stable
set search_path = ''
as $$
  select
    coalesce(oc.corrected->>'name', r.customer->>'name'),
    coalesce(oc.corrected->>'phone', r.customer->>'phone'),
    coalesce(oc.corrected->>'address_1',
      nullif(r.raw->'shipping'->>'address_1', ''), r.raw->'billing'->>'address_1'),
    coalesce(nullif(r.raw->'shipping'->>'address_2', ''), r.raw->'billing'->>'address_2'),
    coalesce(oc.corrected->>'city', nullif(r.raw->'shipping'->>'city', ''), r.customer->>'city'),
    coalesce(nullif(r.raw->'shipping'->>'state', ''), r.raw->'billing'->>'state'),
    coalesce(oc.corrected->>'postcode',
      nullif(r.raw->'shipping'->>'postcode', ''), r.customer->>'postcode'),
    coalesce(nullif(r.raw->'shipping'->>'country', ''), r.customer->>'country'),
    r.order_number,
    r.placed_at,
    (oc.id is not null)
  from public.orders_read r
  left join public.order_corrections oc
    on oc.order_read_id = r.id and oc.status in ('staged','applied')
  where public.identity_key(r.customer, r.raw) = p_identity_key
  order by r.placed_at desc
  limit 1
$$;

revoke all on function private.latest_address(text) from public, anon, authenticated;

-- ── live_customers: tiebreak + page-size clamp (body otherwise unchanged) ───
-- Keep the WHERE block identical to live_customers_export below.
create or replace function public.live_customers(
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
  address_key text, shared_address_count bigint,
  total_count bigint
)
language plpgsql stable security definer set search_path to ''
as $function$
declare
  v_needle text := nullif(trim(p_search), '');
  v_size integer := least(greatest(p_page_size, 1), 1000);
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
         c.address_key, c.shared_address_count,
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
          when 'shared_address_count' then coalesce(c.shared_address_count, 1)::numeric
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
  order by c.last_order_at desc nulls last, c.identity_key
  limit v_size
  offset (greatest(p_page, 1) - 1) * v_size;
end;
$function$;

-- ── live_customers_export: customer + latest address in one row ─────────────
-- Same filter semantics as live_customers (keep the WHERE blocks in lockstep).
-- No total_count (the page already knows it), ≤1000 rows/page, deterministic
-- order, and its own statement_timeout so a cold cache cannot 57014 the export.
create or replace function public.live_customers_export(
  p_page integer default 1,
  p_page_size integer default 1000,
  p_search text default '',
  p_brand_id bigint default null,
  p_countries text[] default null,
  p_conditions jsonb default null,
  p_with_address boolean default true
)
returns table(
  identity_key text, display_name text, phone text, email text, city text, country text,
  brand_ids bigint[], total_orders bigint, recognized_orders bigint,
  cod_orders bigint, suspect_orders bigint, cancelled_orders bigint, distinct_names bigint,
  first_order_at timestamptz, last_order_at timestamptz,
  revenue_by_currency jsonb, revenue_total numeric, classification text,
  address_key text, shared_address_count bigint,
  address_1 text, address_2 text, addr_city text, addr_state text,
  postcode text, addr_country text, address_order_number text, address_placed_at timestamptz,
  address_corrected boolean
)
language plpgsql stable security definer
set search_path to ''
set statement_timeout to '30s'
as $function$
declare
  v_needle text := nullif(trim(p_search), '');
  v_size integer := least(greatest(p_page_size, 1), 1000);
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
         c.address_key, c.shared_address_count,
         a.address_1, a.address_2, a.city, a.state,
         a.postcode, a.country, a.order_number, a.placed_at, a.corrected
  from (
    select c.*
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
            when 'shared_address_count' then coalesce(c.shared_address_count, 1)::numeric
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
    order by c.last_order_at desc nulls last, c.identity_key
    limit v_size
    offset (greatest(p_page, 1) - 1) * v_size
  ) c
  left join lateral private.latest_address(c.identity_key) a on p_with_address
  order by c.last_order_at desc nulls last, c.identity_key;
end;
$function$;

-- ── live_customer_addresses: same shape, index-probe body, PostgREST-honest cap
-- Kept for the profile page/tools; PostgREST max_rows=1000 means callers must
-- batch ≤1000 keys — the guard now says so instead of silently truncating.
create or replace function public.live_customer_addresses(p_identity_keys text[])
returns table (
  identity_key text, name text, phone text,
  address_1 text, address_2 text, city text, state text,
  postcode text, country text, order_number text, placed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout to '30s'
as $$
begin
  if not private.is_workspace_member((select min(id) from public.workspaces)) then
    raise exception 'Not a workspace member';
  end if;
  if p_identity_keys is null or array_length(p_identity_keys, 1) is null then
    return;
  end if;
  if array_length(p_identity_keys, 1) > 1000 then
    raise exception 'Too many identities in one call (max 1,000 — PostgREST max_rows)';
  end if;

  return query
  select k.key, a.name, a.phone, a.address_1, a.address_2, a.city, a.state,
         a.postcode, a.country, a.order_number, a.placed_at
  from unnest(p_identity_keys) as k(key)
  cross join lateral private.latest_address(k.key) a;
end;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
revoke all on function public.live_customers(integer, integer, text, bigint, text[], jsonb) from public, anon;
grant execute on function public.live_customers(integer, integer, text, bigint, text[], jsonb) to authenticated, service_role;

revoke all on function public.live_customers_export(integer, integer, text, bigint, text[], jsonb, boolean) from public, anon;
grant execute on function public.live_customers_export(integer, integer, text, bigint, text[], jsonb, boolean) to authenticated, service_role;

revoke all on function public.live_customer_addresses(text[]) from public, anon;
grant execute on function public.live_customer_addresses(text[]) to authenticated, service_role;
