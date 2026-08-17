-- WHT is dated: 8% on Meta ad spend until 31 Jan 2026, 0% from 1 Feb 2026.
--
-- Ad billing moved to the Dubai entity in February 2026, so withholding tax
-- stopped. The rules table was already effective-dated but the range RPC
-- picked one rule for the whole window and the client applied one WHT rate
-- to all spend. Now:
--   • a 2026-02-01 rule sets wht_rate = 0 (unit/delivery/COD unchanged);
--   • live_contribution_range applies whichever rule was effective on each
--     day of the commerce_daily spine for COGS / delivery / COD, and returns
--     `rule_history` so the client can apply WHT per spend day (Meta only,
--     decided 2026-08-17). `rules` (latest ≤ p_to) stays for the returns blend.

insert into public.contribution_cost_rules
  (workspace_id, effective_from, unit_cost_myr, delivery_my_west, delivery_my_east,
   delivery_sg_myr, cod_fee, wht_rate, note, created_by)
select r.workspace_id, '2026-02-01', r.unit_cost_myr, r.delivery_my_west, r.delivery_my_east,
       r.delivery_sg_myr, r.cod_fee, 0,
       'Ad billing moved to Dubai entity — no WHT on Meta spend from Feb 2026', 'migration'
from public.contribution_cost_rules r
where r.effective_from = (select max(effective_from) from public.contribution_cost_rules where effective_from < '2026-02-01')
on conflict (workspace_id, effective_from) do update
  set wht_rate = 0,
      note = excluded.note,
      created_by = excluded.created_by;

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
    -- Latest rule at the range end: the payload's `rules` (WHT rate for the
    -- client, zone rates for the returns blend). Cost lines below apply
    -- whichever rule was effective on each day.
    select * from public.contribution_cost_rules
    where effective_from <= p_to
    order by effective_from desc limit 1
  ),
  first_rule as (
    select * from public.contribution_cost_rules order by effective_from asc limit 1
  ),
  daily as (
    select cd.*,
           coalesce(ic.config->>'country_code', '—') as market,
           coalesce(dr.unit_cost_myr, fr.unit_cost_myr) as unit_cost_myr,
           coalesce(dr.delivery_my_west, fr.delivery_my_west) as delivery_my_west,
           coalesce(dr.delivery_my_east, fr.delivery_my_east) as delivery_my_east,
           coalesce(dr.delivery_sg_myr, fr.delivery_sg_myr) as delivery_sg_myr,
           coalesce(dr.cod_fee, fr.cod_fee) as cod_fee
    from private.commerce_daily cd
    join public.integration_connections ic on ic.id = cd.integration_id
    cross join first_rule fr
    left join lateral (
      select r.* from public.contribution_cost_rules r
      where r.effective_from <= cd.day
      order by r.effective_from desc limit 1
    ) dr on true
    where cd.day between p_from and p_to
  ),
  agg as (
    select nullif(d.brand_key, 0) as brand_id,
           d.market,
           d.currency_code,
           sum(d.orders) as orders,
           sum(d.cod_orders) as cod_orders,
           sum(d.east_orders) as east_orders,
           sum(d.revenue) as revenue,
           sum(d.base_units) as base_units,
           sum(d.unmapped_lines) as unmapped_lines,
           max(d.refreshed_at) as refreshed_at,
           -- Cost lines summed per day under that day's rule.
           sum(d.base_units * d.unit_cost_myr) as cogs_myr,
           sum(case when d.market = 'SG' then d.orders * d.delivery_sg_myr
                    else (d.orders - d.east_orders) * d.delivery_my_west
                         + d.east_orders * d.delivery_my_east end) as delivery_myr,
           sum(d.cod_orders * d.cod_fee) as cod_myr
    from daily d
    group by 1, 2, 3
  ),
  -- Returns: durable first-RTS timestamp (nv_shipments.rts_at), not the
  -- transient rollup status. Parcels are Fighter-booked, so most carry no
  -- brand; linked ones count exactly, the rest are ALLOCATED across MY brand
  -- rows by recognized-order share and flagged as such in the payload.
  rts_linked as (
    select s.brand_id, count(*)::numeric as n
    from public.nv_shipments s
    where s.brand_id is not null
      and s.rts_at >= (p_from::timestamp at time zone 'Asia/Kuala_Lumpur')
      and s.rts_at < ((p_to + 1)::timestamp at time zone 'Asia/Kuala_Lumpur')
    group by s.brand_id
  ),
  rts_unlinked as (
    select count(*)::numeric as n
    from public.nv_shipments s
    where s.brand_id is null
      and s.rts_at >= (p_from::timestamp at time zone 'Asia/Kuala_Lumpur')
      and s.rts_at < ((p_to + 1)::timestamp at time zone 'Asia/Kuala_Lumpur')
  ),
  my_orders as (
    select coalesce(sum(orders), 0)::numeric as n from agg where market = 'MY'
  ),
  attributed as (
    select a.*,
           case when a.market = 'MY'
             then coalesce(l.n, 0)
                  + case when mo.n > 0 then ru.n * a.orders / mo.n else 0 end
             else 0 end as rts_parcels
    from agg a
    cross join rts_unlinked ru
    cross join my_orders mo
    left join rts_linked l on l.brand_id = a.brand_id
  )
  select jsonb_build_object(
    'rules', (select to_jsonb(r) - 'workspace_id' - 'id' from rules r),
    'rule_history', coalesce((
      select jsonb_agg(to_jsonb(r) - 'workspace_id' - 'id' order by r.effective_from)
      from public.contribution_cost_rules r
      where r.effective_from <= p_to
    ), '[]'::jsonb),
    'refreshed_at', (select max(a.refreshed_at) from agg a),
    'rts_linked_parcels', (select coalesce(sum(n), 0) from rts_linked),
    'rts_unlinked_parcels', (select n from rts_unlinked),
    'rts_allocated', (select n > 0 from rts_unlinked),
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
        'rts_parcels', round(a.rts_parcels, 2),
        'cogs_myr', round(a.cogs_myr, 2),
        'delivery_myr', round(a.delivery_myr, 2),
        'returns_myr', case when a.market = 'MY' and a.orders > 0
          then round(a.rts_parcels * (
                 (a.orders - a.east_orders)::numeric / a.orders * r.delivery_my_west
                 + a.east_orders::numeric / a.orders * r.delivery_my_east), 2)
          else 0 end,
        'cod_myr', round(a.cod_myr, 2)
      ) order by a.revenue desc)
      from attributed a
      cross join rules r
    ), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$function$;



revoke all on function public.live_contribution_range(date, date) from public, anon;
grant execute on function public.live_contribution_range(date, date) to authenticated, service_role;
