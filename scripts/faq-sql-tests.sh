#!/usr/bin/env bash
#
# FAQ V1 (0155 + 0156), PROVEN AGAINST A REAL POSTGRES.
#
# What has to hold:
#   · the import lands every question of the brief once (30), the one old
#     /plany question the brief lacks, and the O nas questions the brief
#     lacks — and a second run adds nothing and overwrites nothing;
#   · a visitor reads the base ONLY through faq_public(): no table privilege,
#     nothing hidden, nothing waiting for a review, no [placeholder];
#   · a customer (signed in, not admin) can neither read nor write it;
#   · votes: one per question per browser, server token only, visible
#     questions only, an hourly limit per IP hash, counts nobody else moves;
#   · every change is history (content_versions, target 'faq'), a move is one
#     entry, and any version can be put back — a deleted item with its votes;
#   · 0156 moves the Kontakt links, gives /faq its section, takes O nas's own
#     list away — keeping a version of each page first, never publishing an
#     admin's unpublished draft, and doing nothing on a second run.
#
# The rehearsal schema is the part of PROD these files touch, with the bodies
# of is_admin (0002), server_call_ok (0077) and content_text_ok (0141)
# EXTRACTED from their migrations, and the pages seeded as PROD holds them
# today (O nas' six questions, Kontakt's five links, an empty /faq).
#
# Local harness only, its own database (faq_sqltest), removed on exit
# (KEEP_DB=1 keeps it).
#
#   bash scripts/pg-harness-up.sh && npm run test:faq:sql
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
PGCONN=(-h "$PGSOCK" -p "$PGPORT" -U postgres)

if ! psql "${PGCONN[@]}" -d postgres -X -q -t -A -c 'select 1' >/dev/null 2>&1; then
  echo "faq-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
M="$ROOT/supabase/migrations"
IMPORT="$M/0155_faq_v1.sql"
PAGES="$M/0156_faq_pages.sql"
for f in "$IMPORT" "$PAGES"; do [ -f "$f" ] || { echo "faq-sql: $f not found" >&2; exit 2; }; done

extract() { # file, function name, end marker regex
  awk -v start="^create (or replace )?function public[.]$2[(]" -v stop="$3" \
    '$0 ~ start {on=1} on {print} on && $0 ~ stop {exit}' "$1"
}
IS_ADMIN=$(extract "$M/0002_functions_and_triggers.sql" is_admin '^[$][$];')
SERVER_CALL_OK=$(extract "$M/0077_server_only_rpcs.sql" server_call_ok '^end [$][$];')
TEXT_OK=$(extract "$M/0141_inline_content_editor.sql" content_text_ok '^[$][$];')
for v in IS_ADMIN SERVER_CALL_OK TEXT_OK; do
  [ -n "${!v}" ] || { echo "faq-sql: could not extract $v" >&2; exit 2; }
done

DB="${FAQ_DB:-faq_sqltest}"
WORK=$(mktemp -d)
cleanup() {
  [ "${KEEP_DB:-0}" = "1" ] || dropdb "${PGCONN[@]}" --if-exists --force "$DB" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
ERR="$WORK/err"
q() { psql "${PGCONN[@]}" -d "$DB" -v ON_ERROR_STOP=1 -X -q -t -A "$@"; }
record() {
  q -v name="$1" -v ok="$2" -v detail="$3" >/dev/null <<'SQL'
insert into public.test_results (name, ok, detail) values (:'name', :'ok'::boolean, :'detail');
SQL
}

dropdb "${PGCONN[@]}" --if-exists --force "$DB" >/dev/null 2>&1 || true
createdb "${PGCONN[@]}" "$DB"

# ── The rehearsal ───────────────────────────────────────────────────────────
q >/dev/null <<'SQL'
set client_min_messages = warning;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth; create schema extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema public, auth, extensions to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;

create function auth.uid() returns uuid language sql stable as $f$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$f$;
create table public.profiles (id uuid primary key, email text not null default '', role text not null default 'user');
create table public.app_settings (key text primary key, value jsonb not null default '{}'::jsonb);
alter table public.app_settings enable row level security;
insert into public.app_settings (key, value) values
  ('notifications', jsonb_build_object('dispatch_hash', encode(extensions.digest('faq-test-token', 'sha256'), 'hex')));

-- 0141's history table, as PROD has it.
create table public.content_versions (
  id uuid primary key default gen_random_uuid(),
  target text not null, key text not null, locale text, action text not null,
  before jsonb, after jsonb, created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  constraint content_versions_target_check check (target in ('text', 'slot', 'cms')),
  constraint content_versions_action_check check (action in ('save', 'reset', 'restore', 'clear', 'bulk', 'external')),
  constraint content_versions_key_check check (length(key) between 1 and 600)
);
alter table public.content_versions enable row level security;

-- The CMS tables, the columns these files read and write.
create table public.cms_pages (
  id uuid primary key default gen_random_uuid(), slug text unique not null, title text not null,
  status text not null default 'draft', kind text not null default 'standard',
  nav_group text, nav_order integer default 100, seo jsonb not null default '{}'::jsonb,
  header_mode text default 'global', footer_mode text default 'global',
  published_snapshot jsonb, published_at timestamptz, scheduled_at timestamptz,
  updated_at timestamptz default now()
);
create table public.cms_blocks (
  id uuid primary key default gen_random_uuid(), page_id uuid not null references public.cms_pages(id) on delete cascade,
  sort_order integer not null default 0, type text not null, visible boolean not null default true,
  content jsonb not null default '{}'::jsonb, style jsonb not null default '{}'::jsonb, code jsonb not null default '{}'::jsonb,
  analytics_id text, anchor text, show_from timestamptz, show_until timestamptz, audience text default 'everyone',
  updated_at timestamptz default now()
);
create table public.cms_page_versions (
  id uuid primary key default gen_random_uuid(), page_id uuid not null references public.cms_pages(id) on delete cascade,
  version integer not null, snapshot jsonb not null, seo jsonb, reason text not null, label text,
  created_at timestamptz default now(),
  constraint cms_page_versions_reason_check check (reason in ('publish', 'manual', 'rollback'))
);
SQL
{
  echo "set client_min_messages = warning;"
  printf '%s\n' "$IS_ADMIN" "$SERVER_CALL_OK" "$TEXT_OK"
} > "$WORK/bodies.sql"
q -f "$WORK/bodies.sql" >/dev/null 2>"$ERR" || { cat "$ERR" >&2; exit 2; }

q >/dev/null <<'SQL'
set client_min_messages = warning;
revoke execute on function public.is_admin(uuid) from public, anon;
grant execute on function public.is_admin(uuid) to authenticated;
revoke all on function public.server_call_ok(text) from public, anon, authenticated;
create policy content_versions_admin_read on public.content_versions for select to authenticated using (public.is_admin());
revoke insert, update, delete on public.content_versions from anon, authenticated;

-- The pages, as PROD holds them on the day of FAQ V1.
insert into public.cms_pages (slug, title, status, nav_group, nav_order, published_snapshot, published_at) values
  ('faq', 'FAQ', 'published', null, 100, '[]', now()),
  ('o-nas', 'O nas', 'published', 'company', 10, null, now()),
  ('kontakt', 'Kontakt', 'published', 'company', 20, null, now());

insert into public.cms_blocks (page_id, sort_order, type, content, analytics_id, anchor)
select p.id, 7, 'about_faq', $j${
  "title": {"pl": "Masz pytania?", "en": "Any questions?", "de": "Noch Fragen?"},
  "items": [
    {"title": {"pl": "Czym jest GrovBase?", "en": "What is GrovBase?"}, "description": {"pl": "GrovBase to aplikacja dla sprzedawców e-commerce (stara treść O nas)."}},
    {"title": {"pl": "Kto stoi za GrovBase?"}, "description": {"pl": "GrovBase tworzą dwie osoby (stara treść O nas)."}},
    {"title": {"pl": "Na jakich modelach AI pracujecie?", "en": "Which AI models do you use?", "de": "Mit welchen KI-Modellen arbeitet ihr?"},
     "description": {"pl": "Korzystamy z modeli kilku dostawców — sposób korzystania z aplikacji się nie zmienia.", "en": "We use models from several providers.", "de": "Wir nutzen Modelle mehrerer Anbieter."}},
    {"title": {"pl": "Czym różnicie się od innych narzędzi AI do zdjęć?", "en": "How are you different from other AI photo tools?"},
     "description": {"pl": "Efekty w GrovBase ustawia grafik e-commerce, więc nie musisz pisać promptów.", "en": "The effects are set up by an e-commerce designer."}},
    {"title": {"pl": "Co dzieje się z moimi zdjęciami?"}, "hidden": true, "description": {"pl": "[treść do potwierdzenia]"}},
    {"title": {"pl": "Dane firmy"}, "hidden": true, "description": {"pl": "[nazwa firmy], [miasto], NIP [numer]"}}
  ]}$j$::jsonb, 'about.faq', 'faq'
  from public.cms_pages p where p.slug = 'o-nas';

insert into public.cms_blocks (page_id, sort_order, type, content, analytics_id)
select p.id, 0, 'contact_page', $j${
  "badge": {"pl": "KONTAKT"},
  "title": {"pl": "Napisz do nas"},
  "tiles": [
    {"title": {"pl": "Jak działają kredyty?"}, "url": "/plany#faq-credits"},
    {"title": {"pl": "Jak kupić dodatkowe kredyty?"}, "url": "/plany#faq-topups"},
    {"title": {"pl": "Czy subskrypcja odnawia się automatycznie?"}, "url": "/plany#faq-renewal"},
    {"title": {"pl": "Czy istnieje możliwość zwrotu?"}, "url": "/plany#faq-refunds"},
    {"title": {"pl": "Jak otrzymać fakturę VAT?"}}
  ]}$j$::jsonb, 'contact.page'
  from public.cms_pages p where p.slug = 'kontakt';

-- Published = the blocks as they are now…
update public.cms_pages p set published_snapshot = (
  select jsonb_agg(jsonb_build_object('id', b.id, 'type', b.type, 'sort_order', b.sort_order, 'visible', b.visible,
    'content', b.content, 'style', b.style, 'code', b.code, 'analytics_id', b.analytics_id, 'anchor', b.anchor,
    'show_from', b.show_from, 'show_until', b.show_until, 'audience', b.audience) order by b.sort_order)
  from public.cms_blocks b where b.page_id = p.id) where p.slug in ('o-nas', 'kontakt');
-- …then an admin's UNPUBLISHED draft on Kontakt: 0156 must not publish it.
update public.cms_blocks b set content = jsonb_set(content, '{badge,pl}', '"SZKIC ADMINA"')
  from public.cms_pages p where p.id = b.page_id and p.slug = 'kontakt';

create table public.test_results (name text, ok boolean, detail text, seq serial);
create table public.t_vars (name text primary key, v text);
create function public.t_var(p_name text) returns text language plpgsql volatile as $$
declare v text; begin execute 'select v from public.t_vars where name = $1' into v using p_name; return v; end $$;
create function public.t_set(p_name text, p_v text) returns void language sql as $$
  insert into public.t_vars values (p_name, p_v) on conflict (name) do update set v = excluded.v $$;
create function public.t_tok() returns text language sql immutable as $$ select 'faq-test-token'::text $$;
create function public.t_h(p text) returns text language sql immutable as $$
  select encode(extensions.digest('h:' || p, 'sha256'), 'hex') $$;
create function public.t_uid(p_who text) returns uuid language plpgsql volatile as $$
begin return nullif(public.t_var('uid:' || p_who), '')::uuid; end $$;
create function public.t_be(p_who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claims', case
    when p_who = 'anon' then '{"role":"anon"}'
    when public.t_uid(p_who) is not null then json_build_object('sub', public.t_uid(p_who), 'role', 'authenticated')::text
    else '' end, false);
end $$;
create function public.t_user(p_who text, p_role text default 'user') returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  perform public.t_set('uid:' || p_who, v_id::text);
  insert into public.profiles (id, email, role) values (v_id, p_who || '@example.com', p_role);
  return v_id;
end $$;
select public.t_user('customer'); select public.t_user('admin', 'admin');

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
    values (p_name, v_err is not null and v_err like '%' || p_needle || '%', coalesce(v_err, '(no error raised)'));
end $$;
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
SQL

apply() { PGOPTIONS='-c client_min_messages=warning' psql "${PGCONN[@]}" -d "$DB" -v ON_ERROR_STOP=1 -X -q -t -A -1 -f "$1" >/dev/null 2>"$ERR"; }
digest() { q -c "select md5(coalesce((select string_agg(to_jsonb(i)::text, '|' order by i.slug) from public.faq_items i), '')
                         || coalesce((select string_agg(to_jsonb(c)::text, '|' order by c.slug) from public.faq_categories c), ''))"; }

# ── 0155 ────────────────────────────────────────────────────────────────────
if apply "$IMPORT"; then record 'M0  0155 applies in one transaction' true ''
else record 'M0  0155 applies in one transaction' false "$(tr '\n' ' ' < "$ERR")"; fi

q >/dev/null <<'SQL'
select public.t_true('I1  7 categories, 33 questions: the 30 of the brief, 1 from /plany, 2 from O nas', 'postgres', $q$
  select (select count(*) = 7 from public.faq_categories)
     and (select count(*) = 33 from public.faq_items)
     and (select count(*) = 30 from public.faq_items where import_key like 'brief:%')
     and (select count(*) = 1 from public.faq_items where import_key = 'plany:topups')
     and (select count(*) = 2 from public.faq_items where import_key like 'o-nas:%') $q$);
select public.t_true('I2  every brief number 01–30 once, every one on /faq', 'postgres', $q$
  select count(distinct import_key) = 30 and bool_and('faq' = any(pages)) from public.faq_items where import_key like 'brief:%' $q$);
select public.t_true('I3  O nas extras carry their CURRENT words, all languages, and their place', 'postgres', $q$
  select (select answer ->> 'pl' like 'Korzystamy z modeli kilku dostawców%' and question ? 'de' and pages = array['faq','o-nas']
            from public.faq_items where slug = 'na-jakich-modelach-ai-pracujecie')
     and (select c.slug = 'pierwsze-kroki' and i.position = 55 from public.faq_items i join public.faq_categories c on c.id = i.category_id
           where i.slug = 'czym-roznicie-sie-od-innych-narzedzi') $q$);
select public.t_true('I4  a brief question that replaces an O nas one is not imported twice', 'postgres', $q$
  select (select count(*) = 1 from public.faq_items where question ->> 'pl' = 'Czym jest GrovBase?')
     and (select count(*) = 1 from public.faq_items where question ->> 'pl' = 'Kto stoi za GrovBase?')
     and (select count(*) = 1 from public.faq_items where question ->> 'pl' = 'Dane firmy') $q$);
select public.t_true('I5  20 public, 13 not (placeholder or review)', 'anon', $q$
  select count(*) = 20 from public.faq_public() $q$);
select public.t_true('I6  faq_public() carries no placeholder and no hidden or unreviewed item', 'anon', $q$
  select not exists (select 1 from public.faq_public() f
                      where (f.answer ->> 'pl') ~ '\[' or (f.question ->> 'pl') ~ '\['
                         or f.slug in ('czy-otrzymam-fakture-vat', 'jak-anulowac-subskrypcje', 'dane-firmy',
                                       'czy-kredyty-z-doladowania-wygasaja', 'czy-moge-dodac-wspolpracownikow')) $q$);
select public.t_true('I7  /plany keeps its eight questions; the premiere one is flagged', 'anon', $q$
  select count(*) = 8 and count(*) filter (where only_premiere) = 1
    from public.faq_public() where 'plany' = any(pages) $q$);
select public.t_true('I8  /o-nas shows four, as today', 'anon', $q$
  select count(*) = 4 from public.faq_public() where 'o-nas' = any(pages) $q$);
select public.t_true('I9  a kept answer carries the brief text as its draft', 'postgres', $q$
  select draft_answer ->> 'pl' like '%[X]%' and visible and answer ->> 'pl' like 'To zależy od narzędzia i jakości%'
    from public.faq_items where slug = 'ile-obrazow-moge-wygenerowac' $q$);
select public.t_true('I10 the import is history (external), the counts start at zero', 'postgres', $q$
  select (select count(*) >= 40 from public.content_versions where target = 'faq' and action = 'external')
     and (select bool_and(helpful_count = 0 and unhelpful_count = 0) from public.faq_items) $q$);
select public.t_true('I11 the snapshot kept what the import read (O nas, Kontakt, /faq)', 'postgres', $q$
  select count(*) = 3 and bool_and(data is not null) from public.faq_import_snapshots
   where source in ('o-nas:about_faq', 'kontakt:contact_page', 'faq:page') $q$);

-- ── T. THE TEXT RULE ───────────────────────────────────────────────────
select public.t_true('T1  faq_text_ok: placeholders fail, links and plain text pass', 'postgres', $q$
  select not public.faq_text_ok('[DO POTWIERDZENIA]') and not public.faq_text_ok('Tak. [DO POTWIERDZENIA: kiedy]')
     and not public.faq_text_ok('[X] kredytów') and not public.faq_text_ok('[25] darmowych')
     and not public.faq_text_ok('[data]') and not public.faq_text_ok('') and not public.faq_text_ok('   ')
     and not public.faq_text_ok('niedomknięty [nawias') and not public.faq_text_ok(null)
     and public.faq_text_ok('Napisz [do nas](/kontakt) albo [tu](https://grovbase.com).')
     and public.faq_text_ok('Zwykła **odpowiedź**.') $q$);
SQL

BEFORE=$(digest)
if apply "$IMPORT"; then record 'M1  0155 again (re-runnable)' true ''
else record 'M1  0155 again (re-runnable)' false "$(tr '\n' ' ' < "$ERR")"; fi
AFTER=$(digest)
if [ "$BEFORE" = "$AFTER" ]; then record 'M1b … adds and changes nothing' true ''
else record 'M1b … adds and changes nothing' false "$BEFORE vs $AFTER"; fi

q >/dev/null <<'SQL'
-- ── R. WHO MAY READ AND WRITE ──────────────────────────────────────────
select public.t_raises('R1  anon: no SELECT on faq_items', 'anon', $q$ select count(*) from public.faq_items $q$, 'permission denied');
select public.t_raises('R2  anon: no SELECT on faq_categories', 'anon', $q$ select count(*) from public.faq_categories $q$, 'permission denied');
select public.t_raises('R3  anon: no SELECT on faq_votes', 'anon', $q$ select count(*) from public.faq_votes $q$, 'permission denied');
select public.t_raises('R4  anon: no INSERT into faq_items', 'anon',
  $q$ insert into public.faq_items (slug, category_id, question) select 'x', id, '{"pl":"x"}' from public.faq_categories limit 1 $q$, 'permission denied');
select public.t_raises('R5  anon: no snapshot read', 'anon', $q$ select count(*) from public.faq_import_snapshots $q$, 'permission denied');
select public.t_be('customer');
select public.t_true('R6  a customer reads no item (RLS)', 'authenticated', $q$ select count(*) = 0 from public.faq_items $q$);
select public.t_raises('R7  a customer cannot add one', 'authenticated',
  $q$ insert into public.faq_items (slug, category_id, question) values ('x', gen_random_uuid(), '{"pl":"x"}') $q$, 'row-level security');
select public.t_true('R8  … nor change one (0 rows)', 'authenticated',
  $q$ with u as (update public.faq_items set visible = true returning 1) select count(*) = 0 from u $q$);
select public.t_raises('R9  … nor reorder', 'authenticated',
  $q$ select public.faq_reorder('categories', array(select id from public.faq_categories)) $q$, 'not_allowed');
select public.t_raises('R10 … nor restore', 'authenticated',
  $q$ select public.faq_restore((select id from public.content_versions limit 1)) $q$, 'not_allowed');
select public.t_true('R11 a customer reads faq_public() like anyone', 'authenticated', $q$ select count(*) = 20 from public.faq_public() $q$);
select public.t_raises('R12 anon: faq_reorder not callable', 'anon',
  $q$ select public.faq_reorder('categories', array[gen_random_uuid()]) $q$, 'permission denied');
select public.t_true('R13 anon reads no history row (RLS, as on PROD)', 'anon', $q$ select count(*) = 0 from public.content_versions $q$);

-- ── V. VOTES ───────────────────────────────────────────────────────────
select public.t_raises('V1  a vote without the server token is refused', 'anon',
  $q$ select public.faq_vote('wrong', 'czym-jest-grovbase', public.t_h('b1'), public.t_h('ip1'), true) $q$, 'not_allowed');
select public.t_true('V2  a vote counts', 'anon',
  $q$ select public.faq_vote(public.t_tok(), 'czym-jest-grovbase', public.t_h('b1'), public.t_h('ip1'), true) = 'ok' $q$);
select public.t_true('V3  the same browser again: already (the first vote stands)', 'anon',
  $q$ select public.faq_vote(public.t_tok(), 'czym-jest-grovbase', public.t_h('b1'), public.t_h('ip1'), false) = 'already' $q$);
select public.t_true('V4  another browser votes No', 'anon',
  $q$ select public.faq_vote(public.t_tok(), 'czym-jest-grovbase', public.t_h('b2'), public.t_h('ip1'), false) = 'ok' $q$);
select public.t_true('V5  counts: 1 yes, 1 no', 'postgres',
  $q$ select helpful_count = 1 and unhelpful_count = 1 from public.faq_items where slug = 'czym-jest-grovbase' $q$);
select public.t_true('V6  a hidden question takes no vote', 'anon',
  $q$ select public.faq_vote(public.t_tok(), 'dane-firmy', public.t_h('b1'), public.t_h('ip1'), true) = 'not_found' $q$);
select public.t_true('V7  malformed input: invalid', 'anon',
  $q$ select public.faq_vote(public.t_tok(), 'Czym Jest', public.t_h('b1'), public.t_h('ip1'), true) = 'invalid'
       and public.faq_vote(public.t_tok(), 'czym-jest-grovbase', 'short', public.t_h('ip1'), true) = 'invalid' $q$);
select public.t_true('V8  30 an hour per IP hash, then rate_limited', 'anon', $q$
  select (select count(*) from generate_series(1, 28) g
           where public.faq_vote(public.t_tok(), 'jak-dzialaja-kredyty', public.t_h('flood' || g), public.t_h('ip1'), true) = 'ok') = 28
     and public.faq_vote(public.t_tok(), 'jak-dzialaja-kredyty', public.t_h('flood-x'), public.t_h('ip1'), true) = 'rate_limited' $q$);
select public.t_true('V9  a vote moves neither updated_at nor the history', 'postgres', $q$
  select (select updated_at = created_at from public.faq_items where slug = 'czym-jest-grovbase')
     and not exists (select 1 from public.content_versions where target = 'faq' and action = 'save') $q$);

-- ── A. THE ADMIN ───────────────────────────────────────────────────────
select public.t_be('admin');
select public.t_true('A1  the admin reads everything', 'authenticated', $q$ select count(*) = 33 from public.faq_items $q$);
select public.t_true('A2  an edit is saved', 'authenticated', $q$
  with u as (update public.faq_items set answer = jsonb_set(answer, '{pl}', '"Nowa odpowiedź."') where slug = 'czy-grovbase-dziala-na-telefonie' returning 1)
  select count(*) = 1 from u $q$);
select public.t_true('A2b … with a history entry by the admin', 'authenticated', $q$
  select exists (select 1 from public.content_versions v join public.faq_items i on v.key = 'faq:item:' || i.id
                  where i.slug = 'czy-grovbase-dziala-na-telefonie' and v.action = 'save'
                    and v.after -> 'answer' ->> 'pl' = 'Nowa odpowiedź.' and v.created_by = public.t_uid('admin'))
     and (select updated_at > created_at and updated_by = public.t_uid('admin') from public.faq_items where slug = 'czy-grovbase-dziala-na-telefonie') $q$);
select public.t_true('A3  an admin cannot move the vote counts or the import key', 'authenticated', $q$
  with u as (update public.faq_items set helpful_count = 999, import_key = 'brief:99' where slug = 'czym-jest-grovbase' returning helpful_count, import_key)
  select helpful_count = 1 and import_key = 'brief:01' from u $q$);
select public.t_raises('A4  a placeholder slug is refused by the table', 'authenticated',
  $q$ update public.faq_items set slug = 'Zły Slug' where slug = 'czym-jest-grovbase' $q$, 'faq_items_slug_check');
select public.t_raises('A5  markup in an answer is refused', 'authenticated',
  $q$ update public.faq_items set answer = '{"pl":"<script>x</script>"}' where slug = 'czym-jest-grovbase' $q$, 'faq_items_answer_check');
select public.t_raises('A6  an unknown page is refused', 'authenticated',
  $q$ update public.faq_items set pages = array['faq','cennik'] where slug = 'czym-jest-grovbase' $q$, 'faq_items_pages_check');
select public.t_raises('A7  a category with questions cannot be deleted', 'authenticated',
  $q$ delete from public.faq_categories where slug = 'pierwsze-kroki' $q$, 'foreign key');
select public.t_true('A8  hiding a question …', 'authenticated', $q$
  with u as (update public.faq_items set visible = false where slug = 'czy-musze-umiec-pisac-prompty' returning 1)
  select count(*) = 1 from u $q$);
select public.t_true('A8b … takes it off faq_public()', 'authenticated', $q$ select count(*) = 19 from public.faq_public() $q$);
select public.t_true('A9  hiding a category …', 'authenticated', $q$
  with u as (update public.faq_categories set visible = false where slug = 'nadchodzace-funkcje' returning 1)
  select count(*) = 1 from u $q$);
select public.t_true('A9b … hides its questions', 'authenticated', $q$ select count(*) = 18 from public.faq_public() $q$);
select public.t_true('A10 a move of a whole category''s list', 'authenticated', $q$
  select public.faq_reorder('items',
    (select array_agg(i.id order by i.position desc) from public.faq_items i join public.faq_categories c on c.id = i.category_id where c.slug = 'pierwsze-kroki'),
    (select id from public.faq_categories where slug = 'pierwsze-kroki')) = 6 $q$);
select public.t_true('A10b … is one bulk entry, positions 10…60, no save entry, updated_at kept', 'authenticated', $q$
  select (select count(*) = 1 from public.content_versions
           where key = 'faq:order:' || (select id from public.faq_categories where slug = 'pierwsze-kroki') and action = 'bulk')
     and (select string_agg(i.slug || '@' || i.position, ',' order by i.position) from public.faq_items i
            join public.faq_categories c on c.id = i.category_id where c.slug = 'pierwsze-kroki')
         like 'czym-roznicie-sie-od-innych-narzedzi@10,%@60'
     and not exists (select 1 from public.content_versions v join public.faq_items i on v.key = 'faq:item:' || i.id
                      where i.slug = 'czym-roznicie-sie-od-innych-narzedzi' and v.action = 'save')
     and (select updated_at = created_at from public.faq_items where slug = 'czym-roznicie-sie-od-innych-narzedzi') $q$);
select public.t_raises('A11 a move with a missing item is stale', 'authenticated', $q$
  select public.faq_reorder('items', array(select id from public.faq_items where category_id = (select id from public.faq_categories where slug = 'pierwsze-kroki') limit 2),
                            (select id from public.faq_categories where slug = 'pierwsze-kroki')) $q$, 'stale');
select public.t_true('A12 categories reorder as a whole', 'authenticated', $q$
  select public.faq_reorder('categories', array(select id from public.faq_categories order by position desc)) = 7 $q$);
select public.t_true('A12b … the last is first now', 'authenticated', $q$
  select (select slug from public.faq_categories order by position limit 1) = 'nadchodzace-funkcje' $q$);
select public.t_true('A13 delete …', 'authenticated', $q$
  with d as (delete from public.faq_items where slug = 'czym-jest-grovbase' returning id) select count(*) = 1 from d $q$);
select public.t_true('A13b … is history "clear"; restore it', 'authenticated', $q$
  select (public.faq_restore((select v.id from public.content_versions v where v.action = 'clear' and v.key like 'faq:item:%'
                              order by v.created_at desc limit 1)) ->> 'kind') = 'item' $q$);
select public.t_true('A13c … it is back, with its votes and its import key', 'authenticated', $q$
  select (select helpful_count = 1 and unhelpful_count = 1 and import_key = 'brief:01' from public.faq_items where slug = 'czym-jest-grovbase')
     and exists (select 1 from public.content_versions where action = 'restore') $q$);
select public.t_true('A14 restore an older version of an edit', 'authenticated', $q$
  select (public.faq_restore((select v.id from public.content_versions v
             where v.key = 'faq:item:' || (select id from public.faq_items where slug = 'czy-grovbase-dziala-na-telefonie')
               and v.action = 'external' limit 1)) ->> 'kind') = 'item' $q$);
select public.t_true('A14b … the old words are back', 'authenticated', $q$
  select answer ->> 'pl' like 'Tak, aplikacja działa w przeglądarce%' from public.faq_items where slug = 'czy-grovbase-dziala-na-telefonie' $q$);
-- A15: an item that used to be called "tymczasowe", renamed, and the name
-- taken by another since: its first version cannot come back.
reset role;
select public.t_be('');
insert into public.faq_items (slug, category_id, question, answer)
select 'tymczasowe', id, '{"pl":"Tymczasowe?"}', '{"pl":"Tak."}' from public.faq_categories where slug = 'pierwsze-kroki';
select public.t_set('tmp_v', (select v.id::text from public.content_versions v
  where v.key = 'faq:item:' || (select id from public.faq_items where slug = 'tymczasowe') order by v.created_at limit 1));
update public.faq_items set slug = 'tymczasowe-2' where slug = 'tymczasowe';
insert into public.faq_items (slug, category_id, question)
select 'tymczasowe', id, '{"pl":"Inne?"}' from public.faq_categories where slug = 'pierwsze-kroki';
select public.t_be('admin');
select public.t_raises('A15 a version whose slug is taken is refused', 'authenticated',
  $q$ select public.faq_restore(public.t_var('tmp_v')::uuid) $q$, 'slug_taken');
SQL

# ── 0156 ────────────────────────────────────────────────────────────────────
if apply "$PAGES"; then record 'P0  0156 applies in one transaction' true ''
else record 'P0  0156 applies in one transaction' false "$(tr '\n' ' ' < "$ERR")"; fi

q >/dev/null <<'SQL'
select public.t_true('P1  /faq: one faq_page section, published, in "Pomoc" at 15, with SEO', 'postgres', $q$
  select (select count(*) = 1 from public.cms_blocks b join public.cms_pages p on p.id = b.page_id where p.slug = 'faq' and b.type = 'faq_page')
     and (select jsonb_array_length(published_snapshot) = 1 and published_snapshot -> 0 ->> 'type' = 'faq_page'
               and nav_group = 'help' and nav_order = 15 and seo -> 'pl' ->> 'title' like 'FAQ%'
          from public.cms_pages where slug = 'faq') $q$);
select public.t_true('P2  Kontakt back in "Pomoc", below FAQ', 'postgres', $q$
  select nav_group = 'help' and nav_order = 20 from public.cms_pages where slug = 'kontakt' $q$);
select public.t_true('P3  Kontakt links: four moved to /faq#slug, the VAT one gets its address', 'postgres', $q$
  select (select string_agg(t ->> 'url', ' ' order by o) from public.cms_pages p,
            jsonb_array_elements(p.published_snapshot -> 0 -> 'content' -> 'tiles') with ordinality x(t, o) where p.slug = 'kontakt')
       = '/faq#jak-dzialaja-kredyty /faq#jak-kupic-dodatkowe-kredyty /faq#czy-subskrypcja-odnawia-sie-automatycznie /faq#czy-istnieje-mozliwosc-zwrotu /faq#czy-otrzymam-fakture-vat'
     and (select string_agg(t ->> 'url', ' ' order by o) from public.cms_blocks b join public.cms_pages p on p.id = b.page_id,
            jsonb_array_elements(b.content -> 'tiles') with ordinality x(t, o) where p.slug = 'kontakt')
       = '/faq#jak-dzialaja-kredyty /faq#jak-kupic-dodatkowe-kredyty /faq#czy-subskrypcja-odnawia-sie-automatycznie /faq#czy-istnieje-mozliwosc-zwrotu /faq#czy-otrzymam-fakture-vat' $q$);
select public.t_true('P4  the admin''s unpublished Kontakt draft was NOT published', 'postgres', $q$
  select (select published_snapshot -> 0 -> 'content' -> 'badge' ->> 'pl' = 'KONTAKT' from public.cms_pages where slug = 'kontakt')
     and (select b.content -> 'badge' ->> 'pl' = 'SZKIC ADMINA' from public.cms_blocks b join public.cms_pages p on p.id = b.page_id where p.slug = 'kontakt') $q$);
select public.t_true('P5  O nas: about_faq keeps its heading, loses its list (draft and published)', 'postgres', $q$
  select (select not (b.content ? 'items') and b.content -> 'title' ->> 'pl' = 'Masz pytania?'
            from public.cms_blocks b join public.cms_pages p on p.id = b.page_id where p.slug = 'o-nas' and b.type = 'about_faq')
     and (select not (e -> 'content' ? 'items') from public.cms_pages p, jsonb_array_elements(p.published_snapshot) e
           where p.slug = 'o-nas' and e ->> 'type' = 'about_faq') $q$);
select public.t_true('P6  each changed page kept a "Przed FAQ V1" version — O nas with its six questions', 'postgres', $q$
  select (select count(*) = 3 from public.cms_page_versions where label = 'Przed FAQ V1')
     and (select jsonb_array_length(v.snapshot -> 0 -> 'content' -> 'items') = 6
            from public.cms_page_versions v join public.cms_pages p on p.id = v.page_id
           where p.slug = 'o-nas' and v.label = 'Przed FAQ V1') $q$);
SQL

VERS=$(q -c "select count(*) from public.cms_page_versions")
if apply "$PAGES"; then record 'P7  0156 again (re-runnable)' true ''
else record 'P7  0156 again (re-runnable)' false "$(tr '\n' ' ' < "$ERR")"; fi
VERS2=$(q -c "select count(*) from public.cms_page_versions")
if [ "$VERS" = "$VERS2" ]; then record 'P7b … writes no new version' true ''
else record 'P7b … writes no new version' false "$VERS vs $VERS2"; fi
BEFORE=$(digest)
if apply "$IMPORT"; then record 'P8  0155 after 0156 still applies' true ''
else record 'P8  0155 after 0156 still applies' false "$(tr '\n' ' ' < "$ERR")"; fi
AFTER=$(digest)
if [ "$BEFORE" = "$AFTER" ]; then record 'P8b … and changes no admin edit' true ''
else record 'P8b … and changes no admin edit' false "$BEFORE vs $AFTER"; fi

q -c "select case when ok then '  ✓ ' else '  ✗ ' end || name || case when ok then '' else '  — ' || detail end
      from public.test_results order by seq"
FAILED=$(q -c "select count(*) from public.test_results where not ok")
TOTAL=$(q -c "select count(*) from public.test_results")
if [ "$FAILED" = "0" ]; then
  echo; echo "All $TOTAL FAQ (0155/0156) SQL tests passed."
else
  echo; echo "$FAILED of $TOTAL FAILED" >&2; exit 1
fi
