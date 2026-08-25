-- Applied 2026-08-25 via MCP apply_migration; filed under the recorded version 20260825075212.
-- production_inventory_marketplace_v1 — Phase 7 of the operational-workspaces program.
--
-- Registries and evidence only. No stock level changes, no inventory
-- movements, no marketplace connector call and no WhatsApp send. Every
-- command below records intent or master data and is audited.
--
-- 1. product_pack_configurations — versioned pack master per sellable variant
--    (intake/production plan §3.2). Seeded as DRAFT v1 from
--    product_variants.units_per_pack ("N base units per package"); the governed
--    capsule/sachet configuration replaces it through save + approve.
-- 2. inventory_locations (logical, plan §2.3) and inventory_items — introduced
--    under the S3 migration rule: finished goods mirror product_variants 1:1,
--    identity only. Stock levels stay on product_variants.stock_on_hand; no
--    inventory_levels / inventory_movements exist yet, so there is no second
--    stock truth to drift.
-- 3. marketplace_accounts (per-account registry with cutover_mode) and
--    marketplace_listings (mapping grain listing × variation → variant → item).
--    Seeded from docs/ops/marketplace-onboarding-plan.md. ADR-0009: read
--    scopes only; pilot_write / live are refused by the command.
-- 4. wa_observations — immutable observation record for factory WhatsApp
--    updates (plan §5.3), fed from the existing wa_messages inbox every 15
--    minutes; no parser yet, everything lands in unlinked_review. Reviewing an
--    observation links it to a production item; it never posts stock.
-- 5. channel_publishable_qty(...) — the plan §6.6 formula as a pure function;
--    its inputs (reservations, quarantine, buffers) do not exist yet, so the
--    registry reports inputs_available = false rather than a number.
--
-- Additive only. No table is dropped and no applied migration is edited.

------------------------------------------------------------------------
-- 1. Pack configurations
------------------------------------------------------------------------
create table if not exists public.product_pack_configurations (
  id bigserial primary key,
  workspace_id bigint not null references public.workspaces(id),
  variant_id bigint not null references public.product_variants(id),
  version integer not null,
  presentation_type text not null check (presentation_type in ('capsule_bottle', 'sachet_box', 'bundle', 'other')),
  sellable_uom text not null default 'pack',
  contained_unit_type text not null check (contained_unit_type in ('capsule', 'sachet', 'bottle', 'box', 'unit')),
  contained_units_per_pack integer not null check (contained_units_per_pack > 0),
  content_per_unit text,
  recommended_units_per_day numeric check (recommended_units_per_day is null or recommended_units_per_day > 0),
  nominal_days_supply numeric check (nominal_days_supply is null or nominal_days_supply > 0),
  packaging_bom_version text,
  effective_from date not null default current_date,
  effective_to date,
  status text not null default 'draft' check (status in ('draft', 'approved', 'superseded', 'rejected')),
  note text,
  created_by text,
  approved_by text,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (variant_id, version),
  check (effective_to is null or effective_to > effective_from)
);
create index if not exists ppc_variant_status_idx on public.product_pack_configurations (variant_id, status);
comment on table public.product_pack_configurations is 'Versioned pack master per sellable variant. Only one approved row per variant at a time; approving supersedes the previous approved row. Drives production/packaging requirements, WIP→sellable conversion, channel stock and the CRM depletion window — never rewritten in place.';

------------------------------------------------------------------------
-- 2. Inventory registry (S3 migration rule)
------------------------------------------------------------------------
create table if not exists public.inventory_locations (
  id bigserial primary key,
  workspace_id bigint not null references public.workspaces(id),
  key text not null,
  name text not null,
  location_type text not null check (location_type in ('factory_wip', 'factory_released', 'in_transit', 'warehouse_receiving', 'warehouse_quarantine', 'warehouse_wip', 'warehouse_packaging', 'warehouse_finished', 'fulfilment_staging', 'returns_quarantine')),
  factory text,
  authority_system text not null default 'none' check (authority_system in ('none', 'fullkit', 'external_wms', 'fighter')),
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (workspace_id, key)
);

create table if not exists public.inventory_items (
  id bigserial primary key,
  workspace_id bigint not null references public.workspaces(id),
  item_type text not null check (item_type in ('raw_material', 'bulk_compound', 'wip', 'packaging', 'finished_good', 'fulfilment_material')),
  name text not null,
  uom text not null default 'each',
  variant_id bigint unique references public.product_variants(id),
  production_item_id bigint references public.production_items(id),
  status text not null default 'active',
  created_at timestamptz not null default now(),
  check (item_type <> 'finished_good' or variant_id is not null)
);
comment on table public.inventory_items is 'Item master introduced under the S3 migration rule: identity only. Finished goods mirror product_variants 1:1; stock levels remain on product_variants.stock_on_hand until an inventory authority (levels + append-only movements) exists.';

------------------------------------------------------------------------
-- 3. Marketplace registry
------------------------------------------------------------------------
create table if not exists public.marketplace_accounts (
  id bigserial primary key,
  workspace_id bigint not null references public.workspaces(id),
  integration_id bigint references public.integration_connections(id),
  platform text not null check (platform in ('shopee', 'tiktok_shop', 'lazada')),
  account_label text not null,
  account_ref text,
  legal_entity_id bigint references public.legal_entities(id),
  brand_id bigint references public.brands(id),
  market text not null,
  currency_code text not null,
  timezone text not null default 'Asia/Kuala_Lumpur',
  scopes_requested text[] not null default '{}',
  scopes_granted text[] not null default '{}',
  approval_state text not null default 'not_submitted' check (approval_state in ('not_submitted', 'in_progress', 'submitted', 'approved', 'rejected')),
  app_state text,
  webhook_subscribed boolean not null default false,
  polling_cursor text,
  capabilities jsonb not null default '{}'::jsonb,
  authority jsonb not null default '{}'::jsonb,
  cutover_mode text not null default 'disconnected' check (cutover_mode in ('disconnected', 'read_only', 'shadow', 'pilot_write', 'live')),
  last_success_at timestamptz,
  last_failure_at timestamptz,
  reconciliation_status text not null default 'none',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists marketplace_accounts_identity_uidx on public.marketplace_accounts (platform, market, coalesce(account_ref, account_label));

create table if not exists public.marketplace_listings (
  id bigserial primary key,
  workspace_id bigint not null references public.workspaces(id),
  account_id bigint not null references public.marketplace_accounts(id),
  listing_id text not null,
  variation_id text,
  source_sku text,
  title text,
  variant_id bigint references public.product_variants(id),
  inventory_item_id bigint references public.inventory_items(id),
  mapping_status text not null default 'unmapped' check (mapping_status in ('unmapped', 'mapped', 'ambiguous', 'bundle')),
  bundle_components jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  mapped_by text,
  mapped_at timestamptz
);
create unique index if not exists marketplace_listings_grain_uidx on public.marketplace_listings (account_id, listing_id, coalesce(variation_id, ''));
comment on table public.marketplace_listings is 'Mapping grain: marketplace + account + listing + variation → canonical variant → finished-good inventory item. Unmapped or ambiguous lines can never reserve stock.';

------------------------------------------------------------------------
-- 4. WhatsApp observation inbox
------------------------------------------------------------------------
create table if not exists public.wa_observations (
  id bigserial primary key,
  workspace_id bigint not null references public.workspaces(id),
  provider text not null default 'whatsapp_cloud',
  account_ref text,
  thread_ref text,
  message_ref text not null,
  sender_ref text,
  sender_role text,
  message_at timestamptz,
  received_at timestamptz not null default now(),
  text text,
  media_refs jsonb not null default '[]'::jsonb,
  quoted_message_ref text,
  raw_ref text,
  content_hash text,
  parser_version text not null default 'none',
  parsed jsonb not null default '{}'::jsonb,
  confidence numeric,
  validation jsonb not null default '{}'::jsonb,
  state text not null default 'received' check (state in ('received', 'linked', 'unlinked_review', 'accepted', 'rejected')),
  production_item_id bigint references public.production_items(id),
  batch_ref text,
  resulting_event_id bigint,
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  unique (provider, message_ref)
);
create index if not exists wa_observations_state_idx on public.wa_observations (workspace_id, state, received_at desc);
comment on table public.wa_observations is 'Immutable evidence for factory WhatsApp updates (plan §5.3). Idempotent by provider message id. Review links an observation to a production item; stock never moves from an observation.';

-- RLS + grants for the new tables
alter table public.product_pack_configurations enable row level security;
alter table public.inventory_locations enable row level security;
alter table public.inventory_items enable row level security;
alter table public.marketplace_accounts enable row level security;
alter table public.marketplace_listings enable row level security;
alter table public.wa_observations enable row level security;
do $$ declare t text; begin
  foreach t in array array['product_pack_configurations', 'inventory_locations', 'inventory_items', 'marketplace_accounts', 'marketplace_listings', 'wa_observations'] loop
    execute format('drop policy if exists member_read on public.%I', t);
    execute format('create policy member_read on public.%I for select to authenticated using (private.is_workspace_member(workspace_id))', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;
grant usage, select on sequence public.product_pack_configurations_id_seq, public.inventory_locations_id_seq, public.inventory_items_id_seq,
  public.marketplace_accounts_id_seq, public.marketplace_listings_id_seq, public.wa_observations_id_seq to service_role;

------------------------------------------------------------------------
-- Seeds
------------------------------------------------------------------------
-- Logical locations (plan §2.3). Authority 'none' until a WMS or Fullkit movements own them.
insert into public.inventory_locations (workspace_id, key, name, location_type, factory, authority_system)
select w.id, s.key, s.name, s.location_type, s.factory, 'none'
from (select min(id) as id from public.workspaces) w
cross join (values
  ('f1_wip', 'Factory 1 — production / WIP', 'factory_wip', 'factory_1'),
  ('f1_released', 'Factory 1 — released output', 'factory_released', 'factory_1'),
  ('f2_wip', 'Factory 2 — production / WIP', 'factory_wip', 'factory_2'),
  ('f2_released', 'Factory 2 — released sachets', 'factory_released', 'factory_2'),
  ('in_transit', 'In transit (factory → warehouse)', 'in_transit', null),
  ('wh_receiving', 'Warehouse — receiving / quarantine', 'warehouse_receiving', null),
  ('wh_sachet_wip', 'Warehouse — sachet / WIP storage', 'warehouse_wip', null),
  ('wh_packaging', 'Warehouse — packaging / assembly', 'warehouse_packaging', null),
  ('wh_finished', 'Warehouse — released finished goods', 'warehouse_finished', null),
  ('wh_staging', 'Warehouse — fulfilment staging', 'fulfilment_staging', null),
  ('wh_returns', 'Warehouse — returns / quarantine', 'returns_quarantine', null)
) as s(key, name, location_type, factory)
on conflict (workspace_id, key) do nothing;

-- Finished goods mirror active variants 1:1 (S3 migration rule); re-run by private.inventory_items_sync().
create or replace function private.inventory_items_sync()
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  insert into public.inventory_items (workspace_id, item_type, name, uom, variant_id)
  select v.workspace_id, 'finished_good', coalesce(p.name || ' — ', '') || coalesce(v.name, v.sku), 'pack', v.id
  from public.product_variants v
  left join public.products p on p.id = v.product_id
  where v.status = 'active' and not exists (select 1 from public.inventory_items i where i.variant_id = v.id);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
select private.inventory_items_sync();

-- Draft v1 pack configuration from units_per_pack (bundle of N base units). Approval replaces it with the governed configuration.
insert into public.product_pack_configurations
  (workspace_id, variant_id, version, presentation_type, sellable_uom, contained_unit_type, contained_units_per_pack, effective_from, status, note, created_by)
select v.workspace_id, v.id, 1, 'bundle', 'pack', 'unit', coalesce(v.units_per_pack, 1), date '2026-01-01', 'draft',
       'Seeded from product_variants.units_per_pack (base units per package). Replace with the governed capsule/sachet configuration and approve.', 'migration'
from public.product_variants v
where v.status = 'active' and not exists (select 1 from public.product_pack_configurations c where c.variant_id = v.id);

-- Marketplace accounts from docs/ops/marketplace-onboarding-plan.md (read 2026-08-25).
insert into public.marketplace_accounts
  (workspace_id, integration_id, platform, account_label, legal_entity_id, market, currency_code, scopes_requested, approval_state, app_state, capabilities, authority, cutover_mode, notes)
select w.id, s.integration_id, s.platform, s.label, s.le, s.market, s.ccy, s.scopes, s.approval, s.app_state,
       jsonb_build_object('orders_read', false, 'cancellations_read', false, 'fulfilment_read', false, 'returns_read', false, 'fees_read', false, 'stock_read', false, 'stock_write', false),
       jsonb_build_object('orders', 'marketplace', 'listing_qty', 'marketplace', 'fulfilment', 'marketplace_or_fighter', 'customer_identity', 'masked_by_platform'),
       'disconnected', s.notes
from (select min(id) as id from public.workspaces) w
cross join (values
  (5,  'tiktok_shop', 'TikTok Shop — Malaysia (Fullkit OS app)', null::bigint, 'MY', 'MYR', array['order.read', 'product.read', 'settlement.read'], 'in_progress',
       'ISV approved (entity on file: Teroka Digital); app Fullkit OS in Draft, not submitted; app key issued 2026-08-21; redirect URL points at an endpoint that does not exist',
       'Partner Center ISV track. Entity question open (Teroka Digital vs EFFEN). Review needs a working OAuth callback first.'),
  (6,  'shopee', 'Shopee — Malaysia', 1, 'MY', 'MYR', array['order.read', 'product.read', 'payment.read'], 'in_progress',
       'Partner registration in progress; app not created; blocked on penetration test report (sensitive-data access)',
       'Customer data masked by default; address/contact only after accredited pen test. IP allowlist required.'),
  (6,  'shopee', 'Shopee — Singapore (intended)', 2, 'SG', 'SGD', array['order.read', 'product.read', 'payment.read'], 'not_submitted',
       'Intended after Malaysia; nothing filed',
       'Follows the MY partner app.'),
  (7,  'lazada', 'Lazada — Malaysia', 1, 'MY', 'MYR', array['order.read', 'product.read'], 'not_submitted',
       'No developer application filed',
       'Portfolio scope only; no onboarding work started.')
) as s(integration_id, platform, label, le, market, ccy, scopes, approval, app_state, notes)
on conflict do nothing;

------------------------------------------------------------------------
-- Commands
------------------------------------------------------------------------
create or replace function private.registry_actor(p_roles text[], out workspace_id bigint, out membership_id bigint, out label text)
language plpgsql stable security definer set search_path = '' as $$
begin
  workspace_id := (select min(id) from public.workspaces);
  if not private.has_role(workspace_id, p_roles) then raise exception 'Not allowed: needs one of %', array_to_string(p_roles, ', '); end if;
  select m.id, coalesce(p.display_name, 'unknown') into membership_id, label
  from public.memberships m left join public.profiles p on p.id = m.user_id
  where m.workspace_id = registry_actor.workspace_id and m.user_id = (select auth.uid()) and m.status = 'active' limit 1;
  if label is null then label := 'unknown'; end if;
end;
$$;

-- New DRAFT version of a variant's pack configuration (never edits an existing version).
create or replace function public.save_pack_configuration(
  p_variant_id bigint, p_presentation_type text, p_contained_unit_type text, p_contained_units_per_pack integer,
  p_sellable_uom text default 'pack', p_content_per_unit text default null, p_recommended_units_per_day numeric default null,
  p_nominal_days_supply numeric default null, p_packaging_bom_version text default null, p_effective_from date default current_date, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_a record; v_version integer; v_row public.product_pack_configurations; v_days numeric;
begin
  select * into v_a from private.registry_actor(array['hq_admin', 'operations']);
  if not exists (select 1 from public.product_variants where id = p_variant_id and workspace_id = v_a.workspace_id) then raise exception 'Unknown variant'; end if;
  select coalesce(max(version), 0) + 1 into v_version from public.product_pack_configurations where variant_id = p_variant_id;
  v_days := coalesce(p_nominal_days_supply, case when p_recommended_units_per_day > 0 then p_contained_units_per_pack / p_recommended_units_per_day end);
  insert into public.product_pack_configurations
    (workspace_id, variant_id, version, presentation_type, sellable_uom, contained_unit_type, contained_units_per_pack, content_per_unit,
     recommended_units_per_day, nominal_days_supply, packaging_bom_version, effective_from, status, note, created_by)
  values (v_a.workspace_id, p_variant_id, v_version, p_presentation_type, coalesce(p_sellable_uom, 'pack'), p_contained_unit_type, p_contained_units_per_pack, p_content_per_unit,
          p_recommended_units_per_day, v_days, p_packaging_bom_version, coalesce(p_effective_from, current_date), 'draft', p_note, v_a.label)
  returning * into v_row;
  insert into public.audit_events (workspace_id, actor_membership_id, actor_label, action, entity_ref, detail, after_data)
  values (v_a.workspace_id, v_a.membership_id, v_a.label, 'catalog.pack_configuration_drafted', 'variant:' || p_variant_id,
          'Pack configuration v' || v_version || ' drafted (' || p_presentation_type || ', ' || p_contained_units_per_pack || ' ' || p_contained_unit_type || ')' || coalesce(': ' || left(p_note, 300), ''),
          to_jsonb(v_row) - 'workspace_id');
  return jsonb_build_object('configuration', to_jsonb(v_row));
end;
$$;

create or replace function public.approve_pack_configuration(p_id bigint, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_a record; v_row public.product_pack_configurations; v_prev bigint;
begin
  select * into v_a from private.registry_actor(array['hq_admin']);
  select * into v_row from public.product_pack_configurations where id = p_id and workspace_id = v_a.workspace_id for update;
  if v_row.id is null then raise exception 'No such configuration'; end if;
  if v_row.status = 'approved' then return jsonb_build_object('changed', false, 'configuration', to_jsonb(v_row)); end if;
  if v_row.status <> 'draft' then raise exception 'Only drafts can be approved (status = %)', v_row.status; end if;
  select id into v_prev from public.product_pack_configurations where variant_id = v_row.variant_id and status = 'approved' and id <> v_row.id;
  if v_prev is not null then
    update public.product_pack_configurations set status = 'superseded', effective_to = coalesce(effective_to, greatest(v_row.effective_from, effective_from + 1)) where id = v_prev;
  end if;
  update public.product_pack_configurations set status = 'approved', approved_by = v_a.label, approved_at = now() where id = v_row.id returning * into v_row;
  insert into public.audit_events (workspace_id, actor_membership_id, actor_label, action, entity_ref, detail, before_data, after_data)
  values (v_a.workspace_id, v_a.membership_id, v_a.label, 'catalog.pack_configuration_approved', 'variant:' || v_row.variant_id,
          'Pack configuration v' || v_row.version || ' approved' || case when v_prev is not null then ' (superseded #' || v_prev || ')' else '' end || coalesce(': ' || left(p_note, 300), ''),
          jsonb_build_object('superseded_id', v_prev), to_jsonb(v_row) - 'workspace_id');
  return jsonb_build_object('changed', true, 'configuration', to_jsonb(v_row), 'superseded_id', v_prev);
end;
$$;

-- Cutover: ADR-0009 read scopes only. read_only needs an approved partner app; shadow needs read_only first.
create or replace function public.set_marketplace_cutover(p_account_id bigint, p_mode text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_a record; v_acc public.marketplace_accounts;
begin
  select * into v_a from private.registry_actor(array['hq_admin']);
  select * into v_acc from public.marketplace_accounts where id = p_account_id and workspace_id = v_a.workspace_id for update;
  if v_acc.id is null then raise exception 'No such marketplace account'; end if;
  if p_mode in ('pilot_write', 'live') then raise exception 'ADR-0009: read scopes only in this release; % is not available', p_mode; end if;
  if p_mode not in ('disconnected', 'read_only', 'shadow') then raise exception 'Unknown cutover mode %', p_mode; end if;
  if p_mode in ('read_only', 'shadow') and v_acc.approval_state <> 'approved' then
    raise exception 'Cutover to % needs an approved partner application (approval_state = %)', p_mode, v_acc.approval_state;
  end if;
  if p_mode = 'shadow' and v_acc.cutover_mode <> 'read_only' then raise exception 'Shadow requires a proven read_only mirror first'; end if;
  if v_acc.cutover_mode = p_mode then return jsonb_build_object('changed', false, 'account', to_jsonb(v_acc)); end if;
  update public.marketplace_accounts set cutover_mode = p_mode, updated_at = now() where id = v_acc.id returning * into v_acc;
  insert into public.audit_events (workspace_id, actor_membership_id, actor_label, action, entity_ref, detail, before_data, after_data)
  values (v_a.workspace_id, v_a.membership_id, v_a.label, 'marketplace.cutover_changed', 'marketplace_account:' || v_acc.id,
          v_acc.account_label || ' cutover → ' || p_mode || coalesce(': ' || left(p_note, 300), ''), jsonb_build_object('cutover_mode', v_acc.cutover_mode), jsonb_build_object('cutover_mode', p_mode));
  return jsonb_build_object('changed', true, 'account', to_jsonb(v_acc));
end;
$$;

create or replace function public.map_marketplace_listing(p_listing_id bigint, p_variant_id bigint, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_a record; v_l public.marketplace_listings; v_item bigint;
begin
  select * into v_a from private.registry_actor(array['hq_admin', 'operations']);
  select * into v_l from public.marketplace_listings where id = p_listing_id and workspace_id = v_a.workspace_id for update;
  if v_l.id is null then raise exception 'No such listing'; end if;
  if p_variant_id is null then
    update public.marketplace_listings set variant_id = null, inventory_item_id = null, mapping_status = 'unmapped', mapped_by = v_a.label, mapped_at = now() where id = v_l.id returning * into v_l;
  else
    select id into v_item from public.inventory_items where variant_id = p_variant_id;
    if v_item is null then raise exception 'Variant % has no finished-good inventory item', p_variant_id; end if;
    update public.marketplace_listings set variant_id = p_variant_id, inventory_item_id = v_item, mapping_status = 'mapped', mapped_by = v_a.label, mapped_at = now() where id = v_l.id returning * into v_l;
  end if;
  insert into public.audit_events (workspace_id, actor_membership_id, actor_label, action, entity_ref, detail, after_data)
  values (v_a.workspace_id, v_a.membership_id, v_a.label, 'marketplace.listing_mapped', 'marketplace_listing:' || v_l.id,
          'Listing ' || v_l.listing_id || coalesce('/' || v_l.variation_id, '') || ' → ' || coalesce('variant ' || p_variant_id, 'unmapped') || coalesce(': ' || left(p_note, 300), ''),
          jsonb_build_object('variant_id', p_variant_id, 'inventory_item_id', v_item, 'mapping_status', v_l.mapping_status));
  return jsonb_build_object('listing', to_jsonb(v_l));
end;
$$;

-- Observation inbox: every inbound WhatsApp message becomes evidence exactly once. No parser yet.
create or replace function private.wa_observe_sync()
returns jsonb language plpgsql security definer set search_path = '' set statement_timeout = '2min' as $$
declare v_n integer; v_items integer;
begin
  insert into public.wa_observations (workspace_id, provider, account_ref, thread_ref, message_ref, sender_ref, message_at, received_at, text, media_refs, raw_ref, content_hash, parser_version, state)
  select m.workspace_id, 'whatsapp_cloud', n.phone_number_id, c.wa_contact, m.wa_message_id, c.wa_contact, m.sent_at, m.created_at, m.body,
         case when m.message_type <> 'text' then jsonb_build_array(jsonb_build_object('type', m.message_type, 'wa_message_id', m.wa_message_id)) else '[]'::jsonb end,
         'wa_messages:' || m.id, md5(coalesce(m.body, '') || coalesce(m.wa_message_id, '')), 'none', 'unlinked_review'
  from public.wa_messages m
  join public.wa_conversations c on c.id = m.conversation_id
  left join public.wa_numbers n on n.id = c.number_id
  where m.direction = 'inbound' and m.wa_message_id is not null
    and not exists (select 1 from public.wa_observations o where o.provider = 'whatsapp_cloud' and o.message_ref = m.wa_message_id);
  get diagnostics v_n = row_count;
  v_items := private.inventory_items_sync();
  return jsonb_build_object('observations', v_n, 'inventory_items_added', v_items, 'at', now());
end;
$$;

create or replace function public.review_wa_observation(p_id bigint, p_state text, p_production_item_id bigint default null, p_batch_ref text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_a record; v_o public.wa_observations;
begin
  select * into v_a from private.registry_actor(array['hq_admin', 'operations']);
  if p_state not in ('linked', 'accepted', 'rejected') then raise exception 'Review state must be linked, accepted or rejected'; end if;
  select * into v_o from public.wa_observations where id = p_id and workspace_id = v_a.workspace_id for update;
  if v_o.id is null then raise exception 'No such observation'; end if;
  if p_state in ('linked', 'accepted') and p_production_item_id is null then raise exception 'Linking or accepting needs a production item'; end if;
  if p_production_item_id is not null and not exists (select 1 from public.production_items where id = p_production_item_id) then raise exception 'Unknown production item'; end if;
  update public.wa_observations
  set state = p_state, production_item_id = coalesce(p_production_item_id, production_item_id), batch_ref = coalesce(p_batch_ref, batch_ref),
      reviewed_by = v_a.label, reviewed_at = now(), review_note = p_note
  where id = v_o.id returning * into v_o;
  insert into public.audit_events (workspace_id, actor_membership_id, actor_label, action, entity_ref, detail, before_data, after_data)
  values (v_a.workspace_id, v_a.membership_id, v_a.label, 'production.observation_reviewed', 'wa_observation:' || v_o.id,
          'Observation ' || p_state || coalesce(' → production item ' || p_production_item_id, '') || ' (no stock movement)' || coalesce(': ' || left(p_note, 300), ''),
          jsonb_build_object('state', 'unlinked_review'), jsonb_build_object('state', p_state, 'production_item_id', v_o.production_item_id, 'batch_ref', v_o.batch_ref));
  return jsonb_build_object('observation', to_jsonb(v_o) - 'text' - 'media_refs');
end;
$$;

-- Plan §6.6 formula as a pure function. Reservation / quarantine / buffer inputs do not exist yet.
create or replace function public.channel_publishable_qty(p_on_hand numeric, p_confirmed_reservations numeric, p_quarantine numeric, p_safety_buffer numeric, p_channel_holdback numeric)
returns numeric language sql immutable parallel safe set search_path = '' as $$
  select greatest(0, coalesce(p_on_hand, 0) - coalesce(p_confirmed_reservations, 0) - coalesce(p_quarantine, 0) - coalesce(p_safety_buffer, 0) - coalesce(p_channel_holdback, 0));
$$;

------------------------------------------------------------------------
-- Reads
------------------------------------------------------------------------
create or replace function public.live_inventory_registry()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_ws bigint := (select min(id) from public.workspaces);
begin
  if not private.is_workspace_member(v_ws) then raise exception 'Not a workspace member'; end if;
  return jsonb_build_object(
    'status', 'ok',
    'migration_rule', 'S3: inventory_items is identity only; stock levels stay on product_variants.stock_on_hand until levels + append-only movements exist. No stock moves from inference.',
    'locations', (select coalesce(jsonb_agg(to_jsonb(l) - 'workspace_id' order by l.id), '[]'::jsonb) from public.inventory_locations l where l.workspace_id = v_ws),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'item_type', i.item_type, 'name', i.name, 'uom', i.uom, 'variant_id', i.variant_id, 'sku', v.sku, 'stock_on_hand', v.stock_on_hand, 'units_per_pack', v.units_per_pack, 'status', i.status) order by i.item_type, i.name), '[]'::jsonb)
              from public.inventory_items i left join public.product_variants v on v.id = i.variant_id where i.workspace_id = v_ws),
    'pack_configurations', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'variant_id', c.variant_id, 'sku', v.sku, 'variant_name', v.name, 'product', p.name, 'version', c.version,
                'presentation_type', c.presentation_type, 'sellable_uom', c.sellable_uom, 'contained_unit_type', c.contained_unit_type, 'contained_units_per_pack', c.contained_units_per_pack,
                'content_per_unit', c.content_per_unit, 'recommended_units_per_day', c.recommended_units_per_day, 'nominal_days_supply', c.nominal_days_supply, 'packaging_bom_version', c.packaging_bom_version,
                'effective_from', c.effective_from, 'effective_to', c.effective_to, 'status', c.status, 'note', c.note, 'created_by', c.created_by, 'approved_by', c.approved_by, 'approved_at', c.approved_at, 'created_at', c.created_at)
              order by p.name, v.sku, c.version desc), '[]'::jsonb)
              from public.product_pack_configurations c join public.product_variants v on v.id = c.variant_id left join public.products p on p.id = v.product_id where c.workspace_id = v_ws),
    'publishable', jsonb_build_object(
      'formula', 'channel_publishable_qty = max(0, on_hand - confirmed_reservations - quarantine - safety_buffer - channel_allocation_holdback)',
      'inputs_available', false,
      'missing', jsonb_build_array('confirmed_reservations', 'quarantine', 'safety_buffer', 'channel_allocation_holdback'),
      'note', 'Reservation and quarantine facts need the S3 movement authority (reserve at accepted order, deduct at handover); none exists yet, so no channel quantity is published.'));
end;
$$;

create or replace function public.live_marketplace_registry()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_ws bigint := (select min(id) from public.workspaces);
begin
  if not private.is_workspace_member(v_ws) then raise exception 'Not a workspace member'; end if;
  return jsonb_build_object(
    'status', 'ok',
    'posture', 'ADR-0009: partner track, read scopes only; pilot_write and live are refused by set_marketplace_cutover',
    'onboarding_register', 'docs/ops/marketplace-onboarding-plan.md',
    'accounts', (select coalesce(jsonb_agg((to_jsonb(a) - 'workspace_id') || jsonb_build_object(
        'integration_name', ic.name, 'integration_status', ic.status, 'legal_entity', le.legal_name,
        'listings', (select count(*) from public.marketplace_listings l where l.account_id = a.id),
        'unmapped_listings', (select count(*) from public.marketplace_listings l where l.account_id = a.id and l.mapping_status in ('unmapped', 'ambiguous'))) order by a.platform, a.market), '[]'::jsonb)
      from public.marketplace_accounts a left join public.integration_connections ic on ic.id = a.integration_id left join public.legal_entities le on le.id = a.legal_entity_id where a.workspace_id = v_ws),
    'listings', (select coalesce(jsonb_agg(to_jsonb(l) - 'workspace_id' order by l.last_seen_at desc), '[]'::jsonb) from (select * from public.marketplace_listings where workspace_id = v_ws order by last_seen_at desc limit 200) l),
    'connector', jsonb_build_object('built', false, 'reason', 'No partner application is approved with a working OAuth callback; a read-only mirror is not possible before that (onboarding register §7).'));
end;
$$;

create or replace function public.live_wa_observations(p_state text default null, p_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_ws bigint := (select min(id) from public.workspaces);
begin
  if not private.is_workspace_member(v_ws) then raise exception 'Not a workspace member'; end if;
  return jsonb_build_object(
    'status', 'ok',
    'connection', (select jsonb_build_object('status', ic.status, 'last_success_at', ic.last_success_at, 'notes', ic.notes) from public.integration_connections ic where ic.provider = 'WhatsApp' limit 1),
    'numbers', (select count(*) from public.wa_numbers),
    'feasibility_gate', 'Plan §5.2: an existing human WhatsApp group cannot be assumed to accept a Cloud API bot; verify eligibility, or use a dedicated one-to-one production number. Unofficial device automation stays read-only/shadow.',
    'summary', (select jsonb_object_agg(k, n) from (select state as k, count(*) n from public.wa_observations where workspace_id = v_ws group by 1) s),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'thread_ref', o.thread_ref, 'sender_ref', left(o.sender_ref, 4) || '***', 'message_at', o.message_at, 'received_at', o.received_at,
                'text', left(o.text, 400), 'media', jsonb_array_length(o.media_refs), 'parser_version', o.parser_version, 'parsed', o.parsed, 'confidence', o.confidence, 'state', o.state,
                'production_item_id', o.production_item_id, 'batch_ref', o.batch_ref, 'reviewed_by', o.reviewed_by, 'reviewed_at', o.reviewed_at, 'review_note', o.review_note) order by o.received_at desc), '[]'::jsonb)
             from (select * from public.wa_observations where workspace_id = v_ws and (p_state is null or state = p_state) order by received_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500)) o));
end;
$$;

------------------------------------------------------------------------
-- Grants + schedule
------------------------------------------------------------------------
revoke all on function public.save_pack_configuration(bigint, text, text, integer, text, text, numeric, numeric, text, date, text) from public, anon;
revoke all on function public.approve_pack_configuration(bigint, text) from public, anon;
revoke all on function public.set_marketplace_cutover(bigint, text, text) from public, anon;
revoke all on function public.map_marketplace_listing(bigint, bigint, text) from public, anon;
revoke all on function public.review_wa_observation(bigint, text, bigint, text, text) from public, anon;
revoke all on function public.live_inventory_registry() from public, anon;
revoke all on function public.live_marketplace_registry() from public, anon;
revoke all on function public.live_wa_observations(text, integer) from public, anon;
grant execute on function public.save_pack_configuration(bigint, text, text, integer, text, text, numeric, numeric, text, date, text), public.approve_pack_configuration(bigint, text),
  public.set_marketplace_cutover(bigint, text, text), public.map_marketplace_listing(bigint, bigint, text), public.review_wa_observation(bigint, text, bigint, text, text),
  public.live_inventory_registry(), public.live_marketplace_registry(), public.live_wa_observations(text, integer), public.channel_publishable_qty(numeric, numeric, numeric, numeric, numeric)
  to authenticated, service_role;
revoke all on function private.registry_actor(text[]) from public, anon, authenticated;
revoke all on function private.inventory_items_sync() from public, anon, authenticated;
revoke all on function private.wa_observe_sync() from public, anon, authenticated;

select private.wa_observe_sync();
select cron.unschedule(jobid) from cron.job where jobname = 'wa-observe-every-15m';
select cron.schedule('wa-observe-every-15m', '6,21,36,51 * * * *', $cron$select private.wa_observe_sync();$cron$);
