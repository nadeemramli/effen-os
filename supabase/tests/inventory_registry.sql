-- Inventory / marketplace registry invariants (Phase 7). Read-only; every SELECT must return ok = true.

-- 1. One approved pack configuration per variant at most.
select 'single_approved_pack' as test, count(*) = 0 as ok
from (select variant_id from public.product_pack_configurations where status = 'approved' group by variant_id having count(*) > 1) x;

-- 2. Finished-good items mirror active variants 1:1 (S3 migration rule).
select 'finished_goods_mirror_variants' as test,
  (select count(*) from public.product_variants where status = 'active') = (select count(*) from public.inventory_items where item_type = 'finished_good') as ok;

-- 3. No stock authority exists yet: no levels or movement tables under public/private (nothing can move stock from inference).
select 'no_movement_tables' as test, count(*) = 0 as ok
from information_schema.tables where table_schema in ('public', 'private') and table_name in ('inventory_movements', 'inventory_levels', 'inventory_reservations');

-- 4. ADR-0009: no marketplace account is beyond shadow.
select 'read_scopes_only' as test, count(*) = 0 as ok from public.marketplace_accounts where cutover_mode in ('pilot_write', 'live');

-- 5. Mapped listings always resolve to a finished-good item.
select 'mapped_listings_have_item' as test, count(*) = 0 as ok from public.marketplace_listings where mapping_status = 'mapped' and (variant_id is null or inventory_item_id is null);

-- 6. Observations are idempotent by provider message id and never carry a resulting stock event.
select 'observations_idempotent' as test, count(*) = count(distinct (provider, message_ref)) as ok from public.wa_observations;
select 'observations_no_stock_event' as test, count(*) = 0 as ok from public.wa_observations where resulting_event_id is not null;
