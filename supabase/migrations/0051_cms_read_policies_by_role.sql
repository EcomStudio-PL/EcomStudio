-- FIX 0050: a signed-out visitor could not read ANY page.
--
-- 0050 wrote `using (status = 'published' or public.is_admin())` for the
-- `public` role, which includes `anon` — and `anon` has no EXECUTE on
-- is_admin(). Postgres does not promise to short-circuit an OR inside a policy,
-- so the check raised "permission denied for function is_admin" instead of
-- returning the published rows. The public site fell back to its built-in
-- defaults and any page an admin published would have 404'd.
--
-- The rule was right; the way it was expressed was not. Split it per role, so
-- the anonymous path never mentions is_admin() at all.

-- ── cms_pages ────────────────────────────────────────────────────────────
drop policy if exists "cms_pages_read" on public.cms_pages;
drop policy if exists "cms_pages_read_public" on public.cms_pages;
drop policy if exists "cms_pages_read_authenticated" on public.cms_pages;

-- Signed out: published pages only, and nothing to evaluate but a column.
create policy "cms_pages_read_public" on public.cms_pages for select
  to anon
  using (status = 'published');

-- Signed in: the same, plus everything for an admin.
create policy "cms_pages_read_authenticated" on public.cms_pages for select
  to authenticated
  using (status = 'published' or public.is_admin());

-- ── cms_blocks ───────────────────────────────────────────────────────────
-- Blocks are the draft surface; the public site reads the snapshot on the page
-- row and never touches this table, so anon simply gets no policy.
drop policy if exists "cms_blocks_read" on public.cms_blocks;
drop policy if exists "cms_blocks_read_authenticated" on public.cms_blocks;

create policy "cms_blocks_read_authenticated" on public.cms_blocks for select
  to authenticated
  using (public.is_admin());

-- ── The write policies, too ──────────────────────────────────────────────
-- `for all ... using (is_admin())` on the PUBLIC role also applies to SELECT,
-- and Postgres OR-combines every permissive policy into one expression with no
-- guaranteed evaluation order — so an anonymous read could still end up
-- executing is_admin() and failing on the missing EXECUTE grant.
--
-- Granting anon that EXECUTE would be the shorter fix and the wrong one:
-- is_admin(uid) accepts ANY user id, so it would answer "is this person an
-- admin?" for anyone who knows a uuid. Scoping the policy to the role that
-- actually writes costs nothing instead — anon never writes here.
drop policy if exists "cms_pages_admin_write" on public.cms_pages;
create policy "cms_pages_admin_write" on public.cms_pages for all
  to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "cms_blocks_admin_write" on public.cms_blocks;
create policy "cms_blocks_admin_write" on public.cms_blocks for all
  to authenticated
  using (public.is_admin()) with check (public.is_admin());
