#!/usr/bin/env bash
#
# ONE LIVE CODE AT A TIME, PROVEN AGAINST A REAL POSTGRES.
#
# WHAT THIS EXISTS TO CATCH.
#
# The step-up screen used to run two clocks that disagreed on purpose: the code
# lived 120 s (code_ttl_seconds) while the resend button unlocked after 59 s
# (resend_seconds). From 00:59 a person could ask for a second code while the
# first still verified — one intent, two e-mails, two chances for whoever is
# guessing. Migration 0111 replaces that with one rule: A REPLACEMENT MAY BE
# ASKED FOR ONLY ONCE THE CURRENT CODE HAS EXPIRED.
#
# A disabled button cannot enforce that, and neither can a peek-then-insert in
# application code: two taps a few milliseconds apart both read an empty table
# and both send. So the refusal lives in login_challenge_start, under a
# per-(user, device) advisory lock — and section D holds two real connections
# against each other to show the lock is doing the work, rather than trusting
# that the race is "unlikely".
#
# Section A reproduces the OLD behaviour first, on 0059's function exactly as
# production carries it, so the rule is watched to fail before it is watched to
# pass. A fix nobody saw fail is a fix nobody can trust.
#
# It runs against the local harness, never Supabase: DEV carries none of this
# schema (5 migrations applied, no login_security at all) and PROD is not a
# place to rehearse an auth change.
#
#   bash scripts/pg-harness-up.sh && npm run test:loginsec:sql
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
PSQL=(psql -h "$PGSOCK" -p "$PGPORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -X -q -t -A)

if ! "${PSQL[@]}" -c 'select 1' >/dev/null 2>&1; then
  echo "login-security-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Overridable so the guard can be mutation-tested: point it at a deliberately
# broken copy of 0111 and the run must go red.
MIGRATION="${MIGRATION:-$ROOT/supabase/migrations/0111_one_live_code_at_a_time.sql}"
[ -f "$MIGRATION" ] || { echo "login-security-sql: $MIGRATION not found" >&2; exit 2; }
# 0112 is the second half: it closes the superseded door, and it is a separate
# migration because it must not be applied until the new code is serving (see
# its header). The suite applies BOTH, because the end state is what has to be
# right — section G would otherwise pass on a half-finished rollout.
REVOKE_MIGRATION="${REVOKE_MIGRATION:-$ROOT/supabase/migrations/0112_close_the_superseded_door.sql}"
[ -f "$REVOKE_MIGRATION" ] || { echo "login-security-sql: $REVOKE_MIGRATION not found" >&2; exit 2; }

fails=0
check() { # name, actual, expected
  if [ "$2" = "$3" ]; then echo "  ✓ $1"
  else echo "  ✗ $1 — got [$2], expected [$3]"; fails=$((fails+1)); fi
}

# ── the pieces 0111 touches, replayed from the migrations that created them ──
"${PSQL[@]}" >/dev/null <<'SQL'
drop schema if exists public cascade;  create schema public;
drop schema if exists auth cascade;    create schema auth;
create extension if not exists pgcrypto with schema public;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public, auth to anon, authenticated;

create table auth.users (id uuid primary key);
insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'),   -- user A
  ('22222222-2222-2222-2222-222222222222');   -- user B

create table public.app_settings (key text primary key, value jsonb not null default '{}'::jsonb);
create table public.user_trusted_devices (id uuid primary key default gen_random_uuid());

-- 0057, verbatim shape.
create table public.login_security_challenges (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  device_hash  text not null,
  code_hash    text not null,
  ip_hash      text,
  device_label text not null default '',
  reason       text not null default 'new_device',
  attempts     integer not null default 0,
  max_attempts integer not null default 5,
  expires_at   timestamptz not null,
  used_at      timestamptz,
  created_at   timestamptz not null default now()
);
create table public.security_login_events (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  event_type     text not null,
  device_id      uuid references public.user_trusted_devices (id) on delete set null,
  ip_hash        text,
  device_summary text not null default '',
  success        boolean,
  reason         text,
  occurred_at    timestamptz not null default now()
);

-- 0057's token gate, verbatim.
create function public.login_security_token_ok(p_token text)
returns boolean language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select value->>'hash' from public.app_settings where key = 'login_security_dispatch'), '') <> ''
  and encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
      = (select value->>'hash' from public.app_settings where key = 'login_security_dispatch');
$$;
insert into public.app_settings (key, value)
values ('login_security_dispatch',
        jsonb_build_object('hash', encode(digest('right-token', 'sha256'), 'hex')));

-- 0059's open, verbatim: opens unconditionally, spending whatever was live.
create function public.login_challenge_open(
  p_token text, p_user uuid, p_device_hash text, p_code_hash text, p_ip_hash text,
  p_device_label text, p_reason text, p_ttl_seconds integer, p_max_attempts integer
) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare v_id uuid;
begin
  if not public.login_security_token_ok(p_token) then return null; end if;
  update public.login_security_challenges set used_at = now()
   where user_id = p_user and device_hash = p_device_hash
     and used_at is null and expires_at > now();
  insert into public.login_security_challenges
    (user_id, device_hash, code_hash, ip_hash, device_label, reason, max_attempts, expires_at)
  values (p_user, p_device_hash, p_code_hash, nullif(p_ip_hash,''), coalesce(p_device_label,''),
          coalesce(nullif(p_reason,''),'new_device'), greatest(1, coalesce(p_max_attempts,5)),
          now() + make_interval(secs => greatest(30, coalesce(p_ttl_seconds,120))))
  returning id into v_id;
  insert into public.security_login_events (user_id, event_type, ip_hash, device_summary, reason)
  values (p_user, 'verification_required', nullif(p_ip_hash,''), coalesce(p_device_label,''), 'new_device');
  return v_id;
end; $$;
revoke execute on function public.login_challenge_open(text, uuid, text, text, text, text, text, integer, integer) from public;
grant execute on function public.login_challenge_open(text, uuid, text, text, text, text, text, integer, integer) to anon, authenticated;
SQL

A='11111111-1111-1111-1111-111111111111'
B='22222222-2222-2222-2222-222222222222'
open_old() { # user, code_hash — 0059's function
  "${PSQL[@]}" -c "select public.login_challenge_open('right-token','$1','dev-1','$2','','Mac','new_device',120,5) is not null"
}
start() { # user, device, code_hash
  "${PSQL[@]}" -c "select public.login_challenge_start('right-token','$1','$2','$3','','Mac','new_device',120,5)->>'status'"
}
start_left() { # user, device
  "${PSQL[@]}" -c "select public.login_challenge_start('right-token','$1','$2','h','','Mac','new_device',120,5)->>'expires_in_seconds'"
}
live_count() { # user
  "${PSQL[@]}" -c "select count(*) from public.login_security_challenges where user_id='$1' and used_at is null and expires_at > now()"
}
total_count() { # user
  "${PSQL[@]}" -c "select count(*) from public.login_security_challenges where user_id='$1'"
}

echo
echo "A. THE OLD BEHAVIOUR, REPRODUCED BEFORE IT IS FIXED"
open_old "$A" "hash-1" >/dev/null
check "a first code is opened" "$(total_count "$A")" "1"
# The old rule let a SECOND code be minted at any moment, including one second
# in — the application decided, and the database never refused.
open_old "$A" "hash-2" >/dev/null
check "0059 mints a SECOND code with the first still alive" "$(total_count "$A")" "2"
check "...and only the newest is live, so the person holds a dead code too" "$(live_count "$A")" "1"

"${PSQL[@]}" -c "delete from public.login_security_challenges" >/dev/null
"${PSQL[@]}" -c "delete from public.security_login_events" >/dev/null

echo
echo "B. 0111 APPLIED — A LIVE CODE REFUSES A REPLACEMENT"
"${PSQL[@]}" -f "$MIGRATION" >/dev/null
# The window between the two migrations is a real state this rollout passes
# through, so it is asserted rather than assumed: the old function must still
# work there, or applying 0111 would take logins down until the deploy lands.
check "between 0111 and 0112 the old door still opens (no login outage)" \
  "$("${PSQL[@]}" -c "select has_function_privilege('authenticated','public.login_challenge_open(text,uuid,text,text,text,text,text,integer,integer)','execute')")" "t"
"${PSQL[@]}" -f "$REVOKE_MIGRATION" >/dev/null
check "the first call opens" "$(start "$A" dev-1 hash-1)" "opened"
check "the second is refused while it lives" "$(start "$A" dev-1 hash-2)" "live"
check "and no second row was written" "$(total_count "$A")" "1"
left=$(start_left "$A" dev-1)
check "the refusal reports time left, not zero" "$([ "$left" -gt 0 ] && [ "$left" -le 120 ] && echo yes)" "yes"

echo
echo "C. ONLY EXPIRY OPENS THE DOOR"
# 61 s in — the moment the retired 59 s cooldown allowed a second code.
"${PSQL[@]}" -c "update public.login_security_challenges
                    set created_at = now() - interval '61 seconds',
                        expires_at = now() + interval '59 seconds'
                  where user_id='$A'" >/dev/null
check "at 61 s (the old cooldown) it is still refused" "$(start "$A" dev-1 hash-3)" "live"
check "still one row" "$(total_count "$A")" "1"

"${PSQL[@]}" -c "update public.login_security_challenges
                    set expires_at = now() - interval '1 second' where user_id='$A'" >/dev/null
check "once expired, a replacement is opened" "$(start "$A" dev-1 hash-4)" "opened"
check "which is a second row" "$(total_count "$A")" "2"
check "and exactly one of them is live" "$(live_count "$A")" "1"

echo
echo "D. THE LOCK, HELD BY TWO REAL CONNECTIONS"
#
# Not a thought experiment. Session 1 opens a transaction, calls start (taking
# the advisory lock) and sits on it. Session 2 calls start for the SAME user and
# device with a short statement_timeout. If the lock is real, session 2 blocks
# and times out; without it, session 2 sails past the empty table and inserts.
"${PSQL[@]}" -c "delete from public.login_security_challenges" >/dev/null
(
  psql -h "$PGSOCK" -p "$PGPORT" -U postgres -d postgres -X -q -t -A >/dev/null 2>&1 <<SQL
begin;
select public.login_challenge_start('right-token','$B','dev-9','h1','','Mac','new_device',120,5);
select pg_sleep(3);
commit;
SQL
) &
holder=$!
sleep 1
blocked=$(psql -h "$PGSOCK" -p "$PGPORT" -U postgres -d postgres -X -q -t -A \
  -c "set statement_timeout='1200ms'" \
  -c "select public.login_challenge_start('right-token','$B','dev-9','h2','','Mac','new_device',120,5)->>'status'" \
  2>&1 | grep -c "statement timeout" || true)
check "a concurrent caller is BLOCKED by the lock, not waved through" "$blocked" "1"
wait $holder
check "when the dust settles exactly one code exists" "$(total_count "$B")" "1"
check "and the late caller is now simply refused" "$(start "$B" dev-9 h3)" "live"
check "still one code" "$(total_count "$B")" "1"

echo
echo "E. A DEVICE AND A USER ARE THEIR OWN QUEUE"
# The refusal must be per (user, device) — a live code for A on this browser
# must not stop B from getting one, which is exactly the account-switch case.
check "a DIFFERENT user is unaffected by A's live code" "$(start "$B" dev-1 hash-b)" "opened"
check "a DIFFERENT device for the same user is unaffected" "$(start "$A" dev-2 hash-x)" "opened"

echo
echo "F. A FAILED SEND DOES NOT COST THE FULL TTL"
"${PSQL[@]}" -c "delete from public.login_security_challenges where user_id='$A'" >/dev/null
id=$("${PSQL[@]}" -c "select public.login_challenge_start('right-token','$A','dev-7','h','','Mac','new_device',120,5)->>'id'")
check "a challenge is open" "$(start "$A" dev-7 h2)" "live"
check "abandoning it succeeds" \
  "$("${PSQL[@]}" -c "select public.login_challenge_abandon('right-token','$A','dev-7','$id')")" "t"
check "and the slot is free again immediately" "$(start "$A" dev-7 h3)" "opened"

# ── THE NEGATIVE CASES NEED A ROW THAT IS STILL ALIVE ────────────────────────
#
# These two assertions previously reused $id — the challenge abandoned three
# lines above. A spent row is refused by the `used_at is null` predicate alone,
# so BOTH passed without the guard they are named after ever being consulted:
# delete `and user_id = p_user`, or the token check, and they still printed ✓.
# A guard that cannot fail is decoration. Each negative case now runs against a
# freshly opened, still-live challenge, and is followed by the positive control
# proving the row was abandonable all along — so the refusal is attributable to
# the predicate under test and nothing else.
"${PSQL[@]}" -c "delete from public.login_security_challenges where user_id='$A' and device_hash='dev-7'" >/dev/null
live_id=$("${PSQL[@]}" -c "select public.login_challenge_start('right-token','$A','dev-7','h','','Mac','new_device',120,5)->>'id'")
check "abandon refuses a LIVE row that is not this user's" \
  "$("${PSQL[@]}" -c "select public.login_challenge_abandon('right-token','$B','dev-7','$live_id')")" "f"
check "abandon refuses a LIVE row on a different device" \
  "$("${PSQL[@]}" -c "select public.login_challenge_abandon('right-token','$A','dev-OTHER','$live_id')")" "f"
check "abandon refuses a LIVE row without the token" \
  "$("${PSQL[@]}" -c "select public.login_challenge_abandon('wrong','$A','dev-7','$live_id')")" "f"
check "...and that row was abandonable all along (the control)" \
  "$("${PSQL[@]}" -c "select public.login_challenge_abandon('right-token','$A','dev-7','$live_id')")" "t"

echo
echo "G. THE TOKEN GATE AND THE ONE DOOR"
check "a wrong token opens nothing" \
  "$("${PSQL[@]}" -c "select public.login_challenge_start('wrong','$A','dev-8','h','','Mac','new_device',120,5)->>'status'")" "forbidden"
# The superseded function must be unreachable, or it is a second way to mint a
# code that does not honour any of the above.
check "login_challenge_open is revoked from anon" \
  "$("${PSQL[@]}" -c "select has_function_privilege('anon','public.login_challenge_open(text,uuid,text,text,text,text,text,integer,integer)','execute')")" "f"
check "login_challenge_open is revoked from authenticated" \
  "$("${PSQL[@]}" -c "select has_function_privilege('authenticated','public.login_challenge_open(text,uuid,text,text,text,text,text,integer,integer)','execute')")" "f"
check "login_challenge_start IS callable by authenticated" \
  "$("${PSQL[@]}" -c "select has_function_privilege('authenticated','public.login_challenge_start(text,uuid,text,text,text,text,text,integer,integer)','execute')")" "t"

echo
if [ "$fails" = "0" ]; then echo "All login-security SQL tests passed."; else echo "$fails FAILED"; fi
exit $([ "$fails" = "0" ] && echo 0 || echo 1)
