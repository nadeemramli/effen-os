-- Customer lifecycle contract, v9: restore the session statement_timeout on
-- the nightly cron command, and run one catch-up refresh.
--
-- Applied 2026-08-27 19:22 UTC via MCP apply_migration; filed under the version the
-- ledger recorded (20260827192252), per supabase/migrations/README.md.
--
-- v6 rewrote the 'customer-lifecycle-refresh-daily' command as a bare
-- `select private.refresh_customer_lifecycle_daily();`, relying on the
-- function's own `SET statement_timeout = '20min'`. A function-level SET does
-- not re-arm the timeout of the statement already running, so pg_cron's
-- session default (2 min) applied. Before Phase 5 the incremental refresh
-- took ~1.5 min and slipped under it; once customer_economics_v1 added
-- `private.econ_rebuild(15)` to the same job, every nightly run since
-- 25 Aug 2026 has died with "canceling statement due to statement timeout",
-- rolling the whole refresh back. Lifecycle states, movement and economics
-- have therefore been frozen at the 24 Aug 20:58 UTC refresh.
--
-- Fix: the cron command sets the session timeout first, as
-- 'commerce-daily-refresh' and the v1/v2 schedules already did. cron.schedule
-- upserts by job name, so this replaces the command in place (same schedule,
-- 01:30 MYT). A single-attempt catch-up job unschedules itself and runs once
-- within a minute; if it fails, the refresh log carries the error and the
-- nightly job retries at 17:30 UTC.

select cron.schedule(
  'customer-lifecycle-refresh-daily',
  '30 17 * * *',
  $cron$ set statement_timeout = '20min'; select private.refresh_customer_lifecycle_daily(); $cron$
);

select cron.schedule(
  'customer-lifecycle-catchup',
  '* * * * *',
  $cron$ select cron.unschedule('customer-lifecycle-catchup'); set statement_timeout = '20min'; select private.refresh_customer_lifecycle_daily(); $cron$
);
