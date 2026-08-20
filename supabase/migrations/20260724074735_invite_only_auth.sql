-- Invite-only auth (Slice 1).
-- Anyone can technically authenticate with Supabase Auth, but authorization
-- is invite-gated: a membership is only created when the signing-up email
-- matches a row in membership_invites. Users without a membership see a
-- "not invited" screen and RLS gives them access to nothing.

create table public.membership_invites (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  email text not null unique,
  role_key text not null check (
    role_key in ('hq_admin', 'sales_cs', 'marketing_growth', 'operations', 'finance', 'analyst')
  ),
  invited_by text,
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);

-- No client access at all: invites are managed by HQ via dashboard/SQL, and
-- only the security-definer trigger below reads them.
alter table public.membership_invites enable row level security;

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;

  insert into public.memberships (workspace_id, user_id, role_key, status, joined_at)
  select mi.workspace_id, new.id, mi.role_key, 'active', now()
  from public.membership_invites mi
  where lower(mi.email) = lower(new.email)
    and mi.claimed_at is null
  on conflict (workspace_id, user_id) do nothing;

  update public.membership_invites mi
  set claimed_at = now()
  where lower(mi.email) = lower(new.email)
    and mi.claimed_at is null;

  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_user();

-- Founding invite. Teammates are added with:
--   insert into public.membership_invites (workspace_id, email, role_key, invited_by)
--   select id, 'person@example.com', 'sales_cs', 'Nadeem' from public.workspaces
--   where name = 'EFFEN International Sdn Bhd';
insert into public.membership_invites (workspace_id, email, role_key, invited_by)
select id, 'm.nadeemramli@gmail.com', 'hq_admin', 'bootstrap'
from public.workspaces
where name = 'EFFEN International Sdn Bhd';
