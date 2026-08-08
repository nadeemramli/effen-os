-- Address-based identity + reseller detection via address clustering.
--
-- Identity priority becomes: canonical phone digits → normalized-address key
-- ('a:'||md5(...)) → lowercased email. Phone canonicalization is new too:
-- local-format MY/SG numbers ('0123456789') and country-prefixed ones
-- ('60123456789') now converge on one canonical digit string, which also
-- makes the wa_conversations E.164 join match orders stored with local
-- numbers. Market is inferred from the digits themselves — the identity
-- expression must stay IMMUTABLE for the orders_read expression index, so
-- no integration_connections config lookup is allowed here.
--
-- Linking layer: identities whose latest gate-passing address normalizes to
-- the same key form an "address cluster" (shared_address_count). Clusters
-- surface reseller candidates — resellers rotate phones/emails but ship to
-- one address — and are exposed as siblings on the customer detail; they
-- NEVER hard-merge profiles (a household is not one customer).
-- classification gains: shared_address_count >= 3 → reseller (2 is usually
-- a household; the raw count is a filterable column so the threshold can be
-- second-guessed without a migration).
--
-- Index-compatibility tradeoff: identity_key(customer, raw) reads only
-- orders_read columns, so order_corrections can NOT re-key an identity
-- (corrections live in another table — illegal in an expression index, and
-- MV identity must equal the index expression or order-history lookups lose
-- the fast path). Corrections DO feed the cluster address key, which is
-- computed at MV time.
--
-- Known accepted breakage: /customers/<key> URLs change wherever a phone
-- canonicalizes differently or an email-keyed guest gains an address key.

-- ── Normalization functions ─────────────────────────────────────────────────

-- Canonical phone digits (no '+'; URL-safe, matches digit-stripped E.164).
-- SG checked first; the patterns cannot overlap (SG needs [89] after an
-- optional 65, MY needs 1 after an optional 60/0). Unmatched numbers fall
-- back to the raw digit strip so no order that had a phone identity loses it.
-- MY strip is '^(60)?0?' — ship_readiness's '^(60|0)' mishandles '600…'.
create or replace function public.norm_phone(p text)
returns text
language sql immutable parallel safe
as $$
  select case
    when d ~ '^(65)?[89][0-9]{7}$'   then '65' || right(d, 8)
    when d ~ '^(60)?0?1[0-9]{8,9}$'  then '60' || regexp_replace(d, '^(60)?0?', '')
    else nullif(d, '')
  end
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) s
$$;

-- Normalized MY/SG free-text address. Inputs are already precedence-resolved
-- by the caller (correction ?? shipping ?? billing). Lowercase, punctuation
-- to space, word-boundary abbreviation canonicalization, whitespace collapse,
-- postcode digits appended as the strong disambiguator. Digits are never
-- dropped — unit numbers survive, which is what keeps condo/office blocks
-- from over-clustering. Quality gate reuses the ship_readiness
-- address_incomplete rule (>= 10 chars AND contains a digit); below it the
-- address never participates in identity or clustering.
create or replace function public.norm_address(
  p_addr1 text, p_addr2 text, p_city text, p_postcode text
) returns text
language sql immutable parallel safe
as $$
  select case
    when length(street) >= 10 and street ~ '[0-9]'
      then trim(street || ' ' || regexp_replace(coalesce(p_postcode, ''), '[^0-9]', '', 'g'))
  end
  from (
    select trim(regexp_replace(regexp_replace(
      regexp_replace(regexp_replace(regexp_replace(regexp_replace(
      regexp_replace(regexp_replace(regexp_replace(regexp_replace(
        regexp_replace(lower(concat_ws(' ', p_addr1, p_addr2, p_city)), '[^a-z0-9]+', ' ', 'g'),
        '\mjln\M', 'jalan', 'g'),
        '\mtmn\M', 'taman', 'g'),
        '\mlrg\M', 'lorong', 'g'),
        '\m(kg|kpg)\M', 'kampung', 'g'),
        '\m(blk|block)\M', 'blok', 'g'),
        '\mpsn\M', 'persiaran', 'g'),
        '\mapt\M', 'apartment', 'g'),
        '\mkondo\M', 'kondominium', 'g'),
      '\mno ([0-9])', '\1', 'g'),
      '\s+', ' ', 'g')) as street
  ) s
$$;

-- THE identity expression, defined once (previously inlined 8×). IMMUTABLE
-- composition over orders_read columns only — index-compatible.
-- 'a:'||md5(NULL) is NULL, so a gate-failing address falls through to email.
create or replace function public.identity_key(p_customer jsonb, p_raw jsonb)
returns text
language sql immutable parallel safe
as $$
  select coalesce(
    public.norm_phone(p_customer->>'phone'),
    'a:' || md5(public.norm_address(
      coalesce(nullif(p_raw->'shipping'->>'address_1', ''), p_raw->'billing'->>'address_1'),
      coalesce(nullif(p_raw->'shipping'->>'address_2', ''), p_raw->'billing'->>'address_2'),
      coalesce(nullif(p_raw->'shipping'->>'city', ''), p_customer->>'city'),
      coalesce(nullif(p_raw->'shipping'->>'postcode', ''), p_customer->>'postcode')
    )),
    nullif(lower(coalesce(p_customer->>'email', '')), '')
  )
$$;

-- ── Expression index swap ───────────────────────────────────────────────────
-- Plain CREATE INDEX (transactional); the brief SHARE lock on this small
-- mirror table is acceptable.

drop index if exists public.orders_read_identity_expr_idx;
create index orders_read_identity_expr_idx
  on public.orders_read (public.identity_key(customer, raw));

-- ── Rebuild the identity read-model ─────────────────────────────────────────
-- Diff vs 20260804000002: identity via public.identity_key(); per-order
-- cluster key (correction-overlaid address, same precedence as
-- live_customer_addresses); per-identity address = latest order's
-- gate-passing address (matches the address the UI displays); cluster size
-- as a window count (CASE-guarded so address-less identities don't form one
-- giant NULL cluster); reseller classification gains the cluster rule.

drop materialized view if exists private.customers_read;
create materialized view private.customers_read as
with base as (
  select o.workspace_id,
    public.identity_key(o.customer, o.raw) as identity_key,
    nullif(o.customer->>'name', '') as name,
    nullif(o.customer->>'phone', '') as phone,
    nullif(lower(o.customer->>'email'), '') as email,
    nullif(o.customer->>'city', '') as city,
    nullif(o.customer->>'country', '') as country,
    o.brand_id,
    o.currency_code,
    o.total::numeric as total,
    o.source_status,
    o.placed_at,
    (o.raw->>'payment_method' = 'cod') as is_cod,
    (
      coalesce(o.customer->>'name', '') ~* '\mtest(ing|er)?\M'
      or coalesce(o.raw->'billing'->>'address_1', '') ~* '\mtest(ing|er)?\M'
      or (nullif(trim(coalesce(o.customer->>'name', '')), '') is not null
          and lower(trim(o.customer->>'name')) = lower(trim(coalesce(o.raw->'billing'->>'address_1', ''))))
      or coalesce(o.customer->>'name', '') ~* 'asdf|qwer|zxcv|sdfg|wert|xcvb'
      or coalesce(o.raw->'billing'->>'address_1', '') ~* 'asdf|qwer|zxcv|sdfg|wert|xcvb'
      or coalesce(o.customer->>'name', '') ~* '([a-z])\1\1\1'
      or coalesce(o.customer->>'email', '') ~* '(^test@|@(test|example|mailinator)\.)'
      or regexp_replace(coalesce(o.customer->>'phone', ''), '[^0-9]', '', 'g') ~ '(\d)\1{6,}'
    ) as suspect,
    case when an.addr_norm is not null then 'a:' || md5(an.addr_norm) end as order_address_key
  from public.orders_read o
  left join public.order_corrections oc
    on oc.order_read_id = o.id and oc.status in ('staged', 'applied')
  cross join lateral (
    select public.norm_address(
      coalesce(oc.corrected->>'address_1', nullif(o.raw->'shipping'->>'address_1', ''), o.raw->'billing'->>'address_1'),
      coalesce(nullif(o.raw->'shipping'->>'address_2', ''), o.raw->'billing'->>'address_2'),
      coalesce(oc.corrected->>'city', nullif(o.raw->'shipping'->>'city', ''), o.customer->>'city'),
      coalesce(oc.corrected->>'postcode', nullif(o.raw->'shipping'->>'postcode', ''), o.customer->>'postcode')
    ) as addr_norm
  ) an
  where o.customer is not null
),
keyed as (
  select * from base where identity_key is not null
),
per_ccy as (
  select identity_key, currency_code,
         sum(total) filter (where source_status in ('processing', 'completed')) as revenue
  from keyed
  group by identity_key, currency_code
),
ccy_agg as (
  select identity_key,
         jsonb_object_agg(currency_code, round(revenue, 2)) filter (where revenue is not null) as revenue_by_currency
  from per_ccy
  group by identity_key
),
grouped as (
  select identity_key,
    min(workspace_id) as workspace_id,
    (array_agg(name order by placed_at desc nulls last) filter (where name is not null))[1] as display_name,
    (array_agg(phone order by placed_at desc nulls last) filter (where phone is not null))[1] as phone,
    (array_agg(email order by placed_at desc nulls last) filter (where email is not null))[1] as email,
    (array_agg(city order by placed_at desc nulls last) filter (where city is not null))[1] as city,
    (array_agg(country order by placed_at desc nulls last) filter (where country is not null))[1] as country,
    array_agg(distinct brand_id) filter (where brand_id is not null) as brand_ids,
    count(*) as total_orders,
    count(*) filter (where source_status in ('processing', 'completed')) as recognized_orders,
    count(*) filter (where is_cod) as cod_orders,
    count(*) filter (where suspect) as suspect_orders,
    count(*) filter (where source_status in ('cancelled', 'failed', 'refunded')) as cancelled_orders,
    count(distinct lower(trim(name))) filter (where name is not null) as distinct_names,
    min(placed_at) as first_order_at,
    max(placed_at) as last_order_at
  from keyed
  group by identity_key
),
addr_pick as (
  select distinct on (identity_key) identity_key, order_address_key as address_key
  from keyed
  where order_address_key is not null
  order by identity_key, placed_at desc nulls last
),
final as (
  select g.*, a.address_key, c.revenue_by_currency,
    coalesce((select sum(v.value::numeric) from jsonb_each_text(coalesce(c.revenue_by_currency, '{}'::jsonb)) v), 0) as revenue_total
  from grouped g
  left join ccy_agg c using (identity_key)
  left join addr_pick a using (identity_key)
),
clustered as (
  select f.*,
    (case when f.address_key is not null
       then count(*) over (partition by f.address_key) end)::bigint as shared_address_count
  from final f
)
select c.*,
  case
    when c.suspect_orders > 0 and c.cod_orders = c.total_orders and c.total_orders <= 3 then 'joy_buyer'
    when c.distinct_names >= 4 or c.total_orders >= 10
         or coalesce(c.shared_address_count, 1) >= 3 then 'reseller'
    else 'regular'
  end as classification
from clustered c;

-- Unique index is REQUIRED for the cron's refresh ... concurrently.
create unique index customers_read_identity_key_uidx on private.customers_read (identity_key);
create index customers_read_classification_idx on private.customers_read (classification);
create index customers_read_last_order_idx on private.customers_read (last_order_at desc nulls last);
create index customers_read_address_key_idx on private.customers_read (address_key) where address_key is not null;

-- ── live_customers: + address_key / shared_address_count ────────────────────
-- Return type changes, so drop + recreate (grants re-issued below).

drop function if exists public.live_customers(integer, integer, text, bigint, text[], jsonb);
create function public.live_customers(
  p_page integer default 1,
  p_page_size integer default 50,
  p_search text default '',
  p_brand_id bigint default null,
  p_countries text[] default null,
  p_conditions jsonb default null
)
returns table(
  identity_key text, display_name text, phone text, email text, city text, country text,
  brand_ids bigint[], total_orders bigint, recognized_orders bigint,
  cod_orders bigint, suspect_orders bigint, cancelled_orders bigint, distinct_names bigint,
  first_order_at timestamptz, last_order_at timestamptz,
  revenue_by_currency jsonb, revenue_total numeric, classification text,
  address_key text, shared_address_count bigint,
  total_count bigint
)
language plpgsql stable security definer set search_path to ''
as $function$
declare
  v_needle text := nullif(trim(p_search), '');
begin
  if not private.is_workspace_member((select min(id) from public.workspaces)) then
    raise exception 'Not a workspace member';
  end if;
  return query
  select c.identity_key, c.display_name, c.phone, c.email, c.city, c.country,
         c.brand_ids, c.total_orders, c.recognized_orders,
         c.cod_orders, c.suspect_orders, c.cancelled_orders, c.distinct_names,
         c.first_order_at, c.last_order_at,
         c.revenue_by_currency, c.revenue_total, c.classification,
         c.address_key, c.shared_address_count,
         count(*) over ()::bigint as total_count
  from private.customers_read c
  where (p_brand_id is null or c.brand_ids @> array[p_brand_id])
    and (p_countries is null or upper(coalesce(c.country, '')) = any(p_countries))
    and (v_needle is null
         or c.display_name ilike '%' || v_needle || '%'
         or c.phone ilike '%' || v_needle || '%'
         or c.email ilike '%' || v_needle || '%'
         or c.identity_key ilike '%' || regexp_replace(v_needle, '[^0-9a-z@._-]', '', 'gi') || '%')
    and (p_conditions is null or jsonb_typeof(p_conditions) <> 'array' or not exists (
      select 1
      from jsonb_array_elements(p_conditions) as cond
      cross join lateral (
        select case cond->>'field'
          when 'total_orders' then c.total_orders::numeric
          when 'recognized_orders' then c.recognized_orders::numeric
          when 'cod_orders' then c.cod_orders::numeric
          when 'suspect_orders' then c.suspect_orders::numeric
          when 'cancelled_orders' then c.cancelled_orders::numeric
          when 'distinct_names' then c.distinct_names::numeric
          when 'revenue_total' then c.revenue_total
          when 'shared_address_count' then coalesce(c.shared_address_count, 1)::numeric
          when 'cod_share' then case when c.total_orders > 0 then round(100.0 * c.cod_orders / c.total_orders, 1) else 0 end
          when 'last_order_days' then case when c.last_order_at is null then null else extract(epoch from now() - c.last_order_at) / 86400 end
          when 'first_order_days' then case when c.first_order_at is null then null else extract(epoch from now() - c.first_order_at) / 86400 end
          else null
        end as num_val
      ) nv
      where not (
        case cond->>'field'
          when 'activity' then (cond->>'value') = (
            case
              when c.last_order_at is null then 'provisional'
              when c.first_order_at > now() - interval '30 days' and c.total_orders = 1 then 'new'
              when c.last_order_at > now() - interval '30 days' then 'active'
              when c.last_order_at > now() - interval '90 days' then 'at_risk'
              else 'dormant'
            end)
          when 'repeat' then (cond->>'value') = (
            case when c.total_orders >= 5 then 'loyal' when c.total_orders >= 2 then 'repeat' else 'first_time' end)
          when 'tier' then (cond->>'value') = (
            case when c.revenue_total >= 900 then 'vip' when c.revenue_total >= 600 then 'high' when c.revenue_total >= 230 then 'mid' else 'low' end)
          when 'classification' then (cond->>'value') = c.classification
          when 'country' then upper(coalesce(c.country, '')) in (
            select upper(x.value) from jsonb_array_elements_text(coalesce(cond->'value', '[]'::jsonb)) x)
          else nv.num_val is not null and (
            case cond->>'op'
              when 'gte' then nv.num_val >= (cond->>'value')::numeric
              when 'lte' then nv.num_val <= (cond->>'value')::numeric
              when 'eq'  then nv.num_val = (cond->>'value')::numeric
              else false
            end)
        end)
    ))
  order by c.last_order_at desc nulls last
  limit greatest(p_page_size, 1)
  offset (greatest(p_page, 1) - 1) * greatest(p_page_size, 1);
end;
$function$;

-- ── live_customer_detail: new identity expression + siblings ────────────────
-- Also fixes the postcode/country asymmetry (they were billing-derived even
-- when shipping won street/city — a spliced, undeliverable address), and the
-- WA join now canonicalizes through norm_phone so E.164 contacts match
-- orders stored with local-format numbers.

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

  return jsonb_build_object('profile', v_profile, 'orders', v_orders,
    'address', v_address, 'address_siblings', v_siblings, 'wa_conversations', v_wa);
end;
$$;

-- ── live_customer_addresses: new identity expression, same shape ────────────

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
    coalesce(oc.corrected->>'postcode',
      nullif(r.raw->'shipping'->>'postcode', ''), r.customer->>'postcode'),
    coalesce(nullif(r.raw->'shipping'->>'country', ''), r.customer->>'country'),
    r.order_number,
    r.placed_at
  from public.orders_read r
  cross join lateral (
    select public.identity_key(r.customer, r.raw) as identity_key
  ) ik
  left join public.order_corrections oc
    on oc.order_read_id = r.id and oc.status in ('staged','applied')
  where ik.identity_key = any(p_identity_keys)
  order by ik.identity_key, r.placed_at desc;
end;
$$;

-- ── order_identity_key: kills the client-side copy of the expression ────────
-- SECURITY INVOKER — orders_read RLS authorizes, same as the order page's
-- direct select.

create or replace function public.order_identity_key(p_order_id bigint)
returns text
language sql
stable
set search_path = ''
as $$
  select public.identity_key(o.customer, o.raw)
  from public.orders_read o
  where o.id = p_order_id
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────

revoke all on function public.live_customers(integer, integer, text, bigint, text[], jsonb) from public, anon;
grant execute on function public.live_customers(integer, integer, text, bigint, text[], jsonb) to authenticated, service_role;
revoke execute on function public.live_customer_detail(text) from public, anon;
grant execute on function public.live_customer_detail(text) to authenticated;
revoke all on function public.live_customer_addresses(text[]) from public, anon;
grant execute on function public.live_customer_addresses(text[]) to authenticated, service_role;
revoke execute on function public.order_identity_key(bigint) from public, anon;
grant execute on function public.order_identity_key(bigint) to authenticated;
