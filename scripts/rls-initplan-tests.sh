#!/usr/bin/env bash
#
# MIGRATION 0109 MUST CHANGE THE PLAN AND NOT THE ANSWER (P1-33).
#
# 0109 wraps two zero-argument calls in a scalar subquery so the planner runs
# them once per statement instead of once per row. The claim is that this is
# semantically identical. A claim about RLS is worth nothing without a test
# that could catch it being false, so this builds the real policies on a
# throwaway Postgres, records what four different callers can see, applies the
# migration, and records it again. Any difference is a failure.
#
# THE CALLERS, because "it still works for me" is not a test:
#   anon          no role claim at all
#   member A      a workspace member, reading their own rows
#   member B      a DIFFERENT customer — must never gain a row
#   admin         an operator, for whom the hoisted call is the one that matters
#
# It runs against the local harness, never Supabase: DEV does not carry this
# data and PROD is not a place to rehearse policy changes.
#
#   bash scripts/pg-harness-up.sh && npm run test:rls:initplan
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
PSQL=(psql -h "$PGSOCK" -p "$PGPORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -X -q -t -A)

if ! "${PSQL[@]}" -c 'select 1' >/dev/null 2>&1; then
  echo "rls-initplan: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATION="$ROOT/supabase/migrations/0109_rls_hoists_the_calls_that_do_not_vary.sql"
[ -f "$MIGRATION" ] || { echo "rls-initplan: $MIGRATION not found" >&2; exit 2; }

BEFORE=$(mktemp) ; AFTER=$(mktemp) ; PLANS=$(mktemp)
trap 'rm -f "$BEFORE" "$AFTER" "$PLANS"' EXIT

# ── A throwaway rehearsal of the real thing ─────────────────────────────────
#
# Only the tables 0109 touches, with the policy expressions replayed from the
# migrations that created them. auth.uid() and is_admin() are stubbed to read
# session settings so a test can BE each caller — that is what Supabase's own
# helpers do at runtime, one reading the JWT and the other the profiles row.
"${PSQL[@]}" >/dev/null <<'SQL'
-- A previous run leaves the test role holding grants on the auth schema, and a
-- role holding privileges cannot simply be dropped. `drop owned by` clears the
-- grants as well as the objects, which is what makes this re-runnable.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'rls_caller') then
    execute 'drop owned by rls_caller';
    execute 'drop role rls_caller';
  end if;
end $$;

drop schema if exists public cascade;
create schema public;
drop schema if exists auth cascade;
create schema auth;

create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
create or replace function public.is_admin() returns boolean language sql stable as
  $$ select coalesce(current_setting('test.admin', true), 'off') = 'on' $$;
create or replace function public.is_workspace_member(p_ws uuid) returns boolean language sql stable as
  $$ select p_ws = nullif(current_setting('test.ws', true), '')::uuid $$;

create table public.products (id uuid primary key, workspace_id uuid not null);
create table public.product_images (id uuid primary key, product_id uuid not null);
create table public.generations (id uuid primary key, workspace_id uuid not null);
create table public.generation_assets (id uuid primary key, generation_id uuid not null);
create table public.generation_jobs (id uuid primary key, workspace_id uuid not null, user_id uuid);
create table public.credit_wallets (id uuid primary key, workspace_id uuid not null);
create table public.credit_transactions (id uuid primary key, wallet_id uuid not null);
create table public.usage_events (id uuid primary key, workspace_id uuid not null);
create table public.notifications (id uuid primary key, user_id uuid);
create table public.newsletter_contacts (id uuid primary key);
create table public.newsletter_recipients (id uuid primary key);
create table public.newsletter_events (id uuid primary key);

do $$ declare t text; begin
  foreach t in array array['product_images','generations','generation_assets','generation_jobs',
    'credit_wallets','credit_transactions','usage_events','notifications',
    'newsletter_contacts','newsletter_recipients','newsletter_events']
  loop execute format('alter table public.%I enable row level security', t); end loop;
end $$;

-- The policy set exactly as the repository defines it after 0108.
create policy gen_select on public.generations for select
  using (public.is_workspace_member(workspace_id) or public.is_admin());
create policy ga_select on public.generation_assets for select
  using (exists (select 1 from public.generations g where g.id = generation_id
    and (public.is_workspace_member(g.workspace_id) or public.is_admin())));
create policy gj_select on public.generation_jobs for select
  using (public.is_workspace_member(workspace_id) or public.is_admin());
create policy gj_update on public.generation_jobs for update
  using (public.is_workspace_member(workspace_id) or public.is_admin());
create policy gj_insert on public.generation_jobs for insert
  with check (public.is_workspace_member(workspace_id) and user_id = auth.uid());
create policy pimg_select on public.product_images for select
  using (exists (select 1 from public.products p where p.id = product_id
    and (public.is_workspace_member(p.workspace_id) or public.is_admin())));
create policy wallet_select on public.credit_wallets for select
  using (public.is_workspace_member(workspace_id) or public.is_admin());
create policy ctx_select on public.credit_transactions for select
  using (exists (select 1 from public.credit_wallets w where w.id = wallet_id
    and (public.is_workspace_member(w.workspace_id) or public.is_admin())));
create policy usage_events_member_read on public.usage_events for select
  using (public.is_workspace_member(workspace_id) or public.is_admin());
create policy usage_events_admin_update on public.usage_events for update
  using (public.is_admin());
create policy notifications_own_read on public.notifications for select
  using (user_id = auth.uid());
create policy notifications_own_update on public.notifications for update
  using (user_id = auth.uid());
create policy notifications_insert on public.notifications for insert
  with check (user_id = auth.uid() or public.is_admin());
create policy newsletter_contacts_admin on public.newsletter_contacts for all to public
  using (public.is_admin()) with check (public.is_admin());
create policy newsletter_recipients_admin on public.newsletter_recipients for all to public
  using (public.is_admin()) with check (public.is_admin());
create policy newsletter_events_admin on public.newsletter_events for all to public
  using (public.is_admin()) with check (public.is_admin());

-- Two workspaces, two customers, rows belonging to each.
insert into public.products values
  ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001'),
  ('22222222-2222-2222-2222-222222222222','bbbbbbbb-0000-0000-0000-000000000002');
insert into public.product_images values
  ('11111111-0000-0000-0000-00000000000a','11111111-1111-1111-1111-111111111111'),
  ('22222222-0000-0000-0000-00000000000b','22222222-2222-2222-2222-222222222222');
insert into public.generations values
  ('11111111-0000-0000-0000-0000000000c1','aaaaaaaa-0000-0000-0000-000000000001'),
  ('22222222-0000-0000-0000-0000000000c2','bbbbbbbb-0000-0000-0000-000000000002');
insert into public.generation_assets values
  ('11111111-0000-0000-0000-0000000000d1','11111111-0000-0000-0000-0000000000c1'),
  ('22222222-0000-0000-0000-0000000000d2','22222222-0000-0000-0000-0000000000c2');
insert into public.generation_jobs values
  ('11111111-0000-0000-0000-0000000000e1','aaaaaaaa-0000-0000-0000-000000000001','deadbeef-0000-0000-0000-000000000001'),
  ('22222222-0000-0000-0000-0000000000e2','bbbbbbbb-0000-0000-0000-000000000002','deadbeef-0000-0000-0000-000000000002');
insert into public.credit_wallets values
  ('11111111-0000-0000-0000-0000000000f1','aaaaaaaa-0000-0000-0000-000000000001'),
  ('22222222-0000-0000-0000-0000000000f2','bbbbbbbb-0000-0000-0000-000000000002');
insert into public.credit_transactions values
  ('11111111-0000-0000-0000-00000000a001','11111111-0000-0000-0000-0000000000f1'),
  ('22222222-0000-0000-0000-00000000a002','22222222-0000-0000-0000-0000000000f2');
insert into public.usage_events values
  ('11111111-0000-0000-0000-00000000b001','aaaaaaaa-0000-0000-0000-000000000001'),
  ('22222222-0000-0000-0000-00000000b002','bbbbbbbb-0000-0000-0000-000000000002');
insert into public.notifications values
  ('11111111-0000-0000-0000-00000000c001','deadbeef-0000-0000-0000-000000000001'),
  ('22222222-0000-0000-0000-00000000c002','deadbeef-0000-0000-0000-000000000002');
insert into public.newsletter_contacts values ('11111111-0000-0000-0000-00000000d001');
insert into public.newsletter_recipients values ('11111111-0000-0000-0000-00000000d002');
insert into public.newsletter_events values ('11111111-0000-0000-0000-00000000d003');

-- A role that RLS actually applies to. The table OWNER bypasses RLS entirely,
-- so running these probes as postgres would pass no matter what the policies
-- said — which is the most common way an RLS test proves nothing.
create role rls_caller;
grant usage on schema public, auth to rls_caller;
grant select, insert, update on all tables in schema public to rls_caller;
grant execute on all functions in schema public, auth to rls_caller;
SQL

# ── What each caller can see, as one comparable record ──────────────────────
snapshot() {
  "${PSQL[@]}" <<'SQL'
set role rls_caller;
\set QUIET on
-- anon: no uid, no workspace, not an admin
select set_config('test.uid','',false), set_config('test.ws','',false), set_config('test.admin','off',false);
select 'anon  product_images=' || count(*) from public.product_images
union all select 'anon  generations=' || count(*) from public.generations
union all select 'anon  generation_assets=' || count(*) from public.generation_assets
union all select 'anon  generation_jobs=' || count(*) from public.generation_jobs
union all select 'anon  credit_wallets=' || count(*) from public.credit_wallets
union all select 'anon  credit_transactions=' || count(*) from public.credit_transactions
union all select 'anon  usage_events=' || count(*) from public.usage_events
union all select 'anon  notifications=' || count(*) from public.notifications
union all select 'anon  newsletter_contacts=' || count(*) from public.newsletter_contacts
union all select 'anon  newsletter_recipients=' || count(*) from public.newsletter_recipients
union all select 'anon  newsletter_events=' || count(*) from public.newsletter_events;

-- member A
select set_config('test.uid','deadbeef-0000-0000-0000-000000000001',false),
       set_config('test.ws','aaaaaaaa-0000-0000-0000-000000000001',false),
       set_config('test.admin','off',false);
select 'memberA  product_images=' || count(*) from public.product_images
union all select 'memberA  generations=' || count(*) from public.generations
union all select 'memberA  generation_assets=' || count(*) from public.generation_assets
union all select 'memberA  generation_jobs=' || count(*) from public.generation_jobs
union all select 'memberA  credit_wallets=' || count(*) from public.credit_wallets
union all select 'memberA  credit_transactions=' || count(*) from public.credit_transactions
union all select 'memberA  usage_events=' || count(*) from public.usage_events
union all select 'memberA  notifications=' || count(*) from public.notifications
union all select 'memberA  newsletter_contacts=' || count(*) from public.newsletter_contacts
union all select 'memberA  newsletter_recipients=' || count(*) from public.newsletter_recipients
union all select 'memberA  newsletter_events=' || count(*) from public.newsletter_events;

-- member B — the cross-customer case
select set_config('test.uid','deadbeef-0000-0000-0000-000000000002',false),
       set_config('test.ws','bbbbbbbb-0000-0000-0000-000000000002',false),
       set_config('test.admin','off',false);
select 'memberB  product_images=' || count(*) from public.product_images
union all select 'memberB  generations=' || count(*) from public.generations
union all select 'memberB  generation_assets=' || count(*) from public.generation_assets
union all select 'memberB  generation_jobs=' || count(*) from public.generation_jobs
union all select 'memberB  credit_wallets=' || count(*) from public.credit_wallets
union all select 'memberB  credit_transactions=' || count(*) from public.credit_transactions
union all select 'memberB  usage_events=' || count(*) from public.usage_events
union all select 'memberB  notifications=' || count(*) from public.notifications;

-- and WHICH rows, not just how many: a swap that kept the count would pass a
-- count-only comparison and leak one customer's work to another.
select 'memberB  ids  ' || coalesce(string_agg(id::text, ',' order by id), '(none)') from public.generations;

-- admin
select set_config('test.uid','deadbeef-0000-0000-0000-00000000000f',false),
       set_config('test.ws','',false), set_config('test.admin','on',false);
select 'admin  product_images=' || count(*) from public.product_images
union all select 'admin  generations=' || count(*) from public.generations
union all select 'admin  generation_assets=' || count(*) from public.generation_assets
union all select 'admin  generation_jobs=' || count(*) from public.generation_jobs
union all select 'admin  credit_wallets=' || count(*) from public.credit_wallets
union all select 'admin  credit_transactions=' || count(*) from public.credit_transactions
union all select 'admin  usage_events=' || count(*) from public.usage_events
union all select 'admin  notifications=' || count(*) from public.notifications
union all select 'admin  newsletter_contacts=' || count(*) from public.newsletter_contacts
union all select 'admin  newsletter_recipients=' || count(*) from public.newsletter_recipients
union all select 'admin  newsletter_events=' || count(*) from public.newsletter_events;

-- WRITES, which a read-only comparison would miss entirely.
--
-- INSIDE AN EXPLICIT TRANSACTION, and that is not a detail. The first version
-- of this file used savepoints without one: psql reported "SAVEPOINT can only
-- be used in transaction blocks" in both runs so the messages cancelled out in
-- the diff, while the inserts themselves COMMITTED — and the extra rows showed
-- up in the second snapshot as a phantom access change. The harness accusing a
-- correct migration is the same failure as a harness excusing a broken one.
begin;
select set_config('test.uid','deadbeef-0000-0000-0000-000000000001',false),
       set_config('test.ws','aaaaaaaa-0000-0000-0000-000000000001',false),
       set_config('test.admin','off',false);
\set ON_ERROR_STOP off
savepoint s1;
insert into public.generation_jobs values ('33333333-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','deadbeef-0000-0000-0000-000000000001');
select 'write  memberA inserts own job: allowed';
rollback to savepoint s1;
savepoint s2;
insert into public.generation_jobs values ('33333333-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','deadbeef-0000-0000-0000-000000000002');
select 'write  memberA inserts job AS ANOTHER USER: allowed <<< LEAK';
rollback to savepoint s2;
savepoint s3;
insert into public.generation_jobs values ('33333333-0000-0000-0000-000000000003','bbbbbbbb-0000-0000-0000-000000000002','deadbeef-0000-0000-0000-000000000001');
select 'write  memberA inserts into ANOTHER WORKSPACE: allowed <<< LEAK';
rollback to savepoint s3;
savepoint s4;
update public.usage_events set workspace_id = workspace_id where true;
select 'write  memberA updates usage_events: ' || 'rows touched';
rollback to savepoint s4;
savepoint s5;
insert into public.newsletter_contacts values ('44444444-0000-0000-0000-000000000001');
select 'write  memberA writes newsletter_contacts: allowed <<< LEAK';
rollback to savepoint s5;
-- Nothing the write probes did may survive into the next snapshot.
rollback;
SQL
}

echo "==> recording access BEFORE 0109"
snapshot > "$BEFORE" 2>&1

echo "==> applying 0109"
"${PSQL[@]}" -f "$MIGRATION" > /dev/null

echo "==> recording access AFTER 0109"
snapshot > "$AFTER" 2>&1

echo
if diff -u "$BEFORE" "$AFTER" > "$PLANS"; then
  echo "ACCESS IS IDENTICAL — every caller, every table, reads and writes."
else
  echo "ACCESS CHANGED. 0109 is not a planner-only edit:"
  cat "$PLANS"
  exit 1
fi

# ── THE DIFF ALONE IS NOT ENOUGH, and this is the hole it leaves ────────────
#
# "BEFORE equals AFTER" proves the migration changed nothing. It does NOT
# prove the thing it preserved was correct: if a policy leaked one customer's
# rows to another BOTH times, the diff would be empty and this script would
# report success. So the invariants are asserted outright, against the
# snapshot, rather than inferred from its stability.
fail=0
assert_absent() {  # a line that must never appear in either run
  if grep -qF "$1" "$BEFORE" || grep -qF "$1" "$AFTER"; then
    echo "  ✗ LEAK: $1" >&2; fail=1
  else
    echo "  ✓ refused: ${1#write  }"
  fi
}
assert_line() {   # an exact line that must appear in both runs
  if grep -qxF "$1" "$BEFORE" && grep -qxF "$1" "$AFTER"; then
    echo "  ✓ $1"
  else
    echo "  ✗ expected in both runs and was not: $1" >&2; fail=1
  fi
}

echo
echo "==> isolation, asserted rather than assumed"
# An anonymous caller sees nothing, anywhere.
for t in product_images generations generation_assets generation_jobs \
         credit_wallets credit_transactions usage_events notifications \
         newsletter_contacts newsletter_recipients newsletter_events; do
  assert_line "anon  ${t}=0"
done
# A member sees their own row and exactly one — never the other customer's.
for t in product_images generations generation_assets generation_jobs \
         credit_wallets credit_transactions usage_events notifications; do
  assert_line "memberA  ${t}=1"
done
# And the operator-only tables stay invisible to a paying customer.
assert_line "memberA  newsletter_contacts=0"
assert_line "memberA  newsletter_recipients=0"
assert_line "memberA  newsletter_events=0"
# WHICH row, not how many: a swap preserving the count would pass a count test.
assert_line "memberB  ids  22222222-0000-0000-0000-0000000000c2"
# The admin sees both workspaces — the path the hoisted call actually speeds up.
assert_line "admin  generations=2"
assert_line "admin  credit_transactions=2"

echo
echo "==> writes that must be refused"
assert_absent "write  memberA inserts job AS ANOTHER USER: allowed <<< LEAK"
assert_absent "write  memberA inserts into ANOTHER WORKSPACE: allowed <<< LEAK"
assert_absent "write  memberA writes newsletter_contacts: allowed <<< LEAK"
assert_line   "write  memberA inserts own job: allowed"

[ "$fail" -eq 0 ] || { echo; echo "isolation assertions FAILED" >&2; exit 1; }

# ── And the thing it was supposed to change DID change ──────────────────────
#
# Without this the test would pass just as happily if the migration had done
# nothing at all, which is the most likely way for it to be silently wrong.
echo
echo "==> the plan, which is the part that was meant to change"
HOISTED=$("${PSQL[@]}" -c "
  select count(*) from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname='public'
    and p.polname in ('gen_select','ga_select','gj_select','gj_update','gj_insert',
      'pimg_select','wallet_select','ctx_select','usage_events_member_read',
      'usage_events_admin_update','notifications_own_read','notifications_own_update',
      'notifications_insert','newsletter_contacts_admin','newsletter_recipients_admin',
      'newsletter_events_admin')
    and (coalesce(pg_get_expr(p.polqual,p.polrelid),'') like '%( SELECT %'
      or coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') like '%( SELECT %');
")
echo "    policies now carrying a hoisted call: $HOISTED / 16"
if [ "$HOISTED" -ne 16 ]; then
  echo "    the migration did not take effect on every target — this is a failure" >&2
  exit 1
fi

# InitPlan is the observable proof the call moved out of the per-row path.
echo
echo "==> EXPLAIN, admin reading generations"
"${PSQL[@]}" <<'SQL' | sed 's/^/    /'
set role rls_caller;
select set_config('test.uid','deadbeef-0000-0000-0000-00000000000f',false),
       set_config('test.ws','',false), set_config('test.admin','on',false);
explain (costs off) select * from public.generations;
SQL

echo
echo "rls initplan tests passed."
