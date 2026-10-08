#!/usr/bin/env bash
#
# THE PUBLIC CENNIK CAN READ THE CATALOGUE — PROVEN AGAINST A REAL POSTGRES.
#
# /plany is read without a session. Before 0137, an anonymous read of the
# plans or the packs did not return "no rows" — it RAISED
# `permission denied for function is_admin`, because the policies on both
# tables OR-ed `is_admin()` into anon's path (reproduced on PROD with
# `set local role anon`). This harness rebuilds that exact state, shows the
# error, applies 0137 (twice), and proves:
#
#   · anon reads the ACTIVE rows, through the exact column lists the app
#     asks for (lib/server/pricing-page.ts, lib/server/cms-data.ts — read
#     from the source, not copied here);
#   · anon never sees an inactive row;
#   · anon still writes nothing; a signed-in user reads what they read before;
#   · an admin still reads and writes everything.
#
# It runs on the local harness, never Supabase.
#
#   bash scripts/pg-harness-up.sh && npm run test:catalogue:sql
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
DB=catalogue_sql
ADMIN=(psql -h "$PGSOCK" -p "$PGPORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -X -q -t -A)
PSQL=(psql -h "$PGSOCK" -p "$PGPORT" -U postgres -d "$DB" -v ON_ERROR_STOP=1 -X -q -t -A)
# Without ON_ERROR_STOP: for statements that are EXPECTED to fail.
TRY=(psql -h "$PGSOCK" -p "$PGPORT" -U postgres -d "$DB" -X -q -t -A)

if ! "${ADMIN[@]}" -c 'select 1' >/dev/null 2>&1; then
  echo "catalogue-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATION="${MIGRATION:-$ROOT/supabase/migrations/0137_public_catalogue_read.sql}"
[ -f "$MIGRATION" ] || { echo "catalogue-sql: $MIGRATION not found" >&2; exit 2; }

# The column lists the app really sends, read from the source.
PLAN_COLUMNS="$(sed -n 's/^const PLAN_COLUMNS = "\(.*\)";$/\1/p' "$ROOT/lib/server/pricing-page.ts")"
PACK_COLUMNS="$(sed -n 's/^const PACK_COLUMNS = "\(.*\)";$/\1/p' "$ROOT/lib/server/pricing-page.ts")"
CMS_COLUMNS="$(grep -A1 'export async function loadPublicPlans' "$ROOT/lib/server/cms-data.ts" >/dev/null && \
  sed -n '/export async function loadPublicPlans/,/limit(8)/p' "$ROOT/lib/server/cms-data.ts" | sed -n 's/.*\.select("\([^"]*\)").*/\1/p')"
[ -n "$PLAN_COLUMNS" ] && [ -n "$PACK_COLUMNS" ] && [ -n "$CMS_COLUMNS" ] \
  || { echo "catalogue-sql: could not read the app's column lists" >&2; exit 2; }

fails=0
check() { # name, actual, expected
  if [ "$2" = "$3" ]; then echo "  ✓ $1"
  else echo "  ✗ $1 — got [$2], expected [$3]"; fails=$((fails+1)); fi
}
as() { # role, admin(true|false), sql — prints the result or the error line
  "${TRY[@]}" -c "begin; set local role $1; set local test.is_admin = '$2'; $3; rollback;" 2>&1 | grep -v '^$' | head -1
}

"${ADMIN[@]}" -c "drop database if exists $DB" >/dev/null
"${ADMIN[@]}" -c "create database $DB" >/dev/null

# PROD's shape on 2026-10-08: every column, the four policies on the PUBLIC
# role, is_admin() not executable by anon, and anon holding table privileges.
"${PSQL[@]}" >/dev/null <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
end $$;
grant usage on schema public to anon, authenticated;

create or replace function public.is_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select coalesce(nullif(current_setting('test.is_admin', true), '')::boolean, false)
$$;
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

create table public.subscription_plans (
  id uuid primary key default gen_random_uuid(), slug text not null, name text not null,
  monthly_credits integer not null default 0, price_cents integer not null default 0,
  currency text not null default 'PLN', active boolean not null default true,
  features jsonb not null default '{}'::jsonb, sort_order integer not null default 0,
  created_at timestamptz not null default now(), description text,
  annual_price_cents integer not null default 0, featured boolean not null default false,
  bonus_credits integer not null default 0, limits jsonb not null default '{}'::jsonb,
  stripe_product_id text, stripe_price_id_monthly text, stripe_price_id_annual text,
  stripe_price_monthly_cents integer, stripe_price_annual_cents integer,
  stripe_sync_status text, stripe_synced_at timestamptz, stripe_sync_error text
);
create table public.credit_packages (
  id uuid primary key default gen_random_uuid(), name text not null, credits integer not null,
  bonus_credits integer not null default 0, price_cents integer not null, currency text not null default 'PLN',
  active boolean not null default true, featured boolean not null default false,
  sort_order integer not null default 0, badge text, description text,
  created_at timestamptz not null default now(), stripe_product_id text, stripe_price_id text,
  stripe_price_cents integer, stripe_sync_status text, stripe_synced_at timestamptz, stripe_sync_error text
);
alter table public.subscription_plans enable row level security;
alter table public.credit_packages enable row level security;
create policy "plans_select" on public.subscription_plans for select using (active = true or public.is_admin());
create policy "plans_admin_write" on public.subscription_plans for all using (public.is_admin()) with check (public.is_admin());
create policy "pkg_select_active" on public.credit_packages for select using (active = true or public.is_admin());
create policy "pkg_admin_write" on public.credit_packages for all using (public.is_admin()) with check (public.is_admin());
grant all on public.subscription_plans, public.credit_packages to anon, authenticated;

insert into public.subscription_plans (slug, name, price_cents, monthly_credits, sort_order, active, stripe_sync_error) values
  ('free', 'Free', 0, 25, 0, true, null), ('starter', 'Starter', 9900, 300, 1, true, null),
  ('pro', 'Pro', 29900, 1200, 2, true, 'internal sync note'), ('legacy', 'Legacy', 4900, 100, 9, false, null);
insert into public.credit_packages (name, credits, bonus_credits, price_cents, sort_order, active, stripe_sync_error) values
  ('Start', 100, 0, 1900, 0, true, 'internal sync note'), ('Old', 50, 0, 990, 9, false, null);
SQL

echo "BEFORE 0137 — the bug, reproduced"
check "anon reading the active plans RAISES (permission denied for is_admin)" \
  "$(as anon false "select count(*) from public.subscription_plans where active" | grep -c 'permission denied for function is_admin' || true)" "1"
check "anon reading the active packs RAISES too" \
  "$(as anon false "select count(*) from public.credit_packages where active" | grep -c 'permission denied for function is_admin' || true)" "1"

"${PSQL[@]}" -f "$MIGRATION" >/dev/null
"${PSQL[@]}" -f "$MIGRATION" >/dev/null
echo "AFTER 0137 (applied twice — idempotent)"

check "anon reads the plans with /plany's exact columns: the 3 active rows" \
  "$(as anon false "select count(*) from (select $PLAN_COLUMNS from public.subscription_plans where active = true order by sort_order) x")" "3"
check "anon reads the packs with /plany's exact columns: the 1 active row" \
  "$(as anon false "select count(*) from (select $PACK_COLUMNS from public.credit_packages where active = true order by sort_order) x")" "1"
check "anon reads the CMS price table's columns (loadPublicPlans)" \
  "$(as anon false "select count(*) from (select $CMS_COLUMNS from public.subscription_plans where active = true) x")" "3"
check "anon never sees an inactive plan (even without the filter)" \
  "$(as anon false "select count(*) from public.subscription_plans where slug = 'legacy'")" "0"
check "anon never sees an inactive pack" \
  "$(as anon false "select count(*) from public.credit_packages where name = 'Old'")" "0"
check "anon sees exactly what a signed-in customer sees: the active rows, no more" \
  "$(as anon false "select count(*) from (select * from public.subscription_plans) x")/$(as authenticated false "select count(*) from (select * from public.subscription_plans) x")" "3/3"
check "anon cannot insert a plan" \
  "$(as anon false "insert into public.subscription_plans (slug, name) values ('x', 'x')" | grep -c 'row-level security\|permission denied' || true)" "1"
"${TRY[@]}" -c "begin; set local role anon; update public.subscription_plans set price_cents = 1 where slug = 'pro'; delete from public.credit_packages; commit;" >/dev/null 2>&1 || true
check "anon's update/delete changed nothing" \
  "$("${PSQL[@]}" -c "select (select price_cents from public.subscription_plans where slug='pro') || '/' || (select count(*) from public.credit_packages)")" "29900/2"

check "signed in (not admin): every column of the active plans, as before" \
  "$(as authenticated false "select count(*) from (select * from public.subscription_plans) x")" "3"
check "signed in (not admin): sync bookkeeping still readable, as before" \
  "$(as authenticated false "select stripe_sync_error from public.subscription_plans where slug = 'pro'")" "internal sync note"
check "signed in (not admin): no inactive rows, no writes" \
  "$(as authenticated false "with u as (update public.subscription_plans set price_cents = 1 returning 1) select count(*) from u")" "0"
check "admin: every plan, active or not" \
  "$(as authenticated true "select count(*) from public.subscription_plans")" "4"
check "admin: can still write" \
  "$(as authenticated true "with u as (update public.credit_packages set badge = 'x' returning 1) select count(*) from u")" "2"
check "is_admin() is still NOT executable by anon (never granted)" \
  "$("${PSQL[@]}" -c "select has_function_privilege('anon', 'public.is_admin()', 'execute')")" "f"
check "the four original policies kept their names (re-scoped, not dropped)" \
  "$("${PSQL[@]}" -c "select count(*) from pg_policies where policyname in ('plans_select','plans_admin_write','pkg_select_active','pkg_admin_write') and roles = '{authenticated}'")" "4"
check "no policy on either table applies to anon AND mentions is_admin" \
  "$("${PSQL[@]}" -c "select count(*) from pg_policies where tablename in ('subscription_plans','credit_packages') and ('anon' = any(roles) or 'public' = any(roles)) and coalesce(qual,'') || coalesce(with_check,'') like '%is_admin%'")" "0"

"${ADMIN[@]}" -c "drop database if exists $DB" >/dev/null

echo
if [ "$fails" = "0" ]; then echo "All public catalogue SQL tests passed."; else echo "$fails FAILED"; fi
exit $([ "$fails" = "0" ] && echo 0 || echo 1)
