-- Team onboarding — register the EFFEN Workspace accounts (Aug 2026).
--
-- Auth users are NOT created here. Passwords must never live in a committed
-- migration, so account creation is a one-off provisioning step run against
-- the project; this migration carries only the durable, reviewable half:
-- who is invited, at what role, and the first-login gate they land on.
--
-- Flow: invite row exists -> HQ creates the auth user with a handed-out
-- password -> on_auth_user_created claims the invite, writes the profile and
-- the membership, and carries require_password_change onto the profile.

alter table public.profiles
  add column if not exists password_change_required boolean not null default false;

comment on column public.profiles.password_change_required is
  'True until the member replaces an HQ-issued password. AuthGate blocks the app while set, so a handed-out shared secret cannot stay live.';

alter table public.membership_invites
  add column if not exists require_password_change boolean not null default false;

comment on column public.membership_invites.require_password_change is
  'Seeds profiles.password_change_required when this invite is claimed.';

-- Carry the invite's first-login gate onto the profile it creates. Everything
-- else about this trigger is unchanged from 20260724000003_invite_only_auth.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, password_change_required)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    coalesce(
      (
        select mi.require_password_change
        from public.membership_invites mi
        where lower(mi.email) = lower(new.email)
          and mi.claimed_at is null
        limit 1
      ),
      false
    )
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

-- The seven Google Workspace accounts, all hq_admin per HQ instruction.
-- admin@ and effen@ are shared role mailboxes rather than individuals; they
-- get the same first-login gate so neither keeps the issued password.
insert into public.membership_invites
  (workspace_id, email, role_key, invited_by, require_password_change)
select w.id, v.email, 'hq_admin', 'Nadeem', true
from public.workspaces w,
  (values
    ('amir@effengroup.com'),
    ('ijie@effengroup.com'),
    ('admin@effengroup.com'),
    ('effen@effengroup.com'),
    ('firdaus@effengroup.com'),
    ('nadeem@effengroup.com'),
    ('yun@effengroup.com')
  ) as v (email)
where w.name = 'EFFEN International Sdn Bhd'
on conflict (email) do nothing;
