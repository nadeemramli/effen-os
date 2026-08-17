-- The top bar grew 90d / 1y / custom presets (71f061b) but the preference
-- row's check still only allowed today/7d/30d, so every 90d or 1y pick
-- failed the upsert with 23514 (silently — the app only console.warns).
alter table public.user_preferences drop constraint if exists user_preferences_default_date_range_check;
alter table public.user_preferences
  add constraint user_preferences_default_date_range_check
  check (default_date_range in ('today', '7d', '30d', '90d', '1y'));
