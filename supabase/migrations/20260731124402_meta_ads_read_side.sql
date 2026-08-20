-- Meta ads read-side (Slice 2). Account registry + daily facts mirror.
-- The account inventory below is the real EFFEN Meta estate discovered via
-- the authorized Ads connector on 2026-07-31: businesses "EL- IJIE V10"
-- (media-buyer accounts for Synovil / Adipocyde / Glycoxil / Metaponin /
-- Melasma) and "BM - Main EFFEN". Brand mapping is by account name; numbered
-- "Unlimited Spend" accounts stay unmapped until Marketing maps them.
-- Ongoing daily sync requires a Meta system-user token (META secret_ref in
-- Vault) — the initial facts were seeded through the session connector.

create table public.ad_accounts_read (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  provider text not null default 'Meta',
  account_id text not null unique,
  name text,
  business_name text,
  account_status text,
  currency_code text,
  brand_id bigint references public.brands (id),
  is_active boolean not null default true,
  raw jsonb not null default '{}',
  first_seen_at timestamptz not null default now()
);

create table public.ad_daily_facts (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  account_ref bigint not null references public.ad_accounts_read (id) on delete cascade,
  date date not null,
  spend numeric,
  impressions bigint,
  clicks bigint,
  purchases bigint,
  captured_at timestamptz not null default now(),
  unique (account_ref, date)
);

create index ad_daily_facts_date_idx on public.ad_daily_facts (date desc);

alter table public.ad_accounts_read enable row level security;
alter table public.ad_daily_facts enable row level security;
create policy member_read on public.ad_accounts_read for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy member_read on public.ad_daily_facts for select to authenticated
  using (private.is_workspace_member(workspace_id));

-- Registry: EFFEN-estate accounts (EL- IJIE V10 + BM - Main EFFEN).
insert into public.ad_accounts_read (workspace_id, account_id, name, business_name, account_status, currency_code, brand_id, is_active)
select w.id, v.account_id, v.name, v.biz, v.status, 'MYR',
       case
         when v.name ilike '%synovil%' then (select id from public.brands where slug = 'synovil')
         when v.name ilike '%adipocyde%' then (select id from public.brands where slug = 'adipocyde')
         else null
       end,
       v.status = 'ACTIVE'
from public.workspaces w,
  (values
    ('694293249173496',  '01',                                            'BM - Main EFFEN', 'ACTIVE'),
    ('1562229277758106', 'SYNOVIL MY 1 [AMIR]',                           'EL- IJIE V10', 'ACTIVE'),
    ('1706161739919781', 'SYNOVIL MY 2 [AMIR]',                           'EL- IJIE V10', 'ACTIVE'),
    ('458020606594899',  'SYNOVIL SG [AMIR]',                             'EL- IJIE V10', 'ACTIVE'),
    ('503593629198176',  'SYNOVIL SG 1 [AMIR]',                           'EL- IJIE V10', 'DISABLED'),
    ('1069292474720053', 'SYNOVIL SG 2 [AMIR]',                           'EL- IJIE V10', 'DISABLED'),
    ('1047291477028819', 'SYNOVIL SG 3 [AMIR]',                           'EL- IJIE V10', 'DISABLED'),
    ('924825356131557',  'AMAR Synovil SG | 1474 | Unlimited Spend Ads Acc', 'EL- IJIE V10', 'ACTIVE'),
    ('1794055434411483', 'Adipocyde MY 1 (Fazir)',                        'EL- IJIE V10', 'ACTIVE'),
    ('1100141371105993', 'Adipocyde MY 2 (Fazir)',                        'EL- IJIE V10', 'ACTIVE'),
    ('1365832004124866', 'Adipocyde SG 1 (Fazir)',                        'EL- IJIE V10', 'ACTIVE'),
    ('492720220243659',  'Adipocyde SG 2 (Fazir)',                        'EL- IJIE V10', 'ACTIVE'),
    ('1044174580258781', 'GLYCOXIL MY 1 [AMIR]',                          'EL- IJIE V10', 'ACTIVE'),
    ('397181053181786',  'GLYCOXIL MY 2 [AMIR]',                          'EL- IJIE V10', 'ACTIVE'),
    ('1076885890660801', 'AMAR GLYCOXIL SG | 1604 | Unlimited Spend Ads Acc', 'EL- IJIE V10', 'ACTIVE'),
    ('759689532741469',  'Metaponin MY (BARU) -17/07 - AMIR',             'EL- IJIE V10', 'ACTIVE'),
    ('1475291739729781', 'Melasma SG - AMIR',                             'EL- IJIE V10', 'ACTIVE'),
    ('1101400400962088', '131 | HAZIM | Unlimited Spend Ads Acc',         'EL- IJIE V10', 'ACTIVE'),
    ('1073308514304958', '1061 | Unlimited Spend Ads Acc | HAZIM',        'EL- IJIE V10', 'ACTIVE'),
    ('1043690970310829', '1302 | HAZIM | Unlimited Spend Ads Acc',        'EL- IJIE V10', 'ACTIVE'),
    ('922479093080760',  '2131 | HAZIM | Unlimited Spend Ads Acc',        'EL- IJIE V10', 'ACTIVE'),
    ('3653490778258358', '147 | Hazim | Unlimited Spend Ads Acc',         'EL- IJIE V10', 'ACTIVE'),
    ('858190646411396',  'PALI | 1471 | Unlimited Spend Ads Acc',         'EL- IJIE V10', 'ACTIVE'),
    ('971385704757191',  'PALI | 1472 | Unlimited Spend Ads Acc',         'EL- IJIE V10', 'ACTIVE'),
    ('1708142293333173', 'PALI | 1473 | Unlimited Spend Ads Acc',         'EL- IJIE V10', 'ACTIVE'),
    ('895345415776793',  '1300 | PALI Unlimited Spend Ads Acc',           'EL- IJIE V10', 'ACTIVE'),
    ('1702801686791332', '1301 | PALI ERXSG | Unlimited Spend Ads Acc',   'EL- IJIE V10', 'ACTIVE'),
    ('1085496563000058', '1319 | IJIE | Unlimited Spend Ads Acc #SG',     'EL- IJIE V10', 'ACTIVE')
  ) as v (account_id, name, biz, status);

-- Registry row for the pipeline: repoint the seeded Meta Ads connection.
update public.integration_connections
set secret_ref = 'META',
    notes = 'Account registry + daily facts seeded from the authorized Ads connector. '
         || 'Ongoing daily sync needs a Meta system-user token stored as META_SYSTEM_TOKEN in Vault.'
where provider = 'Meta';
