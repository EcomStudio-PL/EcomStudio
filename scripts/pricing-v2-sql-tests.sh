#!/usr/bin/env bash
#
# CENNIK V2 (0173 + 0174), PROVEN AGAINST A REAL POSTGRES.
#
# The rehearsal database is PROD's money schema as it stands before 0174
# (scripts/sql/pricing-v2-base.sql: every credit an integer), the ledger and
# GrovShot functions loaded VERBATIM from the migrations PROD ran (extracted,
# not retyped), PROD's three wallets with their exact balances and a charge
# made before the pools exist (pricing-v2-seed.sql). Then 0173 and 0174 are
# applied the way the Supabase connector applies them — each file one
# transaction — and scripts/sql/pricing-v2-tests.sql checks what they promise.
# 0174 is then applied a SECOND time: it must be a no-op that changes nothing.
#
#   bash scripts/pg-harness-up.sh && npm run test:pricing:sql
set -euo pipefail
cd "$(dirname "$0")/.."

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
DB=pricing_v2_rehearsal
PG=(psql -h "$PGSOCK" -p "$PGPORT" -U postgres -X -q -v ON_ERROR_STOP=1)

if ! psql -h "$PGSOCK" -p "$PGPORT" -U postgres -d postgres -X -q -t -c 'select 1' >/dev/null 2>&1; then
  bash scripts/pg-harness-up.sh >&2
fi
dropdb -h "$PGSOCK" -p "$PGPORT" -U postgres --if-exists "$DB"
createdb -h "$PGSOCK" -p "$PGPORT" -U postgres -E UTF8 -T template0 "$DB"

"${PG[@]}" -d "$DB" -f scripts/sql/pricing-v2-base.sql >/dev/null

# PROD's own bodies, from the migration that last defined each one.
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
load $M/0163_grovshot_v2_worker.sql grovshot_srv_scope
load $M/0163_grovshot_v2_worker.sql grovshot_srv_job_update
load $M/0163_grovshot_v2_worker.sql grovshot_srv_usage_start
load $M/0167_grovshot_shot_customer.sql grovshot_run_create
load $M/0072_temporary_account_block.sql admin_customer_rows

"${PG[@]}" -d "$DB" -f scripts/sql/pricing-v2-seed.sql >/dev/null

echo "── applying 0173, 0174 (one transaction each) ─────────────────────────"
"${PG[@]}" -d "$DB" -1 -f $M/0173_credit_tx_expiration.sql >/dev/null
"${PG[@]}" -d "$DB" -1 -f $M/0174_pricing_v2_ledger.sql >/dev/null
if [ -f $M/0176_finance_analytics.sql ]; then
  FIN=1
fi
if [ -f $M/0175_pricing_v2_catalogue.sql ]; then
  echo "── applying 0175 ───────────────────────────────────────────────────────"
  "${PG[@]}" -d "$DB" -1 -f $M/0175_pricing_v2_catalogue.sql >/dev/null
fi

if [ "${FIN:-0}" = 1 ]; then
  echo "── applying 0176 ───────────────────────────────────────────────────────"
  "${PG[@]}" -d "$DB" -1 -f $M/0176_finance_analytics.sql >/dev/null
fi
"${PG[@]}" -d "$DB" -f scripts/sql/pricing-v2-tests.sql >/dev/null

echo "── applying 0174 again: must change nothing ───────────────────────────"
before=$("${PG[@]}" -d "$DB" -t -A -c "select md5(string_agg(id || ':' || remaining, ',' order by id)) || '/' || (select md5(string_agg(id || ':' || balance, ',' order by id)) from public.credit_wallets) from public.credit_lots")
"${PG[@]}" -d "$DB" -1 -f $M/0174_pricing_v2_ledger.sql >/dev/null
after=$("${PG[@]}" -d "$DB" -t -A -c "select md5(string_agg(id || ':' || remaining, ',' order by id)) || '/' || (select md5(string_agg(id || ':' || balance, ',' order by id)) from public.credit_wallets) from public.credit_lots")
"${PG[@]}" -d "$DB" -c "select public.t_ok('R1 re-applying 0174 changes no lot and no balance', '$before' = '$after')" >/dev/null

"${PG[@]}" -d "$DB" -t -A -F ' | ' -c "select case when ok then '  ✓' else '  ✗' end, name, case when ok then '' else detail end from public.t_results order by n"
fails=$("${PG[@]}" -d "$DB" -t -A -c "select count(*) from public.t_results where not ok")
total=$("${PG[@]}" -d "$DB" -t -A -c "select count(*) from public.t_results")
if [ "$fails" != "0" ]; then echo "$fails of $total PRICING SQL TEST(S) FAILED"; exit 1; fi
echo "All $total pricing SQL tests passed."
