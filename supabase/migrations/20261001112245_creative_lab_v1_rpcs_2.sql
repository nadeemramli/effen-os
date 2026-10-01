-- Creative lab v1 (ADR-0010), part 3 of 7 — exactly the SQL recorded under
-- this version. Applied in parts because one 93 KB statement exceeds the MCP
-- call budget; every RPC part re-runs the grant lockdown. Annotated source and
-- local contract tests: supabase/reference/creative_lab_v1.sql,
-- supabase/tests/creative_lab.sql (scripts/creative/test-sql.sh).

create or replace function private.creative_secret_name(p_provider text)
returns text language sql immutable set search_path = '' as $$
  select case lower(p_provider) when 'openai' then 'CREATIVE_OPENAI_API_KEY' end;
$$;
create or replace function public.creative_set_provider_key(p_provider text, p_api_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ws bigint := (select min(id) from public.workspaces); v_name text; v_secret_id uuid;
begin
  if not private.has_role(v_ws, array['hq_admin']) then raise exception 'creative_forbidden'; end if;
  v_name := private.creative_secret_name(p_provider);
  if v_name is null then raise exception 'creative_unsupported_provider: %', p_provider; end if;
  if length(coalesce(p_api_key, '')) < 20 then raise exception 'creative_key_too_short'; end if;
  select id into v_secret_id from vault.secrets where name = v_name;
  if v_secret_id is null then
    perform vault.create_secret(p_api_key, v_name, 'Creative lab ' || lower(p_provider) || ' API key');
  else
    perform vault.update_secret(v_secret_id, p_api_key, v_name, 'Creative lab ' || lower(p_provider) || ' API key');
  end if;
  insert into public.integration_connections (workspace_id, provider, name, category, environment, direction,
    read_scopes, write_scopes, secret_ref, status, freshness_sla_minutes, notes)
  select v_ws, 'OpenAI', 'OpenAI — creative lab', 'ai', 'production', 'read',
    array['images.generate (supporting backgrounds)', 'responses (poster analysis)'], '{}', v_name, 'pending_setup', 1440,
    'Creative lab provider. Key stored in Vault; calls run only in the generation worker under a batch budget.'
  where not exists (select 1 from public.integration_connections where secret_ref = v_name);
  update public.integration_connections set notes = 'Key stored ' || to_char(now(), 'YYYY-MM-DD') ||
    '. Calls run only in the generation worker under a batch budget.'
  where secret_ref = v_name;
  perform private.creative_audit(v_ws, 'creative.provider_key_set', 'provider:' || lower(p_provider),
    'API key stored in Vault (value not logged)');
  return jsonb_build_object('provider', lower(p_provider), 'key_set', true);
end $$;
create or replace function public.creative_provider_status()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_ws bigint := (select min(id) from public.workspaces);
begin
  if not (private.creative_is_service() or private.has_role(v_ws, array['hq_admin', 'marketing_growth', 'analyst'])) then
    raise exception 'creative_forbidden';
  end if;
  return (select jsonb_agg(jsonb_build_object('provider', p, 'key_set', s.id is not null, 'set_at', s.updated_at))
          from unnest(array['openai']) p
          left join vault.secrets s on s.name = private.creative_secret_name(p));
end $$;
create or replace function public.creative_get_provider_key(p_provider text)
returns text language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.creative_is_service() then raise exception 'creative_forbidden'; end if;
  return (select decrypted_secret from vault.decrypted_secrets
          where name = private.creative_secret_name(p_provider));
end $$;
create or replace function private.creative_missing_config(p_brand_id bigint)
returns text[] language sql stable security definer set search_path = '' as $$
  with c as (select * from creative.brand_runtime_config where brand_id = p_brand_id)
  select array_remove(array[
    case when (select image_provider from c) is null or (select image_model from c) is null then 'image_provider_model' end,
    case when (select analysis_provider from c) is null or (select analysis_model from c) is null then 'analysis_provider_model' end,
    case when (select batch_budget_amount from c) is null or (select budget_currency from c) is null then 'batch_budget' end,
    case when coalesce(cardinality((select reviewer_membership_ids from c)), 0) = 0 then 'reviewers' end,
    case when not coalesce((select provider_data_approved from c), false) then 'provider_data_approval' end,
    case when coalesce((select image_provider from c), 'fixture') != 'fixture'
          and not exists (select 1 from vault.secrets s
                          where s.name = private.creative_secret_name((select image_provider from c)))
         then 'provider_credentials' end,
    case when coalesce((select image_provider from c), 'fixture') != 'fixture'
          and ((select provider_pricing from c) ->> 'image_estimate_per_call') is null
         then 'provider_pricing' end,
    case when (select target_cpa from c) is null and (select target_roas from c) is null then 'target_economics' end,
    case when (select media_test_budget_amount from c) is null then 'media_test_budget' end,
    case when not exists (select 1 from creative.approved_claims a
      where a.brand_id = p_brand_id and a.status = 'approved' and a.kind in ('product', 'claim', 'copy')) then 'approved_copy' end,
    case when not exists (select 1 from creative.approved_claims a
      where a.brand_id = p_brand_id and a.status = 'approved' and a.kind = 'offer') then 'approved_offer' end
  ], null);
$$;
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
