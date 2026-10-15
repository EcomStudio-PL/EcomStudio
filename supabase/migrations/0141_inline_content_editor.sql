-- 0141 — INLINE CONTENT EDITOR: text overrides, one history for every writer, slot framing.
--
-- The visual editor lets an admin click a heading, a description, a picture or
-- a clip on a real page and change it. It adds NO second CMS and NO second
-- media library:
--
--   · PICTURES AND CLIPS stay in media_assets and are assigned through
--     media_slots, as every other picture already is. Added: `crop` (the
--     frame the admin chose — focal point and zoom, applied at render time,
--     never to the file) and `alt_i18n` (alt text per language).
--   · PUBLIC CMS PAGES keep cms_blocks / cms_pages / cms_page_versions. Added:
--     `cms_inline_patch`, which changes ONE field of ONE published block and
--     writes the page version first, like publishing does.
--   · TEXT ON THE CODE-RENDERED PAGES (/home, /plany, /tools, a tool's page)
--     has exactly one source today: the shipped dictionaries. There is no
--     table to write to, so one is added — `content_overrides`, one row per
--     edited (i18n key, locale), holding only what an admin changed. No row =
--     the dictionary's text, exactly as before.
--
-- 1. content_overrides — admins may READ it; nobody may write it directly.
--    The only writer is content_override_write() (definer): it checks the
--    role, refuses invisible / markup / control characters and over-long
--    text, compares-and-sets, and writes history. Visitors read the published
--    values through content_overrides_published() (definer, three columns).
-- 2. content_versions — the history: who, when, which key and locale, the
--    value before and after. Append-only (no update or delete policy). Rows
--    are written by TRIGGERS on content_overrides and media_slots, so every
--    writer leaves history — the editor, Admin → Media's save / clear /
--    "replace everywhere", or anything else.
-- 3. media_slots.crop + media_slots.alt_i18n, a trigger that drops a crop
--    framed for a different picture, and media_slots_resolve_v2 — the same
--    resolver plus the new columns. media_slots_resolve itself is left exactly
--    as it is (the running code keeps calling it until the new code ships).
-- 4. media_slots_write(jsonb) — every slot of a pair or a bulk upload in ONE
--    transaction, each compare-and-set on updated_at. RLS still decides who
--    writes (invoker), plus an explicit role check.
-- 5. cms_inline_patch(...) — one field of one published CMS block (definer,
--    explicit role check: it also writes the history row).
--
-- PURELY ADDITIVE: no DROP of any kind. No table, column, row, policy,
-- function or grant that exists today is dropped or rewritten. Re-runnable:
-- every object is created only when missing (or created-or-replaced). No
-- storage object, bucket or storage policy is touched.
--
-- APPLY BEFORE THE CODE DEPLOY that uses it (the editor reads the new columns
-- directly). The pages themselves treat a missing function as "no overrides".
--
-- ROLLBACK (manual, in this order):
--   drop trigger if exists content_overrides_history on public.content_overrides;
--   drop trigger if exists media_slots_history on public.media_slots;
--   drop trigger if exists media_slots_crop_reset on public.media_slots;
--   drop function if exists public.cms_inline_patch(uuid, text[], text, text, text, timestamptz, text);
--   drop function if exists public.media_slots_write(jsonb, text);
--   drop function if exists public.content_override_write(text, text, text, timestamptz, text);
--   drop function if exists public.content_overrides_published();
--   drop function if exists public.content_versions_record();
--   drop function if exists public.media_slots_crop_reset();
--   drop function if exists public.media_slots_resolve_v2(text[]);
--   alter table public.media_slots drop constraint if exists media_slots_crop_check,
--     drop constraint if exists media_slots_alt_i18n_check;
--   alter table public.media_slots drop column if exists crop, drop column if exists alt_i18n;
--   drop function if exists public.media_crop_ok(jsonb);
--   drop function if exists public.media_alt_i18n_ok(jsonb);
--   drop table if exists public.content_versions;
--   drop table if exists public.content_overrides;
--   drop function if exists public.content_text_ok(text);

set local lock_timeout = '3s';

-- shared: what no edited text may contain ───────────────────────────────────
-- Invisible and direction-changing characters (zero-width, joiners, bidi
-- embeddings, isolates and the Arabic letter mark, word joiner, BOM, soft
-- hyphen, the combining grapheme joiner, Hangul and halfwidth fillers, Khmer
-- inherent vowels, the Mongolian vowel separator, Unicode TAG characters),
-- line/paragraph separators, C0/C1 controls other than a newline, and markup
-- brackets.
create or replace function public.content_text_ok(p text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p is not null
    and p !~ '[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\u3164\uFEFF\uFFA0<>]'
    and p !~ '[\U000E0000-\U000E007F]';
$$;

-- 1 ─────────────────────────────────────────────────────────────────────────
create table if not exists public.content_overrides (
  key text not null check (key ~ '^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$' and length(key) <= 160),
  locale text not null check (locale in ('pl', 'en', 'de')),
  value text not null check (length(value) between 1 and 2000 and public.content_text_ok(value) and value !~ '[\r\n]'),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  primary key (key, locale)
);

alter table public.content_overrides enable row level security;

do $policy$ begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'content_overrides' and policyname = 'content_overrides_admin_read') then
    create policy content_overrides_admin_read on public.content_overrides
      for select to authenticated
      using ((select public.is_admin()));
  end if;
end $policy$;
-- No INSERT / UPDATE / DELETE policy: the write function below is the only door.

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
  target text not null check (target in ('text', 'slot', 'cms')),
  key text not null check (length(key) between 1 and 600),
  locale text check (locale is null or locale in ('pl', 'en', 'de')),
  action text not null check (action in ('save', 'reset', 'restore', 'clear', 'bulk', 'external')),
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

do $policy$ begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'content_versions' and policyname = 'content_versions_admin_read') then
    create policy content_versions_admin_read on public.content_versions
      for select to authenticated
      using ((select public.is_admin()));
  end if;
end $policy$;
-- No INSERT / UPDATE / DELETE policy: rows come from the triggers and
-- functions below (definer), never from a client.

-- The action a write was made as: set (transaction-local) by the write
-- functions; anything else writing the tables is recorded as 'external'.
create or replace function public.content_versions_record()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text := coalesce(nullif(current_setting('ice.action', true), ''), 'external');
  v_before jsonb;
  v_after jsonb;
begin
  if v_action not in ('save', 'reset', 'restore', 'clear', 'bulk', 'external') then v_action := 'external'; end if;
  if tg_table_name = 'content_overrides' then
    if tg_op <> 'INSERT' then v_before := jsonb_build_object('value', old.value, 'updated_at', old.updated_at); end if;
    if tg_op <> 'DELETE' then v_after := jsonb_build_object('value', new.value, 'updated_at', new.updated_at); end if;
    if v_before is not distinct from v_after then return null; end if;
    insert into public.content_versions (target, key, locale, action, before, after, created_by)
    values ('text', coalesce(new.key, old.key), coalesce(new.locale, old.locale), v_action, v_before, v_after, auth.uid());
  else
    if tg_op <> 'INSERT' then
      v_before := jsonb_build_object(
        'media_type', old.media_type, 'media_id', old.media_id, 'tablet_media_id', old.tablet_media_id,
        'mobile_media_id', old.mobile_media_id, 'poster_media_id', old.poster_media_id,
        'alt_text', old.alt_text, 'alt_i18n', old.alt_i18n, 'object_fit', old.object_fit,
        'object_position', old.object_position, 'crop', old.crop, 'enabled', old.enabled, 'updated_at', old.updated_at);
    end if;
    if tg_op <> 'DELETE' then
      v_after := jsonb_build_object(
        'media_type', new.media_type, 'media_id', new.media_id, 'tablet_media_id', new.tablet_media_id,
        'mobile_media_id', new.mobile_media_id, 'poster_media_id', new.poster_media_id,
        'alt_text', new.alt_text, 'alt_i18n', new.alt_i18n, 'object_fit', new.object_fit,
        'object_position', new.object_position, 'crop', new.crop, 'enabled', new.enabled, 'updated_at', new.updated_at);
    end if;
    if (v_before - 'updated_at') is not distinct from (v_after - 'updated_at') then return null; end if;
    insert into public.content_versions (target, key, locale, action, before, after, created_by)
    values ('slot', coalesce(new.slot_key, old.slot_key), null, v_action, v_before, v_after, auth.uid());
  end if;
  return null;
end;
$$;

revoke all on function public.content_versions_record() from public, anon, authenticated;

create or replace trigger content_overrides_history
  after insert or update or delete on public.content_overrides
  for each row execute function public.content_versions_record();

-- 3 ─────────────────────────────────────────────────────────────────────────
alter table public.media_slots add column if not exists crop jsonb;
alter table public.media_slots add column if not exists alt_i18n jsonb;

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
    and (c - 'x' - 'y' - 'zoom' - 'm') = '{}'::jsonb
    and (not (c ? 'm') or (
      jsonb_typeof(c -> 'm') = 'object'
      and jsonb_typeof(c -> 'm' -> 'x') = 'number' and jsonb_typeof(c -> 'm' -> 'y') = 'number'
      and jsonb_typeof(c -> 'm' -> 'zoom') = 'number'
      and (c -> 'm' ->> 'x')::numeric between 0 and 100 and (c -> 'm' ->> 'y')::numeric between 0 and 100
      and (c -> 'm' ->> 'zoom')::numeric between 1 and 2.5
      and ((c -> 'm') - 'x' - 'y' - 'zoom') = '{}'::jsonb))
  );
$$;

create or replace function public.media_alt_i18n_ok(a jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select a is null or (
    jsonb_typeof(a) = 'object'
    and (a - 'pl' - 'en' - 'de') = '{}'::jsonb
    and not exists (
      select 1 from jsonb_each(a) e
      where jsonb_typeof(e.value) <> 'string' or length(e.value #>> '{}') > 300
        or not public.content_text_ok(e.value #>> '{}') or (e.value #>> '{}') ~ '[\r\n]')
  );
$$;

do $constraint$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.media_slots'::regclass and conname = 'media_slots_crop_check') then
    alter table public.media_slots add constraint media_slots_crop_check check (public.media_crop_ok(crop));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.media_slots'::regclass and conname = 'media_slots_alt_i18n_check') then
    alter table public.media_slots add constraint media_slots_alt_i18n_check check (public.media_alt_i18n_ok(alt_i18n));
  end if;
end $constraint$;

-- A crop is framed for one picture. When a writer swaps the picture without
-- choosing a new frame (Admin → Media's save, "replace everywhere"), the old
-- frame is dropped instead of being applied to a picture it was never meant
-- for. The editor sets ice.crop_explicit when it sends a frame on purpose.
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
  return new;
end;
$$;

create or replace trigger media_slots_crop_reset
  before update on public.media_slots
  for each row execute function public.media_slots_crop_reset();

create or replace trigger media_slots_history
  after insert or update or delete on public.media_slots
  for each row execute function public.content_versions_record();

-- The resolver the pages read through, with the editor's columns. A new
-- name rather than a re-created media_slots_resolve: changing a function's
-- result columns needs a DROP, and the code running today keeps calling the
-- old one untouched (lib/server/media-slots.ts tries v2, then v1).
create or replace function public.media_slots_resolve_v2(p_keys text[])
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
  crop jsonb,
  alt_i18n jsonb,
  mobile_variants jsonb
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
    s.crop,
    s.alt_i18n,
    m.variants
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

revoke all on function public.media_slots_resolve_v2(text[]) from public, anon, authenticated;
grant execute on function public.media_slots_resolve_v2(text[]) to anon, authenticated;

-- 1 (continued) — the only writer of content_overrides ──────────────────────
-- p_value null = back to the dictionary's own text. p_base = the updated_at
-- the admin loaded (null = "there was no override"); a mismatch is 'conflict'.
create or replace function public.content_override_write(
  p_key text, p_locale text, p_value text, p_base timestamptz, p_action text
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.content_overrides%rowtype;
  v_had boolean;
  v_now timestamptz := clock_timestamp();
begin
  if not public.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  if p_action is null or p_action not in ('save', 'reset', 'restore') then raise exception 'bad_action'; end if;
  if p_value is not null and (length(p_value) not between 1 and 2000 or not public.content_text_ok(p_value) or p_value ~ '[\r\n]') then
    raise exception 'invalid_text';
  end if;
  perform set_config('ice.action', p_action, true);
  select * into v_old from public.content_overrides where key = p_key and locale = p_locale for update;
  v_had := found;
  if v_had then
    if p_base is null or v_old.updated_at <> p_base then raise exception 'conflict'; end if;
  elsif p_base is not null then
    raise exception 'conflict';
  end if;

  if p_value is null then
    if not v_had then raise exception 'noop'; end if;
    delete from public.content_overrides where key = p_key and locale = p_locale;
    return null;
  end if;
  if v_had then
    if v_old.value = p_value then raise exception 'noop'; end if;
    update public.content_overrides set value = p_value, updated_at = v_now, updated_by = auth.uid()
      where key = p_key and locale = p_locale;
  else
    begin
      insert into public.content_overrides (key, locale, value, updated_at, updated_by)
        values (p_key, p_locale, p_value, v_now, auth.uid());
    exception when unique_violation then
      raise exception 'conflict';
    end;
  end if;
  return v_now;
end;
$$;

revoke all on function public.content_override_write(text, text, text, timestamptz, text) from public, anon;
grant execute on function public.content_override_write(text, text, text, timestamptz, text) to authenticated;

-- 4 ─────────────────────────────────────────────────────────────────────────
-- p_writes: [{key, entity_type, entity_id, slot_name, media_type, media_id,
--   tablet_media_id, mobile_media_id, poster_media_id, alt_text, alt_i18n,
--   object_fit, object_position, crop, base}] — all or nothing. Returns
--   {key: new updated_at}.
create or replace function public.media_slots_write(p_writes jsonb, p_action text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  w jsonb;
  v_key text;
  v_base timestamptz;
  v_now timestamptz := clock_timestamp();
  v_old public.media_slots%rowtype;
  v_out jsonb := '{}'::jsonb;
begin
  if not public.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  if p_action is null or p_action not in ('save', 'restore', 'clear', 'bulk') then raise exception 'bad_action'; end if;
  if jsonb_typeof(p_writes) <> 'array' or jsonb_array_length(p_writes) = 0 or jsonb_array_length(p_writes) > 60 then
    raise exception 'bad_writes';
  end if;
  perform set_config('ice.action', p_action, true);
  perform set_config('ice.crop_explicit', 'on', true);
  -- Lock in key order: two bulk writes over overlapping slots cannot deadlock.
  for w in select value from jsonb_array_elements(p_writes) order by value ->> 'key' loop
    v_key := w ->> 'key';
    v_base := nullif(w ->> 'base', '')::timestamptz;
    select * into v_old from public.media_slots where slot_key = v_key for update;
    if found then
      if v_base is null or v_old.updated_at <> v_base then raise exception 'conflict:%', v_key; end if;
      update public.media_slots set
        media_type = w ->> 'media_type',
        media_id = nullif(w ->> 'media_id', '')::uuid,
        tablet_media_id = nullif(w ->> 'tablet_media_id', '')::uuid,
        mobile_media_id = nullif(w ->> 'mobile_media_id', '')::uuid,
        poster_media_id = nullif(w ->> 'poster_media_id', '')::uuid,
        alt_text = nullif(w ->> 'alt_text', ''),
        alt_i18n = case when jsonb_typeof(w -> 'alt_i18n') = 'object' then w -> 'alt_i18n' end,
        object_fit = w ->> 'object_fit',
        object_position = w ->> 'object_position',
        crop = case when jsonb_typeof(w -> 'crop') = 'object' then w -> 'crop' end,
        updated_at = v_now,
        updated_by = auth.uid()
      where slot_key = v_key;
    else
      if v_base is not null then raise exception 'conflict:%', v_key; end if;
      begin
        insert into public.media_slots (slot_key, entity_type, entity_id, slot_name, media_type, media_id,
          tablet_media_id, mobile_media_id, poster_media_id, alt_text, alt_i18n, object_fit, object_position, crop,
          updated_at, updated_by)
        values (v_key, w ->> 'entity_type', w ->> 'entity_id', w ->> 'slot_name', w ->> 'media_type',
          nullif(w ->> 'media_id', '')::uuid, nullif(w ->> 'tablet_media_id', '')::uuid,
          nullif(w ->> 'mobile_media_id', '')::uuid, nullif(w ->> 'poster_media_id', '')::uuid,
          nullif(w ->> 'alt_text', ''), case when jsonb_typeof(w -> 'alt_i18n') = 'object' then w -> 'alt_i18n' end,
          w ->> 'object_fit', w ->> 'object_position',
          case when jsonb_typeof(w -> 'crop') = 'object' then w -> 'crop' end,
          v_now, auth.uid());
      exception when unique_violation then
        raise exception 'conflict:%', v_key;
      end;
    end if;
    v_out := v_out || jsonb_build_object(v_key, v_now);
  end loop;
  return v_out;
end;
$$;

revoke all on function public.media_slots_write(jsonb, text) from public, anon;
grant execute on function public.media_slots_write(jsonb, text) to authenticated;

-- 5 ─────────────────────────────────────────────────────────────────────────
-- One field of one PUBLISHED block, live at once:
--   · the page row is locked, so a concurrent publish or edit waits;
--   · the block must be in the published snapshot, and the published value
--     at the path must still be what the admin saw (p_expected), and the
--     draft must not hold a different, unpublished value there (it would be
--     overwritten without ever having been live);
--   · the version row is written FIRST (as publishing does), then the draft
--     and the snapshot get the same one-path change, then history.
-- p_path: e.g. {title,pl} / {items,2,description,de} / {fields,hero.h1,pl} /
-- {mediaUrl}. Returns the block's new updated_at.
--
-- DEFINER, like content_override_write: the history row goes to
-- content_versions, which no client may insert into. The role is checked
-- first, explicitly; nothing else is reachable without it.
create or replace function public.cms_inline_patch(
  p_block_id uuid, p_path text[], p_value text, p_expected text, p_label text, p_base timestamptz,
  p_action text default 'save'
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_block public.cms_blocks%rowtype;
  v_page public.cms_pages%rowtype;
  v_idx int;
  v_snap jsonb;
  v_live text;
  v_version int;
  v_now timestamptz := clock_timestamp();
begin
  if not public.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  if p_action is null or p_action not in ('save', 'restore') then raise exception 'bad_action'; end if;
  if p_path is null or array_length(p_path, 1) is null or array_length(p_path, 1) > 6 then raise exception 'bad_path'; end if;
  if p_value is null or length(p_value) > 4000 or not public.content_text_ok(p_value) then raise exception 'invalid_text'; end if;

  -- The page first, then the block, both locked: a draft save or a publish
  -- running at the same moment is waited for, and the checks below read what
  -- it left — never a copy from before it.
  select * into v_page from public.cms_pages
    where id = (select b.page_id from public.cms_blocks b where b.id = p_block_id) for update;
  if not found then raise exception 'block_missing'; end if;
  select * into v_block from public.cms_blocks where id = p_block_id for update;
  if not found or v_block.page_id <> v_page.id then raise exception 'block_missing'; end if;
  if v_page.status <> 'published' or jsonb_typeof(v_page.published_snapshot) is distinct from 'array' then
    raise exception 'not_published';
  end if;
  if p_base is not null and v_block.updated_at <> p_base then raise exception 'conflict'; end if;

  select (e.ordinality - 1)::int into v_idx
  from jsonb_array_elements(v_page.published_snapshot) with ordinality as e(value, ordinality)
  where e.value ->> 'id' = p_block_id::text
  limit 1;
  if v_idx is null then raise exception 'not_in_snapshot'; end if;

  v_live := v_page.published_snapshot -> v_idx -> 'content' #>> p_path;
  if v_live is distinct from p_expected then raise exception 'conflict'; end if;
  -- The block's draft must hold exactly what is published. Any unpublished
  -- change in this block — an edited text, items reordered, added or removed
  -- — means a path may not name the same thing in both, and writing it into
  -- the draft would mix the two: refused, to be published or discarded in
  -- Strony WWW first.
  if v_block.content is distinct from (v_page.published_snapshot -> v_idx -> 'content') then
    raise exception 'draft_diverged';
  end if;
  if p_value = coalesce(v_live, '') then raise exception 'noop'; end if;

  v_snap := jsonb_set(v_page.published_snapshot, array[v_idx::text, 'content'] || p_path, to_jsonb(p_value), true);
  -- jsonb_set creates only the LAST missing key: a path whose parent is
  -- absent comes back unchanged. That must be a refusal, never a "saved".
  if (v_snap -> v_idx -> 'content') #>> p_path is distinct from p_value
     or jsonb_set(v_block.content, p_path, to_jsonb(p_value), true) #>> p_path is distinct from p_value then
    raise exception 'bad_path';
  end if;

  select coalesce(max(version), 0) + 1 into v_version from public.cms_page_versions where page_id = v_page.id;
  begin
    insert into public.cms_page_versions (page_id, version, snapshot, seo, reason, label, created_by)
    values (v_page.id, v_version, v_snap, v_page.seo, 'publish', left(coalesce(p_label, 'Edytor wizualny'), 120), auth.uid());
  exception when unique_violation then
    raise exception 'conflict';
  end;

  update public.cms_blocks
    set content = jsonb_set(content, p_path, to_jsonb(p_value), true), updated_at = v_now, updated_by = auth.uid()
    where id = p_block_id;
  update public.cms_pages
    set published_snapshot = v_snap, published_at = v_now, updated_at = v_now, updated_by = auth.uid()
    where id = v_page.id;

  insert into public.content_versions (target, key, locale, action, before, after, created_by)
  values ('cms', v_page.id::text || ':' || p_block_id::text || ':' || array_to_string(p_path, '.'),
    case when p_path[array_length(p_path, 1)] in ('pl', 'en', 'de') then p_path[array_length(p_path, 1)] end,
    p_action,
    jsonb_build_object('value', v_live), jsonb_build_object('value', p_value), auth.uid());
  return v_now;
end;
$$;

revoke all on function public.cms_inline_patch(uuid, text[], text, text, text, timestamptz, text) from public, anon;
grant execute on function public.cms_inline_patch(uuid, text[], text, text, text, timestamptz, text) to authenticated;
