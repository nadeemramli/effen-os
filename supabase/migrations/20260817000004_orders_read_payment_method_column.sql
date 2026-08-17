-- Denormalised payment method on orders_read.
--
-- The contribution model needs "is COD" per order. Reading it as
-- raw->>'payment_method' detoasts the whole Woo order blob: 916MB of TOAST
-- for 280k orders on a 256MB-shared_buffers instance, ~5 TOAST pages per
-- order. Measured: live_contribution_range 30d = 6.2s, 1y = 57014 timeout,
-- and Marketing silently swallowed that error (CM cards showed "—").
-- A trigger-maintained column keeps every P&L range query on the heap.
alter table public.orders_read add column if not exists payment_method text;

create or replace function public.orders_read_denorm()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.payment_method := new.raw->>'payment_method';
  return new;
end;
$$;

drop trigger if exists orders_read_denorm_trg on public.orders_read;
create trigger orders_read_denorm_trg
  before insert or update of raw on public.orders_read
  for each row execute function public.orders_read_denorm();

-- Backfill. On prod this ran as 29 batches of 20k ids (~8s each) via the
-- Management API before this statement, so it only sweeps stragglers here;
-- on a fresh DB the table is small and this is instant.
update public.orders_read
set payment_method = raw->>'payment_method'
where payment_method is null and raw ? 'payment_method';
