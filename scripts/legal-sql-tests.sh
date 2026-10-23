#!/usr/bin/env bash
#
# LEGAL DOCUMENTS V1 (0146 + 0147), PROVEN AGAINST A REAL POSTGRES.
#
# 0146 adds legal_document_sources and legal_document_import(); 0147 (GENERATED
# by scripts/gen-legal-migration.mjs) loads the four Polish texts in parts and
# imports each one into its CMS page. The promise is "the page holds the file,
# byte for byte, or nothing changed" — so every check below compares what the
# database holds with content/legal/pl/*.txt itself (sha256sum, code points,
# the bytes decoded back out of the database and cmp'd with the file).
#
# The rehearsal schema is what the two files land on, replayed from the
# migrations that created it: roles anon / authenticated with SUPABASE'S
# DEFAULT PRIVILEGES (every new table and function in public granted to both,
# so 0146's revokes are what make "no access" true); pgcrypto WITH SCHEMA
# extensions, as on PROD; auth.uid() as PROD defines it; is_admin (0002, body
# extracted) with 0005's grants; cms_pages / cms_blocks / cms_page_versions with
# every column and CHECK the import can meet (0012, 0049, 0085, 0092, 0110,
# 0116), the reserved-slug function (0125, extracted) and the homepage trigger
# (0110, extracted).
#
#   A  PROD as it is: Regulamin published as ONE text section (the text pasted
#      into description.pl, no final newline, title "Regulanin"), Polityka
#      prywatności a draft with the 0087 placeholders, no cookies / DPA page,
#      unrelated pages around. 0146, then 0147 PIECE BY PIECE, each piece its
#      own transaction (as the PROD connector applies it). Four pages
#      published; each text hashes like its file, has its characters, equals
#      the file byte for byte (draft and published); other sections hidden,
#      never removed; the old sections kept in a "Przed importem" version; the
#      publish version labelled with the sha; menu / SEO of existing pages
#      unchanged; EN/DE "soon"; nothing else touched.
#   B  0147 again, as one file: every call "unchanged", no row written.
#   C  0146 again: a no-op; ONE legal_document_import (p_force last, false).
#   D  a damaged part, a wrong sha / count / length, bad arguments → refused,
#      nothing changed; 0147 again repairs the part.
#   E  a fresh PROD-like database, 0147 cut short (some parts, then the
#      import), parts only, and a damaged part → refused / nothing visible;
#      the whole file afterwards → imported.
#   F  later admin work: a re-run leaves it alone; a new version of a text
#      keeps the other languages and the previous text in a version.
#   R  an import is ONE-TIME: the admin corrects the privacy text, publishes
#      and drafts an EN text → the same import piece (and all of 0147) returns
#      'already_imported' and writes nothing — the correction stays drafted
#      and published, the EN draft unpublished, the cookies 1.1 live, an
#      unpublished page unpublished; a new version over the admin's text →
#      legal_import_conflict; p_force imports (both cases).
#   K  a Polish text an admin wrote with no import on record (active in the
#      published page only / in the draft only) → legal_import_conflict,
#      nothing written (0147 as one file: not even a part); p_force imports
#      and the admin's texts stay in the versions.
#   G  an existing page with a doc section (hidden, windowed, audience) after
#      another legal section: the doc section is the target; the page keeps
#      its title and menu place; a non-standard page is refused.
#   P  privileges: anon / customer / admin can neither execute the import nor
#      write the parts; only an admin reads them.
#   H  the files: generator --check, no drop/delete, every piece < 20 000
#      bytes, the pieces add up to the file, imports follow their parts, the
#      order warning in 0146, in 0147's header and in EVERY piece.
#
# Local harness only, its own database (legal_sqltest), removed on exit
# (KEEP_DB=1 keeps it).
#
#   bash scripts/pg-harness-up.sh && bash scripts/legal-sql-tests.sh
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
PGCONN=(-h "$PGSOCK" -p "$PGPORT" -U postgres)
DB="${LEGAL_DB:-legal_sqltest}"
export PGCLIENTENCODING=UTF8

if ! psql "${PGCONN[@]}" -d postgres -X -q -t -A -c 'select 1' >/dev/null 2>&1; then
  echo "legal-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
M="$ROOT/supabase/migrations"
SCHEMA="$M/0146_legal_documents.sql"
DATA="$M/0147_legal_documents_v1_pl.sql"
SRC="$ROOT/content/legal/pl"
for f in "$SCHEMA" "$DATA"; do [ -f "$f" ] || { echo "legal-sql: $f not found" >&2; exit 2; }; done

extract() { # file, function name, end marker regex
  awk -v start="^create (or replace )?function public[.]$2[(]" -v stop="$3" \
    '$0 ~ start {on=1} on {print} on && $0 ~ stop {exit}' "$1"
}
IS_ADMIN=$(extract "$M/0002_functions_and_triggers.sql" is_admin '^[$][$];')
RESERVED=$(extract "$M/0125_grovnews_sources_daily.sql" cms_slug_is_reserved '^[$][$];')
HOMEPAGE_LIVE=$(extract "$M/0110_homepage_is_a_page.sql" cms_pages_homepage_stays_live '^[$][$];')
for v in IS_ADMIN RESERVED HOMEPAGE_LIVE; do
  [ -n "${!v}" ] || { echo "legal-sql: could not extract $v" >&2; exit 2; }
done

WORK=$(mktemp -d)
cleanup() {
  if [ "${KEEP_DB:-0}" != "1" ]; then
    dropdb "${PGCONN[@]}" --if-exists --force "$DB" >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT
ERR="$WORK/err"

PASS=0; FAIL=0
ok() { PASS=$((PASS + 1)); echo "  PASS $1"; }
bad() { FAIL=$((FAIL + 1)); echo "  FAIL $1" >&2; }
q() { psql "${PGCONN[@]}" -d "$DB" -X -q -t -A -v ON_ERROR_STOP=1 "$@"; }
check() { # name, sql returning t/f
  local got; got=$(q -c "$2" 2>&1) || { bad "$1 (error: $got)"; return 0; }
  if [ "$got" = "t" ]; then ok "$1"; else bad "$1 (got: $got)"; fi
}
expect_raise() { # name, sql, pattern the error must contain
  local got
  if got=$(q -c "$2" 2>&1); then bad "$1 (no error; got: $got)"
  elif grep -q -- "$3" <<<"$got"; then ok "$1"
  else bad "$1 (error: $got)"; fi
}
apply_file() { # file [out] — one transaction, as the PROD connector applies a piece
  PGOPTIONS='-c client_min_messages=warning' \
    psql "${PGCONN[@]}" -d "$DB" -X -q -t -A -v ON_ERROR_STOP=1 -1 -f "$1" >"${2:-/dev/null}" 2>"$ERR"
}
# A statement as a client role (in a transaction that is never committed).
as_role() { # role, auth.uid() ('' for none), sql → output and errors
  psql "${PGCONN[@]}" -d "$DB" -X -q -t -A -v ON_ERROR_STOP=1 \
    -c "begin" -c "select set_config('request.jwt.claim.sub', '$2', true) is not null" \
    -c "set local role $1" -c "$3" 2>&1 || true
}
role_denied() { # name, role, uid, sql, the object the refusal must name ("function x" / "table x")
  local got; got=$(as_role "$2" "$3" "$4")
  if grep -q "permission denied for $5" <<<"$got"; then ok "$1"; else bad "$1 (got: $got)"; fi
}
role_value() { # name, role, uid, sql, expected last line
  local got; got=$(as_role "$2" "$3" "$4" | tail -1)
  if [ "$got" = "$5" ]; then ok "$1"; else bad "$1 (got: $got)"; fi
}

# ── The expected values, from the files themselves ─────────────────────────
SLUGS=(regulamin polityka-prywatnosci polityka-cookies umowa-powierzenia-danych)
declare -A SHA CHARS TITLE
TITLE[regulamin]="Regulamin"
TITLE[polityka-prywatnosci]="Polityka prywatności"
TITLE[polityka-cookies]="Polityka cookies"
TITLE[umowa-powierzenia-danych]="Umowa powierzenia danych"
for s in "${SLUGS[@]}"; do
  SHA[$s]=$(sha256sum "$SRC/$s.txt" | cut -d' ' -f1)
  CHARS[$s]=$(node -e 'let n=0;for(const _ of require("fs").readFileSync(process.argv[1],"utf8"))n++;process.stdout.write(String(n))' "$SRC/$s.txt")
done
# The owner's brief, independent of the generator: every document v1.0, in
# force from 20 October 2026.
VERSION="1.0"; EFFECTIVE="2026-10-20"
# PROD holds the Regulamin pasted into a text section, without its final newline.
REG_OLD=$(cat "$SRC/regulamin.txt")
SOON='{"status":"soon","text":"","version":"","effective":null}'
SNAP_KEYS="array['analytics_id','anchor','audience','code','content','id','show_from','show_until','sort_order','style','type','visible']"

# 0147 cut at its "-- [n/N]" lines, the way it is applied to PROD.
mkdir -p "$WORK/pieces"
LC_ALL=C awk -v dir="$WORK/pieces" -v head="$WORK/head.sql" '
  /^-- \[[0-9]+\/[0-9]+\] / { n++; f = sprintf("%s/%02d.sql", dir, n) }
  n == 0 { print > head }
  n > 0 { print > f }' "$DATA"
PIECES=("$WORK"/pieces/*.sql)
piece_kind() { head -1 "$1" | sed -E 's/^-- \[[0-9]+\/[0-9]+\] ([a-z-]+) · (part|import).*/\1 \2/'; }
declare -A PARTS_OF IMPORT_OF
for p in "${PIECES[@]}"; do
  read -r slug kind < <(piece_kind "$p")
  if [ "$kind" = "part" ]; then PARTS_OF[$slug]="${PARTS_OF[$slug]:-} $p"; else IMPORT_OF[$slug]="$p"; fi
done
nparts() { local a; read -r -a a <<<"${PARTS_OF[$1]:-}"; echo "${#a[@]}"; }
import_sql() { sed 1d "${IMPORT_OF[$1]}"; }

# ── The rehearsal ───────────────────────────────────────────────────────────
build_schema() {
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

-- PROD's auth.uid(), verbatim.
create function auth.uid() returns uuid language sql stable as $f$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$f$;
create table public.profiles (id uuid primary key, email text not null default '', role text not null default 'user');
SQL
  {
    echo "set client_min_messages = warning;"
    printf '%s\n' "$IS_ADMIN" "$RESERVED" "$HOMEPAGE_LIVE"
  } > "$WORK/bodies.sql"
  q -f "$WORK/bodies.sql" >/dev/null

  q >/dev/null <<'SQL'
set client_min_messages = warning;
-- 0005
revoke execute on function public.is_admin(uuid) from public, anon;
grant execute on function public.is_admin(uuid) to authenticated;

-- cms_pages: 0012, + kind/sort_order (0049), seo/scheduled_at/updated_by/nav
-- (0085), header/footer/promo/template (0092), is_homepage (0110), and every
-- CHECK as it stands after 0116.
create table public.cms_pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  status text not null default 'draft',
  published_snapshot jsonb,
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  kind text not null default 'standard',
  sort_order integer not null default 100,
  seo jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  nav_group text,
  nav_order integer not null default 100,
  header_mode text not null default 'global',
  footer_mode text not null default 'global',
  promo jsonb not null default '{}'::jsonb,
  template text,
  is_homepage boolean not null default false,
  constraint cms_pages_status_check check (status in ('draft', 'published', 'scheduled', 'archived')),
  constraint cms_pages_scheduled_needs_date check (status <> 'scheduled' or scheduled_at is not null),
  constraint cms_pages_kind_check check (kind = any (array['standard'::text, 'launch'::text, 'app'::text])),
  constraint cms_pages_header_mode_check check (header_mode in ('global', 'minimal', 'none')),
  constraint cms_pages_footer_mode_check check (footer_mode in ('global', 'minimal', 'none')));
alter table public.cms_pages add constraint cms_pages_slug_not_reserved
  check (slug = 'home' or not public.cms_slug_is_reserved(slug)) not valid;
alter table public.cms_pages add constraint cms_pages_slug_shape
  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$') not valid;
create unique index cms_pages_one_homepage on public.cms_pages (is_homepage) where is_homepage;
create trigger cms_pages_homepage_stays_live before update or delete on public.cms_pages
  for each row execute function public.cms_pages_homepage_stays_live();

-- cms_blocks: 0012 + style/code/analytics_id/anchor/updated_by (0085) +
-- show_from/show_until/audience (0092).
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
  constraint cms_blocks_audience_check check (audience in ('everyone', 'anon', 'user')));
create index cms_blocks_page_idx on public.cms_blocks (page_id, sort_order);

-- cms_page_versions (0085), verbatim.
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
  constraint cms_page_versions_reason_check check (reason in ('publish', 'manual', 'rollback')));

alter table public.cms_pages enable row level security;
alter table public.cms_blocks enable row level security;
alter table public.cms_page_versions enable row level security;

-- Test helpers (not part of any migration): lib/services/cms.ts snapshotOf,
-- a fingerprint of every CMS row (updated_at included) and their row versions.
create function public.t_snapshot(p_page uuid) returns jsonb language sql stable as $f$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'type', b.type, 'sort_order', b.sort_order, 'visible', b.visible,
    'content', b.content, 'style', b.style, 'code', b.code,
    'analytics_id', b.analytics_id, 'anchor', b.anchor,
    'show_from', b.show_from, 'show_until', b.show_until, 'audience', b.audience
  ) order by b.sort_order, b.created_at, b.id), '[]'::jsonb)
  from public.cms_blocks b where b.page_id = p_page
$f$;
create function public.t_fingerprint(p_slugs text[] default null) returns text language sql stable as $f$
  select md5(
    coalesce((select string_agg(t::text, '|' order by t.id) from public.cms_pages t
              where p_slugs is null or t.slug = any (p_slugs)), '') || '#' ||
    coalesce((select string_agg(t::text, '|' order by t.id) from public.cms_blocks t
              join public.cms_pages p on p.id = t.page_id where p_slugs is null or p.slug = any (p_slugs)), '') || '#' ||
    coalesce((select string_agg(t::text, '|' order by t.id) from public.cms_page_versions t
              join public.cms_pages p on p.id = t.page_id where p_slugs is null or p.slug = any (p_slugs)), ''))
$f$;
-- Any INSERT or UPDATE changes this; a row lock does not.
create function public.t_xmins() returns text language sql stable as $f$
  select coalesce((select string_agg(xmin::text || ':' || id, ',' order by id) from public.cms_pages), '') || '#' ||
         coalesce((select string_agg(xmin::text || ':' || id, ',' order by id) from public.cms_blocks), '') || '#' ||
         coalesce((select string_agg(xmin::text || ':' || id, ',' order by id) from public.cms_page_versions), '')
$f$;
SQL
}

seed_prod_like() {
  q -v regtext="$REG_OLD" >/dev/null <<'SQL'
set client_min_messages = warning;
insert into public.profiles (id, email, role) values
  ('00000000-0000-4000-8000-00000000a001', 'admin@example.com', 'admin'),
  ('00000000-0000-4000-8000-00000000c001', 'customer@example.com', 'user');

-- Unrelated pages (one with a legal section of its own): nothing may touch them.
insert into public.cms_pages (slug, title, status, kind, nav_group, nav_order, seo, published_at)
values ('o-nas', 'O nas', 'published', 'standard', 'company', 10, '{"pl":{"title":"O GrovBase"}}', now() - interval '9 days'),
       ('premiera', 'Strona premiery', 'published', 'launch', null, 100, '{}', now() - interval '9 days'),
       ('kontakt', 'Kontakt', 'draft', 'standard', 'help', 10, '{}', null);
update public.cms_pages set is_homepage = true where slug = 'premiera';
insert into public.cms_blocks (page_id, type, sort_order, content, style)
  select id, 'text', 0, '{"title":{"pl":"Czym jest GrovBase"},"description":{"pl":"Narzędziem."}}', '{"base":{"width":"narrow"}}'
  from public.cms_pages where slug = 'o-nas';
insert into public.cms_blocks (page_id, type, sort_order, content)
  select id, 'legal', 1, '{"html":{"pl":"<h2>Nie dokument</h2>"}}' from public.cms_pages where slug = 'o-nas';
insert into public.cms_blocks (page_id, type, sort_order, content)
  select id, 'launch', 0, '{"fields":{"hero.badge":{"pl":"ZDJĘCIA AI DLA SPRZEDAWCÓW"}}}' from public.cms_pages where slug = 'premiera';
insert into public.cms_blocks (page_id, type, sort_order, content)
  select id, 'contact_form', 0, '{"formHandler":"contact"}' from public.cms_pages where slug = 'kontakt';

-- Regulamin as PROD holds it: published, ONE text section, the whole text
-- pasted into description.pl (without the final newline) under "Regulanin".
insert into public.cms_pages (slug, title, status, kind, nav_group, nav_order, seo, published_at)
values ('regulamin', 'Regulamin', 'published', 'standard', 'legal', 10,
        '{"pl":{"title":"Regulamin — GrovBase","description":"Regulamin korzystania z serwisu GrovBase."},"en":{"title":"Terms — GrovBase"}}',
        now() - interval '2 days');
insert into public.cms_blocks (page_id, type, sort_order, content, style)
  select id, 'text', 0,
         jsonb_build_object('title', jsonb_build_object('pl', 'Regulanin'), 'description', jsonb_build_object('pl', :'regtext')),
         '{"base":{"width":"narrow"}}'
  from public.cms_pages where slug = 'regulamin';

-- Polityka prywatności as 0087 seeded it: a draft, placeholder + html outline.
insert into public.cms_pages (slug, title, status, kind, nav_group, nav_order, seo)
values ('polityka-prywatnosci', 'Polityka prywatności', 'draft', 'standard', 'legal', 20,
        '{"pl":{"title":"Polityka prywatności — GrovBase","description":"Jak GrovBase przetwarza dane osobowe."}}');
insert into public.cms_blocks (page_id, type, sort_order, content, style)
  select id, 'text', 0, '{"description":{"pl":"Treść polityki prywatności jest przygotowywana i zostanie opublikowana przed startem usługi."}}',
         '{"base":{"width":"narrow"}}'
  from public.cms_pages where slug = 'polityka-prywatnosci';
insert into public.cms_blocks (page_id, type, sort_order, content, style)
  select id, 'legal', 1,
         '{"html":{"pl":"<h2>Administrator danych</h2><p>W przygotowaniu.</p>","en":"<h2>Data controller</h2><p>In preparation.</p>","de":"<h2>Verantwortlicher</h2><p>In Vorbereitung.</p>"}}',
         '{"base":{"width":"narrow"}}'
  from public.cms_pages where slug = 'polityka-prywatnosci';

-- What is published is the snapshot; each published page has two versions,
-- the privacy draft one manual save.
update public.cms_pages p set published_snapshot = public.t_snapshot(p.id) where p.status = 'published';
insert into public.cms_page_versions (page_id, version, snapshot, seo, reason, label, created_at)
  select p.id, v.n, p.published_snapshot, p.seo, 'publish', null, now() - interval '5 days'
  from public.cms_pages p cross join (values (1), (2)) v(n) where p.status = 'published';
insert into public.cms_page_versions (page_id, version, snapshot, seo, reason, label)
  select p.id, 1, public.t_snapshot(p.id), p.seo, 'manual', 'zapis roboczy'
  from public.cms_pages p where p.slug = 'polityka-prywatnosci';
SQL
}

reset_db() {
  dropdb "${PGCONN[@]}" --if-exists --force "$DB" >/dev/null 2>&1 || true
  createdb "${PGCONN[@]}" -E UTF8 -T template0 "$DB"
  build_schema
  seed_prod_like
}

LEGAL_SLUGS="array['regulamin','polityka-prywatnosci','polityka-cookies','umowa-powierzenia-danych']"
OTHER_FP="public.t_fingerprint(array(select slug from public.cms_pages where slug <> all ($LEGAL_SLUGS)))"
SRC_XMINS="(select string_agg(xmin::text || ':' || doc_key || ':' || part, ',' order by doc_key, part) from public.legal_document_sources)"
doc_block() { echo "(select b from public.cms_blocks b join public.cms_pages p on p.id = b.page_id where p.slug = '$1' and b.type = 'legal' and b.visible)"; }
pub_doc() { echo "(select e from public.cms_pages p, jsonb_array_elements(p.published_snapshot) e where p.slug = '$1' and e->>'type' = 'legal' and (e->>'visible')::boolean)"; }
sha_sql() { echo "encode(extensions.digest(convert_to($1, 'UTF8'), 'sha256'), 'hex')"; }
# The statuses an applied file printed, in order ("unchanged already_imported …").
statuses() { { grep -o '"status": "[a-z_]*"' "$1" || true; } | sed -E 's/.*: "([a-z_]*)"/\1/' | paste -sd' ' -; }
# How many versions the legal pages have.
LEGAL_VERSIONS="(select count(*) from public.cms_page_versions v join public.cms_pages p on p.id = v.page_id where p.slug = any ($LEGAL_SLUGS))"
last_version() { echo "(select v from public.cms_page_versions v join public.cms_pages p on p.id = v.page_id where p.slug = '$1' order by v.version desc limit 1)"; }

# The text the database holds, decoded back to bytes and compared with the file.
same_bytes() { # name, text expression, file
  local out="$WORK/bytes.out"
  if ! q -c "select encode(convert_to(($2), 'UTF8'), 'base64')" 2>"$ERR" | base64 -d >"$out" 2>>"$ERR"; then
    bad "$1 (error: $(cat "$ERR"))"; return 0
  fi
  if cmp -s "$out" "$3"; then ok "$1"
  else bad "$1 ($(wc -c <"$out") bytes vs $(wc -c <"$3"); $(cmp "$out" "$3" 2>&1 | head -1))"; fi
}
# The same through psql's plain unaligned output (one trailing record separator).
same_raw() { # name, text expression, file
  local out="$WORK/raw.out"
  q -c "select $2" >"$out" 2>"$ERR" || { bad "$1 (error: $(cat "$ERR"))"; return 0; }
  if cmp -s "$out" <(cat "$3"; printf '\n'); then ok "$1"
  else bad "$1 ($(cmp "$out" <(cat "$3"; printf '\n') 2>&1 | head -1))"; fi
}
# Every legal page's text vs its file, in the draft and in the published page.
texts_match_files() {
  local s B E
  for s in "${SLUGS[@]}"; do
    B=$(doc_block "$s"); E=$(pub_doc "$s")
    check "$s: draft and published text hash like the file" \
      "select $(sha_sql "($B).content->'doc'->'pl'->>'text'") = '${SHA[$s]}'
          and $(sha_sql "($E)->'content'->'doc'->'pl'->>'text'") = '${SHA[$s]}'"
  done
}

# ════════════════════════════════════════════════════════════════════════════
echo "A · PROD as it is, then 0146 and 0147 piece by piece"
reset_db
SEED_OTHER=$(q -c "select $OTHER_FP")
SEED_ALL=$(q -c "select public.t_fingerprint()")
OLD_PRIV_LEGAL=$(q -c "select b.id from public.cms_blocks b join public.cms_pages p on p.id = b.page_id where p.slug = 'polityka-prywatnosci' and b.type = 'legal'")
OLD_PRIV_TEXT=$(q -c "select b.id from public.cms_blocks b join public.cms_pages p on p.id = b.page_id where p.slug = 'polityka-prywatnosci' and b.type = 'text'")
OLD_REG_TEXT=$(q -c "select b.id from public.cms_blocks b join public.cms_pages p on p.id = b.page_id where p.slug = 'regulamin' and b.type = 'text'")
OLD_REG_CONTENT=$(q -c "select md5(b.content::text) from public.cms_blocks b where b.id = '$OLD_REG_TEXT'")
OLD_META=$(q -c "select string_agg(slug || '=' || md5(seo::text) || ':' || coalesce(nav_group, '-') || ':' || nav_order || ':' || title || ':' || kind, ',' order by slug) from public.cms_pages where slug in ('regulamin', 'polityka-prywatnosci')")

if apply_file "$SCHEMA"; then ok "0146 applies"; else bad "0146 applies ($(cat "$ERR"))"; fi
check "0146 alone changes no CMS row" "select public.t_fingerprint() = '$SEED_ALL'"
applied=0
for p in "${PIECES[@]}"; do
  read -r slug kind < <(piece_kind "$p")
  if apply_file "$p" "$WORK/out.txt"; then
    applied=$((applied + 1))
    if [ "$kind" = "import" ]; then cp "$WORK/out.txt" "$WORK/import_$slug.out"; fi
  else
    bad "piece $(basename "$p") ($slug $kind) applies ($(cat "$ERR"))"
  fi
done
if [ "$applied" -eq "${#PIECES[@]}" ]; then ok "all ${#PIECES[@]} pieces of 0147 apply, each in its own transaction"; fi
for s in "${SLUGS[@]}"; do
  if grep -q '"status": "imported"' "$WORK/import_$s.out" 2>/dev/null && grep -q "\"sha256\": \"${SHA[$s]}\"" "$WORK/import_$s.out"; then
    ok "$s: the import reports 'imported' with the file's sha256"
  else bad "$s: the import reports 'imported' ($(cat "$WORK/import_$s.out" 2>/dev/null))"; fi
done

check "four legal pages, all published just now, none scheduled" \
  "select count(*) = 4 and bool_and(status = 'published' and published_at > now() - interval '1 hour'
                                    and scheduled_at is null and kind = 'standard')
   from public.cms_pages where slug = any ($LEGAL_SLUGS)"
for s in "${SLUGS[@]}"; do
  echo " · $s (${CHARS[$s]} characters, sha256 ${SHA[$s]:0:12}…)"
  B=$(doc_block "$s"); E=$(pub_doc "$s")
  check "one visible section, a legal one, in the draft and in the published page" \
    "select (select count(*) from public.cms_blocks b join public.cms_pages p on p.id = b.page_id where p.slug = '$s' and b.visible) = 1
        and (select count(*) from public.cms_pages p, jsonb_array_elements(p.published_snapshot) e
             where p.slug = '$s' and (e->>'visible')::boolean) = 1
        and ($B).id is not null and ($E) is not null"
  check "draft text hashes like the file (sha256sum)" "select $(sha_sql "($B).content->'doc'->'pl'->>'text'") = '${SHA[$s]}'"
  check "published text hashes like the file" "select $(sha_sql "($E)->'content'->'doc'->'pl'->>'text'") = '${SHA[$s]}'"
  check "stored sha256 and chars are the file's" \
    "select ($B).content->'doc'->'pl'->>'sha256' = '${SHA[$s]}' and (($B).content->'doc'->'pl'->>'chars')::int = ${CHARS[$s]}
        and ($E)->'content'->'doc'->'pl'->>'sha256' = '${SHA[$s]}' and (($E)->'content'->'doc'->'pl'->>'chars')::int = ${CHARS[$s]}"
  check "the text has the file's ${CHARS[$s]} characters (code points)" \
    "select char_length(($B).content->'doc'->'pl'->>'text') = ${CHARS[$s]}
        and char_length(($E)->'content'->'doc'->'pl'->>'text') = ${CHARS[$s]}"
  same_bytes "draft text = the file, byte for byte (decoded from the database, cmp)" "($B).content->'doc'->'pl'->>'text'" "$SRC/$s.txt"
  same_bytes "published text = the file, byte for byte" "($E)->'content'->'doc'->'pl'->>'text'" "$SRC/$s.txt"
  same_raw "published text = the file through psql -At output" "($E)->'content'->'doc'->'pl'->>'text'" "$SRC/$s.txt"
  check "pl: active, version $VERSION, in force from $EFFECTIVE (draft and published)" \
    "select ($B).content->'doc'->'pl'->>'status' = 'active' and ($B).content->'doc'->'pl'->>'version' = '$VERSION'
        and ($B).content->'doc'->'pl'->>'effective' = '$EFFECTIVE'
        and ($E)->'content'->'doc'->'pl'->>'status' = 'active' and ($E)->'content'->'doc'->'pl'->>'version' = '$VERSION'
        and ($E)->'content'->'doc'->'pl'->>'effective' = '$EFFECTIVE'"
  check "en and de: status soon, empty text, no version, no date" \
    "select ($B).content->'doc'->'en' = '$SOON'::jsonb and ($B).content->'doc'->'de' = '$SOON'::jsonb
        and ($E)->'content'->'doc'->'en' = '$SOON'::jsonb and ($E)->'content'->'doc'->'de' = '$SOON'::jsonb"
  check "the section holds only the doc, for everyone, always" \
    "select array(select jsonb_object_keys(($B).content)) = array['doc']
        and ($B).show_from is null and ($B).show_until is null and ($B).audience = 'everyone'"
  check "the published page is the draft (snapshotOf of every section)" \
    "select p.published_snapshot = public.t_snapshot(p.id) from public.cms_pages p where p.slug = '$s'"
  check "every snapshot entry has exactly snapshotOf's keys" \
    "select bool_and(array(select k from jsonb_object_keys(e) k order by k) = $SNAP_KEYS)
     from public.cms_pages p, jsonb_array_elements(p.published_snapshot) e where p.slug = '$s'"
  check "the newest version: 'publish', 'Import: ${TITLE[$s]} v$VERSION (pl) sha256 ${SHA[$s]:0:12}', = the published page" \
    "select (v).reason = 'publish' and (v).label = 'Import: ${TITLE[$s]} v$VERSION (pl) sha256 ${SHA[$s]:0:12}'
        and (v).snapshot = (select published_snapshot from public.cms_pages where slug = '$s') and (v).created_by is null
     from (select $(last_version "$s") as v) x"
  check "the parts in legal_document_sources add up to the stored text, each <= 20 000 characters" \
    "select string_agg(body, '' order by part) = ($B).content->'doc'->'pl'->>'text' and max(char_length(body)) <= 20000
        and count(*) = $(nparts "$s")
     from public.legal_document_sources where doc_key = '$s' and locale = 'pl' and doc_version = '$VERSION'"
done

echo " · regulamin — PROD's text section"
check "two sections: the new legal one (sort_order -1, narrow) and the old text one" \
  "select count(*) = 2 and bool_or(b.type = 'legal' and b.visible and b.sort_order = -1 and b.style = '{\"base\":{\"width\":\"narrow\"}}'::jsonb)
   from public.cms_blocks b join public.cms_pages p on p.id = b.page_id where p.slug = 'regulamin'"
check "the old text section is hidden, not removed, its content untouched" \
  "select not b.visible and md5(b.content::text) = '$OLD_REG_CONTENT' and b.content->'title'->>'pl' = 'Regulanin'
   from public.cms_blocks b where b.id = '$OLD_REG_TEXT'"
check "… it is still in the published page, hidden" \
  "select exists (select 1 from public.cms_pages p, jsonb_array_elements(p.published_snapshot) e
                  where p.slug = 'regulamin' and e->>'id' = '$OLD_REG_TEXT' and not (e->>'visible')::boolean)"
check "versions: the two old ones, then 'Przed importem: Regulamin v$VERSION (pl)' (manual), then the import (publish)" \
  "select array_agg(v.version || ':' || v.reason || ':' || coalesce(v.label, '-') order by v.version) =
          array['1:publish:-', '2:publish:-', '3:manual:Przed importem: Regulamin v$VERSION (pl)',
                '4:publish:Import: Regulamin v$VERSION (pl) sha256 ${SHA[regulamin]:0:12}']
   from public.cms_page_versions v join public.cms_pages p on p.id = v.page_id where p.slug = 'regulamin'"
check "the pre-import version holds the old 'Regulanin' text section, visible, with the text (= the file minus its final newline)" \
  "select jsonb_array_length(v.snapshot) = 1 and v.snapshot->0->>'id' = '$OLD_REG_TEXT' and v.snapshot->0->>'type' = 'text'
      and (v.snapshot->0->>'visible')::boolean and v.snapshot->0->'content'->'title'->>'pl' = 'Regulanin'
      and $(sha_sql "(v.snapshot->0->'content'->'description'->>'pl') || E'\\n'") = '${SHA[regulamin]}'
      and v.seo = (select seo from public.cms_pages where slug = 'regulamin')
   from public.cms_page_versions v join public.cms_pages p on p.id = v.page_id where p.slug = 'regulamin' and v.version = 3"

echo " · polityka-prywatnosci — the 0087 draft"
check "the seed's legal section is the one that holds the document" \
  "select (select b.id from public.cms_blocks b join public.cms_pages p on p.id = b.page_id
           where p.slug = 'polityka-prywatnosci' and b.visible) = '$OLD_PRIV_LEGAL'"
check "the placeholder text section is hidden, not removed" \
  "select not b.visible and b.content->'description'->>'pl' like 'Treść polityki prywatności jest przygotowywana%'
   from public.cms_blocks b where b.id = '$OLD_PRIV_TEXT'"
check "versions: the old manual save, 'Przed importem', the import" \
  "select array_agg(v.version || ':' || v.reason || ':' || coalesce(v.label, '-') order by v.version) =
          array['1:manual:zapis roboczy', '2:manual:Przed importem: Polityka prywatności v$VERSION (pl)',
                '3:publish:Import: Polityka prywatności v$VERSION (pl) sha256 ${SHA[polityka-prywatnosci]:0:12}']
   from public.cms_page_versions v join public.cms_pages p on p.id = v.page_id where p.slug = 'polityka-prywatnosci'"
check "the old html outline lives on in the pre-import version" \
  "select v.snapshot @> '[{\"id\":\"$OLD_PRIV_LEGAL\",\"type\":\"legal\",\"content\":{\"html\":{\"pl\":\"<h2>Administrator danych</h2><p>W przygotowaniu.</p>\"}}}]'::jsonb
      and jsonb_array_length(v.snapshot) = 2
   from public.cms_page_versions v join public.cms_pages p on p.id = v.page_id where p.slug = 'polityka-prywatnosci' and v.version = 2"

echo " · the two existing pages keep their title, menu place and SEO"
check "title, kind, nav_group, nav_order and seo of regulamin / polityka-prywatnosci unchanged" \
  "select string_agg(slug || '=' || md5(seo::text) || ':' || coalesce(nav_group, '-') || ':' || nav_order || ':' || title || ':' || kind, ',' order by slug) = '$OLD_META'
   from public.cms_pages where slug in ('regulamin', 'polityka-prywatnosci')"

echo " · polityka-cookies / umowa-powierzenia-danych — new pages"
for pair in "polityka-cookies:30" "umowa-powierzenia-danych:40"; do
  s=${pair%%:*}; order=${pair##*:}
  check "$s: created as '${TITLE[$s]}', standard, footer group 'legal' at $order, SEO title = page title" \
    "select title = '${TITLE[$s]}' and kind = 'standard' and nav_group = 'legal' and nav_order = $order
        and seo = jsonb_build_object('pl', jsonb_build_object('title', '${TITLE[$s]}')) and not is_homepage
     from public.cms_pages where slug = '$s'"
  check "$s: one section (sort_order 0), one version (the import), no 'Przed importem'" \
    "select (select count(*) from public.cms_blocks b join public.cms_pages p on p.id = b.page_id where p.slug = '$s') = 1
        and (select array_agg(v.version || ':' || v.reason) from public.cms_page_versions v join public.cms_pages p on p.id = v.page_id where p.slug = '$s') = array['1:publish']
        and ($(doc_block "$s")).sort_order = 0"
  if grep -q '"page_created": true' "$WORK/import_$s.out" 2>/dev/null; then ok "$s: the import reports page_created"; else bad "$s: the import reports page_created"; fi
done
for s in regulamin polityka-prywatnosci; do
  if grep -q '"page_created": false' "$WORK/import_$s.out" 2>/dev/null; then ok "$s: the import reports page_created false"; else bad "$s: page_created false"; fi
done

echo " · everything else"
check "unrelated pages (o-nas with its own legal section, the launch homepage, a draft) untouched — rows, sections, versions" \
  "select $OTHER_FP = '$SEED_OTHER'"
check "9 parts stored, nothing else" "select count(*) = 9 from public.legal_document_sources"

# ════════════════════════════════════════════════════════════════════════════
echo "B · 0147 applied again, as one file"
FP_A=$(q -c "select public.t_fingerprint()"); X_A=$(q -c "select public.t_xmins()"); SX_A=$(q -c "select $SRC_XMINS")
if apply_file "$DATA" "$WORK/again.out"; then ok "0147 applies again"; else bad "0147 applies again ($(cat "$ERR"))"; fi
if [ "$(grep -c '"status": "unchanged"' "$WORK/again.out")" = "4" ] && ! grep -q '"status": "imported"' "$WORK/again.out"; then
  ok "all four imports return 'unchanged'"
else bad "all four imports return 'unchanged' ($(cat "$WORK/again.out"))"; fi
check "CMS rows identical (updated_at, published_at, versions)" "select public.t_fingerprint() = '$FP_A'"
check "no CMS row written at all (row versions unchanged)" "select public.t_xmins() = '$X_A'"
check "no part rewritten (row versions unchanged)" "select $SRC_XMINS = '$SX_A'"
check "still 4 + 3 + 1 + 1 versions" \
  "select count(*) = 9 from public.cms_page_versions v join public.cms_pages p on p.id = v.page_id where p.slug = any ($LEGAL_SLUGS)"
echo " · and piece by piece"
again_ok=1
for p in "${PIECES[@]}"; do apply_file "$p" "$WORK/out.txt" || again_ok=0; done
if [ "$again_ok" = 1 ]; then ok "every piece applies a second time"; else bad "every piece applies a second time ($(cat "$ERR"))"; fi
check "… and writes nothing" "select public.t_xmins() = '$X_A' and $SRC_XMINS = '$SX_A'"

# ════════════════════════════════════════════════════════════════════════════
echo "C · 0146 applied again"
ACL_A=$(q -c "select coalesce(p.proacl::text, '-') || '|' || coalesce(c.relacl::text, '-') || '|' || md5(pg_get_functiondef(p.oid))
              from pg_proc p, pg_class c where p.proname = 'legal_document_import' and c.relname = 'legal_document_sources'")
if apply_file "$SCHEMA"; then ok "0146 applies a second time"; else bad "0146 applies a second time ($(cat "$ERR"))"; fi
check "privileges and the function body unchanged" \
  "select coalesce(p.proacl::text, '-') || '|' || coalesce(c.relacl::text, '-') || '|' || md5(pg_get_functiondef(p.oid)) = '$ACL_A'
   from pg_proc p, pg_class c where p.proname = 'legal_document_import' and c.relname = 'legal_document_sources'"
check "one policy, RLS still on" \
  "select (select count(*) from pg_policies where tablename = 'legal_document_sources') = 1
      and (select relrowsecurity from pg_class where relname = 'legal_document_sources')"
check "ONE legal_document_import (no stale overload), p_force last, defaulting to false" \
  "select count(*) = 1
      and bool_and(pg_get_function_identity_arguments(p.oid) = 'p_slug text, p_locale text, p_version text, p_effective date, p_title text, p_parts integer, p_chars integer, p_sha256 text, p_force boolean')
      and bool_and(pg_get_function_arguments(p.oid) like '%p_sha256 text, p_force boolean DEFAULT false')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname = 'legal_document_import'"
check "no data changed" "select public.t_xmins() = '$X_A' and $SRC_XMINS = '$SX_A'"

# ════════════════════════════════════════════════════════════════════════════
echo "D · refusals on an imported database: nothing changes"
REG_IMPORT=$(import_sql regulamin)
NREG=$(nparts regulamin)
REG_CALL() { # parts chars sha
  echo "select public.legal_document_import('regulamin', 'pl', '$VERSION', date '$EFFECTIVE', 'Regulamin', $1, $2, '$3')"
}
q -c "update public.legal_document_sources set body = overlay(body placing 'X' from 200 for 1)
      where doc_key = 'regulamin' and part = 2" >/dev/null
check "(a part damaged: one character replaced, same length)" \
  "select char_length(string_agg(body, '' order by part)) = ${CHARS[regulamin]} from public.legal_document_sources where doc_key = 'regulamin'"
expect_raise "a damaged part → legal_import_mismatch (sha256)" "$REG_IMPORT" "legal_import_mismatch.*sha256"
q -c "update public.legal_document_sources set body = overlay(body placing '' from 200 for 1)
      where doc_key = 'regulamin' and part = 2" >/dev/null
expect_raise "a part one character short → legal_import_mismatch (characters)" "$REG_IMPORT" "legal_import_mismatch.*characters"
check "nothing changed (rows and row versions)" "select public.t_fingerprint() = '$FP_A' and public.t_xmins() = '$X_A'"
if apply_file "${IMPORT_OF[regulamin]}"; then bad "the damaged import piece is refused"
elif grep -q "legal_import_mismatch" "$ERR"; then ok "the damaged import piece is refused (legal_import_mismatch)"
else bad "the damaged import piece is refused ($(cat "$ERR"))"; fi
if apply_file "$DATA" "$WORK/repair.out"; then ok "0147 again repairs the part"; else bad "0147 again repairs the part ($(cat "$ERR"))"; fi
if [ "$(grep -c '"status": "unchanged"' "$WORK/repair.out")" = "4" ]; then ok "… and every import is 'unchanged'"; else bad "… unchanged ($(cat "$WORK/repair.out"))"; fi
check "… the parts add up to the file again" \
  "select $(sha_sql "string_agg(body, '' order by part)") = '${SHA[regulamin]}' from public.legal_document_sources where doc_key = 'regulamin'"
WRONG_SHA="${SHA[regulamin]:0:63}$( [ "${SHA[regulamin]:63:1}" = "0" ] && echo 1 || echo 0 )"
expect_raise "a wrong sha256 argument → legal_import_mismatch" "$(REG_CALL "$NREG" "${CHARS[regulamin]}" "$WRONG_SHA")" "legal_import_mismatch.*sha256"
expect_raise "one part too many announced → legal_import_mismatch" "$(REG_CALL $((NREG + 1)) "${CHARS[regulamin]}" "${SHA[regulamin]}")" "legal_import_mismatch.*$NREG of $((NREG + 1)) parts"
expect_raise "one part too few announced → legal_import_mismatch" "$(REG_CALL $((NREG - 1)) "${CHARS[regulamin]}" "${SHA[regulamin]}")" "legal_import_mismatch.*characters"
expect_raise "a wrong length → legal_import_mismatch" "$(REG_CALL "$NREG" $((CHARS[regulamin] + 1)) "${SHA[regulamin]}")" "legal_import_mismatch.*characters"
expect_raise "a version with no parts → legal_import_mismatch" \
  "select public.legal_document_import('regulamin', 'pl', '9.9', null, 'Regulamin', 1, 10, '${SHA[regulamin]}')" "legal_import_mismatch.*0 of 1 parts"
q -c "insert into public.legal_document_sources (doc_key, locale, doc_version, part, body) values ('regulamin', 'pl', 'crlf', 1, E'a\r\nb\n')" >/dev/null
expect_raise "a text with CR line endings → legal_import_mismatch (not normalised)" \
  "select public.legal_document_import('regulamin', 'pl', 'crlf', null, 'Regulamin', 1, 5, $(sha_sql "E'a\\r\\nb\\n'"))" "not normalised"
expect_raise "a bad locale → legal_import_bad_args" \
  "select public.legal_document_import('regulamin', 'fr', '$VERSION', null, 'Regulamin', 1, 1, '${SHA[regulamin]}')" "legal_import_bad_args"
expect_raise "a bad sha256 → legal_import_bad_args" \
  "select public.legal_document_import('regulamin', 'pl', '$VERSION', null, 'Regulamin', 1, 1, 'XYZ')" "legal_import_bad_args"
expect_raise "a bad slug → legal_import_bad_args" \
  "select public.legal_document_import('Regulamin!', 'pl', '$VERSION', null, 'Regulamin', 1, 1, '${SHA[regulamin]}')" "legal_import_bad_args"
check "after every refusal: nothing changed (rows and row versions)" \
  "select public.t_fingerprint() = '$FP_A' and public.t_xmins() = '$X_A'"

# ════════════════════════════════════════════════════════════════════════════
echo "E · a fresh PROD-like database, 0147 cut short"
reset_db
apply_file "$SCHEMA" || bad "0146 applies ($(cat "$ERR"))"
SEED_E=$(q -c "select public.t_fingerprint()"); SEEDX_E=$(q -c "select public.t_xmins()")
read -r -a REG_PARTS <<<"${PARTS_OF[regulamin]}"
for p in "${REG_PARTS[@]:0:2}"; do apply_file "$p" || bad "part piece applies ($(cat "$ERR"))"; done
if apply_file "${IMPORT_OF[regulamin]}"; then bad "the import with 2 of ${#REG_PARTS[@]} parts is refused"
elif grep -q "legal_import_mismatch.*2 of ${#REG_PARTS[@]} parts" "$ERR"; then ok "the import with 2 of ${#REG_PARTS[@]} parts is refused (legal_import_mismatch)"
else bad "the import with 2 of ${#REG_PARTS[@]} parts is refused ($(cat "$ERR"))"; fi
check "the site is exactly as before (rows and row versions)" "select public.t_fingerprint() = '$SEED_E' and public.t_xmins() = '$SEEDX_E'"
for s in "${SLUGS[@]}"; do
  read -r -a ps <<<"${PARTS_OF[$s]}"
  for p in "${ps[@]}"; do apply_file "$p" || bad "part piece applies ($(cat "$ERR"))"; done
done
check "every part loaded, no import run: the site is exactly as before" \
  "select public.t_fingerprint() = '$SEED_E' and public.t_xmins() = '$SEEDX_E' and (select count(*) = 9 from public.legal_document_sources)"
q -c "update public.legal_document_sources set body = overlay(body placing '#' from 300 for 1) where doc_key = 'regulamin' and part = 4" >/dev/null
if apply_file "${IMPORT_OF[regulamin]}"; then bad "the import over a damaged part is refused"
elif grep -q "legal_import_mismatch" "$ERR"; then ok "the import over a damaged part is refused (legal_import_mismatch)"
else bad "the import over a damaged part is refused ($(cat "$ERR"))"; fi
check "the site is still exactly as before" "select public.t_fingerprint() = '$SEED_E' and public.t_xmins() = '$SEEDX_E'"
if apply_file "$DATA" "$WORK/e.out"; then ok "the whole of 0147 then applies"; else bad "the whole of 0147 then applies ($(cat "$ERR"))"; fi
if [ "$(grep -c '"status": "imported"' "$WORK/e.out")" = "4" ]; then ok "… four imports"; else bad "… four imports ($(cat "$WORK/e.out"))"; fi
texts_match_files

# ════════════════════════════════════════════════════════════════════════════
echo "F · later admin work"
# The admin shows the old text section again and publishes (Strony WWW).
q -c "update public.cms_blocks b set visible = true, updated_at = now() from public.cms_pages p
      where p.id = b.page_id and p.slug = 'regulamin' and b.type = 'text';
      update public.cms_pages set published_snapshot = public.t_snapshot(id), published_at = now() where slug = 'regulamin';
      insert into public.cms_page_versions (page_id, version, snapshot, seo, reason)
        select id, 5, published_snapshot, seo, 'publish' from public.cms_pages where slug = 'regulamin';" >/dev/null
FP_F=$(q -c "select public.t_fingerprint()")
if apply_file "$DATA" "$WORK/f.out" && [ "$(grep -c '"status": "unchanged"' "$WORK/f.out")" = "4" ]; then
  ok "0147 again: 'unchanged' everywhere"; else bad "0147 again: 'unchanged' ($(cat "$ERR" "$WORK/f.out"))"; fi
check "the section the admin showed again stays visible, nothing rewritten" \
  "select public.t_fingerprint() = '$FP_F' and (select bool_and(b.visible) from public.cms_blocks b join public.cms_pages p on p.id = b.page_id where p.slug = 'regulamin')"
# An English text goes live on the cookies page, then a Polish 1.1 is imported.
COOKIES_DOC=$(doc_block polityka-cookies)
q -c "update public.cms_blocks set content = jsonb_set(content, '{doc,en}',
        '{\"status\":\"active\",\"text\":\"Cookie policy (EN)\\n\",\"version\":\"1.0\",\"effective\":\"2026-10-20\"}'::jsonb)
      where id = ($COOKIES_DOC).id;
      update public.cms_pages set published_snapshot = public.t_snapshot(id) where slug = 'polityka-cookies';
      insert into public.legal_document_sources (doc_key, locale, doc_version, part, body)
        select 'polityka-cookies', 'pl', '1.1', 1, replace(($COOKIES_DOC).content->'doc'->'pl'->>'text', 'Wersja: 1.0', 'Wersja: 1.1');" >/dev/null
NEXT="(select body from public.legal_document_sources where doc_key = 'polityka-cookies' and doc_version = '1.1')"
OUT=$(q -c "select public.legal_document_import('polityka-cookies', 'pl', '1.1', date '2026-11-01', 'Polityka cookies', 1,
              (select char_length(body) from public.legal_document_sources where doc_key = 'polityka-cookies' and doc_version = '1.1'),
              (select $(sha_sql body) from public.legal_document_sources where doc_key = 'polityka-cookies' and doc_version = '1.1'))->>'status'" 2>&1)
if [ "$OUT" = "imported" ]; then ok "a Polish 1.1 imports"; else bad "a Polish 1.1 imports ($OUT)"; fi
check "pl is 1.1, in force from 2026-11-01, the new text (draft and published)" \
  "select ($COOKIES_DOC).content->'doc'->'pl'->>'version' = '1.1' and ($COOKIES_DOC).content->'doc'->'pl'->>'effective' = '2026-11-01'
      and ($COOKIES_DOC).content->'doc'->'pl'->>'text' = $NEXT
      and ($(pub_doc polityka-cookies))->'content'->'doc'->'pl'->>'text' = $NEXT"
check "en (active, written by the admin) kept as it was; de still soon" \
  "select ($COOKIES_DOC).content->'doc'->'en' = '{\"status\":\"active\",\"text\":\"Cookie policy (EN)\\n\",\"version\":\"1.0\",\"effective\":\"2026-10-20\"}'::jsonb
      and ($COOKIES_DOC).content->'doc'->'de' = '$SOON'::jsonb"
check "the 1.0 text lives on in 'Przed importem: Polityka cookies v1.1 (pl)', then 'Import: … v1.1'" \
  "select array_agg(v.reason || ':' || coalesce(v.label, '-') order by v.version) =
          array['publish:Import: Polityka cookies v1.0 (pl) sha256 ${SHA[polityka-cookies]:0:12}',
                'manual:Przed importem: Polityka cookies v1.1 (pl)',
                'publish:Import: Polityka cookies v1.1 (pl) sha256 ' || left((select $(sha_sql body) from public.legal_document_sources where doc_key = 'polityka-cookies' and doc_version = '1.1'), 12)]
      and $(sha_sql "(array_agg(v.snapshot order by v.version))[2]->0->'content'->'doc'->'pl'->>'text'") = '${SHA[polityka-cookies]}'
   from public.cms_page_versions v join public.cms_pages p on p.id = v.page_id where p.slug = 'polityka-cookies'"

# ════════════════════════════════════════════════════════════════════════════
echo "R · the same import again after admin work: once only, nothing undone"
ADMIN_ID=00000000-0000-4000-8000-00000000a001
PRIV_DOC=$(doc_block polityka-prywatnosci)
# The admin corrects the Polish privacy text (the save writes sha256/chars)
# and publishes, then starts an English text in the draft without publishing.
q >/dev/null <<SQL
with x as (select ($PRIV_DOC).id as id, (($PRIV_DOC).content->'doc'->'pl'->>'text') || E'§ 99. Poprawka administratora.\n' as txt)
update public.cms_blocks b
   set content = jsonb_set(b.content, '{doc,pl}', (b.content->'doc'->'pl') || jsonb_build_object(
         'text', x.txt, 'sha256', $(sha_sql x.txt), 'chars', char_length(x.txt))),
       updated_at = now(), updated_by = '$ADMIN_ID'
  from x where b.id = x.id;
update public.cms_pages set published_snapshot = public.t_snapshot(id), published_at = now(), updated_at = now()
  where slug = 'polityka-prywatnosci';
insert into public.cms_page_versions (page_id, version, snapshot, seo, reason, created_by)
  select p.id, (select max(v.version) + 1 from public.cms_page_versions v where v.page_id = p.id), p.published_snapshot, p.seo, 'publish', '$ADMIN_ID'
  from public.cms_pages p where p.slug = 'polityka-prywatnosci';
update public.cms_blocks b set content = jsonb_set(b.content, '{doc,en}',
         '{"status":"active","text":"Privacy policy (EN draft)\n","version":"1.0","effective":null}'::jsonb), updated_at = now()
  where b.id = ($PRIV_DOC).id;
SQL
ADMIN_SHA=$(q -c "select $(sha_sql "($PRIV_DOC).content->'doc'->'pl'->>'text'")")
check "(the admin's text: the file plus one line, published, stored digests match)" \
  "select ($PRIV_DOC).content->'doc'->'pl'->>'sha256' = '$ADMIN_SHA' and '$ADMIN_SHA' <> '${SHA[polityka-prywatnosci]}'
      and $(sha_sql "($(pub_doc polityka-prywatnosci))->'content'->'doc'->'pl'->>'text'") = '$ADMIN_SHA'"
FP_R=$(q -c "select public.t_fingerprint()"); X_R=$(q -c "select public.t_xmins()"); SX_R=$(q -c "select $SRC_XMINS")
NV_R=$(q -c "select $LEGAL_VERSIONS")
PRIV_IMPORT_V=$(q -c "select v.version from public.cms_page_versions v join public.cms_pages p on p.id = v.page_id
                      where p.slug = 'polityka-prywatnosci' and v.label = 'Import: Polityka prywatności v$VERSION (pl) sha256 ${SHA[polityka-prywatnosci]:0:12}'")
if apply_file "${IMPORT_OF[polityka-prywatnosci]}" "$WORK/r1.out"; then ok "the privacy import piece applies again"
else bad "the privacy import piece applies again ($(cat "$ERR"))"; fi
if [ "$(statuses "$WORK/r1.out")" = "already_imported" ] && grep -q "\"import_version\": $PRIV_IMPORT_V" "$WORK/r1.out"; then
  ok "… returns 'already_imported', naming the import's version ($PRIV_IMPORT_V)"
else bad "… returns 'already_imported' ($(cat "$WORK/r1.out"))"; fi
check "… writes nothing at all: rows, row versions, parts" \
  "select public.t_fingerprint() = '$FP_R' and public.t_xmins() = '$X_R' and $SRC_XMINS = '$SX_R'"
check "… no new version row" "select $LEGAL_VERSIONS = $NV_R"
check "… the admin's corrected text is still drafted AND published" \
  "select $(sha_sql "($PRIV_DOC).content->'doc'->'pl'->>'text'") = '$ADMIN_SHA'
      and $(sha_sql "($(pub_doc polityka-prywatnosci))->'content'->'doc'->'pl'->>'text'") = '$ADMIN_SHA'"
check "… the unpublished English draft stays a draft (published en still 'soon')" \
  "select ($PRIV_DOC).content->'doc'->'en'->>'text' = E'Privacy policy (EN draft)\n'
      and ($(pub_doc polityka-prywatnosci))->'content'->'doc'->'en' = '$SOON'::jsonb"
echo " · the whole of 0147 again"
if apply_file "$DATA" "$WORK/r2.out"; then ok "0147 applies again as one file"; else bad "0147 applies again as one file ($(cat "$ERR"))"; fi
R2=$(statuses "$WORK/r2.out")
if [ "$R2" = "unchanged already_imported already_imported unchanged" ]; then
  ok "statuses: regulamin unchanged, privacy already_imported, cookies already_imported (1.1 is live), DPA unchanged"
else bad "statuses ($R2)"; fi
check "… nothing written; the admin's privacy text and the cookies 1.1 stay published" \
  "select public.t_xmins() = '$X_R' and $SRC_XMINS = '$SX_R'
      and $(sha_sql "($(pub_doc polityka-prywatnosci))->'content'->'doc'->'pl'->>'text'") = '$ADMIN_SHA'
      and ($(pub_doc polityka-cookies))->'content'->'doc'->'pl'->>'version' = '1.1'
      and ($(doc_block polityka-cookies)).content->'doc'->'pl'->>'version' = '1.1'"
echo " · an unpublished page is not published again"
q -c "update public.cms_pages set status = 'draft', updated_at = now() where slug = 'umowa-powierzenia-danych'" >/dev/null
X_R3=$(q -c "select public.t_xmins()")
if apply_file "${IMPORT_OF[umowa-powierzenia-danych]}" "$WORK/r3.out" && [ "$(statuses "$WORK/r3.out")" = "already_imported" ]; then
  ok "the DPA import piece on the unpublished page: 'already_imported'"
else bad "the DPA import piece on the unpublished page ($(cat "$ERR" "$WORK/r3.out"))"; fi
check "… the page stays a draft, nothing written" \
  "select public.t_xmins() = '$X_R3' and (select status from public.cms_pages where slug = 'umowa-powierzenia-danych') = 'draft'"
echo " · a new version over the admin's text is refused; p_force overrides"
q -c "insert into public.legal_document_sources (doc_key, locale, doc_version, part, body)
      select 'polityka-prywatnosci', 'pl', '1.1', 1, replace(string_agg(body, '' order by part), 'Wersja: 1.0', 'Wersja: 1.1')
      from public.legal_document_sources where doc_key = 'polityka-prywatnosci' and doc_version = '$VERSION'" >/dev/null
PRIV_NEXT="(select body from public.legal_document_sources where doc_key = 'polityka-prywatnosci' and doc_version = '1.1')"
PRIV_11() { # extra argument
  echo "select public.legal_document_import('polityka-prywatnosci', 'pl', '1.1', date '2026-11-01', 'Polityka prywatności', 1,
          (select char_length(body) from public.legal_document_sources where doc_key = 'polityka-prywatnosci' and doc_version = '1.1'),
          (select $(sha_sql body) from public.legal_document_sources where doc_key = 'polityka-prywatnosci' and doc_version = '1.1')$1)->>'status'"
}
X_R4=$(q -c "select public.t_xmins()")
expect_raise "a Polish 1.1 over the admin's corrected text → legal_import_conflict" "$(PRIV_11 "")" \
  "legal_import_conflict: polityka-prywatnosci (pl).*sha256 ${ADMIN_SHA:0:12}"
check "… nothing written" "select public.t_xmins() = '$X_R4'"
OUT=$(q -c "$(PRIV_11 ", p_force => true")" 2>&1) || true
if [ "$OUT" = "imported" ]; then ok "with p_force => true it imports"; else bad "with p_force => true it imports ($OUT)"; fi
check "… 1.1 drafted and published; the admin's text kept in 'Przed importem: Polityka prywatności v1.1 (pl)'" \
  "select ($PRIV_DOC).content->'doc'->'pl'->>'text' = $PRIV_NEXT
      and ($(pub_doc polityka-prywatnosci))->'content'->'doc'->'pl'->>'text' = $PRIV_NEXT
      and exists (select 1 from jsonb_array_elements((v).snapshot) e
                  where e->>'type' = 'legal' and $(sha_sql "e->'content'->'doc'->'pl'->>'text'") = '$ADMIN_SHA')
   from (select v from public.cms_page_versions v join public.cms_pages p on p.id = v.page_id
         where p.slug = 'polityka-prywatnosci' and v.reason = 'manual' and v.label = 'Przed importem: Polityka prywatności v1.1 (pl)') x"
OUT=$(q -c "select public.legal_document_import('umowa-powierzenia-danych', 'pl', '$VERSION', date '$EFFECTIVE', 'Umowa powierzenia danych',
              $(nparts umowa-powierzenia-danych), ${CHARS[umowa-powierzenia-danych]}, '${SHA[umowa-powierzenia-danych]}', p_force => true)->>'status'" 2>&1) || true
if [ "$OUT" = "imported" ]; then ok "p_force also re-runs an import already on record (the unpublished DPA: imported)"
else bad "p_force re-runs an import already on record ($OUT)"; fi
check "… the DPA page is published again with the file's text" \
  "select (select status from public.cms_pages where slug = 'umowa-powierzenia-danych') = 'published'
      and $(sha_sql "($(pub_doc umowa-powierzenia-danych))->'content'->'doc'->'pl'->>'text'") = '${SHA[umowa-powierzenia-danych]}'"
X_R5=$(q -c "select public.t_xmins()"); FP_R5=$(q -c "select public.t_fingerprint()")
if apply_file "$DATA" "$WORK/r5.out" && [ "$(statuses "$WORK/r5.out")" = "unchanged already_imported already_imported unchanged" ]; then
  ok "0147 once more: unchanged / already_imported / already_imported / unchanged"
else bad "0147 once more ($(cat "$ERR"; statuses "$WORK/r5.out"))"; fi
check "… and writes nothing (the privacy 1.1 stays)" \
  "select public.t_xmins() = '$X_R5' and public.t_fingerprint() = '$FP_R5'
      and ($(pub_doc polityka-prywatnosci))->'content'->'doc'->'pl'->>'version' = '1.1'"

# ════════════════════════════════════════════════════════════════════════════
echo "K · a Polish text an admin wrote, no import on record"
reset_db
# polityka-prywatnosci: the seed's legal section made a document by an admin,
# Polish active, in the draft only (the page is a draft).
# regulamin: a legal section with an admin's Polish text, published (with its
# version row); afterwards the draft's Polish is set back to "soon", unpublished.
q >/dev/null <<SQL
update public.cms_blocks b set content = jsonb_build_object('doc', jsonb_build_object(
         'pl', '{"status":"active","text":"Polityka prywatności (tekst administratora)\n","version":"0.9","effective":null}'::jsonb,
         'en', '$SOON'::jsonb, 'de', '$SOON'::jsonb))
  from public.cms_pages p where p.id = b.page_id and p.slug = 'polityka-prywatnosci' and b.type = 'legal';
insert into public.cms_blocks (page_id, type, sort_order, content)
  select id, 'legal', 1, jsonb_build_object('doc', jsonb_build_object(
           'pl', '{"status":"active","text":"Regulamin (tekst administratora)\n","version":"0.9","effective":null}'::jsonb,
           'en', '$SOON'::jsonb, 'de', '$SOON'::jsonb))
  from public.cms_pages where slug = 'regulamin';
update public.cms_pages p set published_snapshot = public.t_snapshot(p.id), published_at = now() where p.slug = 'regulamin';
insert into public.cms_page_versions (page_id, version, snapshot, seo, reason, created_by)
  select id, 3, published_snapshot, seo, 'publish', '$ADMIN_ID' from public.cms_pages where slug = 'regulamin';
update public.cms_blocks b set content = jsonb_set(b.content, '{doc,pl,status}', '"soon"')
  from public.cms_pages p where p.id = b.page_id and p.slug = 'regulamin' and b.type = 'legal';
SQL
apply_file "$SCHEMA" || bad "0146 applies ($(cat "$ERR"))"
SEED_K=$(q -c "select public.t_fingerprint()"); SEEDX_K=$(q -c "select public.t_xmins()")
if apply_file "$DATA"; then bad "0147 as one file is refused"
elif grep -q "legal_import_conflict: regulamin (pl)" "$ERR"; then ok "0147 as one file is refused at the Regulamin import (legal_import_conflict)"
else bad "0147 as one file is refused ($(cat "$ERR"))"; fi
check "… nothing changed, not even a part stored" \
  "select public.t_fingerprint() = '$SEED_K' and public.t_xmins() = '$SEEDX_K' and (select count(*) = 0 from public.legal_document_sources)"
KFP=$(q -c "select public.t_fingerprint(array['regulamin', 'polityka-prywatnosci'])")
for p in "${PIECES[@]}"; do
  read -r slug kind < <(piece_kind "$p")
  if [ "$kind" = "part" ]; then apply_file "$p" || bad "part piece applies ($(cat "$ERR"))"; continue; fi
  if apply_file "$p" "$WORK/k.out"; then echo "$slug $(statuses "$WORK/k.out")" >>"$WORK/k.status"
  elif grep -q "legal_import_conflict: $slug (pl)" "$ERR"; then echo "$slug conflict" >>"$WORK/k.status"
  else echo "$slug error: $(cat "$ERR")" >>"$WORK/k.status"; fi
done
KS=$(paste -sd' ' "$WORK/k.status")
if [ "$KS" = "regulamin conflict polityka-prywatnosci conflict polityka-cookies imported umowa-powierzenia-danych imported" ]; then
  ok "piece by piece: Regulamin (admin text published) and privacy (admin text in the draft) refused; cookies and DPA imported"
else bad "piece by piece ($KS)"; fi
check "… the two refused pages are exactly as before" "select public.t_fingerprint(array['regulamin', 'polityka-prywatnosci']) = '$KFP'"
for s in regulamin polityka-prywatnosci; do
  OUT=$(q -c "$(import_sql "$s" | sed -E "s/'\);\$/', p_force => true)->>'status';/")" 2>&1) || true
  if [ "$OUT" = "imported" ]; then ok "$s: the same call with p_force => true imports"; else bad "$s: p_force => true imports ($OUT)"; fi
done
texts_match_files
check "the admin's texts live on in the versions (privacy: 'Przed importem'; Regulamin: its publish and 'Przed importem')" \
  "select exists (select 1 from public.cms_page_versions v join public.cms_pages p on p.id = v.page_id
                  where p.slug = 'polityka-prywatnosci' and v.label = 'Przed importem: Polityka prywatności v$VERSION (pl)'
                    and v.snapshot @> '[{\"content\":{\"doc\":{\"pl\":{\"status\":\"active\",\"text\":\"Polityka prywatności (tekst administratora)\\n\"}}}}]'::jsonb)
      and exists (select 1 from public.cms_page_versions v join public.cms_pages p on p.id = v.page_id
                  where p.slug = 'regulamin' and v.version = 3
                    and v.snapshot @> '[{\"content\":{\"doc\":{\"pl\":{\"status\":\"active\",\"text\":\"Regulamin (tekst administratora)\\n\"}}}}]'::jsonb)
      and exists (select 1 from public.cms_page_versions v join public.cms_pages p on p.id = v.page_id
                  where p.slug = 'regulamin' and v.label = 'Przed importem: Regulamin v$VERSION (pl)'
                    and v.snapshot @> '[{\"content\":{\"doc\":{\"pl\":{\"text\":\"Regulamin (tekst administratora)\\n\"}}}}]'::jsonb)"
X_K=$(q -c "select public.t_xmins()")
if apply_file "$DATA" "$WORK/k2.out" && [ "$(statuses "$WORK/k2.out")" = "unchanged unchanged unchanged unchanged" ]; then
  ok "0147 afterwards: 'unchanged' four times, nothing written"
else bad "0147 afterwards ($(cat "$ERR"; statuses "$WORK/k2.out"))"; fi
check "… row versions unchanged" "select public.t_xmins() = '$X_K'"

# ════════════════════════════════════════════════════════════════════════════
echo "G · an existing page that already has a doc section"
reset_db
q >/dev/null <<'SQL'
insert into public.cms_pages (slug, title, status, kind, nav_group, nav_order, seo)
values ('polityka-cookies', 'Cookies (archiwum)', 'archived', 'standard', null, 77, '{"pl":{"title":"Stare cookies"}}');
insert into public.cms_blocks (page_id, type, sort_order, visible, content, style, anchor, show_until, audience)
select id, v.type, v.sort_order, v.visible, v.content::jsonb, '{}'::jsonb, v.anchor, v.show_until, v.audience
from public.cms_pages, (values
  ('legal', 0, true, '{"html":{"pl":"<h2>Stara treść</h2>"}}', null, null::timestamptz, 'everyone'),
  ('hero', 1, true, '{"title":{"pl":"Cookies"}}', null, null::timestamptz, 'everyone'),
  ('legal', 5, false, '{"doc":{"en":{"status":"active","text":"Cookie policy (EN)\n","version":"0.9","effective":null},"pl":{"status":"soon","text":"","version":"","effective":null}}}',
   'cookies', now() - interval '1 day', 'anon')
) as v(type, sort_order, visible, content, anchor, show_until, audience)
where slug = 'polityka-cookies';
SQL
DOC_G=$(q -c "select b.id from public.cms_blocks b join public.cms_pages p on p.id = b.page_id where p.slug = 'polityka-cookies' and b.sort_order = 5")
apply_file "$SCHEMA" || bad "0146 applies ($(cat "$ERR"))"
if apply_file "$DATA" "$WORK/g.out"; then ok "0146 + 0147 apply"; else bad "0146 + 0147 apply ($(cat "$ERR"))"; fi
check "the legal section that already had a doc is the target (not the first legal one)" \
  "select ($(doc_block polityka-cookies)).id = '$DOC_G'"
check "… shown, for everyone, always; its anchor kept" \
  "select b.visible and b.show_until is null and b.show_from is null and b.audience = 'everyone' and b.anchor = 'cookies'
   from public.cms_blocks b where b.id = '$DOC_G'"
check "… its English text kept, Polish imported, German soon" \
  "select b.content->'doc'->'en' = '{\"status\":\"active\",\"text\":\"Cookie policy (EN)\\n\",\"version\":\"0.9\",\"effective\":null}'::jsonb
      and $(sha_sql "b.content->'doc'->'pl'->>'text'") = '${SHA[polityka-cookies]}' and b.content->'doc'->'de' = '$SOON'::jsonb
   from public.cms_blocks b where b.id = '$DOC_G'"
check "the other two sections hidden, not removed" \
  "select count(*) = 3 and count(*) filter (where not b.visible) = 2
   from public.cms_blocks b join public.cms_pages p on p.id = b.page_id where p.slug = 'polityka-cookies'"
check "the archived page is published, keeps its title, menu place (none, 77) and SEO" \
  "select status = 'published' and title = 'Cookies (archiwum)' and nav_group is null and nav_order = 77
      and seo = '{\"pl\":{\"title\":\"Stare cookies\"}}'::jsonb
   from public.cms_pages where slug = 'polityka-cookies'"
check "the pre-import version holds the three sections as they were" \
  "select v.reason = 'manual' and jsonb_array_length(v.snapshot) = 3 and v.snapshot->2->>'id' = '$DOC_G' and v.snapshot->2->>'audience' = 'anon'
   from public.cms_page_versions v join public.cms_pages p on p.id = v.page_id where p.slug = 'polityka-cookies' and v.version = 1"
texts_match_files
q -c "insert into public.cms_pages (slug, title, status, kind) values ('test-launch', 'L', 'draft', 'launch');
      insert into public.legal_document_sources (doc_key, locale, doc_version, part, body) values ('test-launch', 'pl', '1.0', 1, E'x\n');" >/dev/null
FP_G=$(q -c "select public.t_fingerprint()")
expect_raise "a page that is not a standard CMS page is refused (legal_import_page_kind)" \
  "select public.legal_document_import('test-launch', 'pl', '1.0', null, 'L', 1, 2, $(sha_sql "E'x\\n'"))" "legal_import_page_kind"
check "… and nothing changed" "select public.t_fingerprint() = '$FP_G'"

# ════════════════════════════════════════════════════════════════════════════
echo "P · privileges"
ADMIN=00000000-0000-4000-8000-00000000a001
CUSTOMER=00000000-0000-4000-8000-00000000c001
CALL="select public.legal_document_import('regulamin', 'pl', '$VERSION', date '$EFFECTIVE', 'Regulamin', $NREG, ${CHARS[regulamin]}, '${SHA[regulamin]}')"
FN="function legal_document_import"; TB="table legal_document_sources"
role_denied "anon cannot read the parts" anon "" "select count(*) from public.legal_document_sources" "$TB"
role_denied "anon cannot execute the import" anon "" "$CALL" "$FN"
role_denied "anon cannot write a part" anon "" "insert into public.legal_document_sources (doc_key, locale, doc_version, part, body) values ('x', 'pl', '1', 1, 'x')" "$TB"
role_value "a customer reads no part (RLS)" authenticated "$CUSTOMER" "select count(*) from public.legal_document_sources" "0"
role_denied "a customer cannot execute the import" authenticated "$CUSTOMER" "$CALL" "$FN"
role_denied "a customer cannot execute a forced import" authenticated "$CUSTOMER" "${CALL%)}, p_force => true)" "$FN"
role_value "an admin reads the parts" authenticated "$ADMIN" "select count(*) > 0 from public.legal_document_sources" "t"
role_denied "an admin cannot execute the import either (migrations only)" authenticated "$ADMIN" "$CALL" "$FN"
role_denied "an admin cannot write a part" authenticated "$ADMIN" "update public.legal_document_sources set body = 'x'" "$TB"
check "catalog: EXECUTE for nobody but the owner; SELECT only for authenticated; INVOKER; search_path set" \
  "select not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('authenticated', p.oid, 'execute')
      and p.proacl is not null and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
      and not p.prosecdef and p.proconfig @> array['search_path=public, extensions']
      and not has_table_privilege('anon', 'public.legal_document_sources', 'select')
      and has_table_privilege('authenticated', 'public.legal_document_sources', 'select')
      and not has_table_privilege('authenticated', 'public.legal_document_sources', 'insert')
      and not has_table_privilege('authenticated', 'public.legal_document_sources', 'update')
   from pg_proc p where p.proname = 'legal_document_import'"

# ════════════════════════════════════════════════════════════════════════════
echo "H · the files"
if (cd "$ROOT" && node scripts/gen-legal-migration.mjs --check >/dev/null 2>&1); then ok "0147 matches its generator (--check)"
else bad "0147 is stale — run node scripts/gen-legal-migration.mjs"; fi
for f in "$SCHEMA" "$DATA"; do
  if grep -qiE 'drop|delete' "$f"; then bad "$(basename "$f") contains drop/delete"; else ok "no drop/delete in $(basename "$f")"; fi
done
big=0
for p in "$WORK/head.sql" "${PIECES[@]}"; do [ "$(wc -c <"$p")" -lt 20000 ] || big=1; done
if [ "$big" = 0 ]; then ok "the header and each of the ${#PIECES[@]} pieces are under 20 000 bytes"; else bad "a piece is 20 000 bytes or more"; fi
if [ "$(wc -c <"$SCHEMA")" -lt 20000 ]; then ok "0146 (applied as one piece) is under 20 000 bytes"; else bad "0146 is $(wc -c <"$SCHEMA") bytes"; fi
if cmp -s <(cat "$WORK/head.sql" "${PIECES[@]}") "$DATA"; then ok "the header and the pieces add up to the file"; else bad "the pieces do not add up to the file"; fi
order_ok=1
for s in "${SLUGS[@]}"; do
  read -r -a ps <<<"${PARTS_OF[$s]}"
  [ "${#ps[@]}" -ge 1 ] && [ -n "${IMPORT_OF[$s]:-}" ] || { order_ok=0; continue; }
  for p in "${ps[@]}"; do [[ "$(basename "$p")" < "$(basename "${IMPORT_OF[$s]}")" ]] || order_ok=0; done
done
if [ "$order_ok" = 1 ]; then ok "every document has its parts, then its import"; else bad "parts / import order"; fi
# The order warning, written out here (not taken from the generator). Each
# piece is applied on its own, so each one carries it right after its marker.
WARN="APPLY ONLY AFTER the Legal documents V1 code is READY on PROD — the previous renderer shows a doc-only legal section as an empty page. Rolling the code back after 0147 requires restoring the pre-import versions ('Przed importem: …') of the four pages."
comment_text() { # file, lines to skip → the comment lines that follow, "-- " stripped, joined by spaces
  awk -v skip="$2" 'NR <= skip { next } /^--( |$)/ { sub(/^-- ?/, ""); printf "%s%s", sep, $0; sep = " "; next } { exit }' "$1"
}
warned=0; unwarned=""
for p in "${PIECES[@]}"; do
  if [[ "$(comment_text "$p" 1)" == *"$WARN"* ]]; then warned=$((warned + 1)); else unwarned="$unwarned $(basename "$p")"; fi
done
if [ "$warned" -eq "${#PIECES[@]}" ]; then ok "every one of the ${#PIECES[@]} pieces carries the order warning right after its [n/N] line"
else bad "pieces without the order warning:$unwarned"; fi
if [[ "$(comment_text "$WORK/head.sql" 0)" == *"$WARN"* ]]; then ok "0147's header carries the order warning"; else bad "0147's header lacks the order warning"; fi
if [[ "$(comment_text "$SCHEMA" 0)" == *"$WARN"* ]]; then ok "0146's header carries the order warning"; else bad "0146's header lacks the order warning"; fi

echo
echo "legal-sql: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
