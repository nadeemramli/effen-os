-- private.latest_address must be inlinable so each export row is a plain
-- index probe on orders_read_identity_expr_idx, not a per-row Function Scan.
-- Postgres refuses to inline a SQL function that carries a SET clause, so
-- the search_path pin comes off: the body is fully schema-qualified, the
-- function is INVOKER, lives in `private` (no API exposure), and is only
-- called from SECURITY DEFINER RPCs that pin search_path themselves.
-- Measured: Function Scan ≈2.9ms/row vs inlined probe ≈0.02ms/row warm.
-- Remaining cost is cold random heap I/O on orders_read (~3ms/identity for
-- repeat buyers); a (identity_key, placed_at desc) index or address columns
-- on private.customers_read would remove it — deferred, see ADR-0007.
-- Advisor lint 0011 (function_search_path_mutable) will flag it — accepted,
-- see docs/ops/supabase-advisor-register.md.
create or replace function private.latest_address(p_identity_key text)
returns table (
  name text, phone text,
  address_1 text, address_2 text, city text, state text,
  postcode text, country text, order_number text, placed_at timestamptz,
  corrected boolean
)
language sql
stable
as $$
  select
    coalesce(oc.corrected->>'name', r.customer->>'name'),
    coalesce(oc.corrected->>'phone', r.customer->>'phone'),
    coalesce(oc.corrected->>'address_1',
      nullif(r.raw->'shipping'->>'address_1', ''), r.raw->'billing'->>'address_1'),
    coalesce(nullif(r.raw->'shipping'->>'address_2', ''), r.raw->'billing'->>'address_2'),
    coalesce(oc.corrected->>'city', nullif(r.raw->'shipping'->>'city', ''), r.customer->>'city'),
    coalesce(nullif(r.raw->'shipping'->>'state', ''), r.raw->'billing'->>'state'),
    coalesce(oc.corrected->>'postcode',
      nullif(r.raw->'shipping'->>'postcode', ''), r.customer->>'postcode'),
    coalesce(nullif(r.raw->'shipping'->>'country', ''), r.customer->>'country'),
    r.order_number,
    r.placed_at,
    (oc.id is not null)
  from (
    -- Pick the newest order id first (heap columns only), then detoast `raw`
    -- for that single row — not for every order the identity ever placed.
    select r0.id
    from public.orders_read r0
    where public.identity_key(r0.customer, r0.raw) = p_identity_key
    order by r0.placed_at desc
    limit 1
  ) pick
  join public.orders_read r on r.id = pick.id
  left join public.order_corrections oc
    on oc.order_read_id = r.id and oc.status in ('staged','applied')
$$;
alter function private.latest_address(text) reset search_path;
revoke all on function private.latest_address(text) from public, anon, authenticated;
