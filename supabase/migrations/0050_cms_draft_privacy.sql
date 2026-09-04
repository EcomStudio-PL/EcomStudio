-- DRAFTS ARE NOT PUBLIC.
--
-- cms_pages and cms_blocks were both `select using (true)`. That was tolerable
-- while `home` was the only row and its draft was the same marketing copy as
-- its published snapshot. It stopped being tolerable the moment the panel
-- gained six more pages, because "Szkic" now means work in progress — an
-- unreleased Regulamin, a launch page being rewritten — and anyone could read
-- it straight off the REST API without ever loading the site.
--
-- The app already refused to RENDER a draft. This makes the database refuse to
-- HAND IT OVER, which is where the rule belongs.

-- Published pages stay world-readable: the homepage reads its snapshot with an
-- anonymous client, and that must keep working.
drop policy if exists "cms_pages_read" on public.cms_pages;
create policy "cms_pages_read" on public.cms_pages for select
  using (status = 'published' or public.is_admin());

-- Blocks are the DRAFT surface by definition — the public site never reads
-- them, it reads the snapshot on the page row. Only an admin needs them.
drop policy if exists "cms_blocks_read" on public.cms_blocks;
create policy "cms_blocks_read" on public.cms_blocks for select
  using (public.is_admin());
