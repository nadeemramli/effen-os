-- Schedule woo-sync every 15 minutes (matches the 15-minute freshness SLA on
-- the Woo connections). Unconfigured connections skip silently, so this is
-- quiet until a brand's base_url + secrets are in place.
-- The bearer token is the publishable anon key — public by design; the
-- function's writes run under its own service-role env, never this key.

create extension if not exists pg_cron;
create extension if not exists pg_net schema extensions;

select cron.schedule(
  'woo-sync-every-15m',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://wwgtjjekhehaepbxyrij.supabase.co/functions/v1/woo-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer sb_publishable_Wdp9R_p1SiVdgrKIQ8fLVA_aNekE-k6'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
