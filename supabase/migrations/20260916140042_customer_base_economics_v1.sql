-- Customer Base: companion economics series for the movement chart toggle.
--
-- public.live_customer_base_economics(p_grain, p_from, p_to, p_brand_id,
-- p_integration_ids, p_policy_version) returns one row per period in the same
-- grain/alignment as live_customer_base_movement (month = 1st, week = Monday,
-- MYT business days) with:
--   • recognized revenue by currency and MYR-only revenue (commerce_daily),
--   • MYR variable-cost lines under the dated contribution rule per day — the
--     same arithmetic as live_contribution_range, including RTS parcels linked
--     exactly and unlinked ones allocated to MY brand rows by order share,
--   • warehouse ad spend (all platforms, source <> legacy_seed) with WHT on Meta
--     at the rule effective on the spend day; brand via dbt slug, market via
--     targeting geo — unattributed spend drops out once a brand/market is chosen,
--   • new_accepted / new_customers from the movement contract under the served
--     policy (null when no policy has a completed refresh).
-- The browser composes nCAC (spend net ÷ new accepted), blended ROAS
-- (revenue ÷ spend), CM2/CM3 with the shared Profit arithmetic, and withholds a
-- cell wherever a source is missing — never a fabricated zero.

create or replace function public.live_customer_base_economics(
  p_grain text default 'month',
  p_from date default null,
  p_to date default null,
  p_brand_id bigint default null,
  p_integration_ids bigint[] default null,
  p_policy_version integer default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set statement_timeout to '30s'
as $$
declare
  v_ws bigint := (select min(id) from public.workspaces);
  v_grain text := case when p_grain = 'week' then 'week' else 'month' end;
  v_step interval := case when p_grain = 'week' then interval '1 week' else interval '1 month' end;
  v_to date;
  v_from date;
  v_markets text[];
  v_brand_slug text;
  v_scope text;
  v_policy_version integer;
  v_out jsonb;
begin
  if not private.is_workspace_member(v_ws) then
    raise exception 'Not a workspace member';
  end if;

  v_to := coalesce(p_to, (now() at time zone 'Asia/Kuala_Lumpur')::date);
  v_from := coalesce(p_from, (v_to - interval '12 months')::date);
  if v_to < v_from then v_from := v_to; end if;
  if v_to - v_from > 800 then v_from := v_to - 800; end if;
  v_from := date_trunc(v_grain, v_from::timestamp)::date;

  if p_integration_ids is not null and cardinality(p_integration_ids) > 0 then
    select array_agg(distinct coalesce(ic.config->>'country_code', '—')) into v_markets
    from public.integration_connections ic where ic.id = any (p_integration_ids);
  end if;
  if p_brand_id is not null then
    select b.slug into v_brand_slug from public.brands b where b.id = p_brand_id;
  end if;

  v_scope := case
    when p_brand_id is null and (p_integration_ids is null or cardinality(p_integration_ids) = 0) then 'workspace'
    when p_brand_id is not null and (p_integration_ids is null or cardinality(p_integration_ids) = 0) then 'brand'
    when p_brand_id is null then 'integration'
    else 'brand_integration' end;

  -- Acquisition denominator for nCAC: the same policy the movement RPC serves,
  -- and only when that policy has a completed refresh. Otherwise nCAC is withheld.
  select p.version into v_policy_version from private.customer_lifecycle_policy p
  where (p_policy_version is null and p.status in ('provisional', 'approved')) or p.version = p_policy_version
  order by p.version desc limit 1;
  if v_policy_version is not null and not exists (
    select 1 from private.customer_lifecycle_refresh_log l
    where l.policy_version = v_policy_version and l.finished_at is not null and l.error is null
  ) then
    v_policy_version := null;
  end if;

  with periods as (
    select d::date as period_start, (d + v_step)::date as period_end
    from generate_series(v_from::timestamp, date_trunc(v_grain, v_to::timestamp), v_step) d
  ),
  first_rule as (
    select * from public.contribution_cost_rules order by effective_from asc limit 1
  ),
  last_rule as (
    select * from public.contribution_cost_rules where effective_from <= v_to order by effective_from desc limit 1
  ),
  -- Same daily cost arithmetic as live_contribution_range: each day under the
  -- rule effective that day, bucketed to the requested grain.
  daily as (
    select date_trunc(v_grain, cd.day::timestamp)::date as period_start,
           cd.integration_id, cd.brand_key, cd.currency_code, cd.orders, cd.cod_orders, cd.east_orders,
           cd.revenue, cd.base_units, cd.unmapped_lines, cd.refreshed_at,
           coalesce(ic.config->>'country_code', '—') as market,
           coalesce(dr.unit_cost_myr, fr.unit_cost_myr) as unit_cost_myr,
           coalesce(dr.delivery_my_west, fr.delivery_my_west) as delivery_my_west,
           coalesce(dr.delivery_my_east, fr.delivery_my_east) as delivery_my_east,
           coalesce(dr.delivery_sg_myr, fr.delivery_sg_myr) as delivery_sg_myr,
           coalesce(dr.cod_fee, fr.cod_fee) as cod_fee
    from private.commerce_daily cd
    join public.integration_connections ic on ic.id = cd.integration_id
    left join first_rule fr on true
    left join lateral (
      select r.* from public.contribution_cost_rules r
      where r.effective_from <= cd.day
      order by r.effective_from desc limit 1
    ) dr on true
    where cd.day >= v_from and cd.day <= v_to
  ),
  -- Workspace-wide MY orders per period: the denominator for allocating
  -- unlinked (Fighter-booked) RTS parcels across MY brand rows by order share,
  -- exactly as live_contribution_range does before the Profit page filters rows.
  ws_my as (
    select period_start, sum(orders)::numeric as orders from daily where market = 'MY' group by 1
  ),
  scoped as (
    select * from daily d
    where (p_brand_id is null or nullif(d.brand_key, 0) = p_brand_id)
      and (p_integration_ids is null or cardinality(p_integration_ids) = 0 or d.integration_id = any (p_integration_ids))
  ),
  commerce as (
    select period_start,
           sum(orders) as orders,
           sum(cod_orders) as cod_orders,
           coalesce(sum(revenue) filter (where currency_code = 'MYR'), 0) as revenue_myr,
           sum(base_units) as base_units,
           sum(unmapped_lines) as unmapped_lines,
           sum(base_units * unit_cost_myr) as cogs_myr,
           sum(case when market = 'SG' then orders * delivery_sg_myr
                    else (orders - east_orders) * delivery_my_west + east_orders * delivery_my_east end) as delivery_myr,
           sum(cod_orders * cod_fee) as cod_myr,
           max(refreshed_at) as refreshed_at
    from scoped
    group by 1
  ),
  revenue_ccy as (
    select period_start, jsonb_object_agg(currency_code, round(rev, 2)) as revenue_by_currency
    from (select period_start, currency_code, sum(revenue) as rev from scoped group by 1, 2) x
    group by 1
  ),
  rts_linked as (
    select date_trunc(v_grain, (s.rts_at at time zone 'Asia/Kuala_Lumpur')::timestamp)::date as period_start,
           s.brand_id, count(*)::numeric as n
    from public.nv_shipments s
    where s.brand_id is not null
      and (p_brand_id is null or s.brand_id = p_brand_id)
      and s.rts_at >= (v_from::timestamp at time zone 'Asia/Kuala_Lumpur')
      and s.rts_at < ((v_to + 1)::timestamp at time zone 'Asia/Kuala_Lumpur')
    group by 1, 2
  ),
  rts_unlinked as (
    select date_trunc(v_grain, (s.rts_at at time zone 'Asia/Kuala_Lumpur')::timestamp)::date as period_start, count(*)::numeric as n
    from public.nv_shipments s
    where s.brand_id is null
      and s.rts_at >= (v_from::timestamp at time zone 'Asia/Kuala_Lumpur')
      and s.rts_at < ((v_to + 1)::timestamp at time zone 'Asia/Kuala_Lumpur')
    group by 1
  ),
  -- Returns per MY brand row: linked parcels exactly, unlinked by order share,
  -- priced at that brand's own west/east blend under the latest rule.
  my_brand as (
    select period_start, nullif(brand_key, 0) as brand_id,
           sum(orders)::numeric as orders, sum(east_orders)::numeric as east_orders
    from scoped where market = 'MY'
    group by 1, 2
  ),
  returns as (
    select mb.period_start,
           sum(coalesce(rl.n, 0) + case when coalesce(w.orders, 0) > 0 then coalesce(ru.n, 0) * mb.orders / w.orders else 0 end) as rts_parcels,
           sum(case when mb.orders > 0 then
                 (coalesce(rl.n, 0) + case when coalesce(w.orders, 0) > 0 then coalesce(ru.n, 0) * mb.orders / w.orders else 0 end)
                 * ((mb.orders - mb.east_orders) / mb.orders * lr.delivery_my_west + mb.east_orders / mb.orders * lr.delivery_my_east)
               else 0 end) as returns_myr
    from my_brand mb
    left join rts_linked rl on rl.period_start = mb.period_start and rl.brand_id = mb.brand_id
    left join rts_unlinked ru on ru.period_start = mb.period_start
    left join ws_my w on w.period_start = mb.period_start
    left join last_rule lr on true
    group by 1
  ),
  -- Warehouse ad spend (ADR-0003), all platforms; WHT on Meta only at the
  -- Finance rule effective on the spend day. Brand via dbt slug, market via
  -- targeting geo; unattributed spend is excluded once a brand/market is chosen.
  ads as (
    select date_trunc(v_grain, f.date::timestamp)::date as period_start,
           sum(f.spend) as spend_gross,
           sum(case when f.platform = 'meta' then f.spend * coalesce(r.wht_rate, 0) else 0 end) as wht_myr,
           coalesce(sum(f.purchases), 0) as purchases,
           coalesce(sum(f.purchase_value), 0) as purchase_value,
           count(*) as fact_rows,
           coalesce(sum(f.spend) filter (where f.is_banned_account), 0) as banned_spend,
           count(*) filter (where f.currency_code is not null and f.currency_code <> 'MYR') as non_myr_rows,
           max(f.mart_synced_at) as as_of
    from public.ad_daily_facts f
    left join lateral (
      select cr.wht_rate from public.contribution_cost_rules cr
      where cr.effective_from <= f.date order by cr.effective_from desc limit 1
    ) r on true
    where f.date >= v_from and f.date <= v_to
      and f.source <> 'legacy_seed'
      and (v_brand_slug is null or f.brand_slug = v_brand_slug)
      and (v_markets is null or f.market = any (v_markets))
    group by 1
  ),
  movement as (
    select m.period_start, sum(m.new_accepted) as new_accepted, sum(m.new_customers) as new_customers
    from private.customer_base_movement_period m
    where v_policy_version is not null
      and m.policy_version = v_policy_version and m.grain = v_grain
      and m.scope_type = v_scope
      and (v_scope not in ('brand', 'brand_integration') or m.brand_id = p_brand_id)
      and (v_scope not in ('integration', 'brand_integration') or m.integration_id = any (p_integration_ids))
      and m.period_start >= v_from and m.period_start <= v_to
    group by 1
  ),
  rows as (
    select p.period_start, p.period_end,
           c.orders, c.cod_orders, c.base_units, c.unmapped_lines, c.revenue_myr, rc.revenue_by_currency,
           c.cogs_myr, c.delivery_myr, c.cod_myr, c.refreshed_at,
           coalesce(rt.rts_parcels, 0) as rts_parcels, coalesce(rt.returns_myr, 0) as returns_myr,
           a.spend_gross, a.wht_myr, a.purchases, a.purchase_value, a.fact_rows, a.banned_spend, a.non_myr_rows, a.as_of,
           mv.new_accepted, mv.new_customers
    from periods p
    left join commerce c on c.period_start = p.period_start
    left join revenue_ccy rc on rc.period_start = p.period_start
    left join returns rt on rt.period_start = p.period_start
    left join ads a on a.period_start = p.period_start
    left join movement mv on mv.period_start = p.period_start
  )
  select jsonb_build_object(
    'status', 'ok',
    'grain', v_grain, 'from', v_from, 'to', v_to,
    'scope', jsonb_build_object('type', v_scope, 'brand_id', p_brand_id, 'brand_slug', v_brand_slug,
                                'integration_ids', to_jsonb(p_integration_ids), 'markets', to_jsonb(v_markets)),
    'policy_version', v_policy_version,
    'rules', (select to_jsonb(r) - 'workspace_id' - 'id' - 'created_by' - 'created_at' from last_rule r),
    'commerce_refreshed_at', (select max(refreshed_at) from rows),
    'ads_as_of', (select max(as_of) from rows),
    'rts_allocated', (select coalesce(sum(n), 0) > 0 from rts_unlinked),
    'periods', coalesce((
      select jsonb_agg(jsonb_build_object(
        'period_start', r.period_start,
        'period_end', r.period_end,
        'orders', coalesce(r.orders, 0),
        'cod_orders', coalesce(r.cod_orders, 0),
        'base_units', coalesce(r.base_units, 0),
        'unmapped_lines', coalesce(r.unmapped_lines, 0),
        'revenue_myr', round(coalesce(r.revenue_myr, 0), 2),
        'revenue_by_currency', coalesce(r.revenue_by_currency, '{}'::jsonb),
        'cogs_myr', round(coalesce(r.cogs_myr, 0), 2),
        'delivery_myr', round(coalesce(r.delivery_myr, 0), 2),
        'cod_myr', round(coalesce(r.cod_myr, 0), 2),
        'rts_parcels', round(r.rts_parcels, 2),
        'returns_myr', round(r.returns_myr, 2),
        'spend', case when r.fact_rows is null then null else jsonb_build_object(
          'gross', round(r.spend_gross, 2),
          'wht', round(r.wht_myr, 2),
          'net', round(r.spend_gross - r.wht_myr, 2),
          'purchases', r.purchases,
          'purchase_value', round(r.purchase_value, 2),
          'fact_rows', r.fact_rows,
          'banned', round(r.banned_spend, 2),
          'non_myr_rows', r.non_myr_rows) end,
        'new_accepted', r.new_accepted,
        'new_customers', r.new_customers
      ) order by r.period_start)
      from rows r
    ), '[]'::jsonb)
  ) into v_out;
  return v_out;
end;
$$;

revoke all on function public.live_customer_base_economics(text, date, date, bigint, bigint[], integer) from public, anon;
grant execute on function public.live_customer_base_economics(text, date, date, bigint, bigint[], integer) to authenticated, service_role;

comment on function public.live_customer_base_economics(text, date, date, bigint, bigint[], integer) is
  'Customer Base companion series: per period × scope, recognized revenue by currency, MYR variable-cost lines (same daily arithmetic as live_contribution_range), warehouse ad spend with dated WHT, and the acquisition denominator (new_accepted) from the movement contract. The browser composes nCAC / ROAS / CM3 with the shared Profit arithmetic; nothing is estimated where a source is missing.';
