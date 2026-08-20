-- Schedule address-suggest one tick after each woo-sync run (:05/:20/:35/:50
-- vs woo-sync at :00/:15/:30/:45), so freshly synced flagged orders get
-- their AI proposal within minutes. Quiet until the OpenRouter key is
-- pasted in Setup → Connections. The bearer is the publishable anon key —
-- public by design; the function's writes run under its own service-role env.

select cron.schedule(
  'address-suggest-every-15m',
  '5,20,35,50 * * * *',
  $$
  select net.http_post(
    url := 'https://wwgtjjekhehaepbxyrij.supabase.co/functions/v1/address-suggest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer sb_publishable_Wdp9R_p1SiVdgrKIQ8fLVA_aNekE-k6'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
