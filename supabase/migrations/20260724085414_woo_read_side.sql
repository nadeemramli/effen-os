-- WooCommerce read-side (Slice 2, step 1).
-- One connection row PER BRAND SITE: WooCommerce REST keys are site-local, so
-- segregation is physical — each brand gets its own key pair (stored as Edge
-- Function secrets, never in this database), its own checkpoint, and its own
-- health status. Blast radius of a leaked or rotated key is one brand.

alter table public.integration_connections
  add column if not exists config jsonb not null default '{}';

-- Replace the umbrella Woo row with per-brand connections.
delete from public.integration_connections where name = 'WooCommerce / Novomira';

insert into public.integration_connections
  (workspace_id, provider, name, category, direction, read_scopes, secret_ref, status, freshness_sla_minutes, config, notes)
select
  w.id, 'WooCommerce', v.name, 'commerce', 'read',
  array['orders.read'], v.secret_ref, 'pending_setup', 15,
  jsonb_build_object('brand_slug', v.brand_slug, 'base_url', null),
  'Set config.base_url to the store URL (https), then add Edge Function secrets '
    || v.secret_ref || '_KEY and ' || v.secret_ref || '_SECRET (read-only Woo REST key).'
from public.workspaces w,
  (values
    ('WooCommerce — Lipidri MY', 'WOO_LIPIDRI_MY', 'lipidri-my'),
    ('WooCommerce — Verdana Botanics', 'WOO_VERDANA', 'verdana-botanics'),
    ('WooCommerce — Nara Coffee', 'WOO_NARA', 'nara-coffee'),
    ('WooCommerce — Solstice Living', 'WOO_SOLSTICE', 'solstice-living')
  ) as v (name, secret_ref, brand_slug)
where w.name = 'EFFEN International Sdn Bhd';

-- Read model: normalized order rows + full source payload. This is a mirror,
-- not an operational order table — the source Woo store stays authoritative.
create table public.orders_read (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  integration_id bigint not null references public.integration_connections (id) on delete cascade,
  brand_id bigint references public.brands (id),
  source_order_id text not null,
  order_number text,
  source_status text not null,
  currency_code text not null,
  total numeric(19, 4) not null default 0,
  customer jsonb not null default '{}',
  items jsonb not null default '[]',
  raw jsonb not null default '{}',
  placed_at timestamptz,
  updated_at_source timestamptz,
  synced_at timestamptz not null default now(),
  unique (integration_id, source_order_id)
);

create index orders_read_brand_placed_idx on public.orders_read (brand_id, placed_at desc);
create index orders_read_workspace_placed_idx on public.orders_read (workspace_id, placed_at desc);

alter table public.orders_read enable row level security;

create policy member_read on public.orders_read for select to authenticated
  using (private.is_workspace_member(workspace_id));
