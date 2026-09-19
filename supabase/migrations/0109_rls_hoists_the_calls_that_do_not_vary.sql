-- ============================================================================
-- 0109 — RLS: evaluate the per-STATEMENT checks once per statement (P1-33)
-- ============================================================================
--
-- WHAT THIS CHANGES: nothing about who can see what. Every policy below keeps
-- its command, its roles and its meaning. The only edit is wrapping two
-- ZERO-ARGUMENT calls in a scalar subquery so the planner hoists them into an
-- InitPlan and runs them once per statement instead of once per row:
--
--     public.is_admin()   ->  (select public.is_admin())
--     auth.uid()          ->  (select auth.uid())
--
-- Both answer a question about the CALLER, not about the row. Their value is
-- identical for every row a statement touches, so evaluating them once is the
-- same answer computed fewer times. This is the standard Supabase guidance and
-- it is a planner hint, not a rule change.
--
-- WHAT IS DELIBERATELY NOT TOUCHED
--
--   public.is_workspace_member(workspace_id) stays exactly as it is. It takes
--   a COLUMN, so its answer genuinely varies per row and hoisting it would be
--   wrong, not merely slower. It is left alone in every policy below, which is
--   also why the gains here are modest: on a member's own rows that call
--   dominates and this change does not touch it.
--
--   The win is on the ADMIN path over large tables. In
--   `is_workspace_member(workspace_id) or is_admin()` the OR short-circuits, so
--   for an operator reading a table they are not a member of, the left side is
--   false on every row and is_admin() is called on every row. Hoisted, it is
--   called once — or, when the left side is true, never, because an InitPlan
--   that is never reached is never executed.
--
-- SCOPE: THE HIGH-GROWTH TABLES ONLY.
--   A repo-wide sweep found 133 policies with an unwrapped call. Rewriting all
--   of them would be a blind refactor of every data-access rule in the product
--   to save microseconds on tables that hold tens of rows. This migration
--   touches 16 policies on the tables that actually grow with usage:
--   generations and their assets and jobs, product images, the credit ledger's
--   read paths, usage events, notifications, and the three largest newsletter
--   tables. The rest are recorded in the finding and left alone.
--
-- WRITTEN AGAINST THE REPOSITORY, NOT AGAINST PRODUCTION.
--   Production is nine migrations behind this file (0099–0108 are not applied
--   there), so its live policy set is NOT the state this migration must edit.
--   Every expression below was derived by replaying supabase/migrations in
--   order. In particular: 0101 deliberately DROPPED usage_events_member_insert
--   to close the client write path into the ledger, and nothing here recreates
--   it. usage_events keeps exactly its read and admin-update policies.
--
-- ALTER, NOT DROP-AND-CREATE. `alter policy` changes only the expression and
-- cannot accidentally change the command or the roles, and it never leaves a
-- window in which the table is unprotected.

begin;

-- ── generations, assets, jobs ───────────────────────────────────────────────

alter policy gen_select on public.generations
  using (public.is_workspace_member(workspace_id) or (select public.is_admin()));

alter policy ga_select on public.generation_assets
  using (exists (
    select 1 from public.generations g
    where g.id = generation_id
      and (public.is_workspace_member(g.workspace_id) or (select public.is_admin()))
  ));

alter policy gj_select on public.generation_jobs
  using (public.is_workspace_member(workspace_id) or (select public.is_admin()));

alter policy gj_update on public.generation_jobs
  using (public.is_workspace_member(workspace_id) or (select public.is_admin()));

-- An INSERT policy carries WITH CHECK and no USING.
alter policy gj_insert on public.generation_jobs
  with check (public.is_workspace_member(workspace_id) and user_id = (select auth.uid()));

-- ── product images ──────────────────────────────────────────────────────────

alter policy pimg_select on public.product_images
  using (exists (
    select 1 from public.products p
    where p.id = product_id
      and (public.is_workspace_member(p.workspace_id) or (select public.is_admin()))
  ));

-- ── the credit ledger's READ paths ──────────────────────────────────────────
--
-- Reads only. Nothing here grants a write: balances still change exclusively
-- through public.apply_credit_transaction(), and no INSERT or UPDATE policy on
-- these tables is created, altered or implied by this migration.

alter policy wallet_select on public.credit_wallets
  using (public.is_workspace_member(workspace_id) or (select public.is_admin()));

alter policy ctx_select on public.credit_transactions
  using (exists (
    select 1 from public.credit_wallets w
    where w.id = wallet_id
      and (public.is_workspace_member(w.workspace_id) or (select public.is_admin()))
  ));

-- ── usage events ────────────────────────────────────────────────────────────
--
-- Exactly two policies, which is the whole set after 0101. There is no member
-- INSERT policy and this migration does not add one.

alter policy usage_events_member_read on public.usage_events
  using (public.is_workspace_member(workspace_id) or (select public.is_admin()));

alter policy usage_events_admin_update on public.usage_events
  using ((select public.is_admin()));

-- ── notifications ───────────────────────────────────────────────────────────

alter policy notifications_own_read on public.notifications
  using (user_id = (select auth.uid()));

alter policy notifications_own_update on public.notifications
  using (user_id = (select auth.uid()));

alter policy notifications_insert on public.notifications
  with check (user_id = (select auth.uid()) or (select public.is_admin()));

-- ── the three newsletter tables that grow per send ──────────────────────────
--
-- `for all` policies carry both a USING and a WITH CHECK, and both must be
-- altered or the halves would disagree — an admin able to read a row but not
-- to write the one they just read.

alter policy newsletter_contacts_admin on public.newsletter_contacts
  using ((select public.is_admin())) with check ((select public.is_admin()));

alter policy newsletter_recipients_admin on public.newsletter_recipients
  using ((select public.is_admin())) with check ((select public.is_admin()));

alter policy newsletter_events_admin on public.newsletter_events
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ── THE MIGRATION CHECKS ITS OWN WORK ───────────────────────────────────────
--
-- A policy rewrite that silently widened access would look exactly like a
-- successful migration, so this refuses to commit unless the result is what it
-- claims. Three things are asserted, all read back from the catalog:
--
--   1. every policy named above still exists;
--   2. none of them has a BARE zero-argument call left in either expression —
--      that is the change actually landing rather than being a no-op;
--   3. usage_events still has exactly its two policies, so this file cannot
--      have resurrected the client write path 0101 removed.
do $$
declare
  v_expected text[] := array[
    'generations.gen_select','generation_assets.ga_select',
    'generation_jobs.gj_select','generation_jobs.gj_update','generation_jobs.gj_insert',
    'product_images.pimg_select',
    'credit_wallets.wallet_select','credit_transactions.ctx_select',
    'usage_events.usage_events_member_read','usage_events.usage_events_admin_update',
    'notifications.notifications_own_read','notifications.notifications_own_update',
    'notifications.notifications_insert',
    'newsletter_contacts.newsletter_contacts_admin',
    'newsletter_recipients.newsletter_recipients_admin',
    'newsletter_events.newsletter_events_admin'
  ];
  v_name text;
  v_qual text;
  v_check text;
  v_count int;
begin
  foreach v_name in array v_expected loop
    select pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid)
      into v_qual, v_check
      from pg_policy p
      join pg_class c on c.oid = p.polrelid
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = split_part(v_name, '.', 1)
       and p.polname = split_part(v_name, '.', 2);

    if not found then
      raise exception '0109: policy % vanished', v_name;
    end if;

    /*
      A BARE CALL IS WHATEVER SURVIVES REMOVING THE HOISTED ONES.

      Postgres does not support lookbehind in its regex flavour, so "a call not
      preceded by SELECT" cannot be asked directly — the first draft of this
      block tried and would have failed at runtime. Instead the hoisted form,
      which the catalog prints as "( SELECT is_admin() AS is_admin)", is
      stripped out first; anything still matching afterwards is a genuine
      per-row call.
    */
    if regexp_replace(coalesce(v_qual, ''),
          '\( SELECT [a-z_.]*(is_admin|uid)\(\) AS [a-z_]+\)', '', 'gi')
         ~* '(is_admin\(\)|auth\.uid\(\))'
       or regexp_replace(coalesce(v_check, ''),
          '\( SELECT [a-z_.]*(is_admin|uid)\(\) AS [a-z_]+\)', '', 'gi')
         ~* '(is_admin\(\)|auth\.uid\(\))' then
      raise exception '0109: % still evaluates a caller-level call per row: using=% check=%',
        v_name, v_qual, v_check;
    end if;
  end loop;

  select count(*) into v_count
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'usage_events';
  if v_count <> 2 then
    raise exception '0109: usage_events has % policies, expected exactly 2 (read + admin update). '
      'Migration 0101 removed the client INSERT path and it must stay removed.', v_count;
  end if;
end $$;

commit;
