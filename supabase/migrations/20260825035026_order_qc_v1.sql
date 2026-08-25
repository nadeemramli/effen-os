-- Applied 2026-08-25 via MCP apply_migration; filed under the recorded version 20260825035026.
-- order_qc_v1 — Phase 4 of the operational-workspaces program: Orders New/QC and Draft.
--
-- 1. public.order_qc: one explicit QC record per mirrored order (or confirmed
--    draft): qc_state, reason codes, owner, due, last contact attempt,
--    reservation/release results (never implied), and a version for
--    optimistic concurrency. Source (Woo) states are never overwritten.
-- 2. public.order_qc_events: append-only transition log (from/to/action/actor).
-- 3. public.order_drafts: server-side manual-order drafts (idempotent save,
--    confirm into the same QC queue, discard). No stock, no courier, no
--    store write — the store order is created only when the write path is
--    enabled (ADR-0006 style gate).
-- 4. Commands: qc_enrol, qc_start_review, qc_request_information,
--    qc_correct_and_revalidate, qc_hold, qc_assign, qc_approve, qc_reject,
--    save_order_draft, confirm_order_draft, discard_order_draft. All are
--    SECURITY DEFINER, role-checked, version-checked, and write both an
--    order_qc_events row and an audit_events row with before/after data.
--    "Request information" creates an internal work item as the shadow
--    dispatch job; nothing is sent to the customer.
-- 5. private.qc_enrol_open_orders(): enrols open mirrored orders placed in
--    the last 7 days as `new` and marks QC `cancelled` when the source order
--    is cancelled/refunded; scheduled every 15 minutes after the Woo sync.
-- 6. live_order_queue_counts gains `qc` and `drafts`; live_workspace_members
--    backs the owner picker.
--
-- Additive only. No table is dropped and no applied migration is edited.

------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------
create table if not exists public.order_drafts (
  id bigserial primary key,
  workspace_id bigint not null references public.workspaces(id),
  integration_id bigint not null references public.integration_connections(id),
  brand_id bigint references public.brands(id),
  currency_code text not null default 'MYR',
  customer jsonb not null default '{}'::jsonb,
  shipping jsonb not null default '{}'::jsonb,
  items jsonb not null default '[]'::jsonb,
  payment_method text not null default 'cod' check (payment_method in ('cod', 'online')),
  note text,
  total numeric(19,4) not null default 0,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'discarded')),
  idempotency_key text not null,
  created_by_membership_id bigint references public.memberships(id),
  confirmed_at timestamptz,
  discarded_at timestamptz,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);
create index if not exists order_drafts_status_idx on public.order_drafts (workspace_id, status, updated_at desc);

create table if not exists public.order_qc (
  id bigserial primary key,
  workspace_id bigint not null references public.workspaces(id),
  source text not null check (source in ('woo', 'draft')),
  order_read_id bigint unique references public.orders_read(id) on delete cascade,
  draft_id bigint unique references public.order_drafts(id) on delete cascade,
  qc_state text not null default 'new'
    check (qc_state in ('new', 'in_review', 'needs_customer_info', 'on_hold', 'approved', 'rejected', 'cancelled')),
  reason_codes text[] not null default '{}',
  owner_membership_id bigint references public.memberships(id),
  due_at timestamptz,
  last_contact_attempt_at timestamptz,
  -- Approval never implies these; they are set by later, separate steps.
  reservation_state text not null default 'not_requested',
  fulfilment_release_state text not null default 'not_released',
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((order_read_id is null) <> (draft_id is null))
);
create index if not exists order_qc_state_idx on public.order_qc (workspace_id, qc_state);
create index if not exists order_qc_owner_open_idx on public.order_qc (owner_membership_id)
  where qc_state in ('new', 'in_review', 'needs_customer_info', 'on_hold');

create table if not exists public.order_qc_events (
  id bigserial primary key,
  workspace_id bigint not null references public.workspaces(id),
  order_qc_id bigint not null references public.order_qc(id) on delete cascade,
  action text not null,
  from_state text,
  to_state text not null,
  reason_codes text[] not null default '{}',
  note text,
  actor_membership_id bigint,
  actor_label text not null,
  version integer not null,
  created_at timestamptz not null default now()
);
create index if not exists order_qc_events_qc_idx on public.order_qc_events (order_qc_id, created_at);

comment on table public.order_qc is 'Explicit QC workflow state per order. Source (Woo) status is never overwritten; approval never implies reservation, courier, AWB, handover, pickup or delivery.';
comment on table public.order_qc_events is 'Append-only QC transition log. Every command writes one row here and one row in audit_events.';
comment on table public.order_drafts is 'Server-side manual-order drafts. Confirm enrols the draft in QC; no store write happens until the write path is enabled.';

-- RLS: members read; only the commands below write.
alter table public.order_drafts enable row level security;
alter table public.order_qc enable row level security;
alter table public.order_qc_events enable row level security;
drop policy if exists member_read on public.order_drafts;
create policy member_read on public.order_drafts for select to authenticated using (private.is_workspace_member(workspace_id));
drop policy if exists member_read on public.order_qc;
create policy member_read on public.order_qc for select to authenticated using (private.is_workspace_member(workspace_id));
drop policy if exists member_read on public.order_qc_events;
create policy member_read on public.order_qc_events for select to authenticated using (private.is_workspace_member(workspace_id));
revoke all on public.order_drafts, public.order_qc, public.order_qc_events from anon, authenticated;
grant select on public.order_drafts, public.order_qc, public.order_qc_events to authenticated;
grant all on public.order_drafts, public.order_qc, public.order_qc_events to service_role;
grant usage, select on sequence public.order_drafts_id_seq, public.order_qc_id_seq, public.order_qc_events_id_seq to service_role;

------------------------------------------------------------------------
-- Helpers (private)
------------------------------------------------------------------------
create or replace function private.qc_reason_codes()
returns text[] language sql immutable parallel safe set search_path = '' as $$
  select array['recipient_identity', 'phone_invalid', 'email_missing', 'address_incomplete',
               'postcode_state_mismatch', 'product_unmapped', 'quantity_bundle', 'stock_shortage',
               'payment_cod_unresolved', 'duplicate_risk', 'courier_unserviceable', 'consent_contact'];
$$;

create or replace function private.qc_open_states()
returns text[] language sql immutable parallel safe set search_path = '' as $$
  select array['new', 'in_review', 'needs_customer_info', 'on_hold'];
$$;

-- Caller's membership + display label in the (single) workspace.
create or replace function private.qc_actor(out membership_id bigint, out label text)
language plpgsql stable security definer set search_path = '' as $$
begin
  select m.id, coalesce(p.display_name, 'unknown') into membership_id, label
  from public.memberships m
  left join public.profiles p on p.id = m.user_id
  where m.workspace_id = (select min(id) from public.workspaces)
    and m.user_id = (select auth.uid()) and m.status = 'active'
  limit 1;
  if label is null then label := 'unknown'; end if;
end;
$$;

create or replace function private.qc_entity_ref(p_qc public.order_qc)
returns text language sql stable set search_path = '' as $$
  select case
    when p_qc.order_read_id is not null then
      'order:' || (select coalesce(o.order_number, o.source_order_id) from public.orders_read o where o.id = p_qc.order_read_id)
    else 'draft:' || p_qc.draft_id
  end;
$$;

/*
 * The one place a QC record changes. Locks the row, checks role, version and
 * the transition table, applies the patch, then writes the event and the
 * audit row. p_to_state null = state unchanged (assign). p_reason_codes null
 * = keep; otherwise replace.
 */
create or replace function private.qc_apply(
  p_qc_id bigint, p_action text, p_to_state text, p_from_allowed text[], p_roles text[],
  p_reason_codes text[], p_note text, p_expected_version integer, p_patch jsonb)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v public.order_qc;
  v_new public.order_qc;
  v_actor record;
  v_bad text[];
  v_to text;
begin
  select * into v from public.order_qc where id = p_qc_id for update;
  if v.id is null then raise exception 'No QC record %', p_qc_id; end if;
  if not private.has_role(v.workspace_id, p_roles) then
    raise exception 'Not allowed: % needs one of %', p_action, array_to_string(p_roles, ', ');
  end if;
  if p_expected_version is not null and v.version <> p_expected_version then
    raise exception 'QC record changed since you loaded it (version % vs %); reload and retry', v.version, p_expected_version;
  end if;
  if p_from_allowed is not null and not (v.qc_state = any (p_from_allowed)) then
    raise exception 'Cannot % an order in state %', replace(p_action, '_', ' '), v.qc_state;
  end if;
  if p_reason_codes is not null then
    select array_agg(c) into v_bad from unnest(p_reason_codes) c where not (c = any (private.qc_reason_codes()));
    if v_bad is not null then raise exception 'Unknown reason code(s): %', array_to_string(v_bad, ', '); end if;
  end if;

  select * into v_actor from private.qc_actor();
  v_to := coalesce(p_to_state, v.qc_state);

  update public.order_qc set
    qc_state = v_to,
    reason_codes = coalesce(p_reason_codes, reason_codes),
    owner_membership_id = case when p_patch ? 'owner_membership_id' then (p_patch->>'owner_membership_id')::bigint else owner_membership_id end,
    due_at = case when p_patch ? 'due_at' then (p_patch->>'due_at')::timestamptz else due_at end,
    last_contact_attempt_at = case when p_patch ? 'last_contact_attempt_at' then (p_patch->>'last_contact_attempt_at')::timestamptz else last_contact_attempt_at end,
    version = version + 1,
    updated_at = now()
  where id = v.id
  returning * into v_new;

  insert into public.order_qc_events (workspace_id, order_qc_id, action, from_state, to_state, reason_codes, note, actor_membership_id, actor_label, version)
  values (v.workspace_id, v.id, p_action, v.qc_state, v_to, coalesce(p_reason_codes, '{}'), p_note, v_actor.membership_id, v_actor.label, v_new.version);

  insert into public.audit_events (workspace_id, actor_membership_id, actor_label, action, entity_ref, detail, before_data, after_data)
  values (v.workspace_id, v_actor.membership_id, v_actor.label, 'order.qc_' || p_action, private.qc_entity_ref(v),
          'QC ' || replace(p_action, '_', ' ') || ': ' || v.qc_state || ' -> ' || v_to || coalesce(' [' || array_to_string(p_reason_codes, ', ') || ']', '') || coalesce(': ' || left(p_note, 500), ''),
          jsonb_build_object('qc_state', v.qc_state, 'reason_codes', v.reason_codes, 'owner_membership_id', v.owner_membership_id, 'due_at', v.due_at, 'version', v.version),
          jsonb_build_object('qc_state', v_new.qc_state, 'reason_codes', v_new.reason_codes, 'owner_membership_id', v_new.owner_membership_id, 'due_at', v_new.due_at, 'version', v_new.version));

  return jsonb_build_object('qc', to_jsonb(v_new));
end;
$$;

------------------------------------------------------------------------
-- Enrolment
------------------------------------------------------------------------
-- Manual enrolment of any open mirrored order (older than the 7-day window). Idempotent.
create or replace function public.qc_enrol(p_order_read_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_o record;
  v_actor record;
  v_qc public.order_qc;
begin
  select o.id, o.workspace_id, o.source_status, coalesce(o.order_number, o.source_order_id) as ref into v_o
  from public.orders_read o where o.id = p_order_read_id;
  if v_o.id is null then raise exception 'Unknown order'; end if;
  if not private.has_role(v_o.workspace_id, array['hq_admin', 'operations', 'sales_cs']) then
    raise exception 'Not allowed to enrol orders in QC';
  end if;
  select * into v_qc from public.order_qc where order_read_id = p_order_read_id;
  if v_qc.id is not null then return jsonb_build_object('qc', to_jsonb(v_qc), 'created', false); end if;
  if v_o.source_status not in ('pending', 'on-hold', 'processing') then
    raise exception 'Only open orders (pending, on-hold, processing) enter QC; this one is %', v_o.source_status;
  end if;
  select * into v_actor from private.qc_actor();
  insert into public.order_qc (workspace_id, source, order_read_id, qc_state)
  values (v_o.workspace_id, 'woo', p_order_read_id, 'new') returning * into v_qc;
  insert into public.order_qc_events (workspace_id, order_qc_id, action, from_state, to_state, actor_membership_id, actor_label, version)
  values (v_o.workspace_id, v_qc.id, 'enrolled', null, 'new', v_actor.membership_id, v_actor.label, 1);
  insert into public.audit_events (workspace_id, actor_membership_id, actor_label, action, entity_ref, detail, after_data)
  values (v_o.workspace_id, v_actor.membership_id, v_actor.label, 'order.qc_enrolled', 'order:' || v_o.ref, 'Order enrolled in QC by hand', jsonb_build_object('qc_state', 'new', 'version', 1));
  return jsonb_build_object('qc', to_jsonb(v_qc), 'created', true);
end;
$$;

-- System enrolment (cron): open orders from the last 7 days become `new`;
-- QC records whose source order was cancelled/refunded become `cancelled`.
create or replace function private.qc_enrol_open_orders()
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '2min' as $$
declare
  v_enrolled integer := 0;
  v_cancelled integer := 0;
  r record;
begin
  for r in
    select o.id, o.workspace_id
    from public.orders_read o
    where o.source_status in ('pending', 'on-hold', 'processing')
      and o.placed_at >= now() - interval '7 days'
      and not exists (select 1 from public.order_qc q where q.order_read_id = o.id)
    order by o.placed_at
  loop
    insert into public.order_qc (workspace_id, source, order_read_id, qc_state) values (r.workspace_id, 'woo', r.id, 'new');
    insert into public.order_qc_events (workspace_id, order_qc_id, action, from_state, to_state, actor_label, version)
    values (r.workspace_id, currval('public.order_qc_id_seq'), 'enrolled', null, 'new', 'system', 1);
    v_enrolled := v_enrolled + 1;
  end loop;

  for r in
    select q.id, q.workspace_id, q.qc_state, q.version, o.source_status
    from public.order_qc q join public.orders_read o on o.id = q.order_read_id
    where q.qc_state = any (private.qc_open_states()) and o.source_status in ('cancelled', 'refunded')
  loop
    update public.order_qc set qc_state = 'cancelled', version = version + 1, updated_at = now() where id = r.id;
    insert into public.order_qc_events (workspace_id, order_qc_id, action, from_state, to_state, note, actor_label, version)
    values (r.workspace_id, r.id, 'source_cancelled', r.qc_state, 'cancelled', 'Source order is ' || r.source_status, 'system', r.version + 1);
    v_cancelled := v_cancelled + 1;
  end loop;

  return jsonb_build_object('enrolled', v_enrolled, 'cancelled', v_cancelled, 'at', now());
end;
$$;

------------------------------------------------------------------------
-- Commands
------------------------------------------------------------------------
create or replace function public.qc_start_review(p_qc_id bigint, p_note text default null, p_expected_version integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor record; v_owner bigint;
begin
  select * into v_actor from private.qc_actor();
  select owner_membership_id into v_owner from public.order_qc where id = p_qc_id;
  return private.qc_apply(p_qc_id, 'start_review', 'in_review', array['new', 'needs_customer_info', 'on_hold'],
    array['hq_admin', 'operations', 'sales_cs'], null, p_note, p_expected_version,
    case when v_owner is null and v_actor.membership_id is not null then jsonb_build_object('owner_membership_id', v_actor.membership_id) else '{}'::jsonb end);
end;
$$;

-- Creates the shadow dispatch job (an internal work item). Nothing is sent.
create or replace function public.qc_request_information(
  p_qc_id bigint, p_reason_codes text[], p_note text default null,
  p_channel text default 'whatsapp_manual', p_expected_version integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_res jsonb; v_qc public.order_qc; v_actor record; v_job bigint;
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
  return v_res || jsonb_build_object('dispatch_job_id', v_job, 'sent', false);
end;
$$;

-- Optional shipping correction (staged, via the existing save_order_correction) then back to review.
create or replace function public.qc_correct_and_revalidate(p_qc_id bigint, p_corrected jsonb default null, p_note text default null, p_expected_version integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_qc public.order_qc;
begin
  select * into v_qc from public.order_qc where id = p_qc_id;
  if v_qc.id is null then raise exception 'No QC record %', p_qc_id; end if;
  if p_corrected is not null and p_corrected <> '{}'::jsonb then
    if v_qc.order_read_id is null then raise exception 'Corrections apply to mirrored orders only; edit the draft instead'; end if;
    perform public.save_order_correction(v_qc.order_read_id, p_corrected, p_note);
  end if;
  return private.qc_apply(p_qc_id, 'correct_and_revalidate', 'in_review', array['new', 'in_review', 'needs_customer_info', 'on_hold'],
    array['hq_admin', 'operations'], null, p_note, p_expected_version, '{}'::jsonb);
end;
$$;

-- Hold: QC on_hold plus a fulfilment-pipeline hold when the order has a holdable pipeline row.
create or replace function public.qc_hold(p_qc_id bigint, p_reason_codes text[], p_note text default null, p_expected_version integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_res jsonb; v_qc public.order_qc; v_held boolean := false;
begin
  v_res := private.qc_apply(p_qc_id, 'hold', 'on_hold', array['new', 'in_review', 'needs_customer_info'],
    array['hq_admin', 'operations'], p_reason_codes, p_note, p_expected_version, '{}'::jsonb);
  select * into v_qc from public.order_qc where id = p_qc_id;
  if v_qc.order_read_id is not null and exists (
    select 1 from public.order_fulfilment f where f.order_read_id = v_qc.order_read_id and f.stage in ('intake', 'exception', 'gate_passed')) then
    perform public.hold_fulfilment_order(v_qc.order_read_id, coalesce(p_note, 'QC hold'));
    v_held := true;
  end if;
  return v_res || jsonb_build_object('pipeline_held', v_held);
end;
$$;

create or replace function public.qc_assign(p_qc_id bigint, p_owner_membership_id bigint, p_due_at timestamptz default null, p_expected_version integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if p_owner_membership_id is not null and not exists (
    select 1 from public.memberships m where m.id = p_owner_membership_id and m.status = 'active'
      and m.workspace_id = (select workspace_id from public.order_qc where id = p_qc_id)) then
    raise exception 'Owner must be an active workspace member';
  end if;
  return private.qc_apply(p_qc_id, 'assign', null, private.qc_open_states(),
    array['hq_admin', 'operations', 'sales_cs'], null, null, p_expected_version,
    jsonb_build_object('owner_membership_id', p_owner_membership_id, 'due_at', p_due_at));
end;
$$;

-- Approval clears QC only. reservation_state / fulfilment_release_state are untouched.
create or replace function public.qc_approve(p_qc_id bigint, p_note text default null, p_expected_version integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return private.qc_apply(p_qc_id, 'approve', 'approved', private.qc_open_states(),
    array['hq_admin', 'operations'], null, p_note, p_expected_version, '{}'::jsonb);
end;
$$;

-- Rejection also holds the fulfilment pipeline so a rejected order cannot reach a courier.
create or replace function public.qc_reject(p_qc_id bigint, p_reason_codes text[], p_note text default null, p_expected_version integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_res jsonb; v_qc public.order_qc; v_held boolean := false;
begin
  if p_reason_codes is null or cardinality(p_reason_codes) = 0 then raise exception 'A rejection needs at least one reason code'; end if;
  v_res := private.qc_apply(p_qc_id, 'reject', 'rejected', private.qc_open_states(),
    array['hq_admin', 'operations'], p_reason_codes, p_note, p_expected_version, '{}'::jsonb);
  select * into v_qc from public.order_qc where id = p_qc_id;
  if v_qc.order_read_id is not null and exists (
    select 1 from public.order_fulfilment f where f.order_read_id = v_qc.order_read_id and f.stage in ('intake', 'exception', 'gate_passed')) then
    perform public.hold_fulfilment_order(v_qc.order_read_id, 'QC rejected: ' || array_to_string(p_reason_codes, ', '));
    v_held := true;
  end if;
  return v_res || jsonb_build_object('pipeline_held', v_held);
end;
$$;

------------------------------------------------------------------------
-- Drafts
------------------------------------------------------------------------
create or replace function private.draft_total(p_items jsonb)
returns numeric language sql immutable set search_path = '' as $$
  select coalesce(sum((i->>'quantity')::numeric * (i->>'unit_price')::numeric), 0)
  from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i;
$$;

create or replace function public.save_order_draft(
  p_id bigint default null, p_integration_id bigint default null, p_customer jsonb default '{}'::jsonb,
  p_shipping jsonb default '{}'::jsonb, p_items jsonb default '[]'::jsonb, p_payment_method text default 'cod',
  p_note text default null, p_currency_code text default null, p_idempotency_key text default null,
  p_expected_version integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ws bigint := (select min(id) from public.workspaces);
  v_conn record; v_brand bigint; v_ccy text; v_actor record; v_d public.order_drafts; i jsonb;
begin
  if not private.has_role(v_ws, array['hq_admin', 'sales_cs']) then raise exception 'Not allowed to create manual orders'; end if;
  if jsonb_typeof(p_items) <> 'array' then raise exception 'Items must be an array'; end if;
  for i in select * from jsonb_array_elements(p_items) loop
    if coalesce((i->>'quantity')::numeric, 0) <= 0 or (i->>'unit_price') is null or coalesce(nullif(i->>'sku', ''), nullif(i->>'name', '')) is null then
      raise exception 'Each item needs a sku or name, a positive quantity and a unit price';
    end if;
  end loop;
  if p_payment_method not in ('cod', 'online') then raise exception 'Payment method must be cod or online'; end if;
  select * into v_actor from private.qc_actor();

  if p_id is null then
    if p_integration_id is null then raise exception 'A store is required'; end if;
    if p_idempotency_key is null then raise exception 'An idempotency key is required for a new draft'; end if;
    select c.id, c.config into v_conn from public.integration_connections c
    where c.id = p_integration_id and c.workspace_id = v_ws and c.provider = 'WooCommerce';
    if v_conn.id is null then raise exception 'Unknown store'; end if;
    select b.id into v_brand from public.brands b where b.workspace_id = v_ws and b.slug = v_conn.config->>'brand_slug';
    v_ccy := coalesce(p_currency_code, case when v_conn.config->>'country_code' = 'SG' then 'SGD' else 'MYR' end);
    insert into public.order_drafts (workspace_id, integration_id, brand_id, currency_code, customer, shipping, items, payment_method, note, total, idempotency_key, created_by_membership_id)
    values (v_ws, p_integration_id, v_brand, v_ccy, coalesce(p_customer, '{}'), coalesce(p_shipping, '{}'), p_items, p_payment_method, p_note, private.draft_total(p_items), p_idempotency_key, v_actor.membership_id)
    on conflict (workspace_id, idempotency_key) do update set updated_at = public.order_drafts.updated_at
    returning * into v_d;
    if v_d.version = 1 and v_d.created_at = v_d.updated_at then
      insert into public.audit_events (workspace_id, actor_membership_id, actor_label, action, entity_ref, detail, after_data)
      values (v_ws, v_actor.membership_id, v_actor.label, 'order.draft_saved', 'draft:' || v_d.id, 'Manual order draft created (no store write)', jsonb_build_object('total', v_d.total, 'items', jsonb_array_length(p_items), 'version', 1));
    end if;
    return jsonb_build_object('draft', to_jsonb(v_d));
  end if;

  select * into v_d from public.order_drafts where id = p_id and workspace_id = v_ws for update;
  if v_d.id is null then raise exception 'No such draft'; end if;
  if v_d.status <> 'draft' then raise exception 'Draft is %; it can no longer be edited', v_d.status; end if;
  if p_expected_version is not null and v_d.version <> p_expected_version then raise exception 'Draft changed since you loaded it; reload and retry'; end if;
  update public.order_drafts set
    customer = coalesce(p_customer, customer), shipping = coalesce(p_shipping, shipping), items = p_items,
    payment_method = p_payment_method, note = p_note, currency_code = coalesce(p_currency_code, currency_code),
    total = private.draft_total(p_items), version = version + 1, updated_at = now()
  where id = v_d.id returning * into v_d;
  insert into public.audit_events (workspace_id, actor_membership_id, actor_label, action, entity_ref, detail, after_data)
  values (v_ws, v_actor.membership_id, v_actor.label, 'order.draft_saved', 'draft:' || v_d.id, 'Manual order draft updated', jsonb_build_object('total', v_d.total, 'items', jsonb_array_length(p_items), 'version', v_d.version));
  return jsonb_build_object('draft', to_jsonb(v_d));
end;
$$;

-- Confirm: the draft is frozen and enters QC as `new`. No stock, no courier, no store write.
create or replace function public.confirm_order_draft(p_id bigint, p_expected_version integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ws bigint := (select min(id) from public.workspaces);
  v_actor record; v_d public.order_drafts; v_qc public.order_qc;
begin
  if not private.has_role(v_ws, array['hq_admin', 'sales_cs']) then raise exception 'Not allowed to confirm manual orders'; end if;
  select * into v_d from public.order_drafts where id = p_id and workspace_id = v_ws for update;
  if v_d.id is null then raise exception 'No such draft'; end if;
  if v_d.status = 'confirmed' then
    select * into v_qc from public.order_qc where draft_id = v_d.id;
    return jsonb_build_object('draft', to_jsonb(v_d), 'qc', to_jsonb(v_qc), 'changed', false);
  end if;
  if v_d.status <> 'draft' then raise exception 'Draft is %', v_d.status; end if;
  if p_expected_version is not null and v_d.version <> p_expected_version then raise exception 'Draft changed since you loaded it; reload and retry'; end if;
  if jsonb_array_length(v_d.items) = 0 then raise exception 'Add at least one item before confirming'; end if;
  if nullif(v_d.customer->>'name', '') is null or nullif(v_d.customer->>'phone', '') is null then raise exception 'Customer name and phone are required'; end if;
  if nullif(v_d.shipping->>'address_1', '') is null or nullif(v_d.shipping->>'postcode', '') is null then raise exception 'Delivery address and postcode are required'; end if;
  select * into v_actor from private.qc_actor();
  update public.order_drafts set status = 'confirmed', confirmed_at = now(), version = version + 1, updated_at = now() where id = v_d.id returning * into v_d;
  insert into public.order_qc (workspace_id, source, draft_id, qc_state, owner_membership_id)
  values (v_ws, 'draft', v_d.id, 'new', v_actor.membership_id) returning * into v_qc;
  insert into public.order_qc_events (workspace_id, order_qc_id, action, from_state, to_state, actor_membership_id, actor_label, version)
  values (v_ws, v_qc.id, 'enrolled', null, 'new', v_actor.membership_id, v_actor.label, 1);
  insert into public.audit_events (workspace_id, actor_membership_id, actor_label, action, entity_ref, detail, before_data, after_data)
  values (v_ws, v_actor.membership_id, v_actor.label, 'order.draft_confirmed', 'draft:' || v_d.id,
          'Manual order confirmed into QC; store order is created only when the write path is enabled',
          jsonb_build_object('status', 'draft'), jsonb_build_object('status', 'confirmed', 'qc_id', v_qc.id, 'total', v_d.total, 'currency', v_d.currency_code));
  return jsonb_build_object('draft', to_jsonb(v_d), 'qc', to_jsonb(v_qc), 'changed', true);
end;
$$;

create or replace function public.discard_order_draft(p_id bigint, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ws bigint := (select min(id) from public.workspaces); v_actor record; v_d public.order_drafts;
begin
  if not private.has_role(v_ws, array['hq_admin', 'sales_cs']) then raise exception 'Not allowed to discard manual orders'; end if;
  select * into v_d from public.order_drafts where id = p_id and workspace_id = v_ws for update;
  if v_d.id is null then raise exception 'No such draft'; end if;
  if v_d.status <> 'draft' then return jsonb_build_object('draft', to_jsonb(v_d), 'changed', false); end if;
  select * into v_actor from private.qc_actor();
  update public.order_drafts set status = 'discarded', discarded_at = now(), version = version + 1, updated_at = now() where id = v_d.id returning * into v_d;
  insert into public.audit_events (workspace_id, actor_membership_id, actor_label, action, entity_ref, detail, before_data, after_data)
  values (v_ws, v_actor.membership_id, v_actor.label, 'order.draft_discarded', 'draft:' || v_d.id, 'Manual order draft discarded' || coalesce(': ' || left(p_note, 500), ''),
          jsonb_build_object('status', 'draft'), jsonb_build_object('status', 'discarded'));
  return jsonb_build_object('draft', to_jsonb(v_d), 'changed', true);
end;
$$;

------------------------------------------------------------------------
-- Reads
------------------------------------------------------------------------
create or replace function public.live_workspace_members()
returns table(membership_id bigint, display_name text, role_key text)
language sql stable security definer set search_path = '' as $$
  select m.id, coalesce(p.display_name, 'Member ' || m.id), m.role_key
  from public.memberships m
  left join public.profiles p on p.id = m.user_id
  where m.workspace_id = (select min(id) from public.workspaces) and m.status = 'active'
    and private.is_workspace_member(m.workspace_id)
  order by 2;
$$;

-- Queue counts: existing shape plus `qc` (open QC states, scoped) and `drafts`.
create or replace function public.live_order_queue_counts(p_brand_id bigint default null, p_integration_ids bigint[] default null)
returns jsonb language sql stable set search_path = '' set statement_timeout = '15s' as $$
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
    'qc', (
      select jsonb_build_object(
        'new', count(*) filter (where q.qc_state = 'new'),
        'in_review', count(*) filter (where q.qc_state = 'in_review'),
        'needs_customer_info', count(*) filter (where q.qc_state = 'needs_customer_info'),
        'on_hold', count(*) filter (where q.qc_state = 'on_hold'),
        'open', count(*))
      from public.order_qc q
      left join public.orders_read o on o.id = q.order_read_id
      left join public.order_drafts d on d.id = q.draft_id
      where q.qc_state in ('new', 'in_review', 'needs_customer_info', 'on_hold')
        and (p_brand_id is null or coalesce(o.brand_id, d.brand_id) = p_brand_id)
        and (p_integration_ids is null or coalesce(o.integration_id, d.integration_id) = any (p_integration_ids))
    ),
    'drafts', (
      select count(*) from public.order_drafts d
      where d.status = 'draft'
        and (p_brand_id is null or d.brand_id = p_brand_id)
        and (p_integration_ids is null or d.integration_id = any (p_integration_ids))
    ),
    -- Courier-wide: parcels are Fighter-booked and mostly carry no brand.
    'courier', jsonb_build_object(
      'in_transit', (
        select count(*) from public.nv_shipments s
        where not s.is_terminal and s.rts_at is null and not s.on_rts_leg
          and coalesce(s.status, '') not ilike '%pending pickup%'
      ),
      'returned_14d', (select count(*) from public.nv_shipments s where s.rts_at >= now() - interval '14 days')
    ),
    'computed_at', now()
  );
$$;

------------------------------------------------------------------------
-- Grants
------------------------------------------------------------------------
revoke all on function public.qc_enrol(bigint) from public, anon;
revoke all on function public.qc_start_review(bigint, text, integer) from public, anon;
revoke all on function public.qc_request_information(bigint, text[], text, text, integer) from public, anon;
revoke all on function public.qc_correct_and_revalidate(bigint, jsonb, text, integer) from public, anon;
revoke all on function public.qc_hold(bigint, text[], text, integer) from public, anon;
revoke all on function public.qc_assign(bigint, bigint, timestamptz, integer) from public, anon;
revoke all on function public.qc_approve(bigint, text, integer) from public, anon;
revoke all on function public.qc_reject(bigint, text[], text, integer) from public, anon;
revoke all on function public.save_order_draft(bigint, bigint, jsonb, jsonb, jsonb, text, text, text, text, integer) from public, anon;
revoke all on function public.confirm_order_draft(bigint, integer) from public, anon;
revoke all on function public.discard_order_draft(bigint, text) from public, anon;
revoke all on function public.live_workspace_members() from public, anon;
grant execute on function public.qc_enrol(bigint), public.qc_start_review(bigint, text, integer),
  public.qc_request_information(bigint, text[], text, text, integer), public.qc_correct_and_revalidate(bigint, jsonb, text, integer),
  public.qc_hold(bigint, text[], text, integer), public.qc_assign(bigint, bigint, timestamptz, integer),
  public.qc_approve(bigint, text, integer), public.qc_reject(bigint, text[], text, integer),
  public.save_order_draft(bigint, bigint, jsonb, jsonb, jsonb, text, text, text, text, integer),
  public.confirm_order_draft(bigint, integer), public.discard_order_draft(bigint, text),
  public.live_workspace_members() to authenticated, service_role;
revoke all on function private.qc_apply(bigint, text, text, text[], text[], text[], text, integer, jsonb) from public, anon, authenticated;
revoke all on function private.qc_enrol_open_orders() from public, anon, authenticated;
revoke all on function private.qc_actor() from public, anon, authenticated;

------------------------------------------------------------------------
-- Initial enrolment + schedule (every 15 min, two minutes after the Woo sync)
------------------------------------------------------------------------
select private.qc_enrol_open_orders();
select cron.unschedule(jobid) from cron.job where jobname = 'order-qc-enrol-every-15m';
select cron.schedule('order-qc-enrol-every-15m', '2,17,32,47 * * * *', $cron$select private.qc_enrol_open_orders();$cron$);
