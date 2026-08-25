-- Applied 2026-08-25 via MCP apply_migration; filed under the recorded version 20260825071249.
-- NOTE: private.dispatch_eligibility as written here fails (text[] || literal); corrected by 20260825071400_fulfilment_crm_shadow_v1_fix.sql. Kept verbatim as applied.
-- fulfilment_crm_shadow_v1 — Phase 6 of the operational-workspaces program: fulfilment and CRM continuation (shadow).
--
-- Everything here records facts and intentions; nothing calls Ninja Van or
-- Strive. ADR-0006 stays the courier write gate; CRM sends are blocked until
-- consent, templates and the transport are verified.
--
-- 1. order_fulfilment gains four explicit, independent state dimensions from
--    the intake plan §4.1 (the existing `stage` is untouched):
--      nv_state           not_submitted | shadow_generated | submission_queued | submitted | processing |
--                         pending_pickup | awb_available | awb_cached | awb_printed | cancelled | failed
--      warehouse_state    not_released | released | picking | picked | packing | packed | ready_for_handover | handed_over | exception
--      carrier_state      not_created | pending_pickup | driver_dispatched | picked_up | in_transit | out_for_delivery |
--                         delivered | delivery_exception | rejected | rts | returned | cancelled
--      notification_state not_required | scheduled | shadow_logged | sent | delivered | failed | suppressed | cancelled
--    carrier_state is written ONLY by private.fulfilment_state_sync() from
--    Ninja Van webhook events; no operator command can touch it, so printing
--    an AWB or recording a handover can never produce in_transit.
-- 2. public.fulfilment_state_events — append-only log of every dimension change with its source.
-- 3. Commands (audited, hq_admin/operations): awb_mark_cached, awb_mark_printed,
--    fulfilment_mark_handover, qc_release_to_fulfilment (sets order_qc.fulfilment_release_state).
-- 4. public.live_awb_manager(p_days) — the AWB Manager shadow surface.
-- 5. CRM: public.dispatch_templates (draft registry), public.dispatch_requests
--    (unique by customer × purpose × trigger × channel × template version),
--    private.dispatch_eligibility (consent / suppression / frequency / template /
--    transport), private.strive_shadow_envelope (what would be sent; no HTTP),
--    create_dispatch_request / cancel_dispatch_request. qc_request_information now
--    also records a dispatch request. A Strive connection row is registered as
--    pending_setup / shadow.
-- 6. pg_cron: fulfilment-state-sync-every-15m (:13/:28/:43/:58, after nv-submit).
--
-- Additive only. No table is dropped and no applied migration is edited.

------------------------------------------------------------------------
-- 1. Explicit state dimensions on order_fulfilment
------------------------------------------------------------------------
alter table public.order_fulfilment
  add column if not exists nv_state text not null default 'not_submitted',
  add column if not exists warehouse_state text not null default 'not_released',
  add column if not exists carrier_state text not null default 'not_created',
  add column if not exists notification_state text not null default 'not_required',
  add column if not exists awb_cached_at timestamptz,
  add column if not exists awb_cached_by text,
  add column if not exists awb_printed_at timestamptz,
  add column if not exists awb_printed_by text,
  add column if not exists released_to_warehouse_at timestamptz,
  add column if not exists handed_over_at timestamptz,
  add column if not exists handed_over_by text,
  add column if not exists carrier_picked_up_at timestamptz,
  add column if not exists carrier_last_event_at timestamptz,
  add column if not exists carrier_last_status text,
  add column if not exists states_synced_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'order_fulfilment_nv_state_chk') then
    alter table public.order_fulfilment add constraint order_fulfilment_nv_state_chk check (nv_state in
      ('not_submitted', 'shadow_generated', 'submission_queued', 'submitted', 'processing', 'pending_pickup', 'awb_available', 'awb_cached', 'awb_printed', 'cancelled', 'failed'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'order_fulfilment_warehouse_state_chk') then
    alter table public.order_fulfilment add constraint order_fulfilment_warehouse_state_chk check (warehouse_state in
      ('not_released', 'released', 'picking', 'picked', 'packing', 'packed', 'ready_for_handover', 'handed_over', 'exception'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'order_fulfilment_carrier_state_chk') then
    alter table public.order_fulfilment add constraint order_fulfilment_carrier_state_chk check (carrier_state in
      ('not_created', 'pending_pickup', 'driver_dispatched', 'picked_up', 'in_transit', 'out_for_delivery', 'delivered', 'delivery_exception', 'rejected', 'rts', 'returned', 'cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'order_fulfilment_notification_state_chk') then
    alter table public.order_fulfilment add constraint order_fulfilment_notification_state_chk check (notification_state in
      ('not_required', 'scheduled', 'shadow_logged', 'sent', 'delivered', 'failed', 'suppressed', 'cancelled'));
  end if;
end $$;

create table if not exists public.fulfilment_state_events (
  id bigserial primary key,
  workspace_id bigint not null references public.workspaces(id),
  order_read_id bigint not null,
  dimension text not null check (dimension in ('nv', 'warehouse', 'carrier', 'notification', 'release')),
  from_state text,
  to_state text not null,
  source text not null check (source in ('operator', 'carrier', 'system', 'qc')),
  actor_label text not null,
  note text,
  evidence jsonb,
  created_at timestamptz not null default now()
);
create index if not exists fulfilment_state_events_order_idx on public.fulfilment_state_events (order_read_id, created_at);
alter table public.fulfilment_state_events enable row level security;
drop policy if exists member_read on public.fulfilment_state_events;
create policy member_read on public.fulfilment_state_events for select to authenticated using (private.is_workspace_member(workspace_id));
revoke all on public.fulfilment_state_events from anon, authenticated;
grant select on public.fulfilment_state_events to authenticated;
grant all on public.fulfilment_state_events to service_role;
grant usage, select on sequence public.fulfilment_state_events_id_seq to service_role;

comment on column public.order_fulfilment.carrier_state is 'Written only by private.fulfilment_state_sync() from Ninja Van webhook events. Operator commands never touch it: AWB print / handover cannot produce in_transit.';

------------------------------------------------------------------------
-- 2. Evidence-only sync (system + carrier sources)
------------------------------------------------------------------------
-- Ninja Van status → carrier_state, with a monotonic rank so late webhooks cannot regress a later state.
create or replace function private.nv_carrier_state(p_status text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select case p_status
    when 'Pending Pickup' then 'pending_pickup'
    when 'Pickup Exception' then 'pending_pickup'
    when 'Picked Up' then 'picked_up'
    when 'Arrived at Origin Hub' then 'in_transit'
    when 'In Transit to Next Sorting Hub' then 'in_transit'
    when 'Arrived at Transit Hub' then 'in_transit'
    when 'Arrived at Destination Hub' then 'in_transit'
    when 'Parcel Measurements Update' then 'in_transit'
    when 'On Vehicle for Delivery' then 'out_for_delivery'
    when 'At PUDO' then 'out_for_delivery'
    when 'Delivered' then 'delivered'
    when 'Delivery Exception' then 'delivery_exception'
    when 'Return to Shipper Exception' then 'rts'
    when 'Returned to Sender' then 'returned'
    when 'Cancelled' then 'cancelled'
    else null end;
$$;

create or replace function private.carrier_rank(p_state text)
returns integer language sql immutable parallel safe set search_path = '' as $$
  select case p_state
    when 'not_created' then 0 when 'pending_pickup' then 1 when 'driver_dispatched' then 2 when 'picked_up' then 3
    when 'in_transit' then 4 when 'out_for_delivery' then 5 when 'delivery_exception' then 5
    when 'rts' then 7 when 'rejected' then 8 when 'delivered' then 9 when 'returned' then 9 when 'cancelled' then 9
    else 0 end;
$$;

create or replace function private.fulfilment_state_sync()
returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout = '3min'
as $$
declare
  r record;
  v_nv integer := 0; v_carrier integer := 0; v_notify integer := 0; v_tracking integer := 0;
  v_new text;
begin
  -- Tracking id from a linked carrier shipment (Fighter-booked today; linked by order ref).
  for r in
    select f.id, f.workspace_id, f.order_read_id, s.tracking_id
    from public.order_fulfilment f
    join lateral (select s.tracking_id from public.nv_shipments s where s.order_read_id = f.order_read_id order by s.first_seen_at desc limit 1) s on true
    where f.tracking_id is null
  loop
    update public.order_fulfilment set tracking_id = r.tracking_id, updated_at = now() where id = r.id;
    v_tracking := v_tracking + 1;
  end loop;

  -- nv_state: shadow submissions generate a payload but send nothing; a linked
  -- shipment is the only evidence that a waybill exists. Operator-recorded
  -- cached/printed states are never overwritten.
  for r in
    select f.id, f.workspace_id, f.order_read_id, f.nv_state, f.stage, f.tracking_id,
           (select s.mode from public.nv_submissions s where s.order_read_id = f.order_read_id order by s.created_at desc limit 1) as sub_mode
    from public.order_fulfilment f
  loop
    v_new := case
      when r.nv_state in ('awb_cached', 'awb_printed') then r.nv_state
      when r.stage = 'cancelled' and r.nv_state not in ('awb_available') then 'cancelled'
      when r.tracking_id is not null then 'awb_available'
      when r.sub_mode = 'shadow' then 'shadow_generated'
      when r.sub_mode = 'live' then 'submitted'
      else 'not_submitted' end;
    if v_new is distinct from r.nv_state then
      update public.order_fulfilment set nv_state = v_new, updated_at = now() where id = r.id;
      insert into public.fulfilment_state_events (workspace_id, order_read_id, dimension, from_state, to_state, source, actor_label, evidence)
      values (r.workspace_id, r.order_read_id, 'nv', r.nv_state, v_new, 'system', 'fulfilment-state-sync',
              jsonb_build_object('tracking_id', r.tracking_id, 'submission_mode', r.sub_mode, 'stage', r.stage));
      v_nv := v_nv + 1;
    end if;
  end loop;

  -- carrier_state: latest Ninja Van event of the linked shipment; never regress rank; terminal states stick.
  for r in
    select f.id, f.workspace_id, f.order_read_id, f.carrier_state, f.carrier_picked_up_at,
           e.status as last_status, e.event_at as last_at, private.nv_carrier_state(e.status) as mapped,
           (select min(e2.event_at) from public.nv_events e2 join public.nv_shipments s2 on s2.id = e2.shipment_id
             where s2.order_read_id = f.order_read_id and e2.status = 'Picked Up') as picked_at
    from public.order_fulfilment f
    join public.nv_shipments s on s.order_read_id = f.order_read_id
    join lateral (select e.status, e.event_at from public.nv_events e where e.shipment_id = s.id order by e.event_at desc limit 1) e on true
  loop
    if r.mapped is null then continue; end if;
    if private.carrier_rank(r.mapped) < private.carrier_rank(r.carrier_state) and private.carrier_rank(r.carrier_state) >= 7 then
      v_new := r.carrier_state;  -- terminal / return states stick
    else
      v_new := r.mapped;
    end if;
    if v_new is distinct from r.carrier_state or r.picked_at is distinct from r.carrier_picked_up_at then
      update public.order_fulfilment
      set carrier_state = v_new, carrier_last_status = r.last_status, carrier_last_event_at = r.last_at,
          carrier_picked_up_at = coalesce(r.picked_at, carrier_picked_up_at), updated_at = now()
      where id = r.id;
      if v_new is distinct from r.carrier_state then
        insert into public.fulfilment_state_events (workspace_id, order_read_id, dimension, from_state, to_state, source, actor_label, evidence)
        values (r.workspace_id, r.order_read_id, 'carrier', r.carrier_state, v_new, 'carrier', 'ninja-van-webhook',
                jsonb_build_object('status', r.last_status, 'event_at', r.last_at));
        v_carrier := v_carrier + 1;
      end if;
    end if;
  end loop;

  -- notification_state from the latest dispatch request of the order (shadow/blocked only in v1).
  for r in
    select f.id, f.workspace_id, f.order_read_id, f.notification_state,
           (select d.status from public.dispatch_requests d where d.order_read_id = f.order_read_id order by d.created_at desc limit 1) as d_status
    from public.order_fulfilment f
  loop
    v_new := case r.d_status
      when 'blocked' then 'suppressed' when 'shadow_logged' then 'shadow_logged' when 'queued' then 'scheduled'
      when 'sent' then 'sent' when 'delivered' then 'delivered' when 'failed' then 'failed' when 'cancelled' then 'cancelled'
      else 'not_required' end;
    if v_new is distinct from r.notification_state then
      update public.order_fulfilment set notification_state = v_new, updated_at = now() where id = r.id;
      insert into public.fulfilment_state_events (workspace_id, order_read_id, dimension, from_state, to_state, source, actor_label, evidence)
      values (r.workspace_id, r.order_read_id, 'notification', r.notification_state, v_new, 'system', 'fulfilment-state-sync', jsonb_build_object('dispatch_status', r.d_status));
      v_notify := v_notify + 1;
    end if;
  end loop;

  update public.order_fulfilment set states_synced_at = now();
  return jsonb_build_object('tracking_linked', v_tracking, 'nv_changed', v_nv, 'carrier_changed', v_carrier, 'notification_changed', v_notify, 'at', now());
end;
$$;

------------------------------------------------------------------------
-- 3. Operator commands (never touch carrier_state)
------------------------------------------------------------------------
create or replace function private.fulfilment_operator(p_order_read_id bigint, out workspace_id bigint, out label text, out membership_id bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  select f.workspace_id into workspace_id from public.order_fulfilment f where f.order_read_id = p_order_read_id;
  if workspace_id is null then raise exception 'No fulfilment pipeline row for this order (store not fulfilment-enabled or order not in intake)'; end if;
  if not private.has_role(workspace_id, array['hq_admin', 'operations']) then raise exception 'Only HQ admins or operations can record fulfilment events'; end if;
  select m.id, coalesce(p.display_name, 'unknown') into membership_id, label
  from public.memberships m left join public.profiles p on p.id = m.user_id
  where m.workspace_id = fulfilment_operator.workspace_id and m.user_id = (select auth.uid()) and m.status = 'active' limit 1;
  if label is null then label := 'unknown'; end if;
end;
$$;

create or replace function public.awb_mark_cached(p_order_read_id bigint, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_op record; v_f public.order_fulfilment;
begin
  select * into v_op from private.fulfilment_operator(p_order_read_id);
  select * into v_f from public.order_fulfilment where order_read_id = p_order_read_id for update;
  if v_f.nv_state not in ('awb_available', 'awb_cached') then
    raise exception 'No waybill evidence for this order yet (nv_state = %); a linked Ninja Van shipment is required', v_f.nv_state;
  end if;
  if v_f.nv_state = 'awb_cached' then return jsonb_build_object('changed', false, 'nv_state', v_f.nv_state); end if;
  update public.order_fulfilment set nv_state = 'awb_cached', awb_cached_at = now(), awb_cached_by = v_op.label, updated_at = now() where id = v_f.id;
  insert into public.fulfilment_state_events (workspace_id, order_read_id, dimension, from_state, to_state, source, actor_label, note)
  values (v_f.workspace_id, p_order_read_id, 'nv', v_f.nv_state, 'awb_cached', 'operator', v_op.label, p_note);
  insert into public.audit_events (workspace_id, actor_membership_id, actor_label, action, entity_ref, detail, before_data, after_data)
  values (v_f.workspace_id, v_op.membership_id, v_op.label, 'fulfilment.awb_cached', 'order:' || (select coalesce(order_number, source_order_id) from public.orders_read where id = p_order_read_id),
          'Waybill recorded as downloaded/cached' || coalesce(': ' || left(p_note, 500), ''), jsonb_build_object('nv_state', v_f.nv_state), jsonb_build_object('nv_state', 'awb_cached'));
  return jsonb_build_object('changed', true, 'nv_state', 'awb_cached');
end;
$$;

create or replace function public.awb_mark_printed(p_order_read_id bigint, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_op record; v_f public.order_fulfilment;
begin
  select * into v_op from private.fulfilment_operator(p_order_read_id);
  select * into v_f from public.order_fulfilment where order_read_id = p_order_read_id for update;
  if v_f.nv_state not in ('awb_available', 'awb_cached', 'awb_printed') then
    raise exception 'No waybill evidence for this order yet (nv_state = %)', v_f.nv_state;
  end if;
  if v_f.nv_state = 'awb_printed' then return jsonb_build_object('changed', false, 'nv_state', v_f.nv_state); end if;
  update public.order_fulfilment set nv_state = 'awb_printed', awb_printed_at = now(), awb_printed_by = v_op.label,
         awb_cached_at = coalesce(awb_cached_at, now()), awb_cached_by = coalesce(awb_cached_by, v_op.label), updated_at = now() where id = v_f.id;
  insert into public.fulfilment_state_events (workspace_id, order_read_id, dimension, from_state, to_state, source, actor_label, note)
  values (v_f.workspace_id, p_order_read_id, 'nv', v_f.nv_state, 'awb_printed', 'operator', v_op.label, p_note);
  insert into public.audit_events (workspace_id, actor_membership_id, actor_label, action, entity_ref, detail, before_data, after_data)
  values (v_f.workspace_id, v_op.membership_id, v_op.label, 'fulfilment.awb_printed', 'order:' || (select coalesce(order_number, source_order_id) from public.orders_read where id = p_order_read_id),
          'Waybill recorded as printed (carrier state untouched)' || coalesce(': ' || left(p_note, 500), ''), jsonb_build_object('nv_state', v_f.nv_state), jsonb_build_object('nv_state', 'awb_printed'));
  return jsonb_build_object('changed', true, 'nv_state', 'awb_printed');
end;
$$;

create or replace function public.fulfilment_mark_handover(p_order_read_id bigint, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_op record; v_f public.order_fulfilment;
begin
  select * into v_op from private.fulfilment_operator(p_order_read_id);
  select * into v_f from public.order_fulfilment where order_read_id = p_order_read_id for update;
  if v_f.warehouse_state = 'handed_over' then return jsonb_build_object('changed', false, 'warehouse_state', v_f.warehouse_state); end if;
  if v_f.warehouse_state not in ('released', 'picking', 'picked', 'packing', 'packed', 'ready_for_handover') then
    raise exception 'Order is not released to the warehouse (warehouse_state = %); release it from QC first', v_f.warehouse_state;
  end if;
  update public.order_fulfilment set warehouse_state = 'handed_over', handed_over_at = now(), handed_over_by = v_op.label, updated_at = now() where id = v_f.id;
  insert into public.fulfilment_state_events (workspace_id, order_read_id, dimension, from_state, to_state, source, actor_label, note)
  values (v_f.workspace_id, p_order_read_id, 'warehouse', v_f.warehouse_state, 'handed_over', 'operator', v_op.label, p_note);
  insert into public.audit_events (workspace_id, actor_membership_id, actor_label, action, entity_ref, detail, before_data, after_data)
  values (v_f.workspace_id, v_op.membership_id, v_op.label, 'fulfilment.handed_over', 'order:' || (select coalesce(order_number, source_order_id) from public.orders_read where id = p_order_read_id),
          'Physical handover recorded by the fulfilment centre; carrier custody is confirmed only by the Ninja Van pickup event' || coalesce(': ' || left(p_note, 500), ''),
          jsonb_build_object('warehouse_state', v_f.warehouse_state), jsonb_build_object('warehouse_state', 'handed_over'));
  return jsonb_build_object('changed', true, 'warehouse_state', 'handed_over');
end;
$$;

-- QC release: approved order → fulfilment_release_state released (and warehouse_state released when a pipeline row exists).
create or replace function public.qc_release_to_fulfilment(p_qc_id bigint, p_note text default null, p_expected_version integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.order_qc; v_actor record; v_f public.order_fulfilment; v_ref text;
begin
  select * into v from public.order_qc where id = p_qc_id for update;
  if v.id is null then raise exception 'No QC record %', p_qc_id; end if;
  if not private.has_role(v.workspace_id, array['hq_admin', 'operations']) then raise exception 'Only HQ admins or operations can release orders to fulfilment'; end if;
  if p_expected_version is not null and v.version <> p_expected_version then raise exception 'QC record changed since you loaded it; reload and retry'; end if;
  if v.qc_state <> 'approved' then raise exception 'Only approved orders can be released (state = %)', v.qc_state; end if;
  if v.fulfilment_release_state = 'released' then return jsonb_build_object('changed', false, 'qc', to_jsonb(v)); end if;
  select * into v_actor from private.qc_actor();
  v_ref := private.qc_entity_ref(v);
  update public.order_qc set fulfilment_release_state = 'released', version = version + 1, updated_at = now() where id = v.id returning * into v;
  insert into public.order_qc_events (workspace_id, order_qc_id, action, from_state, to_state, note, actor_membership_id, actor_label, version)
  values (v.workspace_id, v.id, 'release', v.qc_state, v.qc_state, coalesce(p_note, 'Released to fulfilment'), v_actor.membership_id, v_actor.label, v.version);
  if v.order_read_id is not null then
    select * into v_f from public.order_fulfilment where order_read_id = v.order_read_id for update;
    if v_f.id is not null and v_f.warehouse_state = 'not_released' then
      update public.order_fulfilment set warehouse_state = 'released', released_to_warehouse_at = now(), updated_at = now() where id = v_f.id;
      insert into public.fulfilment_state_events (workspace_id, order_read_id, dimension, from_state, to_state, source, actor_label, note)
      values (v.workspace_id, v.order_read_id, 'warehouse', 'not_released', 'released', 'qc', v_actor.label, p_note);
    end if;
  end if;
  insert into public.fulfilment_state_events (workspace_id, order_read_id, dimension, from_state, to_state, source, actor_label, note)
  values (v.workspace_id, coalesce(v.order_read_id, 0), 'release', 'not_released', 'released', 'qc', v_actor.label, p_note);
  insert into public.audit_events (workspace_id, actor_membership_id, actor_label, action, entity_ref, detail, before_data, after_data)
  values (v.workspace_id, v_actor.membership_id, v_actor.label, 'order.qc_release', v_ref,
          'Released to fulfilment after QC approval (no stock movement, no courier call)' || coalesce(': ' || left(p_note, 500), ''),
          jsonb_build_object('fulfilment_release_state', 'not_released'), jsonb_build_object('fulfilment_release_state', 'released', 'pipeline_row', v_f.id is not null));
  return jsonb_build_object('changed', true, 'qc', to_jsonb(v), 'pipeline_released', v_f.id is not null);
end;
$$;

------------------------------------------------------------------------
-- 4. AWB Manager read
------------------------------------------------------------------------
create or replace function public.live_awb_manager(p_days integer default 14)
returns jsonb language plpgsql stable security definer set search_path = '' set statement_timeout = '15s' as $$
declare v_ws bigint := (select min(id) from public.workspaces); v_rows jsonb; v_summary jsonb;
begin
  if not private.is_workspace_member(v_ws) then raise exception 'Not a workspace member'; end if;
  with rows as (
    select f.order_read_id, f.integration_id, o.brand_id, coalesce(o.order_number, o.source_order_id) as order_ref,
           o.customer->>'name' as customer_name, o.customer->>'city' as city, o.customer->>'postcode' as postcode,
           o.total, o.currency_code, o.source_status, o.placed_at,
           f.stage, f.gate_issues, f.eligible_at, f.held_by, f.hold_reason,
           f.nv_state, f.warehouse_state, f.carrier_state, f.notification_state,
           f.tracking_id, f.awb_cached_at, f.awb_cached_by, f.awb_printed_at, f.awb_printed_by,
           f.released_to_warehouse_at, f.handed_over_at, f.handed_over_by,
           f.carrier_picked_up_at, f.carrier_last_status, f.carrier_last_event_at, f.states_synced_at,
           q.id as qc_id, q.qc_state, q.fulfilment_release_state, q.version as qc_version,
           s.status as submission_status, s.compare->>'woo_status' as submission_compare, s.created_at as submission_at
    from public.order_fulfilment f
    join public.orders_read o on o.id = f.order_read_id
    left join public.order_qc q on q.order_read_id = f.order_read_id
    left join lateral (select st.status, st.compare, st.created_at from public.nv_submissions st where st.order_read_id = f.order_read_id order by st.created_at desc limit 1) s on true
    where o.placed_at > now() - make_interval(days => greatest(coalesce(p_days, 14), 1))
       or f.stage = 'held' or f.warehouse_state in ('released', 'picking', 'picked', 'packing', 'packed', 'ready_for_handover')
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by r.placed_at desc), '[]'::jsonb),
         jsonb_build_object(
           'rows', count(*),
           'by_nv_state', (select jsonb_object_agg(k, n) from (select nv_state k, count(*) n from rows group by 1) x),
           'by_warehouse_state', (select jsonb_object_agg(k, n) from (select warehouse_state k, count(*) n from rows group by 1) x),
           'by_carrier_state', (select jsonb_object_agg(k, n) from (select carrier_state k, count(*) n from rows group by 1) x),
           'released_awaiting_awb', count(*) filter (where warehouse_state <> 'not_released' and nv_state not in ('awb_available', 'awb_cached', 'awb_printed')),
           'awb_to_print', count(*) filter (where nv_state in ('awb_available', 'awb_cached')),
           'printed_awaiting_handover', count(*) filter (where nv_state = 'awb_printed' and warehouse_state <> 'handed_over'),
           'handed_over_awaiting_pickup', count(*) filter (where warehouse_state = 'handed_over' and carrier_state in ('not_created', 'pending_pickup')))
  into v_rows, v_summary
  from rows r;
  return jsonb_build_object(
    'status', 'ok',
    'mode', 'shadow',
    'gate', 'ADR-0006: no consignment is created and no waybill is fetched by Fullkit until the exit gate passes',
    'stores', (select coalesce(jsonb_agg(jsonb_build_object('integration_id', ic.id, 'name', ic.name, 'fulfilment_mode', coalesce(ic.config->>'fulfilment_mode', 'off')) order by ic.id), '[]'::jsonb)
               from public.integration_connections ic where ic.provider = 'WooCommerce'),
    'synced_at', (select max(states_synced_at) from public.order_fulfilment),
    'window_days', greatest(coalesce(p_days, 14), 1),
    'summary', v_summary,
    'rows', v_rows);
end;
$$;

------------------------------------------------------------------------
-- 5. CRM dispatch (shadow)
------------------------------------------------------------------------
create table if not exists public.dispatch_templates (
  key text not null,
  version integer not null,
  channel text not null check (channel in ('whatsapp', 'email')),
  model text not null check (model in ('order', 'product', 'campaign')),
  purpose text not null,
  language text not null default 'ms',
  body_preview text not null,
  variables text[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'verified', 'retired')),
  provider_ref text,
  verified_at timestamptz,
  verified_by text,
  created_at timestamptz not null default now(),
  primary key (key, version)
);

create table if not exists public.dispatch_requests (
  id bigserial primary key,
  workspace_id bigint not null references public.workspaces(id),
  identity_key text not null,
  order_read_id bigint,
  model text not null check (model in ('order', 'product', 'campaign')),
  purpose text not null,
  trigger_event text not null,
  channel text not null check (channel in ('whatsapp', 'email', 'call')),
  template_key text,
  template_version integer,
  recipient_masked text,
  variables jsonb not null default '{}'::jsonb,
  priority integer not null default 4,
  eligibility jsonb not null default '{}'::jsonb,
  decision text not null check (decision in ('blocked', 'eligible')),
  block_reasons text[] not null default '{}',
  status text not null check (status in ('blocked', 'shadow_logged', 'queued', 'sent', 'delivered', 'failed', 'cancelled', 'superseded')),
  transport text not null default 'strive' check (transport in ('strive', 'email', 'manual')),
  transport_mode text not null default 'shadow' check (transport_mode in ('shadow', 'live')),
  transport_ref text,
  transport_envelope jsonb,
  idempotency_key text not null,
  created_by_membership_id bigint,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  unique (workspace_id, idempotency_key)
);
create index if not exists dispatch_requests_identity_idx on public.dispatch_requests (identity_key, created_at desc);
create index if not exists dispatch_requests_order_idx on public.dispatch_requests (order_read_id);
create index if not exists dispatch_requests_status_idx on public.dispatch_requests (workspace_id, status, created_at desc);

alter table public.dispatch_templates enable row level security;
alter table public.dispatch_requests enable row level security;
drop policy if exists member_read on public.dispatch_templates;
create policy member_read on public.dispatch_templates for select to authenticated using (private.is_workspace_member((select min(id) from public.workspaces)));
drop policy if exists member_read on public.dispatch_requests;
create policy member_read on public.dispatch_requests for select to authenticated using (private.is_workspace_member(workspace_id));
revoke all on public.dispatch_templates, public.dispatch_requests from anon, authenticated;
grant select on public.dispatch_templates, public.dispatch_requests to authenticated;
grant all on public.dispatch_templates, public.dispatch_requests to service_role;
grant usage, select on sequence public.dispatch_requests_id_seq to service_role;

comment on table public.dispatch_requests is 'Fullkit-owned contact decisions. Unique by customer × purpose × trigger × channel × template version. Status sent/delivered are reserved for a verified transport; v1 records blocked or shadow_logged only.';

-- Draft templates (unverified) for the order-management flow (intake plan §5.3).
insert into public.dispatch_templates (key, version, channel, model, purpose, language, body_preview, variables, status) values
  ('qc_request_info', 1, 'whatsapp', 'order', 'qc_request_info', 'ms', 'Hi {{name}}, untuk order #{{order_ref}} kami perlukan {{missing}} sebelum penghantaran. Balas mesej ini ya.', array['name', 'order_ref', 'missing'], 'draft'),
  ('order_approved', 1, 'whatsapp', 'order', 'order_confirmation', 'ms', 'Order #{{order_ref}} disahkan dan sedang diproses.', array['name', 'order_ref'], 'draft'),
  ('awb_available', 1, 'whatsapp', 'order', 'processing_ack', 'ms', 'Order #{{order_ref}} sedang disediakan. No. tracking: {{tracking_id}}.', array['name', 'order_ref', 'tracking_id'], 'draft'),
  ('picked_up', 1, 'whatsapp', 'order', 'in_transit', 'ms', 'Parcel #{{order_ref}} dalam perjalanan. Jejak: {{tracking_url}}.', array['name', 'order_ref', 'tracking_url'], 'draft'),
  ('delivered_onboarding', 1, 'whatsapp', 'order', 'delivered_onboarding', 'ms', 'Terima kasih {{name}}! Panduan penggunaan {{product}}: {{guide_url}}.', array['name', 'product', 'guide_url'], 'draft')
on conflict (key, version) do nothing;

-- Strive registered as a pending, shadow-mode transport (no credentials, no endpoint verification yet).
insert into public.integration_connections (workspace_id, provider, name, category, environment, direction, read_scopes, write_scopes, status, freshness_sla_minutes, error_count_24h, notes, config)
select (select min(id) from public.workspaces), 'Strive', 'Strive.asia — WhatsApp transport', 'messaging', 'sandbox', 'write', '{}', '{}', 'pending_setup', 1440, 0,
       'Shadow transport only. Endpoint, API-vs-webhook, account type, receipts and email capability must be verified before any send (intake plan §5.1).',
       jsonb_build_object('mode', 'shadow', 'endpoint_verified', false, 'templates_verified', false, 'email_capable', null)
where not exists (select 1 from public.integration_connections where provider = 'Strive');

create or replace function private.dispatch_eligibility(p_identity_key text, p_channel text, p_template_key text, p_template_version integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_reasons text[] := '{}';
  v_template public.dispatch_templates;
  v_strive record;
  v_recent integer;
  v_has_phone boolean;
begin
  select * into v_template from public.dispatch_templates where key = p_template_key and version = p_template_version;
  select config into v_strive from public.integration_connections where provider = 'Strive' limit 1;
  select count(*) into v_recent from public.dispatch_requests d
  where d.identity_key = p_identity_key and d.status in ('shadow_logged', 'queued', 'sent') and d.created_at > now() - interval '24 hours';
  select (c.phone is not null) into v_has_phone from private.customers_read c where c.identity_key = p_identity_key;

  -- No consent / suppression source exists in the platform yet: every contact is blocked on consent.
  v_reasons := v_reasons || 'no_consent_source';
  if p_channel = 'whatsapp' and coalesce(v_has_phone, false) = false then v_reasons := v_reasons || 'no_phone'; end if;
  if p_channel = 'email' then v_reasons := v_reasons || 'email_adapter_unverified'; end if;
  if p_template_key is not null and (v_template.key is null or v_template.status <> 'verified') then v_reasons := v_reasons || 'template_unverified'; end if;
  if p_channel in ('whatsapp') and (v_strive.config is null or coalesce((v_strive.config->>'endpoint_verified')::boolean, false) = false) then v_reasons := v_reasons || 'transport_unverified'; end if;
  if v_recent >= 1 then v_reasons := v_reasons || 'frequency_cap_24h'; end if;

  return jsonb_build_object(
    'consent', 'unknown', 'suppression', 'unknown', 'frequency_24h', v_recent,
    'template_status', coalesce(v_template.status, 'missing'),
    'transport', jsonb_build_object('provider', 'strive', 'mode', coalesce(v_strive.config->>'mode', 'shadow'), 'endpoint_verified', coalesce((v_strive.config->>'endpoint_verified')::boolean, false)),
    'reasons', to_jsonb(v_reasons),
    'decision', case when cardinality(v_reasons) = 0 then 'eligible' else 'blocked' end);
end;
$$;

-- What the Strive adapter WOULD send. No HTTP. The envelope is stored for review.
create or replace function private.strive_shadow_envelope(p_request public.dispatch_requests, p_template public.dispatch_templates)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'provider', 'strive', 'mode', 'shadow', 'sent', false,
    'would_call', 'POST <strive endpoint — unverified> (Webhook-X-Key)',
    'receiver', p_request.recipient_masked,
    'template', jsonb_build_object('key', p_request.template_key, 'version', p_request.template_version, 'status', p_template.status, 'provider_ref', p_template.provider_ref),
    'variables', p_request.variables,
    'body_preview', p_template.body_preview,
    'note', 'Generated for review only; nothing was transmitted');
$$;

create or replace function public.create_dispatch_request(
  p_identity_key text, p_model text, p_purpose text, p_channel text,
  p_template_key text default null, p_template_version integer default 1,
  p_variables jsonb default '{}'::jsonb, p_order_read_id bigint default null,
  p_trigger_event text default 'manual', p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ws bigint := (select min(id) from public.workspaces);
  v_actor record; v_cust record; v_key text; v_d public.dispatch_requests; v_t public.dispatch_templates; v_elig jsonb;
begin
  if not private.has_role(v_ws, array['hq_admin', 'sales_cs', 'operations', 'marketing_growth']) then raise exception 'Not allowed to draft customer contacts'; end if;
  if p_model not in ('order', 'product', 'campaign') then raise exception 'Unknown model %', p_model; end if;
  if p_channel not in ('whatsapp', 'email', 'call') then raise exception 'Unknown channel %', p_channel; end if;
  select c.identity_key, c.display_name, c.phone into v_cust from private.customers_read c where c.identity_key = p_identity_key;
  if v_cust.identity_key is null then raise exception 'Unknown customer'; end if;
  select * into v_actor from private.qc_actor();
  v_key := concat_ws('|', p_identity_key, p_purpose, p_trigger_event, p_channel, coalesce(p_template_key, '-'), coalesce(p_template_version, 0));
  select * into v_d from public.dispatch_requests where workspace_id = v_ws and idempotency_key = v_key;
  if v_d.id is not null then return jsonb_build_object('created', false, 'request', to_jsonb(v_d)); end if;
  select * into v_t from public.dispatch_templates where key = p_template_key and version = p_template_version;
  v_elig := private.dispatch_eligibility(p_identity_key, p_channel, p_template_key, p_template_version);
  insert into public.dispatch_requests
    (workspace_id, identity_key, order_read_id, model, purpose, trigger_event, channel, template_key, template_version, recipient_masked, variables,
     priority, eligibility, decision, block_reasons, status, transport, transport_mode, idempotency_key, created_by_membership_id, note, decided_at)
  values (v_ws, p_identity_key, p_order_read_id, p_model, p_purpose, p_trigger_event, p_channel, p_template_key, p_template_version,
          case when v_cust.phone is null then null else regexp_replace(v_cust.phone, '(\d{3})\d+(\d{3})$', '\1***\2') end,
          coalesce(p_variables, '{}'::jsonb),
          case p_purpose when 'qc_request_info' then 3 when 'delivery_exception' then 3 when 'order_confirmation' then 4 when 'processing_ack' then 4 when 'in_transit' then 4 when 'delivered_onboarding' then 5 else 6 end,
          v_elig, v_elig->>'decision',
          (select coalesce(array_agg(x), '{}') from jsonb_array_elements_text(v_elig->'reasons') x),
          case when v_elig->>'decision' = 'eligible' then 'shadow_logged' else 'blocked' end,
          case p_channel when 'email' then 'email' when 'call' then 'manual' else 'strive' end, 'shadow', v_key, v_actor.membership_id, p_note, now())
  returning * into v_d;
  if p_channel = 'whatsapp' then
    update public.dispatch_requests set transport_ref = 'shadow:' || v_d.id, transport_envelope = private.strive_shadow_envelope(v_d, v_t) where id = v_d.id returning * into v_d;
  end if;
  insert into public.audit_events (workspace_id, actor_membership_id, actor_label, action, entity_ref, detail, after_data)
  values (v_ws, v_actor.membership_id, v_actor.label, 'crm.dispatch_requested', 'customer:' || p_identity_key,
          'Dispatch request ' || v_d.status || ' (' || p_channel || ' · ' || p_purpose || ')' || case when cardinality(v_d.block_reasons) > 0 then ' blocked: ' || array_to_string(v_d.block_reasons, ', ') else '' end || coalesce(' — ' || left(p_note, 300), ''),
          jsonb_build_object('request_id', v_d.id, 'status', v_d.status, 'decision', v_d.decision, 'reasons', v_d.block_reasons, 'sent', false));
  return jsonb_build_object('created', true, 'request', to_jsonb(v_d));
end;
$$;

create or replace function public.cancel_dispatch_request(p_id bigint, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ws bigint := (select min(id) from public.workspaces); v_actor record; v_d public.dispatch_requests;
begin
  if not private.has_role(v_ws, array['hq_admin', 'sales_cs', 'operations', 'marketing_growth']) then raise exception 'Not allowed to cancel customer contacts'; end if;
  select * into v_d from public.dispatch_requests where id = p_id and workspace_id = v_ws for update;
  if v_d.id is null then raise exception 'No such dispatch request'; end if;
  if v_d.status in ('sent', 'delivered', 'cancelled', 'superseded') then return jsonb_build_object('changed', false, 'request', to_jsonb(v_d)); end if;
  select * into v_actor from private.qc_actor();
  update public.dispatch_requests set status = 'cancelled', cancelled_at = now(), cancel_reason = p_reason, updated_at = now() where id = v_d.id returning * into v_d;
  insert into public.audit_events (workspace_id, actor_membership_id, actor_label, action, entity_ref, detail, before_data, after_data)
  values (v_ws, v_actor.membership_id, v_actor.label, 'crm.dispatch_cancelled', 'customer:' || v_d.identity_key, 'Dispatch request cancelled' || coalesce(': ' || left(p_reason, 300), ''),
          jsonb_build_object('status', 'blocked_or_shadow'), jsonb_build_object('request_id', v_d.id, 'status', 'cancelled'));
  return jsonb_build_object('changed', true, 'request', to_jsonb(v_d));
end;
$$;

-- QC "request information" now also records the customer-facing dispatch decision (WhatsApp only; calls stay a work item).
create or replace function public.qc_request_information(
  p_qc_id bigint, p_reason_codes text[], p_note text default null,
  p_channel text default 'whatsapp_manual', p_expected_version integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_res jsonb; v_qc public.order_qc; v_actor record; v_job bigint; v_identity text; v_dispatch jsonb; v_o record;
begin
  if p_reason_codes is null or cardinality(p_reason_codes) = 0 then raise exception 'Say what information is missing (at least one reason code)'; end if;
  if p_channel not in ('whatsapp_manual', 'call') then raise exception 'Channel must be whatsapp_manual or call'; end if;
  v_res := private.qc_apply(p_qc_id, 'request_information', 'needs_customer_info', array['new', 'in_review', 'on_hold'],
    array['hq_admin', 'operations', 'sales_cs'], p_reason_codes, p_note, p_expected_version,
    jsonb_build_object('last_contact_attempt_at', now()));
  select * into v_qc from public.order_qc where id = p_qc_id;
  select * into v_actor from private.qc_actor();
  insert into public.work_items (workspace_id, title, entity_ref, owner_membership_id, severity, next_action, due_at, status)
  values (v_qc.workspace_id, left('QC: ask customer — ' || array_to_string(p_reason_codes, ', '), 200), private.qc_entity_ref(v_qc),
          coalesce(v_qc.owner_membership_id, v_actor.membership_id), 'medium', p_channel, now() + interval '1 day', 'open')
  on conflict (workspace_id, entity_ref, next_action) where status = 'open' do nothing
  returning id into v_job;
  if v_job is null then
    select id into v_job from public.work_items where workspace_id = v_qc.workspace_id and entity_ref = private.qc_entity_ref(v_qc) and next_action = p_channel and status = 'open';
  end if;
  if p_channel = 'whatsapp_manual' and v_qc.order_read_id is not null then
    select public.identity_key(o.customer, o.raw) as k, coalesce(o.order_number, o.source_order_id) as ref, o.customer->>'name' as name into v_o
    from public.orders_read o where o.id = v_qc.order_read_id;
    if v_o.k is not null and exists (select 1 from private.customers_read c where c.identity_key = v_o.k) then
      begin
        v_dispatch := public.create_dispatch_request(v_o.k, 'order', 'qc_request_info', 'whatsapp', 'qc_request_info', 1,
          jsonb_build_object('name', v_o.name, 'order_ref', v_o.ref, 'missing', array_to_string(p_reason_codes, ', ')),
          v_qc.order_read_id, 'qc.needs_customer_info', p_note);
      exception when others then
        v_dispatch := jsonb_build_object('error', sqlerrm);
      end;
    end if;
  end if;
  return v_res || jsonb_build_object('dispatch_job_id', v_job, 'sent', false, 'dispatch', v_dispatch);
end;
$$;

------------------------------------------------------------------------
-- Grants
------------------------------------------------------------------------
revoke all on function public.awb_mark_cached(bigint, text) from public, anon;
revoke all on function public.awb_mark_printed(bigint, text) from public, anon;
revoke all on function public.fulfilment_mark_handover(bigint, text) from public, anon;
revoke all on function public.qc_release_to_fulfilment(bigint, text, integer) from public, anon;
revoke all on function public.live_awb_manager(integer) from public, anon;
revoke all on function public.create_dispatch_request(text, text, text, text, text, integer, jsonb, bigint, text, text) from public, anon;
revoke all on function public.cancel_dispatch_request(bigint, text) from public, anon;
grant execute on function public.awb_mark_cached(bigint, text), public.awb_mark_printed(bigint, text), public.fulfilment_mark_handover(bigint, text),
  public.qc_release_to_fulfilment(bigint, text, integer), public.live_awb_manager(integer),
  public.create_dispatch_request(text, text, text, text, text, integer, jsonb, bigint, text, text), public.cancel_dispatch_request(bigint, text)
  to authenticated, service_role;
revoke all on function private.fulfilment_state_sync() from public, anon, authenticated;
revoke all on function private.fulfilment_operator(bigint) from public, anon, authenticated;
revoke all on function private.dispatch_eligibility(text, text, text, integer) from public, anon, authenticated;
revoke all on function private.strive_shadow_envelope(public.dispatch_requests, public.dispatch_templates) from public, anon, authenticated;

------------------------------------------------------------------------
-- 6. Initial sync + schedule
------------------------------------------------------------------------
select private.fulfilment_state_sync();
select cron.unschedule(jobid) from cron.job where jobname = 'fulfilment-state-sync-every-15m';
select cron.schedule('fulfilment-state-sync-every-15m', '13,28,43,58 * * * *', $cron$select private.fulfilment_state_sync();$cron$);
