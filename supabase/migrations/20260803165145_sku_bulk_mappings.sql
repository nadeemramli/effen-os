-- Bulk-map all 41 published store SKUs to canonical variants.
-- Evidence per row: brand (store domain), currency, current published price,
-- and modal sold price agree with the canonical target. Register for admin
-- confirmation: docs/ops/sku-mapping-register.md. Every row is marked
-- pending-admin-confirmation in created_by; remaps stay one UPSERT away.

-- ── Canonical corrections surfaced by the channel mirror ────────────────────
-- Promo SKUs are reused vehicles (syn08 sold as "Promo Raya Haji", now
-- publishes as "Payday Sale") — name the canonical variants seasonally
-- generic so they survive the next campaign rename.
update public.product_variants set name = 'Seasonal Promo (8 Botol)', updated_at = now() where sku in ('SYN-MY-PK8', 'SYN-SG-PK8', 'LIP-SG-PK8');
update public.product_variants set name = 'Seasonal Promo (8 Kotak)', updated_at = now() where sku in ('ADI-MY-PK8', 'ADI-SG-PK8');

-- Align canonical reference prices with the CURRENT published channel price
-- (historical order revenue is untouched — line totals come from orders).
update public.product_variants set price = 147, updated_at = now() where sku = 'SYN-SG-PK3' and price <> 147; -- seeded 110; store publishes & sells 147
update public.product_variants set price = 79,  updated_at = now() where sku = 'ADI-SG-PK2' and price <> 79;  -- history sold 98; store moved to 79
update public.product_variants set price = 110, updated_at = now() where sku = 'ADI-SG-PK3' and price <> 110; -- history sold 147; store moved to 110

-- ── The 41 mappings ─────────────────────────────────────────────────────────
with pairs(base_url, alias, canonical_sku) as (
  values
    -- Lipidri MY
    ('https://lipidri.com',      'lip01',      'LIP-MY-PK1'),
    ('https://lipidri.com',      'lip01n',     'LIP-MY-PK1N'),
    ('https://lipidri.com',      'lip02',      'LIP-MY-PK2'),
    ('https://lipidri.com',      'lip03',      'LIP-MY-PK3'),
    ('https://lipidri.com',      'lip04',      'LIP-MY-PK42'),
    ('https://lipidri.com',      'lip06f',     'LIP-MY-PK42G'),
    ('https://lipidri.com',      'lip08',      'LIP-MY-PK8'),
    -- Lipidri SG
    ('https://lipidrisg.com',    'lip02sg',    'LIP-SG-PK2'),
    ('https://lipidrisg.com',    'lip03sg',    'LIP-SG-PK3'),
    ('https://lipidrisg.com',    'lip06sg',    'LIP-SG-PK6'),
    ('https://lipidrisg.com',    'lip08sg',    'LIP-SG-PK8'),
    ('https://lipidrisg.com',    'lipsg06f',   'LIP-SG-PK42G'),
    -- Synovil MY
    ('https://synovil.com',      '9botol',     'SYN-MY-PK9'),
    ('https://synovil.com',      'syn01n',     'SYN-MY-PK1N'),
    ('https://synovil.com',      'syn02',      'SYN-MY-PK2'),
    ('https://synovil.com',      'syn03',      'SYN-MY-PK3'),
    ('https://synovil.com',      'syn04',      'SYN-MY-PK42'),
    ('https://synovil.com',      'syn08',      'SYN-MY-PK8'),
    -- Synovil SG
    ('https://synovilsg.com',    '9botolsg',   'SYN-SG-PK9'),
    ('https://synovilsg.com',    'syn08sg',    'SYN-SG-PK8'),
    ('https://synovilsg.com',    'syn1nsg',    'SYN-SG-PK1N'),
    ('https://synovilsg.com',    'syn2nsg',    'SYN-SG-PK2N'),
    ('https://synovilsg.com',    'syn6nsg',    'SYN-SG-PK6N'),
    ('https://synovilsg.com',    'synovil03',  'SYN-SG-PK3'),
    -- Adipocyde MY
    ('https://adipocyde.com',    'adi06f',     'ADI-MY-PK42T'),
    ('https://adipocyde.com',    'adipocyde1', 'ADI-MY-PK1'),
    ('https://adipocyde.com',    'adipocyde2', 'ADI-MY-PK2'),
    ('https://adipocyde.com',    'adipocyde3', 'ADI-MY-PK3'),
    ('https://adipocyde.com',    'adipocyde6', 'ADI-MY-PK42'),
    ('https://adipocyde.com',    'adipocyde8', 'ADI-MY-PK8'),
    -- Adipocyde SG
    ('https://adipocydesg.com',  'adiposg2',   'ADI-SG-PK2'),
    ('https://adipocydesg.com',  'adiposg3',   'ADI-SG-PK3'),
    ('https://adipocydesg.com',  'adiposg6',   'ADI-SG-PK6'),
    ('https://adipocydesg.com',  'adiposg8',   'ADI-SG-PK8'),
    ('https://adipocydesg.com',  'adisg06f',   'ADI-SG-PK42T'),
    -- Cavernosil MY
    ('https://cavernosil.com',   'cave01',     'CAV-MY-PK1'),
    ('https://cavernosil.com',   'cave02',     'CAV-MY-PK2'),
    ('https://cavernosil.com',   'cave04',     'CAV-MY-PK31'),
    -- Cavernosil SG
    ('https://cavernosilsg.com', 'cave01sg',   'CAV-SG-PK1'),
    ('https://cavernosilsg.com', 'cave02sg',   'CAV-SG-PK2'),
    ('https://cavernosilsg.com', 'cave04sg',   'CAV-SG-PK4')
)
insert into public.variant_aliases (workspace_id, integration_id, alias, variant_id, created_by)
select v.workspace_id, ic.id, pr.alias, v.id,
       'Fullkit assistant — bulk-mapped from price/name evidence, pending admin confirmation'
from pairs pr
join public.integration_connections ic on ic.config->>'base_url' = pr.base_url
join public.product_variants v on v.sku = pr.canonical_sku
on conflict (workspace_id, integration_id, alias) do nothing;

insert into public.audit_events (workspace_id, actor_label, action, entity_ref, detail)
select min(workspace_id), 'Fullkit assistant', 'catalog.sku_mapped', 'catalog:bulk',
       'Bulk-mapped ' || count(*) || ' store SKUs to canonical variants from price/name evidence. Register: docs/ops/sku-mapping-register.md — pending admin confirmation.'
from public.variant_aliases;
