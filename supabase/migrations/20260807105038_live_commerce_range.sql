-- live_commerce_range(p_from, p_to) — recognized revenue, orders, units and
-- COGS for an ARBITRARY inclusive date range (MYT days), per brand × market
-- × currency. Powers the extended top-bar date filter (90d / 12 months /
-- custom picker); the fixed-window live_scorecard / live_unit_economics
-- remain for the classic today/7d/30d paths and their baseline pairing.
-- SECURITY INVOKER like live_scorecard: orders_read RLS authorizes callers.
-- Range capped at 400 days to bound the scan.

create or replace function public.live_commerce_range(p_from date, p_to date)
returns table (
  brand_id bigint, market text, currency_code text,
  revenue numeric, orders bigint, units numeric,
  costed_units numeric, cogs numeric
)
language sql
stable
set search_path = ''
as $function$
  with checked as (
    select case
      when p_to < p_from then null
      when p_to - p_from > 400 then null
      else 1 end as ok
  ),
  base as (
    select o.id, o.brand_id,
           coalesce(ic.config->>'country_code', '—') as market,
           o.currency_code, o.total, o.integration_id, o.items
    from public.orders_read o
    join public.integration_connections ic on ic.id = o.integration_id
    where (select ok from checked) = 1
      and o.source_status in ('processing','completed')
      and o.placed_at >= (p_from::timestamp at time zone 'Asia/Kuala_Lumpur')
      and o.placed_at < ((p_to + 1)::timestamp at time zone 'Asia/Kuala_Lumpur')
  ),
  rev as (
    select brand_id, market, currency_code,
           sum(total) as revenue, count(*) as orders
    from base
    group by brand_id, market, currency_code
  ),
  lines as (
    select b.brand_id, b.market, b.currency_code,
           it.qty, va.variant_id, cc.cost, cc.currency_code as cost_ccy
    from base b
    cross join lateral (
      select e->>'sku' as sku, coalesce(nullif(e->>'quantity','')::numeric, 1) as qty
      from jsonb_array_elements(b.items) e
    ) it
    left join public.variant_aliases va
      on va.integration_id = b.integration_id and va.alias = it.sku
    left join lateral (
      select vc.cost, vc.currency_code
      from public.variant_costs vc
      where vc.variant_id = va.variant_id and vc.effective_from <= current_date
      order by vc.effective_from desc
      limit 1
    ) cc on true
  ),
  econ as (
    select brand_id, market, currency_code,
           sum(qty) as units,
           coalesce(sum(qty) filter (where variant_id is not null and cost is not null and cost_ccy = currency_code), 0) as costed_units,
           coalesce(sum(qty * cost) filter (where cost is not null and cost_ccy = currency_code), 0) as cogs
    from lines
    group by brand_id, market, currency_code
  )
  select r.brand_id, r.market, r.currency_code,
         r.revenue, r.orders,
         coalesce(e.units, 0), coalesce(e.costed_units, 0), coalesce(e.cogs, 0)
  from rev r
  left join econ e
    on e.brand_id is not distinct from r.brand_id
   and e.market = r.market and e.currency_code = r.currency_code;
$function$;

revoke all on function public.live_commerce_range(date, date) from public, anon;
grant execute on function public.live_commerce_range(date, date) to authenticated, service_role;
