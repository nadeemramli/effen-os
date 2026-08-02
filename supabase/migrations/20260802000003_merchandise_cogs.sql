-- Merchandise slice: the COGS spine.
--
-- Stores sell under their own Woo SKUs (lip04, adipocyde6, cave04sg… — 41
-- distinct all-time). The canonical catalog (products/product_variants) keys
-- unit economics. Two new tables bridge and price it:
--   variant_aliases — store SKU → canonical variant, human-confirmed in the
--     OS (never guessed; a wrong mapping corrupts COGS silently).
--   variant_costs — effective-dated cost per variant, so margin on an order
--     uses the cost that was true when the order was placed.
-- Contribution math only pairs cost with revenue in the SAME currency; FX
-- conversion is a Finance policy decision that has not been made.
-- See docs/decisions/0004-merchandise-cogs-spine.md.

create table if not exists public.variant_aliases (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces(id),
  integration_id bigint not null references public.integration_connections(id),
  alias text not null,
  variant_id bigint not null references public.product_variants(id) on delete cascade,
  created_by text,
  created_at timestamptz not null default now(),
  unique (workspace_id, integration_id, alias)
);
create index if not exists variant_aliases_variant_id_idx on public.variant_aliases (variant_id);
create index if not exists variant_aliases_integration_alias_idx on public.variant_aliases (integration_id, alias);

alter table public.variant_aliases enable row level security;
drop policy if exists member_read on public.variant_aliases;
create policy member_read on public.variant_aliases
  for select to authenticated
  using (workspace_id in (
    select m.workspace_id from public.memberships m
    where m.user_id = (select auth.uid()) and m.status = 'active'
  ));

create table if not exists public.variant_costs (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces(id),
  variant_id bigint not null references public.product_variants(id) on delete cascade,
  cost numeric not null check (cost >= 0),
  currency_code text not null check (currency_code in ('MYR','SGD')),
  effective_from date not null default current_date,
  note text,
  created_by text,
  created_at timestamptz not null default now(),
  unique (variant_id, effective_from)
);
create index if not exists variant_costs_workspace_id_idx on public.variant_costs (workspace_id);

alter table public.variant_costs enable row level security;
drop policy if exists member_read on public.variant_costs;
create policy member_read on public.variant_costs
  for select to authenticated
  using (workspace_id in (
    select m.workspace_id from public.memberships m
    where m.user_id = (select auth.uid()) and m.status = 'active'
  ));

-- ── Writes (SECURITY DEFINER, internally gated, audited) ────────────────────

create or replace function public.map_variant_alias(
  p_integration_id bigint, p_alias text, p_variant_id bigint
) returns void
language plpgsql security definer set search_path to ''
as $function$
declare
  v_ws bigint;
  v_variant record;
begin
  select v.id, v.workspace_id, v.sku into v_variant
  from public.product_variants v where v.id = p_variant_id;
  if v_variant is null then
    raise exception 'Unknown variant';
  end if;
  v_ws := v_variant.workspace_id;
  if not exists (
    select 1 from public.integration_connections ic
    where ic.id = p_integration_id and ic.workspace_id = v_ws
  ) then
    raise exception 'Unknown integration for this workspace';
  end if;
  if not private.has_role(v_ws, array['hq_admin', 'operations', 'finance']) then
    raise exception 'Only HQ admins, operations, or finance can map SKUs';
  end if;
  if nullif(trim(p_alias), '') is null then
    raise exception 'Alias must not be empty';
  end if;

  insert into public.variant_aliases (workspace_id, integration_id, alias, variant_id, created_by)
  values (
    v_ws, p_integration_id, trim(p_alias), p_variant_id,
    coalesce((select display_name from public.profiles where id = (select auth.uid())), 'unknown')
  )
  on conflict (workspace_id, integration_id, alias) do update
    set variant_id = excluded.variant_id,
        created_by = excluded.created_by,
        created_at = now();

  insert into public.audit_events (workspace_id, actor_label, action, entity_ref, detail)
  values (
    v_ws,
    coalesce((select display_name from public.profiles where id = (select auth.uid())), 'unknown'),
    'catalog.sku_mapped',
    'sku:' || trim(p_alias),
    'Store SKU mapped to canonical variant ' || v_variant.sku || ' (integration ' || p_integration_id || ')'
  );
end;
$function$;

create or replace function public.save_variant_cost(
  p_variant_id bigint, p_cost numeric, p_currency text,
  p_effective_from date default current_date, p_note text default null
) returns void
language plpgsql security definer set search_path to ''
as $function$
declare
  v_variant record;
begin
  select v.id, v.workspace_id, v.sku into v_variant
  from public.product_variants v where v.id = p_variant_id;
  if v_variant is null then
    raise exception 'Unknown variant';
  end if;
  if not private.has_role(v_variant.workspace_id, array['hq_admin', 'finance']) then
    raise exception 'Only HQ admins or finance can set costs';
  end if;
  if p_cost is null or p_cost < 0 then
    raise exception 'Cost must be zero or positive';
  end if;
  if p_currency not in ('MYR', 'SGD') then
    raise exception 'Currency must be MYR or SGD';
  end if;

  insert into public.variant_costs (workspace_id, variant_id, cost, currency_code, effective_from, note, created_by)
  values (
    v_variant.workspace_id, p_variant_id, p_cost, p_currency, coalesce(p_effective_from, current_date), p_note,
    coalesce((select display_name from public.profiles where id = (select auth.uid())), 'unknown')
  )
  on conflict (variant_id, effective_from) do update
    set cost = excluded.cost,
        currency_code = excluded.currency_code,
        note = excluded.note,
        created_by = excluded.created_by,
        created_at = now();

  insert into public.audit_events (workspace_id, actor_label, action, entity_ref, detail)
  values (
    v_variant.workspace_id,
    coalesce((select display_name from public.profiles where id = (select auth.uid())), 'unknown'),
    'catalog.cost_set',
    'variant:' || v_variant.sku,
    'COGS set to ' || p_cost || ' ' || p_currency || ' effective ' || coalesce(p_effective_from, current_date)
  );
end;
$function$;

-- ── Reads (SECURITY INVOKER — RLS applies) ──────────────────────────────────

-- Catalog with unit-economics context: current cost, aliases, sold velocity.
create or replace function public.live_merchandise()
returns jsonb
language sql stable security invoker set search_path to ''
as $function$
  with sold as (
    select va.variant_id,
           sum(it.qty) filter (where o.placed_at > now() - interval '14 days') as units_14d,
           sum(it.qty) filter (where o.placed_at > now() - interval '30 days') as units_30d,
           sum(it.qty) as units_90d,
           max(o.placed_at) as last_sold_at
    from public.orders_read o
    cross join lateral (
      select e->>'sku' as sku, coalesce(nullif(e->>'quantity','')::numeric, 1) as qty
      from jsonb_array_elements(o.items) e
    ) it
    join public.variant_aliases va
      on va.integration_id = o.integration_id and va.alias = it.sku
    where o.placed_at > now() - interval '90 days'
      and o.source_status in ('processing', 'completed')
    group by va.variant_id
  ),
  cur_cost as (
    select distinct on (vc.variant_id) vc.variant_id, vc.cost, vc.currency_code, vc.effective_from
    from public.variant_costs vc
    where vc.effective_from <= current_date
    order by vc.variant_id, vc.effective_from desc
  ),
  al as (
    select va.variant_id,
           jsonb_agg(jsonb_build_object('integration_id', va.integration_id, 'alias', va.alias) order by va.alias) as aliases
    from public.variant_aliases va
    group by va.variant_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'brand_id', p.brand_id, 'name', p.name, 'category', p.category, 'status', p.status,
    'variants', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', v.id, 'sku', v.sku, 'name', v.name,
        'price', v.price, 'currency_code', v.currency_code,
        'cost', cc.cost, 'cost_currency', cc.currency_code, 'cost_effective_from', cc.effective_from,
        'aliases', coalesce(al.aliases, '[]'::jsonb),
        'units_14d', coalesce(s.units_14d, 0),
        'units_30d', coalesce(s.units_30d, 0),
        'units_90d', coalesce(s.units_90d, 0),
        'last_sold_at', s.last_sold_at
      ) order by v.sku), '[]'::jsonb)
      from public.product_variants v
      left join cur_cost cc on cc.variant_id = v.id
      left join al on al.variant_id = v.id
      left join sold s on s.variant_id = v.id
      where v.product_id = p.id
    )
  ) order by p.brand_id, p.name), '[]'::jsonb)
  from public.products p;
$function$;

-- Store SKUs seen in orders that have no canonical mapping yet, by volume.
create or replace function public.live_sku_mapping_queue()
returns table(
  integration_id bigint, brand_id bigint, market text, currency_code text,
  store_sku text, item_name text, units numeric, orders bigint, last_sold_at timestamptz
)
language sql stable security invoker set search_path to ''
as $function$
  select o.integration_id,
         max(o.brand_id) as brand_id,
         coalesce(max(ic.config->>'country_code'), '—') as market,
         max(o.currency_code) as currency_code,
         it.sku as store_sku,
         (array_agg(it.name order by o.placed_at desc))[1] as item_name,
         sum(it.qty) as units,
         count(distinct o.id) as orders,
         max(o.placed_at) as last_sold_at
  from public.orders_read o
  join public.integration_connections ic on ic.id = o.integration_id
  cross join lateral (
    select e->>'sku' as sku, e->>'name' as name,
           coalesce(nullif(e->>'quantity','')::numeric, 1) as qty
    from jsonb_array_elements(o.items) e
  ) it
  where nullif(it.sku, '') is not null
    and not exists (
      select 1 from public.variant_aliases va
      where va.integration_id = o.integration_id and va.alias = it.sku
    )
  group by o.integration_id, it.sku
  order by sum(it.qty) desc;
$function$;

-- Line-level unit economics per scorecard window/brand/market/currency.
-- cogs pairs cost with revenue only when the cost currency matches the order
-- currency; costed_units/units expose coverage so the UI can refuse to show
-- contribution built on thin data.
create or replace function public.live_unit_economics()
returns table(
  win text, brand_id bigint, market text, currency_code text,
  revenue numeric, orders bigint, units numeric,
  mapped_units numeric, costed_units numeric, cogs numeric
)
language sql stable security invoker set search_path to ''
as $function$
  with tz as (select (now() at time zone 'Asia/Kuala_Lumpur')::date as today),
  lines as (
    select o.id, o.brand_id, o.currency_code, o.placed_at, o.integration_id,
           coalesce(ic.config->>'country_code', '—') as market,
           (o.placed_at at time zone 'Asia/Kuala_Lumpur')::date as placed_d,
           it.sku, it.qty, it.line_total
    from public.orders_read o
    join public.integration_connections ic on ic.id = o.integration_id
    cross join lateral (
      select e->>'sku' as sku,
             coalesce(nullif(e->>'quantity','')::numeric, 1) as qty,
             coalesce(nullif(e->>'total','')::numeric, 0) as line_total
      from jsonb_array_elements(o.items) e
    ) it
    where o.source_status in ('processing', 'completed')
      and o.placed_at is not null
      and (o.placed_at at time zone 'Asia/Kuala_Lumpur')::date >= (select today from tz) - 29
  ),
  enriched as (
    select l.*, va.variant_id, cc.cost, cc.cost_currency
    from lines l
    left join public.variant_aliases va
      on va.integration_id = l.integration_id and va.alias = l.sku
    left join lateral (
      select vc.cost, vc.currency_code as cost_currency
      from public.variant_costs vc
      where vc.variant_id = va.variant_id and vc.effective_from <= l.placed_d
      order by vc.effective_from desc limit 1
    ) cc on va.variant_id is not null
  )
  select w.win, e.brand_id, e.market, e.currency_code,
         sum(e.line_total) as revenue,
         count(distinct e.id) as orders,
         sum(e.qty) as units,
         coalesce(sum(e.qty) filter (where e.variant_id is not null), 0) as mapped_units,
         coalesce(sum(e.qty) filter (where e.cost is not null and e.cost_currency = e.currency_code), 0) as costed_units,
         coalesce(sum(e.cost * e.qty) filter (where e.cost is not null and e.cost_currency = e.currency_code), 0) as cogs
  from enriched e
  cross join tz
  cross join lateral (values
    ('today', tz.today,      tz.today + 1),
    ('d7',    tz.today - 6,  tz.today + 1),
    ('d30',   tz.today - 29, tz.today + 1)
  ) as w(win, from_d, to_d)
  where e.placed_d >= w.from_d and e.placed_d < w.to_d
  group by w.win, e.brand_id, e.market, e.currency_code;
$function$;

-- Lock down execute: authenticated members only (internal gates do the rest).
revoke all on function public.map_variant_alias(bigint, text, bigint) from public, anon;
revoke all on function public.save_variant_cost(bigint, numeric, text, date, text) from public, anon;
revoke all on function public.live_merchandise() from public, anon;
revoke all on function public.live_sku_mapping_queue() from public, anon;
revoke all on function public.live_unit_economics() from public, anon;
grant execute on function public.map_variant_alias(bigint, text, bigint) to authenticated, service_role;
grant execute on function public.save_variant_cost(bigint, numeric, text, date, text) to authenticated, service_role;
grant execute on function public.live_merchandise() to authenticated, service_role;
grant execute on function public.live_sku_mapping_queue() to authenticated, service_role;
grant execute on function public.live_unit_economics() to authenticated, service_role;
