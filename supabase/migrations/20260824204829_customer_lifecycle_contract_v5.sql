-- Customer lifecycle contract, v5: closed source statuses win over parcel evidence.
--
-- The first full backfill found 43 orders that Ninja Van reports as Delivered
-- while the store status is cancelled (38) or refunded (5) -- rejected COD parcels
-- and post-delivery refunds. They must not count as qualifying purchases: the
-- policy excludes cancelled / failed / refunded orders regardless of parcel
-- evidence. Ninja Van delivery now only rescues `processing` orders.
-- The rows were corrected in place with the same rule before the derived facts
-- were rebuilt; this migration makes every future refresh agree.

create or replace function private.lifecycle_upsert_orders(
  p_after_id bigint default 0,
  p_limit integer default 20000,
  p_since timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set jit to 'off'
set max_parallel_workers_per_gather to '0'
set work_mem to '16MB'
set statement_timeout to '5min'
as $$
declare
  v_rows integer;
  v_last bigint;
begin
  with batch as (
    select o.* from public.orders_read o
    where o.id > p_after_id and (p_since is null or o.synced_at > p_since)
    order by o.id
    limit greatest(coalesce(p_limit, 20000), 1)
  ),
  ins as (
    insert into private.customer_qualifying_orders as q
      (order_read_id, workspace_id, identity_key, brand_id, integration_id, currency_code, total,
       source, source_status, payment_method, placed_at, synced_at,
       accepted_at, delivered_at, delivered_evidence, qualifies_acceptance, qualifies_lifecycle,
       exclusion_reason, is_suspect, first_sku, refreshed_at)
    select
      o.id, o.workspace_id, ik.identity_key, o.brand_id, o.integration_id, o.currency_code, o.total,
      o.source, o.source_status, o.payment_method, o.placed_at, o.synced_at,
      case when o.source_status in ('processing', 'completed') then o.placed_at end,
      case when nv.delivered_at is not null then nv.delivered_at
           when o.source_status = 'completed' then coalesce(o.updated_at_source, o.placed_at) end,
      case when nv.delivered_at is not null then 'nv_delivered'
           when o.source_status = 'completed' then 'source_completed' end,
      (ik.identity_key is not null and not s.suspect and o.source_status in ('processing', 'completed')),
      -- lifecycle: completed, or processing with carrier delivery evidence; closed statuses never qualify
      (ik.identity_key is not null and not s.suspect
        and (o.source_status = 'completed' or (o.source_status = 'processing' and nv.delivered_at is not null))),
      case
        when ik.identity_key is null then 'no_identity'
        when s.suspect then 'suspect'
        when o.source_status in ('cancelled', 'failed', 'refunded') then 'closed_' || replace(o.source_status, '-', '_')
        when o.source_status in ('on-hold', 'pending', 'checkout-draft') then 'not_accepted_' || replace(o.source_status, '-', '_')
        when o.source_status = 'processing' and nv.delivered_at is null then 'accepted_not_delivered'
        when o.source_status = 'completed' or (o.source_status = 'processing' and nv.delivered_at is not null) then null
        else 'status_' || replace(o.source_status, '-', '_')
      end,
      s.suspect, nullif(o.items->0->>'sku', ''), now()
    from batch o
    cross join lateral (select public.identity_key(o.customer, o.raw) as identity_key) ik
    cross join lateral (select private.is_suspect_order(o.customer, o.raw) as suspect) s
    left join lateral (
      select max(sh.last_event_at) as delivered_at
      from public.nv_shipments sh where sh.order_read_id = o.id and sh.status = 'Delivered'
    ) nv on true
    on conflict (order_read_id) do update set
      workspace_id = excluded.workspace_id, identity_key = excluded.identity_key,
      brand_id = excluded.brand_id, integration_id = excluded.integration_id,
      currency_code = excluded.currency_code, total = excluded.total, source = excluded.source,
      source_status = excluded.source_status, payment_method = excluded.payment_method,
      placed_at = excluded.placed_at, synced_at = excluded.synced_at,
      accepted_at = excluded.accepted_at, delivered_at = excluded.delivered_at,
      delivered_evidence = excluded.delivered_evidence,
      qualifies_acceptance = excluded.qualifies_acceptance, qualifies_lifecycle = excluded.qualifies_lifecycle,
      exclusion_reason = excluded.exclusion_reason, is_suspect = excluded.is_suspect,
      first_sku = excluded.first_sku, refreshed_at = excluded.refreshed_at
    returning order_read_id
  )
  select count(*), max(order_read_id) into v_rows, v_last from ins;
  return jsonb_build_object('rows', v_rows, 'last_id', v_last);
end;
$$;

revoke all on function private.lifecycle_upsert_orders(bigint, integer, timestamptz) from public, anon, authenticated;
