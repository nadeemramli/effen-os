-- Creative lab v1 (ADR-0010): owner-config read RPC for the readiness panel.
-- Exactly the SQL recorded under this version; mirrored in
-- supabase/reference/creative_lab_v1.sql.

create or replace function public.creative_runtime_config(p_brand_id bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.creative_can_read(p_brand_id) then raise exception 'creative_forbidden'; end if;
  return coalesce(
    (select to_jsonb(c) - 'workspace_id' from creative.brand_runtime_config c where c.brand_id = p_brand_id),
    jsonb_build_object('brand_id', p_brand_id, 'version', 0, 'reviewer_membership_ids', '[]'::jsonb,
                       'provider_pricing', '{}'::jsonb, 'provider_data_approved', false))
    || jsonb_build_object('missing_config', to_jsonb(private.creative_missing_config(p_brand_id)));
end $$;
revoke all on function public.creative_runtime_config(bigint) from public, anon, authenticated;
grant execute on function public.creative_runtime_config(bigint) to authenticated, service_role;
