-- Applied 2026-08-25 via MCP apply_migration; filed under the recorded version 20260824221514.
-- customer_cohort_workspaces_v1 — Phase 3 of the operational-workspaces program.
--
-- 1. private.customer_lifecycle_current: one row per identity with the state
--    that holds at refresh time plus the next scheduled boundary (the state
--    rebuild currently writes no future intervals, so next_change_at is null
--    and threshold crossings surface at the nightly refresh — the same
--    latency as live_customer_lifecycle_states).
-- 2. private.lifecycle_rebuild_current(): builds it; wired into the daily job.
-- 3. live_customers / live_customers_export: the `activity` segment field now
--    reads the governed contract (policy-versioned) instead of the
--    unversioned 30/90-day CASE. Values: new | active | at_risk | lapsed |
--    provisional. `dormant` is accepted as an alias of `lapsed` so saved
--    segments keep working.
-- 4. live_customer_segment_summary(): cohort header numbers for the VIP,
--    At-risk and Shared-address workspaces. States when consent / outbound
--    are unavailable instead of pretending.
-- 5. create_customer_work_item / close_work_item: audited, idempotent,
--    role-checked commands over the existing public.work_items table.
--    Internal follow-ups only; nothing is sent to a customer.
--
-- Additive only. No table is dropped and no applied migration is edited.
-- Dry-run inside a rolled-back transaction before apply (see program plan §6).

create table if not exists private.customer_lifecycle_current (
  identity_key       text primary key,
  policy_version     integer not null,
  state              text not null,
  since              timestamptz not null,
  next_change_at     timestamptz,
  next_state         text,
  last_qualifying_at timestamptz,
  lifecycle_orders   integer,
  first_accepted_at  timestamptz,
  refreshed_at       timestamptz not null
);
create index if not exists clc_state_idx on private.customer_lifecycle_current (policy_version, state);
comment on table private.customer_lifecycle_current is
  'Per-identity lifecycle state at refresh time plus the next scheduled boundary. Query-time state = next_state when next_change_at <= now(), else state. Rebuilt by private.lifecycle_rebuild_current() after every state rebuild.';

create or replace function private.lifecycle_rebuild_current(p_policy_version integer default null)
returns jsonb language plpgsql security definer set search_path = '' set jit = off set max_parallel_workers_per_gather = 0 set work_mem = '16MB' set statement_timeout = '5min'
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
  select c.identity_key, v_policy.version, cur.state, cur.valid_from, nxt.valid_from, nxt.state,
         c.last_qualifying_at, c.lifecycle_orders, c.first_accepted_at, v_now
  from private.customer_acquisition_cohort c
  join lateral (
    select st.state, st.valid_from from private.customer_lifecycle_state st
    where st.policy_version = v_policy.version and st.identity_key = c.identity_key
      and st.valid_from <= v_now and (st.valid_to is null or st.valid_to > v_now)
    order by st.valid_from desc limit 1
  ) cur on true
  left join lateral (
    select st.state, st.valid_from from private.customer_lifecycle_state st
    where st.policy_version = v_policy.version and st.identity_key = c.identity_key and st.valid_from > v_now
    order by st.valid_from asc limit 1
  ) nxt on true;
  get diagnostics v_rows = row_count;
  analyze private.customer_lifecycle_current;
  return jsonb_build_object('rows', v_rows, 'policy_version', v_policy.version, 'refreshed_at', v_now);
end;
$$;

create or replace function private.refresh_customer_lifecycle_daily()
returns jsonb language plpgsql security definer set search_path = '' set jit = off set max_parallel_workers_per_gather = 0 set work_mem = '16MB' set statement_timeout = '10min'
as $$
declare
  v_since timestamptz; v_last bigint := 0; v_step jsonb; v_rows integer := 0;
begin
  select max(finished_at) into v_since from private.customer_lifecycle_refresh_log where finished_at is not null and error is null;
  if v_since is null then raise exception 'No completed refresh yet: run the v3 steps by hand first'; end if;
  v_since := v_since - interval '1 hour';
  loop
    v_step := private.lifecycle_upsert_orders(v_last, 20000, v_since);
    v_rows := v_rows + coalesce((v_step->>'rows')::integer, 0);
    exit when coalesce((v_step->>'rows')::integer, 0) = 0;
    v_last := (v_step->>'last_id')::bigint;
  end loop;
  perform private.lifecycle_rebuild_cohort();
  perform private.lifecycle_rebuild_states();
  perform private.lifecycle_rebuild_current();
  perform private.lifecycle_rebuild_movement(null, 'month');
  perform private.lifecycle_rebuild_movement(null, 'week');
  return private.lifecycle_finish(null, 'incremental', v_rows);
end;
$$;

-- Query-time activity value for one identity (null when not in the cohort).
-- `new` = active, single qualifying order, accepted within the lapse threshold.
create or replace function private.lifecycle_activity(
  p_state text, p_next_change_at timestamptz, p_next_state text,
  p_lifecycle_orders integer, p_first_accepted_at timestamptz, p_threshold_days integer)
returns text language sql stable parallel safe set search_path = ''
as $$
  select case
    when p_state is null then null
    when (case when p_next_change_at is not null and p_next_change_at <= now() then p_next_state else p_state end) = 'active'
         and p_lifecycle_orders = 1
         and p_first_accepted_at > now() - make_interval(days => p_threshold_days)
      then 'new'
    else (case when p_next_change_at is not null and p_next_change_at <= now() then p_next_state else p_state end)
  end;
$$;

create or replace function public.live_customers(
  p_page integer default 1, p_page_size integer default 50, p_search text default '',
  p_brand_id bigint default null, p_countries text[] default null, p_conditions jsonb default null)
returns table(identity_key text, display_name text, phone text, email text, city text, country text,
  brand_ids bigint[], total_orders bigint, recognized_orders bigint, cod_orders bigint, suspect_orders bigint,
  cancelled_orders bigint, distinct_names bigint, first_order_at timestamptz, last_order_at timestamptz,
  revenue_by_currency jsonb, revenue_total numeric, classification text, address_key text,
  shared_address_count bigint, total_count bigint)
language plpgsql stable security definer set search_path = '' set jit = off set work_mem = '16MB'
as $$
declare
  v_needle text := nullif(trim(p_search), '');
  v_size integer := least(greatest(p_page_size, 1), 1000);
  v_threshold integer := coalesce((private.lifecycle_policy(null)).threshold_days, 60);
begin
  if not private.is_workspace_member((select min(id) from public.workspaces)) then raise exception 'Not a workspace member'; end if;
  return query
  select c.identity_key, c.display_name, c.phone, c.email, c.city, c.country,
         c.brand_ids, c.total_orders, c.recognized_orders, c.cod_orders, c.suspect_orders, c.cancelled_orders, c.distinct_names,
         c.first_order_at, c.last_order_at, c.revenue_by_currency, c.revenue_total, c.classification, c.address_key, c.shared_address_count,
         count(*) over ()::bigint as total_count
  from private.customers_read c
  left join private.customer_lifecycle_current lc on lc.identity_key = c.identity_key
  where (p_brand_id is null or c.brand_ids @> array[p_brand_id])
    and (p_countries is null or upper(coalesce(c.country, '')) = any(p_countries))
    and (v_needle is null
         or c.display_name ilike '%' || v_needle || '%'
         or c.phone ilike '%' || v_needle || '%'
         or c.email ilike '%' || v_needle || '%'
         or c.identity_key ilike '%' || regexp_replace(v_needle, '[^0-9a-z@._-]', '', 'gi') || '%')
    and (p_conditions is null or jsonb_typeof(p_conditions) <> 'array' or not exists (
      select 1 from jsonb_array_elements(p_conditions) as cond
      cross join lateral (
        select case cond->>'field'
          when 'total_orders' then c.total_orders::numeric
          when 'recognized_orders' then c.recognized_orders::numeric
          when 'cod_orders' then c.cod_orders::numeric
          when 'suspect_orders' then c.suspect_orders::numeric
          when 'cancelled_orders' then c.cancelled_orders::numeric
          when 'distinct_names' then c.distinct_names::numeric
          when 'revenue_total' then c.revenue_total
          when 'shared_address_count' then coalesce(c.shared_address_count, 1)::numeric
          when 'cod_share' then case when c.total_orders > 0 then round(100.0 * c.cod_orders / c.total_orders, 1) else 0 end
          when 'last_order_days' then case when c.last_order_at is null then null else extract(epoch from now() - c.last_order_at) / 86400 end
          when 'first_order_days' then case when c.first_order_at is null then null else extract(epoch from now() - c.first_order_at) / 86400 end
          else null end as num_val
      ) nv
      where not (
        case cond->>'field'
          when 'activity' then
            (case when cond->>'value' = 'dormant' then 'lapsed' else cond->>'value' end) = coalesce(
              private.lifecycle_activity(lc.state, lc.next_change_at, lc.next_state, lc.lifecycle_orders, lc.first_accepted_at, v_threshold), 'provisional')
          when 'repeat' then (cond->>'value') = (case when c.total_orders >= 5 then 'loyal' when c.total_orders >= 2 then 'repeat' else 'first_time' end)
          when 'tier' then (cond->>'value') = (case when c.revenue_total >= 900 then 'vip' when c.revenue_total >= 600 then 'high' when c.revenue_total >= 230 then 'mid' else 'low' end)
          when 'classification' then (cond->>'value') = c.classification
          when 'country' then upper(coalesce(c.country, '')) in (select upper(x.value) from jsonb_array_elements_text(coalesce(cond->'value', '[]'::jsonb)) x)
          else nv.num_val is not null and (
            case cond->>'op'
              when 'gte' then nv.num_val >= (cond->>'value')::numeric
              when 'lte' then nv.num_val <= (cond->>'value')::numeric
              when 'eq'  then nv.num_val = (cond->>'value')::numeric
              else false end)
        end)
    ))
  order by c.last_order_at desc nulls last, c.identity_key
  limit v_size offset (greatest(p_page, 1) - 1) * v_size;
end;
$$;

create or replace function public.live_customers_export(
  p_page integer default 1, p_page_size integer default 1000, p_search text default '',
  p_brand_id bigint default null, p_countries text[] default null, p_conditions jsonb default null,
  p_with_address boolean default true)
returns table(identity_key text, display_name text, phone text, email text, city text, country text,
  brand_ids bigint[], total_orders bigint, recognized_orders bigint, cod_orders bigint, suspect_orders bigint,
  cancelled_orders bigint, distinct_names bigint, first_order_at timestamptz, last_order_at timestamptz,
  revenue_by_currency jsonb, revenue_total numeric, classification text, address_key text,
  shared_address_count bigint, address_1 text, address_2 text, addr_city text, addr_state text, postcode text,
  addr_country text, address_order_number text, address_placed_at timestamptz, address_corrected boolean)
language plpgsql stable security definer set search_path = '' set jit = off set work_mem = '16MB' set statement_timeout = '30s'
as $$
declare
  v_needle text := nullif(trim(p_search), '');
  v_size integer := least(greatest(p_page_size, 1), 1000);
  v_threshold integer := coalesce((private.lifecycle_policy(null)).threshold_days, 60);
begin
  if not private.is_workspace_member((select min(id) from public.workspaces)) then raise exception 'Not a workspace member'; end if;
  return query
  select c.identity_key, c.display_name, c.phone, c.email, c.city, c.country,
         c.brand_ids, c.total_orders, c.recognized_orders, c.cod_orders, c.suspect_orders, c.cancelled_orders, c.distinct_names,
         c.first_order_at, c.last_order_at, c.revenue_by_currency, c.revenue_total, c.classification, c.address_key, c.shared_address_count,
         a.address_1, a.address_2, a.city, a.state, a.postcode, a.country, a.order_number, a.placed_at, a.corrected
  from (
    select c.*
    from private.customers_read c
    left join private.customer_lifecycle_current lc on lc.identity_key = c.identity_key
    where (p_brand_id is null or c.brand_ids @> array[p_brand_id])
      and (p_countries is null or upper(coalesce(c.country, '')) = any(p_countries))
      and (v_needle is null
           or c.display_name ilike '%' || v_needle || '%'
           or c.phone ilike '%' || v_needle || '%'
           or c.email ilike '%' || v_needle || '%'
           or c.identity_key ilike '%' || regexp_replace(v_needle, '[^0-9a-z@._-]', '', 'gi') || '%')
      and (p_conditions is null or jsonb_typeof(p_conditions) <> 'array' or not exists (
        select 1 from jsonb_array_elements(p_conditions) as cond
        cross join lateral (
          select case cond->>'field'
            when 'total_orders' then c.total_orders::numeric
            when 'recognized_orders' then c.recognized_orders::numeric
            when 'cod_orders' then c.cod_orders::numeric
            when 'suspect_orders' then c.suspect_orders::numeric
            when 'cancelled_orders' then c.cancelled_orders::numeric
            when 'distinct_names' then c.distinct_names::numeric
            when 'revenue_total' then c.revenue_total
            when 'shared_address_count' then coalesce(c.shared_address_count, 1)::numeric
            when 'cod_share' then case when c.total_orders > 0 then round(100.0 * c.cod_orders / c.total_orders, 1) else 0 end
            when 'last_order_days' then case when c.last_order_at is null then null else extract(epoch from now() - c.last_order_at) / 86400 end
            when 'first_order_days' then case when c.first_order_at is null then null else extract(epoch from now() - c.first_order_at) / 86400 end
            else null end as num_val
        ) nv
        where not (
          case cond->>'field'
            when 'activity' then
              (case when cond->>'value' = 'dormant' then 'lapsed' else cond->>'value' end) = coalesce(
                private.lifecycle_activity(lc.state, lc.next_change_at, lc.next_state, lc.lifecycle_orders, lc.first_accepted_at, v_threshold), 'provisional')
            when 'repeat' then (cond->>'value') = (case when c.total_orders >= 5 then 'loyal' when c.total_orders >= 2 then 'repeat' else 'first_time' end)
            when 'tier' then (cond->>'value') = (case when c.revenue_total >= 900 then 'vip' when c.revenue_total >= 600 then 'high' when c.revenue_total >= 230 then 'mid' else 'low' end)
            when 'classification' then (cond->>'value') = c.classification
            when 'country' then upper(coalesce(c.country, '')) in (select upper(x.value) from jsonb_array_elements_text(coalesce(cond->'value', '[]'::jsonb)) x)
            else nv.num_val is not null and (
              case cond->>'op'
                when 'gte' then nv.num_val >= (cond->>'value')::numeric
                when 'lte' then nv.num_val <= (cond->>'value')::numeric
                when 'eq'  then nv.num_val = (cond->>'value')::numeric
                else false end)
          end)
      ))
    order by c.last_order_at desc nulls last, c.identity_key
    limit v_size offset (greatest(p_page, 1) - 1) * v_size
  ) c
  left join lateral private.latest_address(c.identity_key) a on p_with_address
  order by c.last_order_at desc nulls last, c.identity_key;
end;
$$;

create or replace function public.live_customer_segment_summary(p_cohort text, p_brand_id bigint default null, p_countries text[] default null)
returns jsonb language plpgsql stable security definer set search_path = '' set jit = off set work_mem = '16MB' set statement_timeout = '15s'
as $$
declare
  v_ws bigint := (select min(id) from public.workspaces);
  v_policy private.customer_lifecycle_policy := private.lifecycle_policy(null);
  v_refreshed timestamptz := (select max(refreshed_at) from private.customer_lifecycle_current);
  v_threshold integer := coalesce(v_policy.threshold_days, 60);
  v_def jsonb; v_stats jsonb;
begin
  if not private.is_workspace_member(v_ws) then raise exception 'Not a workspace member'; end if;
  if p_cohort not in ('vip', 'at_risk', 'shared_address') then raise exception 'Unknown cohort %', p_cohort; end if;
  v_def := case p_cohort
    when 'vip' then jsonb_build_object('key', 'vip', 'label', 'VIP',
      'rule', 'Lifetime recognized revenue >= 900 (value-tier rule v0, unversioned; calibrated to p99 of the live distribution)',
      'rule_version', 'tier-v0', 'governed', false)
    when 'at_risk' then jsonb_build_object('key', 'at_risk', 'label', 'At risk',
      'rule', format('Lifecycle state at_risk under policy v%s: last qualifying purchase between %s and %s days ago', v_policy.version, v_policy.at_risk_days, v_policy.threshold_days),
      'rule_version', 'lifecycle-policy-v' || v_policy.version, 'governed', true)
    else jsonb_build_object('key', 'shared_address', 'label', 'Shared address',
      'rule', 'Two or more resolved identities share one normalized delivery address (review signal; never auto-merged)',
      'rule_version', 'identity-v1', 'governed', true)
  end;
  if v_policy.version is null or v_refreshed is null then
    return jsonb_build_object('status', 'unavailable', 'reason', case when v_policy.version is null then 'no_policy' else 'not_computed' end, 'definition', v_def);
  end if;
  with members as (
    select c.identity_key, c.revenue_total, c.revenue_by_currency, c.total_orders, c.cod_orders, c.last_order_at, c.shared_address_count, c.classification, c.address_key,
           coalesce(private.lifecycle_activity(lc.state, lc.next_change_at, lc.next_state, lc.lifecycle_orders, lc.first_accepted_at, v_threshold), 'provisional') as activity
    from private.customers_read c
    left join private.customer_lifecycle_current lc on lc.identity_key = c.identity_key
    where (p_brand_id is null or c.brand_ids @> array[p_brand_id])
      and (p_countries is null or upper(coalesce(c.country, '')) = any(p_countries))
      and case p_cohort
            when 'vip' then c.revenue_total >= 900
            when 'at_risk' then private.lifecycle_activity(lc.state, lc.next_change_at, lc.next_state, lc.lifecycle_orders, lc.first_accepted_at, v_threshold) = 'at_risk'
            else coalesce(c.shared_address_count, 1) >= 2 end
  ), agg as (
    select count(*) as members,
           count(*) filter (where activity = 'new') as new_count,
           count(*) filter (where activity = 'active') as active_count,
           count(*) filter (where activity = 'at_risk') as at_risk_count,
           count(*) filter (where activity = 'lapsed') as lapsed_count,
           count(*) filter (where activity = 'provisional') as provisional_count,
           coalesce(sum(total_orders), 0) as orders,
           coalesce(sum(cod_orders), 0) as cod_orders,
           coalesce(sum(revenue_total), 0) as revenue_total,
           count(*) filter (where last_order_at >= now() - interval '30 days') as ordered_30d,
           count(*) filter (where classification = 'reseller') as resellers,
           count(distinct address_key) as address_clusters
    from members
  ), ccy as (
    select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) as by_currency
    from (select e.key as k, sum((e.value)::numeric) as v from members m cross join lateral jsonb_each_text(coalesce(m.revenue_by_currency, '{}'::jsonb)) e group by e.key) s
  ), wi as (
    select count(*) as open_work_items from public.work_items w
    where w.workspace_id = v_ws and w.status = 'open' and w.entity_ref in (select 'customer:' || identity_key from members)
  )
  select jsonb_build_object(
    'members', a.members,
    'lifecycle', jsonb_build_object('new', a.new_count, 'active', a.active_count, 'at_risk', a.at_risk_count, 'lapsed', a.lapsed_count, 'provisional', a.provisional_count),
    'orders', a.orders,
    'cod_share', case when a.orders > 0 then round(100.0 * a.cod_orders / a.orders, 1) else null end,
    'revenue_total', a.revenue_total,
    'revenue_by_currency', ccy.by_currency,
    'ordered_30d', a.ordered_30d,
    'resellers', a.resellers,
    'address_clusters', case when p_cohort = 'shared_address' then a.address_clusters else null end,
    'open_work_items', wi.open_work_items)
  into v_stats from agg a, ccy, wi;
  return jsonb_build_object(
    'status', 'ok', 'cohort', p_cohort, 'definition', v_def,
    'scope', jsonb_build_object('brand_id', p_brand_id, 'countries', p_countries),
    'policy', jsonb_build_object('version', v_policy.version, 'status', v_policy.status, 'threshold_days', v_policy.threshold_days, 'at_risk_days', v_policy.at_risk_days),
    'computed_at', v_refreshed, 'stats', v_stats,
    'consent', jsonb_build_object('status', 'unavailable', 'reason', 'no_consent_source'),
    'outbound', jsonb_build_object('enabled', false, 'reason', 'internal follow-ups only; no CRM send path in this release'));
end;
$$;

-- One open follow-up per customer and action; a second request returns the existing one.
create unique index if not exists work_items_open_entity_action_uidx on public.work_items (workspace_id, entity_ref, next_action) where status = 'open';

create or replace function public.create_customer_work_item(
  p_identity_key text, p_next_action text, p_severity text default 'medium',
  p_due_at timestamptz default null, p_note text default null, p_source text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_ws bigint := (select min(id) from public.workspaces);
  v_me bigint; v_actor text; v_name text;
  v_existing public.work_items%rowtype; v_item public.work_items%rowtype;
begin
  if not private.has_role(v_ws, array['hq_admin', 'sales_cs', 'operations', 'marketing_growth']) then raise exception 'Not allowed to create customer follow-ups'; end if;
  if p_next_action not in ('call', 'whatsapp_manual', 'review', 'address_review') then raise exception 'Unknown next action %', p_next_action; end if;
  if p_severity not in ('low', 'medium', 'high') then raise exception 'Unknown severity %', p_severity; end if;
  if p_source is not null and p_source not in ('vip', 'at_risk', 'shared_address', 'customer_360', 'customers') then raise exception 'Unknown source %', p_source; end if;
  select display_name into v_name from private.customers_read where identity_key = p_identity_key;
  if not found then raise exception 'Unknown customer'; end if;
  select m.id into v_me from public.memberships m where m.workspace_id = v_ws and m.user_id = (select auth.uid()) and m.status = 'active' limit 1;
  v_actor := coalesce((select display_name from public.profiles where id = (select auth.uid())), 'unknown');
  select * into v_existing from public.work_items w
  where w.workspace_id = v_ws and w.entity_ref = 'customer:' || p_identity_key and w.next_action = p_next_action and w.status = 'open';
  if v_existing.id is not null then return jsonb_build_object('created', false, 'work_item', to_jsonb(v_existing)); end if;
  insert into public.work_items (workspace_id, title, entity_ref, owner_membership_id, severity, next_action, due_at, status)
  values (v_ws, left(coalesce(v_name, 'Customer') || ' — ' || replace(p_next_action, '_', ' ') || coalesce(' (' || p_source || ')', ''), 200),
          'customer:' || p_identity_key, v_me, p_severity, p_next_action, p_due_at, 'open')
  returning * into v_item;
  insert into public.audit_events (workspace_id, actor_membership_id, actor_label, action, entity_ref, detail, after_data)
  values (v_ws, v_me, v_actor, 'customer.work_item_created', 'customer:' || p_identity_key,
          'Follow-up created' || coalesce(' from ' || p_source, '') || coalesce(': ' || left(p_note, 500), ''),
          jsonb_build_object('work_item_id', v_item.id, 'next_action', p_next_action, 'severity', p_severity, 'due_at', p_due_at, 'source', p_source));
  return jsonb_build_object('created', true, 'work_item', to_jsonb(v_item));
end;
$$;

create or replace function public.close_work_item(p_work_item_id bigint, p_outcome text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_ws bigint := (select min(id) from public.workspaces);
  v_me bigint; v_actor text; v_item public.work_items%rowtype;
begin
  if not private.has_role(v_ws, array['hq_admin', 'sales_cs', 'operations', 'marketing_growth']) then raise exception 'Not allowed to close follow-ups'; end if;
  if p_outcome not in ('done', 'dropped') then raise exception 'Outcome must be done or dropped'; end if;
  select * into v_item from public.work_items where id = p_work_item_id and workspace_id = v_ws;
  if v_item.id is null then raise exception 'No such work item'; end if;
  if v_item.status <> 'open' then return jsonb_build_object('changed', false, 'work_item', to_jsonb(v_item)); end if;
  select m.id into v_me from public.memberships m where m.workspace_id = v_ws and m.user_id = (select auth.uid()) and m.status = 'active' limit 1;
  v_actor := coalesce((select display_name from public.profiles where id = (select auth.uid())), 'unknown');
  update public.work_items set status = p_outcome where id = v_item.id returning * into v_item;
  insert into public.audit_events (workspace_id, actor_membership_id, actor_label, action, entity_ref, detail, before_data, after_data)
  values (v_ws, v_me, v_actor, 'customer.work_item_closed', v_item.entity_ref, 'Follow-up ' || p_outcome || coalesce(': ' || left(p_note, 500), ''),
          jsonb_build_object('status', 'open'), jsonb_build_object('work_item_id', v_item.id, 'status', p_outcome));
  return jsonb_build_object('changed', true, 'work_item', to_jsonb(v_item));
end;
$$;

revoke all on function public.live_customer_segment_summary(text, bigint, text[]) from public, anon;
grant execute on function public.live_customer_segment_summary(text, bigint, text[]) to authenticated, service_role;
revoke all on function public.create_customer_work_item(text, text, text, timestamptz, text, text) from public, anon;
grant execute on function public.create_customer_work_item(text, text, text, timestamptz, text, text) to authenticated, service_role;
revoke all on function public.close_work_item(bigint, text, text) from public, anon;
grant execute on function public.close_work_item(bigint, text, text) to authenticated, service_role;
revoke all on function private.lifecycle_rebuild_current(integer) from public, anon, authenticated;
revoke all on function private.lifecycle_activity(text, timestamptz, text, integer, timestamptz, integer) from public, anon;
-- Direct table writes stay blocked (RLS has no write policy); only the commands above write.
revoke insert, update, delete, truncate, references, trigger on public.work_items from anon, authenticated;

-- Initial build of the current-state table (~154k rows).
select private.lifecycle_rebuild_current();
