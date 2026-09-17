-- THE MEDIA CATALOGUE IS NOT A PUBLIC LIST.
--
-- `media_assets` has been world-readable since it was created: one policy,
-- `media_read`, with `using (true)` for the `public` role. That made the whole
-- catalogue readable by anyone holding the publishable key — every title,
-- folder, tag and storage path, including assets no published page references.
-- The FILES are public by design (the `media` bucket is public); the LIST of
-- them was never meant to be.
--
-- Nothing legitimate needs that list anonymously:
--
--   · the admin media library and the picker both run as a signed-in admin;
--   · the public renderer needs width, height and variants for the images a
--     page already references, and reads them through cms_media_meta() (0088),
--     which takes known paths and returns nothing else. No listing, no search,
--     no enumeration.
--
-- SCOPED TO `authenticated`, NOT `public`. `media_admin_write` was also on the
-- public role, and `for all … using (is_admin())` applies to SELECT too —
-- so an anonymous read could end up evaluating is_admin(), which anon has no
-- EXECUTE on, and fail with a permission error instead of simply returning
-- nothing. That is the exact trap 0051 fixed for cms_pages; this is the same
-- fix for the same shape.

alter table public.media_assets enable row level security;

drop policy if exists "media_read" on public.media_assets;
drop policy if exists "media_read_authenticated" on public.media_assets;

-- One policy, one role, one rule: an admin sees the catalogue. Anonymous
-- visitors get no policy at all, which is what "not a public list" means.
create policy "media_read_authenticated" on public.media_assets for select
  to authenticated using (public.is_admin());

drop policy if exists "media_admin_write" on public.media_assets;
create policy "media_admin_write" on public.media_assets for all
  to authenticated using (public.is_admin()) with check (public.is_admin());
