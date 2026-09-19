#!/usr/bin/env bash
# THE CREDIT LEDGER SUITE, RUN IN BOTH DIRECTIONS.
#
# A security test that passes against the unpatched code proves nothing. This
# runner therefore refuses to report success unless the suite FAILS first:
#
#   1. build the harness (PROD function bodies, defect included)
#   2. run the suite            -> must report failures
#   3. apply the remediation migrations
#   4. run the suite again      -> must report none
#   5. race ten real backends for one credit -> exactly one wins
#
# Step 2 failing is the evidence that step 4 passing means something. If a
# later change makes step 2 pass, the tests stopped testing — fix the TEST.
#
# Needs a throwaway local Postgres; PROD and DEV are not places to run attacks.
# Point it anywhere with the standard PG* variables:
#
#   PGHOST=/tmp/pgtest PGPORT=5433 npm run test:ledger:sql
set -euo pipefail

cd "$(dirname "$0")/.."

export PGHOST="${PGHOST:-/tmp/pgtest}"
export PGPORT="${PGPORT:-5433}"
export PGUSER="${PGUSER:-postgres}"
export PGDATABASE="${PGDATABASE:-postgres}"

# In release order. 0100 only adds a function and is safe to apply before the
# application deploy; 0101 removes the policy the old build writes through and
# must come after it. Applied here back to back because the harness has no
# deploy in between.
MIGRATIONS=(
  supabase/migrations/0099_refund_requires_charge.sql
  supabase/migrations/0100_usage_ledger_server_writes.sql
  supabase/migrations/0101_idempotency_key_is_released.sql
  supabase/migrations/0102_reconcile_stale_usage_events.sql
)

if ! psql -q -t -c 'select 1' >/dev/null 2>&1; then
  echo "ledger-sql: no Postgres at ${PGHOST}:${PGPORT}. Bringing one up." >&2
  bash "$(dirname "$0")/pg-harness-up.sh" >&2
fi
if ! psql -q -t -c 'select 1' >/dev/null 2>&1; then
  echo "ledger-sql: still no Postgres at ${PGHOST}:${PGPORT}." >&2
  exit 2
fi

run_suite() {
  psql -q -f scripts/sql/credit-ledger-tests.sql 2>&1 | sed 's/^psql:[^ ]*: //'
}
failures() {
  psql -q -t -A -c 'select count(*) from public.t_failures'
}

echo "── 1/4  BEFORE the fix (the suite must fail here) ─────────────────────"
psql -q -f scripts/sql/credit-ledger-harness.sql >/dev/null 2>&1
run_suite
before=$(failures)
if [ "$before" -eq 0 ]; then
  echo "ledger-sql: FAILED — the suite passed against the UNPATCHED ledger." >&2
  echo "            These tests no longer reproduce anything. Fix the tests." >&2
  exit 1
fi

echo
echo "── 2/4  AFTER the fix ─────────────────────────────────────────────────"
for m in "${MIGRATIONS[@]}"; do
  psql -q -v ON_ERROR_STOP=1 -f "$m" >/dev/null
done
run_suite
after=$(failures)
if [ "$after" -ne 0 ]; then
  echo "ledger-sql: FAILED — $after check(s) still failing after the migrations." >&2
  exit 1
fi

# ── Concurrency, run for real ──────────────────────────────────────────────
# Ten simultaneous starts against a balance that covers ONE. Argument settles
# nothing here: the answer depends on whether apply_credit_transaction's
# `for update` actually serialises, so ten separate backends race for it.
echo
echo "── 3/4  ten parallel starts, credits for one ──────────────────────────"
psql -q -c "update public.credit_wallets set balance = 5
              from public.t_fixture f where credit_wallets.id = f.wallet_id" >/dev/null
seq 1 10 | xargs -P 10 -I{} psql -q -t -A \
  -c "select set_config('app.current_user', (select user_id from public.t_fixture)::text, false)" \
  -c "select status from public.usage_event_start(
     'test-server-token',
     (select user_id from public.t_fixture),
     (select workspace_id from public.t_fixture),
     (select wallet_id from public.t_fixture),
     'test-tool', 5, null, null, null, 'race:{}', '{}'::jsonb)" \
  > /tmp/ledger-race.$$ 2>&1 || true

ok_count=$(grep -c '^ok$' /tmp/ledger-race.$$ || true)
balance=$(psql -q -t -A -c "select balance from public.credit_wallets w
                            join public.t_fixture f on f.wallet_id = w.id")
charged=$(psql -q -t -A -c "select count(*) from public.usage_events
                            where idempotency_key like 'race:%'")
rm -f /tmp/ledger-race.$$

echo "  successes: $ok_count   events written: $charged   balance: $balance"
if [ "$ok_count" -ne 1 ] || [ "$balance" != "0" ] || [ "$charged" != "1" ]; then
  echo "ledger-sql: FAILED — expected exactly 1 success, 1 event and a 0 balance." >&2
  exit 1
fi
echo "  ok   exactly one of ten parallel starts was charged"

# ── The reconciler, raced ──────────────────────────────────────────────────
# Sweeping the same row twice in one session proves idempotence. It does NOT
# prove that two runners cannot both refund it — that depends on FOR UPDATE
# SKIP LOCKED holding under real contention, which only real backends can
# settle. Twenty stranded charges, four reconcilers, one answer.
echo
echo "── 4/4  four reconcilers over twenty stranded charges ─────────────────"
psql -q -v ON_ERROR_STOP=1 <<'SQL' >/dev/null
do $$
declare f record; i int; v_ev uuid;
begin
  select * into f from public.t_fixture;
  perform set_config('app.current_user', f.user_id::text, false);
  delete from public.usage_events where idempotency_key like 'reap:%';
  drop table if exists public.t_reap;
  create table public.t_reap (id uuid primary key);
  update public.credit_wallets set balance = 100 where id = f.wallet_id;
  for i in 1..20 loop
    select event_id into v_ev from public.usage_event_start(
      'test-server-token', f.user_id, f.workspace_id, f.wallet_id, 'test-tool',
      5, null, null, null, 'reap:' || i, '{}'::jsonb);
    update public.usage_events set started_at = now() - interval '2 hours' where id = v_ev;
    insert into public.t_reap (id) values (v_ev);
  end loop;
end $$;
SQL

before_bal=$(psql -q -t -A -c "select balance from public.credit_wallets w
                               join public.t_fixture f on f.wallet_id = w.id")
seq 1 4 | xargs -P 4 -I{} psql -q -t -A   -c "select count(*) from public.usage_events_reconcile_stale(50, 1800)" >/dev/null 2>&1 || true

after_bal=$(psql -q -t -A -c "select balance from public.credit_wallets w
                              join public.t_fixture f on f.wallet_id = w.id")
refunds=$(psql -q -t -A -c "select count(*) from public.credit_transactions t
                            join public.t_reap r on r.id = t.reference_id
                            where t.type = 'refund'")
doubles=$(psql -q -t -A -c "select count(*) from (
                              select reference_id from public.credit_transactions
                               where type = 'refund' group by reference_id having count(*) > 1) d")
still_pending=$(psql -q -t -A -c "select count(*) from public.usage_events
                                  where status = 'pending' and started_at < now() - interval '30 minutes'")

echo "  balance: $before_bal -> $after_bal   refunds: $refunds   double-refunded rows: $doubles   left pending: $still_pending"
if [ "$refunds" -ne 20 ] || [ "$doubles" -ne 0 ] || [ "$still_pending" -ne 0 ] || [ "$after_bal" != "100" ]; then
  echo "ledger-sql: FAILED — expected 20 single refunds, none doubled, none left behind, balance back to 100." >&2
  exit 1
fi
echo "  ok   every stranded charge came back exactly once, under contention"

echo
echo "ledger-sql: OK — $before failure(s) before the fix, 0 after; 1/10 under contention; 20/20 reconciled."
