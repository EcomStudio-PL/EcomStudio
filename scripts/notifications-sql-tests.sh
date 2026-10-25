#!/usr/bin/env bash
#
# POWIADOMIENIA V2 (0160), PROVEN AGAINST A REAL POSTGRES.
#
# What has to hold:
#   · the backfill classifies history by its real type, marks ONLY the
#     generation rows read, and a second run changes nothing;
#   · the category is the trigger's, never the caller's; a customer can insert
#     only the ordinary columns and update only read_at / banner_dismissed_at;
#   · an announcement reaches exactly its audience (a plan means that plan),
#     once per user however often it is processed; only an admin can count,
#     publish or withdraw; a scheduled one waits for its time;
#   · the bell counts unread IMPORTANT only, pins "Ważny" first, offers its bar
#     until that user closes it — closing is not reading;
#   · withdrawal removes it from every recipient and keeps its read count;
#   · activity older than 30 days goes, important stays;
#   · a failed plan invoice and a cancelled plan ending within 3 days each
#     notify the owners once; any other payment event notifies nobody;
#   · the favourite ring is added ON, and an admin's OFF survives a re-run.
#
# The rehearsal schema is the part of PROD 0160 touches (notifications with
# its PROD policies, profiles, workspaces, plans, subscriptions,
# payment_events, app_settings), with is_admin EXTRACTED from 0002.
#
# Local harness only, its own database, removed on exit (KEEP_DB=1 keeps it).
#
#   bash scripts/pg-harness-up.sh && npm run test:notifications:sql
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
PGCONN=(-h "$PGSOCK" -p "$PGPORT" -U postgres)

if ! psql "${PGCONN[@]}" -d postgres -X -q -t -A -c 'select 1' >/dev/null 2>&1; then
  echo "notifications-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
M="$ROOT/supabase/migrations"
MIG="$M/0160_notifications_v2.sql"
[ -f "$MIG" ] || { echo "notifications-sql: $MIG not found" >&2; exit 2; }

extract() { # file, function name, end marker regex
  awk -v start="^create (or replace )?function public[.]$2[(]" -v stop="$3" \
    '$0 ~ start {on=1} on {print} on && $0 ~ stop {exit}' "$1"
}
IS_ADMIN=$(extract "$M/0002_functions_and_triggers.sql" is_admin '^[$][$];')
[ -n "$IS_ADMIN" ] || { echo "notifications-sql: could not extract is_admin" >&2; exit 2; }

DB="${NOTIF_DB:-notifications_sqltest}"
WORK=$(mktemp -d)
cleanup() {
  [ "${KEEP_DB:-0}" = "1" ] || dropdb "${PGCONN[@]}" --if-exists --force "$DB" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
q() { psql "${PGCONN[@]}" -d "$DB" -v ON_ERROR_STOP=1 -X -q -t -A "$@"; }

dropdb "${PGCONN[@]}" --if-exists --force "$DB" >/dev/null 2>&1 || true
createdb "${PGCONN[@]}" "$DB"

q >/dev/null <<'SQL'
set client_min_messages = warning;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth;
grant usage on schema public, auth to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
create function auth.uid() returns uuid language sql stable as $f$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$f$;
create table public.profiles (id uuid primary key, email text not null default '', role text not null default 'user');
create table public.app_settings (key text primary key, value jsonb not null default '{}'::jsonb);
create table public.workspace_members (workspace_id uuid not null, user_id uuid not null references public.profiles(id), role text not null default 'owner', created_at timestamptz default now());
create table public.subscription_plans (id uuid primary key default gen_random_uuid(), slug text unique, name text, price_cents integer not null default 0);
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(), workspace_id uuid not null, plan_id uuid references public.subscription_plans(id),
  status text not null, current_period_start timestamptz, current_period_end timestamptz,
  cancel_at_period_end boolean not null default false, created_at timestamptz not null default now());
create table public.payment_events (
  stripe_event_id text primary key, event_type text not null, object_id text, workspace_id uuid,
  outcome text not null default 'recorded', detail jsonb not null default '{}'::jsonb, received_at timestamptz default now());
-- notifications as 0013 created it, with the policies PROD has today.
create table public.notifications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null default 'info', title text not null, body text, href text,
  read_at timestamptz, created_at timestamptz not null default now());
create index notifications_user_idx on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
create table public.test_results (name text, ok boolean, detail text);
grant insert on public.test_results to anon, authenticated;
SQL
q >/dev/null <<SQL
$IS_ADMIN
SQL
q >/dev/null <<'SQL'
create policy notifications_insert on public.notifications for insert
  with check ((user_id = (select auth.uid())) or (select public.is_admin()));
create policy notifications_own_read on public.notifications for select using (user_id = (select auth.uid()));
create policy notifications_own_update on public.notifications for update using (user_id = (select auth.uid()));

-- People: an admin, a Pro customer, a Starter customer, a Free customer
-- (live Free subscription), a customer with an expired Pro, and nobody else.
insert into public.profiles (id, email, role) values
  ('00000000-0000-0000-0000-00000000000a', 'admin@x', 'admin'),
  ('00000000-0000-0000-0000-000000000001', 'pro@x', 'user'),
  ('00000000-0000-0000-0000-000000000002', 'starter@x', 'user'),
  ('00000000-0000-0000-0000-000000000003', 'free@x', 'user'),
  ('00000000-0000-0000-0000-000000000004', 'lapsed@x', 'user');
insert into public.subscription_plans (id, slug, name, price_cents) values
  ('10000000-0000-0000-0000-000000000000', 'free', 'Free', 0),
  ('10000000-0000-0000-0000-000000000001', 'starter', 'Starter', 9900),
  ('10000000-0000-0000-0000-000000000002', 'pro', 'Pro', 29900);
insert into public.workspace_members (workspace_id, user_id, role) values
  ('20000000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-00000000000a', 'owner'),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'owner'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', 'owner'),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000003', 'owner'),
  ('20000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000004', 'owner');
insert into public.subscriptions (workspace_id, plan_id, status, current_period_start, current_period_end) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', 'active', now() - interval '20 days', now() + interval '10 days'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'active', now() - interval '20 days', now() + interval '10 days'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000000', 'active', now() - interval '20 days', now() + interval '10 days'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', 'canceled', now() - interval '60 days', now() - interval '30 days');
insert into public.app_settings (key, value) values ('general', '{"app_name": "GrovBase"}');

-- History, as PROD holds it: generations (some unread), credits, a reply, a gift.
insert into public.notifications (user_id, type, title, body, href, read_at, created_at) values
  ('00000000-0000-0000-0000-000000000001', 'generation_done', 'generation_done', 'thumbnail ×1', '/library', null, now() - interval '2 days'),
  ('00000000-0000-0000-0000-000000000001', 'generation_failed', 'generation_failed', 'provider_error', '/history', null, now() - interval '3 days'),
  ('00000000-0000-0000-0000-000000000001', 'generation_done', 'generation_done', 'Pro ×2', '/library', now() - interval '1 day', now() - interval '5 days'),
  ('00000000-0000-0000-0000-000000000001', 'credits_granted', 'credits_granted', '+50 · zwrot', '/credits', null, now() - interval '4 days'),
  ('00000000-0000-0000-0000-000000000002', 'support_reply', 'support_reply', 'Temat', '/support', now(), now() - interval '6 days'),
  ('00000000-0000-0000-0000-000000000003', 'bonus', 'Bonus', 'Odbierz', '/home?bonus=1', null, now() - interval '1 day');
SQL

q -f "$MIG" >/dev/null 2>"$WORK/mig1.err" || { cat "$WORK/mig1.err" >&2; exit 1; }
SNAP1=$(q -c "select md5(string_agg(id::text || category || coalesce(read_at::text,'-') || coalesce(meta::text,''), ',' order by id)) from public.notifications")
q -f "$MIG" >/dev/null 2>"$WORK/mig2.err" || { cat "$WORK/mig2.err" >&2; exit 1; }
SNAP2=$(q -c "select md5(string_agg(id::text || category || coalesce(read_at::text,'-') || coalesce(meta::text,''), ',' order by id)) from public.notifications")

q >/dev/null <<SQL
insert into public.test_results values ('rerun changes nothing', '$SNAP1' = '$SNAP2', '$SNAP1 / $SNAP2');
SQL

q >/dev/null <<'SQL'
set client_min_messages = warning;
create or replace function pg_temp.as_user(p uuid) returns void language sql as $f$
  select set_config('request.jwt.claim.sub', p::text, false), set_config('role', 'authenticated', false)
$f$;
create or replace function pg_temp.as_owner() returns void language sql as $f$
  select set_config('role', 'postgres', false), set_config('request.jwt.claim.sub', '', false)
$f$;

-- ── backfill ──────────────────────────────────────────────────────────────
insert into public.test_results
select 'history: generations → activity, read', bool_and(category = 'activity' and read_at is not null), count(*)::text
  from public.notifications where type like 'generation_%';
insert into public.test_results
select 'history: credits/bonus stay important + unread', bool_and(category = 'important' and read_at is null), count(*)::text
  from public.notifications where type in ('credits_granted', 'bonus');
insert into public.test_results
select 'history: a reply keeps its read state', bool_and(category = 'important' and read_at is not null), count(*)::text
  from public.notifications where type = 'support_reply';
insert into public.test_results
select 'history: nothing deleted', count(*) = 6, count(*)::text from public.notifications;

-- ── what a customer may write ────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
insert into public.notifications (user_id, type, title, meta)
  values ('00000000-0000-0000-0000-000000000001', 'generation_done', 'generation_done', '{"tool":"retouch","count":1}');
insert into public.notifications (user_id, type, title)
  values ('00000000-0000-0000-0000-000000000001', 'credits_granted', 'credits_granted');
select pg_temp.as_owner();
insert into public.test_results
select 'trigger: a generation is activity', category = 'activity', category
  from public.notifications where meta->>'tool' = 'retouch';

select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
do $$ begin
  begin
    insert into public.notifications (user_id, type, title, category) values (auth.uid(), 'generation_done', 'x', 'important');
    insert into public.test_results values ('customer cannot set the category', false, 'inserted');
  exception when insufficient_privilege then
    insert into public.test_results values ('customer cannot set the category', true, sqlerrm);
  end;
  begin
    insert into public.notifications (user_id, type, title, pinned) values (auth.uid(), 'announcement', 'x', true);
    insert into public.test_results values ('customer cannot pin', false, 'inserted');
  exception when insufficient_privilege then
    insert into public.test_results values ('customer cannot pin', true, sqlerrm);
  end;
  begin
    update public.notifications set title = 'changed' where user_id = auth.uid();
    insert into public.test_results values ('customer cannot rewrite a title', false, 'updated');
  exception when insufficient_privilege then
    insert into public.test_results values ('customer cannot rewrite a title', true, sqlerrm);
  end;
  begin
    insert into public.notifications (user_id, type, title) values ('00000000-0000-0000-0000-000000000002', 'bonus', 'x');
    insert into public.test_results values ('customer cannot notify someone else', false, 'inserted');
  exception when insufficient_privilege then
    insert into public.test_results values ('customer cannot notify someone else', true, sqlerrm);
  end;
  begin
    perform public.announcement_audience_count('{"kind":"all"}');
    insert into public.test_results values ('customer cannot count an audience', false, 'counted');
  exception when others then
    insert into public.test_results values ('customer cannot count an audience', true, sqlerrm);
  end;
end $$;
insert into public.test_results
select 'customer reads only their own', bool_and(user_id = auth.uid()), count(*)::text from public.notifications;
insert into public.test_results
select 'bell: unread counts important only', (public.notification_bell(20)->>'unread')::int = 2,
       public.notification_bell(20)->>'unread';
select pg_temp.as_owner();

-- ── announcements ────────────────────────────────────────────────────────
insert into public.admin_announcements (id, title, body, priority, audience, status, publish_at, created_by) values
  ('30000000-0000-0000-0000-000000000001', 'Tylko Pro', 'Treść', 'normal',
   '{"kind":"plans","plan_ids":["10000000-0000-0000-0000-000000000002"]}', 'scheduled', now(), '00000000-0000-0000-0000-00000000000a'),
  ('30000000-0000-0000-0000-000000000002', 'Ważne dla wszystkich', 'Treść', 'important',
   '{"kind":"all"}', 'scheduled', now(), '00000000-0000-0000-0000-00000000000a'),
  ('30000000-0000-0000-0000-000000000003', 'Później', 'Treść', 'normal',
   '{"kind":"no_plan"}', 'scheduled', now() + interval '1 hour', '00000000-0000-0000-0000-00000000000a');

select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
do $$ begin
  begin
    perform public.announcement_process('30000000-0000-0000-0000-000000000001');
    insert into public.test_results values ('customer cannot publish', false, 'published');
  exception when others then
    insert into public.test_results values ('customer cannot publish', true, sqlerrm);
  end;
end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into public.test_results
select 'audience: Pro plan = 1 user', public.announcement_audience_count('{"kind":"plans","plan_ids":["10000000-0000-0000-0000-000000000002"]}') = 1, '';
insert into public.test_results
select 'audience: no plan = admin, free, lapsed', public.announcement_audience_count('{"kind":"no_plan"}') = 3, '';
insert into public.test_results
select 'audience: one user', public.announcement_audience_count('{"kind":"user","user_id":"00000000-0000-0000-0000-000000000004"}') = 1, '';
select public.announcement_process('30000000-0000-0000-0000-000000000001');
select public.announcement_process('30000000-0000-0000-0000-000000000001');
select public.announcement_process('30000000-0000-0000-0000-000000000002');
select public.announcement_process('30000000-0000-0000-0000-000000000003');
select pg_temp.as_owner();
select public.announcements_cron_tick();
insert into public.test_results
select 'Pro-only reaches only Pro, once', count(*) = 1 and bool_and(user_id = '00000000-0000-0000-0000-000000000001'), count(*)::text
  from public.notifications where announcement_id = '30000000-0000-0000-0000-000000000001';
insert into public.test_results
select 'all reaches all 5, pinned, important', count(*) = 5 and bool_and(pinned and category = 'important'), count(*)::text
  from public.notifications where announcement_id = '30000000-0000-0000-0000-000000000002';
insert into public.test_results
select 'scheduled waits for its time', count(*) = 0, count(*)::text
  from public.notifications where announcement_id = '30000000-0000-0000-0000-000000000003';
update public.admin_announcements set publish_at = now() - interval '1 minute' where id = '30000000-0000-0000-0000-000000000003';
select public.announcements_cron_tick();
select public.announcements_cron_tick();
insert into public.test_results
select 'the minute tick publishes it, once', count(*) = 3, count(*)::text
  from public.notifications where announcement_id = '30000000-0000-0000-0000-000000000003';
insert into public.test_results
select 'recipient count recorded', recipient_count = 5, recipient_count::text
  from public.admin_announcements where id = '30000000-0000-0000-0000-000000000002';

-- ── the bell for the Pro customer ────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
insert into public.test_results
select 'bell: badge = old credit + new credit + 2 announcements', (b->>'unread')::int = 4, b->>'unread'
  from (select public.notification_bell(20) b) x;
insert into public.test_results
select 'bell: the important one is pinned first', b->'important'->0->>'title' = 'Ważne dla wszystkich', b->'important'->0->>'title'
  from (select public.notification_bell(20) b) x;
insert into public.test_results
select 'bell: bar offered for the important one', b->'banner'->>'title' = 'Ważne dla wszystkich', coalesce(b->'banner'->>'title', 'null')
  from (select public.notification_bell(20) b) x;
update public.notifications set banner_dismissed_at = now()
 where announcement_id = '30000000-0000-0000-0000-000000000002' and user_id = auth.uid();
insert into public.test_results
select 'closing the bar: gone, still unread', b->'banner' = 'null'::jsonb and (b->>'unread')::int = 4, b->>'unread'
  from (select public.notification_bell(20) b) x;
update public.notifications set read_at = now()
 where announcement_id = '30000000-0000-0000-0000-000000000002' and user_id = auth.uid();
insert into public.test_results
select 'reading lowers the badge', (b->>'unread')::int = 3, b->>'unread'
  from (select public.notification_bell(20) b) x;
select pg_temp.as_user('00000000-0000-0000-0000-000000000002');
insert into public.test_results
select 'Starter does not see the Pro-only one', not exists (
  select 1 from jsonb_array_elements(public.notification_bell(20)->'important') e where e->>'title' = 'Tylko Pro'), '';

-- ── withdrawal ───────────────────────────────────────────────────────────
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
select public.announcement_withdraw('30000000-0000-0000-0000-000000000002');
insert into public.test_results
select 'withdrawn: read count kept', reads = 1, reads::text
  from public.announcement_stats() where announcement_id = '30000000-0000-0000-0000-000000000002';
select pg_temp.as_owner();
insert into public.test_results
select 'withdrawn: gone from every recipient', count(*) = 0, count(*)::text
  from public.notifications where announcement_id = '30000000-0000-0000-0000-000000000002';
select public.announcements_cron_tick();
insert into public.test_results
select 'withdrawn: a later tick does not bring it back', count(*) = 0, count(*)::text
  from public.notifications where announcement_id = '30000000-0000-0000-0000-000000000002';
insert into public.test_results
select 'withdrawn: the record stays', status = 'withdrawn', status
  from public.admin_announcements where id = '30000000-0000-0000-0000-000000000002';

-- ── expiry, retention ────────────────────────────────────────────────────
update public.notifications set expires_at = now() - interval '1 minute'
 where announcement_id = '30000000-0000-0000-0000-000000000001';
select pg_temp.as_user('00000000-0000-0000-0000-000000000001');
insert into public.test_results
select 'expired: off the bell', not exists (
  select 1 from jsonb_array_elements(public.notification_bell(20)->'important') e where e->>'title' = 'Tylko Pro'), '';
select pg_temp.as_owner();
insert into public.notifications (user_id, type, title, created_at) values
  ('00000000-0000-0000-0000-000000000002', 'generation_done', 'old', now() - interval '31 days'),
  ('00000000-0000-0000-0000-000000000002', 'credits_granted', 'old', now() - interval '90 days');
select public.notifications_hourly_tick();
insert into public.test_results
select 'retention: old activity gone, old important kept',
       not exists (select 1 from public.notifications where title = 'old' and category = 'activity')
       and exists (select 1 from public.notifications where title = 'old' and category = 'important'), '';

-- ── payments ─────────────────────────────────────────────────────────────
insert into public.payment_events (stripe_event_id, event_type, workspace_id, outcome) values
  ('evt_1', 'invoice.payment_failed', '20000000-0000-0000-0000-000000000001', 'failed'),
  ('evt_2', 'payment_intent.payment_failed', '20000000-0000-0000-0000-000000000002', 'failed'),
  ('evt_3', 'invoice.paid', '20000000-0000-0000-0000-000000000002', 'applied');
insert into public.payment_events (stripe_event_id, event_type, workspace_id, outcome) values
  ('evt_1', 'invoice.payment_failed', '20000000-0000-0000-0000-000000000001', 'failed') on conflict do nothing;
insert into public.test_results
select 'failed renewal → important, once, with the plan', count(*) = 1 and bool_and(type = 'renewal_failed' and category = 'important' and meta->>'plan' = 'Pro'),
       string_agg(type, ',')
  from public.notifications where dedupe_key like 'stripe:%';
update public.subscriptions set cancel_at_period_end = true, current_period_end = now() + interval '2 days'
 where workspace_id = '20000000-0000-0000-0000-000000000002';
select public.notifications_hourly_tick();
select public.notifications_hourly_tick();
insert into public.test_results
select 'cancelled plan ending in 2 days → one notice', count(*) = 1 and bool_and(category = 'important'), count(*)::text
  from public.notifications where type = 'plan_expiring';

-- ── the favourite ring ───────────────────────────────────────────────────
insert into public.test_results
select 'favorite_ring added ON, other fields kept', value->>'favorite_ring' = 'true' and value->>'app_name' = 'GrovBase', value::text
  from public.app_settings where key = 'general';
update public.app_settings set value = value || '{"favorite_ring": false}' where key = 'general';
SQL

q -f "$MIG" >/dev/null 2>"$WORK/mig3.err" || { cat "$WORK/mig3.err" >&2; exit 1; }
q >/dev/null <<'SQL'
insert into public.test_results
select 'an admin''s OFF survives a re-run', value->>'favorite_ring' = 'false', value::text
  from public.app_settings where key = 'general';
SQL

FAIL=0
while IFS='|' read -r name ok detail; do
  if [ "$ok" = "t" ]; then echo "  ok   $name"; else echo "  FAIL $name — $detail"; FAIL=1; fi
done < <(q -c "select name, ok, detail from public.test_results")
TOTAL=$(q -c "select count(*) from public.test_results")
if [ "$FAIL" = "0" ]; then echo "notifications-sql: $TOTAL/$TOTAL passed"; else echo "notifications-sql: FAILED"; exit 1; fi
