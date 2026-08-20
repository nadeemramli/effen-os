-- Two-plane catalog: the WooCommerce channel mirror.
--
-- Commercial truth lives in products/product_variants (finance/admin, in the
-- OS). Channel truth is what marketers actually published per store; this
-- table mirrors it read-only from each store's Woo products API, same
-- pattern as orders_read. Reconciliation stays human-confirmed via
-- variant_aliases. See ADR-0004.

create table if not exists public.woo_products_read (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces(id),
  integration_id bigint not null references public.integration_connections(id),
  source_product_id text not null,
  parent_product_id text,
  sku text,
  name text,
  status text,
  type text,
  price numeric,
  regular_price numeric,
  sale_price numeric,
  stock_status text,
  updated_at_source timestamptz,
  synced_at timestamptz not null default now(),
  raw jsonb not null default '{}'::jsonb,
  unique (integration_id, source_product_id)
);
create index if not exists woo_products_read_integration_sku_idx on public.woo_products_read (integration_id, sku);
create index if not exists woo_products_read_workspace_id_idx on public.woo_products_read (workspace_id);

alter table public.woo_products_read enable row level security;
drop policy if exists member_read on public.woo_products_read;
create policy member_read on public.woo_products_read
  for select to authenticated
  using (workspace_id in (
    select m.workspace_id from public.memberships m
    where m.user_id = (select auth.uid()) and m.status = 'active'
  ));

-- ── Data fix: Adipocyde SG variants were seeded in MYR with converted
-- values. Real sales are SGD; prices below are the observed modal selling
-- prices (adiposg2 S$98, adiposg3 S$147, adiposg6 S$130).
update public.product_variants set currency_code = 'SGD', price = 98,  updated_at = now() where sku = 'ADI-SG-PK2' and currency_code <> 'SGD';
update public.product_variants set currency_code = 'SGD', price = 147, updated_at = now() where sku = 'ADI-SG-PK3' and currency_code <> 'SGD';
update public.product_variants set currency_code = 'SGD', price = 130, updated_at = now() where sku = 'ADI-SG-PK6' and currency_code <> 'SGD';

-- ── Data fix: canonical homes for promo/limited packages that really sold
-- but were missing from the July seed. Names and prices come from the
-- observed order lines (modal unit price, recognized orders only).
with targets(product_name, sku, vname, price, ccy) as (
  values
    ('Lipidri — Malaysia packages',   'LIP-MY-PK8',   'Promo 8 Botol (Anniversary)',      196::numeric, 'MYR'),
    ('Lipidri — Malaysia packages',   'LIP-MY-PK42G', 'Pakej 4+2 + Free Gift',            196, 'MYR'),
    ('Lipidri — Singapore packages',  'LIP-SG-PK8',   'Promo 8 Botol (Ramadhan)',         130, 'SGD'),
    ('Lipidri — Singapore packages',  'LIP-SG-PK42G', 'Pakej 4+2 + Free Gift',            130, 'SGD'),
    ('Synovil — Malaysia packages',   'SYN-MY-PK9',   'Anniversary Sale (9 Botol)',       196, 'MYR'),
    ('Synovil — Malaysia packages',   'SYN-MY-PK8',   'Promo Raya Haji (8 Botol)',        196, 'MYR'),
    ('Synovil — Singapore packages',  'SYN-SG-PK9',   'Anniversary Sale (9 Botol)',        99, 'SGD'),
    ('Synovil — Singapore packages',  'SYN-SG-PK8',   'Promo Raya Haji (8 Botol)',         99, 'SGD'),
    ('Adipocyde — Malaysia packages', 'ADI-MY-PK8',   'Promo 8 Kotak (Ramadan/Raya)',     196, 'MYR'),
    ('Adipocyde — Malaysia packages', 'ADI-MY-PK42T', 'Pakej 4+2 + Tumbler',              196, 'MYR'),
    ('Adipocyde — Singapore packages','ADI-SG-PK8',   'Promo 8 Kotak (Ramadan/Raya)',     130, 'SGD'),
    ('Adipocyde — Singapore packages','ADI-SG-PK42T', 'Pakej 4+2 + Tumbler',              130, 'SGD')
)
insert into public.product_variants (workspace_id, product_id, sku, name, price, currency_code, cost, stock_on_hand, status)
select p.workspace_id, p.id, t.sku, t.vname, t.price, t.ccy, null, 0, 'active'
from targets t
join public.products p on p.name = t.product_name
where not exists (select 1 from public.product_variants v where v.sku = t.sku);

-- ── Mapping queue now unions the PUBLISHED store catalog with sold lines,
-- so a new Woo product appears here before its first sale. Signature
-- changes, so drop-and-recreate.
drop function if exists public.live_sku_mapping_queue();
create function public.live_sku_mapping_queue()
returns table(
  integration_id bigint, brand_id bigint, market text, currency_code text,
  store_sku text, item_name text, units numeric, orders bigint, last_sold_at timestamptz,
  published boolean, store_price numeric, store_status text
)
language sql stable security invoker set search_path to ''
as $function$
  with sold as (
    select o.integration_id, it.sku,
           max(o.brand_id) as brand_id,
           max(o.currency_code) as ccy,
           (array_agg(it.name order by o.placed_at desc))[1] as item_name,
           sum(it.qty) as units,
           count(distinct o.id) as orders,
           max(o.placed_at) as last_sold_at
    from public.orders_read o
    cross join lateral (
      select e->>'sku' as sku, e->>'name' as name,
             coalesce(nullif(e->>'quantity','')::numeric, 1) as qty
      from jsonb_array_elements(o.items) e
    ) it
    where nullif(it.sku, '') is not null
    group by o.integration_id, it.sku
  ),
  published as (
    select wp.integration_id, wp.sku,
           (array_agg(wp.name order by wp.updated_at_source desc nulls last))[1] as name,
           (array_agg(wp.price order by wp.updated_at_source desc nulls last))[1] as price,
           (array_agg(wp.status order by wp.updated_at_source desc nulls last))[1] as status
    from public.woo_products_read wp
    where nullif(wp.sku, '') is not null and wp.status = 'publish'
    group by wp.integration_id, wp.sku
  ),
  merged as (
    select coalesce(s.integration_id, p.integration_id) as integration_id,
           coalesce(s.sku, p.sku) as sku,
           s.brand_id, s.ccy,
           coalesce(p.name, s.item_name) as item_name,
           coalesce(s.units, 0) as units,
           coalesce(s.orders, 0) as orders,
           s.last_sold_at,
           (p.sku is not null) as published,
           p.price as store_price,
           p.status as store_status
    from sold s
    full outer join published p
      on p.integration_id = s.integration_id and p.sku = s.sku
  )
  select m.integration_id, m.brand_id,
         coalesce(ic.config->>'country_code', '—') as market,
         coalesce(m.ccy, case when ic.config->>'country_code' = 'SG' then 'SGD' else 'MYR' end) as currency_code,
         m.sku, m.item_name, m.units, m.orders, m.last_sold_at,
         m.published, m.store_price, m.store_status
  from merged m
  join public.integration_connections ic on ic.id = m.integration_id
  where not exists (
    select 1 from public.variant_aliases va
    where va.integration_id = m.integration_id and va.alias = m.sku
  )
  order by m.units desc nulls last;
$function$;
revoke all on function public.live_sku_mapping_queue() from public, anon;
grant execute on function public.live_sku_mapping_queue() to authenticated, service_role;

-- ── live_merchandise: aliases now carry the store's published side of each
-- mapping (name, price, status) so the UI can show both truths and flag
-- price drift.
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
           jsonb_agg(jsonb_build_object(
             'integration_id', va.integration_id,
             'alias', va.alias,
             'store_name', wp.name,
             'store_price', wp.price,
             'store_status', wp.status
           ) order by va.alias) as aliases
    from public.variant_aliases va
    left join lateral (
      select w.name, w.price, w.status
      from public.woo_products_read w
      where w.integration_id = va.integration_id and w.sku = va.alias
      order by w.updated_at_source desc nulls last
      limit 1
    ) wp on true
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

-- ── Hourly mirror refresh (edge function woo-products-sync), offset from the
-- 15-minute orders cron.
select cron.schedule(
  'woo-products-sync-hourly',
  '40 * * * *',
  $cron$
  select net.http_post(
    url := 'https://wwgtjjekhehaepbxyrij.supabase.co/functions/v1/woo-products-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer sb_publishable_Wdp9R_p1SiVdgrKIQ8fLVA_aNekE-k6'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
  $cron$
);
