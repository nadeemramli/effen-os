-- Ninja Van read-side (Slice 2). Ninja Van pushes tracking events to the
-- nv-webhook Edge Function; this schema stores the raw event log and a
-- one-row-per-parcel shipment mirror. Outbound order creation stays in
-- Slice 3 (bounded write pilot) — nothing here writes to Ninja Van.

-- Repoint the seeded registry row at the live wiring.
update public.integration_connections
set secret_ref = 'NV',
    read_scopes = array['tracking events (webhook)'],
    config = jsonb_build_object('country_code', 'MY'),
    freshness_sla_minutes = 60,
    notes = 'Configure in Setup: paste the API Client ID + Client Key '
         || '(stored in Vault), then register the nv-webhook callback URL in the '
         || 'Ninja Van Shipper Dashboard for all order status events.'
where provider = 'Ninja Van';

-- One row per parcel; latest known state.
create table public.nv_shipments (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  tracking_id text not null unique,
  order_ref text,             -- shipper_order_ref_no / requested tracking ref; joins loosely to orders_read.order_number
  brand_id bigint references public.brands (id),
  status text,                -- latest granular event/status name as sent by Ninja Van
  is_terminal boolean not null default false, -- Completed / Returned to Sender / Cancelled
  last_event_at timestamptz,
  first_seen_at timestamptz not null default now(),
  raw jsonb not null default '{}'  -- latest event payload
);

-- Append-only event log (webhook deliveries can retry — event_key dedupes).
create table public.nv_events (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  shipment_id bigint not null references public.nv_shipments (id) on delete cascade,
  event_key text not null unique,
  status text,
  previous_status text,
  event_at timestamptz,
  raw jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index nv_events_shipment_idx on public.nv_events (shipment_id, event_at desc);
create index nv_shipments_order_ref_idx on public.nv_shipments (order_ref);
create index nv_shipments_last_event_idx on public.nv_shipments (workspace_id, last_event_at desc);

alter table public.nv_shipments enable row level security;
alter table public.nv_events enable row level security;

create policy member_read on public.nv_shipments for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy member_read on public.nv_events for select to authenticated
  using (private.is_workspace_member(workspace_id));

-- ---------- config RPCs (same Vault pattern as WooCommerce/WhatsApp) ----------

create or replace function public.set_nv_connection(
  p_client_id text,
  p_client_key text
)
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
  where provider = 'Ninja Van'
  limit 1;
  if v_ws is null or not private.has_role(v_ws, array['hq_admin']) then
    raise exception 'Only HQ admins can configure the Ninja Van connection';
  end if;
  if length(p_client_id) < 16 or length(p_client_key) < 16 then
    raise exception 'Client ID and Client Key look too short — paste the full values';
  end if;

  delete from vault.secrets where name in ('NV_CLIENT_ID', 'NV_CLIENT_KEY');
  perform vault.create_secret(p_client_id, 'NV_CLIENT_ID', 'Ninja Van API client id');
  perform vault.create_secret(p_client_key, 'NV_CLIENT_KEY', 'Ninja Van API client key (OAuth secret + webhook HMAC)');

  update public.integration_connections
  set status = 'pending_setup',
      notes = 'Credentials stored. Register the nv-webhook callback URL in the Ninja Van Shipper Dashboard.'
  where provider = 'Ninja Van';

  insert into public.audit_events (workspace_id, actor_label, action, entity_ref, detail)
  values (
    v_ws,
    coalesce((select display_name from public.profiles where id = (select auth.uid())), 'unknown'),
    'integration.configured', 'integration:ninjavan',
    'Ninja Van API credentials stored in Vault'
  );
end;
$$;

revoke execute on function public.set_nv_connection(text, text) from public, anon;
grant execute on function public.set_nv_connection(text, text) to authenticated;

create or replace function public.get_nv_secrets()
returns table (client_id text, client_key text)
language sql
security definer
set search_path = ''
as $$
  select
    (select decrypted_secret from vault.decrypted_secrets where name = 'NV_CLIENT_ID'),
    (select decrypted_secret from vault.decrypted_secrets where name = 'NV_CLIENT_KEY');
$$;

revoke execute on function public.get_nv_secrets() from public, anon, authenticated;
grant execute on function public.get_nv_secrets() to service_role;
