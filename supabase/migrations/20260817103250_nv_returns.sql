-- Returns (RTS) tracking: durable facts, order linkage, honest attribution.
--
-- Why: Profit/Marketing showed "Returns RM0 · NinjaVan RTS parcels" in every
-- window although 557 parcels have had a "Returned to Sender" event since the
-- webhook went live (2026-07-31). Three defects, verified in prod:
--   1. nv_shipments.brand_id was never written (0/8,711) and the contribution
--      rts CTE joined on it NULL-unsafely → rts_parcels structurally 0.
--   2. RTS was read from the transient rollup status; any later event erased
--      it (557 ever vs 523 now), and the webhook's out-of-order guard compared
--      timestamp strings of different shapes (never fired).
--   3. Parcels are booked by Fighter under FIGHTER-<id> refs; the webhook
--      payload has no recipient/COD/brand, so parcels cannot be tied to Woo
--      orders. Fighter's staging links ~107 of them (ids ≤ 6634356); real
--      linkage arrives when Fullkit books NV itself (ADR-0006 endgame).
--
-- What this does:
--   • nv_shipments gains rts_at (first RTS event), rts_reason, on_rts_leg,
--     order_read_id — maintained by triggers on nv_events / nv_shipments so
--     webhook replays and backfills stay consistent.
--   • private.link_nv_shipment: FIGHTER-<id> → fighter staging → order, else
--     orders_read.order_number = order_ref (the ref Fullkit will use live).
--   • live_contribution_range: returns from rts_at; linked parcels count per
--     brand, unlinked ones are ALLOCATED across MY brand rows by order share
--     and the payload says so (rts_linked_parcels / rts_unlinked_parcels /
--     rts_allocated).
--   • live_nv_returns(p_days): the Fulfilment "Returned to sender" lane.
--   • live_production: RTS and "already shipped" joins go through
--     order_read_id instead of the never-matching order_number = order_ref.

-- ── Durable RTS facts + linkage columns ─────────────────────────────────────
alter table public.nv_shipments
  add column if not exists rts_at timestamptz,
  add column if not exists rts_reason text,
  add column if not exists on_rts_leg boolean not null default false,
  add column if not exists order_read_id bigint references public.orders_read (id) on delete set null;
create index if not exists nv_shipments_rts_at_idx on public.nv_shipments (rts_at) where rts_at is not null;
create index if not exists nv_shipments_order_read_idx on public.nv_shipments (order_read_id) where order_read_id is not null;

-- Every appended event updates the durable facts. AFTER INSERT on nv_events
-- runs before the webhook's rollup UPDATE, so nv_shipments.last_event_at is
-- still the previous newest — on_rts_leg follows only newer events.
create or replace function public.nv_events_rts_rollup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.nv_shipments s
     set rts_at = case when new.status = 'Returned to Sender'
                       then least(coalesce(s.rts_at, new.event_at), new.event_at)
                       else s.rts_at end,
         rts_reason = case when new.status = 'Returned to Sender'
                           then coalesce(new.raw->>'rts_reason', s.rts_reason)
                           else s.rts_reason end,
         on_rts_leg = case when new.event_at >= coalesce(s.last_event_at, '-infinity'::timestamptz)
                           then coalesce((new.raw->>'is_parcel_on_rts_leg')::boolean, s.on_rts_leg)
                           else s.on_rts_leg end
   where s.id = new.shipment_id;
  return new;
end;
$$;
drop trigger if exists nv_events_rts_trg on public.nv_events;
create trigger nv_events_rts_trg
  after insert on public.nv_events
  for each row execute function public.nv_events_rts_rollup();

-- ── Linker: parcel → order (→ brand) ────────────────────────────────────────
create or replace function private.link_nv_shipment(p_id bigint)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_ref text;
  v_fid bigint;
  v_order bigint;
begin
  select order_ref into v_ref from public.nv_shipments where id = p_id;
  if v_ref is null then return; end if;

  v_fid := nullif(substring(v_ref from '^FIGHTER-(\d+)$'), '')::bigint;
  if v_fid is not null then
    select coalesce(st.matched_order_read_id, st.imported_order_read_id) into v_order
    from private.fighter_orders_staging st
    where st.fighter_order_id = v_fid;
  end if;
  if v_order is null then
    select o.id into v_order
    from public.orders_read o
    where o.order_number = v_ref
    order by o.placed_at desc
    limit 1;
  end if;
  if v_order is not null then
    update public.nv_shipments s
       set order_read_id = o.id,
           brand_id = coalesce(o.brand_id, s.brand_id)
      from public.orders_read o
     where s.id = p_id and o.id = v_order;
  end if;
end;
$$;

create or replace function public.nv_shipments_link_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.link_nv_shipment(new.id);
  return null;
end;
$$;
drop trigger if exists nv_shipments_link_trg on public.nv_shipments;
create trigger nv_shipments_link_trg
  after insert or update of order_ref on public.nv_shipments
  for each row execute function public.nv_shipments_link_trigger();

-- ── Backfill ────────────────────────────────────────────────────────────────
update public.nv_shipments s
   set rts_at = e.first_rts,
       rts_reason = coalesce(e.reason, s.rts_reason)
  from (
    select shipment_id,
           min(event_at) as first_rts,
           (array_agg(raw->>'rts_reason' order by event_at desc) filter (where raw ? 'rts_reason'))[1] as reason
    from public.nv_events
    where status = 'Returned to Sender'
    group by shipment_id
  ) e
 where e.shipment_id = s.id;

update public.nv_shipments
   set on_rts_leg = coalesce((raw->>'is_parcel_on_rts_leg')::boolean, false);

select count(private.link_nv_shipment(id)) from public.nv_shipments where order_ref is not null;

-- ── live_contribution_range v4: returns from rts_at, linked + allocated ────
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
        'cogs_myr', round(a.base_units * r.unit_cost_myr, 2),
        'delivery_myr', case when a.market = 'SG'
          then round(a.orders * r.delivery_sg_myr, 2)
          else round((a.orders - a.east_orders) * r.delivery_my_west
                     + a.east_orders * r.delivery_my_east, 2) end,
        'returns_myr', case when a.market = 'MY' and a.orders > 0
          then round(a.rts_parcels * (
                 (a.orders - a.east_orders)::numeric / a.orders * r.delivery_my_west
                 + a.east_orders::numeric / a.orders * r.delivery_my_east), 2)
          else 0 end,
        'cod_myr', round(a.cod_orders * r.cod_fee, 2)
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

-- ── live_nv_returns: the Fulfilment "Returned to sender" lane ──────────────
-- SECURITY INVOKER: nv_shipments / nv_events / orders_read RLS authorize.
create or replace function public.live_nv_returns(p_days integer default 14)
returns jsonb
language sql
stable
set search_path = ''
as $$
  with w as (
    select now() - make_interval(days => greatest(coalesce(p_days, 14), 1)) as since
  ),
  r as (
    select s.id, s.tracking_id, s.order_ref, s.rts_at, s.rts_reason, s.on_rts_leg,
           s.brand_id, s.order_read_id, o.order_number
    from public.nv_shipments s
    left join public.orders_read o on o.id = s.order_read_id
    where s.rts_at >= (select since from w)
  ),
  pickup as (
    select e.shipment_id, min(e.event_at) as picked
    from public.nv_events e
    where e.status in ('Picked Up', 'Pending Pickup')
    group by e.shipment_id
  )
  select jsonb_build_object(
    'window_days', greatest(coalesce(p_days, 14), 1),
    'summary', jsonb_build_object(
      'returned', (select count(*) from r),
      'linked', (select count(*) from r where order_read_id is not null),
      'in_return_transit', (select count(*) from public.nv_shipments s where s.on_rts_leg and s.rts_at is null),
      'avg_days_to_rts', (
        select round(avg(extract(epoch from r.rts_at - p.picked) / 86400)::numeric, 1)
        from r join pickup p on p.shipment_id = r.id
        where p.picked < r.rts_at
      )
    ),
    'by_reason', coalesce((
      select jsonb_agg(jsonb_build_object('reason', x.reason, 'n', x.n) order by x.n desc)
      from (
        select coalesce(nullif(trim(split_part(rts_reason, ';', 1)), ''), 'Unknown') as reason, count(*) as n
        from r group by 1
      ) x
    ), '[]'::jsonb),
    'by_day', coalesce((
      select jsonb_agg(jsonb_build_object('day', x.d, 'n', x.n) order by x.d)
      from (
        select (rts_at at time zone 'Asia/Kuala_Lumpur')::date as d, count(*) as n
        from r group by 1
      ) x
    ), '[]'::jsonb),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', x.id, 'tracking_id', x.tracking_id, 'order_ref', x.order_ref,
        'rts_at', x.rts_at, 'rts_reason', x.rts_reason, 'on_rts_leg', x.on_rts_leg,
        'brand_id', x.brand_id, 'order_read_id', x.order_read_id, 'order_number', x.order_number
      ) order by x.rts_at desc)
      from (select * from r order by rts_at desc limit 200) x
    ), '[]'::jsonb)
  );
$$;
revoke all on function public.live_nv_returns(integer) from public, anon;
grant execute on function public.live_nv_returns(integer) to authenticated, service_role;

-- ── live_production: NV joins through order_read_id ────────────────────────
CREATE OR REPLACE FUNCTION public.live_production()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
with pack as (
  select v.id as variant_id, v.product_id, v.units_per_pack, v.sku, v.name
  from public.product_variants v
),
open_orders as (
  select o.id, o.integration_id, o.items
  from public.orders_read o
  where o.source_status in ('pending','on-hold','processing')
    and o.placed_at > now() - interval '180 days'
    and not exists (
      -- Parcel already booked for this order (nv_shipments.order_read_id is
      -- populated by the linker; sparse until Fullkit books NV itself).
      select 1 from public.nv_shipments s where s.order_read_id = o.id
    )
),
backlog_lines as (
  select pk.product_id,
         it.sku,
         it.qty,
         pk.units_per_pack
  from open_orders o
  cross join lateral (
    select e->>'sku' as sku, coalesce(nullif(e->>'quantity','')::numeric, 1) as qty
    from jsonb_array_elements(o.items) e
  ) it
  left join public.variant_aliases va
    on va.integration_id = o.integration_id and va.alias = it.sku
  left join pack pk on pk.variant_id = va.variant_id
),
backlog as (
  select product_id, sum(qty * units_per_pack)::int as backlog_units
  from backlog_lines where product_id is not null
  group by product_id
),
unmapped_backlog as (
  select coalesce(sum(qty), 0)::int as qty from backlog_lines where product_id is null
),
usage as (
  select pk.product_id, sum(it.qty * pk.units_per_pack) / 30.0 as daily_units
  from public.orders_read o
  cross join lateral (
    select e->>'sku' as sku, coalesce(nullif(e->>'quantity','')::numeric, 1) as qty
    from jsonb_array_elements(o.items) e
  ) it
  join public.variant_aliases va
    on va.integration_id = o.integration_id and va.alias = it.sku
  join pack pk on pk.variant_id = va.variant_id
  where o.placed_at > now() - interval '30 days'
    and o.source_status in ('processing','completed')
  group by pk.product_id
),
rts as (
  -- Returned parcels linked to an order (nv_shipments.order_read_id / rts_at,
  -- see 20260817000008). Linked parcels are rare until the pipeline books
  -- NV with Fullkit refs — this is honest, not complete.
  select pk.product_id,
         sum(it.qty * pk.units_per_pack)::int as rts_units_30d,
         count(distinct s.tracking_id)::int as rts_parcels_30d
  from public.nv_shipments s
  join public.orders_read o on o.id = s.order_read_id
  cross join lateral (
    select e->>'sku' as sku, coalesce(nullif(e->>'quantity','')::numeric, 1) as qty
    from jsonb_array_elements(o.items) e
  ) it
  join public.variant_aliases va
    on va.integration_id = o.integration_id and va.alias = it.sku
  join pack pk on pk.variant_id = va.variant_id
  where s.rts_at > now() - interval '30 days'
  group by pk.product_id
),
refunds as (
  select pk.product_id, sum(it.qty * pk.units_per_pack)::int as refund_units_30d
  from public.orders_read o
  cross join lateral (
    select e->>'sku' as sku, coalesce(nullif(e->>'quantity','')::numeric, 1) as qty
    from jsonb_array_elements(o.items) e
  ) it
  join public.variant_aliases va
    on va.integration_id = o.integration_id and va.alias = it.sku
  join pack pk on pk.variant_id = va.variant_id
  where o.source_status in ('refunded','cancelled')
    and o.placed_at > now() - interval '30 days'
  group by pk.product_id
),
materials as (
  select production_item_id,
         jsonb_agg(jsonb_build_object(
           'id', id, 'kind', kind, 'name', name, 'uom', uom, 'qty', qty, 'note', note
         ) order by kind, name) as list
  from public.production_materials
  group by production_item_id
),
incoming as (
  select production_item_id,
         sum(qty_units)::int as incoming_units,
         min(eta) as next_eta,
         jsonb_agg(jsonb_build_object(
           'id', id, 'qty_units', qty_units, 'freight', freight, 'eta', eta,
           'status', status, 'note', note
         ) order by coalesce(eta, '9999-12-31'::date)) as shipments
  from public.production_inbound
  where status = 'ordered'
  group by production_item_id
),
recent_entries as (
  select production_item_id,
         jsonb_agg(jsonb_build_object(
           'field', field, 'old_qty', old_qty, 'new_qty', new_qty, 'delta', delta,
           'source', source, 'note', note, 'actor', actor_label, 'at', created_at
         ) order by created_at desc) as entries
  from (
    select *, row_number() over (partition by production_item_id order by created_at desc) as rn
    from public.production_entries
  ) x
  where rn <= 10
  group by production_item_id
)
select jsonb_build_object(
  'items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', i.id,
      'product_id', i.product_id,
      'name', i.name,
      'dosage_form', i.dosage_form,
      'base_uom', i.base_uom,
      'raw_material_units', i.raw_material_units,
      'premix_units', i.premix_units,
      'in_progress_units', i.in_progress_units,
      'ready_units', i.ready_units,
      'status', i.status,
      'updated_at', i.updated_at,
      'backlog_units', coalesce(b.backlog_units, 0),
      'net_position', i.ready_units + i.in_progress_units + i.premix_units - coalesce(b.backlog_units, 0),
      'daily_usage', round(coalesce(u.daily_units, 0)::numeric, 1),
      'days_cover', case when coalesce(u.daily_units, 0) > 0
        then round((i.ready_units / u.daily_units)::numeric, 0) end,
      'rts_units_30d', coalesce(r.rts_units_30d, 0),
      'rts_parcels_30d', coalesce(r.rts_parcels_30d, 0),
      'refund_units_30d', coalesce(f.refund_units_30d, 0),
      'incoming_units', coalesce(inc.incoming_units, 0),
      'next_eta', inc.next_eta,
      'incoming', coalesce(inc.shipments, '[]'::jsonb),
      'materials', coalesce(m.list, '[]'::jsonb),
      'entries', coalesce(e.entries, '[]'::jsonb)
    ) order by i.name)
    from public.production_items i
    left join backlog b on b.product_id = i.product_id
    left join usage u on u.product_id = i.product_id
    left join rts r on r.product_id = i.product_id
    left join refunds f on f.product_id = i.product_id
    left join materials m on m.production_item_id = i.id
    left join incoming inc on inc.production_item_id = i.id
    left join recent_entries e on e.production_item_id = i.id
    where i.status = 'active'
  ), '[]'::jsonb),
  'unmapped_backlog_qty', (select qty from unmapped_backlog),
  'variants_missing_pack', coalesce((
    select jsonb_agg(jsonb_build_object('id', pk.variant_id, 'sku', pk.sku, 'name', pk.name))
    from pack pk
    join public.production_items i on i.product_id = pk.product_id and i.status = 'active'
    where pk.units_per_pack = 1
  ), '[]'::jsonb)
);
$function$;
