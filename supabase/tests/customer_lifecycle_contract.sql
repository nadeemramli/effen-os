-- Invariant tests for the customer lifecycle contract (program plan Phase 1).
--
-- Run against a project where private.refresh_customer_lifecycle() has
-- completed at least once (psql, the Supabase SQL editor, or the MCP
-- execute_sql tool). Every row must have pass = true. These are plain SQL so
-- they can run without pgTAP; the `details` column explains a failure.

with policy as (
  select version from private.customer_lifecycle_policy
  where status in ('provisional', 'approved') order by version desc limit 1
),
t as (
  -- 1. Reconciliation identity holds for every period × scope row.
  select 'movement_reconciles' as test,
         count(*) filter (where closing_active <> opening_active + new_customers + reactivated - lapsed + corrections) = 0 as pass,
         jsonb_build_object('rows', count(*), 'violations',
           count(*) filter (where closing_active <> opening_active + new_customers + reactivated - lapsed + corrections)) as details
  from private.customer_base_movement_period m, policy p where m.policy_version = p.version
  union all
  -- 2. net_active_change is stored consistently.
  select 'net_change_consistent',
         count(*) filter (where net_active_change <> new_customers + reactivated - lapsed) = 0,
         jsonb_build_object('violations', count(*) filter (where net_active_change <> new_customers + reactivated - lapsed))
  from private.customer_base_movement_period m, policy p where m.policy_version = p.version
  union all
  -- 3. Retained never exceeds opening or closing.
  select 'retained_bounded',
         count(*) filter (where retained > opening_active or retained > closing_active) = 0,
         jsonb_build_object('violations', count(*) filter (where retained > opening_active or retained > closing_active))
  from private.customer_base_movement_period m, policy p where m.policy_version = p.version
  union all
  -- 4. No overlapping state intervals for one identity (at most one state at any instant).
  select 'state_intervals_disjoint',
         count(*) = 0,
         jsonb_build_object('overlaps', count(*))
  from private.customer_lifecycle_state a
  join private.customer_lifecycle_state b
    on a.policy_version = b.policy_version and a.identity_key = b.identity_key
   and a.valid_from < b.valid_from
   and (a.valid_to is null or a.valid_to > b.valid_from)
  join policy p on p.version = a.policy_version
  union all
  -- 5. Transition from/to pairs are only the allowed ones.
  select 'transition_pairs_valid',
         count(*) filter (where not (
           (transition = 'new' and from_state is null and to_state = 'active') or
           (transition = 'reactivated' and from_state = 'lapsed' and to_state = 'active') or
           (transition = 'at_risk' and from_state = 'active' and to_state = 'at_risk') or
           (transition = 'lapsed' and from_state = 'at_risk' and to_state = 'lapsed'))) = 0,
         jsonb_build_object('rows', count(*))
  from private.customer_lifecycle_transition t, policy p where t.policy_version = p.version
  union all
  -- 6. Exactly one 'new' per identity, and it is that identity's earliest transition.
  select 'one_new_per_identity_first',
         count(*) filter (where n_new <> 1 or first_tr <> 'new') = 0,
         jsonb_build_object('identities', count(*), 'violations', count(*) filter (where n_new <> 1 or first_tr <> 'new'))
  from (
    select identity_key,
           count(*) filter (where transition = 'new') as n_new,
           (array_agg(transition order by occurred_at, case transition when 'new' then 0 when 'reactivated' then 1 when 'at_risk' then 2 else 3 end))[1] as first_tr
    from private.customer_lifecycle_transition t, policy p where t.policy_version = p.version
    group by identity_key
  ) x
  union all
  -- 7. Enter and exit events alternate: no two enters without a lapse between them.
  select 'episodes_alternate',
         count(*) = 0,
         jsonb_build_object('violations', count(*))
  from (
    select identity_key, transition,
           lag(transition) over (partition by identity_key order by occurred_at) as prev_tr
    from private.customer_lifecycle_transition t, policy p
    where t.policy_version = p.version and transition in ('new', 'reactivated', 'lapsed')
  ) y
  where (transition in ('new', 'reactivated') and prev_tr in ('new', 'reactivated'))
     or (transition = 'lapsed' and (prev_tr is null or prev_tr = 'lapsed'))
  union all
  -- 8. No transition in the future.
  select 'no_future_transitions',
         count(*) filter (where occurred_at > now()) = 0,
         jsonb_build_object('future', count(*) filter (where occurred_at > now()))
  from private.customer_lifecycle_transition t, policy p where t.policy_version = p.version
  union all
  -- 9. Scope isolation: workspace totals equal the sum over brand scopes (null brand included) per period.
  select 'scope_sums_to_workspace',
         count(*) filter (where ws_opening <> br_opening or ws_new <> br_new or ws_lapsed <> br_lapsed) = 0,
         jsonb_build_object('periods', count(*), 'violations',
           count(*) filter (where ws_opening <> br_opening or ws_new <> br_new or ws_lapsed <> br_lapsed))
  from (
    select w.grain, w.period_start,
           w.opening_active as ws_opening, w.new_customers as ws_new, w.lapsed as ws_lapsed,
           sum(b.opening_active) as br_opening, sum(b.new_customers) as br_new, sum(b.lapsed) as br_lapsed
    from private.customer_base_movement_period w
    join private.customer_base_movement_period b
      on b.policy_version = w.policy_version and b.grain = w.grain and b.period_start = w.period_start and b.scope_type = 'brand'
    join policy p on p.version = w.policy_version
    where w.scope_type = 'workspace'
    group by w.grain, w.period_start, w.opening_active, w.new_customers, w.lapsed
  ) z
  union all
  -- 10. Accepted-new is cumulatively >= delivered-new (every lifecycle-qualifying order is also accepted).
  select 'accepted_cumulative_ge_delivered',
         count(*) filter (where cum_acc < cum_new) = 0,
         jsonb_build_object('violations', count(*) filter (where cum_acc < cum_new))
  from (
    select period_start,
           sum(new_accepted) over (order by period_start) as cum_acc,
           sum(new_customers) over (order by period_start) as cum_new
    from private.customer_base_movement_period m, policy p
    where m.policy_version = p.version and m.grain = 'month' and m.scope_type = 'workspace'
  ) c
  union all
  -- 11. Every qualifying order carries a currency and an identity.
  select 'qualifying_orders_complete',
         count(*) filter (where qualifies_lifecycle and (currency_code is null or identity_key is null or placed_at is null)) = 0,
         jsonb_build_object('violations', count(*) filter (where qualifies_lifecycle and (currency_code is null or identity_key is null or placed_at is null)))
  from private.customer_qualifying_orders
  union all
  -- 12. Excluded + qualifying partitions the order set (no row both excluded and qualifying).
  select 'exclusion_partition',
         count(*) filter (where (exclusion_reason is null) <> (qualifies_lifecycle)) = 0,
         jsonb_build_object('violations', count(*) filter (where (exclusion_reason is null) <> (qualifies_lifecycle)))
  from private.customer_qualifying_orders
  union all
  -- 13. Cohort: first delivered is never before first accepted.
  select 'cohort_delivered_not_before_accepted',
         count(*) filter (where first_delivered_at < first_accepted_at) = 0,
         jsonb_build_object('violations', count(*) filter (where first_delivered_at < first_accepted_at))
  from private.customer_acquisition_cohort
  union all
  -- 14. First (empty) period has opening 0; the RPC must then report the rate as not applicable.
  select 'first_period_zero_opening',
         bool_and(opening_active = 0),
         jsonb_build_object('first_period', min(period_start))
  from (
    select opening_active, period_start from private.customer_base_movement_period m, policy p
    where m.policy_version = p.version and m.grain = 'month' and m.scope_type = 'workspace'
    order by period_start limit 1
  ) f
  union all
  -- 15. No negative stocks anywhere.
  select 'no_negative_counts',
         count(*) filter (where opening_active < 0 or closing_active < 0 or at_risk_closing < 0 or retained < 0) = 0,
         jsonb_build_object('violations', count(*) filter (where opening_active < 0 or closing_active < 0 or at_risk_closing < 0 or retained < 0))
  from private.customer_base_movement_period m, policy p where m.policy_version = p.version
  union all
  -- 16. Closing by cumulative events equals the direct point-in-time count of open episodes at period end.
  select 'closing_matches_point_in_time',
         count(*) filter (where closing_active <> pit) = 0,
         jsonb_build_object('checked', count(*), 'violations', count(*) filter (where closing_active <> pit))
  from (
    select m.closing_active,
           (select count(*) from private.customer_base_episode e
             where e.policy_version = m.policy_version
               and e.entered_at <= least((m.period_end::timestamp at time zone 'Asia/Kuala_Lumpur'), now())
               and (e.exited_at is null or e.exited_at > least((m.period_end::timestamp at time zone 'Asia/Kuala_Lumpur'), now()))) as pit
    from private.customer_base_movement_period m, policy p
    where m.policy_version = p.version and m.grain = 'month' and m.scope_type = 'workspace'
  ) c
  union all
  -- 17. at_risk_closing equals the direct point-in-time count of at-risk intervals at period end.
  select 'at_risk_matches_point_in_time',
         count(*) filter (where at_risk_closing <> pit) = 0,
         jsonb_build_object('checked', count(*), 'violations', count(*) filter (where at_risk_closing <> pit))
  from (
    select m.at_risk_closing,
           (select count(*) from private.customer_lifecycle_state s
             where s.policy_version = m.policy_version and s.state = 'at_risk'
               and s.valid_from <= least((m.period_end::timestamp at time zone 'Asia/Kuala_Lumpur'), now())
               and (s.valid_to is null or s.valid_to > least((m.period_end::timestamp at time zone 'Asia/Kuala_Lumpur'), now()))) as pit
    from private.customer_base_movement_period m, policy p
    where m.policy_version = p.version and m.grain = 'month' and m.scope_type = 'workspace'
  ) c
  union all
  -- 18. retained equals the direct count of episodes spanning the whole period.
  select 'retained_matches_point_in_time',
         count(*) filter (where retained <> pit) = 0,
         jsonb_build_object('checked', count(*), 'violations', count(*) filter (where retained <> pit))
  from (
    select m.retained,
           (select count(*) from private.customer_base_episode e
             where e.policy_version = m.policy_version
               and e.entered_at <= (m.period_start::timestamp at time zone 'Asia/Kuala_Lumpur')
               and (e.exited_at is null or e.exited_at > least((m.period_end::timestamp at time zone 'Asia/Kuala_Lumpur'), now()))) as pit
    from private.customer_base_movement_period m, policy p
    where m.policy_version = p.version and m.grain = 'month' and m.scope_type = 'workspace'
  ) c
)
select test, pass, details from t order by test;
