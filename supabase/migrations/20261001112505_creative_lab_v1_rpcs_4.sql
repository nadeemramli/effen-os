-- Creative lab v1 (ADR-0010), part 5 of 7 — exactly the SQL recorded under
-- this version. Applied in parts because one 93 KB statement exceeds the MCP
-- call budget; every RPC part re-runs the grant lockdown. Annotated source and
-- local contract tests: supabase/reference/creative_lab_v1.sql,
-- supabase/tests/creative_lab.sql (scripts/creative/test-sql.sh).

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
  v_missing := array(select m from unnest(private.creative_missing_config(p_brand_id)) with ordinality u(m, o)
    where m = any (array['image_provider_model', 'batch_budget', 'reviewers', 'provider_data_approval',
                         'provider_credentials', 'provider_pricing'])
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
create or replace function public.creative_worker_context(p_context_manifest_id bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_m creative.context_manifests; v_cfg creative.brand_runtime_config;
begin
  if not private.creative_is_service() then raise exception 'creative_forbidden'; end if;
  select * into v_m from creative.context_manifests where id = p_context_manifest_id;
  if v_m.id is null then raise exception 'creative_unknown_manifest'; end if;
  select * into v_cfg from creative.brand_runtime_config where brand_id = v_m.brand_id;
  return jsonb_build_object(
    'context_manifest_id', v_m.id,
    'manifest_sha256', v_m.manifest_sha256,
    'brand_id', v_m.brand_id,
    'tokens', (select tokens from creative.brand_kit_versions where id = v_m.kit_version_id),
    'assets', (select coalesce(jsonb_agg(jsonb_build_object('sha256', r.sha256, 'storage_ref', r.storage_ref,
                 'mime_type', r.mime_type, 'width', r.width, 'height', r.height) order by r.id), '[]'::jsonb)
               from creative.raw_assets r where r.id = any (v_m.raw_asset_ids)),
    'approved_claim_ids', to_jsonb(v_m.claim_ids),
    'max_cost_per_candidate', v_cfg.max_cost_per_candidate,
    'image_provider', v_cfg.image_provider,
    'image_model', v_cfg.image_model,
    'provider_data_approved', coalesce(v_cfg.provider_data_approved, false),
    'provider_pricing', coalesce(v_cfg.provider_pricing, '{}'::jsonb));
end $$;
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
