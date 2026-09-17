-- THE PAGE BUILDER, ON TOP OF THE CMS THAT ALREADY EXISTS.
--
-- GrovBase already had cms_pages + cms_blocks + media_assets, a published
-- snapshot model and role-split RLS (0049–0051). Nothing here replaces any of
-- that. This migration adds the five things the builder needs and the old
-- editor never had:
--
--   1. per-section STYLE and RESPONSIVE overrides, so one page can look right
--      at 320 and at 1920 without a second page;
--   2. a CUSTOM CODE payload (html/css/js) whose JavaScript is off unless
--      somebody deliberately turns it on, per block;
--   3. VERSION HISTORY — a snapshot per publish, so a legal document can be
--      rolled back and the superseded text is never lost;
--   4. GLOBAL SECTIONS (header, footer, announcement bar, global CTA) shared
--      by every public page, with a per-page override;
--   5. real SEO columns, a scheduled-publish slot, and the media metadata a
--      picker needs to be usable (folder, tags, dimensions, variants).
--
-- NOTHING IS DELETED AND NOTHING IS RESET. Every statement is additive and
-- idempotent; existing rows keep their content, their snapshots and their
-- publish state. The waitlist page is a cms_pages row like any other and is
-- not touched by any statement below.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. cms_pages — SEO, scheduling, authorship, archiving
-- ─────────────────────────────────────────────────────────────────────────

alter table public.cms_pages
  -- Per-locale SEO: { "pl": { "title": …, "description": …, "ogTitle": …,
  -- "ogDescription": …, "ogImage": … }, "en": {…}, "de": {…} } plus the
  -- non-localized "canonical", "noindex", "nofollow".
  add column if not exists seo jsonb not null default '{}'::jsonb,
  -- When a SCHEDULED page should go live. Null for everything else.
  add column if not exists scheduled_at timestamptz,
  -- Who last saved a draft, for the "Autor zmian" column in the page list.
  add column if not exists updated_by uuid references public.profiles(id) on delete set null,
  -- Which footer group this page belongs to, so the footer is built from the
  -- page list rather than from ten hardcoded <Link>s.
  add column if not exists nav_group text,
  add column if not exists nav_order integer not null default 100;

-- draft → published was the whole vocabulary. SCHEDULED is a draft with a
-- date; ARCHIVED is a page taken out of the menus without being deleted, so
-- an old landing keeps its history instead of vanishing.
do $$
begin
  alter table public.cms_pages drop constraint if exists cms_pages_status_check;
  alter table public.cms_pages
    add constraint cms_pages_status_check
    check (status in ('draft', 'published', 'scheduled', 'archived'));
end $$;

-- A scheduled page without a date would never publish and never say why.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cms_pages_scheduled_needs_date') then
    alter table public.cms_pages
      add constraint cms_pages_scheduled_needs_date
      check (status <> 'scheduled' or scheduled_at is not null);
  end if;
end $$;

create index if not exists cms_pages_status_idx on public.cms_pages (status);
create index if not exists cms_pages_nav_idx on public.cms_pages (nav_group, nav_order)
  where nav_group is not null;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. THE SLUG GUARD
-- ─────────────────────────────────────────────────────────────────────────
--
-- /admin, /api, /auth, /dashboard and the rest are answered by real routes.
-- A cms_pages row claiming one of those slugs is not "shadowed" — it is a
-- page an admin can publish, preview and link to, which then 404s forever
-- because Next's matcher never reaches the catch-all. The app refuses those
-- slugs already; the database refuses them now too, which is where a rule
-- that must never be bypassed belongs.
create or replace function public.cms_slug_is_reserved(p_slug text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select lower(coalesce(p_slug, '')) = any (array[
    'api', 'auth', 'admin', 'login', 'register', 'logout',
    'home', 'dashboard', 'settings', 'generator', 'library', 'products',
    'prompts', 'history', 'credits', 'plan', 'tools', 'inspirations',
    'support', 'retusz', 'wideo', 'k', 'forgot-password', 'reset-password',
    'sitemap.xml', 'robots.txt', 'manifest.webmanifest', '_next', 'favicon.ico'
  ]);
$$;

-- `home` is grandfathered: it has existed since 0012 and is the homepage's own
-- row, read by slug and never served at /home. The constraint therefore fires
-- only on rows created from now on, which is what NOT VALID expresses exactly.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cms_pages_slug_not_reserved') then
    alter table public.cms_pages
      add constraint cms_pages_slug_not_reserved
      check (slug = 'home' or not public.cms_slug_is_reserved(slug)) not valid;
  end if;
end $$;

-- A slug also has to survive being put in a URL.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cms_pages_slug_shape') then
    alter table public.cms_pages
      add constraint cms_pages_slug_shape
      check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$') not valid;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. cms_blocks — style, responsive, custom code, analytics
-- ─────────────────────────────────────────────────────────────────────────

alter table public.cms_blocks
  -- { "base": { "paddingY": "lg", "bg": "surface", "align": "center", … },
  --   "md": {…}, "sm": {…},                       ← breakpoint overrides
  --   "hide": { "desktop": false, "tablet": false, "mobile": true } }
  add column if not exists style jsonb not null default '{}'::jsonb,
  -- { "html": "…", "css": "…", "js": "…", "jsEnabled": false }
  -- Only read by the `custom_code` section type. jsEnabled defaults to false
  -- in the application too — a block that runs script has to be asked for.
  add column if not exists code jsonb not null default '{}'::jsonb,
  -- The event name this section reports, e.g. homepage.hero.generate_click.
  add column if not exists analytics_id text,
  -- #anchor for in-page navigation and the legal table of contents.
  add column if not exists anchor text,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null;

create index if not exists cms_blocks_page_order_idx on public.cms_blocks (page_id, sort_order);

-- ─────────────────────────────────────────────────────────────────────────
-- 4. cms_page_versions — one row per publish, plus manual snapshots
-- ─────────────────────────────────────────────────────────────────────────
--
-- The page row holds ONE published snapshot; this holds every one that came
-- before it. Rolling back is copying a version's blocks back onto the draft,
-- so nothing is ever destroyed by a rollback either.
create table if not exists public.cms_page_versions (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.cms_pages(id) on delete cascade,
  -- 1, 2, 3 … per page. Unique, so two simultaneous publishes cannot both
  -- claim "version 7" and leave the history ambiguous.
  version integer not null,
  -- The blocks exactly as they were, including style/code/anchor.
  snapshot jsonb not null default '[]'::jsonb,
  seo jsonb not null default '{}'::jsonb,
  -- 'publish' | 'manual' | 'rollback' — why this version exists.
  reason text not null default 'publish',
  label text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  constraint cms_page_versions_unique unique (page_id, version),
  constraint cms_page_versions_reason_check check (reason in ('publish', 'manual', 'rollback'))
);

create index if not exists cms_page_versions_page_idx
  on public.cms_page_versions (page_id, version desc);

alter table public.cms_page_versions enable row level security;

-- History is the admin's own record. `anon` gets no policy at all and cannot
-- read superseded drafts of an unreleased document.
drop policy if exists "cms_page_versions_read" on public.cms_page_versions;
create policy "cms_page_versions_read" on public.cms_page_versions for select
  to authenticated using (public.is_admin());

drop policy if exists "cms_page_versions_write" on public.cms_page_versions;
create policy "cms_page_versions_write" on public.cms_page_versions for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────
-- 5. cms_global_sections — header, footer, announcement bar, global CTA
-- ─────────────────────────────────────────────────────────────────────────
--
-- Shared by every public page, edited once. A page may override one by
-- writing the same slot into its own blocks — that decision lives in the
-- renderer, not here.
--
-- PUBLIC PAGES ONLY. The signed-in dashboard and the admin panel have their
-- own layouts and must never read this table; there is nothing here that
-- could reach them.
create table if not exists public.cms_global_sections (
  id uuid primary key default gen_random_uuid(),
  slot text not null,
  type text not null,
  content jsonb not null default '{}'::jsonb,
  style jsonb not null default '{}'::jsonb,
  visible boolean not null default true,
  -- Same draft → publish model as a page: what a visitor sees is the
  -- snapshot, never the row being edited.
  published_snapshot jsonb,
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  constraint cms_global_sections_slot_unique unique (slot),
  constraint cms_global_sections_slot_check
    check (slot in ('header', 'footer', 'announcement', 'global_cta'))
);

alter table public.cms_global_sections enable row level security;

-- The published header and footer are printed on every public page, so an
-- anonymous visitor must be able to read them — but only the snapshot column
-- carries what they see, and a row that was never published shows nothing.
drop policy if exists "cms_global_read_public" on public.cms_global_sections;
create policy "cms_global_read_public" on public.cms_global_sections for select
  to anon using (visible = true);

drop policy if exists "cms_global_read_authenticated" on public.cms_global_sections;
create policy "cms_global_read_authenticated" on public.cms_global_sections for select
  to authenticated using (visible = true or public.is_admin());

drop policy if exists "cms_global_write" on public.cms_global_sections;
create policy "cms_global_write" on public.cms_global_sections for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.cms_global_sections (slot, type, visible)
values
  ('header',       'header',       true),
  ('footer',       'footer',       true),
  ('announcement', 'announcement', false),
  ('global_cta',   'global_cta',   false)
on conflict (slot) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. media_assets — what a media manager actually needs
-- ─────────────────────────────────────────────────────────────────────────
--
-- The table stored a path and a title. A picker that is meant to replace
-- typing URLs by hand needs to be searchable and to know the shape of the
-- image, because a renderer that does not know width and height cannot
-- reserve the box and the page jumps while it loads.
alter table public.media_assets
  add column if not exists folder text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists width integer,
  add column if not exists height integer,
  -- { "webp": { "1600": "path", "800": "path" }, "avif": {…} } — filled by
  -- the derivative route, absent until then. The original is never replaced.
  add column if not exists variants jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists media_assets_folder_idx on public.media_assets (folder, created_at desc);
create index if not exists media_assets_kind_idx on public.media_assets (kind, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 7. CMS SETTINGS
-- ─────────────────────────────────────────────────────────────────────────
--
-- Brand colours and typography for the PUBLIC site, defaulted to what
-- GrovBase already uses. Empty values mean "inherit the design system", which
-- is why the row ships empty rather than with a copy of the palette: a copy
-- would silently freeze the branding at today's values.
insert into public.app_settings (key, value)
values ('cms_design', jsonb_build_object(
  'primary', '', 'secondary', '',
  'bgDark', '', 'bgLight', '', 'textDark', '', 'textLight', '',
  'fontHeading', '', 'fontBody', '', 'scale', ''
))
on conflict (key) do nothing;
