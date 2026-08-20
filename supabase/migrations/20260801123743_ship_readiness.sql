-- Ship-readiness validation gate (ADR-0002 Phase 0, read-only).
-- Grades every pre-ship order (pending / on-hold / processing) with
-- market-aware deterministic rules. Three lanes:
--   green  = no issues (auto-passable once Slice 3 writes exist)
--   yellow = representation-only suggestions (never applied automatically)
--   red    = human judgment required (surfaced in the Fulfilment queue)
-- Security INVOKER — orders_read RLS authorizes callers.
create or replace function public.live_ship_readiness(p_days integer default 14)
returns table (
  id bigint,
  order_number text,
  brand_id bigint,
  market text,
  placed_at timestamptz,
  source_status text,
  issues text[],
  suggestions jsonb,
  total_checked bigint,
  total_flagged bigint
)
language sql
stable
set search_path = ''
as $$
  with pre_ship as (
    select o.id, o.order_number, o.source_order_id, o.brand_id, o.placed_at, o.source_status,
           coalesce(ic.config->>'country_code', 'MY') as market,
           trim(coalesce(o.raw->'billing'->>'first_name','') || ' ' || coalesce(o.raw->'billing'->>'last_name','')) as name,
           coalesce(o.customer->>'phone', '') as phone_raw,
           regexp_replace(coalesce(o.customer->>'phone',''), '[^0-9]', '', 'g') as phone,
           coalesce(o.raw->'billing'->>'address_1','') as addr,
           coalesce(o.customer->>'postcode','') as postcode_raw,
           trim(coalesce(o.customer->>'postcode','')) as postcode,
           trim(coalesce(o.customer->>'city','')) as city
    from public.orders_read o
    join public.integration_connections ic on ic.id = o.integration_id
    where o.source_status in ('pending', 'on-hold', 'processing')
      and o.placed_at > now() - make_interval(days => greatest(p_days, 1))
  ),
  graded as (
    select p.*,
      array_remove(array[
        case when length(p.name) < 3 then 'name_incomplete' end,
        case when not (
               (p.market = 'SG' and p.phone ~ '^(65)?[89][0-9]{7}$')
            or (p.market <> 'SG' and p.phone ~ '^(60)?0?1[0-9]{8,9}$')
        ) then 'phone_invalid' end,
        case when not (
               (p.market = 'SG' and p.postcode ~ '^[0-9]{6}$')
            or (p.market <> 'SG' and p.postcode ~ '^[0-9]{5}$')
        ) then 'postcode_format' end,
        case when not (length(p.addr) >= 10 and p.addr ~ '[0-9]') then 'address_incomplete' end,
        case when p.market <> 'SG' and length(p.city) < 2 then 'city_missing' end
      ], null) as issues,
      -- Representation-only suggestions; never inference.
      jsonb_strip_nulls(jsonb_build_object(
        'postcode', case when p.postcode <> p.postcode_raw
                          and ((p.market = 'SG' and p.postcode ~ '^[0-9]{6}$')
                            or (p.market <> 'SG' and p.postcode ~ '^[0-9]{5}$'))
                    then p.postcode end,
        'phone_normalized', case
          when p.market = 'SG' and p.phone ~ '^(65)?[89][0-9]{7}$' and p.phone_raw !~ '^\+65'
            then '+65' || right(p.phone, 8)
          when p.market <> 'SG' and p.phone ~ '^(60)?0?1[0-9]{8,9}$' and p.phone_raw !~ '^\+60'
            then '+60' || regexp_replace(p.phone, '^(60|0)', '')
        end
      )) as suggestions
    from pre_ship p
  )
  select g.id, coalesce(g.order_number, g.source_order_id) as order_number,
         g.brand_id, g.market, g.placed_at, g.source_status,
         g.issues, g.suggestions,
         (select count(*) from graded)::bigint as total_checked,
         (select count(*) from graded x where array_length(x.issues, 1) > 0)::bigint as total_flagged
  from graded g
  where array_length(g.issues, 1) > 0
  order by g.placed_at desc
  limit 200;
$$;

revoke execute on function public.live_ship_readiness(integer) from public, anon;
grant execute on function public.live_ship_readiness(integer) to authenticated, service_role;
