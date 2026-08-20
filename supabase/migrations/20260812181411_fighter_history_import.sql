-- Fighter-platform historical order import (2023-06 → 2026-06).
--
-- Two desktop export folders (EFFEN ALL, VISENA SDN BHD) share one 44-column
-- fighter-platform export schema; union after dedupe by the platform-global
-- Order ID is 223,669 orders. The fighter storefronts ARE the WooCommerce
-- stores we now sync live (verified: fighter 6515829 == adipocyde.com Woo
-- order 21000, same second/phone/total), but fighter Order ID ≠ per-store Woo
-- order id — so duplicates against live rows are matched by
-- (domain-mapped integration, placed_at ±3min, canonical phone), never by id.
-- Live Woo wins for the overlap; matched export rows stay in staging with the
-- matched orders_read.id as the phase-2 seller-attribution input.
--
-- Money caveat: export amounts are MYR-normalized even for SG stores
-- (Woo 130.00 SGD shows as 442 in the export), so every imported row is MYR.
--
-- This migration is DDL + function definitions only. Data flows later:
--   loader (scripts/fighter-history/load_fighter_history.py) → staging →
--   select * from private.fighter_import_run()  (manual, re-runnable).

-- ── Provenance column on orders_read ────────────────────────────────────────
-- Same convention as ad_daily_facts.source ('api'|'csv_export'|'legacy_seed').
-- woo-sync upserts an explicit column list, so live rows keep the default.

alter table public.orders_read
  add column if not exists source text not null default 'woo_api';

do $$
begin
  alter table public.orders_read
    add constraint orders_read_source_check
    check (source in ('woo_api', 'fighter_export'));
exception when duplicate_object then null;
end $$;

-- Purge/verification path only; the 'woo_api' majority stays unindexed.
create index if not exists orders_read_source_idx
  on public.orders_read (source) where source <> 'woo_api';

-- Duplicate-match probe: 6-minute placed_at window per staged row.
create index if not exists orders_read_integration_placed_idx
  on public.orders_read (integration_id, placed_at);

-- ── Staging table (full 44-column fidelity + transform bookkeeping) ────────
-- private schema: not exposed via PostgREST, service-role/psql writes only,
-- same posture as private.customers_read.

create table if not exists private.fighter_orders_staging (
  fighter_order_id  bigint primary key,          -- platform-global; dedupe key
  placed_at         timestamptz not null,        -- export Date, MYT → UTC in loader
  invoice_number    text,
  status            text not null,               -- Completed/Returned/Rejected/In Transit
  channel           text,
  channel_url       text,
  domain            text,                        -- lowercased host, 'www.' stripped
  seller_id         text,
  seller_name       text,
  seller_role       text,                        -- Sales Team/Leader/Fighter/Master Leader/Admin
  seller_code       text,
  customer_name     text,
  address           text,                        -- primary line (→ raw.billing.address_1)
  street_address    text,                        -- continuation (→ raw.billing.address_2)
  postcode          text,
  city              text,
  state             text,
  country           text,                        -- ISO-2 by loader: MY / SG
  email             text,                        -- lowercased by loader
  phone             text,                        -- digits-only by loader
  products_raw      text,
  skus_raw          text,
  items             jsonb not null default '[]', -- loader-parsed [{sku,name,quantity}]
  item_count        int,
  weight_g          numeric,
  payment_method    text,
  payment_url       text,
  payment_status    text,
  paid_at           timestamptz,
  shipping_provider text,
  pushed_date       timestamptz,
  tracking_number   text,
  tracking_confirmation_number text,
  coupon_code       text,
  points            numeric,
  cost              numeric(19,4),
  member_price      numeric(19,4),
  sales_commission  numeric(19,4),
  shipping_charge   numeric(19,4),
  cod_charge        numeric(19,4),
  gateway_charge    numeric(19,4),
  discount_coupon   numeric(19,4),
  discount_dynamic  numeric(19,4),
  selling_price     numeric(19,4),               -- order total, ALWAYS MYR
  completed_at      timestamptz,
  notes             text,
  -- load provenance
  source_entity     text not null,               -- canonical folder (EFFEN ALL preferred)
  source_entities   text[] not null,             -- both when the dup file pair existed
  source_file       text not null,
  loaded_at         timestamptz not null default now(),
  -- transform bookkeeping
  phone_norm        text generated always as (public.norm_phone(phone)) stored,
  mapped_integration_id bigint,                  -- live Woo connection for this domain
  brand_id          bigint,
  import_status     text not null default 'pending'
    check (import_status in ('pending', 'inserted', 'skipped_live_dup', 'error')),
  matched_order_read_id  bigint,                 -- live orders_read.id when skipped_live_dup
  match_time_diff_s numeric,
  imported_order_read_id bigint,                 -- new orders_read.id when inserted
  processed_at      timestamptz
);

create index if not exists fighter_staging_match_idx
  on private.fighter_orders_staging (mapped_integration_id, placed_at)
  where mapped_integration_id is not null;
create index if not exists fighter_staging_status_idx
  on private.fighter_orders_staging (import_status);

-- ── Archived brands for the defunct fighter-era portfolio ──────────────────
-- Major historical brands only (each ≥ ~1k orders in the exports); the long
-- tail of one-off domains keeps brand_id NULL — the domain always survives in
-- raw->'_fighter'->>'domain' so more brands can be backfilled later.

insert into public.brands (workspace_id, name, slug, category, status)
select w.id, b.name, b.slug, 'health', 'archived'
from (values
  ('OFICactus',      'oficactus'),
  ('Eraxtanol',      'eraxtanol'),
  ('Metaponin',      'metaponin'),
  ('Morosil',        'morosil'),
  ('Melasmacare',    'melasmacare'),
  ('Daravex',        'daravex'),
  ('Miroestro',      'miroestro'),
  ('Makcik Kaulawa', 'makcik-kaulawa'),
  ('TheTuneMind',    'tunemind')
) b(name, slug)
cross join (
  select workspace_id as id from public.integration_connections
  where provider = 'Fighter' limit 1
) w
on conflict (slug) do nothing;

-- ── Fighter OMS connection becomes the historical-import home ───────────────

update public.integration_connections
set status = 'healthy',
    notes  = 'Historical fighter-platform export import (2023-06 → 2026-06) via private.fighter_orders_staging; no live sync. Fighter order id = orders_read.source_order_id; provenance orders_read.source = fighter_export.'
where provider = 'Fighter';

-- ── Transform: staging → orders_read ────────────────────────────────────────
-- Manual, re-runnable: every pass only touches import_status = 'pending' rows
-- and stamps a terminal state, so re-invocation is a no-op on processed rows.
-- p_batch_limit chunks the expensive insert pass (identity expression index
-- maintenance) so it can be driven through clients with short statement
-- timeouts; NULL = single shot.

create or replace function private.fighter_import_run(
  p_in_transit_status text default 'completed',
  p_batch_limit int default null
)
returns table (staged bigint, matched bigint, inserted bigint, reconciled bigint, pending bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fighter_id   bigint;
  v_workspace_id bigint;
  v_staged bigint; v_matched bigint := 0; v_inserted bigint := 0; v_reconciled bigint := 0;
begin
  select ic.id, ic.workspace_id into strict v_fighter_id, v_workspace_id
  from public.integration_connections ic
  where ic.provider = 'Fighter';

  select count(*) into v_staged from private.fighter_orders_staging;

  -- Pass 0a: domain → live Woo integration (only these rows can be live dups).
  update private.fighter_orders_staging s
  set mapped_integration_id = ic.id
  from public.integration_connections ic
  where s.import_status = 'pending'
    and s.mapped_integration_id is null
    and s.domain is not null
    and ic.provider = 'WooCommerce'
    and lower(regexp_replace(coalesce(ic.config->>'base_url', ''),
                             '^https?://(www\.)?|/+$', '', 'g')) = s.domain;

  -- Pass 0b: domain → brand by containment (sgadipocydehq.com, hqoficactus.online,
  -- jusoficactus.com etc. all carry the brand key mid-string, so a prefix
  -- match is not enough). Keys are mutually exclusive across the portfolio.
  update private.fighter_orders_staging s
  set brand_id = m.brand_id
  from (
    select k.key, b.id as brand_id
    from (values
      ('synovil'), ('lipidri'), ('adipocyde'), ('cavernosil'),
      ('oficactus'), ('eraxtanol'), ('metaponin'), ('morosil'),
      ('melasmacare'), ('daravex'), ('miroestro'), ('kaulawa'), ('tunemind')
    ) k(key)
    join public.brands b
      on b.slug = case k.key when 'kaulawa' then 'makcik-kaulawa' else k.key end
  ) m
  where s.import_status = 'pending'
    and s.brand_id is null
    and s.domain is not null
    and position(m.key in s.domain) > 0;

  -- Pass 1: duplicate match against live Woo rows. Same store, placed_at
  -- within ±3 minutes (export MYT == live UTC+8h with ~1s skew), same
  -- canonical phone. Total is NOT compared (export is MYR, SG live is SGD);
  -- it only breaks nearest-time ties. Probes orders_read_integration_placed_idx
  -- per staged row — not O(n²).
  with cand as (
    select s.fighter_order_id, o.id as order_read_id,
           abs(extract(epoch from o.placed_at - s.placed_at)) as diff_s,
           row_number() over (
             partition by s.fighter_order_id
             order by abs(extract(epoch from o.placed_at - s.placed_at)),
                      (o.total = s.selling_price) desc
           ) as rn
    from private.fighter_orders_staging s
    join public.orders_read o
      on  o.integration_id = s.mapped_integration_id
      and o.source = 'woo_api'
      and o.placed_at >= s.placed_at - interval '3 minutes'
      and o.placed_at <= s.placed_at + interval '3 minutes'
      and public.norm_phone(o.customer->>'phone') = s.phone_norm
    where s.import_status = 'pending'
      and s.mapped_integration_id is not null
      and s.phone_norm is not null
  )
  update private.fighter_orders_staging s
  set matched_order_read_id = c.order_read_id,
      match_time_diff_s     = c.diff_s,
      import_status         = 'skipped_live_dup',
      processed_at          = now()
  from cand c
  where c.rn = 1 and s.fighter_order_id = c.fighter_order_id;
  get diagnostics v_matched = row_count;

  -- Pass 2: insert the remainder as fighter_export rows. customer/raw take the
  -- Woo shape identity_key()/norm_address() read; the full fighter row rides
  -- under raw._fighter (seller attribution, costs, commissions, tracking,
  -- source entity/file).
  with src as (
    select *
    from private.fighter_orders_staging
    where import_status = 'pending'
    order by fighter_order_id
    limit coalesce(p_batch_limit, 2147483647)
  ), ins as (
    insert into public.orders_read
      (workspace_id, integration_id, brand_id, source_order_id, order_number,
       source_status, currency_code, total, customer, items, raw,
       placed_at, updated_at_source, synced_at, source)
    select
      v_workspace_id, v_fighter_id, s.brand_id,
      s.fighter_order_id::text,
      coalesce(nullif(s.invoice_number, ''), s.fighter_order_id::text),
      case s.status
        when 'Completed'  then 'completed'
        when 'Returned'   then 'refunded'
        when 'Rejected'   then 'cancelled'
        when 'In Transit' then p_in_transit_status
        else lower(s.status)
      end,
      'MYR',
      coalesce(s.selling_price, 0),
      jsonb_strip_nulls(jsonb_build_object(
        'name',     nullif(s.customer_name, ''),
        'email',    nullif(s.email, ''),
        'phone',    nullif(s.phone, ''),
        'city',     nullif(s.city, ''),
        'postcode', nullif(s.postcode, ''),
        'country',  nullif(s.country, ''))),
      s.items,
      jsonb_build_object(
        'billing', a.addr,
        'shipping', a.addr,
        'payment_method',
          case when s.payment_method ilike 'cod%' then 'cod'
               else lower(regexp_replace(coalesce(s.payment_method, ''), '\s+', '_', 'g')) end,
        'payment_method_title', s.payment_method,
        '_fighter', jsonb_strip_nulls(jsonb_build_object(
          'order_id', s.fighter_order_id,
          'invoice_number', s.invoice_number,
          'status', s.status,
          'channel_url', s.channel_url,
          'domain', s.domain,
          'seller_id', s.seller_id,
          'seller_name', s.seller_name,
          'seller_role', s.seller_role,
          'seller_code', s.seller_code,
          'payment_status', s.payment_status,
          'paid_at', s.paid_at,
          'shipping_provider', s.shipping_provider,
          'pushed_date', s.pushed_date,
          'tracking_number', s.tracking_number,
          'tracking_confirmation_number', s.tracking_confirmation_number,
          'coupon_code', s.coupon_code,
          'points', s.points,
          'cost', s.cost,
          'member_price', s.member_price,
          'sales_commission', s.sales_commission,
          'shipping_charge', s.shipping_charge,
          'cod_charge', s.cod_charge,
          'gateway_charge', s.gateway_charge,
          'discount_coupon', s.discount_coupon,
          'discount_dynamic', s.discount_dynamic,
          'weight_g', s.weight_g,
          'item_count', s.item_count,
          'notes', s.notes,
          'source_entity', s.source_entity,
          'source_entities', to_jsonb(s.source_entities),
          'source_file', s.source_file))),
      s.placed_at,
      coalesce(s.completed_at, s.paid_at, s.placed_at),
      now(),
      'fighter_export'
    from src s
    cross join lateral (
      select jsonb_strip_nulls(jsonb_build_object(
        'first_name', nullif(s.customer_name, ''),
        'address_1',  nullif(s.address, ''),
        'address_2',  case when nullif(s.street_address, '') is not null
                            and (s.address is null
                                 or position(lower(s.street_address) in lower(s.address)) = 0)
                           then s.street_address end,
        'city',     nullif(s.city, ''),
        'state',    nullif(s.state, ''),
        'postcode', nullif(s.postcode, ''),
        'country',  nullif(s.country, ''),
        'phone',    nullif(s.phone, ''),
        'email',    nullif(s.email, ''))) as addr
    ) a
    on conflict (integration_id, source_order_id) do nothing
    returning id, source_order_id
  )
  update private.fighter_orders_staging s
  set imported_order_read_id = i.id,
      import_status          = 'inserted',
      processed_at           = now()
  from ins i
  where s.fighter_order_id::text = i.source_order_id
    and s.import_status = 'pending';
  get diagnostics v_inserted = row_count;

  -- Pass 3: adopt rows a prior partial run already inserted under the fighter
  -- connection (conflict-skipped above, so still pending here).
  update private.fighter_orders_staging s
  set imported_order_read_id = o.id,
      import_status          = 'inserted',
      processed_at           = now()
  from public.orders_read o
  where s.import_status = 'pending'
    and o.integration_id = v_fighter_id
    and o.source_order_id = s.fighter_order_id::text;
  get diagnostics v_reconciled = row_count;

  insert into public.audit_events (workspace_id, actor_label, action, entity_ref, detail)
  values (
    v_workspace_id, 'migration-backfill', 'orders.fighter_history_import',
    'integration:fighter-oms',
    format('staged %s; matched-to-live %s; inserted %s; reconciled %s; in_transit→%s',
           v_staged, v_matched, v_inserted, v_reconciled, p_in_transit_status)
  );

  return query
  select v_staged, v_matched, v_inserted, v_reconciled,
         (select count(*) from private.fighter_orders_staging
          where import_status = 'pending');
end;
$$;

revoke all on function private.fighter_import_run(text, int) from public, anon, authenticated;
