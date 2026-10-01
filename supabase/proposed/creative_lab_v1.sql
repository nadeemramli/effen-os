-- Creative Learning & Poster Production — operational schema v1 (ADR-0010)
--
-- STATUS: PROPOSED — NOT APPLIED. Per supabase/migrations/README.md a
-- migration file is committed under the version it was recorded with when
-- it ran, so this file lives outside migrations/ until an owner applies it
-- (Supabase MCP apply_migration) and files it under the returned version.
-- Verified locally by supabase/tests/creative_lab.sql on a Postgres 16
-- harness (supabase/tests/creative_lab_harness.sql) — see ADR-0010 §8.
--
-- Shape (ADR-0010 §4):
--   * Everything lives in schema `creative`; anon/authenticated get NO
--     table grants. Every read and write goes through a public.creative_*
--     SECURITY DEFINER RPC that checks role AND brand scope, so the browser
--     never reads facts or media references it is not scoped to.
--   * Brand scope uses public.membership_brand_scopes for the first time:
--     hq_admin sees every brand; a member with no scope rows keeps today's
--     workspace-wide view; a member with scope rows sees only those brands.
--   * Generation, QA, human review, export and launch are separate status
--     columns. Nothing here publishes ads or spends media budget.
--   * Generation runs in a worker that claims jobs with a lease
--     (FOR UPDATE SKIP LOCKED), reserves estimated cost against the batch
--     budget before each call, and is bounded by max_attempts.
--   * Brand kits import as DRAFT and are never auto-approved.
--   * Facts (image/ad daily) are a serving copy of the warehouse contract
--     marts (BigQuery stays analytical authority) written only by the
--     service role.

create schema if not exists creative;
revoke all on schema creative from public;
grant usage on schema creative to service_role;

-- ---------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------

-- True when the request carries the service-role JWT (edge functions,
-- the generation worker, the mart sync).
create or replace function private.creative_is_service()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) = 'service_role';
$$;

-- Active membership of the caller in the brand's workspace with one of
-- `p_roles`, honouring membership_brand_scopes (see header).
create or replace function private.creative_member_for_brand(p_brand_id bigint, p_roles text[])
returns bigint language sql stable security definer set search_path = '' as $$
  select m.id
  from public.brands b
  join public.memberships m on m.workspace_id = b.workspace_id
  where b.id = p_brand_id
    and m.user_id = (select auth.uid())
    and m.status = 'active'
    and m.role_key = any (p_roles)
    and (
      m.role_key = 'hq_admin'
      or not exists (select 1 from public.membership_brand_scopes s where s.membership_id = m.id)
      or exists (select 1 from public.membership_brand_scopes s
                 where s.membership_id = m.id and s.brand_id = b.id)
    )
  limit 1;
$$;

create or replace function private.creative_can_read(p_brand_id bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.creative_is_service()
      or private.creative_member_for_brand(p_brand_id,
           array['hq_admin', 'marketing_growth', 'analyst']) is not null;
$$;

create or replace function private.creative_can_write(p_brand_id bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.creative_is_service()
      or private.creative_member_for_brand(p_brand_id,
           array['hq_admin', 'marketing_growth']) is not null;
$$;

create or replace function private.creative_is_admin(p_brand_id bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.creative_member_for_brand(p_brand_id, array['hq_admin']) is not null;
$$;

create or replace function private.creative_sha256(p_text text)
returns text language sql immutable set search_path = '' as $$
  select encode(pg_catalog.sha256(convert_to(p_text, 'UTF8')), 'hex');
$$;

create or replace function private.creative_audit(
  p_workspace_id bigint, p_action text, p_entity_ref text, p_detail text,
  p_before jsonb default null, p_after jsonb default null)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_events (workspace_id, actor_membership_id, actor_label, action,
    entity_ref, detail, before_data, after_data)
  select p_workspace_id,
         (select m.id from public.memberships m
           where m.workspace_id = p_workspace_id and m.user_id = (select auth.uid()) limit 1),
         case when private.creative_is_service() then 'service:creative'
              else coalesce((select auth.uid())::text, 'unknown') end,
         p_action, p_entity_ref, p_detail, p_before, p_after;
$$;

-- ---------------------------------------------------------------------
-- Brand kits and raw assets (Slice 1)
-- ---------------------------------------------------------------------

create table creative.brand_kits (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  brand_id bigint not null unique references public.brands (id),
  created_at timestamptz not null default now()
);

create table creative.brand_kit_versions (
  id bigint generated always as identity primary key,
  brand_kit_id bigint not null references creative.brand_kits (id),
  version int not null,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'superseded', 'rejected')),
  -- where the kit came from; drafts derived from a website or historical
  -- identity are never promoted silently
  provenance text not null
    check (provenance in ('website_derived', 'historical_identity', 'owner_supplied', 'fixture')),
  completeness text not null default 'incomplete'
    check (completeness in ('detailed', 'incomplete')),
  tokens jsonb not null default '{}'::jsonb,
  guidelines_md text,
  source_root text,
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  imported_at timestamptz not null default now(),
  approved_by_membership_id bigint references public.memberships (id),
  approved_at timestamptz,
  unique (brand_kit_id, version),
  unique (brand_kit_id, manifest_sha256)
);

create table creative.raw_assets (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  brand_id bigint references public.brands (id),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  storage_ref text,              -- gs://<bucket>/sha256/<hash>.<ext>; null until uploaded
  original_filename text,
  mime_type text,
  byte_size bigint,
  width int,
  height int,
  -- raster reference ≠ print master ≠ approved current claim
  is_print_master boolean not null default false,
  origin text not null
    check (origin in ('owner_supplied', 'website', 'meta_archive', 'generated', 'fixture')),
  first_imported_at timestamptz not null default now(),
  unique (workspace_id, sha256)
);
create index raw_assets_brand_idx on creative.raw_assets (brand_id);

create table creative.kit_version_assets (
  kit_version_id bigint not null references creative.brand_kit_versions (id),
  raw_asset_id bigint not null references creative.raw_assets (id),
  asset_role text not null
    check (asset_role in ('packshot', 'logo', 'reference', 'evidence', 'archive', 'other')),
  source_path text not null,
  primary key (kit_version_id, raw_asset_id, source_path)
);
create index kit_version_assets_asset_idx on creative.kit_version_assets (raw_asset_id);

-- Approved product/copy/offer claims. Owner-supplied; never generated.
create table creative.approved_claims (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  brand_id bigint not null references public.brands (id),
  kind text not null check (kind in ('product', 'claim', 'offer', 'copy', 'disclaimer')),
  market text,
  body text not null,
  evidence_ref text,
  valid_from date,
  valid_until date,
  status text not null default 'approved' check (status in ('approved', 'retired')),
  approved_by_membership_id bigint references public.memberships (id),
  created_at timestamptz not null default now()
);
create index approved_claims_brand_idx on creative.approved_claims (brand_id);

-- Owner decisions the system must not invent. NULL = not configured,
-- surfaced by creative_readiness as a precise missing requirement.
create table creative.brand_runtime_config (
  brand_id bigint primary key references public.brands (id),
  workspace_id bigint not null references public.workspaces (id),
  image_provider text,
  image_model text,
  analysis_provider text,
  analysis_model text,
  batch_budget_amount numeric(14, 4) check (batch_budget_amount >= 0),
  budget_currency text check (budget_currency ~ '^[A-Z]{3}$'),
  max_cost_per_candidate numeric(14, 4) check (max_cost_per_candidate >= 0),
  reviewer_membership_ids bigint[] not null default '{}',
  target_cpa numeric(14, 4),
  target_roas numeric(10, 4),
  economics_currency text check (economics_currency ~ '^[A-Z]{3}$'),
  media_test_budget_amount numeric(14, 4),
  provider_data_approved boolean not null default false,  -- may private assets go to the provider?
  version int not null default 1,
  updated_by_membership_id bigint references public.memberships (id),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Performance serving copy (Slice 2) — written by the mart sync only
-- ---------------------------------------------------------------------

create table creative.image_daily_facts (
  id bigint generated always as identity primary key,
  date date not null,
  platform text not null default 'meta',
  account_id text not null,
  image_hash text not null,
  brand_slug text not null,
  market text not null,
  currency_code text not null,
  campaign_objective text not null,
  attribution_setting text not null,
  account_timezone text not null,
  ads int not null,
  ad_ids text[] not null default '{}',
  spend numeric not null,
  impressions bigint,
  clicks bigint,
  purchases bigint,
  purchase_value numeric,
  any_banned_account boolean not null default false,
  data_maturity text not null check (data_maturity in ('maturing', 'settled')),
  ingested_at timestamptz,
  synced_at timestamptz not null default now(),
  unique (date, platform, account_id, image_hash, brand_slug, market, currency_code,
          campaign_objective, attribution_setting, account_timezone)
);
create index image_daily_facts_brand_idx on creative.image_daily_facts (brand_slug, market, date desc);
create index image_daily_facts_image_idx on creative.image_daily_facts (platform, account_id, image_hash);

create table creative.ad_daily_facts (
  id bigint generated always as identity primary key,
  date date not null,
  platform text not null default 'meta',
  account_id text not null,
  campaign_id text,
  adset_id text,
  ad_id text not null,
  creative_id text,
  creative_format text not null,
  binding_status text not null,
  image_hash text,
  brand_slug text,
  market text,
  currency_code text,
  campaign_objective text,
  attribution_setting text,
  spend numeric not null,
  impressions bigint,
  clicks bigint,
  purchases bigint,
  purchase_value numeric,
  data_maturity text not null check (data_maturity in ('maturing', 'settled')),
  ingested_at timestamptz,
  synced_at timestamptz not null default now(),
  unique (date, platform, ad_id)
);
create index ad_daily_facts_ad_idx on creative.ad_daily_facts (platform, ad_id);

-- Meta image identity (per account) → exact bytes. Many refs may share one
-- raw asset (same SHA-256): de-duplication without losing which account /
-- ads used it.
create table creative.platform_image_refs (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  platform text not null default 'meta',
  account_id text not null,
  image_hash text not null,
  raw_asset_id bigint references creative.raw_assets (id),
  fetch_status text not null default 'pending'
    check (fetch_status in ('pending', 'archived', 'failed', 'unavailable')),
  fetch_error text,
  fetched_at timestamptz,
  unique (platform, account_id, image_hash)
);
create index platform_image_refs_asset_idx on creative.platform_image_refs (raw_asset_id);

-- Immutable evidence snapshot: server-computed aggregates for a cohort and
-- window. Ranking is a deterministic function of (rows, method_version).
create table creative.performance_snapshots (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  brand_id bigint not null references public.brands (id),
  market text,
  window_start date not null,
  window_end date not null,
  method_version text not null,
  params jsonb not null default '{}'::jsonb,
  rows jsonb not null,
  rows_sha256 text not null,
  facts_synced_at timestamptz,
  created_at timestamptz not null default now()
);
create index performance_snapshots_brand_idx on creative.performance_snapshots (brand_id);

-- ---------------------------------------------------------------------
-- Analysis, SOP and recipe (Slice 3)
-- ---------------------------------------------------------------------

create table creative.poster_analyses (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  brand_id bigint not null references public.brands (id),
  raw_asset_id bigint not null references creative.raw_assets (id),
  snapshot_id bigint references creative.performance_snapshots (id),
  analysis jsonb not null,
  provider text not null,
  model text not null,
  prompt_sha256 text,
  status text not null default 'draft' check (status in ('draft', 'reviewed', 'rejected')),
  reviewed_by_membership_id bigint references public.memberships (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index poster_analyses_asset_idx on creative.poster_analyses (raw_asset_id);
create index poster_analyses_brand_idx on creative.poster_analyses (brand_id);

create table creative.recipes (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  brand_id bigint not null references public.brands (id),
  name text not null,
  created_at timestamptz not null default now(),
  unique (brand_id, name)
);

create table creative.recipe_versions (
  id bigint generated always as identity primary key,
  recipe_id bigint not null references creative.recipes (id),
  version int not null,
  spec jsonb not null,             -- structured recipe (layout, slots, fixed/variable factors)
  sop_md text not null,            -- human reconstruction SOP
  spec_sha256 text not null,
  source_analysis_ids bigint[] not null default '{}',
  evidence_snapshot_id bigint references creative.performance_snapshots (id),
  status text not null default 'draft' check (status in ('draft', 'approved', 'rejected', 'retired')),
  reviewed_by_membership_id bigint references public.memberships (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (recipe_id, version)
);

-- Reviewed playbook per brand; learnings revise it into a new version.
create table creative.playbook_versions (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  brand_id bigint not null references public.brands (id),
  version int not null,
  parent_version_id bigint references creative.playbook_versions (id),
  content_md text not null,
  learning_record_ids bigint[] not null default '{}',
  status text not null default 'draft' check (status in ('draft', 'approved', 'superseded')),
  approved_by_membership_id bigint references public.memberships (id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (brand_id, version)
);

-- Immutable context for a batch: exactly which kit, assets, claims,
-- evidence, recipe and playbook the candidates were made from.
create table creative.context_manifests (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  brand_id bigint not null references public.brands (id),
  kit_version_id bigint not null references creative.brand_kit_versions (id),
  recipe_version_id bigint references creative.recipe_versions (id),
  snapshot_id bigint references creative.performance_snapshots (id),
  playbook_version_id bigint references creative.playbook_versions (id),
  raw_asset_ids bigint[] not null,
  claim_ids bigint[] not null default '{}',
  manifest jsonb not null,
  manifest_sha256 text not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, manifest_sha256)
);

-- ---------------------------------------------------------------------
-- Batches, candidates and durable generation jobs (Slice 4)
-- ---------------------------------------------------------------------

create table creative.batches (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  brand_id bigint not null references public.brands (id),
  market text not null,
  context_manifest_id bigint not null references creative.context_manifests (id),
  idempotency_key text not null,
  plan jsonb not null,                        -- mix, families, method version
  stages int[] not null default '{5,20,100}', -- cumulative pilot gates
  stage_limit int not null,                   -- slots < stage_limit may generate
  requested_count int not null check (requested_count > 0),
  status text not null default 'running' check (status in
    ('running', 'awaiting_review', 'paused_budget', 'completed', 'cancelled')),
  provider text not null,
  model text not null,
  budget_amount numeric(14, 4) not null check (budget_amount >= 0),
  budget_currency text not null,
  reserved_amount numeric(14, 4) not null default 0 check (reserved_amount >= 0),
  spent_amount numeric(14, 4) not null default 0 check (spent_amount >= 0),
  created_by_membership_id bigint references public.memberships (id),
  created_at timestamptz not null default now(),
  version int not null default 1,
  unique (workspace_id, idempotency_key)
);
create index batches_brand_idx on creative.batches (brand_id, created_at desc);

create table creative.candidate_families (
  id bigint generated always as identity primary key,
  batch_id bigint not null references creative.batches (id),
  family_index int not null,
  lane text not null check (lane in ('exploit', 'adjacent', 'explore')),
  hypothesis text not null,
  changed_factors text[] not null,
  fixed_factors text[] not null,
  unique (batch_id, family_index)
);

create table creative.candidates (
  id bigint generated always as identity primary key,
  batch_id bigint not null references creative.batches (id),
  family_id bigint not null references creative.candidate_families (id),
  slot_index int not null,
  variant_spec jsonb not null,
  input_sha256 text not null,              -- hash of the exact generation inputs
  generation_status text not null default 'queued' check (generation_status in
    ('queued', 'generating', 'generated', 'failed', 'duplicate')),
  qa_status text not null default 'pending' check (qa_status in ('pending', 'passed', 'failed')),
  review_status text not null default 'pending' check (review_status in
    ('pending', 'approved', 'rejected', 'changes_requested')),
  export_status text not null default 'not_exported' check (export_status in ('not_exported', 'exported')),
  launch_status text not null default 'not_launched' check (launch_status in ('not_launched', 'launched')),
  output_ref text,
  output_sha256 text,
  provider text,
  model text,
  prompt text,
  config jsonb,
  cost_amount numeric(14, 4),
  duplicate_of_candidate_id bigint references creative.candidates (id),
  version int not null default 1,
  updated_at timestamptz not null default now(),
  unique (batch_id, slot_index),
  unique (batch_id, input_sha256)          -- identical inputs are not distinct candidates
);
create index candidates_family_idx on creative.candidates (family_id);
create index candidates_output_idx on creative.candidates (batch_id, output_sha256);

create table creative.generation_jobs (
  id bigint generated always as identity primary key,
  candidate_id bigint not null unique references creative.candidates (id),
  status text not null default 'queued' check (status in ('queued', 'leased', 'succeeded', 'dead')),
  attempts int not null default 0,
  max_attempts int not null default 3 check (max_attempts between 1 and 10),
  estimated_cost numeric(14, 4) not null check (estimated_cost >= 0),
  reserved_cost numeric(14, 4) not null default 0,
  lease_owner text,
  lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index generation_jobs_claim_idx on creative.generation_jobs (status, lease_expires_at);

create table creative.qa_checks (
  id bigint generated always as identity primary key,
  candidate_id bigint not null references creative.candidates (id),
  check_key text not null,
  passed boolean not null,
  detail jsonb,
  checked_at timestamptz not null default now()
);
create index qa_checks_candidate_idx on creative.qa_checks (candidate_id);

create table creative.reviews (
  id bigint generated always as identity primary key,
  candidate_id bigint not null references creative.candidates (id),
  reviewer_membership_id bigint not null references public.memberships (id),
  decision text not null check (decision in ('approved', 'rejected', 'changes_requested')),
  reason_codes text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now()
);
create index reviews_candidate_idx on creative.reviews (candidate_id);

create table creative.exports (
  id bigint generated always as identity primary key,
  batch_id bigint not null references creative.batches (id),
  candidate_ids bigint[] not null,
  manifest jsonb not null,
  created_by_membership_id bigint references public.memberships (id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Launch bindings, experiments and learning (Slice 5)
-- ---------------------------------------------------------------------

create table creative.launch_bindings (
  id bigint generated always as identity primary key,
  candidate_id bigint not null references creative.candidates (id),
  platform text not null default 'meta',
  account_id text not null,
  ad_id text not null,
  receipt_ref text not null,        -- manual / P3 launch receipt; Fullkit never launches
  bound_by_membership_id bigint references public.memberships (id),
  bound_at timestamptz not null default now(),
  unique (platform, ad_id)          -- an ad is one variant; a variant may run in many ads
);
create index launch_bindings_candidate_idx on creative.launch_bindings (candidate_id);

create table creative.learning_records (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  brand_id bigint not null references public.brands (id),
  batch_id bigint references creative.batches (id),
  observation_window daterange not null,
  method_version text not null,
  evidence jsonb not null,           -- outcome rows exactly as read, incl. maturity
  finding text not null,
  confidence text not null check (confidence in ('observational', 'directional', 'tested')),
  recommendation text,
  status text not null default 'draft' check (status in ('draft', 'reviewed', 'rejected')),
  reviewed_by_membership_id bigint references public.memberships (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index learning_records_brand_idx on creative.learning_records (brand_id);

-- ---------------------------------------------------------------------
-- Lock the schema down: RLS on, no anon/authenticated grants.
-- ---------------------------------------------------------------------
do $$
declare t record;
begin
  for t in select tablename from pg_tables where schemaname = 'creative' loop
    execute format('alter table creative.%I enable row level security', t.tablename);
    execute format('revoke all on creative.%I from public, anon, authenticated', t.tablename);
    execute format('grant all on creative.%I to service_role', t.tablename);
  end loop;
end $$;
grant usage on all sequences in schema creative to service_role;

-- =====================================================================
-- RPCs
-- =====================================================================

-- Brand-kit import (idempotent on manifest SHA-256). Always lands DRAFT.
create or replace function public.creative_import_brand_kit(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_brand public.brands;
  v_kit_id bigint;
  v_existing creative.brand_kit_versions;
  v_version_id bigint;
  v_next int;
  v_asset jsonb;
  v_asset_id bigint;
  v_new_assets int := 0;
begin
  select * into v_brand from public.brands where slug = p_payload ->> 'brand_slug';
  if v_brand.id is null then
    raise exception 'creative_unknown_brand: %', p_payload ->> 'brand_slug';
  end if;
  if not (private.creative_is_service() or private.creative_is_admin(v_brand.id)) then
    raise exception 'creative_forbidden';
  end if;
  if coalesce(p_payload ->> 'manifest_sha256', '') !~ '^[0-9a-f]{64}$' then
    raise exception 'creative_bad_manifest_sha256';
  end if;

  insert into creative.brand_kits (workspace_id, brand_id)
  values (v_brand.workspace_id, v_brand.id)
  on conflict (brand_id) do nothing;
  select id into v_kit_id from creative.brand_kits where brand_id = v_brand.id;

  select * into v_existing from creative.brand_kit_versions
  where brand_kit_id = v_kit_id and manifest_sha256 = p_payload ->> 'manifest_sha256';
  if v_existing.id is not null then
    return jsonb_build_object('changed', false, 'kit_version_id', v_existing.id,
      'version', v_existing.version, 'status', v_existing.status);
  end if;

  select coalesce(max(version), 0) + 1 into v_next
  from creative.brand_kit_versions where brand_kit_id = v_kit_id;

  insert into creative.brand_kit_versions (brand_kit_id, version, status, provenance,
    completeness, tokens, guidelines_md, source_root, manifest_sha256)
  values (v_kit_id, v_next, 'draft', p_payload ->> 'provenance',
    coalesce(p_payload ->> 'completeness', 'incomplete'),
    coalesce(p_payload -> 'tokens', '{}'::jsonb), p_payload ->> 'guidelines_md',
    p_payload ->> 'source_root', p_payload ->> 'manifest_sha256')
  returning id into v_version_id;

  for v_asset in select * from jsonb_array_elements(coalesce(p_payload -> 'assets', '[]'::jsonb)) loop
    if coalesce(v_asset ->> 'sha256', '') !~ '^[0-9a-f]{64}$' then
      raise exception 'creative_bad_asset_sha256: %', v_asset ->> 'source_path';
    end if;
    if not exists (select 1 from creative.raw_assets
                   where workspace_id = v_brand.workspace_id and sha256 = v_asset ->> 'sha256') then
      v_new_assets := v_new_assets + 1;
    end if;
    insert into creative.raw_assets (workspace_id, brand_id, sha256, storage_ref,
      original_filename, mime_type, byte_size, width, height, origin)
    values (v_brand.workspace_id, v_brand.id, v_asset ->> 'sha256', v_asset ->> 'storage_ref',
      v_asset ->> 'filename', v_asset ->> 'mime_type', (v_asset ->> 'byte_size')::bigint,
      (v_asset ->> 'width')::int, (v_asset ->> 'height')::int,
      coalesce(v_asset ->> 'origin', 'owner_supplied'))
    on conflict (workspace_id, sha256) do update
      set storage_ref = coalesce(creative.raw_assets.storage_ref, excluded.storage_ref)
    returning id into v_asset_id;
    insert into creative.kit_version_assets (kit_version_id, raw_asset_id, asset_role, source_path)
    values (v_version_id, v_asset_id, coalesce(v_asset ->> 'role', 'other'), v_asset ->> 'source_path')
    on conflict do nothing;
  end loop;

  perform private.creative_audit(v_brand.workspace_id, 'creative.kit_imported',
    'brand_kit_version:' || v_version_id, p_payload ->> 'source_root', null,
    jsonb_build_object('version', v_next, 'manifest_sha256', p_payload ->> 'manifest_sha256',
      'assets', jsonb_array_length(coalesce(p_payload -> 'assets', '[]'::jsonb))));

  return jsonb_build_object('changed', true, 'kit_version_id', v_version_id,
    'version', v_next, 'status', 'draft', 'new_assets', v_new_assets);
end $$;

-- Owner approval of a kit version (hq_admin only). Supersedes the previous
-- approved version; never happens on import.
create or replace function public.creative_approve_kit_version(p_kit_version_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v creative.brand_kit_versions; v_kit creative.brand_kits;
begin
  select * into v from creative.brand_kit_versions where id = p_kit_version_id for update;
  select * into v_kit from creative.brand_kits where id = v.brand_kit_id;
  if v.id is null or not private.creative_is_admin(v_kit.brand_id) then
    raise exception 'creative_forbidden';
  end if;
  if v.status != 'draft' then
    raise exception 'creative_bad_state: kit version is %', v.status;
  end if;
  update creative.brand_kit_versions set status = 'superseded'
  where brand_kit_id = v.brand_kit_id and status = 'approved';
  update creative.brand_kit_versions
  set status = 'approved', approved_at = now(),
      approved_by_membership_id = private.creative_member_for_brand(v_kit.brand_id, array['hq_admin'])
  where id = v.id;
  perform private.creative_audit(v_kit.workspace_id, 'creative.kit_approved',
    'brand_kit_version:' || v.id, null, null, jsonb_build_object('version', v.version));
  return jsonb_build_object('changed', true, 'kit_version_id', v.id);
end $$;

-- Owner runtime decisions (hq_admin only, optimistic concurrency).
create or replace function public.creative_set_runtime_config(
  p_brand_id bigint, p_patch jsonb, p_expected_version int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_brand public.brands; v_before creative.brand_runtime_config; v_after creative.brand_runtime_config;
begin
  select * into v_brand from public.brands where id = p_brand_id;
  if v_brand.id is null or not private.creative_is_admin(p_brand_id) then
    raise exception 'creative_forbidden';
  end if;
  insert into creative.brand_runtime_config (brand_id, workspace_id)
  values (p_brand_id, v_brand.workspace_id) on conflict (brand_id) do nothing;
  select * into v_before from creative.brand_runtime_config where brand_id = p_brand_id for update;
  if p_expected_version is not null and v_before.version != p_expected_version then
    raise exception 'creative_version_conflict: expected %, found %', p_expected_version, v_before.version;
  end if;
  update creative.brand_runtime_config c set
    image_provider = case when p_patch ? 'image_provider' then p_patch ->> 'image_provider' else c.image_provider end,
    image_model = case when p_patch ? 'image_model' then p_patch ->> 'image_model' else c.image_model end,
    analysis_provider = case when p_patch ? 'analysis_provider' then p_patch ->> 'analysis_provider' else c.analysis_provider end,
    analysis_model = case when p_patch ? 'analysis_model' then p_patch ->> 'analysis_model' else c.analysis_model end,
    batch_budget_amount = case when p_patch ? 'batch_budget_amount' then (p_patch ->> 'batch_budget_amount')::numeric else c.batch_budget_amount end,
    budget_currency = case when p_patch ? 'budget_currency' then p_patch ->> 'budget_currency' else c.budget_currency end,
    max_cost_per_candidate = case when p_patch ? 'max_cost_per_candidate' then (p_patch ->> 'max_cost_per_candidate')::numeric else c.max_cost_per_candidate end,
    reviewer_membership_ids = case when p_patch ? 'reviewer_membership_ids'
      then array(select jsonb_array_elements_text(p_patch -> 'reviewer_membership_ids')::bigint) else c.reviewer_membership_ids end,
    target_cpa = case when p_patch ? 'target_cpa' then (p_patch ->> 'target_cpa')::numeric else c.target_cpa end,
    target_roas = case when p_patch ? 'target_roas' then (p_patch ->> 'target_roas')::numeric else c.target_roas end,
    economics_currency = case when p_patch ? 'economics_currency' then p_patch ->> 'economics_currency' else c.economics_currency end,
    media_test_budget_amount = case when p_patch ? 'media_test_budget_amount' then (p_patch ->> 'media_test_budget_amount')::numeric else c.media_test_budget_amount end,
    provider_data_approved = case when p_patch ? 'provider_data_approved' then (p_patch ->> 'provider_data_approved')::boolean else c.provider_data_approved end,
    version = c.version + 1,
    updated_at = now(),
    updated_by_membership_id = private.creative_member_for_brand(p_brand_id, array['hq_admin'])
  where c.brand_id = p_brand_id
  returning * into v_after;
  perform private.creative_audit(v_brand.workspace_id, 'creative.runtime_config_set',
    'brand:' || p_brand_id, null, to_jsonb(v_before), to_jsonb(v_after));
  return jsonb_build_object('changed', true, 'version', v_after.version);
end $$;

-- Missing owner decisions for a brand, in a fixed vocabulary the UI renders.
create or replace function private.creative_missing_config(p_brand_id bigint)
returns text[] language sql stable security definer set search_path = '' as $$
  with c as (select * from creative.brand_runtime_config where brand_id = p_brand_id)
  select array_remove(array[
    case when (select image_provider from c) is null or (select image_model from c) is null then 'image_provider_model' end,
    case when (select analysis_provider from c) is null or (select analysis_model from c) is null then 'analysis_provider_model' end,
    case when (select batch_budget_amount from c) is null or (select budget_currency from c) is null then 'batch_budget' end,
    case when coalesce(cardinality((select reviewer_membership_ids from c)), 0) = 0 then 'reviewers' end,
    case when not coalesce((select provider_data_approved from c), false) then 'provider_data_approval' end,
    case when (select target_cpa from c) is null and (select target_roas from c) is null then 'target_economics' end,
    case when (select media_test_budget_amount from c) is null then 'media_test_budget' end,
    case when not exists (select 1 from creative.approved_claims a
      where a.brand_id = p_brand_id and a.status = 'approved' and a.kind in ('product', 'claim', 'copy')) then 'approved_copy' end,
    case when not exists (select 1 from creative.approved_claims a
      where a.brand_id = p_brand_id and a.status = 'approved' and a.kind = 'offer') then 'approved_offer' end
  ], null);
$$;

-- Readiness for every brand the caller may see.
create or replace function public.creative_readiness()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  return coalesce((
    select jsonb_agg(row_to_json(r) order by r.brand_name)
    from (
      select
        b.id as brand_id, b.slug as brand_slug, b.name as brand_name,
        kv.id as kit_version_id, kv.version as kit_version,
        coalesce(kv.status, 'none') as kit_status,
        kv.provenance as kit_provenance, kv.completeness as kit_completeness,
        (select count(*) from creative.kit_version_assets ka where ka.kit_version_id = kv.id
           and ka.asset_role = 'packshot') as packshots,
        (select count(*) from creative.kit_version_assets ka where ka.kit_version_id = kv.id) as kit_assets,
        (select count(*) from creative.image_daily_facts f where f.brand_slug = b.slug) as image_fact_rows,
        (select max(f.synced_at) from creative.image_daily_facts f where f.brand_slug = b.slug) as facts_synced_at,
        private.creative_missing_config(b.id) as missing_config,
        (select count(*) from creative.batches x where x.brand_id = b.id) as batches
      from public.brands b
      left join creative.brand_kits k on k.brand_id = b.id
      left join lateral (
        select * from creative.brand_kit_versions v where v.brand_kit_id = k.id
        order by (v.status = 'approved') desc, v.version desc limit 1
      ) kv on true
      where private.creative_can_read(b.id)
    ) r
  ), '[]'::jsonb);
end $$;

-- Serving-copy upserts from the creative mart sync (service role only).
create or replace function public.creative_upsert_image_facts(p_rows jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not private.creative_is_service() then raise exception 'creative_forbidden'; end if;
  insert into creative.image_daily_facts (date, platform, account_id, image_hash, brand_slug, market,
    currency_code, campaign_objective, attribution_setting, account_timezone, ads, ad_ids, spend,
    impressions, clicks, purchases, purchase_value, any_banned_account, data_maturity, ingested_at, synced_at)
  select (r ->> 'date')::date, coalesce(r ->> 'platform', 'meta'), r ->> 'account_id', r ->> 'image_hash',
    r ->> 'brand_slug', r ->> 'market', r ->> 'currency_code', r ->> 'campaign_objective',
    r ->> 'attribution_setting', r ->> 'account_timezone', (r ->> 'ads')::int,
    coalesce(array(select jsonb_array_elements_text(r -> 'ad_ids')), '{}'),
    (r ->> 'spend')::numeric, (r ->> 'impressions')::bigint, (r ->> 'clicks')::bigint,
    (r ->> 'purchases')::bigint, (r ->> 'purchase_value')::numeric,
    coalesce((r ->> 'any_banned_account')::boolean, false), r ->> 'data_maturity',
    (r ->> 'ingested_at')::timestamptz, now()
  from jsonb_array_elements(p_rows) r
  on conflict (date, platform, account_id, image_hash, brand_slug, market, currency_code,
    campaign_objective, attribution_setting, account_timezone)
  do update set ads = excluded.ads, ad_ids = excluded.ad_ids, spend = excluded.spend,
    impressions = excluded.impressions, clicks = excluded.clicks, purchases = excluded.purchases,
    purchase_value = excluded.purchase_value, any_banned_account = excluded.any_banned_account,
    data_maturity = excluded.data_maturity, ingested_at = excluded.ingested_at, synced_at = now();
  get diagnostics n = row_count;
  insert into creative.platform_image_refs (workspace_id, platform, account_id, image_hash)
  select distinct (select min(id) from public.workspaces), coalesce(r ->> 'platform', 'meta'),
    r ->> 'account_id', r ->> 'image_hash'
  from jsonb_array_elements(p_rows) r
  on conflict (platform, account_id, image_hash) do nothing;
  return n;
end $$;

create or replace function public.creative_upsert_ad_facts(p_rows jsonb)
returns int language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  if not private.creative_is_service() then raise exception 'creative_forbidden'; end if;
  insert into creative.ad_daily_facts (date, platform, account_id, campaign_id, adset_id, ad_id,
    creative_id, creative_format, binding_status, image_hash, brand_slug, market, currency_code,
    campaign_objective, attribution_setting, spend, impressions, clicks, purchases, purchase_value,
    data_maturity, ingested_at, synced_at)
  select (r ->> 'date')::date, coalesce(r ->> 'platform', 'meta'), r ->> 'account_id', r ->> 'campaign_id',
    r ->> 'adset_id', r ->> 'ad_id', r ->> 'creative_id', r ->> 'creative_format', r ->> 'binding_status',
    r ->> 'image_hash', r ->> 'brand_slug', r ->> 'market', r ->> 'currency_code',
    r ->> 'campaign_objective', r ->> 'attribution_setting', (r ->> 'spend')::numeric,
    (r ->> 'impressions')::bigint, (r ->> 'clicks')::bigint, (r ->> 'purchases')::bigint,
    (r ->> 'purchase_value')::numeric, r ->> 'data_maturity', (r ->> 'ingested_at')::timestamptz, now()
  from jsonb_array_elements(p_rows) r
  on conflict (date, platform, ad_id) do update set
    creative_id = excluded.creative_id, creative_format = excluded.creative_format,
    binding_status = excluded.binding_status, image_hash = excluded.image_hash,
    brand_slug = excluded.brand_slug, market = excluded.market, currency_code = excluded.currency_code,
    campaign_objective = excluded.campaign_objective, attribution_setting = excluded.attribution_setting,
    spend = excluded.spend, impressions = excluded.impressions, clicks = excluded.clicks,
    purchases = excluded.purchases, purchase_value = excluded.purchase_value,
    data_maturity = excluded.data_maturity, ingested_at = excluded.ingested_at, synced_at = now();
  get diagnostics n = row_count;
  return n;
end $$;

-- Image leaderboard input: per image × cohort totals in a window. The
-- ranking itself (eligibility, shrinkage, provisional thresholds) is the
-- versioned function in apps/web/src/lib/creative-lab/ranking.ts.
create or replace function public.creative_image_leaderboard(
  p_brand_id bigint, p_market text, p_from date, p_to date)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_slug text;
begin
  if not private.creative_can_read(p_brand_id) then raise exception 'creative_forbidden'; end if;
  select slug into v_slug from public.brands where id = p_brand_id;
  return jsonb_build_object(
    'as_of', (select max(synced_at) from creative.image_daily_facts where brand_slug = v_slug),
    'window', jsonb_build_object('from', p_from, 'to', p_to),
    'rows', coalesce((
      select jsonb_agg(row_to_json(x) order by x.spend desc)
      from (
        select f.platform, f.account_id, f.image_hash, f.market, f.currency_code,
          f.campaign_objective, f.attribution_setting, f.account_timezone,
          sum(f.spend) as spend, sum(f.impressions) as impressions, sum(f.clicks) as clicks,
          sum(f.purchases) as purchases, sum(f.purchase_value) as purchase_value,
          max(f.ads) as max_concurrent_ads,
          (select count(distinct a) from creative.image_daily_facts f2, unnest(f2.ad_ids) a
            where f2.platform = f.platform and f2.account_id = f.account_id
              and f2.image_hash = f.image_hash and f2.date between p_from and p_to) as distinct_ads,
          min(f.date) as first_date, max(f.date) as last_date, count(*) as days,
          sum(case when f.data_maturity = 'maturing' then f.spend else 0 end) as maturing_spend,
          bool_or(f.any_banned_account) as any_banned_account,
          pir.fetch_status, ra.sha256 as asset_sha256, ra.storage_ref as asset_storage_ref
        from creative.image_daily_facts f
        left join creative.platform_image_refs pir
          on pir.platform = f.platform and pir.account_id = f.account_id and pir.image_hash = f.image_hash
        left join creative.raw_assets ra on ra.id = pir.raw_asset_id
        where f.brand_slug = v_slug
          and (p_market is null or f.market = p_market)
          and f.date between p_from and p_to
        group by f.platform, f.account_id, f.image_hash, f.market, f.currency_code,
          f.campaign_objective, f.attribution_setting, f.account_timezone,
          pir.fetch_status, ra.sha256, ra.storage_ref
      ) x
    ), '[]'::jsonb)
  );
end $$;

create or replace function public.creative_image_evidence(
  p_brand_id bigint, p_account_id text, p_image_hash text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_slug text; v_ref creative.platform_image_refs;
begin
  if not private.creative_can_read(p_brand_id) then raise exception 'creative_forbidden'; end if;
  select slug into v_slug from public.brands where id = p_brand_id;
  select * into v_ref from creative.platform_image_refs
  where platform = 'meta' and account_id = p_account_id and image_hash = p_image_hash;
  return jsonb_build_object(
    'platform_ref', to_jsonb(v_ref),
    'asset', (select to_jsonb(ra) from creative.raw_assets ra where ra.id = v_ref.raw_asset_id),
    'same_bytes_refs', (select coalesce(jsonb_agg(jsonb_build_object('account_id', o.account_id,
        'image_hash', o.image_hash)), '[]'::jsonb)
      from creative.platform_image_refs o
      where v_ref.raw_asset_id is not null and o.raw_asset_id = v_ref.raw_asset_id and o.id != v_ref.id),
    'daily', (select coalesce(jsonb_agg(row_to_json(f) order by f.date), '[]'::jsonb)
      from creative.image_daily_facts f
      where f.brand_slug = v_slug and f.account_id = p_account_id and f.image_hash = p_image_hash),
    'ads', (select coalesce(jsonb_agg(row_to_json(a)), '[]'::jsonb) from (
        select ad_id, campaign_id, creative_id, min(date) as first_date, max(date) as last_date,
          sum(spend) as spend, sum(purchases) as purchases, sum(purchase_value) as purchase_value
        from creative.ad_daily_facts
        where account_id = p_account_id and image_hash = p_image_hash
        group by ad_id, campaign_id, creative_id) a),
    'analyses', (select coalesce(jsonb_agg(to_jsonb(pa) order by pa.created_at desc), '[]'::jsonb)
      from creative.poster_analyses pa where pa.raw_asset_id = v_ref.raw_asset_id and pa.brand_id = p_brand_id)
  );
end $$;

-- Immutable performance snapshot computed server-side from serving facts.
create or replace function public.creative_snapshot_performance(
  p_brand_id bigint, p_market text, p_from date, p_to date, p_method_version text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_board jsonb; v_id bigint; v_ws bigint;
begin
  if not private.creative_can_write(p_brand_id) then raise exception 'creative_forbidden'; end if;
  select workspace_id into v_ws from public.brands where id = p_brand_id;
  v_board := public.creative_image_leaderboard(p_brand_id, p_market, p_from, p_to);
  insert into creative.performance_snapshots (workspace_id, brand_id, market, window_start, window_end,
    method_version, rows, rows_sha256, facts_synced_at)
  values (v_ws, p_brand_id, p_market, p_from, p_to, p_method_version, v_board -> 'rows',
    private.creative_sha256((v_board -> 'rows')::text), (v_board ->> 'as_of')::timestamptz)
  returning id into v_id;
  return jsonb_build_object('snapshot_id', v_id, 'rows', jsonb_array_length(v_board -> 'rows'));
end $$;

-- Poster analysis (draft until a human reviews it) and recipe versions.
create or replace function public.creative_save_poster_analysis(
  p_brand_id bigint, p_raw_asset_id bigint, p_snapshot_id bigint, p_analysis jsonb,
  p_provider text, p_model text, p_prompt_sha256 text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_ws bigint;
begin
  if not private.creative_can_write(p_brand_id) then raise exception 'creative_forbidden'; end if;
  select workspace_id into v_ws from public.brands where id = p_brand_id;
  if not exists (select 1 from creative.raw_assets where id = p_raw_asset_id and workspace_id = v_ws) then
    raise exception 'creative_unknown_asset';
  end if;
  insert into creative.poster_analyses (workspace_id, brand_id, raw_asset_id, snapshot_id, analysis,
    provider, model, prompt_sha256)
  values (v_ws, p_brand_id, p_raw_asset_id, p_snapshot_id, p_analysis, p_provider, p_model, p_prompt_sha256)
  returning id into v_id;
  return jsonb_build_object('analysis_id', v_id, 'status', 'draft');
end $$;

create or replace function public.creative_save_recipe_version(
  p_brand_id bigint, p_recipe_name text, p_spec jsonb, p_sop_md text,
  p_source_analysis_ids bigint[], p_snapshot_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ws bigint; v_recipe_id bigint; v_next int; v_id bigint; v_sha text;
begin
  if not private.creative_can_write(p_brand_id) then raise exception 'creative_forbidden'; end if;
  select workspace_id into v_ws from public.brands where id = p_brand_id;
  insert into creative.recipes (workspace_id, brand_id, name) values (v_ws, p_brand_id, p_recipe_name)
  on conflict (brand_id, name) do nothing;
  select id into v_recipe_id from creative.recipes where brand_id = p_brand_id and name = p_recipe_name;
  v_sha := private.creative_sha256(p_spec::text || coalesce(p_sop_md, ''));
  select id into v_id from creative.recipe_versions where recipe_id = v_recipe_id and spec_sha256 = v_sha;
  if v_id is not null then
    return jsonb_build_object('changed', false, 'recipe_version_id', v_id);
  end if;
  select coalesce(max(version), 0) + 1 into v_next from creative.recipe_versions where recipe_id = v_recipe_id;
  insert into creative.recipe_versions (recipe_id, version, spec, sop_md, spec_sha256,
    source_analysis_ids, evidence_snapshot_id)
  values (v_recipe_id, v_next, p_spec, p_sop_md, v_sha, coalesce(p_source_analysis_ids, '{}'), p_snapshot_id)
  returning id into v_id;
  return jsonb_build_object('changed', true, 'recipe_version_id', v_id, 'version', v_next);
end $$;

-- A configured reviewer (brand_runtime_config.reviewer_membership_ids)
-- approves/rejects analyses, recipe versions and learning records.
create or replace function private.creative_reviewer(p_brand_id bigint)
returns bigint language sql stable security definer set search_path = '' as $$
  select m from (
    select private.creative_member_for_brand(p_brand_id, array['hq_admin', 'marketing_growth']) as m
  ) x
  where x.m is not null
    and x.m = any (coalesce((select reviewer_membership_ids from creative.brand_runtime_config
                              where brand_id = p_brand_id), '{}'));
$$;

create or replace function public.creative_review_artifact(
  p_kind text, p_id bigint, p_decision text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_brand bigint; v_reviewer bigint; v_ws bigint;
begin
  if p_kind = 'analysis' then
    select brand_id into v_brand from creative.poster_analyses where id = p_id;
  elsif p_kind = 'recipe_version' then
    select r.brand_id into v_brand from creative.recipe_versions v join creative.recipes r on r.id = v.recipe_id where v.id = p_id;
  elsif p_kind = 'learning' then
    select brand_id into v_brand from creative.learning_records where id = p_id;
  else
    raise exception 'creative_bad_kind: %', p_kind;
  end if;
  v_reviewer := private.creative_reviewer(v_brand);
  if v_brand is null or v_reviewer is null then raise exception 'creative_not_reviewer'; end if;
  select workspace_id into v_ws from public.brands where id = v_brand;
  if p_kind = 'analysis' then
    if p_decision not in ('reviewed', 'rejected') then raise exception 'creative_bad_decision'; end if;
    update creative.poster_analyses set status = p_decision, reviewed_by_membership_id = v_reviewer,
      reviewed_at = now() where id = p_id and status = 'draft';
  elsif p_kind = 'recipe_version' then
    if p_decision not in ('approved', 'rejected') then raise exception 'creative_bad_decision'; end if;
    update creative.recipe_versions set status = p_decision, reviewed_by_membership_id = v_reviewer,
      reviewed_at = now() where id = p_id and status = 'draft';
  else
    if p_decision not in ('reviewed', 'rejected') then raise exception 'creative_bad_decision'; end if;
    update creative.learning_records set status = p_decision, reviewed_by_membership_id = v_reviewer,
      reviewed_at = now() where id = p_id and status = 'draft';
  end if;
  if not found then raise exception 'creative_bad_state: % % is not a draft', p_kind, p_id; end if;
  perform private.creative_audit(v_ws, 'creative.' || p_kind || '_' || p_decision, p_kind || ':' || p_id, null);
  return jsonb_build_object('changed', true);
end $$;

-- Immutable context manifest. Requires an APPROVED kit version: drafts are
-- never silently used for production.
create or replace function public.creative_create_context_manifest(
  p_brand_id bigint, p_kit_version_id bigint, p_recipe_version_id bigint,
  p_snapshot_id bigint, p_playbook_version_id bigint, p_raw_asset_ids bigint[], p_claim_ids bigint[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ws bigint; v_manifest jsonb; v_sha text; v_id bigint;
begin
  if not private.creative_can_write(p_brand_id) then raise exception 'creative_forbidden'; end if;
  select workspace_id into v_ws from public.brands where id = p_brand_id;
  if not exists (select 1 from creative.brand_kit_versions v join creative.brand_kits k on k.id = v.brand_kit_id
                 where v.id = p_kit_version_id and k.brand_id = p_brand_id and v.status = 'approved') then
    raise exception 'creative_kit_not_approved';
  end if;
  if p_recipe_version_id is not null and not exists (
      select 1 from creative.recipe_versions v join creative.recipes r on r.id = v.recipe_id
      where v.id = p_recipe_version_id and r.brand_id = p_brand_id and v.status = 'approved') then
    raise exception 'creative_recipe_not_approved';
  end if;
  if exists (select 1 from unnest(p_raw_asset_ids) a
             where not exists (select 1 from creative.raw_assets r where r.id = a and r.workspace_id = v_ws
                               and r.brand_id = p_brand_id)) then
    raise exception 'creative_asset_not_in_brand';
  end if;
  if exists (select 1 from unnest(coalesce(p_claim_ids, '{}')) c
             where not exists (select 1 from creative.approved_claims a where a.id = c
                               and a.brand_id = p_brand_id and a.status = 'approved')) then
    raise exception 'creative_claim_not_approved';
  end if;
  v_manifest := jsonb_build_object(
    'brand_id', p_brand_id,
    'kit_version_id', p_kit_version_id,
    'recipe_version_id', p_recipe_version_id,
    'snapshot_id', p_snapshot_id,
    'playbook_version_id', p_playbook_version_id,
    'raw_assets', (select jsonb_agg(jsonb_build_object('id', r.id, 'sha256', r.sha256) order by r.id)
                   from creative.raw_assets r where r.id = any (p_raw_asset_ids)),
    'claims', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'body', a.body) order by a.id), '[]'::jsonb)
               from creative.approved_claims a where a.id = any (coalesce(p_claim_ids, '{}'))),
    'recipe_spec_sha256', (select spec_sha256 from creative.recipe_versions where id = p_recipe_version_id),
    'snapshot_rows_sha256', (select rows_sha256 from creative.performance_snapshots where id = p_snapshot_id));
  v_sha := private.creative_sha256(v_manifest::text);
  insert into creative.context_manifests (workspace_id, brand_id, kit_version_id, recipe_version_id,
    snapshot_id, playbook_version_id, raw_asset_ids, claim_ids, manifest, manifest_sha256)
  values (v_ws, p_brand_id, p_kit_version_id, p_recipe_version_id, p_snapshot_id, p_playbook_version_id,
    p_raw_asset_ids, coalesce(p_claim_ids, '{}'), v_manifest, v_sha)
  on conflict (workspace_id, manifest_sha256) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from creative.context_manifests where workspace_id = v_ws and manifest_sha256 = v_sha;
  end if;
  return jsonb_build_object('context_manifest_id', v_id, 'manifest_sha256', v_sha);
end $$;

-- Create a batch from a planner output (idempotent on p_idempotency_key).
-- Refuses to start while any owner decision it depends on is missing.
create or replace function public.creative_create_batch(
  p_brand_id bigint, p_market text, p_context_manifest_id bigint, p_plan jsonb, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_ws bigint; v_cfg creative.brand_runtime_config; v_missing text[]; v_batch_id bigint;
  v_fam jsonb; v_var jsonb; v_family_id bigint; v_candidate_id bigint; v_count int; v_est numeric;
  v_stages int[];
begin
  if not private.creative_can_write(p_brand_id) then raise exception 'creative_forbidden'; end if;
  select workspace_id into v_ws from public.brands where id = p_brand_id;
  select id into v_batch_id from creative.batches where workspace_id = v_ws and idempotency_key = p_idempotency_key;
  if v_batch_id is not null then
    return jsonb_build_object('changed', false, 'batch_id', v_batch_id);
  end if;
  select * into v_cfg from creative.brand_runtime_config where brand_id = p_brand_id;
  -- generation needs these four; economics/claims gate launch, not generation
  v_missing := array(select m from unnest(private.creative_missing_config(p_brand_id)) with ordinality u(m, o)
    where m = any (array['image_provider_model', 'batch_budget', 'reviewers', 'provider_data_approval'])
    order by o);
  if cardinality(v_missing) > 0 then
    raise exception 'creative_config_missing: %', array_to_string(v_missing, ',');
  end if;
  if not exists (select 1 from creative.context_manifests where id = p_context_manifest_id and brand_id = p_brand_id) then
    raise exception 'creative_unknown_manifest';
  end if;
  v_count := (select count(*) from jsonb_array_elements(p_plan -> 'families') f,
                jsonb_array_elements(f -> 'variants') v);
  v_est := (p_plan ->> 'estimated_cost_per_candidate')::numeric;
  if v_count = 0 or v_est is null then raise exception 'creative_bad_plan'; end if;
  if v_cfg.max_cost_per_candidate is not null and v_est > v_cfg.max_cost_per_candidate then
    raise exception 'creative_estimate_exceeds_cap';
  end if;
  v_stages := coalesce(array(select jsonb_array_elements_text(p_plan -> 'stages')::int), '{5,20,100}');

  insert into creative.batches (workspace_id, brand_id, market, context_manifest_id, idempotency_key, plan,
    stages, stage_limit, requested_count, provider, model, budget_amount, budget_currency,
    created_by_membership_id)
  values (v_ws, p_brand_id, p_market, p_context_manifest_id, p_idempotency_key, p_plan,
    v_stages, least(v_stages[1], v_count), v_count, v_cfg.image_provider, v_cfg.image_model,
    v_cfg.batch_budget_amount, v_cfg.budget_currency,
    private.creative_member_for_brand(p_brand_id, array['hq_admin', 'marketing_growth']))
  returning id into v_batch_id;

  for v_fam in select * from jsonb_array_elements(p_plan -> 'families') loop
    insert into creative.candidate_families (batch_id, family_index, lane, hypothesis, changed_factors, fixed_factors)
    values (v_batch_id, (v_fam ->> 'index')::int, v_fam ->> 'lane', v_fam ->> 'hypothesis',
      array(select jsonb_array_elements_text(v_fam -> 'changed_factors')),
      array(select jsonb_array_elements_text(v_fam -> 'fixed_factors')))
    returning id into v_family_id;
    for v_var in select * from jsonb_array_elements(v_fam -> 'variants') loop
      insert into creative.candidates (batch_id, family_id, slot_index, variant_spec, input_sha256)
      values (v_batch_id, v_family_id, (v_var ->> 'slot_index')::int, v_var -> 'spec', v_var ->> 'input_sha256')
      returning id into v_candidate_id;
      insert into creative.generation_jobs (candidate_id, estimated_cost, max_attempts)
      values (v_candidate_id, v_est, coalesce((p_plan ->> 'max_attempts')::int, 3));
    end loop;
  end loop;

  perform private.creative_audit(v_ws, 'creative.batch_created', 'batch:' || v_batch_id, null, null,
    jsonb_build_object('requested', v_count, 'budget', v_cfg.batch_budget_amount, 'currency', v_cfg.budget_currency));
  return jsonb_build_object('changed', true, 'batch_id', v_batch_id, 'requested', v_count,
    'stage_limit', least(v_stages[1], v_count));
end $$;

-- Recompute batch status after any job/review transition.
create or replace function private.creative_refresh_batch(p_batch_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v creative.batches; v_open int;
begin
  select * into v from creative.batches where id = p_batch_id for update;
  if v.status in ('cancelled', 'paused_budget') then return; end if;
  select count(*) into v_open
  from creative.generation_jobs j join creative.candidates c on c.id = j.candidate_id
  where c.batch_id = p_batch_id and c.slot_index < v.stage_limit and j.status in ('queued', 'leased');
  if v_open = 0 then
    update creative.batches set status = case when v.stage_limit >= v.requested_count
      then 'completed' else 'awaiting_review' end, version = version + 1
    where id = p_batch_id and status = 'running';
  end if;
end $$;

-- Worker: claim up to p_limit jobs (service role only). Budget is reserved
-- per job BEFORE the provider call; a batch that cannot afford its next job
-- pauses instead of overspending. An expired lease (worker crash) counts as
-- an attempt and its reservation is booked as spent (cost unknown → assume
-- the provider charged).
create or replace function public.creative_claim_jobs(p_worker text, p_limit int, p_lease_seconds int default 300)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_job record; v_batch creative.batches; v_out jsonb := '[]'::jsonb;
begin
  if not private.creative_is_service() then raise exception 'creative_forbidden'; end if;

  -- crashed leases first
  for v_job in
    select j.id, j.reserved_cost, j.attempts, j.max_attempts, c.batch_id, c.id as candidate_id
    from creative.generation_jobs j join creative.candidates c on c.id = j.candidate_id
    where j.status = 'leased' and j.lease_expires_at < now()
    for update of j skip locked
  loop
    update creative.batches set spent_amount = spent_amount + v_job.reserved_cost,
      reserved_amount = greatest(reserved_amount - v_job.reserved_cost, 0)
    where id = v_job.batch_id;
    update creative.generation_jobs set reserved_cost = 0, lease_owner = null, lease_expires_at = null,
      last_error = 'lease_expired', updated_at = now(),
      status = case when v_job.attempts >= v_job.max_attempts then 'dead' else 'queued' end
    where id = v_job.id;
    if v_job.attempts >= v_job.max_attempts then
      update creative.candidates set generation_status = 'failed', updated_at = now() where id = v_job.candidate_id;
      perform private.creative_refresh_batch(v_job.batch_id);
    else
      update creative.candidates set generation_status = 'queued', updated_at = now() where id = v_job.candidate_id;
    end if;
  end loop;

  for v_job in
    select j.id, j.estimated_cost, c.batch_id, c.id as candidate_id, c.slot_index
    from creative.generation_jobs j
    join creative.candidates c on c.id = j.candidate_id
    join creative.batches b on b.id = c.batch_id
    where j.status = 'queued' and b.status = 'running' and c.slot_index < b.stage_limit
    order by b.id, c.slot_index
    for update of j skip locked
    limit greatest(p_limit, 0)
  loop
    select * into v_batch from creative.batches where id = v_job.batch_id for update;
    if v_batch.status != 'running' then continue; end if;
    if v_batch.spent_amount + v_batch.reserved_amount + v_job.estimated_cost > v_batch.budget_amount then
      update creative.batches set status = 'paused_budget', version = version + 1 where id = v_batch.id;
      perform private.creative_audit(v_batch.workspace_id, 'creative.batch_paused_budget',
        'batch:' || v_batch.id, null, null,
        jsonb_build_object('spent', v_batch.spent_amount, 'reserved', v_batch.reserved_amount,
          'next_estimate', v_job.estimated_cost, 'budget', v_batch.budget_amount));
      continue;
    end if;
    update creative.batches set reserved_amount = reserved_amount + v_job.estimated_cost where id = v_batch.id;
    update creative.generation_jobs set status = 'leased', attempts = attempts + 1,
      reserved_cost = v_job.estimated_cost, lease_owner = p_worker,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds), updated_at = now()
    where id = v_job.id;
    update creative.candidates set generation_status = 'generating', updated_at = now() where id = v_job.candidate_id;
    v_out := v_out || jsonb_build_object('job_id', v_job.id, 'candidate_id', v_job.candidate_id,
      'batch_id', v_job.batch_id, 'slot_index', v_job.slot_index,
      'variant_spec', (select variant_spec from creative.candidates where id = v_job.candidate_id),
      'context_manifest_id', v_batch.context_manifest_id,
      'provider', v_batch.provider, 'model', v_batch.model);
  end loop;
  return v_out;
end $$;

-- Worker: record a successful generation. Idempotent for the lease owner;
-- a stale owner (lease expired and re-claimed) is refused.
create or replace function public.creative_complete_job(p_job_id bigint, p_worker text, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_job creative.generation_jobs; v_c creative.candidates; v_dup bigint; v_cost numeric;
begin
  if not private.creative_is_service() then raise exception 'creative_forbidden'; end if;
  select * into v_job from creative.generation_jobs where id = p_job_id for update;
  select * into v_c from creative.candidates where id = v_job.candidate_id for update;
  if v_job.status = 'succeeded' and v_c.output_sha256 = p_result ->> 'output_sha256' then
    return jsonb_build_object('changed', false, 'candidate_id', v_c.id, 'generation_status', v_c.generation_status);
  end if;
  if v_job.status != 'leased' or v_job.lease_owner is distinct from p_worker then
    raise exception 'creative_stale_lease';
  end if;
  if coalesce(p_result ->> 'output_sha256', '') !~ '^[0-9a-f]{64}$' then
    raise exception 'creative_bad_output_sha256';
  end if;
  v_cost := coalesce((p_result ->> 'cost_amount')::numeric, v_job.reserved_cost);
  select id into v_dup from creative.candidates
  where batch_id = v_c.batch_id and output_sha256 = p_result ->> 'output_sha256' and id != v_c.id
  order by slot_index limit 1;

  update creative.batches set spent_amount = spent_amount + v_cost,
    reserved_amount = greatest(reserved_amount - v_job.reserved_cost, 0)
  where id = v_c.batch_id;
  update creative.generation_jobs set status = 'succeeded', reserved_cost = 0, lease_owner = null,
    lease_expires_at = null, updated_at = now() where id = v_job.id;
  update creative.candidates set
    generation_status = case when v_dup is null then 'generated' else 'duplicate' end,
    duplicate_of_candidate_id = v_dup,
    output_ref = p_result ->> 'output_ref', output_sha256 = p_result ->> 'output_sha256',
    provider = p_result ->> 'provider', model = p_result ->> 'model', prompt = p_result ->> 'prompt',
    config = p_result -> 'config', cost_amount = v_cost, version = version + 1, updated_at = now()
  where id = v_c.id;
  perform private.creative_refresh_batch(v_c.batch_id);
  return jsonb_build_object('changed', true, 'candidate_id', v_c.id,
    'generation_status', case when v_dup is null then 'generated' else 'duplicate' end);
end $$;

-- Worker: record a failed attempt; bounded retries.
create or replace function public.creative_fail_job(p_job_id bigint, p_worker text, p_error text, p_cost numeric default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_job creative.generation_jobs; v_batch_id bigint; v_dead boolean;
begin
  if not private.creative_is_service() then raise exception 'creative_forbidden'; end if;
  select * into v_job from creative.generation_jobs where id = p_job_id for update;
  if v_job.status != 'leased' or v_job.lease_owner is distinct from p_worker then
    raise exception 'creative_stale_lease';
  end if;
  select batch_id into v_batch_id from creative.candidates where id = v_job.candidate_id;
  v_dead := v_job.attempts >= v_job.max_attempts;
  update creative.batches set spent_amount = spent_amount + coalesce(p_cost, 0),
    reserved_amount = greatest(reserved_amount - v_job.reserved_cost, 0)
  where id = v_batch_id;
  update creative.generation_jobs set status = case when v_dead then 'dead' else 'queued' end,
    reserved_cost = 0, lease_owner = null, lease_expires_at = null, last_error = left(p_error, 2000),
    updated_at = now() where id = p_job_id;
  update creative.candidates set generation_status = case when v_dead then 'failed' else 'queued' end,
    updated_at = now() where id = v_job.candidate_id;
  perform private.creative_refresh_batch(v_batch_id);
  return jsonb_build_object('dead', v_dead, 'attempts', v_job.attempts);
end $$;

-- Worker: automated QA (dimensions, safe zones, duplicate, text fit ...).
create or replace function public.creative_record_qa(p_candidate_id bigint, p_checks jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_pass boolean;
begin
  if not private.creative_is_service() then raise exception 'creative_forbidden'; end if;
  if not exists (select 1 from creative.candidates where id = p_candidate_id and generation_status = 'generated') then
    raise exception 'creative_bad_state: QA needs a generated candidate';
  end if;
  insert into creative.qa_checks (candidate_id, check_key, passed, detail)
  select p_candidate_id, c ->> 'key', (c ->> 'passed')::boolean, c -> 'detail'
  from jsonb_array_elements(p_checks) c;
  select bool_and((c ->> 'passed')::boolean) into v_pass from jsonb_array_elements(p_checks) c;
  update creative.candidates set qa_status = case when v_pass then 'passed' else 'failed' end,
    version = version + 1, updated_at = now() where id = p_candidate_id;
  return jsonb_build_object('qa_status', case when v_pass then 'passed' else 'failed' end);
end $$;

-- Human review: configured reviewer only, QA must have passed.
create or replace function public.creative_review_candidate(
  p_candidate_id bigint, p_decision text, p_reason_codes text[], p_notes text, p_expected_version int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_c creative.candidates; v_b creative.batches; v_reviewer bigint;
begin
  select * into v_c from creative.candidates where id = p_candidate_id for update;
  select * into v_b from creative.batches where id = v_c.batch_id;
  v_reviewer := private.creative_reviewer(v_b.brand_id);
  if v_c.id is null or v_reviewer is null then raise exception 'creative_not_reviewer'; end if;
  if p_decision not in ('approved', 'rejected', 'changes_requested') then raise exception 'creative_bad_decision'; end if;
  if v_c.version != p_expected_version then raise exception 'creative_version_conflict'; end if;
  if v_c.generation_status != 'generated' or v_c.qa_status != 'passed' then
    raise exception 'creative_bad_state: review needs generated + QA passed (is %/%)', v_c.generation_status, v_c.qa_status;
  end if;
  if v_c.export_status = 'exported' then raise exception 'creative_bad_state: already exported'; end if;
  insert into creative.reviews (candidate_id, reviewer_membership_id, decision, reason_codes, notes)
  values (p_candidate_id, v_reviewer, p_decision, coalesce(p_reason_codes, '{}'), p_notes);
  update creative.candidates set review_status = p_decision, version = version + 1, updated_at = now()
  where id = p_candidate_id;
  perform private.creative_audit(v_b.workspace_id, 'creative.candidate_' || p_decision,
    'candidate:' || p_candidate_id, p_notes);
  return jsonb_build_object('changed', true, 'version', v_c.version + 1);
end $$;

-- Pilot gate: 5 → 20 → 100 only once every candidate in the current
-- stage is terminal and every generated one has a human decision.
create or replace function public.creative_advance_stage(p_batch_id bigint, p_expected_version int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v creative.batches; v_next int; v_pending int;
begin
  select * into v from creative.batches where id = p_batch_id for update;
  if v.id is null or not private.creative_can_write(v.brand_id) then raise exception 'creative_forbidden'; end if;
  if v.version != p_expected_version then raise exception 'creative_version_conflict'; end if;
  if v.status != 'awaiting_review' then raise exception 'creative_bad_state: batch is %', v.status; end if;
  select count(*) into v_pending from creative.candidates c
  where c.batch_id = p_batch_id and c.slot_index < v.stage_limit
    and (c.generation_status in ('queued', 'generating')
         or (c.generation_status = 'generated' and c.qa_status = 'pending')
         or (c.generation_status = 'generated' and c.qa_status = 'passed' and c.review_status = 'pending'));
  if v_pending > 0 then raise exception 'creative_stage_unreviewed: % candidates', v_pending; end if;
  select min(s) into v_next from unnest(v.stages) s where s > v.stage_limit;
  v_next := least(coalesce(v_next, v.requested_count), v.requested_count);
  update creative.batches set stage_limit = v_next, status = 'running', version = version + 1 where id = p_batch_id;
  perform private.creative_audit(v.workspace_id, 'creative.batch_stage_advanced', 'batch:' || p_batch_id, null,
    jsonb_build_object('stage_limit', v.stage_limit), jsonb_build_object('stage_limit', v_next));
  return jsonb_build_object('stage_limit', v_next, 'version', v.version + 1);
end $$;

-- Resume a budget-paused batch after an owner raised the budget.
create or replace function public.creative_resume_batch(p_batch_id bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v creative.batches; v_budget numeric;
begin
  select * into v from creative.batches where id = p_batch_id for update;
  if v.id is null or not private.creative_is_admin(v.brand_id) then raise exception 'creative_forbidden'; end if;
  if v.status != 'paused_budget' then raise exception 'creative_bad_state: batch is %', v.status; end if;
  select batch_budget_amount into v_budget from creative.brand_runtime_config where brand_id = v.brand_id;
  update creative.batches set status = 'running', budget_amount = greatest(budget_amount, coalesce(v_budget, 0)),
    version = version + 1 where id = p_batch_id;
  perform private.creative_audit(v.workspace_id, 'creative.batch_resumed', 'batch:' || p_batch_id, null,
    jsonb_build_object('budget', v.budget_amount), jsonb_build_object('budget', greatest(v.budget_amount, coalesce(v_budget, 0))));
  return jsonb_build_object('status', 'running');
end $$;

-- Export approved candidates (download/hand-off manifest; not a launch).
create or replace function public.creative_export_candidates(p_batch_id bigint, p_candidate_ids bigint[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v creative.batches; v_bad int; v_id bigint; v_manifest jsonb;
begin
  select * into v from creative.batches where id = p_batch_id;
  if v.id is null or not private.creative_can_write(v.brand_id) then raise exception 'creative_forbidden'; end if;
  select count(*) into v_bad from unnest(p_candidate_ids) x
  where not exists (select 1 from creative.candidates c where c.id = x and c.batch_id = p_batch_id
                    and c.review_status = 'approved');
  if v_bad > 0 then raise exception 'creative_export_requires_approval: % candidates', v_bad; end if;
  v_manifest := (select jsonb_agg(jsonb_build_object('candidate_id', c.id, 'output_ref', c.output_ref,
      'output_sha256', c.output_sha256, 'family_id', c.family_id, 'slot_index', c.slot_index) order by c.slot_index)
    from creative.candidates c where c.id = any (p_candidate_ids));
  insert into creative.exports (batch_id, candidate_ids, manifest, created_by_membership_id)
  values (p_batch_id, p_candidate_ids, v_manifest,
    private.creative_member_for_brand(v.brand_id, array['hq_admin', 'marketing_growth']))
  returning id into v_id;
  update creative.candidates set export_status = 'exported', version = version + 1, updated_at = now()
  where id = any (p_candidate_ids);
  perform private.creative_audit(v.workspace_id, 'creative.candidates_exported', 'export:' || v_id, null);
  return jsonb_build_object('export_id', v_id, 'manifest', v_manifest);
end $$;

-- Bind a launched ad (manual or P3 receipt) to the exact exported variant.
create or replace function public.creative_bind_launch(
  p_candidate_id bigint, p_platform text, p_account_id text, p_ad_id text, p_receipt_ref text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_c creative.candidates; v_b creative.batches; v_id bigint; v_existing creative.launch_bindings;
begin
  select * into v_c from creative.candidates where id = p_candidate_id for update;
  select * into v_b from creative.batches where id = v_c.batch_id;
  if v_c.id is null or not private.creative_can_write(v_b.brand_id) then raise exception 'creative_forbidden'; end if;
  if v_c.export_status != 'exported' then raise exception 'creative_bind_requires_export'; end if;
  if coalesce(p_receipt_ref, '') = '' then raise exception 'creative_bind_requires_receipt'; end if;
  select * into v_existing from creative.launch_bindings where platform = p_platform and ad_id = p_ad_id;
  if v_existing.id is not null then
    if v_existing.candidate_id = p_candidate_id then
      return jsonb_build_object('changed', false, 'launch_binding_id', v_existing.id);
    end if;
    raise exception 'creative_ad_already_bound: ad % is bound to candidate %', p_ad_id, v_existing.candidate_id;
  end if;
  insert into creative.launch_bindings (candidate_id, platform, account_id, ad_id, receipt_ref, bound_by_membership_id)
  values (p_candidate_id, p_platform, p_account_id, p_ad_id, p_receipt_ref,
    private.creative_member_for_brand(v_b.brand_id, array['hq_admin', 'marketing_growth']))
  returning id into v_id;
  update creative.candidates set launch_status = 'launched', version = version + 1, updated_at = now()
  where id = p_candidate_id;
  perform private.creative_audit(v_b.workspace_id, 'creative.launch_bound', 'launch_binding:' || v_id,
    p_receipt_ref, null, jsonb_build_object('ad_id', p_ad_id, 'candidate_id', p_candidate_id));
  return jsonb_build_object('changed', true, 'launch_binding_id', v_id);
end $$;

-- Outcomes for a batch: bound ads' delivery exactly as the facts say,
-- with maturity. No allocation, no imputation.
create or replace function public.creative_batch_outcomes(p_batch_id bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v creative.batches;
begin
  select * into v from creative.batches where id = p_batch_id;
  if v.id is null or not private.creative_can_read(v.brand_id) then raise exception 'creative_forbidden'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(o) order by o.slot_index)
    from (
      select c.id as candidate_id, c.slot_index, cf.lane, cf.family_index, lb.ad_id, lb.account_id,
        count(f.id) as fact_days, sum(f.spend) as spend, sum(f.purchases) as purchases,
        sum(f.purchase_value) as purchase_value, max(f.currency_code) as currency_code,
        count(distinct f.currency_code) as currencies,
        bool_or(f.data_maturity = 'maturing') as has_maturing_days,
        min(f.date) as first_date, max(f.date) as last_date, max(f.synced_at) as synced_at
      from creative.launch_bindings lb
      join creative.candidates c on c.id = lb.candidate_id
      join creative.candidate_families cf on cf.id = c.family_id
      left join creative.ad_daily_facts f on f.platform = lb.platform and f.ad_id = lb.ad_id
      where c.batch_id = p_batch_id
      group by c.id, c.slot_index, cf.lane, cf.family_index, lb.ad_id, lb.account_id
    ) o
  ), '[]'::jsonb);
end $$;

-- Learning draft → reviewed (creative_review_artifact) → playbook version.
create or replace function public.creative_record_learning(
  p_brand_id bigint, p_batch_id bigint, p_window_from date, p_window_to date, p_method_version text,
  p_finding text, p_confidence text, p_recommendation text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ws bigint; v_id bigint; v_evidence jsonb;
begin
  if not private.creative_can_write(p_brand_id) then raise exception 'creative_forbidden'; end if;
  select workspace_id into v_ws from public.brands where id = p_brand_id;
  if p_batch_id is not null and not exists (select 1 from creative.batches where id = p_batch_id and brand_id = p_brand_id) then
    raise exception 'creative_unknown_batch';
  end if;
  -- evidence is captured server-side at record time (immutable)
  v_evidence := case when p_batch_id is null then '[]'::jsonb else public.creative_batch_outcomes(p_batch_id) end;
  insert into creative.learning_records (workspace_id, brand_id, batch_id, observation_window, method_version,
    evidence, finding, confidence, recommendation)
  values (v_ws, p_brand_id, p_batch_id, daterange(p_window_from, p_window_to, '[]'), p_method_version,
    v_evidence, p_finding, p_confidence, p_recommendation)
  returning id into v_id;
  return jsonb_build_object('learning_record_id', v_id, 'status', 'draft');
end $$;

create or replace function public.creative_publish_playbook(
  p_brand_id bigint, p_content_md text, p_learning_ids bigint[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ws bigint; v_reviewer bigint; v_parent creative.playbook_versions; v_id bigint; v_unreviewed int;
begin
  v_reviewer := private.creative_reviewer(p_brand_id);
  if v_reviewer is null then raise exception 'creative_not_reviewer'; end if;
  select workspace_id into v_ws from public.brands where id = p_brand_id;
  select count(*) into v_unreviewed from unnest(coalesce(p_learning_ids, '{}')) l
  where not exists (select 1 from creative.learning_records r where r.id = l and r.brand_id = p_brand_id and r.status = 'reviewed');
  if v_unreviewed > 0 then raise exception 'creative_learning_not_reviewed: %', v_unreviewed; end if;
  select * into v_parent from creative.playbook_versions where brand_id = p_brand_id and status = 'approved'
  order by version desc limit 1 for update;
  update creative.playbook_versions set status = 'superseded' where id = v_parent.id;
  insert into creative.playbook_versions (workspace_id, brand_id, version, parent_version_id, content_md,
    learning_record_ids, status, approved_by_membership_id, approved_at)
  values (v_ws, p_brand_id, coalesce(v_parent.version, 0) + 1, v_parent.id, p_content_md,
    coalesce(p_learning_ids, '{}'), 'approved', v_reviewer, now())
  returning id into v_id;
  perform private.creative_audit(v_ws, 'creative.playbook_published', 'playbook_version:' || v_id, null);
  return jsonb_build_object('playbook_version_id', v_id, 'version', coalesce(v_parent.version, 0) + 1);
end $$;

-- Full lineage for one candidate: evidence → recipe → manifest → batch →
-- generation → QA → review → export → launch → outcome.
create or replace function public.creative_candidate_lineage(p_candidate_id bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_c creative.candidates; v_b creative.batches; v_m creative.context_manifests;
begin
  select * into v_c from creative.candidates where id = p_candidate_id;
  select * into v_b from creative.batches where id = v_c.batch_id;
  if v_c.id is null or not private.creative_can_read(v_b.brand_id) then raise exception 'creative_forbidden'; end if;
  select * into v_m from creative.context_manifests where id = v_b.context_manifest_id;
  return jsonb_build_object(
    'candidate', to_jsonb(v_c),
    'family', (select to_jsonb(f) from creative.candidate_families f where f.id = v_c.family_id),
    'batch', to_jsonb(v_b) - 'plan',
    'context_manifest', to_jsonb(v_m),
    'kit_version', (select to_jsonb(k) - 'guidelines_md' from creative.brand_kit_versions k where k.id = v_m.kit_version_id),
    'recipe_version', (select to_jsonb(r) from creative.recipe_versions r where r.id = v_m.recipe_version_id),
    'snapshot', (select to_jsonb(s) - 'rows' from creative.performance_snapshots s where s.id = v_m.snapshot_id),
    'job', (select to_jsonb(j) from creative.generation_jobs j where j.candidate_id = v_c.id),
    'qa', (select coalesce(jsonb_agg(to_jsonb(q) order by q.id), '[]'::jsonb) from creative.qa_checks q where q.candidate_id = v_c.id),
    'reviews', (select coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb) from creative.reviews r where r.candidate_id = v_c.id),
    'exports', (select coalesce(jsonb_agg(jsonb_build_object('export_id', e.id, 'created_at', e.created_at)), '[]'::jsonb)
                from creative.exports e where v_c.id = any (e.candidate_ids)),
    'launch_bindings', (select coalesce(jsonb_agg(to_jsonb(l) order by l.id), '[]'::jsonb)
                        from creative.launch_bindings l where l.candidate_id = v_c.id)
  );
end $$;

create or replace function public.creative_batches(p_brand_id bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.creative_can_read(p_brand_id) then raise exception 'creative_forbidden'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'batch', to_jsonb(b) - 'plan',
      'counts', (select jsonb_build_object(
          'generated', count(*) filter (where c.generation_status = 'generated'),
          'failed', count(*) filter (where c.generation_status = 'failed'),
          'duplicate', count(*) filter (where c.generation_status = 'duplicate'),
          'qa_passed', count(*) filter (where c.qa_status = 'passed'),
          'approved', count(*) filter (where c.review_status = 'approved'),
          'exported', count(*) filter (where c.export_status = 'exported'),
          'launched', count(*) filter (where c.launch_status = 'launched'))
        from creative.candidates c where c.batch_id = b.id)) order by b.created_at desc)
    from creative.batches b where b.brand_id = p_brand_id
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------
-- Grants: user-facing RPCs to authenticated; worker/sync RPCs to the
-- service role only. Everything revoked from public/anon first.
-- ---------------------------------------------------------------------
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'creative\_%'
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
    if f.proname not in ('creative_upsert_image_facts', 'creative_upsert_ad_facts', 'creative_claim_jobs',
                         'creative_complete_job', 'creative_fail_job', 'creative_record_qa') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
  end loop;
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname like 'creative\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
  end loop;
end $$;
