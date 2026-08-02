-- RLS fast path. The member_read policies called
-- private.is_workspace_member(workspace_id) — a SECURITY DEFINER function the
-- planner cannot inline, so it ran once per candidate row. On orders_read
-- (121k rows) a single page load burned ~3s per scan and the exact count
-- pushed past the 8s statement timeout → PostgREST 500 on the Orders screen.
--
-- Same semantics, planner-friendly shape: an IN (subquery) semi-join that
-- Postgres evaluates once per statement as a hashed subplan. The subquery is
-- the function body verbatim (active membership for auth.uid()); memberships'
-- own RLS exposes exactly those rows, so visibility is unchanged.
-- private.is_workspace_member itself stays — RPC gates still use it, where it
-- runs once per call, which is what it is good at.

do $$
declare
  t text;
begin
  foreach t in array array[
    'ad_accounts_read','ad_daily_facts','approvals','audit_events','brands',
    'comments','data_quality_issues','integration_account_mappings',
    'integration_connections','legal_entities','metric_definitions','nv_events',
    'nv_shipments','order_corrections','orders_read','product_variants',
    'products','stores','sync_runs','wa_conversations','wa_messages',
    'wa_numbers','work_items'
  ] loop
    execute format('drop policy if exists member_read on public.%I', t);
    execute format($p$
      create policy member_read on public.%I
        for select to authenticated
        using (workspace_id in (
          select m.workspace_id
          from public.memberships m
          where m.user_id = (select auth.uid())
            and m.status = 'active'
        ))
    $p$, t);
  end loop;
end $$;

-- The Orders list sorts by (placed_at desc, id desc); give it the exact index
-- so the first page is an index walk instead of a 121k-row top-N sort.
create index if not exists orders_read_placed_id_idx
  on public.orders_read (placed_at desc, id desc);
