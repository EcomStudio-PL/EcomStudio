-- 0141 — INLINE CONTENT EDITOR: per-key text overrides, one history, slot framing.
--
-- The visual editor lets an admin click a heading, a description, a picture or
-- a clip on a real page and change it. It adds NO second CMS and NO second
-- media library:
--
--   · PICTURES AND CLIPS stay in media_assets and are assigned through
--     media_slots, as every other picture in the app already is. Two
--     additions only: a nullable `crop` (the frame the admin chose — focal
--     point and zoom, applied at render time, never to the file) and the
--     same `crop` in `media_slots_resolve`'s answer.
--   · PUBLIC CMS PAGES keep cms_blocks / cms_page_versions; nothing here.
--   · TEXT ON THE CODE-RENDERED PAGES (/home, /plany, /tools, a tool's own
--     page) has exactly one source today: the shipped dictionaries. There is
--     no table to write to, so one is added — `content_overrides`, one row per
--     edited (i18n key, locale), holding only what an admin actually changed.
--     No row = the dictionary's own text, exactly as before.
--
-- 1. content_overrides — admin-only table; customers read the published
--    values through `content_overrides_published()` (definer, three columns),
--    the pattern of tool_search_tags() and media_slots_resolve().
-- 2. content_versions — the history of every editor write (text and slot):
--    who, when, which key and locale, the value before and after. Append-only:
--    no update or delete policy exists for anyone.
-- 3. media_slots.crop + media_slots_resolve re-created with it (same body,
--    same 200-key bound, same grants; one more OUT column, so drop + create in
--    this transaction — old code reads the columns it knows and ignores it).
-- 4. Two write functions, SECURITY INVOKER (RLS still decides who may write):
--    compare-and-set on updated_at, so two admins can never silently
--    overwrite each other, and the history row lands in the SAME transaction
--    as the change it describes.
--
-- ADDITIVE: no table, column, row, policy or grant that exists today is
-- dropped or rewritten, apart from the one function re-created in 3. No
-- storage object or bucket is touched.
--
-- APPLY BEFORE OR AFTER THE DEPLOY — either order is safe: the code treats a
-- missing table/function as "no overrides" and a missing `crop` as no crop.
--
-- ROLLBACK (manual, in this order):
--   drop function if exists public.media_slot_write(text, text, text, text, text, uuid, uuid, uuid, uuid, text, text, text, jsonb, timestamptz, text);
--   drop function if exists public.content_override_write(text, text, text, timestamptz, text);
--   drop function if exists public.content_overrides_published();
--   -- re-create media_slots_resolve from 0091 (drop the crop column first):
--   drop function if exists public.media_slots_resolve(text[]);  -- then run 0091's create + grants
--   alter table public.media_slots drop column if exists crop;
--   drop table if exists public.content_versions;
--   drop table if exists public.content_overrides;

-- 1 ─────────────────────────────────────────────────────────────────────────
create table if not exists public.content_overrides (
  key text not null check (key ~ '^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$' and length(key) <= 160),
  locale text not null check (locale in ('pl', 'en', 'de')),
  value text not null check (length(value) between 1 and 2000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  primary key (key, locale)
);

alter table public.content_overrides enable row level security;

drop policy if exists content_overrides_admin on public.content_overrides;
create policy content_overrides_admin on public.content_overrides
  for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- What every visitor's page needs and nothing more: key, locale, text. The
-- texts are already public the moment they render; who wrote them is not.
create or replace function public.content_overrides_published()
returns table (key text, locale text, value text)
language sql
stable
security definer
set search_path = public
as $$
  select o.key, o.locale, o.value from public.content_overrides o;
$$;

revoke all on function public.content_overrides_published() from public, anon, authenticated;
grant execute on function public.content_overrides_published() to anon, authenticated;

-- 2 ─────────────────────────────────────────────────────────────────────────
create table if not exists public.content_versions (
  id uuid primary key default gen_random_uuid(),
  target text not null check (target in ('text', 'slot')),
  key text not null check (length(key) between 1 and 200),
  locale text check (locale is null or locale in ('pl', 'en', 'de')),
  action text not null check (action in ('save', 'reset', 'restore', 'clear', 'bulk')),
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null
);

create index if not exists content_versions_key_idx
  on public.content_versions (target, key, locale, created_at desc);
create index if not exists content_versions_recent_idx
  on public.content_versions (created_at desc);

alter table public.content_versions enable row level security;

drop policy if exists content_versions_admin_read on public.content_versions;
create policy content_versions_admin_read on public.content_versions
  for select to authenticated
  using ((select public.is_admin()));

drop policy if exists content_versions_admin_insert on public.content_versions;
create policy content_versions_admin_insert on public.content_versions
  for insert to authenticated
  with check ((select public.is_admin()) and created_by = (select auth.uid()));

-- 3 ─────────────────────────────────────────────────────────────────────────
alter table public.media_slots add column if not exists crop jsonb;

alter table public.media_slots drop constraint if exists media_slots_crop_check;
alter table public.media_slots add constraint media_slots_crop_check check (
  crop is null or (
    jsonb_typeof(crop) = 'object'
    and jsonb_typeof(crop -> 'x') = 'number' and jsonb_typeof(crop -> 'y') = 'number'
    and jsonb_typeof(crop -> 'zoom') = 'number'
    and (crop ->> 'x')::numeric between 0 and 100
    and (crop ->> 'y')::numeric between 0 and 100
    and (crop ->> 'zoom')::numeric between 1 and 4
    and crop - 'x' - 'y' - 'zoom' = '{}'::jsonb
  )
);

drop function if exists public.media_slots_resolve(text[]);
create function public.media_slots_resolve(p_keys text[])
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
  poster_url text,
  crop jsonb
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
    p.storage_path, p.external_url,
    s.crop
  from public.media_slots s
  join public.media_assets d on d.id = s.media_id
  left join public.media_assets t on t.id = s.tablet_media_id
  left join public.media_assets m on m.id = s.mobile_media_id
  left join public.media_assets p on p.id = s.poster_media_id
  where
    array_length(p_keys, 1) is not null
    and array_length(p_keys, 1) <= 200
    and s.slot_key = any (p_keys)
    and s.enabled
    and (d.storage_path is not null or d.external_url is not null);
$$;

revoke all on function public.media_slots_resolve(text[]) from public, anon, authenticated;
grant execute on function public.media_slots_resolve(text[]) to anon, authenticated;

-- 4 ─────────────────────────────────────────────────────────────────────────
-- TEXT: set (p_value) or remove (p_value null = back to the dictionary) one
-- key's override in one locale, only if nobody changed it since the admin
-- loaded it (p_base = the updated_at they saw; null = "there was none").
create or replace function public.content_override_write(
  p_key text, p_locale text, p_value text, p_base timestamptz, p_action text
)
returns timestamptz
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old public.content_overrides%rowtype;
  v_had boolean;
  v_now timestamptz := clock_timestamp();
begin
  if p_action not in ('save', 'reset', 'restore') then raise exception 'bad_action'; end if;
  select * into v_old from public.content_overrides where key = p_key and locale = p_locale for update;
  v_had := found;
  if v_had then
    if p_base is null or v_old.updated_at <> p_base then raise exception 'conflict'; end if;
  elsif p_base is not null then
    raise exception 'conflict';
  end if;

  if p_value is null then
    if v_had then delete from public.content_overrides where key = p_key and locale = p_locale; end if;
  elsif v_had then
    update public.content_overrides set value = p_value, updated_at = v_now, updated_by = auth.uid()
      where key = p_key and locale = p_locale;
  else
    insert into public.content_overrides (key, locale, value, updated_at, updated_by)
      values (p_key, p_locale, p_value, v_now, auth.uid());
  end if;

  insert into public.content_versions (target, key, locale, action, before, after, created_by)
  values ('text', p_key, p_locale, p_action,
    case when v_had then jsonb_build_object('value', v_old.value, 'updated_at', v_old.updated_at) end,
    case when p_value is not null then jsonb_build_object('value', p_value, 'updated_at', v_now) end,
    auth.uid());

  return case when p_value is null then null else v_now end;
end;
$$;

revoke all on function public.content_override_write(text, text, text, timestamptz, text) from public, anon;
grant execute on function public.content_override_write(text, text, text, timestamptz, text) to authenticated;

-- SLOT: assign / re-frame / un-assign one slot, compare-and-set on updated_at.
-- The row is created on first use (identity columns come from the code's slot
-- registry); un-assigning keeps the row (media null → the page's own fallback)
-- and never touches a file.
create or replace function public.media_slot_write(
  p_slot_key text, p_entity_type text, p_entity_id text, p_slot_name text,
  p_media_type text, p_media_id uuid, p_tablet_media_id uuid, p_mobile_media_id uuid, p_poster_media_id uuid,
  p_alt_text text, p_object_fit text, p_object_position text, p_crop jsonb,
  p_base timestamptz, p_action text
)
returns timestamptz
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_old public.media_slots%rowtype;
  v_now timestamptz := clock_timestamp();
  v_before jsonb;
  v_after jsonb;
begin
  if p_action not in ('save', 'restore', 'clear', 'bulk') then raise exception 'bad_action'; end if;
  select * into v_old from public.media_slots where slot_key = p_slot_key for update;
  if found then
    if p_base is null or v_old.updated_at <> p_base then raise exception 'conflict'; end if;
    v_before := jsonb_build_object(
      'media_type', v_old.media_type, 'media_id', v_old.media_id, 'tablet_media_id', v_old.tablet_media_id,
      'mobile_media_id', v_old.mobile_media_id, 'poster_media_id', v_old.poster_media_id,
      'alt_text', v_old.alt_text, 'object_fit', v_old.object_fit, 'object_position', v_old.object_position,
      'crop', v_old.crop, 'updated_at', v_old.updated_at);
    update public.media_slots set
      media_type = p_media_type, media_id = p_media_id, tablet_media_id = p_tablet_media_id,
      mobile_media_id = p_mobile_media_id, poster_media_id = p_poster_media_id,
      alt_text = p_alt_text, object_fit = p_object_fit, object_position = p_object_position,
      crop = p_crop, updated_at = v_now, updated_by = auth.uid()
    where slot_key = p_slot_key;
  else
    if p_base is not null then raise exception 'conflict'; end if;
    insert into public.media_slots (slot_key, entity_type, entity_id, slot_name, media_type, media_id,
      tablet_media_id, mobile_media_id, poster_media_id, alt_text, object_fit, object_position, crop,
      updated_at, updated_by)
    values (p_slot_key, p_entity_type, p_entity_id, p_slot_name, p_media_type, p_media_id,
      p_tablet_media_id, p_mobile_media_id, p_poster_media_id, p_alt_text, p_object_fit, p_object_position, p_crop,
      v_now, auth.uid());
  end if;
  v_after := jsonb_build_object(
    'media_type', p_media_type, 'media_id', p_media_id, 'tablet_media_id', p_tablet_media_id,
    'mobile_media_id', p_mobile_media_id, 'poster_media_id', p_poster_media_id,
    'alt_text', p_alt_text, 'object_fit', p_object_fit, 'object_position', p_object_position,
    'crop', p_crop, 'updated_at', v_now);
  insert into public.content_versions (target, key, locale, action, before, after, created_by)
  values ('slot', p_slot_key, null, p_action, v_before, v_after, auth.uid());
  return v_now;
end;
$$;

revoke all on function public.media_slot_write(text, text, text, text, text, uuid, uuid, uuid, uuid, text, text, text, jsonb, timestamptz, text) from public, anon;
grant execute on function public.media_slot_write(text, text, text, text, text, uuid, uuid, uuid, uuid, text, text, text, jsonb, timestamptz, text) to authenticated;
