#!/usr/bin/env bash
#
# GROVBASE SHOT — THE KNOWLEDGE FILE: FLEXIBLE IMPORT, GUARDED ACTIVATION
# (0166 + 0182), PROVEN AGAINST A REAL POSTGRES.
#
# 0164, 0166 and 0182 are loaded VERBATIM (0182 twice: it must re-run
# cleanly) on the shape of the 0042/0126 tables they extend. The uploads are
# built by the admin action's own function (buildKbImport) from the files in
# docs/grovshot-shot/. What has to hold:
#   · any readable .md is saved: the 07–08.11 files, the 15.11 file as
#     written, a file with no recipe at all (a draft), the same file with
#     Windows line ends and a BOM — each byte for byte (sha256 of the stored
#     text = the file's), each a NEW INACTIVE version;
#   · an import never changes the active version, nor what the engine reads;
#   · a draft the engine cannot run on is refused at activation
#     (not_engine_ready) and nothing changes — no event, same active version;
#   · activating the 15.11 file: new orders read it, an order that pinned the
#     earlier version still reads that one; rollback = activating the earlier;
#   · admin only (a customer can neither import nor activate);
#   · the stored parses of every engine-ready version pass the database's
#     readiness test, the draft's does not — the same verdict as readKb().
#
#   bash scripts/pg-harness-up.sh && npm run test:grovshot-kb:sql
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
DB="${GSKB_DB:-gskb_sqltest}"
PSQL0=(psql -h "$PGSOCK" -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -X -q -t -A)
PSQL=("${PSQL0[@]}" -d "$DB")

if ! "${PSQL0[@]}" -d postgres -c 'select 1' >/dev/null 2>&1; then
  echo "grovshot-kb-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
M="$ROOT/supabase/migrations"
extract() { awk -v start="^create (or replace )?function public[.]$2[(]" -v stop="$3" '$0 ~ start {on=1} on {print} on && $0 ~ stop {exit}' "$1"; }
IS_ADMIN=$(extract "$M/0002_functions_and_triggers.sql" is_admin '^[$][$];')
SERVER_CALL_OK=$(extract "$M/0077_server_only_rpcs.sql" server_call_ok '^end [$][$];')
LOG_ACTIVITY=$(extract "$M/0036_definer_function_hardening.sql" log_activity '^end [$][$];')
for v in IS_ADMIN SERVER_CALL_OK LOG_ACTIVITY; do [ -n "${!v}" ] || { echo "grovshot-kb-sql: could not extract $v" >&2; exit 2; }; done

WORK=$(mktemp -d)
cleanup() { rm -rf "$WORK"; [ "${KEEP_DB:-0}" = "1" ] || "${PSQL0[@]}" -d postgres -c "drop database if exists $DB with (force)" >/dev/null 2>&1 || true; }
trap cleanup EXIT
(cd "$ROOT" && npx esbuild scripts/grovshot-kb-payloads.ts --bundle --platform=node --format=cjs --alias:@=. --outfile="$WORK/payloads.cjs" --log-level=error \
  && node "$WORK/payloads.cjs" "$WORK/payloads.sql")

PGOPTIONS="-c client_min_messages=warning" "${PSQL0[@]}" -d postgres -c "drop database if exists $DB with (force)" >/dev/null
"${PSQL0[@]}" -d postgres -c "create database $DB" >/dev/null

fails=0
check() { if [ "$2" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1 — got [$2], expected [$3]"; fails=$((fails+1)); fi; }
q() { "${PSQL[@]}" -c "$1"; }
as() {
  local out
  out=$("${PSQL[@]}" -c "set role ${3:-authenticated}; select set_config('request.jwt.claim.sub', '$1', false); $2" 2>&1 || true)
  if echo "$out" | grep -q 'ERROR:'; then echo "$out" | sed -n 's/^.*ERROR:  //p' | head -1
  else echo "$out" | grep -v '^$' | tail -1; fi
}
TOKEN='the-right-dispatch-token'
UA=00000000-0000-0000-0000-00000000000a   # admin
UC=00000000-0000-0000-0000-00000000000c   # customer

"${PSQL[@]}" >/dev/null <<SQL
set client_min_messages = warning;
create schema auth; create schema extensions; create schema storage;
create extension if not exists pgcrypto with schema extensions;
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end \$\$;
grant usage on schema public, auth, extensions, storage to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
create function auth.uid() returns uuid language sql stable as \$f\$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid \$f\$;
create table auth.users (id uuid primary key);
create table public.app_settings (key text primary key, value jsonb not null default '{}'::jsonb);
insert into public.app_settings values ('notifications', jsonb_build_object('dispatch_hash', encode(extensions.digest('$TOKEN', 'sha256'), 'hex')));
create table public.profiles (id uuid primary key, role text not null default 'user', full_name text, email text);
insert into auth.users values ('$UA'), ('$UC');
insert into public.profiles values ('$UA', 'admin', 'Admin', 'admin@example.test'), ('$UC', 'user', 'Klient', 'c@example.test');
create table public.workspace_members (workspace_id uuid not null, user_id uuid not null);
create function public.is_workspace_member(ws uuid) returns boolean language sql stable as \$f\$ select exists (select 1 from public.workspace_members where workspace_id = ws and user_id = auth.uid()) \$f\$;
create table public.activity_logs (id bigserial primary key, workspace_id uuid, actor_id uuid, on_behalf_of uuid, action text, entity_type text, entity_id uuid, metadata jsonb, created_at timestamptz default now());
create table storage.objects (bucket_id text, name text, metadata jsonb);
$IS_ADMIN
$SERVER_CALL_OK
$LOG_ACTIVITY
grant select on public.profiles to authenticated;
create table public.knowledge_sets (
  id uuid primary key default gen_random_uuid(), name text not null, product_category text, product_description text, model text,
  status text not null default 'uploaded', error text, notes text, doc_text text, file_count integer not null default 0, zip_path text,
  version integer not null default 1, created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.knowledge_examples (
  id uuid primary key default gen_random_uuid(), set_id uuid not null references public.knowledge_sets(id) on delete cascade,
  reference_path text, generated_path text, prompt_used text, result_rating integer check (result_rating between 1 and 5),
  what_worked text, what_failed text, correction text, tags text[] not null default '{}', enabled boolean not null default true,
  created_at timestamptz not null default now(), review_status text not null default 'approved', scene text, product_category text,
  confidence numeric(4, 3), source_kind text not null default 'zip', source_ref text, reviewed_by uuid references auth.users(id), reviewed_at timestamptz);
alter table public.knowledge_sets enable row level security;
create policy ks_admin_all on public.knowledge_sets using (public.is_admin());
alter table public.knowledge_examples enable row level security;
create policy ke_admin_all on public.knowledge_examples using (public.is_admin());
SQL
# 0166 also ships the engine's queue/test/library functions, typed on tables of
# other migrations (ai_engine_runs …) this harness does not build: their
# bodies are not compiled here (check_function_bodies off for 0166 only).
PGOPTIONS="-c client_min_messages=error" "${PSQL[@]}" -f "$M/0164_grovshot_v2_knowledge.sql" >/dev/null
PGOPTIONS="-c client_min_messages=error -c check_function_bodies=off" "${PSQL[@]}" -f "$M/0166_grovshot_shot_engine.sql" >/dev/null
for i in 1 2; do PGOPTIONS="-c client_min_messages=error" "${PSQL[@]}" -f "$M/0182_grovshot_kb_activation_guard.sql" >/dev/null; done
"${PSQL[@]}" >/dev/null <<SQL
create table public.t_payload (name text primary key, body jsonb not null, ready boolean not null);
grant select on public.t_payload to authenticated;
SQL
"${PSQL[@]}" -f "$WORK/payloads.sql" >/dev/null
echo "grovshot-kb-sql: 0164 + 0166 + 0182 (twice) loaded; uploads built by buildKbImport"

imp() { as "$UA" "select public.grovshot_shot_kb_import((select body from t_payload where name = '$1'), null)::text"; }
act() { as "$UA" "select public.grovshot_shot_kb_activate((select id from knowledge_versions where tool_key = 'grovshot_shot' and version = $1), 'test')::text"; }
active() { q "select coalesce(string_agg(version::text, ','), '-') from knowledge_versions where tool_key = 'grovshot_shot' and active"; }
engine() { as "$UC" "select (public.grovshot_shot_kb('$TOKEN', $1)->>'version')" anon; }
vid() { echo "'$(q "select id from knowledge_versions where tool_key = 'grovshot_shot' and version = $1")'::uuid"; }

echo "technical checks only (before the database)"
check "empty, not .md, no note, binary, too large → refused by name" "$(q "select body #>> '{}' from t_payload where name = 'refused'")" "empty_file,not_markdown,change_note_required,unreadable,file_too_large"
check "the 15.11 file is ready for the engine as written; the notes file is a draft" "$(q "select string_agg(name || ':' || ready, ',' order by name) from t_payload where name <> 'refused'")" "crlf:true,draft:false,v1:true,v2new:true,v2old:true"

echo "import = a new inactive version, the file byte for byte"
check "v1 (07.11 format) imported" "$(imp v1 | sed 's/"id": "[^"]*", //')" '{"version": 1, "duplicate": false}'
check "activate v1" "$(act 1 | sed 's/, "from_version": null//')" '{"action": "activated", "version": 1}'
check "the 15.11 file imported as v2, with no edits" "$(imp v2new | sed 's/"id": "[^"]*", //')" '{"version": 2, "duplicate": false}'
check "…inactive: v1 stays active and new orders still read v1" "$(active):$(engine null)" "1:1"
check "…stored byte for byte (sha256 of the stored text = the file's)" "$(q "select (s.sha256 = encode(extensions.digest(s.content, 'sha256'), 'hex') and s.sha256 = (select body->>'sha256' from t_payload where name = 'v2new'))::text from knowledge_versions v join knowledge_sources s on s.id = v.source_id where v.version = 2")" "true"
check "…its parse: 19 recipes, 7 flags, 9 footers (one default), 42 negative items" "$(q "select jsonb_array_length(parsed->'recipes') || ':' || jsonb_array_length(parsed->'special') || ':' || jsonb_array_length(parsed->'footers') || ':' || (select count(*) from jsonb_array_elements(parsed->'footers') f where f->'when'->>'isDefault' = 'true') || ':' || jsonb_array_length(parsed->'negativeItems') from knowledge_versions where version = 2")" "19:7:9:1:42"
check "…summary says engine_ready, no blockers" "$(q "select (summary->>'engine_ready') || ':' || (summary->'blockers')::text from knowledge_versions where version = 2")" "true:[]"
check "a file with no recipe is saved too (v3), as a draft" "$(imp draft | sed 's/"id": "[^"]*", //')" '{"version": 3, "duplicate": false}'
check "…its summary: not engine-ready, why" "$(q "select (summary->>'engine_ready') || ':' || (summary->'blockers')::text from knowledge_versions where version = 3")" 'false:["no_recipes", "no_footers"]'
check "the same file with CRLF + BOM is its own version, stored as sent" "$(imp crlf | sed 's/"id": "[^"]*", //')" '{"version": 4, "duplicate": false}'
check "…its stored text keeps the BOM and the CRLF" "$(q "select (left(s.content, 1) = chr(65279) and position(chr(13) || chr(10) in s.content) > 0 and s.sha256 = encode(extensions.digest(s.content, 'sha256'), 'hex'))::text from knowledge_versions v join knowledge_sources s on s.id = v.source_id where v.version = 4")" "true"
check "…and reads exactly like the plain file (same parse hash)" "$(q "select (a.content_sha256 = b.content_sha256)::text from knowledge_versions a, knowledge_versions b where a.version = 2 and b.version = 4")" "true"
check "uploading the same bytes again = the existing version" "$(imp v2new | sed 's/"id": "[^"]*", //')" '{"version": 2, "duplicate": true}'
check "four imports later v1 is still the only active version" "$(active)" "1"

echo "activation: never an incompatible version"
EV0=$(q "select count(*) from knowledge_version_events")
check "activating the draft is refused (not_engine_ready)" "$(act 3)" '{"error": "not_engine_ready", "version": 3}'
check "…nothing changed: v1 active, no event, new orders read v1" "$(active):$(q "select count(*) from knowledge_version_events"):$(engine null)" "1:$EV0:1"
check "the database's readiness = readKb's verdict for every stored parse" "$(q "select string_agg(version || ':' || public.grovshot_shot_kb_ready(parsed), ',' order by version) from knowledge_versions")" "1:true,2:true,3:false,4:true"
check "a broken shape is never ready (no format, recipes not an array, no default footer)" "$(q "select public.grovshot_shot_kb_ready('{}'::jsonb) || ',' || public.grovshot_shot_kb_ready(jsonb_set(parsed, '{recipes}', '{}'::jsonb)) || ',' || public.grovshot_shot_kb_ready(jsonb_set(parsed, '{footers}', '[]'::jsonb)) from knowledge_versions where version = 2")" "false,false,false"

echo "activate the 15.11 file, pinned orders, rollback"
check "activate v2 (the 15.11 file)" "$(act 2)" '{"action": "activated", "version": 2, "from_version": 1}'
check "new orders read v2; an order that pinned v1 still reads v1" "$(engine null):$(engine "$(vid 1)")" "2:1"
check "rollback to v1" "$(act 1)" '{"action": "rolled_back", "version": 1, "from_version": 2}'
check "…new orders read v1 again; v2 remains readable by its pin" "$(engine null):$(engine "$(vid 2)")" "1:2"
check "the history: 4 imports, activated ×2, rolled_back ×1" "$(q "select string_agg(action || '=' || n, ',' order by action) from (select action, count(*) n from knowledge_version_events group by action) x")" "activated=2,imported=4,rolled_back=1"
check "every import/activation/rollback is in the activity log" "$(q "select string_agg(action || '=' || n, ',' order by action) from (select action, count(*) n from activity_logs where action like 'admin.grovshot_kb_%' group by action) x")" "admin.grovshot_kb_activated=2,admin.grovshot_kb_imported=4,admin.grovshot_kb_rolled_back=1"

echo "admin only"
check "a customer cannot import" "$(as "$UC" "select public.grovshot_shot_kb_import((select body from t_payload where name = 'v2old'), null)")" "forbidden"
check "a customer cannot activate" "$(as "$UC" "select public.grovshot_shot_kb_activate((select id from knowledge_versions where version = 2), 'x')")" "forbidden"
check "anon cannot call the readiness test" "$(as "$UC" "select public.grovshot_shot_kb_ready('{}'::jsonb)" anon | grep -c 'permission denied')" "1"

echo
if [ "$fails" -eq 0 ]; then echo "grovshot-kb-sql: all checks passed"; else echo "grovshot-kb-sql: $fails check(s) failed"; exit 1; fi
