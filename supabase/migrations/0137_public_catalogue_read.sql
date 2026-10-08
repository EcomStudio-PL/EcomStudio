-- 0137 — THE PUBLIC CENNIK MUST BE ABLE TO READ THE CATALOGUE.
--
-- THE BUG THIS FIXES, FOUND BEFORE /plany WENT LIVE.
--
-- /plany is the first page that reads the plans and the credit packs WITHOUT
-- a session. Both tables carried, for the `public` role (which includes anon):
--
--     plans_select / pkg_select_active   using (active = true or is_admin())
--     plans_admin_write / pkg_admin_write for all using (is_admin())
--
-- and anon has no EXECUTE on is_admin() (0005). The planner hoists the
-- argument-less is_admin() into an InitPlan and evaluates it up front, so an
-- anonymous read of even the active rows was not "no rows" but a hard error:
--
--     ERROR: 42501: permission denied for function is_admin
--
-- (proven on PROD with `set local role anon` before this migration). 0051 met
-- the same thing on cms_pages, 0115 on the webhook's reads. The cure is 0051's:
-- split the rule by role, so the anonymous path never mentions is_admin() at
-- all — and never grant anon is_admin(uid), which would answer "is this person
-- an admin?" for any uuid.
--
-- HOW: the four existing policies are RE-SCOPED in place (ALTER POLICY: same
-- names, `to authenticated`, is_admin() hoisted as in 0109), and one new read
-- policy per table gives anon the ACTIVE rows — the rule that already applied
-- to everyone, now without the function anon cannot call. Nothing is dropped.
--
-- WHAT ANON SEES: exactly what any signed-in customer already sees — the
-- active rows of two price lists. Sign-up is open, so nothing here was ever
-- private from the public; anon's write privileges stay as they were and,
-- with no policy granting anon a write, RLS refuses every one.
--
-- Nothing else changes: prices, rows, the webhook's reader (0115), credits,
-- payments and the ledger are untouched. Idempotent.

do $$
begin
  /* ── subscription_plans ──────────────────────────────────────────────── */
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'subscription_plans' and policyname = 'plans_select') then
    alter policy "plans_select" on public.subscription_plans
      to authenticated
      using (active = true or (select public.is_admin()));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'subscription_plans' and policyname = 'plans_admin_write') then
    alter policy "plans_admin_write" on public.subscription_plans
      to authenticated
      using ((select public.is_admin())) with check ((select public.is_admin()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'subscription_plans' and policyname = 'plans_select_public') then
    -- Signed out: the plans on sale, and nothing to evaluate but a column.
    create policy "plans_select_public" on public.subscription_plans for select
      to anon
      using (active = true);
  end if;

  /* ── credit_packages ─────────────────────────────────────────────────── */
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'credit_packages' and policyname = 'pkg_select_active') then
    alter policy "pkg_select_active" on public.credit_packages
      to authenticated
      using (active = true or (select public.is_admin()));
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'credit_packages' and policyname = 'pkg_admin_write') then
    alter policy "pkg_admin_write" on public.credit_packages
      to authenticated
      using ((select public.is_admin())) with check ((select public.is_admin()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'credit_packages' and policyname = 'pkg_select_public') then
    create policy "pkg_select_public" on public.credit_packages for select
      to anon
      using (active = true);
  end if;
end $$;

-- ROLLBACK (restores the pre-0137 state exactly):
--   drop policy if exists "plans_select_public" on public.subscription_plans;
--   drop policy if exists "pkg_select_public" on public.credit_packages;
--   alter policy "plans_select" on public.subscription_plans to public using (active = true or public.is_admin());
--   alter policy "plans_admin_write" on public.subscription_plans to public using (public.is_admin()) with check (public.is_admin());
--   alter policy "pkg_select_active" on public.credit_packages to public using (active = true or public.is_admin());
--   alter policy "pkg_admin_write" on public.credit_packages to public using (public.is_admin()) with check (public.is_admin());
