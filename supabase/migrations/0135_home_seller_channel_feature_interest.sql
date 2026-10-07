-- 0135 — THE SIGNED-IN START (/home): WHERE A SELLER SELLS, AND WHAT THEY WAIT FOR.
--
-- Two small, additive pieces of user state the redesigned /home needs. Nothing
-- here touches credits, payments, generation, prompts or any existing policy.
--
-- 1. profiles.seller_channel — the answer to "Gdzie sprzedajesz?", asked once
--    of a new seller. It only picks which task the /home hero pre-selects.
--    profiles.seller_channel_asked_at — stamped when the question was answered
--    OR closed, so a seller who dismisses it is not asked on every visit.
--    The existing profiles policies (own row / admin) and the role-escalation
--    trigger already cover both columns; nothing new is granted.
--
-- 2. public.feature_interest — "Powiadom mnie" on a feature that is not live
--    yet. One row per (user, feature): a second click is a no-op, not a
--    duplicate. The user is ALWAYS auth.uid() — the insert policy refuses any
--    other user_id, so a client cannot register somebody else. No e-mail is
--    stored here: the account already has one. The global waitlist
--    (waitlist_subscribers / newsletter) is a different thing and is untouched.

alter table public.profiles
  add column if not exists seller_channel text,
  add column if not exists seller_channel_asked_at timestamptz;

alter table public.profiles drop constraint if exists profiles_seller_channel_check;
alter table public.profiles add constraint profiles_seller_channel_check check (
  seller_channel is null or seller_channel in ('allegro', 'amazon', 'own_store', 'multi')
);

comment on column public.profiles.seller_channel is
  'Where the seller sells (asked once on /home): allegro | amazon | own_store | multi. Presentation only — picks the default /home task.';
comment on column public.profiles.seller_channel_asked_at is
  'When the /home seller-channel question was answered or dismissed — it is never asked again.';

create table if not exists public.feature_interest (
  user_id uuid not null references auth.users (id) on delete cascade,
  feature_key text not null,
  workspace_id uuid references public.workspaces (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (user_id, feature_key),
  constraint feature_interest_key_check check (
    feature_key in ('ugc', 'video', 'ads', 'social', 'mailing')
  )
);

comment on table public.feature_interest is
  '"Powiadom mnie" on /home: which signed-in users asked to hear when a coming-soon feature launches. One row per user and feature.';

alter table public.feature_interest enable row level security;

drop policy if exists "feature_interest_select_own_or_admin" on public.feature_interest;
create policy "feature_interest_select_own_or_admin" on public.feature_interest
  for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "feature_interest_insert_own" on public.feature_interest;
create policy "feature_interest_insert_own" on public.feature_interest
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and (workspace_id is null or public.is_workspace_member(workspace_id))
  );

-- No update and no delete policy: a registration is a fact, not a setting.
revoke all on public.feature_interest from anon;
grant select, insert on public.feature_interest to authenticated;

-- Demand per feature for the admin dashboard. SECURITY INVOKER: it runs under
-- the caller's RLS, so an admin sees every row and a customer only their own.
create or replace function public.feature_interest_counts()
returns table (feature_key text, interested bigint)
language sql stable security invoker set search_path = public as $$
  select fi.feature_key, count(*)::bigint
    from public.feature_interest fi
   group by fi.feature_key;
$$;
revoke all on function public.feature_interest_counts() from public, anon;
grant execute on function public.feature_interest_counts() to authenticated;
