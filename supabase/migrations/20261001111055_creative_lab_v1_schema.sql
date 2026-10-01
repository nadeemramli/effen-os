-- Creative lab v1 (ADR-0010), part 1 of 7 — exactly the SQL recorded under
-- this version. Applied in parts because one 93 KB statement exceeds the MCP
-- call budget; every RPC part re-runs the grant lockdown. Annotated source and
-- local contract tests: supabase/reference/creative_lab_v1.sql,
-- supabase/tests/creative_lab.sql (scripts/creative/test-sql.sh).

create schema if not exists creative;
revoke all on schema creative from public;
grant usage on schema creative to service_role;
create or replace function private.creative_is_service()
returns boolean language sql stable set search_path = '' as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  ) = 'service_role';
$$;
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
  provider_pricing jsonb not null default '{}'::jsonb,
  version int not null default 1,
  updated_by_membership_id bigint references public.memberships (id),
  updated_at timestamptz not null default now()
);
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
