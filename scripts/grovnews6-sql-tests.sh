#!/usr/bin/env bash
#
# GROVNEWS STAGE 6 (0128) — THE FINALIZATION, PROVEN ON A REAL POSTGRES.
#
# Migrations 0119, 0120, 0121, 0122, 0125 and 0128 are loaded VERBATIM next to
# the helpers they depend on, cut out of the migrations that ship them
# (is_admin and touch_updated_at from 0002, server_call_ok from 0077,
# account_blocked from 0072), the smallest possible newsletter tables and a
# stub vault / pg_net for the tick. A pass here is the SQL itself.
#
#   S  settings and source-auth constraints
#   H  health: auth_failed / secret_missing
#   G  dedupe, language, orphans, one edition a day, idempotence, review vs automatic
#   R  runs: abandoned days, DONE clears the error, publish / send waits, the tick
#   M  recipients (M1–M8), the digest's links (M9), the published edition (M10), operators
#
# Local harness only:
#
#   bash scripts/pg-harness-up.sh && bash scripts/grovnews6-sql-tests.sh
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
DB=grovnews6
PSQL0=(psql -h "$PGSOCK" -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -X -q -t -A)
PSQL=("${PSQL0[@]}" -d "$DB")

if ! "${PSQL0[@]}" -d postgres -c 'select 1' >/dev/null 2>&1; then
  echo "grovnews6-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
M=$ROOT/supabase/migrations
MIGRATION="${MIGRATION:-$M/0128_grovnews_finalization.sql}"
for f in "$MIGRATION" "$M/0002_functions_and_triggers.sql" "$M/0072_temporary_account_block.sql" "$M/0077_server_only_rpcs.sql" \
         "$M/0119_grovnews.sql" "$M/0120_grovnews_hardening.sql" "$M/0121_grovnews_research.sql" \
         "$M/0122_grovnews_send_time_access.sql" "$M/0125_grovnews_sources_daily.sql"; do
  [ -f "$f" ] || { echo "grovnews6-sql: $f not found" >&2; exit 2; }
done

extract() { # file, function name, end marker regex
  awk -v start="^create (or replace )?function public[.]$2[(]" -v stop="$3" \
    '$0 ~ start {on=1} on {print} on && $0 ~ stop {exit}' "$1"
}
IS_ADMIN=$(extract "$M/0002_functions_and_triggers.sql" is_admin '^[$][$];')
TOUCH=$(extract "$M/0002_functions_and_triggers.sql" touch_updated_at '^[$][$];')
SERVER_CALL_OK=$(extract "$M/0077_server_only_rpcs.sql" server_call_ok '^end [$][$];')
ACCOUNT_BLOCKED=$(extract "$M/0072_temporary_account_block.sql" account_blocked '^[$][$];')
for v in IS_ADMIN TOUCH SERVER_CALL_OK ACCOUNT_BLOCKED; do
  [ -n "${!v}" ] || { echo "grovnews6-sql: could not extract $v" >&2; exit 2; }
done

"${PSQL0[@]}" -d postgres -c "drop database if exists $DB" >/dev/null
"${PSQL0[@]}" -d postgres -c "create database $DB" >/dev/null

fails=0
check() { # name, actual, expected
  if [ "$2" = "$3" ]; then echo "  ✓ $1"
  else echo "  ✗ $1 — got [$2], expected [$3]"; fails=$((fails+1)); fi
}
note() { echo "  · $1"; }
q() { "${PSQL[@]}" -c "$1"; }
as_user() { "${PSQL[@]}" -c "set role authenticated; set request.jwt.claim.sub = '$1'; $2"; }
err() { # sql, [role], [sub]
  local out
  if out=$("${PSQL[@]}" -c "set role ${2:-postgres}; set request.jwt.claim.sub = '${3:-}'; $1" 2>&1); then echo ok
  else echo "$out" | sed -n 's/^.*ERROR:  //p' | head -1; fi
}
field() { python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(eval('d'+sys.argv[1]))" "$1"; }
TOKEN='the-right-dispatch-token'

"${PSQL[@]}" >/dev/null <<SQL
set check_function_bodies = off;
create schema auth; create schema t; create schema vault; create schema net;
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

create function public.provider_credential_read(p_token text, p_provider uuid) returns text
  language sql as \$f\$ select null::text \$f\$;

-- 0125 checks the CMS for a 'blog' page before it reserves the slug.
create table public.cms_pages (id uuid primary key default gen_random_uuid(), slug text not null unique);

-- The tick's outside world: the vault's two secrets and pg_net.
create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
create table t.posts (url text, headers jsonb);
create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer) returns bigint
  language plpgsql as \$f\$ begin insert into t.posts values (url, headers); return 42; end \$f\$;

$IS_ADMIN
$TOUCH
$SERVER_CALL_OK
$ACCOUNT_BLOCKED

create function t.usr(p_email text, p_confirmed boolean default true) returns uuid language plpgsql as \$f\$
declare v uuid; begin
  insert into auth.users (email, email_confirmed_at) values (p_email, case when p_confirmed then now() end) returning id into v;
  insert into public.profiles (id) values (v);
  return v; end \$f\$;
SQL

for f in 0119_grovnews.sql 0120_grovnews_hardening.sql 0121_grovnews_research.sql 0122_grovnews_send_time_access.sql 0125_grovnews_sources_daily.sql; do
  "${PSQL[@]}" -f "$M/$f" >/dev/null 2>&1 || { echo "grovnews6-sql: $f did not load" >&2; "${PSQL[@]}" -f "$M/$f" >/dev/null; exit 2; }
done
# The settings row as it is on PROD before 0128 (REVIEW, daily off, 06:00).
SETTINGS_BEFORE=$(q "select to_jsonb(s) - 'updated_at' from public.grovnews_settings s")
"${PSQL[@]}" -f "$MIGRATION" >/dev/null

ADMIN=$(q "select t.usr('admin@x.pl')"); q "update public.profiles set role = 'admin' where id = '$ADMIN'" >/dev/null
CAT_AI=$(q "select id from public.grovnews_categories where slug = 'ai'")
TODAY=$(q "select (now() at time zone 'Europe/Warsaw')::date")
HOUR=$(q "select extract(hour from now() at time zone 'Europe/Warsaw')::integer")
OFF=$(as_user "$ADMIN" "insert into public.grovnews_sources (name, source_type, url, official_source, priority, baseline_at) values ('Official', 'RSS', 'https://gov.example.com/rss', true, 100, now()) returning id")
UNO=$(as_user "$ADMIN" "insert into public.grovnews_sources (name, source_type, url, priority, baseline_at, language) values ('Media A', 'RSS', 'https://media-a.example.com/rss', 60, now(), 'de') returning id")

mk() { # source, category, status, relevance, importance
  q "with k as (select gen_random_uuid()::text as u)
     insert into public.grovnews_research_items (source_id, canonical_url, normalized_url, source_title, content_hash, category_id,
       status, relevance_score, importance_score, selected_at, analyzed_at)
     select '$1', 'https://x.example.com/' || k.u, 'https://x.example.com/' || k.u, 'Topic ' || k.u, encode(digest(k.u, 'sha256'), 'hex'), '$2',
       '$3', $4, $5, case when '$3' = 'SELECTED' then now() end, now()
     from k returning id"
}
POST='{"title":"GrovNews","slug":"grovnews-daily","excerpt":"Lead","content":"## 1. One\n\nBody\n\n## 2. Two\n\nBody","sources":[{"url":"https://gov.example.com/a","title":"Gov"}],"tags":["grovnews"],"read_minutes":4,"language":"pl","daily":{"version":1,"topics":[{"title":"One"},{"title":"Two"}]}}'
daily() { # date, ids-array, publish, [review]
  q "select public.grovnews_daily_article('$TOKEN', '$1'::date, array[$2]::uuid[], '$POST'::jsonb, $3, '${4:-}')"
}
hash() { q "select encode(digest('$1', 'sha256'), 'hex')"; }
item() { # url, title, hash, [duplicate_of], [language]
  printf '{"url":"%s","nurl":"%s","title":"%s","excerpt":"x","published_at":null,"hash":"%s","title_norm":"%s","stale":false,"metadata":{}%s%s}' \
    "$1" "$1" "$2" "$3" "$2" "${4:+,\"duplicate_of\":\"$4\"}" "${5:+,\"language\":\"$5\"}"
}
ingest() { q "select public.grovnews_ingest('$TOKEN', '$1', true, '', '$2'::jsonb)"; }

echo
echo "S. SETTINGS AND SOURCE AUTH (0128 §1–2)"
check "S0 deploy changes nothing an admin chose: REVIEW, daily off, 06:00 stay; the new settings mean today's behaviour" \
  "$(q "select (to_jsonb(s) - 'updated_at' - 'ai_provider' - 'ai_model' - 'publish_hour' - 'send_hour' - 'operator_emails') = '$SETTINGS_BEFORE'::jsonb, ai_provider is null and ai_model is null and publish_hour is null and send_hour is null and operator_emails = '{}' from public.grovnews_settings s" | tr '|' ' ')" \
  "t t"
check "S1 hours must be in order (publish ≥ prepare, send ≥ publish) and within 0–23" \
  "$(err "update public.grovnews_settings set publish_hour = 5" | grep -o grovnews_settings_hours_order || true)|$(err "update public.grovnews_settings set publish_hour = 9, send_hour = 8" | grep -o grovnews_settings_hours_order || true)|$(err "update public.grovnews_settings set send_hour = 24" | grep -o 'send_hour_check' || true)|$(err "update public.grovnews_settings set publish_hour = 8, send_hour = 9")" \
  "grovnews_settings_hours_order|grovnews_settings_hours_order|send_hour_check|ok"
q "update public.grovnews_settings set publish_hour = null, send_hour = null" >/dev/null
check "S2 a model needs a provider; the provider is one of the platform's; ≤ 5 valid distinct operator addresses" \
  "$(err "update public.grovnews_settings set ai_model = 'gpt-4.1'" | grep -o model_needs_provider || true)|$(err "update public.grovnews_settings set ai_provider = 'anthropic'" | grep -o ai_provider_check || true)|$(err "update public.grovnews_settings set operator_emails = array['a@x.pl','nope']" | grep -o operator_emails_check || true)|$(err "update public.grovnews_settings set operator_emails = array['a@x.pl','b@x.pl','c@x.pl','d@x.pl','e@x.pl','f@x.pl']" | grep -o operator_emails_check || true)|$(err "update public.grovnews_settings set ai_provider = 'google', ai_model = 'gemini-2.5-flash', operator_emails = array['ops@x.pl']")" \
  "model_needs_provider|ai_provider_check|operator_emails_check|operator_emails_check|ok"
check "S3 auth only on API sources; a header key needs a safe header name; the secret has no column at all" \
  "$(err "insert into public.grovnews_sources (name, source_type, url, auth_kind) values ('R', 'RSS', 'https://r.example.com/f', 'bearer')" | grep -o auth_api_only || true)|$(err "insert into public.grovnews_sources (name, source_type, url, auth_kind) values ('A', 'API', 'https://a1.example.com/v1', 'header')" | grep -o auth_header_shape || true)|$(err "insert into public.grovnews_sources (name, source_type, url, auth_kind, auth_header) values ('A', 'API', 'https://a2.example.com/v1', 'header', 'Host')" | grep -o auth_header_check || true)|$(err "insert into public.grovnews_sources (name, source_type, url, auth_kind, auth_header) values ('A', 'API', 'https://a3.example.com/v1', 'header', 'X-API-Key')")|$(q "select count(*) from information_schema.columns where table_name = 'grovnews_sources' and column_name ~ 'secret|token|key'")" \
  "auth_api_only|auth_header_shape|auth_header_check|ok|0"

echo
echo "H. HEALTH (0128 §2.1)"
API1=$(q "select id from public.grovnews_sources where url = 'https://a3.example.com/v1'")
check "H1 an API refusing our credential (auth_failed) or a missing secret is UNSUPPORTED at once; a timeout is not" \
  "$(q "select public.grovnews_source_checked('$TOKEN', '$API1', '{\"ok\":false,\"error\":\"auth_failed\",\"http\":401}'::jsonb)")|$(q "select public.grovnews_source_checked('$TOKEN', '$API1', '{\"ok\":false,\"error\":\"secret_missing\"}'::jsonb)")|$(q "select public.grovnews_source_checked('$TOKEN', '$OFF', '{\"ok\":false,\"error\":\"timeout\"}'::jsonb)")" \
  "UNSUPPORTED|UNSUPPORTED|DEGRADED"
check "H2 the job context tells the reader how an API source authenticates (never a secret)" \
  "$(q "select s->>'auth_kind' || '|' || (s->>'auth_header') from jsonb_array_elements(public.grovnews_job_context('$TOKEN')->'sources') s where s->>'id' = '$API1'")" \
  "header|X-API-Key"

echo
echo "G. PIPELINE (0128 §3–5)"
H_REJ=$(hash "story-baseline"); H_LIVE=$(hash "story-live")
REJ=$(q "insert into public.grovnews_research_items (source_id, canonical_url, normalized_url, source_title, content_hash, status, review_reason) values ('$OFF', 'https://gov.example.com/old', 'https://gov.example.com/old', 'Baseline', '$H_REJ', 'REJECTED', 'baseline') returning id")
LIVE=$(q "insert into public.grovnews_research_items (source_id, canonical_url, normalized_url, source_title, content_hash, status) values ('$OFF', 'https://gov.example.com/live', 'https://gov.example.com/live', 'Live', '$H_LIVE', 'NEW') returning id")
ingest "$UNO" "[$(item https://media-a.example.com/1 'Same story as baseline' "$H_REJ"),$(item https://media-a.example.com/2 'Same story as live' "$H_LIVE"),$(item https://media-a.example.com/3 'Points at a rejected one' "$(hash other)" "$REJ")]" >/dev/null
check "G7 a new report is NOT swallowed by a REJECTED (baseline) item — neither by hash nor by a duplicate_of pointing at it; a live story still absorbs its duplicate" \
  "$(q "select status || ':' || coalesce(duplicate_of::text, '-') from public.grovnews_research_items where canonical_url = 'https://media-a.example.com/1'")|$(q "select status || ':' || coalesce(duplicate_of::text, '-') from public.grovnews_research_items where canonical_url = 'https://media-a.example.com/3'")|$(q "select status || ':' || (duplicate_of = '$LIVE') from public.grovnews_research_items where canonical_url = 'https://media-a.example.com/2'")" \
  "NEW:-|NEW:-|DUPLICATE:true"
check "G7 …and the dedupe memory the job reads leaves rejected items out" \
  "$(q "select count(*) filter (where r->>'id' = '$REJ') || '/' || count(*) filter (where r->>'id' = '$LIVE') from jsonb_array_elements(public.grovnews_job_context('$TOKEN')->'recent') r")" "0/1"
ingest "$UNO" "[$(item https://media-a.example.com/4 'An English report' "$(hash en)" '' en),$(item https://media-a.example.com/5 'No language given' "$(hash none)")]" >/dev/null
check "G8 an item keeps its detected language; one without falls back to its source's" \
  "$(q "select string_agg(language, ',' order by canonical_url) from public.grovnews_research_items where canonical_url in ('https://media-a.example.com/4', 'https://media-a.example.com/5')")" "en,de"
R1=$(ingest "$UNO" "[$(item https://media-a.example.com/4 'An English report' "$(hash en)" '' en)]")
check "G13 re-reading the same feed is idempotent: the known URL is skipped, nothing new stored" \
  "$(echo "$R1" | field "['skipped']")|$(echo "$R1" | field "['inserted']")|$(q "select count(*) from public.grovnews_research_items where canonical_url = 'https://media-a.example.com/4'")" "1|0|1"
ORPH=$(mk "$OFF" "$CAT_AI" SELECTED 10 10); OLD=$(mk "$OFF" "$CAT_AI" SELECTED 10 10)
q "update public.grovnews_research_items set selected_at = now() - interval '1 day' where id = '$ORPH'; update public.grovnews_research_items set selected_at = now() - interval '9 days', discovered_at = now() - interval '9 days' where id = '$OLD'" >/dev/null
q "select public.grovnews_select_top('$TOKEN')" >/dev/null
check "G-ORPHAN a story SELECTED on an earlier day and never written goes back to the pool (fresh) or is REJECTED 'expired' (old)" \
  "$(q "select status || ':' || (selected_at is null) from public.grovnews_research_items where id = '$ORPH'")|$(q "select status || ':' || review_reason from public.grovnews_research_items where id = '$OLD'")" \
  "ANALYZED:true|REJECTED:expired"
check "G-CANDIDATES the day's candidates carry each report's own language" \
  "$(q "update public.grovnews_research_items set status = 'SELECTED', selected_at = now(), relevance_score = 90, importance_score = 90 where canonical_url = 'https://media-a.example.com/4'; select c->>'item_language' || '/' || (c->>'language') from jsonb_array_elements(public.grovnews_daily_candidates('$TOKEN', '$TODAY'::date)) c where c->>'url' = 'https://media-a.example.com/4'" | tail -1)" \
  "en/de"
q "update public.grovnews_research_items set status = 'REJECTED' where canonical_url = 'https://media-a.example.com/4'" >/dev/null

d() { echo "$TODAY" | python3 -c "import sys,datetime; print(datetime.date.fromisoformat(sys.stdin.read().strip()) - datetime.timedelta(days=$1))"; }
q "update public.grovnews_settings set ai_provider = null, ai_model = null, operator_emails = '{}', min_topics = 2" >/dev/null
V1=$(mk "$OFF" "$CAT_AI" SELECTED 80 80); V2=$(mk "$OFF" "$CAT_AI" SELECTED 80 80)
check "G15 REVIEW mode never publishes, even when the writer asks to" "$(daily "$(d 5)" "'$V1','$V2'" true | field "['status']")" "DRAFT"
q "update public.grovnews_settings set mode = 'AUTOMATIC'" >/dev/null
U1=$(mk "$UNO" "$CAT_AI" SELECTED 80 80); U2=$(mk "$OFF" "$CAT_AI" SELECTED 80 80)
W1=$(mk "$OFF" "$CAT_AI" SELECTED 80 80); W2=$(mk "$OFF" "$CAT_AI" SELECTED 80 80)
check "G16 AUTOMATIC publishes only a valid day: one unofficial single-source topic keeps it a DRAFT; an all-official day is PUBLISHED (edition too)" \
  "$(daily "$(d 6)" "'$U1','$U2'" true | field "['status']")|$(daily "$(d 7)" "'$W1','$W2'" true | field "['status']")|$(q "select status from public.grovnews_editions where edition_date = '$(d 7)'")" \
  "DRAFT|PUBLISHED|PUBLISHED"
T1=$(mk "$OFF" "$CAT_AI" SELECTED 80 80); T2=$(mk "$OFF" "$CAT_AI" SELECTED 80 80)
A=$(daily "$TODAY" "'$T1','$T2'" true); B=$(daily "$TODAY" "'$T1','$T2'" true)
check "G12 one edition a day: writing today twice returns the SAME article, one edition, and it is today's published one" \
  "$(echo "$A" | field "['post_id']")|$(echo "$B" | field "['created']")|$(q "select count(*) from public.grovnews_editions where edition_date = '$TODAY'")|$(q "select status from public.grovnews_editions where edition_date = '$TODAY'")" \
  "$(echo "$A" | field "['post_id']")|False|1|PUBLISHED"
EDT=$(q "select id from public.grovnews_editions where edition_date = '$TODAY'")
SLUG=$(q "select slug from public.grovnews_posts where id = '$(echo "$A" | field "['post_id']")'")

echo
echo "R. RUNS (0128 §6)"
q "update public.grovnews_settings set mode = 'REVIEW', daily_enabled = true, run_hour = 0" >/dev/null
STALE=$(q "insert into public.grovnews_runs (run_date, stage) values ('$(d 2)', 'ANALYZE') returning id")
CL=$(q "select public.grovnews_run_claim('$TOKEN', 'CRON')")
RUN=$(echo "$CL" | field "['run_id']")
check "R1 a RUNNING run of an earlier day is closed as FAILED 'abandoned'; today's run is claimed" \
  "$(q "select status || ':' || error || ':' || (finished_at is not null) from public.grovnews_runs where id = '$STALE'")|$(echo "$CL" | field "['claimed']")" \
  "FAILED:abandoned:true|True"
q "select public.grovnews_run_update('$TOKEN', '$RUN', 'ANALYZE', null, '{}'::jsonb, 'provider_down', true)" >/dev/null
q "select public.grovnews_run_update('$TOKEN', '$RUN', 'DONE', 'DONE', '{}'::jsonb, null, false)" >/dev/null
check "R2 a run that reaches DONE drops the error an earlier invocation left" \
  "$(q "select status || ':' || coalesce(error, 'none') from public.grovnews_runs where id = '$RUN'")" "DONE:none"
q "delete from public.grovnews_runs where id = '$RUN'" >/dev/null
q "update public.grovnews_settings set mode = 'AUTOMATIC'" >/dev/null
if [ "$HOUR" -lt 23 ]; then
  RUN2=$(q "insert into public.grovnews_runs (run_date, stage) values ('$TODAY', 'DRAFT') returning id")
  q "update public.grovnews_settings set publish_hour = $((HOUR + 1)), send_hour = $((HOUR + 1))" >/dev/null
  check "R3 AUTOMATIC at DRAFT before publish_hour: the claim WAITS (no attempt spent), the tick does not dispatch" \
    "$(q "select public.grovnews_run_claim('$TOKEN', 'CRON')" | field "['reason']")|$(q "select invocations from public.grovnews_runs where id = '$RUN2'")|$(q "select public.grovnews_cron_tick()")|$(q "select count(*) from t.posts")" \
    "waiting_publish|0|waiting_publish|0"
  q "update public.grovnews_runs set stage = 'SEND' where id = '$RUN2'" >/dev/null
  check "R4 at SEND before send_hour: waits too (claim and tick)" \
    "$(q "select public.grovnews_run_claim('$TOKEN', 'CRON')" | field "['reason']")|$(q "select public.grovnews_cron_tick()")" "waiting_send|waiting_send"
  q "update public.grovnews_settings set mode = 'REVIEW'" >/dev/null
  check "R4b REVIEW mode never waits for the hours (a person decides)" \
    "$(q "select public.grovnews_run_claim('$TOKEN', 'CRON')" | field "['claimed']")" "True"
  q "update public.grovnews_settings set mode = 'AUTOMATIC', publish_hour = null, send_hour = null; update public.grovnews_runs set locked_until = null where id = '$RUN2'" >/dev/null
else
  note "R3/R4 skipped: it is 23:00 in Warsaw, no later hour exists to wait for"
  RUN2=$(q "insert into public.grovnews_runs (run_date, stage) values ('$TODAY', 'SEND') returning id")
fi
q "insert into vault.decrypted_secrets values ('grovbase.newsletter.worker_url', 'https://app.example.com/api/newsletter/worker'), ('grovbase.newsletter.worker_token', 'tok')" >/dev/null
check "R5 the tick keeps dispatching until the run is DONE (posts to /api/cron/grovnews with the token); DONE → no more; switched off → nothing" \
  "$(q "select public.grovnews_cron_tick()")|$(q "select url from t.posts limit 1")|$(q "update public.grovnews_runs set status = 'DONE' where id = '$RUN2'; select public.grovnews_cron_tick()" | tail -1)|$(q "update public.grovnews_settings set daily_enabled = false; select public.grovnews_cron_tick()" | tail -1)" \
  "posted:42|https://app.example.com/api/cron/grovnews|done|disabled"

echo
echo "M. RECIPIENTS AND THE DIGEST (0128 §7–8)"
q "update public.grovnews_settings set mode = 'AUTOMATIC', email_enabled = true, send_hour = null" >/dev/null
mkuser() { # email, [confirmed]
  q "select t.usr('$1', ${2:-true})"
}
ent() { q "insert into public.grovnews_entitlements (user_id, status, starts_at, expires_at) values ('$1', '${2:-ACTIVE}', now() - interval '2 days', ${3:-null})" >/dev/null; }
contact() { q "insert into public.newsletter_contacts (email, user_id, marketing_consent) values ('$1', ${2:-null}, ${3:-true})" >/dev/null; }
U1=$(mkuser m1@x.pl); ent "$U1"; contact m1@x.pl "'$U1'"
U2=$(mkuser m2@x.pl); contact m2@x.pl "'$U2'"
U3=$(mkuser m3@x.pl); ent "$U3" ACTIVE "now() - interval '1 day'"; contact m3@x.pl "'$U3'"
U4=$(mkuser m4@x.pl); ent "$U4" REVOKED; contact m4@x.pl "'$U4'"
U5=$(mkuser m5@x.pl); ent "$U5"; contact m5@x.pl "'$U5'"; q "update public.newsletter_contacts set unsubscribed_at = now() where email = 'm5@x.pl'" >/dev/null
U6=$(mkuser m6@x.pl); ent "$U6"; contact m6@x.pl "'$U6'"; q "insert into public.newsletter_suppressions values ('m6@x.pl')" >/dev/null
U7=$(mkuser m7@x.pl); ent "$U7"; contact m7@x.pl "'$U7'"; q "update public.profiles set blocked = true where id = '$U7'" >/dev/null
U8=$(mkuser m8@x.pl); ent "$U8"; contact m8-old@x.pl "'$U8'"; contact m8@x.pl
U9=$(mkuser m9@x.pl); ent "$U9"; contact m9-unverified@x.pl "'$U9'"
U10=$(mkuser m10@x.pl false); ent "$U10"; contact m10@x.pl "'$U10'"
UA=$(mkuser admin-reader@x.pl); q "update public.profiles set role = 'admin' where id = '$UA'" >/dev/null; contact admin-reader@x.pl "'$UA'"

GOOD="<p>Intro</p><p><a href=\"https://grovbase.com/grovnews/$SLUG#t1\">Czytaj więcej</a></p><p><a href=\"https://grovbase.com/grovnews/$SLUG#t2\">Czytaj więcej</a></p><p><a href=\"https://grovbase.com/grovnews/$SLUG\">Otwórz całe dzisiejsze wydanie</a></p>"
passes() { # body → passed_guard when every guard lets it through (rolled back)
  err "do \$x\$ begin perform public.grovnews_edition_send('$TOKEN', '$EDT', 's', 'p', \$b\$$1\$b\$, '{}', '{}'::jsonb); raise exception 'passed_guard'; end \$x\$" | grep -o 'foreign_link\|passed_guard\|not_send_time\|edition_not_published'
}
check "M9 the digest may link to the article and its topic anchors (#t1, #t2); another anchor form, a query string, another slug, another site are refused" \
  "$(passes "$GOOD")|$(passes "<a href=\"https://grovbase.com/grovnews/$SLUG#t100\">x</a>")|$(passes "<a href=\"https://grovbase.com/grovnews/$SLUG#top\">x</a>")|$(passes "<a href=\"https://grovbase.com/grovnews/$SLUG?x=1\">x</a>")|$(passes "<a href=\"https://grovbase.com/grovnews/inny-wpis\">x</a>")|$(passes "<a href=\"https://evil.example.com/\">x</a><a href=\"https://grovbase.com/grovnews/$SLUG\">y</a>")" \
  "passed_guard|foreign_link|foreign_link|foreign_link|foreign_link|foreign_link"
if [ "$HOUR" -lt 23 ]; then
  q "update public.grovnews_settings set send_hour = $((HOUR + 1))" >/dev/null
  check "M-HOUR AUTOMATIC mail waits for send_hour at the door itself" "$(passes "$GOOD")" "not_send_time"
  q "update public.grovnews_settings set send_hour = null" >/dev/null
else
  note "M-HOUR skipped: it is 23:00 in Warsaw"
fi
q "update public.grovnews_editions set status = 'DRAFT' where id = '$EDT'" >/dev/null 2>&1 || true
check "M10 only the PUBLISHED edition can be mailed (a draft is refused at the door)" \
  "$(passes "$GOOD")" "edition_not_published"
q "update public.grovnews_editions set status = 'READY' where id = '$EDT'; update public.grovnews_editions set status = 'PUBLISHED', published_at = now() where id = '$EDT'" >/dev/null
R=$(q "select public.grovnews_edition_send('$TOKEN', '$EDT', 'GrovNews — dziś', 'p', \$b\$$GOOD\$b\$, array['https://grovbase.com/grovnews/$SLUG#t1', 'https://grovbase.com/grovnews/$SLUG'], '{\"source\":\"grovnews\"}'::jsonb)")
LIST=$(q "select string_agg(email, ',' order by email) from public.newsletter_recipients")
check "M1–M7 queued: only the active entitlement with consent and a verified address (m1, m8) — not no-entitlement, expired, revoked, unsubscribed, suppressed, blocked, unconfirmed" \
  "$(echo "$R" | field "['status']")|$(echo "$R" | field "['recipients']")|$LIST" "queued|2|m1@x.pl,m8@x.pl"
check "M8 one person, one copy: the user with a linked contact on an OLD address and a contact on the verified address gets exactly one — the verified one; a contact whose address is not the verified one is never mailed" \
  "$(q "select count(*) from public.newsletter_recipients where email like 'm8%'")|$(q "select email from public.newsletter_recipients where email like 'm8%'")|$(q "select count(*) from public.newsletter_recipients where email like 'm9%'")" \
  "1|m8@x.pl|0"
# Eligible = access + a verified address (m1, m5, m6, m8); consent, unsubscribe and
# suppression are the queue's own filters on top (M5/M6 above).
check "M8 …the eligible set has at most one contact per person (group sync and the send guard ask the same function)" \
  "$(q "select count(*) = count(distinct c.user_id) + count(*) filter (where c.user_id is null) from public.newsletter_contacts c where c.id in (select public.grovnews_eligible_contacts(null))")|$(q "select string_agg(c.email, ',' order by c.email) from public.newsletter_contacts c where c.id in (select public.grovnews_eligible_contacts(null))")" "t|m1@x.pl,m5@x.pl,m6@x.pl,m8@x.pl"
R2=$(q "select public.grovnews_edition_send('$TOKEN', '$EDT', 'GrovNews — dziś', 'p', \$b\$$GOOD\$b\$, '{}', '{}'::jsonb)")
check "M8/G12 a retry of the same day: already queued — no second campaign, no second copy" \
  "$(echo "$R2" | field "['status']")|$(q "select count(*) from public.newsletter_campaigns")|$(q "select count(*) from public.newsletter_recipients")" "already_queued|1|2"
q "update public.grovnews_entitlements set status = 'REVOKED' where user_id = '$U1'" >/dev/null
check "M4 at SEND time: access revoked after queueing → the send guard refuses that row (0122 guard, 0128 rule); the other stays allowed" \
  "$(q "select string_agg(r.email || ':' || g.allowed, ',' order by r.email) from public.grovnews_send_guard('$TOKEN', (select array_agg(id) from public.newsletter_recipients)) g join public.newsletter_recipients r on r.id = g.recipient_id")" \
  "m1@x.pl:false,m8@x.pl:true"
q "update public.grovnews_settings set operator_emails = array['ops@x.pl', 'sup-op@x.pl']; insert into public.newsletter_suppressions values ('sup-op@x.pl')" >/dev/null
check "M-OPS operator copies go to the configured addresses minus suppressed ones; only the job's token or an admin may ask" \
  "$(q "select array_to_string(public.grovnews_operator_recipients('$TOKEN'), ',')")|$(err "select public.grovnews_operator_recipients('nope')" anon)|$(as_user "$ADMIN" "select array_to_string(public.grovnews_operator_recipients(''), ',')")" \
  "ops@x.pl|forbidden|ops@x.pl"

echo
if [ "$fails" -eq 0 ]; then echo "grovnews6-sql: all checks passed"; else echo "grovnews6-sql: $fails check(s) FAILED"; fi
exit $fails
