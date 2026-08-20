-- Aggregates for the Command Centre's live commercial scorecard.
-- Security INVOKER on purpose: orders_read RLS (member-read) authorizes the
-- caller — no service-role path from the browser. Recognized revenue =
-- processing + completed source statuses; windows are Asia/Kuala_Lumpur days.
create or replace function public.live_scorecard()
returns table (win text, brand_id bigint, currency_code text, orders bigint, revenue numeric)
language sql
stable
set search_path = ''
as $$
  with tz as (select (now() at time zone 'Asia/Kuala_Lumpur')::date as today)
  select w.win, o.brand_id, o.currency_code, count(*)::bigint, sum(o.total)::numeric
  from public.orders_read o
  cross join tz
  cross join lateral (values
    ('today',     tz.today,      tz.today + 1),
    ('yesterday', tz.today - 1,  tz.today),
    ('d7',        tz.today - 6,  tz.today + 1),
    ('d30',       tz.today - 29, tz.today + 1)
  ) as w(win, from_d, to_d)
  where o.source_status in ('processing', 'completed')
    and o.placed_at is not null
    and (o.placed_at at time zone 'Asia/Kuala_Lumpur')::date >= w.from_d
    and (o.placed_at at time zone 'Asia/Kuala_Lumpur')::date < w.to_d
  group by w.win, o.brand_id, o.currency_code;
$$;

revoke execute on function public.live_scorecard() from public, anon;
grant execute on function public.live_scorecard() to authenticated, service_role;
