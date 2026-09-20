-- THE HOMEPAGE STOPS BEING A MODE AND BECOMES A PAGE.
--
-- ─────────────────────────────────────────────────────────────────────────
-- PART 1 — WHY "/" IGNORED THE ADMIN PANEL. THE MEASURED CAUSE.
-- ─────────────────────────────────────────────────────────────────────────
--
-- Production state on 2026-09-20:
--   app_settings.homepage        = {"mode":"waitlist"}
--   cms_pages('premiera')        = published, kind='launch'
--   https://grovbase.com/        = the FULL landing (SiteHeader + BlockRenderer
--                                  over DEFAULT_HOME_BLOCKS), not the launch page
--
-- The admin panel and the public route read the SAME ROW and got DIFFERENT
-- ANSWERS, because they read it as different database roles.
--
--   set local role anon;
--   select count(*) from public.app_settings;
--   → ERROR 42501: permission denied for function is_admin
--
-- That is not a row filter. It is the whole SELECT failing. `settings_admin_write`
-- (migration 0008) is `for all ... using (is_admin())` with NO role clause, so it
-- applies to PUBLIC — including `anon`. Postgres OR-combines every permissive
-- policy into one expression and initialises every function in it, and `anon` has
-- had no EXECUTE on is_admin(uuid) since 0005. So an anonymous read of
-- app_settings raises instead of returning rows.
--
-- getHomepageMode() destructures `{ data }` and ignores `error`, so `data` is
-- null, so the mode reads as "full" — its deliberate "a broken setting must never
-- hide the product behind a signup form" default. An admin is `authenticated`,
-- has the EXECUTE grant, reads the row, and sees "Strona premiery" active.
--
-- THIS EXACT BUG WAS ALREADY FOUND AND FIXED ONCE. Migration 0051 carries the
-- diagnosis almost word for word — for cms_pages and cms_blocks. app_settings
-- was never given the same treatment, and 0107 rewrote the SELECT policy without
-- touching the FOR ALL one that actually raises. Part 2 applies 0051's fix here.
--
-- Everything anonymous that reads app_settings has therefore been running on its
-- defaults on production: the homepage mode, the social links, the platform
-- access flags, the registration config, the legacy launch copy. Recorded, not
-- separately "fixed" — one policy is the cause of all of them.
--
-- ─────────────────────────────────────────────────────────────────────────
-- PART 2 — app_settings: SPLIT THE POLICY BY ROLE (the 0051 fix).
-- ─────────────────────────────────────────────────────────────────────────
--
-- Granting anon EXECUTE on is_admin() would be the shorter fix and the wrong
-- one, for the reason 0051 gives: is_admin(uid) accepts ANY user id, so it
-- would answer "is this person an admin?" for anyone who knows a uuid. Scoping
-- the write policy to the role that actually writes costs nothing — anon never
-- writes here, and after this it cannot even try.
--
-- What changes: anon SELECT stops raising and returns the non-private rows,
-- which is what 0107 already said it should do.
-- What does not change: the three private rows stay hidden (Part 2 keeps
-- app_setting_is_private as the filter), admins keep reading everything through
-- settings_admin_write, and no role gains a write it did not have.

drop policy if exists "settings_admin_write" on public.app_settings;
create policy "settings_admin_write" on public.app_settings
  for all
  to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "settings_select_public" on public.app_settings;
create policy "settings_select_public" on public.app_settings
  for select
  to anon, authenticated
  using (not public.app_setting_is_private(key));

-- ─────────────────────────────────────────────────────────────────────────
-- PART 3 — ONE FLAG, ON THE PAGE ITSELF.
-- ─────────────────────────────────────────────────────────────────────────
--
-- Fixing Part 2 alone would make the binary switch work again. It would not make
-- it right: "which page answers /" was expressed TWICE — as an enum in
-- app_settings.homepage.mode, and as the literal slugs 'home' and 'premiera'
-- hardcoded in app/page.tsx, in the page list's badge, in its public-URL column
-- and in the delete guard. Two spellings of one fact is how they drift.
--
-- Checked before adding a column, because a column is not free: cms_pages has
-- id, slug, title, status, published_snapshot, published_at, updated_at,
-- created_at, kind, sort_order, seo, scheduled_at, updated_by, nav_group,
-- nav_order, header_mode, footer_mode, promo, template. None of them can carry
-- "this one is the front door" — `kind` is the page's TYPE (a launch page stays
-- a launch page whether or not it is live at /), and overloading sort_order or
-- nav_group would be the same two-spellings mistake in a new place.
--
-- The partial unique index is the real guarantee. "Exactly one homepage" is not
-- an application convention here; a second true row is refused by the database.

alter table public.cms_pages
  add column if not exists is_homepage boolean not null default false;

comment on column public.cms_pages.is_homepage is
  'The single page that answers "/". Enforced unique by cms_pages_one_homepage; set only through cms_set_homepage().';

create unique index if not exists cms_pages_one_homepage
  on public.cms_pages (is_homepage) where is_homepage;

-- ─────────────────────────────────────────────────────────────────────────
-- PART 4 — BACKFILL FROM THE SWITCH THAT IS BEING RETIRED.
-- ─────────────────────────────────────────────────────────────────────────
--
-- The flag inherits whatever the old enum meant, so nothing about the live site
-- changes at deploy time beyond the bug in Part 1 being gone:
--   mode = 'waitlist' → the launch page
--   otherwise         → 'home'
--
-- A page that is not LIVE is deliberately not flagged. The flag means "this page
-- is what a visitor gets", and a draft is not what a visitor gets — "/" falls
-- back to the built-in default layout exactly as it does today, and the panel
-- says so in as many words instead of showing a badge that the public contradicts.
-- On this production database mode is 'waitlist' and the launch page is
-- published, so exactly one row is flagged.
--
-- app_settings.homepage is LEFT IN PLACE and simply stops being read. Dropping a
-- settings row in the same migration that stops reading it makes a rollback a
-- data-loss event; this way rolling back the application alone restores the old
-- behaviour with the old value intact.

update public.cms_pages set is_homepage = true
where id = (
  select p.id from public.cms_pages p
  where (p.status = 'published'
         or (p.status = 'scheduled' and p.scheduled_at is not null and p.scheduled_at <= now()))
    and case
      when coalesce(
        (select s.value->>'mode' from public.app_settings s where s.key = 'homepage'), 'full'
      ) = 'waitlist'
      then p.kind = 'launch'
      else p.slug = 'home'
    end
  order by p.sort_order, p.created_at
  limit 1
);

-- ─────────────────────────────────────────────────────────────────────────
-- PART 5 — THE SWITCH ITSELF, AS ONE TRANSACTION.
-- ─────────────────────────────────────────────────────────────────────────
--
-- WHY THIS IS AN RPC AND NOT TWO UPDATES FROM THE SERVER ACTION.
-- With the unique index above, "clear the old one, set the new one" is only
-- correct as a single transaction: PostgREST gives each call its own, so two
-- calls leave a window with NO homepage — and if the second fails, the site is
-- left on the built-in default with no page flagged at all. One function, one
-- transaction, and "/" is never briefly nobody's.
--
-- SECURITY DEFINER is needed because the two UPDATEs must both land even though
-- the second momentarily competes with the index; the authorisation is not
-- weakened by it — is_admin() is checked INSIDE, on the caller's own JWT, and
-- EXECUTE is revoked from anon so an anonymous caller cannot reach the check at
-- all. This is the same shape as every other definer RPC in this schema.

create or replace function public.cms_set_homepage(p_page_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text;
  v_status text;
  v_scheduled timestamptz;
begin
  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  select slug, status, scheduled_at
    into v_slug, v_status, v_scheduled
    from public.cms_pages where id = p_page_id
    for update;

  if v_slug is null then
    raise exception 'missing' using errcode = 'P0002';
  end if;

  -- A draft cannot be the front door. Refusing here is what keeps the panel and
  -- "/" from ever disagreeing: the badge is only ever on a page a visitor can
  -- actually be served.
  if not (v_status = 'published'
          or (v_status = 'scheduled' and v_scheduled is not null and v_scheduled <= now())) then
    raise exception 'not_published' using errcode = 'P0001';
  end if;

  update public.cms_pages set is_homepage = false where is_homepage and id <> p_page_id;
  update public.cms_pages set is_homepage = true  where id = p_page_id;

  return v_slug;
end;
$$;

comment on function public.cms_set_homepage(uuid) is
  'Moves the single is_homepage flag to one page, atomically. Admin-only (checked inside on the caller''s JWT) and refuses a page that is not live.';

revoke execute on function public.cms_set_homepage(uuid) from public, anon;
grant execute on function public.cms_set_homepage(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- PART 6 — THE HOMEPAGE CANNOT BE TAKEN DOWN BY ACCIDENT.
-- ─────────────────────────────────────────────────────────────────────────
--
-- Unpublishing, archiving or deleting the page that answers "/" would recreate
-- the exact inconsistency this migration exists to remove — the panel showing a
-- homepage the public is not being served. The server actions refuse it too;
-- this is the version that holds no matter which client does the writing.
-- Clearing the flag first is always allowed, so nothing here is a dead end.

create or replace function public.cms_pages_homepage_stays_live()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_homepage then
      raise exception 'homepage_protected' using errcode = 'P0001';
    end if;
    return old;
  end if;

  -- The same liveness test cms_set_homepage applies, so a page cannot be
  -- flagged into a state the setter would have refused — including being
  -- scheduled forward, which would take "/" down until the date arrives.
  if new.is_homepage
     and not (new.status = 'published'
              or (new.status = 'scheduled' and new.scheduled_at is not null
                  and new.scheduled_at <= now())) then
    raise exception 'homepage_protected' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

comment on function public.cms_pages_homepage_stays_live() is
  'Refuses to unpublish, archive or delete the page that answers "/". Clear is_homepage first (or move it to another page with cms_set_homepage).';

drop trigger if exists cms_pages_homepage_stays_live on public.cms_pages;
create trigger cms_pages_homepage_stays_live
  before update or delete on public.cms_pages
  for each row execute function public.cms_pages_homepage_stays_live();

-- ROLLBACK:
--   drop trigger if exists cms_pages_homepage_stays_live on public.cms_pages;
--   drop function if exists public.cms_pages_homepage_stays_live();
--   drop function if exists public.cms_set_homepage(uuid);
--   drop index if exists public.cms_pages_one_homepage;
--   alter table public.cms_pages drop column if exists is_homepage;
--   -- Part 2 is independent and should NOT be rolled back with the rest: it is
--   -- the fix for the anonymous read, and reverting it re-breaks every public
--   -- app_settings read. If it must go back:
--   --   drop policy "settings_admin_write" on public.app_settings;
--   --   create policy "settings_admin_write" on public.app_settings for all
--   --     using (public.is_admin()) with check (public.is_admin());
