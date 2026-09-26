#!/usr/bin/env bash
#
# GROVNEWS STAGE 5 — SOURCE HEALTH, BULK IMPORT, ONE DAILY ARTICLE, ONE DAILY
# MAIL, AND THE CMS `blog` SLUG, PROVEN ON A REAL POSTGRES.
#
# Migrations 0119, 0120, 0121 and 0125 are loaded VERBATIM next to the helpers
# they depend on, cut out of the migrations that ship them (is_admin and
# touch_updated_at from 0002, server_call_ok from 0077, account_blocked from
# 0072) and the smallest possible newsletter tables. A pass here is the SQL
# itself — the functions the daily job and the admin screens call — not a
# TypeScript retelling of it.
#
# Local harness only (DEV does not carry this schema; PROD gets a rolled-back
# dry run instead):
#
#   bash scripts/pg-harness-up.sh && npm run test:grovnews5:sql
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
DB=grovnews5
PSQL0=(psql -h "$PGSOCK" -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -X -q -t -A)
PSQL=("${PSQL0[@]}" -d "$DB")

if ! "${PSQL0[@]}" -d postgres -c 'select 1' >/dev/null 2>&1; then
  echo "grovnews5-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
M=$ROOT/supabase/migrations
MIGRATION="${MIGRATION:-$M/0125_grovnews_sources_daily.sql}"
for f in "$MIGRATION" "$M/0002_functions_and_triggers.sql" "$M/0072_temporary_account_block.sql" \
         "$M/0077_server_only_rpcs.sql" "$M/0085_cms_page_builder.sql" "$M/0119_grovnews.sql" \
         "$M/0120_grovnews_hardening.sql" "$M/0121_grovnews_research.sql"; do
  [ -f "$f" ] || { echo "grovnews5-sql: $f not found" >&2; exit 2; }
done

extract() { # file, function name, end marker regex
  awk -v start="^create (or replace )?function public[.]$2[(]" -v stop="$3" \
    '$0 ~ start {on=1} on {print} on && $0 ~ stop {exit}' "$1"
}
IS_ADMIN=$(extract "$M/0002_functions_and_triggers.sql" is_admin '^[$][$];')
TOUCH=$(extract "$M/0002_functions_and_triggers.sql" touch_updated_at '^[$][$];')
SERVER_CALL_OK=$(extract "$M/0077_server_only_rpcs.sql" server_call_ok '^end [$][$];')
ACCOUNT_BLOCKED=$(extract "$M/0072_temporary_account_block.sql" account_blocked '^[$][$];')
# The CMS guard as 0085 created it — 0125 then replaces the function it calls.
CMS_RESERVED_0085=$(extract "$M/0085_cms_page_builder.sql" cms_slug_is_reserved '^[$][$];')
for v in IS_ADMIN TOUCH SERVER_CALL_OK ACCOUNT_BLOCKED CMS_RESERVED_0085; do
  [ -n "${!v}" ] || { echo "grovnews5-sql: could not extract $v" >&2; exit 2; }
done

"${PSQL0[@]}" -d postgres -c "drop database if exists $DB" >/dev/null
"${PSQL0[@]}" -d postgres -c "create database $DB" >/dev/null

fails=0
check() { # name, actual, expected
  if [ "$2" = "$3" ]; then echo "  ✓ $1"
  else echo "  ✗ $1 — got [$2], expected [$3]"; fails=$((fails+1)); fi
}
q() { "${PSQL[@]}" -c "$1"; }
as_user() { "${PSQL[@]}" -c "set role authenticated; set request.jwt.claim.sub = '$1'; $2"; }
as_anon() { "${PSQL[@]}" -c "set role anon; set request.jwt.claim.sub = ''; $1"; }
# The first error line's text (after "ERROR:  "), or "ok". A function's own
# `raise exception 'code'` is therefore exactly its code.
err() { # sql, [role], [sub]
  local out
  if out=$("${PSQL[@]}" -c "set role ${2:-postgres}; set request.jwt.claim.sub = '${3:-}'; $1" 2>&1); then echo ok
  else echo "$out" | sed -n 's/^.*ERROR:  //p' | head -1; fi
}
TOKEN='the-right-dispatch-token'

"${PSQL[@]}" >/dev/null <<SQL
set check_function_bodies = off;
create schema auth; create schema t;
create extension if not exists pgcrypto with schema public;
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end \$\$;
grant usage on schema public, auth to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;

create function auth.uid() returns uuid language sql stable as
  \$f\$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid \$f\$;
create table auth.users (
  id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz default now());

create table public.app_settings (key text primary key, value jsonb not null default '{}'::jsonb);
insert into public.app_settings values
  ('notifications', jsonb_build_object('dispatch_hash', encode(digest('$TOKEN', 'sha256'), 'hex')));

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade, role text not null default 'user',
  blocked boolean not null default false, blocked_until timestamptz);

-- Newsletter: only the columns GrovNews' functions touch.
create table public.newsletter_contacts (
  id uuid primary key default gen_random_uuid(), email text not null unique,
  user_id uuid references public.profiles(id) on delete set null,
  marketing_consent boolean not null default false, unsubscribed_at timestamptz);
create table public.newsletter_suppressions (email text primary key);
create table public.newsletter_groups (
  id uuid primary key default gen_random_uuid(), key text not null unique, name text not null,
  description text, is_dynamic boolean not null default false);
create table public.newsletter_group_members (
  group_id uuid not null references public.newsletter_groups(id) on delete cascade,
  contact_id uuid not null references public.newsletter_contacts(id) on delete cascade,
  primary key (group_id, contact_id));
create table public.newsletter_campaigns (
  id uuid primary key default gen_random_uuid(), name text not null default 'c', kind text,
  status text not null default 'draft', audience jsonb not null default '{"include": [], "exclude": []}'::jsonb,
  track_opens boolean, track_clicks boolean, utm jsonb, started_at timestamptz, finished_at timestamptz);
create table public.newsletter_campaign_steps (
  campaign_id uuid not null references public.newsletter_campaigns(id) on delete cascade,
  step_index integer not null, variant text not null, subject text, preheader text, editor text, body_html text,
  primary key (campaign_id, step_index, variant));
create table public.newsletter_links (
  campaign_id uuid not null references public.newsletter_campaigns(id) on delete cascade, url text not null,
  unique (campaign_id, url));
create table public.newsletter_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.newsletter_campaigns(id) on delete cascade,
  step_index integer not null default 0, variant text not null default 'A',
  contact_id uuid not null references public.newsletter_contacts(id) on delete cascade,
  email text not null, status text not null default 'pending', send_after timestamptz,
  unique (campaign_id, step_index, contact_id));

-- AI credentials: 0121 grants this to anon; its body is not under test here.
create function public.provider_credential_read(p_token text, p_provider uuid) returns text
  language sql as \$f\$ select null::text \$f\$;

-- The CMS table as far as its slug guard goes (0085).
create table public.cms_pages (id uuid primary key default gen_random_uuid(), slug text not null unique,
  title text not null default 'x');

$IS_ADMIN
$TOUCH
$SERVER_CALL_OK
$ACCOUNT_BLOCKED
$CMS_RESERVED_0085

alter table public.cms_pages add constraint cms_pages_slug_not_reserved
  check (slug = 'home' or not public.cms_slug_is_reserved(slug)) not valid;
insert into public.cms_pages (slug) values ('home'), ('o-nas'), ('cennik');

create function t.usr(p_email text) returns uuid language plpgsql as \$f\$
declare v uuid; begin
  insert into auth.users (email) values (p_email) returning id into v;
  insert into public.profiles (id) values (v);
  return v; end \$f\$;
SQL

for f in 0119_grovnews.sql 0120_grovnews_hardening.sql 0121_grovnews_research.sql; do
  "${PSQL[@]}" -f "$M/$f" >/dev/null 2>&1 || { echo "grovnews5-sql: $f did not load" >&2; "${PSQL[@]}" -f "$M/$f" >/dev/null; exit 2; }
done
"${PSQL[@]}" -f "$MIGRATION" >/dev/null

ADMIN=$(q "select t.usr('admin@x.pl')"); q "update public.profiles set role = 'admin' where id = '$ADMIN'" >/dev/null
CUST=$(q "select t.usr('customer@x.pl')")
CAT_AI=$(q "select id from public.grovnews_categories where slug = 'ai'")
CAT_LAW=$(q "select id from public.grovnews_categories where slug = 'prawo'")
TODAY=$(q "select (now() at time zone 'Europe/Warsaw')::date")
YESTERDAY=$(q "select (now() at time zone 'Europe/Warsaw')::date - 1")

# An import row the way the server action sends it.
row() { # name, url, health, [resolved]
  printf '{"name":"%s","type":"RSS","url":"%s","category_id":"%s","priority":80,"official":true,"language":"en","enabled":true,"health_status":"%s","detected_type":"RSS","http":200,"entries":12%s}' \
    "$1" "$2" "$CAT_AI" "$3" "${4:+,\"resolved_url\":\"$4\"}"
}
import_as() { # user, rows-json, update
  as_user "$1" "select public.grovnews_import_sources('$2'::jsonb, $3)"
}
field() { python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(eval('d'+sys.argv[1]))" "$1"; }

echo
echo "C. CMS — the blog slug"
check "C1 a CMS page cannot be CREATED as /blog" \
  "$(err "insert into public.cms_pages (slug) values ('blog')" | grep -o 'cms_pages_slug_not_reserved' || true)" "cms_pages_slug_not_reserved"
check "C2 a CMS page cannot be RENAMED to /blog (nor BLOG)" \
  "$(err "update public.cms_pages set slug = 'blog' where slug = 'o-nas'" | grep -o 'cms_pages_slug_not_reserved' || true)|$(q "select public.cms_slug_is_reserved('BLOG')")" \
  "cms_pages_slug_not_reserved|t"
check "C3 every earlier reservation still holds; ordinary slugs and the grandfathered home row still work" \
  "$(q "select bool_and(public.cms_slug_is_reserved(s)) from unnest(array['api','auth','admin','login','register','logout','home','dashboard','settings','generator','library','products','prompts','history','credits','plan','tools','inspirations','support','retusz','wideo','k','forgot-password','reset-password','sitemap.xml','robots.txt','manifest.webmanifest','_next','favicon.ico']) s")|$(err "insert into public.cms_pages (slug) values ('blog-firmowy')")|$(err "update public.cms_pages set title = 'Start' where slug = 'home'")|$(q "select public.cms_slug_is_reserved('polityka-prywatnosci')")" \
  "t|ok|ok|f"

echo
echo "I. BULK IMPORT (grovnews_import_sources)"
R1=$(row "Feed One" "https://one.example.com/feed" HEALTHY)
R2=$(row "Feed Two" "https://two.example.com/rss" HEALTHY "https://www.two.example.com/rss.xml")
RES=$(import_as "$ADMIN" "[$R1,$R2]" false)
check "I1 an admin imports two tested rows in one call" \
  "$(echo "$RES" | field "['imported']")|$(echo "$RES" | field "['failed']")|$(q "select count(*) from public.grovnews_sources")" "2|0|2"
check "I1b imported rows carry the health the test measured, and are switched on" \
  "$(q "select health_status || '|' || detected_type || '|' || last_http_status || '|' || last_items_count || '|' || enabled from public.grovnews_sources where name = 'Feed One'")" \
  "HEALTHY|RSS|200|12|true"
RES=$(import_as "$ADMIN" "[$R1,$R2]" false)
check "I6 the same file again is IDEMPOTENT: nothing imported, both skipped as duplicates" \
  "$(echo "$RES" | field "['imported']")|$(echo "$RES" | field "['duplicate']")|$(q "select count(*) from public.grovnews_sources")" "0|2|2"
R1U=$(row "FEED ONE" "HTTPS://ONE.EXAMPLE.COM/feed" HEALTHY)
R2R=$(row "Two again" "https://www.two.example.com/rss.xml" HEALTHY)
RES=$(import_as "$ADMIN" "[$R1U,$R2R]" false)
check "I5 the same URL in another case, or the URL an existing source resolves to, is a duplicate (skipped)" \
  "$(echo "$RES" | field "['duplicate']")|$(q "select count(*) from public.grovnews_sources")|$(q "select name from public.grovnews_sources where url = 'https://one.example.com/feed'")" \
  "2|2|Feed One"
q "update public.grovnews_sources set enabled = false where name = 'Feed One'" >/dev/null
RES=$(import_as "$ADMIN" "[$R1U]" true)
check "I5-MARK consent alone updates nothing: a row the app did not mark as an UPDATE (e.g. a new row matching only by path case) is a duplicate" \
  "$(echo "$RES" | field "['updated']")|$(echo "$RES" | field "['duplicate']")|$(q "select name from public.grovnews_sources where url = 'https://one.example.com/feed'")" \
  "0|1|Feed One"
R1U=$(echo "$R1U" | sed 's/}$/,"update":true}/')
RES=$(import_as "$ADMIN" "[$R1U]" true)
check "I5b UPDATE only on explicit consent — and it never changes the URL or switches the source back on" \
  "$(echo "$RES" | field "['updated']")|$(q "select name || '|' || url || '|' || enabled from public.grovnews_sources where url ilike 'https://one.example.com/feed'")" \
  "1|FEED ONE|https://one.example.com/feed|false"
UPD=$(printf '{"name":"Feed One","type":"ATOM","url":"https://one.example.com/feed","category_id":"","priority":55,"official":false,"language":"pl","update":true}')
RES=$(import_as "$ADMIN" "[$UPD]" true)
check "I5c an UPDATE rewrites only what describes the source: never its type (how it is read) nor language, and a row naming no category keeps the old one; no new test is needed" \
  "$(echo "$RES" | field "['updated']")|$(q "select name || '|' || source_type || '|' || (category_id = '$CAT_AI') || '|' || priority || '|' || official_source || '|' || language from public.grovnews_sources where url = 'https://one.example.com/feed'")" \
  "1|Feed One|RSS|true|55|false|en"
q "update public.grovnews_sources set official_source = true where url = 'https://one.example.com/feed'" >/dev/null
UPD2=$(printf '{"name":"Feed One","url":"https://one.example.com/feed","priority":56,"official":null,"language":"pl","update":true}')
RES=$(import_as "$ADMIN" "[$UPD2]" true)
check "I5e an UPDATE whose file said nothing about 'official' keeps the source's flag" \
  "$(echo "$RES" | field "['updated']")|$(q "select priority || '|' || official_source from public.grovnews_sources where url = 'https://one.example.com/feed'")" \
  "1|56|true"
OLDER=$(as_user "$ADMIN" "insert into public.grovnews_sources (name, source_type, url, resolved_url, priority, created_at) values ('Older', 'RSS', 'https://x-older.example.com/rss', 'https://x-older.example.com/feed', 40, now() - interval '1 day') returning id")
EXACT=$(as_user "$ADMIN" "insert into public.grovnews_sources (name, source_type, url, priority) values ('Exact', 'RSS', 'https://x-older.example.com/feed', 40) returning id")
RES=$(import_as "$ADMIN" '[{"name":"Exact renamed","url":"https://x-older.example.com/feed","priority":90,"official":null,"language":"pl","update":true}]' true)
check "I5f an UPDATE changes the source whose OWN address it names — not an older one that merely redirects there" \
  "$(echo "$RES" | field "['updated']")|$(q "select name from public.grovnews_sources where id = '$EXACT'")|$(q "select name from public.grovnews_sources where id = '$OLDER'")" \
  "1|Exact renamed|Older"
NEWUNT=$(printf '{"name":"Untested new","url":"https://brand-new.example.com/feed","priority":50,"language":"pl","update":true}')
RES=$(import_as "$ADMIN" "[$NEWUNT]" true)
check "I5d consent to UPDATE never lets an untested NEW source in" \
  "$(echo "$RES" | field "['failed']")|$(q "select count(*) from public.grovnews_sources where url = 'https://brand-new.example.com/feed'")" "1|0"
BAD=$(row "Broken" "https://broken.example.com/" FAILED)
UNS=$(row "Paywalled" "https://paywall.example.com/" UNSUPPORTED)
UNT=$(printf '{"name":"Untested","type":"RSS","url":"https://untested.example.com/","priority":50,"language":"pl"}')
RES=$(import_as "$ADMIN" "[$BAD,$UNS,$UNT]" false)
check "I-NEVER a FAILED, UNSUPPORTED or untested row is never imported (reported as failed, not_healthy)" \
  "$(echo "$RES" | field "['failed']")|$(echo "$RES" | field "['results'][0]['error']")|$(q "select count(*) from public.grovnews_sources where name in ('Broken','Paywalled','Untested')")" \
  "3|not_healthy|0"
BADP=$(printf '{"name":"Prio","type":"RSS","url":"https://p.example.com/","priority":140,"language":"en","health_status":"HEALTHY"}')
BADU=$(printf '{"name":"Http","type":"RSS","url":"http://h.example.com/","priority":10,"language":"en","health_status":"HEALTHY"}')
BADT=$(printf '{"name":"Api","type":"API","url":"https://a.example.com/","priority":10,"language":"en","health_status":"HEALTHY"}')
BADC=$(printf '{"name":"Cat","type":"RSS","url":"https://c.example.com/","priority":10,"language":"en","health_status":"HEALTHY","category_id":"00000000-0000-0000-0000-000000000000"}')
GOOD=$(row "Good after bad" "https://good.example.com/feed" HEALTHY)
RES=$(import_as "$ADMIN" "[$BADP,$BADU,$BADT,$BADC,$GOOD]" false)
check "I8 a bad priority, an http:// URL, an API type, an unknown category: each refused on its own row; a good row still lands" \
  "$(echo "$RES" | field "['results'][0]['error']")|$(echo "$RES" | field "['results'][1]['error']")|$(echo "$RES" | field "['results'][2]['error']")|$(echo "$RES" | field "['results'][3]['error']")|$(echo "$RES" | field "['imported']")" \
  "priority|url|type|category|1"
check "I10 a customer cannot import (forbidden); an anonymous caller holds no EXECUTE at all" \
  "$(err "select public.grovnews_import_sources('[]'::jsonb, false)" authenticated "$CUST")|$(err "select public.grovnews_import_sources('[]'::jsonb, false)" anon | grep -o 'permission denied' || true)" \
  "forbidden|permission denied"
check "I-LIMIT more than 500 rows in one call is refused" \
  "$(as_user "$ADMIN" "select 1" >/dev/null; err "select public.grovnews_import_sources((select jsonb_agg('{}'::jsonb) from generate_series(1, 501)), false)" authenticated "$ADMIN")" \
  "too_many_rows"

echo
echo "H. SOURCE HEALTH"
SRC=$(q "select id from public.grovnews_sources where name = 'Good after bad'")
checked() { q "select public.grovnews_source_checked('$TOKEN', '$SRC', '$1'::jsonb)"; }
check "H1 one timeout makes a healthy source DEGRADED — not FAILED, and still switched on" \
  "$(checked '{"ok":false,"error":"timeout"}')|$(q "select consecutive_failures || '|' || enabled from public.grovnews_sources where id = '$SRC'")" \
  "DEGRADED|1|true"
checked '{"ok":false,"error":"timeout"}' >/dev/null
check "H2 three failures in a row: FAILED (still switched on — only an admin switches a source off)" \
  "$(checked '{"ok":false,"error":"http_status_503"}')|$(q "select consecutive_failures || '|' || enabled || '|' || last_http_status from public.grovnews_sources where id = '$SRC'")" \
  "FAILED|3|true|503"
check "H3 a successful read heals it: HEALTHY, streak reset, detected type and final URL recorded" \
  "$(checked '{"ok":true,"entries":7,"http":200,"detected_type":"ATOM","resolved_url":"https://good.example.com/atom.xml"}')|$(q "select consecutive_failures || '|' || detected_type || '|' || resolved_url || '|' || coalesce(last_error, '-') from public.grovnews_sources where id = '$SRC'")" \
  "HEALTHY|0|ATOM|https://good.example.com/atom.xml|-"
check "H4 login / forbidden / robots / bot protection: UNSUPPORTED at once (never worked around)" \
  "$(checked '{"ok":false,"error":"http_status_401"}')|$(checked '{"ok":false,"error":"robots"}')|$(checked '{"ok":false,"error":"bot_protection"}')|$(checked '{"ok":false,"error":"requires_access"}')" \
  "UNSUPPORTED|UNSUPPORTED|UNSUPPORTED|UNSUPPORTED"
checked '{"ok":true,"entries":0}' >/dev/null
check "H5 a read that lists nothing is DEGRADED ('empty'), not HEALTHY" \
  "$(q "select health_status || '|' || last_error from public.grovnews_sources where id = '$SRC'")" "DEGRADED|empty"
NEWSRC=$(as_user "$ADMIN" "insert into public.grovnews_sources (name, source_type, url) values ('Never read', 'RSS', 'https://never.example.com/feed') returning id")
check "H6 a source that has NEVER worked and answers 404 / no such host is FAILED at once; one that has worked is only DEGRADED" \
  "$(q "select public.grovnews_source_checked('$TOKEN', '$NEWSRC', '{\"ok\":false,\"error\":\"http_status_404\"}'::jsonb)")|$(checked '{"ok":false,"error":"http_status_404"}')" \
  "FAILED|DEGRADED"
check "H7 who may record a check: an admin (no token) and the job (token); a customer or an anonymous caller may not" \
  "$(as_user "$ADMIN" "select public.grovnews_source_checked('', '$SRC', '{\"ok\":true,\"entries\":3}'::jsonb)")|$(err "select public.grovnews_source_checked('', '$SRC', '{\"ok\":true}'::jsonb)" authenticated "$CUST")|$(err "select public.grovnews_source_checked('nope', '$SRC', '{\"ok\":true}'::jsonb)" anon)|$(err "select public.grovnews_source_health_core('$SRC', true, null, null, null, null, 1, 1)" authenticated "$ADMIN" | grep -o 'permission denied' || true)" \
  "HEALTHY|forbidden|forbidden|permission denied"

echo
echo "B. THE FIRST READ IS A BASELINE"
BSRC=$(as_user "$ADMIN" "insert into public.grovnews_sources (name, source_type, url, category_id) values ('Baseline', 'WEB_PAGE', 'https://base.example.com/news', '$CAT_AI') returning id")
item() { # n, published_at-or-null
  local h; h=$(printf '%064x' "$1")
  printf '{"url":"https://base.example.com/a/%s","nurl":"https://base.example.com/a/%s","title":"Story number %s about sellers","excerpt":"","published_at":%s,"hash":"%s","title_norm":"story number %s sellers","duplicate_of":null,"stale":false,"metadata":{}}' \
    "$1" "$1" "$1" "$2" "$h" "$1"
}
RECENT=$(q "select to_json((now() - interval '2 hours'))::text")
OLD=$(q "select to_json((now() - interval '5 days'))::text")
R=$(q "select public.grovnews_ingest('$TOKEN', '$BSRC', true, '', '[$(item 1 null),$(item 2 null),$(item 3 "$OLD"),$(item 4 "$RECENT")]'::jsonb)")
check "B1 first read of a source: what it already listed is remembered but never analysed; only an entry dated in the last 48 h is NEW" \
  "$(echo "$R" | field "['inserted']")|$(echo "$R" | field "['baseline']")|$(q "select count(*) from public.grovnews_research_items where source_id = '$BSRC' and status = 'REJECTED' and review_reason = 'baseline'")|$(q "select baseline_at is not null from public.grovnews_sources where id = '$BSRC'")" \
  "1|True|3|t"
R=$(q "select public.grovnews_ingest('$TOKEN', '$BSRC', true, '', '[$(item 1 null),$(item 5 null)]'::jsonb)")
check "B2 the next read: a link seen before is skipped, a new undated link is NEW; health and counts recorded" \
  "$(echo "$R" | field "['inserted']")|$(echo "$R" | field "['skipped']")|$(q "select health_status || '|' || last_items_count || '|' || last_new_items from public.grovnews_sources where id = '$BSRC'")" \
  "1|1|HEALTHY|2|1"
q "select public.grovnews_ingest('$TOKEN', '$BSRC', false, 'timeout', '[]'::jsonb)" >/dev/null
check "B3 a failed read goes through the same health rule (one timeout → DEGRADED)" \
  "$(q "select health_status || '|' || last_error from public.grovnews_sources where id = '$BSRC'")" "DEGRADED|timeout"

echo
echo "D. ONE DAILY ARTICLE"
OFF=$(as_user "$ADMIN" "insert into public.grovnews_sources (name, source_type, url, official_source, priority) values ('Official', 'RSS', 'https://gov.example.com/rss', true, 100) returning id")
UNO=$(as_user "$ADMIN" "insert into public.grovnews_sources (name, source_type, url, priority) values ('Media A', 'RSS', 'https://media-a.example.com/rss', 60) returning id")
UNO2=$(as_user "$ADMIN" "insert into public.grovnews_sources (name, source_type, url, priority) values ('Media B', 'RSS', 'https://media-b.example.com/rss', 60) returning id")
mk() { # source, category, status, relevance, importance, [review_required], [duplicate_of], [sensitive]
  q "with k as (select gen_random_uuid()::text as u)
     insert into public.grovnews_research_items (source_id, canonical_url, normalized_url, source_title, content_hash, category_id,
       status, relevance_score, importance_score, review_required, duplicate_of, sensitive, selected_at, analyzed_at)
     select '$1', 'https://x.example.com/' || k.u, 'https://x.example.com/' || k.u, 'Topic ' || k.u, encode(digest(k.u, 'sha256'), 'hex'), '$2',
       '$3', $4, $5, ${6:-false}, ${7:-null}, ${8:-false}, case when '$3' = 'SELECTED' then now() end, now()
     from k returning id"
}
POST='{"title":"GrovNews — 01.01.2030","slug":"grovnews-daily","excerpt":"Lead","content":"## 1. One\n\nBody","sources":[{"url":"https://gov.example.com/a","title":"Gov"}],"tags":["grovnews"],"read_minutes":4,"language":"pl","daily":{"version":1,"topics":[{"title":"One"}]}}'
daily() { # date, ids-array, publish, [review]
  q "select public.grovnews_daily_article('$TOKEN', '$1'::date, array[$2]::uuid[], '$POST'::jsonb, $3, '${4:-}')"
}
I1=$(mk "$OFF" "$CAT_AI" SELECTED 80 80); I2=$(mk "$OFF" "$CAT_AI" SELECTED 80 80); I3=$(mk "$OFF" "$CAT_AI" SELECTED 80 80)
POSTS_BEFORE=$(q "select count(*) from public.grovnews_posts")
R=$(daily "$TODAY" "'$I1','$I2','$I3'" true)
check "D1 three topics become ONE post (not three), and every topic points at it (USED)" \
  "$(( $(q "select count(*) from public.grovnews_posts") - POSTS_BEFORE ))|$(q "select count(*) from public.grovnews_research_items where post_id = '$(echo "$R" | field "['post_id']")' and status = 'USED'")" \
  "1|3"
check "D1b REVIEW mode: the article and its edition stay DRAFT even when publishing is asked for" \
  "$(echo "$R" | field "['status']")|$(echo "$R" | field "['edition_status']")|$(echo "$R" | field "['attached']")" "DRAFT|DRAFT|True"
PID=$(echo "$R" | field "['post_id']")
I4=$(mk "$OFF" "$CAT_AI" SELECTED 80 80)
R2=$(daily "$TODAY" "'$I4'" true)
check "D5/D6 the same date again (a retry, a second run, other topics): the SAME article, nothing new written" \
  "$(echo "$R2" | field "['post_id']")|$(echo "$R2" | field "['created']")|$(q "select status from public.grovnews_research_items where id = '$I4'")|$(q "select count(*) from public.grovnews_posts where metadata->>'daily_date' = '$TODAY'")" \
  "$PID|False|SELECTED|1"
check "D5b the database itself refuses a second post stamped with the same date" \
  "$(err "insert into public.grovnews_posts (slug, title, metadata) values ('dup-daily', 'x', jsonb_build_object('daily_date', '$TODAY'))" | grep -o 'grovnews_posts_daily_date_key' || true)" \
  "grovnews_posts_daily_date_key"
check "D-PRIV the post's metadata (readable by subscribers) is its date only; the editorial record is on the admin-only edition" \
  "$(q "select metadata::text from public.grovnews_posts where id = '$PID'")|$(q "select daily->'topics'->0->>'title' from public.grovnews_editions where article_post_id = '$PID'")" \
  "{\"daily_date\": \"$TODAY\"}|One"
check "D-BUILD the Stage 2 builder leaves an article edition alone (no second post added)" \
  "$(q "select public.grovnews_build_edition('$TOKEN', '$TODAY'::date, false)->>'added'")|$(q "select count(*) from public.grovnews_edition_posts ep join public.grovnews_editions e on e.id = ep.edition_id where e.edition_date = '$TODAY'")" \
  "0|1"
EXTRA=$(q "insert into public.grovnews_posts (slug, title, content, status, published_at) values ('extra-post', 'Extra', 'x', 'PUBLISHED', now() - interval '1 minute') returning id")
q "update public.grovnews_posts set status = 'PUBLISHED', published_at = now() - interval '1 minute' where id = '$PID'" >/dev/null
EDT=$(q "select id from public.grovnews_editions where edition_date = '$TODAY'")
q "insert into public.grovnews_edition_posts (edition_id, post_id, position) values ('$EDT', '$EXTRA', 2)" >/dev/null
check "D-ONE an article edition cannot move on while it carries anything besides its article" \
  "$(err "update public.grovnews_editions set status = 'READY' where id = '$EDT'")" "grovnews_edition_not_single_article"
q "delete from public.grovnews_edition_posts where edition_id = '$EDT' and post_id = '$EXTRA'" >/dev/null
check "D-ONE-b with its article alone, it can" \
  "$(err "update public.grovnews_editions set status = 'READY' where id = '$EDT'")" "ok"
q "update public.grovnews_editions set status = 'DRAFT' where id = '$EDT'" >/dev/null

# AUTOMATIC mode: the publish gate, per topic.
q "update public.grovnews_settings set mode = 'AUTOMATIC', min_topics = 2, max_topics = 5" >/dev/null
d() { echo "$TODAY" | python3 -c "import sys,datetime; print(datetime.date.fromisoformat(sys.stdin.read().strip()) - datetime.timedelta(days=$1))"; }
A1=$(mk "$OFF" "$CAT_AI" SELECTED 80 80); A2=$(mk "$OFF" "$CAT_AI" SELECTED 80 80)
R=$(daily "$(d 10)" "'$A1','$A2'" true)
check "D-AUTO AUTOMATIC + every topic official, above both thresholds, enough topics: article AND edition PUBLISHED" \
  "$(echo "$R" | field "['status']")|$(echo "$R" | field "['edition_status']")" "PUBLISHED|PUBLISHED"
B1=$(mk "$OFF" "$CAT_AI" SELECTED 80 80 true); B2=$(mk "$OFF" "$CAT_AI" SELECTED 80 80)
check "D11 one topic flagged REVIEW_REQUIRED keeps the whole article a DRAFT (nothing publishes, nothing can be sent)" \
  "$(daily "$(d 11)" "'$B1','$B2'" true | field "['status']")" "DRAFT"
C1=$(mk "$OFF" "$CAT_AI" SELECTED 80 80)
check "D-MIN fewer topics than min_topics: written, but a DRAFT for a person" \
  "$(daily "$(d 12)" "'$C1'" true | field "['status']")" "DRAFT"
E1=$(mk "$UNO" "$CAT_AI" SELECTED 80 80); E2=$(mk "$OFF" "$CAT_AI" SELECTED 80 80)
check "D-SINGLE a topic resting on ONE unofficial source keeps it a DRAFT" \
  "$(daily "$(d 13)" "'$E1','$E2'" true | field "['status']")" "DRAFT"
F1=$(mk "$UNO" "$CAT_AI" SELECTED 80 80); F1D=$(mk "$UNO2" "$CAT_AI" DUPLICATE 80 80 false "'$F1'"); F2=$(mk "$OFF" "$CAT_AI" SELECTED 80 80)
check "D2 the same story from two different sources (a cluster) is corroborated: it may publish" \
  "$(daily "$(d 14)" "'$F1','$F2'" true | field "['status']")" "PUBLISHED"
G1=$(mk "$UNO" "$CAT_LAW" SELECTED 80 80); G1D=$(mk "$UNO2" "$CAT_LAW" DUPLICATE 80 80 false "'$G1'"); G2=$(mk "$OFF" "$CAT_AI" SELECTED 80 80)
check "D-LAW law/tax without an official source among its reports stays a DRAFT, even corroborated" \
  "$(daily "$(d 15)" "'$G1','$G2'" true | field "['status']")" "DRAFT"
q "update public.grovnews_settings set auto_publish_official_sensitive = true" >/dev/null
H1=$(mk "$UNO" "$CAT_LAW" SELECTED 80 80); H1D=$(mk "$OFF" "$CAT_LAW" DUPLICATE 80 80 false "'$H1'"); H2=$(mk "$OFF" "$CAT_AI" SELECTED 80 80)
H3=$(mk "$OFF" "$CAT_LAW" SELECTED 80 80); H4=$(mk "$OFF" "$CAT_AI" SELECTED 80 80)
check "D3 with the admin's consent a law topic publishes on its OWN official source only — an official duplicate in the cluster does not lend it authority" \
  "$(daily "$(d 16)" "'$H1','$H2'" true | field "['status']")|$(daily "$(d 23)" "'$H3','$H4'" true | field "['status']")" "DRAFT|PUBLISHED"
q "update public.grovnews_settings set auto_publish_official_sensitive = false" >/dev/null
J1=$(mk "$OFF" "$CAT_AI" SELECTED 80 80); J2=$(mk "$OFF" "$CAT_AI" SELECTED 80 80)
check "D-REASON a review reason from the writer (e.g. half the sources failed) keeps it a DRAFT" \
  "$(daily "$(d 17)" "'$J1','$J2'" true sources_failed | field "['status']")" "DRAFT"
# A day whose edition an admin already built by hand (with its own post):
# the article is written but NOT attached, so nothing can mail that edition.
MAN_POST=$(q "insert into public.grovnews_posts (slug, title, content, status, published_at) values ('manual-day', 'Manual', 'x', 'PUBLISHED', now() - interval '1 minute') returning id")
MAN_ED=$(q "insert into public.grovnews_editions (edition_date, title) values ('$(d 19)'::date, 'Manual') returning id")
q "insert into public.grovnews_edition_posts (edition_id, post_id, position) values ('$MAN_ED', '$MAN_POST', 1)" >/dev/null
M1I=$(mk "$OFF" "$CAT_AI" SELECTED 80 80); M2I=$(mk "$OFF" "$CAT_AI" SELECTED 80 80)
R=$(daily "$(d 19)" "'$M1I','$M2I'" true)
check "D-MANUAL an edition built by hand keeps its posts; the article is written but not attached (and stays a DRAFT edition-wise)" \
  "$(echo "$R" | field "['attached']")|$(q "select count(*) from public.grovnews_edition_posts where edition_id = '$MAN_ED'")|$(q "select article_post_id is null from public.grovnews_editions where id = '$MAN_ED'")|$(daily "$(d 19)" "'$M1I'" true | field "['attached']")" \
  "False|1|t|False"
# The same story twice, merged by the writer into one topic: the absorbed
# report is claimed with the article, and its doubt is the day's doubt.
abs_post() { python3 -c "import json,sys; p=json.loads(sys.argv[1]); p['absorbed']=sys.argv[2:]; print(json.dumps(p))" "$POST" "$@"; }
T1=$(mk "$OFF" "$CAT_AI" SELECTED 80 80); T1B=$(mk "$UNO" "$CAT_AI" SELECTED 70 70); T2=$(mk "$OFF" "$CAT_AI" SELECTED 80 80)
R=$(q "select public.grovnews_daily_article('$TOKEN', '$(d 20)'::date, array['$T1','$T2']::uuid[], '$(abs_post "$T1B" "not-a-uuid" "$T1")'::jsonb, true, '')")
check "D4 a story merged into a topic is claimed with the article (never a topic of its own later); the topic count is the topics'" \
  "$(echo "$R" | field "['status']")|$(q "select status || '|' || (post_id = '$(echo "$R" | field "['post_id']")') from public.grovnews_research_items where id = '$T1B'")" \
  "PUBLISHED|USED|true"
V1=$(mk "$OFF" "$CAT_AI" SELECTED 80 80); V1B=$(mk "$UNO" "$CAT_AI" SELECTED 80 80 true); V2=$(mk "$OFF" "$CAT_AI" SELECTED 80 80)
check "D11b a merged report flagged REVIEW_REQUIRED keeps the day a DRAFT" \
  "$(q "select public.grovnews_daily_article('$TOKEN', '$(d 21)'::date, array['$V1','$V2']::uuid[], '$(abs_post "$V1B")'::jsonb, true, '')" | field "['status']")" "DRAFT"
W1=$(mk "$OFF" "$CAT_AI" SELECTED 80 80); W1D=$(mk "$UNO2" "$CAT_AI" DUPLICATE 80 80 true "'$W1'"); W2=$(mk "$OFF" "$CAT_AI" SELECTED 80 80)
X1=$(mk "$OFF" "$CAT_AI" SELECTED 80 80); X1D=$(mk "$UNO2" "$CAT_LAW" DUPLICATE 80 80 false "'$X1'"); X2=$(mk "$OFF" "$CAT_AI" SELECTED 80 80)
check "D11c a same-story report (its excerpt goes to the writer) flagged REVIEW_REQUIRED, or law/tax from an unofficial site, keeps the day a DRAFT" \
  "$(daily "$(d 24)" "'$W1','$W2'" true | field "['status']")|$(daily "$(d 25)" "'$X1','$X2'" true | field "['status']")" "DRAFT|DRAFT"
Y1=$(mk "$OFF" "$CAT_AI" SELECTED 80 80); Y1B=$(mk "$OFF" "$CAT_AI" SELECTED 80 80); Y2=$(mk "$OFF" "$CAT_AI" SELECTED 80 80)
q "update public.grovnews_research_items set status = 'REJECTED' where id = '$Y1B'" >/dev/null
check "D11d a merged report someone REJECTED while the article was being written keeps the day a DRAFT (and stays rejected)" \
  "$(q "select public.grovnews_daily_article('$TOKEN', '$(d 26)'::date, array['$Y1','$Y2']::uuid[], '$(abs_post "$Y1B")'::jsonb, true, '')" | field "['status']")|$(q "select status from public.grovnews_research_items where id = '$Y1B'")" \
  "DRAFT|REJECTED"
POSTS_NOW=$(q "select count(*) from public.grovnews_posts")
check "D-RESUME an empty topic list asks only whether the date already has its article: returned when written, refused when not — nothing is written either way" \
  "$(q "select public.grovnews_daily_article('$TOKEN', '$TODAY'::date, array[]::uuid[], '{}'::jsonb, false, '')->>'post_id'")|$(err "select public.grovnews_daily_article('$TOKEN', '$(d 30)'::date, array[]::uuid[], '{}'::jsonb, false, '')")|$(( $(q "select count(*) from public.grovnews_posts") - POSTS_NOW ))" \
  "$PID|invalid_items|0"
K1=$(mk "$OFF" "$CAT_AI" ANALYZED 80 80)
check "D-GUARD only SELECTED, unused topics; only the job's token" \
  "$(err "select public.grovnews_daily_article('$TOKEN', '$(d 18)'::date, array['$K1']::uuid[], '$POST'::jsonb, true, '')")|$(err "select public.grovnews_daily_article('nope', '$(d 18)'::date, array['$K1']::uuid[], '$POST'::jsonb, true, '')" anon)" \
  "items_not_selected|forbidden"

echo
echo "S. SELECTION — lookback and authority"
q "update public.grovnews_settings set max_topics = 1, min_topics = 1, lookback_hours = 24" >/dev/null
q "update public.grovnews_research_items set selected_at = now() - interval '2 days' where selected_at is not null" >/dev/null
S1=$(mk "$UNO" "$CAT_AI" ANALYZED 80 80); S2=$(mk "$OFF" "$CAT_AI" ANALYZED 80 80)
S3=$(mk "$OFF" "$CAT_AI" ANALYZED 99 99); q "update public.grovnews_research_items set discovered_at = now() - interval '30 hours' where id = '$S3'" >/dev/null
check "S1 equal scores: the OFFICIAL source's story is picked; a story older than the lookback is not" \
  "$(q "select public.grovnews_select_top('$TOKEN')")|$(q "select status from public.grovnews_research_items where id = '$S2'")|$(q "select status from public.grovnews_research_items where id = '$S1'")|$(q "select status from public.grovnews_research_items where id = '$S3'")" \
  "1|SELECTED|ANALYZED|ANALYZED"
check "S2 the day's candidates carry every report of the story, the official one first" \
  "$(q "select jsonb_array_length(public.grovnews_daily_candidates('$TOKEN', '$TODAY'::date))")" "1"
S2D=$(mk "$UNO" "$CAT_AI" DUPLICATE 80 80 true "'$S2'")
check "S2b a report of the story flagged for review is marked 'flagged' in the candidates (the writer's side waits too)" \
  "$(q "select public.grovnews_daily_candidates('$TOKEN', '$TODAY'::date)->0->'related'->0->>'flagged'")" "true"
check "S3 min_topics can never exceed max_topics" \
  "$(err "update public.grovnews_settings set min_topics = 5, max_topics = 3" | grep -o 'grovnews_settings_topics_range' || true)" "grovnews_settings_topics_range"

echo
echo "M. ONE DAILY MAIL (grovnews_edition_send)"
q "update public.grovnews_settings set mode = 'AUTOMATIC', max_topics = 5, min_topics = 2, lookback_hours = 36" >/dev/null
GRP=$(q "insert into public.newsletter_groups (key, name) values ('grovnews', 'g') returning id")
USER1=$(q "select t.usr('reader1@x.pl')"); USER2=$(q "select t.usr('reader2@x.pl')"); USER3=$(q "select t.usr('reader3@x.pl')"); USER4=$(q "select t.usr('reader4@x.pl')")
for u in $USER1 $USER2 $USER3 $USER4; do q "insert into public.grovnews_entitlements (user_id) values ('$u')" >/dev/null; done
q "insert into public.newsletter_contacts (email, user_id, marketing_consent) values ('reader1@x.pl', '$USER1', true), ('reader2@x.pl', '$USER2', false), ('reader3@x.pl', '$USER3', true), ('reader4@x.pl', '$USER4', true)" >/dev/null
q "update public.newsletter_contacts set unsubscribed_at = now() where email = 'reader3@x.pl'" >/dev/null
q "insert into public.newsletter_suppressions (email) values ('reader4@x.pl')" >/dev/null
# Today's article, published by an admin.
q "update public.grovnews_editions set status = 'READY' where id = '$EDT'" >/dev/null
q "update public.grovnews_editions set status = 'PUBLISHED', published_at = now() where id = '$EDT'" >/dev/null
SLUG=$(q "select slug from public.grovnews_posts where id = '$PID'")
send() { # edition, body
  q "select public.grovnews_edition_send('$TOKEN', '$1', 'GrovNews — dziś', 'preview', \$b\$$2\$b\$, array['https://grovbase.com/grovnews/$SLUG'], '{\"source\":\"grovnews\"}'::jsonb)"
}
GOODBODY="<p>Intro</p><p><a href=\"https://grovbase.com/grovnews/$SLUG\" style=\"x\">Czytaj pełne dzisiejsze GrovNews →</a></p>"
check "M1 a link to anything but the published article is refused (another site, /grovnews, /blog, single quotes, no link at all)" \
  "$(err "select public.grovnews_edition_send('$TOKEN', '$EDT', 's', 'p', \$b\$<a href=\"https://evil.example.com/\">x</a><a href=\"https://grovbase.com/grovnews/$SLUG\">y</a>\$b\$, '{}', '{}'::jsonb)")|$(err "select public.grovnews_edition_send('$TOKEN', '$EDT', 's', 'p', \$b\$<a href=\"https://grovbase.com/grovnews\">x</a>\$b\$, '{}', '{}'::jsonb)")|$(err "select public.grovnews_edition_send('$TOKEN', '$EDT', 's', 'p', \$b\$<a href=\"https://grovbase.com/blog/x\">x</a><a href=\"https://grovbase.com/grovnews/$SLUG\">y</a>\$b\$, '{}', '{}'::jsonb)")|$(err "select public.grovnews_edition_send('$TOKEN', '$EDT', 's', 'p', \$b\$<a href='https://evil.example.com/'>x</a><a href=\"https://grovbase.com/grovnews/$SLUG\">y</a>\$b\$, '{}', '{}'::jsonb)")|$(err "select public.grovnews_edition_send('$TOKEN', '$EDT', 's', 'p', \$b\$<p>no link</p>\$b\$, '{}', '{}'::jsonb)")" \
  "foreign_link|foreign_link|foreign_link|foreign_link|foreign_link"
check "M1b an address in the mail's visible text is refused; the escaped words 'href=' in a title are not a link" \
  "$(err "select public.grovnews_edition_send('$TOKEN', '$EDT', 's', 'p', \$b\$<p>Zaloguj: https://allegro-weryfikacja.com/login</p><a href=\"https://grovbase.com/grovnews/$SLUG\">y</a>\$b\$, '{}', '{}'::jsonb)")|$(err "select public.grovnews_edition_send('$TOKEN', '$EDT', 's', 'p', \$b\$<p>evil.com/x</p><a href=\"https://grovbase.com/grovnews/$SLUG\">y</a>\$b\$, '{}', '{}'::jsonb)")|$(err "do \$x\$ begin perform public.grovnews_edition_send('$TOKEN', '$EDT', 's', 'p', \$b\$<p>Allegro blokuje atrybut href= w opisach</p><a href=\"https://grovbase.com/grovnews/$SLUG\">y</a>\$b\$, '{}', '{}'::jsonb); raise exception 'passed_guard'; end \$x\$" | grep -o 'foreign_link\|passed_guard')" \
  "foreign_link|foreign_link|passed_guard"
ZW=$'\u200b'
passes() { # body → passed_guard when every guard lets it through (rolled back)
  err "do \$x\$ begin perform public.grovnews_edition_send('$TOKEN', '$EDT', 's', 'p', \$b\$$1<a href=\"https://grovbase.com/grovnews/$SLUG\">y</a>\$b\$, '{}', '{}'::jsonb); raise exception 'passed_guard'; end \$x\$" | grep -o 'foreign_link\|passed_guard'
}
check "M1c bare domains a mail client would link are refused — digits-only (1688.com), non-ASCII (łódź.pl), fullwidth dot (evil．com), a half-defused chain (biznes.gov.​pl); fully defused ones (every dot) and plain numbers pass" \
  "$(passes "<p>Więcej na 1688.com dziś</p>")|$(passes "<p>Promocja na łódź.pl</p>")|$(passes "<p>Zobacz evil．com teraz</p>")|$(passes "<p>Sprzedajesz na Allegro.${ZW}pl? Stawka 8.5% bez zmian, m.${ZW}in. w elektronice.</p>")|$(passes "<p>Wniosek w serwisie biznes.${ZW}gov.${ZW}pl, kontakt@${ZW}uokik.${ZW}gov.${ZW}pl.</p>")|$(passes "<p>Serwis biznes.gov.${ZW}pl</p>")" \
  "foreign_link|foreign_link|foreign_link|passed_guard|passed_guard|foreign_link"
q "update public.grovnews_settings set email_enabled = false" >/dev/null
check "M-OFF e-mail switched off in the settings: nothing is queued" "$(err "select public.grovnews_edition_send('$TOKEN', '$EDT', 's', 'p', \$b\$$GOODBODY\$b\$, '{}', '{}'::jsonb)")" "email_disabled"
q "update public.grovnews_settings set email_enabled = true, mode = 'REVIEW'" >/dev/null
check "M-REVIEW REVIEW mode: the unattended door stays shut" "$(err "select public.grovnews_edition_send('$TOKEN', '$EDT', 's', 'p', \$b\$$GOODBODY\$b\$, '{}', '{}'::jsonb)")" "not_automatic"
q "update public.grovnews_settings set mode = 'AUTOMATIC'" >/dev/null
OLDED=$(q "select id from public.grovnews_editions where edition_date = '$(d 10)'")
check "M-DAY an older day's edition is never mailed today" \
  "$(err "select public.grovnews_edition_send('$TOKEN', '$OLDED', 's', 'p', 'x', '{}', '{}'::jsonb)")" "edition_not_today"
R=$(send "$EDT" "$GOODBODY")
check "M2/M3 queued to exactly the consenting, subscribed, not-suppressed readers (1 of 4)" \
  "$(echo "$R" | field "['status']")|$(echo "$R" | field "['recipients']")|$(q "select string_agg(email, ',') from public.newsletter_recipients")" \
  "queued|1|reader1@x.pl"
R=$(send "$EDT" "$GOODBODY")
check "D8/D9 a retry of the same day: already queued — no second campaign, no second recipient row" \
  "$(echo "$R" | field "['status']")|$(q "select count(*) from public.newsletter_campaigns")|$(q "select count(*) from public.newsletter_recipients")" \
  "already_queued|1|1"
check "D7 the mail exists only for a PUBLISHED article: the edition is QUEUED and its article is live" \
  "$(q "select e.status || '|' || p.status from public.grovnews_editions e join public.grovnews_posts p on p.id = e.article_post_id where e.id = '$EDT'")" \
  "QUEUED|PUBLISHED"

echo
if [ "$fails" -eq 0 ]; then echo "grovnews5-sql: all checks passed"; else echo "grovnews5-sql: $fails check(s) FAILED"; fi
exit $fails
