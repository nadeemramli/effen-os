# Marketplace onboarding — Shopee & TikTok Shop developer access

**Date: 2026-08-21.** Owner checklist and build sequence for API access to
Shopee Open Platform and TikTok Shop Partner Center. The durable decision
behind it is [ADR-0009](../decisions/0009-marketplace-isv-posture.md). This
register tracks approval state; it is not a design document. Platform
requirements quoted here were read on 2026-08-21 and change without notice —
re-verify at the console, not from this file.

Both applications are open. TikTok is further along than Shopee: the ISV
developer account exists and an app is in Draft. Shopee's blocking item is
not the application at all — it is a penetration test report.

## 1. Where each platform stands

| | Shopee | TikTok Shop |
|---|---|---|
| Account | Partner registration in progress | **App Developer (ISV)** — approved |
| Entity on file | To confirm | **Teroka Digital** |
| App | Not created | `Fullkit OS` — Draft, ID 7676289274388449031 |
| Market | MY (+SG intended) | Malaysia, local sellers |
| Credentials | None | App key issued 2026-08-21 |
| Redirect URL | Not set | Set, **pointing at an endpoint that does not exist** |
| Blocking item | Penetration test report | App review needs a working app |

⚠ The TikTok Shop Seller Center **"Enable API"** toggle is the direct-seller
path and covers only shops we own. The Partner Center app above is the one
that matters.

## 2. The two findings that reshape this work

### 2.1 Shopee masks all customer data by default

Shopee's *Requesting Access to Sensitive Data* guide states that sensitive
data — **"customer name, phone number, email address, and address"** — is
masked by default. Unmasking requires two things:

1. **A penetration test report.** Mandatory for Third-party Partner Platform
   (ISV) developers "serving, or planning to serve, sellers in Thailand,
   Malaysia, Singapore, or the Philippines". That is us. It must be
   black-box, cover the externally exposed attack surface, document
   methodology and findings, and confirm **all Critical and High severity
   vulnerabilities have been remediated**. Vulnerability scans alone are
   explicitly not accepted. Review takes ~10 working days. Access is granted
   for **two years from the report's issue date**, so a report older than a
   year burns runway.
2. **IP address whitelisting.** Required for all developers; declared at the
   Go Live step. Once enabled, API calls can only originate from the declared
   addresses.

This is the long pole. Engaging an accredited tester (Shopee names CREST,
OSCP, GPEN, CEH, CISSP among others), remediating whatever it finds, and
waiting out review is measured in weeks, not days — and it has to start
before it is needed, not when the connector is ready.

### 2.2 It also breaks our marketplace identity strategy

[ADR-0007](../decisions/0007-address-identity.md) makes address the identity
join key for marketplace ingestion precisely because "TikTok Shop / Shopee
mask phone and e-mail with virtual identifiers". Shopee masks **address
too**. Without sensitive-data approval there is no join key at all, and
marketplace orders cannot be resolved to customers — which is most of what
S1 wanted from them.

That does not stall everything. Order counts, revenue, SKUs, settlement and
fulfilment state do not need customer identity, so a masked-data Phase 1 is
worth shipping. But Customer 360 across marketplaces waits on the pen test.

## 3. IP allowlisting versus the current architecture

Both platforms now want declared IPs — Shopee requires it for sensitive
data, TikTok has shipped an "IP allowlist" panel on the app.

**Supabase Edge Functions cannot satisfy this.** Supabase documents the
point directly in *"Why Supabase Edge Functions cannot provide static egress
IPs for allow listing"*: functions are serverless and globally distributed,
so outbound calls do not originate from a stable address. Every existing
connector (`woo-sync`, `nv-submit`, `mart-sync`) is an edge function.

Options, in the order they are worth considering:

| Option | What it costs | Notes |
|---|---|---|
| Static-IP outbound proxy | One small always-on VM | Supabase's own recommendation. Edge functions keep the logic; the proxy only forwards. Smallest change to the architecture. |
| Move marketplace polling to a VM/container | A deployment target we do not have | Heavier, but removes the proxy hop and gives a natural home for scheduled pulls. |
| Self-host the edge runtime | Most operational load | Supabase lists it; unjustified at our size. |

Note the asymmetry: **inbound** callbacks (the OAuth redirect, webhooks) are
fine on edge functions — the allowlist governs outbound calls carrying the
app key. So the redirect URL already saved in TikTok does not need to move.

## 4. What Nadeem must do (owner checklist)

### Immediately — TikTok, to clear the launch checklist

- [ ] **Target sellers** — Malaysia / local sellers shows "1 to complete".
  Finish that configuration.
- [ ] **Partner registration review** — complete contact and business
  information, then submit.
- [ ] **Listing review** — Distribution at Service Market → Malaysia →
  English listing. This is the public-facing description of Fullkit OS and
  is the same copy the marketing page needs, so write it once.
- [ ] **App review** — do not submit yet. It says "We will review and test
  app functionality", and the saved Redirect URL currently resolves to
  nothing. See §5 W6a.
- [ ] **Widget** — skip unless we intend to publish a seller-facing widget.
- [ ] **IP allowlist** — leave off until §3 is decided.

### Immediately — Shopee, because it is the long pole

- [ ] **Commission the penetration test.** Black-box, against the externally
  exposed surface. Start scoping now; everything else on Shopee waits behind
  it. Note the report must be uploaded from the **developer account owner** —
  member accounts cannot upload it.
- [ ] Decide the testing scope with the vendor: the public marketing page,
  the demo instance, the Fullkit app domain, and the Supabase edge functions
  are all externally exposed. Scope determines both price and how much
  remediation we inherit.
- [ ] Create the Shopee partner account and app so the Go Live form (and its
  IP allowlist field) is visible.

### Entity and credentials

- [ ] **Resolve the entity question.** TikTok's account is held by **Teroka
  Digital**, not EFFEN International Sdn Bhd. Decide which entity holds
  marketplace platform accounts and register Shopee consistently — the two
  applications describing different companies operating the same shops is
  the kind of inconsistency reviewers query. ADR-0009 records this as a
  custodianship question; it now needs an answer.
- [ ] **App key and secret go into Supabase Vault**, never `.env`, never the
  repo. The key was visible in a shared screenshot; a key alone is not
  sensitive (it identifies, it does not authorise), but rotate the **secret**
  if it was ever shown.

### Domain

- [ ] **Name the domain.** Still unresolved, and now blocking more than the
  marketing page: the pen test scope and the Shopee listing both want a
  stable public address.
- [ ] ⚠ Before pointing a custom domain at Vercel: `effen-os` has Deployment
  Protection set to `all_except_custom_domains`. Attaching a domain removes
  the SSO wall fronting `effen-os.vercel.app`. Set
  `NEXT_PUBLIC_FULLKIT_AUTH=required` first, and expect that domain to be in
  the pen test scope.

## 5. Build sequence (repo-side)

- [x] **W0 — Docs.** This register and ADR-0009.
- [x] **W1 — Seed hygiene and demo clock.** Demo identity overlay and a
  rolling seed epoch, enforced by a leak scan in `check:seed`.
- [ ] **W2 — Demo deployment target.** Separate Vercel project on a `demo`
  branch. `isDemoMode()` and the `next.config.ts` guard are done; the Vercel
  project is not.
- [ ] **W3 — Reviewer login.** `middleware.ts` and `/api/demo-login`.
- [ ] **W4 — Seed-backed reads.** Split `live.ts`; Tier 1 is Orders,
  Customers and the top bar.
- [ ] **W5 — Domain and public page.**
- [ ] **W6a — TikTok OAuth callback.** `tiktok-oauth` edge function, per-shop
  token storage, and enough of an authorised call to demonstrate function.
  **This moved ahead of submission** — TikTok tests the app during review.
- [ ] **Submit TikTok for app review.**
- [ ] **W6b — Static egress decision (§3)**, needed before any Shopee call
  that carries the app key.
- [ ] **W6c — Shopee connector**, masked-data Phase 1.
- [ ] **Shopee Go Live** with the IP allowlist populated.
- [ ] **Sensitive-data unmasking** once the pen test clears; only then does
  marketplace customer identity resolution become buildable.

## 6. Connector shape

Reuse the existing patterns:

- **Credentials** follow the Vault pattern — `integration_connections` holds
  a `secret_ref` into `vault.secrets`, never the credential. Paired
  `set_*_connection` (hq_admin gated, `authenticated`) and `get_*_secrets`
  (`service_role` only). Model on
  `supabase/migrations/20260724090514_woo_connect_rpcs.sql`.
- **`integration_connections.category`** already permits `'marketplace'`.
- **Per-shop tokens.** Each shop authorises separately and yields its own
  refreshable token. Follow `public.nv_tokens` (RLS on, zero policies,
  service-role only) but key by connection, not by provider.
- **Callbacks** are inbound and stay on edge functions: `tiktok-oauth` and
  `shopee-oauth`, shaped like `nv-webhook` (`verify_jwt = false`,
  signature-verified), exchanging the code server-side then redirecting to
  `/integrations`.
- **Outbound calls** must leave from a declared IP once allowlisting is on
  (§3).
- **Order mirror** targets `orders_read`, which already carries
  `unique (integration_id, source_order_id)`.
- **Identity** is blocked on unmasking (§2.2). Ingest and store the masked
  values with provenance; do not invent a resolver against masked input.

## 7. Application state

| Platform | Account | App | Submitted | Sensitive data | Connector |
|---|---|---|---|---|---|
| TikTok Shop | ISV approved (Teroka Digital) | Draft | No | n/a | Not built |
| Shopee | In progress | Not created | No | Blocked on pen test | Not built |

Update on every state change. This is the only place the approval position
is recorded.

## Sources

- Shopee Open Platform, *Requesting Access to Sensitive Data*
  (`open.shopee.com/developer-guide/718`), last updated 2026-08-04, read
  2026-08-21.
- TikTok Shop Partner Center, app `Fullkit OS` detail page, read 2026-08-21.
- Supabase, *Why Supabase Edge Functions cannot provide static egress IPs
  for allow listing*.
- `docs/PRD.md` §"Risks & Open Questions" item 5 (approval lead time).
