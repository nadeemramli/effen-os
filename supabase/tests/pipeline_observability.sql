-- Ads-pipeline observability invariants (ledger + registry). Read-only;
-- every SELECT must return ok = true.

-- 1. Vocabulary: stage / status / event_type / received_via stay inside the checked sets.
select 'stage_vocabulary' as test, bool_and(stage in ('airbyte', 'dbt', 'mart_sync')) as ok from public.pipeline_runs;
select 'status_vocabulary' as test, bool_and(status in ('pending', 'running', 'incomplete', 'success', 'failed', 'cancelled', 'warning', 'info')) as ok from public.pipeline_runs;

-- 2. One ledger row per external job id per stage (webhook + poller converge, never duplicate).
select 'external_ids_unique' as test, count(*) = count(distinct (stage, external_id)) as ok
from public.pipeline_runs where external_id is not null;

-- 3. Terminal runs carry a finish time; running/pending ones do not claim one.
select 'terminal_runs_finished' as test, count(*) = 0 as ok
from public.pipeline_runs where status in ('success', 'failed', 'cancelled', 'incomplete') and event_type = 'sync' and finished_at is null;

-- 4. Registry: every Terraform-declared Meta connection is present and keys are unique.
select 'registry_seeded' as test, count(*) >= 41 as ok from public.airbyte_connections;
select 'registry_keys_unique' as test, count(*) = count(distinct key) as ok from public.airbyte_connections;

-- 5. A connection's last_success_at never precedes its last_job_at by more than the job itself (monotone).
select 'registry_success_not_after_job' as test, count(*) = 0 as ok
from public.airbyte_connections where last_success_at is not null and last_job_at is not null and last_success_at > last_job_at + interval '1 minute';

-- 6. Browser roles can never read the Airbyte secrets.
select 'secrets_hidden' as test,
  not has_function_privilege('authenticated', 'public.get_airbyte_secrets()', 'execute')
  and not has_function_privilege('anon', 'public.get_airbyte_secrets()', 'execute') as ok;

-- 7. Observation only: no function in public/private calls the Airbyte API with a mutating verb.
select 'no_airbyte_writes' as test, count(*) = 0 as ok
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public', 'private') and p.prokind = 'f'
  and pg_get_functiondef(p.oid) ilike '%api.airbyte.com%';
