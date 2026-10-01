-- customers_read: incremental maintenance (phase A — additive, nothing swapped yet)
--
-- `refresh materialized view concurrently private.customers_read` ran every
-- 15 min and re-derived all ~178k customers from all ~305k orders, detoasting
-- ~1.2 GB of orders_read.raw and running a dozen regexes per order each time.
-- It averaged ~310 s per run and accounted for ~97% of all shared-block reads
-- in pg_stat_statements, which is what drained the project's Disk IO budget.
-- Roughly 250 orders change per 15 min.
--
-- This migration adds:
--   * private.customer_order_facts — one narrow row per order holding exactly
--     the per-order values customers_read aggregates (identity key, address key,
--     suspect / COD flags, …). Computed once per order write, never re-derived.
--   * statement-level triggers on orders_read and order_corrections that keep
--     the facts current and queue the touched identity keys.
--   * private.customers_read_dirty — the queue of identity keys to recompute.
--   * private.customers_read_compute(keys) — the matview's aggregation, run
--     over the facts table for a set of identities.
--   * private.customers_read_next — a shadow of the matview built from the
--     facts, to diff against the live matview before anything is swapped.
-- Phase B swaps the matview for that table and adds the incremental refresh.

set local statement_timeout = '20min';

------------------------------------------------------------------------
-- 1. Per-order facts
------------------------------------------------------------------------
create table private.customer_order_facts (
  order_read_id     bigint primary key,
  workspace_id      bigint,
  identity_key      text not null,
  name              text,
  phone             text,
  email             text,
  city              text,
  country           text,
  brand_id          bigint,
  currency_code     text,
  total             numeric,
  source_status     text,
  placed_at         timestamptz,
  is_cod            boolean,
  suspect           boolean,
  order_address_key text
);
create index customer_order_facts_identity_idx on private.customer_order_facts (identity_key);
revoke all on private.customer_order_facts from public, anon, authenticated;

-- The matview's `base` CTE, verbatim, plus the order id. Filtering on
-- order_read_id pushes down to the orders_read primary key.
create view private.customer_order_facts_src as
select o.id as order_read_id,
       o.workspace_id,
       public.identity_key(o.customer, o.raw) as identity_key,
       nullif(o.customer->>'name', '') as name,
       nullif(o.customer->>'phone', '') as phone,
       nullif(lower(o.customer->>'email'), '') as email,
       nullif(o.customer->>'city', '') as city,
       nullif(o.customer->>'country', '') as country,
       o.brand_id,
       o.currency_code,
       o.total::numeric as total,
       o.source_status,
       o.placed_at,
       (o.raw->>'payment_method') = 'cod' as is_cod,
       (   coalesce(o.customer->>'name', '') ~* '\mtest(ing|er)?\M'
        or coalesce(o.raw->'billing'->>'address_1', '') ~* '\mtest(ing|er)?\M'
        or (nullif(trim(coalesce(o.customer->>'name', '')), '') is not null
            and lower(trim(o.customer->>'name')) = lower(trim(coalesce(o.raw->'billing'->>'address_1', ''))))
        or coalesce(o.customer->>'name', '') ~* 'asdf|qwer|zxcv|sdfg|wert|xcvb'
        or coalesce(o.raw->'billing'->>'address_1', '') ~* 'asdf|qwer|zxcv|sdfg|wert|xcvb'
        or coalesce(o.customer->>'name', '') ~* '([a-z])\1\1\1'
        or coalesce(o.customer->>'email', '') ~* '(^test@|@(test|example|mailinator)\.)'
        or regexp_replace(coalesce(o.customer->>'phone', ''), '[^0-9]', '', 'g') ~ '(\d)\1{6,}'
       ) as suspect,
       case when an.addr_norm is not null then 'a:' || md5(an.addr_norm) end as order_address_key
  from public.orders_read o
  left join public.order_corrections oc
         on oc.order_read_id = o.id and oc.status in ('staged', 'applied')
  cross join lateral (
    select public.norm_address(
      coalesce(oc.corrected->>'address_1', nullif(o.raw->'shipping'->>'address_1', ''), o.raw->'billing'->>'address_1'),
      coalesce(nullif(o.raw->'shipping'->>'address_2', ''), o.raw->'billing'->>'address_2'),
      coalesce(oc.corrected->>'city', nullif(o.raw->'shipping'->>'city', ''), o.customer->>'city'),
      coalesce(oc.corrected->>'postcode', nullif(o.raw->'shipping'->>'postcode', ''), o.customer->>'postcode')
    ) as addr_norm
  ) an
 where o.customer is not null
   and public.identity_key(o.customer, o.raw) is not null;
revoke all on private.customer_order_facts_src from public, anon, authenticated;

------------------------------------------------------------------------
-- 2. Dirty-identity queue + fact maintenance
------------------------------------------------------------------------
create table private.customers_read_dirty (
  identity_key text primary key,
  queued_at    timestamptz not null default now()
);
revoke all on private.customers_read_dirty from public, anon, authenticated;

-- Re-derive the facts for a set of orders and queue every identity key they
-- belonged to before or belong to now.
create or replace function private.customer_order_facts_apply(p_ids bigint[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old text[];
  v_new text[];
begin
  if p_ids is null or cardinality(p_ids) = 0 then
    return;
  end if;

  with gone as (
    delete from private.customer_order_facts f
     where f.order_read_id = any(p_ids)
    returning f.identity_key
  )
  select array_agg(identity_key) into v_old from gone;

  with came as (
    insert into private.customer_order_facts
    select s.* from private.customer_order_facts_src s
     where s.order_read_id = any(p_ids)
    returning identity_key
  )
  select array_agg(identity_key) into v_new from came;

  insert into private.customers_read_dirty (identity_key)
  select distinct k
    from unnest(coalesce(v_old, '{}') || coalesce(v_new, '{}')) k
   order by k
  on conflict (identity_key) do nothing;
end;
$$;

revoke all on function private.customer_order_facts_apply(bigint[]) from public, anon, authenticated;

create or replace function private.orders_read_facts_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids bigint[];
begin
  if tg_op = 'INSERT' then
    select array_agg(n.id) into v_ids from new_rows n;
  elsif tg_op = 'DELETE' then
    select array_agg(o.id) into v_ids from old_rows o;
  else
    -- Woo sync re-upserts unchanged orders; only re-derive rows whose
    -- aggregated inputs actually moved.
    select array_agg(n.id) into v_ids
      from new_rows n
      join old_rows o on o.id = n.id
     where (n.customer, n.raw, n.total, n.source_status, n.placed_at,
            n.currency_code, n.brand_id, n.workspace_id)
           is distinct from
           (o.customer, o.raw, o.total, o.source_status, o.placed_at,
            o.currency_code, o.brand_id, o.workspace_id);
  end if;
  perform private.customer_order_facts_apply(v_ids);
  return null;
end;
$$;

create trigger orders_read_facts_ins
  after insert on public.orders_read
  referencing new table as new_rows
  for each statement execute function private.orders_read_facts_trg();
create trigger orders_read_facts_upd
  after update on public.orders_read
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.orders_read_facts_trg();
create trigger orders_read_facts_del
  after delete on public.orders_read
  referencing old table as old_rows
  for each statement execute function private.orders_read_facts_trg();

-- Address corrections feed order_address_key.
create or replace function private.order_corrections_facts_trg()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids bigint[];
begin
  if tg_op = 'INSERT' then
    select array_agg(distinct n.order_read_id) into v_ids from new_rows n;
  elsif tg_op = 'DELETE' then
    select array_agg(distinct o.order_read_id) into v_ids from old_rows o;
  else
    select array_agg(distinct x.id) into v_ids
      from (select order_read_id id from new_rows union select order_read_id from old_rows) x;
  end if;
  perform private.customer_order_facts_apply(v_ids);
  return null;
end;
$$;

create trigger order_corrections_facts_ins
  after insert on public.order_corrections
  referencing new table as new_rows
  for each statement execute function private.order_corrections_facts_trg();
create trigger order_corrections_facts_upd
  after update on public.order_corrections
  referencing old table as old_rows new table as new_rows
  for each statement execute function private.order_corrections_facts_trg();
create trigger order_corrections_facts_del
  after delete on public.order_corrections
  referencing old table as old_rows
  for each statement execute function private.order_corrections_facts_trg();

-- Backfill. The triggers above are already live in this transaction, so any
-- order write that commits after this one is captured as well.
insert into private.customer_order_facts
select * from private.customer_order_facts_src;
analyze private.customer_order_facts;

------------------------------------------------------------------------
-- 3. Aggregation (the matview's grouped/ccy_agg/addr_pick/final CTEs)
------------------------------------------------------------------------
create or replace function private.customer_classification(
  p_suspect_orders bigint, p_cod_orders bigint, p_total_orders bigint,
  p_distinct_names bigint, p_shared_address_count bigint)
returns text
language sql
immutable parallel safe
set search_path = ''
as $$
  select case
    when p_suspect_orders > 0 and p_cod_orders = p_total_orders and p_total_orders <= 3 then 'joy_buyer'
    when p_distinct_names >= 4 or p_total_orders >= 10 or coalesce(p_shared_address_count, 1) >= 3 then 'reseller'
    else 'regular'
  end
$$;

-- p_keys null = every identity.
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
     where p_keys is null or f.identity_key = any(p_keys)
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
           (array_agg(k.name    order by k.placed_at desc nulls last) filter (where k.name    is not null))[1] as display_name,
           (array_agg(k.phone   order by k.placed_at desc nulls last) filter (where k.phone   is not null))[1] as phone,
           (array_agg(k.email   order by k.placed_at desc nulls last) filter (where k.email   is not null))[1] as email,
           (array_agg(k.city    order by k.placed_at desc nulls last) filter (where k.city    is not null))[1] as city,
           (array_agg(k.country order by k.placed_at desc nulls last) filter (where k.country is not null))[1] as country,
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
     order by k.identity_key, k.placed_at desc nulls last
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
-- 4. Shadow table, built from the facts, for verification before the swap
------------------------------------------------------------------------
create table private.customers_read_next (
  identity_key         text primary key,
  workspace_id         bigint,
  display_name         text,
  phone                text,
  email                text,
  city                 text,
  country              text,
  brand_ids            bigint[],
  total_orders         bigint,
  recognized_orders    bigint,
  cod_orders           bigint,
  suspect_orders       bigint,
  cancelled_orders     bigint,
  distinct_names       bigint,
  first_order_at       timestamptz,
  last_order_at        timestamptz,
  address_key          text,
  revenue_by_currency  jsonb,
  revenue_total        numeric,
  shared_address_count bigint,
  classification       text
);
revoke all on private.customers_read_next from public, anon, authenticated;

insert into private.customers_read_next
select x.*, private.customer_classification(
         x.suspect_orders, x.cod_orders, x.total_orders, x.distinct_names, x.shared_address_count)
  from (select c.*,
               case when c.address_key is not null then count(*) over (partition by c.address_key) end
                 as shared_address_count
          from private.customers_read_compute(null) c) x;

create index customers_read_next_address_key_idx on private.customers_read_next (address_key) where address_key is not null;
create index customers_read_next_classification_idx on private.customers_read_next (classification);
create index customers_read_next_last_order_idx on private.customers_read_next (last_order_at desc nulls last);
analyze private.customers_read_next;
