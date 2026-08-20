-- Fix-in-OS: operators correct flagged shipping details inside Fullkit
-- instead of wp-admin. This is an INTERNAL write only — Fullkit's own DB,
-- audited. It does NOT touch WooCommerce or Ninja Van. A staged correction
-- reaches the courier when external write propagation is enabled
-- (ADR-0002: write-back-to-Woo is the first, narrowest Slice 3 write).

create table public.order_corrections (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  order_read_id bigint not null references public.orders_read (id) on delete cascade,
  corrected jsonb not null,                 -- {name?, phone?, address_1?, postcode?, city?}
  original jsonb not null default '{}',      -- snapshot of the same keys at correction time
  status text not null default 'staged'      -- staged → applied (once propagated) | rejected
    check (status in ('staged', 'applied', 'rejected')),
  note text,
  corrected_by text,
  corrected_at timestamptz not null default now(),
  unique (order_read_id)
);

create index order_corrections_status_idx on public.order_corrections (status);

alter table public.order_corrections enable row level security;
create policy member_read on public.order_corrections for select to authenticated
  using (private.is_workspace_member(workspace_id));

-- Only HQ admins / operations may record a correction. Security definer +
-- role check; the browser cannot write this table directly.
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

  -- Allowlist the correctable shipping fields; reject anything else.
  for k in select jsonb_object_keys(p_corrected) loop
    if k not in ('name', 'phone', 'address_1', 'postcode', 'city') then
      raise exception 'Field % is not a correctable shipping field', k;
    end if;
  end loop;

  v_original := jsonb_strip_nulls(jsonb_build_object(
    'name', trim(coalesce(v_order.raw->'billing'->>'first_name','') || ' ' || coalesce(v_order.raw->'billing'->>'last_name','')),
    'phone', v_order.customer->>'phone',
    'address_1', v_order.raw->'billing'->>'address_1',
    'postcode', v_order.customer->>'postcode',
    'city', v_order.customer->>'city'
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

-- Re-grade ship-readiness with staged corrections applied. An order whose
-- correction resolves every issue leaves the red lane but stays visible as
-- "corrected · staged" until propagation exists, because the courier label
-- is still generated from the uncorrected source today.
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
  correction_status text,
  total_checked bigint,
  total_flagged bigint,
  total_corrected bigint
)
language sql
stable
set search_path = ''
as $$
  with pre_ship as (
    select o.id, o.order_number, o.source_order_id, o.brand_id, o.placed_at, o.source_status,
           coalesce(ic.config->>'country_code', 'MY') as market,
           oc.status as correction_status,
           trim(coalesce(oc.corrected->>'name',
             coalesce(o.raw->'billing'->>'first_name','') || ' ' || coalesce(o.raw->'billing'->>'last_name',''))) as name,
           coalesce(oc.corrected->>'phone', o.customer->>'phone', '') as phone_raw,
           regexp_replace(coalesce(oc.corrected->>'phone', o.customer->>'phone', ''), '[^0-9]', '', 'g') as phone,
           coalesce(oc.corrected->>'address_1', o.raw->'billing'->>'address_1', '') as addr,
           coalesce(oc.corrected->>'postcode', o.customer->>'postcode', '') as postcode_raw,
           trim(coalesce(oc.corrected->>'postcode', o.customer->>'postcode', '')) as postcode,
           trim(coalesce(oc.corrected->>'city', o.customer->>'city', '')) as city
    from public.orders_read o
    join public.integration_connections ic on ic.id = o.integration_id
    left join public.order_corrections oc
      on oc.order_read_id = o.id and oc.status in ('staged', 'applied')
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
         g.issues, g.suggestions, g.correction_status,
         (select count(*) from graded)::bigint,
         (select count(*) from graded x where array_length(x.issues, 1) > 0)::bigint,
         (select count(*) from graded x where x.correction_status = 'staged')::bigint
  from graded g
  where array_length(g.issues, 1) > 0 or g.correction_status = 'staged'
  order by g.placed_at desc
  limit 200;
$$;

revoke execute on function public.live_ship_readiness(integer) from public, anon;
grant execute on function public.live_ship_readiness(integer) to authenticated, service_role;
