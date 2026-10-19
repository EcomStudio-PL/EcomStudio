#!/usr/bin/env bash
#
# 0145 (THE LAUNCH PAGE'S V2 COPY), PROVEN AGAINST A REAL POSTGRES.
#
# 0145 rewrites the stored copy of "/" — the launch block's draft and the
# published snapshot — but only where a value is absent or still the old
# shipped default. These checks run the GENERATED file verbatim on the
# cms_pages / cms_blocks / cms_page_versions shapes it lands on:
#
#   A  a page exactly like PROD today (every value the efec08f default, draft
#      equal to the published snapshot): every key becomes the V2 default,
#      draft and snapshot stay equal, one history row holds the old snapshot;
#   B  a second run changes nothing and writes no second history row;
#   C  admin-written values (per language) are left alone, a default with
#      different whitespace / CRLF still counts as the default;
#   D  unknown keys, other block properties and other blocks are preserved;
#   E  a draft that diverged from the snapshot: each side transformed on its
#      own (the draft's custom words survive);
#   F  a never-published page: the draft is updated, no history row;
#   G  no launch page at all: nothing happens, no error;
#   H  the file is current (generator --check) and has no drop/delete.
#
# Local harness only, its own database (prelaunch_copytest), removed on exit.
#
#   bash scripts/pg-harness-up.sh && bash scripts/prelaunch-copy-sql-tests.sh
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
PGCONN=(-h "$PGSOCK" -p "$PGPORT" -U postgres)
DB=prelaunch_copytest

if ! psql "${PGCONN[@]}" -d postgres -X -q -t -A -c 'select 1' >/dev/null 2>&1; then
  echo "prelaunch-copy-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATION="$ROOT/supabase/migrations/0145_prelaunch_copy.sql"
[ -f "$MIGRATION" ] || { echo "prelaunch-copy-sql: $MIGRATION not found" >&2; exit 2; }

PASS=0; FAIL=0
ok() { PASS=$((PASS + 1)); echo "  ok  $1"; }
bad() { FAIL=$((FAIL + 1)); echo "  FAIL $1" >&2; }
q() { psql "${PGCONN[@]}" -d "$DB" -X -q -t -A -v ON_ERROR_STOP=1 -c "$1"; }
check() { # name, sql returning t/f
  local got; got=$(q "$2" 2>&1) || { bad "$1 (error: $got)"; return; }
  if [ "$got" = "t" ]; then ok "$1"; else bad "$1 (got: $got)"; fi
}
apply() { psql "${PGCONN[@]}" -d "$DB" -X -q -v ON_ERROR_STOP=1 -f "$MIGRATION" >/dev/null 2>&1; }

cleanup() { psql "${PGCONN[@]}" -d postgres -X -q -c "drop database if exists $DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

# The map the migration carries, and the PROD-like fields built from its OLD
# values (what production holds today: every key the efec08f default).
MAP=$(node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8");process.stdout.write(s.match(/\$copy\$(.*)\$copy\$/s)[1])' "$MIGRATION")
OLD_FIELDS=$(node -e '
const m=JSON.parse(process.argv[1]); const f={};
for (const [k,v] of Object.entries(m)) for (const [l,p] of Object.entries(v)) if (p.old!==null) (f[k]??={})[l]=p.old;
process.stdout.write(JSON.stringify(f));' "$MAP")

reset_db() {
  cleanup
  psql "${PGCONN[@]}" -d postgres -X -q -c "create database $DB" >/dev/null
  q "
    create table public.cms_pages (
      id uuid primary key default gen_random_uuid(),
      slug text not null unique, title text not null default '',
      kind text not null default 'standard', is_homepage boolean not null default false,
      sort_order int not null default 0, seo jsonb not null default '{}'::jsonb,
      published_snapshot jsonb, updated_at timestamptz not null default now());
    create table public.cms_blocks (
      id uuid primary key default gen_random_uuid(),
      page_id uuid not null references public.cms_pages(id) on delete cascade,
      type text not null, sort_order int not null default 0,
      content jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now());
    create table public.cms_page_versions (
      id uuid primary key default gen_random_uuid(),
      page_id uuid not null references public.cms_pages(id) on delete cascade,
      version integer not null, snapshot jsonb not null default '[]'::jsonb,
      seo jsonb not null default '{}'::jsonb, reason text not null default 'publish', label text,
      created_at timestamptz not null default now(),
      constraint cms_page_versions_unique unique (page_id, version),
      constraint cms_page_versions_reason_check check (reason in ('publish', 'manual', 'rollback')));
    create table map(m jsonb); create table oldf(f jsonb);" >/dev/null
  q "insert into map values (\$m\$${MAP}\$m\$::jsonb); insert into oldf values (\$o\$${OLD_FIELDS}\$o\$::jsonb);" >/dev/null
}

# A page with a launch block (and a gallery block after it), published as is.
seed_page() { # slug, homepage, fields-sql-expr, publish (1/0)
  q "
    insert into public.cms_pages (slug, kind, is_homepage, seo)
      values ('$1', 'launch', $2, '{\"title\":{\"pl\":\"x\"}}');
    insert into public.cms_blocks (page_id, type, sort_order, content)
      select id, 'launch', 0, jsonb_build_object('fields', $3, 'style', '{\"pad\":\"lg\"}'::jsonb)
      from public.cms_pages where slug = '$1';
    insert into public.cms_blocks (page_id, type, sort_order, content)
      select id, 'launch_gallery', 10, '{\"gallery\":\"thumbs\",\"items\":[]}'::jsonb
      from public.cms_pages where slug = '$1';
    update public.cms_pages p set published_snapshot = (
      select jsonb_agg(jsonb_build_object('id', b.id, 'type', b.type, 'content', b.content) order by b.sort_order)
      from public.cms_blocks b where b.page_id = p.id)
    where p.slug = '$1' and $4 = 1;" >/dev/null
}

DRAFT="(select b.content from cms_blocks b join cms_pages p on p.id=b.page_id where p.slug='premiera' and b.type='launch')"
PUB="(select e->'content' from cms_pages p, jsonb_array_elements(p.published_snapshot) e where p.slug='premiera' and e->>'type'='launch')"
# Every key/language of the map: the side holds the NEW default.
ALL_NEW() { echo "(select bool_and(($1)->'fields'->k->>l = m.m->k->l->>'new') from map m, jsonb_object_keys(m.m) k, jsonb_object_keys(m.m->k) l)"; }

echo "A · production as it is today"
reset_db
seed_page premiera true "(select f from oldf)" 1
q "insert into public.cms_page_versions (page_id, version, snapshot, reason) select id, 1, published_snapshot, 'publish' from cms_pages" >/dev/null
SNAP_BEFORE=$(q "select md5(published_snapshot::text) from cms_pages where slug='premiera'")
if apply; then ok "0145 applies"; else bad "0145 applies"; fi
check "every key × language of the draft is the V2 default" "select $(ALL_NEW "$DRAFT")"
check "every key × language of the published copy is the V2 default" "select $(ALL_NEW "$PUB")"
check "draft still equals the published content (inline editor stays usable)" "select $DRAFT = $PUB"
check "hero.badge reads 'ZDJĘCIA AI DLA SPRZEDAWCÓW'" "select $PUB->'fields'->'hero.badge'->>'pl' = 'ZDJĘCIA AI DLA SPRZEDAWCÓW'"
check "seo.title is the brief's title" "select $PUB->'fields'->'seo.title'->>'pl' = 'GrovBase — Zdjęcia AI dla sprzedawców | Premiera wkrótce'"
check "no stored value is a video promise any more" "select not exists (select 1 from jsonb_each($PUB->'fields') f, jsonb_each_text(f.value) t where t.value ~* '(film|wideo|video)')"
check "new V2 keys exist as objects (every-key invariant)" "select bool_and(jsonb_typeof($PUB->'fields'->k) = 'object') from map m, jsonb_object_keys(m.m) k"
check "one history row, version 2, manual, labelled" "select count(*) = 1 and min(version) = 2 and min(reason) = 'manual' and min(label) like 'Landing V2%' from cms_page_versions where version > 1"
check "the history row holds the snapshot as it was" "select md5(snapshot::text) = '$SNAP_BEFORE' from cms_page_versions where version = 2"
check "the gallery block and block style are untouched" "select (select content->'style'->>'pad' from cms_blocks where type='launch') = 'lg' and (select content from cms_blocks where type='launch_gallery') = '{\"gallery\":\"thumbs\",\"items\":[]}'::jsonb and (select published_snapshot->1->'content' from cms_pages) = '{\"gallery\":\"thumbs\",\"items\":[]}'::jsonb"

echo "B · a second run"
DRAFT_A=$(q "select md5($DRAFT::text)"); PUB_A=$(q "select md5(published_snapshot::text) from cms_pages")
if apply; then ok "0145 applies again"; else bad "0145 applies again"; fi
check "draft unchanged" "select md5($DRAFT::text) = '$DRAFT_A'"
check "snapshot unchanged" "select md5(published_snapshot::text) = '$PUB_A' from cms_pages"
check "no second history row" "select count(*) = 2 from cms_page_versions"

echo "C · admin-written values"
reset_db
seed_page premiera true "(select jsonb_set(jsonb_set(jsonb_set(f, '{hero.badge,pl}', '\"MOJA ODZNAKA\"'), '{hero.sub,en}', to_jsonb(E'  Create AI photos and videos that sell.\r\nThe e-commerce revolution is coming.  '::text)), '{benefit.1}', '{\"pl\":\"\"}') from oldf)" 1
apply && ok "0145 applies" || bad "0145 applies"
check "an admin's Polish badge stays" "select $PUB->'fields'->'hero.badge'->>'pl' = 'MOJA ODZNAKA'"
check "the untouched English badge of the same key is replaced" "select $PUB->'fields'->'hero.badge'->>'en' = (select m->'hero.badge'->'en'->>'new' from map)"
check "the default with other whitespace / CRLF still counts as the default" "select $PUB->'fields'->'hero.sub'->>'en' = (select m->'hero.sub'->'en'->>'new' from map)"
check "an admin's deliberate empty value stays empty" "select $PUB->'fields'->'benefit.1'->>'pl' = ''"
check "a language absent from a key the admin edited is filled in" "select $PUB->'fields'->'benefit.1'->>'en' = (select m->'benefit.1'->'en'->>'new' from map)"

echo "D · unknown keys and other properties"
reset_db
seed_page premiera true "(select f || '{\"custom.key\":{\"pl\":\"zostaje\"},\"showCost\":{\"pl\":\"1\"}}'::jsonb from oldf)" 1
apply && ok "0145 applies" || bad "0145 applies"
check "a key outside the map stays" "select $PUB->'fields'->'custom.key'->>'pl' = 'zostaje' and $DRAFT->'fields'->'custom.key'->>'pl' = 'zostaje'"
check "an admin's section switch stays" "select $PUB->'fields'->'showCost'->>'pl' = '1'"

echo "E · a draft that diverged from the snapshot"
reset_db
seed_page premiera true "(select f from oldf)" 1
q "update cms_blocks set content = jsonb_set(content, '{fields,hero.h1,pl}', '\"Wersja robocza\"') where type='launch'" >/dev/null
apply && ok "0145 applies" || bad "0145 applies"
check "the draft's own words survive" "select $DRAFT->'fields'->'hero.h1'->>'pl' = 'Wersja robocza'"
check "the published side is transformed on its own" "select $(ALL_NEW "$PUB")"
check "the draft's other defaults are transformed too" "select $DRAFT->'fields'->'hero.badge'->>'pl' = 'ZDJĘCIA AI DLA SPRZEDAWCÓW'"

echo "F · a page never published"
reset_db
seed_page premiera true "(select f from oldf)" 0
apply && ok "0145 applies" || bad "0145 applies"
check "the draft is updated" "select $(ALL_NEW "$DRAFT")"
check "no snapshot invented" "select published_snapshot is null from cms_pages"
check "no history row" "select count(*) = 0 from cms_page_versions"

echo "G · no launch page"
reset_db
q "insert into cms_pages (slug, kind) values ('o-nas', 'standard')" >/dev/null
apply && ok "0145 applies without a launch page" || bad "0145 applies without a launch page"
check "nothing written" "select count(*) = 0 from cms_page_versions"

echo "G2 · the homepage launch page wins over another launch page"
reset_db
seed_page premiera false "(select f from oldf)" 1
seed_page start true "(select f from oldf)" 1
apply && ok "0145 applies" || bad "0145 applies"
check "the homepage's block is updated" "select (select b.content->'fields'->'hero.badge'->>'pl' from cms_blocks b join cms_pages p on p.id=b.page_id where p.slug='start' and b.type='launch') = 'ZDJĘCIA AI DLA SPRZEDAWCÓW'"
check "the other launch page is untouched" "select (select b.content->'fields'->'hero.badge'->>'pl' from cms_blocks b join cms_pages p on p.id=b.page_id where p.slug='premiera' and b.type='launch') = 'AI DLA E-COMMERCE'"

echo "H · the file itself"
if (cd "$ROOT" && node scripts/gen-prelaunch-copy.mjs --check >/dev/null 2>&1); then ok "the migration matches its generator (--check)"; else bad "the migration is stale — run node scripts/gen-prelaunch-copy.mjs"; fi
if grep -qiE 'drop|delete' "$MIGRATION"; then bad "the file contains drop/delete"; else ok "no drop/delete in the file"; fi

echo
echo "prelaunch-copy-sql: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
