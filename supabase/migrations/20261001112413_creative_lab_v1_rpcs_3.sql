-- Creative lab v1 (ADR-0010), part 4 of 7 — exactly the SQL recorded under
-- this version. Applied in parts because one 93 KB statement exceeds the MCP
-- call budget; every RPC part re-runs the grant lockdown. Annotated source and
-- local contract tests: supabase/reference/creative_lab_v1.sql,
-- supabase/tests/creative_lab.sql (scripts/creative/test-sql.sh).

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
