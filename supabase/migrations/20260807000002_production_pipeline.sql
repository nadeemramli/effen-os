-- Production pipeline (P5 slice 0): per-product factory tracking replacing
-- the operator spreadsheet. Five stages — raw material, premix (measured in
-- finished-good output units), in-progress (sachet products only; capsules
-- bottle immediately), in-stock, and a COMPUTED backlog (unfulfilled orders
-- vs stock) — plus incoming raw-material shipments and days-of-cover from
-- real sales velocity.
--
-- Design doctrine (S3/P5 docs): counters are a cache the append-only
-- production_entries ledger fully explains; the ONLY write path is audited
-- RPCs; direct edits are impossible (RLS exposes select only).
--
-- Deliberately deferred: BOM/recipes, work orders/batches, lots/expiry,
-- locations, reservations/ATP, auto stock decrement on order/ship events,
-- per-variant stock allocation, valuation, RTS/refund AUTO-restock (returns
-- are surfaced as signals; operators re-count physically), migration of the
-- interim product_variants.stock_on_hand, WMS integration.

-- ── Tables ──────────────────────────────────────────────────────────────

create table public.production_items (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces(id),
  product_id bigint references public.products(id),
  name text not null,
  dosage_form text not null check (dosage_form in ('capsule','sachet','other')),
  base_uom text not null default 'bottle',
  raw_material_units int not null default 0 check (raw_material_units >= 0),
  premix_units int not null default 0 check (premix_units >= 0),
  in_progress_units int not null default 0 check (in_progress_units >= 0),
  ready_units int not null default 0 check (ready_units >= 0),
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- capsules go straight to bottles: no in-progress stage
  check (dosage_form = 'sachet' or in_progress_units = 0)
);

create unique index production_items_product_uidx
  on public.production_items (workspace_id, product_id) where product_id is not null;
create unique index production_items_name_uidx
  on public.production_items (workspace_id, lower(name));

create table public.production_materials (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces(id),
  production_item_id bigint not null references public.production_items(id) on delete cascade,
  kind text not null check (kind in ('product','packaging')),
  name text not null,
  uom text not null,
  qty numeric not null default 0 check (qty >= 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index production_materials_item_idx on public.production_materials (production_item_id);

-- Append-only: every counter change is explained here. No update/delete
-- policies exist and none may ever be added.
create table public.production_entries (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces(id),
  production_item_id bigint not null references public.production_items(id) on delete cascade,
  field text not null check (field in ('raw_material_units','premix_units','in_progress_units','ready_units')),
  old_qty int not null,
  new_qty int not null,
  delta int not null,
  source text not null default 'manual' check (source in ('manual','inbound_arrival')),
  note text,
  actor_label text not null,
  created_at timestamptz not null default now()
);
create index production_entries_item_idx
  on public.production_entries (production_item_id, created_at desc);

create table public.production_inbound (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces(id),
  production_item_id bigint not null references public.production_items(id) on delete cascade,
  qty_units int not null check (qty_units > 0),
  freight text not null check (freight in ('sea','air','sea_air')),
  eta date,
  status text not null default 'ordered' check (status in ('ordered','arrived','cancelled')),
  arrived_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index production_inbound_item_idx
  on public.production_inbound (production_item_id, status);

-- Pack → base-unit factor: a "Pakej 4+2" variant consumes 6 base units.
-- Drives backlog and velocity conversion; default 1 flagged in the UI.
alter table public.product_variants
  add column units_per_pack int not null default 1 check (units_per_pack > 0);

-- ── RLS: member read; ALL writes via SECURITY DEFINER RPCs ──────────────

alter table public.production_items enable row level security;
alter table public.production_materials enable row level security;
alter table public.production_entries enable row level security;
alter table public.production_inbound enable row level security;

create policy member_read on public.production_items for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy member_read on public.production_materials for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy member_read on public.production_entries for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy member_read on public.production_inbound for select to authenticated
  using (private.is_workspace_member(workspace_id));

-- ── Write RPCs ──────────────────────────────────────────────────────────

create or replace function public.save_production_item(
  p_name text, p_dosage_form text, p_base_uom text default 'bottle',
  p_product_id bigint default null, p_item_id bigint default null
) returns bigint
language plpgsql security definer set search_path to ''
as $function$
declare
  v_ws bigint;
  v_actor text;
  v_id bigint;
begin
  select min(id) into v_ws from public.workspaces;
  if not private.has_role(v_ws, array['hq_admin','operations']) then
    raise exception 'Production items require hq_admin or operations role';
  end if;
  if p_dosage_form not in ('capsule','sachet','other') then
    raise exception 'dosage_form must be capsule, sachet or other';
  end if;
  if nullif(trim(p_name), '') is null then
    raise exception 'Name is required';
  end if;
  if p_product_id is not null and not exists (
    select 1 from public.products pr where pr.id = p_product_id and pr.workspace_id = v_ws
  ) then
    raise exception 'Product % not found in this workspace', p_product_id;
  end if;

  select coalesce((select display_name from public.profiles where id = (select auth.uid())), 'unknown')
  into v_actor;

  if p_item_id is null then
    insert into public.production_items (workspace_id, product_id, name, dosage_form, base_uom)
    values (v_ws, p_product_id, trim(p_name), p_dosage_form, coalesce(nullif(trim(p_base_uom), ''), 'bottle'))
    returning id into v_id;
  else
    update public.production_items
    set product_id = p_product_id, name = trim(p_name), dosage_form = p_dosage_form,
        base_uom = coalesce(nullif(trim(p_base_uom), ''), 'bottle'), updated_at = now()
    where id = p_item_id and workspace_id = v_ws
    returning id into v_id;
    if v_id is null then raise exception 'Production item % not found', p_item_id; end if;
  end if;

  insert into public.audit_events (workspace_id, actor_label, action, entity_ref, detail)
  values (v_ws, v_actor, 'production.item_saved', 'production:' || trim(p_name),
          p_dosage_form || ' · ' || coalesce(nullif(trim(p_base_uom), ''), 'bottle'));
  return v_id;
end;
$function$;

create or replace function public.set_production_stage(
  p_item_id bigint, p_field text, p_qty int, p_note text default null
) returns void
language plpgsql security definer set search_path to ''
as $function$
declare
  v_item record;
  v_actor text;
  v_old int;
begin
  select * into v_item from public.production_items where id = p_item_id;
  if v_item is null then raise exception 'Production item % not found', p_item_id; end if;
  if not private.has_role(v_item.workspace_id, array['hq_admin','operations']) then
    raise exception 'Stage counts require hq_admin or operations role';
  end if;
  if p_field not in ('raw_material_units','premix_units','in_progress_units','ready_units') then
    raise exception 'Unknown stage field %', p_field;
  end if;
  if p_field = 'in_progress_units' and v_item.dosage_form <> 'sachet' then
    raise exception 'In-progress applies to sachet products only (capsules bottle immediately)';
  end if;
  if p_qty < 0 then raise exception 'Quantity cannot be negative'; end if;

  v_old := case p_field
    when 'raw_material_units' then v_item.raw_material_units
    when 'premix_units' then v_item.premix_units
    when 'in_progress_units' then v_item.in_progress_units
    else v_item.ready_units end;

  execute format('update public.production_items set %I = $1, updated_at = now() where id = $2', p_field)
  using p_qty, p_item_id;

  select coalesce((select display_name from public.profiles where id = (select auth.uid())), 'unknown')
  into v_actor;

  insert into public.production_entries
    (workspace_id, production_item_id, field, old_qty, new_qty, delta, source, note, actor_label)
  values (v_item.workspace_id, p_item_id, p_field, v_old, p_qty, p_qty - v_old, 'manual', p_note, v_actor);

  insert into public.audit_events (workspace_id, actor_label, action, entity_ref, detail)
  values (v_item.workspace_id, v_actor, 'production.stage_set', 'production:' || v_item.name,
          p_field || ': ' || v_old || ' → ' || p_qty || coalesce(' · ' || p_note, ''));
end;
$function$;

create or replace function public.save_production_material(
  p_item_id bigint, p_kind text, p_name text, p_uom text, p_qty numeric,
  p_note text default null, p_material_id bigint default null
) returns bigint
language plpgsql security definer set search_path to ''
as $function$
declare
  v_item record;
  v_actor text;
  v_id bigint;
begin
  select * into v_item from public.production_items where id = p_item_id;
  if v_item is null then raise exception 'Production item % not found', p_item_id; end if;
  if not private.has_role(v_item.workspace_id, array['hq_admin','operations']) then
    raise exception 'Materials require hq_admin or operations role';
  end if;
  if p_kind not in ('product','packaging') then
    raise exception 'kind must be product or packaging';
  end if;
  if nullif(trim(p_name), '') is null or nullif(trim(p_uom), '') is null then
    raise exception 'Material name and unit are required';
  end if;
  if p_qty < 0 then raise exception 'Quantity cannot be negative'; end if;

  if p_material_id is null then
    insert into public.production_materials (workspace_id, production_item_id, kind, name, uom, qty, note)
    values (v_item.workspace_id, p_item_id, p_kind, trim(p_name), trim(p_uom), p_qty, p_note)
    returning id into v_id;
  else
    update public.production_materials
    set kind = p_kind, name = trim(p_name), uom = trim(p_uom), qty = p_qty, note = p_note, updated_at = now()
    where id = p_material_id and production_item_id = p_item_id
    returning id into v_id;
    if v_id is null then raise exception 'Material % not found', p_material_id; end if;
  end if;

  select coalesce((select display_name from public.profiles where id = (select auth.uid())), 'unknown')
  into v_actor;
  insert into public.audit_events (workspace_id, actor_label, action, entity_ref, detail)
  values (v_item.workspace_id, v_actor, 'production.material_saved', 'production:' || v_item.name,
          p_kind || ' · ' || trim(p_name) || ': ' || p_qty || ' ' || trim(p_uom));
  return v_id;
end;
$function$;

create or replace function public.delete_production_material(p_material_id bigint) returns void
language plpgsql security definer set search_path to ''
as $function$
declare
  v_mat record;
  v_item record;
  v_actor text;
begin
  select * into v_mat from public.production_materials where id = p_material_id;
  if v_mat is null then raise exception 'Material % not found', p_material_id; end if;
  select * into v_item from public.production_items where id = v_mat.production_item_id;
  if not private.has_role(v_mat.workspace_id, array['hq_admin','operations']) then
    raise exception 'Materials require hq_admin or operations role';
  end if;
  delete from public.production_materials where id = p_material_id;
  select coalesce((select display_name from public.profiles where id = (select auth.uid())), 'unknown')
  into v_actor;
  insert into public.audit_events (workspace_id, actor_label, action, entity_ref, detail)
  values (v_mat.workspace_id, v_actor, 'production.material_removed', 'production:' || v_item.name,
          v_mat.kind || ' · ' || v_mat.name);
end;
$function$;

create or replace function public.save_production_inbound(
  p_item_id bigint, p_qty_units int, p_freight text,
  p_eta date default null, p_note text default null, p_inbound_id bigint default null
) returns bigint
language plpgsql security definer set search_path to ''
as $function$
declare
  v_item record;
  v_actor text;
  v_id bigint;
begin
  select * into v_item from public.production_items where id = p_item_id;
  if v_item is null then raise exception 'Production item % not found', p_item_id; end if;
  if not private.has_role(v_item.workspace_id, array['hq_admin','operations']) then
    raise exception 'Inbound shipments require hq_admin or operations role';
  end if;
  if p_freight not in ('sea','air','sea_air') then
    raise exception 'freight must be sea, air or sea_air';
  end if;
  if p_qty_units <= 0 then raise exception 'Quantity must be positive'; end if;

  if p_inbound_id is null then
    insert into public.production_inbound (workspace_id, production_item_id, qty_units, freight, eta, note)
    values (v_item.workspace_id, p_item_id, p_qty_units, p_freight, p_eta, p_note)
    returning id into v_id;
  else
    update public.production_inbound
    set qty_units = p_qty_units, freight = p_freight, eta = p_eta, note = p_note, updated_at = now()
    where id = p_inbound_id and production_item_id = p_item_id and status = 'ordered'
    returning id into v_id;
    if v_id is null then raise exception 'Inbound % not found or no longer editable', p_inbound_id; end if;
  end if;

  select coalesce((select display_name from public.profiles where id = (select auth.uid())), 'unknown')
  into v_actor;
  insert into public.audit_events (workspace_id, actor_label, action, entity_ref, detail)
  values (v_item.workspace_id, v_actor, 'production.inbound_saved', 'production:' || v_item.name,
          p_qty_units || ' units · ' || p_freight || coalesce(' · ETA ' || p_eta, ''));
  return v_id;
end;
$function$;

create or replace function public.cancel_production_inbound(p_inbound_id bigint) returns void
language plpgsql security definer set search_path to ''
as $function$
declare
  v_in record;
  v_item record;
  v_actor text;
begin
  select * into v_in from public.production_inbound where id = p_inbound_id;
  if v_in is null then raise exception 'Inbound % not found', p_inbound_id; end if;
  if v_in.status <> 'ordered' then raise exception 'Only ordered shipments can be cancelled'; end if;
  select * into v_item from public.production_items where id = v_in.production_item_id;
  if not private.has_role(v_in.workspace_id, array['hq_admin','operations']) then
    raise exception 'Inbound shipments require hq_admin or operations role';
  end if;
  update public.production_inbound set status = 'cancelled', updated_at = now() where id = p_inbound_id;
  select coalesce((select display_name from public.profiles where id = (select auth.uid())), 'unknown')
  into v_actor;
  insert into public.audit_events (workspace_id, actor_label, action, entity_ref, detail)
  values (v_in.workspace_id, v_actor, 'production.inbound_cancelled', 'production:' || v_item.name,
          v_in.qty_units || ' units · ' || v_in.freight);
end;
$function$;

-- Arrival auto-rolls into raw material: one action, counter + ledger + audit
-- in a single transaction (manual re-entry would recreate the spreadsheet's
-- double-entry drift).
create or replace function public.mark_inbound_arrived(p_inbound_id bigint) returns void
language plpgsql security definer set search_path to ''
as $function$
declare
  v_in record;
  v_item record;
  v_actor text;
begin
  select * into v_in from public.production_inbound where id = p_inbound_id;
  if v_in is null then raise exception 'Inbound % not found', p_inbound_id; end if;
  if v_in.status <> 'ordered' then raise exception 'Shipment already %', v_in.status; end if;
  select * into v_item from public.production_items where id = v_in.production_item_id;
  if not private.has_role(v_in.workspace_id, array['hq_admin','operations']) then
    raise exception 'Inbound shipments require hq_admin or operations role';
  end if;

  update public.production_inbound
  set status = 'arrived', arrived_at = now(), updated_at = now()
  where id = p_inbound_id;

  update public.production_items
  set raw_material_units = raw_material_units + v_in.qty_units, updated_at = now()
  where id = v_item.id;

  select coalesce((select display_name from public.profiles where id = (select auth.uid())), 'unknown')
  into v_actor;

  insert into public.production_entries
    (workspace_id, production_item_id, field, old_qty, new_qty, delta, source, note, actor_label)
  values (v_in.workspace_id, v_item.id, 'raw_material_units',
          v_item.raw_material_units, v_item.raw_material_units + v_in.qty_units, v_in.qty_units,
          'inbound_arrival', 'inbound #' || v_in.id || ' (' || v_in.freight || ')', v_actor);

  insert into public.audit_events (workspace_id, actor_label, action, entity_ref, detail)
  values (v_in.workspace_id, v_actor, 'production.inbound_arrived', 'production:' || v_item.name,
          v_in.qty_units || ' units rolled into raw material');
end;
$function$;

create or replace function public.set_variant_units_per_pack(p_variant_id bigint, p_units int) returns void
language plpgsql security definer set search_path to ''
as $function$
declare
  v_variant record;
  v_actor text;
begin
  select * into v_variant from public.product_variants where id = p_variant_id;
  if v_variant is null then raise exception 'Variant % not found', p_variant_id; end if;
  if not private.has_role(v_variant.workspace_id, array['hq_admin','operations','finance']) then
    raise exception 'Pack sizes require hq_admin, operations or finance role';
  end if;
  if p_units <= 0 then raise exception 'Units per pack must be positive'; end if;

  update public.product_variants set units_per_pack = p_units, updated_at = now()
  where id = p_variant_id;

  select coalesce((select display_name from public.profiles where id = (select auth.uid())), 'unknown')
  into v_actor;
  insert into public.audit_events (workspace_id, actor_label, action, entity_ref, detail)
  values (v_variant.workspace_id, v_actor, 'catalog.units_per_pack_set', 'variant:' || v_variant.sku,
          v_variant.units_per_pack || ' → ' || p_units || ' base units');
end;
$function$;

-- ── Read RPC (SECURITY INVOKER — RLS applies) ───────────────────────────
-- Backlog decisions: open lane = pending/on-hold/processing within 180d,
-- anti-joined against nv_shipments (a parcel handed to the courier has left
-- the physical count). Unmapped store SKUs and default pack sizes are
-- returned as explicit caveats, never silently folded in. Returns (courier
-- RTS + Woo refunds) are SIGNALS — no auto-restock.

create or replace function public.live_production()
returns jsonb
language sql stable
set search_path to ''
as $function$
with pack as (
  select v.id as variant_id, v.product_id, v.units_per_pack, v.sku, v.name
  from public.product_variants v
),
open_orders as (
  select o.id, o.integration_id, o.items
  from public.orders_read o
  where o.source_status in ('pending','on-hold','processing')
    and o.placed_at > now() - interval '180 days'
    and not exists (
      select 1 from public.nv_shipments s where s.order_ref = o.order_number
    )
),
backlog_lines as (
  select pk.product_id,
         it.sku,
         it.qty,
         pk.units_per_pack
  from open_orders o
  cross join lateral (
    select e->>'sku' as sku, coalesce(nullif(e->>'quantity','')::numeric, 1) as qty
    from jsonb_array_elements(o.items) e
  ) it
  left join public.variant_aliases va
    on va.integration_id = o.integration_id and va.alias = it.sku
  left join pack pk on pk.variant_id = va.variant_id
),
backlog as (
  select product_id, sum(qty * units_per_pack)::int as backlog_units
  from backlog_lines where product_id is not null
  group by product_id
),
unmapped_backlog as (
  select coalesce(sum(qty), 0)::int as qty from backlog_lines where product_id is null
),
usage as (
  select pk.product_id, sum(it.qty * pk.units_per_pack) / 30.0 as daily_units
  from public.orders_read o
  cross join lateral (
    select e->>'sku' as sku, coalesce(nullif(e->>'quantity','')::numeric, 1) as qty
    from jsonb_array_elements(o.items) e
  ) it
  join public.variant_aliases va
    on va.integration_id = o.integration_id and va.alias = it.sku
  join pack pk on pk.variant_id = va.variant_id
  where o.placed_at > now() - interval '30 days'
    and o.source_status in ('processing','completed')
  group by pk.product_id
),
rts as (
  select pk.product_id,
         sum(it.qty * pk.units_per_pack)::int as rts_units_30d,
         count(distinct s.tracking_id)::int as rts_parcels_30d
  from public.nv_shipments s
  join public.orders_read o on o.order_number = s.order_ref
  cross join lateral (
    select e->>'sku' as sku, coalesce(nullif(e->>'quantity','')::numeric, 1) as qty
    from jsonb_array_elements(o.items) e
  ) it
  join public.variant_aliases va
    on va.integration_id = o.integration_id and va.alias = it.sku
  join pack pk on pk.variant_id = va.variant_id
  where s.status ilike '%return%'
    and s.last_event_at > now() - interval '30 days'
  group by pk.product_id
),
refunds as (
  select pk.product_id, sum(it.qty * pk.units_per_pack)::int as refund_units_30d
  from public.orders_read o
  cross join lateral (
    select e->>'sku' as sku, coalesce(nullif(e->>'quantity','')::numeric, 1) as qty
    from jsonb_array_elements(o.items) e
  ) it
  join public.variant_aliases va
    on va.integration_id = o.integration_id and va.alias = it.sku
  join pack pk on pk.variant_id = va.variant_id
  where o.source_status in ('refunded','cancelled')
    and o.placed_at > now() - interval '30 days'
  group by pk.product_id
),
materials as (
  select production_item_id,
         jsonb_agg(jsonb_build_object(
           'id', id, 'kind', kind, 'name', name, 'uom', uom, 'qty', qty, 'note', note
         ) order by kind, name) as list
  from public.production_materials
  group by production_item_id
),
incoming as (
  select production_item_id,
         sum(qty_units)::int as incoming_units,
         min(eta) as next_eta,
         jsonb_agg(jsonb_build_object(
           'id', id, 'qty_units', qty_units, 'freight', freight, 'eta', eta,
           'status', status, 'note', note
         ) order by coalesce(eta, '9999-12-31'::date)) as shipments
  from public.production_inbound
  where status = 'ordered'
  group by production_item_id
),
recent_entries as (
  select production_item_id,
         jsonb_agg(jsonb_build_object(
           'field', field, 'old_qty', old_qty, 'new_qty', new_qty, 'delta', delta,
           'source', source, 'note', note, 'actor', actor_label, 'at', created_at
         ) order by created_at desc) as entries
  from (
    select *, row_number() over (partition by production_item_id order by created_at desc) as rn
    from public.production_entries
  ) x
  where rn <= 10
  group by production_item_id
)
select jsonb_build_object(
  'items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', i.id,
      'product_id', i.product_id,
      'name', i.name,
      'dosage_form', i.dosage_form,
      'base_uom', i.base_uom,
      'raw_material_units', i.raw_material_units,
      'premix_units', i.premix_units,
      'in_progress_units', i.in_progress_units,
      'ready_units', i.ready_units,
      'status', i.status,
      'updated_at', i.updated_at,
      'backlog_units', coalesce(b.backlog_units, 0),
      'net_position', i.ready_units + i.in_progress_units + i.premix_units - coalesce(b.backlog_units, 0),
      'daily_usage', round(coalesce(u.daily_units, 0)::numeric, 1),
      'days_cover', case when coalesce(u.daily_units, 0) > 0
        then round((i.ready_units / u.daily_units)::numeric, 0) end,
      'rts_units_30d', coalesce(r.rts_units_30d, 0),
      'rts_parcels_30d', coalesce(r.rts_parcels_30d, 0),
      'refund_units_30d', coalesce(f.refund_units_30d, 0),
      'incoming_units', coalesce(inc.incoming_units, 0),
      'next_eta', inc.next_eta,
      'incoming', coalesce(inc.shipments, '[]'::jsonb),
      'materials', coalesce(m.list, '[]'::jsonb),
      'entries', coalesce(e.entries, '[]'::jsonb)
    ) order by i.name)
    from public.production_items i
    left join backlog b on b.product_id = i.product_id
    left join usage u on u.product_id = i.product_id
    left join rts r on r.product_id = i.product_id
    left join refunds f on f.product_id = i.product_id
    left join materials m on m.production_item_id = i.id
    left join incoming inc on inc.production_item_id = i.id
    left join recent_entries e on e.production_item_id = i.id
    where i.status = 'active'
  ), '[]'::jsonb),
  'unmapped_backlog_qty', (select qty from unmapped_backlog),
  'variants_missing_pack', coalesce((
    select jsonb_agg(jsonb_build_object('id', pk.variant_id, 'sku', pk.sku, 'name', pk.name))
    from pack pk
    join public.production_items i on i.product_id = pk.product_id and i.status = 'active'
    where pk.units_per_pack = 1
  ), '[]'::jsonb)
);
$function$;

-- ── Grants ──────────────────────────────────────────────────────────────

revoke all on function public.save_production_item(text, text, text, bigint, bigint) from public, anon;
revoke all on function public.set_production_stage(bigint, text, int, text) from public, anon;
revoke all on function public.save_production_material(bigint, text, text, text, numeric, text, bigint) from public, anon;
revoke all on function public.delete_production_material(bigint) from public, anon;
revoke all on function public.save_production_inbound(bigint, int, text, date, text, bigint) from public, anon;
revoke all on function public.cancel_production_inbound(bigint) from public, anon;
revoke all on function public.mark_inbound_arrived(bigint) from public, anon;
revoke all on function public.set_variant_units_per_pack(bigint, int) from public, anon;
revoke all on function public.live_production() from public, anon;

grant execute on function public.save_production_item(text, text, text, bigint, bigint) to authenticated, service_role;
grant execute on function public.set_production_stage(bigint, text, int, text) to authenticated, service_role;
grant execute on function public.save_production_material(bigint, text, text, text, numeric, text, bigint) to authenticated, service_role;
grant execute on function public.delete_production_material(bigint) to authenticated, service_role;
grant execute on function public.save_production_inbound(bigint, int, text, date, text, bigint) to authenticated, service_role;
grant execute on function public.cancel_production_inbound(bigint) to authenticated, service_role;
grant execute on function public.mark_inbound_arrived(bigint) to authenticated, service_role;
grant execute on function public.set_variant_units_per_pack(bigint, int) to authenticated, service_role;
grant execute on function public.live_production() to authenticated, service_role;
