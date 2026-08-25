-- Applied 2026-08-25 via MCP apply_migration; filed under the recorded version 20260825061910.
-- customer_economics_v1 — Phase 5 of the operational-workspaces program: Profit customer economics.
--
-- Metric version econ-v1. Everything here is provisional under owner
-- decisions D3–D7 (program plan §7) and says so in its payload:
--   D3 spend  = Meta spend from ad_daily_facts (source <> legacy_seed,
--               banned accounts included and reported) net of the dated WHT rule
--   D4 paid   = provider purchase attribution share (purchases ÷ accepted orders, capped at 1)
--   D5 day-0  = COGS + delivery + COD fee + expected return leg (monthly RTS rate ×
--               delivery cost) only where carrier evidence exists for that month
--   D6 horizons = 0 / 30 / 60 / 90 / 180 / 365 days; a horizon is published only
--               when every customer of the cohort month has reached it
--   D7 FX     = none; contribution is MYR-only, SG rows (SGD revenue, MYR costs)
--               are marked currency_mixed and contribution-based metrics are suppressed
--
-- 1. private.customer_order_economics — one row per accepted order of an
--    identity in the acquisition cohort, with the same cost lines the
--    commerce spine uses (unit cost × base units, delivery by zone, COD fee).
-- 2. private.acquisition_spend_month — Meta spend per month × brand × market
--    net of WHT, with purchases and banned share.
-- 3. private.customer_cohort_economics — cohort month × acquisition brand ×
--    market × currency × horizon: customers, orders, revenue, cost lines,
--    contribution, repeat customers, maturity.
-- 4. private.econ_rebuild(p_months) — rebuilds 1–3; wired into the nightly job.
-- 5. public.live_brand_customer_economics(p_brand_id, p_countries, p_months) —
--    nCAC (accepted / delivered / paid denominators), platform CPA labelled
--    provider attribution, first-order contribution and FOP, LTV per customer
--    by horizon, LTV:nCAC, payback, coverage and suppression reasons per cohort.
--
-- Additive only. No table is dropped and no applied migration is edited.

------------------------------------------------------------------------
-- Tables
------------------------------------------------------------------------
create table if not exists private.customer_order_economics (
  order_read_id        bigint primary key,
  identity_key         text not null,
  brand_id             bigint,
  integration_id       bigint not null,
  market               text not null,
  currency_code        text not null,
  placed_at            timestamptz not null,
  placed_month         date not null,
  delivered_at         timestamptz,
  is_first_order       boolean not null,
  first_accepted_at    timestamptz not null,
  revenue              numeric not null,
  base_units           numeric not null,
  unmapped_lines       numeric not null,
  is_cod               boolean not null,
  is_east              boolean not null,
  cogs_myr             numeric not null,
  delivery_myr         numeric not null,
  cod_myr              numeric not null,
  -- Null when the month/market has no carrier evidence (never guessed).
  returns_expected_myr numeric,
  refreshed_at         timestamptz not null
);
create index if not exists coe_identity_idx on private.customer_order_economics (identity_key, placed_at);
create index if not exists coe_month_scope_idx on private.customer_order_economics (placed_month, brand_id, market);

create table if not exists private.acquisition_spend_month (
  month        date not null,
  brand_key    bigint not null,          -- 0 = unattributed (no brand_slug on the fact)
  brand_id     bigint,
  market       text not null,
  spend_gross  numeric not null,
  wht_myr      numeric not null,
  spend_net    numeric not null,
  banned_spend numeric not null,
  purchases    bigint not null,
  fact_rows    integer not null,
  refreshed_at timestamptz not null,
  primary key (month, brand_key, market)
);

create table if not exists private.customer_cohort_economics (
  cohort_month         date not null,
  brand_key            bigint not null,
  brand_id             bigint,
  market               text not null,
  currency_code        text not null,
  horizon_days         integer not null,
  customers_accepted   integer not null,
  customers_delivered  integer not null,
  matured              boolean not null,
  orders               integer not null,
  revenue              numeric not null,
  base_units           numeric not null,
  unmapped_lines       numeric not null,
  cogs_myr             numeric not null,
  delivery_myr         numeric not null,
  cod_myr              numeric not null,
  returns_expected_myr numeric,
  returns_evidence     boolean not null,
  repeat_customers     integer not null,
  refreshed_at         timestamptz not null,
  primary key (cohort_month, brand_key, market, currency_code, horizon_days)
);

comment on table private.customer_order_economics is 'econ-v1: per accepted order of a cohort identity — revenue in order currency, cost lines in MYR under the dated contribution rule; returns_expected_myr only with carrier evidence for that month.';
comment on table private.customer_cohort_economics is 'econ-v1: acquisition cohort month × brand × market × currency × horizon. A horizon row is matured only when the whole cohort month has reached it.';

------------------------------------------------------------------------
-- Rebuild steps
------------------------------------------------------------------------
create or replace function private.econ_rebuild_orders(p_from_month date)
returns jsonb
language plpgsql security definer set search_path = '' set jit = off set max_parallel_workers_per_gather = 0 set work_mem = '16MB' set statement_timeout = '8min'
as $$
declare
  v_month date := date_trunc('month', p_from_month)::date;
  v_end date := date_trunc('month', now() at time zone 'Asia/Kuala_Lumpur')::date;
  v_rows bigint := 0;
  v_n bigint;
begin
  delete from private.customer_order_economics where placed_month >= v_month;
  while v_month <= v_end loop
    with rules as (
      select r.* from public.contribution_cost_rules r
    ),
    base as (
      select q.order_read_id, q.identity_key, q.brand_id, q.integration_id,
             coalesce(ic.config->>'country_code', '—') as market,
             q.currency_code, q.placed_at,
             (q.placed_at at time zone 'Asia/Kuala_Lumpur')::date as placed_day,
             q.delivered_at, q.total as revenue,
             (q.order_read_id = c.first_accepted_order_id) as is_first_order,
             c.first_accepted_at,
             (q.payment_method = 'cod') as is_cod,
             (coalesce(ic.config->>'country_code', '') = 'MY'
               and substring(o.customer->>'postcode' from 1 for 2) in ('87','88','89','90','91','93','94','95','96','97','98')) as is_east,
             o.items
      from private.customer_qualifying_orders q
      join private.customer_acquisition_cohort c on c.identity_key = q.identity_key
      join public.orders_read o on o.id = q.order_read_id
      join public.integration_connections ic on ic.id = q.integration_id
      where q.qualifies_acceptance
        and q.placed_at >= (v_month::timestamp at time zone 'Asia/Kuala_Lumpur')
        and q.placed_at < ((v_month + interval '1 month')::timestamp at time zone 'Asia/Kuala_Lumpur')
    ),
    units as (
      select b.order_read_id,
             coalesce(sum(it.qty * coalesce(v.units_per_pack, 1)), 0) as base_units,
             coalesce(sum(it.qty) filter (where va.variant_id is null), 0) as unmapped_lines
      from base b
      cross join lateral (
        select e->>'sku' as sku, coalesce(nullif(e->>'quantity', '')::numeric, 1) as qty
        from jsonb_array_elements(coalesce(b.items, '[]'::jsonb)) e
      ) it
      left join public.variant_aliases va on va.integration_id = b.integration_id and va.alias = it.sku
      left join public.product_variants v on v.id = va.variant_id
      group by b.order_read_id
    ),
    -- Monthly RTS rate for MY: parcels returned in the month ÷ accepted MY orders in the month,
    -- only when the carrier feed has any event in that month.
    rts as (
      select
        (select count(*)::numeric from public.nv_shipments s
          where s.rts_at >= (v_month::timestamp at time zone 'Asia/Kuala_Lumpur')
            and s.rts_at < ((v_month + interval '1 month')::timestamp at time zone 'Asia/Kuala_Lumpur')) as parcels,
        (select count(*)::numeric from base where market = 'MY') as my_orders,
        exists (select 1 from public.nv_events e
          where e.event_at >= (v_month::timestamp at time zone 'Asia/Kuala_Lumpur')
            and e.event_at < ((v_month + interval '1 month')::timestamp at time zone 'Asia/Kuala_Lumpur')) as evidence
    )
    insert into private.customer_order_economics
      (order_read_id, identity_key, brand_id, integration_id, market, currency_code, placed_at, placed_month,
       delivered_at, is_first_order, first_accepted_at, revenue, base_units, unmapped_lines, is_cod, is_east,
       cogs_myr, delivery_myr, cod_myr, returns_expected_myr, refreshed_at)
    select b.order_read_id, b.identity_key, b.brand_id, b.integration_id, b.market, b.currency_code, b.placed_at, v_month,
           b.delivered_at, b.is_first_order, b.first_accepted_at, b.revenue,
           coalesce(u.base_units, 0), coalesce(u.unmapped_lines, 0), b.is_cod, b.is_east,
           coalesce(u.base_units, 0) * r.unit_cost_myr,
           case when b.market = 'SG' then r.delivery_sg_myr when b.is_east then r.delivery_my_east else r.delivery_my_west end,
           case when b.is_cod then r.cod_fee else 0 end,
           case when b.market = 'MY' and rts.evidence and rts.my_orders > 0
                then (rts.parcels / rts.my_orders) * (case when b.is_east then r.delivery_my_east else r.delivery_my_west end)
                else null end,
           now()
    from base b
    left join units u on u.order_read_id = b.order_read_id
    cross join rts
    left join lateral (
      select * from rules r where r.effective_from <= b.placed_day order by r.effective_from desc limit 1
    ) r on true
    where r.unit_cost_myr is not null;
    get diagnostics v_n = row_count;
    v_rows := v_rows + v_n;
    v_month := (v_month + interval '1 month')::date;
  end loop;
  analyze private.customer_order_economics;
  return jsonb_build_object('rows', v_rows, 'from_month', date_trunc('month', p_from_month)::date);
end;
$$;

create or replace function private.econ_rebuild_spend(p_from_month date)
returns jsonb
language plpgsql security definer set search_path = '' set jit = off set statement_timeout = '3min'
as $$
declare v_from date := date_trunc('month', p_from_month)::date; v_n bigint;
begin
  delete from private.acquisition_spend_month where month >= v_from;
  insert into private.acquisition_spend_month
    (month, brand_key, brand_id, market, spend_gross, wht_myr, spend_net, banned_spend, purchases, fact_rows, refreshed_at)
  select date_trunc('month', f.date)::date,
         coalesce(b.id, 0), b.id, coalesce(f.market, '—'),
         sum(f.spend),
         sum(f.spend * coalesce(r.wht_rate, 0)),
         sum(f.spend) - sum(f.spend * coalesce(r.wht_rate, 0)),
         coalesce(sum(f.spend) filter (where f.is_banned_account), 0),
         coalesce(sum(f.purchases), 0),
         count(*),
         now()
  from public.ad_daily_facts f
  left join public.brands b on b.slug = f.brand_slug
  left join lateral (
    select wht_rate from public.contribution_cost_rules cr where cr.effective_from <= f.date order by cr.effective_from desc limit 1
  ) r on true
  where f.platform = 'meta' and f.source <> 'legacy_seed' and f.date >= v_from
  group by 1, 2, 3, 4;
  get diagnostics v_n = row_count;
  return jsonb_build_object('rows', v_n, 'from_month', v_from);
end;
$$;

create or replace function private.econ_rebuild_cohorts(p_from_month date)
returns jsonb
language plpgsql security definer set search_path = '' set jit = off set max_parallel_workers_per_gather = 0 set work_mem = '16MB' set statement_timeout = '5min'
as $$
declare v_from date := date_trunc('month', p_from_month)::date; v_n bigint; v_now timestamptz := now();
begin
  delete from private.customer_cohort_economics where cohort_month >= v_from;
  insert into private.customer_cohort_economics
    (cohort_month, brand_key, brand_id, market, currency_code, horizon_days, customers_accepted, customers_delivered, matured,
     orders, revenue, base_units, unmapped_lines, cogs_myr, delivery_myr, cod_myr, returns_expected_myr, returns_evidence,
     repeat_customers, refreshed_at)
  with members as (
    select c.identity_key, c.accepted_cohort_month as cohort_month, c.first_accepted_at,
           coalesce(c.acquisition_brand_id, 0) as brand_key, c.acquisition_brand_id as brand_id,
           coalesce(ic.config->>'country_code', '—') as market,
           coalesce(c.acquisition_currency, 'MYR') as currency_code,
           (c.first_delivered_at is not null) as delivered
    from private.customer_acquisition_cohort c
    left join public.integration_connections ic on ic.id = c.acquisition_integration_id
    where c.accepted_cohort_month >= v_from
  ),
  horizons as (select unnest(array[0, 30, 60, 90, 180, 365]) as h),
  per_customer as (
    select m.identity_key, m.cohort_month, m.brand_key, m.brand_id, m.market, m.currency_code, m.delivered, hz.h,
           count(e.order_read_id) as orders,
           coalesce(sum(e.revenue), 0) as revenue,
           coalesce(sum(e.base_units), 0) as base_units,
           coalesce(sum(e.unmapped_lines), 0) as unmapped_lines,
           coalesce(sum(e.cogs_myr), 0) as cogs_myr,
           coalesce(sum(e.delivery_myr), 0) as delivery_myr,
           coalesce(sum(e.cod_myr), 0) as cod_myr,
           sum(e.returns_expected_myr) as returns_expected_myr,
           bool_and(e.returns_expected_myr is not null) filter (where e.order_read_id is not null) as returns_evidence
    from members m
    cross join horizons hz
    left join private.customer_order_economics e
      on e.identity_key = m.identity_key
     and (case when hz.h = 0 then e.is_first_order else e.placed_at <= m.first_accepted_at + make_interval(days => hz.h) end)
    group by 1, 2, 3, 4, 5, 6, 7, 8
  )
  select p.cohort_month, p.brand_key, p.brand_id, p.market, p.currency_code, p.h,
         count(*)::integer,
         count(*) filter (where p.delivered)::integer,
         ((p.cohort_month + interval '1 month')::timestamp at time zone 'Asia/Kuala_Lumpur') + make_interval(days => p.h) <= v_now,
         sum(p.orders)::integer, sum(p.revenue), sum(p.base_units), sum(p.unmapped_lines),
         sum(p.cogs_myr), sum(p.delivery_myr), sum(p.cod_myr),
         case when bool_and(coalesce(p.returns_evidence, true)) then sum(p.returns_expected_myr) else null end,
         bool_and(coalesce(p.returns_evidence, true)),
         count(*) filter (where p.orders >= 2)::integer,
         v_now
  from per_customer p
  group by 1, 2, 3, 4, 5, 6;
  get diagnostics v_n = row_count;
  analyze private.customer_cohort_economics;
  return jsonb_build_object('rows', v_n, 'from_month', v_from);
end;
$$;

create or replace function private.econ_rebuild(p_months integer default 15)
returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout = '15min'
as $$
declare v_from date := (date_trunc('month', now() at time zone 'Asia/Kuala_Lumpur') - make_interval(months => greatest(p_months, 1) - 1))::date;
begin
  return jsonb_build_object(
    'orders', private.econ_rebuild_orders(v_from),
    'spend', private.econ_rebuild_spend(v_from),
    'cohorts', private.econ_rebuild_cohorts(v_from));
end;
$$;

-- Nightly job: as before, plus the economics rebuild after the current-state step.
create or replace function private.refresh_customer_lifecycle_daily()
returns jsonb language plpgsql security definer set search_path = '' set jit = off set max_parallel_workers_per_gather = 0 set work_mem = '16MB' set statement_timeout = '20min'
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
  perform private.econ_rebuild(15);
  perform private.lifecycle_rebuild_movement(null, 'month');
  perform private.lifecycle_rebuild_movement(null, 'week');
  return private.lifecycle_finish(null, 'incremental', v_rows);
end;
$$;

------------------------------------------------------------------------
-- Read: brand customer economics
------------------------------------------------------------------------
create or replace function public.live_brand_customer_economics(
  p_brand_id bigint default null, p_countries text[] default null, p_months integer default 12)
returns jsonb
language plpgsql stable security definer set search_path = '' set jit = off set work_mem = '16MB' set statement_timeout = '20s'
as $$
declare
  v_ws bigint := (select min(id) from public.workspaces);
  v_from date := (date_trunc('month', now() at time zone 'Asia/Kuala_Lumpur') - make_interval(months => least(greatest(p_months, 1), 15) - 1))::date;
  v_refreshed timestamptz := (select max(refreshed_at) from private.customer_cohort_economics);
  v_rules record;
  v_cohorts jsonb;
begin
  if not private.is_workspace_member(v_ws) then raise exception 'Not a workspace member'; end if;
  if v_refreshed is null then
    return jsonb_build_object('status', 'unavailable', 'reason', 'not_computed', 'metric_version', 'econ-v1');
  end if;
  select * into v_rules from public.contribution_cost_rules order by effective_from desc limit 1;

  with scope as (
    select * from private.customer_cohort_economics ce
    where ce.cohort_month >= v_from
      and (p_brand_id is null or ce.brand_id = p_brand_id)
      and (p_countries is null or ce.market = any (p_countries))
  ),
  spend as (
    select s.month, sum(s.spend_gross) as spend_gross, sum(s.wht_myr) as wht_myr, sum(s.spend_net) as spend_net,
           sum(s.banned_spend) as banned_spend, sum(s.purchases) as purchases, sum(s.fact_rows) as fact_rows
    from private.acquisition_spend_month s
    where s.month >= v_from
      and (p_brand_id is null or s.brand_id = p_brand_id)
      and (p_countries is null or s.market = any (p_countries))
    group by s.month
  ),
  -- Accepted orders of the scope in the month (paid-share denominator) and identity coverage.
  month_orders as (
    select date_trunc('month', q.placed_at at time zone 'Asia/Kuala_Lumpur')::date as month,
           count(*) as orders,
           count(*) filter (where q.identity_key is not null) as orders_with_identity
    from private.customer_qualifying_orders q
    left join public.integration_connections ic on ic.id = q.integration_id
    where q.qualifies_acceptance and q.placed_at >= (v_from::timestamp at time zone 'Asia/Kuala_Lumpur')
      and (p_brand_id is null or q.brand_id = p_brand_id)
      and (p_countries is null or coalesce(ic.config->>'country_code', '—') = any (p_countries))
    group by 1
  ),
  per_month_h as (
    select sc.cohort_month, sc.horizon_days,
           sum(sc.customers_accepted) as customers_accepted,
           sum(sc.customers_delivered) as customers_delivered,
           bool_and(sc.matured) as matured,
           sum(sc.orders) as orders, sum(sc.revenue) as revenue,
           sum(sc.base_units) as base_units, sum(sc.unmapped_lines) as unmapped_lines,
           sum(sc.cogs_myr) as cogs_myr, sum(sc.delivery_myr) as delivery_myr, sum(sc.cod_myr) as cod_myr,
           case when bool_and(sc.returns_evidence) then sum(sc.returns_expected_myr) else null end as returns_expected_myr,
           bool_and(sc.returns_evidence) as returns_evidence,
           sum(sc.repeat_customers) as repeat_customers,
           count(distinct sc.currency_code) as currencies,
           bool_and(sc.currency_code = 'MYR') as myr_only
    from scope sc
    group by 1, 2
  ),
  months as (
    select distinct cohort_month from per_month_h
  ),
  built as (
    select m.cohort_month,
           h0.customers_accepted, h0.customers_delivered,
           sp.spend_gross, sp.wht_myr, sp.spend_net, sp.banned_spend, sp.purchases, sp.fact_rows,
           mo.orders as month_orders, mo.orders_with_identity,
           case when mo.orders > 0 then least(1, coalesce(sp.purchases, 0)::numeric / mo.orders) else null end as paid_share,
           h0.revenue as fo_revenue, h0.cogs_myr as fo_cogs, h0.delivery_myr as fo_delivery, h0.cod_myr as fo_cod,
           h0.returns_expected_myr as fo_returns, h0.returns_evidence as fo_returns_evidence,
           h0.myr_only, h0.currencies,
           case when h0.myr_only then h0.revenue - h0.cogs_myr - h0.delivery_myr - h0.cod_myr - coalesce(h0.returns_expected_myr, 0) else null end as fo_contribution,
           -- Cost coverage over the whole observed life (365 row includes every order)
           (select case when (base_units + unmapped_lines) > 0 then base_units / (base_units + unmapped_lines) else null end
              from per_month_h x where x.cohort_month = m.cohort_month and x.horizon_days = 365) as cost_coverage,
           case when mo.orders > 0 then mo.orders_with_identity::numeric / mo.orders else null end as identity_coverage
    from months m
    join per_month_h h0 on h0.cohort_month = m.cohort_month and h0.horizon_days = 0
    left join spend sp on sp.month = m.cohort_month
    left join month_orders mo on mo.month = m.cohort_month
  ),
  rows_out as (
    select b.*,
           case when b.customers_accepted > 0 and b.spend_net is not null then b.spend_net / b.customers_accepted end as ncac_accepted,
           case when b.customers_delivered > 0 and b.spend_net is not null then b.spend_net / b.customers_delivered end as ncac_delivered,
           case when b.customers_accepted > 0 and b.spend_net is not null and b.paid_share > 0 then b.spend_net / (b.customers_accepted * b.paid_share) end as ncac_paid,
           case when b.purchases > 0 and b.spend_net is not null then b.spend_net / b.purchases end as cpa_platform,
           case when b.customers_accepted > 0 and b.fo_contribution is not null then b.fo_contribution / b.customers_accepted end as fo_contribution_per_customer
    from built b
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'cohort_month', r.cohort_month,
    'customers_accepted', r.customers_accepted,
    'customers_delivered', r.customers_delivered,
    'month_orders', r.month_orders,
    'spend', case when r.spend_net is null then null else jsonb_build_object(
      'gross', round(r.spend_gross, 2), 'wht', round(r.wht_myr, 2), 'net', round(r.spend_net, 2),
      'banned', round(r.banned_spend, 2), 'purchases', r.purchases, 'fact_rows', r.fact_rows) end,
    'paid_share', case when r.paid_share is null then null else round(r.paid_share, 4) end,
    'ncac', jsonb_build_object(
      'accepted', case when r.ncac_accepted is null then null else round(r.ncac_accepted, 2) end,
      'delivered', case when r.ncac_delivered is null then null else round(r.ncac_delivered, 2) end,
      'paid', case when r.ncac_paid is null then null else round(r.ncac_paid, 2) end,
      'cpa_platform', case when r.cpa_platform is null then null else round(r.cpa_platform, 2) end),
    'first_order', jsonb_build_object(
      'revenue', round(r.fo_revenue, 2), 'cogs', round(r.fo_cogs, 2), 'delivery', round(r.fo_delivery, 2), 'cod', round(r.fo_cod, 2),
      'returns_expected', case when r.fo_returns is null then null else round(r.fo_returns, 2) end,
      'contribution', case when r.fo_contribution is null then null else round(r.fo_contribution, 2) end,
      'contribution_per_customer', case when r.fo_contribution_per_customer is null then null else round(r.fo_contribution_per_customer, 2) end,
      'fop', case when r.fo_contribution_per_customer is null or r.ncac_accepted is null then null else round(r.fo_contribution_per_customer - r.ncac_accepted, 2) end),
    'horizons', (
      select jsonb_agg(jsonb_build_object(
        'days', h.horizon_days,
        'matured', h.matured,
        'orders', h.orders,
        'revenue', round(h.revenue, 2),
        'contribution', case when h.myr_only and h.matured then round(h.revenue - h.cogs_myr - h.delivery_myr - h.cod_myr - coalesce(h.returns_expected_myr, 0), 2) else null end,
        'ltv_per_customer', case when h.myr_only and h.matured and h.customers_accepted > 0
          then round((h.revenue - h.cogs_myr - h.delivery_myr - h.cod_myr - coalesce(h.returns_expected_myr, 0)) / h.customers_accepted, 2) else null end,
        'ltv_ncac', case when h.myr_only and h.matured and h.customers_accepted > 0 and r.ncac_accepted > 0
          then round(((h.revenue - h.cogs_myr - h.delivery_myr - h.cod_myr - coalesce(h.returns_expected_myr, 0)) / h.customers_accepted) / r.ncac_accepted, 3) else null end,
        'repeat_rate', case when h.customers_accepted > 0 then round(h.repeat_customers::numeric / h.customers_accepted, 4) else null end,
        'returns_evidence', h.returns_evidence
      ) order by h.horizon_days)
      from per_month_h h where h.cohort_month = r.cohort_month),
    'payback', (
      select case
        when r.ncac_accepted is null or not r.myr_only then jsonb_build_object('status', 'unavailable')
        when exists (select 1 from per_month_h h where h.cohort_month = r.cohort_month and h.matured and h.customers_accepted > 0
                     and (h.revenue - h.cogs_myr - h.delivery_myr - h.cod_myr - coalesce(h.returns_expected_myr, 0)) / h.customers_accepted >= r.ncac_accepted)
          then jsonb_build_object('status', 'reached', 'horizon_days', (
            select min(h.horizon_days) from per_month_h h where h.cohort_month = r.cohort_month and h.matured and h.customers_accepted > 0
              and (h.revenue - h.cogs_myr - h.delivery_myr - h.cod_myr - coalesce(h.returns_expected_myr, 0)) / h.customers_accepted >= r.ncac_accepted))
        when exists (select 1 from per_month_h h where h.cohort_month = r.cohort_month and not h.matured)
          then jsonb_build_object('status', 'immature', 'matured_through_days', (select coalesce(max(h.horizon_days), 0) from per_month_h h where h.cohort_month = r.cohort_month and h.matured))
        else jsonb_build_object('status', 'not_reached')
      end),
    'coverage', jsonb_build_object(
      'identity', case when r.identity_coverage is null then null else round(r.identity_coverage, 4) end,
      'cost', case when r.cost_coverage is null then null else round(r.cost_coverage, 4) end,
      'spend', r.spend_net is not null,
      'currency_mixed', not r.myr_only,
      'currencies', r.currencies,
      'returns_evidence', r.fo_returns_evidence),
    'suppressed', (
      select coalesce(jsonb_agg(x), '[]'::jsonb) from (
        select 'no_spend_data' as x where r.spend_net is null
        union all select 'currency_mixed' where not r.myr_only
        union all select 'cost_coverage_below_90' where coalesce(r.cost_coverage, 0) < 0.9
        union all select 'identity_coverage_below_95' where coalesce(r.identity_coverage, 0) < 0.95
        union all select 'no_return_evidence' where not r.fo_returns_evidence
      ) s)
  ) order by r.cohort_month desc), '[]'::jsonb)
  into v_cohorts
  from rows_out r;

  return jsonb_build_object(
    'status', 'ok',
    'metric_version', 'econ-v1',
    'scope', jsonb_build_object('brand_id', p_brand_id, 'countries', p_countries, 'months', least(greatest(p_months, 1), 15), 'from_month', v_from),
    'computed_at', v_refreshed,
    'horizons', jsonb_build_array(0, 30, 60, 90, 180, 365),
    'rules', jsonb_build_object('effective_from', v_rules.effective_from, 'unit_cost_myr', v_rules.unit_cost_myr,
      'delivery_my_west', v_rules.delivery_my_west, 'delivery_my_east', v_rules.delivery_my_east,
      'delivery_sg_myr', v_rules.delivery_sg_myr, 'cod_fee', v_rules.cod_fee, 'wht_rate', v_rules.wht_rate),
    'definitions', jsonb_build_object(
      'ncac_accepted', 'Meta spend net of dated WHT in the cohort month ÷ customers whose first accepted order fell in the month (D3, provisional)',
      'ncac_delivered', 'Same spend ÷ customers of the month with a delivered first order',
      'ncac_paid', 'Spend ÷ (accepted new customers × paid share); paid share = provider-reported purchases ÷ accepted orders, capped at 1 (D4, provisional, non-incremental)',
      'cpa_platform', 'Spend ÷ provider-reported purchases — provider attribution, not new customers',
      'first_order_contribution', 'First-order revenue − COGS − delivery − COD fee − expected return leg (monthly RTS rate × delivery, only with carrier evidence) (D5, provisional). Fixed costs excluded.',
      'fop', 'First-order contribution per customer − blended nCAC (accepted)',
      'ltv_per_customer', 'Cumulative contribution of the cohort at the horizon ÷ accepted customers; published only when every customer has reached the horizon (D6)',
      'ltv_ncac', 'LTV per customer ÷ blended nCAC (accepted); a ratio, not a currency',
      'payback', 'Earliest matured horizon where LTV per customer ≥ nCAC; not_reached when every matured horizon is below; immature while horizons are still open',
      'currency', 'No FX (D7). Contribution-based metrics need MYR-only scope: SG revenue is SGD while cost rules are MYR, so SG rows are currency_mixed.',
      'suppression', 'Cells render a reason instead of a number when spend is missing, currency is mixed, SKU cost coverage < 90 %, identity coverage < 95 %, or return evidence is absent.'),
    'decisions', jsonb_build_array('D3', 'D4', 'D5', 'D6', 'D7'),
    'cohorts', v_cohorts);
end;
$$;

revoke all on function public.live_brand_customer_economics(bigint, text[], integer) from public, anon;
grant execute on function public.live_brand_customer_economics(bigint, text[], integer) to authenticated, service_role;
revoke all on function private.econ_rebuild(integer) from public, anon, authenticated;
revoke all on function private.econ_rebuild_orders(date) from public, anon, authenticated;
revoke all on function private.econ_rebuild_spend(date) from public, anon, authenticated;
revoke all on function private.econ_rebuild_cohorts(date) from public, anon, authenticated;

-- Initial build: 4 months here (fits the migration tool timeout); the nightly job and a
-- one-off `select private.econ_rebuild(15)` after apply extend it to 15 months.
select private.econ_rebuild(4);
