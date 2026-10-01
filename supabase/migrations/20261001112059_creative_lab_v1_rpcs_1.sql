-- Creative lab v1 (ADR-0010), part 2 of 7 — exactly the SQL recorded under
-- this version. Applied in parts because one 93 KB statement exceeds the MCP
-- call budget; every RPC part re-runs the grant lockdown. Annotated source and
-- local contract tests: supabase/reference/creative_lab_v1.sql,
-- supabase/tests/creative_lab.sql (scripts/creative/test-sql.sh).

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
    provider_pricing = case when p_patch ? 'provider_pricing' then p_patch -> 'provider_pricing' else c.provider_pricing end,
    version = c.version + 1,
    updated_at = now(),
    updated_by_membership_id = private.creative_member_for_brand(p_brand_id, array['hq_admin'])
  where c.brand_id = p_brand_id
  returning * into v_after;
  perform private.creative_audit(v_brand.workspace_id, 'creative.runtime_config_set',
    'brand:' || p_brand_id, null, to_jsonb(v_before), to_jsonb(v_after));
  return jsonb_build_object('changed', true, 'version', v_after.version);
end $$;
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'creative\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
    if f.proname not in ('creative_upsert_image_facts', 'creative_upsert_ad_facts', 'creative_claim_jobs',
                         'creative_complete_job', 'creative_fail_job', 'creative_record_qa',
                         'creative_get_provider_key', 'creative_worker_context') then
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
