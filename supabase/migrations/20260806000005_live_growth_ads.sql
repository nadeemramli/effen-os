-- live_growth_ads(days) — server-side aggregate over the warehouse-fed
-- ad_daily_facts for the Marketing/Growth surfaces. Brand × market grain
-- using the warehouse attribution columns (brand_slug from the dbt
-- waterfall, market from Meta targeting geo), NOT the account register —
-- so unregistered accounts and unattributed spend are visible, never
-- silently dropped. Excludes legacy_seed rows (none should remain).

create or replace function public.live_growth_ads(p_days int default 30)
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
    'total', (
      select jsonb_build_object(
        'spend', coalesce(sum(spend), 0),
        'purchases', coalesce(sum(purchases), 0),
        'purchase_value', coalesce(sum(purchase_value), 0),
        'accounts', count(distinct account_id),
        'campaigns', count(distinct campaign_id)
      )
      from public.ad_daily_facts
      where date > current_date - p_days and source <> 'legacy_seed'
    ),
    'rows', (
      select coalesce(jsonb_agg(r order by r.spend desc), '[]'::jsonb)
      from (
        select
          brand_slug,
          market,
          sum(spend) as spend,
          sum(purchases) as purchases,
          sum(purchase_value) as purchase_value,
          count(distinct account_id) as accounts,
          sum(spend) filter (where is_banned_account) as banned_spend
        from public.ad_daily_facts
        where date > current_date - p_days and source <> 'legacy_seed'
        group by brand_slug, market
      ) r
    )
  );
end;
$function$;

revoke all on function public.live_growth_ads(int) from public, anon;
grant execute on function public.live_growth_ads(int) to authenticated, service_role;
