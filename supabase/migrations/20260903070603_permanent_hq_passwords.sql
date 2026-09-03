-- Permanent HQ-issued passwords (Sep 2026).
--
-- HQ decided the workspace accounts keep the password they were issued: the
-- app is internal-only and the forced first-login change was blocking the
-- team. The password hashes themselves are reset out-of-band (never in a
-- migration); this clears the gate so AuthGate no longer lands anyone on the
-- forced "Set your password" screen. The columns stay so the voluntary
-- change-password dialog and any future opt-in gate keep working.

update public.profiles
set password_change_required = false
where password_change_required;

update public.membership_invites
set require_password_change = false
where require_password_change;
