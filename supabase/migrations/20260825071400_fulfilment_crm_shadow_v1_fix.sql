-- Applied 2026-08-25 via MCP apply_migration; filed under the recorded version 20260825071400.
-- fulfilment_crm_shadow_v1_fix — corrects private.dispatch_eligibility.
-- `text[] || 'literal'` is parsed by PostgreSQL as array || array (the literal
-- becomes a malformed array), so every create_dispatch_request call failed.
-- Reasons are now appended with array_append. No other change.

create or replace function private.dispatch_eligibility(p_identity_key text, p_channel text, p_template_key text, p_template_version integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_reasons text[] := '{}';
  v_template public.dispatch_templates;
  v_strive record;
  v_recent integer;
  v_has_phone boolean;
begin
  select * into v_template from public.dispatch_templates where key = p_template_key and version = p_template_version;
  select config into v_strive from public.integration_connections where provider = 'Strive' limit 1;
  select count(*) into v_recent from public.dispatch_requests d
  where d.identity_key = p_identity_key and d.status in ('shadow_logged', 'queued', 'sent') and d.created_at > now() - interval '24 hours';
  select (c.phone is not null) into v_has_phone from private.customers_read c where c.identity_key = p_identity_key;

  -- No consent / suppression source exists in the platform yet: every contact is blocked on consent.
  v_reasons := array_append(v_reasons, 'no_consent_source');
  if p_channel = 'whatsapp' and coalesce(v_has_phone, false) = false then v_reasons := array_append(v_reasons, 'no_phone'); end if;
  if p_channel = 'email' then v_reasons := array_append(v_reasons, 'email_adapter_unverified'); end if;
  if p_template_key is not null and (v_template.key is null or v_template.status <> 'verified') then v_reasons := array_append(v_reasons, 'template_unverified'); end if;
  if p_channel in ('whatsapp') and (v_strive.config is null or coalesce((v_strive.config->>'endpoint_verified')::boolean, false) = false) then v_reasons := array_append(v_reasons, 'transport_unverified'); end if;
  if v_recent >= 1 then v_reasons := array_append(v_reasons, 'frequency_cap_24h'); end if;

  return jsonb_build_object(
    'consent', 'unknown', 'suppression', 'unknown', 'frequency_24h', v_recent,
    'template_status', coalesce(v_template.status, 'missing'),
    'transport', jsonb_build_object('provider', 'strive', 'mode', coalesce(v_strive.config->>'mode', 'shadow'), 'endpoint_verified', coalesce((v_strive.config->>'endpoint_verified')::boolean, false)),
    'reasons', to_jsonb(v_reasons),
    'decision', case when cardinality(v_reasons) = 0 then 'eligible' else 'blocked' end);
end;
$$;
revoke all on function private.dispatch_eligibility(text, text, text, integer) from public, anon, authenticated;
