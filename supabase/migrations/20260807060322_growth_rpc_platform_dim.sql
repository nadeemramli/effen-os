-- Growth RPCs v3: platform becomes a first-class dimension (rows, trend,
-- accounts) so the UI can filter Meta / TikTok / Google / marketplaces
-- independently of brand and market; campaigns gain the owning account's
-- register name. Ready for the TikTok/Google/Shopee/Lazada sources —
-- they land as new platform values with zero further schema work.

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
        'campaigns', count(distinct campaign_id),
        'non_myr_rows', count(*) filter (where currency_code is not null and currency_code <> 'MYR')
      )
      from public.ad_daily_facts
      where date > current_date - p_days and source <> 'legacy_seed'
    ),
    'platforms', (
      select coalesce(jsonb_agg(distinct platform), '[]'::jsonb)
      from public.ad_daily_facts
      where source <> 'legacy_seed'
    ),
    'rows', (
      select coalesce(jsonb_agg(r order by r.spend desc), '[]'::jsonb)
      from (
        select
          brand_slug,
          market,
          platform,
          sum(spend) as spend,
          sum(purchases) as purchases,
          sum(purchase_value) as purchase_value,
          count(distinct account_id) as accounts,
          sum(spend) filter (where is_banned_account) as banned_spend
        from public.ad_daily_facts
        where date > current_date - p_days and source <> 'legacy_seed'
        group by brand_slug, market, platform
      ) r
    ),
    'trend', (
      select coalesce(jsonb_agg(t order by t.date), '[]'::jsonb)
      from (
        select
          date,
          brand_slug,
          market,
          platform,
          sum(spend) as spend,
          sum(purchases) as purchases,
          sum(purchase_value) as purchase_value
        from public.ad_daily_facts
        where date > current_date - p_days and source <> 'legacy_seed'
        group by date, brand_slug, market, platform
      ) t
    ),
    'accounts', (
      select coalesce(jsonb_agg(a order by a.spend desc), '[]'::jsonb)
      from (
        select
          f.account_id,
          max(f.platform) as platform,
          max(ar.name) as name,
          max(ar.account_status) as account_status,
          (max(ar.id) is not null) as registered,
          coalesce(to_jsonb(array_agg(distinct f.brand_slug) filter (where f.brand_slug is not null)), '[]'::jsonb) as brands,
          coalesce(to_jsonb(array_agg(distinct f.market) filter (where f.market is not null)), '[]'::jsonb) as markets,
          sum(f.spend) as spend,
          sum(f.purchases) as purchases,
          max(f.date) as last_active,
          bool_or(f.is_banned_account) as is_banned
        from public.ad_daily_facts f
        left join public.ad_accounts_read ar on ar.account_id = f.account_id
        where f.date > current_date - p_days and f.source <> 'legacy_seed'
        group by f.account_id
      ) a
    )
  );
end;
$function$;

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
          f.campaign_id,
          max(f.campaign_name) as campaign_name,
          f.brand_slug,
          f.market,
          f.platform,
          count(distinct f.account_id) as accounts,
          max(ar.name) as account_name,
          sum(f.spend) as spend,
          sum(f.purchases) as purchases,
          sum(f.purchase_value) as purchase_value,
          max(f.date) as last_active,
          bool_or(f.is_banned_account) as is_banned_account
        from public.ad_daily_facts f
        left join public.ad_accounts_read ar on ar.account_id = f.account_id
        where f.date > current_date - p_days and f.source <> 'legacy_seed'
        group by f.campaign_id, f.brand_slug, f.market, f.platform
        order by sum(f.spend) desc
        limit p_limit
      ) r
    )
  );
end;
$function$;

revoke all on function public.live_growth_ads(int) from public, anon;
grant execute on function public.live_growth_ads(int) to authenticated, service_role;
revoke all on function public.live_growth_campaigns(int, int) from public, anon;
grant execute on function public.live_growth_campaigns(int, int) to authenticated, service_role;
