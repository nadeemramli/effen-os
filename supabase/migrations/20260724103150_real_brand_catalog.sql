-- Real EFFEN brand portfolio (from Finance's pricing sheet, Jul 2026):
-- Synovil, Lipidri, Adipocyde, Cavernosil — each with an MY and an SG site.
-- Demo brands are archived. Package prices load as product variants with
-- generated SKU codes (editable in Setup → Brands & catalog); costs and
-- stock are left for Finance/Ops to fill.
-- NOTE: adipocydesg.com prices are listed in RM in the source sheet —
-- loaded as MYR and flagged in the product description for confirmation.

-- 1. Archive demo brands (and their stores below); normalize Lipidri.
update public.brands set status = 'archived' where slug in ('verdana-botanics', 'nara-coffee', 'solstice-living');
update public.stores set status = 'archived'
where brand_id in (select id from public.brands where status = 'archived')
   or domain in ('lipidri.example');
update public.brands set name = 'Lipidri', slug = 'lipidri', category = 'Health supplements' where slug = 'lipidri-my';

-- 2. Real brands.
insert into public.brands (workspace_id, default_legal_entity_id, name, slug, category, is_demo, status)
select w.id,
       (select le.id from public.legal_entities le where le.country_code = 'MY' limit 1),
       v.name, v.slug, 'Health supplements', false, 'active'
from public.workspaces w,
  (values ('Synovil', 'synovil'), ('Adipocyde', 'adipocyde'), ('Cavernosil', 'cavernosil')) as v (name, slug)
where w.name = 'EFFEN International Sdn Bhd'
on conflict (slug) do nothing;

-- 3. Stores: one per site.
insert into public.stores (workspace_id, brand_id, legal_entity_id, name, channel_type, source_type, domain, country_code, currency_code)
select
  w.id,
  (select b.id from public.brands b where b.slug = v.brand_slug),
  (select le.id from public.legal_entities le where le.country_code = v.country limit 1),
  v.name, 'website', 'woocommerce', v.domain, v.country, v.currency
from public.workspaces w,
  (values
    ('lipidri',    'Lipidri MY (lipidri.my)',        'lipidri.my',      'MY', 'MYR'),
    ('lipidri',    'Lipidri SG (lipidrisg.com)',     'lipidrisg.com',   'SG', 'SGD'),
    ('synovil',    'Synovil MY (synovil.com)',       'synovil.com',     'MY', 'MYR'),
    ('synovil',    'Synovil SG (synovilsg.com)',     'synovilsg.com',   'SG', 'SGD'),
    ('adipocyde',  'Adipocyde MY (adipocyde.com)',   'adipocyde.com',   'MY', 'MYR'),
    ('adipocyde',  'Adipocyde SG (adipocydesg.com)', 'adipocydesg.com', 'SG', 'MYR'),
    ('cavernosil', 'Cavernosil MY (cavernosil.com)', 'cavernosil.com',  'MY', 'MYR'),
    ('cavernosil', 'Cavernosil SG (cavernosilsg.com)','cavernosilsg.com','SG', 'SGD')
  ) as v (brand_slug, name, domain, country, currency)
where w.name = 'EFFEN International Sdn Bhd';

-- 4. Package products + variants per brand-market.
with ws as (select id from public.workspaces where name = 'EFFEN International Sdn Bhd'),
prods as (
  insert into public.products (workspace_id, brand_id, name, category, description)
  select (select id from ws),
         (select b.id from public.brands b where b.slug = v.brand_slug),
         v.pname, 'Packages', v.descr
  from (values
    ('lipidri',    'Lipidri — Malaysia packages',    'Package pricing from lipidri.my.'),
    ('lipidri',    'Lipidri — Singapore packages',   'Package pricing from lipidrisg.com.'),
    ('synovil',    'Synovil — Malaysia packages',    'Package pricing from synovil.com.'),
    ('synovil',    'Synovil — Singapore packages',   'Package pricing from synovilsg.com.'),
    ('adipocyde',  'Adipocyde — Malaysia packages',  'Package pricing from adipocyde.com.'),
    ('adipocyde',  'Adipocyde — Singapore packages', 'Package pricing from adipocydesg.com. Prices listed in RM in the source sheet — confirm currency.'),
    ('cavernosil', 'Cavernosil — Malaysia packages', 'Package pricing from cavernosil.com.'),
    ('cavernosil', 'Cavernosil — Singapore packages','Package pricing from cavernosilsg.com.')
  ) as v (brand_slug, pname, descr)
  returning id, name
)
insert into public.product_variants (workspace_id, product_id, sku, name, price, currency_code)
select (select id from ws), (select p.id from prods p where p.name = v.pname), v.sku, v.vname, v.price, v.currency
from (values
  -- Lipidri MY (lipidri.my)
  ('Lipidri — Malaysia packages',    'LIP-MY-PK1',      'Pakej 1',        49.00,  'MYR'),
  ('Lipidri — Malaysia packages',    'LIP-MY-PK1N',     'Pakej 1N',       78.00,  'MYR'),
  ('Lipidri — Malaysia packages',    'LIP-MY-PK2',      'Pakej 2',        98.00,  'MYR'),
  ('Lipidri — Malaysia packages',    'LIP-MY-PK3',      'Pakej 3',        147.00, 'MYR'),
  ('Lipidri — Malaysia packages',    'LIP-MY-PK42',     'Pakej 4+2',      196.00, 'MYR'),
  -- Lipidri SG (lipidrisg.com)
  ('Lipidri — Singapore packages',   'LIP-SG-PK2',      'Pakej 2',        79.00,  'SGD'),
  ('Lipidri — Singapore packages',   'LIP-SG-PK3',      'Pakej 3',        110.00, 'SGD'),
  ('Lipidri — Singapore packages',   'LIP-SG-PK6',      'Pakej 6',        130.00, 'SGD'),
  -- Synovil MY (synovil.com)
  ('Synovil — Malaysia packages',    'SYN-MY-PK1',      'Pakej 1',        49.00,  'MYR'),
  ('Synovil — Malaysia packages',    'SYN-MY-PK1N',     'Pakej 1N',       78.00,  'MYR'),
  ('Synovil — Malaysia packages',    'SYN-MY-PK2',      'Pakej 2',        98.00,  'MYR'),
  ('Synovil — Malaysia packages',    'SYN-MY-PK3',      'Pakej 3',        147.00, 'MYR'),
  ('Synovil — Malaysia packages',    'SYN-MY-PK42',     'Pakej 4+2',      196.00, 'MYR'),
  -- Synovil SG (synovilsg.com)
  ('Synovil — Singapore packages',   'SYN-SG-PK2',      'Pakej 2',        79.00,  'SGD'),
  ('Synovil — Singapore packages',   'SYN-SG-PK3',      'Pakej 3',        110.00, 'SGD'),
  ('Synovil — Singapore packages',   'SYN-SG-PK6',      'Pakej 6',        130.00, 'SGD'),
  ('Synovil — Singapore packages',   'SYN-SG-PK1N',     'Pakej 1N (59)',  59.00,  'SGD'),
  ('Synovil — Singapore packages',   'SYN-SG-PK2N',     'Pakej 2N (89)',  89.00,  'SGD'),
  ('Synovil — Singapore packages',   'SYN-SG-PK1N-COD', 'Pakej 1N + COD (69)', 69.00, 'SGD'),
  ('Synovil — Singapore packages',   'SYN-SG-PK2N-COD', 'Pakej 2N + COD (99)', 99.00, 'SGD'),
  ('Synovil — Singapore packages',   'SYN-SG-PK6N',     'Pakej 6N (99)',  99.00,  'SGD'),
  ('Synovil — Singapore packages',   'SYN-SG-PK6N-COD', 'Pakej 6N + COD (109)', 109.00, 'SGD'),
  -- Adipocyde MY (adipocyde.com)
  ('Adipocyde — Malaysia packages',  'ADI-MY-PK1',      'Pakej 1',        78.00,  'MYR'),
  ('Adipocyde — Malaysia packages',  'ADI-MY-PK2',      'Pakej 2',        98.00,  'MYR'),
  ('Adipocyde — Malaysia packages',  'ADI-MY-PK3',      'Pakej 3',        147.00, 'MYR'),
  ('Adipocyde — Malaysia packages',  'ADI-MY-PK42',     'Pakej 4+2',      196.00, 'MYR'),
  -- Adipocyde SG (adipocydesg.com) — RM per source sheet
  ('Adipocyde — Singapore packages', 'ADI-SG-PK2',      'Pakej 2',        249.71, 'MYR'),
  ('Adipocyde — Singapore packages', 'ADI-SG-PK3',      'Pakej 3',        347.70, 'MYR'),
  ('Adipocyde — Singapore packages', 'ADI-SG-PK6',      'Pakej 6',        410.92, 'MYR'),
  -- Cavernosil MY (cavernosil.com)
  ('Cavernosil — Malaysia packages', 'CAV-MY-PK1',      'Pakej 1',        98.00,  'MYR'),
  ('Cavernosil — Malaysia packages', 'CAV-MY-PK2',      'Pakej 2',        147.00, 'MYR'),
  ('Cavernosil — Malaysia packages', 'CAV-MY-PK31',     'Pakej 3+1',      196.00, 'MYR'),
  -- Cavernosil SG (cavernosilsg.com)
  ('Cavernosil — Singapore packages','CAV-SG-PK1',      'Pakej 1',        79.00,  'SGD'),
  ('Cavernosil — Singapore packages','CAV-SG-PK2',      'Pakej 2',        110.00, 'SGD'),
  ('Cavernosil — Singapore packages','CAV-SG-PK4',      'Pakej 4',        130.00, 'SGD')
) as v (pname, sku, vname, price, currency);

-- 5. Woo connections: one per site, domains prefilled — only keys are needed.
delete from public.integration_connections
where provider = 'WooCommerce' and secret_ref in ('WOO_VERDANA', 'WOO_NARA', 'WOO_SOLSTICE');

update public.integration_connections
set name = 'WooCommerce — Lipidri MY (lipidri.my)',
    config = jsonb_build_object('brand_slug', 'lipidri', 'base_url', 'https://lipidri.my'),
    notes = 'Paste the read-only REST key from lipidri.my in Setup → Store connections.'
where secret_ref = 'WOO_LIPIDRI_MY';

insert into public.integration_connections
  (workspace_id, provider, name, category, direction, read_scopes, secret_ref, status, freshness_sla_minutes, config, notes)
select w.id, 'WooCommerce', v.name, 'commerce', 'read', array['orders.read'], v.secret_ref, 'pending_setup', 15,
       jsonb_build_object('brand_slug', v.brand_slug, 'base_url', v.base_url),
       'Paste the read-only REST key from ' || replace(v.base_url, 'https://', '') || ' in Setup → Store connections.'
from public.workspaces w,
  (values
    ('WooCommerce — Lipidri SG (lipidrisg.com)',      'WOO_LIPIDRI_SG',    'lipidri',    'https://lipidrisg.com'),
    ('WooCommerce — Synovil MY (synovil.com)',        'WOO_SYNOVIL_MY',    'synovil',    'https://synovil.com'),
    ('WooCommerce — Synovil SG (synovilsg.com)',      'WOO_SYNOVIL_SG',    'synovil',    'https://synovilsg.com'),
    ('WooCommerce — Adipocyde MY (adipocyde.com)',    'WOO_ADIPOCYDE_MY',  'adipocyde',  'https://adipocyde.com'),
    ('WooCommerce — Adipocyde SG (adipocydesg.com)',  'WOO_ADIPOCYDE_SG',  'adipocyde',  'https://adipocydesg.com'),
    ('WooCommerce — Cavernosil MY (cavernosil.com)',  'WOO_CAVERNOSIL_MY', 'cavernosil', 'https://cavernosil.com'),
    ('WooCommerce — Cavernosil SG (cavernosilsg.com)','WOO_CAVERNOSIL_SG', 'cavernosil', 'https://cavernosilsg.com')
  ) as v (name, secret_ref, brand_slug, base_url)
where w.name = 'EFFEN International Sdn Bhd';
