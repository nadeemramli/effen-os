-- UI-driven Woo connection setup.
-- Keys pasted in the Fullkit setup UI go through set_woo_connection (HQ-admin
-- only) into Supabase Vault (encrypted at rest). They are readable ONLY via
-- get_woo_secrets, which is executable by service_role alone — i.e. the
-- woo-sync Edge Function. The browser can write a key but can never read one.

create or replace function public.set_woo_connection(
  p_connection_id bigint,
  p_base_url text,
  p_consumer_key text,
  p_consumer_secret text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conn record;
begin
  select id, workspace_id, secret_ref, provider
  into v_conn
  from public.integration_connections
  where id = p_connection_id;

  if v_conn is null or v_conn.provider <> 'WooCommerce' then
    raise exception 'Unknown WooCommerce connection';
  end if;
  if not private.has_role(v_conn.workspace_id, array['hq_admin']) then
    raise exception 'Only HQ admins can configure connections';
  end if;
  if p_base_url !~* '^https://' then
    raise exception 'Store URL must be https://';
  end if;
  if p_consumer_key !~ '^ck_' or p_consumer_secret !~ '^cs_' then
    raise exception 'Expected a WooCommerce key pair (ck_… / cs_…)';
  end if;

  delete from vault.secrets where name in (v_conn.secret_ref || '_KEY', v_conn.secret_ref || '_SECRET');
  perform vault.create_secret(p_consumer_key, v_conn.secret_ref || '_KEY', 'Woo read-only consumer key');
  perform vault.create_secret(p_consumer_secret, v_conn.secret_ref || '_SECRET', 'Woo read-only consumer secret');

  update public.integration_connections
  set config = jsonb_set(config, '{base_url}', to_jsonb(rtrim(p_base_url, '/'))),
      status = 'pending_setup',
      notes = 'Configured from the Fullkit setup UI. First sync backfills from the beginning.'
  where id = p_connection_id;

  insert into public.audit_events (workspace_id, actor_label, action, entity_ref, detail)
  values (
    v_conn.workspace_id,
    coalesce((select display_name from public.profiles where id = (select auth.uid())), 'unknown'),
    'integration.configured',
    'integration:' || p_connection_id,
    'WooCommerce store connected via setup UI (key stored in Vault)'
  );
end;
$$;

revoke execute on function public.set_woo_connection(bigint, text, text, text) from public, anon;
grant execute on function public.set_woo_connection(bigint, text, text, text) to authenticated;

create or replace function public.get_woo_secrets(p_connection_id bigint)
returns table (consumer_key text, consumer_secret text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref text;
begin
  select secret_ref into v_ref
  from public.integration_connections
  where id = p_connection_id and provider = 'WooCommerce';
  if v_ref is null then
    return;
  end if;
  return query
  select
    (select decrypted_secret from vault.decrypted_secrets where name = v_ref || '_KEY'),
    (select decrypted_secret from vault.decrypted_secrets where name = v_ref || '_SECRET');
end;
$$;

-- Service role only — the browser must never be able to read a key back.
revoke execute on function public.get_woo_secrets(bigint) from public, anon, authenticated;
grant execute on function public.get_woo_secrets(bigint) to service_role;
