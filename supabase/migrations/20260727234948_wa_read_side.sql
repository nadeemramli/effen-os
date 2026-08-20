-- WhatsApp Cloud API read-side (Slice 2, step 2).
-- Meta pushes events to the wa-webhook Edge Function; this schema stores the
-- consolidated cross-brand inbox. There is NO history backfill in the Cloud
-- API — capture starts when the webhook connects — except coexistence
-- onboarding, whose history payloads land with from_history = true.

-- Allow a messaging category on connections.
alter table public.integration_connections drop constraint integration_connections_category_check;
alter table public.integration_connections add constraint integration_connections_category_check
  check (category in ('commerce', 'ads', 'marketplace', 'payments', 'logistics', 'cdp', 'analytics', 'accounting', 'messaging'));

insert into public.integration_connections
  (workspace_id, provider, name, category, direction, read_scopes, secret_ref, status, freshness_sla_minutes, config, notes)
select w.id, 'WhatsApp', 'WhatsApp Cloud API', 'messaging', 'read',
       array['messages (webhook)', 'statuses (webhook)', 'history (coexistence)'],
       'WA', 'pending_setup', 1440, '{}',
       'Configure in Setup → Store connections: paste the Meta App Secret and System User token; copy the callback URL + verify token into the Meta App dashboard.'
from public.workspaces w
where w.name = 'EFFEN International Sdn Bhd';

-- One row per registered business number; brand mapping mirrors the
-- integration_account_mappings idea but keeps message FKs simple.
create table public.wa_numbers (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  phone_number_id text not null unique, -- Meta's numeric id, not the raw number
  display_number text,
  brand_id bigint references public.brands (id),
  status text not null default 'active' check (status in ('active', 'archived')),
  first_seen_at timestamptz not null default now()
);

create table public.wa_conversations (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  number_id bigint not null references public.wa_numbers (id) on delete cascade,
  wa_contact text not null, -- customer's phone in E.164 (joins to orders_read.customer->>'phone')
  contact_name text,
  last_message_at timestamptz,
  last_direction text check (last_direction in ('in', 'out')),
  unread_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (number_id, wa_contact)
);

create table public.wa_messages (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  conversation_id bigint not null references public.wa_conversations (id) on delete cascade,
  wa_message_id text not null unique,
  direction text not null check (direction in ('in', 'out')),
  message_type text not null default 'text',
  body text,
  status text not null default 'received'
    check (status in ('received', 'sent', 'delivered', 'read', 'failed')),
  sent_at timestamptz,
  from_history boolean not null default false,
  raw jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index wa_messages_conversation_idx on public.wa_messages (conversation_id, sent_at desc);
create index wa_conversations_last_idx on public.wa_conversations (workspace_id, last_message_at desc);

alter table public.wa_numbers enable row level security;
alter table public.wa_conversations enable row level security;
alter table public.wa_messages enable row level security;

create policy member_read on public.wa_numbers for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy member_read on public.wa_conversations for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy member_read on public.wa_messages for select to authenticated
  using (private.is_workspace_member(workspace_id));

-- ---------- config RPCs (same Vault pattern as WooCommerce) ----------

-- HQ admin pastes App Secret + System User token; the verify token is
-- generated server-side and returned so the UI can display it for the Meta
-- dashboard. Secrets are write-only from the browser.
create or replace function public.set_wa_connection(
  p_app_secret text,
  p_access_token text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws bigint;
  v_verify text;
begin
  select workspace_id into v_ws
  from public.integration_connections
  where provider = 'WhatsApp'
  limit 1;
  if v_ws is null or not private.has_role(v_ws, array['hq_admin']) then
    raise exception 'Only HQ admins can configure the WhatsApp connection';
  end if;
  if length(p_app_secret) < 16 or length(p_access_token) < 16 then
    raise exception 'App Secret and access token look too short — paste the full values';
  end if;

  select decrypted_secret into v_verify from vault.decrypted_secrets where name = 'WA_VERIFY_TOKEN';
  if v_verify is null then
    v_verify := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
    perform vault.create_secret(v_verify, 'WA_VERIFY_TOKEN', 'Webhook verify token for the Meta app dashboard');
  end if;

  delete from vault.secrets where name in ('WA_APP_SECRET', 'WA_ACCESS_TOKEN');
  perform vault.create_secret(p_app_secret, 'WA_APP_SECRET', 'Meta app secret (webhook signature verification)');
  perform vault.create_secret(p_access_token, 'WA_ACCESS_TOKEN', 'System user token (Graph API reads)');

  update public.integration_connections
  set status = 'pending_setup',
      notes = 'Secrets stored. Paste the callback URL + verify token into the Meta App dashboard (WhatsApp → Configuration) and subscribe to messages/statuses/history.'
  where provider = 'WhatsApp';

  insert into public.audit_events (workspace_id, actor_label, action, entity_ref, detail)
  values (
    v_ws,
    coalesce((select display_name from public.profiles where id = (select auth.uid())), 'unknown'),
    'integration.configured', 'integration:whatsapp',
    'WhatsApp Cloud API secrets stored in Vault via setup UI'
  );

  return v_verify;
end;
$$;

revoke execute on function public.set_wa_connection(text, text) from public, anon;
grant execute on function public.set_wa_connection(text, text) to authenticated;

create or replace function public.get_wa_secrets()
returns table (verify_token text, app_secret text, access_token text)
language sql
security definer
set search_path = ''
as $$
  select
    (select decrypted_secret from vault.decrypted_secrets where name = 'WA_VERIFY_TOKEN'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'WA_APP_SECRET'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'WA_ACCESS_TOKEN');
$$;

revoke execute on function public.get_wa_secrets() from public, anon, authenticated;
grant execute on function public.get_wa_secrets() to service_role;

-- HQ admin maps a number to a brand once its first webhook arrives.
create or replace function public.map_wa_number(p_number_id bigint, p_brand_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ws bigint;
begin
  select workspace_id into v_ws from public.wa_numbers where id = p_number_id;
  if v_ws is null or not private.has_role(v_ws, array['hq_admin']) then
    raise exception 'Only HQ admins can map WhatsApp numbers';
  end if;
  update public.wa_numbers set brand_id = p_brand_id where id = p_number_id;
end;
$$;

revoke execute on function public.map_wa_number(bigint, bigint) from public, anon;
grant execute on function public.map_wa_number(bigint, bigint) to authenticated;
