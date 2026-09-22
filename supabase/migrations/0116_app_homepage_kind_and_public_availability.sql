-- ============================================================================
-- 0116 — "/" MAY BE THE PRODUCT ITSELF, AND A STRANGER MAY BE TOLD THE TRUTH
--        ABOUT WHAT IS SWITCHED ON.
--
-- Two changes, both required by the same page and neither useful without the
-- other.
--
-- ─── 1. A THIRD PAGE KIND ───────────────────────────────────────────────────
--
-- `cms_pages.kind` has been 'standard' | 'launch' since the builder shipped.
-- "/" resolves through `is_homepage` and then branches on that kind:
--
--     kind 'launch'  → the pre-launch / waitlist page
--     anything else  → the page's authored CMS blocks in the site chrome
--
-- The new front door is neither. It is the PRODUCT — the tool catalogue, the
-- generator box and the category rows — rendered from lib/features.ts,
-- lib/categories.ts and lib/tool-cards.ts, which is to say from the same
-- registries the signed-in application runs on. It is not authored, so it is
-- not a bag of blocks; it is not a marketing page, so it does not wear the
-- marketing chrome.
--
-- WHY A KIND AND NOT A NEW FLAG. Because the question "what is at /" already
-- has exactly one answer in this schema — `is_homepage`, with a unique index
-- behind it — and that answer must keep having one place. A second boolean, a
-- setting in app_settings or a hard-coded branch in the route would be the
-- two-systems bug this project has already paid for once (see 0104, where
-- app_settings.homepage and cms_pages disagreed and the panel lied about it).
-- Widening an existing enum keeps one resolver, one flag, one admin control
-- and one "Ustaw jako stronę główną" button.
--
-- NOTHING IS FLAGGED BY THIS MIGRATION. It widens a CHECK constraint and
-- stops. Which page is the homepage stays whatever an operator last chose —
-- today the launch page — and changing it remains a deliberate act in the
-- admin panel rather than a side effect of a deploy.
--
-- ─── 2. ANON MAY READ feature_availability ──────────────────────────────────
--
-- THE BUG THIS PREVENTS, FOUND BEFORE THE PAGE SHIPPED RATHER THAN AFTER.
--
-- The switchboard is read by getAvailabilityMap(), which overlays the stored
-- rows on top of the registry defaults. Its read policy is:
--
--     feature_availability_read   FOR SELECT   TO authenticated   USING (true)
--
-- `TO authenticated`. An anonymous visitor therefore matches no policy, gets
-- ZERO ROWS — no error, just nothing — and every module falls back to its
-- registry default. On production today that turns
--
--     image_social, image_mailing, image_inne, video   COMING_SOON
--
-- into ACTIVE for exactly the people who are not logged in. The public
-- homepage would advertise four modules as ready, a stranger would click one,
-- and the page behind it would tell them it is not ready yet. That is the
-- "visible button that does nothing" this codebase treats as release-blocking,
-- and it would appear ONLY for logged-out visitors, which is the hardest
-- possible place to notice it.
--
-- The table holds no personal data and no secret: it is a list of module names
-- and the words "active", "coming soon", "maintenance". The menu shows it to
-- every signed-in customer already. Making the same list readable by a visitor
-- who has not signed in yet reveals nothing new and is the only way the public
-- surface can be honest.
--
-- WRITES ARE UNTOUCHED. Insert, update and delete stay `is_admin()`; only the
-- SELECT side widens.
-- ============================================================================

-- ─── 1 ───────────────────────────────────────────────────────────────────────

alter table public.cms_pages drop constraint if exists cms_pages_kind_check;

alter table public.cms_pages
  add constraint cms_pages_kind_check
  check (kind = any (array['standard'::text, 'launch'::text, 'app'::text]));

comment on column public.cms_pages.kind is
  'What the route renders for this page. standard = its authored CMS blocks in '
  'the site chrome. launch = the pre-launch / waitlist page. app = the product '
  'surface itself (tool catalogue, generator, categories), rendered from the '
  'feature and category registries rather than from authored blocks — so a CMS '
  'edit can never change what the product screen offers.';

-- ─── 2 ───────────────────────────────────────────────────────────────────────

-- Replaced rather than added to: two SELECT policies on one table are two
-- answers to one question, and the next person to read this would have to work
-- out which one wins. One policy, PUBLIC, same predicate.
drop policy if exists feature_availability_read on public.feature_availability;

create policy feature_availability_read
  on public.feature_availability
  for select
  to public
  using (true);

comment on table public.feature_availability is
  'Which modules are active, coming soon, in maintenance or switched off. '
  'READABLE BY EVERYONE ON PURPOSE: the public homepage renders the same tool '
  'catalogue the signed-in menu does, and a visitor who is told a module is '
  'ready when an operator has marked it "Wkrótce" has been lied to by the '
  'product. The rows are module names and states — no personal data, no '
  'secret. Writes remain admin-only.';
