-- ─────────────────────────────────────────────────────────────────────────
-- A SLOT WITH NO FILE IS NOT A SLOT THE RENDERER CAN USE.
-- ─────────────────────────────────────────────────────────────────────────
--
-- Found while running the smoke scenario on production: delete a file that a
-- slot points at, and `media_slots_resolve` still returns that slot — with
-- every file column null. The interface handles it correctly (lib/server/
-- media-slots.ts drops a row with no desktop URL, and the surface falls back
-- to the art it drew before), so nothing was ever broken on screen. But the
-- function was sending a row that, by its own contract, nothing can paint.
--
-- Two reasons to fix it at the source rather than leave it to the caller:
--
--   · WHAT COMES BACK SHOULD BE TRUE. "These are the slots to render" is a
--     clearer contract than "these are the slots, some of which you must
--     discard", and a future caller that forgets the second half gets a
--     broken image rather than a fallback.
--   · IT IS ON THE HOT PATH. Every dashboard asks for seven keys and every
--     tool catalogue for twenty. Rows nobody can use are bytes on every one
--     of those requests, forever.
--
-- `media_id` alone is not the test: a row may point at a file that has since
-- been deleted (the column is `on delete set null`) or at a row with neither
-- a stored path nor an external URL. So the guard is on the JOINED file,
-- which is the same thing the renderer checks.
--
-- The application-side guard STAYS. It is not redundant: it is what keeps the
-- customer's screen correct if this function is ever changed again.

create or replace function public.media_slots_resolve(p_keys text[])
returns table (
  slot_key text,
  media_type text,
  alt_text text,
  object_fit text,
  object_position text,
  autoplay boolean,
  muted boolean,
  loop boolean,
  controls boolean,
  desktop_path text,
  desktop_url text,
  desktop_width integer,
  desktop_height integer,
  desktop_variants jsonb,
  tablet_path text,
  tablet_url text,
  mobile_path text,
  mobile_url text,
  poster_path text,
  poster_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.slot_key,
    s.media_type,
    s.alt_text,
    s.object_fit,
    s.object_position,
    s.autoplay,
    s.muted,
    s.loop,
    s.controls,
    d.storage_path, d.external_url, d.width, d.height, d.variants,
    t.storage_path, t.external_url,
    m.storage_path, m.external_url,
    p.storage_path, p.external_url
  from public.media_slots s
  -- INNER on the desktop file now: a slot whose file is missing is a slot
  -- that renders its fallback, and the caller does not need to be told about
  -- it. The other three stay LEFT — they are genuinely optional.
  join public.media_assets d on d.id = s.media_id
  left join public.media_assets t on t.id = s.tablet_media_id
  left join public.media_assets m on m.id = s.mobile_media_id
  left join public.media_assets p on p.id = s.poster_media_id
  where
    -- Bounded, never a scan: at most the slots one screen paints.
    array_length(p_keys, 1) is not null
    and array_length(p_keys, 1) <= 200
    and s.slot_key = any (p_keys)
    -- A disabled slot is invisible to the renderer, which is what makes
    -- "switch it off" fall back to the built-in art.
    and s.enabled
    -- A file row with neither a stored object nor an external address points
    -- at nothing.
    and (d.storage_path is not null or d.external_url is not null);
$$;

-- Supabase re-grants EXECUTE to `public` by name on every create, so the
-- revoke has to name the roles explicitly — the trap 0083, 0086, 0088 and
-- 0090 all had to handle.
revoke all on function public.media_slots_resolve(text[]) from public, anon, authenticated;
grant execute on function public.media_slots_resolve(text[]) to anon, authenticated;
