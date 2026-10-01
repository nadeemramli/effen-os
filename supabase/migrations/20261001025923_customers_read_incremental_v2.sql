-- customers_read: incremental maintenance (phase B — swap)
--
-- Replaces the private.customers_read materialized view with the table built
-- in customers_read_incremental_v1, and points the `customers-read-refresh`
-- cron job at an incremental refresh that recomputes only the identities the
-- orders_read / order_corrections triggers queued. The job name is unchanged so
-- live_automation_health() keeps reporting its last successful run.
--
-- Verified before the swap: the shadow table matched the matview except for
--   * identities whose orders changed after the matview's last snapshot, and
--   * identities with two or more orders sharing one placed_at, where the
--     "latest" phone / address / city / name pick had no tie-breaker and so
--     already flipped between matview refreshes.
-- The second is fixed here: ties now break on order_read_id desc.
--
-- Every reader (live_customers, live_customer_detail, dispatch_eligibility, …)
-- references private.customers_read by name in a string body, so they resolve
-- to the table without being redefined. Column names, types and order match.

set local statement_timeout = '10min';

------------------------------------------------------------------------
-- 1. Aggregation: deterministic tie-break; key filter as a join so large key
--    sets (the weekly rebuild) hash instead of scanning an array per row.
------------------------------------------------------------------------
create or replace function private.customers_read_compute(p_keys text[])
returns table (
  identity_key text, workspace_id bigint, display_name text, phone text,
  email text, city text, country text, brand_ids bigint[],
  total_orders bigint, recognized_orders bigint, cod_orders bigint,
  suspect_orders bigint, cancelled_orders bigint, distinct_names bigint,
  first_order_at timestamptz, last_order_at timestamptz, address_key text,
  revenue_by_currency jsonb, revenue_total numeric)
language sql
stable
set search_path = ''
as $$
  with keyed as (
    select f.* from private.customer_order_facts f
     where p_keys is null
    union all
    select f.* from (select distinct k from unnest(p_keys) k) q
      join private.customer_order_facts f on f.identity_key = q.k
     where p_keys is not null
  ), per_ccy as (
    select k.identity_key, k.currency_code,
           sum(k.total) filter (where k.source_status in ('processing', 'completed')) as revenue
      from keyed k
     group by k.identity_key, k.currency_code
  ), ccy_agg as (
    select p.identity_key,
           jsonb_object_agg(p.currency_code, round(p.revenue, 2)) filter (where p.revenue is not null) as revenue_by_currency
      from per_ccy p
     group by p.identity_key
  ), grouped as (
    select k.identity_key,
           min(k.workspace_id) as workspace_id,
           (array_agg(k.name    order by k.placed_at desc nulls last, k.order_read_id desc) filter (where k.name    is not null))[1] as display_name,
           (array_agg(k.phone   order by k.placed_at desc nulls last, k.order_read_id desc) filter (where k.phone   is not null))[1] as phone,
           (array_agg(k.email   order by k.placed_at desc nulls last, k.order_read_id desc) filter (where k.email   is not null))[1] as email,
           (array_agg(k.city    order by k.placed_at desc nulls last, k.order_read_id desc) filter (where k.city    is not null))[1] as city,
           (array_agg(k.country order by k.placed_at desc nulls last, k.order_read_id desc) filter (where k.country is not null))[1] as country,
           array_agg(distinct k.brand_id) filter (where k.brand_id is not null) as brand_ids,
           count(*) as total_orders,
           count(*) filter (where k.source_status in ('processing', 'completed')) as recognized_orders,
           count(*) filter (where k.is_cod) as cod_orders,
           count(*) filter (where k.suspect) as suspect_orders,
           count(*) filter (where k.source_status in ('cancelled', 'failed', 'refunded')) as cancelled_orders,
           count(distinct lower(trim(k.name))) filter (where k.name is not null) as distinct_names,
           min(k.placed_at) as first_order_at,
           max(k.placed_at) as last_order_at
      from keyed k
     group by k.identity_key
  ), addr_pick as (
    select distinct on (k.identity_key) k.identity_key, k.order_address_key as address_key
      from keyed k
     where k.order_address_key is not null
     order by k.identity_key, k.placed_at desc nulls last, k.order_read_id desc
  )
  select g.identity_key, g.workspace_id, g.display_name, g.phone, g.email,
         g.city, g.country, g.brand_ids, g.total_orders, g.recognized_orders,
         g.cod_orders, g.suspect_orders, g.cancelled_orders, g.distinct_names,
         g.first_order_at, g.last_order_at, a.address_key, c.revenue_by_currency,
         coalesce((select sum(v.value::numeric)
                     from jsonb_each_text(coalesce(c.revenue_by_currency, '{}'::jsonb)) v(key, value)), 0)
    from grouped g
    left join ccy_agg c using (identity_key)
    left join addr_pick a using (identity_key)
$$;

------------------------------------------------------------------------
-- 2. Refresh paths
------------------------------------------------------------------------
-- Incremental: drain the queue, recompute those identities, then re-derive
-- shared_address_count / classification for every address cluster they left
-- or joined (that count spans the whole cluster).
create or replace function private.refresh_customers_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keys text[];
  v_addr text[];
begin
  -- One refresh at a time; a concurrent caller leaves the queue for the next run.
  if not pg_try_advisory_xact_lock(hashtext('private.refresh_customers_read')) then
    return 0;
  end if;

  with claimed as (
    delete from private.customers_read_dirty returning identity_key
  )
  select array_agg(identity_key) into v_keys from claimed;
  if v_keys is null then
    return 0;
  end if;

  with gone as (
    delete from private.customers_read c
     using unnest(v_keys) k
     where c.identity_key = k
    returning c.address_key
  )
  select array_agg(distinct address_key) filter (where address_key is not null) into v_addr from gone;

  with came as (
    insert into private.customers_read
    select x.*, null::bigint, null::text
      from private.customers_read_compute(v_keys) x
    returning address_key
  )
  select coalesce(v_addr, '{}') || coalesce(array_agg(distinct address_key) filter (where address_key is not null), '{}')
    into v_addr from came;

  with addr as (
    select distinct a from unnest(v_addr) a
  ), cnt as (
    select c.address_key, count(*) as n
      from private.customers_read c
      join addr on addr.a = c.address_key
     group by c.address_key
  ), affected as (
    select c.identity_key from private.customers_read c join addr on addr.a = c.address_key
    union
    select k from unnest(v_keys) k
  ), target as (
    select c.identity_key,
           cnt.n as shared_address_count,
           private.customer_classification(
             c.suspect_orders, c.cod_orders, c.total_orders, c.distinct_names, cnt.n) as classification
      from affected a
      join private.customers_read c on c.identity_key = a.identity_key
      left join cnt on cnt.address_key = c.address_key
  )
  update private.customers_read c
     set shared_address_count = t.shared_address_count,
         classification = t.classification
    from target t
   where t.identity_key = c.identity_key
     and (c.shared_address_count, c.classification) is distinct from (t.shared_address_count, t.classification);

  return cardinality(v_keys);
end;
$$;
revoke all on function private.refresh_customers_read() from public, anon, authenticated;

-- Full: rebuild every customer from the facts table (≈7 s, never touches
-- orders_read). Weekly drift insurance, and the manual reset button.
create or replace function private.rebuild_customers_read()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  -- Waits for an in-flight incremental run rather than racing it.
  perform pg_advisory_xact_lock(hashtext('private.refresh_customers_read'));

  delete from private.customers_read_dirty;
  delete from private.customers_read;
  insert into private.customers_read
  select x.*, private.customer_classification(
           x.suspect_orders, x.cod_orders, x.total_orders, x.distinct_names, x.shared_address_count)
    from (select c.*,
                 case when c.address_key is not null then count(*) over (partition by c.address_key) end
                   as shared_address_count
            from private.customers_read_compute(null) c) x;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function private.rebuild_customers_read() from public, anon, authenticated;

------------------------------------------------------------------------
-- 3. Swap
------------------------------------------------------------------------
drop materialized view private.customers_read;
alter table private.customers_read_next rename to customers_read;
alter index private.customers_read_next_pkey rename to customers_read_identity_key_uidx;
alter index private.customers_read_next_address_key_idx rename to customers_read_address_key_idx;
alter index private.customers_read_next_classification_idx rename to customers_read_classification_idx;
alter index private.customers_read_next_last_order_idx rename to customers_read_last_order_idx;

-- Re-derive everything once with the deterministic tie-break, which also
-- absorbs whatever the triggers queued while the shadow was being verified.
select private.rebuild_customers_read();
analyze private.customers_read;

------------------------------------------------------------------------
-- 4. Schedule
------------------------------------------------------------------------
-- Same job name and slot; now a few hundred identities instead of all of them.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'customers-read-refresh'),
  command := 'select private.refresh_customers_read()',
  active := true
);

select cron.schedule(
  'customers-read-rebuild-weekly',
  '45 18 * * 0',
  $$set statement_timeout = '10min'; select private.rebuild_customers_read()$$
);
