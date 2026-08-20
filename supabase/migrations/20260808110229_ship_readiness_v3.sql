-- Ship-readiness v3: the gate learns to read addresses, not just formats.
-- NV bounces parcels on address quality ("Inaccurate Address") that the
-- phone+postcode shape rules never see. Three changes (ADR-0006):
--   1. ship_grades() — shared grader returning EVERY pre-ship order (green
--      included, no limit), so the fulfilment gate tick and the AI
--      suggester can consume the same verdicts as the UI queue.
--   2. Address substance rules: red postcode_state_mismatch (MY postcode
--      outside the state's published range) + address_too_short; yellow
--      warnings[] (missing street keyword / unit number) that summon the
--      AI without blocking — too false-positive-prone to hard-block
--      (ADR-0005 lesson: length rules burn legitimate addresses).
--   3. Grading prefers raw->shipping over billing per field (what NV
--      actually delivers to), and 'state' joins the correctable allowlist.

-- MY postcode allocations per state, deliberately generous to the decade
-- boundary: a mismatch flag must mean "certainly the wrong state", never
-- "our table was too tight". Reference data — no workspace_id.
create table public.my_postcode_ranges (
  state_code text not null,   -- Woo MY state codes
  state_name text not null,
  range_start int not null,
  range_end int not null
);

insert into public.my_postcode_ranges (state_code, state_name, range_start, range_end) values
  ('PLS', 'Perlis',           1000,  2999),
  ('KDH', 'Kedah',            5000,  9999),
  ('PNG', 'Pulau Pinang',    10000, 14999),
  ('KTN', 'Kelantan',        15000, 18999),
  ('TRG', 'Terengganu',      20000, 24999),
  ('PHG', 'Pahang',          25000, 28999),
  ('PHG', 'Pahang',          39000, 39999),
  ('PHG', 'Pahang',          49000, 49999),
  ('PHG', 'Pahang',          69000, 69999),
  ('PRK', 'Perak',           30000, 36999),
  ('SGR', 'Selangor',        40000, 48999),
  ('SGR', 'Selangor',        63000, 64999),
  ('SGR', 'Selangor',        68000, 68199),
  ('KUL', 'Kuala Lumpur',    50000, 60999),
  ('PJY', 'Putrajaya',       62000, 62999),
  ('NSN', 'Negeri Sembilan', 70000, 73999),
  ('MLK', 'Melaka',          75000, 78999),
  ('JHR', 'Johor',           79000, 86999),
  ('LBN', 'Labuan',          87000, 87999),
  ('SBH', 'Sabah',           88000, 91999),
  ('SWK', 'Sarawak',         93000, 98999),
  -- Klang Valley equivalence: customers write KUL/Selangor/Putrajaya
  -- interchangeably at the boundary (Batu Caves 68100, Cheras 43200,
  -- Cyberjaya 63000…) and NV routes by postcode, so a swap within the
  -- trio must not flag.
  ('KUL', 'Kuala Lumpur',    40000, 48999),
  ('KUL', 'Kuala Lumpur',    62000, 64999),
  ('KUL', 'Kuala Lumpur',    68000, 68199),
  ('SGR', 'Selangor',        50000, 60999),
  ('SGR', 'Selangor',        62000, 62999),
  ('PJY', 'Putrajaya',       40000, 48999),
  ('PJY', 'Putrajaya',       50000, 60999),
  ('PJY', 'Putrajaya',       63000, 64999),
  -- Documented cross-border anomaly: 3495x is Bandar Baharu, Kedah,
  -- inside Perak's numeric block.
  ('KDH', 'Kedah',           34950, 34959);

alter table public.my_postcode_ranges enable row level security;
create policy member_read on public.my_postcode_ranges for select to authenticated
  using (true);

-- The shared grader. Corrections overlay first, then shipping block, then
-- billing. Address substance is judged on address_1 + address_2 combined so
-- a street living in line 2 doesn't false-flag line 1.
create or replace function public.ship_grades(p_days integer default 14)
returns table (
  id bigint,
  integration_id bigint,
  source_order_id text,
  order_number text,
  brand_id bigint,
  market text,
  placed_at timestamptz,
  source_status text,
  issues text[],
  warnings text[],
  suggestions jsonb,
  correction_status text,
  fields jsonb
)
language sql
stable
set search_path = ''
as $$
  with pre_ship as (
    select o.id, o.integration_id, o.source_order_id, o.order_number, o.brand_id,
           o.placed_at, o.source_status,
           coalesce(ic.config->>'country_code', 'MY') as market,
           oc.status as correction_status,
           trim(coalesce(
             oc.corrected->>'name',
             nullif(trim(coalesce(o.raw->'shipping'->>'first_name', '') || ' ' || coalesce(o.raw->'shipping'->>'last_name', '')), ''),
             trim(coalesce(o.raw->'billing'->>'first_name', '') || ' ' || coalesce(o.raw->'billing'->>'last_name', ''))
           )) as name,
           coalesce(oc.corrected->>'phone', nullif(o.raw->'shipping'->>'phone', ''), o.customer->>'phone', '') as phone_raw,
           regexp_replace(coalesce(oc.corrected->>'phone', nullif(o.raw->'shipping'->>'phone', ''), o.customer->>'phone', ''), '[^0-9]', '', 'g') as phone,
           coalesce(oc.corrected->>'address_1', nullif(o.raw->'shipping'->>'address_1', ''), o.raw->'billing'->>'address_1', '') as addr,
           coalesce(nullif(o.raw->'shipping'->>'address_2', ''), o.raw->'billing'->>'address_2', '') as addr2,
           coalesce(oc.corrected->>'postcode', nullif(o.raw->'shipping'->>'postcode', ''), o.customer->>'postcode', '') as postcode_raw,
           trim(coalesce(oc.corrected->>'postcode', nullif(o.raw->'shipping'->>'postcode', ''), o.customer->>'postcode', '')) as postcode,
           trim(coalesce(oc.corrected->>'city', nullif(o.raw->'shipping'->>'city', ''), o.customer->>'city', '')) as city,
           upper(trim(coalesce(oc.corrected->>'state', nullif(o.raw->'shipping'->>'state', ''), o.raw->'billing'->>'state', ''))) as state
    from public.orders_read o
    join public.integration_connections ic on ic.id = o.integration_id
    left join public.order_corrections oc
      on oc.order_read_id = o.id and oc.status in ('staged', 'applied')
    where o.source_status in ('pending', 'on-hold', 'processing')
      and o.placed_at > now() - make_interval(days => greatest(p_days, 1))
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
$$;

revoke all on function public.ship_grades(integer) from public, anon;
grant execute on function public.ship_grades(integer) to authenticated, service_role;

-- live_ship_readiness becomes a thin wrapper: same contract as v2 plus an
-- appended warnings column (red-lane filter unchanged — warnings alone do
-- not put an order in the exception queue).
drop function public.live_ship_readiness(integer);
create function public.live_ship_readiness(p_days integer default 14)
returns table (
  id bigint,
  order_number text,
  brand_id bigint,
  market text,
  placed_at timestamptz,
  source_status text,
  issues text[],
  suggestions jsonb,
  correction_status text,
  total_checked bigint,
  total_flagged bigint,
  total_corrected bigint,
  warnings text[]
)
language sql
stable
set search_path = ''
as $$
  with graded as (
    select * from public.ship_grades(p_days)
  )
  select g.id, coalesce(g.order_number, g.source_order_id) as order_number,
         g.brand_id, g.market, g.placed_at, g.source_status,
         g.issues, g.suggestions, g.correction_status,
         (select count(*) from graded)::bigint,
         (select count(*) from graded x where array_length(x.issues, 1) > 0)::bigint,
         (select count(*) from graded x where x.correction_status = 'staged')::bigint,
         g.warnings
  from graded g
  where array_length(g.issues, 1) > 0 or g.correction_status = 'staged'
  order by g.placed_at desc
  limit 200;
$$;

revoke all on function public.live_ship_readiness(integer) from public, anon;
grant execute on function public.live_ship_readiness(integer) to authenticated, service_role;

-- 'state' joins the correctable allowlist (postcode_state_mismatch needs a
-- fixable state), and the original snapshot follows the same
-- corrections→shipping→billing precedence the grader now uses.
create or replace function public.save_order_correction(
  p_order_id bigint,
  p_corrected jsonb,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws bigint;
  v_order record;
  v_original jsonb;
  k text;
begin
  select o.workspace_id, o.customer, o.raw, o.order_number, o.source_order_id
  into v_order
  from public.orders_read o where o.id = p_order_id;
  if v_order is null then
    raise exception 'Unknown order';
  end if;
  v_ws := v_order.workspace_id;
  if not private.has_role(v_ws, array['hq_admin', 'operations']) then
    raise exception 'Only HQ admins or operations can correct orders';
  end if;

  for k in select jsonb_object_keys(p_corrected) loop
    if k not in ('name', 'phone', 'address_1', 'postcode', 'city', 'state') then
      raise exception 'Field % is not a correctable shipping field', k;
    end if;
  end loop;

  v_original := jsonb_strip_nulls(jsonb_build_object(
    'name', coalesce(
      nullif(trim(coalesce(v_order.raw->'shipping'->>'first_name', '') || ' ' || coalesce(v_order.raw->'shipping'->>'last_name', '')), ''),
      trim(coalesce(v_order.raw->'billing'->>'first_name', '') || ' ' || coalesce(v_order.raw->'billing'->>'last_name', ''))),
    'phone', coalesce(nullif(v_order.raw->'shipping'->>'phone', ''), v_order.customer->>'phone'),
    'address_1', coalesce(nullif(v_order.raw->'shipping'->>'address_1', ''), v_order.raw->'billing'->>'address_1'),
    'postcode', coalesce(nullif(v_order.raw->'shipping'->>'postcode', ''), v_order.customer->>'postcode'),
    'city', coalesce(nullif(v_order.raw->'shipping'->>'city', ''), v_order.customer->>'city'),
    'state', coalesce(nullif(v_order.raw->'shipping'->>'state', ''), v_order.raw->'billing'->>'state')
  ));

  insert into public.order_corrections (workspace_id, order_read_id, corrected, original, note, corrected_by)
  values (
    v_ws, p_order_id, p_corrected, v_original, p_note,
    coalesce((select display_name from public.profiles where id = (select auth.uid())), 'unknown')
  )
  on conflict (order_read_id) do update
    set corrected = excluded.corrected,
        original = excluded.original,
        note = excluded.note,
        corrected_by = excluded.corrected_by,
        corrected_at = now(),
        status = 'staged';

  insert into public.audit_events (workspace_id, actor_label, action, entity_ref, detail)
  values (
    v_ws,
    coalesce((select display_name from public.profiles where id = (select auth.uid())), 'unknown'),
    'order.shipping_corrected',
    'order:' || coalesce(v_order.order_number, v_order.source_order_id),
    'Shipping details corrected in Fullkit (staged for write propagation): ' || (p_corrected::text)
  );
end;
$$;

revoke execute on function public.save_order_correction(bigint, jsonb, text) from public, anon;
grant execute on function public.save_order_correction(bigint, jsonb, text) to authenticated;
