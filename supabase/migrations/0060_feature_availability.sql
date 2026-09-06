-- ============================================================================
-- 0060 — FEATURE AVAILABILITY: per-module ACTIVE / COMING_SOON / MAINTENANCE /
-- DISABLED, with an optional time window.
--
-- One row per feature_key from the app's central registry (lib/features.ts).
-- No seed rows: an absent row MEANS active, so the table stays a list of
-- exceptions, not a mirror of the product. Login/logout/auth-confirm/security
-- verification are not features and have no key — the registry excludes them
-- and the admin actions refuse unknown keys (C11).
--
-- RLS: any signed-in user may READ (the menu needs the statuses; they are not
-- secrets); only admins write. The window semantics live in the app:
-- the restriction applies between starts_at and ends_at, and auto_reenable
-- decides whether reaching ends_at reopens the module by itself.
-- ============================================================================

create table if not exists public.feature_availability (
  feature_key      text primary key,
  status           text not null default 'ACTIVE'
                   check (status in ('ACTIVE','COMING_SOON','MAINTENANCE','DISABLED')),
  hidden_from_menu boolean not null default false,
  starts_at        timestamptz,
  ends_at          timestamptz,
  auto_reenable    boolean not null default true,
  custom_title     text,
  custom_message   text,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users (id) on delete set null,
  constraint feature_availability_window_ok
    check (starts_at is null or ends_at is null or starts_at < ends_at)
);

alter table public.feature_availability enable row level security;

drop policy if exists feature_availability_read on public.feature_availability;
create policy feature_availability_read on public.feature_availability
  for select to authenticated
  using (true);

drop policy if exists feature_availability_admin_insert on public.feature_availability;
create policy feature_availability_admin_insert on public.feature_availability
  for insert to authenticated
  with check (public.is_admin());

drop policy if exists feature_availability_admin_update on public.feature_availability;
create policy feature_availability_admin_update on public.feature_availability
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists feature_availability_admin_delete on public.feature_availability;
create policy feature_availability_admin_delete on public.feature_availability
  for delete to authenticated
  using (public.is_admin());
