# Supabase advisor register

**Last sweep: 2026-08-02.** Run the security + performance advisors after
every migration; update this register when a finding is fixed or an
acceptance changes. Findings not listed here should be treated as new.

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
