-- ship_grades: read orders_read.raw once per order.
--
-- raw is TOASTed (~6 KB per order). Every `o.raw->…` expression re-reads and
-- re-decompresses the whole value, and the pre_ship CTE made ~25 of them per
-- order. fulfilment_gate_tick() calls ship_grades(30) every 5 min: ~3,100
-- orders → ~1.07M buffer touches and ~9.4 s per call, the second-largest
-- consumer of disk IO after the customers_read matview.
--
-- shipping / billing are now pulled out once in a MATERIALIZED CTE and the
-- rest of the function reads those small jsonb values. The grading logic
-- (with_addr / graded / final select) is unchanged byte-for-byte, and the
-- output was diffed against the previous definition (3,089 rows, 0 differences).
-- Measured: 38k buffers, 0.78 s.
--
-- Side effect worth knowing: the address-suggest edge function calls
-- ship_grades(14) through PostgREST, where `authenticator` carries an 8 s
-- statement_timeout. At ~9 s it had been returning HTTP 500 on every run
-- (4/hour, all of the 24 h log window). First run after this: 200.

drop function if exists public.ship_grades_v2(integer);

CREATE OR REPLACE FUNCTION public.ship_grades(p_days integer DEFAULT 14)
 RETURNS TABLE(id bigint, integration_id bigint, source_order_id text, order_number text, brand_id bigint, market text, placed_at timestamp with time zone, source_status text, issues text[], warnings text[], suggestions jsonb, correction_status text, fields jsonb)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with src as materialized (
    -- Pull shipping / billing out of orders_read.raw once per order. raw is
    -- TOASTed (~6 KB); every `o.raw->…` reference re-reads and re-decompresses
    -- the whole value, and this function makes ~25 of them per order.
    select o.id, o.integration_id, o.source_order_id, o.order_number, o.brand_id,
           o.placed_at, o.source_status, o.customer,
           o.raw->'shipping' as shp,
           o.raw->'billing' as bil
    from public.orders_read o
    where o.source_status in ('pending', 'on-hold', 'processing')
      and o.placed_at > now() - make_interval(days => greatest(p_days, 1))
  ),
  pre_ship as (
    select o.id, o.integration_id, o.source_order_id, o.order_number, o.brand_id,
           o.placed_at, o.source_status,
           coalesce(ic.config->>'country_code', 'MY') as market,
           oc.status as correction_status,
           trim(coalesce(
             oc.corrected->>'name',
             nullif(trim(coalesce(o.shp->>'first_name', '') || ' ' || coalesce(o.shp->>'last_name', '')), ''),
             trim(coalesce(o.bil->>'first_name', '') || ' ' || coalesce(o.bil->>'last_name', ''))
           )) as name,
           coalesce(oc.corrected->>'phone', nullif(o.shp->>'phone', ''), o.customer->>'phone', '') as phone_raw,
           regexp_replace(coalesce(oc.corrected->>'phone', nullif(o.shp->>'phone', ''), o.customer->>'phone', ''), '[^0-9]', '', 'g') as phone,
           coalesce(oc.corrected->>'address_1', nullif(o.shp->>'address_1', ''), o.bil->>'address_1', '') as addr,
           coalesce(nullif(o.shp->>'address_2', ''), o.bil->>'address_2', '') as addr2,
           coalesce(oc.corrected->>'postcode', nullif(o.shp->>'postcode', ''), o.customer->>'postcode', '') as postcode_raw,
           trim(coalesce(oc.corrected->>'postcode', nullif(o.shp->>'postcode', ''), o.customer->>'postcode', '')) as postcode,
           trim(coalesce(oc.corrected->>'city', nullif(o.shp->>'city', ''), o.customer->>'city', '')) as city,
           upper(trim(coalesce(oc.corrected->>'state', nullif(o.shp->>'state', ''), o.bil->>'state', ''))) as state
    from src o
    join public.integration_connections ic on ic.id = o.integration_id
    left join public.order_corrections oc
      on oc.order_read_id = o.id and oc.status in ('staged', 'applied')
  ),
  with_addr as (
    select p.*, trim(p.addr || ' ' || p.addr2) as addr_full
    from pre_ship p
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
        case when p.addr_full !~ '[0-9]' then 'address_incomplete' end,
        case when length(p.addr_full) < 15
              and coalesce(array_length(regexp_split_to_array(trim(p.addr_full), '\s+'), 1), 0) < 3
             then 'address_too_short' end,
        case when p.market <> 'SG' and length(p.city) < 2 then 'city_missing' end,
        case when p.market <> 'SG' and p.postcode ~ '^[0-9]{5}$' and p.state <> ''
              and exists (select 1 from public.my_postcode_ranges r
                          where r.state_code = p.state or upper(r.state_name) = p.state)
              and not exists (select 1 from public.my_postcode_ranges r
                              where (r.state_code = p.state or upper(r.state_name) = p.state)
                                and nullif(regexp_replace(p.postcode, '[^0-9]', '', 'g'), '')::int
                                    between r.range_start and r.range_end)
             then 'postcode_state_mismatch' end
      ], null) as issues,
      array_remove(array[
        case when p.market <> 'SG' and p.addr_full !~* '(jalan|jln|lorong|lrg|taman|tmn|persiaran|psn|kampung|kg|blok|block|blk|apartment|apt|kondo|condo|residensi|residence|jaya|bandar|desa|lebuh|medan|solok|pangsapuri|flat|felda|pekan|kuarters|universiti|kolej|hospital|sekolah|pejabat|kompleks|plaza|wisma|menara)'
             then 'address_no_street_keyword' end,
        case when p.addr_full !~* '((no|lot|blk|blok|block|unit|tingkat|level)[.,]?\s*[0-9])|([0-9]+[a-z]?\s*[-/#]\s*[0-9])|(^[0-9])|(#\s*[0-9])'
             then 'address_no_unit' end
      ], null) as warnings,
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
    from with_addr p
  )
  select g.id, g.integration_id, g.source_order_id, g.order_number, g.brand_id,
         g.market, g.placed_at, g.source_status,
         g.issues, g.warnings, g.suggestions, g.correction_status,
         jsonb_build_object(
           'name', g.name, 'phone', g.phone_raw, 'address_1', g.addr,
           'address_2', g.addr2, 'postcode', g.postcode, 'city', g.city, 'state', g.state
         ) as fields
  from graded g;
$function$;
