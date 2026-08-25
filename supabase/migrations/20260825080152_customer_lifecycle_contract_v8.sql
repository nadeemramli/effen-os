-- Applied 2026-08-25 via MCP apply_migration; filed under the recorded version 20260825080152.
-- customer_lifecycle_contract_v8 — Phase 8 hardening.
--
-- 1. Successor-state derivation between refreshes. The state rebuild writes
--    each identity's current interval with a deterministic future valid_to
--    (active ends at last purchase + at_risk_days; at_risk ends at + threshold)
--    but not the interval that follows it. Between nightly refreshes an
--    identity whose interval has expired had NO covering interval, and
--    live_customer_lifecycle_states / the list filter reported it as
--    "provisional". Policy makes the successor deterministic, so:
--      - live_customer_lifecycle_states derives it: active → at_risk, at_risk → lapsed;
--      - lifecycle_rebuild_current stores next_change_at / next_state from the
--        interval's valid_to, so private.lifecycle_activity (list filter,
--        cohort summary) flips at the right instant too.
--    Found by the Phase 8 test run: 305 identities were in that gap.
-- 2. Advisor: two SECURITY DEFINER functions were executable by anon via
--    PostgREST (nv_events_rts_rollup, nv_shipments_link_trigger). Revoked for
--    anon and authenticated; cron and triggers run as postgres.
--
-- Additive only. No table is dropped and no applied migration is edited.

create or replace function public.live_customer_lifecycle_states(p_identity_keys text[])
returns jsonb
language plpgsql stable security definer set search_path = '' set statement_timeout = '10s'
as $$
declare
  v_ws bigint := (select min(id) from public.workspaces);
  v_policy private.customer_lifecycle_policy;
  v_log private.customer_lifecycle_refresh_log%rowtype;
  v_states jsonb;
begin
  if not private.is_workspace_member(v_ws) then raise exception 'Not a workspace member'; end if;
  if p_identity_keys is null or cardinality(p_identity_keys) = 0 then return jsonb_build_object('status', 'ok', 'states', '{}'::jsonb); end if;
  if cardinality(p_identity_keys) > 500 then raise exception 'At most 500 identity keys per call'; end if;

  v_policy := private.lifecycle_policy(null);
  select * into v_log from private.customer_lifecycle_refresh_log
  where policy_version = v_policy.version and finished_at is not null and error is null
  order by finished_at desc limit 1;
  if v_policy.version is null or v_log.id is null then
    return jsonb_build_object('status', 'unavailable', 'reason', case when v_policy.version is null then 'no_policy' else 'not_computed' end);
  end if;

  select jsonb_object_agg(k.key, jsonb_build_object(
           'state', coalesce(
             -- Latest interval; when it has already ended, the policy-determined successor.
             case when s.valid_to is not null and s.valid_to <= now()
                  then case s.state when 'active' then 'at_risk' when 'at_risk' then 'lapsed' else s.state end
                  else s.state end,
             case when c.identity_key is not null then 'provisional' end),
           'since', case when s.valid_to is not null and s.valid_to <= now() then s.valid_to else s.valid_from end,
           'derived', (s.valid_to is not null and s.valid_to <= now()),
           'last_qualifying_at', c.last_qualifying_at,
           'lifecycle_orders', c.lifecycle_orders,
           'first_accepted_at', c.first_accepted_at))
  into v_states
  from unnest(p_identity_keys) as k(key)
  left join private.customer_acquisition_cohort c on c.identity_key = k.key
  left join lateral (
    select st.state, st.valid_from, st.valid_to
    from private.customer_lifecycle_state st
    where st.policy_version = v_policy.version and st.identity_key = k.key and st.valid_from <= now()
    order by st.valid_from desc limit 1
  ) s on true;

  return jsonb_build_object(
    'status', 'ok',
    'policy', jsonb_build_object('version', v_policy.version, 'status', v_policy.status,
      'threshold_days', v_policy.threshold_days, 'at_risk_days', v_policy.at_risk_days),
    'computed_at', v_log.finished_at,
    'states', coalesce(v_states, '{}'::jsonb));
end;
$$;

-- Current-state table now carries the scheduled successor so query-time evaluation flips at valid_to.
create or replace function private.lifecycle_rebuild_current(p_policy_version integer default null)
returns jsonb
language plpgsql security definer set search_path = '' set jit = off set max_parallel_workers_per_gather = 0 set work_mem = '16MB' set statement_timeout = '5min'
as $$
declare
  v_policy private.customer_lifecycle_policy := private.lifecycle_policy(p_policy_version);
  v_now timestamptz := now();
  v_rows bigint;
begin
  if v_policy.version is null then raise exception 'No lifecycle policy'; end if;
  truncate private.customer_lifecycle_current;
  insert into private.customer_lifecycle_current
    (identity_key, policy_version, state, since, next_change_at, next_state, last_qualifying_at, lifecycle_orders, first_accepted_at, refreshed_at)
  select c.identity_key, v_policy.version,
         -- If the latest interval already ended (rebuild lag), start from its successor.
         case when cur.valid_to is not null and cur.valid_to <= v_now
              then case cur.state when 'active' then 'at_risk' when 'at_risk' then 'lapsed' else cur.state end
              else cur.state end,
         case when cur.valid_to is not null and cur.valid_to <= v_now then cur.valid_to else cur.valid_from end,
         -- Scheduled successor: an active interval ends into at_risk, an at_risk interval into lapsed.
         case when cur.valid_to is not null and cur.valid_to > v_now and cur.state in ('active', 'at_risk') then cur.valid_to
              when cur.valid_to is not null and cur.valid_to <= v_now and cur.state = 'active'
                then cur.valid_to + make_interval(days => v_policy.threshold_days - v_policy.at_risk_days)
              else null end,
         case when cur.valid_to is not null and cur.valid_to > v_now and cur.state = 'active' then 'at_risk'
              when cur.valid_to is not null and cur.valid_to > v_now and cur.state = 'at_risk' then 'lapsed'
              when cur.valid_to is not null and cur.valid_to <= v_now and cur.state = 'active' then 'lapsed'
              else null end,
         c.last_qualifying_at, c.lifecycle_orders, c.first_accepted_at, v_now
  from private.customer_acquisition_cohort c
  join lateral (
    select st.state, st.valid_from, st.valid_to
    from private.customer_lifecycle_state st
    where st.policy_version = v_policy.version and st.identity_key = c.identity_key and st.valid_from <= v_now
    order by st.valid_from desc limit 1
  ) cur on true;
  get diagnostics v_rows = row_count;
  analyze private.customer_lifecycle_current;
  return jsonb_build_object('rows', v_rows, 'policy_version', v_policy.version, 'refreshed_at', v_now);
end;
$$;

-- Advisor: no anon / authenticated execute on internal SECURITY DEFINER helpers.
revoke execute on function public.nv_events_rts_rollup() from public, anon, authenticated;
revoke execute on function public.nv_shipments_link_trigger() from public, anon, authenticated;

select private.lifecycle_rebuild_current();
