-- live_contribution_range: read COD from orders_read.payment_method (see
-- 20260817000004) instead of raw->>'payment_method', and give the RPC its
-- own 30s ceiling. Same output, same rules; only the plan changes — the
-- Profit page and Marketing depend on 30d–1y windows returning.
create or replace function public.live_contribution_range(p_from date, p_to date)
returns jsonb
language sql
stable
set search_path to ''
set statement_timeout to '30s'
as $function$
  with rules as (
    select * from public.contribution_cost_rules
    where effective_from <= p_to
    order by effective_from desc limit 1
  ),
  base as (
    select o.brand_id,
           coalesce(ic.config->>'country_code', '—') as market,
           o.currency_code, o.total, o.integration_id, o.items,
           (o.payment_method = 'cod') as is_cod,
           (coalesce(ic.config->>'country_code','') = 'MY'
             and substring(o.customer->>'postcode' from 1 for 2)
                 in ('87','88','89','90','91','93','94','95','96','97','98')) as is_east
    from public.orders_read o
    join public.integration_connections ic on ic.id = o.integration_id
    where p_to >= p_from and p_to - p_from <= 400
      and o.source_status in ('processing','completed')
      and o.placed_at >= (p_from::timestamp at time zone 'Asia/Kuala_Lumpur')
      and o.placed_at < ((p_to + 1)::timestamp at time zone 'Asia/Kuala_Lumpur')
  ),
  units as (
    select b.brand_id, b.market, b.currency_code,
           sum(it.qty * coalesce(v.units_per_pack, 1)) as base_units,
           sum(it.qty) filter (where va.variant_id is null) as unmapped_lines
    from base b
    cross join lateral (
      select e->>'sku' as sku, coalesce(nullif(e->>'quantity','')::numeric, 1) as qty
      from jsonb_array_elements(b.items) e
    ) it
    left join public.variant_aliases va
      on va.integration_id = b.integration_id and va.alias = it.sku
    left join public.product_variants v on v.id = va.variant_id
    group by b.brand_id, b.market, b.currency_code
  ),
  agg as (
    select brand_id, market, currency_code,
           count(*) as orders,
           count(*) filter (where is_cod) as cod_orders,
           count(*) filter (where is_east) as east_orders,
           sum(total) as revenue
    from base
    group by brand_id, market, currency_code
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
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'brand_id', a.brand_id,
        'market', a.market,
        'currency_code', a.currency_code,
        'orders', a.orders,
        'cod_orders', a.cod_orders,
        'east_orders', a.east_orders,
        'revenue', a.revenue,
        'base_units', coalesce(u.base_units, 0),
        'unmapped_lines', coalesce(u.unmapped_lines, 0),
        'rts_parcels', case when a.market = 'MY' then coalesce(t.rts_parcels, 0) else 0 end,
        'cogs_myr', round(coalesce(u.base_units, 0) * r.unit_cost_myr, 2),
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
      left join units u on u.brand_id is not distinct from a.brand_id
        and u.market = a.market and u.currency_code = a.currency_code
      left join rts t on t.brand_id = a.brand_id
    ), '[]'::jsonb)
  );
$function$;
