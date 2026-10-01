-- Creative lab v1 (ADR-0010), part 7 of 7 — exactly the SQL recorded under
-- this version. Applied in parts because one 93 KB statement exceeds the MCP
-- call budget; every RPC part re-runs the grant lockdown. Annotated source and
-- local contract tests: supabase/reference/creative_lab_v1.sql,
-- supabase/tests/creative_lab.sql (scripts/creative/test-sql.sh).

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
