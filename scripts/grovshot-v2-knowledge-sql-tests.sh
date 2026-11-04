#!/usr/bin/env bash
#
# GROVBASE SHOT V2 — THE EXPERT KNOWLEDGE BASE (0164 + the 0165 seed),
# PROVEN AGAINST A REAL POSTGRES.
#
# Both migrations are loaded VERBATIM, each TWICE (they must re-run cleanly),
# on the shape of the 0042/0126 tables they extend; the helpers come from the
# migrations that ship them (is_admin 0002, server_call_ok 0077, log_activity
# 0036). What has to hold:
#   · the seed: Kuba's set becomes V2's, MD = primary source (full text,
#     sha256), PDF = confirmation (sha only when the stored size matches),
#     every rule PENDING, the 03.11 correction supersedes the 03.11 recipe, the
#     page-2 diagram "example" rejected — and a second run adds nothing;
#   · admin only: a customer reads no rule, cannot review, publish or preview;
#   · an approved rule's content is frozen (rule_immutable), status moves only
#     along the review paths; approving a correction supersedes what it names;
#   · publish: nothing approved → no_rules; a version = the approved rules,
#     one active; the same content again → no_changes; rollback = activate;
#   · the snapshot: only with the server token (or an admin's preview), only
#     the active version's SENT rules (delivery = knowledge), never the others.
#
#   bash scripts/pg-harness-up.sh && npm run test:grovshot2:knowledge:sql
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
DB="${GSV2K_DB:-gsv2_knowledge_sqltest}"
PSQL0=(psql -h "$PGSOCK" -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -X -q -t -A)
PSQL=("${PSQL0[@]}" -d "$DB")

if ! "${PSQL0[@]}" -d postgres -c 'select 1' >/dev/null 2>&1; then
  echo "gsv2-knowledge-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
M="$ROOT/supabase/migrations"
F1="$M/0164_grovshot_v2_knowledge.sql"
SEED=$(ls "$M"/0165_grovshot_v2_knowledge_seed_*.sql | sort -t_ -k6 -n)
extract() { awk -v start="^create (or replace )?function public[.]$2[(]" -v stop="$3" '$0 ~ start {on=1} on {print} on && $0 ~ stop {exit}' "$1"; }
IS_ADMIN=$(extract "$M/0002_functions_and_triggers.sql" is_admin '^[$][$];')
SERVER_CALL_OK=$(extract "$M/0077_server_only_rpcs.sql" server_call_ok '^end [$][$];')
LOG_ACTIVITY=$(extract "$M/0036_definer_function_hardening.sql" log_activity '^end [$][$];')
for v in IS_ADMIN SERVER_CALL_OK LOG_ACTIVITY; do [ -n "${!v}" ] || { echo "gsv2-knowledge-sql: could not extract $v" >&2; exit 2; }; done

cleanup() { [ "${KEEP_DB:-0}" = "1" ] || "${PSQL0[@]}" -d postgres -c "drop database if exists $DB with (force)" >/dev/null 2>&1 || true; }
trap cleanup EXIT
PGOPTIONS="-c client_min_messages=warning" "${PSQL0[@]}" -d postgres -c "drop database if exists $DB with (force)" >/dev/null
"${PSQL0[@]}" -d postgres -c "create database $DB" >/dev/null

fails=0
check() { if [ "$2" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1 — got [$2], expected [$3]"; fails=$((fails+1)); fi; }
q() { "${PSQL[@]}" -c "$1"; }
# As an authenticated user (or anon with no uid): the error text or the value.
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
create table public.profiles (id uuid primary key, role text not null default 'user');
insert into auth.users values ('$UA'), ('$UC');
insert into public.profiles values ('$UA', 'admin'), ('$UC', 'user');
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

-- PROD's state on 03.11: the PDF imported as a set, its one guessed example pending.
insert into public.knowledge_sets (name, status, doc_text, file_count, zip_path, created_by)
values ('GrovBase Shot – specyfikacja silnika lifestyle', 'ready', '=== 1 ===
GrovBase Shot – specyfikacja silnika lifestyle', 20, 'sets/S/source.pdf', '$UA');
insert into storage.objects values ('knowledge', 'sets/S/source.pdf', '{"size": "665372"}');
insert into public.knowledge_examples (set_id, reference_path, review_status, source_kind, source_ref, confidence)
select id, 'sets/S/pdf/001-before.jpg', 'pending', 'pdf', 'pdf page 2', 0.2 from public.knowledge_sets;
SQL

for f in "$F1" "$F1" $SEED $SEED; do PGOPTIONS="-c client_min_messages=warning" "${PSQL[@]}" -f "$f" >/dev/null; done
echo "gsv2-knowledge-sql: 0164 + 0165 (parts $(echo $SEED | wc -w)) loaded twice each"

echo "the seed"
check "the set is GrovShot V2's" "$(q "select scope from knowledge_sets")" "grovshot_v2"
check "MD = primary, PDF = confirmation (one each, after two runs)" "$(q "select string_agg(format||':'||role, ',' order by format) from knowledge_sources")" "md:primary,pdf:confirmation"
check "MD: the full document, its sha256" "$(q "select (content_chars > 37000)::text || ':' || sha256 from knowledge_sources where format = 'md'")" "true:42347b65326e6f6fab76fd8c91cc77861759d4ed3ed7f2127646286db2527cd8"
check "MD: Polish letters and the 03.11 correction kept" "$(q "select (content like '%Korekta przepisu świątecznego (03.11)%' and content like '%licencjonowanymi%')::text from knowledge_sources where format = 'md'")" "true"
check "PDF: sha256 only because the stored size matches" "$(q "select sha256 is not null from knowledge_sources where format = 'pdf'")" "t"
check "201 MD rules + the PDF diagram, all pending (two runs, no duplicates)" "$(q "select count(*) || ':' || count(*) filter (where status = 'pending') from knowledge_rules")" "202:202"
check "80 rules are sent to models, the rest is config/template/code/reference" "$(q "select count(*) filter (where delivery = 'knowledge') from knowledge_rules")" "80"
check "the 03.11 Christmas correction supersedes the 03.11 recipe" "$(q "select count(*) from knowledge_rules c join knowledge_rules r on r.id = any(c.supersedes) where c.title like 'Korekta przepisu świątecznego%' and r.title like 'Przepis „świąteczna aura”%'")" "1"
check "the CO-detector correction is scoped to its category, not global" "$(q "select scope_kind from knowledge_rules where title like 'Korekta (czujnik czadu%'")" "category"
check "the page-2 diagram example is rejected (never a quality example)" "$(q "select review_status || ':' || array_to_string(tags, ',') from knowledge_examples")" "rejected:schemat_workflow"

echo "admin only"
check "a customer reads no rule" "$(as "$UC" "select count(*) from public.knowledge_rules")" "0"
check "a customer cannot review" "$(as "$UC" "select public.grovshot_knowledge_review(array(select id from public.knowledge_rules limit 1), 'approved', null)")" "forbidden"
check "a customer cannot publish" "$(as "$UC" "select public.grovshot_knowledge_publish('x')")" "forbidden"
check "a customer cannot preview" "$(as "$UC" "select public.grovshot_knowledge_snapshot('', true)")" "forbidden"
check "anon cannot even call the snapshot" "$(as "" "select public.grovshot_knowledge_snapshot('$TOKEN', false)" anon)" "permission denied for function grovshot_knowledge_snapshot"
check "nothing approved → nothing to publish" "$(as "$UA" "select public.grovshot_knowledge_publish('v1')->>'error'")" "no_rules"
check "no version → the server's snapshot is empty" "$(as "$UC" "select coalesce(public.grovshot_knowledge_snapshot('$TOKEN', false)::text, 'null')")" "null"

echo "review, immutability, supersede"
check "order does not matter: the correction approved first…" "$(as "$UA" "select public.grovshot_knowledge_review(array(select id from public.knowledge_rules where title like 'Korekta przepisu świątecznego%'), 'approved', null)")" "1"
check "…then the recipe it replaces ends superseded at once" "$(as "$UA" "select public.grovshot_knowledge_review(array(select id from public.knowledge_rules where title like 'Przepis „świąteczna aura”%'), 'approved', null); select status from public.knowledge_rules where title like 'Przepis „świąteczna aura”%'")" "superseded"
check "the admin approves every MD rule" "$(as "$UA" "select public.grovshot_knowledge_review(array(select id from public.knowledge_rules where origin = 'document' and section not like 'Architektura (PDF)%'), 'approved', 'import 03.11')")" "200"
check "approving the correction superseded the recipe it names" "$(q "select status from knowledge_rules where title like 'Przepis „świąteczna aura”%'")" "superseded"
check "an approved rule's text is frozen" "$(as "$UA" "update public.knowledge_rules set body = 'x' where title like 'Hero%' returning id")" "rule_immutable"
check "an approved rule cannot go back to pending" "$(as "$UA" "update public.knowledge_rules set status = 'pending' where title like 'Hero%' returning id")" "invalid_transition"
check "a pending rule can be edited (the diagram)" "$(as "$UA" "update public.knowledge_rules set review_note = 'ok' where page = 2 returning review_note")" "ok"
check "the review is logged" "$(q "select count(*) from activity_logs where action = 'admin.knowledge_rules_reviewed'")" "3"

echo "publish, versions, rollback"
check "publish v1" "$(as "$UA" "select (public.grovshot_knowledge_publish('Specyfikacja Kuby 27.10–03.11')->>'version')")" "1"
check "v1 lists the 200 approved rules (the superseded recipe out), 80 sent" "$(q "select rule_count || ':' || delivered_count || ':' || active from knowledge_versions where version = 1")" "200:80:true"
check "the same content again → no_changes" "$(as "$UA" "select public.grovshot_knowledge_publish('again')->>'error'")" "no_changes"
check "the server's snapshot: v1, only the sent rules" "$(as "$UC" "select (s->>'version') || ':' || jsonb_array_length(s->'rules') from (select public.grovshot_knowledge_snapshot('$TOKEN', false) s) x")" "1:80"
check "the snapshot never carries a config/template/reference rule" "$(as "$UC" "select count(*) from jsonb_array_elements(public.grovshot_knowledge_snapshot('$TOKEN', false)->'rules') r where r->>'title' like 'Reklama sezonowa%' or r->>'title' like 'Schemat%'")" "0"
check "without the token the snapshot is refused" "$(as "$UC" "select public.grovshot_knowledge_snapshot('wrong', false)")" "forbidden"
check "retire one rule (cofnięcie)" "$(as "$UA" "select public.grovshot_knowledge_review(array(select id from public.knowledge_rules where title like 'Mgiełka, para, dym%'), 'retired', 'test')")" "1"
check "an admin's preview already follows the approved rules (79 sent)" "$(as "$UA" "select jsonb_array_length(public.grovshot_knowledge_snapshot('', true)->'rules')")" "79"
check "…while orders still get v1 (80) until a version is published" "$(as "$UC" "select jsonb_array_length(public.grovshot_knowledge_snapshot('$TOKEN', false)->'rules')")" "80"
check "publish v2 — v1 no longer active" "$(as "$UA" "select public.grovshot_knowledge_publish('bez mgiełki')->>'version'")" "2"
check "one active version" "$(q "select string_agg(version || ':' || active, ',' order by version) from knowledge_versions")" "1:false,2:true"
check "rollback: activate v1" "$(as "$UA" "select public.grovshot_knowledge_activate((select id from public.knowledge_versions where version = 1))->>'version'")" "1"
check "orders get v1 again (80 rules)" "$(as "$UC" "select (s->>'version') || ':' || jsonb_array_length(s->'rules') from (select public.grovshot_knowledge_snapshot('$TOKEN', false) s) x")" "1:80"
check "a customer cannot activate a version" "$(as "$UC" "select public.grovshot_knowledge_activate((select id from public.knowledge_versions where version = 2))")" "forbidden"
check "a customer cannot write a version directly" "$(as "$UC" "insert into public.knowledge_versions (version, rule_ids, rule_count, delivered_count, content_sha256) values (9, '{}', 0, 0, repeat('a', 64)) returning id")" "permission denied for table knowledge_versions"
check "publish, activate and the review are in the activity log" "$(q "select count(*) from activity_logs where action in ('admin.knowledge_published', 'admin.knowledge_activated')")" "3"

echo
if [ "$fails" -gt 0 ]; then echo "gsv2-knowledge-sql: $fails FAILED"; exit 1; fi
echo "gsv2-knowledge-sql: all checks passed"
