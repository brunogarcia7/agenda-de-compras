-- =========================================================
-- Supabase schema for the purchase requisition system.
-- Run this in the Supabase SQL Editor (SQL > New query).
--
-- This version restricts all access to AUTHENTICATED users
-- (email + password accounts you create in the dashboard).
-- =========================================================

-- 1) Table: one row per material item (post AI structuring).
create table if not exists public.purchase_items (
  id           uuid primary key default gen_random_uuid(),
  batch_id     text,                         -- groups items from one submission
  obra         text not null,
  observacao   text,
  category     text not null,                -- AI-assigned purchase category
  name         text not null,                -- material name (normalized by AI)
  quantity     text,                         -- e.g. "20 sacos", "50 m", "A definir"
  urgency      text not null,                -- 'Urgente' | 'Prazo Normal' | 'Programado'
  status       text not null default 'Novo Pedido', -- 'Novo Pedido' | 'Comprado'
  created_by   uuid default auth.uid() references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  purchased_at timestamptz,
  purchased_by uuid references auth.users (id) on delete set null,
  sort_order   double precision,            -- manual position on the board (drag & drop)
  bundle_id    text                         -- items sharing a bundle_id show in one card ("Juntar com…")
);

-- If you already created the table before these columns existed, run:
alter table public.purchase_items
  add column if not exists sort_order double precision;
alter table public.purchase_items
  add column if not exists bundle_id text;

-- Helpful indexes for the dashboard/history queries.
create index if not exists purchase_items_status_idx
  on public.purchase_items (status);
create index if not exists purchase_items_created_idx
  on public.purchase_items (created_at);
create index if not exists purchase_items_purchased_idx
  on public.purchase_items (purchased_at);

-- 2) Row Level Security — only logged-in users.
alter table public.purchase_items enable row level security;

-- The app is a closed team tool: any authenticated user can see and
-- manage every item (shared purchasing board). Anonymous visitors get
-- nothing. If you later need per-user isolation, change these policies
-- to compare created_by = auth.uid().

drop policy if exists "authenticated can read" on public.purchase_items;
create policy "authenticated can read"
  on public.purchase_items for select
  to authenticated
  using (true);

drop policy if exists "authenticated can insert" on public.purchase_items;
create policy "authenticated can insert"
  on public.purchase_items for insert
  to authenticated
  with check (true);

drop policy if exists "authenticated can update" on public.purchase_items;
create policy "authenticated can update"
  on public.purchase_items for update
  to authenticated
  using (true)
  with check (true);

-- Note: no policy for the `anon` role => anonymous users are denied.


-- =========================================================
-- 3) Category order (drag the whole column to reorder).
--    One row per category, storing its board position.
-- =========================================================
create table if not exists public.category_order (
  category   text primary key,
  position   double precision not null,
  updated_at timestamptz not null default now()
);

alter table public.category_order enable row level security;

drop policy if exists "auth read category_order" on public.category_order;
create policy "auth read category_order"
  on public.category_order for select
  to authenticated using (true);

drop policy if exists "auth write category_order" on public.category_order;
create policy "auth write category_order"
  on public.category_order for insert
  to authenticated with check (true);

drop policy if exists "auth update category_order" on public.category_order;
create policy "auth update category_order"
  on public.category_order for update
  to authenticated using (true) with check (true);
