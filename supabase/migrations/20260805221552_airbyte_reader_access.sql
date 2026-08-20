-- Read-only access for the Airbyte warehouse sync (ADR-0003 amendment:
-- Supabase read-models -> BigQuery). The airbyte_reader LOGIN role is
-- created out-of-band (it carries a password, which never belongs in a
-- migration); this migration must run AFTER the role exists.
--
-- Scope: SELECT on the five synced tables only, plus permissive RLS
-- read policies scoped to airbyte_reader alone. No writes, no other
-- tables, connection_limit enforced on the role itself.

grant usage on schema public to airbyte_reader;

grant select on
  public.orders_read,
  public.ad_accounts_read,
  public.ad_daily_facts,
  public.nv_shipments,
  public.brands
to airbyte_reader;

drop policy if exists airbyte_read on public.orders_read;
create policy airbyte_read on public.orders_read
  for select to airbyte_reader using (true);

drop policy if exists airbyte_read on public.ad_accounts_read;
create policy airbyte_read on public.ad_accounts_read
  for select to airbyte_reader using (true);

drop policy if exists airbyte_read on public.ad_daily_facts;
create policy airbyte_read on public.ad_daily_facts
  for select to airbyte_reader using (true);

drop policy if exists airbyte_read on public.nv_shipments;
create policy airbyte_read on public.nv_shipments
  for select to airbyte_reader using (true);

drop policy if exists airbyte_read on public.brands;
create policy airbyte_read on public.brands
  for select to airbyte_reader using (true);
