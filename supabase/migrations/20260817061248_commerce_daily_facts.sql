-- Commerce daily facts: the pre-aggregated spine for range P&L.
--
-- Why: live_contribution_range scanned orders_read per call. After the
-- payment_method column (20260817000004) a 30-day window is ~2s, but a
-- 1-year window is still ~26s of random heap I/O on this compute tier —
-- and Marketing/Profit ask for 7d…1y windows on every load. One row per
-- MYT day × store × brand × currency turns any range into a sum over
-- ≤400 × stores rows. This is the first slice of S4 "fct_order_economics".
--
-- Freshness: private.refresh_commerce_daily_recent() recomputes every MYT
-- day touched by orders synced in the last 30 minutes (plus today and
-- yesterday) — status changes on old orders re-aggregate their day, not
-- the whole table. Cron every 15 minutes; initial backfill ran in monthly
-- chunks via the Management API (2023-01 → 2026-08).
--
-- Market is NOT stored — it is joined from integration_connections at read
-- time so a config change re-labels history; east_orders is evaluated at
-- refresh time (postcode zone), which is stable.

create table if not exists private.commerce_daily (
  day date not null,
  integration_id bigint not null,
  brand_key bigint not null,          -- coalesce(orders_read.brand_id, 0)
  currency_code text not null,
  orders bigint not null,
  cod_orders bigint not null,
  east_orders bigint not null,
  revenue numeric not null,
  base_units numeric not null,        -- pack-expanded units (units_per_pack)
  unmapped_lines numeric not null,    -- line qty with no variant alias
  refreshed_at timestamptz not null default now(),
  primary key (day, integration_id, brand_key, currency_code)
);
create index if not exists commerce_daily_day_idx on private.commerce_daily (day);
revoke all on table private.commerce_daily from public, anon, authenticated;

-- Incremental refresh looks up "days touched since": index the sync stamp.
create index if not exists orders_read_synced_at_idx on public.orders_read (synced_at);

-- ── Recompute an inclusive MYT day range ────────────────────────────────────
create or replace function private.refresh_commerce_daily(p_from date, p_to date)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_n integer;
begin
  delete from private.commerce_daily where day between p_from and p_to;

  with base as (
    select (o.placed_at at time zone 'Asia/Kuala_Lumpur')::date as day,
           o.integration_id,
           coalesce(o.brand_id, 0) as brand_key,
           o.currency_code, o.total, o.items,
           (o.payment_method = 'cod') as is_cod,
           (coalesce(ic.config->>'country_code','') = 'MY'
             and substring(o.customer->>'postcode' from 1 for 2)
                 in ('87','88','89','90','91','93','94','95','96','97','98')) as is_east
    from public.orders_read o
    join public.integration_connections ic on ic.id = o.integration_id
    where o.source_status in ('processing','completed')
      and o.placed_at >= (p_from::timestamp at time zone 'Asia/Kuala_Lumpur')
      and o.placed_at < ((p_to + 1)::timestamp at time zone 'Asia/Kuala_Lumpur')
  ),
  units as (
    select b.day, b.integration_id, b.brand_key, b.currency_code,
           sum(it.qty * coalesce(v.units_per_pack, 1)) as base_units,
           coalesce(sum(it.qty) filter (where va.variant_id is null), 0) as unmapped_lines
    from base b
    cross join lateral (
      select e->>'sku' as sku, coalesce(nullif(e->>'quantity','')::numeric, 1) as qty
      from jsonb_array_elements(b.items) e
    ) it
    left join public.variant_aliases va
      on va.integration_id = b.integration_id and va.alias = it.sku
    left join public.product_variants v on v.id = va.variant_id
    group by b.day, b.integration_id, b.brand_key, b.currency_code
  ),
  agg as (
    select day, integration_id, brand_key, currency_code,
           count(*) as orders,
           count(*) filter (where is_cod) as cod_orders,
           count(*) filter (where is_east) as east_orders,
           sum(total) as revenue
    from base
    group by day, integration_id, brand_key, currency_code
  )
  insert into private.commerce_daily
    (day, integration_id, brand_key, currency_code, orders, cod_orders, east_orders,
     revenue, base_units, unmapped_lines, refreshed_at)
  select a.day, a.integration_id, a.brand_key, a.currency_code,
         a.orders, a.cod_orders, a.east_orders, a.revenue,
         coalesce(u.base_units, 0), coalesce(u.unmapped_lines, 0), now()
  from agg a
  left join units u
    on u.day = a.day and u.integration_id = a.integration_id
   and u.brand_key = a.brand_key and u.currency_code = a.currency_code;

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- ── Incremental: every day touched by recent syncs, plus today/yesterday ────
create or replace function private.refresh_commerce_daily_recent(p_lookback interval default interval '30 minutes')
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_day date;
  v_total integer := 0;
begin
  for v_day in
    select distinct d from (
      select (o.placed_at at time zone 'Asia/Kuala_Lumpur')::date as d
      from public.orders_read o
      where o.synced_at >= now() - p_lookback
        and o.placed_at is not null
      union
      select (now() at time zone 'Asia/Kuala_Lumpur')::date
      union
      select (now() at time zone 'Asia/Kuala_Lumpur')::date - 1
    ) s
    order by d
  loop
    v_total := v_total + private.refresh_commerce_daily(v_day, v_day);
  end loop;
  return v_total;
end;
$$;

select cron.schedule(
  'commerce-daily-refresh',
  '3,18,33,48 * * * *',
  $$set statement_timeout = '5min'; select private.refresh_commerce_daily_recent()$$
);

-- ── live_contribution_range v3: sum the spine ───────────────────────────────
-- Same shape as before (+ refreshed_at). Reads private.* so it becomes
-- SECURITY DEFINER with the workspace-member gate, like live_customers.
create or replace function public.live_contribution_range(p_from date, p_to date)
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
set statement_timeout to '30s'
as $function$
declare
  v_out jsonb;
begin
  if not private.is_workspace_member((select min(id) from public.workspaces)) then
    raise exception 'Not a workspace member';
  end if;
  if p_to < p_from or p_to - p_from > 400 then
    return jsonb_build_object('rules', null, 'rows', '[]'::jsonb, 'refreshed_at', null);
  end if;

  with rules as (
    select * from public.contribution_cost_rules
    where effective_from <= p_to
    order by effective_from desc limit 1
  ),
  agg as (
    select nullif(cd.brand_key, 0) as brand_id,
           coalesce(ic.config->>'country_code', '—') as market,
           cd.currency_code,
           sum(cd.orders) as orders,
           sum(cd.cod_orders) as cod_orders,
           sum(cd.east_orders) as east_orders,
           sum(cd.revenue) as revenue,
           sum(cd.base_units) as base_units,
           sum(cd.unmapped_lines) as unmapped_lines,
           max(cd.refreshed_at) as refreshed_at
    from private.commerce_daily cd
    join public.integration_connections ic on ic.id = cd.integration_id
    where cd.day between p_from and p_to
    group by 1, 2, 3
  ),
  rts as (
    select s.brand_id, count(*) as rts_parcels
    from public.nv_shipments s
    where s.status ilike '%return%'
      and s.last_event_at >= (p_from::timestamp at time zone 'Asia/Kuala_Lumpur')
      and s.last_event_at < ((p_to + 1)::timestamp at time zone 'Asia/Kuala_Lumpur')
    group by s.brand_id
  )
  select jsonb_build_object(
    'rules', (select to_jsonb(r) - 'workspace_id' - 'id' from rules r),
    'refreshed_at', (select max(a.refreshed_at) from agg a),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'brand_id', a.brand_id,
        'market', a.market,
        'currency_code', a.currency_code,
        'orders', a.orders,
        'cod_orders', a.cod_orders,
        'east_orders', a.east_orders,
        'revenue', a.revenue,
        'base_units', a.base_units,
        'unmapped_lines', a.unmapped_lines,
        'rts_parcels', case when a.market = 'MY' then coalesce(t.rts_parcels, 0) else 0 end,
        'cogs_myr', round(a.base_units * r.unit_cost_myr, 2),
        'delivery_myr', case when a.market = 'SG'
          then round(a.orders * r.delivery_sg_myr, 2)
          else round((a.orders - a.east_orders) * r.delivery_my_west
                     + a.east_orders * r.delivery_my_east, 2) end,
        'returns_myr', case when a.market = 'MY' and a.orders > 0
          then round(coalesce(t.rts_parcels, 0) * (
                 (a.orders - a.east_orders)::numeric / a.orders * r.delivery_my_west
                 + a.east_orders::numeric / a.orders * r.delivery_my_east), 2)
          else 0 end,
        'cod_myr', round(a.cod_orders * r.cod_fee, 2)
      ) order by a.revenue desc)
      from agg a
      cross join rules r
      left join rts t on t.brand_id = a.brand_id
    ), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$function$;

revoke all on function public.live_contribution_range(date, date) from public, anon;
grant execute on function public.live_contribution_range(date, date) to authenticated, service_role;
