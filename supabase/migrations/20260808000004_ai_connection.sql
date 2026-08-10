-- AI address assist (ADR-0006): OpenRouter connection registry row + Vault
-- credential RPCs + the ai_suggestions store. Strictly suggest-only: the
-- address-suggest edge function writes proposals here; a human accepts one
-- in the fix-shipping dialog and the write rides save_order_correction
-- (allowlist, original snapshot, audit — all inherited, never duplicated).

alter table public.integration_connections
  drop constraint integration_connections_category_check;
alter table public.integration_connections
  add constraint integration_connections_category_check
  check (category in ('commerce', 'ads', 'marketplace', 'payments', 'logistics',
                      'cdp', 'analytics', 'accounting', 'messaging', 'ai'));

insert into public.integration_connections
  (workspace_id, provider, name, category, environment, direction,
   read_scopes, write_scopes, secret_ref, status, freshness_sla_minutes, config, notes)
select w.id, 'OpenRouter', 'OpenRouter — address AI', 'ai', 'production', 'read',
       array['chat completions (address suggestions)'], '{}', 'OPENROUTER', 'pending_setup', 1440,
       jsonb_build_object('model', 'openai/gpt-4o-mini', 'batch_cap', 20, 'daily_cap', 400, 'ai_scope', 'pilot'),
       'Suggest-only shipping-address corrections for flagged orders. Paste the API key in Setup → Connections (stored in Vault). ai_scope=pilot limits candidates to fulfilment-enabled stores; set to ''all'' to widen.'
from (select min(id) as id from public.workspaces) w
where not exists (select 1 from public.integration_connections where provider = 'OpenRouter');

-- ---------- Vault RPCs (same pattern as Ninja Van / WhatsApp) ----------

create or replace function public.set_ai_connection(p_api_key text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws bigint;
begin
  select workspace_id into v_ws
  from public.integration_connections
  where provider = 'OpenRouter'
  limit 1;
  if v_ws is null or not private.has_role(v_ws, array['hq_admin']) then
    raise exception 'Only HQ admins can configure the OpenRouter connection';
  end if;
  if length(p_api_key) < 20 then
    raise exception 'API key looks too short — paste the full value';
  end if;

  delete from vault.secrets where name = 'OPENROUTER_API_KEY';
  perform vault.create_secret(p_api_key, 'OPENROUTER_API_KEY', 'OpenRouter API key (address suggestions)');

  update public.integration_connections
  set status = 'pending_setup',
      notes = 'API key stored. Suggestions start on the next address-suggest run.'
  where provider = 'OpenRouter';

  insert into public.audit_events (workspace_id, actor_label, action, entity_ref, detail)
  values (
    v_ws,
    coalesce((select display_name from public.profiles where id = (select auth.uid())), 'unknown'),
    'integration.configured', 'integration:openrouter',
    'OpenRouter API key stored in Vault'
  );
end;
$$;

revoke execute on function public.set_ai_connection(text) from public, anon;
grant execute on function public.set_ai_connection(text) to authenticated;

create or replace function public.get_ai_secrets()
returns table (api_key text)
language sql
security definer
set search_path = ''
as $$
  select (select decrypted_secret from vault.decrypted_secrets where name = 'OPENROUTER_API_KEY');
$$;

revoke execute on function public.get_ai_secrets() from public, anon, authenticated;
grant execute on function public.get_ai_secrets() to service_role;

-- ---------- suggestion store ----------

create table public.ai_suggestions (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  order_read_id bigint not null references public.orders_read (id) on delete cascade,
  input_hash text not null,          -- hash of the graded fields; a new suggestion only when the data changed
  payload jsonb not null,            -- {fields: {name?,phone?,address_1?,postcode?,city?,state?}, confidence, rationale}
  model text not null,
  status text not null default 'pending'
    check (status in ('pending', 'shown', 'accepted', 'rejected', 'superseded', 'failed')),
  prompt_tokens int,
  completion_tokens int,
  cost_usd numeric(10, 6),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  unique (order_read_id, input_hash)
);

create index ai_suggestions_order_idx on public.ai_suggestions (order_read_id, status);

alter table public.ai_suggestions enable row level security;
create policy member_read on public.ai_suggestions for select to authenticated
  using (private.is_workspace_member(workspace_id));

-- Accepting = recording a correction (through the one write path) and
-- closing the suggestion, atomically. p_corrected is what the admin
-- actually saved — possibly edited from the AI's proposal.
create or replace function public.accept_ai_suggestion(
  p_suggestion_id bigint,
  p_corrected jsonb,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s record;
  v_actor text;
begin
  select s.id, s.order_read_id, s.workspace_id, s.status
  into v_s
  from public.ai_suggestions s where s.id = p_suggestion_id;
  if v_s is null then
    raise exception 'Unknown suggestion';
  end if;
  if not private.has_role(v_s.workspace_id, array['hq_admin', 'operations']) then
    raise exception 'Only HQ admins or operations can accept suggestions';
  end if;
  if v_s.status in ('accepted', 'rejected', 'superseded') then
    raise exception 'Suggestion is already resolved (%)', v_s.status;
  end if;

  perform public.save_order_correction(v_s.order_read_id, p_corrected,
    coalesce(p_note, 'AI suggestion accepted'));

  v_actor := coalesce((select display_name from public.profiles where id = (select auth.uid())), 'unknown');

  update public.ai_suggestions
  set status = 'accepted', resolved_at = now(), resolved_by = v_actor
  where id = p_suggestion_id;

  insert into public.audit_events (workspace_id, actor_label, action, entity_ref, detail)
  values (v_s.workspace_id, v_actor, 'order.ai_suggestion_accepted',
          'order_read:' || v_s.order_read_id,
          'AI address suggestion accepted and recorded as correction: ' || (p_corrected::text));
end;
$$;

revoke execute on function public.accept_ai_suggestion(bigint, jsonb, text) from public, anon;
grant execute on function public.accept_ai_suggestion(bigint, jsonb, text) to authenticated;

create or replace function public.reject_ai_suggestion(
  p_suggestion_id bigint,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s record;
  v_actor text;
begin
  select s.id, s.order_read_id, s.workspace_id, s.status
  into v_s
  from public.ai_suggestions s where s.id = p_suggestion_id;
  if v_s is null then
    raise exception 'Unknown suggestion';
  end if;
  if not private.has_role(v_s.workspace_id, array['hq_admin', 'operations']) then
    raise exception 'Only HQ admins or operations can reject suggestions';
  end if;
  if v_s.status in ('accepted', 'rejected', 'superseded') then
    raise exception 'Suggestion is already resolved (%)', v_s.status;
  end if;

  v_actor := coalesce((select display_name from public.profiles where id = (select auth.uid())), 'unknown');

  update public.ai_suggestions
  set status = 'rejected', resolved_at = now(), resolved_by = v_actor
  where id = p_suggestion_id;

  insert into public.audit_events (workspace_id, actor_label, action, entity_ref, detail)
  values (v_s.workspace_id, v_actor, 'order.ai_suggestion_rejected',
          'order_read:' || v_s.order_read_id,
          'AI address suggestion dismissed' || coalesce(': ' || p_reason, ''));
end;
$$;

revoke execute on function public.reject_ai_suggestion(bigint, text) from public, anon;
grant execute on function public.reject_ai_suggestion(bigint, text) to authenticated;
