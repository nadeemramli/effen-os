-- customer_lifecycle_contract_v7 — point-in-time lifecycle state lookup.
--
-- Applied 2026-08-24 via MCP apply_migration; filed under the version the
-- ledger recorded (20260824210513), per supabase/migrations/README.md.
--
-- Lets the Customers list and Customer 360 show the governed lifecycle
-- state (policy-versioned, computed by the daily refresh) instead of the
-- browser's own "days since last order" derivation. Read-only; the caller
-- must be a workspace member; at most 500 identity keys per call.
--
-- Response shape:
--   { status: 'ok', policy: {version,status,threshold_days,at_risk_days},
--     computed_at, states: { <identity_key>: { state, since,
--     last_qualifying_at, lifecycle_orders, first_accepted_at } } }
--   { status: 'unavailable', reason: 'no_policy' | 'not_computed' }
--
-- `state` is null when the identity has no qualifying purchase under the
-- policy, and 'provisional' when the identity is in the acquisition cohort
-- but has no closed state interval covering now().

create or replace function public.live_customer_lifecycle_states(p_identity_keys text[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout = '10s'
as $$
declare
  v_ws bigint := (select min(id) from public.workspaces);
  v_policy private.customer_lifecycle_policy;
  v_log private.customer_lifecycle_refresh_log%rowtype;
  v_states jsonb;
begin
  if not private.is_workspace_member(v_ws) then
    raise exception 'Not a workspace member';
  end if;
  if p_identity_keys is null or cardinality(p_identity_keys) = 0 then
    return jsonb_build_object('status', 'ok', 'states', '{}'::jsonb);
  end if;
  if cardinality(p_identity_keys) > 500 then
    raise exception 'At most 500 identity keys per call';
  end if;

  v_policy := private.lifecycle_policy(null);
  select * into v_log from private.customer_lifecycle_refresh_log
  where policy_version = v_policy.version and finished_at is not null and error is null
  order by finished_at desc limit 1;
  if v_policy.version is null or v_log.id is null then
    return jsonb_build_object('status', 'unavailable', 'reason', case when v_policy.version is null then 'no_policy' else 'not_computed' end);
  end if;

  select jsonb_object_agg(k.key, jsonb_build_object(
           'state', coalesce(s.state, case when c.identity_key is not null then 'provisional' end),
           'since', s.valid_from,
           'last_qualifying_at', c.last_qualifying_at,
           'lifecycle_orders', c.lifecycle_orders,
           'first_accepted_at', c.first_accepted_at))
  into v_states
  from unnest(p_identity_keys) as k(key)
  left join private.customer_acquisition_cohort c on c.identity_key = k.key
  left join lateral (
    select st.state, st.valid_from
    from private.customer_lifecycle_state st
    where st.policy_version = v_policy.version and st.identity_key = k.key
      and st.valid_from <= now() and (st.valid_to is null or st.valid_to > now())
    order by st.valid_from desc limit 1
  ) s on true;

  return jsonb_build_object(
    'status', 'ok',
    'policy', jsonb_build_object('version', v_policy.version, 'status', v_policy.status,
      'threshold_days', v_policy.threshold_days, 'at_risk_days', v_policy.at_risk_days),
    'computed_at', v_log.finished_at,
    'states', coalesce(v_states, '{}'::jsonb)
  );
end;
$$;

revoke all on function public.live_customer_lifecycle_states(text[]) from public, anon;
grant execute on function public.live_customer_lifecycle_states(text[]) to authenticated, service_role;
