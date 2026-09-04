-- ONE CMS FOR EVERY PUBLIC PAGE.
--
-- The marketing menu had grown four entries that all edited "the public site"
-- in different ways: Strona główna (a mode switch), Strona WWW (block CMS),
-- Strona premiery (a flat field map in app_settings) and Media. This migration
-- makes cms_pages the single list behind all of it.
--
-- Nothing is deleted. app_settings.launch_page keeps its rows; the launch page
-- simply becomes a cms_pages row too, so it gains the draft → preview →
-- publish model the other pages already had.

-- ── 1. cms_pages learns what kind of page it is, and how to sort ──────────
-- 'standard' renders through the block renderer; 'launch' renders through the
-- bespoke pre-launch component. The column exists so the admin list and the
-- public router can tell them apart without hardcoding a slug.
alter table public.cms_pages
  add column if not exists kind text not null default 'standard',
  add column if not exists sort_order integer not null default 100;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cms_pages_kind_check'
  ) then
    alter table public.cms_pages
      add constraint cms_pages_kind_check check (kind in ('standard', 'launch'));
  end if;
end $$;

create index if not exists cms_pages_sort_idx on public.cms_pages (sort_order, created_at);

-- ── 2. The pages the panel promises ──────────────────────────────────────
-- Seeded as drafts: a draft page is invisible publicly, so creating the rows
-- changes nothing for visitors until an admin publishes one. `home` already
-- exists and only gains its ordering.
update public.cms_pages set sort_order = 0 where slug = 'home';

insert into public.cms_pages (slug, title, status, kind, sort_order)
values
  ('premiera',              'Strona premiery',      'draft', 'launch',   10),
  ('o-nas',                 'O nas',                'draft', 'standard', 20),
  ('faq',                   'FAQ',                  'draft', 'standard', 30),
  ('kontakt',               'Kontakt',              'draft', 'standard', 40),
  ('regulamin',             'Regulamin',            'draft', 'standard', 50),
  ('polityka-prywatnosci',  'Polityka prywatności', 'draft', 'standard', 60)
on conflict (slug) do nothing;

-- ── 3. Global public-site settings ───────────────────────────────────────
-- app_settings is world-readable by design (settings_select_all), which is
-- correct here: these are public profile links, printed on the page itself.
-- Nothing secret may ever be added to this row.
insert into public.app_settings (key, value)
values ('public_site', jsonb_build_object('instagram_url', '', 'facebook_url', ''))
on conflict (key) do nothing;
