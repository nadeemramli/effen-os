-- Brand-filtered Orders timed out: "canceling statement due to statement timeout".
--
-- The Orders surface filters orders_read by brand and asks PostgREST for an
-- exact count, under an RLS policy that tests workspace_id. The existing
-- (brand_id, placed_at desc) index carried neither workspace_id nor this
-- query's NULLS LAST / id tiebreak ordering, so both halves fell apart:
--
--   count -> index scan on brand_id, then a heap visit for every matching row
--            purely to read workspace_id for the RLS test. 46,515 rows,
--            15,507 blocks off disk, 9.5 s against an 8 s statement_timeout.
--   page  -> the planner preferred the placed_at index and filtered brand
--            inline, discarding 211,938 rows to reach 50. 33 s.
--
-- One index answers both. brand_id leads, followed by the exact ORDER BY keys
-- so the page walks the index and stops at 50; workspace_id rides along as an
-- INCLUDE payload, which satisfies the RLS test straight from the index tuple
-- (Heap Fetches: 0). Making workspace_id a key column instead would sit
-- between brand_id and placed_at and destroy the sort order the page needs --
-- measured at 33 s, so the column order here is load-bearing.
--
--   count  9,540 ms -> 41 ms        page  33,374 ms -> 1.1 ms
--
-- Index-only scans need the visibility map, which autovacuum maintains; a
-- freshly bulk-loaded table wants a manual VACUUM ANALYZE to get there (it
-- cannot run inside this migration's transaction).
--
-- Unfiltered Orders was never affected and still uses
-- orders_read_placed_nulls_last_id_idx.

create index if not exists orders_read_brand_placed_id_ws_idx
  on public.orders_read (brand_id, placed_at desc nulls last, id desc)
  include (workspace_id);
