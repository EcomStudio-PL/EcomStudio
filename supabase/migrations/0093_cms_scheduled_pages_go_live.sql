-- A SCHEDULED PAGE HAS TO ACTUALLY APPEAR.
--
-- `cms_pages.scheduled_at` and the `scheduled` status have existed since 0085,
-- and nothing ever made them do anything: the read policy admits `published`
-- and only `published`, so a page scheduled for Friday stayed invisible on
-- Friday, on Saturday, and until somebody pressed Publish by hand.
--
-- The fix is the policy, not a cron job. "Is this page live?" is a question
-- about the current time, and the database already knows the current time —
-- a scheduler would only be a second, lossier copy of the same fact, with an
-- outage window of its own. Here the page becomes readable the moment
-- `scheduled_at` passes, with nothing to run and nothing to fail.
--
-- WHAT DOES NOT CHANGE. Only a page an admin explicitly scheduled is affected:
-- `status = 'scheduled'` is set by the schedule action, which snapshots the
-- draft at the same moment. A draft stays a draft. Nothing is published
-- automatically that was not deliberately scheduled.

-- ── anon ─────────────────────────────────────────────────────────────────
-- Still no mention of is_admin() on this path — see 0051 for why that matters.
drop policy if exists "cms_pages_read_public" on public.cms_pages;
create policy "cms_pages_read_public" on public.cms_pages for select
  to anon
  using (
    status = 'published'
    or (status = 'scheduled' and scheduled_at is not null and scheduled_at <= now())
  );

-- ── authenticated ────────────────────────────────────────────────────────
drop policy if exists "cms_pages_read_authenticated" on public.cms_pages;
create policy "cms_pages_read_authenticated" on public.cms_pages for select
  to authenticated
  using (
    status = 'published'
    or (status = 'scheduled' and scheduled_at is not null and scheduled_at <= now())
    or public.is_admin()
  );
