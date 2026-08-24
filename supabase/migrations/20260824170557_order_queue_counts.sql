-- Per-queue counts for the Orders section nav.
--
-- One grouped scan instead of ten head-counts: one round trip, one
-- computed_at, and the badges appear together. Numbers are interface
-- observations over the Woo mirror (orders_read.source_status) plus two
-- courier-wide parcel counts from the Ninja Van read-side. Parcels are
-- Fighter-booked and mostly carry no brand, so the courier block ignores the
-- brand/store scope on purpose; the UI labels it as courier-wide.
--
-- SECURITY INVOKER (same as live_scorecard / live_nv_returns): RLS on
-- orders_read and nv_shipments authorizes the caller; there is no
-- service-role path from the browser.

create or replace function public.live_order_queue_counts(
  p_brand_id bigint default null,
  p_integration_ids bigint[] default null
)
returns jsonb
language sql
stable
set search_path = ''
set statement_timeout to '15s'
as $$
  with scoped as (
    select o.source_status, o.placed_at
    from public.orders_read o
    where (p_brand_id is null or o.brand_id = p_brand_id)
      and (p_integration_ids is null or o.integration_id = any (p_integration_ids))
  ),
  by_status as (
    select source_status, count(*)::bigint as n
    from scoped
    group by 1
  )
  select jsonb_build_object(
    'by_status', coalesce((select jsonb_object_agg(source_status, n) from by_status), '{}'::jsonb),
    'total',     (select coalesce(sum(n), 0) from by_status),
    'new_24h',   (select count(*) from scoped where placed_at >= now() - interval '24 hours'),
    'courier', jsonb_build_object(
      'in_transit', (
        select count(*) from public.nv_shipments s
        where not s.is_terminal
          and s.rts_at is null
          and not s.on_rts_leg
          and coalesce(s.status, '') not ilike '%pending pickup%'
      ),
      'returned_14d', (
        select count(*) from public.nv_shipments s
        where s.rts_at >= now() - interval '14 days'
      )
    ),
    'computed_at', now()
  );
$$;

revoke all on function public.live_order_queue_counts(bigint, bigint[]) from public, anon;
grant execute on function public.live_order_queue_counts(bigint, bigint[]) to authenticated, service_role;
