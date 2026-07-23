-- Fullkit Slice 1 foundation
-- Frontend-serving metadata only, per docs/Fullkit Technical Architecture.md:
-- auth/membership scaffolding, UI preferences, saved views, work items,
-- approvals, integration metadata, data-quality issues, metric definitions,
-- audit events. Deliberately NOT an operational commerce core — payment /
-- stock / shipment / ad-delivery facts stay with their systems of record.
-- RLS is enabled on every table; writes are deny-by-default (no insert/update
-- policies yet — Slice 3 introduces guarded RPCs with idempotency + audit).

create schema if not exists private;

-- ---------- organization ----------

create table public.workspaces (
  id bigint generated always as identity primary key,
  name text not null,
  timezone text not null default 'Asia/Kuala_Lumpur',
  base_currency_code text not null check (char_length(base_currency_code) = 3),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now()
);

create table public.legal_entities (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  legal_name text not null,
  registration_number text,
  country_code text not null check (char_length(country_code) = 2),
  default_currency_code text not null check (char_length(default_currency_code) = 3),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now()
);

create table public.brands (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  default_legal_entity_id bigint references public.legal_entities (id),
  name text not null,
  slug text not null unique,
  category text,
  is_demo boolean not null default false,
  status text not null default 'active' check (status in ('active', 'upcoming', 'archived')),
  created_at timestamptz not null default now()
);

create table public.stores (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  brand_id bigint not null references public.brands (id),
  legal_entity_id bigint references public.legal_entities (id),
  name text not null,
  channel_type text not null check (channel_type in ('website', 'marketplace', 'conversation', 'manual')),
  source_type text not null,
  domain text,
  country_code text not null check (char_length(country_code) = 2),
  currency_code text not null check (char_length(currency_code) = 3),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now()
);

-- ---------- identity & access ----------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  phone_e164 text,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now()
);

create table public.memberships (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  user_id uuid not null references auth.users (id) on delete cascade,
  role_key text not null check (
    role_key in ('hq_admin', 'sales_cs', 'marketing_growth', 'operations', 'finance', 'analyst', 'system_automation')
  ),
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

create table public.user_preferences (
  user_id uuid not null references auth.users (id) on delete cascade,
  workspace_id bigint not null references public.workspaces (id),
  theme text not null default 'dark' check (theme in ('dark', 'light')),
  default_brand_slug text,
  default_date_range text not null default '7d' check (default_date_range in ('today', '7d', '30d')),
  updated_at timestamptz not null default now(),
  primary key (user_id, workspace_id)
);

create table public.saved_views (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  user_id uuid not null references auth.users (id) on delete cascade,
  route_key text not null,
  name text not null,
  params jsonb not null default '{}',
  is_shared boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- workflow ----------

create table public.work_items (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  title text not null,
  entity_ref text not null,
  owner_membership_id bigint references public.memberships (id),
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  next_action text,
  due_at timestamptz,
  status text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  created_at timestamptz not null default now()
);

create table public.approvals (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  subject_ref text not null,
  decision text not null check (decision in ('approved', 'rejected', 'scheduled', 'evidence_requested', 'expired')),
  decided_by_membership_id bigint references public.memberships (id),
  decided_at timestamptz not null default now(),
  rationale text,
  limits jsonb,
  created_at timestamptz not null default now()
);

create table public.comments (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  entity_ref text not null,
  author_membership_id bigint references public.memberships (id),
  body text not null,
  created_at timestamptz not null default now()
);

-- ---------- integrations & data trust ----------

create table public.integration_connections (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  provider text not null,
  name text not null,
  category text not null check (
    category in ('commerce', 'ads', 'marketplace', 'payments', 'logistics', 'cdp', 'analytics', 'accounting')
  ),
  environment text not null default 'production' check (environment in ('production', 'sandbox')),
  direction text not null check (direction in ('read', 'write', 'read_write')),
  read_scopes text[] not null default '{}',
  write_scopes text[] not null default '{}',
  -- Reference into the server-side secrets manager. Never the credential itself.
  secret_ref text,
  owner_membership_id bigint references public.memberships (id),
  status text not null default 'pending_setup' check (
    status in ('healthy', 'degraded', 'stale', 'disconnected', 'pending_setup')
  ),
  freshness_sla_minutes integer not null default 60,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  sync_checkpoint text,
  error_count_24h integer not null default 0,
  credential_rotates_at timestamptz,
  notes text,
  created_at timestamptz not null default now()
);

create table public.integration_account_mappings (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  integration_id bigint not null references public.integration_connections (id) on delete cascade,
  external_account_id text not null,
  external_name text,
  brand_id bigint references public.brands (id),
  legal_entity_id bigint references public.legal_entities (id),
  market_code text,
  currency_code text,
  business_purpose text,
  owner_membership_id bigint references public.memberships (id),
  status text not null default 'unmapped' check (status in ('mapped', 'unmapped', 'disabled')),
  created_at timestamptz not null default now(),
  unique (integration_id, external_account_id)
);

create table public.sync_runs (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  integration_id bigint not null references public.integration_connections (id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'success', 'partial', 'failed')),
  records_read integer not null default 0,
  records_written integer not null default 0,
  error_count integer not null default 0,
  reason_code text,
  message text
);

create table public.data_quality_issues (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  title text not null,
  detail text,
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  category text not null check (category in ('freshness', 'mapping', 'reconciliation', 'sync_failure', 'definition')),
  integration_id bigint references public.integration_connections (id),
  entity_ref text,
  owner_membership_id bigint references public.memberships (id),
  status text not null default 'open' check (status in ('open', 'acknowledged', 'resolved')),
  opened_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table public.metric_definitions (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  metric_key text not null,
  name text not null,
  formula text not null,
  grain text,
  source_integration_ids bigint[] not null default '{}',
  quality text not null default 'monitored' check (quality in ('trusted', 'monitored', 'degraded')),
  caveat text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  unique (workspace_id, metric_key)
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

-- ---------- RLS: enable everywhere, deny writes by default ----------

alter table public.workspaces enable row level security;
alter table public.legal_entities enable row level security;
alter table public.brands enable row level security;
alter table public.stores enable row level security;
alter table public.profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.membership_brand_scopes enable row level security;
alter table public.user_preferences enable row level security;
alter table public.saved_views enable row level security;
alter table public.work_items enable row level security;
alter table public.approvals enable row level security;
alter table public.comments enable row level security;
alter table public.integration_connections enable row level security;
alter table public.integration_account_mappings enable row level security;
alter table public.sync_runs enable row level security;
alter table public.data_quality_issues enable row level security;
alter table public.metric_definitions enable row level security;
alter table public.audit_events enable row level security;

-- Security-definer membership check (avoids recursive RLS on memberships).
create or replace function private.is_workspace_member(ws_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.workspace_id = ws_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
  );
$$;

-- Member read access, workspace-scoped.
create policy member_read on public.workspaces for select to authenticated
  using (private.is_workspace_member(id));
create policy member_read on public.legal_entities for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy member_read on public.brands for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy member_read on public.stores for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy member_read on public.memberships for select to authenticated
  using (user_id = (select auth.uid()) or private.is_workspace_member(workspace_id));
create policy member_read on public.membership_brand_scopes for select to authenticated
  using (exists (
    select 1 from public.memberships m
    where m.id = membership_id and private.is_workspace_member(m.workspace_id)
  ));
create policy member_read on public.work_items for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy member_read on public.approvals for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy member_read on public.comments for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy member_read on public.integration_connections for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy member_read on public.integration_account_mappings for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy member_read on public.sync_runs for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy member_read on public.data_quality_issues for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy member_read on public.metric_definitions for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy member_read on public.audit_events for select to authenticated
  using (private.is_workspace_member(workspace_id));

-- Own-row surfaces.
create policy own_profile_read on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy own_profile_update on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));
create policy own_preferences on public.user_preferences for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy member_or_shared_views_read on public.saved_views for select to authenticated
  using (
    private.is_workspace_member(workspace_id)
    and (is_shared or user_id = (select auth.uid()))
  );
create policy own_views_write on public.saved_views for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));
create policy own_views_update on public.saved_views for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy own_views_delete on public.saved_views for delete to authenticated
  using (user_id = (select auth.uid()));

-- Comments are the one member-writable collaboration surface in Slice 1.
create policy member_comment_insert on public.comments for insert to authenticated
  with check (
    private.is_workspace_member(workspace_id)
    and author_membership_id in (
      select m.id from public.memberships m where m.user_id = (select auth.uid())
    )
  );
