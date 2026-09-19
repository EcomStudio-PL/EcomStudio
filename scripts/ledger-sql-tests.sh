#!/usr/bin/env bash
# THE CREDIT LEDGER SUITE, RUN IN BOTH DIRECTIONS.
#
# A security test that passes against the unpatched code proves nothing. This
# runner therefore refuses to report success unless the suite FAILS first:
#
#   1. build the harness (PROD function bodies, defect included)
#   2. run the suite            -> must report failures
#   3. apply the remediation migration
#   4. run the suite again      -> must report none
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

MIGRATIONS=(
  supabase/migrations/0099_refund_requires_charge.sql
  supabase/migrations/0100_usage_ledger_server_writes.sql
)

if ! psql -q -t -c 'select 1' >/dev/null 2>&1; then
  echo "ledger-sql: no Postgres at ${PGHOST}:${PGPORT}. Start one first." >&2
  exit 2
fi

run_suite() {
  psql -q -f scripts/sql/credit-ledger-tests.sql 2>&1 | sed 's/^psql:[^ ]*: //'
}
failures() {
  psql -q -t -A -c 'select count(*) from public.t_failures'
}

echo "── 1/2  BEFORE the fix (the suite must fail here) ─────────────────────"
psql -q -f scripts/sql/credit-ledger-harness.sql >/dev/null 2>&1
run_suite
before=$(failures)
if [ "$before" -eq 0 ]; then
  echo "ledger-sql: FAILED — the suite passed against the UNPATCHED ledger." >&2
  echo "            These tests no longer reproduce anything. Fix the tests." >&2
  exit 1
fi

echo
echo "── 2/3  AFTER the fix ─────────────────────────────────────────────────"
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
echo "── 3/3  ten parallel starts, credits for one ──────────────────────────"
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

echo
echo "ledger-sql: OK — $before failure(s) before the fix, 0 after; 1/10 under contention."
