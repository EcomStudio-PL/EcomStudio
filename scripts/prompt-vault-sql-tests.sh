#!/usr/bin/env bash
#
# PROMPT KEY IN VAULT — migration 0130 proven on a real Postgres.
#
# 0130 is loaded VERBATIM on top of the helpers it calls (is_admin from 0002,
# server_call_ok from 0077), the 0070 prompt table with its RLS policy, the
# 0071 version functions, and an emulation of Supabase Vault that behaves like
# the real one where it matters: vault.secrets with the UNIQUE name index,
# vault.decrypted_secrets, create_secret / update_secret, and NO grant to anon
# or authenticated. pgcrypto lives in `extensions`, as on Supabase.
#
# Proves: the key exists after apply; only the server token opens the door
# (not anon, not a customer, not an admin session); ten concurrent first
# calls create exactly ONE key; a stored key is never overwritten; the generic
# secret_* functions refuse the reserved namespace while provider/integration
# secrets work exactly as before; RLS keeps prompt ciphertext admin-only.
#
#   bash scripts/pg-harness-up.sh && npm run test:promptvault:sql
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
DB=promptvault
PSQL0=(psql -h "$PGSOCK" -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -X -q -t -A)
PSQL=("${PSQL0[@]}" -d "$DB")

if ! "${PSQL0[@]}" -d postgres -c 'select 1' >/dev/null 2>&1; then
  echo "promptvault-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
M=$ROOT/supabase/migrations
MIGRATION="$M/0130_prompt_master_key.sql"
extract() { # file, function name, end marker regex
  awk -v start="^create (or replace )?function public[.]$2[(]" -v stop="$3" \
    '$0 ~ start {on=1} on {print} on && $0 ~ stop {exit}' "$1"
}
IS_ADMIN=$(extract "$M/0002_functions_and_triggers.sql" is_admin '^[$][$];')
SERVER_CALL_OK=$(extract "$M/0077_server_only_rpcs.sql" server_call_ok '^end [$][$];')
SAVE_PROMPT=$(extract "$M/0071_ai_prompt_publishing.sql" ai_save_tool_prompt '^[$][$];')
for v in IS_ADMIN SERVER_CALL_OK SAVE_PROMPT; do
  [ -n "${!v}" ] || { echo "promptvault-sql: could not extract $v" >&2; exit 2; }
done

"${PSQL0[@]}" -d postgres -c "drop database if exists $DB" >/dev/null
"${PSQL0[@]}" -d postgres -c "create database $DB" >/dev/null

fails=0
check() { if [ "$2" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1 — got [$2], expected [$3]"; fails=$((fails+1)); fi; }
q() { "${PSQL[@]}" -c "$1"; }
as_user() { "${PSQL[@]}" -c "set role authenticated; set request.jwt.claim.sub = '$1'; $2"; }
as_anon() { "${PSQL[@]}" -c "set role anon; $1"; }
err() { # sql, [role], [sub] → first error text, or ok
  local out
  if out=$("${PSQL[@]}" -c "set role ${2:-postgres}; set request.jwt.claim.sub = '${3:-}'; $1" 2>&1); then echo ok
  else echo "$out" | sed -n 's/^.*ERROR:  //p' | head -1; fi
}
TOKEN='the-right-dispatch-token'
KEYNAME='grovbase.prompts.master_key_v1'

"${PSQL[@]}" >/dev/null <<SQL
set check_function_bodies = off;
create schema auth; create schema extensions; create schema vault;
create extension if not exists pgcrypto with schema extensions;
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end \$\$;
grant usage on schema public, auth, extensions to anon, authenticated;
-- Supabase's defaults: every new public function/table is granted to both.
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;

create function auth.uid() returns uuid language sql stable as
  \$f\$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid \$f\$;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create table public.app_settings (key text primary key, value jsonb not null default '{}'::jsonb);
insert into public.app_settings values
  ('notifications', jsonb_build_object('dispatch_hash', encode(extensions.digest('$TOKEN', 'sha256'), 'hex')));
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, role text not null default 'user');

$IS_ADMIN
$SERVER_CALL_OK

-- Supabase Vault, as far as this migration touches it. No grants to clients:
-- on Supabase the vault schema is not reachable by anon or authenticated.
create table vault.secrets (
  id uuid primary key default gen_random_uuid(), name text, description text not null default '',
  secret text not null, key_id uuid, nonce bytea,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create unique index secrets_name_idx on vault.secrets (name) where name is not null;
create view vault.decrypted_secrets as
  select id, name, description, secret, secret as decrypted_secret, key_id, nonce, created_at, updated_at from vault.secrets;
create function vault.create_secret(new_secret text, new_name text default null, new_description text default '', new_key_id uuid default null)
returns uuid language plpgsql as \$f\$
declare v uuid; begin
  -- a tiny delay widens the race window, so the concurrency test means something
  perform pg_sleep(0.05);
  insert into vault.secrets (name, description, secret, key_id) values (new_name, coalesce(new_description, ''), new_secret, new_key_id)
  returning id into v; return v; end \$f\$;
create function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null, new_description text default null, new_key_id uuid default null)
returns void language plpgsql as \$f\$ begin
  update vault.secrets set secret = coalesce(new_secret, secret), name = coalesce(new_name, name),
    description = coalesce(new_description, description), updated_at = now() where id = secret_id; end \$f\$;

-- The prompt table and its 0070 RLS, plus the 0071 save function.
create table public.ai_tools (tool_key text primary key, engine_mode text not null default 'grovbase');
create table public.ai_tool_prompts (
  id uuid primary key default gen_random_uuid(), tool_key text not null references public.ai_tools on delete cascade,
  version integer not null, status text not null default 'draft', body_encrypted text not null, body_iv text not null,
  body_tag text not null, summary text, reason text, source text not null default 'manual', created_by uuid,
  created_at timestamptz not null default now(), published_at timestamptz, unique (tool_key, version));
create unique index ai_tool_prompts_one_published on public.ai_tool_prompts (tool_key) where status = 'published';
alter table public.ai_tool_prompts enable row level security;
create policy ai_tool_prompts_admin on public.ai_tool_prompts for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
$SAVE_PROMPT
insert into public.ai_tools values ('retouch', 'grovbase'), ('generator', 'hybrid');
SQL

echo "S1 — apply"
"${PSQL[@]}" -f "$MIGRATION" >/dev/null
"${PSQL[@]}" -f "$MIGRATION" >/dev/null && echo "  ✓ S1 0130 re-runs cleanly"
check "S1 the key exists right after the migration" "$(q "select count(*) from vault.secrets where name = '$KEYNAME'")" "1"
check "S1 …as a 256-bit hex key" "$(q "select decrypted_secret ~ '^[0-9a-f]{64}\$' from vault.decrypted_secrets where name = '$KEYNAME'")" "t"
KEY1=$(q "select decrypted_secret from vault.decrypted_secrets where name = '$KEYNAME'")
check "S1 the second apply did not replace it" "$(q "select count(*) from vault.secrets")" "1"

ADMIN=$(q "insert into auth.users (email) values ('a@x') returning id"); q "insert into public.profiles values ('$ADMIN', 'admin')" >/dev/null
CUST=$(q "insert into auth.users (email) values ('c@x') returning id"); q "insert into public.profiles values ('$CUST', 'user')" >/dev/null

echo "S2 — who can open the door"
check "S2 anon cannot even call it" "$(err "select public.prompt_master_key('$TOKEN')" anon | grep -c 'permission denied')" "1"
check "S2 a customer without the token → forbidden" "$(err "select public.prompt_master_key(null)" authenticated "$CUST")" "forbidden"
check "S2 a customer with a guessed token → forbidden" "$(err "select public.prompt_master_key('guess')" authenticated "$CUST")" "forbidden"
check "S2 an ADMIN session without the token → forbidden (admins read prompts, never the key)" "$(err "select public.prompt_master_key(null)" authenticated "$ADMIN")" "forbidden"
check "S2 the server token opens it — the same key, every time" "$(as_user "$CUST" "select public.prompt_master_key('$TOKEN') = '$KEY1'")" "t"
check "S2 grants: anon no, authenticated yes" "$(q "select has_function_privilege('anon','public.prompt_master_key(text)','execute')::text || has_function_privilege('authenticated','public.prompt_master_key(text)','execute')::text")" "falsetrue"
check "S2 the creator is not callable by any client role" "$(q "select has_function_privilege('anon','public.prompt_master_key_ensure()','execute')::text || has_function_privilege('authenticated','public.prompt_master_key_ensure()','execute')::text")" "falsefalse"
check "S2 a customer cannot call the creator directly" "$(err "select public.prompt_master_key_ensure()" authenticated "$CUST" | grep -c 'permission denied')" "1"
check "S2 clients cannot read the vault schema" "$(err "select count(*) from vault.decrypted_secrets" authenticated "$ADMIN" | grep -c 'permission denied')" "1"
check "S2 the door is VOLATILE (read-write under PostgREST) and SECURITY DEFINER" "$(q "select provolatile::text || prosecdef::text from pg_proc where proname = 'prompt_master_key'")" "vtrue"

echo "S3 — ten concurrent first calls create ONE key"
q "delete from vault.secrets" >/dev/null
seq 1 10 | xargs -P 10 -I{} psql -h "$PGSOCK" -p "$PGPORT" -U postgres -d "$DB" -X -q -t -A \
  -c "set role authenticated; set request.jwt.claim.sub = '$CUST'; select public.prompt_master_key('$TOKEN')" \
  > /tmp/promptvault-race.$$ 2>&1 || true
check "S3 exactly one vault row" "$(q "select count(*) from vault.secrets where name = '$KEYNAME'")" "1"
check "S3 all ten callers got the same key" "$(grep -E '^[0-9a-f]{64}$' /tmp/promptvault-race.$$ | sort -u | wc -l | tr -d ' ')" "1"
check "S3 …and all ten got one" "$(grep -cE '^[0-9a-f]{64}$' /tmp/promptvault-race.$$)" "10"
check "S3 no caller saw an error" "$(grep -c ERROR /tmp/promptvault-race.$$ || true)" "0"
KEY2=$(q "select decrypted_secret from vault.decrypted_secrets where name = '$KEYNAME'")
check "S3 the returned key IS the stored key" "$(grep -E '^[0-9a-f]{64}$' /tmp/promptvault-race.$$ | head -1)" "$KEY2"
rm -f /tmp/promptvault-race.$$

echo "S4 — a stored key is never overwritten"
check "S4 later calls return the stored key" "$(as_user "$CUST" "select public.prompt_master_key('$TOKEN') = '$KEY2'")" "t"
q "update vault.secrets set secret = 'not-a-key' where name = '$KEYNAME'" >/dev/null
check "S4 a malformed stored value is refused, not repaired" "$(err "select public.prompt_master_key('$TOKEN')" authenticated "$CUST")" "master_key_malformed"
check "S4 …and left exactly as it was" "$(q "select secret from vault.secrets where name = '$KEYNAME'")" "not-a-key"
q "update vault.secrets set secret = '$KEY2' where name = '$KEYNAME'" >/dev/null

echo "S5 — the generic secret functions refuse the reserved namespace"
check "S5 secret_put cannot overwrite the key" "$(err "select public.secret_put('$KEYNAME', 'x')" authenticated "$ADMIN")" "reserved_name"
check "S5 secret_clear cannot delete it" "$(err "select public.secret_clear('$KEYNAME')" authenticated "$ADMIN")" "reserved_name"
check "S5 secret_read cannot return it (admin)" "$(err "select public.secret_read('$KEYNAME')" authenticated "$ADMIN")" "reserved_name"
check "S5 secret_read cannot return it (server token)" "$(err "select public.secret_read('$KEYNAME', '$TOKEN')" anon)" "reserved_name"
check "S5 secret_read_many cannot return it" "$(err "select * from public.secret_read_many(array['grovbase.mail.smtp_password', '$KEYNAME'], '$TOKEN')" anon)" "reserved_name"
check "S5 secret_status cannot even show its last four" "$(err "select * from public.secret_status(array['$KEYNAME'])" authenticated "$ADMIN")" "reserved_name"
check "S5 the key survived all of that" "$(q "select secret = '$KEY2' from vault.secrets where name = '$KEYNAME'")" "t"

echo "S6 — provider and integration secrets work exactly as before"
check "S6 admin stores a provider key" "$(err "select public.secret_put('grovbase.provider.abc', 'sk-test-value-1234')" authenticated "$ADMIN")" "ok"
check "S6 admin updates it in place" "$(err "select public.secret_put('grovbase.provider.abc', 'sk-test-value-5678')" authenticated "$ADMIN"); $(q "select count(*) from vault.secrets where name = 'grovbase.provider.abc'")" "ok; 1"
check "S6 the server reads it with the token" "$(as_anon "select public.secret_read('grovbase.provider.abc', '$TOKEN')")" "sk-test-value-5678"
check "S6 the batch read still works" "$(as_anon "select value from public.secret_read_many(array['grovbase.provider.abc'], '$TOKEN')")" "sk-test-value-5678"
check "S6 status shows the last four" "$(as_user "$ADMIN" "select last_four from public.secret_status(array['grovbase.provider.abc'])")" "5678"
check "S6 a customer still cannot write one" "$(err "select public.secret_put('grovbase.provider.abc', 'x')" authenticated "$CUST")" "forbidden"
check "S6 anon still cannot read without the token" "$(err "select public.secret_read('grovbase.provider.abc')" anon)" "forbidden"
check "S6 admin clears it" "$(as_user "$ADMIN" "select public.secret_clear('grovbase.provider.abc')")" "t"
check "S6 grants unchanged: secret_read reaches anon (0079), secret_put does not" "$(q "select has_function_privilege('anon','public.secret_read(text,text)','execute')::text || has_function_privilege('anon','public.secret_put(text,text)','execute')::text")" "truefalse"

echo "S7 — prompt rows stay admin-only; old unreadable rows never block a new version"
q "insert into public.ai_tool_prompts (tool_key, version, status, body_encrypted, body_iv, body_tag) values ('retouch', 1, 'published', 'legacy-cipher-key-gone', 'iv', 'tag')" >/dev/null
check "S7 anon sees no prompt rows" "$(as_anon "select count(*) from public.ai_tool_prompts" 2>/dev/null || echo 0)" "0"
check "S7 a customer sees no prompt rows (no ciphertext either)" "$(as_user "$CUST" "select count(*) from public.ai_tool_prompts")" "0"
check "S7 a customer cannot insert one" "$(err "insert into public.ai_tool_prompts (tool_key, version, body_encrypted, body_iv, body_tag) values ('retouch', 9, 'x', 'i', 't')" authenticated "$CUST" | grep -c 'row-level security')" "1"
check "S7 a customer's update touches nothing" "$(as_user "$CUST" "with u as (update public.ai_tool_prompts set body_encrypted = 'x' returning 1) select count(*) from u")" "0"
check "S7 a customer's delete touches nothing" "$(as_user "$CUST" "with d as (delete from public.ai_tool_prompts returning 1) select count(*) from d")" "0"
check "S7 a customer cannot save a version through the function" "$(err "select public.ai_save_tool_prompt('retouch', 'x', 'i', 't')" authenticated "$CUST")" "not_authorized"
check "S7 the admin saves a NEW version next to the unreadable legacy one" "$(as_user "$ADMIN" "select public.ai_save_tool_prompt('retouch', 'vault-cipher', 'iv2', 'tag2', 'Retusz 1.0', 'Test systemu promptów', 'manual', true)->>'version'")" "2"
check "S7 …and it is the one published; the legacy row is kept" "$(q "select string_agg(version || ':' || status, ',' order by version) from public.ai_tool_prompts")" "1:superseded,2:published"

echo
if [ "$fails" -eq 0 ]; then echo "All prompt-vault SQL tests passed."; else echo "$fails FAILED"; exit 1; fi
