#!/usr/bin/env bash
#
# GROVNEWS STAGE 2.1 — ACCESS AT THE MOMENT OF SENDING, PROVEN ON A REAL POSTGRES.
#
# The functions under test are loaded VERBATIM from the migrations, not
# restated: server_call_ok (0077), account_blocked (0072), the newsletter's own
# newsletter_queue_claim / newsletter_queue_finish (0094), the Stage 2 group
# sync (0121, kept under another name as the "before" for an equivalence
# check) and the whole of 0122. Tables carry the columns and constraints those
# functions touch. So a pass here means the SQL itself behaves — claim, guard,
# finish, group sync — not a TypeScript retelling of it.
#
# It runs on the local harness, never Supabase: DEV does not carry this schema
# and PROD is not a place to rehearse (PROD gets a rolled-back dry run instead).
#
#   bash scripts/pg-harness-up.sh && npm run test:grovnews21:sql
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
DB=grovnews21
PSQL0=(psql -h "$PGSOCK" -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -X -q -t -A)
PSQL=("${PSQL0[@]}" -d "$DB")

if ! "${PSQL0[@]}" -d postgres -c 'select 1' >/dev/null 2>&1; then
  echo "grovnews21-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
M=$ROOT/supabase/migrations
MIGRATION="${MIGRATION:-$M/0122_grovnews_send_time_access.sql}"
for f in "$MIGRATION" "$M/0072_temporary_account_block.sql" "$M/0077_server_only_rpcs.sql" \
         "$M/0094_newsletter.sql" "$M/0121_grovnews_research.sql"; do
  [ -f "$f" ] || { echo "grovnews21-sql: $f not found" >&2; exit 2; }
done

# Verbatim function bodies, cut out of the migrations that ship them.
extract() { # file, function name, end marker regex
  awk -v start="^create (or replace )?function public[.]$2[(]" -v stop="$3" \
    '$0 ~ start {on=1} on {print} on && $0 ~ stop {exit}' "$1"
}
SERVER_CALL_OK=$(extract "$M/0077_server_only_rpcs.sql" server_call_ok '^end [$][$];')
ACCOUNT_BLOCKED=$(extract "$M/0072_temporary_account_block.sql" account_blocked '^[$][$];')
CLAIM=$(extract "$M/0094_newsletter.sql" newsletter_queue_claim '^end [$][$];')
FINISH=$(extract "$M/0094_newsletter.sql" newsletter_queue_finish '^end [$][$];')
OLD_SYNC=$(extract "$M/0121_grovnews_research.sql" grovnews_group_sync_core '^end [$][$];' \
  | sed 's/function public\.grovnews_group_sync_core()/function t.old_group_sync_core()/')
for v in SERVER_CALL_OK ACCOUNT_BLOCKED CLAIM FINISH OLD_SYNC; do
  [ -n "${!v}" ] || { echo "grovnews21-sql: could not extract $v" >&2; exit 2; }
done

"${PSQL0[@]}" -d postgres -c "drop database if exists $DB" >/dev/null
"${PSQL0[@]}" -d postgres -c "create database $DB" >/dev/null

fails=0
check() { # name, actual, expected
  if [ "$2" = "$3" ]; then echo "  ✓ $1"
  else echo "  ✗ $1 — got [$2], expected [$3]"; fails=$((fails+1)); fi
}
q() { "${PSQL[@]}" -c "$1"; }
TOKEN='the-right-dispatch-token'

"${PSQL[@]}" >/dev/null <<SQL
-- helpers below name 0122's functions, which are created after them
set check_function_bodies = off;
create schema auth; create schema t;
create extension if not exists pgcrypto with schema public;
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end \$\$;
grant usage on schema public, auth to anon, authenticated;

create function auth.uid() returns uuid language sql stable as
  \$f\$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid \$f\$;
create table auth.users (
  id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz,
  created_at timestamptz not null default now());

create table public.app_settings (key text primary key, value jsonb not null default '{}'::jsonb);
insert into public.app_settings values
  ('notifications', jsonb_build_object('dispatch_hash', encode(digest('$TOKEN', 'sha256'), 'hex')));

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  blocked boolean not null default false, blocked_until timestamptz);

create table public.grovnews_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  source text not null default 'ADMIN_GRANT',
  status text not null default 'ACTIVE' check (status in ('ACTIVE','REVOKED','EXPIRED')),
  starts_at timestamptz not null default now(), expires_at timestamptz,
  unique (user_id, source));

create table public.newsletter_contacts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(btrim(email))),
  user_id uuid references public.profiles(id) on delete set null,
  first_name text, locale text not null default 'pl',
  marketing_consent boolean not null default false, consent_at timestamptz,
  unsubscribed_at timestamptz, unsubscribe_token uuid not null default gen_random_uuid(),
  last_activity_at timestamptz, last_sent_at timestamptz,
  check (marketing_consent = false or consent_at is not null));
create table public.newsletter_suppressions (email text primary key, reason text not null default 'blocked');
create table public.newsletter_groups (
  id uuid primary key default gen_random_uuid(), key text not null unique, name text not null,
  description text, is_dynamic boolean not null default false);
create table public.newsletter_group_members (
  group_id uuid not null references public.newsletter_groups(id) on delete cascade,
  contact_id uuid not null references public.newsletter_contacts(id) on delete cascade,
  primary key (group_id, contact_id));
create table public.newsletter_campaigns (
  id uuid primary key default gen_random_uuid(), name text not null default 'c',
  status text not null default 'sending', audience jsonb not null default '{"include": [], "exclude": []}'::jsonb,
  finished_at timestamptz);
create table public.newsletter_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.newsletter_campaigns(id) on delete cascade,
  step_index integer not null default 0, variant text not null default 'A',
  contact_id uuid not null references public.newsletter_contacts(id) on delete cascade,
  email text not null,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'skipped', 'cancelled')),
  send_after timestamptz not null default now(), attempts integer not null default 0,
  claimed_at timestamptz, next_attempt_at timestamptz, sent_at timestamptz,
  smtp_response text, message_id text, last_error_safe text, personalization jsonb,
  created_at timestamptz not null default now(),
  unique (campaign_id, step_index, contact_id));
create table public.newsletter_events (
  id bigserial primary key, event_type text not null, campaign_id uuid, step_index integer,
  variant text, contact_id uuid, recipient_id uuid, created_at timestamptz not null default now());
create table public.grovnews_editions (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid unique references public.newsletter_campaigns(id) on delete set null);

$SERVER_CALL_OK
$ACCOUNT_BLOCKED
$CLAIM
$FINISH
$OLD_SYNC

-- ── test helpers (schema t) ─────────────────────────────────────────────────
create function t.usr(p_email text, p_confirmed boolean default true) returns uuid language plpgsql as \$f\$
declare v uuid; begin
  insert into auth.users (email, email_confirmed_at) values (p_email, case when p_confirmed then now() end) returning id into v;
  insert into public.profiles (id) values (v); return v; end \$f\$;
create function t.ent(p_user uuid, p_status text default 'ACTIVE', p_starts interval default '-1 day',
                      p_expires interval default null) returns void language sql as \$f\$
  insert into public.grovnews_entitlements (user_id, status, starts_at, expires_at)
  values (p_user, p_status, now() + p_starts, case when p_expires is null then null else now() + p_expires end) \$f\$;
create function t.contact(p_email text, p_user uuid default null, p_consent boolean default true) returns uuid
language sql as \$f\$
  insert into public.newsletter_contacts (email, user_id, marketing_consent, consent_at)
  values (lower(p_email), p_user, p_consent, case when p_consent then now() end) returning id \$f\$;
create function t.grp() returns uuid language sql as \$f\$
  insert into public.newsletter_groups (key, name) values ('grovnews', 'g')
  on conflict (key) do update set key = excluded.key returning id \$f\$;
create function t.other_grp() returns uuid language sql as \$f\$
  insert into public.newsletter_groups (key, name) values ('main', 'm')
  on conflict (key) do update set key = excluded.key returning id \$f\$;
-- kind: edition | group | mixed | plain
create function t.campaign(p_kind text) returns uuid language plpgsql as \$f\$
declare v uuid; v_aud jsonb; begin
  v_aud := case p_kind
    when 'group' then jsonb_build_object('include', jsonb_build_array(t.grp()::text), 'exclude', '[]'::jsonb)
    when 'mixed' then jsonb_build_object('include', jsonb_build_array(t.grp()::text, t.other_grp()::text), 'exclude', '[]'::jsonb)
    when 'edition' then jsonb_build_object('include', jsonb_build_array(t.grp()::text), 'exclude', '[]'::jsonb)
    else jsonb_build_object('include', jsonb_build_array(t.other_grp()::text), 'exclude', '[]'::jsonb) end;
  insert into public.newsletter_campaigns (audience) values (v_aud) returning id into v;
  if p_kind = 'edition' then insert into public.grovnews_editions (campaign_id) values (v); end if;
  return v; end \$f\$;
create function t.q(p_campaign uuid, p_contact uuid) returns uuid language sql as \$f\$
  insert into public.newsletter_recipients (campaign_id, contact_id, email)
  select p_campaign, c.id, c.email from public.newsletter_contacts c where c.id = p_contact returning id \$f\$;
-- one verdict as "grovnews/allowed", e.g. "t/f"; "absent" when the guard left it out
create function t.v(p_id uuid) returns text language sql as \$f\$
  select coalesce((select (case when g.grovnews then 't' else 'f' end) || '/' || (case when g.allowed then 't' else 'f' end)
                     from public.grovnews_send_guard('$TOKEN', array[p_id]) g), 'absent') \$f\$;
create function t.claimed(p_limit integer default 200) returns setof uuid language sql as \$f\$
  select id from public.newsletter_queue_claim('$TOKEN', p_limit) \$f\$;
create function t.reset() returns void language sql as \$f\$
  truncate public.newsletter_events, public.newsletter_recipients, public.grovnews_editions,
           public.newsletter_campaigns, public.newsletter_group_members, public.newsletter_groups,
           public.newsletter_suppressions, public.newsletter_contacts, public.grovnews_entitlements,
           public.profiles, auth.users cascade \$f\$;
SQL

# THE MIGRATION UNDER TEST, as shipped.
"${PSQL[@]}" -f "$MIGRATION" >/dev/null

echo
echo "T1–T4. ACCESS LOST AFTER QUEUEING (real claim → guard → finish)"
q "select t.reset()" >/dev/null
r=$(q "with u as (select t.usr('t1@x.pl') id), e as (select t.ent(id) from u), c as (select t.contact('t1@x.pl', (select id from u)) id)
       select t.q(t.campaign('edition'), (select id from c)) from e")
q "update public.grovnews_entitlements set status = 'REVOKED'" >/dev/null
check "T1 the claim still hands the revoked reader's row over (the gap being closed)" \
  "$(q "select count(*) from t.claimed() x where x = '$r'")" "1"
check "T1 guard: GrovNews row, NOT allowed" "$(q "select t.v('$r')")" "t/f"
q "select public.newsletter_queue_finish('$TOKEN', '$r', 'skipped', 'grovnews_access_inactive')" >/dev/null
check "T1 → finished 'skipped' with reason grovnews_access_inactive" \
  "$(q "select status || ':' || last_error_safe from public.newsletter_recipients where id = '$r'")" "skipped:grovnews_access_inactive"
check "T1 → no 'sent' event, contact not stamped as mailed" \
  "$(q "select (select count(*) from public.newsletter_events)::text || '/' || coalesce((select last_sent_at::text from public.newsletter_contacts), 'null')")" "0/null"
check "T1 → the campaign still closes itself (newsletter's own finish logic)" \
  "$(q "select status from public.newsletter_campaigns")" "sent"

q "select t.reset()" >/dev/null
r=$(q "with u as (select t.usr('t2@x.pl') id), e as (select t.ent(id, 'ACTIVE', '-1 day', '2 seconds') from u),
            c as (select t.contact('t2@x.pl', (select id from u)) id)
       select t.q(t.campaign('edition'), (select id from c)) from e")
check "T2 entitlement still inside its window → allowed" "$(q "select t.v('$r')")" "t/t"
q "select pg_sleep(2.3)" >/dev/null
check "T2 the SAME row after the window closed by the clock alone → NOT allowed" "$(q "select t.v('$r')")" "t/f"
q "select t.reset()" >/dev/null
r=$(q "with u as (select t.usr('t2b@x.pl') id), e as (select t.ent(id, 'ACTIVE', '-2 day', '-1 minute') from u),
            c as (select t.contact('t2b@x.pl', (select id from u)) id)
       select t.q(t.campaign('edition'), (select id from c)) from e")
check "T2 expires_at already in the past → NOT allowed" "$(q "select t.v('$r')")" "t/f"
q "select t.reset()" >/dev/null
r=$(q "with u as (select t.usr('t2c@x.pl') id), e as (select t.ent(id, 'ACTIVE', '+1 day') from u),
            c as (select t.contact('t2c@x.pl', (select id from u)) id)
       select t.q(t.campaign('edition'), (select id from c)) from e")
check "T2 a window that has not started yet → NOT allowed" "$(q "select t.v('$r')")" "t/f"

q "select t.reset()" >/dev/null
r=$(q "with u as (select t.usr('t3@x.pl') id), e as (select t.ent(id) from u), c as (select t.contact('t3@x.pl', (select id from u)) id)
       select t.q(t.campaign('edition'), (select id from c)) from e")
q "update public.profiles set blocked = true" >/dev/null
check "T3 account blocked after enqueue (entitlement untouched) → NOT allowed" "$(q "select t.v('$r')")" "t/f"
q "update public.profiles set blocked_until = now() - interval '1 minute'" >/dev/null
check "T3 a temporary block that has ended → allowed again (account_blocked semantics)" "$(q "select t.v('$r')")" "t/t"

q "select t.reset()" >/dev/null
r=$(q "with u as (select t.usr('t4@x.pl') id), e as (select t.ent(id) from u), c as (select t.contact('t4@x.pl', (select id from u)) id)
       select t.q(t.campaign('edition'), (select id from c)) from e")
check "T4 active reader → GrovNews row, allowed" "$(q "select t.v('$r')")" "t/t"
claimed=$(q "select count(*) from t.claimed() x where x = '$r'")
q "select public.newsletter_queue_finish('$TOKEN', '$r', 'sent')" >/dev/null
check "T4 → claimable and sendable (claim + finish 'sent')" \
  "$claimed/$(q "select status from public.newsletter_recipients where id = '$r'")" "1/sent"

echo
echo "T5. ORDINARY CAMPAIGNS ARE LEFT ALONE"
q "select t.reset()" >/dev/null
q "select t.usr('nobody@x.pl')" >/dev/null
r=$(q "select t.q(t.campaign('plain'), t.contact('nobody@x.pl', (select id from public.profiles)))")
check "T5 ordinary campaign, reader WITHOUT GrovNews access → not GrovNews, allowed" "$(q "select t.v('$r')")" "f/t"
r=$(q "select t.q(t.campaign('plain'), t.contact('waitlist@x.pl'))")
check "T5 ordinary campaign, waitlist contact with no account → allowed" "$(q "select t.v('$r')")" "f/t"
r=$(q "select t.q(t.campaign('mixed'), (select id from public.newsletter_contacts where email = 'waitlist@x.pl'))")
check "T5 campaign aimed at grovnews + another group → treated as ordinary (its other readers never needed access)" \
  "$(q "select t.v('$r')")" "f/t"
r=$(q "select t.q(t.campaign('group'), (select id from public.newsletter_contacts where email = 'nobody@x.pl'))")
check "a campaign aimed ONLY at the grovnews group by hand → held to the GrovNews rule" "$(q "select t.v('$r')")" "t/f"

echo
echo "T6/T7. SUPPRESSION AND UNSUBSCRIBE STILL WIN — before the guard is ever asked"
q "select t.reset()" >/dev/null
q "select t.ent(t.usr('sup@x.pl')); select t.ent(t.usr('uns@x.pl'))" >/dev/null
rs=$(q "select t.q(t.campaign('edition'), t.contact('sup@x.pl', (select id from auth.users where email = 'sup@x.pl')))")
ru=$(q "select t.q((select campaign_id from public.newsletter_recipients limit 1), t.contact('uns@x.pl', (select id from auth.users where email = 'uns@x.pl')))")
q "insert into public.newsletter_suppressions (email) values ('sup@x.pl');
   update public.newsletter_contacts set unsubscribed_at = now() where email = 'uns@x.pl'" >/dev/null
check "the guard alone would allow both (they ARE entitled)" "$(q "select t.v('$rs') || ' ' || t.v('$ru')")" "t/t t/t"
check "T6 suppressed → the real claim never hands the row over" "$(q "select count(*) from t.claimed() x where x = '$rs'")" "0"
check "T7 unsubscribed → the real claim never hands the row over" "$(q "select count(*) from t.claimed() x where x = '$ru'")" "0"

echo
echo "T8. AN SMTP RETRY IS RE-CHECKED"
q "select t.reset()" >/dev/null
r=$(q "with u as (select t.usr('t8@x.pl') id), e as (select t.ent(id) from u), c as (select t.contact('t8@x.pl', (select id from u)) id)
       select t.q(t.campaign('edition'), (select id from c)) from e")
q "select count(*) from t.claimed()" >/dev/null
q "select public.newsletter_queue_finish('$TOKEN', '$r', 'failed', '451 try later')" >/dev/null
check "T8 SMTP failure → back to 'pending' with a backoff (unchanged newsletter behaviour)" \
  "$(q "select status || ':' || (next_attempt_at > now())::text from public.newsletter_recipients where id = '$r'")" "pending:true"
q "update public.grovnews_entitlements set status = 'REVOKED';
   update public.newsletter_recipients set next_attempt_at = now() - interval '1 second' where id = '$r'" >/dev/null
check "T8 the retry is claimed again…" "$(q "select count(*) from t.claimed() x where x = '$r'")" "1"
check "T8 …and the guard refuses it at send time" "$(q "select t.v('$r')")" "t/f"

echo
echo "T9. ONE BATCH, MIXED READERS — ONE GUARD CALL"
q "select t.reset()" >/dev/null
q "select t.ent(t.usr('ok@x.pl')); select t.ent(t.usr('rev@x.pl'), 'REVOKED');
   select t.ent(t.usr('exp@x.pl'), 'ACTIVE', '-2 day', '-1 second'); select t.ent(t.usr('blk@x.pl'));
   update public.profiles set blocked = true where id = (select id from auth.users where email = 'blk@x.pl');
   select t.usr('never@x.pl')" >/dev/null
q "select t.campaign('edition')" >/dev/null
for e in ok rev exp blk never; do
  q "select t.q((select campaign_id from public.grovnews_editions), t.contact('$e@x.pl', (select id from auth.users where email = '$e@x.pl')))" >/dev/null
done
q "select t.q(t.campaign('plain'), t.contact('plain@x.pl'))" >/dev/null
check "T9 all six rows are claimed in one batch" "$(q "select count(*) from t.claimed()")" "6"
check "T9 one guard call answers every row correctly" \
  "$(q "select string_agg(split_part(r.email, '@', 1) || '=' || (case when g.grovnews then 't' else 'f' end) || (case when g.allowed then 't' else 'f' end), ' ' order by r.email)
         from public.grovnews_send_guard('$TOKEN', (select array_agg(id) from public.newsletter_recipients)) g
         join public.newsletter_recipients r on r.id = g.recipient_id")" \
  "blk=tf exp=tf never=tf ok=tt plain=ft rev=tf"

echo
echo "LINKING. WHO A CONTACT IS (0121's rules, unchanged)"
q "select t.reset()" >/dev/null
q "select t.ent(t.usr('Mixed.Case@X.pl')); select t.ent(t.usr('unconfirmed@x.pl', false))" >/dev/null
ra=$(q "select t.q(t.campaign('edition'), t.contact('mixed.case@x.pl'))")
rb=$(q "select t.q((select campaign_id from public.grovnews_editions), t.contact('unconfirmed@x.pl'))")
rc=$(q "select t.q((select campaign_id from public.grovnews_editions), t.contact('stranger@x.pl'))")
check "unlinked contact → linked by the CONFIRMED sign-in address (case-insensitive)" "$(q "select t.v('$ra')")" "t/t"
check "unlinked contact whose account never confirmed its address → NOT allowed" "$(q "select t.v('$rb')")" "t/f"
check "contact with no account at all → NOT allowed" "$(q "select t.v('$rc')")" "t/f"
q "update public.newsletter_contacts set user_id = (select id from auth.users where email = 'unconfirmed@x.pl') where email = 'unconfirmed@x.pl'" >/dev/null
check "linked contact whose account never confirmed its address → NOT allowed" "$(q "select t.v('$rb')")" "t/f"
check "a recipient id that does not exist → absent from the answer (sent nothing)" \
  "$(q "select t.v(gen_random_uuid())")" "absent"

echo
echo "ONE SOURCE OF TRUTH. READER, GROUP SYNC AND GUARD AGREE"
q "select t.reset()" >/dev/null
q "select t.ent(t.usr('a@x.pl')); select t.ent(t.usr('b@x.pl'), 'REVOKED'); select t.usr('c@x.pl')" >/dev/null
check "grovnews_has_access() for an entitled reader (auth.uid() = them)" \
  "$(q "select set_config('request.jwt.claim.sub', (select id::text from auth.users where email = 'a@x.pl'), false); select public.grovnews_has_access()" | tail -1)" "t"
check "grovnews_has_access() for a revoked reader" \
  "$(q "select set_config('request.jwt.claim.sub', (select id::text from auth.users where email = 'b@x.pl'), false); select public.grovnews_has_access()" | tail -1)" "f"
check "grovnews_has_access() for nobody (anonymous)" \
  "$(q "select set_config('request.jwt.claim.sub', '', false); select public.grovnews_has_access()" | tail -1)" "f"

# EQUIVALENCE: the Stage 2 group sync (0121) and the new one (0122) must pick
# the same members across every state the access rule distinguishes.
q "select t.reset()" >/dev/null
q "select t.ent(t.usr('m-active@x.pl'));
   select t.ent(t.usr('m-revoked@x.pl'), 'REVOKED');
   select t.ent(t.usr('m-expired@x.pl'), 'ACTIVE', '-2 day', '-1 minute');
   select t.ent(t.usr('m-future@x.pl'), 'ACTIVE', '+1 day');
   select t.ent(t.usr('m-blocked@x.pl')); update public.profiles set blocked = true where id = (select id from auth.users where email = 'm-blocked@x.pl');
   select t.ent(t.usr('m-blockover@x.pl')); update public.profiles set blocked = true, blocked_until = now() - interval '1 hour' where id = (select id from auth.users where email = 'm-blockover@x.pl');
   select t.ent(t.usr('m-unconf@x.pl', false));
   select t.ent(t.usr('M-Upper@x.pl'));
   select t.usr('m-none@x.pl')" >/dev/null
q "select t.contact(email, id) from auth.users where email not in ('M-Upper@x.pl', 'm-unconf@x.pl');
   select t.contact('m-upper@x.pl'); select t.contact('m-unconf@x.pl'); select t.contact('m-waitlist@x.pl')" >/dev/null
q "select t.old_group_sync_core()" >/dev/null
OLD=$(q "select string_agg(c.email, ',' order by c.email) from public.newsletter_group_members m join public.newsletter_contacts c on c.id = m.contact_id")
q "delete from public.newsletter_group_members; select public.grovnews_group_sync_core()" >/dev/null
NEW=$(q "select string_agg(c.email, ',' order by c.email) from public.newsletter_group_members m join public.newsletter_contacts c on c.id = m.contact_id")
check "group sync: 0122 picks EXACTLY the members 0121 picked" "$NEW" "$OLD"
check "group sync: those members are the active, unblocked-or-block-over, confirmed readers" "$NEW" "m-active@x.pl,m-blockover@x.pl,m-upper@x.pl"
GUARDED=$(q "select string_agg(c.email, ',' order by c.email) from public.newsletter_contacts c
              where c.id in (select public.grovnews_eligible_contacts((select array_agg(id) from public.newsletter_contacts)))")
check "group sync and the send guard give the same answer for every contact" "$GUARDED" "$NEW"
q "update public.grovnews_entitlements set status = 'REVOKED' where user_id = (select id from auth.users where email = 'm-active@x.pl')" >/dev/null
check "a revoke is honoured by the next group sync (removed: 1)" "$(q "select public.grovnews_group_sync_core()->>'removed'")" "1"
q "update public.newsletter_groups set is_dynamic = true where key = 'grovnews'" >/dev/null
check "a dynamic grovnews group is still refused" \
  "$(q "do \$\$ begin perform public.grovnews_group_sync_core(); raise notice 'no'; exception when others then raise exception '%', sqlerrm; end \$\$" 2>&1 | grep -o 'grovnews_group_dynamic' | head -1)" "grovnews_group_dynamic"


echo
echo "SCALE. GROUP SYNC STAYS ONE PASS (review finding: no per-contact scan)"
q "select t.reset()" >/dev/null
q "insert into auth.users (email, email_confirmed_at) select 'u' || g || '@scale.pl', now() from generate_series(1, 3000) g;
   insert into public.profiles (id) select id from auth.users;
   insert into public.grovnews_entitlements (user_id) select id from auth.users where (split_part(split_part(email, '@', 1), 'u', 2))::int % 3 <> 0;
   insert into public.newsletter_contacts (email, user_id, marketing_consent, consent_at)
     select email, id, true, now() from auth.users where (split_part(split_part(email, '@', 1), 'u', 2))::int <= 1500;
   insert into public.newsletter_contacts (email, marketing_consent, consent_at)
     select email, true, now() from auth.users where (split_part(split_part(email, '@', 1), 'u', 2))::int > 1500;
   insert into public.newsletter_contacts (email, marketing_consent, consent_at)
     select 'w' || g || '@waitlist.pl', true, now() from generate_series(1, 5000) g;
   analyze" >/dev/null
OLD_MS=$(q "select extract(milliseconds from clock_timestamp() - now()) from (select t.old_group_sync_core()) x" | tail -1)
OLD_SET=$(q "select md5(string_agg(contact_id::text, ',' order by contact_id)) from public.newsletter_group_members")
NEW_T=$(q "delete from public.newsletter_group_members;
           set statement_timeout = '3s';
           select extract(milliseconds from clock_timestamp() - now())::int from (select public.grovnews_group_sync_core()) x" | tail -1)
NEW_SET=$(q "select md5(string_agg(contact_id::text, ',' order by contact_id)) from public.newsletter_group_members")
echo "    (3 000 users, 9 500 contacts: 0121 ${OLD_MS%.*} ms, 0122 ${NEW_T} ms)"
check "scale: 0122 group sync picks exactly 0121's members" "$NEW_SET" "$OLD_SET"
check "scale: 0122 group sync finishes inside anon's 3 s statement_timeout" "$([ -n "$NEW_T" ] && [ "$NEW_T" -lt 3000 ] && echo yes || echo no)" "yes"
check "scale: 0122 group sync is no slower than 3x the 0121 sync" \
  "$(awk -v n="$NEW_T" -v o="${OLD_MS:-1}" 'BEGIN { print (n <= 3 * o + 100) ? "yes" : "no" }')" "yes"
G=$(q "select extract(milliseconds from clock_timestamp() - now())::int from (select count(*) from public.grovnews_send_guard('$TOKEN',
         (select array_agg(r) from (select t.q(t.campaign('edition'), c.id) r from public.newsletter_contacts c order by c.email limit 200) x))) y" | tail -1)
echo "    (guard over a 200-row batch: ${G} ms)"
check "scale: one 200-row guard call stays well under a second" "$([ -n "$G" ] && [ "$G" -lt 1000 ] && echo yes || echo no)" "yes"
echo
echo "DOORS. WHO MAY ASK"
for role in anon authenticated; do
  check "$role cannot call grovnews_user_has_access (nobody asks about someone else)" \
    "$(q "select has_function_privilege('$role', 'public.grovnews_user_has_access(uuid)', 'execute')")" "f"
  check "$role cannot call grovnews_eligible_contacts" \
    "$(q "select has_function_privilege('$role', 'public.grovnews_eligible_contacts(uuid[])', 'execute')")" "f"
  check "$role CAN reach grovnews_send_guard (the worker's anon client) — token decides" \
    "$(q "select has_function_privilege('$role', 'public.grovnews_send_guard(text, uuid[])', 'execute')")" "t"
done
check "public (default) cannot call the resolver" \
  "$(q "select has_function_privilege('public', 'public.grovnews_user_has_access(uuid)', 'execute')")" "f"
check "anon calling the resolver directly is refused by Postgres" \
  "$(q "set role anon; select public.grovnews_user_has_access(gen_random_uuid())" 2>&1 | grep -o 'permission denied' | head -1)" "permission denied"
check "anon calling the guard with a wrong token → forbidden" \
  "$(q "set role anon; select * from public.grovnews_send_guard('wrong', array[gen_random_uuid()])" 2>&1 | grep -o 'forbidden' | head -1)" "forbidden"
check "anon calling the guard with no token → forbidden" \
  "$(q "set role anon; select * from public.grovnews_send_guard(null, array[gen_random_uuid()])" 2>&1 | grep -o 'forbidden' | head -1)" "forbidden"
check "the guard refuses more than 200 ids" \
  "$(q "select * from public.grovnews_send_guard('$TOKEN', (select array_agg(gen_random_uuid()) from generate_series(1, 201)))" 2>&1 | grep -o 'too_many_recipients' | head -1)" "too_many_recipients"
check "group sync core stays internal (no client role may call it)" \
  "$(q "select has_function_privilege('anon', 'public.grovnews_group_sync_core()', 'execute')::text || '/' || has_function_privilege('authenticated', 'public.grovnews_group_sync_core()', 'execute')::text")" "false/false"
check "grovnews_has_access keeps its grants (authenticated yes, anon no)" \
  "$(q "select has_function_privilege('authenticated', 'public.grovnews_has_access()', 'execute')::text || '/' || has_function_privilege('anon', 'public.grovnews_has_access()', 'execute')::text")" "true/false"

echo
if [ "$fails" -eq 0 ]; then echo "All GrovNews Stage 2.1 SQL tests passed."; else echo "$fails FAILED"; fi
"${PSQL0[@]}" -d postgres -c "drop database if exists $DB" >/dev/null
[ "$fails" -eq 0 ]
