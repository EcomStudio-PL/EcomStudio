#!/usr/bin/env bash
#
# ONE PAYMENT, ONE GRANT — PROVEN AGAINST A REAL POSTGRES.
#
# Stripe retries webhooks, and Stripe also warns that one occurrence can
# produce TWO different Event objects. Either of those, mishandled, mints
# credits nobody paid for. This is the money path, so it is not asserted by
# reading the migration — it is executed.
#
# The harness replays the REAL definitions production carries:
#   · apply_credit_transaction()  verbatim from PROD (row lock, balance floor)
#   · server_call_ok()            verbatim from PROD (sha256 of the token)
#   · credit_wallets CHECK (balance >= 0), the constraint that makes a refund
#     clawback impossible and therefore a business decision
# so a test passing here means the function behaves against the constraints
# that actually exist, not against a convenient replica.
#
# It runs on the local harness, never Supabase: DEV carries none of this schema
# and PROD is not a place to rehearse a billing migration.
#
#   bash scripts/pg-harness-up.sh && npm run test:stripe:sql
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
PSQL=(psql -h "$PGSOCK" -p "$PGPORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -X -q -t -A)

if ! "${PSQL[@]}" -c 'select 1' >/dev/null 2>&1; then
  echo "stripe-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Overridable so the guard can be mutation-tested: point it at a deliberately
# broken 0113 and the run must go red.
MIGRATION="${MIGRATION:-$ROOT/supabase/migrations/0113_stripe_mapping_and_idempotency.sql}"
[ -f "$MIGRATION" ] || { echo "stripe-sql: $MIGRATION not found" >&2; exit 2; }
MIGRATION2="${MIGRATION2:-$ROOT/supabase/migrations/0114_stripe_customer_reverse_lookup.sql}"
[ -f "$MIGRATION2" ] || { echo "stripe-sql: $MIGRATION2 not found" >&2; exit 2; }
MIGRATION3="${MIGRATION3:-$ROOT/supabase/migrations/0115_stripe_catalogue_for_the_webhook.sql}"
[ -f "$MIGRATION3" ] || { echo "stripe-sql: $MIGRATION3 not found" >&2; exit 2; }

fails=0
check() { # name, actual, expected
  if [ "$2" = "$3" ]; then echo "  ✓ $1"
  else echo "  ✗ $1 — got [$2], expected [$3]"; fails=$((fails+1)); fi
}

TOKEN='the-right-dispatch-token'

"${PSQL[@]}" >/dev/null <<'SQL'
drop schema if exists public cascade; create schema public;
drop schema if exists auth cascade;   create schema auth;
create extension if not exists pgcrypto with schema public;

do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public to anon, authenticated;

create table public.workspaces (id uuid primary key default gen_random_uuid());
create table public.app_settings (key text primary key, value jsonb not null default '{}'::jsonb);

create type credit_tx_type as enum
  ('subscription','topup','generation','refund','bonus','admin_adjustment',
   'purchase','promotion','admin_grant','manual_adjustment');

create table public.credit_wallets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.credit_wallets(id) on delete cascade,
  amount integer not null,
  type credit_tx_type not null,
  description text,
  reference_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  balance_before integer,
  balance_after integer,
  usage_event_id uuid
);
create table public.credit_packages (
  id uuid primary key default gen_random_uuid(),
  name text not null, credits integer not null, bonus_credits integer not null default 0,
  price_cents integer not null, currency text not null default 'PLN',
  active boolean not null default true, featured boolean not null default false,
  sort_order integer not null default 0, badge text, description text,
  created_at timestamptz not null default now()
);
create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  slug text not null, name text not null, monthly_credits integer not null default 0,
  price_cents integer not null default 0, currency text not null default 'PLN',
  active boolean not null default true, features jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0, created_at timestamptz not null default now(),
  description text, annual_price_cents integer not null default 0,
  featured boolean not null default false, bonus_credits integer not null default 0,
  limits jsonb not null default '{}'::jsonb
);

-- THE POLICY THAT CAUSED THE BUG, REPRODUCED EXACTLY.
--
-- Production guards both catalogue tables with `active = true OR is_admin()`,
-- and `is_admin()` is SECURITY DEFINER and NOT executable by anon. Because it
-- takes no arguments the planner hoists it into an InitPlan and evaluates it
-- once per query, so anon does not see "no rows" — the query RAISES
-- `permission denied for function is_admin`.
--
-- The webhook holds the anon key. Without this reproduced here, a test could
-- pass against a convenient replica while the real thing granted zero credits
-- to a customer who had already paid.
create or replace function public.is_admin() returns boolean
language sql security definer stable set search_path = public as $$ select false $$;
revoke execute on function public.is_admin() from public, anon;
grant  execute on function public.is_admin() to authenticated;

alter table public.credit_packages   enable row level security;
alter table public.subscription_plans enable row level security;
create policy pkg_select_active on public.credit_packages
  for select using (active = true or public.is_admin());
create policy plans_select on public.subscription_plans
  for select using (active = true or public.is_admin());
grant select on public.credit_packages, public.subscription_plans to anon, authenticated;
-- LIVE SHAPE: workspace_id nullable, ON DELETE SET NULL (post hard-delete tombstones).
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete set null,
  amount_cents integer not null, currency text not null default 'PLN',
  status text not null default 'pending', provider text, provider_payment_id text,
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
  archived_workspace_id uuid, archived_account_email text, archived_at timestamptz
);
create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan_id uuid not null references public.subscription_plans(id),
  status text not null default 'active',
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz,
  provider text, provider_subscription_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- VERBATIM FROM PROD.
create function public.server_call_ok(p_token text) returns boolean
language plpgsql stable security definer set search_path to 'public','extensions' as $function$
declare v_hash text;
begin
  select value->>'dispatch_hash' into v_hash from public.app_settings where key='notifications';
  if v_hash is null or v_hash = '' then return false; end if;
  return encode(digest(coalesce(p_token,''),'sha256'),'hex') = v_hash;
end $function$;

create function public.apply_credit_transaction(
  p_wallet_id uuid, p_amount integer, p_type credit_tx_type,
  p_description text default null, p_reference_id uuid default null,
  p_metadata jsonb default '{}'::jsonb, p_created_by uuid default null)
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare v_balance int; v_tx_id uuid;
begin
  select balance into v_balance from public.credit_wallets where id = p_wallet_id for update;
  if not found then raise exception 'wallet_not_found'; end if;
  if v_balance + p_amount < 0 then raise exception 'insufficient_credits'; end if;
  update public.credit_wallets set balance = v_balance + p_amount, updated_at = now() where id = p_wallet_id;
  insert into public.credit_transactions
    (wallet_id, amount, type, description, reference_id, metadata, created_by, balance_before, balance_after)
  values (p_wallet_id, p_amount, p_type, p_description, p_reference_id, p_metadata, p_created_by, v_balance, v_balance + p_amount)
  returning id into v_tx_id;
  return v_tx_id;
end; $function$;
revoke execute on function public.apply_credit_transaction(uuid,integer,credit_tx_type,text,uuid,jsonb,uuid) from public, anon, authenticated;
revoke execute on function public.server_call_ok(text) from public, anon, authenticated;

insert into public.app_settings (key, value)
values ('notifications', jsonb_build_object('dispatch_hash', encode(digest('the-right-dispatch-token','sha256'),'hex')));

insert into public.workspaces (id) values
  ('11111111-1111-1111-1111-111111111111'),
  ('22222222-2222-2222-2222-222222222222');
insert into public.credit_wallets (workspace_id, balance) values
  ('11111111-1111-1111-1111-111111111111', 100);
-- workspace 2 deliberately has NO wallet.
insert into public.credit_packages (name, credits, price_cents) values ('Standard', 500, 7900);
insert into public.subscription_plans (slug, name, monthly_credits, price_cents) values ('pro','Pro',1200,29900);
SQL

"${PSQL[@]}" -f "$MIGRATION"  >/dev/null
"${PSQL[@]}" -f "$MIGRATION2" >/dev/null
"${PSQL[@]}" -f "$MIGRATION3" >/dev/null

W1='11111111-1111-1111-1111-111111111111'
W2='22222222-2222-2222-2222-222222222222'
PKG=$("${PSQL[@]}" -c "select id from public.credit_packages limit 1")
PLAN=$("${PSQL[@]}" -c "select id from public.subscription_plans limit 1")

settle() { # event_id, payment_id, credits, token
  "${PSQL[@]}" -c "select public.stripe_settle_payment(
    '${4:-$TOKEN}','$1','checkout.session.completed','$W1','$2',7900,'PLN','credit_pack',
    $3,'topup'::credit_tx_type,'Pakiet Standard','$PKG',null,'cus_test','{}'::jsonb)->>'status'"
}
balance() { "${PSQL[@]}" -c "select balance from public.credit_wallets where workspace_id='$W1'"; }
txcount() { "${PSQL[@]}" -c "select count(*) from public.credit_transactions"; }
paycount() { "${PSQL[@]}" -c "select count(*) from public.payments"; }

echo
echo "A. THE TOKEN IS THE GATE"
check "a wrong token is refused" \
  "$("${PSQL[@]}" -c "select public.stripe_settle_payment('wrong','evt_x','t','$W1','pi_x',100,'PLN','credit_pack',10,'topup'::credit_tx_type,null,null,null,null,'{}'::jsonb)" 2>&1 | grep -c forbidden || true)" "1"
check "and it moved no balance" "$(balance)" "100"
check "anon cannot call apply_credit_transaction directly" \
  "$("${PSQL[@]}" -c "select has_function_privilege('anon','public.apply_credit_transaction(uuid,integer,credit_tx_type,text,uuid,jsonb,uuid)','execute')")" "f"
check "authenticated cannot either" \
  "$("${PSQL[@]}" -c "select has_function_privilege('authenticated','public.apply_credit_transaction(uuid,integer,credit_tx_type,text,uuid,jsonb,uuid)','execute')")" "f"
check "the settle function IS callable by anon (token is the gate)" \
  "$("${PSQL[@]}" -c "select has_function_privilege('anon','public.stripe_settle_payment(text,text,text,uuid,text,integer,text,text,integer,credit_tx_type,text,uuid,uuid,text,jsonb)','execute')")" "t"

echo
echo "B. TEST 8 — ONE PAYMENT, CREDITS GRANTED EXACTLY ONCE"
check "first delivery applies" "$(settle evt_1 pi_1 500)" "applied"
check "balance moved 100 → 600" "$(balance)" "600"
check "one ledger row" "$(txcount)" "1"
check "one payment row" "$(paycount)" "1"

echo
echo "C. TEST 7 — WEBHOOK RETRY ×3 CHANGES NOTHING"
check "retry 2 is a duplicate event" "$(settle evt_1 pi_1 500)" "duplicate_event"
check "retry 3 is a duplicate event" "$(settle evt_1 pi_1 500)" "duplicate_event"
check "balance is STILL 600" "$(balance)" "600"
check "still one ledger row" "$(txcount)" "1"

echo
echo "D. LAYER 2 — TWO DIFFERENT EVENTS, ONE PAYMENT"
# Stripe's own warning: one occurrence can produce two Event objects. The event
# key cannot catch that; the payment key must.
check "a NEW event for the SAME payment is refused" "$(settle evt_2 pi_1 500)" "already_settled"
check "balance is still 600" "$(balance)" "600"
check "still one ledger row" "$(txcount)" "1"
check "still one payment row" "$(paycount)" "1"

echo
echo "E. A GENUINELY NEW PAYMENT STILL WORKS"
check "different payment, different event applies" "$(settle evt_3 pi_2 250)" "applied"
check "balance 600 → 850" "$(balance)" "850"
check "two ledger rows" "$(txcount)" "2"
check "the ledger row points at its payment" \
  "$("${PSQL[@]}" -c "select count(*) from public.payments p join public.credit_transactions t on t.id=p.credit_tx_id where t.reference_id=p.id")" "2"

echo
echo "F. A WORKSPACE WITH NO WALLET IS RECORDED, NOT RETRIED FOREVER"
check "settles without credits" \
  "$("${PSQL[@]}" -c "select public.stripe_settle_payment('$TOKEN','evt_nw','checkout.session.completed','$W2','pi_nw',7900,'PLN','credit_pack',500,'topup'::credit_tx_type,null,'$PKG',null,null,'{}'::jsonb)->>'status'")" "settled_without_credits"
check "the payment was still recorded" \
  "$("${PSQL[@]}" -c "select count(*) from public.payments where provider_payment_id='pi_nw'")" "1"
check "and granted nothing" "$(txcount)" "2"

echo
echo "G. SUBSCRIPTIONS — LIFECYCLE IS STATE, NEVER CREDITS"
sync() { # event_id, status
  "${PSQL[@]}" -c "select public.stripe_sync_subscription('$TOKEN','$1','customer.subscription.updated','$W1','sub_1','$PLAN','$2',now(),now()+interval '30 days',false,'price_x','cus_test','{}'::jsonb)->>'status'"
}
check "created" "$(sync evt_s1 active)" "applied"
check "an update upserts the same row" "$(sync evt_s2 past_due)" "applied"
check "still exactly one subscription" \
  "$("${PSQL[@]}" -c "select count(*) from public.subscriptions")" "1"
check "status followed Stripe" \
  "$("${PSQL[@]}" -c "select status from public.subscriptions where provider_subscription_id='sub_1'")" "past_due"
check "repeating the SAME event is a duplicate" "$(sync evt_s2 canceled)" "duplicate_event"
check "and the status did not move" \
  "$("${PSQL[@]}" -c "select status from public.subscriptions where provider_subscription_id='sub_1'")" "past_due"
check "NO credits were granted by any subscription event" "$(txcount)" "2"

echo
echo "H. REFUND — RECORDED AND FLAGGED, NEVER CLAWED BACK"
check "a refund naming a real payment is recorded" \
  "$("${PSQL[@]}" -c "select public.stripe_record_refund('$TOKEN','evt_r1','charge.refunded','pi_1',7900,'refunded','{}'::jsonb)->>'status'")" "recorded"
check "the balance is untouched" "$(balance)" "850"
check "it is flagged for a human" \
  "$("${PSQL[@]}" -c "select metadata->'refund'->>'needs_review' from public.payments where provider_payment_id='pi_1'")" "true"
check "and says plainly that nothing was clawed back" \
  "$("${PSQL[@]}" -c "select metadata->'refund'->>'credits_clawed_back' from public.payments where provider_payment_id='pi_1'")" "false"
check "a refund for a payment we never recorded is refused" \
  "$("${PSQL[@]}" -c "select public.stripe_record_refund('$TOKEN','evt_r2','charge.refunded','pi_ghost',500,'refunded','{}'::jsonb)->>'status'")" "unknown_payment"
check "the ledger never moved for any refund" "$(txcount)" "2"

echo
echo "I. TEST 18 — A CLIENT CANNOT REACH THE MONEY TABLES"
for t in stripe_customers payment_events; do
  check "$t has RLS on" \
    "$("${PSQL[@]}" -c "select relrowsecurity from pg_class where relname='$t'")" "t"
  check "$t has no policy at all" \
    "$("${PSQL[@]}" -c "select count(*) from pg_policies where tablename='$t'")" "0"
  check "anon holds no table grant on $t" \
    "$("${PSQL[@]}" -c "select has_table_privilege('anon','public.$t','select')")" "f"
  check "authenticated holds no table grant on $t" \
    "$("${PSQL[@]}" -c "select has_table_privilege('authenticated','public.$t','insert')")" "f"
done

echo
echo "J. THE MAPPING IS A FUNCTION, NOT A GUESS"
check "two packages cannot share one Stripe price" \
  "$("${PSQL[@]}" -c "update public.credit_packages set stripe_price_id='price_dup';
      insert into public.credit_packages (name,credits,price_cents,stripe_price_id)
      values ('Second',10,100,'price_dup')" 2>&1 | grep -c 'duplicate key\|unique' || true)" "1"
check "a workspace keeps ONE Stripe customer" \
  "$("${PSQL[@]}" -c "select public.stripe_link_customer('$TOKEN','$W1','cus_first',false)")" "cus_first"
check "a second link returns the FIRST, never a new one" \
  "$("${PSQL[@]}" -c "select public.stripe_link_customer('$TOKEN','$W1','cus_second',false)")" "cus_first"
check "and reads back the same" \
  "$("${PSQL[@]}" -c "select public.stripe_customer_for('$TOKEN','$W1')")" "cus_first"

echo
echo "K. THE BALANCE FLOOR STILL STANDS"
check "credit_wallets still refuses to go negative" \
  "$("${PSQL[@]}" -c "select count(*) from pg_constraint where conrelid='public.credit_wallets'::regclass and pg_get_constraintdef(oid) like '%balance >= 0%'")" "1"
check "payments cannot hold an invented status" \
  "$("${PSQL[@]}" -c "update public.payments set status='totally_paid_trust_me' where provider_payment_id='pi_2'" 2>&1 | grep -c 'violates check' || true)" "1"

echo
echo "L. 0114 — THE REVERSE LOOKUP AND THE RECORD-ONLY DOOR"
# A subscription created in the Stripe DASHBOARD carries no GrovBase metadata.
# Its only link back to a workspace is the Customer id, so this lookup is what
# stands between a paid renewal and credits that never arrive.
check "a linked customer resolves to its workspace" \
  "$("${PSQL[@]}" -c "select public.stripe_workspace_for('$TOKEN','cus_first')")" "$W1"
check "an unknown customer resolves to nothing, rather than guessing" \
  "$("${PSQL[@]}" -c "select coalesce(public.stripe_workspace_for('$TOKEN','cus_nobody')::text,'null')")" "null"
check "an empty customer id is answered, not queried" \
  "$("${PSQL[@]}" -c "select coalesce(public.stripe_workspace_for('$TOKEN','')::text,'null')")" "null"
check "the wrong token cannot read the mapping" \
  "$("${PSQL[@]}" -c "select public.stripe_workspace_for('not-the-token','cus_first')" 2>&1 | grep -c 'forbidden' || true)" "1"

# THE RECORD-ONLY FUNCTION. A failed payment must leave a trace and must NEVER
# be able to touch a payments row — the first draft reused the refund function,
# which writes payments.status, so a stray failure could have flipped a settled
# payment to 'failed'.
SETTLED_STATUS=$("${PSQL[@]}" -c "select status from public.payments where provider_payment_id='pi_1'")
check "a failure is recorded" \
  "$("${PSQL[@]}" -c "select public.stripe_record_event('$TOKEN','evt_f1','payment_intent.payment_failed','pi_1','$W1','failed','{}'::jsonb)->>'status'")" "recorded"
check "...and the settled payment it names is UNCHANGED" \
  "$("${PSQL[@]}" -c "select status from public.payments where provider_payment_id='pi_1'")" "$SETTLED_STATUS"
check "...and the balance did not move" "$(balance)" "850"
check "the same failure event twice is a duplicate, not a second row" \
  "$("${PSQL[@]}" -c "select public.stripe_record_event('$TOKEN','evt_f1','payment_intent.payment_failed','pi_1','$W1','failed','{}'::jsonb)->>'status'")" "duplicate_event"
check "exactly one event row exists for it" \
  "$("${PSQL[@]}" -c "select count(*) from public.payment_events where stripe_event_id='evt_f1'")" "1"
check "an event id already used by a SETTLEMENT cannot be re-recorded" \
  "$("${PSQL[@]}" -c "select public.stripe_record_event('$TOKEN','evt_1','payment_intent.payment_failed','pi_1','$W1','failed','{}'::jsonb)->>'status'")" "duplicate_event"
check "the wrong token records nothing" \
  "$("${PSQL[@]}" -c "select public.stripe_record_event('not-the-token','evt_f9','x','pi_1','$W1','failed','{}'::jsonb)" 2>&1 | grep -c 'forbidden' || true)" "1"
check "...and left no row behind" \
  "$("${PSQL[@]}" -c "select count(*) from public.payment_events where stripe_event_id='evt_f9'")" "0"

echo
echo "M. THE NEW FUNCTIONS ARE GATED THE SAME WAY AS THE OLD ONES"
for f in stripe_workspace_for stripe_record_event; do
  check "$f is SECURITY DEFINER" \
    "$("${PSQL[@]}" -c "select prosecdef from pg_proc where proname='$f'")" "t"
  check "$f pins its search_path" \
    "$("${PSQL[@]}" -c "select count(*) from pg_proc where proname='$f' and 'search_path=public, extensions' = any(proconfig)")" "1"
done

echo
echo "N. 0115 — THE WEBHOOK CAN READ WHAT IT IS CREDITING"
# FIRST, THE FAILURE ITSELF. If this stops reproducing, the test below stops
# testing anything, so it is asserted rather than assumed.
check "as anon, a direct read of credit_packages RAISES (this is the bug)" \
  "$("${PSQL[@]}" -c "begin; set local role anon; select count(*) from public.credit_packages; rollback" 2>&1 | grep -c 'permission denied for function is_admin' || true)" "1"
check "as anon, a direct read of subscription_plans raises too" \
  "$("${PSQL[@]}" -c "begin; set local role anon; select count(*) from public.subscription_plans; rollback" 2>&1 | grep -c 'permission denied for function is_admin' || true)" "1"
check "and it raises even for a row that IS active" \
  "$("${PSQL[@]}" -c "begin; set local role anon; select name from public.credit_packages where id='$PKG'; rollback" 2>&1 | grep -c 'permission denied' || true)" "1"

# NOW THE FIX. The same read, through the token-gated function, as anon.
check "through stripe_catalogue, anon CAN read the package" \
  "$("${PSQL[@]}" -c "begin; set local role anon; select public.stripe_catalogue('$TOKEN','$PKG',null,null)->'package'->>'name'; rollback")" "Standard"
check "with the credits the ledger will grant" \
  "$("${PSQL[@]}" -c "begin; set local role anon; select (public.stripe_catalogue('$TOKEN','$PKG',null,null)->'package'->>'credits'); rollback")" "500"
check "and the plan, by id" \
  "$("${PSQL[@]}" -c "begin; set local role anon; select public.stripe_catalogue('$TOKEN',null,'$PLAN',null)->'plan'->>'slug'; rollback")" "pro"

# RESOLUTION BY PRICE, which is how a renewal finds its plan.
"${PSQL[@]}" >/dev/null -c "update public.subscription_plans set stripe_price_id_monthly='price_pro_live' where id='$PLAN';
                            update public.credit_packages set stripe_price_id='price_pack_live' where id='$PKG'"
check "a plan resolves from the Stripe price that was billed" \
  "$("${PSQL[@]}" -c "select public.stripe_catalogue('$TOKEN',null,null,'price_pro_live')->'plan'->>'slug'")" "pro"
check "a package resolves from its price too" \
  "$("${PSQL[@]}" -c "select public.stripe_catalogue('$TOKEN',null,null,'price_pack_live')->'package'->>'name'")" "Standard"
check "an unknown price resolves to nothing, rather than guessing" \
  "$("${PSQL[@]}" -c "select coalesce((public.stripe_catalogue('$TOKEN',null,null,'price_nobody')->'plan')::text,'null')")" "null"

# A WITHDRAWN PACKAGE STILL CREDITS. The customer's money is already gone.
"${PSQL[@]}" >/dev/null -c "update public.credit_packages set active=false where id='$PKG'"
check "a package deactivated mid-purchase is still readable" \
  "$("${PSQL[@]}" -c "begin; set local role anon; select public.stripe_catalogue('$TOKEN','$PKG',null,null)->'package'->>'name'; rollback")" "Standard"
check "...and reports that it is no longer on sale" \
  "$("${PSQL[@]}" -c "select public.stripe_catalogue('$TOKEN','$PKG',null,null)->'package'->>'active'")" "false"
"${PSQL[@]}" >/dev/null -c "update public.credit_packages set active=true where id='$PKG'"

check "the wrong token reads nothing" \
  "$("${PSQL[@]}" -c "select public.stripe_catalogue('not-the-token','$PKG',null,null)" 2>&1 | grep -c 'forbidden' || true)" "1"
check "stripe_catalogue is SECURITY DEFINER" \
  "$("${PSQL[@]}" -c "select prosecdef from pg_proc where proname='stripe_catalogue'")" "t"
check "stripe_catalogue pins its search_path" \
  "$("${PSQL[@]}" -c "select count(*) from pg_proc where proname='stripe_catalogue' and 'search_path=public, extensions' = any(proconfig)")" "1"

echo
if [ "$fails" = "0" ]; then echo "All Stripe SQL tests passed."; else echo "$fails FAILED"; fi
exit $([ "$fails" = "0" ] && echo 0 || echo 1)
