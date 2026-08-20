-- live_automation_health() v2: adds the 'growth' key (ADR-0003 pipeline —
-- Airbyte ingestion, dbt transforms, mart sync) and excludes mart-sync's
-- sync_runs rows (integration_id 3) from the WooCommerce counters they
-- were polluting.

create or replace function public.live_automation_health()
returns jsonb
language plpgsql stable security definer set search_path to ''
as $function$
declare
  v_ws bigint;
  v_ship record;
begin
  select min(id) into v_ws from public.workspaces;
  if not private.is_workspace_member(v_ws) then
    raise exception 'Not a workspace member';
  end if;

  select total_checked, total_flagged, total_corrected
  into v_ship
  from public.live_ship_readiness(14)
  limit 1;

  return jsonb_build_object(
    'woo_orders', (
      select jsonb_build_object(
        'last_success_at', max(finished_at) filter (where status = 'success'),
        'runs_24h', count(*) filter (where started_at > now() - interval '24 hours'),
        'failed_24h', count(*) filter (where started_at > now() - interval '24 hours' and status = 'failed')
      )
      from public.sync_runs
      where coalesce(message, '') not like 'Products:%'
        and integration_id <> 3 -- mart-sync logs there; counted under 'growth'
    ),
    'woo_products', (
      select jsonb_build_object(
        'last_success_at', (select max(finished_at) from public.sync_runs where status = 'success' and message like 'Products:%'),
        'mirrored', count(*)
      )
      from public.woo_products_read
    ),
    'customers_mv', (
      select jsonb_build_object('last_refresh_at', max(d.end_time))
      from cron.job_run_details d
      join cron.job j on j.jobid = d.jobid
      where j.jobname = 'customers-read-refresh' and d.status = 'succeeded'
    ),
    'nv', (
      select jsonb_build_object(
        'last_event_at', max(event_at),
        'events_24h', count(*) filter (where created_at > now() - interval '24 hours'),
        'parcels', (select count(*) from public.nv_shipments)
      )
      from public.nv_events
    ),
    'ship_gate', jsonb_build_object(
      'checked_14d', coalesce(v_ship.total_checked, 0),
      'flagged_14d', coalesce(v_ship.total_flagged, 0),
      'corrected_14d', coalesce(v_ship.total_corrected, 0)
    ),
    'corrections', (
      select jsonb_build_object('staged', count(*) filter (where status = 'staged'), 'total', count(*))
      from public.order_corrections
    ),
    'mapping', (
      select jsonb_build_object(
        'aliases', (select count(*) from public.variant_aliases),
        'unmapped_published', count(*)
      )
      from (
        select distinct wp.integration_id, wp.sku
        from public.woo_products_read wp
        where nullif(wp.sku, '') is not null and wp.status = 'publish'
          and not exists (
            select 1 from public.variant_aliases va
            where va.integration_id = wp.integration_id and va.alias = wp.sku
          )
      ) u
    ),
    'drift', (
      select jsonb_build_object('variants', count(distinct v.id))
      from public.product_variants v
      join public.variant_aliases va on va.variant_id = v.id
      join public.woo_products_read wp on wp.integration_id = va.integration_id and wp.sku = va.alias
      where wp.price is not null and v.price is not null and wp.price <> v.price
    ),
    'costs', (
      select jsonb_build_object(
        'costed_variants', count(distinct variant_id),
        'total_variants', (select count(*) from public.product_variants)
      )
      from public.variant_costs
    ),
    -- ADR-0003 growth pipeline: warehouse-fed marketing facts.
    'growth', (
      select jsonb_build_object(
        'mart_last_sync_at', (select max(mart_synced_at) from public.ad_daily_facts),
        'mart_rows', (select count(*) from public.ad_daily_facts where source <> 'legacy_seed'),
        'brands', (select count(distinct brand_slug) from public.ad_daily_facts where brand_slug is not null),
        'accounts', (select count(distinct account_id) from public.ad_daily_facts where account_id is not null),
        'unattributed_rows', (select count(*) from public.ad_daily_facts where brand_slug is null),
        'spend_30d', (select coalesce(sum(spend), 0) from public.ad_daily_facts where date > current_date - 30),
        'runs_24h', (select count(*) from public.sync_runs where integration_id = 3 and started_at > now() - interval '24 hours'),
        'failed_24h', (select count(*) from public.sync_runs where integration_id = 3 and started_at > now() - interval '24 hours' and status = 'failed'),
        'last_success_at', (select last_success_at from public.integration_connections where id = 3)
      )
    )
  );
end;
$function$;

revoke all on function public.live_automation_health() from public, anon;
grant execute on function public.live_automation_health() to authenticated, service_role;
