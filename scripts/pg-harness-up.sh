#!/usr/bin/env bash
# A THROWAWAY POSTGRES FOR THE MONEY-PATH HARNESS.
#
# scripts/ledger-sql-tests.sh attacks the credit ledger by rebuilding it from
# production's own function bodies and trying to break it. That needs a real
# Postgres, and it must not be Supabase: DEV does not have these tables and
# PROD is not a place to run attacks. So this brings up a local one that can be
# thrown away and rebuilt at any time — it holds no data anyone would miss.
#
# Idempotent: run it as often as you like. If a server is already answering on
# the socket it does nothing.
#
#   bash scripts/pg-harness-up.sh && npm run test:ledger:sql
#
# In a container the data directory usually lives in /tmp and does not survive
# a restart, which is why this exists as a script instead of a paragraph in a
# README that someone has to follow by hand.
set -euo pipefail

PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
PGDATA="${PGDATA:-/tmp/pgdata}"
PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"

if [ ! -x "$PGBIN/pg_ctl" ]; then
  echo "pg-harness: no Postgres at $PGBIN. Set PGBIN." >&2
  exit 2
fi

if psql -h "$PGSOCK" -p "$PGPORT" -U postgres -d postgres -t -c 'select 1' >/dev/null 2>&1; then
  echo "pg-harness: already up on $PGSOCK:$PGPORT"
  exit 0
fi

# Postgres refuses to run as root, so the whole harness runs as the `postgres`
# system user and the directories are handed to it.
mkdir -p "$PGDATA" "$PGSOCK"
chown -R postgres:postgres "$PGDATA" "$PGSOCK"
chmod 700 "$PGDATA"

# initdb writes to /dev/null. In at least one container image /dev/null was a
# regular FILE rather than a character device, and initdb failed with a
# permission error that pointed nowhere near the cause. Check rather than
# rediscover it.
if [ ! -c /dev/null ]; then
  echo "pg-harness: /dev/null is not a character device; fixing" >&2
  rm -f /dev/null
  mknod /dev/null c 1 3
  chmod 666 /dev/null
fi

if [ ! -f "$PGDATA/PG_VERSION" ]; then
  echo "pg-harness: initialising $PGDATA"
  su postgres -c "$PGBIN/initdb -D $PGDATA -U postgres --auth=trust" >/dev/null
fi

echo "pg-harness: starting on $PGSOCK:$PGPORT"
su postgres -c "$PGBIN/pg_ctl -D $PGDATA -o '-k $PGSOCK -p $PGPORT -c listen_addresses=' -l $PGDATA/server.log -w start" >/dev/null

psql -h "$PGSOCK" -p "$PGPORT" -U postgres -d postgres -t -c 'select version()' | head -1
