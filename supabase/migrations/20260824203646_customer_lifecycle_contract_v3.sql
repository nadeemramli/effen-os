-- Customer lifecycle contract, v3: chunked, separately committed refresh.
--
-- v1 (20260824190819) crashed the 1 GB instance; v2 (20260824191711) wedged it
-- twice — every step ran inside one transaction over the whole 282k-order
-- corpus, and the one-off cron job re-fired after each restart because pg_cron
-- runs a job command as a single transaction (the in-command unschedule rolled
-- back with the failure). Both jobs were removed by hand on 24 Aug 2026.
--
-- v3 splits the refresh into step functions that each do one bounded unit of
-- work, and a PROCEDURE that COMMITs between them. The first backfill is driven
-- by hand, step by step, before any schedule exists. Tables and RPCs are
-- unchanged.
--
--   private.lifecycle_upsert_orders(p_after_id, p_limit, p_since) -> {rows, last_id}
--   private.lifecycle_rebuild_cohort()                           -> {customers}
--   private.lifecycle_rebuild_states(p_policy_version)           -> {intervals, transitions, episodes}
--   private.lifecycle_rebuild_movement(p_policy_version, p_grain)-> {rows}
--   private.lifecycle_finish(p_policy_version, p_mode, p_rows)   -> coverage; writes the log row (computed_at)
--   procedure private.run_customer_lifecycle_refresh(p_full)     -> orchestrates with COMMIT between steps

drop function if exists private.refresh_customer_lifecycle(integer, boolean, timestamptz);

create or replace function private.lifecycle_policy(p_policy_version integer default null)
returns private.customer_lifecycle_policy
language sql
stable
set search_path = ''
as $$
  select p.* from private.customer_lifecycle_policy p
  where (p_policy_version is null and p.status in ('provisional', 'approved')) or p.version = p_policy_version
  order by p.version desc limit 1
$$;

-- 1. one batch of order-level facts (by id after p_after_id, or by synced_at when p_since is given)
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
      (ik.identity_key is not null and not s.suspect and (o.source_status = 'completed' or nv.delivered_at is not null)),
      case
        when ik.identity_key is null then 'no_identity'
        when s.suspect then 'suspect'
        when o.source_status in ('cancelled', 'failed', 'refunded') then 'closed_' || replace(o.source_status, '-', '_')
        when o.source_status in ('on-hold', 'pending', 'checkout-draft') then 'not_accepted_' || replace(o.source_status, '-', '_')
        when o.source_status = 'processing' and nv.delivered_at is null then 'accepted_not_delivered'
        when o.source_status = 'completed' or nv.delivered_at is not null then null
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

-- 2. acquisition cohort (full rebuild)
create or replace function private.lifecycle_rebuild_cohort()
returns jsonb
language plpgsql
security definer
set search_path = ''
set jit to 'off'
set max_parallel_workers_per_gather to '0'
set work_mem to '16MB'
set statement_timeout to '5min'
as $$
declare v_n integer;
begin
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
    select identity_key, min(placed_at) as first_at,
           (array_agg(order_read_id order by placed_at, order_read_id))[1] as first_order_id,
           count(*)::integer as n, max(placed_at) as last_at
    from private.customer_qualifying_orders
    where qualifies_lifecycle
    group by identity_key
  )
  select
    coalesce(a.identity_key, d.identity_key),
    coalesce(a.workspace_id, (select workspace_id from private.customer_qualifying_orders q where q.identity_key = d.identity_key limit 1)),
    a.placed_at, a.order_read_id, d.first_at, d.first_order_id,
    a.brand_id, a.integration_id, a.currency_code, a.first_sku, a.total,
    (date_trunc('month', a.placed_at at time zone 'Asia/Kuala_Lumpur'))::date,
    (date_trunc('month', d.first_at at time zone 'Asia/Kuala_Lumpur'))::date,
    coalesce(d.n, 0), d.last_at, now()
  from acc a
  full outer join del d using (identity_key);
  get diagnostics v_n = row_count;
  return jsonb_build_object('customers', v_n);
end;
$$;

-- 3. state intervals, transitions and base episodes for one policy
create or replace function private.lifecycle_rebuild_states(p_policy_version integer default null)
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
  v_policy private.customer_lifecycle_policy;
  v_a interval; v_t interval; v_now timestamptz := now();
  v_intervals integer; v_transitions integer; v_episodes integer;
begin
  v_policy := private.lifecycle_policy(p_policy_version);
  if v_policy.version is null then raise exception 'No lifecycle policy found'; end if;
  v_a := make_interval(days => v_policy.at_risk_days);
  v_t := make_interval(days => v_policy.threshold_days);

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
  from pg_temp.tmp_purchases where (next_at is null or next_at > placed_at + v_a) and placed_at + v_a <= v_now
  union all
  select v_policy.version, identity_key, 'lapsed', placed_at + v_t, next_at, order_read_id
  from pg_temp.tmp_purchases where (next_at is null or next_at > placed_at + v_t) and placed_at + v_t <= v_now;
  get diagnostics v_intervals = row_count;

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
  get diagnostics v_transitions = row_count;

  drop table if exists pg_temp.tmp_purchases;

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
  get diagnostics v_episodes = row_count;

  return jsonb_build_object('policy_version', v_policy.version, 'intervals', v_intervals, 'transitions', v_transitions, 'episodes', v_episodes);
end;
$$;

-- 4. reconciled movement for one grain, from bucketed events + cumulative sums
create or replace function private.lifecycle_rebuild_movement(p_policy_version integer default null, p_grain text default 'month')
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
  v_policy private.customer_lifecycle_policy;
  v_grain text := case when p_grain = 'week' then 'week' else 'month' end;
  v_now timestamptz := now();
  v_n integer;
begin
  v_policy := private.lifecycle_policy(p_policy_version);
  if v_policy.version is null then raise exception 'No lifecycle policy found'; end if;

  delete from private.customer_base_movement_period where policy_version = v_policy.version and grain = v_grain;

  insert into private.customer_base_movement_period
    (policy_version, grain, period_start, period_end, scope_type, brand_id, integration_id,
     opening_active, new_customers, reactivated, lapsed, retained, closing_active, corrections,
     net_active_change, at_risk_closing, new_accepted, is_complete, computed_at)
  with periods as (
    select d::date as period_start,
           (d + case when v_grain = 'week' then interval '1 week' else interval '1 month' end)::date as period_end
    from generate_series(
           date_trunc(v_grain, v_policy.valid_from::timestamp),
           date_trunc(v_grain, (v_now at time zone 'Asia/Kuala_Lumpur')::date::timestamp),
           case when v_grain = 'week' then interval '1 week' else interval '1 month' end) d
  ),
  ev as (
    select 'enter_new' as kind, date_trunc(v_grain, entered_at at time zone 'Asia/Kuala_Lumpur')::date as ps,
           acquisition_brand_id as b, acquisition_integration_id as i
    from private.customer_base_episode where policy_version = v_policy.version and entry_kind = 'new'
    union all
    select 'enter_react', date_trunc(v_grain, entered_at at time zone 'Asia/Kuala_Lumpur')::date, acquisition_brand_id, acquisition_integration_id
    from private.customer_base_episode where policy_version = v_policy.version and entry_kind = 'reactivated'
    union all
    select 'exit', date_trunc(v_grain, exited_at at time zone 'Asia/Kuala_Lumpur')::date, acquisition_brand_id, acquisition_integration_id
    from private.customer_base_episode where policy_version = v_policy.version and exited_at is not null
    union all
    select 'churn_within', date_trunc(v_grain, exited_at at time zone 'Asia/Kuala_Lumpur')::date, acquisition_brand_id, acquisition_integration_id
    from private.customer_base_episode
    where policy_version = v_policy.version and exited_at is not null
      and date_trunc(v_grain, entered_at at time zone 'Asia/Kuala_Lumpur') = date_trunc(v_grain, exited_at at time zone 'Asia/Kuala_Lumpur')
    union all
    select 'ar_start', date_trunc(v_grain, s.valid_from at time zone 'Asia/Kuala_Lumpur')::date, c.acquisition_brand_id, c.acquisition_integration_id
    from private.customer_lifecycle_state s
    left join private.customer_acquisition_cohort c on c.identity_key = s.identity_key
    where s.policy_version = v_policy.version and s.state = 'at_risk'
    union all
    select 'ar_end', date_trunc(v_grain, s.valid_to at time zone 'Asia/Kuala_Lumpur')::date, c.acquisition_brand_id, c.acquisition_integration_id
    from private.customer_lifecycle_state s
    left join private.customer_acquisition_cohort c on c.identity_key = s.identity_key
    where s.policy_version = v_policy.version and s.state = 'at_risk' and s.valid_to is not null and s.valid_to <= v_now
    union all
    select 'accepted', date_trunc(v_grain, first_accepted_at at time zone 'Asia/Kuala_Lumpur')::date, acquisition_brand_id, acquisition_integration_id
    from private.customer_acquisition_cohort where first_accepted_at is not null
  ),
  agg as (
    select ps,
           case grouping(b, i) when 3 then 'workspace' when 1 then 'brand' when 2 then 'integration' else 'brand_integration' end as scope_type,
           case when grouping(b) = 0 then b end as brand_id,
           case when grouping(i) = 0 then i end as integration_id,
           count(*) filter (where kind = 'enter_new')::int    as new_customers,
           count(*) filter (where kind = 'enter_react')::int  as reactivated,
           count(*) filter (where kind = 'exit')::int         as lapsed,
           count(*) filter (where kind = 'churn_within')::int as churn_within,
           count(*) filter (where kind = 'ar_start')::int     as ar_start,
           count(*) filter (where kind = 'ar_end')::int       as ar_end,
           count(*) filter (where kind = 'accepted')::int     as new_accepted
    from ev
    group by grouping sets ((ps), (ps, b), (ps, i), (ps, b, i))
  ),
  scopes as (select distinct scope_type, brand_id, integration_id from agg),
  grid as (
    select p.period_start, p.period_end, s.scope_type, s.brand_id, s.integration_id,
           coalesce(a.new_customers, 0) as new_customers, coalesce(a.reactivated, 0) as reactivated,
           coalesce(a.lapsed, 0) as lapsed, coalesce(a.churn_within, 0) as churn_within,
           coalesce(a.ar_start, 0) as ar_start, coalesce(a.ar_end, 0) as ar_end,
           coalesce(a.new_accepted, 0) as new_accepted
    from periods p
    cross join scopes s
    left join agg a on a.ps = p.period_start and a.scope_type = s.scope_type
                   and a.brand_id is not distinct from s.brand_id and a.integration_id is not distinct from s.integration_id
  ),
  cum as (
    select g.*,
           coalesce(sum(new_customers + reactivated - lapsed) over (
             partition by scope_type, brand_id, integration_id order by period_start
             rows between unbounded preceding and 1 preceding), 0)::int as opening_active,
           sum(ar_start - ar_end) over (
             partition by scope_type, brand_id, integration_id order by period_start
             rows between unbounded preceding and current row)::int as at_risk_closing
    from grid g
  )
  select v_policy.version, v_grain, period_start, period_end, scope_type, brand_id, integration_id,
         opening_active, new_customers, reactivated, lapsed,
         opening_active - (lapsed - churn_within),
         opening_active + new_customers + reactivated - lapsed,
         0, new_customers + reactivated - lapsed,
         at_risk_closing, new_accepted,
         ((period_end::timestamp at time zone 'Asia/Kuala_Lumpur') <= v_now),
         v_now
  from cum;
  get diagnostics v_n = row_count;
  return jsonb_build_object('policy_version', v_policy.version, 'grain', v_grain, 'rows', v_n);
end;
$$;

-- 5. coverage + log row; computed_at is this row's finished_at
create or replace function private.lifecycle_finish(p_policy_version integer default null, p_mode text default 'full', p_rows integer default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
set statement_timeout to '5min'
as $$
declare
  v_policy private.customer_lifecycle_policy;
  v_coverage jsonb;
begin
  v_policy := private.lifecycle_policy(p_policy_version);
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

  insert into private.customer_lifecycle_refresh_log (policy_version, mode, started_at, finished_at, orders_processed, coverage)
  values (v_policy.version, coalesce(p_mode, 'full'), now(), clock_timestamp(), p_rows, v_coverage);
  return v_coverage;
end;
$$;

-- 6. orchestrator with transaction control; pg_cron runs `call private.run_customer_lifecycle_refresh(false)`
create or replace procedure private.run_customer_lifecycle_refresh(p_full boolean default false)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_since timestamptz;
  v_last bigint := 0;
  v_step jsonb;
  v_rows integer := 0;
  v_mode text;
begin
  select max(finished_at) into v_since from private.customer_lifecycle_refresh_log where finished_at is not null and error is null;
  if p_full or v_since is null or not exists (select 1 from private.customer_qualifying_orders limit 1) then
    v_mode := 'full'; v_since := null;
  else
    v_mode := 'incremental'; v_since := v_since - interval '1 hour';
  end if;

  loop
    v_step := private.lifecycle_upsert_orders(v_last, 20000, v_since);
    commit;
    v_rows := v_rows + coalesce((v_step->>'rows')::integer, 0);
    exit when coalesce((v_step->>'rows')::integer, 0) = 0;
    v_last := (v_step->>'last_id')::bigint;
  end loop;

  perform private.lifecycle_rebuild_cohort();  commit;
  perform private.lifecycle_rebuild_states();  commit;
  perform private.lifecycle_rebuild_movement(null, 'month'); commit;
  perform private.lifecycle_rebuild_movement(null, 'week');  commit;
  perform private.lifecycle_finish(null, v_mode, v_rows);    commit;
end;
$$;

revoke all on function private.lifecycle_upsert_orders(bigint, integer, timestamptz) from public, anon, authenticated;
revoke all on function private.lifecycle_rebuild_cohort() from public, anon, authenticated;
revoke all on function private.lifecycle_rebuild_states(integer) from public, anon, authenticated;
revoke all on function private.lifecycle_rebuild_movement(integer, text) from public, anon, authenticated;
revoke all on function private.lifecycle_finish(integer, text, integer) from public, anon, authenticated;
revoke all on procedure private.run_customer_lifecycle_refresh(boolean) from public, anon, authenticated;

-- No schedule in this migration. The daily job is added only after the first
-- hand-driven backfill has completed and the invariant tests pass on the corpus.
