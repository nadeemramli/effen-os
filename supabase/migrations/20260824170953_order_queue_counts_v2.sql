-- Orders section nav counts, v2.
--
-- v1 grouped every row in orders_read (282k, 86% completed) through a
-- materialized CTE and took ~4.5 s per call. Badges are for work queues, so v2
-- counts only the open statuses (~8k rows, index-only) and drops the archive
-- numbers (completed / cancelled / refunded / total) — those queues show no
-- badge. new_24h and the two courier-wide parcel counts stay; each is a few ms.
--
-- The partial covering index makes the open-status scan index-only even under
-- RLS (workspace_id) and brand/store scoping (brand_id, integration_id).
-- Measured as `authenticated` with RLS on 282k rows: ~340 ms cold, ~270 ms warm.

create index if not exists orders_read_open_status_scope_idx
  on public.orders_read (source_status, brand_id, integration_id)
  include (workspace_id, placed_at)
  where source_status in ('checkout-draft', 'pending', 'on-hold', 'failed', 'processing');

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
  select jsonb_build_object(
    'by_status', coalesce((
      select jsonb_object_agg(s.source_status, s.n)
      from (
        select o.source_status, count(*)::bigint as n
        from public.orders_read o
        where o.source_status in ('checkout-draft', 'pending', 'on-hold', 'failed', 'processing')
          and (p_brand_id is null or o.brand_id = p_brand_id)
          and (p_integration_ids is null or o.integration_id = any (p_integration_ids))
        group by 1
      ) s
    ), '{}'::jsonb),
    'new_24h', (
      select count(*) from public.orders_read o
      where o.placed_at >= now() - interval '24 hours'
        and (p_brand_id is null or o.brand_id = p_brand_id)
        and (p_integration_ids is null or o.integration_id = any (p_integration_ids))
    ),
    -- Courier-wide: parcels are Fighter-booked and mostly carry no brand.
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
