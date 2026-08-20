-- Statistical plan baseline (interim Prophit expectation, per decision on
-- 2026-08-01): for each day, the expectation is the average recognized
-- revenue/orders of the SAME WEEKDAY over the prior 4 weeks, per
-- brand × market × currency. Labeled "statistical baseline" in the UI —
-- explicitly not a leadership target; superseded when the governed plan
-- model (Growth Engine methodology) lands.
-- Security INVOKER like live_scorecard: orders_read RLS authorizes callers.
create or replace function public.live_plan_baseline()
returns table (win text, brand_id bigint, market text, currency_code text,
               expected_revenue numeric, expected_orders numeric)
language sql
stable
set search_path = ''
as $$
  with tz as (select (now() at time zone 'Asia/Kuala_Lumpur')::date as today),
  daily as (
    select (o.placed_at at time zone 'Asia/Kuala_Lumpur')::date as d,
           o.brand_id,
           coalesce(ic.config->>'country_code', '—') as market,
           o.currency_code,
           sum(o.total::numeric) as rev,
           count(*)::numeric as ord
    from public.orders_read o
    join public.integration_connections ic on ic.id = o.integration_id
    where o.source_status in ('processing', 'completed')
      and o.placed_at is not null
      and o.placed_at > now() - interval '65 days'
    group by 1, 2, 3, 4
  ),
  wins as (
    select w.win, gs::date as d
    from tz
    cross join lateral (values
      ('today',     tz.today,      tz.today),
      ('yesterday', tz.today - 1,  tz.today - 1),
      ('d7',        tz.today - 6,  tz.today),
      ('d30',       tz.today - 29, tz.today)
    ) as w(win, from_d, to_d)
    cross join lateral generate_series(w.from_d, w.to_d, interval '1 day') gs
  ),
  per_day as (
    select w.win, w.d, dy.brand_id, dy.market, dy.currency_code,
           avg(dy.rev) as exp_rev, avg(dy.ord) as exp_ord
    from wins w
    join daily dy on dy.d in (w.d - 7, w.d - 14, w.d - 21, w.d - 28)
    group by 1, 2, 3, 4, 5
  )
  select p.win, p.brand_id, p.market, p.currency_code,
         round(sum(p.exp_rev), 2), round(sum(p.exp_ord), 1)
  from per_day p
  group by 1, 2, 3, 4;
$$;

revoke execute on function public.live_plan_baseline() from public, anon;
grant execute on function public.live_plan_baseline() to authenticated, service_role;
