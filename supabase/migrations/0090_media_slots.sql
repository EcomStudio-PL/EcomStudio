-- ADMIN CONTROL OVER EVERY PICTURE IN THE INTERFACE.
--
-- A "slot" is one named position in the product — the Moda tile on the
-- dashboard, the hero of Retusz, the promo banner above the tool catalogue.
-- An admin fills a slot; the interface renders what is in it.
--
-- THE ABSENCE OF A ROW IS THE DEFAULT, AND THAT IS THE WHOLE MIGRATION PLAN.
-- Every surface keeps the art it draws today as its fallback, so this ships
-- with the interface looking exactly as it did, and each slot changes only
-- when somebody deliberately fills it. There is no data migration, nothing to
-- backfill, and no moment where a screen is half-converted.
--
-- ONE LIBRARY, NOT TWO. Slots point at `media_assets` — the same table the
-- public CMS, the media manager and the picker already use. A file used in six
-- places is one row and six references (the brief's §24), which is also what
-- makes "used in N places" answerable at all.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. THE SLOTS
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.media_slots (
  id uuid primary key default gen_random_uuid(),

  -- 'dashboard.category.moda.card'. Declared in lib/media-slots.ts, which
  -- DERIVES the list from the category and feature registries — so this is a
  -- key the product already knows, never one typed twice.
  slot_key text not null unique,

  -- Denormalised from the key so the admin screens can list by entity without
  -- parsing strings, and so a future index on (entity_type, entity_id) is
  -- possible. The key remains the identity.
  entity_type text not null,
  entity_id text not null,
  slot_name text not null,

  media_type text not null default 'image',

  -- DESKTOP IS THE ONLY REQUIRED ONE. Tablet and mobile are overrides: absent
  -- means "use the desktop file", which is what the brief asks for — an admin
  -- must not be made to upload three copies of the same picture.
  media_id uuid references public.media_assets(id) on delete set null,
  tablet_media_id uuid references public.media_assets(id) on delete set null,
  mobile_media_id uuid references public.media_assets(id) on delete set null,
  -- The still shown before a video plays. Without one a video card is a black
  -- rectangle until the first frame decodes.
  poster_media_id uuid references public.media_assets(id) on delete set null,

  alt_text text,

  -- CLOSED VOCABULARIES. Both become CSS, so neither may be free text: an
  -- object-position of "fixed; background: url(…)" is a stylesheet, not a
  -- position. The same rule as the CMS style presets.
  object_fit text not null default 'cover',
  object_position text not null default 'center center',

  -- Video playback. The defaults are what a card wants: it plays quietly and
  -- forever and has no chrome. An admin can change any of them per slot.
  autoplay boolean not null default true,
  muted boolean not null default true,
  loop boolean not null default true,
  controls boolean not null default false,

  -- Switched off without being deleted: the slot reverts to its fallback and
  -- the configuration is still there when it is switched back on.
  enabled boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,

  constraint media_slots_media_type_check check (media_type in ('image', 'video')),
  constraint media_slots_fit_check check (object_fit in ('cover', 'contain')),
  constraint media_slots_position_check check (object_position in (
    'left top', 'center top', 'right top',
    'left center', 'center center', 'right center',
    'left bottom', 'center bottom', 'right bottom'
  )),
  constraint media_slots_entity_check check (entity_type in (
    'category', 'workflow', 'tool', 'banner', 'section', 'global'
  ))
);

create index if not exists media_slots_entity_idx
  on public.media_slots (entity_type, entity_id);
-- "Which slots use this file?" — asked every time somebody tries to delete
-- one, so it gets an index rather than four sequential scans.
create index if not exists media_slots_media_idx on public.media_slots (media_id)
  where media_id is not null;
create index if not exists media_slots_tablet_idx on public.media_slots (tablet_media_id)
  where tablet_media_id is not null;
create index if not exists media_slots_mobile_idx on public.media_slots (mobile_media_id)
  where mobile_media_id is not null;
create index if not exists media_slots_poster_idx on public.media_slots (poster_media_id)
  where poster_media_id is not null;

alter table public.media_slots enable row level security;

-- Writing is an admin action. Reading goes through the function below, so no
-- role gets a blanket SELECT on the table — the same posture as media_assets.
drop policy if exists "media_slots_admin" on public.media_slots;
create policy "media_slots_admin" on public.media_slots for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

-- ─────────────────────────────────────────────────────────────────────────
-- 2. BANNERS
-- ─────────────────────────────────────────────────────────────────────────
--
-- A banner is not a slot: it has a link, a schedule and a position in a
-- sequence. Its PICTURE is a slot like everything else
-- (`banner.<key>.media`), so there is one media pipeline and not a second
-- uploader bolted onto a banner editor.
create table if not exists public.app_banners (
  id uuid primary key default gen_random_uuid(),
  -- 'dashboard.promo'. Stable, and what the slot key is built from.
  banner_key text not null unique,
  -- Which surface shows it.
  placement text not null default 'dashboard',

  -- Localized, like every other piece of copy in this product.
  label jsonb not null default '{}'::jsonb,
  body jsonb not null default '{}'::jsonb,
  cta_label jsonb not null default '{}'::jsonb,
  cta_url text,

  active boolean not null default false,
  -- A campaign window. Null on either side means "no bound on that side",
  -- so a banner with neither is simply on while `active` is true.
  starts_at timestamptz,
  ends_at timestamptz,
  sort_order integer not null default 100,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,

  constraint app_banners_placement_check
    check (placement in ('dashboard', 'tools', 'library', 'generator')),
  -- A window that ends before it starts would never show and would look like
  -- a bug in the renderer rather than a typo in the form.
  constraint app_banners_window_check
    check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create index if not exists app_banners_live_idx
  on public.app_banners (placement, sort_order) where active;

alter table public.app_banners enable row level security;

drop policy if exists "app_banners_admin" on public.app_banners;
create policy "app_banners_admin" on public.app_banners for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

-- A signed-in customer sees the banners that are live right now. The check is
-- in the policy, not only in the query, so an expired campaign cannot be read
-- back by anyone whatever they ask for.
drop policy if exists "app_banners_read_live" on public.app_banners;
create policy "app_banners_read_live" on public.app_banners for select
  to authenticated using (
    active
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
  );

insert into public.app_banners (banner_key, placement, active, sort_order)
values
  ('dashboard.promo', 'dashboard', false, 10),
  ('tools.top',       'tools',     false, 10)
on conflict (banner_key) do nothing;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. READING A SCREEN'S SLOTS — ONE CALL
-- ─────────────────────────────────────────────────────────────────────────
--
-- The dashboard needs six category tiles; the tool catalogue needs a dozen
-- cards. Fetching those one at a time would be the "20 requests for 20 cards"
-- the brief refuses, and the caller is an ordinary customer who has no read on
-- `media_assets` (0089) and must not be given one.
--
-- So: hand it the keys the screen is about to paint, get back the resolved
-- rows. The join happens once, in the database, and what comes out is
-- presentation configuration for positions the product itself declares —
-- nothing that identifies a person and nothing that lists the library.
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
  left join public.media_assets d on d.id = s.media_id
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
    and s.enabled;
$$;

-- Supabase re-grants EXECUTE to `public` by name on create, so the revoke has
-- to name the roles explicitly (the trap 0083, 0086 and 0088 all hit).
revoke all on function public.media_slots_resolve(text[]) from public, anon, authenticated;
grant execute on function public.media_slots_resolve(text[]) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. WHERE IS THIS FILE USED?
-- ─────────────────────────────────────────────────────────────────────────
--
-- Asked before every delete, and shown beside every file in the library. It
-- counts the four slot columns plus the published CMS pages whose blocks
-- reference the file's public URL — because "used in 6 places" is only
-- trustworthy if it looks everywhere the file can be used.
create or replace function public.media_usage(p_media_id uuid)
returns table (
  usage_kind text,
  usage_key text,
  usage_label text
)
language sql
stable
security definer
set search_path = public
as $$
  with asset as (
    select id, storage_path, external_url from public.media_assets where id = p_media_id
  )
  -- Slots, one row per column that points at it, so replacing a mobile
  -- override is distinguishable from replacing the desktop file.
  select 'slot', s.slot_key,
         case
           when s.media_id = p_media_id then 'desktop'
           when s.tablet_media_id = p_media_id then 'tablet'
           when s.mobile_media_id = p_media_id then 'mobile'
           else 'poster'
         end
  from public.media_slots s
  where p_media_id in (s.media_id, s.tablet_media_id, s.mobile_media_id, s.poster_media_id)

  union all

  -- CMS pages. A block stores the public URL, so the match is on the path
  -- appearing anywhere in the page's blocks.
  select 'cms_page', p.slug, p.status
  from public.cms_pages p, asset a
  where a.storage_path is not null
    and exists (
      select 1 from public.cms_blocks b
      where b.page_id = p.id and b.content::text like '%' || a.storage_path || '%'
    );
$$;

revoke all on function public.media_usage(uuid) from public, anon, authenticated;
grant execute on function public.media_usage(uuid) to authenticated;
