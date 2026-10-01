-- Creative lab v1 (ADR-0010), part 6 of 7 — exactly the SQL recorded under
-- this version. Applied in parts because one 93 KB statement exceeds the MCP
-- call budget; every RPC part re-runs the grant lockdown. Annotated source and
-- local contract tests: supabase/reference/creative_lab_v1.sql,
-- supabase/tests/creative_lab.sql (scripts/creative/test-sql.sh).

create or replace function public.creative_claim_jobs(p_worker text, p_limit int, p_lease_seconds int default 300)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_job record; v_batch creative.batches; v_out jsonb := '[]'::jsonb;
begin
  if not private.creative_is_service() then raise exception 'creative_forbidden'; end if;
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
