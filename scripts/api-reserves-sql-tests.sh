#!/usr/bin/env bash
#
# API RESERVE CENTER (0180), PROVEN AGAINST A REAL POSTGRES.
#
# 0180 is loaded VERBATIM, twice, on the shape of the tables it reads (taken
# from PROD's columns) with is_admin (0002), server_call_ok (0077) and
# finance_is_internal (0176) extracted from their migrations. What must hold:
#   · ADMIN ONLY: a customer and a visitor are refused by the snapshot, the
#     sale facts and every writer, and read nothing from the three tables; the
#     server token (the unattended reports) is the only other way in;
#   · the snapshot's numbers are right: provider spend from ai_provider_calls
#     only, split customer / internal (admin actor or internal workspace) /
#     system, unknown costs COUNTED (never summed as 0), credit pools and
#     tranches for customers and internal accounts apart, sales by kind;
#   · writers: a bad time zone and a negative top-up are refused, a manual
#     balance sets the base, a sync records a confirmed balance;
#   · the admin_panel channel: an enabled event lands there as 'sent', a
#     disabled one nowhere, a repeated dedupe key once per channel, and the
#     telegram / admin_email paths behave exactly as in 0055;
#   · the cron tick posts nothing without a configured destination, and posts
#     once to <newsletter origin>/api/cron/reserves with the bearer token.
#
#   bash scripts/pg-harness-up.sh && npm run test:reserves:sql
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
DB="${RESERVES_DB:-api_reserves_sqltest}"
PSQL0=(psql -h "$PGSOCK" -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -X -q -t -A)
PSQL=("${PSQL0[@]}" -d "$DB")

if ! "${PSQL0[@]}" -d postgres -c 'select 1' >/dev/null 2>&1; then
  echo "reserves-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
M="$ROOT/supabase/migrations"
MIG="$M/0180_api_reserves.sql"
extract() { awk -v start="^create (or replace )?function public[.]$2[(]" -v stop="$3" '$0 ~ start {on=1} on {print} on && $0 ~ stop {exit}' "$1"; }
IS_ADMIN=$(extract "$M/0002_functions_and_triggers.sql" is_admin '^[$][$];')
SERVER_OK=$(extract "$M/0077_server_only_rpcs.sql" server_call_ok '^end [$][$];')
INTERNAL=$(extract "$M/0176_finance_analytics.sql" finance_is_internal '^[$][$];')
[ -n "$IS_ADMIN" ] && [ -n "$SERVER_OK" ] && [ -n "$INTERNAL" ] || { echo "reserves-sql: could not extract helpers" >&2; exit 2; }

cleanup() { [ "${KEEP_DB:-0}" = "1" ] || "${PSQL0[@]}" -d postgres -c "drop database if exists $DB with (force)" >/dev/null 2>&1 || true; }
trap cleanup EXIT
PGOPTIONS="-c client_min_messages=warning" "${PSQL0[@]}" -d postgres -c "drop database if exists $DB with (force)" >/dev/null
"${PSQL0[@]}" -d postgres -c "create database $DB" >/dev/null

fails=0
check() { if [ "$2" = "$3" ]; then echo "  ✓ $1"; else echo "  ✗ $1 — got [$2], expected [$3]"; fails=$((fails+1)); fi; }
q() { "${PSQL[@]}" -c "$1"; }
as_user() { "${PSQL[@]}" -c "set role authenticated; set request.jwt.claim.sub = '$1'; $2" 2>&1 | sed -n 's/^.*ERROR:  //p;/ERROR/!p' | head -1; }
as_anon() { "${PSQL[@]}" -c "set role anon; $1" 2>&1 | sed -n 's/^.*ERROR:  //p;/ERROR/!p' | head -1; }

UA=00000000-0000-0000-0000-00000000000a
U1=00000000-0000-0000-0000-000000000001
WC=10000000-0000-0000-0000-000000000001   # a paying customer's workspace
WI=10000000-0000-0000-0000-000000000002   # the admin's own (internal) workspace
TOKEN=test-dispatch-token

"${PSQL[@]}" >/dev/null <<SQL
set client_min_messages = warning;
create extension if not exists pgcrypto;
create schema auth;
create schema extensions;
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end \$\$;
grant usage on schema public, auth, extensions to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
create function auth.uid() returns uuid language sql stable as
  \$f\$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid \$f\$;
create table public.profiles (id uuid primary key, role text not null default 'user');
insert into public.profiles values ('$UA', 'admin'), ('$U1', 'user');
create table public.app_settings (key text primary key, value jsonb not null default '{}');
insert into public.app_settings values ('notifications', jsonb_build_object('dispatch_hash', encode(digest('$TOKEN', 'sha256'), 'hex'))),
                                       ('billing', '{"internal_workspace_ids": []}');
$IS_ADMIN
$SERVER_OK
create table public.workspaces (id uuid primary key, owner_id uuid);
insert into public.workspaces values ('$WC', '$U1'), ('$WI', '$UA');
$INTERNAL
create table public.ai_providers (id uuid primary key default gen_random_uuid(), slug text unique, name text, active boolean default true, metadata jsonb default '{}', created_at timestamptz default now());
insert into public.ai_providers (slug, name, active) values ('google', 'Google Gemini', true), ('openai', 'OpenAI', true), ('anthropic', 'Anthropic', true), ('fal', 'fal.ai', true), ('photoroom', 'Photoroom', false);
create table public.ai_provider_credentials (id uuid primary key default gen_random_uuid(), provider_id uuid, active boolean default true);
create table public.ai_provider_calls (id uuid primary key default gen_random_uuid(), created_at timestamptz default now(), actor_kind text, workspace_id uuid,
  provider_slug text, model text, status text default 'succeeded', cost_usd_micros bigint, cost_basis text default 'estimated');
create table public.credit_wallets (id uuid primary key default gen_random_uuid(), workspace_id uuid unique, balance numeric(14,2) default 0);
create table public.credit_lots (id uuid primary key default gen_random_uuid(), wallet_id uuid, kind text, amount numeric(14,2), remaining numeric(14,2),
  expires_at timestamptz, payment_id uuid, expired_at timestamptz, created_at timestamptz default now());
create table public.credit_transactions (id uuid primary key default gen_random_uuid(), wallet_id uuid, amount numeric(14,2), type text, metadata jsonb default '{}', created_at timestamptz default now());
create table public.credit_lot_moves (id bigserial primary key, lot_id uuid, tx_id uuid, amount numeric(14,2), created_at timestamptz default now());
create table public.subscription_tranches (id uuid primary key default gen_random_uuid(), workspace_id uuid, payment_id uuid, credits numeric(14,2), starts_at timestamptz, status text);
create table public.subscription_plans (id uuid primary key default gen_random_uuid(), slug text, name text);
create table public.payments (id uuid primary key default gen_random_uuid(), workspace_id uuid, amount_cents integer, currency text, status text, kind text,
  plan_id uuid, billing_period text, metadata jsonb default '{}', created_at timestamptz default now());
create table public.ai_models (id uuid primary key default gen_random_uuid(), provider_id uuid, model_identifier text, name text, display_name text,
  pricing jsonb, credit_cost numeric, active boolean default true, visible_managed boolean default true, visible_custom boolean default false);
create table public.ai_unit_prices (provider_slug text, model text, unit_kind text, resolution text, quality text, usd_micros_per_unit bigint);
create table public.notification_preferences (event_type text primary key, telegram_enabled boolean not null default false,
  admin_email_enabled boolean not null default false, category text not null, sort_order integer not null default 100, updated_at timestamptz default now());
insert into public.notification_preferences (event_type, category, telegram_enabled, admin_email_enabled) values ('user.registered', 'users', true, true);
create table public.notification_outbox (id uuid primary key default gen_random_uuid(), event_type text not null, payload jsonb not null default '{}',
  dedupe_key text, status text not null default 'pending' check (status in ('pending','sent','failed','skipped')), attempts integer not null default 0,
  last_error_safe text, created_at timestamptz not null default now(), sent_at timestamptz, claimed_at timestamptz, channel text not null default 'telegram');
alter table public.notification_outbox add constraint notification_outbox_channel_check check (channel in ('telegram', 'admin_email'));
create unique index notification_outbox_channel_dedupe_key on public.notification_outbox (channel, dedupe_key) where dedupe_key is not null;
SQL

echo "0180 — loaded verbatim, twice"
"${PSQL[@]}" -c "set client_min_messages = warning;" -f "$MIG" >/dev/null 2>&1 || "${PSQL[@]}" -c "set client_min_messages = warning;" -f "$MIG"
"${PSQL[@]}" -c "set client_min_messages = warning;" -f "$MIG" >/dev/null 2>&1
check "re-runs cleanly: 3 tables, the settings row, 4 events, admin_panel column" \
  "$(q "select count(*) from pg_tables where tablename in ('api_reserve_settings','api_provider_funds','api_provider_fund_events')")/$(q "select count(*) from api_reserve_settings")/$(q "select count(*) from notification_preferences where category='finance'")/$(q "select count(*) from information_schema.columns where table_name='notification_preferences' and column_name='admin_panel_enabled'")" "3/1/4/1"
check "provider modes seeded from official capabilities (google postpaid, openai manual, fal auto)" \
  "$(q "select string_agg(p.slug || '=' || f.mode, ',' order by p.slug) from api_provider_funds f join ai_providers p on p.id = f.provider_id where p.slug in ('google','openai','fal')")" "fal=auto,google=postpaid,openai=manual"
check "defaults: buffer 20%, daily report 23:00 Europe/Warsaw" "$(q "select buffer_percent::int || '/' || daily_report_hour || '/' || report_timezone from api_reserve_settings")" "20/23/Europe/Warsaw"

# ── controlled data ────────────────────────────────────────────────────────
"${PSQL[@]}" >/dev/null <<SQL
insert into credit_wallets (id, workspace_id, balance) values ('20000000-0000-0000-0000-000000000001', '$WC', 0), ('20000000-0000-0000-0000-000000000002', '$WI', 0);
-- customer: 40 subscription credits expiring in 3 days, 100 top-up, 10 bonus; internal: 1000 legacy
insert into credit_lots (wallet_id, kind, amount, remaining, expires_at) values
  ('20000000-0000-0000-0000-000000000001', 'subscription', 55, 40, now() + interval '3 days'),
  ('20000000-0000-0000-0000-000000000001', 'topup', 100, 100, null),
  ('20000000-0000-0000-0000-000000000001', 'bonus', 10, 10, null),
  ('20000000-0000-0000-0000-000000000001', 'subscription', 20, 5, now() - interval '1 day'),
  ('20000000-0000-0000-0000-000000000002', 'legacy', 1000, 1000, null);
insert into subscription_tranches (workspace_id, credits, starts_at, status) values
  ('$WC', 125, now() + interval '20 days', 'pending'), ('$WC', 125, now() + interval '50 days', 'pending'), ('$WC', 125, now() - interval '1 day', 'granted');
-- usage: the customer used 15 credits today (one refund of 1), 30 over the week
insert into credit_transactions (wallet_id, amount, type, created_at) values
  ('20000000-0000-0000-0000-000000000001', -16, 'generation', now() - interval '2 hours'),
  ('20000000-0000-0000-0000-000000000001', 1, 'refund', now() - interval '1 hour'),
  ('20000000-0000-0000-0000-000000000001', -15, 'generation', now() - interval '3 days'),
  ('20000000-0000-0000-0000-000000000001', 55, 'subscription', now() - interval '3 hours'),
  ('20000000-0000-0000-0000-000000000002', -500, 'generation', now() - interval '1 hour');
-- provider calls: customer google 2 × \$0.134; admin anthropic \$0.05; internal-workspace customer call \$1; system openai unknown cost
insert into ai_provider_calls (actor_kind, workspace_id, provider_slug, cost_usd_micros, created_at) values
  ('customer', '$WC', 'google', 134000, now() - interval '10 minutes'),
  ('customer', '$WC', 'google', 134000, now() - interval '5 hours'),
  ('admin', null, 'anthropic', 50000, now() - interval '20 minutes'),
  ('customer', '$WI', 'google', 1000000, now() - interval '30 minutes'),
  ('system', null, 'openai', null, now() - interval '15 minutes');
insert into subscription_plans (id, slug, name) values ('30000000-0000-0000-0000-000000000001', 'pro', 'Pro');
insert into payments (id, workspace_id, amount_cents, currency, status, kind, plan_id, billing_period, metadata, created_at) values
  ('40000000-0000-0000-0000-000000000001', '$WC', 4990, 'USD', 'succeeded', 'subscription', '30000000-0000-0000-0000-000000000001', 'monthly', '{"billing_reason":"subscription_create"}', now() - interval '20 minutes'),
  ('40000000-0000-0000-0000-000000000002', '$WC', 1900, 'USD', 'succeeded', 'custom_credits', null, null, '{}', now() - interval '2 hours'),
  ('40000000-0000-0000-0000-000000000003', '$WI', 9999, 'USD', 'succeeded', 'custom_credits', null, null, '{}', now() - interval '10 minutes');
insert into credit_lots (wallet_id, kind, amount, remaining, expires_at, payment_id) values
  ('20000000-0000-0000-0000-000000000001', 'subscription', 125, 125, now() + interval '30 days', '40000000-0000-0000-0000-000000000001');
SQL

echo "admin only"
check "a customer cannot read the snapshot" "$(as_user $U1 "select public.api_reserve_snapshot()")" "not_admin"
check "a visitor cannot read the snapshot without the token" "$(as_anon "select public.api_reserve_snapshot()")" "not_admin"
check "…nor with a wrong token" "$(as_anon "select public.api_reserve_snapshot('nope')")" "not_admin"
check "the server token can (the unattended reports)" "$(as_anon "select (public.api_reserve_snapshot('$TOKEN') ? 'providers')::text")" "true"
check "the admin session can" "$(as_user $UA "select (public.api_reserve_snapshot() ? 'spend')::text")" "true"
check "a customer cannot read sale facts" "$(as_user $U1 "select public.api_reserve_sale_facts(null, '40000000-0000-0000-0000-000000000001')")" "not_admin"
check "a customer reads nothing from the funds table" "$(as_user $U1 "select count(*) from public.api_provider_funds")" "0"
check "a customer reads nothing from the settings table" "$(as_user $U1 "select count(*) from public.api_reserve_settings")" "0"
check "a customer cannot write the settings" "$(as_user $U1 "select public.api_reserve_settings_save('{\"buffer_percent\": 0}'::jsonb)")" "not_admin"
check "a customer cannot record a balance" "$(as_user $U1 "select public.api_provider_fund_record((select id from ai_providers where slug='openai'), 'balance_set', 1, null)")" "not_admin"
check "a customer cannot insert into the funds table directly" "$(as_user $U1 "insert into public.api_provider_funds (provider_id) values (gen_random_uuid())" | grep -c 'permission denied\|row-level security')" "1"
check "a visitor cannot record a sync without the token" "$(as_anon "select public.api_provider_sync_record('nope', 'fal', 'ok', 1000000, null)")" "not_admin"

echo "the snapshot's numbers"
S="select public.api_reserve_snapshot('$TOKEN')"
spend() { q "select coalesce(sum((x->>'$3')::bigint), 0) from jsonb_array_elements(($S)->'spend') x where x->>'provider_slug' = '$1' and x->>'cls' = '$2'"; }
check "customer google spend: 2 calls, \$0.268 in 24 h, \$0.134 in the last hour" "$(spend google customer d1)/$(spend google customer h1)" "268000/134000"
check "an admin-actor call is internal, not customer" "$(spend anthropic internal h1)/$(spend anthropic customer h1)" "50000/0"
check "a customer call from an internal workspace is internal" "$(spend google internal h1)" "1000000"
check "a system call with an unknown cost is COUNTED as unknown, summed as 0" \
  "$(q "select (x->>'unknown_h1') || '/' || (x->>'h1') from jsonb_array_elements(($S)->'spend') x where x->>'provider_slug' = 'openai'")" "1/0"
check "customer pools: subscription 165 (expired lot excluded), top-up 100, bonus 10" \
  "$(q "select (($S)->'pools'->'customer'->>'subscription')::numeric::int || '/' || (($S)->'pools'->'customer'->>'topup')::numeric::int || '/' || (($S)->'pools'->'customer'->>'bonus')::numeric::int")" "165/100/10"
check "…expiring within 7 days: 40" "$(q "select (($S)->'pools'->'customer'->>'expiring_7d')::numeric::int")" "40"
check "internal pools apart: legacy 1000" "$(q "select (($S)->'pools'->'internal'->>'legacy')::numeric::int")" "1000"
check "future tranches: 250 pending, 125 within the 30-day horizon" \
  "$(q "select (($S)->'tranches'->'customer'->>'total')::numeric::int || '/' || (($S)->'tranches'->'customer'->>'within_horizon')::numeric::int")" "250/125"
check "customer credits used today net of refunds: 15; over 7 days: 30" \
  "$(q "select (($S)->'credits_month'->'customer'->>'used_today')::numeric::int || '/' || (($S)->'credits_month'->'customer'->>'used_d7')::numeric::int")" "15/30"
check "sales today exclude internal workspaces: 2 (1 new subscription, 1 top-up), \$68.90" \
  "$(q "select (($S)->'sales'->'today'->>'count') || '/' || (($S)->'sales'->'today'->>'new') || '/' || (($S)->'sales'->'today'->>'topups') || '/' || (($S)->'sales'->'today'->'revenue'->>'USD')")" "2/1/1/6890"
check "sale facts: PRO, 125 credits granted, not internal" \
  "$(as_anon "select (f->>'plan_slug') || '/' || (f->>'credits_now')::numeric::int || '/' || (f->>'internal') from public.api_reserve_sale_facts('$TOKEN', '40000000-0000-0000-0000-000000000001') f")" "pro/125/false"

echo "writers"
check "an unknown time zone is refused, nothing written" "$(as_user $UA "select public.api_reserve_settings_save('{\"report_timezone\": \"Mars/Base\"}'::jsonb)" | grep -c 'time zone')" "1"
as_user $UA "select public.api_reserve_settings_save('{\"buffer_percent\": 25, \"daily_report_hour\": 22}'::jsonb)" >/dev/null
check "the admin changes the buffer and the hour" "$(q "select buffer_percent::int || '/' || daily_report_hour from api_reserve_settings")" "25/22"
check "a negative top-up is refused" "$(as_user $UA "select public.api_provider_fund_record((select id from ai_providers where slug='openai'), 'topup', -5, null)")" "bad_input"
as_user $UA "select public.api_provider_fund_record((select id from ai_providers where slug='openai'), 'balance_set', 50000000, 'z panelu')" >/dev/null
as_user $UA "select public.api_provider_fund_record((select id from ai_providers where slug='openai'), 'topup', 10000000, null)" >/dev/null
check "a manual balance becomes the base; the top-up is an event after it" \
  "$(q "select f.balance_usd_micros || '/' || f.balance_basis || '/' || (select count(*) from api_provider_fund_events e where e.provider_id = f.provider_id) from api_provider_funds f join ai_providers p on p.id = f.provider_id where p.slug='openai'")" "50000000/manual/2"
check "…and the snapshot hands the estimate its inputs (top-ups since the base)" \
  "$(q "select x->>'adjust_since_balance' from jsonb_array_elements(($S)->'providers') x where x->>'slug' = 'openai'")" "10000000"
as_anon "select public.api_provider_sync_record('$TOKEN', 'fal', 'ok', 24500000, null)" >/dev/null
check "a token sync records a CONFIRMED balance" "$(q "select f.balance_usd_micros || '/' || f.balance_basis || '/' || f.last_sync_status from api_provider_funds f join ai_providers p on p.id = f.provider_id where p.slug='fal'")" "24500000/confirmed/ok"
as_anon "select public.api_provider_sync_record('$TOKEN', 'fal', 'error', null, 'http_500')" >/dev/null
check "a failed sync keeps the last confirmed balance and says why" "$(q "select f.balance_usd_micros || '/' || f.last_sync_status || '/' || f.last_sync_error_safe from api_provider_funds f join ai_providers p on p.id = f.provider_id where p.slug='fal'")" "24500000/error/http_500"

echo "the admin_panel channel"
enq() { as_anon "select public.enqueue_notification('$1', '{\"title\":\"x\"}'::jsonb, '$2', '$TOKEN')" >/dev/null; }
enq finance.reserve_sale sale:1
check "an after-sale report lands in the panel as delivered, and on Telegram as pending" \
  "$(q "select string_agg(channel || '=' || status, ',' order by channel) from notification_outbox where dedupe_key = 'sale:1'")" "admin_panel=sent,telegram=pending"
enq finance.reserve_sale sale:1
check "the same dedupe key again: still one row per channel" "$(q "select count(*) from notification_outbox where dedupe_key = 'sale:1'")" "2"
enq finance.reserve_hourly hour:1
check "the hourly report defaults to the panel only" "$(q "select string_agg(channel, ',') from notification_outbox where dedupe_key = 'hour:1'")" "admin_panel"
q "update notification_preferences set telegram_enabled = false, admin_email_enabled = false, admin_panel_enabled = false where event_type = 'finance.funds_low'" >/dev/null
enq finance.funds_low low:1
check "an event switched off everywhere enqueues nothing" "$(q "select count(*) from notification_outbox where dedupe_key = 'low:1'")" "0"
enq user.registered reg:1
check "an existing event keeps its two 0055 channels, no panel row" "$(q "select string_agg(channel, ',' order by channel) from notification_outbox where dedupe_key = 'reg:1'")" "admin_email,telegram"
check "a wrong token enqueues nothing (oracle-free void)" "$(as_anon "select public.enqueue_notification('finance.reserve_sale', '{}'::jsonb, 'sale:2', 'nope')")/$(q "select count(*) from notification_outbox where dedupe_key='sale:2'")" "/0"

echo "the cron tick"
# Supabase always has Vault; here it starts empty.
q "create schema if not exists vault; create table vault.decrypted_secrets (name text, decrypted_secret text);" >/dev/null
check "no destination in Vault: nothing is posted" "$(q "select public.api_reserves_cron_tick()")" "not_configured"
"${PSQL[@]}" >/dev/null <<SQL
insert into vault.decrypted_secrets values ('grovbase.newsletter.worker_url', 'https://grovbase.example/api/newsletter/worker'), ('grovbase.newsletter.worker_token', 'secret-token');
create schema if not exists net;
create table net.calls (url text, headers jsonb, body jsonb);
create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds integer) returns bigint language sql as
  \$f\$ insert into net.calls values (url, headers, body); select 7::bigint \$f\$;
SQL
check "configured: one post to the newsletter origin's /api/cron/reserves" "$(q "select public.api_reserves_cron_tick()")" "posted:7"
check "…with the bearer token from Vault" "$(q "select url || ' ' || (headers->>'Authorization') from net.calls")" "https://grovbase.example/api/cron/reserves Bearer secret-token"
q "update api_reserve_settings set enabled = false" >/dev/null
check "switched off: the tick does nothing" "$(q "select public.api_reserves_cron_tick()")" "disabled"
check "nobody but the scheduler may call the tick" "$(as_user $UA "select public.api_reserves_cron_tick()" | grep -c 'permission denied')" "1"

echo
if [ "$fails" -eq 0 ]; then echo "All API reserve SQL tests passed."; else echo "$fails FAILED"; exit 1; fi
