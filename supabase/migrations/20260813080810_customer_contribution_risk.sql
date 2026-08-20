-- Customer 360: light up the Contribution LTV and COD/return risk cards.
--
-- live_customer_detail gains two sibling keys next to profile/orders:
--
--   contribution — variable-cost rollup over ALL recognized orders of the
--     identity (the order timeline stays capped at 100; these aggregates are
--     not). Same cost model as live_contribution_range (contribution_cost_rules:
--     unit COGS × base units via variant_aliases/product_variants, delivery by
--     zone from postcode, COD fee), with one upgrade: fighter-era orders carry
--     their ACTUAL per-order costs in raw->'_fighter' (cost, shipping_charge,
--     cod_charge) and those take precedence over the modeled rates. Costs are
--     MYR (the rules sheet is MYR); revenue stays by currency and the frontend
--     converts with FX_TO_MYR. Return legs are omitted at customer level —
--     nv_shipments can't join to orders (Fighter refs), and refunded orders
--     already drop out of recognized revenue.
--
--   risk — status × payment split over ALL orders of the identity, so the UI
--     can show COD share and return rate. 'refunded' means the parcel came
--     back (fighter 'Returned' mapped there); cancelled/failed never shipped.
--
-- Both are computed from orders_read via the identity expression index, so
-- the two extra aggregate scans stay per-customer cheap.

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
  v_siblings jsonb := '[]'::jsonb;
  v_wa bigint;
  v_contribution jsonb;
  v_risk jsonb;
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
    where public.identity_key(r.customer, r.raw) = p_identity_key
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
    'postcode', coalesce(oc.corrected->>'postcode',
      nullif(r.raw->'shipping'->>'postcode', ''), r.customer->>'postcode'),
    'country', coalesce(nullif(r.raw->'shipping'->>'country', ''), r.customer->>'country'),
    'order_number', r.order_number,
    'placed_at', r.placed_at,
    'corrected', (oc.id is not null)
  ) into v_address
  from public.orders_read r
  left join public.order_corrections oc
    on oc.order_read_id = r.id and oc.status in ('staged','applied')
  where public.identity_key(r.customer, r.raw) = p_identity_key
  order by r.placed_at desc
  limit 1;

  -- Address siblings: other profiles whose latest order ships to the same
  -- normalized address. A reseller / drop-point signal — never a merge.
  if v_profile->>'address_key' is not null then
    select coalesce(jsonb_agg(s), '[]'::jsonb) into v_siblings
    from (
      select c2.identity_key, c2.display_name, c2.total_orders, c2.revenue_total,
             c2.classification, c2.last_order_at
      from private.customers_read c2
      where c2.address_key = v_profile->>'address_key'
        and c2.identity_key <> p_identity_key
      order by c2.total_orders desc, c2.last_order_at desc nulls last
      limit 20
    ) s;
  end if;

  select count(*) into v_wa
  from public.wa_conversations wc
  where public.norm_phone(wc.wa_contact) = p_identity_key;

  -- COD share and return rate over every order of the identity.
  select jsonb_build_object(
    'total_orders', count(*),
    'cod_orders', count(*) filter (where o.raw->>'payment_method' = 'cod'),
    'returned_orders', count(*) filter (where o.source_status = 'refunded'),
    'cancelled_orders', count(*) filter (where o.source_status in ('cancelled', 'failed')),
    'cod_returned_orders', count(*) filter
      (where o.raw->>'payment_method' = 'cod' and o.source_status = 'refunded')
  ) into v_risk
  from public.orders_read o
  where public.identity_key(o.customer, o.raw) = p_identity_key;

  -- Variable-cost contribution over recognized orders.
  with rules as (
    select * from public.contribution_cost_rules
    order by effective_from desc limit 1
  ),
  recognized as (
    select o.id, o.total, o.currency_code, o.items, o.integration_id,
           (o.raw->>'payment_method' = 'cod') as is_cod,
           coalesce(nullif(ic.config->>'country_code', ''),
                    nullif(o.customer->>'country', '')) as market,
           substring(coalesce(o.customer->>'postcode', '') from 1 for 2) as pc2,
           (o.raw->'_fighter'->>'cost')::numeric as f_cogs,
           (o.raw->'_fighter'->>'shipping_charge')::numeric as f_delivery,
           (o.raw->'_fighter'->>'cod_charge')::numeric as f_cod
    from public.orders_read o
    join public.integration_connections ic on ic.id = o.integration_id
    where public.identity_key(o.customer, o.raw) = p_identity_key
      and o.source_status in ('processing', 'completed')
  ),
  costed as (
    select r.total, r.currency_code,
           coalesce(r.f_cogs,
                    coalesce(u.base_units, 0) * coalesce((select unit_cost_myr from rules), 0)
           ) as cogs_myr,
           coalesce(r.f_delivery,
             case when r.market = 'SG' then coalesce((select delivery_sg_myr from rules), 0)
                  when r.pc2 in ('87','88','89','90','91','93','94','95','96','97','98')
                    then coalesce((select delivery_my_east from rules), 0)
                  else coalesce((select delivery_my_west from rules), 0) end
           ) as delivery_myr,
           case when r.is_cod
                then coalesce(r.f_cod, (select cod_fee from rules), 0)
                else 0 end as cod_myr,
           (r.f_cogs is not null) as actual_cost,
           case when r.f_cogs is null then coalesce(u.unmapped_lines, 0) else 0 end as unmapped_lines
    from recognized r
    left join lateral (
      select sum(it.qty * coalesce(v.units_per_pack, 1)) as base_units,
             count(*) filter (where va.variant_id is null) as unmapped_lines
      from (
        select e->>'sku' as sku, coalesce(nullif(e->>'quantity', '')::numeric, 1) as qty
        from jsonb_array_elements(r.items) e
      ) it
      left join public.variant_aliases va
        on va.integration_id = r.integration_id and va.alias = it.sku
      left join public.product_variants v on v.id = va.variant_id
    ) u on true
  )
  select jsonb_build_object(
    'orders', count(*),
    'revenue_by_currency', coalesce((
      select jsonb_object_agg(x.currency_code, x.rev)
      from (select currency_code, sum(total) as rev from costed group by 1) x
    ), '{}'::jsonb),
    'cogs_myr', round(coalesce(sum(cogs_myr), 0), 2),
    'delivery_myr', round(coalesce(sum(delivery_myr), 0), 2),
    'cod_myr', round(coalesce(sum(cod_myr), 0), 2),
    'actual_cost_orders', count(*) filter (where actual_cost),
    'unmapped_lines', coalesce(sum(unmapped_lines), 0)
  ) into v_contribution
  from costed;

  return jsonb_build_object('profile', v_profile, 'orders', v_orders,
    'address', v_address, 'address_siblings', v_siblings, 'wa_conversations', v_wa,
    'contribution', v_contribution, 'risk', v_risk);
end;
$$;

revoke execute on function public.live_customer_detail(text) from public, anon;
grant execute on function public.live_customer_detail(text) to authenticated;
