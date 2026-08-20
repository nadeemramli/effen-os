-- NV shadow submission log (ADR-0006 / ADR-0002 Phase 1). nv-submit builds
-- the full Ninja Van order-create payload for every green, unheld,
-- past-hold-window pilot order and logs it here. In shadow mode NOTHING is
-- sent to Ninja Van — the payload is evidence.
--
-- Comparison ground truth (checked 2026-08-08): NV webhook events carry no
-- recipient fields and nv_shipments.brand_id is unpopulated, so shadow
-- payloads cannot be field-diffed against real consignments yet (that
-- needs the NV order-details API — on ADR-0002's stakeholder ask list).
-- Until then the compare pass validates ORDER-LEVEL COVERAGE against Woo:
-- Fighter shipping an order flips its Woo status to completed, so
--   matched    = the order we would have submitted was shipped
--   mismatched = it was cancelled/refunded after passing the gate
--                (live mode must handle this timing edge via NV cancel)
--   unmatched  = 7+ days and never shipped — investigate
-- Payload fidelity stays a manual eyeball vs the NV dashboard for now.

create table public.nv_submissions (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  integration_id bigint not null references public.integration_connections (id),
  order_read_id bigint not null references public.orders_read (id) on delete cascade,
  mode text not null check (mode in ('shadow', 'live')),
  idempotency_key text not null unique,     -- 'FK-{integration_id}-{source_order_id}'
  payload jsonb not null,                   -- full NV order-create body
  status text not null default 'generated'
    check (status in ('generated', 'matched', 'mismatched', 'unmatched',
                      'submitted', 'accepted', 'rejected', 'error')),
  response jsonb,                           -- live-mode NV response
  compare jsonb,                            -- {matched_by, woo_status, tracking_id?, days_open}
  matched_shipment_id bigint references public.nv_shipments (id),
  created_at timestamptz not null default now(),
  compared_at timestamptz
);

create unique index nv_submissions_order_mode_idx on public.nv_submissions (order_read_id, mode);
create index nv_submissions_status_idx on public.nv_submissions (mode, status);

alter table public.nv_submissions enable row level security;
create policy member_read on public.nv_submissions for select to authenticated
  using (private.is_workspace_member(workspace_id));

alter table public.order_fulfilment
  add constraint order_fulfilment_nv_submission_fk
  foreign key (nv_submission_id) references public.nv_submissions (id);

-- OAuth token cache for live mode. Service-role only: RLS enabled with no
-- select policy, so PostgREST exposes nothing.
create table public.nv_tokens (
  provider text primary key default 'ninjavan',
  access_token text not null,
  expires_at timestamptz not null
);
alter table public.nv_tokens enable row level security;

-- The shadow evidence surface (ADR-0006 exit gate: coverage ≥99% for two
-- consecutive weeks). Security invoker — RLS governs.
create or replace function public.live_shadow_report(p_days integer default 14)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'totals', (
      select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
      from (
        select status, count(*) as n
        from public.nv_submissions
        where created_at > now() - make_interval(days => greatest(p_days, 1))
        group by status
      ) t
    ),
    'coverage_pct', (
      select round(100.0 * count(*) filter (where status = 'matched')
             / nullif(count(*) filter (where status in ('matched', 'mismatched', 'unmatched')), 0), 2)
      from public.nv_submissions
      where created_at > now() - make_interval(days => greatest(p_days, 1))
    ),
    'open', (
      select count(*) from public.nv_submissions
      where status = 'generated'
        and created_at > now() - make_interval(days => greatest(p_days, 1))
    ),
    'daily', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'day', day, 'shadow', shadow, 'matched', matched, 'mismatched', mismatched) order by day), '[]'::jsonb)
      from (
        select date_trunc('day', created_at)::date as day,
               count(*) as shadow,
               count(*) filter (where status = 'matched') as matched,
               count(*) filter (where status = 'mismatched') as mismatched
        from public.nv_submissions
        where created_at > now() - make_interval(days => greatest(p_days, 1))
        group by 1
      ) d
    ),
    'recent_exceptions', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'order_number', coalesce(o.order_number, o.source_order_id),
               'status', s.status, 'compare', s.compare, 'created_at', s.created_at)
               order by s.compared_at desc), '[]'::jsonb)
      from (
        select * from public.nv_submissions
        where status in ('mismatched', 'unmatched')
          and created_at > now() - make_interval(days => greatest(p_days, 1))
        order by compared_at desc nulls last
        limit 20
      ) s
      join public.orders_read o on o.id = s.order_read_id
    )
  );
$$;

revoke all on function public.live_shadow_report(integer) from public, anon;
grant execute on function public.live_shadow_report(integer) to authenticated, service_role;

-- The live flip (and instant rollback) — hq_admin only, audited.
create or replace function public.set_fulfilment_mode(
  p_integration_id bigint,
  p_mode text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conn record;
  v_actor text;
begin
  if p_mode not in ('off', 'shadow', 'live') then
    raise exception 'Mode must be off, shadow, or live';
  end if;
  select id, workspace_id, name into v_conn
  from public.integration_connections where id = p_integration_id and provider = 'WooCommerce';
  if v_conn is null then
    raise exception 'Unknown WooCommerce connection';
  end if;
  if not private.has_role(v_conn.workspace_id, array['hq_admin']) then
    raise exception 'Only HQ admins can change the fulfilment mode';
  end if;

  update public.integration_connections
  set config = config || jsonb_build_object('fulfilment_mode', p_mode)
  where id = p_integration_id;

  v_actor := coalesce((select display_name from public.profiles where id = (select auth.uid())), 'unknown');
  insert into public.audit_events (workspace_id, actor_label, action, entity_ref, detail)
  values (v_conn.workspace_id, v_actor, 'fulfilment.mode_changed',
          'integration:' || v_conn.id,
          v_conn.name || ' fulfilment mode set to ' || p_mode);
end;
$$;

revoke execute on function public.set_fulfilment_mode(bigint, text) from public, anon;
grant execute on function public.set_fulfilment_mode(bigint, text) to authenticated;
