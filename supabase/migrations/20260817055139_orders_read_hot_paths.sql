-- Orders / Catalog / Inventory timed out (57014) after orders_read grew to
-- 280k rows with the fighter history import. Measured as `authenticated`:
--
--   GET /orders_read?order=placed_at.desc.nullslast,id.desc   2.1s (+4s count)
--     the (placed_at DESC, id DESC) index is NULLS FIRST, so the nullslast
--     order forced a full sort of every row incl. `raw`.
--   live_unit_economics                                       8.7s timeout
--     the only date predicate was (placed_at at time zone KL)::date >= …,
--     which no index can serve → full scan + unnest of every items array.
--   live_sku_mapping_queue                                    8.8s timeout
--     array_agg(name ORDER BY placed_at) + count(distinct) made the planner
--     walk the whole table through orders_read_integration_placed_idx
--     (280k random heap reads) and spill an external sort: 21s even as
--     postgres.
--
-- Fixes below keep every result identical; only the plans change.

-- ── Orders list: index that matches the app's order clause exactly ─────────
create index if not exists orders_read_placed_nulls_last_id_idx
  on public.orders_read (placed_at desc nulls last, id desc);

-- ── live_unit_economics: add a sargable bound alongside the MYT date filter ─
create or replace function public.live_unit_economics()
returns table(win text, brand_id bigint, market text, currency_code text, revenue numeric, orders bigint, units numeric, mapped_units numeric, costed_units numeric, cogs numeric)
language sql
stable
set search_path to ''
set statement_timeout to '30s'
as $function$
  with tz as (select (now() at time zone 'Asia/Kuala_Lumpur')::date as today),
  lines as (
    select o.id, o.brand_id, o.currency_code, o.placed_at, o.integration_id,
           coalesce(ic.config->>'country_code', '—') as market,
           (o.placed_at at time zone 'Asia/Kuala_Lumpur')::date as placed_d,
           it.sku, it.qty, it.line_total
    from public.orders_read o
    join public.integration_connections ic on ic.id = o.integration_id
    cross join lateral (
      select e->>'sku' as sku,
             coalesce(nullif(e->>'quantity','')::numeric, 1) as qty,
             coalesce(nullif(e->>'total','')::numeric, 0) as line_total
      from jsonb_array_elements(o.items) e
    ) it
    where o.source_status in ('processing', 'completed')
      and o.placed_at is not null
      -- Index-servable bound (orders_read_status_placed_idx); the exact MYT
      -- day boundary below still decides membership.
      and o.placed_at >= now() - interval '31 days'
      and (o.placed_at at time zone 'Asia/Kuala_Lumpur')::date >= (select today from tz) - 29
  ),
  enriched as (
    select l.*, va.variant_id, cc.cost, cc.cost_currency
    from lines l
    left join public.variant_aliases va
      on va.integration_id = l.integration_id and va.alias = l.sku
    left join lateral (
      select vc.cost, vc.currency_code as cost_currency
      from public.variant_costs vc
      where vc.variant_id = va.variant_id and vc.effective_from <= l.placed_d
      order by vc.effective_from desc limit 1
    ) cc on va.variant_id is not null
  )
  select w.win, e.brand_id, e.market, e.currency_code,
         sum(e.line_total) as revenue,
         count(distinct e.id) as orders,
         sum(e.qty) as units,
         coalesce(sum(e.qty) filter (where e.variant_id is not null), 0) as mapped_units,
         coalesce(sum(e.qty) filter (where e.cost is not null and e.cost_currency = e.currency_code), 0) as costed_units,
         coalesce(sum(e.cost * e.qty) filter (where e.cost is not null and e.cost_currency = e.currency_code), 0) as cogs
  from enriched e
  cross join tz
  cross join lateral (values
    ('today', tz.today,      tz.today + 1),
    ('d7',    tz.today - 6,  tz.today + 1),
    ('d30',   tz.today - 29, tz.today + 1)
  ) as w(win, from_d, to_d)
  where e.placed_d >= w.from_d and e.placed_d < w.to_d
  group by w.win, e.brand_id, e.market, e.currency_code;
$function$;

-- ── live_sku_mapping_queue: hash-friendly aggregate, name via index probe ──
create or replace function public.live_sku_mapping_queue()
returns table(integration_id bigint, brand_id bigint, market text, currency_code text, store_sku text, item_name text, units numeric, orders bigint, last_sold_at timestamptz, published boolean, store_price numeric, store_status text)
language sql
stable
set search_path to ''
set statement_timeout to '30s'
as $function$
  with lines as (
    -- One row per (order, sku): qty summed if a SKU repeats within an order.
    select o.integration_id, it.sku, o.id as order_id,
           max(o.brand_id) as brand_id, max(o.currency_code) as ccy,
           max(o.placed_at) as placed_at, sum(it.qty) as qty
    from public.orders_read o
    cross join lateral (
      select e->>'sku' as sku,
             coalesce(nullif(e->>'quantity','')::numeric, 1) as qty
      from jsonb_array_elements(o.items) e
    ) it
    where nullif(it.sku, '') is not null
    group by o.integration_id, it.sku, o.id
  ),
  sold as (
    -- Plain aggregates only → HashAggregate, no ORDER BY / DISTINCT inside.
    select l.integration_id, l.sku,
           max(l.brand_id) as brand_id,
           max(l.ccy) as ccy,
           sum(l.qty) as units,
           count(*) as orders,
           max(l.placed_at) as last_sold_at
    from lines l
    group by l.integration_id, l.sku
  ),
  named as (
    -- Item name as it appeared on the newest order that carried the SKU:
    -- one probe on orders_read_integration_placed_idx per (store, sku).
    select s.*, nm.name as item_name
    from sold s
    left join lateral (
      select e->>'name' as name
      from public.orders_read o2
      cross join lateral jsonb_array_elements(o2.items) e
      where o2.integration_id = s.integration_id
        and o2.placed_at = s.last_sold_at
        and e->>'sku' = s.sku
      limit 1
    ) nm on true
  ),
  published as (
    select wp.integration_id, wp.sku,
           (array_agg(wp.name order by wp.updated_at_source desc nulls last))[1] as name,
           (array_agg(wp.price order by wp.updated_at_source desc nulls last))[1] as price,
           (array_agg(wp.status order by wp.updated_at_source desc nulls last))[1] as status
    from public.woo_products_read wp
    where nullif(wp.sku, '') is not null and wp.status = 'publish'
    group by wp.integration_id, wp.sku
  ),
  merged as (
    select coalesce(s.integration_id, p.integration_id) as integration_id,
           coalesce(s.sku, p.sku) as sku,
           s.brand_id, s.ccy,
           coalesce(p.name, s.item_name) as item_name,
           coalesce(s.units, 0) as units,
           coalesce(s.orders, 0) as orders,
           s.last_sold_at,
           (p.sku is not null) as published,
           p.price as store_price,
           p.status as store_status
    from named s
    full outer join published p
      on p.integration_id = s.integration_id and p.sku = s.sku
  )
  select m.integration_id, m.brand_id,
         coalesce(ic.config->>'country_code', '—') as market,
         coalesce(m.ccy, case when ic.config->>'country_code' = 'SG' then 'SGD' else 'MYR' end) as currency_code,
         m.sku, m.item_name, m.units, m.orders, m.last_sold_at,
         m.published, m.store_price, m.store_status
  from merged m
  join public.integration_connections ic on ic.id = m.integration_id
  where not exists (
    select 1 from public.variant_aliases va
    where va.integration_id = m.integration_id and va.alias = m.sku
  )
  order by m.units desc nulls last;
$function$;

-- ── Fulfilment readiness: near the cap (3–8s over a 14-day window); give it
-- headroom rather than a surprise 57014 on a cold cache.
-- (Only the top-level RPC: a SET clause on the nested ship_grades() would
-- stop it inlining into this query.)
alter function public.live_ship_readiness(integer) set statement_timeout to '30s';

-- Grants unchanged (create or replace keeps them); restate for the record.
revoke all on function public.live_unit_economics() from public, anon;
grant execute on function public.live_unit_economics() to authenticated, service_role;
revoke all on function public.live_sku_mapping_queue() from public, anon;
grant execute on function public.live_sku_mapping_queue() to authenticated, service_role;
