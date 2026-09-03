# Supabase advisor register

**Last sweep: 2026-08-25** (Phase 8 hardening, after migrations
`20260824190819` → `20260825075212`). Run the security + performance
advisors after every migration; update this register when a finding is
fixed or an acceptance changes. Findings not listed here should be treated
as new.

## Sweep 2026-08-25 — findings and disposition

Security: 73 lints — 66× WARN `authenticated_security_definer_function_executable`,
2× WARN `anon_security_definer_function_executable`, 4× WARN
`function_search_path_mutable`, 1× INFO `rls_enabled_no_policy`.
Performance: 99 lints — 28× INFO unindexed FK, 68× INFO unused index, 2×
INFO no primary key, 1× INFO auth connections.

| Finding | Disposition |
|---|---|
| 66× authenticated-executable SECURITY DEFINER RPCs (every `live_*`, `qc_*`, `awb_*`, `create_/close_*`, `save_/approve_*`, `set_*`, `map_*`, `review_*` added by the program) | **Accepted — same shape as the 2026-08-02 acceptance below**: `SET search_path = ''`, first-line membership / `private.has_role` gate, EXECUTE only to `authenticated` + `service_role`. Re-verified 2026-08-25 by the Phase 8 role matrix (`sales_cs`, `operations`, `finance`, `analyst`, `marketing_growth`): reads member-gated, every write role-gated, direct table writes denied. |
| 2× anon-executable SECURITY DEFINER: `nv_events_rts_rollup()`, `nv_shipments_link_trigger()` | **Fixed** in `customer_lifecycle_contract_v8`: EXECUTE revoked from `public`, `anon`, `authenticated`. Both return `trigger`, so PostgREST could not have invoked them anyway; the revoke removes the lint and the ambiguity. |
| 4× mutable search_path: `public.norm_phone`, `public.norm_address`, `public.identity_key`, `private.latest_address` | **Accepted, pre-existing** (see 2026-08-02 note on `latest_address`). `identity_key` backs an expression index on `orders_read`; altering its config is deferred to a dedicated change with a reindex plan. |
| 1× RLS enabled, no policy: `public.nv_tokens` | **Accepted** — carrier tokens are read/written only by the edge functions (`service_role`); no browser role may see this table, so "no policy" is the intended deny-all. |
| 28× unindexed FKs — mostly `workspace_id` on the new small registry tables (`fulfilment_state_events`, `inventory_items`, `customer_lifecycle_policy`, …) | **Accepted until review 2026-09-15**: single-workspace tables of tens to hundreds of rows; the FK column is never a join key on a hot path. Add covering indexes only if a plan shows a seq scan on them. |
| 68× unused indexes (incl. every index created by the program) | **Expected** — created in the last 36 hours; usage stats are empty. Review 2026-09-15 with the 2026-09-01 items below. |

## Fixed (migration `20260802000002_advisor_mitigations`)

| Finding | Fix |
|---|---|
| 40× unindexed foreign keys (lint 0001) | Covering index per flagged FK column |
| `memberships.user_id` FK + RLS hot path | `memberships_user_status_ws_idx (user_id, status) include (workspace_id)` — the member_read policies probe this on every request; now index-only |
| `membership_invites` RLS enabled, no policies (lint 0008) | Explicit `admin_read` / `admin_delete` policies for `hq_admin`; creation/claiming stay behind SECURITY DEFINER functions |

Earlier related fix: `20260802000001_rls_fastpath` replaced per-row
`private.is_workspace_member()` calls in the `member_read` policies with a
hashed semi-join after statement timeouts on `orders_read` (121k rows).

## Accepted — by design (re-verify when touching these functions)

**7× WARN “Signed-in users can execute SECURITY DEFINER function”**
(`live_customers`, `live_customer_detail`, `save_order_correction`,
`map_wa_number`, `set_woo_connection`, `set_nv_connection`,
`set_wa_connection`; since 2026-08-17 also `live_customers_export` and
`live_customer_addresses`, same shape and gate as `live_customers`).

The linter cannot see inside a function; these are intentional. Verified
2026-08-02, and required for any future function of this shape:

- `SET search_path = ''` on every function.
- Internal gate on the first line: workspace membership for read RPCs,
  `private.has_role(..., '{hq_admin}')` for secret-writers,
  `hq_admin|operations` for `save_order_correction`.
- EXECUTE granted to `authenticated` + `service_role` only — `anon` and
  `PUBLIC` are revoked (verified via `has_function_privilege`).
- DEFINER is the point: they read `private.*` objects (e.g. the
  `customers_read` materialized view, which cannot carry RLS) or write
  Vault secrets. INVOKER would break them, and direct table grants would
  be worse.

Caveat recorded: `live_customers` / `live_customers_export` / `live_customer_detail` gate on
membership of the *first* workspace (`min(id)`). Correct while Fullkit is
single-workspace; must be re-scoped if a second workspace is ever created.

**1× WARN “Function Search Path Mutable” — `private.latest_address(text)`**
(2026-08-17). Deliberate: Postgres will not inline a SQL function that
carries a `SET` clause, and this helper must inline so each CSV export
row is a plain probe on `orders_read_identity_expr_idx` (Function Scan
≈2.9ms/row vs inlined ≈0.02ms/row warm). It is INVOKER, fully
schema-qualified, lives in `private` (not API-exposed, EXECUTE revoked
from `anon`/`authenticated`), and is only called from SECURITY DEFINER
RPCs that pin `search_path = ''` themselves. Re-verify if it ever moves
to `public` or gains a grant.

## Accepted — review by 2026-09-01

**3× unused indexes (lint 0005):** `wa_conversations_last_idx` (WhatsApp
not connected yet), `nv_shipments_last_event_idx`, `ad_daily_facts_date_idx`
(120 rows; seq scan wins). Usage stats are days old — too early to drop.
If still zero scans at review time, drop them. The FK covering indexes
added above will appear in this lint too until traffic grows into them;
same review date applies.

## User-action items (dashboard; cannot be done via SQL)

- [ ] Auth → Passwords → enable **leaked-password protection**
      (HaveIBeenPwned check). Clears the remaining security WARN.
- [ ] Auth → switch DB connection allocation from **fixed 10** to
      **percentage-based**, so Auth scales with any future instance resize.
- [ ] Auth → Emails: paste the branded templates and enable the security
      notifications, email confirmation and secure email change — full
      checklist in [`email-templates/README.md`](email-templates/README.md)
      (added 2026-08-28, after Resend custom SMTP went live).
