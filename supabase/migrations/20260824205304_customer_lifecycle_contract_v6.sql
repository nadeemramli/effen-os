-- Customer lifecycle contract, v6: daily incremental refresh function + schedule.
--
-- The first full backfill was driven by hand through the v3 step functions
-- (24 Aug 2026, ~6 min of chunked upserts, then cohort 4 s, states 53 s,
-- movement 12 s) and the 18 invariants pass on the corpus. The daily job only
-- touches orders synced since the last successful refresh (a few thousand
-- rows) and then rebuilds the derived facts step by step; each step is
-- memory-light and time-boxed. pg_cron may run commands through background
-- workers where in-procedure COMMIT is not allowed, so the scheduled entry is
-- a plain function; the v3 procedure remains for manual full runs from a
-- client session. The coverage note is corrected to the v5 rule.

create or replace function private.refresh_customer_lifecycle_daily()
returns jsonb
language plpgsql
security definer
set search_path = ''
set jit to 'off'
set max_parallel_workers_per_gather to '0'
set work_mem to '16MB'
set statement_timeout to '10min'
as $$
declare
  v_since timestamptz;
  v_last bigint := 0;
  v_step jsonb;
  v_rows integer := 0;
begin
  select max(finished_at) into v_since
  from private.customer_lifecycle_refresh_log where finished_at is not null and error is null;
  if v_since is null then
    raise exception 'No completed refresh yet: run the v3 steps by hand first';
  end if;
  v_since := v_since - interval '1 hour';

  loop
    v_step := private.lifecycle_upsert_orders(v_last, 20000, v_since);
    v_rows := v_rows + coalesce((v_step->>'rows')::integer, 0);
    exit when coalesce((v_step->>'rows')::integer, 0) = 0;
    v_last := (v_step->>'last_id')::bigint;
  end loop;

  perform private.lifecycle_rebuild_cohort();
  perform private.lifecycle_rebuild_states();
  perform private.lifecycle_rebuild_movement(null, 'month');
  perform private.lifecycle_rebuild_movement(null, 'week');
  return private.lifecycle_finish(null, 'incremental', v_rows);
end;
$$;

revoke all on function private.refresh_customer_lifecycle_daily() from public, anon, authenticated;

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
    'note', 'Lifecycle-qualifying = store status completed, or processing with a Ninja Van delivered parcel; cancelled, failed and refunded orders never qualify. Acceptance = processing or completed. Identity merges are not historised yet, so the corrections line is always 0.'
  ) into v_coverage
  from private.customer_qualifying_orders;

  insert into private.customer_lifecycle_refresh_log (policy_version, mode, started_at, finished_at, orders_processed, coverage)
  values (v_policy.version, coalesce(p_mode, 'full'), now(), clock_timestamp(), p_rows, v_coverage);
  return v_coverage;
end;
$$;

revoke all on function private.lifecycle_finish(integer, text, integer) from public, anon, authenticated;

-- Daily at 01:30 MYT (17:30 UTC), after the Woo sync and customers_read refresh have settled.
select cron.schedule(
  'customer-lifecycle-refresh-daily',
  '30 17 * * *',
  $cron$ select private.refresh_customer_lifecycle_daily(); $cron$
);
