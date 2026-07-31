-- Indexes for the live Orders surface: server-side pagination + filtering
-- over the six-figure orders_read mirror. Brand and workspace paths were
-- covered in 20260724000005; these cover the store, status, and order-number
-- lookups the main Orders page now issues.
create index if not exists orders_read_integration_placed_idx
  on public.orders_read (integration_id, placed_at desc);
create index if not exists orders_read_status_placed_idx
  on public.orders_read (source_status, placed_at desc);
create index if not exists orders_read_order_number_idx
  on public.orders_read (order_number);
