-- Live Woo wiring + demo purge (2026-07-31).
-- All eight real store domains verified live via authenticated probes:
--   synovil.com, synovilsg.com, lipidri.com, lipidrisg.com,
--   adipocyde.com, adipocydesg.com, cavernosil.com, cavernosilsg.com
-- lipidri.my (seeded in 20260724000009) does not resolve — the live MY store
-- is lipidri.com. Consumer keys live in Vault (WOO_*_KEY / WOO_*_SECRET),
-- written via the setup path — never in migrations.
-- Idempotent: safe to re-run against a database where this already applied.

-- 1. Lipidri MY domain correction.
update public.integration_connections
set name = 'WooCommerce — Lipidri MY (lipidri.com)',
    config = jsonb_set(config, '{base_url}', to_jsonb('https://lipidri.com'::text)),
    notes = 'Domain corrected from lipidri.my (dead) to lipidri.com (verified live).'
where secret_ref = 'WOO_LIPIDRI_MY';

update public.stores set name = 'Lipidri MY (lipidri.com)', domain = 'lipidri.com'
where domain = 'lipidri.my';

update public.products set description = replace(description, 'lipidri.my', 'lipidri.com')
where description like '%lipidri.my%';

-- 2. Remove demo brands and everything hanging off them. The prototype's
-- synthetic brands have no place in the live workspace now that real
-- brand/order data is flowing.
with demo_brands as (
  select id from public.brands where slug in ('verdana-botanics','nara-coffee','solstice-living')
)
, d1 as (delete from public.integration_account_mappings where brand_id in (select id from demo_brands))
, d2 as (delete from public.membership_brand_scopes where brand_id in (select id from demo_brands))
, d3 as (delete from public.orders_read where brand_id in (select id from demo_brands))
, d4 as (delete from public.wa_numbers where brand_id in (select id from demo_brands))
, d5 as (delete from public.product_variants where product_id in
          (select id from public.products where brand_id in (select id from demo_brands)))
, d6 as (delete from public.products where brand_id in (select id from demo_brands))
, d7 as (delete from public.stores where brand_id in (select id from demo_brands))
select 1;

delete from public.stores where domain = 'lipidri.example';
delete from public.brands where slug in ('verdana-botanics','nara-coffee','solstice-living');

-- 3. Legal entities: drop demo markers; real registration numbers pending.
update public.legal_entities set legal_name = 'EFFEN Commerce Pte Ltd', registration_number = null
where legal_name = 'EFFEN Commerce Pte Ltd (Demo)';
update public.legal_entities set registration_number = null where registration_number like '%(DEMO)%';
