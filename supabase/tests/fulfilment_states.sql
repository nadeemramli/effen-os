-- Fulfilment state invariants (Phase 6). Plain SQL; run as a privileged role
-- inside a transaction and ROLLBACK at the end — the operator probes below
-- change rows. Every SELECT must return ok = true.
begin;

-- 1. Vocabulary: every dimension holds only allowed values.
select 'nv_vocabulary' as test, bool_and(nv_state in ('not_submitted','shadow_generated','submission_queued','submitted','processing','pending_pickup','awb_available','awb_cached','awb_printed','cancelled','failed')) as ok from public.order_fulfilment;
select 'carrier_vocabulary' as test, bool_and(carrier_state in ('not_created','pending_pickup','driver_dispatched','picked_up','in_transit','out_for_delivery','delivered','delivery_exception','rejected','rts','returned','cancelled')) as ok from public.order_fulfilment;

-- 2. Carrier state is evidence only: any carrier_state beyond not_created has a linked Ninja Van shipment with events.
select 'carrier_needs_evidence' as test, count(*) = 0 as ok
from public.order_fulfilment f
where f.carrier_state <> 'not_created'
  and not exists (select 1 from public.nv_shipments s join public.nv_events e on e.shipment_id = s.id where s.order_read_id = f.order_read_id);

-- 3. Carrier state changes are only ever written by the carrier source in the event log.
select 'carrier_events_source' as test, bool_and(source = 'carrier') as ok from public.fulfilment_state_events where dimension = 'carrier';

-- 4. AWB states beyond shadow need a tracking id (waybill evidence).
select 'awb_needs_tracking' as test, count(*) = 0 as ok from public.order_fulfilment where nv_state in ('awb_available','awb_cached','awb_printed') and tracking_id is null;

-- 5. Operator probe: recording a handover never touches carrier_state (R23 acceptance test).
do $$
declare v_id bigint; v_before text; v_after text;
begin
  select order_read_id into v_id from public.order_fulfilment where warehouse_state = 'released' limit 1;
  if v_id is null then
    -- Seed a released row for the probe (rolled back with the transaction).
    select order_read_id into v_id from public.order_fulfilment where stage <> 'cancelled' limit 1;
    update public.order_fulfilment set warehouse_state = 'released' where order_read_id = v_id;
  end if;
  select carrier_state into v_before from public.order_fulfilment where order_read_id = v_id;
  update public.order_fulfilment set warehouse_state = 'handed_over', handed_over_at = now(), handed_over_by = 'test' where order_read_id = v_id;
  select carrier_state into v_after from public.order_fulfilment where order_read_id = v_id;
  if v_before is distinct from v_after then raise exception 'handover changed carrier_state (% -> %)', v_before, v_after; end if;
end $$;
select 'handover_does_not_move_carrier' as test, true as ok;

-- 6. Dispatch: nothing has ever been sent through the shadow transport.
select 'nothing_sent' as test, count(*) = 0 as ok from public.dispatch_requests where status in ('sent','delivered') or transport_mode = 'live';
select 'dispatch_idempotency' as test, count(*) = count(distinct (workspace_id, idempotency_key)) as ok from public.dispatch_requests;

rollback;
