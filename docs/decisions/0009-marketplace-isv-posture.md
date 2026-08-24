# ADR-0009 — Marketplace access: the partner track, and the public surface it requires

**Date:** 2026-08-21 · **Status: accepted (registration not yet submitted; no connector built)**

## Why this ADR exists

Shopee and TikTok Shop both asked, on the same day, for something Fullkit
has never had: a public identity. Shopee's console demands an account
type, a live product URL and reviewer credentials; TikTok Shop asked for
an OAuth redirect URL. Neither can be answered from an internal-only
application.

The account-type question is the load-bearing one. Both platforms offer a
direct-seller path — an app bound to shops the registering seller owns —
and a partner path, where one app serves shops owned by other parties.
EFFEN operates shops belonging to other parties on both platforms, so the
direct-seller path is unavailable in both cases.

That forces a boundary `docs/PRD.md` explicitly ruled out. Its non-goals
list "no multi-tenancy, no billing, no white-label, no public signup".
Registering as a partner platform and publishing a product page moves
Fullkit toward vendor posture. This ADR records exactly how far it moves,
so that "we are an ISV now" does not silently contradict the PRD.

## Decisions

**1. Register on the partner track on both platforms.** Shopee Open
Platform as *Third-party Partner Platform*; TikTok Shop via Partner
Center. The TikTok Seller Center "Enable API" toggle is the direct-seller
path and does not substitute — it covers only shops we own. These are two
separate applications with two separate reviews, tracked in
`docs/ops/marketplace-onboarding-plan.md`.

This is a truthful classification, not a workaround. The partner category
describes operating shops on behalf of the parties that own them. That is
what EFFEN does, and the application answers should come from the real
counts.

**2. What moves, and what holds.**

*Holds.* No public signup. No billing. No white-label. The workspace model
stays single-tenant: there is one workspace, and membership remains
invite-only through `membership_invites`.

*Moves.* Two things. `integration_connections` will hold credentials for
shops outside the workspace's ownership — Fullkit becomes custodian of
other parties' marketplace access, which is a governance change rather
than an architectural one. And Fullkit acquires a public presence: a
marketing page and a reviewer-accessible demo.

The distinction matters because the second is what reviewers see and the
first is what carries risk. Holding another party's shop credentials
obliges us to a revocation path and a clear answer to "who at EFFEN can
reach this shop's data" — the same `hq_admin`-gated Vault RPCs the
existing connectors use, and nothing looser.

**3. The reviewer surface is a separate deployment on synthetic data.**
Reviewers get a demo instance built from the existing deterministic seed,
deployed as its own Vercel project with no Supabase credentials at all,
behind a demo login. They never touch the production tenant.

Rejected: giving reviewers a scoped account in the real app. A read-only
role would still place an external party inside the production workspace,
and role enforcement today is largely client-side — `private.has_role` is
applied on write RPCs, but most live read models are gated only by
`private.is_workspace_member`. Any active member can read them. That is
acceptable for staff and not acceptable for an external reviewer.

Also rejected: a throwaway Supabase project for the demo. It would mean
replicating the migrations, RPCs and warehouse marts the live read path
depends on, and would put a real Supabase URL and anon key back into the
demo bundle — the exact exposure the separation exists to prevent.

**4. Read scopes only.** Request order, product and settlement reads.
`docs/PRD.md` already defers marketplace write-back, and
`docs/Spines/S1 - Customer and Order Hub.md` stages marketplace ingestion
read-only first. Requesting write scopes we will not exercise invites
review scrutiny for no gain.

## Consequences

- The seed data becomes publicly visible and must stop naming real
  entities. Workspace name, the `Lipidri MY` brand, and the personas
  `Nadeem` and `Ida` are real today. Enforced by a denylist scan in
  `apps/web/src/lib/seed/__check__.ts` rather than by review, because
  find-and-replace regresses.
- The fixed demo clock becomes a liability. `DEMO_NOW_ISO` is a constant
  while the Orders page computes relative time from the real clock, so
  the demo dataset ages one day per day. To a reviewer assessing an
  order-ingestion product, a stale Orders page reads as broken sync. Demo
  mode must shift the seed epoch so the dataset always ends today.
- Attaching a custom domain to the `effen-os` Vercel project removes its
  SSO protection, which is currently set to `all_except_custom_domains`.
  The internal app then stands on client-side `AuthGate` plus RLS alone.
  This must be a deliberate step, not a side effect of DNS work.
- Marketplace commissions remain outside CM3 (ADR-0008) until settlement
  ingestion lands. Connecting the shops does not by itself close that gap.
- A second deployment is a second thing to keep current. The demo tracks
  its own branch and carries a type-level completeness guard so that
  adding a live read function fails the demo build rather than silently
  leaving a hole.

## Known limits / risks accepted

- **The demo shows a Shopee integration that does not exist.** The seeded
  `INT-shopee` connection, including its re-authorisation dialog, is
  aspirational — `supabase/functions/` contains no Shopee connector. If a
  reviewer probes for live API traffic, the honest answer is that
  approval is the prerequisite for building it, which is the normal
  sequence. We should not imply otherwise in the application.
- **Platform API specifics are not settled here.** Token lifetimes,
  signature schemes and endpoint shapes for both platforms must be
  verified against current vendor documentation when the connector is
  built, not carried from memory or from this file.
- **Approval may be refused.** Neither platform guarantees partner
  access, and refusal leaves marketplace orders in their silos. The
  fallback is per-shop direct-seller apps for the shops EFFEN does own,
  which covers part of the estate and none of the partner shops.

## What this amends

`docs/PRD.md` non-goals ("no multi-tenancy … no public signup") stand as
written for the product, but no longer describe the deployment surface:
Fullkit will have a public marketing page and a public demo. The
single-tenant, invite-only claim is unchanged.

## Amendment 2026-08-21 — what the platform consoles actually require

Both consoles were read the day this ADR was written. Four things change.

**1. Shopee masks address as well as phone and e-mail, which invalidates
ADR-0007's marketplace claim.** Shopee's *Requesting Access to Sensitive
Data* guide defines sensitive data as "customer name, phone number, email
address, and address", all masked by default. ADR-0007 chose address as the
identity join key for marketplace ingestion *because* phone and e-mail are
masked. That reasoning does not survive: without sensitive-data approval
there is no unmasked join key on Shopee, and marketplace orders cannot be
resolved to a customer at all.

The consequence is a split, not a stall. Order counts, revenue, SKU mix,
settlement and fulfilment state need no customer identity and can ship
first. Customer 360 across marketplaces is gated on approval. Ingest masked
values with their provenance and do not build a resolver against them —
a resolver over masked input would silently manufacture false identities,
which is worse than no resolution.

**2. Unmasking requires a penetration test, and that is now the long pole.**
Mandatory for ISVs serving Malaysia, Singapore, Thailand or the Philippines.
Black-box, covering the externally exposed surface, with all Critical and
High findings remediated; vulnerability scans are explicitly rejected.
Roughly ten working days of review, and access lasts two years from the
report's *issue* date. This must be commissioned before it is needed. It
also means the public marketing page and demo instance this ADR introduces
become part of an audited attack surface — a cost of going public that was
not visible when the decision was taken.

**3. IP allowlisting is incompatible with our connector architecture.**
Shopee requires declared IPs; TikTok has shipped the same panel. Supabase
documents that Edge Functions cannot provide static egress IPs, being
serverless and globally distributed — and every connector we have is an edge
function. Outbound marketplace calls therefore need a static-IP path, most
cheaply a small outbound proxy that edge functions route through. Inbound
callbacks are unaffected, so the OAuth redirect stays where it is.

**4. TikTok tests the app before approving it, so the connector moves ahead
of submission.** The launch checklist states "We will review and test app
functionality", and the app's Redirect URL is already saved pointing at
`/functions/v1/tiktok-oauth`, which does not exist. The original sequencing
in this ADR — register, then build — is wrong for TikTok. Build the callback
and a demonstrable authorised call first, submit second. Shopee's sequencing
is unchanged, because its blocker is the pen test rather than the app.

**Also noted:** the TikTok ISV account is held by **Teroka Digital**, not
EFFEN International Sdn Bhd. The custodianship question this ADR raised now
has a concrete instance. Shopee should be registered under whichever entity
is chosen, and the choice recorded here — two applications naming different
companies for the same shops invites exactly the scrutiny §1 aims to avoid.
