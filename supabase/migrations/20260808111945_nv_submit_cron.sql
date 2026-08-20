-- Schedule nv-submit at :10/:25/:40/:55 — after the 5-minute gate ticks
-- have graded fresh orders and after woo-sync (:00/:15/:30/:45) has pulled
-- status changes for the compare pass. Quiet when no store has
-- fulfilment_mode set. Shadow mode never calls Ninja Van.

select cron.schedule(
  'nv-submit-every-15m',
  '10,25,40,55 * * * *',
  $$
  select net.http_post(
    url := 'https://wwgtjjekhehaepbxyrij.supabase.co/functions/v1/nv-submit',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer sb_publishable_Wdp9R_p1SiVdgrKIQ8fLVA_aNekE-k6'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
