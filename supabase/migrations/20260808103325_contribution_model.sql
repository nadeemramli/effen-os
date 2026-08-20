-- Full variable-cost contribution model (completes CM2/CM3), per the
-- operator P&L sheets: product cost RM7/base unit, delivery RM8.50
-- semenanjung / RM15 Sabah+Sarawak+Labuan / RM35 (MYR) Singapore, return
-- legs at the same fees, COD fee RM5/COD order, WHT 8% on ad spend.
--
-- Mechanics decided by the data:
-- - Zone from order postcode (87-91, 93-98 prefixes = MY_EAST).
-- - COD from raw->>'payment_method' = 'cod'.
-- - One parcel per recognized order (matches the sheets' delivery lines).
-- - RTS parcels count per brand from nv_shipments.brand_id (Fighter refs
--   make parcel→order joins impossible); return legs are costed at the
--   brand's own west/east order mix. NV covers MY — SG returns await an
--   SG courier feed. Returned-order revenue/COGS netting rides on Woo
--   statuses (cancelled/refunded leave recognized revenue automatically);
--   the sheets model returns the same way (shipping legs only).
-- - All cost rates are MYR (the sheets convert SG to MYR); revenue stays
--   by currency and the frontend converts for display.

create table public.contribution_cost_rules (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces(id),
  effective_from date not null default current_date,
  unit_cost_myr numeric not null check (unit_cost_myr >= 0),
  delivery_my_west numeric not null check (delivery_my_west >= 0),
  delivery_my_east numeric not null check (delivery_my_east >= 0),
  delivery_sg_myr numeric not null check (delivery_sg_myr >= 0),
  cod_fee numeric not null check (cod_fee >= 0),
  wht_rate numeric not null check (wht_rate >= 0 and wht_rate <= 1),
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  unique (workspace_id, effective_from)
);

alter table public.contribution_cost_rules enable row level security;
create policy member_read on public.contribution_cost_rules for select to authenticated
  using (private.is_workspace_member(workspace_id));

-- Seed from the operator sheets (Adipocyde/Synovil/Cavernosil P&L).
insert into public.contribution_cost_rules
  (workspace_id, effective_from, unit_cost_myr, delivery_my_west, delivery_my_east,
   delivery_sg_myr, cod_fee, wht_rate, note, created_by)
select min(id), '2025-01-01', 7.00, 8.50, 15.00, 35.00, 5.00, 0.08,
       'Initial rules from operator P&L sheets (2026-08-08)', 'system-seed'
from public.workspaces;

create or replace function public.save_contribution_rules(
  p_unit_cost numeric, p_delivery_west numeric, p_delivery_east numeric,
  p_delivery_sg numeric, p_cod_fee numeric, p_wht_rate numeric,
  p_effective_from date default current_date, p_note text default null
) returns bigint
language plpgsql security definer set search_path to ''
as $function$
declare
  v_ws bigint;
  v_actor text;
  v_id bigint;
begin
  select min(id) into v_ws from public.workspaces;
  if not private.has_role(v_ws, array['hq_admin','finance']) then
    raise exception 'Cost rules require hq_admin or finance role';
  end if;
  select coalesce((select display_name from public.profiles where id = (select auth.uid())), 'unknown')
  into v_actor;

  insert into public.contribution_cost_rules
    (workspace_id, effective_from, unit_cost_myr, delivery_my_west, delivery_my_east,
     delivery_sg_myr, cod_fee, wht_rate, note, created_by)
  values (v_ws, p_effective_from, p_unit_cost, p_delivery_west, p_delivery_east,
          p_delivery_sg, p_cod_fee, p_wht_rate, p_note, v_actor)
  on conflict (workspace_id, effective_from) do update
    set unit_cost_myr = excluded.unit_cost_myr,
        delivery_my_west = excluded.delivery_my_west,
        delivery_my_east = excluded.delivery_my_east,
        delivery_sg_myr = excluded.delivery_sg_myr,
        cod_fee = excluded.cod_fee,
        wht_rate = excluded.wht_rate,
        note = excluded.note,
        created_by = excluded.created_by
  returning id into v_id;

  insert into public.audit_events (workspace_id, actor_label, action, entity_ref, detail)
  values (v_ws, v_actor, 'finance.cost_rules_set', 'cost_rules:' || p_effective_from,
          'unit ' || p_unit_cost || ' · west ' || p_delivery_west || ' · east ' || p_delivery_east
          || ' · sg ' || p_delivery_sg || ' · cod ' || p_cod_fee || ' · wht ' || p_wht_rate);
  return v_id;
end;
$function$;

-- Per brand × market × currency over an arbitrary range: order/unit/zone/
-- COD counts, revenue, and MYR cost lines from the effective rules.
create or replace function public.live_contribution_range(p_from date, p_to date)
returns jsonb
language sql stable
set search_path = ''
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
           (o.raw->>'payment_method' = 'cod') as is_cod,
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

revoke all on function public.save_contribution_rules(numeric, numeric, numeric, numeric, numeric, numeric, date, text) from public, anon;
grant execute on function public.save_contribution_rules(numeric, numeric, numeric, numeric, numeric, numeric, date, text) to authenticated, service_role;
revoke all on function public.live_contribution_range(date, date) from public, anon;
grant execute on function public.live_contribution_range(date, date) to authenticated, service_role;
