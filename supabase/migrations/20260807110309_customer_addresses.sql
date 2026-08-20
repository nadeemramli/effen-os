-- Customer addresses: (1) live_customer_detail gains an 'address' block —
-- the customer's latest order's shipping/billing address with any staged or
-- applied Fullkit correction overlaid (the OS-fixed value is the truth we
-- show); (2) live_customer_addresses(keys[]) batch-resolves latest
-- addresses for the customer CSV export. Street address comes from the raw
-- Woo payload (billing, shipping fallback); the compact customer JSON only
-- carries name/phone/email/city/postcode/country.

create or replace function public.live_customer_detail(p_identity_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile jsonb;
  v_orders jsonb;
  v_address jsonb;
  v_wa bigint;
begin
  if not private.is_workspace_member((select min(id) from public.workspaces)) then
    raise exception 'Not a workspace member';
  end if;

  select to_jsonb(c) into v_profile from private.customers_read c where c.identity_key = p_identity_key;
  if v_profile is null then
    return null;
  end if;

  select coalesce(jsonb_agg(o order by o.placed_at desc), '[]'::jsonb) into v_orders
  from (
    select r.id, r.integration_id, r.brand_id, r.order_number, r.source_order_id,
           r.source_status, r.currency_code, r.total, r.items, r.placed_at
    from public.orders_read r
    where coalesce(
        nullif(regexp_replace(coalesce(r.customer->>'phone', ''), '[^0-9]', '', 'g'), ''),
        nullif(lower(coalesce(r.customer->>'email', '')), '')
      ) = p_identity_key
    order by r.placed_at desc
    limit 100
  ) o;

  -- Latest order's address, correction-overlaid (staged/applied fixes win).
  select jsonb_build_object(
    'name', coalesce(oc.corrected->>'name', r.customer->>'name'),
    'phone', coalesce(oc.corrected->>'phone', r.customer->>'phone'),
    'address_1', coalesce(oc.corrected->>'address_1',
      nullif(r.raw->'shipping'->>'address_1', ''), r.raw->'billing'->>'address_1'),
    'address_2', coalesce(nullif(r.raw->'shipping'->>'address_2', ''), r.raw->'billing'->>'address_2'),
    'city', coalesce(oc.corrected->>'city', nullif(r.raw->'shipping'->>'city', ''), r.customer->>'city'),
    'state', coalesce(nullif(r.raw->'shipping'->>'state', ''), r.raw->'billing'->>'state'),
    'postcode', coalesce(oc.corrected->>'postcode', r.customer->>'postcode'),
    'country', r.customer->>'country',
    'order_number', r.order_number,
    'placed_at', r.placed_at,
    'corrected', (oc.id is not null)
  ) into v_address
  from public.orders_read r
  left join public.order_corrections oc
    on oc.order_read_id = r.id and oc.status in ('staged','applied')
  where coalesce(
      nullif(regexp_replace(coalesce(r.customer->>'phone', ''), '[^0-9]', '', 'g'), ''),
      nullif(lower(coalesce(r.customer->>'email', '')), '')
    ) = p_identity_key
  order by r.placed_at desc
  limit 1;

  select count(*) into v_wa
  from public.wa_conversations wc
  where regexp_replace(wc.wa_contact, '[^0-9]', '', 'g') = p_identity_key;

  return jsonb_build_object('profile', v_profile, 'orders', v_orders,
    'address', v_address, 'wa_conversations', v_wa);
end;
$$;

-- Batch latest-address resolution for CSV export. One row per requested
-- identity that has at least one order; correction overlay identical to the
-- detail view. Capped at 20k identities per call.
create or replace function public.live_customer_addresses(p_identity_keys text[])
returns table (
  identity_key text, name text, phone text,
  address_1 text, address_2 text, city text, state text,
  postcode text, country text, order_number text, placed_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_workspace_member((select min(id) from public.workspaces)) then
    raise exception 'Not a workspace member';
  end if;
  if p_identity_keys is null or array_length(p_identity_keys, 1) is null then
    return;
  end if;
  if array_length(p_identity_keys, 1) > 20000 then
    raise exception 'Too many identities in one export (max 20,000)';
  end if;

  return query
  select distinct on (ik.identity_key)
    ik.identity_key,
    coalesce(oc.corrected->>'name', r.customer->>'name'),
    coalesce(oc.corrected->>'phone', r.customer->>'phone'),
    coalesce(oc.corrected->>'address_1',
      nullif(r.raw->'shipping'->>'address_1', ''), r.raw->'billing'->>'address_1'),
    coalesce(nullif(r.raw->'shipping'->>'address_2', ''), r.raw->'billing'->>'address_2'),
    coalesce(oc.corrected->>'city', nullif(r.raw->'shipping'->>'city', ''), r.customer->>'city'),
    coalesce(nullif(r.raw->'shipping'->>'state', ''), r.raw->'billing'->>'state'),
    coalesce(oc.corrected->>'postcode', r.customer->>'postcode'),
    r.customer->>'country',
    r.order_number,
    r.placed_at
  from public.orders_read r
  cross join lateral (
    select coalesce(
      nullif(regexp_replace(coalesce(r.customer->>'phone', ''), '[^0-9]', '', 'g'), ''),
      nullif(lower(coalesce(r.customer->>'email', '')), '')
    ) as identity_key
  ) ik
  left join public.order_corrections oc
    on oc.order_read_id = r.id and oc.status in ('staged','applied')
  where ik.identity_key = any(p_identity_keys)
  order by ik.identity_key, r.placed_at desc;
end;
$$;

revoke execute on function public.live_customer_detail(text) from public, anon;
grant execute on function public.live_customer_detail(text) to authenticated;
revoke all on function public.live_customer_addresses(text[]) from public, anon;
grant execute on function public.live_customer_addresses(text[]) to authenticated, service_role;
