-- Customer lifecycle contract, v4: same-instant orders are one purchase event.
--
-- The first full run of lifecycle_rebuild_states (v3) hit
-- customer_lifecycle_state_pkey: an identity with two orders at the same
-- second produced two `active` intervals with the same valid_from. Lifecycle
-- timing is per purchase *event*, so orders sharing (identity_key, placed_at)
-- collapse to one row (lowest order id as the trigger). Nothing else changes.

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
  with p as (
    select distinct on (identity_key, placed_at) identity_key, placed_at, order_read_id
    from private.customer_qualifying_orders
    where qualifies_lifecycle and identity_key is not null and placed_at is not null
    order by identity_key, placed_at, order_read_id
  )
  select identity_key, placed_at, order_read_id,
         lag(placed_at)  over (partition by identity_key order by placed_at) as prev_at,
         lead(placed_at) over (partition by identity_key order by placed_at) as next_at,
         row_number()    over (partition by identity_key order by placed_at) as rn
  from p;

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

revoke all on function private.lifecycle_rebuild_states(integer) from public, anon, authenticated;
