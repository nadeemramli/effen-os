-- ADR-0003 mart sync: ad_daily_facts grows to campaign grain with
-- warehouse provenance. Additive columns only; the (account_ref, date)
-- unique gives way to the mart contract grain
-- (date, platform, account_id, campaign_id).
--
-- Existing connector-seeded rows are marked source='legacy_seed' and are
-- deleted by the first full mart sync (they cover the same dates the
-- warehouse now serves, so keeping both would double-count).

alter table public.ad_daily_facts
  add column if not exists platform text not null default 'meta',
  add column if not exists account_id text,
  add column if not exists campaign_id text not null default '',
  add column if not exists campaign_name text,
  add column if not exists purchase_value numeric,
  add column if not exists source text not null default 'api',
  add column if not exists is_banned_account boolean not null default false,
  add column if not exists brand_slug text,
  add column if not exists market text,
  add column if not exists mart_synced_at timestamptz;

-- Everything present before this migration is connector-seeded interim
-- data; stamp provenance and backfill the platform account id.
update public.ad_daily_facts f
set source = 'legacy_seed',
    account_id = a.account_id
from public.ad_accounts_read a
where a.id = f.account_ref;

alter table public.ad_daily_facts
  alter column account_ref drop not null;

alter table public.ad_daily_facts
  drop constraint if exists ad_daily_facts_account_ref_date_key;

create unique index if not exists ad_daily_facts_grain_key
  on public.ad_daily_facts (date, platform, account_id, campaign_id);

create index if not exists ad_daily_facts_brand_date_idx
  on public.ad_daily_facts (brand_slug, date desc);
