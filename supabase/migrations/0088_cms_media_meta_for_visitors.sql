-- THE IMAGES ON A PUBLIC PAGE NEED THEIR OWN DIMENSIONS.
--
-- `media_assets` is admin-only, and correctly so: it is the catalogue, and a
-- stranger has no business listing every file we hold, including the ones no
-- published page references yet.
--
-- But the renderer reads that table for exactly two things — how big an image
-- is, and whether smaller copies of it exist — and it reads it with the
-- VISITOR'S client. So for every real visitor the query returned nothing,
-- which meant no width, no height and no srcset: every phone downloaded the
-- full-size original, and every image landed without its box reserved. The
-- feature was built and then switched off by a policy nobody thought to check
-- from the other side.
--
-- Granting anon a SELECT on the table would fix it and give away the
-- catalogue. This function fixes it and gives away nothing else: the caller
-- must already KNOW the storage path, which it only knows because a published
-- page references it. There is no listing, no search, and no way to enumerate.
-- Everything it returns describes a file that is already downloadable from a
-- public bucket.

create or replace function public.cms_media_meta(p_paths text[])
returns table (
  storage_path text,
  external_url text,
  width integer,
  height integer,
  variants jsonb,
  alt text
)
language sql
stable
security definer
set search_path = public
as $$
  select m.storage_path, m.external_url, m.width, m.height, m.variants, m.alt
  from public.media_assets m
  where
    -- A bounded lookup, never a scan: at most the images one page renders.
    array_length(p_paths, 1) is not null
    and array_length(p_paths, 1) <= 200
    and (m.storage_path = any (p_paths) or m.external_url = any (p_paths));
$$;

-- Supabase re-grants EXECUTE to `public` by name on create, so the revoke has
-- to name the roles explicitly (the same trap as 0083 and 0086).
revoke all on function public.cms_media_meta(text[]) from public, anon, authenticated;
grant execute on function public.cms_media_meta(text[]) to anon, authenticated;
