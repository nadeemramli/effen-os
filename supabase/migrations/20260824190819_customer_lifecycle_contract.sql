-- Customer lifecycle contract, version 1 (program plan Phase 1).
--
-- Governed, versioned, historical customer lifecycle facts that replace the
-- unversioned `activity` CASE expressions in private.customers_read and the
-- browser's lifecycleOf(). Everything here is additive and lives in `private`;
-- the browser reaches it only through the two SECURITY DEFINER serving RPCs
-- at the end, which check workspace membership (and role for drill-through)
-- exactly like live_customers does (ADR-0005 pattern).
--
-- Objects
--   private.customer_lifecycle_policy        one row per policy version (v1 = provisional 60-day fallback)
--   private.is_suspect_order(jsonb, jsonb)   the customers_read suspect heuristic, as a function
--   private.customer_qualifying_orders       one row per orders_read row: identity, accepted/lifecycle flags, exclusion reason
--   private.customer_acquisition_cohort      one row per identity: first accepted and first lifecycle-qualifying order
--   private.customer_lifecycle_state         state intervals (active / at_risk / lapsed) per identity × policy
--   private.customer_lifecycle_transition    new / reactivated / at_risk / lapsed events per identity × policy
--   private.customer_base_episode            membership episodes of the active base (enter -> exit)
--   private.customer_base_movement_period    reconciled opening / new / reactivated / lapsed / retained / closing per period × scope
--   private.customer_lifecycle_refresh_log   one row per refresh with coverage; supplies computed_at
--   private.refresh_customer_lifecycle()     incremental qualifying-order upsert + full rebuild of the derived facts
--   public.live_customer_base_movement(...)  serving RPC for the Customer Base page
--   public.live_customer_transition_population(...) masked, cursor-paginated drill-through
--
-- Semantics (recorded in docs/plans/operational-workspaces-customer-profit.md §4)
--   * lifecycle-qualifying order = source_status 'completed' (Woo or Fighter) or a Ninja Van
--     'Delivered' parcel linked by order_read_id; not suspect; identity resolvable.
--   * acceptance-qualifying order = source_status in ('processing','completed'); used for the
--     accepted-new-customer lens (first_accepted_at). Lifecycle timing uses placed_at.
--   * states: active for at_risk_days after a qualifying purchase, at_risk until threshold_days,
--     lapsed after that until the next qualifying purchase. Lapsed customers remain customers.
--   * transitions: new (first qualifying purchase), reactivated (purchase after lapse),
--     at_risk, lapsed. `reactivated` is a movement, never a standing tag.
--   * movement per period is event-exact: closing = opening + new + reactivated - lapsed
--     (+ corrections, 0 in v1 because identity history is not yet kept). retained =
--     opening customers still in the base at period end.
--   * business date = Asia/Kuala_Lumpur; weeks start Monday; the current period is
--     evaluated at now() and flagged is_complete = false.

-- ────────────────────────────────────────────────────────────── policy

create table if not exists private.customer_lifecycle_policy (
  version          integer primary key,
  workspace_id     bigint not null references public.workspaces (id),
  scope            text not null default 'workspace' check (scope in ('workspace', 'brand')),
  qualifying_event text not null,
  exclusions       jsonb not null default '{}'::jsonb,
  lapse_method     text not null check (lapse_method in ('fallback', 'percentile')),
  percentile       numeric,
  lookback_days    integer,
  min_sample       integer,
  threshold_days   integer not null check (threshold_days > 0),
  at_risk_days     integer not null check (at_risk_days > 0 and at_risk_days < threshold_days),
  valid_from       date not null,
  valid_to         date,
  status           text not null check (status in ('provisional', 'approved', 'superseded')),
  approved_by      text,
  note             text,
  created_at       timestamptz not null default now()
);

insert into private.customer_lifecycle_policy
  (version, workspace_id, scope, qualifying_event, exclusions, lapse_method,
   threshold_days, at_risk_days, valid_from, status, note)
select 1, w.id, 'workspace', 'delivered_or_source_completed',
  jsonb_build_object(
    'accepted_statuses',  jsonb_build_array('processing', 'completed'),
    'lifecycle_statuses', jsonb_build_array('completed'),
    'excluded_statuses',  jsonb_build_array('cancelled', 'failed', 'refunded', 'on-hold', 'pending', 'checkout-draft'),
    'suspect_excluded',   true,
    'duplicate_rule',     'orders_read is unique on (integration_id, source_order_id); no cross-source duplicate detection in v1',
    'timing',             'placed_at'
  ),
  'fallback', 60, 40, date '2023-06-01', 'provisional',
  'Provisional policy (decision D2 open): 60-day fallback lapse threshold, at-risk from day 40. '
  'Replace with a behaviour-derived p80 repurchase delay per brand once >= 200 second purchases '
  'are observed and stable across two computations.'
from public.workspaces w
order by w.id
limit 1
on conflict (version) do nothing;

-- ─────────────────────────────────────────────────── suspect heuristic

-- Same expression as the `suspect` column in private.customers_read
-- (20260808104454); lifted into a function so order-level facts and the
-- customer read model agree. The MV is not touched here.
create or replace function private.is_suspect_order(p_customer jsonb, p_raw jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select
    coalesce(p_customer->>'name', '') ~* '\mtest(ing|er)?\M'
    or coalesce(p_raw->'billing'->>'address_1', '') ~* '\mtest(ing|er)?\M'
    or (nullif(trim(coalesce(p_customer->>'name', '')), '') is not null
        and lower(trim(p_customer->>'name')) = lower(trim(coalesce(p_raw->'billing'->>'address_1', ''))))
    or coalesce(p_customer->>'name', '') ~* 'asdf|qwer|zxcv|sdfg|wert|xcvb'
    or coalesce(p_raw->'billing'->>'address_1', '') ~* 'asdf|qwer|zxcv|sdfg|wert|xcvb'
    or coalesce(p_customer->>'name', '') ~* '([a-z])\1\1\1'
    or coalesce(p_customer->>'email', '') ~* '(^test@|@(test|example|mailinator)\.)'
    or regexp_replace(coalesce(p_customer->>'phone', ''), '[^0-9]', '', 'g') ~ '(\d)\1{6,}'
$$;

-- ─────────────────────────────────────────────── order-level facts

create table if not exists private.customer_qualifying_orders (
  order_read_id        bigint primary key references public.orders_read (id) on delete cascade,
  workspace_id         bigint not null,
  identity_key         text,
  brand_id             bigint,
  integration_id       bigint,
  currency_code        text,
  total                numeric,
  source               text,
  source_status        text,
  payment_method       text,
  placed_at            timestamptz,
  synced_at            timestamptz,
  accepted_at          timestamptz,
  delivered_at         timestamptz,
  delivered_evidence   text check (delivered_evidence in ('nv_delivered', 'source_completed')),
  qualifies_acceptance boolean not null default false,
  qualifies_lifecycle  boolean not null default false,
  exclusion_reason     text,
  is_suspect           boolean not null default false,
  first_sku            text,
  refreshed_at         timestamptz not null default now()
);
create index if not exists cqo_lifecycle_identity_idx
  on private.customer_qualifying_orders (identity_key, placed_at, order_read_id) where qualifies_lifecycle;
create index if not exists cqo_accept_identity_idx
  on private.customer_qualifying_orders (identity_key, placed_at, order_read_id) where qualifies_acceptance;
create index if not exists cqo_synced_idx on private.customer_qualifying_orders (synced_at);

create table if not exists private.customer_acquisition_cohort (
  identity_key               text primary key,
  workspace_id               bigint not null,
  first_accepted_at          timestamptz,
  first_accepted_order_id    bigint,
  first_delivered_at         timestamptz,
  first_delivered_order_id   bigint,
  acquisition_brand_id       bigint,
  acquisition_integration_id bigint,
  acquisition_currency       text,
  first_sku                  text,
  first_order_total          numeric,
  accepted_cohort_month      date,
  delivered_cohort_month     date,
  lifecycle_orders           integer not null default 0,
  last_qualifying_at         timestamptz,
  computed_at                timestamptz not null default now()
);
create index if not exists cac_scope_idx
  on private.customer_acquisition_cohort (acquisition_brand_id, acquisition_integration_id);
create index if not exists cac_accepted_idx on private.customer_acquisition_cohort (first_accepted_at);

create table if not exists private.customer_lifecycle_state (
  policy_version   integer not null references private.customer_lifecycle_policy (version),
  identity_key     text not null,
  state            text not null check (state in ('active', 'at_risk', 'lapsed')),
  valid_from       timestamptz not null,
  valid_to         timestamptz,
  trigger_order_id bigint,
  primary key (policy_version, identity_key, valid_from)
);
create index if not exists cls_window_idx
  on private.customer_lifecycle_state (policy_version, state, valid_from, valid_to);

create table if not exists private.customer_lifecycle_transition (
  id               bigint generated always as identity primary key,
  policy_version   integer not null references private.customer_lifecycle_policy (version),
  identity_key     text not null,
  transition       text not null check (transition in ('new', 'reactivated', 'at_risk', 'lapsed')),
  occurred_at      timestamptz not null,
  from_state       text,
  to_state         text not null,
  trigger_order_id bigint,
  unique (policy_version, identity_key, occurred_at, transition)
);
create index if not exists clt_time_idx
  on private.customer_lifecycle_transition (policy_version, transition, occurred_at);
create index if not exists clt_identity_idx
  on private.customer_lifecycle_transition (policy_version, identity_key, occurred_at);

create table if not exists private.customer_base_episode (
  policy_version             integer not null references private.customer_lifecycle_policy (version),
  identity_key               text not null,
  entered_at                 timestamptz not null,
  entry_kind                 text not null check (entry_kind in ('new', 'reactivated')),
  exited_at                  timestamptz,
  acquisition_brand_id       bigint,
  acquisition_integration_id bigint,
  primary key (policy_version, identity_key, entered_at)
);
create index if not exists cbe_window_idx
  on private.customer_base_episode (policy_version, entered_at, exited_at);
create index if not exists cbe_exit_idx
  on private.customer_base_episode (policy_version, exited_at) where exited_at is not null;

create table if not exists private.customer_base_movement_period (
  policy_version    integer not null references private.customer_lifecycle_policy (version),
  grain             text not null check (grain in ('week', 'month')),
  period_start      date not null,
  period_end        date not null,
  scope_type        text not null check (scope_type in ('workspace', 'brand', 'integration', 'brand_integration')),
  brand_id          bigint,
  integration_id    bigint,
  opening_active    integer not null,
  new_customers     integer not null,
  reactivated       integer not null,
  lapsed            integer not null,
  retained          integer not null,
  closing_active    integer not null,
  corrections       integer not null default 0,
  net_active_change integer not null,
  at_risk_closing   integer not null,
  new_accepted      integer not null,
  is_complete       boolean not null,
  computed_at       timestamptz not null
);
create unique index if not exists cbmp_key_uidx
  on private.customer_base_movement_period
  (policy_version, grain, period_start, scope_type, coalesce(brand_id, 0), coalesce(integration_id, 0));

create table if not exists private.customer_lifecycle_refresh_log (
  id               bigint generated always as identity primary key,
  policy_version   integer not null,
  mode             text not null check (mode in ('full', 'incremental')),
  started_at       timestamptz not null default now(),
  finished_at      timestamptz,
  orders_processed integer,
  coverage         jsonb,
  error            text
);

-- ────────────────────────────────────────────────────── refresh

-- p_since bounds the order window explicitly (dry runs, targeted backfills);
-- otherwise incremental on the last successful refresh, or full on first run.
create or replace function private.refresh_customer_lifecycle(
  p_policy_version integer default null,
  p_full boolean default false,
  p_since timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout to '15min'
as $$
declare
  v_policy   private.customer_lifecycle_policy%rowtype;
  v_log_id   bigint;
  v_mode     text;
  v_since    timestamptz;
  v_now      timestamptz := now();
  v_count    integer;
  v_a        interval;
  v_t        interval;
  v_coverage jsonb;
begin
  select * into v_policy
  from private.customer_lifecycle_policy p
  where (p_policy_version is null and p.status in ('provisional', 'approved'))
     or p.version = p_policy_version
  order by p.version desc
  limit 1;
  if v_policy.version is null then
    raise exception 'No lifecycle policy found';
  end if;
  v_a := make_interval(days => v_policy.at_risk_days);
  v_t := make_interval(days => v_policy.threshold_days);

  -- Incremental window on synced_at (orders_read_synced_at_idx); full when
  -- asked or on the first run. One hour of overlap absorbs clock skew.
  select max(finished_at) into v_since from private.customer_lifecycle_refresh_log where finished_at is not null and error is null;
  if p_since is not null then
    v_mode := 'incremental';
    v_since := p_since;
  elsif p_full or v_since is null or not exists (select 1 from private.customer_qualifying_orders limit 1) then
    v_mode := 'full';
    v_since := null;
  else
    v_mode := 'incremental';
    v_since := v_since - interval '1 hour';
  end if;

  insert into private.customer_lifecycle_refresh_log (policy_version, mode)
  values (v_policy.version, v_mode) returning id into v_log_id;

  -- 1. order-level facts ----------------------------------------------------
  insert into private.customer_qualifying_orders as q
    (order_read_id, workspace_id, identity_key, brand_id, integration_id, currency_code, total,
     source, source_status, payment_method, placed_at, synced_at,
     accepted_at, delivered_at, delivered_evidence, qualifies_acceptance, qualifies_lifecycle,
     exclusion_reason, is_suspect, first_sku, refreshed_at)
  select
    o.id, o.workspace_id, ik.identity_key, o.brand_id, o.integration_id, o.currency_code, o.total,
    o.source, o.source_status, o.payment_method, o.placed_at, o.synced_at,
    case when o.source_status in ('processing', 'completed') then o.placed_at end as accepted_at,
    case when nv.delivered_at is not null then nv.delivered_at
         when o.source_status = 'completed' then coalesce(o.updated_at_source, o.placed_at) end as delivered_at,
    case when nv.delivered_at is not null then 'nv_delivered'
         when o.source_status = 'completed' then 'source_completed' end as delivered_evidence,
    -- acceptance lens
    (ik.identity_key is not null and not s.suspect and o.source_status in ('processing', 'completed')) as qualifies_acceptance,
    -- lifecycle lens: delivered evidence required
    (ik.identity_key is not null and not s.suspect
      and (o.source_status = 'completed' or nv.delivered_at is not null)) as qualifies_lifecycle,
    case
      when ik.identity_key is null then 'no_identity'
      when s.suspect then 'suspect'
      when o.source_status in ('cancelled', 'failed', 'refunded') then 'closed_' || replace(o.source_status, '-', '_')
      when o.source_status in ('on-hold', 'pending', 'checkout-draft') then 'not_accepted_' || replace(o.source_status, '-', '_')
      when o.source_status = 'processing' and nv.delivered_at is null then 'accepted_not_delivered'
      when o.source_status = 'completed' or nv.delivered_at is not null then null
      else 'status_' || replace(o.source_status, '-', '_')
    end as exclusion_reason,
    s.suspect,
    nullif(o.items->0->>'sku', ''),
    v_now
  from public.orders_read o
  cross join lateral (select public.identity_key(o.customer, o.raw) as identity_key) ik
  cross join lateral (select private.is_suspect_order(o.customer, o.raw) as suspect) s
  left join lateral (
    select max(sh.last_event_at) as delivered_at
    from public.nv_shipments sh
    where sh.order_read_id = o.id and sh.status = 'Delivered'
  ) nv on true
  where v_since is null or o.synced_at > v_since
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
    first_sku = excluded.first_sku, refreshed_at = excluded.refreshed_at;
  get diagnostics v_count = row_count;

  -- 2. acquisition cohort (full rebuild; cheap) ---------------------------------
  truncate private.customer_acquisition_cohort;
  insert into private.customer_acquisition_cohort
    (identity_key, workspace_id, first_accepted_at, first_accepted_order_id,
     first_delivered_at, first_delivered_order_id, acquisition_brand_id, acquisition_integration_id,
     acquisition_currency, first_sku, first_order_total, accepted_cohort_month, delivered_cohort_month,
     lifecycle_orders, last_qualifying_at, computed_at)
  with acc as (
    select distinct on (identity_key) identity_key, workspace_id, placed_at, order_read_id,
           brand_id, integration_id, currency_code, first_sku, total
    from private.customer_qualifying_orders
    where qualifies_acceptance
    order by identity_key, placed_at, order_read_id
  ),
  del as (
    select identity_key,
           min(placed_at) as first_at,
           (array_agg(order_read_id order by placed_at, order_read_id))[1] as first_order_id,
           count(*)::integer as n,
           max(placed_at) as last_at
    from private.customer_qualifying_orders
    where qualifies_lifecycle
    group by identity_key
  )
  select
    coalesce(a.identity_key, d.identity_key),
    coalesce(a.workspace_id, (select workspace_id from private.customer_qualifying_orders q where q.identity_key = d.identity_key limit 1)),
    a.placed_at, a.order_read_id,
    d.first_at, d.first_order_id,
    a.brand_id, a.integration_id, a.currency_code, a.first_sku, a.total,
    (date_trunc('month', a.placed_at at time zone 'Asia/Kuala_Lumpur'))::date,
    (date_trunc('month', d.first_at at time zone 'Asia/Kuala_Lumpur'))::date,
    coalesce(d.n, 0), d.last_at, v_now
  from acc a
  full outer join del d using (identity_key);

  -- 3. lifecycle intervals and transitions for this policy ------------------
  delete from private.customer_base_episode where policy_version = v_policy.version;
  delete from private.customer_lifecycle_transition where policy_version = v_policy.version;
  delete from private.customer_lifecycle_state where policy_version = v_policy.version;

  drop table if exists pg_temp.tmp_purchases;
  create temp table tmp_purchases on commit drop as
  select identity_key, placed_at, order_read_id,
         lag(placed_at)  over (partition by identity_key order by placed_at, order_read_id) as prev_at,
         lead(placed_at) over (partition by identity_key order by placed_at, order_read_id) as next_at,
         row_number()    over (partition by identity_key order by placed_at, order_read_id) as rn
  from private.customer_qualifying_orders
  where qualifies_lifecycle and identity_key is not null and placed_at is not null;

  insert into private.customer_lifecycle_state (policy_version, identity_key, state, valid_from, valid_to, trigger_order_id)
  select v_policy.version, identity_key, 'active', placed_at, least(placed_at + v_a, next_at), order_read_id
  from pg_temp.tmp_purchases
  union all
  select v_policy.version, identity_key, 'at_risk', placed_at + v_a, least(placed_at + v_t, next_at), order_read_id
  from pg_temp.tmp_purchases
  where (next_at is null or next_at > placed_at + v_a) and placed_at + v_a <= v_now
  union all
  select v_policy.version, identity_key, 'lapsed', placed_at + v_t, next_at, order_read_id
  from pg_temp.tmp_purchases
  where (next_at is null or next_at > placed_at + v_t) and placed_at + v_t <= v_now;

  insert into private.customer_lifecycle_transition (policy_version, identity_key, transition, occurred_at, from_state, to_state, trigger_order_id)
  select v_policy.version, identity_key, 'new', placed_at, null, 'active', order_read_id
  from pg_temp.tmp_purchases where rn = 1
  union all
  select v_policy.version, identity_key, 'reactivated', placed_at, 'lapsed', 'active', order_read_id
  from pg_temp.tmp_purchases where rn > 1 and placed_at > prev_at + v_t
  union all
  select v_policy.version, identity_key, 'at_risk', placed_at + v_a, 'active', 'at_risk', order_read_id
  from pg_temp.tmp_purchases where (next_at is null or next_at > placed_at + v_a) and placed_at + v_a <= v_now
  union all
  select v_policy.version, identity_key, 'lapsed', placed_at + v_t, 'at_risk', 'lapsed', order_read_id
  from pg_temp.tmp_purchases where (next_at is null or next_at > placed_at + v_t) and placed_at + v_t <= v_now;

  -- 4. base-membership episodes: enter (new/reactivated) -> exit (lapsed) ------
  insert into private.customer_base_episode
    (policy_version, identity_key, entered_at, entry_kind, exited_at, acquisition_brand_id, acquisition_integration_id)
  with e as (
    select t.identity_key, t.transition, t.occurred_at,
           lead(t.occurred_at) over (partition by t.identity_key order by t.occurred_at) as next_at,
           lead(t.transition)  over (partition by t.identity_key order by t.occurred_at) as next_tr
    from private.customer_lifecycle_transition t
    where t.policy_version = v_policy.version and t.transition in ('new', 'reactivated', 'lapsed')
  )
  select v_policy.version, e.identity_key, e.occurred_at, e.transition,
         case when e.next_tr = 'lapsed' then e.next_at end,
         c.acquisition_brand_id, c.acquisition_integration_id
  from e
  left join private.customer_acquisition_cohort c on c.identity_key = e.identity_key
  where e.transition in ('new', 'reactivated');

  -- 5. reconciled movement per period × scope ---------------------------------
  delete from private.customer_base_movement_period where policy_version = v_policy.version;

  drop table if exists pg_temp.tmp_periods;
  create temp table tmp_periods on commit drop as
  with bounds as (
    select v_policy.valid_from as from_date,
           (v_now at time zone 'Asia/Kuala_Lumpur')::date as today
  ),
  months as (
    select 'month'::text as grain,
           d::date as period_start,
           (d + interval '1 month')::date as period_end
    from bounds, generate_series(date_trunc('month', from_date::timestamp), date_trunc('month', today::timestamp), interval '1 month') d
  ),
  weeks as (
    select 'week'::text as grain,
           d::date as period_start,
           (d + interval '1 week')::date as period_end
    from bounds, generate_series(date_trunc('week', from_date::timestamp), date_trunc('week', today::timestamp), interval '1 week') d
  ),
  all_p as (select * from months union all select * from weeks)
  select grain, period_start, period_end,
         (period_start::timestamp at time zone 'Asia/Kuala_Lumpur') as s_ts,
         least((period_end::timestamp at time zone 'Asia/Kuala_Lumpur'), v_now) as e_ts,
         ((period_end::timestamp at time zone 'Asia/Kuala_Lumpur') <= v_now) as is_complete
  from all_p;

  insert into private.customer_base_movement_period
    (policy_version, grain, period_start, period_end, scope_type, brand_id, integration_id,
     opening_active, new_customers, reactivated, lapsed, retained, closing_active, corrections,
     net_active_change, at_risk_closing, new_accepted, is_complete, computed_at)
  with ep as (
    select p.grain, p.period_start, p.period_end, p.s_ts, p.e_ts, p.is_complete,
           e.acquisition_brand_id, e.acquisition_integration_id,
           (e.entered_at <= p.s_ts and (e.exited_at is null or e.exited_at > p.s_ts))::int as in_start,
           (e.entered_at <= p.e_ts and (e.exited_at is null or e.exited_at > p.e_ts))::int as in_end,
           (e.entered_at >= p.s_ts and e.entered_at < p.e_ts and e.entry_kind = 'new')::int as enter_new,
           (e.entered_at >= p.s_ts and e.entered_at < p.e_ts and e.entry_kind = 'reactivated')::int as enter_react,
           (e.exited_at is not null and e.exited_at >= p.s_ts and e.exited_at < p.e_ts)::int as exit_lapsed,
           (e.entered_at <= p.s_ts and (e.exited_at is null or e.exited_at > p.e_ts))::int as retained
    from pg_temp.tmp_periods p
    join private.customer_base_episode e
      on e.policy_version = v_policy.version
     and e.entered_at < p.e_ts
     and (e.exited_at is null or e.exited_at >= p.s_ts)
  ),
  mv as (
    select grain, period_start, period_end, is_complete,
           case grouping(acquisition_brand_id, acquisition_integration_id)
             when 3 then 'workspace' when 1 then 'brand' when 2 then 'integration' else 'brand_integration' end as scope_type,
           case when grouping(acquisition_brand_id) = 0 then acquisition_brand_id end as brand_id,
           case when grouping(acquisition_integration_id) = 0 then acquisition_integration_id end as integration_id,
           sum(in_start)::int as opening_active, sum(enter_new)::int as new_customers,
           sum(enter_react)::int as reactivated, sum(exit_lapsed)::int as lapsed,
           sum(retained)::int as retained, sum(in_end)::int as closing_active
    from ep
    group by grouping sets (
      (grain, period_start, period_end, is_complete),
      (grain, period_start, period_end, is_complete, acquisition_brand_id),
      (grain, period_start, period_end, is_complete, acquisition_integration_id),
      (grain, period_start, period_end, is_complete, acquisition_brand_id, acquisition_integration_id)
    )
  ),
  ar as (
    select p.grain, p.period_start,
           case grouping(c.acquisition_brand_id, c.acquisition_integration_id)
             when 3 then 'workspace' when 1 then 'brand' when 2 then 'integration' else 'brand_integration' end as scope_type,
           case when grouping(c.acquisition_brand_id) = 0 then c.acquisition_brand_id end as brand_id,
           case when grouping(c.acquisition_integration_id) = 0 then c.acquisition_integration_id end as integration_id,
           count(*)::int as at_risk_closing
    from pg_temp.tmp_periods p
    join private.customer_lifecycle_state s
      on s.policy_version = v_policy.version and s.state = 'at_risk'
     and s.valid_from <= p.e_ts and (s.valid_to is null or s.valid_to > p.e_ts)
    left join private.customer_acquisition_cohort c on c.identity_key = s.identity_key
    group by grouping sets (
      (p.grain, p.period_start),
      (p.grain, p.period_start, c.acquisition_brand_id),
      (p.grain, p.period_start, c.acquisition_integration_id),
      (p.grain, p.period_start, c.acquisition_brand_id, c.acquisition_integration_id)
    )
  ),
  na as (
    select p.grain, p.period_start,
           case grouping(c.acquisition_brand_id, c.acquisition_integration_id)
             when 3 then 'workspace' when 1 then 'brand' when 2 then 'integration' else 'brand_integration' end as scope_type,
           case when grouping(c.acquisition_brand_id) = 0 then c.acquisition_brand_id end as brand_id,
           case when grouping(c.acquisition_integration_id) = 0 then c.acquisition_integration_id end as integration_id,
           count(*)::int as new_accepted
    from pg_temp.tmp_periods p
    join private.customer_acquisition_cohort c
      on c.first_accepted_at >= p.s_ts and c.first_accepted_at < p.e_ts
    group by grouping sets (
      (p.grain, p.period_start),
      (p.grain, p.period_start, c.acquisition_brand_id),
      (p.grain, p.period_start, c.acquisition_integration_id),
      (p.grain, p.period_start, c.acquisition_brand_id, c.acquisition_integration_id)
    )
  )
  select v_policy.version, m.grain, m.period_start, m.period_end, m.scope_type, m.brand_id, m.integration_id,
         m.opening_active, m.new_customers, m.reactivated, m.lapsed, m.retained, m.closing_active, 0,
         m.new_customers + m.reactivated - m.lapsed,
         coalesce(a.at_risk_closing, 0), coalesce(n.new_accepted, 0), m.is_complete, v_now
  from mv m
  left join ar a on a.grain = m.grain and a.period_start = m.period_start and a.scope_type = m.scope_type
                and a.brand_id is not distinct from m.brand_id and a.integration_id is not distinct from m.integration_id
  left join na n on n.grain = m.grain and n.period_start = m.period_start and n.scope_type = m.scope_type
                and n.brand_id is not distinct from m.brand_id and n.integration_id is not distinct from m.integration_id;

  -- 6. coverage for the envelope --------------------------------------------
  select jsonb_build_object(
    'orders_total', count(*),
    'orders_with_identity', count(*) filter (where identity_key is not null),
    'orders_qualifying_acceptance', count(*) filter (where qualifies_acceptance),
    'orders_qualifying_lifecycle', count(*) filter (where qualifies_lifecycle),
    'orders_excluded_by_reason', (select jsonb_object_agg(r, n) from (
        select coalesce(exclusion_reason, 'qualifies') as r, count(*) as n
        from private.customer_qualifying_orders group by 1) x),
    'delivered_evidence', (select jsonb_object_agg(coalesce(delivered_evidence, 'none'), n) from (
        select delivered_evidence, count(*) as n from private.customer_qualifying_orders
        where qualifies_lifecycle group by 1) y),
    'customers_total', (select count(*) from private.customer_acquisition_cohort),
    'customers_with_lifecycle_purchase', (select count(*) from private.customer_acquisition_cohort where first_delivered_at is not null),
    'identity_corrections_tracked', false,
    'note', 'Lifecycle-qualifying = source completed or Ninja Van delivered; acceptance = processing/completed. Identity merges are not historised yet, so the corrections line is always 0.'
  ) into v_coverage
  from private.customer_qualifying_orders;

  update private.customer_lifecycle_refresh_log
     set finished_at = clock_timestamp(), orders_processed = v_count, coverage = v_coverage
   where id = v_log_id;

  return jsonb_build_object('policy_version', v_policy.version, 'mode', v_mode, 'orders_processed', v_count, 'coverage', v_coverage);
end;
$$;

revoke all on function private.refresh_customer_lifecycle(integer, boolean, timestamptz) from public, anon, authenticated;

-- ─────────────────────────────────────────────────── serving RPCs

-- Movement chart / cards for the Customer Base page. Scope resolution:
--   no filter -> workspace; brand only -> brand; stores only -> sum of the
--   integration rows; both -> sum of the brand_integration rows. Acquisition
--   scope is single-valued per customer, so sums across stores are exact.
create or replace function public.live_customer_base_movement(
  p_grain text default 'month',
  p_from date default null,
  p_to date default null,
  p_brand_id bigint default null,
  p_integration_ids bigint[] default null,
  p_policy_version integer default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout to '15s'
as $$
declare
  v_ws bigint := (select min(id) from public.workspaces);
  v_policy private.customer_lifecycle_policy%rowtype;
  v_scope text;
  v_grain text := case when p_grain = 'week' then 'week' else 'month' end;
  v_from date;
  v_to date;
  v_log private.customer_lifecycle_refresh_log%rowtype;
  v_periods jsonb;
begin
  if not private.is_workspace_member(v_ws) then
    raise exception 'Not a workspace member';
  end if;

  select * into v_policy from private.customer_lifecycle_policy p
  where (p_policy_version is null and p.status in ('provisional', 'approved')) or p.version = p_policy_version
  order by p.version desc limit 1;
  if v_policy.version is null then
    return jsonb_build_object('status', 'unavailable', 'reason', 'no_policy');
  end if;

  select * into v_log from private.customer_lifecycle_refresh_log
  where policy_version = v_policy.version and finished_at is not null and error is null
  order by finished_at desc limit 1;
  if v_log.id is null then
    return jsonb_build_object('status', 'unavailable', 'reason', 'not_computed',
      'policy', jsonb_build_object('version', v_policy.version, 'status', v_policy.status));
  end if;

  v_scope := case
    when p_brand_id is null and (p_integration_ids is null or cardinality(p_integration_ids) = 0) then 'workspace'
    when p_brand_id is not null and (p_integration_ids is null or cardinality(p_integration_ids) = 0) then 'brand'
    when p_brand_id is null then 'integration'
    else 'brand_integration' end;
  v_to := coalesce(p_to, (now() at time zone 'Asia/Kuala_Lumpur')::date);
  v_from := coalesce(p_from, (v_to - interval '12 months')::date);

  select jsonb_agg(jsonb_build_object(
      'period_start', r.period_start, 'period_end', r.period_end, 'is_complete', r.is_complete,
      'opening_active', r.opening_active, 'new_customers', r.new_customers,
      'reactivated', r.reactivated, 'lapsed', r.lapsed, 'retained', r.retained,
      'closing_active', r.closing_active, 'corrections', r.corrections,
      'net_active_change', r.net_active_change,
      'net_active_rate', case when r.opening_active > 0
                              then round(r.net_active_change::numeric / r.opening_active, 4) end,
      'rate_applicable', r.opening_active > 0,
      'at_risk_closing', r.at_risk_closing, 'new_accepted', r.new_accepted
    ) order by r.period_start)
  into v_periods
  from (
    -- Every computed period in range (from the workspace rows), with the
    -- scoped sums filled by computed zeros where the scope had no customers.
    select w.period_start, w.period_end, w.is_complete,
           coalesce(sum(m.opening_active), 0) as opening_active, coalesce(sum(m.new_customers), 0) as new_customers,
           coalesce(sum(m.reactivated), 0) as reactivated, coalesce(sum(m.lapsed), 0) as lapsed,
           coalesce(sum(m.retained), 0) as retained, coalesce(sum(m.closing_active), 0) as closing_active,
           coalesce(sum(m.corrections), 0) as corrections, coalesce(sum(m.net_active_change), 0) as net_active_change,
           coalesce(sum(m.at_risk_closing), 0) as at_risk_closing, coalesce(sum(m.new_accepted), 0) as new_accepted
    from private.customer_base_movement_period w
    left join private.customer_base_movement_period m
      on m.policy_version = w.policy_version and m.grain = w.grain and m.period_start = w.period_start
     and m.scope_type = v_scope
     and (v_scope not in ('brand', 'brand_integration') or m.brand_id = p_brand_id)
     and (v_scope not in ('integration', 'brand_integration') or m.integration_id = any (p_integration_ids))
    where w.policy_version = v_policy.version and w.grain = v_grain and w.scope_type = 'workspace'
      and w.period_end > v_from and w.period_start <= v_to
    group by w.period_start, w.period_end, w.is_complete
  ) r;

  return jsonb_build_object(
    'status', 'ok',
    'scope', jsonb_build_object('type', v_scope, 'brand_id', p_brand_id, 'integration_ids', to_jsonb(p_integration_ids), 'lens', 'acquisition'),
    'grain', v_grain, 'from', v_from, 'to', v_to,
    'policy', jsonb_build_object('version', v_policy.version, 'status', v_policy.status,
      'qualifying_event', v_policy.qualifying_event, 'lapse_method', v_policy.lapse_method,
      'threshold_days', v_policy.threshold_days, 'at_risk_days', v_policy.at_risk_days,
      'valid_from', v_policy.valid_from, 'note', v_policy.note),
    'periods', coalesce(v_periods, '[]'::jsonb),
    'coverage', v_log.coverage,
    'computed_at', v_log.finished_at,
    'timezone', 'Asia/Kuala_Lumpur'
  );
end;
$$;

revoke all on function public.live_customer_base_movement(text, date, date, bigint, bigint[], integer) from public, anon;
grant execute on function public.live_customer_base_movement(text, date, date, bigint, bigint[], integer) to authenticated, service_role;

-- Exact masked population behind one card/segment. Requires a role that
-- carries customers.view in the app matrix (finance is excluded). Keyset
-- pagination on identity_key; p_limit is capped at 200.
create or replace function public.live_customer_transition_population(
  p_grain text,
  p_period_start date,
  p_measure text,
  p_brand_id bigint default null,
  p_integration_ids bigint[] default null,
  p_policy_version integer default null,
  p_cursor text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout to '15s'
as $$
declare
  v_ws bigint := (select min(id) from public.workspaces);
  v_policy private.customer_lifecycle_policy%rowtype;
  v_grain text := case when p_grain = 'week' then 'week' else 'month' end;
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_s timestamptz;
  v_e timestamptz;
  v_rows jsonb;
  v_total bigint;
  v_next text;
begin
  if not private.has_role(v_ws, array['hq_admin', 'sales_cs', 'marketing_growth', 'operations', 'analyst']) then
    raise exception 'Role cannot view customer populations';
  end if;
  if p_measure not in ('new', 'reactivated', 'lapsed', 'opening', 'closing', 'retained') then
    raise exception 'Unknown measure %', p_measure;
  end if;

  select * into v_policy from private.customer_lifecycle_policy p
  where (p_policy_version is null and p.status in ('provisional', 'approved')) or p.version = p_policy_version
  order by p.version desc limit 1;

  select s_ts, e_ts into v_s, v_e from (
    select (p_period_start::timestamp at time zone 'Asia/Kuala_Lumpur') as s_ts,
           least(((p_period_start + case when v_grain = 'week' then interval '1 week' else interval '1 month' end)::timestamp
                   at time zone 'Asia/Kuala_Lumpur'), now()) as e_ts
  ) b;

  with pop as (
    select e.identity_key,
           case when p_measure = 'lapsed' then e.exited_at else e.entered_at end as occurred_at,
           e.entry_kind, e.exited_at, e.acquisition_brand_id, e.acquisition_integration_id
    from private.customer_base_episode e
    where e.policy_version = v_policy.version
      and (p_brand_id is null or e.acquisition_brand_id = p_brand_id)
      and (p_integration_ids is null or cardinality(p_integration_ids) = 0 or e.acquisition_integration_id = any (p_integration_ids))
      and case p_measure
            when 'new'         then e.entry_kind = 'new'         and e.entered_at >= v_s and e.entered_at < v_e
            when 'reactivated' then e.entry_kind = 'reactivated' and e.entered_at >= v_s and e.entered_at < v_e
            when 'lapsed'      then e.exited_at is not null and e.exited_at >= v_s and e.exited_at < v_e
            when 'opening'     then e.entered_at <= v_s and (e.exited_at is null or e.exited_at > v_s)
            when 'closing'     then e.entered_at <= v_e and (e.exited_at is null or e.exited_at > v_e)
            when 'retained'    then e.entered_at <= v_s and (e.exited_at is null or e.exited_at > v_e)
          end
  ),
  page as (
    select t.identity_key, t.occurred_at, t.entry_kind, t.exited_at, t.acquisition_brand_id, t.acquisition_integration_id,
           c.display_name, c.phone, c.total_orders, c.classification,
           a.first_accepted_at, a.first_delivered_at, a.lifecycle_orders, a.last_qualifying_at
    from pop t
    left join private.customers_read c on c.identity_key = t.identity_key
    left join private.customer_acquisition_cohort a on a.identity_key = t.identity_key
    where p_cursor is null or t.identity_key > p_cursor
    order by t.identity_key
    limit v_limit + 1
  ),
  lim as (select * from page order by identity_key limit v_limit)
  select
    (select count(*) from pop),
    (select jsonb_agg(jsonb_build_object(
           'identity_key', identity_key,
           'display_name', case when display_name is null then null
                                else split_part(display_name, ' ', 1) || case when position(' ' in display_name) > 0
                                     then ' ' || left(split_part(display_name, ' ', 2), 1) || '.' else '' end end,
           'phone_masked', case when phone is null then null else '•••' || right(regexp_replace(phone, '[^0-9]', '', 'g'), 4) end,
           'occurred_at', occurred_at, 'entry_kind', entry_kind, 'exited_at', exited_at,
           'acquisition_brand_id', acquisition_brand_id, 'acquisition_integration_id', acquisition_integration_id,
           'first_accepted_at', first_accepted_at, 'first_delivered_at', first_delivered_at,
           'lifecycle_orders', lifecycle_orders, 'last_qualifying_at', last_qualifying_at,
           'total_orders', total_orders, 'classification', classification
         ) order by identity_key) from lim),
    (select identity_key from page order by identity_key offset v_limit limit 1)
  into v_total, v_rows, v_next;

  return jsonb_build_object(
    'status', 'ok', 'measure', p_measure, 'grain', v_grain, 'period_start', p_period_start,
    'policy_version', v_policy.version, 'total_count', v_total,
    'rows', coalesce(v_rows, '[]'::jsonb), 'next_cursor', v_next,
    'masked', true
  );
end;
$$;

revoke all on function public.live_customer_transition_population(text, date, text, bigint, bigint[], integer, text, integer) from public, anon;
grant execute on function public.live_customer_transition_population(text, date, text, bigint, bigint[], integer, text, integer) to authenticated, service_role;

-- ──────────────────────────────────────────────────────── schedule

-- Daily at 01:30 MYT (17:30 UTC), after the Woo sync and the customers_read
-- refresh have settled. Incremental on synced_at; the derived facts rebuild fully.
select cron.schedule(
  'customer-lifecycle-refresh-daily',
  '30 17 * * *',
  $cron$ set statement_timeout = '15min'; select private.refresh_customer_lifecycle(); $cron$
);

-- One-off backfill: runs within a minute of this migration and unschedules
-- itself after a successful full refresh. If it fails, the log row carries the
-- error and the job keeps retrying each minute until unscheduled by hand.
select cron.schedule(
  'customer-lifecycle-backfill',
  '* * * * *',
  $cron$ set statement_timeout = '15min'; select private.refresh_customer_lifecycle(null, true); select cron.unschedule('customer-lifecycle-backfill'); $cron$
);
