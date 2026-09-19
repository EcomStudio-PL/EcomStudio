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

MIGRATION=supabase/migrations/0099_refund_requires_charge.sql

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
echo "── 2/2  AFTER the fix ─────────────────────────────────────────────────"
psql -q -v ON_ERROR_STOP=1 -f "$MIGRATION" >/dev/null
run_suite
after=$(failures)
if [ "$after" -ne 0 ]; then
  echo "ledger-sql: FAILED — $after check(s) still failing after $MIGRATION." >&2
  exit 1
fi

echo
echo "ledger-sql: OK — $before failure(s) before the fix, 0 after."
