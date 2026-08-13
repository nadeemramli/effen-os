-- Unify the two cost systems: the Marketing CM model reads
-- contribution_cost_rules (RM7/base unit) while Catalog/Inventory/
-- Command-Centre read variant_costs — which was empty, so COGS showed 0
-- everywhere despite CM computing fine.
--
-- 1) units_per_pack derived from the SKU/name encoding (PK42 = "4+2" = 6,
--    PK31 = 4, PK8/PK9 = 8/9, N/COD suffixes are pricing variants of the
--    same count). Corrects CM/backlog math too — everything counted 1
--    unit per pack until now, understating COGS and backlog.
-- 2) variant_costs backfilled for MYR variants at units_per_pack ×
--    unit_cost_myr from the current cost rules, effective-dated to match.
--    SGD variants are NOT backfilled: costs pair with revenue only in the
--    same currency (house rule), and no governed FX policy exists —
--    Finance sets SGD costs explicitly (Catalog set-cost dialog).
-- Both steps write audit_events (migration-actor) since the RPC path
-- requires an interactive session.

with pack as (
  select id, sku,
    case
      when sku like '%PK42%' then 6
      when sku like '%PK31%' then 4
      when sku like '%PK9%' then 9
      when sku like '%PK8%' then 8
      when sku like '%PK6%' then 6
      when sku like '%PK4' then 4
      when sku like '%PK3%' then 3
      when sku like '%PK2%' then 2
      when sku like '%PK1%' then 1
      else 1
    end as units
  from public.product_variants
)
update public.product_variants v
set units_per_pack = pack.units, updated_at = now()
from pack
where pack.id = v.id and v.units_per_pack is distinct from pack.units;

insert into public.audit_events (workspace_id, actor_label, action, entity_ref, detail)
select v.workspace_id, 'migration-backfill', 'catalog.units_per_pack_set',
       'variant:' || v.sku, 'derived from SKU encoding → ' || v.units_per_pack || ' base units'
from public.product_variants v
where v.units_per_pack > 1;

-- Cost backfill: MYR variants only, from the effective cost rules.
insert into public.variant_costs (workspace_id, variant_id, cost, currency_code, effective_from, note, created_by)
select v.workspace_id, v.id,
       v.units_per_pack * r.unit_cost_myr, 'MYR', r.effective_from,
       'rules-derived: ' || v.units_per_pack || ' units × RM' || r.unit_cost_myr
         || ' (contribution_cost_rules ' || r.effective_from || ')',
       'migration-backfill'
from public.product_variants v
cross join lateral (
  select unit_cost_myr, effective_from from public.contribution_cost_rules
  order by effective_from desc limit 1
) r
where v.currency_code = 'MYR'
on conflict (variant_id, effective_from) do nothing;

insert into public.audit_events (workspace_id, actor_label, action, entity_ref, detail)
select vc.workspace_id, 'migration-backfill', 'catalog.cost_set',
       'variant:' || v.sku, 'RM' || vc.cost || ' (rules-derived)'
from public.variant_costs vc
join public.product_variants v on v.id = vc.variant_id
where vc.created_by = 'migration-backfill';
