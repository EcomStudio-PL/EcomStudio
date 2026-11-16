#!/usr/bin/env bash
#
# SMART SUBSCRIPTION MANAGEMENT (0181), PROVEN AGAINST A REAL POSTGRES.
#
# The money schema exactly as the Cennik V2 rehearsal builds it (PROD's shape
# before 0174, the ledger and GrovShot bodies extracted verbatim, PROD's
# wallets), then 0173 → 0174 → 0175 → 0176 as PROD ran them, then 0181 TWICE
# (a re-run must change nothing). scripts/sql/plan-change-tests.sql checks
# every financial promise: the reserved pool, release, settlement, annual
# tranches, a late payment, permissions, the ledger invariant.
#
#   bash scripts/pg-harness-up.sh && npm run test:planchange:sql
set -euo pipefail
cd "$(dirname "$0")/.."

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
DB=plan_change_rehearsal
PG=(psql -h "$PGSOCK" -p "$PGPORT" -U postgres -X -q -v ON_ERROR_STOP=1)

if ! psql -h "$PGSOCK" -p "$PGPORT" -U postgres -d postgres -X -q -t -c 'select 1' >/dev/null 2>&1; then
  bash scripts/pg-harness-up.sh >&2
fi
dropdb -h "$PGSOCK" -p "$PGPORT" -U postgres --if-exists "$DB"
createdb -h "$PGSOCK" -p "$PGPORT" -U postgres -E UTF8 -T template0 "$DB"
cleanup() { [ "${KEEP_DB:-0}" = "1" ] || dropdb -h "$PGSOCK" -p "$PGPORT" -U postgres --if-exists "$DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT

"${PG[@]}" -d "$DB" -f scripts/sql/pricing-v2-base.sql >/dev/null
load() { # file function
  { echo "set check_function_bodies = off; set search_path = public, extensions;"
    python3 -I scripts/sql/extract-function.py "$1" "$2"; } | "${PG[@]}" -d "$DB" >/dev/null
}
M=supabase/migrations
load $M/0100_usage_ledger_server_writes.sql usage_event_start
load $M/0077_server_only_rpcs.sql usage_event_charge
load $M/0099_refund_requires_charge.sql usage_event_refund_partial
load $M/0101_idempotency_key_is_released.sql usage_event_fail
load $M/0102_reconcile_stale_usage_events.sql usage_events_reconcile_stale
load $M/0113_stripe_mapping_and_idempotency.sql stripe_record_refund
load $M/0113_stripe_mapping_and_idempotency.sql stripe_settle_payment
load $M/0113_stripe_mapping_and_idempotency.sql stripe_sync_subscription
load $M/0163_grovshot_v2_worker.sql grovshot_srv_scope
load $M/0163_grovshot_v2_worker.sql grovshot_srv_job_update
load $M/0163_grovshot_v2_worker.sql grovshot_srv_usage_start
load $M/0167_grovshot_shot_customer.sql grovshot_run_create
load $M/0072_temporary_account_block.sql admin_customer_rows
"${PG[@]}" -d "$DB" -f scripts/sql/pricing-v2-seed.sql >/dev/null

for f in 0173_credit_tx_expiration 0174_pricing_v2_ledger 0175_pricing_v2_catalogue 0176_finance_analytics; do
  "${PG[@]}" -d "$DB" -1 -f "$M/$f.sql" >/dev/null
done
echo "── applying 0181 (twice: a re-run must be a no-op) ─────────────────────"
"${PG[@]}" -d "$DB" -1 -f $M/0181_plan_changes.sql >/dev/null
"${PG[@]}" -d "$DB" -1 -f $M/0181_plan_changes.sql >/dev/null

"${PG[@]}" -d "$DB" -f scripts/sql/plan-change-tests.sql >/dev/null

"${PG[@]}" -d "$DB" -t -A -F ' | ' -c "select case when ok then '  ✓' else '  ✗' end, name, case when ok then '' else detail end from public.t_results order by n"
fails=$("${PG[@]}" -d "$DB" -t -A -c "select count(*) from public.t_results where not ok")
total=$("${PG[@]}" -d "$DB" -t -A -c "select count(*) from public.t_results")
if [ "$fails" != "0" ]; then echo "$fails of $total PLAN CHANGE SQL TEST(S) FAILED"; exit 1; fi
echo "All $total plan change SQL tests passed."
