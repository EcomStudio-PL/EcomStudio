-- Search analytics (UX spec §2.2): log every query so the admin can later
-- read "top phrases" and "phrases with no results". Additive only — no
-- existing table, policy or behaviour is touched.
create table if not exists public.search_queries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  workspace_id uuid,
  query text not null,
  media_type text not null default 'image',
  result_count integer not null default 0,
  clicked boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.search_queries enable row level security;

-- Users may only write their own rows; only admins may read the log.
create policy sq_insert_own on public.search_queries
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy sq_admin_select on public.search_queries
  for select to authenticated
  using (public.is_admin());

create index if not exists search_queries_created_idx
  on public.search_queries (created_at desc);
