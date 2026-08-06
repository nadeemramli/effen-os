-- live_growth_campaigns(days, limit) — campaign-grain aggregates from the
-- warehouse-fed ad_daily_facts for the Marketing campaign explorer.
-- Warehouse attribution (brand_slug, market) — not the account register.
-- Top-N by spend with the total count returned so truncation is visible,
-- never silent.

create or replace function public.live_growth_campaigns(p_days int default 30, p_limit int default 60)
returns jsonb
language plpgsql stable security definer set search_path to ''
as $function$
declare
  v_ws bigint;
begin
  select min(id) into v_ws from public.workspaces;
  if not private.is_workspace_member(v_ws) then
    raise exception 'Not a workspace member';
  end if;

  return jsonb_build_object(
    'as_of', (select max(mart_synced_at) from public.ad_daily_facts),
    'window_days', p_days,
    'total_campaigns', (
      select count(distinct campaign_id)
      from public.ad_daily_facts
      where date > current_date - p_days and source <> 'legacy_seed'
    ),
    'rows', (
      select coalesce(jsonb_agg(r order by r.spend desc), '[]'::jsonb)
      from (
        select
          campaign_id,
          max(campaign_name) as campaign_name,
          brand_slug,
          market,
          platform,
          count(distinct account_id) as accounts,
          sum(spend) as spend,
          sum(purchases) as purchases,
          sum(purchase_value) as purchase_value,
          max(date) as last_active,
          bool_or(is_banned_account) as is_banned_account
        from public.ad_daily_facts
        where date > current_date - p_days and source <> 'legacy_seed'
        group by campaign_id, brand_slug, market, platform
        order by sum(spend) desc
        limit p_limit
      ) r
    )
  );
end;
$function$;

revoke all on function public.live_growth_campaigns(int, int) from public, anon;
grant execute on function public.live_growth_campaigns(int, int) to authenticated, service_role;
