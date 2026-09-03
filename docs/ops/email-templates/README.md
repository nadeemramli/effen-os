# Auth email templates and hardening register

**Status (2026-08-28):** templates authored in this folder; not yet pasted into the dashboard. Resend custom SMTP is live on Supabase project `wwgtjjekhehaepbxyrij` (`admin@updates.effengroup.com`, `smtp.resend.com:465`, user `resend`, 60 s minimum interval per user). Every Security-notification toggle is still **off**. Production app: `https://app.effengroup.com`; the dashboard Site URL still points at `https://effen-os.vercel.app` and needs changing.

These files are the source of truth for the 13 Supabase Auth email templates. Edit here, then re-paste into **Supabase → Authentication → Emails → Templates**. There is no `supabase/config.toml` in this repo and the app has no email code; Auth is configured only in the hosted dashboard.

## How to install

1. Open Supabase → Authentication → Emails → **Templates**.
2. For each row in the table below: open the row, paste the **Subject**, paste the whole `.html` file into the body field, Save.
3. For rows 07–13, also switch the toggle on the Templates page **on** and press *Save changes* — Security notifications are only sent when enabled at project level.
4. Test with `03-magic-link.html` first: request a magic link from the Fullkit login screen, confirm it arrives from *Fullkit &lt;admin@updates.effengroup.com&gt;*, click it, then check Resend → Logs shows *Delivered* and the stored link is the raw Supabase `/auth/v1/verify?...` URL (no tracking rewrite).

Variables are Go templates and case-sensitive. The dashboard does not validate them; a typo renders as empty text.

## Templates

| File | Dashboard row | Subject | Variables |
|---|---|---|---|
| `01-confirm-signup.html` | Confirm sign up | Confirm your email for Fullkit | `.ConfirmationURL`, `.Email` |
| `02-invite-user.html` | Invite user | You've been invited to Fullkit | `.ConfirmationURL`, `.Email` |
| `03-magic-link.html` | Magic link or OTP | Your Fullkit sign-in link | `.ConfirmationURL`, `.Email` |
| `04-change-email.html` | Change email address | Confirm your new Fullkit email address | `.ConfirmationURL`, `.Email`, `.NewEmail` |
| `05-reset-password.html` | Reset password | Reset your Fullkit password | `.ConfirmationURL`, `.Email` |
| `06-reauthentication.html` | Reauthentication | `{{ .Token }} is your Fullkit verification code` | `.Token`, `.Email` |
| `07-password-changed.html` | Password changed | Your Fullkit password was changed | `.Email`, `.SiteURL` |
| `08-email-changed.html` | Email address changed | Your Fullkit email address was changed | `.OldEmail`, `.Email`, `.SiteURL` |
| `09-phone-changed.html` | Phone number changed | Your Fullkit phone number was changed | `.OldPhone`, `.Phone`, `.Email`, `.SiteURL` |
| `10-sign-in-method-linked.html` | Sign-in method linked | A sign-in method was linked to your Fullkit account | `.Provider`, `.Email`, `.SiteURL` |
| `11-sign-in-method-removed.html` | Sign-in method removed | A sign-in method was removed from your Fullkit account | `.Provider`, `.Email`, `.SiteURL` |
| `12-mfa-method-added.html` | MFA method added | A verification method was added to your Fullkit account | `.FactorType`, `.Email`, `.SiteURL` |
| `13-mfa-method-removed.html` | MFA method removed | A verification method was removed from your Fullkit account | `.FactorType`, `.Email`, `.SiteURL` |

Every template also uses `.Email` and `.SiteURL` in the footer. `_base.html` is a reference skeleton showing every building block once; it is not a dashboard template.

Variable rules (from the Supabase Email Templates guide): `.NewEmail` only in *Change email address*; `.OldEmail` only in *Email address changed*; `.Phone`/`.OldPhone` only in *Phone number changed*; `.Provider` only in the sign-in-method notices; `.FactorType` only in the MFA notices. `.ConfirmationURL`, `.Token`, `.TokenHash`, `.SiteURL`, `.RedirectTo`, `.Data`, `.Email` are available everywhere.

## How the templates fit the app

- The web app (`apps/web/src/components/auth/login-screen.tsx`) offers password sign-in and a magic link (`signInWithOtp`, no `emailRedirectTo`), uses the implicit flow and has no callback route. Links therefore stay on `{{ .ConfirmationURL }}` and land on the dashboard **Site URL**, which must be `https://app.effengroup.com` (see URL Configuration below). There is no OTP-entry screen, so the magic-link email is link-first and does not show the code.
- Reauthentication is code-only (`{{ .Token }}`). It fires before `updateUser({ password })` because *secure password change* is on.
- Password reset (`05`) has no in-app trigger yet (`resetPasswordForEmail` is not called anywhere). The template is ready for when it exists.
- Members are provisioned by HQ with a handed-out password (`supabase/migrations/20260820064147_team_onboarding.sql`); `02-invite-user.html` covers `auth.admin.inviteUserByEmail` if HQ ever switches to dashboard invites.
- Security notices never contain an action link other than `{{ .SiteURL }}`. The "if this wasn't you" action is *contact an HQ admin*, because HQ, not the user, can lock and re-issue an account.
- Demo-mode redaction (`apps/web/src/lib/seed/demo-profile.ts`) does not apply: templates live in the dashboard, not the app bundle, and auth mail only reaches invited `@effengroup.com` staff.

## Design tokens

Light palette from `apps/web/src/app/globals.css` (dark-mode variables do not survive email clients, and `color-scheme: light` is declared so Gmail/Apple Mail do not invert the graphite brand colour):

| Use | Value |
|---|---|
| Page background | `#f6f7f8` |
| Card | `#ffffff`, 1 px `#e3e5e9` border, 8 px radius, 32 px padding |
| Ink | `#16181d`; muted `#5d6470` |
| Primary (F mark, button) | `#232833` on `#f4f3ef` |
| Warning callout | 4 px `#b06000` left border on `#fbf5ec` |
| Links | `#2563cf` |
| Font | `Geist, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`; code `"Geist Mono", SFMono-Regular, Menlo, Consolas, monospace` |

Layout is a 600 px centred table with nested `role="presentation"` tables and inline styles; the `<style>` block only carries the mobile media query. No images (the F mark is a table cell), no tracking pixels, no unsubscribe (transactional, internal). Each CTA has a plain-text fallback link because `{{ .ConfirmationURL }}` is single-use and some corporate scanners (Microsoft Safe Links) pre-fetch it.

## Security and deliverability checklist

Legend: **on** = already configured, **turn on** = do now, **decision** = needs an owner call.

### Resend (`updates.effengroup.com`)

- [ ] **turn on** — Domain status is *Verified* with both SPF and DKIM records published (not *Pending*).
- [ ] **turn on** — DMARC record on `updates.effengroup.com`: `v=DMARC1; p=quarantine; rua=mailto:dmarc@effengroup.com`. Start at `p=none` for a week if unsure, then move to `quarantine`.
- [ ] **turn on** — Custom return-path (bounce) domain in Resend so SPF aligns with the From domain.
- [ ] **turn on** — **Disable click tracking and open tracking** for this domain. Link rewriting replaces `{{ .ConfirmationURL }}` and breaks sign-in; the Supabase guide warns about this explicitly.
- [ ] **turn on** — API key scoped to *Sending access* and restricted to this domain. It should exist only in the Supabase SMTP password field; rotate it if it was ever pasted anywhere else.
- [ ] **turn on** — SMTP sender name `admin` → `Fullkit`. The inbox shows the name; "admin" reads as phishing. The address `admin@updates.effengroup.com` is fine (`no-reply@` optional).

### Supabase → Authentication → Emails

- **on** — Custom SMTP, port 465, 60 s minimum interval per user.
- [ ] **turn on** — All 7 Security-notification toggles (Password changed, Email address changed, Phone number changed, Sign-in method linked/removed, MFA method added/removed) after pasting 07–13.

### Supabase → Authentication → Sign In / Providers → Email

- [ ] **turn on** — Confirm email.
- [ ] **turn on** — Secure email change (double confirmation from old and new address).
- **on** — Secure password change (`updateUser` requires `current_password`; see `README.md`).
- [ ] **turn on** — Minimum password length 10 (matches `change-password-dialog.tsx`), require letters, digits and symbols.
- [ ] **turn on** — Leaked-password protection (HaveIBeenPwned). This is the open item in [`supabase-advisor-register.md`](../supabase-advisor-register.md); it clears the last security WARN.
- [ ] **turn on** — Email OTP expiry ≤ 3600 s (the advisor warns above one hour). OTP length 6 is fine; 8 optional.
- **decision** — *Allow new users to sign up*. The login screen calls `signInWithOtp` with `shouldCreateUser: true` (`login-screen.tsx:55`), so anyone can create an auth user (no membership, so no access). Recommended: turn sign-ups **off** and flip `shouldCreateUser` to `false` so only HQ-provisioned users exist. Not executed as part of this register.
- [ ] **turn on** — Anonymous sign-ins off. Phone provider off (the `09` template then never fires).

### Supabase → Authentication → URL Configuration

The production app is **`https://app.effengroup.com`**. As of 2026-08-28 email links still land on `https://effen-os.vercel.app` because that is the dashboard Site URL; every template uses `{{ .SiteURL }}` / `{{ .ConfirmationURL }}` (no hardcoded host), so fixing the dashboard fixes every email at once.

- [ ] **turn on** — Site URL = `https://app.effengroup.com` (no trailing slash).
- [ ] **turn on** — Redirect URLs allow-list: `https://app.effengroup.com/**`. Keep `https://effen-os.vercel.app/**` only while anyone still signs in there; remove it once the custom domain is the only entry point. Add `https://effen-os-*-<team>.vercel.app/**` only if preview deployments must complete magic links.
- **on** — Vercel: `app.effengroup.com` is attached to the `effen-os` project (verified 2026-08-28 via the Vercel API, alongside `effen-os.vercel.app` and the git/preview aliases).
- [ ] **turn on** — Vercel: set `effen-os.vercel.app` to *Redirect to* `app.effengroup.com` (Project → Settings → Domains) so old links and bookmarks converge on one origin.
- [ ] **turn on** — Resend and DMARC alignment stays on `updates.effengroup.com`; the sending subdomain and the app domain are intentionally different, which keeps auth-mail reputation separate from the app host.

### Supabase → Authentication → Rate Limits

- [ ] **turn on** — Emails per hour: keep the default (30 with custom SMTP) until real volume shows otherwise; token verifications, sign-in/sign-up per 5 minutes at defaults; anonymous users 0.

### Supabase → Authentication → Attack Protection, Multi-Factor, Sessions, Audit Logs

- **on** — hCaptcha on every sign-in (see `README.md`).
- **decision** — Multi-Factor: enable TOTP with optional enrolment so `12`/`13` become meaningful. Do not enforce yet; the app has no enrolment UI.
- **decision** — Sessions: inactivity timeout and single-session-per-user are available on Pro; set them once HQ agrees a policy.
- [ ] **turn on** — Audit Logs: confirm `user_recovery_requested` / `user_updated_password` events appear after the first test.

### App-side follow-ups (out of scope here)

- Add `emailRedirectTo` and a `/auth/confirm` route with `token_hash` verification (PKCE) if links ever need to deep-link into a page; until then links land on Site URL.
- Wire `resetPasswordForEmail` to a "Forgot password" action so template `05` has a trigger.
- Flip `shouldCreateUser` per the decision above.

## Maintenance

- Re-paste after any edit here; the dashboard has no link to this folder.
- Update the status line and tick the checklist as items are completed; move durable auth-boundary decisions (sign-up policy, MFA enforcement) into an ADR under `docs/decisions/`.
- Update `CURRENT_STATE.md` when the templates are live, per the maintenance rule in `docs/README.md`.
