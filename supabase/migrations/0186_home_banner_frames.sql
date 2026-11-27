-- /HOME UPGRADE (27.11.2026): the three promo banners get a tablet file of
-- their own, a phone shape (1:1 or 5:4) and an adjustable background dimming.
--
-- ADDITIVE ONLY. Nothing is renamed, dropped or rewritten, and no row changes:
--   · the tablet file uses the column media_slots has had since 0090
--     (tablet_media_id) — media_slots_write already writes it;
--   · the frame column `crop` (0141) may now also hold
--       t   the tablet file's frame — same shape as `m` (x, y 0–100, zoom 1–2.5),
--       pr  the banner's phone shape: '1:1' or '5:4',
--       ov  the background dimming: an integer 0–100 (% of the shipped gradient);
--     every value stored today stays valid (these keys are all optional);
--   · the frame reset (0141) drops `t` when the tablet file is swapped by a
--     writer that did not choose a new frame (Admin → Media), exactly as it
--     drops `m` for the phone file.
--
-- Rollback: re-run the 0141 definitions of media_crop_ok and
-- media_slots_crop_reset (strip t / pr / ov from any crop first:
--   update public.media_slots set crop = crop - 't' - 'pr' - 'ov' where crop ?| array['t','pr','ov']).

create or replace function public.media_crop_ok(c jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select c is null or (
    jsonb_typeof(c) = 'object'
    and jsonb_typeof(c -> 'x') = 'number' and jsonb_typeof(c -> 'y') = 'number' and jsonb_typeof(c -> 'zoom') = 'number'
    and (c ->> 'x')::numeric between 0 and 100 and (c ->> 'y')::numeric between 0 and 100
    and (c ->> 'zoom')::numeric between 1 and 2.5
    and (c - 'x' - 'y' - 'zoom' - 'm' - 't' - 'pr' - 'ov') = '{}'::jsonb
    and (not (c ? 'm') or (
      jsonb_typeof(c -> 'm') = 'object'
      and jsonb_typeof(c -> 'm' -> 'x') = 'number' and jsonb_typeof(c -> 'm' -> 'y') = 'number'
      and jsonb_typeof(c -> 'm' -> 'zoom') = 'number'
      and (c -> 'm' ->> 'x')::numeric between 0 and 100 and (c -> 'm' ->> 'y')::numeric between 0 and 100
      and (c -> 'm' ->> 'zoom')::numeric between 1 and 2.5
      and ((c -> 'm') - 'x' - 'y' - 'zoom') = '{}'::jsonb))
    and (not (c ? 't') or (
      jsonb_typeof(c -> 't') = 'object'
      and jsonb_typeof(c -> 't' -> 'x') = 'number' and jsonb_typeof(c -> 't' -> 'y') = 'number'
      and jsonb_typeof(c -> 't' -> 'zoom') = 'number'
      and (c -> 't' ->> 'x')::numeric between 0 and 100 and (c -> 't' ->> 'y')::numeric between 0 and 100
      and (c -> 't' ->> 'zoom')::numeric between 1 and 2.5
      and ((c -> 't') - 'x' - 'y' - 'zoom') = '{}'::jsonb))
    and (not (c ? 'pr') or (jsonb_typeof(c -> 'pr') = 'string' and c ->> 'pr' in ('1:1', '5:4')))
    and (not (c ? 'ov') or (
      jsonb_typeof(c -> 'ov') = 'number'
      and (c ->> 'ov')::numeric = trunc((c ->> 'ov')::numeric)
      and (c ->> 'ov')::numeric between 0 and 100))
  );
$$;

create or replace function public.media_slots_crop_reset()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.media_id is distinct from old.media_id
     and new.crop is not distinct from old.crop
     and coalesce(current_setting('ice.crop_explicit', true), '') <> 'on' then
    new.crop := null;
  end if;
  if new.mobile_media_id is distinct from old.mobile_media_id
     and new.crop is not null and new.crop ? 'm'
     and coalesce(current_setting('ice.crop_explicit', true), '') <> 'on' then
    new.crop := new.crop - 'm';
  end if;
  if new.tablet_media_id is distinct from old.tablet_media_id
     and new.crop is not null and new.crop ? 't'
     and coalesce(current_setting('ice.crop_explicit', true), '') <> 'on' then
    new.crop := new.crop - 't';
  end if;
  return new;
end;
$$;
