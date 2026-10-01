-- LOCAL HARNESS ONLY — never run against the Supabase project.
--
-- Recreates, on a bare Postgres 16, the minimum of Supabase + Fullkit
-- foundation that supabase/reference/creative_lab_v1.sql depends on, with
-- the same definitions as production (auth.uid() reads the JWT claims
-- GUCs; is_workspace_member/has_role copied from slice1/catalog_live).
-- Used by scripts/creative/test-sql.sh:
--   harness → proposed migration → supabase/tests/creative_lab.sql
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
create schema if not exists private;
grant usage on schema auth, private, public to anon, authenticated, service_role;

create table if not exists auth.users (id uuid primary key, email text);

create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;

create table public.workspaces (
  id bigint generated always as identity primary key,
  name text not null,
  timezone text not null default 'Asia/Kuala_Lumpur',
  base_currency_code text not null default 'MYR',
  status text not null default 'active',
  created_at timestamptz not null default now()
);
create table public.brands (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  default_legal_entity_id bigint,
  name text not null,
  slug text not null unique,
  category text,
  is_demo boolean not null default false,
  status text not null default 'active',
  created_at timestamptz not null default now()
);
create table public.memberships (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  user_id uuid not null references auth.users (id) on delete cascade,
  role_key text not null check (role_key in ('hq_admin', 'sales_cs', 'marketing_growth', 'operations', 'finance', 'analyst', 'system_automation')),
  status text not null default 'invited' check (status in ('invited', 'active', 'suspended')),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);
create table public.membership_brand_scopes (
  id bigint generated always as identity primary key,
  membership_id bigint not null references public.memberships (id) on delete cascade,
  brand_id bigint not null references public.brands (id) on delete cascade,
  unique (membership_id, brand_id)
);
create table public.audit_events (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  actor_membership_id bigint references public.memberships (id),
  actor_label text not null,
  action text not null,
  entity_ref text,
  detail text,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
alter table public.workspaces enable row level security;
alter table public.brands enable row level security;
alter table public.memberships enable row level security;
alter table public.membership_brand_scopes enable row level security;
alter table public.audit_events enable row level security;

create or replace function private.is_workspace_member(ws_id bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m where m.workspace_id = ws_id
    and m.user_id = (select auth.uid()) and m.status = 'active');
$$;
create or replace function private.has_role(ws_id bigint, allowed text[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m where m.workspace_id = ws_id
    and m.user_id = (select auth.uid()) and m.status = 'active' and m.role_key = any (allowed));
$$;
grant execute on function private.has_role(bigint, text[]) to authenticated;

-- Supabase Vault stand-in (same surface the RPCs use: vault.secrets,
-- vault.create_secret, vault.decrypted_secrets). Plaintext locally.
create schema if not exists vault;
create table if not exists vault.secrets (
  id uuid primary key default gen_random_uuid(),
  name text unique,
  description text,
  secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create or replace function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
returns uuid language sql as $$
  insert into vault.secrets (name, description, secret) values (new_name, new_description, new_secret) returning id;
$$;
create or replace function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null)
returns void language sql as $$
  update vault.secrets set secret = coalesce(new_secret, secret), name = coalesce(new_name, name),
    description = coalesce(new_description, description), updated_at = now() where id = secret_id;
$$;
create or replace view vault.decrypted_secrets as select id, name, description, secret as decrypted_secret, created_at, updated_at from vault.secrets;
revoke all on schema vault from public, anon, authenticated;

create table public.integration_connections (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  provider text not null,
  name text not null,
  category text not null,
  environment text not null default 'production',
  direction text not null,
  read_scopes text[] not null default '{}',
  write_scopes text[] not null default '{}',
  secret_ref text,
  status text not null default 'pending_setup',
  freshness_sla_minutes integer not null default 60,
  notes text,
  created_at timestamptz not null default now()
);
