-- AI Studio ad-hoc products, generation output storage, notifications and
-- customer <-> staff support chat. Additive only.

-- Products: richer ad-hoc context captured directly in AI Studio.
alter table public.products add column if not exists sku text;
alter table public.products add column if not exists source_url text;
alter table public.products add column if not exists extra_info text;

-- Generation jobs: settings + provenance for the real generation path.
alter table public.generation_jobs add column if not exists quantity int not null default 1;
alter table public.generation_jobs add column if not exists resolution text;
alter table public.generation_jobs add column if not exists provider_slug text;
alter table public.generation_jobs add column if not exists settings jsonb not null default '{}'::jsonb;

-- The app writes generated files with the user's own token — members need
-- write access to their workspace folder (select policy existed already).
create policy "generation_assets_insert" on storage.objects for insert
  with check (bucket_id = 'generation-assets' and public.is_workspace_member((storage.foldername(name))[1]::uuid));
create policy "generation_assets_delete" on storage.objects for delete
  using (bucket_id = 'generation-assets' and public.is_workspace_member((storage.foldername(name))[1]::uuid));

-- ---------- NOTIFICATIONS ----------
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null default 'info',
  title text not null,
  body text,
  href text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications(user_id, created_at desc);
alter table public.notifications enable row level security;
create policy "notifications_own_read" on public.notifications
  for select using (user_id = auth.uid());
create policy "notifications_own_update" on public.notifications
  for update using (user_id = auth.uid());
create policy "notifications_insert" on public.notifications
  for insert with check (user_id = auth.uid() or public.is_admin());

-- ---------- SUPPORT CHAT ----------
create table public.support_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  subject text not null,
  status text not null default 'open' check (status in ('open','closed')),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index support_threads_user_idx on public.support_threads(user_id, last_message_at desc);
create index support_threads_status_idx on public.support_threads(status, last_message_at desc);
alter table public.support_threads enable row level security;
create policy "support_threads_own" on public.support_threads
  for select using (user_id = auth.uid() or public.is_admin());
create policy "support_threads_own_insert" on public.support_threads
  for insert with check (user_id = auth.uid());
create policy "support_threads_update" on public.support_threads
  for update using (user_id = auth.uid() or public.is_admin());

create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.support_threads(id) on delete cascade,
  author_id uuid references public.profiles(id) on delete set null,
  is_staff boolean not null default false,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index support_messages_thread_idx on public.support_messages(thread_id, created_at);
alter table public.support_messages enable row level security;
create policy "support_messages_read" on public.support_messages
  for select using (
    public.is_admin() or
    exists (select 1 from public.support_threads t where t.id = thread_id and t.user_id = auth.uid())
  );
create policy "support_messages_insert" on public.support_messages
  for insert with check (
    author_id = auth.uid() and (
      public.is_admin() or
      exists (select 1 from public.support_threads t where t.id = thread_id and t.user_id = auth.uid())
    )
  );
create policy "support_messages_update" on public.support_messages
  for update using (
    public.is_admin() or
    exists (select 1 from public.support_threads t where t.id = thread_id and t.user_id = auth.uid())
  );
