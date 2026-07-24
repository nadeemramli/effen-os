-- Live catalog management (brands / products / variants) + role helper.
-- Writes are direct table policies gated by membership role — catalog is
-- governance metadata, not commercial truth, so guarded RPCs aren't needed
-- yet. Money-touching writes (orders) keep the RPC-only rule.

create or replace function private.has_role(ws_id bigint, allowed text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    where m.workspace_id = ws_id
      and m.user_id = (select auth.uid())
      and m.status = 'active'
      and m.role_key = any (allowed)
  );
$$;

grant execute on function private.has_role(bigint, text[]) to authenticated;

-- ---------- catalog tables ----------

create table public.products (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  brand_id bigint not null references public.brands (id),
  name text not null,
  category text,
  description text,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.product_variants (
  id bigint generated always as identity primary key,
  workspace_id bigint not null references public.workspaces (id),
  product_id bigint not null references public.products (id) on delete cascade,
  sku text not null,
  name text not null default '',
  price numeric(19, 4) not null default 0,
  currency_code text not null default 'MYR' check (char_length(currency_code) = 3),
  cost numeric(19, 4),
  -- Slice-level stock figure. The full S3 inventory spine (locations,
  -- reservations, movement ledger) replaces this as the source of truth later.
  stock_on_hand integer not null default 0,
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, sku)
);

create index product_variants_product_idx on public.product_variants (product_id);
create index products_brand_idx on public.products (brand_id);

alter table public.products enable row level security;
alter table public.product_variants enable row level security;

create policy member_read on public.products for select to authenticated
  using (private.is_workspace_member(workspace_id));
create policy member_read on public.product_variants for select to authenticated
  using (private.is_workspace_member(workspace_id));

-- Catalog writes: HQ admin + operations.
create policy catalog_insert on public.products for insert to authenticated
  with check (private.has_role(workspace_id, array['hq_admin', 'operations']));
create policy catalog_update on public.products for update to authenticated
  using (private.has_role(workspace_id, array['hq_admin', 'operations']))
  with check (private.has_role(workspace_id, array['hq_admin', 'operations']));
create policy catalog_insert on public.product_variants for insert to authenticated
  with check (private.has_role(workspace_id, array['hq_admin', 'operations']));
create policy catalog_update on public.product_variants for update to authenticated
  using (private.has_role(workspace_id, array['hq_admin', 'operations']))
  with check (private.has_role(workspace_id, array['hq_admin', 'operations']));
create policy catalog_delete on public.product_variants for delete to authenticated
  using (private.has_role(workspace_id, array['hq_admin', 'operations']));

-- Brand writes: HQ admin only. Archive instead of delete.
create policy brand_insert on public.brands for insert to authenticated
  with check (private.has_role(workspace_id, array['hq_admin']));
create policy brand_update on public.brands for update to authenticated
  using (private.has_role(workspace_id, array['hq_admin']))
  with check (private.has_role(workspace_id, array['hq_admin']));
