-- Supabase advisor mitigations (2026-08-02 sweep).
-- Companion register: docs/ops/supabase-advisor-register.md

-- ── RLS hot path ────────────────────────────────────────────────────────────
-- The member_read policies probe memberships by (user_id, status) on every
-- request; the only existing index led with workspace_id, forcing a full
-- index scan. Covering (workspace_id) makes the probe index-only. Also
-- satisfies the memberships_user_id_fkey covering-index lint.
create index if not exists memberships_user_status_ws_idx
  on public.memberships (user_id, status) include (workspace_id);

-- ── Foreign-key covering indexes (lint 0001) ────────────────────────────────
-- Fact/event tables grow into these; on the small dimension tables they cost
-- ~8 kB each and close the cascade-scan hazard when parent rows are deleted.
create index if not exists ad_accounts_read_brand_id_idx on public.ad_accounts_read (brand_id);
create index if not exists ad_accounts_read_workspace_id_idx on public.ad_accounts_read (workspace_id);
create index if not exists ad_daily_facts_workspace_id_idx on public.ad_daily_facts (workspace_id);
create index if not exists approvals_decided_by_membership_id_idx on public.approvals (decided_by_membership_id);
create index if not exists approvals_workspace_id_idx on public.approvals (workspace_id);
create index if not exists audit_events_actor_membership_id_idx on public.audit_events (actor_membership_id);
create index if not exists audit_events_workspace_id_idx on public.audit_events (workspace_id);
create index if not exists brands_default_legal_entity_id_idx on public.brands (default_legal_entity_id);
create index if not exists brands_workspace_id_idx on public.brands (workspace_id);
create index if not exists comments_author_membership_id_idx on public.comments (author_membership_id);
create index if not exists comments_workspace_id_idx on public.comments (workspace_id);
create index if not exists data_quality_issues_integration_id_idx on public.data_quality_issues (integration_id);
create index if not exists data_quality_issues_owner_membership_id_idx on public.data_quality_issues (owner_membership_id);
create index if not exists data_quality_issues_workspace_id_idx on public.data_quality_issues (workspace_id);
create index if not exists integration_account_mappings_brand_id_idx on public.integration_account_mappings (brand_id);
create index if not exists integration_account_mappings_legal_entity_id_idx on public.integration_account_mappings (legal_entity_id);
create index if not exists integration_account_mappings_owner_membership_id_idx on public.integration_account_mappings (owner_membership_id);
create index if not exists integration_account_mappings_workspace_id_idx on public.integration_account_mappings (workspace_id);
create index if not exists integration_connections_owner_membership_id_idx on public.integration_connections (owner_membership_id);
create index if not exists integration_connections_workspace_id_idx on public.integration_connections (workspace_id);
create index if not exists legal_entities_workspace_id_idx on public.legal_entities (workspace_id);
create index if not exists membership_brand_scopes_brand_id_idx on public.membership_brand_scopes (brand_id);
create index if not exists membership_invites_workspace_id_idx on public.membership_invites (workspace_id);
create index if not exists nv_events_workspace_id_idx on public.nv_events (workspace_id);
create index if not exists nv_shipments_brand_id_idx on public.nv_shipments (brand_id);
create index if not exists order_corrections_workspace_id_idx on public.order_corrections (workspace_id);
create index if not exists products_workspace_id_idx on public.products (workspace_id);
create index if not exists saved_views_user_id_idx on public.saved_views (user_id);
create index if not exists saved_views_workspace_id_idx on public.saved_views (workspace_id);
create index if not exists stores_brand_id_idx on public.stores (brand_id);
create index if not exists stores_legal_entity_id_idx on public.stores (legal_entity_id);
create index if not exists stores_workspace_id_idx on public.stores (workspace_id);
create index if not exists sync_runs_integration_id_idx on public.sync_runs (integration_id);
create index if not exists sync_runs_workspace_id_idx on public.sync_runs (workspace_id);
create index if not exists user_preferences_workspace_id_idx on public.user_preferences (workspace_id);
create index if not exists wa_messages_workspace_id_idx on public.wa_messages (workspace_id);
create index if not exists wa_numbers_brand_id_idx on public.wa_numbers (brand_id);
create index if not exists wa_numbers_workspace_id_idx on public.wa_numbers (workspace_id);
create index if not exists work_items_owner_membership_id_idx on public.work_items (owner_membership_id);
create index if not exists work_items_workspace_id_idx on public.work_items (workspace_id);

-- ── membership_invites: explicit policies (lint 0008) ───────────────────────
-- Was RLS-enabled with zero policies: deny-all by implication. Same effective
-- posture, now stated: HQ admins can see and revoke invites; creation and
-- claiming stay behind SECURITY DEFINER functions / service role.
drop policy if exists admin_read on public.membership_invites;
create policy admin_read on public.membership_invites
  for select to authenticated
  using (private.has_role(workspace_id, array['hq_admin']));

drop policy if exists admin_delete on public.membership_invites;
create policy admin_delete on public.membership_invites
  for delete to authenticated
  using (private.has_role(workspace_id, array['hq_admin']));
