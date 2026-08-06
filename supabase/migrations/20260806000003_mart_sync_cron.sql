-- Daily mart-sync schedule (ADR-0003): 22:00 UTC = 06:00 MYT, after the
-- Airbyte syncs (19:00/20:00 UTC) and the dbt build. The bearer token is
-- the project's anon key — public by design (it ships in the frontend
-- bundle); it only satisfies the edge function's JWT check, all real
-- authority stays in function-side secrets.

select cron.unschedule('mart-sync-daily')
where exists (select 1 from cron.job where jobname = 'mart-sync-daily');

select cron.schedule(
  'mart-sync-daily',
  '0 22 * * *',
  $$
  select net.http_post(
    url := 'https://wwgtjjekhehaepbxyrij.supabase.co/functions/v1/mart-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3Z3RqamVraGVoYWVwYnh5cmlqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ4MjI0NzIsImV4cCI6MjEwMDM5ODQ3Mn0.VNtR5OGSJ-ZRg56smDllMvqJWJqMKAbyCCY6TJItJjc'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
