-- EFFEN workspace metadata seed (Slice 1).
-- Governance/metadata rows only — mirrors apps/web/src/lib/seed identifiers by
-- slug/name lookups (no hardcoded generated IDs). Commercial facts (orders,
-- payments, shipments) intentionally stay out of Supabase per the Technical
-- Architecture: it must not become a second authority for operational truth.

with ws as (
  insert into public.workspaces (name, timezone, base_currency_code)
  values ('EFFEN International Sdn Bhd', 'Asia/Kuala_Lumpur', 'MYR')
  returning id
),
les as (
  insert into public.legal_entities (workspace_id, legal_name, registration_number, country_code, default_currency_code)
  select ws.id, v.legal_name, v.registration_number, v.country_code, v.currency
  from ws,
    (values
      ('EFFEN International Sdn Bhd', '202501000001 (DEMO)', 'MY', 'MYR'),
      ('EFFEN Commerce Pte Ltd (Demo)', '202500002D (DEMO)', 'SG', 'SGD')
    ) as v (legal_name, registration_number, country_code, currency)
  returning id, country_code
),
b as (
  insert into public.brands (workspace_id, default_legal_entity_id, name, slug, category, is_demo, status)
  select
    ws.id,
    (select id from les where country_code = v.country limit 1),
    v.name, v.slug, v.category, v.is_demo, 'active'
  from ws,
    (values
      ('Lipidri MY', 'lipidri-my', 'Health supplements', false, 'MY'),
      ('Verdana Botanics (Demo)', 'verdana-botanics', 'Skincare', true, 'MY'),
      ('Nara Coffee Co. (Demo)', 'nara-coffee', 'F&B — coffee', true, 'MY'),
      ('Solstice Living (Demo)', 'solstice-living', 'Home & living', true, 'SG')
    ) as v (name, slug, category, is_demo, country)
  returning id, slug
)
insert into public.stores (workspace_id, brand_id, legal_entity_id, name, channel_type, source_type, domain, country_code, currency_code)
select
  (select id from ws),
  (select id from b where slug = v.brand_slug),
  (select le.id from les le where le.country_code = v.country limit 1),
  v.name, v.channel_type, v.source_type, v.domain, v.country, v.currency
from (values
  ('lipidri-my', 'Lipidri Web Store', 'website', 'woocommerce', 'lipidri.example', 'MY', 'MYR'),
  ('lipidri-my', 'Lipidri Shopee MY', 'marketplace', 'shopee', null, 'MY', 'MYR'),
  ('lipidri-my', 'Lipidri TikTok Shop', 'marketplace', 'tiktok_shop', null, 'MY', 'MYR'),
  ('lipidri-my', 'Lipidri WhatsApp CS', 'conversation', 'whatsapp', null, 'MY', 'MYR'),
  ('verdana-botanics', 'Verdana Web Store', 'website', 'woocommerce', 'verdana.example', 'MY', 'MYR'),
  ('verdana-botanics', 'Verdana Lazada MY', 'marketplace', 'lazada', null, 'MY', 'MYR'),
  ('nara-coffee', 'Nara Web Store', 'website', 'woocommerce', 'naracoffee.example', 'MY', 'MYR'),
  ('solstice-living', 'Solstice Web Store', 'website', 'woocommerce', 'solsticeliving.example', 'SG', 'SGD')
) as v (brand_slug, name, channel_type, source_type, domain, country, currency);

-- Integration registry (metadata only; secret_ref names a secrets-manager
-- entry — credentials never live in this database).
insert into public.integration_connections
  (workspace_id, provider, name, category, direction, read_scopes, write_scopes, secret_ref, status, freshness_sla_minutes, notes)
select w.id, v.provider, v.name, v.category, v.direction, v.read_scopes, v.write_scopes, v.secret_ref, 'pending_setup', v.sla, v.notes
from public.workspaces w,
  (values
    ('Fighter', 'Fighter OMS', 'commerce', 'read', array['orders.read','customers.read','products.read'], array[]::text[], 'gsm://fighter-api-key', 30, 'Shadow read-side; Fighter stays the system of record for Lipidri orders.'),
    ('WooCommerce', 'WooCommerce / Novomira', 'commerce', 'read', array['orders.read','products.read'], array[]::text[], 'gsm://woo-consumer-key', 15, null),
    ('Meta', 'Meta Ads', 'ads', 'read', array['ads_read','insights.read'], array[]::text[], 'gsm://meta-system-user-token', 180, 'Write scopes require separate approval.'),
    ('Google', 'Google Ads', 'ads', 'read', array['adwords.readonly'], array[]::text[], 'gsm://google-ads-oauth', 240, null),
    ('TikTok', 'TikTok Ads / Shop', 'ads', 'read', array['ads.read','shop.orders.read'], array[]::text[], 'gsm://tiktok-oauth', 240, null),
    ('Shopee', 'Shopee MY', 'marketplace', 'read', array['orders.read','listings.read'], array[]::text[], 'gsm://shopee-oauth', 60, null),
    ('Lazada', 'Lazada MY', 'marketplace', 'read', array['orders.read'], array[]::text[], 'gsm://lazada-oauth', 60, null),
    ('Chip', 'Chip (Payments)', 'payments', 'read', array['payments.read','settlements.read'], array[]::text[], 'gsm://chip-api-key', 60, null),
    ('Stripe', 'Stripe (Payments)', 'payments', 'read', array['charges.read','payouts.read'], array[]::text[], 'gsm://stripe-restricted-key', 60, 'HitPay and Billplz queued for connection.'),
    ('Ninja Van', 'Ninja Van', 'logistics', 'read_write', array['tracking.read'], array['orders.create'], 'gsm://ninjavan-oauth', 120, null),
    ('J&T', 'J&T Express', 'logistics', 'read_write', array['tracking.read'], array['consignment.create'], 'gsm://jnt-api-key', 120, null),
    ('RudderStack', 'RudderStack CDP', 'cdp', 'read', array['profiles.read','events.read'], array[]::text[], 'gsm://rudderstack-token', 360, null),
    ('Prophit', 'Prophit / Growth Engine', 'analytics', 'read', array['recommendations.read','diagnoses.read','expectations.read'], array[]::text[], 'gsm://prophit-feed-key', 360, 'Read-side import; Fullkit owns assignment, approval, and outcomes.'),
    ('SQL Accounting', 'SQL Accounting', 'accounting', 'write', array[]::text[], array['journal.export'], 'gsm://sqlacc-export', 10080, 'Export bridge only — SQL Accounting remains the authoritative ledger.')
  ) as v (provider, name, category, direction, read_scopes, write_scopes, secret_ref, sla, notes)
where w.name = 'EFFEN International Sdn Bhd';

-- Governed metric definitions.
insert into public.metric_definitions (workspace_id, metric_key, name, formula, grain, quality, caveat)
select w.id, v.metric_key, v.name, v.formula, v.grain, v.quality, v.caveat
from public.workspaces w,
  (values
    ('net_revenue', 'Net revenue', 'Σ order grand total − refunds, approved/completed orders only', 'order → day × brand × store', 'monitored', null),
    ('contribution', 'Contribution', 'Net revenue − COGS − fulfilment − gateway fees − commissions − ad spend', 'order → day × brand', 'monitored', 'Commission rates are contract estimates until settlement files reconcile.'),
    ('cogs', 'COGS', 'Σ variant cost (current cost version) × quantity', 'order line', 'monitored', 'Cost versions update monthly from SQL Accounting export.'),
    ('ad_spend', 'Ad spend', 'Σ platform-reported spend across connected ad accounts', 'day × platform × campaign', 'trusted', 'Platform D-1 finalisation — today is provisional.'),
    ('blended_mer', 'Blended MER', 'Net revenue ÷ ad spend', 'day × brand', 'monitored', 'Efficiency guardrail, not incrementality.'),
    ('amer', 'aMER (acquisition MER)', 'New-customer net revenue ÷ ad spend', 'day × brand', 'monitored', 'Depends on identity stitching freshness.'),
    ('orders', 'Orders', 'Count of non-draft, non-cancelled orders by placed time', 'day × brand × store', 'monitored', null),
    ('new_customer_mix', 'New-customer mix', 'New-customer orders ÷ total orders', 'day × brand', 'monitored', null),
    ('target_variance', 'Target variance', '(Actual − plan) ÷ plan, plan = Prophit daily expectation', 'day × brand', 'trusted', null)
  ) as v (metric_key, name, formula, grain, quality, caveat)
where w.name = 'EFFEN International Sdn Bhd';
