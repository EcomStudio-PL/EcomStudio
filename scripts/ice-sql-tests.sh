#!/usr/bin/env bash
#
# THE INLINE CONTENT EDITOR (0141), PROVEN AGAINST A REAL POSTGRES.
#
# 0141 gives an admin a pen on the live site: a text override per i18n key, a
# frame and per-language alt text per picture slot, and a one-field patch of a
# PUBLISHED CMS block. Every one of those writes goes straight to what a
# visitor sees, so what has to be proven is not that the happy path works but
# that NOTHING ELSE does:
#
#   · nobody but an admin reaches a writer, and a customer who calls one is
#     refused by the function AND would be refused by RLS anyway;
#   · nobody — admin included — writes content_overrides or content_versions
#     around the functions; the history is append-only for every client;
#   · every successful write leaves exactly one history row, with the action
#     it was made as, and a refused or no-op write leaves none;
#   · compare-and-set is real: a stale base is a conflict, never a silent
#     overwrite, and a multi-slot write is all or nothing;
#   · invisible, markup and control characters never reach a page.
#
# A TYPE CHECKER HAS NO OPINION ABOUT ANY OF THAT, and neither does a test that
# only ever runs as an admin. So every rule is asserted as the caller it is
# meant to stop — anon, a signed-in customer, an admin going around the door —
# against the real migration file, applied verbatim, TWICE (it has to be
# re-runnable) and a THIRD time over a populated database at the end.
#
# It runs against the local harness, never Supabase: DEV and PROD are not
# places to rehearse policy changes.
#
#   bash scripts/pg-harness-up.sh && npm run test:ice:sql
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
PSQL=(psql -h "$PGSOCK" -p "$PGPORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -X -q -t -A)

if ! "${PSQL[@]}" -c 'select 1' >/dev/null 2>&1; then
  echo "ice-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Overridable so the guard can be mutation-tested: point it at a deliberately
# broken copy of 0141 and the run must go red. A guard nobody has watched fail
# is a guard nobody knows works.
MIGRATION="${MIGRATION:-$ROOT/supabase/migrations/0141_inline_content_editor.sql}"
[ -f "$MIGRATION" ] || { echo "ice-sql: $MIGRATION not found" >&2; exit 2; }

OUT=$(mktemp); ERR=$(mktemp); trap 'rm -f "$OUT" "$ERR"' EXIT

# ── A throwaway rehearsal of the schema 0141 lands on ───────────────────────
#
# Only what 0141 touches, with the columns, CHECKs, policies and grants
# replayed from the migrations that created them: 0012 (media_assets,
# cms_pages, cms_blocks), 0051 + 0093 (the per-role CMS policies), 0085 (the
# builder columns, cms_page_versions and its reason CHECK), 0089 (the media
# catalogue is admin-only), 0090 (media_slots), 0091 (media_slots_resolve as
# it stands before 0141) and 0092 (the block audience columns).
#
# SUPABASE'S DEFAULT PRIVILEGES ARE REPLAYED TOO: every table and function the
# owner creates in `public` is granted to anon and authenticated, so RLS and
# explicit revokes are the only locks. That is what makes the assertions below
# mean anything — "anon sees 0 rows" has to be RLS filtering a table anon may
# SELECT, not a missing grant — and it is what 0141's own revokes are written
# against. auth.uid() and is_admin() read session settings so a test can BE
# each caller.
"${PSQL[@]}" >/dev/null <<'SQL'
set client_min_messages = warning;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'drop owned by anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'drop owned by authenticated'; end if;
end $$;

drop schema if exists public cascade;  create schema public;
drop schema if exists auth cascade;    create schema auth;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

grant usage on schema public, auth to anon, authenticated;

alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;

-- The real is_admin is SECURITY DEFINER over profiles. What matters here is
-- its SHAPE — a definer function anon may not execute — so the body is a
-- session setting and the GRANTS are copied verbatim from 0005.
create function public.is_admin(uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select coalesce(current_setting('test.admin', true) = '1', false)
$$;
revoke execute on function public.is_admin(uuid) from public, anon;
grant execute on function public.is_admin(uuid) to authenticated;

-- Only the key matters here: content_overrides, content_versions,
-- media_slots, cms_pages, cms_blocks and cms_page_versions all reference it.
create table public.profiles (id uuid primary key, role text not null default 'user');
insert into public.profiles (id, role) values
  ('ad000000-0000-0000-0000-000000000001', 'admin'),
  ('c0000000-0000-0000-0000-000000000001', 'user');

-- ── media_assets: 0012 + 0085 columns, 0089 policies ──────────────────────
create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'image' check (kind in ('image','video','file')),
  storage_path text,
  external_url text,
  poster_url text,
  alt text,
  title text,
  mime text,
  size_bytes bigint,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  folder text,
  tags text[] not null default '{}',
  width integer,
  height integer,
  variants jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.media_assets enable row level security;
create policy "media_read_authenticated" on public.media_assets for select
  to authenticated using (public.is_admin());
create policy "media_admin_write" on public.media_assets for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── cms_pages: 0012 + 0085 columns and CHECKs, 0093 + 0051 policies ───────
create table public.cms_pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  status text not null default 'draft',
  published_snapshot jsonb,
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  seo jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  constraint cms_pages_status_check check (status in ('draft', 'published', 'scheduled', 'archived')),
  constraint cms_pages_scheduled_needs_date check (status <> 'scheduled' or scheduled_at is not null)
);
alter table public.cms_pages enable row level security;
create policy "cms_pages_read_public" on public.cms_pages for select to anon
  using (status = 'published'
         or (status = 'scheduled' and scheduled_at is not null and scheduled_at <= now()));
create policy "cms_pages_read_authenticated" on public.cms_pages for select to authenticated
  using (status = 'published'
         or (status = 'scheduled' and scheduled_at is not null and scheduled_at <= now())
         or public.is_admin());
create policy "cms_pages_admin_write" on public.cms_pages for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ── cms_blocks: 0012 + 0085 + 0092 columns, 0051 policies ─────────────────
create table public.cms_blocks (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.cms_pages(id) on delete cascade,
  type text not null,
  sort_order int not null default 0,
  visible boolean not null default true,
  content jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  style jsonb not null default '{}'::jsonb,
  code jsonb not null default '{}'::jsonb,
  analytics_id text,
  anchor text,
  updated_by uuid references public.profiles(id) on delete set null,
  show_from timestamptz,
  show_until timestamptz,
  audience text not null default 'everyone',
  constraint cms_blocks_audience_check check (audience in ('everyone', 'anon', 'user'))
);
alter table public.cms_blocks enable row level security;
create policy "cms_blocks_read_authenticated" on public.cms_blocks for select to authenticated
  using (public.is_admin());
create policy "cms_blocks_admin_write" on public.cms_blocks for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ── cms_page_versions: 0085 verbatim (PROD carries the same reason CHECK) ─
create table public.cms_page_versions (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.cms_pages(id) on delete cascade,
  version integer not null,
  snapshot jsonb not null default '[]'::jsonb,
  seo jsonb not null default '{}'::jsonb,
  reason text not null default 'publish',
  label text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  constraint cms_page_versions_unique unique (page_id, version),
  constraint cms_page_versions_reason_check check (reason in ('publish', 'manual', 'rollback'))
);
alter table public.cms_page_versions enable row level security;
create policy "cms_page_versions_read" on public.cms_page_versions for select
  to authenticated using (public.is_admin());
create policy "cms_page_versions_write" on public.cms_page_versions for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── media_slots: 0090 verbatim ──────────────────────────────────────────────
create table public.media_slots (
  id uuid primary key default gen_random_uuid(),
  slot_key text not null unique,
  entity_type text not null,
  entity_id text not null,
  slot_name text not null,
  media_type text not null default 'image',
  media_id uuid references public.media_assets(id) on delete set null,
  tablet_media_id uuid references public.media_assets(id) on delete set null,
  mobile_media_id uuid references public.media_assets(id) on delete set null,
  poster_media_id uuid references public.media_assets(id) on delete set null,
  alt_text text,
  object_fit text not null default 'cover',
  object_position text not null default 'center center',
  autoplay boolean not null default true,
  muted boolean not null default true,
  loop boolean not null default true,
  controls boolean not null default false,
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
alter table public.media_slots enable row level security;
create policy "media_slots_admin" on public.media_slots for all
  to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── media_slots_resolve as 0091 left it — 0141 must leave it EXACTLY so ──
create or replace function public.media_slots_resolve(p_keys text[])
returns table (
  slot_key text, media_type text, alt_text text, object_fit text, object_position text,
  autoplay boolean, muted boolean, loop boolean, controls boolean,
  desktop_path text, desktop_url text, desktop_width integer, desktop_height integer, desktop_variants jsonb,
  tablet_path text, tablet_url text, mobile_path text, mobile_url text, poster_path text, poster_url text
)
language sql stable security definer set search_path = public
as $$
  select
    s.slot_key, s.media_type, s.alt_text, s.object_fit, s.object_position,
    s.autoplay, s.muted, s.loop, s.controls,
    d.storage_path, d.external_url, d.width, d.height, d.variants,
    t.storage_path, t.external_url,
    m.storage_path, m.external_url,
    p.storage_path, p.external_url
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

-- ── Rows that exist BEFORE 0141, the way production has them ──────────────
insert into public.media_assets (id, storage_path, external_url, width, height, variants) values
  ('a0000000-0000-0000-0000-000000000001', 'media/hero.jpg', null, 1600, 900,
   '{"640":"https://cdn.test/hero_w640.webp","1600":"https://cdn.test/hero.jpg"}'),
  ('a0000000-0000-0000-0000-000000000002', 'media/other.jpg', null, 1200, 800, '{}'),
  ('a0000000-0000-0000-0000-000000000003', 'media/hero-mobile.jpg', null, 800, 1000,
   '{"480":"https://cdn.test/hero-mobile_w480.webp"}'),
  ('a0000000-0000-0000-0000-000000000004', null, null, null, null, '{}'),          -- points at nothing
  ('a0000000-0000-0000-0000-000000000005', null, 'https://cdn.test/ext.jpg', null, null, '{}'),
  ('a0000000-0000-0000-0000-000000000006', 'media/doomed.jpg', null, null, null, '{}');

insert into public.media_slots (slot_key, entity_type, entity_id, slot_name, media_id, alt_text) values
  ('global.legacy.hero', 'global', 'legacy', 'hero', 'a0000000-0000-0000-0000-000000000001', 'Legacy');

-- A published page: three blocks live in its snapshot (B1 hero, B2 text, B4
-- a launch block whose field keys contain a dot, B6 a list), plus B3, a draft
-- block that was never published. A draft page that was published once (P2)
-- still carries its old snapshot. P1 already has versions 1–3.
insert into public.cms_pages (id, slug, title, status, published_snapshot, published_at, seo) values
  ('f0000000-0000-0000-0000-000000000001', 'cennik', 'Cennik', 'published',
   '[{"id":"b0000000-0000-0000-0000-000000000001","type":"hero","sort_order":0,"visible":true,
      "content":{"title":{"pl":"Stary","en":"Old"},"subtitle":{"pl":"Pod"}}},
     {"id":"b0000000-0000-0000-0000-000000000002","type":"text","sort_order":1,"visible":true,
      "content":{"body":{"pl":"Inny"}}},
     {"id":"b0000000-0000-0000-0000-000000000004","type":"launch","sort_order":2,"visible":true,
      "content":{"fields":{"hero.h1":{"pl":"Premiera"}}}},
     {"id":"b0000000-0000-0000-0000-000000000006","type":"list","sort_order":3,"visible":true,
      "content":{"items":[{"description":{"pl":"Zero"}},{"description":{"pl":"Jeden"}}]}}]',
   now() - interval '1 day', '{"pl":{"title":"Cennik"}}'),
  ('f0000000-0000-0000-0000-000000000002', 'o-nas', 'O nas', 'draft',
   '[{"id":"b0000000-0000-0000-0000-000000000005","type":"hero","sort_order":0,"visible":true,
      "content":{"title":{"pl":"O nas"}}}]',
   now() - interval '2 days', '{}');

insert into public.cms_blocks (id, page_id, type, sort_order, content) values
  ('b0000000-0000-0000-0000-000000000001', 'f0000000-0000-0000-0000-000000000001', 'hero', 0,
   '{"title":{"pl":"Stary","en":"Old"},"subtitle":{"pl":"Pod"}}'),
  ('b0000000-0000-0000-0000-000000000002', 'f0000000-0000-0000-0000-000000000001', 'text', 1,
   '{"body":{"pl":"Inny"}}'),
  ('b0000000-0000-0000-0000-000000000003', 'f0000000-0000-0000-0000-000000000001', 'text', 9,
   '{"title":{"pl":"Szkic nowej sekcji"}}'),
  ('b0000000-0000-0000-0000-000000000004', 'f0000000-0000-0000-0000-000000000001', 'launch', 2,
   '{"fields":{"hero.h1":{"pl":"Premiera"}}}'),
  ('b0000000-0000-0000-0000-000000000006', 'f0000000-0000-0000-0000-000000000001', 'list', 3,
   '{"items":[{"description":{"pl":"Zero"}},{"description":{"pl":"Jeden"}}]}'),
  ('b0000000-0000-0000-0000-000000000005', 'f0000000-0000-0000-0000-000000000002', 'hero', 0,
   '{"title":{"pl":"O nas"}}');

insert into public.cms_page_versions (page_id, version, snapshot, reason, label) values
  ('f0000000-0000-0000-0000-000000000001', 1, '[]', 'publish', 'v1'),
  ('f0000000-0000-0000-0000-000000000001', 2, '[]', 'manual', 'v2'),
  ('f0000000-0000-0000-0000-000000000001', 3, '[]', 'rollback', 'v3');

-- ── The scoreboard and its helpers ────────────────────────────────────────
create table public.test_results (name text, ok boolean, detail text, seq serial);

/* Values a later assertion needs from an earlier one (a returned timestamp
   that must be the next base, a count that must not move). Granted to every
   role by the default privileges above, so a test can write it while it runs
   AS the role under test. */
create table public.t_vars (name text primary key, v text);
create function public.t_var(p_name text) returns text language sql stable as $$
  select v from public.t_vars where name = p_name
$$;

/* BE a caller. Session-level settings, so they hold for the rest of the
   heredoc — and ONLY that heredoc (see the note above section A). */
create function public.t_be(p_who text) returns void language plpgsql as $$
begin
  perform set_config('test.uid', case p_who
    when 'admin' then 'ad000000-0000-0000-0000-000000000001'
    when 'customer' then 'c0000000-0000-0000-0000-000000000001'
    else '' end, false);
  perform set_config('test.admin', case when p_who = 'admin' then '1' else '0' end, false);
end $$;

create function public.t_admin_uid() returns uuid language sql immutable as $$
  select 'ad000000-0000-0000-0000-000000000001'::uuid
$$;

/* One element of a media_slots_write payload: every column the function
   writes, so a test states only what it is about. entity_id / slot_name are
   the 2nd / 3rd segment of the key, the way lib/media-slots.ts builds them. */
create function public.t_slot(p_key text, p_media uuid, p_alt text, p_crop jsonb, p_base text,
                              p_mobile uuid default null)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'key', p_key, 'entity_type', 'global', 'entity_id', split_part(p_key, '.', 2),
    'slot_name', split_part(p_key, '.', 3), 'media_type', 'image', 'media_id', p_media,
    'tablet_media_id', null, 'mobile_media_id', p_mobile, 'poster_media_id', null,
    'alt_text', p_alt, 'alt_i18n', case when p_alt is null then null else jsonb_build_object('pl', p_alt) end,
    'object_fit', 'cover', 'object_position', 'center center', 'crop', p_crop, 'base', p_base)
$$;

/* A cms_inline_patch either REFUSES, or the value it reports saved is really
   at that path afterwards — in the draft block and in the block's entry of
   the published snapshot. Any refusal is acceptable (the exception rolls back
   everything it did); a success that changed nothing is the one outcome that
   is not. Invoker, so it runs as the role under test. */
create function public.t_patch_is_honest(p_block uuid, p_path text[], p_value text, p_expected text)
returns boolean language plpgsql as $$
begin
  perform public.cms_inline_patch(p_block, p_path, p_value, p_expected, null, null, 'save');
  return (select content #>> p_path from public.cms_blocks where id = p_block) is not distinct from p_value
     and (select e.value -> 'content' #>> p_path
            from public.cms_pages pg, jsonb_array_elements(pg.published_snapshot) e
           where pg.id = (select page_id from public.cms_blocks where id = p_block)
             and e.value ->> 'id' = p_block::text) is not distinct from p_value;
exception when others then
  return true;
end $$;

/* Run `p_sql` AS `p_role` and record whether it raised something containing
   `p_needle`. The role is reset before the result is written, or the insert
   itself would run as the role under test. */
create function public.t_raises(p_name text, p_role text, p_sql text, p_needle text)
returns void language plpgsql as $$
declare v_err text := null;
begin
  begin
    execute format('set local role %I', p_role);
    execute p_sql;
  exception when others then v_err := sqlerrm;
  end;
  execute 'reset role';
  insert into public.test_results(name, ok, detail)
    values (p_name, v_err is not null and v_err like '%' || p_needle || '%',
            coalesce(v_err, '(no error raised)'));
end $$;

/* Run a boolean `select` as `p_role`. An error is a failure, reported as one
   rather than aborting the run. */
create function public.t_true(p_name text, p_role text, p_sql text)
returns void language plpgsql as $$
declare v_ok boolean := null; v_err text := null;
begin
  begin
    execute format('set local role %I', p_role);
    execute p_sql into v_ok;
  exception when others then v_err := sqlerrm;
  end;
  execute 'reset role';
  insert into public.test_results(name, ok, detail)
    values (p_name, coalesce(v_ok, false), coalesce(v_err, 'got ' || coalesce(v_ok::text, 'null')));
end $$;

/* Everything 0141 writes or guards, as one digest — read as the owner, so
   RLS hides nothing. Used to prove that a re-apply and a wall of refused
   writes changed nothing at all. plpgsql, because two of the tables do not
   exist until 0141 creates them and a SQL body is checked at creation. */
create function public.t_fingerprint() returns text language plpgsql stable as $$
begin
  return md5(
    (select coalesce(string_agg(t::text, '|' order by t::text), '') from public.content_overrides t) || '#' ||
    (select coalesce(string_agg(t::text, '|' order by t::text), '') from public.content_versions t) || '#' ||
    (select coalesce(string_agg(t::text, '|' order by t::text), '') from public.media_slots t) || '#' ||
    (select coalesce(string_agg(t::text, '|' order by t::text), '') from public.cms_pages t) || '#' ||
    (select coalesce(string_agg(t::text, '|' order by t::text), '') from public.cms_blocks t) || '#' ||
    (select coalesce(string_agg(t::text, '|' order by t::text), '') from public.cms_page_versions t));
end $$;
SQL

# ── APPLY THE REAL MIGRATION FILE — AND THEN AGAIN ──────────────────────────
#
# Verbatim, in one transaction (`psql -1`: the file opens with `set local
# lock_timeout`, which only means something inside one). A migration that
# cannot be applied twice is one a half-finished deploy cannot be retried
# with, so the second apply is an assertion, not a formality — a failure is
# recorded with Postgres's own error text and the run carries on with the
# state the first apply left.
record() {
  "${PSQL[@]}" -v name="$1" -v ok="$2" -v detail="$3" >/dev/null <<'SQL'
insert into public.test_results (name, ok, detail) values (:'name', :'ok'::boolean, :'detail');
SQL
}
apply_migration() {
  PGOPTIONS='-c client_min_messages=warning' "${PSQL[@]}" -1 -f "$MIGRATION" >/dev/null 2>"$ERR"
}

scoreboard() {
  "${PSQL[@]}" -c \
    "select case when ok then '  ✓ ' else '  ✗ ' end || name || case when ok then '' else '  — ' || detail end
     from public.test_results order by seq" > "$OUT"

  cat "$OUT"
  FAILED=$("${PSQL[@]}" -c "select count(*) from public.test_results where not ok")
  TOTAL=$("${PSQL[@]}" -c "select count(*) from public.test_results")

  if [ "$FAILED" = "0" ]; then
    echo
    echo "All $TOTAL inline-content-editor SQL tests passed."
  else
    echo
    echo "$FAILED of $TOTAL FAILED" >&2
    exit 1
  fi
}

# The 0091 resolver, as production runs it today: its body, its result type
# and who may call it. 0141 adds media_slots_resolve_v2 next to it and must
# not change a byte of this (M8a).
"${PSQL[@]}" >/dev/null <<'SQL'
insert into public.t_vars
select 'v1_before', md5(p.prosrc || '|' || pg_get_function_result(p.oid) || '|' || coalesce(p.proacl::text, '')
                        || '|' || p.prosecdef::text || '|' || p.provolatile::text || '|' || coalesce(array_to_string(p.proconfig, ','), ''))
  from pg_proc p where p.oid = 'public.media_slots_resolve(text[])'::regprocedure;
SQL
if grep -qiE '^[[:space:]]*drop[[:space:]]' "$MIGRATION"; then
  record 'M0  0141 is purely additive: not one DROP statement in the file' false "$(grep -inE '^[[:space:]]*drop[[:space:]]' "$MIGRATION" | head -3 | tr '\n' ' ')"
else
  record 'M0  0141 is purely additive: not one DROP statement in the file' true ''
fi
if apply_migration; then
  record 'M1  0141 applies to the pre-0141 schema in one transaction' true ''
else
  # Nothing after this would mean anything: the transaction rolled back and
  # the schema is still pre-0141. Report it as the failure it is and stop.
  record 'M1  0141 applies to the pre-0141 schema in one transaction' false "$(tr '\n' ' ' < "$ERR")"
  echo "ice-sql: the FIRST apply of $MIGRATION failed; no further assertion was run." >&2
  scoreboard
fi
if apply_migration; then
  record 'M2  and applies again on top of itself (re-runnable)' true ''
else
  record 'M2  and applies again on top of itself (re-runnable)' false "$(tr '\n' ' ' < "$ERR")"
fi

# ── M. WHAT THE APPLY LEFT BEHIND ───────────────────────────────────────────
#
# EVERY HEREDOC IS ITS OWN SESSION, so the caller the stubs read (test.uid,
# test.admin) has to be set inside each one — t_be() does it. Setting it in a
# separate `psql -c` loses it and turns "an admin can" assertions into "an
# anonymous caller cannot" assertions that pass for the wrong reason (the
# homepage harness learnt that the hard way).
"${PSQL[@]}" >/dev/null <<'SQL'
select public.t_be('admin');

select public.t_true(
  'M3  the second apply left one trigger of each, not two',
  'postgres', $q$
  select (select count(*) from pg_trigger where tgrelid = 'public.media_slots'::regclass and not tgisinternal) = 2
     and (select count(*) from pg_trigger where tgrelid = 'public.content_overrides'::regclass and not tgisinternal) = 1
     and (select count(*) from pg_trigger where tgname = 'media_slots_crop_reset') = 1
     and (select count(*) from pg_trigger where tgname = 'media_slots_history') = 1 $q$);
select public.t_true(
  'M4  and one policy per new table, both read-only, both admin-only',
  'postgres', $q$
  select (select count(*) from pg_policies where tablename = 'content_overrides') = 1
     and (select count(*) from pg_policies where tablename = 'content_versions') = 1
     and (select bool_and(cmd = 'SELECT' and roles = '{authenticated}')
            from pg_policies where tablename in ('content_overrides', 'content_versions')) $q$);
select public.t_true(
  'M5  RLS is on for both new tables',
  'postgres', $q$
  select bool_and(relrowsecurity) from pg_class
   where oid in ('public.content_overrides'::regclass, 'public.content_versions'::regclass) $q$);
select public.t_true(
  'M6  a slot that existed before 0141 keeps every value and gets null crop / alt_i18n',
  'postgres', $q$
  select media_id = 'a0000000-0000-0000-0000-000000000001' and alt_text = 'Legacy'
     and crop is null and alt_i18n is null
    from public.media_slots where slot_key = 'global.legacy.hero' $q$);
select public.t_true(
  'M7  and still resolves for an anonymous visitor, through v1 and through v2',
  'anon', $q$
  select (select count(*) = 1 and bool_and(desktop_path = 'media/hero.jpg' and alt_text = 'Legacy')
            from public.media_slots_resolve(array['global.legacy.hero']))
     and (select count(*) = 1 and bool_and(desktop_path = 'media/hero.jpg' and alt_text = 'Legacy' and crop is null)
            from public.media_slots_resolve_v2(array['global.legacy.hero'])) $q$);
select public.t_true(
  'M8  v2 keeps 0091''s 20 columns in order and appends exactly crop, alt_i18n, mobile_variants',
  'postgres', $q$
  select pg_get_function_result('public.media_slots_resolve_v2(text[])'::regprocedure) =
    'TABLE(slot_key text, media_type text, alt_text text, object_fit text, object_position text, '
    'autoplay boolean, muted boolean, loop boolean, controls boolean, desktop_path text, desktop_url text, '
    'desktop_width integer, desktop_height integer, desktop_variants jsonb, tablet_path text, tablet_url text, '
    'mobile_path text, mobile_url text, poster_path text, poster_url text, crop jsonb, alt_i18n jsonb, '
    'mobile_variants jsonb)' $q$);
select public.t_true(
  'M8a the 0091 resolver is untouched: same body, result type, definer, volatility, search_path and grants',
  'postgres', $q$
  select md5(p.prosrc || '|' || pg_get_function_result(p.oid) || '|' || coalesce(p.proacl::text, '')
             || '|' || p.prosecdef::text || '|' || p.provolatile::text || '|' || coalesce(array_to_string(p.proconfig, ','), ''))
         = public.t_var('v1_before')
    from pg_proc p where p.oid = 'public.media_slots_resolve(text[])'::regprocedure $q$);
select public.t_true(
  'M8b v2 is a definer function with a pinned search_path, callable by anon and authenticated only',
  'postgres', $q$
  select p.prosecdef and p.provolatile = 's' and p.proconfig = '{search_path=public}'
     and has_function_privilege('anon', p.oid, 'execute')
     and has_function_privilege('authenticated', p.oid, 'execute')
     and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0 and a.privilege_type = 'EXECUTE')
    from pg_proc p where p.oid = 'public.media_slots_resolve_v2(text[])'::regprocedure $q$);
select public.t_true(
  'M9  the existing CMS rows were not touched by the apply',
  'postgres', $q$
  select (select content->'title'->>'pl' from public.cms_blocks where id = 'b0000000-0000-0000-0000-000000000001') = 'Stary'
     and (select count(*) from public.cms_page_versions) = 3
     and (select count(*) from public.content_versions) = 0 $q$);
SQL

# ── A. TEXT OVERRIDES — content_override_write is the only door ────────────
"${PSQL[@]}" >/dev/null <<'SQL'
select public.t_be('admin');

select public.t_true(
  'A1  an admin''s first write (no base) inserts the override and returns a timestamptz',
  'authenticated', $q$
  with r as (select public.content_override_write('home.hero.title', 'pl', 'Witaj', null, 'save') as ts),
       s as (insert into public.t_vars select 'A1', ts::text from r returning v)
  select (select pg_typeof(ts) from r) = 'timestamptz'::regtype
     and (select v from s) is not null $q$);
select public.t_true(
  'A2  the returned timestamp is the stored updated_at — the base for the next write',
  'authenticated', $q$
  select value = 'Witaj' and updated_at = public.t_var('A1')::timestamptz and updated_by = public.t_admin_uid()
    from public.content_overrides where key = 'home.hero.title' and locale = 'pl' $q$);
select public.t_raises(
  'A3  a second "there was no override" write is a conflict, not an overwrite',
  'authenticated', $q$ select public.content_override_write('home.hero.title', 'pl', 'Inaczej', null, 'save') $q$,
  'conflict');
select public.t_true(
  'A4  a write carrying the right base updates and returns a new timestamp',
  'authenticated', $q$
  with r as (select public.content_override_write('home.hero.title', 'pl', 'Witaj ponownie',
                                                  public.t_var('A1')::timestamptz, 'save') as ts),
       s as (insert into public.t_vars select 'A4', ts::text from r returning v)
  select (select v from s)::timestamptz > public.t_var('A1')::timestamptz $q$);
select public.t_true(
  'A5  the row holds the new value, stamped with that timestamp and the admin',
  'authenticated', $q$
  select value = 'Witaj ponownie' and updated_at = public.t_var('A4')::timestamptz and updated_by = public.t_admin_uid()
    from public.content_overrides where key = 'home.hero.title' and locale = 'pl' $q$);
select public.t_raises(
  'A6  writing the value that is already there is a noop',
  'authenticated', $q$ select public.content_override_write('home.hero.title', 'pl', 'Witaj ponownie',
                                                            public.t_var('A4')::timestamptz, 'save') $q$,
  'noop');
select public.t_raises(
  'A7  a stale base (the first write''s timestamp) is a conflict',
  'authenticated', $q$ select public.content_override_write('home.hero.title', 'pl', 'Nadpisane',
                                                            public.t_var('A1')::timestamptz, 'save') $q$,
  'conflict');
select public.t_raises(
  'A8  an action outside save / reset / restore is refused',
  'authenticated', $q$ select public.content_override_write('home.hero.sub', 'pl', 'x', null, 'bulk') $q$,
  'bad_action');
select public.t_raises(
  'A9  a key without a dot is refused by the table CHECK',
  'authenticated', $q$ select public.content_override_write('nokey', 'pl', 'x', null, 'save') $q$,
  'content_overrides_key_check');
select public.t_raises(
  'A10 a locale outside pl / en / de is refused by the table CHECK',
  'authenticated', $q$ select public.content_override_write('home.hero.sub', 'fr', 'x', null, 'save') $q$,
  'content_overrides_locale_check');

-- Invisible, markup and control characters, and the length bounds.
select public.t_raises('A11 refused text: markup <b>x</b>', 'authenticated',
  $q$ select public.content_override_write('home.invalid.probe', 'pl', '<b>x</b>', null, 'save') $q$, 'invalid_text');
select public.t_raises('A12 refused text: a zero-width space (U+200B)', 'authenticated',
  $q$ select public.content_override_write('home.invalid.probe', 'pl', U&'Wi\200Btaj', null, 'save') $q$, 'invalid_text');
select public.t_raises('A13 refused text: a Unicode TAG character (U+E0041)', 'authenticated',
  $q$ select public.content_override_write('home.invalid.probe', 'pl', U&'Witaj\+0E0041', null, 'save') $q$, 'invalid_text');
select public.t_raises('A14 refused text: a newline', 'authenticated',
  $q$ select public.content_override_write('home.invalid.probe', 'pl', 'Wi' || chr(10) || 'taj', null, 'save') $q$, 'invalid_text');
select public.t_raises('A15 refused text: the empty string', 'authenticated',
  $q$ select public.content_override_write('home.invalid.probe', 'pl', '', null, 'save') $q$, 'invalid_text');
select public.t_raises('A16 refused text: 2001 characters', 'authenticated',
  $q$ select public.content_override_write('home.invalid.probe', 'pl', repeat('a', 2001), null, 'save') $q$, 'invalid_text');
select public.t_raises('A17 refused text: a bidi override (U+202E)', 'authenticated',
  $q$ select public.content_override_write('home.invalid.probe', 'pl', U&'abc\202Edef', null, 'save') $q$, 'invalid_text');
select public.t_true(
  'A18 2000 characters is still fine (the bound is inclusive)',
  'authenticated', $q$
  select public.content_override_write('home.long.probe', 'de', repeat('a', 2000), null, 'save') is not null $q$);
select public.t_true(
  'A19 none of the refused writes stored anything',
  'authenticated', $q$
  select count(*) = 0 from public.content_overrides
   where key in ('home.invalid.probe', 'nokey', 'home.hero.sub') $q$);
-- The table CHECK is the second lock: a writer that skips the function (the
-- service role, the SQL editor) meets the same rules.
select public.t_raises(
  'A20 the table CHECK refuses markup even from a writer that skips the function',
  'postgres', $q$ insert into public.content_overrides (key, locale, value) values ('home.x.y', 'pl', 'a<script>') $q$,
  'content_overrides_value_check');
select public.t_raises(
  'A21 and a newline',
  'postgres', $q$ insert into public.content_overrides (key, locale, value) values ('home.x.y', 'pl', 'a' || chr(13) || chr(10) || 'b') $q$,
  'content_overrides_value_check');

-- Nobody writes the table directly. Not even an admin.
select public.t_raises(
  'A22 an admin cannot INSERT into content_overrides directly',
  'authenticated', $q$ insert into public.content_overrides (key, locale, value) values ('home.x.y', 'pl', 'x') $q$,
  'row-level security');
select public.t_true(
  'A23 an admin''s direct UPDATE reaches no rows',
  'authenticated', $q$
  with u as (update public.content_overrides set value = 'hijack' returning 1) select count(*) = 0 from u $q$);
select public.t_true(
  'A24 an admin''s direct DELETE reaches no rows',
  'authenticated', $q$
  with d as (delete from public.content_overrides returning 1) select count(*) = 0 from d $q$);

select public.t_true(
  'A25 a reset (value null) with the right base deletes the row and returns null',
  'authenticated', $q$
  select public.content_override_write('home.hero.title', 'pl', null, public.t_var('A4')::timestamptz, 'reset') is null $q$);
select public.t_true(
  'A26 and the key is back to the dictionary''s text (no row)',
  'authenticated', $q$
  select count(*) = 0 from public.content_overrides where key = 'home.hero.title' and locale = 'pl' $q$);
select public.t_raises(
  'A27 resetting a key that has no override is a noop',
  'authenticated', $q$ select public.content_override_write('home.hero.title', 'pl', null, null, 'reset') $q$,
  'noop');
select public.t_true(
  'A28 a restore writes it back as a fresh row',
  'authenticated', $q$
  with r as (select public.content_override_write('home.hero.title', 'pl', 'Witaj', null, 'restore') as ts),
       s as (insert into public.t_vars select 'A28', ts::text from r returning v)
  select (select v from s) is not null $q$);
select public.t_true(
  'A29 a second locale of the same key is its own row',
  'authenticated', $q$
  select public.content_override_write('home.hero.title', 'en', 'Welcome', null, 'save') is not null $q$);

-- ── a signed-in customer ──
select public.t_be('customer');
select public.t_raises(
  'A30 a customer calling content_override_write is refused by its own check',
  'authenticated', $q$ select public.content_override_write('home.hero.title', 'pl', 'Hacked', public.t_var('A28')::timestamptz, 'save') $q$,
  'not_admin');
select public.t_true(
  'A31 a customer selects 0 rows from content_overrides (3 exist)',
  'authenticated', $q$ select count(*) = 0 from public.content_overrides $q$);
select public.t_raises(
  'A32 a customer cannot INSERT directly',
  'authenticated', $q$ insert into public.content_overrides (key, locale, value) values ('home.x.y', 'pl', 'x') $q$,
  'row-level security');
select public.t_true(
  'A33 a customer''s UPDATE reaches no rows',
  'authenticated', $q$
  with u as (update public.content_overrides set value = 'Hacked' returning 1) select count(*) = 0 from u $q$);
select public.t_true(
  'A34 a customer''s DELETE reaches no rows',
  'authenticated', $q$
  with d as (delete from public.content_overrides returning 1) select count(*) = 0 from d $q$);
select public.t_true(
  'A35 a customer reads the published values through content_overrides_published()',
  'authenticated', $q$
  select count(*) = 3 from public.content_overrides_published() $q$);

-- ── an anonymous visitor ──
select public.t_be('anon');
select public.t_raises(
  'A36 an anonymous caller cannot even reach content_override_write',
  'anon', $q$ select public.content_override_write('home.hero.title', 'pl', 'Hacked', null, 'save') $q$,
  'permission denied for function content_override_write');
select public.t_true(
  'A37 an anonymous SELECT of content_overrides returns 0 rows, not an error (3 exist)',
  'anon', $q$ select count(*) = 0 from public.content_overrides $q$);
select public.t_raises(
  'A38 an anonymous INSERT is refused outright',
  'anon', $q$ insert into public.content_overrides (key, locale, value) values ('home.x.y', 'pl', 'x') $q$,
  'row-level security');
select public.t_true(
  'A39 an anonymous UPDATE / DELETE reaches no rows',
  'anon', $q$
  with u as (update public.content_overrides set value = 'Hacked' returning 1),
       d as (delete from public.content_overrides returning 1)
  select (select count(*) from u) = 0 and (select count(*) from d) = 0 $q$);
select public.t_true(
  'A40 content_overrides_published() is open to anon and returns (key, locale, value)',
  'anon', $q$
  select pg_get_function_result('public.content_overrides_published()'::regprocedure) = 'TABLE(key text, locale text, value text)'
     and (select count(*) from public.content_overrides_published()) = 3
     and exists (select 1 from public.content_overrides_published()
                  where key = 'home.hero.title' and locale = 'pl' and value = 'Witaj') $q$);

-- ── back to the admin: nothing above moved anything ──
select public.t_be('admin');
select public.t_true(
  'A41 after every customer and anonymous attempt the rows are exactly as the admin left them',
  'authenticated', $q$
  select (select value = 'Witaj' and updated_at = public.t_var('A28')::timestamptz
            from public.content_overrides where key = 'home.hero.title' and locale = 'pl')
     and (select value = 'Welcome' from public.content_overrides where key = 'home.hero.title' and locale = 'en')
     and (select count(*) from public.content_overrides) = 3 $q$);

-- ── the history ──
select public.t_true(
  'A42 home.hero.title/pl has exactly 4 history rows — the noop, conflicts and refusals left none',
  'authenticated', $q$
  select count(*) = 4 from public.content_versions where target = 'text' and key = 'home.hero.title' and locale = 'pl' $q$);
select public.t_true(
  'A43 #1 save: before null, after Witaj (+ the returned timestamp), by the admin',
  'authenticated', $q$
  select action = 'save' and before is null and after->>'value' = 'Witaj'
     and (after->>'updated_at')::timestamptz = public.t_var('A1')::timestamptz and created_by = public.t_admin_uid()
    from public.content_versions where target = 'text' and key = 'home.hero.title' and locale = 'pl'
   order by created_at offset 0 limit 1 $q$);
select public.t_true(
  'A44 #2 save: before Witaj, after Witaj ponownie',
  'authenticated', $q$
  select action = 'save' and before->>'value' = 'Witaj' and after->>'value' = 'Witaj ponownie'
     and created_by = public.t_admin_uid()
    from public.content_versions where target = 'text' and key = 'home.hero.title' and locale = 'pl'
   order by created_at offset 1 limit 1 $q$);
select public.t_true(
  'A45 #3 reset: before Witaj ponownie, after null',
  'authenticated', $q$
  select action = 'reset' and before->>'value' = 'Witaj ponownie' and after is null
     and created_by = public.t_admin_uid()
    from public.content_versions where target = 'text' and key = 'home.hero.title' and locale = 'pl'
   order by created_at offset 2 limit 1 $q$);
select public.t_true(
  'A46 #4 restore: before null, after Witaj',
  'authenticated', $q$
  select action = 'restore' and before is null and after->>'value' = 'Witaj'
     and created_by = public.t_admin_uid()
    from public.content_versions where target = 'text' and key = 'home.hero.title' and locale = 'pl'
   order by created_at offset 3 limit 1 $q$);
select public.t_true(
  'A47 every text history row so far is one per successful write (pl 4 + en 1 + de 1)',
  'authenticated', $q$ select count(*) = 6 from public.content_versions where target = 'text' $q$);
-- A writer that goes around the function (service role, SQL editor) still
-- leaves history — the trigger is on the table, not in the function. Such a
-- writer carries no user, so the caller is nobody for this one statement.
select public.t_be('nobody');
select public.t_true(
  'A48 a write that skips the function is still recorded, as ''external''',
  'postgres', $q$
  with u as (update public.content_overrides set value = 'Welcome!', updated_at = now()
              where key = 'home.hero.title' and locale = 'en' returning 1)
  select (select count(*) from u) = 1 $q$);
select public.t_be('admin');
select public.t_true(
  'A49 … with the before / after values and no author',
  'authenticated', $q$
  select count(*) = 1 and bool_and(before->>'value' = 'Welcome' and after->>'value' = 'Welcome!' and created_by is null)
    from public.content_versions where target = 'text' and key = 'home.hero.title' and locale = 'en' and action = 'external' $q$);
SQL

# ── B. THE HISTORY IS APPEND-ONLY FOR EVERY CLIENT ──────────────────────────
"${PSQL[@]}" >/dev/null <<'SQL'
select public.t_be('admin');

select public.t_true(
  'B1  there is history to hide (read as the owner)',
  'postgres', $q$
  with s as (insert into public.t_vars values ('B_count', (select count(*) from public.content_versions)::text),
                                              ('B_print', public.t_fingerprint()) returning 1)
  select (select count(*) from s) = 2 and (select count(*) from public.content_versions) > 0 $q$);
select public.t_true(
  'B2  an admin sees every history row',
  'authenticated', $q$ select count(*) = public.t_var('B_count')::int from public.content_versions $q$);
select public.t_raises(
  'B3  an admin cannot INSERT a history row',
  'authenticated', $q$ insert into public.content_versions (target, key, action) values ('text', 'home.fake.row', 'save') $q$,
  'row-level security');
select public.t_true(
  'B4  an admin''s UPDATE of history reaches no rows',
  'authenticated', $q$ with u as (update public.content_versions set action = 'restore' returning 1) select count(*) = 0 from u $q$);
select public.t_true(
  'B5  an admin''s DELETE of history reaches no rows',
  'authenticated', $q$ with d as (delete from public.content_versions returning 1) select count(*) = 0 from d $q$);

select public.t_be('customer');
select public.t_true(
  'B6  a customer sees 0 history rows',
  'authenticated', $q$ select count(*) = 0 from public.content_versions $q$);
select public.t_raises(
  'B7  a customer cannot INSERT a history row',
  'authenticated', $q$ insert into public.content_versions (target, key, action) values ('text', 'home.fake.row', 'save') $q$,
  'row-level security');
select public.t_true(
  'B8  a customer''s UPDATE / DELETE of history reaches no rows',
  'authenticated', $q$
  with u as (update public.content_versions set action = 'restore' returning 1),
       d as (delete from public.content_versions returning 1)
  select (select count(*) from u) = 0 and (select count(*) from d) = 0 $q$);

select public.t_be('anon');
select public.t_true(
  'B9  an anonymous visitor sees 0 history rows',
  'anon', $q$ select count(*) = 0 from public.content_versions $q$);
select public.t_raises(
  'B10 an anonymous visitor cannot INSERT a history row',
  'anon', $q$ insert into public.content_versions (target, key, action) values ('text', 'home.fake.row', 'save') $q$,
  'row-level security');
select public.t_true(
  'B11 an anonymous UPDATE / DELETE of history reaches no rows',
  'anon', $q$
  with u as (update public.content_versions set action = 'restore' returning 1),
       d as (delete from public.content_versions returning 1)
  select (select count(*) from u) = 0 and (select count(*) from d) = 0 $q$);

select public.t_be('admin');
select public.t_true(
  'B12 after all of that, not one row was added, changed or removed',
  'postgres', $q$ select public.t_fingerprint() = public.t_var('B_print') $q$);
SQL

# ── C. PICTURE SLOTS — CHECKs, media_slots_write, history, framing, resolve ─
"${PSQL[@]}" >/dev/null <<'SQL'
select public.t_be('admin');

-- A probe row for the CHECKs (inserted directly by the admin, which RLS allows).
select public.t_true(
  'C0  an admin may still insert a slot directly (RLS allows it, 0090)',
  'authenticated', $q$
  with i as (insert into public.media_slots (slot_key, entity_type, entity_id, slot_name, media_id)
             values ('global.ice.probe', 'global', 'ice', 'probe', 'a0000000-0000-0000-0000-000000000002') returning 1)
  select count(*) = 1 from i $q$);

-- crop
select public.t_true('C1  crop {x:50,y:50,zoom:1} is accepted', 'authenticated', $q$
  with u as (update public.media_slots set crop = '{"x":50,"y":50,"zoom":1}' where slot_key = 'global.ice.probe' returning 1)
  select count(*) = 1 from u $q$);
select public.t_true('C2  crop with a mobile frame m {x:0,y:100,zoom:2.5} is accepted', 'authenticated', $q$
  with u as (update public.media_slots set crop = '{"x":50,"y":50,"zoom":1,"m":{"x":0,"y":100,"zoom":2.5}}'
              where slot_key = 'global.ice.probe' returning 1)
  select count(*) = 1 from u $q$);
select public.t_raises('C3  crop zoom 3 is refused', 'authenticated',
  $q$ update public.media_slots set crop = '{"x":50,"y":50,"zoom":3}' where slot_key = 'global.ice.probe' $q$,
  'media_slots_crop_check');
select public.t_raises('C4  crop x 101 is refused', 'authenticated',
  $q$ update public.media_slots set crop = '{"x":101,"y":50,"zoom":1}' where slot_key = 'global.ice.probe' $q$,
  'media_slots_crop_check');
select public.t_raises('C5  crop with an extra key is refused', 'authenticated',
  $q$ update public.media_slots set crop = '{"x":50,"y":50,"zoom":1,"rotate":90}' where slot_key = 'global.ice.probe' $q$,
  'media_slots_crop_check');
select public.t_raises('C6  crop with string values is refused', 'authenticated',
  $q$ update public.media_slots set crop = '{"x":"50","y":"50","zoom":"1"}' where slot_key = 'global.ice.probe' $q$,
  'media_slots_crop_check');
select public.t_raises('C7  crop with a non-numeric string is refused by the CHECK, not a cast error', 'authenticated',
  $q$ update public.media_slots set crop = '{"x":"abc","y":50,"zoom":1}' where slot_key = 'global.ice.probe' $q$,
  'media_slots_crop_check');
select public.t_raises('C8  a mobile frame with zoom 0.5 is refused', 'authenticated',
  $q$ update public.media_slots set crop = '{"x":50,"y":50,"zoom":1,"m":{"x":1,"y":1,"zoom":0.5}}' where slot_key = 'global.ice.probe' $q$,
  'media_slots_crop_check');
select public.t_raises('C9  a mobile frame with an extra key is refused', 'authenticated',
  $q$ update public.media_slots set crop = '{"x":50,"y":50,"zoom":1,"m":{"x":1,"y":1,"zoom":1,"q":1}}' where slot_key = 'global.ice.probe' $q$,
  'media_slots_crop_check');
select public.t_raises('C10 a crop that is an array is refused', 'authenticated',
  $q$ update public.media_slots set crop = '[50,50,1]' where slot_key = 'global.ice.probe' $q$,
  'media_slots_crop_check');

-- alt_i18n
select public.t_true('C11 alt_i18n {pl:''a''} is accepted', 'authenticated', $q$
  with u as (update public.media_slots set alt_i18n = '{"pl":"a"}' where slot_key = 'global.ice.probe' returning 1)
  select count(*) = 1 from u $q$);
select public.t_true('C12 alt_i18n with pl/en/de and 300 characters is accepted', 'authenticated', $q$
  with u as (update public.media_slots set alt_i18n = jsonb_build_object('pl', repeat('a', 300), 'en', 'b', 'de', 'c')
              where slot_key = 'global.ice.probe' returning 1)
  select count(*) = 1 from u $q$);
select public.t_raises('C13 alt_i18n {fr:''a''} is refused', 'authenticated',
  $q$ update public.media_slots set alt_i18n = '{"fr":"a"}' where slot_key = 'global.ice.probe' $q$,
  'media_slots_alt_i18n_check');
select public.t_raises('C14 alt_i18n of 301 characters is refused', 'authenticated',
  $q$ update public.media_slots set alt_i18n = jsonb_build_object('pl', repeat('a', 301)) where slot_key = 'global.ice.probe' $q$,
  'media_slots_alt_i18n_check');
select public.t_raises('C15 alt_i18n containing ''<'' is refused', 'authenticated',
  $q$ update public.media_slots set alt_i18n = '{"pl":"a <img>"}' where slot_key = 'global.ice.probe' $q$,
  'media_slots_alt_i18n_check');
select public.t_raises('C16 alt_i18n with a newline is refused', 'authenticated',
  $q$ update public.media_slots set alt_i18n = jsonb_build_object('pl', 'a' || chr(10) || 'b') where slot_key = 'global.ice.probe' $q$,
  'media_slots_alt_i18n_check');
select public.t_raises('C17 alt_i18n with a non-string value is refused', 'authenticated',
  $q$ update public.media_slots set alt_i18n = '{"pl":42}' where slot_key = 'global.ice.probe' $q$,
  'media_slots_alt_i18n_check');

-- media_slots_write: who may call it
select public.t_be('customer');
select public.t_raises(
  'C18 a customer calling media_slots_write is refused by its own check',
  'authenticated', $q$ select public.media_slots_write(jsonb_build_array(
      public.t_slot('global.ice.evil', 'a0000000-0000-0000-0000-000000000001', 'x', null, null)), 'save') $q$,
  'not_admin');
select public.t_raises(
  'C19 and a customer''s direct INSERT is refused by RLS — the function is invoker, RLS is the lock',
  'authenticated', $q$ insert into public.media_slots (slot_key, entity_type, entity_id, slot_name)
                      values ('global.ice.evil', 'global', 'ice', 'evil') $q$,
  'row-level security');
select public.t_be('anon');
select public.t_raises(
  'C20 an anonymous caller cannot even reach media_slots_write',
  'anon', $q$ select public.media_slots_write(jsonb_build_array(
      public.t_slot('global.ice.evil', 'a0000000-0000-0000-0000-000000000001', 'x', null, null)), 'save') $q$,
  'permission denied for function media_slots_write');

-- media_slots_write: compare-and-set
select public.t_be('admin');
select public.t_true(
  'C21 an admin''s single write (no base) inserts the slot and returns {key: timestamp}',
  'authenticated', $q$
  with r as (select public.media_slots_write(jsonb_build_array(
               public.t_slot('global.ice.hero', 'a0000000-0000-0000-0000-000000000001', 'Bohater',
                             '{"x":50,"y":40,"zoom":1.2}', null)), 'save') as out),
       s as (insert into public.t_vars select 'C21', out ->> 'global.ice.hero' from r returning v)
  select (select array_agg(k) from r, jsonb_object_keys(r.out) k) = array['global.ice.hero']
     and (select v from s) is not null $q$);
select public.t_true(
  'C22 the row is entity_type global with the crop, alt and alt_i18n sent, stamped with that timestamp',
  'authenticated', $q$
  select entity_type = 'global' and entity_id = 'ice' and slot_name = 'hero'
     and media_id = 'a0000000-0000-0000-0000-000000000001' and alt_text = 'Bohater'
     and alt_i18n = '{"pl":"Bohater"}' and crop = '{"x":50,"y":40,"zoom":1.2}'
     and updated_at = public.t_var('C21')::timestamptz and updated_by = public.t_admin_uid()
    from public.media_slots where slot_key = 'global.ice.hero' $q$);
select public.t_raises(
  'C23 writing it again with no base is conflict:<key>',
  'authenticated', $q$ select public.media_slots_write(jsonb_build_array(
      public.t_slot('global.ice.hero', 'a0000000-0000-0000-0000-000000000001', 'Inny', null, null)), 'save') $q$,
  'conflict:global.ice.hero');
select public.t_true(
  'C24 with the right base it updates and returns the new timestamp',
  'authenticated', $q$
  with r as (select public.media_slots_write(jsonb_build_array(
               public.t_slot('global.ice.hero', 'a0000000-0000-0000-0000-000000000001', 'Bohater 2',
                             '{"x":50,"y":40,"zoom":1.2}', public.t_var('C21'))), 'save') as out),
       s as (insert into public.t_vars select 'C24', out ->> 'global.ice.hero' from r returning v)
  select (select v from s)::timestamptz > public.t_var('C21')::timestamptz $q$);
-- A SELECT of media_slots in that same statement would run in the outer
-- statement's snapshot and read the PRE-write row, so the stored value is
-- checked in a statement of its own.
select public.t_true(
  'C25 the row now carries the new alt text and exactly the returned timestamp',
  'authenticated', $q$
  select alt_text = 'Bohater 2' and updated_at = public.t_var('C24')::timestamptz
    from public.media_slots where slot_key = 'global.ice.hero' $q$);
select public.t_raises(
  'C26 a stale base (the first write''s timestamp) is conflict:<key>',
  'authenticated', $q$ select public.media_slots_write(jsonb_build_array(
      public.t_slot('global.ice.hero', 'a0000000-0000-0000-0000-000000000001', 'Nadpisany', null, public.t_var('C21'))), 'save') $q$,
  'conflict:global.ice.hero');

-- a pair is all or nothing
select public.t_true(
  'C27 a pair written in one call (bulk) creates both slots with one timestamp',
  'authenticated', $q$
  with r as (select public.media_slots_write(jsonb_build_array(
               public.t_slot('global.ice.pair_b', 'a0000000-0000-0000-0000-000000000002', 'B', null, null),
               public.t_slot('global.ice.pair_a', 'a0000000-0000-0000-0000-000000000001', 'A', null, null)), 'bulk') as out)
  select (select out ->> 'global.ice.pair_a' = out ->> 'global.ice.pair_b' from r)
     and (select count(*) from r, jsonb_object_keys(r.out)) = 2 $q$);
select public.t_true(
  'C28 (store pair_a''s state)',
  'postgres', $q$
  with s as (insert into public.t_vars
               select 'C28', row(alt_text, updated_at, media_id)::text from public.media_slots where slot_key = 'global.ice.pair_a'
             returning 1)
  select count(*) = 1 from s $q$);
select public.t_raises(
  'C29 a pair whose SECOND slot has a stale base fails as a whole …',
  'authenticated', $q$ select public.media_slots_write(jsonb_build_array(
      public.t_slot('global.ice.pair_a', 'a0000000-0000-0000-0000-000000000002', 'A zmienione', null,
                    (select updated_at::text from public.media_slots where slot_key = 'global.ice.pair_a')),
      public.t_slot('global.ice.pair_b', 'a0000000-0000-0000-0000-000000000001', 'B zmienione', null,
                    '2000-01-01 00:00:00+00')), 'save') $q$,
  'conflict:global.ice.pair_b');
select public.t_true(
  'C30 … and the FIRST slot, already updated inside the call, is exactly as it was',
  'authenticated', $q$
  select row(alt_text, updated_at, media_id)::text = public.t_var('C28')
    from public.media_slots where slot_key = 'global.ice.pair_a' $q$);
select public.t_raises(
  'C31 the same key twice in one call is a conflict, and nothing is written',
  'authenticated', $q$ select public.media_slots_write(jsonb_build_array(
      public.t_slot('global.ice.dup', 'a0000000-0000-0000-0000-000000000001', 'x', null, null),
      public.t_slot('global.ice.dup', 'a0000000-0000-0000-0000-000000000002', 'y', null, null)), 'save') $q$,
  'conflict:global.ice.dup');
select public.t_true(
  'C32 (no global.ice.dup row exists)',
  'authenticated', $q$ select count(*) = 0 from public.media_slots where slot_key = 'global.ice.dup' $q$);
select public.t_raises(
  'C33 61 writes in one call is bad_writes',
  'authenticated', $q$ select public.media_slots_write(
      (select jsonb_agg(public.t_slot('global.ice.n' || g, 'a0000000-0000-0000-0000-000000000001', 'x', null, null))
         from generate_series(1, 61) g), 'bulk') $q$,
  'bad_writes');
select public.t_raises(
  'C34 an empty array is bad_writes',
  'authenticated', $q$ select public.media_slots_write('[]'::jsonb, 'bulk') $q$, 'bad_writes');
select public.t_raises(
  'C35 an object instead of an array is bad_writes',
  'authenticated', $q$ select public.media_slots_write(
      public.t_slot('global.ice.obj', 'a0000000-0000-0000-0000-000000000001', 'x', null, null), 'save') $q$,
  'bad_writes');
select public.t_raises(
  'C36 an action of ''external'' cannot be claimed — bad_action',
  'authenticated', $q$ select public.media_slots_write(jsonb_build_array(
      public.t_slot('global.ice.act', 'a0000000-0000-0000-0000-000000000001', 'x', null, null)), 'external') $q$,
  'bad_action');
select public.t_raises(
  'C37 nor ''reset'' (a text action) — bad_action',
  'authenticated', $q$ select public.media_slots_write(jsonb_build_array(
      public.t_slot('global.ice.act', 'a0000000-0000-0000-0000-000000000001', 'x', null, null)), 'reset') $q$,
  'bad_action');
select public.t_true(
  'C38 60 writes in one call is fine (the bound is inclusive)',
  'authenticated', $q$
  select (select count(*) from jsonb_object_keys(public.media_slots_write(
            (select jsonb_agg(public.t_slot('global.ice.n' || g, 'a0000000-0000-0000-0000-000000000001', 'x', null, null))
               from generate_series(1, 60) g), 'bulk'))) = 60 $q$);

-- history for slots
select public.t_true(
  'C39 global.ice.hero has two history rows, both target slot and action save, by the admin',
  'authenticated', $q$
  select count(*) = 2 and bool_and(target = 'slot' and action = 'save' and locale is null and created_by = public.t_admin_uid())
    from public.content_versions where key = 'global.ice.hero' $q$);
select public.t_true(
  'C40 the first is the insert (before null), the second carries before / after alt and crop',
  'authenticated', $q$
  select (select before is null and after->>'alt_text' = 'Bohater' from public.content_versions
           where key = 'global.ice.hero' order by created_at limit 1)
     and (select before->>'alt_text' = 'Bohater' and after->>'alt_text' = 'Bohater 2'
                 and after->'crop' = '{"x":50,"y":40,"zoom":1.2}' and after->'alt_i18n' = '{"pl":"Bohater 2"}'
            from public.content_versions where key = 'global.ice.hero' order by created_at offset 1 limit 1) $q$);
select public.t_true(
  'C41 a bulk write records action bulk, once per slot; the refused pair and dup calls left nothing',
  'authenticated', $q$
  select (select count(*) from public.content_versions where key = 'global.ice.pair_a') = 1
     and (select count(*) from public.content_versions where key = 'global.ice.pair_b') = 1
     and (select bool_and(action = 'bulk') from public.content_versions where key in ('global.ice.pair_a', 'global.ice.pair_b'))
     and (select count(*) from public.content_versions where key = 'global.ice.dup') = 0
     and (select count(*) from public.content_versions where key like 'global.ice.n%') = 60 $q$);
select public.t_true(
  'C42 a clear is recorded as clear',
  'authenticated', $q$
  select (select count(*) from jsonb_object_keys(public.media_slots_write(jsonb_build_array(
            public.t_slot('global.ice.pair_b', null, null, null,
                          (select updated_at::text from public.media_slots where slot_key = 'global.ice.pair_b'))), 'clear'))) = 1 $q$);
select public.t_true(
  'C43 (… with media_id null after, and the old one before)',
  'authenticated', $q$
  select count(*) = 1 and bool_and(before->>'media_id' = 'a0000000-0000-0000-0000-000000000002' and after->>'media_id' is null)
    from public.content_versions where key = 'global.ice.pair_b' and action = 'clear' $q$);
select public.t_true(
  'C44 a plain admin UPDATE of media_slots (Admin → Media) is recorded as external',
  'authenticated', $q$
  with u as (update public.media_slots set alt_text = 'Zmienione w Media' where slot_key = 'global.ice.hero' returning 1)
  select count(*) = 1 from u $q$);
select public.t_true(
  'C45 (… one external row, by the admin, with the new alt text)',
  'authenticated', $q$
  select count(*) = 1 and bool_and(after->>'alt_text' = 'Zmienione w Media' and created_by = public.t_admin_uid())
    from public.content_versions where key = 'global.ice.hero' and action = 'external' $q$);
select public.t_true(
  'C46 an identical re-save bumps updated_at but adds no history row',
  'authenticated', $q$
  with s as (insert into public.t_vars values
               ('C46n', (select count(*) from public.content_versions where key = 'global.ice.pair_a')::text),
               ('C46t', (select updated_at::text from public.media_slots where slot_key = 'global.ice.pair_a'))
             returning 1),
       w as (select public.media_slots_write(jsonb_build_array(
               public.t_slot('global.ice.pair_a', 'a0000000-0000-0000-0000-000000000001', 'A', null,
                             (select updated_at::text from public.media_slots where slot_key = 'global.ice.pair_a'))), 'save') as out)
  select (select count(*) from s) = 2 and (select out ? 'global.ice.pair_a' from w) $q$);
select public.t_true(
  'C47 (… the count is unchanged and updated_at moved)',
  'authenticated', $q$
  select (select count(*) from public.content_versions where key = 'global.ice.pair_a') = public.t_var('C46n')::int
     and (select updated_at > public.t_var('C46t')::timestamptz
            from public.media_slots where slot_key = 'global.ice.pair_a') $q$);

-- the trigger function needs no EXECUTE at fire time
select public.t_true(
  'C48 content_versions_record is SECURITY DEFINER and no client role holds EXECUTE on it',
  'postgres', $q$
  select prosecdef
     and not has_function_privilege('authenticated', oid, 'execute')
     and not has_function_privilege('anon', oid, 'execute')
     and not has_function_privilege('public', oid, 'execute')
    from pg_proc where oid = 'public.content_versions_record()'::regprocedure $q$);
select public.t_true(
  'C49 yet the admin''s invoker-rights writes above fired it — EXECUTE is not checked when a trigger fires',
  'authenticated', $q$
  select not has_function_privilege('authenticated', 'public.content_versions_record()', 'execute')
     and (select prosecdef from pg_proc where oid = 'public.media_slots_write(jsonb, text)'::regprocedure) = false
     and exists (select 1 from public.content_versions
                  where target = 'slot' and key = 'global.ice.hero' and created_by = public.t_admin_uid()) $q$);

-- framing: a crop belongs to one picture
select public.t_true(
  'C50 (set up global.ice.crop: desktop a1, mobile a3, a frame with a mobile part)',
  'authenticated', $q$
  select public.media_slots_write(jsonb_build_array(
      public.t_slot('global.ice.crop', 'a0000000-0000-0000-0000-000000000001', 'Kadr',
                    '{"x":20,"y":30,"zoom":1.5,"m":{"x":40,"y":60,"zoom":2}}', null,
                    'a0000000-0000-0000-0000-000000000003')), 'save') ? 'global.ice.crop' $q$);
select public.t_true(
  'C51 a direct admin swap of the desktop picture drops the frame',
  'authenticated', $q$
  with u as (update public.media_slots set media_id = 'a0000000-0000-0000-0000-000000000002'
              where slot_key = 'global.ice.crop' returning crop)
  select count(*) = 1 and bool_and(crop is null) from u $q$);
select public.t_true(
  'C52 (… and the history row shows the frame that was dropped)',
  'authenticated', $q$
  select count(*) = 1 and bool_and(before->'crop' = '{"x":20,"y":30,"zoom":1.5,"m":{"x":40,"y":60,"zoom":2}}' and after->'crop' = 'null')
    from public.content_versions where key = 'global.ice.crop' and action = 'external' $q$);
select public.t_true(
  'C53 media_slots_write swapping the picture WITH a frame keeps the frame it sent',
  'authenticated', $q$
  select public.media_slots_write(jsonb_build_array(
      public.t_slot('global.ice.crop', 'a0000000-0000-0000-0000-000000000001', 'Kadr',
                    '{"x":70,"y":20,"zoom":1.1,"m":{"x":50,"y":50,"zoom":1}}',
                    (select updated_at::text from public.media_slots where slot_key = 'global.ice.crop'),
                    'a0000000-0000-0000-0000-000000000003')), 'save') ? 'global.ice.crop' $q$);
select public.t_true(
  'C54 (… the stored frame is exactly the one sent)',
  'authenticated', $q$
  select media_id = 'a0000000-0000-0000-0000-000000000001' and crop = '{"x":70,"y":20,"zoom":1.1,"m":{"x":50,"y":50,"zoom":1}}'
    from public.media_slots where slot_key = 'global.ice.crop' $q$);
select public.t_true(
  'C55 a direct swap of the MOBILE picture drops only the mobile part of the frame',
  'authenticated', $q$
  with u as (update public.media_slots set mobile_media_id = 'a0000000-0000-0000-0000-000000000005'
              where slot_key = 'global.ice.crop' returning crop)
  select count(*) = 1 and bool_and(crop = '{"x":70,"y":20,"zoom":1.1}') from u $q$);
select public.t_true(
  'C56 a direct swap that sets a NEW frame in the same statement keeps the new frame',
  'authenticated', $q$
  with u as (update public.media_slots set media_id = 'a0000000-0000-0000-0000-000000000002', crop = '{"x":1,"y":2,"zoom":2}'
              where slot_key = 'global.ice.crop' returning crop)
  select count(*) = 1 and bool_and(crop = '{"x":1,"y":2,"zoom":2}') from u $q$);
select public.t_true(
  'C57 an edit that does not touch the picture leaves the frame alone',
  'authenticated', $q$
  with u as (update public.media_slots set alt_text = 'Tylko alt' where slot_key = 'global.ice.crop' returning crop)
  select count(*) = 1 and bool_and(crop = '{"x":1,"y":2,"zoom":2}') from u $q$);
select public.t_true(
  'C58 deleting the picture itself (FK on delete set null) drops the frame and is recorded as external',
  'authenticated', $q$
  with w as (select public.media_slots_write(jsonb_build_array(
               public.t_slot('global.ice.gone', 'a0000000-0000-0000-0000-000000000006', 'Zniknie',
                             '{"x":10,"y":10,"zoom":1}', null)), 'save') as out)
  select (select out ? 'global.ice.gone' from w) $q$);
select public.t_true(
  'C59 (… delete the asset)',
  'authenticated', $q$
  with d as (delete from public.media_assets where id = 'a0000000-0000-0000-0000-000000000006' returning 1)
  select count(*) = 1 from d $q$);
select public.t_true(
  'C60 (… the slot lost its picture and its frame, and history says external)',
  'authenticated', $q$
  select (select media_id is null and crop is null from public.media_slots where slot_key = 'global.ice.gone')
     and (select count(*) = 1 and bool_and(after->'crop' = 'null' and before->>'media_id' = 'a0000000-0000-0000-0000-000000000006')
            from public.content_versions where key = 'global.ice.gone' and action = 'external') $q$);

-- the resolver
select public.t_true(
  'C61 (set up: a full slot, one whose desktop file is empty, one to be switched off)',
  'authenticated', $q$
  select (select count(*) from jsonb_object_keys(public.media_slots_write(jsonb_build_array(
            public.t_slot('global.ice.show', 'a0000000-0000-0000-0000-000000000001', 'Pokaz',
                          '{"x":30,"y":70,"zoom":1.4}', null, 'a0000000-0000-0000-0000-000000000003'),
            public.t_slot('global.ice.empty', 'a0000000-0000-0000-0000-000000000004', 'Pusty', null, null),
            public.t_slot('global.ice.off', 'a0000000-0000-0000-0000-000000000005', 'Wyłączony', null, null)), 'bulk'))) = 3 $q$);
select public.t_true(
  'C62 (switch global.ice.off off)',
  'authenticated', $q$
  with u as (update public.media_slots set enabled = false where slot_key = 'global.ice.off' returning 1)
  select count(*) = 1 from u $q$);

select public.t_be('anon');
select public.t_true(
  'C63 an anonymous visitor resolves a slot with crop, alt_i18n and mobile_variants',
  'anon', $q$
  select count(*) = 1 and bool_and(
           crop = '{"x":30,"y":70,"zoom":1.4}' and alt_i18n = '{"pl":"Pokaz"}'
       and mobile_variants = '{"480":"https://cdn.test/hero-mobile_w480.webp"}'
       and mobile_path = 'media/hero-mobile.jpg' and desktop_path = 'media/hero.jpg'
       and desktop_variants ? '640' and desktop_width = 1600)
    from public.media_slots_resolve_v2(array['global.ice.show']) $q$);
select public.t_true(
  'C64 a slot whose desktop file has neither a path nor a URL is not returned',
  'anon', $q$ select count(*) = 0 from public.media_slots_resolve_v2(array['global.ice.empty']) $q$);
select public.t_true(
  'C65 a switched-off slot is not returned',
  'anon', $q$ select count(*) = 0 from public.media_slots_resolve_v2(array['global.ice.off']) $q$);
select public.t_true(
  'C66 201 keys return nothing at all, even the valid one',
  'anon', $q$
  select count(*) = 0 from public.media_slots_resolve_v2(
    array['global.ice.show'] || array(select 'global.pad.k' || g from generate_series(1, 200) g)) $q$);
select public.t_true(
  'C67 200 keys still resolve (the bound is inclusive)',
  'anon', $q$
  select count(*) = 1 from public.media_slots_resolve_v2(
    array['global.ice.show'] || array(select 'global.pad.k' || g from generate_series(1, 199) g)) $q$);
select public.t_true(
  'C68 the anonymous visitor still cannot read media_slots or media_assets directly',
  'anon', $q$ select (select count(*) from public.media_slots) = 0 and (select count(*) from public.media_assets) = 0 $q$);
select public.t_true(
  'C69 an external-URL-only desktop file resolves too',
  'postgres', $q$
  with u as (update public.media_slots set enabled = true where slot_key = 'global.ice.off' returning 1)
  select count(*) = 1 from u $q$);
select public.t_true(
  'C70 (… with desktop_url set and desktop_path null)',
  'anon', $q$
  select count(*) = 1 and bool_and(desktop_url = 'https://cdn.test/ext.jpg' and desktop_path is null)
    from public.media_slots_resolve_v2(array['global.ice.off']) $q$);
SQL

# ── D. cms_inline_patch — one field of one PUBLISHED block ──────────────────
"${PSQL[@]}" >/dev/null <<'SQL'
select public.t_be('customer');
select public.t_raises(
  'D1  a customer calling cms_inline_patch is refused by its own check',
  'authenticated', $q$ select public.cms_inline_patch('b0000000-0000-0000-0000-000000000001',
      array['title', 'pl'], 'Hacked', 'Stary', null, null, 'save') $q$,
  'not_admin');
select public.t_be('anon');
select public.t_raises(
  'D2  an anonymous caller cannot even reach cms_inline_patch',
  'anon', $q$ select public.cms_inline_patch('b0000000-0000-0000-0000-000000000001',
      array['title', 'pl'], 'Hacked', 'Stary', null, null, 'save') $q$,
  'permission denied for function cms_inline_patch');

select public.t_be('admin');
select public.t_true(
  'D3  (nothing moved: still Stary in the draft and the snapshot)',
  'authenticated', $q$
  select (select content #>> '{title,pl}' from public.cms_blocks where id = 'b0000000-0000-0000-0000-000000000001') = 'Stary'
     and (select published_snapshot -> 0 -> 'content' #>> '{title,pl}' from public.cms_pages
           where id = 'f0000000-0000-0000-0000-000000000001') = 'Stary' $q$);
select public.t_true(
  'D4  an admin patches {title,pl} Stary → Nowy and gets a timestamp back',
  'authenticated', $q$
  with r as (select public.cms_inline_patch('b0000000-0000-0000-0000-000000000001',
               array['title', 'pl'], 'Nowy', 'Stary', 'Edytor wizualny: tytuł', null, 'save') as ts),
       s as (insert into public.t_vars select 'D4', ts::text from r returning v)
  select (select pg_typeof(ts) from r) = 'timestamptz'::regtype and (select v from s) is not null $q$);
select public.t_true(
  'D5  the draft block holds Nowy, stamped with that timestamp and the admin; the other locale is untouched',
  'authenticated', $q$
  select content #>> '{title,pl}' = 'Nowy' and content #>> '{title,en}' = 'Old' and content #>> '{subtitle,pl}' = 'Pod'
     and updated_at = public.t_var('D4')::timestamptz and updated_by = public.t_admin_uid()
    from public.cms_blocks where id = 'b0000000-0000-0000-0000-000000000001' $q$);
select public.t_true(
  'D6  the published snapshot holds Nowy too, and the page is stamped',
  'authenticated', $q$
  select published_snapshot -> 0 -> 'content' #>> '{title,pl}' = 'Nowy'
     and published_snapshot -> 0 -> 'content' #>> '{title,en}' = 'Old'
     and published_at = public.t_var('D4')::timestamptz and updated_at = public.t_var('D4')::timestamptz
     and updated_by = public.t_admin_uid() and status = 'published'
    from public.cms_pages where id = 'f0000000-0000-0000-0000-000000000001' $q$);
select public.t_true(
  'D7  a page version was written: reason publish, version 4 (max 3 + 1), the label, the new snapshot',
  'authenticated', $q$
  select count(*) = 1 and bool_and(reason = 'publish' and label = 'Edytor wizualny: tytuł'
           and snapshot = (select published_snapshot from public.cms_pages where id = 'f0000000-0000-0000-0000-000000000001')
           and snapshot -> 0 -> 'content' #>> '{title,pl}' = 'Nowy'
           and seo = '{"pl":{"title":"Cennik"}}' and created_by = public.t_admin_uid())
    from public.cms_page_versions where page_id = 'f0000000-0000-0000-0000-000000000001' and version = 4 $q$);
select public.t_true(
  'D8  and one history row: target cms, locale pl, action save, before Stary, after Nowy',
  'authenticated', $q$
  select count(*) = 1 and bool_and(locale = 'pl' and action = 'save'
           and before = '{"value":"Stary"}' and after = '{"value":"Nowy"}' and created_by = public.t_admin_uid())
    from public.content_versions
   where target = 'cms'
     and key = 'f0000000-0000-0000-0000-000000000001:b0000000-0000-0000-0000-000000000001:title.pl' $q$);
select public.t_raises(
  'D9  a wrong expected value (the admin saw something else) is a conflict',
  'authenticated', $q$ select public.cms_inline_patch('b0000000-0000-0000-0000-000000000001',
      array['title', 'pl'], 'Trzeci', 'Stary', null, null, 'save') $q$,
  'conflict');
select public.t_raises(
  'D10 the value that is already live is a noop',
  'authenticated', $q$ select public.cms_inline_patch('b0000000-0000-0000-0000-000000000001',
      array['title', 'pl'], 'Nowy', 'Nowy', null, null, 'save') $q$,
  'noop');
select public.t_raises(
  'D11 a base that is not the block''s updated_at is a conflict',
  'authenticated', $q$ select public.cms_inline_patch('b0000000-0000-0000-0000-000000000001',
      array['title', 'pl'], 'Trzeci', 'Nowy', null, '2000-01-01 00:00:00+00', 'save') $q$,
  'conflict');
select public.t_true(
  'D12 (the draft is edited in the builder: title.pl = Szkic, unpublished)',
  'authenticated', $q$
  with u as (update public.cms_blocks set content = jsonb_set(content, '{title,pl}', '"Szkic"')
              where id = 'b0000000-0000-0000-0000-000000000001' returning 1)
  select count(*) = 1 from u $q$);
select public.t_raises(
  'D13 a draft that holds a different unpublished value is draft_diverged — never overwritten unseen',
  'authenticated', $q$ select public.cms_inline_patch('b0000000-0000-0000-0000-000000000001',
      array['title', 'pl'], 'Trzeci', 'Nowy', null, null, 'save') $q$,
  'draft_diverged');
select public.t_true(
  'D14 (the draft goes back to the live value)',
  'authenticated', $q$
  with u as (update public.cms_blocks set content = jsonb_set(content, '{title,pl}', '"Nowy"')
              where id = 'b0000000-0000-0000-0000-000000000001' returning 1)
  select count(*) = 1 from u $q$);
-- The guard is the WHOLE block, not the one path: any unpublished change in
-- the block (another field, items reordered) means a path may not name the
-- same thing in the draft and the live copy.
select public.t_true(
  'D14b (an unrelated field of the same block changes in the draft, unpublished)',
  'authenticated', $q$
  with u as (update public.cms_blocks set content = content || '{"x_unpublished": {"pl": "Szkic"}}'::jsonb
              where id = 'b0000000-0000-0000-0000-000000000001' returning 1)
  select count(*) = 1 from u $q$);
select public.t_raises(
  'D14c … then even the untouched title is draft_diverged (the block has unpublished changes)',
  'authenticated', $q$ select public.cms_inline_patch('b0000000-0000-0000-0000-000000000001',
      array['title', 'pl'], 'Trzeci', 'Nowy', null, null, 'save') $q$,
  'draft_diverged');
select public.t_true(
  'D14d (the unpublished change is discarded again)',
  'authenticated', $q$
  with u as (update public.cms_blocks set content = content - 'x_unpublished'
              where id = 'b0000000-0000-0000-0000-000000000001' returning 1)
  select count(*) = 1 from u $q$);
select public.t_raises(
  'D15 a page that is not published (draft, old snapshot still on it) is not_published',
  'authenticated', $q$ select public.cms_inline_patch('b0000000-0000-0000-0000-000000000005',
      array['title', 'pl'], 'Nowe o nas', 'O nas', null, null, 'save') $q$,
  'not_published');
select public.t_raises(
  'D16 a draft-only block of a published page is not_in_snapshot',
  'authenticated', $q$ select public.cms_inline_patch('b0000000-0000-0000-0000-000000000003',
      array['title', 'pl'], 'Nowa sekcja', 'Szkic nowej sekcji', null, null, 'save') $q$,
  'not_in_snapshot');
select public.t_raises(
  'D17 a block that does not exist is block_missing',
  'authenticated', $q$ select public.cms_inline_patch('b0000000-0000-0000-0000-0000000000ff',
      array['title', 'pl'], 'x', 'y', null, null, 'save') $q$,
  'block_missing');
select public.t_raises(
  'D18 p_action bogus is bad_action',
  'authenticated', $q$ select public.cms_inline_patch('b0000000-0000-0000-0000-000000000001',
      array['title', 'pl'], 'Trzeci', 'Nowy', null, null, 'bogus') $q$,
  'bad_action');
select public.t_raises(
  'D19 a value containing ''<'' is invalid_text',
  'authenticated', $q$ select public.cms_inline_patch('b0000000-0000-0000-0000-000000000001',
      array['title', 'pl'], 'Trzeci <script>', 'Nowy', null, null, 'save') $q$,
  'invalid_text');
select public.t_raises(
  'D20 a value with a zero-width space is invalid_text',
  'authenticated', $q$ select public.cms_inline_patch('b0000000-0000-0000-0000-000000000001',
      array['title', 'pl'], U&'Trz\200Beci', 'Nowy', null, null, 'save') $q$,
  'invalid_text');
select public.t_raises(
  'D21 a path of 7 elements is bad_path',
  'authenticated', $q$ select public.cms_inline_patch('b0000000-0000-0000-0000-000000000001',
      array['a', 'b', 'c', 'd', 'e', 'f', 'g'], 'x', null, null, null, 'save') $q$,
  'bad_path');
select public.t_raises(
  'D22 an empty path is bad_path',
  'authenticated', $q$ select public.cms_inline_patch('b0000000-0000-0000-0000-000000000001',
      array[]::text[], 'x', null, null, null, 'save') $q$,
  'bad_path');
select public.t_true(
  'D23 none of the refusals wrote a version or a history row',
  'authenticated', $q$
  select (select max(version) from public.cms_page_versions where page_id = 'f0000000-0000-0000-0000-000000000001') = 4
     and (select count(*) from public.content_versions where target = 'cms') = 1 $q$);
select public.t_true(
  'D24 a restore with the right base works and is recorded as restore (version 5)',
  'authenticated', $q$
  select public.cms_inline_patch('b0000000-0000-0000-0000-000000000001',
      array['title', 'pl'], 'Stary', 'Nowy', null, public.t_var('D4')::timestamptz, 'restore') is not null $q$);
select public.t_true(
  'D25 (… history: restore, before Nowy, after Stary; the version has the default label)',
  'authenticated', $q$
  select (select count(*) = 1 from public.content_versions
           where target = 'cms' and action = 'restore' and locale = 'pl'
             and before = '{"value":"Nowy"}' and after = '{"value":"Stary"}')
     and (select label = 'Edytor wizualny' and reason = 'publish' from public.cms_page_versions
           where page_id = 'f0000000-0000-0000-0000-000000000001' and version = 5) $q$);
select public.t_true(
  'D26 a launch field whose key contains a dot ({fields,hero.h1,pl}) is one path element',
  'authenticated', $q$
  select public.cms_inline_patch('b0000000-0000-0000-0000-000000000004',
      array['fields', 'hero.h1', 'pl'], 'Wielka premiera', 'Premiera', null, null, 'save') is not null $q$);
select public.t_true(
  'D27 (… draft and snapshot both hold it under the key "hero.h1", nothing was split on the dot)',
  'authenticated', $q$
  select (select content -> 'fields' -> 'hero.h1' ->> 'pl' = 'Wielka premiera' and not (content -> 'fields' ? 'hero')
            from public.cms_blocks where id = 'b0000000-0000-0000-0000-000000000004')
     and (select published_snapshot -> 2 -> 'content' -> 'fields' -> 'hero.h1' ->> 'pl' = 'Wielka premiera'
            from public.cms_pages where id = 'f0000000-0000-0000-0000-000000000001')
     and (select count(*) = 1 from public.content_versions
           where key = 'f0000000-0000-0000-0000-000000000001:b0000000-0000-0000-0000-000000000004:fields.hero.h1.pl'
             and locale = 'pl') $q$);
select public.t_true(
  'D28 an array index in the path ({items,1,description,pl}) patches that item only',
  'authenticated', $q$
  select public.cms_inline_patch('b0000000-0000-0000-0000-000000000006',
      array['items', '1', 'description', 'pl'], 'Dwa', 'Jeden', null, null, 'save') is not null $q$);
select public.t_true(
  'D29 (… item 1 changed in draft and snapshot, item 0 did not)',
  'authenticated', $q$
  select (select content = '{"items":[{"description":{"pl":"Zero"}},{"description":{"pl":"Dwa"}}]}'
            from public.cms_blocks where id = 'b0000000-0000-0000-0000-000000000006')
     and (select published_snapshot -> 3 -> 'content' = '{"items":[{"description":{"pl":"Zero"}},{"description":{"pl":"Dwa"}}]}'
            from public.cms_pages where id = 'f0000000-0000-0000-0000-000000000001') $q$);
select public.t_true(
  'D30 another block''s content, in the draft and in the snapshot, is untouched',
  'authenticated', $q$
  select (select content = '{"body":{"pl":"Inny"}}' and updated_by is null
            from public.cms_blocks where id = 'b0000000-0000-0000-0000-000000000002')
     and (select published_snapshot -> 1 = '{"id":"b0000000-0000-0000-0000-000000000002","type":"text","sort_order":1,"visible":true,"content":{"body":{"pl":"Inny"}}}'
            from public.cms_pages where id = 'f0000000-0000-0000-0000-000000000001') $q$);
select public.t_true(
  'D31 the draft-only block and the other page are untouched',
  'authenticated', $q$
  select (select content = '{"title":{"pl":"Szkic nowej sekcji"}}' from public.cms_blocks where id = 'b0000000-0000-0000-0000-000000000003')
     and (select content = '{"title":{"pl":"O nas"}}' from public.cms_blocks where id = 'b0000000-0000-0000-0000-000000000005')
     and (select status = 'draft' and published_snapshot -> 0 -> 'content' = '{"title":{"pl":"O nas"}}'
            from public.cms_pages where id = 'f0000000-0000-0000-0000-000000000002')
     and (select count(*) = 0 from public.cms_page_versions where page_id = 'f0000000-0000-0000-0000-000000000002') $q$);
select public.t_true(
  'D32 the snapshot still has 4 blocks in their order, and versions run 1…7 with no gap',
  'authenticated', $q$
  select (select jsonb_array_length(published_snapshot) = 4
             and published_snapshot -> 0 ->> 'id' = 'b0000000-0000-0000-0000-000000000001'
             and published_snapshot -> 3 ->> 'id' = 'b0000000-0000-0000-0000-000000000006'
            from public.cms_pages where id = 'f0000000-0000-0000-0000-000000000001')
     and (select array_agg(version order by version) = array[1, 2, 3, 4, 5, 6, 7]
            from public.cms_page_versions where page_id = 'f0000000-0000-0000-0000-000000000001') $q$);
select public.t_true(
  'D33 an anonymous visitor reads the patched page through the ordinary published-page policy',
  'anon', $q$
  select published_snapshot -> 0 -> 'content' #>> '{title,pl}' = 'Stary'
     and published_snapshot -> 2 -> 'content' -> 'fields' -> 'hero.h1' ->> 'pl' = 'Wielka premiera'
    from public.cms_pages where slug = 'cennik' $q$);

-- A launch field the block has never held. The editor offers every
-- LAUNCH_TEXT_FIELDS entry (lib/server/ice/cms.ts blockFields), set or not,
-- so {fields,hero.sub,pl} on a block whose `fields` has only hero.h1 is a
-- path an admin reaches by typing into an empty field. jsonb_set(…, true)
-- creates only the LAST missing key, so a missing parent ('hero.sub') makes
-- it return its input unchanged.
select public.t_true(
  'D34 a path whose parent key is missing is refused or really written — never "saved" while nothing changed',
  'authenticated', $q$
  select public.t_patch_is_honest('b0000000-0000-0000-0000-000000000004',
      array['fields', 'hero.sub', 'pl'], 'Nowy podpis', null) $q$);
SQL

# ── E. A PATCH RACING A DRAFT SAVE ─────────────────────────────────────────
#
# cms_inline_patch promises that "the page row is locked, so a concurrent
# publish or edit waits", and that a draft holding a different, unpublished
# value is never overwritten (draft_diverged). Both promises are only as good
# as the moment the block row is READ relative to that lock.
#
# Staged deterministically with three sessions — no sleeps that guess:
#   C  holds the page row lock (as a concurrent publish or patch does), and
#      lets go only once A's save is visible or A is itself waiting on a lock;
#   B  the admin's inline patch of subtitle.pl (live = draft = 'Pod', base =
#      the block's updated_at as loaded) — started once C holds the lock, and
#      left until Postgres reports it waiting on a lock;
#   A  the builder saves an UNPUBLISHED draft value at the same path.
# Whatever order a correct implementation forces (B refused with conflict /
# draft_diverged, or A's save landing after B's), the draft must end up
# holding A's value. Only a patch that checked a stale copy of the block
# replaces it.
E_OUT=$(mktemp); trap 'rm -f "$OUT" "$ERR" "$E_OUT"' EXIT
race_wait() {  # $1 application_name, $2 condition on its pg_stat_activity row; ~10 s at most
  local _
  for _ in $(seq 1 100); do
    [ "$("${PSQL[@]}" -c "select count(*) from pg_stat_activity where application_name = '$1' and $2")" != "0" ] && return 0
    sleep 0.1
  done
  return 1
}
RACE_OPTS='-c statement_timeout=30s -c client_min_messages=warning'

PGAPPNAME=ice_race_c PGOPTIONS="$RACE_OPTS" "${PSQL[@]}" >/dev/null 2>&1 <<'SQL' &
begin;
select 1 from public.cms_pages where id = 'f0000000-0000-0000-0000-000000000001' for update;
do $$ begin
  for i in 1..200 loop
    perform pg_stat_clear_snapshot();
    exit when (select content #>> '{subtitle,pl}' from public.cms_blocks
                where id = 'b0000000-0000-0000-0000-000000000001') = 'Szkic podtytułu'
           or exists (select 1 from pg_stat_activity where application_name = 'ice_race_a' and wait_event_type = 'Lock');
    perform pg_sleep(0.05);
  end loop;
end $$;
commit;
SQL
C_PID=$!

E_STAGED=true
race_wait ice_race_c "wait_event = 'PgSleep'" || E_STAGED=false

PGAPPNAME=ice_race_b PGOPTIONS="$RACE_OPTS" "${PSQL[@]}" >"$E_OUT" 2>&1 <<'SQL' &
select public.t_be('admin');
set role authenticated;
select public.cms_inline_patch('b0000000-0000-0000-0000-000000000001', array['subtitle', 'pl'], 'Nowy podtytuł', 'Pod',
  null, (select updated_at from public.cms_blocks where id = 'b0000000-0000-0000-0000-000000000001'), 'save');
SQL
B_PID=$!

race_wait ice_race_b "wait_event_type = 'Lock'" || E_STAGED=false

PGAPPNAME=ice_race_a PGOPTIONS="$RACE_OPTS" "${PSQL[@]}" >/dev/null 2>&1 \
  -c "update public.cms_blocks set content = jsonb_set(content, '{subtitle,pl}', '\"Szkic podtytułu\"'), updated_at = now()
      where id = 'b0000000-0000-0000-0000-000000000001'" || E_STAGED=false

wait "$C_PID" || E_STAGED=false
wait "$B_PID" || true   # B may rightly be refused; its outcome is in $E_OUT

E_DRAFT=$("${PSQL[@]}" -c "select content #>> '{subtitle,pl}' from public.cms_blocks where id = 'b0000000-0000-0000-0000-000000000001'")
E_B=$(tr '\n' ' ' < "$E_OUT" | sed 's/  */ /g')
if [ "$E_STAGED" != "true" ]; then
  record 'E1  an inline patch racing a draft save never overwrites the unpublished draft' false \
    "the race could not be staged (a session did not reach its wait); draft is '$E_DRAFT'; patch said: $E_B"
elif [ "$E_DRAFT" = "Szkic podtytułu" ]; then
  record 'E1  an inline patch racing a draft save never overwrites the unpublished draft' true ''
else
  record 'E1  an inline patch racing a draft save never overwrites the unpublished draft' false \
    "the draft's unpublished 'Szkic podtytułu' was replaced by '$E_DRAFT'; the racing patch returned: $E_B"
fi

# ── M (again). RE-APPLY OVER A POPULATED DATABASE ──────────────────────────
#
# M2 re-applied over empty tables. The real retry happens after people have
# used the thing: the CHECKs are dropped and re-added (and re-validated over
# every row), the resolver is dropped and re-created, the triggers replaced.
BEFORE=$("${PSQL[@]}" -c 'select public.t_fingerprint()')
if apply_migration; then
  record 'M10 0141 applies a third time, over every row the tests above wrote' true ''
else
  record 'M10 0141 applies a third time, over every row the tests above wrote' false "$(tr '\n' ' ' < "$ERR")"
fi
AFTER=$("${PSQL[@]}" -c 'select public.t_fingerprint()')
if [ "$BEFORE" = "$AFTER" ]; then
  record 'M11 and not one row of overrides, history, slots, pages, blocks or versions changed' true ''
else
  record 'M11 and not one row of overrides, history, slots, pages, blocks or versions changed' false "$BEFORE → $AFTER"
fi
"${PSQL[@]}" >/dev/null <<'SQL'
select public.t_be('anon');
select public.t_true(
  'M12 after the re-apply the grants are still the ones 0141 means: anon reads, never writes',
  'postgres', $q$
  select has_function_privilege('anon', 'public.content_overrides_published()', 'execute')
     and has_function_privilege('anon', 'public.media_slots_resolve(text[])', 'execute')
     and has_function_privilege('anon', 'public.media_slots_resolve_v2(text[])', 'execute')
     and not has_function_privilege('anon', 'public.content_override_write(text, text, text, timestamptz, text)', 'execute')
     and not has_function_privilege('anon', 'public.media_slots_write(jsonb, text)', 'execute')
     and not has_function_privilege('anon', 'public.cms_inline_patch(uuid, text[], text, text, text, timestamptz, text)', 'execute')
     and has_function_privilege('authenticated', 'public.content_override_write(text, text, text, timestamptz, text)', 'execute')
     and not has_function_privilege('authenticated', 'public.content_versions_record()', 'execute') $q$);
select public.t_raises(
  'M13 and an anonymous write is still refused',
  'anon', $q$ select public.content_override_write('home.hero.title', 'pl', 'Hacked', null, 'save') $q$,
  'permission denied for function content_override_write');
select public.t_true(
  'M14 and v2 still answers with the frame',
  'anon', $q$
  select count(*) = 1 and bool_and(crop = '{"x":30,"y":70,"zoom":1.4}')
    from public.media_slots_resolve_v2(array['global.ice.show']) $q$);
select public.t_true(
  'M15 and the 0091 resolver is still byte for byte what it was before the first apply',
  'postgres', $q$
  select md5(p.prosrc || '|' || pg_get_function_result(p.oid) || '|' || coalesce(p.proacl::text, '')
             || '|' || p.prosecdef::text || '|' || p.provolatile::text || '|' || coalesce(array_to_string(p.proconfig, ','), ''))
         = public.t_var('v1_before')
    from pg_proc p where p.oid = 'public.media_slots_resolve(text[])'::regprocedure $q$);
SQL

scoreboard
