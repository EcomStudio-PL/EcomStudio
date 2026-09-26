#!/usr/bin/env bash
#
# GROVNEWS STAGE 3 — PAID ACCESS, LAUNCH BONUS AND DISCOUNT CODES, PROVEN ON A
# REAL POSTGRES.
#
# Migration 0123 is loaded VERBATIM, next to the functions it depends on cut out
# of the migrations that ship them (server_call_ok 0077, account_blocked 0072,
# is_admin 0002, grovnews_has_access 0122). Tables carry the columns and
# constraints those functions touch. So a pass here is the SQL itself behaving
# — the idempotency keys, the extend-only grant, the one-claim constraint, the
# code bound to its owner — not a TypeScript retelling of it.
#
# Local harness only (DEV does not carry this schema; PROD gets a rolled-back
# dry run instead):
#
#   bash scripts/pg-harness-up.sh && npm run test:grovnews3:sql
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
DB=grovnews3
PSQL0=(psql -h "$PGSOCK" -p "$PGPORT" -U postgres -v ON_ERROR_STOP=1 -X -q -t -A)
PSQL=("${PSQL0[@]}" -d "$DB")

if ! "${PSQL0[@]}" -d postgres -c 'select 1' >/dev/null 2>&1; then
  echo "grovnews3-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
M=$ROOT/supabase/migrations
MIGRATION="${MIGRATION:-$M/0123_grovnews_monetization.sql}"
for f in "$MIGRATION" "$M/0002_functions_and_triggers.sql" "$M/0072_temporary_account_block.sql" \
         "$M/0077_server_only_rpcs.sql" "$M/0122_grovnews_send_time_access.sql"; do
  [ -f "$f" ] || { echo "grovnews3-sql: $f not found" >&2; exit 2; }
done

extract() { # file, function name, end marker regex
  awk -v start="^create (or replace )?function public[.]$2[(]" -v stop="$3" \
    '$0 ~ start {on=1} on {print} on && $0 ~ stop {exit}' "$1"
}
SERVER_CALL_OK=$(extract "$M/0077_server_only_rpcs.sql" server_call_ok '^end [$][$];')
ACCOUNT_BLOCKED=$(extract "$M/0072_temporary_account_block.sql" account_blocked '^[$][$];')
IS_ADMIN=$(extract "$M/0002_functions_and_triggers.sql" is_admin '^[$][$];')
TOUCH=$(extract "$M/0002_functions_and_triggers.sql" touch_updated_at '^[$][$];')
HAS_ACCESS=$(extract "$M/0122_grovnews_send_time_access.sql" grovnews_has_access '^[$][$];')
for v in SERVER_CALL_OK ACCOUNT_BLOCKED IS_ADMIN TOUCH HAS_ACCESS; do
  [ -n "${!v}" ] || { echo "grovnews3-sql: could not extract $v" >&2; exit 2; }
done

"${PSQL0[@]}" -d postgres -c "drop database if exists $DB" >/dev/null
"${PSQL0[@]}" -d postgres -c "create database $DB" >/dev/null

fails=0
check() { # name, actual, expected
  if [ "$2" = "$3" ]; then echo "  ✓ $1"
  else echo "  ✗ $1 — got [$2], expected [$3]"; fails=$((fails+1)); fi
}
q() { "${PSQL[@]}" -c "$1"; }
# As a signed-in customer (RLS and grants apply), or as a client that fails.
as_user() { "${PSQL[@]}" -c "set role authenticated; set request.jwt.claim.sub = '$1'; $2"; }
err() { "${PSQL[@]}" -c "$1" 2>&1 | grep -o "$2" | head -1 || true; }
err_as() { "${PSQL[@]}" -c "set role $1; set request.jwt.claim.sub = '${3:-}'; $2" 2>&1 \
  | grep -oE 'permission denied|forbidden|violates row-level security' | head -1 || true; }
TOKEN='the-right-dispatch-token'
T="'$TOKEN'"

"${PSQL[@]}" >/dev/null <<SQL
set check_function_bodies = off;
create schema auth; create schema t; create schema extensions;
create extension if not exists pgcrypto with schema extensions;
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end \$\$;
grant usage on schema public, auth, extensions to anon, authenticated;
-- Supabase's default: new tables in public are granted to the client roles, so
-- the migration's own REVOKEs are what is being tested.
alter default privileges in schema public grant all on tables to anon, authenticated;

create function auth.uid() returns uuid language sql stable as
  \$f\$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid \$f\$;
create table auth.users (
  id uuid primary key default gen_random_uuid(), email text, email_confirmed_at timestamptz,
  created_at timestamptz not null default now());

create table public.app_settings (key text primary key, value jsonb not null default '{}'::jsonb);
insert into public.app_settings values
  ('notifications', jsonb_build_object('dispatch_hash', encode(extensions.digest('$TOKEN', 'sha256'), 'hex')));

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade, role text not null default 'user',
  blocked boolean not null default false, blocked_until timestamptz);
create table public.workspaces (id uuid primary key default gen_random_uuid());
create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(), name text not null, sort_order integer not null default 0,
  active boolean not null default true, price_cents integer not null default 0,
  stripe_product_id text, stripe_price_id_monthly text);
create table public.welcome_bonus_offers (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  claimed_at timestamptz);
create table public.grovnews_entitlements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'EXPIRED', 'REVOKED')),
  source text not null default 'ADMIN_GRANT' check (source in ('ADMIN_GRANT', 'LAUNCH_BONUS', 'PAID', 'PROMO')),
  starts_at timestamptz not null default now(), expires_at timestamptz, internal_note text,
  constraint grovnews_entitlements_window_ok check (expires_at is null or expires_at > starts_at),
  constraint grovnews_entitlements_one_per_source unique (user_id, source));
create table public.payment_events (
  stripe_event_id text primary key, event_type text not null, object_id text,
  workspace_id uuid references public.workspaces (id) on delete set null,
  outcome text not null, detail jsonb not null default '{}'::jsonb, received_at timestamptz not null default now());
-- the credit ledger exists so the tests can prove GrovNews never touches it
create table public.credit_wallets (id uuid primary key default gen_random_uuid(), workspace_id uuid, balance integer not null default 0);
create table public.credit_transactions (id uuid primary key default gen_random_uuid(), wallet_id uuid, amount integer);

$SERVER_CALL_OK
$ACCOUNT_BLOCKED
$IS_ADMIN
$TOUCH

-- helpers
create function t.usr(p_email text, p_created interval default '0 seconds', p_survey boolean default true)
returns uuid language plpgsql as \$f\$
declare v uuid; begin
  insert into auth.users (email, email_confirmed_at, created_at) values (p_email, now(), now() + p_created) returning id into v;
  insert into public.profiles (id) values (v);
  if p_survey then insert into public.welcome_bonus_offers (user_id, claimed_at) values (v, now()); end if;
  return v; end \$f\$;
create function t.admin() returns uuid language plpgsql as \$f\$
declare v uuid; begin v := t.usr('admin-' || gen_random_uuid() || '@x.pl'); update public.profiles set role = 'admin' where id = v; return v; end \$f\$;
create function t.plan(p_name text, p_cents integer) returns uuid language sql as \$f\$
  insert into public.subscription_plans (name, price_cents, stripe_product_id, stripe_price_id_monthly)
  values (p_name, p_cents, 'prod_' || p_name, 'price_' || p_name) returning id \$f\$;
SQL

"${PSQL[@]}" -f "$MIGRATION" >/dev/null
# 0122's reader question, verbatim, on top of 0123's resolver.
"${PSQL[@]}" >/dev/null <<SQL
$HAS_ACCESS
revoke all on function public.grovnews_has_access() from public, anon;
grant execute on function public.grovnews_has_access() to authenticated;
SQL

WS=$(q "insert into public.workspaces default values returning id")
PRO=$(q "select t.plan('Pro', 9900)")
STARTER=$(q "select t.plan('Starter', 4900)")
CHEAP=$(q "select t.plan('Tiny', 300)")
ADMIN=$(q "select t.admin()")

echo
echo "G. GROVNEWS PAID SUBSCRIPTION"
check "G1 sales start OFF with no price — nothing is offered" \
  "$(q "select public.grovnews_offer()->>'available'")" "false"
check "G1b sales cannot be switched on without a confirmed Price" \
  "$(as_user "$ADMIN" "select public.grovnews_billing_set_sales(true)->>'status'")" "no_price"
check "G2 a price is applied only with the dispatch token" \
  "$(err "select public.grovnews_billing_apply_price('wrong', null, 'prod_gn', 'price_a', 2900, 'pln', null)" forbidden)" "forbidden"
check "G2b the first Price is applied (compare-and-swap on 'no previous')" \
  "$(q "select public.grovnews_billing_apply_price($T, null, 'prod_gn', 'price_a', 2900, 'pln', '$ADMIN')->>'status'")" "applied"
check "G2c a second change built on a stale previous Price loses (conflict, nothing written)" \
  "$(q "select public.grovnews_billing_apply_price($T, null, 'prod_gn', 'price_x', 3900, 'pln', '$ADMIN')->>'status'")|$(q "select stripe_price_id from public.grovnews_billing")" "conflict|price_a"
check "G2d the same Price applied twice (a retry) is 'applied', never a conflict" \
  "$(q "select public.grovnews_billing_apply_price($T, null, 'prod_gn', 'price_a', 2900, 'pln', '$ADMIN')->>'status'")" "applied"
check "G3 a price change: new Price active, old one kept in history and archived, ONE Product" \
  "$(q "select public.grovnews_billing_apply_price($T, 'price_a', 'prod_gn', 'price_b', 3900, 'pln', '$ADMIN')->>'previous_price_id'")|$(q "select stripe_price_id || ':' || price_cents || ':' || stripe_product_id from public.grovnews_billing")|$(q "select string_agg(stripe_price_id || '=' || (archived_at is not null)::text, ',' order by stripe_price_id) from public.grovnews_prices")" \
  "price_a|price_b:3900:prod_gn|price_a=true,price_b=false"
check "G3b the price is an integer in grosze, bounded (199 refused)" \
  "$(err "select public.grovnews_billing_apply_price($T, 'price_b', 'prod_gn', 'price_c', 199, 'pln', null)" invalid_amount)" "invalid_amount"
check "G4 sales ON by an admin; still not offered to anyone while OFF before" \
  "$(as_user "$ADMIN" "select public.grovnews_billing_set_sales(true)->>'status'")|$(q "select public.grovnews_offer()->>'available'")|$(q "select public.grovnews_offer()->>'price_cents'")" "applied|true|3900"
C1=$(q "select t.usr('c1@x.pl')")
check "G4b a customer cannot switch sales" "$(err_as authenticated "select public.grovnews_billing_set_sales(false)" "$C1")" "forbidden"
check "G4c a price whose Stripe amount drifted is not offered (parity)" \
  "$(q "update public.grovnews_billing set stripe_price_cents = 3800; select public.grovnews_offer()->>'available'; update public.grovnews_billing set stripe_price_cents = 3900")" "false"

A1=$(q "select gen_random_uuid()"); A2=$(q "select gen_random_uuid()")
check "G5 checkout: the first attempt takes the lock, a parallel one is told 'in progress'" \
  "$(q "select public.grovnews_checkout_begin($T, '$C1', '$A1')->>'status'")|$(q "select public.grovnews_checkout_begin($T, '$C1', '$A2')->>'status'")" "locked|in_progress"
q "select public.grovnews_checkout_attach($T, '$C1', '$A1', 'sub_gn1')" >/dev/null
check "G5b the parallel attempt is handed the SAME subscription to resume" \
  "$(q "select public.grovnews_checkout_begin($T, '$C1', '$A2')->>'stripe_subscription_id'")" "sub_gn1"
check "G5c ten parallel begins → exactly one lock holder" \
  "$(q "delete from public.grovnews_checkout_locks; select count(*) filter (where s = 'locked') from (select public.grovnews_checkout_begin($T, '$C1', gen_random_uuid())->>'status' s from generate_series(1, 10)) x")" "1"

inv() { # event, invoice, sub, user, period_end_interval
  q "select public.grovnews_invoice_paid($T, '$1', 'invoice.paid', '$2', '$3', ${4:-null}, '$WS', 'cus_1', 'price_b', 3900, 'pln', now(), now() + interval '${5:-30 days}')->>'status'"
}
check "G6 invoice.paid activates paid access" \
  "$(inv evt_i1 in_1 sub_gn1 "'$C1'")|$(q "select public.grovnews_user_has_access('$C1')")|$(as_user "$C1" "select public.grovnews_has_access()")" "applied|t|t"
check "G7 the same event 3× and 10× = one invoice, one extension" \
  "$(for i in 1 2 3; do inv evt_i1 in_1 sub_gn1 "'$C1'"; done | sort -u)|$(for i in $(seq 1 10); do inv evt_i1 in_1 sub_gn1 "'$C1'"; done | sort -u)|$(q "select count(*) from public.grovnews_invoices")" \
  "duplicate_event|duplicate_event|1"
check "G7b a DIFFERENT event describing the same invoice is already_settled" "$(inv evt_i1b in_1 sub_gn1 "'$C1'")" "already_settled"
check "G8 GrovNews never touches the credit ledger" \
  "$(q "select count(*) from public.credit_wallets")|$(q "select count(*) from public.credit_transactions")" "0|0"
check "G8b a second purchase is refused while one is live (already_active)" \
  "$(q "select public.grovnews_checkout_begin($T, '$C1', gen_random_uuid())->>'status'")" "already_active"
check "G8c the paid invoice released the checkout lock" "$(q "select count(*) from public.grovnews_checkout_locks where user_id = '$C1'")" "0"

sub() { # event, sub, status, created_offset, cancel_flag, deleted, ended
  q "select public.grovnews_sync_subscription($T, '$1', 'customer.subscription.updated', now() + interval '$4',
     '$2', null, '$WS', 'cus_1', 'price_b', 3900, 'pln', '$3', now(), now() + interval '30 days', $5, null, ${7:-null}, $6)->>'status'" >/dev/null
}
sub evt_s1 sub_gn1 active '1 minute' true false
check "G9 cancel at period end keeps access to the end of the paid period" \
  "$(q "select cancel_at_period_end::text || '/' || status from public.grovnews_subscriptions where stripe_subscription_id = 'sub_gn1'")|$(q "select public.grovnews_user_has_access('$C1')")" "true/active|t"
sub evt_s0 sub_gn1 past_due '-1 minute' false false
check "G10 an OLDER event arriving late does not overwrite a newer one" \
  "$(q "select status || '/' || cancel_at_period_end from public.grovnews_subscriptions where stripe_subscription_id = 'sub_gn1'")|$(q "select outcome from public.payment_events where stripe_event_id = 'evt_s0'")" "active/true|stale"
sub evt_s2 sub_gn1 past_due '2 minutes' false false
q "update public.grovnews_subscriptions set paid_through = now() - interval '1 second' where stripe_subscription_id = 'sub_gn1'" >/dev/null
check "G11 renewal not paid (past_due): no extension — access ends with the paid period" \
  "$(q "select public.grovnews_user_has_access('$C1')")" "f"
check "G11b recovery: the renewal invoice is paid → access back, status active" \
  "$(inv evt_i2 in_2 sub_gn1 "'$C1'" '60 days')|$(q "select public.grovnews_user_has_access('$C1')")|$(q "select status from public.grovnews_subscriptions where stripe_subscription_id = 'sub_gn1'")" "applied|t|active"
q "select public.grovnews_sync_subscription($T, 'evt_del', 'customer.subscription.deleted', now() + interval '5 minutes', 'sub_gn1', null, '$WS', 'cus_1', 'price_b', 3900, 'pln', 'canceled', now(), now() + interval '30 days', false, now(), now(), true)" >/dev/null
check "G12 subscription deleted → access cut at the end moment; canceled is terminal" \
  "$(q "select public.grovnews_user_has_access('$C1')")|$(sub evt_s3 sub_gn1 active '10 minutes' false false; q "select status from public.grovnews_subscriptions where stripe_subscription_id = 'sub_gn1'")" "f|canceled"
check "G12b a late invoice for the ended subscription cannot reach past its end" \
  "$(inv evt_i3 in_3 sub_gn1 "'$C1'" '90 days')|$(q "select public.grovnews_user_has_access('$C1')")" "applied|f"
check "G13 an invoice whose user cannot be resolved is recorded, never guessed" \
  "$(inv evt_i4 in_4 sub_unknown null)|$(q "select outcome from public.payment_events where stripe_event_id = 'evt_i4'")|$(q "select count(*) from public.grovnews_subscriptions where stripe_subscription_id = 'sub_unknown'")" "unresolved_workspace|unresolved_user|0"
check "G13b the webhook recognises GrovNews objects by stable ids (old AND new Price, known subscription)" \
  "$(q "select public.grovnews_is_billing_object($T, null, 'price_a')")$(q "select public.grovnews_is_billing_object($T, null, 'price_b')")$(q "select public.grovnews_is_billing_object($T, 'sub_gn1', null)")$(q "select public.grovnews_is_billing_object($T, 'sub_plan', 'price_Pro')")" "tttf"
check "G14 PAID can never be written as an entitlement row (not even by the owner role)" \
  "$(err "insert into public.grovnews_entitlements (user_id, source) values ('$C1', 'PAID')" grovnews_entitlements_not_paid)" "grovnews_entitlements_not_paid"
check "G14b sales OFF blocks new offers; the existing subscription row is untouched" \
  "$(as_user "$ADMIN" "select public.grovnews_billing_set_sales(false)->>'status'")|$(q "select public.grovnews_offer()->>'available'")|$(q "select count(*) from public.grovnews_subscriptions")" "applied|false|1"

echo
echo "L. LAUNCH CAMPAIGN"
cfg() { # access_mode extra
  echo "{\"name\":\"Premiera\",\"window_start\":\"$(q "select (now() - interval '1 day')::text")\",\"window_end\":\"$(q "select (now() + interval '1 day')::text")\",\"access_mode\":\"$1\"$2}"
}
CFG_DAYS=$(cfg DAYS ",\"access_days\":30,\"discount_enabled\":true,\"discount_type\":\"PERCENT\",\"discount_value\":20,\"discount_duration\":\"REPEATING\",\"discount_months\":3,\"eligible_plan_ids\":[\"$PRO\",\"$STARTER\"],\"code_valid_days\":30")
check "L1 a customer cannot create a campaign" "$(err_as authenticated "select public.grovnews_launch_save(null, '{}'::jsonb)" "$C1")" "forbidden"
check "L1b an invalid config is refused (window end before start)" \
  "$(as_user "$ADMIN" "select public.grovnews_launch_save(null, '{\"name\":\"x\",\"window_start\":\"2030-01-02\",\"window_end\":\"2030-01-01\",\"access_mode\":\"FOREVER\"}'::jsonb)->>'status'")" "invalid"
CAMP=$(as_user "$ADMIN" "select public.grovnews_launch_save(null, '$CFG_DAYS'::jsonb)->>'id'")
check "L2 a DRAFT is saved; activation needs the coupon when there is a discount" \
  "$(q "select status from public.grovnews_launch_campaigns where id = '$CAMP'")|$(q "select public.grovnews_launch_activate($T, '$CAMP', null, '$ADMIN', (select updated_at from public.grovnews_launch_campaigns where id = '$CAMP'))->>'status'")" "DRAFT|no_coupon"
check "L2b a plan whose discounted first charge would be under 2 zł blocks activation" \
  "$(C=$(as_user "$ADMIN" "select public.grovnews_launch_save(null, '$(cfg FOREVER ",\"discount_enabled\":true,\"discount_type\":\"AMOUNT\",\"discount_value\":200,\"discount_duration\":\"ONCE\",\"eligible_plan_ids\":[\"$CHEAP\"],\"code_valid_days\":30")'::jsonb)->>'id'"); q "select public.grovnews_launch_activate($T, '$C', 'coupon_x', '$ADMIN', (select updated_at from public.grovnews_launch_campaigns where id = '$C'))->>'status'")" "plan_ineligible"
check "L2c activation built on a stale read of the draft is refused (a save happened in between)" \
  "$(q "select public.grovnews_launch_activate($T, '$CAMP', 'coupon_launch', '$ADMIN', now() - interval '1 day')->>'status'")" "changed"
check "L3 activation with the coupon; only ONE campaign may be ACTIVE" \
  "$(q "select public.grovnews_launch_activate($T, '$CAMP', 'coupon_launch', '$ADMIN', (select updated_at from public.grovnews_launch_campaigns where id = '$CAMP'))->>'status'")|$(q "select status from public.grovnews_launch_campaigns where id = '$CAMP'")|$(err "insert into public.grovnews_launch_campaigns (name, status, window_start, window_end, access_mode) values ('b', 'ACTIVE', now(), now() + interval '1 day', 'FOREVER')" grovnews_launch_one_active)" \
  "applied|ACTIVE|grovnews_launch_one_active"
check "L3b an ACTIVE campaign cannot be edited" \
  "$(as_user "$ADMIN" "select public.grovnews_launch_save('$CAMP', '$CFG_DAYS'::jsonb)->>'status'")" "not_draft"

IN=$(q "select t.usr('in@x.pl', '-1 hour')")
EARLY=$(q "select t.usr('early@x.pl', '-2 days')")
NOSURVEY=$(q "select t.usr('nosurvey@x.pl', '-1 hour', false)")
EDGE=$(q "select t.usr('edge@x.pl')")
q "update auth.users set created_at = (select window_start from public.grovnews_launch_campaigns where id = '$CAMP') where id = '$EDGE'" >/dev/null
check "L4 registered in the window + survey done → granted (access + code)" \
  "$(as_user "$IN" "select public.grovnews_launch_ensure()->>'status'")|$(q "select public.grovnews_user_has_access('$IN')")|$(q "select count(*) from public.grovnews_launch_codes where user_id = '$IN'")" "granted|t|1"
check "L4b the window is inclusive at its start" "$(as_user "$EDGE" "select public.grovnews_launch_ensure()->>'status'")" "granted"
check "L5 registered before the window → nothing" "$(as_user "$EARLY" "select public.grovnews_launch_ensure()->>'status'")|$(q "select public.grovnews_user_has_access('$EARLY')")" "not_eligible|f"
check "L6 survey not completed → nothing (and a later survey then qualifies)" \
  "$(as_user "$NOSURVEY" "select public.grovnews_launch_ensure()->>'status'")|$(q "insert into public.welcome_bonus_offers (user_id, claimed_at) values ('$NOSURVEY', now())"; as_user "$NOSURVEY" "select public.grovnews_launch_ensure()->>'status'")" "not_eligible|granted"
check "L7 one claim per user: a repeat (or 10 repeats) grants nothing more" \
  "$(for i in $(seq 1 10); do as_user "$IN" "select public.grovnews_launch_ensure()->>'status'"; done | sort -u)|$(q "select count(*) from public.grovnews_launch_claims where user_id = '$IN'")|$(q "select count(*) from public.grovnews_launch_codes where user_id = '$IN'")" "claimed|1|1"
check "L7b the one-claim rule is a constraint, not only a check" \
  "$(err "insert into public.grovnews_launch_claims (campaign_id, user_id) values ('$CAMP', '$IN')" grovnews_launch_one_claim)" "grovnews_launch_one_claim"
check "L8 access source is LAUNCH_BONUS, 30 days from the claim" \
  "$(q "select source || ':' || (expires_at between now() + interval '29 days' and now() + interval '31 days') from public.grovnews_entitlements where user_id = '$IN'")" "LAUNCH_BONUS:true"
LONG=$(q "select t.usr('long@x.pl', '-1 hour')")
q "insert into public.grovnews_entitlements (user_id, source, expires_at) values ('$LONG', 'LAUNCH_BONUS', now() + interval '400 days')" >/dev/null
check "L9 extend-only: a longer existing launch access is not shortened by a 30-day grant" \
  "$(as_user "$LONG" "select public.grovnews_launch_ensure()->>'status'")|$(q "select expires_at > now() + interval '399 days' from public.grovnews_entitlements where user_id = '$LONG' and source = 'LAUNCH_BONUS'")" "granted|t"
REV=$(q "select t.usr('rev@x.pl', '-1 hour')")
q "insert into public.grovnews_entitlements (user_id, source, status) values ('$REV', 'LAUNCH_BONUS', 'REVOKED')" >/dev/null
check "L9b an admin's REVOKE is not undone by the campaign" \
  "$(as_user "$REV" "select public.grovnews_launch_ensure()->>'status'")|$(q "select status from public.grovnews_entitlements where user_id = '$REV'")|$(q "select public.grovnews_user_has_access('$REV')")" "granted|REVOKED|f"
BLK=$(q "select t.usr('blk@x.pl', '-1 hour')")
q "update public.profiles set blocked = true where id = '$BLK'" >/dev/null
check "L9c a blocked account gets nothing" "$(as_user "$BLK" "select public.grovnews_launch_ensure()->>'status'")" "not_eligible"
ADM_ALSO=$(q "select t.usr('both@x.pl', '-1 hour')")
q "insert into public.grovnews_entitlements (user_id, source, expires_at) values ('$ADM_ALSO', 'ADMIN_GRANT', now() + interval '90 days')" >/dev/null
as_user "$ADM_ALSO" "select public.grovnews_launch_ensure()" >/dev/null
q "update public.grovnews_entitlements set starts_at = now() - interval '40 days', expires_at = now() - interval '1 second' where user_id = '$ADM_ALSO' and source = 'LAUNCH_BONUS'" >/dev/null
check "L10 launch access running out falls back to the ADMIN grant" "$(q "select public.grovnews_user_has_access('$ADM_ALSO')")" "t"
q "select public.grovnews_invoice_paid($T, 'evt_in', 'invoice.paid', 'in_in', 'sub_in', '$IN', '$WS', 'cus_1', 'price_b', 3900, 'pln', now(), now() + interval '30 days')" >/dev/null
q "update public.grovnews_entitlements set starts_at = now() - interval '40 days', expires_at = now() - interval '1 second' where user_id = '$IN'" >/dev/null
check "L10b ... and to PAID; paid + launch together never conflict" "$(q "select public.grovnews_user_has_access('$IN')")" "t"
check "L11 an ENDED campaign grants nothing new; existing grants stay" \
  "$(as_user "$ADMIN" "select public.grovnews_launch_set_status('$CAMP', 'ENDED')->>'status'")|$(L=$(q "select t.usr('late@x.pl', '-1 hour')"); as_user "$L" "select public.grovnews_launch_ensure()->>'status'")|$(q "select count(*) from public.grovnews_launch_claims")" \
  "applied|no_campaign|$(q "select count(*) from public.grovnews_launch_claims")"
check "L11b the grant of an earlier claim is still there after the end" "$(q "select public.grovnews_user_has_access('$NOSURVEY')")" "t"
check "L11c a customer reads only their own state; no campaign/claim/code rows directly" \
  "$(as_user "$IN" "select (public.grovnews_my_state()->'launch'->>'access_granted')")|$(as_user "$IN" "select count(*) from public.grovnews_launch_claims")|$(err_as authenticated "select code from public.grovnews_launch_codes" "$IN")" \
  "true|0|permission denied"

echo
echo "D. DISCOUNT CODES"
CODE=$(as_user "$IN" "select public.grovnews_my_state()->'launch'->>'code'")
res() { q "select public.grovnews_launch_code_resolve($T, '$1', '$2', '$3', '${4:-monthly}')->>'${5:-reason}'"; }
check "D1 the code has the GROV-XXXX-XXXX shape from an unambiguous alphabet" \
  "$(echo "$CODE" | grep -cE '^GROV-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$')" "1"
check "D2 codes are unique and not derived from the user (two users, two unrelated codes)" \
  "$(q "select count(distinct code) = count(*) and count(*) >= 3 from public.grovnews_launch_codes")" "t"
check "D3 the owner's code resolves for an eligible MONTHLY plan, with the server's coupon" \
  "$(res "$IN" "$CODE" "$PRO" monthly ok)|$(res "$IN" "$CODE" "$PRO" monthly coupon_id)|$(res "$IN" "$CODE" "$PRO" monthly first_charge_cents)" "true|coupon_launch|7920"
check "D4 lower-case and padded input is the same code" "$(res "$IN" "  ${CODE,,} " "$PRO" monthly ok)" "true"
check "D5 ANOTHER user's code answers exactly like a code that does not exist" \
  "$(res "$EDGE" "$CODE" "$PRO")|$(res "$IN" "GROV-AAAA-AAAA" "$PRO")" "code_invalid|code_invalid"
check "D6 an ineligible plan is refused" "$(res "$IN" "$CODE" "$CHEAP")" "code_plan"
check "D7 an annual period is refused (monthly only)" "$(res "$IN" "$CODE" "$PRO" annual)" "code_monthly_only"
check "D8 resolving a code is server-only (token), a customer cannot probe it" \
  "$(err_as authenticated "select public.grovnews_launch_code_resolve('wrong', '$IN', '$CODE', '$PRO', 'monthly')" "$IN")" "forbidden"
CODE_ID=$(res "$IN" "$CODE" "$PRO" monthly code_id)
check "D9 an abandoned checkout leaves the code usable (nothing is redeemed until paid)" "$(res "$IN" "$CODE" "$PRO" monthly ok)" "true"
check "D10 redeemed once on the paid invoice; retries 1×/3×/10× change nothing" \
  "$(q "select public.grovnews_launch_code_redeem($T, '$CODE_ID', 'sub_plan1')->>'status'")|$(for i in $(seq 1 10); do q "select public.grovnews_launch_code_redeem($T, '$CODE_ID', 'sub_plan1')->>'status'"; done | sort -u)|$(q "select public.grovnews_launch_code_redeem($T, '$CODE_ID', 'sub_plan2')->>'status'")" \
  "redeemed|already_redeemed|redeemed_elsewhere"
check "D11 a used code cannot be used again" "$(res "$IN" "$CODE" "$PRO")" "code_used"
CODE2=$(as_user "$EDGE" "select public.grovnews_my_state()->'launch'->>'code'")
q "update public.grovnews_launch_codes set expires_at = now() - interval '1 second' where code = '$CODE2'" >/dev/null
check "D12 an expired code is refused and no longer shown to its owner" \
  "$(res "$EDGE" "$CODE2" "$PRO")|$(as_user "$EDGE" "select coalesce(public.grovnews_my_state()->'launch'->>'code', 'hidden')")" "code_expired|hidden"
CODE3=$(as_user "$NOSURVEY" "select public.grovnews_my_state()->'launch'->>'code'")
check "D13 an ENDED campaign's code still works to its expiry; DISABLED stops it" \
  "$(res "$NOSURVEY" "$CODE3" "$STARTER" monthly ok)|$(as_user "$ADMIN" "select public.grovnews_launch_set_status('$CAMP', 'DISABLED')->>'status'")|$(res "$NOSURVEY" "$CODE3" "$STARTER")" \
  "true|applied|code_expired"

echo
echo "DOORS. WHO MAY CALL WHAT"
for f in "grovnews_user_has_access(uuid)" "grovnews_launch_eligible(uuid, uuid)" "grovnews_new_code()"; do
  for role in anon authenticated; do
    check "$role cannot call $f" "$(q "select has_function_privilege('$role', 'public.$f', 'execute')")" "f"
  done
done
check "anon cannot read a customer's state or claim a bonus" \
  "$(q "select has_function_privilege('anon', 'public.grovnews_my_state()', 'execute')")$(q "select has_function_privilege('anon', 'public.grovnews_launch_ensure()', 'execute')")" "ff"
for tb in grovnews_billing grovnews_subscriptions grovnews_invoices grovnews_launch_campaigns grovnews_launch_claims grovnews_prices; do
  check "a customer reads 0 rows of $tb; cannot write it" \
    "$(as_user "$IN" "select count(*) from public.$tb")|$(err_as authenticated "delete from public.$tb" "$IN")" "0|permission denied"
done
check "a customer cannot touch the checkout locks at all" "$(err_as authenticated "select * from public.grovnews_checkout_locks" "$IN")" "permission denied"
check "every token door refuses a wrong token" \
  "$(err "select public.grovnews_invoice_paid('x', 'e', 't', 'i', 's', null, null, null, null, 1, 'pln', now(), now())" forbidden)$(err "select public.grovnews_sync_subscription('x', 'e', 't', now(), 's', null, null, null, null, 1, 'pln', 'active', now(), now(), false, null, null, false)" forbidden)$(err "select public.grovnews_checkout_begin('x', '$IN', gen_random_uuid())" forbidden)$(err "select public.grovnews_launch_code_redeem('x', gen_random_uuid(), 's')" forbidden)$(err "select public.grovnews_launch_activate('x', gen_random_uuid(), 'c', null, now())" forbidden)" \
  "forbiddenforbiddenforbiddenforbiddenforbidden"
check "the admin sees code STATUS but not the code itself" \
  "$(as_user "$ADMIN" "select count(*) > 0 from public.grovnews_launch_codes where redeemed_at is not null")|$(err_as authenticated "select code from public.grovnews_launch_codes" "$ADMIN")" "t|permission denied"

echo
if [ "$fails" -eq 0 ]; then echo "grovnews3-sql: all checks passed"; else echo "grovnews3-sql: $fails FAILED"; exit 1; fi
