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
# Proves: the key exists after apply; only the server's prompt-key token
# opens the door (not anon, not a customer, not an admin session — not even
# one that reads the dispatch token from Vault or forges the dispatch hash);
# the first call pins that token once, race-safe; ten concurrent first calls
# create exactly ONE key; a stored key is never overwritten; the generic
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
KTOKEN='the-servers-own-prompt-key-token-0123456789'
KEYNAME='grovbase.prompts.master_key_v1'
PINNAME='grovbase.prompts.server_verifier_v1'

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

-- 0110: admins may write app_settings, the dispatch hash included — the
-- reason the key door cannot trust server_call_ok alone.
alter table public.app_settings enable row level security;
create policy settings_admin_write on public.app_settings for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));

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
# The secret_* functions come from 0130 itself (loaded below); the worker
# token is stored the way provisionSchedulerAction stores it.

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
check "S2 anon cannot even call it" "$(err "select public.prompt_master_key('$TOKEN', '$KTOKEN')" anon | grep -c 'permission denied')" "1"
check "S2 a customer without tokens → forbidden" "$(err "select public.prompt_master_key(null, null)" authenticated "$CUST")" "forbidden"
check "S2 a customer with guessed tokens → forbidden" "$(err "select public.prompt_master_key('guess', 'guess-guess-guess-guess-guess-guess-guess')" authenticated "$CUST")" "forbidden"
check "S2 …and a refused first call pins nothing" "$(q "select count(*) from vault.secrets where name = '$PINNAME'")" "0"
check "S2 the dispatch token itself can never be pinned as the key token" "$(err "select public.prompt_master_key('$TOKEN', '$TOKEN')" authenticated "$ADMIN")" "forbidden"
check "S2 an ADMIN session without the key token → forbidden (admins read prompts, never the key)" "$(err "select public.prompt_master_key(null, null)" authenticated "$ADMIN")" "forbidden"
check "S2 the server's first call opens it and pins sha256(key token)" "$(as_user "$CUST" "select public.prompt_master_key('$TOKEN', '$KTOKEN') = '$KEY1'"); $(q "select decrypted_secret = encode(extensions.digest('$KTOKEN', 'sha256'), 'hex') from vault.decrypted_secrets where name = '$PINNAME'")" "t; t"
check "S2 later calls need only the key token — the same key, every time" "$(as_user "$CUST" "select public.prompt_master_key(null, '$KTOKEN') = '$KEY1'")" "t"
check "S2 grants: anon no, authenticated yes" "$(q "select has_function_privilege('anon','public.prompt_master_key(text,text)','execute')::text || has_function_privilege('authenticated','public.prompt_master_key(text,text)','execute')::text")" "falsetrue"
check "S2 the old one-token door does not exist" "$(q "select count(*) from pg_proc where proname = 'prompt_master_key' and pronargs = 1")" "0"
check "S2 the creator, the pin and the unpin are not callable by any client role" "$(q "select bool_or(has_function_privilege(r, f, 'execute'))::text from unnest(array['anon','authenticated']) r, unnest(array['public.prompt_master_key_ensure()','public.prompt_key_verifier(text)','public.prompt_key_unpin()']) f")" "false"
check "S2 a customer cannot call the creator directly" "$(err "select public.prompt_master_key_ensure()" authenticated "$CUST" | grep -c 'permission denied')" "1"
check "S2 clients cannot read the vault schema" "$(err "select count(*) from vault.decrypted_secrets" authenticated "$ADMIN" | grep -c 'permission denied')" "1"
check "S2 the door is VOLATILE (read-write under PostgREST) and SECURITY DEFINER" "$(q "select provolatile::text || prosecdef::text from pg_proc where proname = 'prompt_master_key'")" "vtrue"

echo "S3 — ten concurrent first calls create ONE key and ONE pin"
q "delete from vault.secrets" >/dev/null
seq 1 10 | xargs -P 10 -I{} psql -h "$PGSOCK" -p "$PGPORT" -U postgres -d "$DB" -X -q -t -A \
  -c "set role authenticated; set request.jwt.claim.sub = '$CUST'; select public.prompt_master_key('$TOKEN', '$KTOKEN')" \
  > /tmp/promptvault-race.$$ 2>&1 || true
check "S3 exactly one key row and one pin row" "$(q "select count(*) filter (where name = '$KEYNAME') || '/' || count(*) filter (where name = '$PINNAME') from vault.secrets")" "1/1"
check "S3 all ten callers got the same key" "$(grep -E '^[0-9a-f]{64}$' /tmp/promptvault-race.$$ | sort -u | wc -l | tr -d ' ')" "1"
check "S3 …and all ten got one" "$(grep -cE '^[0-9a-f]{64}$' /tmp/promptvault-race.$$)" "10"
check "S3 no caller saw an error" "$(grep -c ERROR /tmp/promptvault-race.$$ || true)" "0"
KEY2=$(q "select decrypted_secret from vault.decrypted_secrets where name = '$KEYNAME'")
check "S3 the returned key IS the stored key" "$(grep -E '^[0-9a-f]{64}$' /tmp/promptvault-race.$$ | head -1)" "$KEY2"
# Ten first callers with ten DIFFERENT key tokens (all passing the dispatch
# check): exactly one pins, exactly one gets the key — never two identities.
q "delete from vault.secrets where name = '$PINNAME'" >/dev/null
seq 1 10 | xargs -P 10 -I{} psql -h "$PGSOCK" -p "$PGPORT" -U postgres -d "$DB" -X -q -t -A \
  -c "set role authenticated; set request.jwt.claim.sub = '$CUST'; select public.prompt_master_key('$TOKEN', 'contender-{}-000000000000000000000000000000')" \
  > /tmp/promptvault-race.$$ 2>&1 || true
check "S3 ten competing identities → one pin" "$(q "select count(*) from vault.secrets where name = '$PINNAME'")" "1"
check "S3 …one caller got the key, nine were refused" "$(grep -cE '^[0-9a-f]{64}$' /tmp/promptvault-race.$$)/$(grep -c 'forbidden' /tmp/promptvault-race.$$ || true)" "1/9"
rm -f /tmp/promptvault-race.$$
# Back to the real server identity for the rest of the file.
q "delete from vault.secrets where name = '$PINNAME'" >/dev/null
check "S3 the real server re-pins after that reset" "$(as_user "$CUST" "select public.prompt_master_key('$TOKEN', '$KTOKEN') = '$KEY2'")" "t"

echo "S4 — a stored key is never overwritten"
check "S4 later calls return the stored key" "$(as_user "$CUST" "select public.prompt_master_key('$TOKEN', '$KTOKEN') = '$KEY2'")" "t"
q "update vault.secrets set secret = 'not-a-key' where name = '$KEYNAME'" >/dev/null
check "S4 a malformed stored value is refused, not repaired" "$(err "select public.prompt_master_key('$TOKEN', '$KTOKEN')" authenticated "$CUST")" "master_key_malformed"
check "S4 …and left exactly as it was" "$(q "select secret from vault.secrets where name = '$KEYNAME'")" "not-a-key"
q "update vault.secrets set secret = '$KEY2' where name = '$KEYNAME'" >/dev/null

echo "S5 — the generic secret functions refuse the reserved namespace"
check "S5 secret_put cannot overwrite the key" "$(err "select public.secret_put('$KEYNAME', 'x')" authenticated "$ADMIN")" "reserved_name"
check "S5 secret_clear cannot delete it" "$(err "select public.secret_clear('$KEYNAME')" authenticated "$ADMIN")" "reserved_name"
check "S5 secret_read cannot return it (admin)" "$(err "select public.secret_read('$KEYNAME')" authenticated "$ADMIN")" "reserved_name"
check "S5 secret_read cannot return it (server token)" "$(err "select public.secret_read('$KEYNAME', '$TOKEN')" anon)" "reserved_name"
check "S5 secret_read_many cannot return it" "$(err "select * from public.secret_read_many(array['grovbase.mail.smtp_password', '$KEYNAME'], '$TOKEN')" anon)" "reserved_name"
check "S5 secret_status cannot even show its last four" "$(err "select * from public.secret_status(array['$KEYNAME'])" authenticated "$ADMIN")" "reserved_name"
check "S5 the pin is out of reach the same way (read / put / clear)" "$(err "select public.secret_read('$PINNAME')" authenticated "$ADMIN") $(err "select public.secret_put('$PINNAME', 'x')" authenticated "$ADMIN") $(err "select public.secret_clear('$PINNAME')" authenticated "$ADMIN")" "reserved_name reserved_name reserved_name"
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

echo "S8 — an ADMIN session that reaches the dispatch token still gets no key"
# (a) the dispatch token is in Vault for the newsletter worker, and an admin
#     session may read it (0078/0130 secret_read) — by design, until now.
as_user "$ADMIN" "select public.secret_put('grovbase.newsletter.worker_token', '$TOKEN')" >/dev/null
check "S8 an admin session can read the dispatch token from Vault" "$(as_user "$ADMIN" "select public.secret_read('grovbase.newsletter.worker_token') = '$TOKEN'")" "t"
check "S8 …it opens nothing as the key token" "$(err "select public.prompt_master_key('$TOKEN', '$TOKEN')" authenticated "$ADMIN")" "forbidden"
check "S8 …nor with any key token it invents" "$(err "select public.prompt_master_key('$TOKEN', 'admin-invented-token-00000000000000000000')" authenticated "$ADMIN")" "forbidden"
# (b) an admin session rewrites the published dispatch hash (0110 RLS).
check "S8 an admin session can forge the dispatch hash" "$(err "update public.app_settings set value = jsonb_build_object('dispatch_hash', encode(extensions.digest('forged-token-000000000000000000000000', 'sha256'), 'hex')) where key = 'notifications'" authenticated "$ADMIN")" "ok"
check "S8 …server_call_ok now accepts the forged token (the generic proof)" "$(q "select public.server_call_ok('forged-token-000000000000000000000000')")" "t"
check "S8 …but the key door does not" "$(err "select public.prompt_master_key('forged-token-000000000000000000000000', 'forged-token-000000000000000000000000')" authenticated "$ADMIN") $(err "select public.prompt_master_key('forged-token-000000000000000000000000', 'another-forged-token-0000000000000000000')" authenticated "$ADMIN")" "forbidden forbidden"
check "S8 …the pin is unchanged" "$(q "select decrypted_secret = encode(extensions.digest('$KTOKEN', 'sha256'), 'hex') from vault.decrypted_secrets where name = '$PINNAME'")" "t"
check "S8 …and the real server is unaffected by the forged hash" "$(as_user "$CUST" "select public.prompt_master_key('whatever', '$KTOKEN') = '$KEY2'")" "t"
q "update public.app_settings set value = jsonb_build_object('dispatch_hash', encode(extensions.digest('$TOKEN', 'sha256'), 'hex')) where key = 'notifications'" >/dev/null
# (c) a rotated server secret is refused until the operator unpins — which
#     no client role can do.
check "S8 a rotated server identity is refused while the old pin stands" "$(err "select public.prompt_master_key('$TOKEN', 'rotated-server-key-token-000000000000000')" authenticated "$CUST")" "forbidden"
check "S8 neither an admin nor a customer can unpin" "$(err "select public.prompt_key_unpin()" authenticated "$ADMIN" | grep -c 'permission denied')$(err "select public.prompt_key_unpin()" authenticated "$CUST" | grep -c 'permission denied')" "11"
check "S8 the operator unpins (SQL editor)" "$(q "select public.prompt_key_unpin()")" "t"
check "S8 the rotated server pins itself on its next call — and gets the SAME key" "$(as_user "$CUST" "select public.prompt_master_key('$TOKEN', 'rotated-server-key-token-000000000000000') = '$KEY2'")" "t"
check "S8 unpinning never touched the key" "$(q "select count(*) from vault.secrets where name = '$KEYNAME' and secret = '$KEY2'")" "1"

echo
if [ "$fails" -eq 0 ]; then echo "All prompt-vault SQL tests passed."; else echo "$fails FAILED"; exit 1; fi
