-- Creative Learning & Poster Production — SQL contract tests (ADR-0010).
--
-- Runs on the local harness via scripts/creative/test-sql.sh. Each block
-- raises on failure and prints `ok: <name>`; the run stops at the first
-- failure (psql ON_ERROR_STOP). Covers: idempotent import, draft-only
-- kits, RLS/direct-table denial, cross-brand isolation, role gates,
-- missing-config refusal, fact upsert + late-conversion revision, cohort
-- separation, batch idempotency, duplicate inputs/outputs, pilot stage
-- limits, budget reservation/pause/resume, crash/lease expiry, bounded
-- retries, stale leases, QA → review → stage gate → export → launch
-- binding → outcomes → reviewed learning → playbook revision, lineage,
-- and audit.

set client_min_messages = notice;

-- ---------------------------------------------------------------------
-- Actors and fixtures
-- ---------------------------------------------------------------------
create schema t;
grant usage on schema t to authenticated, anon, service_role;

create function t.as_user(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;
create function t.as_service() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true);
  select set_config('role', 'service_role', true);
$$;
create function t.as_anon() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"anon"}', true);
  select set_config('role', 'anon', true);
$$;
create function t.as_owner() returns void language sql as $$
  select set_config('request.jwt.claims', '', true);
  select set_config('role', 'none', true);
$$;
grant execute on all functions in schema t to authenticated, anon, service_role;

create function t.sha(p text) returns text language sql as $$
  select encode(sha256(convert_to(p, 'UTF8')), 'hex');
$$;
grant execute on function t.sha(text) to authenticated, anon, service_role;

-- Expect `p_sql` to raise an error whose message matches `p_pattern`.
create function t.expect_error(p_sql text, p_pattern text) returns void language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected error matching "%" but statement succeeded: %', p_pattern, p_sql;
exception when others then
  if sqlerrm like 'expected error matching%' then raise; end if;
  if sqlerrm !~* p_pattern then
    raise exception 'expected error matching "%", got "%"', p_pattern, sqlerrm;
  end if;
end $$;
grant execute on function t.expect_error(text, text) to authenticated, anon, service_role;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@effen.test'),
  ('00000000-0000-0000-0000-00000000000b', 'growth@effen.test'),      -- unscoped marketing
  ('00000000-0000-0000-0000-00000000000c', 'scoped@effen.test'),      -- marketing, brand B only
  ('00000000-0000-0000-0000-00000000000d', 'analyst@effen.test'),
  ('00000000-0000-0000-0000-00000000000e', 'ops@effen.test'),
  ('00000000-0000-0000-0000-00000000000f', 'reviewer@effen.test');    -- marketing, configured reviewer
insert into public.workspaces (name) values ('EFFEN');
insert into public.brands (workspace_id, name, slug) values
  (1, 'Adipocyde', 'adipocyde'), (1, 'Lipidri', 'lipidri');
insert into public.memberships (workspace_id, user_id, role_key, status) values
  (1, '00000000-0000-0000-0000-00000000000a', 'hq_admin', 'active'),
  (1, '00000000-0000-0000-0000-00000000000b', 'marketing_growth', 'active'),
  (1, '00000000-0000-0000-0000-00000000000c', 'marketing_growth', 'active'),
  (1, '00000000-0000-0000-0000-00000000000d', 'analyst', 'active'),
  (1, '00000000-0000-0000-0000-00000000000e', 'operations', 'active'),
  (1, '00000000-0000-0000-0000-00000000000f', 'marketing_growth', 'active');
insert into public.membership_brand_scopes (membership_id, brand_id) values (3, 2);  -- scoped → Lipidri only

-- ---------------------------------------------------------------------
-- 1. Brand-kit import is idempotent, de-duplicates bytes, lands DRAFT
-- ---------------------------------------------------------------------
do $$
declare r jsonb; r2 jsonb; r3 jsonb; n int;
begin
  perform t.as_service();
  r := public.creative_import_brand_kit(jsonb_build_object(
    'brand_slug', 'adipocyde', 'provenance', 'website_derived', 'completeness', 'detailed',
    'manifest_sha256', t.sha('manifest-1'), 'source_root', 'creative/adipocyde',
    'tokens', '{"colors":{"primary":"#0B5"}}'::jsonb,
    'assets', jsonb_build_array(
      jsonb_build_object('sha256', t.sha('png-1'), 'filename', 'front.png', 'role', 'packshot', 'source_path', 'raw-materials/front.png'),
      jsonb_build_object('sha256', t.sha('png-2'), 'filename', 'side.png', 'role', 'packshot', 'source_path', 'raw-materials/side.png'))));
  if not (r ->> 'changed')::boolean or r ->> 'status' != 'draft' or (r ->> 'new_assets')::int != 2 then
    raise exception 'first import wrong: %', r; end if;
  r2 := public.creative_import_brand_kit(jsonb_build_object(
    'brand_slug', 'adipocyde', 'provenance', 'website_derived', 'manifest_sha256', t.sha('manifest-1'), 'assets', '[]'::jsonb));
  if (r2 ->> 'changed')::boolean or (r2 ->> 'kit_version_id') != (r ->> 'kit_version_id') then
    raise exception 're-import not idempotent: %', r2; end if;
  r3 := public.creative_import_brand_kit(jsonb_build_object(
    'brand_slug', 'adipocyde', 'provenance', 'owner_supplied', 'manifest_sha256', t.sha('manifest-2'),
    'assets', jsonb_build_array(
      jsonb_build_object('sha256', t.sha('png-2'), 'filename', 'side-copy.png', 'role', 'packshot', 'source_path', 'raw-materials/side-copy.png'),
      jsonb_build_object('sha256', t.sha('png-3'), 'filename', 'logo.png', 'role', 'logo', 'source_path', 'logo.png'))));
  if (r3 ->> 'version')::int != 2 or (r3 ->> 'new_assets')::int != 1 then raise exception 'v2 wrong: %', r3; end if;
  perform t.as_owner();
  select count(*) into n from creative.raw_assets;
  if n != 3 then raise exception 'expected 3 distinct raw assets by sha256, got %', n; end if;
  if exists (select 1 from creative.brand_kit_versions where status != 'draft') then
    raise exception 'import must never approve a kit'; end if;
  perform t.as_service();
  perform t.expect_error($q$ select public.creative_import_brand_kit('{"brand_slug":"adipocyde","manifest_sha256":"nope","provenance":"fixture"}') $q$,
    'creative_bad_manifest_sha256');
  perform t.as_owner();
  raise notice 'ok: import idempotent, byte-deduplicated, draft-only';
end $$;

-- ---------------------------------------------------------------------
-- 2. Access: anon/direct table denial, role and brand-scope gates
-- ---------------------------------------------------------------------
do $$
declare r jsonb;
begin
  perform t.as_anon();
  perform t.expect_error($q$ select public.creative_readiness() $q$, 'permission denied');
  perform t.as_user('00000000-0000-0000-0000-00000000000b');
  perform t.expect_error($q$ select count(*) from creative.image_daily_facts $q$, 'permission denied');
  perform t.expect_error($q$ select public.creative_upsert_image_facts('[]') $q$, 'permission denied');
  perform t.expect_error($q$ select public.creative_import_brand_kit(jsonb_build_object('brand_slug','adipocyde',
      'manifest_sha256', t.sha('m-x'), 'provenance','fixture')) $q$, 'creative_forbidden');
  r := public.creative_readiness();
  if jsonb_array_length(r) != 2 then raise exception 'unscoped marketing should see 2 brands, saw %', r; end if;

  perform t.as_user('00000000-0000-0000-0000-00000000000c');   -- scoped to Lipidri
  r := public.creative_readiness();
  if jsonb_array_length(r) != 1 or r -> 0 ->> 'brand_slug' != 'lipidri' then
    raise exception 'scoped member leaked brands: %', r; end if;
  perform t.expect_error($q$ select public.creative_image_leaderboard(1, null, '2026-01-01', '2026-12-31') $q$, 'creative_forbidden');
  perform t.expect_error($q$ select public.creative_image_evidence(1, 'acc1', 'h1') $q$, 'creative_forbidden');
  perform t.expect_error($q$ select public.creative_batches(1) $q$, 'creative_forbidden');
  perform public.creative_image_leaderboard(2, null, '2026-01-01', '2026-12-31');

  perform t.as_user('00000000-0000-0000-0000-00000000000d');   -- analyst: read, no write
  perform public.creative_image_leaderboard(1, null, '2026-01-01', '2026-12-31');
  perform t.expect_error($q$ select public.creative_snapshot_performance(1, 'MY', '2026-01-01', '2026-12-31', 'v1') $q$, 'creative_forbidden');

  perform t.as_user('00000000-0000-0000-0000-00000000000e');   -- operations: nothing
  r := public.creative_readiness();
  if jsonb_array_length(r) != 0 then raise exception 'operations should see no creative brands: %', r; end if;
  perform t.expect_error($q$ select public.creative_image_leaderboard(1, null, '2026-01-01', '2026-12-31') $q$, 'creative_forbidden');
  perform t.as_owner();
  raise notice 'ok: anon/direct denial, role gates, cross-brand isolation';
end $$;

-- ---------------------------------------------------------------------
-- 3. Facts: service-only upsert, late-conversion revision, cohorts kept apart
-- ---------------------------------------------------------------------
do $$
declare r jsonb; n int;
begin
  perform t.as_service();
  perform public.creative_upsert_image_facts('[
    {"date":"2026-09-01","account_id":"acc1","image_hash":"h1","brand_slug":"adipocyde","market":"MY","currency_code":"MYR","campaign_objective":"OUTCOME_SALES","attribution_setting":"7d_click_1d_view","account_timezone":"Asia/Kuala_Lumpur","ads":2,"ad_ids":["ad1","ad2"],"spend":100,"impressions":10000,"clicks":200,"purchases":4,"purchase_value":600,"data_maturity":"maturing"},
    {"date":"2026-09-02","account_id":"acc1","image_hash":"h1","brand_slug":"adipocyde","market":"MY","currency_code":"MYR","campaign_objective":"OUTCOME_SALES","attribution_setting":"7d_click_1d_view","account_timezone":"Asia/Kuala_Lumpur","ads":1,"ad_ids":["ad1"],"spend":50,"impressions":5000,"clicks":90,"purchases":1,"purchase_value":150,"data_maturity":"maturing"},
    {"date":"2026-09-01","account_id":"acc9","image_hash":"h1","brand_slug":"adipocyde","market":"SG","currency_code":"SGD","campaign_objective":"OUTCOME_SALES","attribution_setting":"7d_click_1d_view","account_timezone":"Asia/Singapore","ads":1,"ad_ids":["ad9"],"spend":40,"impressions":3000,"clicks":50,"purchases":1,"purchase_value":60,"data_maturity":"settled"}
  ]');
  -- late conversions arrive: same grain, revised purchases, now settled
  perform public.creative_upsert_image_facts('[
    {"date":"2026-09-01","account_id":"acc1","image_hash":"h1","brand_slug":"adipocyde","market":"MY","currency_code":"MYR","campaign_objective":"OUTCOME_SALES","attribution_setting":"7d_click_1d_view","account_timezone":"Asia/Kuala_Lumpur","ads":2,"ad_ids":["ad1","ad2"],"spend":100,"impressions":10000,"clicks":200,"purchases":6,"purchase_value":900,"data_maturity":"settled"}
  ]');
  perform t.as_owner();
  select count(*) into n from creative.image_daily_facts;
  if n != 3 then raise exception 'upsert must not duplicate grain rows, got %', n; end if;
  if (select purchases from creative.image_daily_facts where date = '2026-09-01' and account_id = 'acc1') != 6 then
    raise exception 'late conversions must revise the outcome'; end if;
  if (select count(*) from creative.platform_image_refs) != 2 then
    raise exception 'platform image refs should be registered per account+hash'; end if;

  perform t.as_user('00000000-0000-0000-0000-00000000000b');
  r := public.creative_image_leaderboard(1, null, '2026-08-01', '2026-09-30');
  if jsonb_array_length(r -> 'rows') != 2 then raise exception 'MY and SG cohorts must stay separate: %', r; end if;
  r := public.creative_image_leaderboard(1, 'MY', '2026-08-01', '2026-09-30');
  if jsonb_array_length(r -> 'rows') != 1 or (r -> 'rows' -> 0 ->> 'spend')::numeric != 150
     or (r -> 'rows' -> 0 ->> 'purchases')::int != 7 or (r -> 'rows' -> 0 ->> 'distinct_ads')::int != 2
     or (r -> 'rows' -> 0 ->> 'maturing_spend')::numeric != 50 then
    raise exception 'MY leaderboard aggregate wrong: %', r; end if;
  perform t.as_owner();
  raise notice 'ok: facts upsert, revision, cohort separation, distinct ads, maturity';
end $$;

-- ---------------------------------------------------------------------
-- 4. Batch refused while owner decisions are missing; drafts not usable
-- ---------------------------------------------------------------------
do $$
declare v_assets bigint[] := (select array_agg(id order by id) from creative.raw_assets
                              where sha256 in (t.sha('png-2'), t.sha('png-3')));
begin
  perform t.as_user('00000000-0000-0000-0000-00000000000b');
  perform t.expect_error($q$ select public.creative_create_context_manifest(1, 1, null, null, null, array[1]::bigint[], '{}') $q$,
    'creative_kit_not_approved');
  perform t.expect_error($q$ select public.creative_approve_kit_version(1) $q$, 'creative_forbidden');
  perform t.as_user('00000000-0000-0000-0000-00000000000a');
  perform public.creative_approve_kit_version(2);
  perform t.expect_error($q$ select public.creative_approve_kit_version(2) $q$, 'creative_bad_state');
  perform t.as_user('00000000-0000-0000-0000-00000000000b');
  perform public.creative_create_context_manifest(1, 2, null, null, null, v_assets, '{}');
  perform t.expect_error($q$ select public.creative_create_batch(1, 'MY', 1,
      '{"estimated_cost_per_candidate":1,"families":[{"index":0,"lane":"exploit","hypothesis":"h","changed_factors":["headline"],"fixed_factors":["layout"],"variants":[{"slot_index":0,"input_sha256":"a","spec":{}}]}]}',
      'k-missing') $q$, 'creative_config_missing: image_provider_model,batch_budget,reviewers,provider_data_approval');
  perform t.as_owner();
  raise notice 'ok: missing config refuses batch; draft kits unusable; approval admin-only';
end $$;

-- ---------------------------------------------------------------------
-- 5. Configure, plan 20 candidates (4 families × 5), pilot stages 5 → 20
-- ---------------------------------------------------------------------
do $$
declare v_plan jsonb; r jsonb; r2 jsonb;
begin
  perform t.as_user('00000000-0000-0000-0000-00000000000b');
  perform t.expect_error($q$ select public.creative_set_runtime_config(1, '{"image_provider":"x"}') $q$, 'creative_forbidden');
  perform t.as_user('00000000-0000-0000-0000-00000000000a');
  perform public.creative_set_runtime_config(1, '{"image_provider":"fixture","image_model":"fixture-v1",
    "batch_budget_amount":4.5,"budget_currency":"USD","reviewer_membership_ids":[6],"provider_data_approved":true}', 1);
  perform t.expect_error($q$ select public.creative_set_runtime_config(1, '{"image_model":"y"}', 1) $q$, 'creative_version_conflict');

  select jsonb_build_object('estimated_cost_per_candidate', 1, 'max_attempts', 2, 'stages', '[5,20]'::jsonb,
    'families', jsonb_agg(jsonb_build_object('index', f, 'lane', case when f < 2 then 'exploit' when f = 2 then 'adjacent' else 'explore' end,
      'hypothesis', 'family ' || f, 'changed_factors', '["headline"]'::jsonb, 'fixed_factors', '["layout","packshot"]'::jsonb,
      'variants', (select jsonb_agg(jsonb_build_object('slot_index', f * 5 + v, 'input_sha256', t.sha('in-' || (f * 5 + v)),
        'spec', jsonb_build_object('headline', 'H' || (f * 5 + v)))) from generate_series(0, 4) v))))
  into v_plan from generate_series(0, 3) f;

  perform t.as_user('00000000-0000-0000-0000-00000000000b');
  r := public.creative_create_batch(1, 'MY', 1, v_plan, 'batch-1');
  r2 := public.creative_create_batch(1, 'MY', 1, v_plan, 'batch-1');
  if (r2 ->> 'changed')::boolean or r2 ->> 'batch_id' != r ->> 'batch_id' then raise exception 'batch create not idempotent'; end if;
  if (r ->> 'requested')::int != 20 or (r ->> 'stage_limit')::int != 5 then raise exception 'batch shape wrong: %', r; end if;

  -- identical inputs are not distinct candidates
  perform t.expect_error(format($q$ select public.creative_create_batch(1, 'MY', 1, %L, 'batch-dup') $q$,
    jsonb_set(v_plan, '{families,0,variants,1,input_sha256}', v_plan #> '{families,0,variants,0,input_sha256}')),
    'duplicate key');
  perform t.as_owner();
  raise notice 'ok: owner config versioned; 20-candidate plan; idempotent; duplicate inputs refused';
end $$;

-- ---------------------------------------------------------------------
-- 6. Worker: stage limit, budget reservation and pause, stale lease,
--    idempotent completion, duplicate output, crash, bounded retries
-- ---------------------------------------------------------------------
do $$
declare j jsonb; k jsonb; r jsonb; v_job bigint; b creative.batches;
begin
  perform t.as_user('00000000-0000-0000-0000-00000000000b');
  perform t.expect_error($q$ select public.creative_claim_jobs('w1', 10) $q$, 'permission denied');
  perform t.as_service();
  j := public.creative_claim_jobs('w1', 10, 300);
  -- budget 4.5 at 1.0/job → 4 reserved, 5th pauses the batch; never slot ≥ 5
  if jsonb_array_length(j) != 4 then raise exception 'expected 4 claims under budget, got %', jsonb_array_length(j); end if;
  if exists (select 1 from jsonb_array_elements(j) x where (x ->> 'slot_index')::int >= 5) then
    raise exception 'claimed beyond pilot stage limit'; end if;
  perform t.as_owner();
  select * into b from creative.batches where id = 1;
  if b.status != 'paused_budget' or b.reserved_amount != 4 then raise exception 'budget pause wrong: % %', b.status, b.reserved_amount; end if;

  perform t.as_service();
  if jsonb_array_length(public.creative_claim_jobs('w2', 10)) != 0 then raise exception 'paused batch must not be claimable'; end if;

  -- job 0: success; job 1: same output bytes → duplicate
  perform t.expect_error(format($q$ select public.creative_complete_job(%s, 'intruder', '{"output_sha256":"%s"}') $q$,
    j -> 0 ->> 'job_id', t.sha('out-0')), 'creative_stale_lease');
  r := public.creative_complete_job((j -> 0 ->> 'job_id')::bigint, 'w1', jsonb_build_object('output_sha256', t.sha('out-0'),
    'output_ref', 'fixture://out-0.svg', 'provider', 'fixture', 'model', 'fixture-v1', 'prompt', 'p0', 'cost_amount', 0.8));
  if r ->> 'generation_status' != 'generated' then raise exception 'complete wrong: %', r; end if;
  r := public.creative_complete_job((j -> 0 ->> 'job_id')::bigint, 'w1', jsonb_build_object('output_sha256', t.sha('out-0')));
  if (r ->> 'changed')::boolean then raise exception 'repeat completion must be a no-op'; end if;
  r := public.creative_complete_job((j -> 1 ->> 'job_id')::bigint, 'w1', jsonb_build_object('output_sha256', t.sha('out-0'),
    'output_ref', 'fixture://out-1.svg', 'provider', 'fixture', 'model', 'fixture-v1', 'cost_amount', 0.8));
  if r ->> 'generation_status' != 'duplicate' then raise exception 'duplicate output not detected: %', r; end if;

  -- job 2: provider error → requeued (attempt 1 of 2), cost booked
  r := public.creative_fail_job((j -> 2 ->> 'job_id')::bigint, 'w1', 'provider 500', 0.1);
  if (r ->> 'dead')::boolean then raise exception 'first failure must retry'; end if;

  -- job 3: worker crashes (lease expires)
  perform t.as_owner();
  update creative.generation_jobs set lease_expires_at = now() - interval '1 minute' where id = (j -> 3 ->> 'job_id')::bigint;
  select * into b from creative.batches where id = 1;
  -- spent 0.8 + 0.8 + 0.1 = 1.7; reserved: job 3 only = 1
  if b.spent_amount != 1.7 or b.reserved_amount != 1 then raise exception 'ledger wrong: spent % reserved %', b.spent_amount, b.reserved_amount; end if;

  -- owner raises budget and resumes
  perform t.as_user('00000000-0000-0000-0000-00000000000a');
  perform public.creative_set_runtime_config(1, '{"batch_budget_amount":20}');
  perform public.creative_resume_batch(1);

  perform t.as_service();
  k := public.creative_claim_jobs('w3', 10, 300);
  perform t.as_owner();
  select * into b from creative.batches where id = 1;
  -- crashed reservation booked as spent (1.7 + 1 = 2.7); slots 2, 3, 4 claimed
  if b.spent_amount != 2.7 then raise exception 'crash reservation not booked as spent: %', b.spent_amount; end if;
  if jsonb_array_length(k) != 3 then raise exception 'expected 3 claims after resume, got %', k; end if;
  if (select attempts from creative.generation_jobs where id = (j -> 3 ->> 'job_id')::bigint) != 2 then
    raise exception 'crash must count as an attempt'; end if;

  perform t.as_service();
  -- slot 2 fails again → dead (max_attempts 2); slot 3 crashed earlier, now succeeds; slot 4 succeeds
  r := public.creative_fail_job((j -> 2 ->> 'job_id')::bigint, 'w3', 'provider 500', 0);
  if not (r ->> 'dead')::boolean then raise exception 'second failure must be terminal'; end if;
  perform public.creative_complete_job((j -> 3 ->> 'job_id')::bigint, 'w3', jsonb_build_object('output_sha256', t.sha('out-3'),
    'output_ref', 'fixture://out-3.svg', 'provider', 'fixture', 'model', 'fixture-v1', 'cost_amount', 1));
  perform public.creative_complete_job((select (x ->> 'job_id')::bigint from jsonb_array_elements(k) x where (x ->> 'slot_index')::int = 4),
    'w3', jsonb_build_object('output_sha256', t.sha('out-4'), 'output_ref', 'fixture://out-4.svg', 'provider', 'fixture',
    'model', 'fixture-v1', 'cost_amount', 1));
  perform t.as_owner();
  select * into b from creative.batches where id = 1;
  if b.status != 'awaiting_review' then raise exception 'stage 1 should await review, is %', b.status; end if;
  if b.reserved_amount != 0 then raise exception 'reservations must be released: %', b.reserved_amount; end if;
  if (select generation_status from creative.candidates where slot_index = 2 and batch_id = 1) != 'failed' then
    raise exception 'dead job must fail its candidate'; end if;
  raise notice 'ok: stage limit, budget reserve/pause/resume, stale lease, idempotent complete, duplicate output, crash, bounded retries';
end $$;

-- ---------------------------------------------------------------------
-- 7. QA → human review → stage gate → export → launch binding → outcomes
-- ---------------------------------------------------------------------
do $$
declare c0 bigint; c3 bigint; c4 bigint; r jsonb; v int; w int;
begin
  select id into c0 from creative.candidates where batch_id = 1 and slot_index = 0;
  select id into c3 from creative.candidates where batch_id = 1 and slot_index = 3;
  select id into c4 from creative.candidates where batch_id = 1 and slot_index = 4;

  perform t.as_user('00000000-0000-0000-0000-00000000000f');
  perform t.expect_error(format($q$ select public.creative_review_candidate(%s, 'approved', '{}', null, 2) $q$, c0), 'creative_bad_state');
  perform t.as_service();
  perform t.expect_error(format($q$ select public.creative_record_qa(%s, '[]') $q$,
    (select id from creative.candidates where batch_id = 1 and slot_index = 1)), 'creative_bad_state');  -- duplicate
  perform public.creative_record_qa(c0, '[{"key":"dimensions","passed":true},{"key":"packshot_unaltered","passed":true}]');
  perform public.creative_record_qa(c3, '[{"key":"dimensions","passed":true}]');
  perform public.creative_record_qa(c4, '[{"key":"dimensions","passed":true},{"key":"text_fit","passed":false}]');

  perform t.as_user('00000000-0000-0000-0000-00000000000b');     -- marketing, not a configured reviewer
  perform t.expect_error(format($q$ select public.creative_review_candidate(%s, 'approved', '{}', null, 3) $q$, c0), 'creative_not_reviewer');
  perform t.as_owner();
  select version into v from creative.candidates where id = c0;
  perform t.as_user('00000000-0000-0000-0000-00000000000f');
  perform public.creative_review_candidate(c0, 'approved', '{}', 'faithful packshot', v);
  perform t.expect_error(format($q$ select public.creative_review_candidate(%s, 'approved', '{}', null, %s) $q$, c0, v), 'creative_version_conflict');

  perform t.as_owner();
  select version into v from creative.batches where id = 1;
  perform t.as_user('00000000-0000-0000-0000-00000000000b');
  perform t.expect_error(format($q$ select public.creative_advance_stage(1, %s) $q$, v), 'creative_stage_unreviewed: 1');
  perform t.as_owner();
  select version into w from creative.candidates where id = c3;
  perform t.as_user('00000000-0000-0000-0000-00000000000f');
  perform public.creative_review_candidate(c3, 'rejected', '{off_brand_colour}', null, w);
  perform t.as_user('00000000-0000-0000-0000-00000000000b');
  r := public.creative_advance_stage(1, v);
  if (r ->> 'stage_limit')::int != 20 then raise exception 'stage should advance to 20: %', r; end if;

  -- export only approved; launch only exported, with a receipt
  perform t.expect_error(format($q$ select public.creative_export_candidates(1, array[%s, %s]::bigint[]) $q$, c0, c3),
    'creative_export_requires_approval: 1');
  perform t.expect_error(format($q$ select public.creative_bind_launch(%s, 'meta', 'acc1', 'ad-77', 'r') $q$, c0), 'creative_bind_requires_export');
  perform public.creative_export_candidates(1, array[c0]);
  perform t.expect_error(format($q$ select public.creative_bind_launch(%s, 'meta', 'acc1', 'ad-77', '') $q$, c0), 'creative_bind_requires_receipt');
  perform public.creative_bind_launch(c0, 'meta', 'acc1', 'ad-77', 'manual:ads-manager:2026-09-10');
  r := public.creative_bind_launch(c0, 'meta', 'acc1', 'ad-77', 'manual:ads-manager:2026-09-10');
  if (r ->> 'changed')::boolean then raise exception 'rebinding same ad must be a no-op'; end if;
  perform t.expect_error(format($q$ select public.creative_bind_launch(%s, 'meta', 'acc1', 'ad-77', 'x') $q$, c3), 'creative_bind_requires_export');

  perform t.as_service();
  perform public.creative_upsert_ad_facts('[
    {"date":"2026-09-11","account_id":"acc1","ad_id":"ad-77","creative_id":"cr-77","creative_format":"single_image","binding_status":"bound","image_hash":"h77","brand_slug":"adipocyde","market":"MY","currency_code":"MYR","spend":30,"purchases":1,"purchase_value":150,"data_maturity":"settled"},
    {"date":"2026-09-12","account_id":"acc1","ad_id":"ad-77","creative_id":"cr-77","creative_format":"single_image","binding_status":"bound","image_hash":"h77","brand_slug":"adipocyde","market":"MY","currency_code":"MYR","spend":20,"purchases":0,"purchase_value":0,"data_maturity":"maturing"},
    {"date":"2026-09-12","account_id":"acc1","ad_id":"ad-other","creative_format":"carousel","binding_status":"bound","brand_slug":"adipocyde","market":"MY","currency_code":"MYR","spend":999,"purchases":9,"data_maturity":"maturing"}
  ]');
  perform t.as_user('00000000-0000-0000-0000-00000000000d');
  r := public.creative_batch_outcomes(1);
  if jsonb_array_length(r) != 1 or (r -> 0 ->> 'spend')::numeric != 50 or (r -> 0 ->> 'purchases')::int != 1
     or not (r -> 0 ->> 'has_maturing_days')::boolean then
    raise exception 'outcomes must be exactly the bound ad, with maturity: %', r; end if;
  perform t.as_owner();
  raise notice 'ok: QA, reviewer-only approval, stage gate, export/launch gates, exact outcome binding';
end $$;

-- ---------------------------------------------------------------------
-- 8. Learning → reviewed → playbook revision; lineage; audit
-- ---------------------------------------------------------------------
do $$
declare r jsonb; l bigint; p1 jsonb; p2 jsonb; c0 bigint;
begin
  perform t.as_user('00000000-0000-0000-0000-00000000000b');
  r := public.creative_record_learning(1, 1, '2026-09-10', '2026-09-30', 'v1',
    'Ingredient-proof headline held CPA within MY cohort', 'observational', 'Keep proof-led headline; test offer framing');
  l := (r ->> 'learning_record_id')::bigint;
  perform t.as_owner();
  if jsonb_array_length((select evidence from creative.learning_records where id = l)) != 1 then
    raise exception 'learning must capture server-side evidence'; end if;
  perform t.as_user('00000000-0000-0000-0000-00000000000f');
  perform t.expect_error(format($q$ select public.creative_publish_playbook(1, '# v1', array[%s]::bigint[]) $q$, l), 'creative_learning_not_reviewed');
  perform t.as_user('00000000-0000-0000-0000-00000000000b');
  perform t.expect_error(format($q$ select public.creative_review_artifact('learning', %s, 'reviewed') $q$, l), 'creative_not_reviewer');
  perform t.as_user('00000000-0000-0000-0000-00000000000f');
  perform public.creative_review_artifact('learning', l, 'reviewed');
  p1 := public.creative_publish_playbook(1, '# Adipocyde playbook v1', array[l]);
  p2 := public.creative_publish_playbook(1, '# Adipocyde playbook v2', array[l]);
  perform t.as_owner();
  if (p2 ->> 'version')::int != 2
     or (select parent_version_id from creative.playbook_versions where id = (p2 ->> 'playbook_version_id')::bigint) != (p1 ->> 'playbook_version_id')::bigint
     or (select status from creative.playbook_versions where id = (p1 ->> 'playbook_version_id')::bigint) != 'superseded' then
    raise exception 'playbook revision chain wrong'; end if;

  select id into c0 from creative.candidates where batch_id = 1 and slot_index = 0;
  perform t.as_user('00000000-0000-0000-0000-00000000000d');
  r := public.creative_candidate_lineage(c0);
  if r -> 'context_manifest' is null or r -> 'kit_version' is null or r -> 'job' is null
     or jsonb_array_length(r -> 'qa') != 2 or jsonb_array_length(r -> 'reviews') != 1
     or jsonb_array_length(r -> 'exports') != 1 or jsonb_array_length(r -> 'launch_bindings') != 1 then
    raise exception 'lineage incomplete: %', r; end if;
  perform t.as_user('00000000-0000-0000-0000-00000000000c');
  perform t.expect_error(format($q$ select public.creative_candidate_lineage(%s) $q$, c0), 'creative_forbidden');
  perform t.as_owner();

  if (select count(distinct action) from public.audit_events where action like 'creative.%') < 10 then
    raise exception 'expected audit coverage, got %', (select array_agg(distinct action) from public.audit_events); end if;
  raise notice 'ok: reviewed learning, playbook revision, lineage chain, audit';
end $$;

select 'creative_lab: all contract tests passed' as result;
