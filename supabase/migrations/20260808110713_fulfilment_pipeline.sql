-- Fulfilment pipeline (ADR-0006): the operational stage model that finally
-- consumes the ship-readiness green lane. One row per pilot-store order in
-- order_fulfilment, driven by a 5-minute pg_cron tick — intake, grade
-- (via ship_grades), auto-pass with a hold window, freeze on hold. Shadow
-- NV submission (nv-submit) reads gate_passed rows past eligible_at.
-- Per-store enablement is data: integration_connections.config
-- fulfilment_mode ∈ off|shadow|live (absent = off). Pilot: Synovil MY.

update public.integration_connections
set config = config || jsonb_build_object('fulfilment_mode', 'shadow', 'hold_minutes', 20)
where secret_ref = 'WOO_SYNOVIL_MY' and provider = 'WooCommerce';

create table public.order_fulfilment (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  integration_id bigint not null references public.integration_connections (id) on delete cascade,
  order_read_id bigint not null unique references public.orders_read (id) on delete cascade,
  stage text not null default 'intake' check (stage in
    ('intake', 'exception', 'gate_passed', 'held', 'ready_to_submit',
     'shadow_logged', 'submitted', 'in_transit', 'delivered', 'failed', 'cancelled')),
  gate_issues text[] not null default '{}',
  gate_warnings text[] not null default '{}',
  graded_at timestamptz,
  eligible_at timestamptz,          -- gate_passed and now() >= eligible_at ⇒ submittable
  held_by text,
  held_at timestamptz,
  hold_reason text,
  released_by text,
  released_at timestamptz,
  nv_submission_id bigint,          -- FK added with nv_submissions
  tracking_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index order_fulfilment_stage_idx on public.order_fulfilment (integration_id, stage);

alter table public.order_fulfilment enable row level security;
create policy member_read on public.order_fulfilment for select to authenticated
  using (private.is_workspace_member(workspace_id));

-- The tick. Security definer so pg_cron (and only pg_cron/service_role —
-- no grant to authenticated) can run it; ship_grades under the owner sees
-- all rows. A sync_runs row is written only when the tick changed
-- something or failed — cadence health comes from cron.job_run_details.
create or replace function public.fulfilment_gate_tick()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_int bigint;
  v_ws bigint;
  v_intake int := 0;
  v_cancelled int := 0;
  v_graded int := 0;
begin
  select id, workspace_id into v_int, v_ws from public.integration_connections
  where config->>'fulfilment_mode' in ('shadow', 'live')
  order by id limit 1;
  if v_int is null then
    return;
  end if;

  begin
    -- Intake: every processing order on an enabled store gets a pipeline row.
    insert into public.order_fulfilment (workspace_id, integration_id, order_read_id)
    select o.workspace_id, o.integration_id, o.id
    from public.orders_read o
    join public.integration_connections ic on ic.id = o.integration_id
    where ic.config->>'fulfilment_mode' in ('shadow', 'live')
      and o.source_status = 'processing'
      and o.placed_at > now() - interval '30 days'
    on conflict (order_read_id) do nothing;
    get diagnostics v_intake = row_count;

    -- Sweep: order died at the source before we did anything with it.
    update public.order_fulfilment f
    set stage = 'cancelled', updated_at = now()
    from public.orders_read o
    where o.id = f.order_read_id
      and f.stage in ('intake', 'exception', 'gate_passed', 'held', 'ready_to_submit')
      and o.source_status in ('cancelled', 'refunded', 'failed', 'trash');
    get diagnostics v_cancelled = row_count;

    -- Grade. Held rows are deliberately frozen until released; an already
    -- gate_passed row keeps its eligible_at (the window must not slide).
    update public.order_fulfilment f
    set gate_issues = coalesce(g.issues, '{}'),
        gate_warnings = coalesce(g.warnings, '{}'),
        graded_at = now(),
        stage = case when coalesce(array_length(g.issues, 1), 0) > 0
                     then 'exception' else 'gate_passed' end,
        eligible_at = case
          when coalesce(array_length(g.issues, 1), 0) > 0 then null
          when f.stage = 'gate_passed' and f.eligible_at is not null then f.eligible_at
          else now() + make_interval(mins => coalesce((ic.config->>'hold_minutes')::int, 20))
        end,
        updated_at = now()
    from public.ship_grades(30) g
    join public.integration_connections ic on true
    where g.id = f.order_read_id
      and ic.id = f.integration_id
      and f.stage in ('intake', 'exception', 'gate_passed');
    get diagnostics v_graded = row_count;

    if v_intake + v_cancelled > 0 then
      insert into public.sync_runs (workspace_id, integration_id, status, started_at, finished_at, records_read, records_written, message)
      values (v_ws, v_int, 'success', now(), now(), v_graded, v_intake + v_cancelled,
              'Gate: ' || v_intake || ' intake, ' || v_graded || ' graded, ' || v_cancelled || ' cancelled');
    end if;
  exception when others then
    insert into public.sync_runs (workspace_id, integration_id, status, started_at, finished_at, error_count, reason_code, message)
    values (v_ws, v_int, 'failed', now(), now(), 1, 'GATE_ERROR', 'Gate: ' || sqlerrm);
  end;
end;
$$;

revoke all on function public.fulfilment_gate_tick() from public, anon, authenticated;
grant execute on function public.fulfilment_gate_tick() to service_role;

-- Hold / release: the admin's guaranteed intervention. Mirrors the
-- save_order_correction shape — role-gated, audited.
create or replace function public.hold_fulfilment_order(
  p_order_read_id bigint,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_f record;
  v_actor text;
begin
  select f.id, f.stage, f.workspace_id, coalesce(o.order_number, o.source_order_id) as order_ref
  into v_f
  from public.order_fulfilment f
  join public.orders_read o on o.id = f.order_read_id
  where f.order_read_id = p_order_read_id;
  if v_f is null then
    raise exception 'No fulfilment pipeline row for this order';
  end if;
  if not private.has_role(v_f.workspace_id, array['hq_admin', 'operations']) then
    raise exception 'Only HQ admins or operations can hold orders';
  end if;
  if v_f.stage not in ('intake', 'exception', 'gate_passed') then
    raise exception 'Cannot hold an order in stage %', v_f.stage;
  end if;

  v_actor := coalesce((select display_name from public.profiles where id = (select auth.uid())), 'unknown');

  update public.order_fulfilment
  set stage = 'held', held_by = v_actor, held_at = now(), hold_reason = p_reason,
      eligible_at = null, updated_at = now()
  where id = v_f.id;

  insert into public.audit_events (workspace_id, actor_label, action, entity_ref, detail)
  values (v_f.workspace_id, v_actor, 'order.fulfilment_held', 'order:' || v_f.order_ref,
          'Order held before courier submission' || coalesce(': ' || p_reason, ''));
end;
$$;

revoke execute on function public.hold_fulfilment_order(bigint, text) from public, anon;
grant execute on function public.hold_fulfilment_order(bigint, text) to authenticated;

create or replace function public.release_fulfilment_order(p_order_read_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_f record;
  v_actor text;
begin
  select f.id, f.stage, f.workspace_id, coalesce(o.order_number, o.source_order_id) as order_ref
  into v_f
  from public.order_fulfilment f
  join public.orders_read o on o.id = f.order_read_id
  where f.order_read_id = p_order_read_id;
  if v_f is null then
    raise exception 'No fulfilment pipeline row for this order';
  end if;
  if not private.has_role(v_f.workspace_id, array['hq_admin', 'operations']) then
    raise exception 'Only HQ admins or operations can release orders';
  end if;
  if v_f.stage <> 'held' then
    raise exception 'Order is not held (stage %)', v_f.stage;
  end if;

  v_actor := coalesce((select display_name from public.profiles where id = (select auth.uid())), 'unknown');

  -- Back to intake: the next tick re-grades and opens a fresh hold window.
  update public.order_fulfilment
  set stage = 'intake', released_by = v_actor, released_at = now(), updated_at = now()
  where id = v_f.id;

  insert into public.audit_events (workspace_id, actor_label, action, entity_ref, detail)
  values (v_f.workspace_id, v_actor, 'order.fulfilment_released', 'order:' || v_f.order_ref,
          'Hold released; order re-enters the gate');
end;
$$;

revoke execute on function public.release_fulfilment_order(bigint) from public, anon;
grant execute on function public.release_fulfilment_order(bigint) to authenticated;

-- Read side for the UI: pipeline rows joined to order essentials.
-- Security invoker — RLS on both tables governs.
create or replace function public.live_fulfilment_pipeline(p_days integer default 14)
returns table (
  order_read_id bigint,
  integration_id bigint,
  brand_id bigint,
  order_number text,
  customer_name text,
  city text,
  postcode text,
  total numeric,
  currency_code text,
  stage text,
  gate_issues text[],
  gate_warnings text[],
  eligible_at timestamptz,
  held_by text,
  held_at timestamptz,
  hold_reason text,
  tracking_id text,
  placed_at timestamptz,
  updated_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  select f.order_read_id, f.integration_id, o.brand_id,
         coalesce(o.order_number, o.source_order_id),
         o.customer->>'name', o.customer->>'city', o.customer->>'postcode',
         o.total, o.currency_code,
         f.stage, f.gate_issues, f.gate_warnings, f.eligible_at,
         f.held_by, f.held_at, f.hold_reason, f.tracking_id,
         o.placed_at, f.updated_at
  from public.order_fulfilment f
  join public.orders_read o on o.id = f.order_read_id
  where f.stage = 'held'
     or o.placed_at > now() - make_interval(days => greatest(p_days, 1))
  order by o.placed_at desc;
$$;

revoke all on function public.live_fulfilment_pipeline(integer) from public, anon;
grant execute on function public.live_fulfilment_pipeline(integer) to authenticated, service_role;

select cron.schedule(
  'fulfilment-gate-tick',
  '*/5 * * * *',
  $$ select public.fulfilment_gate_tick(); $$
);
