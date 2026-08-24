-- Customer lifecycle contract, v2 of the refresh (program plan Phase 1).
--
-- v1's first full backfill (20260824190819) crashed the 1 GB instance: the
-- movement step cross-joined ~200k base episodes against ~200 periods and
-- aggregated four grouping sets in one pass. Both cron jobs were unscheduled
-- by hand and the failed transaction rolled back; the tables were empty.
--
-- v2 keeps every table and both serving RPCs and replaces only the refresh:
--   * period movement is computed from bucketed EVENT counts (enters, exits,
--     within-period churn, at-risk starts/ends, first accepted orders) plus
--     cumulative sums over periods — exact for event accounting, no cross join;
--   * per-grain loop so each aggregate touches one grain at a time;
--   * jit off, no parallel workers, bounded work_mem for a predictable footprint;
--   * the one-off backfill unschedules itself BEFORE running, so a failure can
--     never loop; the daily job is re-created.

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
set jit to 'off'
set max_parallel_workers_per_gather to '0'
set work_mem to '16MB'
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
  v_grain    text;
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
    (ik.identity_key is not null and not s.suspect and o.source_status in ('processing', 'completed')) as qualifies_acceptance,
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

  -- 2. acquisition cohort ------------------------------------------------------
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

  -- 3. lifecycle intervals and transitions ------------------------------------
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

  drop table if exists pg_temp.tmp_purchases;

  -- 4. base-membership episodes ------------------------------------------------
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

  -- 5. reconciled movement per period × scope, from bucketed events -----------
  delete from private.customer_base_movement_period where policy_version = v_policy.version;

  foreach v_grain in array array['month', 'week'] loop
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
    -- one row per event, bucketed to its period start in business time
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
      -- entered and exited inside the same period: not part of "retained"
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
           opening_active - (lapsed - churn_within) as retained,
           opening_active + new_customers + reactivated - lapsed as closing_active,
           0,
           new_customers + reactivated - lapsed,
           at_risk_closing, new_accepted,
           ((period_end::timestamp at time zone 'Asia/Kuala_Lumpur') <= v_now) as is_complete,
           v_now
    from cum;
  end loop;

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

-- Daily at 01:30 MYT (17:30 UTC).
select cron.schedule(
  'customer-lifecycle-refresh-daily',
  '30 17 * * *',
  $cron$ set statement_timeout = '15min'; select private.refresh_customer_lifecycle(); $cron$
);

-- Single-attempt backfill: unschedules itself first, then runs once.
select cron.schedule(
  'customer-lifecycle-backfill',
  '* * * * *',
  $cron$ select cron.unschedule('customer-lifecycle-backfill'); set statement_timeout = '15min'; select private.refresh_customer_lifecycle(null, true); $cron$
);
