#!/usr/bin/env bash
#
# PRE-LAUNCH LANDING V2 (0144), PROVEN AGAINST A REAL POSTGRES.
#
# 0144 turns the launch page's form into a real double opt-in list: a bare
# contact at submit, consent only at the DOI click, first-touch attribution,
# referrals decided once under a lock, and credits paid to a verified account
# exactly once however many renders ask at the same moment. Every one of
# those is a DATABASE rule, so every one is asserted here AS THE CALLER it is
# meant to stop — anon without the server token, a customer, another
# customer, an admin — on the real migration file, applied verbatim TWICE,
# and a third time over a populated database.
#
# The rehearsal schema is what 0144 lands on, replayed from the migrations
# that created it (function bodies EXTRACTED from the files, not retyped):
#   · roles anon / authenticated and SUPABASE'S DEFAULT PRIVILEGES (every new
#     table and function in public is granted to both), so 0144's revokes are
#     what make "no access" true;
#   · pgcrypto installed WITH SCHEMA extensions, as on PROD — never in public,
#     which would hide a search_path that cannot see gen_random_bytes (S3);
#   · auth.uid() as PROD defines it; auth.users; is_admin (0002) with 0005's
#     grants; account_blocked (0072); server_call_ok (0077);
#     apply_credit_transaction (0012); app_setting_is_private as 0143 left it
#     and the app_settings policies (0110);
#   · the newsletter: sources, contacts, suppressions, groups, members,
#     contact sources (0094/0097), newsletter_upsert_contact (0097),
#     newsletter_resubscribe (0096); the legacy waitlist table, email_settings
#     and waitlist_subscribe as 0106 left it; cms_pages / cms_blocks.
#
# Concurrency is real: separate backends released together by an advisory
# lock barrier, each holding its transaction open a moment after the call
# (double DOI click, the referral cap, ten parallel reward renders). The last
# section breaks copies of 0144 on purpose and checks the suite goes red
# where it should.
#
# Local harness only, its own databases (prelaunch_sqltest, _m1…_m3), removed
# on exit (KEEP_DB=1 keeps them; SKIP_MUTANTS=1 skips section Z).
#
#   bash scripts/pg-harness-up.sh && bash scripts/prelaunch-sql-tests.sh
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
PGCONN=(-h "$PGSOCK" -p "$PGPORT" -U postgres)

if ! psql "${PGCONN[@]}" -d postgres -X -q -t -A -c 'select 1' >/dev/null 2>&1; then
  echo "prelaunch-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
M="$ROOT/supabase/migrations"
MIGRATION="${MIGRATION:-$M/0144_prelaunch_landing.sql}"
[ -f "$MIGRATION" ] || { echo "prelaunch-sql: $MIGRATION not found" >&2; exit 2; }

extract() { # file, function name, end marker regex
  awk -v start="^create (or replace )?function public[.]$2[(]" -v stop="$3" \
    '$0 ~ start {on=1} on {print} on && $0 ~ stop {exit}' "$1"
}
IS_ADMIN=$(extract "$M/0002_functions_and_triggers.sql" is_admin '^[$][$];')
TOUCH=$(extract "$M/0002_functions_and_triggers.sql" touch_updated_at '^[$][$];')
SERVER_CALL_OK=$(extract "$M/0077_server_only_rpcs.sql" server_call_ok '^end [$][$];')
ACCOUNT_BLOCKED=$(extract "$M/0072_temporary_account_block.sql" account_blocked '^[$][$];')
APPLY_TX=$(extract "$M/0012_saas_foundation.sql" apply_credit_transaction '^[$][$];')
UPSERT=$(extract "$M/0097_newsletter_contact_merge.sql" newsletter_upsert_contact '^end [$][$];')
RESUB=$(extract "$M/0096_newsletter_resubscribe.sql" newsletter_resubscribe '^end [$][$];')
WAITLIST_0106=$(extract "$M/0106_waitlist_confirmation_is_token_gated.sql" waitlist_subscribe '^[$]function[$];')
PRIVATE_0143=$(extract "$M/0143_trial_watermark.sql" app_setting_is_private '^[$][$];')
for v in IS_ADMIN TOUCH SERVER_CALL_OK ACCOUNT_BLOCKED APPLY_TX UPSERT RESUB WAITLIST_0106 PRIVATE_0143; do
  [ -n "${!v}" ] || { echo "prelaunch-sql: could not extract $v" >&2; exit 2; }
done

DB_MAIN="${PRELAUNCH_DB:-prelaunch_sqltest}"
MUTANT_DBS=("${DB_MAIN}_m1" "${DB_MAIN}_m2" "${DB_MAIN}_m3")
WORK=$(mktemp -d)
cleanup() {
  if [ "${KEEP_DB:-0}" != "1" ]; then
    for d in "$DB_MAIN" "${MUTANT_DBS[@]}"; do
      dropdb "${PGCONN[@]}" --if-exists --force "$d" >/dev/null 2>&1 || true
    done
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT
ERR="$WORK/err"

DB=""
SUITE_ABORTED=0
q() { psql "${PGCONN[@]}" -d "$DB" -v ON_ERROR_STOP=1 -X -q -t -A "$@"; }
record() {
  q -v name="$1" -v ok="$2" -v detail="$3" >/dev/null <<'SQL'
insert into public.test_results (name, ok, detail) values (:'name', :'ok'::boolean, :'detail');
SQL
}
apply_migration() {  # verbatim, one transaction (the file opens with `set local lock_timeout`)
  PGOPTIONS='-c client_min_messages=warning' \
    psql "${PGCONN[@]}" -d "$DB" -v ON_ERROR_STOP=1 -X -q -t -A -1 -f "$1" >/dev/null 2>"$ERR"
}

# Run SQL in several backends AT ONCE: one argument per backend. Each backend
# first waits on a shared advisory lock that a holder backend keeps for a
# moment, so all of them are released together — a real race, not a queue.
# The callers wrap their call in a transaction that stays open a little
# after the call (pg_sleep before commit): without the lock under test, two
# backends would both read the same not-yet-committed state; with it, the
# second waits. Output of backend i lands in $WORK/race_i.out.
race() {
  local pids=() i=0 sql
  rm -f "$WORK"/race_*.out
  psql "${PGCONN[@]}" -d "$DB" -X -q -t -A \
    -c "select pg_advisory_lock(424242)" -c "select pg_sleep(1.2)" >/dev/null 2>&1 &
  local holder=$!
  for sql in "$@"; do
    i=$((i + 1))
    psql "${PGCONN[@]}" -d "$DB" -X -q -t -A \
      -c "select pg_sleep(0.4)" -c "select pg_advisory_lock_shared(424242)" \
      -c "select pg_advisory_unlock_shared(424242)" -c "$sql" >"$WORK/race_$i.out" 2>&1 &
    pids+=($!)
  done
  for i in "${pids[@]}"; do wait "$i" || true; done
  wait "$holder" || true
}

# ── The rehearsal ───────────────────────────────────────────────────────────
build_rehearsal() {
  q >/dev/null <<'SQL'
set client_min_messages = warning;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth; create schema extensions;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema public, auth, extensions to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;

-- PROD's auth.uid(), verbatim.
create function auth.uid() returns uuid language sql stable as $f$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$f$;
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz,
  created_at timestamptz not null default now());

create type public.credit_tx_type as enum ('subscription','topup','generation','refund','bonus','admin_adjustment',
  'purchase','promotion','admin_grant','manual_adjustment');

-- profiles: the columns is_admin / account_blocked / the contact link read.
create table public.profiles (id uuid primary key, email text not null default '', role text not null default 'user',
  blocked boolean not null default false, blocked_until timestamptz, updated_at timestamptz not null default now());
create table public.workspaces (id uuid primary key default gen_random_uuid(), name text not null default 'ws',
  owner_id uuid not null references public.profiles(id) on delete cascade, created_at timestamptz not null default now());
create table public.credit_wallets (id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade,
  balance int not null default 0 check (balance >= 0), updated_at timestamptz not null default now());
create table public.credit_transactions (id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.credit_wallets(id) on delete cascade, amount int not null,
  type public.credit_tx_type not null, description text, reference_id uuid, metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now(),
  balance_before int, balance_after int);

-- app_settings (0008) with its 0110 policies.
create table public.app_settings (key text primary key, value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now());
alter table public.app_settings enable row level security;

-- the newsletter (0094 + 0097), admin-only RLS as on PROD
create table public.newsletter_sources (key text primary key, name text not null, note text,
  created_at timestamptz not null default now());
create table public.newsletter_contacts (
  id uuid primary key default gen_random_uuid(),
  email text not null
    constraint newsletter_contacts_email_normalised check (email = lower(btrim(email)))
    constraint newsletter_contacts_email_shape check (email ~ '^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$'),
  first_name text, last_name text,
  locale text not null default 'pl' check (locale in ('pl', 'en', 'de')),
  source_key text not null default 'form' references public.newsletter_sources(key) on update cascade on delete set default,
  user_id uuid references public.profiles(id) on delete set null,
  tags text[] not null default '{}',
  marketing_consent boolean not null default false,
  consent_at timestamptz, consent_source text, consent_version text,
  unsubscribed_at timestamptz, unsubscribe_reason text,
  unsubscribe_token uuid not null default gen_random_uuid(),
  last_activity_at timestamptz, last_sent_at timestamptz, last_opened_at timestamptz, last_clicked_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  constraint newsletter_contacts_consent_coherent check (marketing_consent = false or consent_at is not null));
create unique index newsletter_contacts_email_key on public.newsletter_contacts (email);
create unique index newsletter_contacts_unsub_token_key on public.newsletter_contacts (unsubscribe_token);
create unique index newsletter_contacts_email_lower_key on public.newsletter_contacts (lower(email));
create table public.newsletter_suppressions (email text primary key check (email = lower(btrim(email))),
  reason text not null default 'unsubscribed' check (reason in ('unsubscribed', 'bounced', 'complained', 'blocked')),
  note text, created_at timestamptz not null default now(), created_by uuid references public.profiles(id) on delete set null);
create table public.newsletter_groups (id uuid primary key default gen_random_uuid(),
  key text not null check (key ~ '^[a-z][a-z0-9_-]{1,60}$'), name text not null, description text,
  is_dynamic boolean not null default false, rules jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null);
create unique index newsletter_groups_key_idx on public.newsletter_groups (key);
create table public.newsletter_group_members (
  group_id uuid not null references public.newsletter_groups(id) on delete cascade,
  contact_id uuid not null references public.newsletter_contacts(id) on delete cascade,
  added_at timestamptz not null default now(), primary key (group_id, contact_id));
create table public.newsletter_contact_sources (
  contact_id uuid not null references public.newsletter_contacts(id) on delete cascade,
  source_key text not null references public.newsletter_sources(key) on delete cascade,
  first_seen_at timestamptz not null default now(), last_seen_at timestamptz not null default now(),
  primary key (contact_id, source_key));
alter table public.newsletter_sources enable row level security;
alter table public.newsletter_contacts enable row level security;
alter table public.newsletter_suppressions enable row level security;
alter table public.newsletter_groups enable row level security;
alter table public.newsletter_group_members enable row level security;
alter table public.newsletter_contact_sources enable row level security;

-- the legacy waitlist (0048 + 0055 columns) and the mailbox (0048)
create table public.waitlist_subscribers (id uuid primary key default gen_random_uuid(), email text not null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'unsubscribed')),
  source text not null default 'landing', locale text not null default 'pl', metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), confirmed_at timestamptz,
  first_name text, last_name text, phone text);
create unique index waitlist_subscribers_email_key on public.waitlist_subscribers (lower(email));
alter table public.waitlist_subscribers enable row level security;
create table public.email_settings (id boolean primary key default true check (id),
  from_name text not null default 'GrovBase', from_email text not null default '', reply_to text not null default '',
  smtp_host text not null default '', smtp_port integer not null default 587, smtp_user text not null default '',
  smtp_secret_ciphertext text, smtp_secret_iv text, smtp_secret_auth_tag text,
  smtp_encryption text not null default 'auto', confirmation_enabled boolean not null default false,
  confirmation_subject text not null default 'Jesteś na liście GrovBase', confirmation_body text not null default 'x',
  updated_at timestamptz not null default now());
alter table public.email_settings enable row level security;
insert into public.email_settings (id) values (true);

-- the CMS tables the gallery index lands on (0012 + 0085 columns that matter)
create table public.cms_pages (id uuid primary key default gen_random_uuid(), slug text not null unique,
  title text not null default 't');
create table public.cms_blocks (id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.cms_pages(id) on delete cascade, type text not null,
  sort_order int not null default 0, visible boolean not null default true, content jsonb not null default '{}'::jsonb);
SQL

  # The function bodies, extracted from the migrations that own them.
  {
    echo "set client_min_messages = warning;"
    printf '%s\n' "$IS_ADMIN" "$TOUCH" "$SERVER_CALL_OK" "$ACCOUNT_BLOCKED" "$APPLY_TX" \
                  "$PRIVATE_0143" "$UPSERT" "$RESUB" "$WAITLIST_0106"
  } > "$WORK/bodies.sql"
  q -f "$WORK/bodies.sql" >/dev/null

  q >/dev/null <<'SQL'
set client_min_messages = warning;
-- 0005
revoke execute on function public.is_admin(uuid) from public, anon;
grant execute on function public.is_admin(uuid) to authenticated;
-- 0072 / 0077 / 0012 / 0097 / 0096 / 0106 grants
revoke execute on function public.account_blocked(uuid) from anon;
revoke all on function public.server_call_ok(text) from public, anon, authenticated;
revoke execute on function public.apply_credit_transaction(uuid, int, public.credit_tx_type, text, uuid, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function public.newsletter_upsert_contact(text, text, text, text, text, boolean, text, text, uuid, text[], timestamptz)
  from public, anon, authenticated;
revoke all on function public.newsletter_resubscribe(uuid, text) from public, anon, authenticated;
grant execute on function public.newsletter_resubscribe(uuid, text) to anon, authenticated;
revoke all on function public.waitlist_subscribe(text, text, text, jsonb) from public;
grant execute on function public.waitlist_subscribe(text, text, text, jsonb) to anon, authenticated;

create trigger newsletter_contacts_touch before update on public.newsletter_contacts
  for each row execute function public.touch_updated_at();

-- 0110's app_settings policies; the newsletter's admin-only policies
create policy "settings_admin_write" on public.app_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "settings_select_public" on public.app_settings for select to anon, authenticated
  using (not public.app_setting_is_private(key));
create policy newsletter_contacts_admin on public.newsletter_contacts for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy newsletter_contact_sources_admin on public.newsletter_contact_sources to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy newsletter_groups_admin on public.newsletter_groups for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy waitlist_admin_all on public.waitlist_subscribers for all
  using (public.is_admin()) with check (public.is_admin());

insert into public.app_settings (key, value) values
  ('notifications', jsonb_build_object('dispatch_hash', encode(extensions.digest('prelaunch-test-dispatch-token', 'sha256'), 'hex'))),
  ('billing', '{"currency":"PLN"}'),
  ('user_defaults', '{"welcome_credits":25}');
insert into public.newsletter_sources (key, name) values
  ('waitlist', 'LP'), ('account', 'Konto'), ('form', 'Formularz'), ('import', 'Import'), ('manual', 'Ręcznie');
insert into public.newsletter_groups (key, name, description) values ('main', 'Newsletter główny', 'x');
SQL

  q >/dev/null <<'SQL'
set client_min_messages = warning;
-- Helpers name 0144's functions, which do not exist yet.
set check_function_bodies = off;
-- ── the scoreboard and its helpers ──────────────────────────────────────
-- Every reader is VOLATILE on purpose: a stable function sees the snapshot of
-- the statement that calls it, i.e. NOT what a call earlier in the same
-- statement just wrote. The tests still store each write's answer first
-- (t_set) and assert in a separate statement.
create table public.test_results (name text, ok boolean, detail text, seq serial);
create table public.t_vars (name text primary key, v text);
create function public.t_var(p_name text) returns text language plpgsql volatile as $$
declare v text; begin execute 'select v from public.t_vars where name = $1' into v using p_name; return v; end $$;
create function public.t_set(p_name text, p_v text) returns void language sql as $$
  insert into public.t_vars values (p_name, p_v) on conflict (name) do update set v = excluded.v $$;
create function public.t_tok() returns text language sql immutable as $$ select 'prelaunch-test-dispatch-token'::text $$;
create function public.t_sha(p text) returns text language sql immutable as $$ select encode(extensions.digest(p, 'sha256'), 'hex') $$;
create function public.t_ip(p text) returns text language sql immutable as $$ select public.t_sha('ip:' || p) $$;

-- people: a uuid per name, kept in t_vars
create function public.t_uid(p_who text) returns uuid language plpgsql volatile as $$
begin return nullif(public.t_var('uid:' || p_who), '')::uuid; end $$;
create function public.t_be(p_who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claims', case
    when p_who = 'anon' then '{"role":"anon"}'
    when public.t_uid(p_who) is not null
      then json_build_object('sub', public.t_uid(p_who), 'role', 'authenticated')::text
    else '' end, false);
end $$;
-- An account: auth user + profile + workspace + wallet, optionally born with
-- a signup-like bonus (source 'signup' or 'bootstrap_recovery'), the way
-- handle_new_user / bootstrap_current_user grant it.
create function public.t_user(p_who text, p_email text, p_verified boolean default true,
  p_created timestamptz default now(), p_wallet boolean default true, p_bonus int default 25,
  p_bonus_source text default 'signup', p_role text default 'user') returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid(); v_ws uuid; v_wallet uuid;
begin
  perform public.t_set('uid:' || p_who, v_id::text);
  insert into auth.users (id, email, email_confirmed_at, created_at)
    values (v_id, p_email, case when p_verified then now() end, p_created);
  insert into public.profiles (id, email, role) values (v_id, p_email, p_role);
  if p_wallet then
    insert into public.workspaces (owner_id) values (v_id) returning id into v_ws;
    insert into public.credit_wallets (workspace_id) values (v_ws) returning id into v_wallet;
    if p_bonus > 0 then
      perform public.apply_credit_transaction(v_wallet, p_bonus, 'bonus', 'Welcome bonus', null,
        jsonb_build_object('source', p_bonus_source), v_id);
    end if;
  end if;
  return v_id;
end $$;
create function public.t_wallet(p_who text) returns uuid language plpgsql volatile as $$
declare v uuid; begin
  execute 'select w.id from public.credit_wallets w join public.workspaces ws on ws.id = w.workspace_id
            where ws.owner_id = public.t_uid($1) order by ws.created_at limit 1' into v using p_who;
  return v; end $$;
create function public.t_balance(p_who text) returns int language plpgsql volatile as $$
declare v int; begin
  execute 'select balance from public.credit_wallets where id = public.t_wallet($1)' into v using p_who;
  return v; end $$;
create function public.t_claims(p_who text, p_kind text) returns int language plpgsql volatile as $$
declare v int; begin
  execute 'select count(*) from public.prelaunch_reward_claims where user_id = public.t_uid($1) and kind = $2'
    into v using p_who, p_kind;
  return v; end $$;
create function public.t_n(p_sql text) returns bigint language plpgsql volatile as $$
declare v bigint; begin execute p_sql into v; return v; end $$;
create function public.t_cfg(p_patch jsonb) returns void language sql as $$
  update public.app_settings set value = value || p_patch where key = 'prelaunch' $$;

-- The route's calls, as the current role. p_label names the raw DOI token
-- and the raw answer handle of the call (their sha256 is what is stored).
create function public.t_consents(p_marketing boolean default true) returns jsonb language sql immutable as $$
  select jsonb_build_array(jsonb_build_object('key', 'terms_privacy', 'version', 'terms_privacy@aaaaaaaaaaaa',
           'text', 'Akceptuję Regulamin i Politykę prywatności.'))
      || case when p_marketing then jsonb_build_array(jsonb_build_object('key', 'marketing_email',
           'version', 'marketing_email@bbbbbbbbbbbb',
           'text', 'Chcę otrzymywać e-mailem informacje o premierze i ofertach GrovBase.')) else '[]'::jsonb end $$;
create function public.t_submit(p_label text, p_email text, p_ip text default null, p_ref text default null,
  p_first text default null, p_attr jsonb default null, p_form text default 'hero', p_locale text default 'pl',
  p_consents jsonb default null) returns jsonb language sql as $$
  select public.prelaunch_signup(public.t_tok(), p_email, p_first, p_locale, p_form,
    coalesce(p_consents, public.t_consents()),
    '{"regulamin":"2026-09-01T10:00:00Z","polityka_prywatnosci":"2026-09-02T10:00:00Z"}'::jsonb,
    p_attr, p_ref, case when p_ip is not null then public.t_ip(p_ip) end,
    public.t_sha('doi:' || p_label), public.t_sha('ans:' || p_label)) $$;
create function public.t_confirm(p_label text) returns jsonb language sql as $$
  select public.prelaunch_confirm(public.t_tok(), public.t_sha('doi:' || p_label)) $$;
create function public.t_resend(p_label text, p_email text, p_ip text default null) returns jsonb language sql as $$
  select public.prelaunch_resend(public.t_tok(), p_email, null,
    case when p_ip is not null then public.t_ip(p_ip) end, public.t_sha('doi:' || p_label)) $$;
create function public.t_resend_link(p_label text, p_old_label text) returns jsonb language sql as $$
  select public.prelaunch_resend(public.t_tok(), null, public.t_sha('doi:' || p_old_label), null,
    public.t_sha('doi:' || p_label)) $$;
create function public.t_channel(p_label text, p_channel text) returns text language sql as $$
  select public.prelaunch_set_channel(public.t_tok(), public.t_sha('ans:' || p_label), p_channel) $$;
-- Reads as the owner (RLS bypassed): what is really stored.
create function public.t_s(p_email text) returns jsonb language plpgsql volatile as $$
declare v jsonb; begin
  execute 'select to_jsonb(s) from public.prelaunch_signups s where lower(email) = lower($1)' into v using p_email;
  return v; end $$;
create function public.t_c(p_email text) returns jsonb language plpgsql volatile as $$
declare v jsonb; begin
  execute 'select to_jsonb(c) from public.newsletter_contacts c where email = lower($1)' into v using p_email;
  return v; end $$;
create function public.t_tokens(p_email text) returns int language plpgsql volatile as $$
declare v int; begin
  execute 'select count(*) from public.prelaunch_optin_tokens t join public.prelaunch_signups s on s.id = t.signup_id
            where lower(s.email) = lower($1)' into v using p_email;
  return v; end $$;
create function public.t_sets(p_email text) returns int language plpgsql volatile as $$
declare v int; begin
  execute 'select count(distinct consent_set) from public.prelaunch_consents c join public.prelaunch_signups s on s.id = c.signup_id
            where lower(s.email) = lower($1)' into v using p_email;
  return v; end $$;
-- Make the per-address throttles think time has passed.
create function public.t_age(p_email text, p_seconds int) returns void language plpgsql as $$
begin
  execute 'update public.prelaunch_signups set last_sent_at = last_sent_at - make_interval(secs => $2),
             sends_window_at = sends_window_at - make_interval(secs => $2),
             last_submit_at = last_submit_at - make_interval(secs => $2) where lower(email) = lower($1)'
    using p_email, p_seconds;
  -- The address's links age with it: the per-mailbox limits read token times.
  execute 'update public.prelaunch_optin_tokens set created_at = created_at - make_interval(secs => $2),
             expires_at = expires_at - make_interval(secs => $2)
           where signup_id in (select id from public.prelaunch_signups where lower(email) = lower($1))'
    using p_email, p_seconds;
end $$;
-- A confirmed signup in one step.
create function public.t_confirmed(p_label text, p_email text, p_ip text default null, p_ref text default null,
  p_first text default null) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  r := public.t_submit(p_label, p_email, p_ip, p_ref, p_first);
  if not coalesce((r->>'send')::boolean, false) then raise exception 't_confirmed: no mail for % (%)', p_email, r; end if;
  r := public.t_confirm(p_label);
  if r->>'status' <> 'confirmed' then raise exception 't_confirmed: % -> %', p_email, r; end if;
  return r;
end $$;
-- The customer's own render: their session, the authenticated role.
create function public.t_ensure(p_who text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform public.t_be(p_who);
  execute 'set local role authenticated';
  r := public.prelaunch_reward_ensure();
  execute 'reset role';
  return r;
end $$;

create function public.t_raises(p_name text, p_role text, p_sql text, p_needle text)
returns void language plpgsql as $$
declare v_err text := null;
begin
  begin
    execute format('set local role %I', p_role);
    execute p_sql;
  exception when others then v_err := sqlerrm;
  end;
  execute 'reset role';
  insert into public.test_results(name, ok, detail)
    values (p_name, v_err is not null and v_err like '%' || p_needle || '%', coalesce(v_err, '(no error raised)'));
end $$;
create function public.t_true(p_name text, p_role text, p_sql text)
returns void language plpgsql as $$
declare v_ok boolean := null; v_err text := null;
begin
  begin
    execute format('set local role %I', p_role);
    execute p_sql into v_ok;
  exception when others then v_err := sqlerrm;
  end;
  execute 'reset role';
  insert into public.test_results(name, ok, detail)
    values (p_name, coalesce(v_ok, false), coalesce(v_err, 'got ' || coalesce(v_ok::text, 'null')));
end $$;
create function public.t_eq(p_name text, p_role text, p_sql text, p_want text)
returns void language plpgsql as $$
declare v_got text := null; v_err text := null;
begin
  begin
    execute format('set local role %I', p_role);
    execute p_sql into v_got;
  exception when others then v_err := sqlerrm;
  end;
  execute 'reset role';
  insert into public.test_results(name, ok, detail)
    values (p_name, v_err is null and v_got is not distinct from p_want,
            coalesce('error: ' || v_err, 'got ' || coalesce(v_got, 'null') || ', want ' || coalesce(p_want, 'null')));
end $$;
create function public.t_runs(p_name text, p_role text, p_sql text)
returns void language plpgsql as $$
declare v_err text := null;
begin
  begin
    execute format('set local role %I', p_role);
    execute p_sql;
  exception when others then v_err := sqlerrm;
  end;
  execute 'reset role';
  insert into public.test_results(name, ok, detail) values (p_name, v_err is null, coalesce(v_err, 'ran'));
end $$;

-- Everything 0144 creates or redefines, as one digest.
create function public.t_schema_print() returns text language sql stable as $$
  select md5(concat_ws('#',
    (select string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc || '|' || pg_get_function_result(p.oid) || '|'
              || pg_get_function_arguments(p.oid) || '|' || coalesce(p.proacl::text, '') || '|' || p.prosecdef::text
              || '|' || p.provolatile::text || '|' || coalesce(array_to_string(p.proconfig, ','), '')),
            ',' order by p.oid::regprocedure::text)
       from pg_proc p where p.pronamespace = 'public'::regnamespace
        and (p.proname like 'prelaunch\_%' or p.proname in ('waitlist_subscribe', 'app_setting_is_private'))),
    (select string_agg(table_name || '.' || column_name || ':' || data_type || ':' || coalesce(column_default, '')
              || ':' || is_nullable, ',' order by table_name, column_name)
       from information_schema.columns where table_schema = 'public'
        and (table_name like 'prelaunch\_%' or table_name = 'newsletter_contact_sources')),
    (select string_agg(indexname || ':' || indexdef, ',' order by indexname) from pg_indexes
      where schemaname = 'public' and (tablename like 'prelaunch\_%' or tablename in ('cms_blocks', 'newsletter_contact_sources'))),
    (select string_agg(conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid), ','
              order by conrelid::regclass::text, conname) from pg_constraint
      where connamespace = 'public'::regnamespace
        and (conrelid::regclass::text like 'prelaunch\_%' or conrelid::regclass::text = 'newsletter_contact_sources')),
    (select string_agg(tablename || '.' || policyname || ':' || cmd || ':' || roles::text || ':' || coalesce(qual, ''), ','
              order by tablename, policyname) from pg_policies where schemaname = 'public'),
    (select string_agg(c.relname || ':' || coalesce(c.relacl::text, '') || ':' || c.relrowsecurity::text, ','
              order by c.relname) from pg_class c
      where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and c.relname like 'prelaunch\_%')))
$$;
create function public.t_data_print() returns text language plpgsql volatile as $$
declare v text;
begin
  execute $q$ select md5(
      (select coalesce(string_agg(t::text, '|' order by t.id), '') from public.prelaunch_signups t) || '#' ||
      (select coalesce(string_agg(t::text, '|' order by t.id), '') from public.prelaunch_optin_tokens t) || '#' ||
      (select coalesce(string_agg(t::text, '|' order by t.id), '') from public.prelaunch_consents t) || '#' ||
      (select coalesce(string_agg(t::text, '|' order by t.id), '') from public.prelaunch_reward_claims t) || '#' ||
      (select value::text from public.app_settings where key = 'prelaunch') || '#' ||
      (select coalesce(string_agg(t::text, '|' order by t.key), '') from public.newsletter_groups t) || '#' ||
      (select coalesce(string_agg(t::text, '|' order by t.contact_id, t.source_key), '') from public.newsletter_contact_sources t) || '#' ||
      (select coalesce(string_agg(t::text, '|' order by t.id), '') from public.newsletter_contacts t) || '#' ||
      (select coalesce(string_agg(t::text, '|' order by t.id), '') from public.credit_transactions t)) $q$ into v;
  return v;
end $$;
SQL
}

# ── R. THE REHEARSAL IS WHAT IT CLAIMS TO BE (before 0144) ─────────────────
rehearsal_checks() {
  q >/dev/null <<'SQL'
select public.t_user('admin', 'admin@grovbase.test', p_role := 'admin');
select public.t_user('customer', 'customer@example.com');
select public.t_true('R1  pgcrypto lives in schema extensions, NOT public (a search_path without extensions cannot see gen_random_bytes)', 'postgres', $q$
  select to_regproc('public.gen_random_bytes') is null and to_regproc('extensions.gen_random_bytes') is not null $q$);
select public.t_be('anon');
select public.t_eq('R2  BEFORE 0144, anon waitlist_subscribe with consent:true … (the S1 hole, seen open)', 'anon',
  $q$ select (public.waitlist_subscribe('hole@example.com', 'hero', 'pl', '{"consent":true}'::jsonb))->>'status' $q$, 'created');
select public.t_eq('R2b … grants MARKETING consent to an address nobody confirmed', 'postgres',
  $q$ select marketing_consent::text from public.newsletter_contacts where email = 'hole@example.com' $q$, 'true');
select public.t_true('R3  BEFORE 0144, app_setting_is_private does not know the key prelaunch', 'postgres', $q$
  select not public.app_setting_is_private('prelaunch') and public.app_setting_is_private('trial_watermark') $q$);
insert into public.t_vars values ('private_acl_before',
  (select coalesce(proacl::text, '') from pg_proc where oid = 'public.app_setting_is_private(text)'::regprocedure));
insert into public.t_vars values ('waitlist_src_before',
  (select prosrc from pg_proc where oid = 'public.waitlist_subscribe(text,text,text,jsonb)'::regprocedure));
-- A legacy-consented contact (source waitlist, version v1) and one consented
-- through the CMS form, for the D3 checks later.
insert into public.newsletter_contacts (email, source_key, marketing_consent, consent_at, consent_source, consent_version)
values ('legacy@example.com', 'waitlist', true, now() - interval '30 days', 'waitlist', 'v1'),
       ('formfan@example.com', 'form', true, now() - interval '30 days', 'cms_form', 'form-v1');
SQL
}

# ── M. APPLY THE REAL FILE — AND AGAIN ──────────────────────────────────────
apply_checks() {
  local mig="$1"
  if grep -qiE 'drop|delete' "$mig"; then
    record 'M0  the file contains neither forbidden word (drop / delete, any case, comments included)' false \
      "$(grep -niE 'drop|delete' "$mig" | head -3 | tr '\n' ' ')"
  else
    record 'M0  the file contains neither forbidden word (drop / delete, any case, comments included)' true ''
  fi
  if apply_migration "$mig"; then
    record 'M1  0144 applies to the pre-0144 schema in one transaction' true ''
  else
    record 'M1  0144 applies to the pre-0144 schema in one transaction' false "$(tr '\n' ' ' < "$ERR")"
    SUITE_ABORTED=1
    return 0
  fi
  q -c "insert into public.t_vars values ('schema_after_1', public.t_schema_print()), ('data_after_1', public.t_data_print())" >/dev/null
  if apply_migration "$mig"; then
    record 'M2  and applies again on top of itself (re-runnable)' true ''
  else
    record 'M2  and applies again on top of itself (re-runnable)' false "$(tr '\n' ' ' < "$ERR")"
  fi
  q >/dev/null <<'SQL'
select public.t_true('M3  the second apply changed nothing: functions (body, ACL, definer, search_path), columns, indexes, constraints, policies, table ACLs', 'postgres', $q$
  select public.t_schema_print() = public.t_var('schema_after_1') $q$);
select public.t_true('M4  … and no data: the settings row, the groups, contacts and sources are as the first apply left them', 'postgres', $q$
  select public.t_data_print() = public.t_var('data_after_1') $q$);
select public.t_true('M5  25 prelaunch_* functions: the 11 entry points are SECURITY DEFINER, the 14 helpers are not; every one pins search_path = public, extensions', 'postgres', $q$
  select count(*) = 25
     and bool_and(p.prosecdef = (p.proname in ('prelaunch_public_config', 'prelaunch_signup', 'prelaunch_resend',
           'prelaunch_confirm', 'prelaunch_set_channel', 'prelaunch_mail_payload', 'prelaunch_mark_sent',
           'prelaunch_reward_ensure', 'prelaunch_forget_contact', 'prelaunch_admin_summary', 'prelaunch_admin_contact')))
     and bool_and(array_to_string(p.proconfig, ',') = 'search_path=public, extensions')
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname like 'prelaunch\_%' $q$);
select public.t_true('M6  app_settings.prelaunch seeded dormant with every key of the contract (nothing approved, rewards off)', 'postgres', $q$
  select value = '{"v":1,"launch_at":null,"launch_at_approved":false,"signup_credits":null,"signup_credits_approved":false,
                   "referral_credits":null,"referral_credits_approved":false,"referral_cap":10,"early_access_hours":null,
                   "early_access_approved":false,"standard_credits":null,"standard_credits_approved":false,
                   "price_lock_approved":false,"rewards_active":false,"reward_claim_until":null,"optin_ttl_hours":72,
                   "optin_hourly_cap":300,"marketing_required":true,"referral_requires_account":true,
                   "survey_bonus_policy":"stack","campaign":"prelaunch-2026"}'::jsonb
    from public.app_settings where key = 'prelaunch' $q$);
select public.t_true('M7  app_setting_is_private: 0143''s six keys + prelaunch; nothing else became private; its ACL unchanged', 'postgres', $q$
  select public.app_setting_is_private('notifications') and public.app_setting_is_private('login_security_dispatch')
     and public.app_setting_is_private('auth_email_hook') and public.app_setting_is_private('ai_background_presets')
     and public.app_setting_is_private('thumbnail') and public.app_setting_is_private('trial_watermark')
     and public.app_setting_is_private('prelaunch')
     and not public.app_setting_is_private('billing') and not public.app_setting_is_private('user_defaults')
     and (select coalesce(proacl::text, '') from pg_proc where oid = 'public.app_setting_is_private(text)'::regprocedure)
         = public.t_var('private_acl_before') $q$);
select public.t_true('M8  RLS on for the four tables; policies exactly: admin SELECT on each + owner SELECT on claims, all TO authenticated', 'postgres', $q$
  select (select bool_and(relrowsecurity) from pg_class where oid in ('public.prelaunch_signups'::regclass,
            'public.prelaunch_optin_tokens'::regclass, 'public.prelaunch_consents'::regclass, 'public.prelaunch_reward_claims'::regclass,
            'public.prelaunch_referral_aliases'::regclass))
     and (select array_agg(tablename || ':' || policyname || ':' || cmd || ':' || roles::text order by tablename, policyname)
            from pg_policies where schemaname = 'public' and tablename like 'prelaunch\_%')
         = array['prelaunch_consents:prelaunch_consents_admin_select:SELECT:{authenticated}',
                 'prelaunch_optin_tokens:prelaunch_optin_tokens_admin_select:SELECT:{authenticated}',
                 'prelaunch_reward_claims:prelaunch_reward_claims_admin_select:SELECT:{authenticated}',
                 'prelaunch_reward_claims:prelaunch_reward_claims_owner_select:SELECT:{authenticated}',
                 'prelaunch_signups:prelaunch_signups_admin_select:SELECT:{authenticated}'] $q$);
select public.t_true('M9  table privileges: anon nothing; authenticated SELECT only (no insert/update on any of the four)', 'postgres', $q$
  select (select bool_and(not has_table_privilege('anon', t, 'select') and not has_table_privilege('anon', t, 'insert')
                  and has_table_privilege('authenticated', t, 'select') and not has_table_privilege('authenticated', t, 'insert')
                  and not has_table_privilege('authenticated', t, 'update'))
    from unnest(array['public.prelaunch_signups', 'public.prelaunch_optin_tokens', 'public.prelaunch_consents',
                      'public.prelaunch_reward_claims']) t)
     and not has_table_privilege('anon', 'public.prelaunch_referral_aliases', 'select')
     and not has_table_privilege('authenticated', 'public.prelaunch_referral_aliases', 'select')
     and not has_table_privilege('authenticated', 'public.prelaunch_referral_aliases', 'insert') $q$);
select public.t_true('M10 newsletter group prelaunch exists, static (membership only through the DOI)', 'postgres', $q$
  select is_dynamic = false from public.newsletter_groups where key = 'prelaunch' $q$);
select public.t_eq('M11 newsletter_contact_sources gained the 9 attribution columns', 'postgres', $q$
  select string_agg(column_name, ',' order by column_name) from information_schema.columns
   where table_schema = 'public' and table_name = 'newsletter_contact_sources'
     and column_name in ('utm_source','utm_medium','utm_campaign','utm_content','utm_term','referrer_host',
                         'landing_path','form_variant','attributed_at') $q$,
  'attributed_at,form_variant,landing_path,referrer_host,utm_campaign,utm_content,utm_medium,utm_source,utm_term');
select public.t_true('M12 waitlist_subscribe: same signature; consent never granted, no name to the contact, the strict address check, one answer for new and known, never a welcome', 'postgres', $q$
  select src like '%p_consent := false,%' and src not like '%p_first_name%' and src not like '%p_last_name%'
     and src like '%prelaunch_email_ok(v_email)%' and src not like '%''exists''%'
     and src like '%''status'', ''created'', ''confirmation'', false%'
     and public.t_var('waitlist_src_before') like '%p_consent := v_consent,%'
    from (select prosrc as src from pg_proc where oid = 'public.waitlist_subscribe(text,text,text,jsonb)'::regprocedure) x $q$);
SQL
}

# ── G. GRANTS, PER FUNCTION (S18) ───────────────────────────────────────────
grant_checks() {
  q >/dev/null <<'SQL'
create function pg_temp.can(p_role text, p_fn text) returns boolean language sql as $$
  select has_function_privilege(p_role, p_fn::regprocedure, 'execute') $$;
select public.t_true('G1  prelaunch_public_config: anon and authenticated may execute, PUBLIC may not', 'postgres', $q$
  select pg_temp.can('anon', 'public.prelaunch_public_config()') and pg_temp.can('authenticated', 'public.prelaunch_public_config()')
     and not pg_temp.can('public', 'public.prelaunch_public_config()') $q$);
select public.t_true('G2  the six server-token-gated functions: anon + authenticated (EXECUTE precedes the gate), not PUBLIC', 'postgres', $q$
  select bool_and(pg_temp.can('anon', f) and pg_temp.can('authenticated', f) and not pg_temp.can('public', f))
    from unnest(array['public.prelaunch_signup(text,text,text,text,text,jsonb,jsonb,jsonb,text,text,text,text)',
                      'public.prelaunch_resend(text,text,text,text,text)', 'public.prelaunch_confirm(text,text)',
                      'public.prelaunch_set_channel(text,text,text)', 'public.prelaunch_mail_payload(text)',
                      'public.prelaunch_mark_sent(text,uuid,boolean)']) f $q$);
select public.t_true('G3  prelaunch_reward_ensure: authenticated only', 'postgres', $q$
  select pg_temp.can('authenticated', 'public.prelaunch_reward_ensure()') and not pg_temp.can('anon', 'public.prelaunch_reward_ensure()')
     and not pg_temp.can('public', 'public.prelaunch_reward_ensure()') $q$);
select public.t_true('G4  the three admin functions: authenticated only (is_admin() inside)', 'postgres', $q$
  select bool_and(pg_temp.can('authenticated', f) and not pg_temp.can('anon', f) and not pg_temp.can('public', f))
    from unnest(array['public.prelaunch_forget_contact(uuid)', 'public.prelaunch_admin_summary(timestamptz,timestamptz)',
                      'public.prelaunch_admin_contact(uuid)']) f $q$);
select public.t_true('G5  the 11 helpers: nobody (not PUBLIC, not anon, not authenticated)', 'postgres', $q$
  select count(*) = 11 and bool_and(not has_function_privilege('anon', p.oid, 'execute')
           and not has_function_privilege('authenticated', p.oid, 'execute')
           and not has_function_privilege('public', p.oid, 'execute'))
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('prelaunch_cfg_int', 'prelaunch_cfg_instant',
      'prelaunch_config', 'prelaunch_canonical_email', 'prelaunch_new_code', 'prelaunch_first_name', 'prelaunch_attr',
      'prelaunch_consent_ok', 'prelaunch_ip_busy', 'prelaunch_send_block', 'prelaunch_issue_token') $q$);
select public.t_true('G6  waitlist_subscribe keeps anon + authenticated; server_call_ok and apply_credit_transaction stay unreachable', 'postgres', $q$
  select pg_temp.can('anon', 'public.waitlist_subscribe(text,text,text,jsonb)')
     and pg_temp.can('authenticated', 'public.waitlist_subscribe(text,text,text,jsonb)')
     and not pg_temp.can('public', 'public.waitlist_subscribe(text,text,text,jsonb)')
     and not pg_temp.can('anon', 'public.server_call_ok(text)')
     and not pg_temp.can('authenticated', 'public.apply_credit_transaction(uuid,int,public.credit_tx_type,text,uuid,jsonb,uuid)') $q$);
SQL
}

# ── A. THE GATES, AS THE CALLERS THEY STOP ──────────────────────────────────
gate_checks() {
  q >/dev/null <<'SQL'
select public.t_be('anon');
select public.t_raises('A1  anon prelaunch_signup WITHOUT the server token → forbidden', 'anon',
  $q$ select public.prelaunch_signup(null, 'a1@example.com', null, 'pl', 'hero', public.t_consents(), null, null, null, null,
       public.t_sha('x'), null) $q$, 'forbidden');
select public.t_raises('A2  anon prelaunch_signup with a WRONG token → forbidden', 'anon',
  $q$ select public.prelaunch_signup('guess', 'a1@example.com', null, 'pl', 'hero', public.t_consents(), null, null, null, null,
       public.t_sha('x'), null) $q$, 'forbidden');
select public.t_raises('A3  anon prelaunch_resend without the token → forbidden', 'anon',
  $q$ select public.prelaunch_resend('', 'a1@example.com', null, null, public.t_sha('x')) $q$, 'forbidden');
select public.t_raises('A4  anon prelaunch_confirm without the token → forbidden', 'anon',
  $q$ select public.prelaunch_confirm('', public.t_sha('x')) $q$, 'forbidden');
select public.t_raises('A5  anon prelaunch_set_channel without the token → forbidden', 'anon',
  $q$ select public.prelaunch_set_channel('', public.t_sha('x'), 'allegro') $q$, 'forbidden');
select public.t_raises('A6  anon prelaunch_mark_sent without the token → forbidden', 'anon',
  $q$ select public.prelaunch_mark_sent('', gen_random_uuid(), true) $q$, 'forbidden');
select public.t_raises('A7  anon prelaunch_mail_payload without the token → forbidden (the SMTP payload)', 'anon',
  $q$ select public.prelaunch_mail_payload('nope') $q$, 'forbidden');
select public.t_raises('A8  anon prelaunch_reward_ensure → permission denied (no EXECUTE)', 'anon',
  $q$ select public.prelaunch_reward_ensure() $q$, 'permission denied');
select public.t_raises('A9  anon prelaunch_admin_summary → permission denied', 'anon',
  $q$ select public.prelaunch_admin_summary(now() - interval '1 day', now()) $q$, 'permission denied');
select public.t_raises('A10 anon calling a helper directly (prelaunch_new_code) → permission denied', 'anon',
  $q$ select public.prelaunch_new_code() $q$, 'permission denied');
select public.t_raises('A11 anon reading prelaunch_signups → permission denied', 'anon',
  $q$ select count(*) from public.prelaunch_signups $q$, 'permission denied');
select public.t_eq('A12 anon reading app_settings sees NO prelaunch row (private)', 'anon',
  $q$ select count(*)::text from public.app_settings where key = 'prelaunch' $q$, '0');
select public.t_be('customer');
select public.t_eq('A13 a customer reading app_settings sees NO prelaunch row (private)', 'authenticated',
  $q$ select count(*)::text from public.app_settings where key = 'prelaunch' $q$, '0');
select public.t_raises('A14 a customer calling prelaunch_admin_summary → forbidden', 'authenticated',
  $q$ select public.prelaunch_admin_summary(now() - interval '1 day', now()) $q$, 'forbidden');
select public.t_raises('A15 a customer calling prelaunch_forget_contact → forbidden', 'authenticated',
  $q$ select public.prelaunch_forget_contact(gen_random_uuid()) $q$, 'forbidden');
select public.t_raises('A16 a customer calling prelaunch_admin_contact → forbidden', 'authenticated',
  $q$ select public.prelaunch_admin_contact(gen_random_uuid()) $q$, 'forbidden');
select public.t_raises('A17 a customer calling prelaunch_mail_payload without the token → forbidden', 'authenticated',
  $q$ select public.prelaunch_mail_payload(null) $q$, 'forbidden');
select public.t_raises('A18 a customer inserting a signup row directly → permission denied', 'authenticated',
  $q$ insert into public.prelaunch_signups (email, referral_code, canonical_email) values ('x@example.com', 'ABCDEFGH', 'x@example.com') $q$,
  'permission denied');
select public.t_raises('A19 a customer inserting a reward claim directly → permission denied', 'authenticated',
  $q$ insert into public.prelaunch_reward_claims (user_id, kind, source_signup, campaign) values (auth.uid(), 'signup', gen_random_uuid(), 'x') $q$,
  'permission denied');
select public.t_be('admin');
select public.t_eq('A20 an admin reads the private prelaunch row (settings_admin_write)', 'authenticated',
  $q$ select count(*)::text from public.app_settings where key = 'prelaunch' $q$, '1');
select public.t_eq('A21 an admin may read the mail payload without the token (settings screen) — null: no SMTP host yet', 'authenticated',
  $q$ select coalesce(public.prelaunch_mail_payload(null)::text, 'null') $q$, 'null');
SQL
}

# ── C. PUBLIC CONFIG: APPROVED VALUES ONLY ──────────────────────────────────
config_checks() {
  q >/dev/null <<'SQL'
select public.t_be('anon');
select public.t_eq('C1  seeded: nothing approved → every value null / false, ttl 72', 'anon',
  $q$ select public.prelaunch_public_config()::text $q$,
  '{"launch_at": null, "price_lock": false, "rewards_active": false, "signup_credits": null, "optin_ttl_hours": 72, "referral_credits": null, "standard_credits": null, "early_access_hours": null}');
select public.t_cfg('{"signup_credits":100}');
select public.t_eq('C2  a value without its approval stays hidden', 'anon',
  $q$ select coalesce(public.prelaunch_public_config()->>'signup_credits', 'null') $q$, 'null');
select public.t_cfg('{"signup_credits_approved":true}');
select public.t_eq('C3  approved and in range → shown', 'anon', $q$ select public.prelaunch_public_config()->>'signup_credits' $q$, '100');
select public.t_cfg('{"signup_credits":1000000}');
select public.t_eq('C4  approved but out of range (> 10000) → treated as not approved', 'anon',
  $q$ select coalesce(public.prelaunch_public_config()->>'signup_credits', 'null') $q$, 'null');
select public.t_cfg('{"signup_credits":"100"}');
select public.t_eq('C5  a string "100" is not a number → not approved', 'anon',
  $q$ select coalesce(public.prelaunch_public_config()->>'signup_credits', 'null') $q$, 'null');
select public.t_cfg('{"signup_credits":12.5}');
select public.t_eq('C6  a fraction is not a credit amount → not approved', 'anon',
  $q$ select coalesce(public.prelaunch_public_config()->>'signup_credits', 'null') $q$, 'null');
select public.t_cfg('{"signup_credits":null,"signup_credits_approved":false}');
select public.t_cfg(jsonb_build_object('launch_at', to_char((now() + interval '30 days') at time zone 'Europe/Warsaw', 'YYYY-MM-DD"T"HH24:MI:SS') || '+01:00'));
select public.t_eq('C7  a future launch date without approval → null', 'anon',
  $q$ select coalesce(public.prelaunch_public_config()->>'launch_at', 'null') $q$, 'null');
select public.t_cfg('{"launch_at_approved":true}');
select public.t_true('C8  approved and ahead → an ISO instant in UTC (…Z) that parses back to the same moment', 'anon', $q$
  select (public.prelaunch_public_config()->>'launch_at') ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$'
     and abs(extract(epoch from (public.prelaunch_public_config()->>'launch_at')::timestamptz - (now() + interval '30 days'))) < 7200 $q$);
select public.t_cfg('{"launch_at":"2020-01-01T10:00:00+01:00"}');
select public.t_eq('C9  approved but in the past → null (no "Startujemy" with a date gone by, D9)', 'anon',
  $q$ select coalesce(public.prelaunch_public_config()->>'launch_at', 'null') $q$, 'null');
select public.t_cfg('{"launch_at":"next friday"}');
select public.t_eq('C10 a malformed date → null, and the function does not raise', 'anon',
  $q$ select coalesce(public.prelaunch_public_config()->>'launch_at', 'null') $q$, 'null');
select public.t_cfg('{"launch_at":"2099-01-01T10:00:00"}');
select public.t_eq('C11 a date without an offset is ambiguous → null', 'anon',
  $q$ select coalesce(public.prelaunch_public_config()->>'launch_at', 'null') $q$, 'null');
select public.t_cfg('{"launch_at":null,"launch_at_approved":false,"standard_credits":25}');
select public.t_eq('C12 the "standard" comparison figure is shown only when the owner approved it (D2)', 'anon',
  $q$ select coalesce(public.prelaunch_public_config()->>'standard_credits', 'null') $q$, 'null');
select public.t_cfg('{"standard_credits_approved":true}');
select public.t_eq('C13 … and then it is', 'anon', $q$ select public.prelaunch_public_config()->>'standard_credits' $q$, '25');
select public.t_cfg('{"early_access_hours":24,"early_access_approved":true}');
select public.t_eq('C14 early-access hours approved in range → 24 (the page still ignores it while unsupported)', 'anon',
  $q$ select public.prelaunch_public_config()->>'early_access_hours' $q$, '24');
select public.t_cfg('{"early_access_hours":1000}');
select public.t_eq('C15 early-access hours out of range (> 720) → null', 'anon',
  $q$ select coalesce(public.prelaunch_public_config()->>'early_access_hours', 'null') $q$, 'null');
select public.t_cfg('{"price_lock_approved":"yes"}');
select public.t_eq('C16 price_lock is true only for JSON true ("yes" is not)', 'anon',
  $q$ select public.prelaunch_public_config()->>'price_lock' $q$, 'false');
select public.t_cfg('{"price_lock_approved":true,"rewards_active":true}');
select public.t_eq('C17 price_lock and rewards_active true when approved', 'anon',
  $q$ select (public.prelaunch_public_config()->>'price_lock') || ',' || (public.prelaunch_public_config()->>'rewards_active') $q$, 'true,true');
-- back to dormant for the flows below
select public.t_cfg('{"price_lock_approved":false,"rewards_active":false,"standard_credits":null,"standard_credits_approved":false,"early_access_hours":null,"early_access_approved":false}');
select public.t_true('C18 the helpers: a code is 8 chars of the unambiguous alphabet; canonical addresses fold aliases and Gmail dots', 'postgres', $q$
  select public.prelaunch_new_code() ~ '^[A-HJ-NP-Z2-9]{8}$'
     and (select count(distinct public.prelaunch_new_code()) from generate_series(1, 200)) = 200
     and public.prelaunch_canonical_email(' Jan.Kowalski+promo@GoogleMail.com ') = 'jankowalski@gmail.com'
     and public.prelaunch_canonical_email('j.k+x@firma.pl') = 'j.k@firma.pl' $q$);
select public.t_true('C19 first names: letters with Polish/German diacritics, space, apostrophe, hyphen, ≤ 40; anything else → null', 'postgres', $q$
  select public.prelaunch_first_name('  Zażółć  ') = 'Zażółć' and public.prelaunch_first_name('Jürgen-Ömer O''Neil') = 'Jürgen-Ömer O''Neil'
     and public.prelaunch_first_name('Łukasz') = 'Łukasz' and public.prelaunch_first_name('Anne   Marie') = 'Anne Marie'
     and public.prelaunch_first_name('Wygrałeś 500 zł → bit.ly/x') is null and public.prelaunch_first_name('<b>Jan') is null
     and public.prelaunch_first_name('Jan2') is null and public.prelaunch_first_name(repeat('a', 41)) is null
     and public.prelaunch_first_name(repeat('a', 40)) = repeat('a', 40) and public.prelaunch_first_name('-Jan') is null
     and public.prelaunch_first_name('') is null $q$);
SQL
}

# ── S. SUBMIT ───────────────────────────────────────────────────────────────
signup_checks() {
  q >/dev/null <<'SQL'
select public.t_be('anon');
select public.t_eq('S1  an invalid address → {status: invalid}', 'anon',
  $q$ select (public.t_submit('s1', 'not-an-email'))::text $q$, '{"status": "invalid"}');
select public.t_eq('S1b … and nothing was written for it', 'postgres',
  $q$ select count(*)::text from public.newsletter_contacts where email like 'not-an-email%' $q$, '0');
select public.t_eq('S2  marketing consent missing (required by default) → consent_required', 'anon',
  $q$ select public.t_submit('s2', 's2@example.com', p_consents := public.t_consents(false))->>'status' $q$, 'consent_required');
select public.t_eq('S3  terms consent missing → consent_required', 'anon',
  $q$ select public.t_submit('s3', 's3@example.com', p_consents := public.t_consents() - 0)->>'status' $q$, 'consent_required');
select public.t_eq('S4  a third, unknown consent object → consent_required', 'anon',
  $q$ select public.t_submit('s4', 's4@example.com', p_consents := public.t_consents()
       || '[{"key":"other","version":"v","text":"t"}]'::jsonb)->>'status' $q$, 'consent_required');
select public.t_eq('S5  an empty consent text → consent_required', 'anon',
  $q$ select public.t_submit('s5', 's5@example.com', p_consents := jsonb_set(public.t_consents(), '{0,text}', '"  "'))->>'status' $q$,
  'consent_required');
select public.t_eq('S6  a version longer than 64 → consent_required', 'anon',
  $q$ select public.t_submit('s6', 's6@example.com', p_consents := jsonb_set(public.t_consents(), '{1,version}',
       to_jsonb(repeat('v', 65))))->>'status' $q$, 'consent_required');
select public.t_eq('S7  the same key twice → consent_required', 'anon',
  $q$ select public.t_submit('s7', 's7@example.com', p_consents := jsonb_build_array(public.t_consents()->0, public.t_consents()->0))->>'status' $q$,
  'consent_required');
select public.t_eq('S7a consents sent as an object instead of an array → consent_required (no crash)', 'anon',
  $q$ select public.t_submit('s7a', 's7@example.com', p_consents := public.t_consents()->0)->>'status' $q$, 'consent_required');
select public.t_eq('S7b no contact was written for any refused submit', 'postgres',
  $q$ select count(*)::text from public.newsletter_contacts where email ~ '^s[2-7]@example\.com$' $q$, '0');
select public.t_raises('S8  a malformed DOI hash from the server is a bug, not a visitor → bad_request', 'anon',
  $q$ select public.prelaunch_signup(public.t_tok(), 's8@example.com', null, 'pl', 'hero', public.t_consents(), null, null,
       null, null, 'zz', null) $q$, 'bad_request');

-- the happy path
select public.t_set('s9', (public.t_submit('s9', 'Anna.Nowak+promo@Example.com ', 'net-anna', p_first := 'Anna',
  p_attr := '{"utm_source":"facebook","utm_medium":"cpc","utm_campaign":"launch","referrer_host":"m.facebook.com","landing_path":"/","evil":"x"}',
  p_locale := 'de', p_form := 'final'))::text);
select public.t_true('S9  new address: pending, created, send, an 8-char referral code, a token id, the normalised address back', 'postgres', $q$
  select r->>'status' = 'pending' and (r->>'created')::boolean and (r->>'send')::boolean
     and r->>'referral_code' ~ '^[A-HJ-NP-Z2-9]{8}$' and r->>'token_id' is not null and r->>'signup_id' is not null
     and r->>'email' = 'anna.nowak+promo@example.com' and r->>'locale' = 'de' and not (r->>'throttled')::boolean
    from (select public.t_var('s9')::jsonb as r) x $q$);
select public.t_true('S10 the signup row: pending, canonical address, the name kept HERE only, the form, both IP hashes, prior flags false', 'postgres', $q$
  select s->>'status' = 'pending' and s->>'canonical_email' = 'anna.nowak@example.com' and s->>'first_name' = 'Anna'
     and s->>'form_variant' = 'final' and s->>'ip_hash' = public.t_ip('net-anna') and s->>'last_ip_hash' = public.t_ip('net-anna')
     and not (s->>'prior_contact')::boolean and not (s->>'prior_account')::boolean and s->>'locale' = 'de'
     and (s->>'sends_24h')::int = 1 and s->>'answer_hash' = public.t_sha('ans:s9')
    from (select public.t_s('anna.nowak+promo@example.com') as s) x $q$);
select public.t_true('S11 the contact exists BARE: no name, no consent, not in the prelaunch group, source waitlist', 'postgres', $q$
  select c->>'first_name' is null and not (c->>'marketing_consent')::boolean and c->>'consent_source' is null
     and c->>'source_key' = 'waitlist' and c->>'locale' = 'de'
     and not exists (select 1 from public.newsletter_group_members m join public.newsletter_groups g on g.id = m.group_id
                      where g.key = 'prelaunch' and m.contact_id = (c->>'id')::uuid)
    from (select public.t_c('anna.nowak+promo@example.com') as c) x $q$);
select public.t_true('S12 one consent set of two rows: exact texts and versions, doc versions on the terms row only, the IP hash', 'postgres', $q$
  select count(*) = 2 and count(distinct c.consent_set) = 1
     and bool_and(c.confirmed_at is null and c.ip_hash = public.t_ip('net-anna') and c.locale = 'de' and c.form_variant = 'final')
     and max(c.consent_text) filter (where c.consent_key = 'marketing_email') = 'Chcę otrzymywać e-mailem informacje o premierze i ofertach GrovBase.'
     and max(c.consent_version) filter (where c.consent_key = 'terms_privacy') = 'terms_privacy@aaaaaaaaaaaa'
     and (max(c.doc_versions::text) filter (where c.consent_key = 'terms_privacy'))::jsonb
         = '{"regulamin":"2026-09-01T10:00:00Z","polityka_prywatnosci":"2026-09-02T10:00:00Z"}'::jsonb
     and bool_and(c.doc_versions is null) filter (where c.consent_key = 'marketing_email')
     and max(c.consent_set::text) = max(s.consent_set_id::text)
    from public.prelaunch_consents c join public.prelaunch_signups s on s.id = c.signup_id
   where s.email = 'anna.nowak+promo@example.com' $q$);
select public.t_true('S13 the token: the sha256 of the raw link token, origin signup, 72 h, unused, linked to that consent set', 'postgres', $q$
  select t.token_hash = public.t_sha('doi:s9') and t.origin = 'signup' and t.used_at is null
     and abs(extract(epoch from t.expires_at - t.created_at) - 72 * 3600) < 5 and t.consent_set = s.consent_set_id
     and t.ip_hash = public.t_ip('net-anna') and t.locale = 'de' and t.form_variant = 'final'
    from public.prelaunch_optin_tokens t join public.prelaunch_signups s on s.id = t.signup_id
   where s.email = 'anna.nowak+promo@example.com' $q$);
select public.t_eq('S14 first-touch attribution on (contact, waitlist): the five fields + form, unknown keys ignored', 'postgres', $q$
  select concat_ws('|', cs.utm_source, cs.utm_medium, cs.utm_campaign, cs.utm_content, cs.utm_term, cs.referrer_host,
                   cs.landing_path, cs.form_variant, (cs.attributed_at is not null)::text)
    from public.newsletter_contact_sources cs join public.newsletter_contacts c on c.id = cs.contact_id
   where c.email = 'anna.nowak+promo@example.com' and cs.source_key = 'waitlist' $q$,
  'facebook|cpc|launch|m.facebook.com|/|final|true');

-- the same address again, seconds later
select public.t_set('s15', (public.t_submit('s15', 'anna.nowak+promo@example.com', 'net-other', p_first := 'Hacker',
  p_attr := '{"utm_source":"google"}', p_form := 'hero'))::text);
select public.t_true('S15 a repeat within 60 s: not created, no mail, flagged throttled — and a fresh ALIAS of the address''s code, never the code itself (review S1)', 'postgres', $q$
  select r->>'status' = 'pending' and not (r->>'created')::boolean and not (r->>'send')::boolean
     and r->>'token_id' is null and (r->>'throttled')::boolean
     and r->>'referral_code' ~ '^[A-HJ-NP-Z2-9]{8}$'
     and r->>'referral_code' <> (public.t_s('anna.nowak+promo@example.com'))->>'referral_code'
     and (select a.signup_id from public.prelaunch_referral_aliases a where a.code = r->>'referral_code')
         = ((public.t_s('anna.nowak+promo@example.com'))->>'id')::uuid
    from (select public.t_var('s15')::jsonb as r) x $q$);
select public.t_true('S16 … wrote no consent set, no token, did not bind its answer handle, did not change the name, and attribution stayed first-touch', 'postgres', $q$
  select public.t_sets('anna.nowak+promo@example.com') = 1 and public.t_tokens('anna.nowak+promo@example.com') = 1
     and s->>'answer_hash' = public.t_sha('ans:s9') and s->>'first_name' = 'Anna'
     and s->>'last_ip_hash' = public.t_ip('net-other') and s->>'ip_hash' = public.t_ip('net-anna')
     and (select cs.utm_source from public.newsletter_contact_sources cs where cs.contact_id = (s->>'contact_id')::uuid
           and cs.source_key = 'waitlist') = 'facebook'
    from (select public.t_s('anna.nowak+promo@example.com') as s) x $q$);
select public.t_age('anna.nowak+promo@example.com', 61);
select public.t_set('s17', (public.t_submit('s17', 'anna.nowak+promo@example.com', 'net-other', p_first := 'Anka'))::text);
select public.t_true('S17 61 s later: a second mail with its own consent set; its name rides on ITS link, the row is not renamed (review S8); another alias', 'postgres', $q$
  select (r->>'send')::boolean and not (r->>'created')::boolean
     and r->>'referral_code' ~ '^[A-HJ-NP-Z2-9]{8}$' and r->>'referral_code' <> public.t_var('s15')::jsonb->>'referral_code'
     and public.t_sets('anna.nowak+promo@example.com') = 2 and public.t_tokens('anna.nowak+promo@example.com') = 2
     and (public.t_s('anna.nowak+promo@example.com'))->>'first_name' = 'Anna'
     and (select first_name from public.prelaunch_optin_tokens where token_hash = public.t_sha('doi:s17')) = 'Anka'
     and ((public.t_s('anna.nowak+promo@example.com'))->>'sends_24h')::int = 2
    from (select public.t_var('s17')::jsonb as r) x $q$);
-- 5 mails in the rolling day
do $$ begin
  for i in 3..5 loop
    perform public.t_age('anna.nowak+promo@example.com', 61);
    if not (public.t_submit('s18_' || i, 'anna.nowak+promo@example.com')->>'send')::boolean then
      raise exception 'mail % not sent', i; end if;
  end loop;
end $$;
select public.t_age('anna.nowak+promo@example.com', 61);
select public.t_set('s18', (public.t_submit('s18_6', 'anna.nowak+promo@example.com'))::text);
select public.t_true('S18 the 6th mail in 24 h is refused (5 per address per rolling day), and no consent set is written for it', 'postgres', $q$
  select not (r->>'send')::boolean and (r->>'throttled')::boolean and public.t_tokens('anna.nowak+promo@example.com') = 5
     and public.t_sets('anna.nowak+promo@example.com') = 5
    from (select public.t_var('s18')::jsonb as r) x $q$);
select public.t_age('anna.nowak+promo@example.com', 25 * 3600);
select public.t_set('s19', (public.t_submit('s19', 'anna.nowak+promo@example.com'))::text);
select public.t_true('S19 a day later the mail window rolls and a mail goes again — but consent sets stay capped at 5 per 24 h (its token points at the latest set)', 'postgres', $q$
  select (r->>'send')::boolean and ((public.t_s('anna.nowak+promo@example.com'))->>'sends_24h')::int = 1
     and public.t_tokens('anna.nowak+promo@example.com') = 6 and public.t_sets('anna.nowak+promo@example.com') = 5
     and (select t.consent_set from public.prelaunch_optin_tokens t where t.id = (r->>'token_id')::uuid)
         = ((public.t_s('anna.nowak+promo@example.com'))->>'consent_set_id')::uuid
    from (select public.t_var('s19')::jsonb as r) x $q$);

-- per network: 20 addresses an hour, the 21st leaves no trace
do $$ begin
  for i in 1..20 loop
    if not (public.t_submit('ip' || i, 'net' || i || '@example.com', 'busy-net')->>'send')::boolean then
      raise exception 'address % from the busy network was refused early', i; end if;
  end loop;
end $$;
select public.t_true('S20 the 21st address from one network in an hour: a normal-looking pending answer, throttled', 'anon', $q$
  select r->>'status' = 'pending' and not (r->>'created')::boolean and not (r->>'send')::boolean and (r->>'throttled')::boolean
     and r->>'signup_id' is null
    from (select public.t_submit('ip21', 'net21@example.com', 'busy-net') as r) x $q$);
select public.t_eq('S21 … and NOTHING was written for it: no contact, no signup (S8)', 'postgres', $q$
  select (select count(*) from public.newsletter_contacts where email = 'net21@example.com')::text || ','
      || (select count(*) from public.prelaunch_signups where email = 'net21@example.com')::text $q$, '0,0');
select public.t_true('S22 a different network is not affected', 'anon', $q$
  select (public.t_submit('ip22', 'net22@example.com', 'calm-net')->>'send')::boolean $q$);

-- global hourly cap
select public.t_cfg(jsonb_build_object('optin_hourly_cap', (select count(*) from public.prelaunch_optin_tokens
                                                              where created_at > now() - interval '1 hour')));
select public.t_true('S23 the global DOI cap per hour reached: the address is recorded (created) but no mail goes (S13)', 'anon', $q$
  select (r->>'created')::boolean and not (r->>'send')::boolean and (r->>'throttled')::boolean
    from (select public.t_submit('cap1', 'globalcap@example.com', 'cap-net') as r) x $q$);
select public.t_cfg('{"optin_hourly_cap":300}');

-- hard suppression
insert into public.newsletter_suppressions (email, reason) values ('bounced@example.com', 'bounced');
select public.t_true('S24 a hard-suppressed address (bounced) never gets a DOI mail; the answer does not say why', 'anon', $q$
  select (r->>'created')::boolean and not (r->>'send')::boolean and not (r->>'throttled')::boolean and r->>'status' = 'pending'
    from (select public.t_submit('bounce1', 'bounced@example.com', 'b-net') as r) x $q$);
select public.t_eq('S25 … no token exists for it', 'postgres', $q$ select public.t_tokens('bounced@example.com')::text $q$, '0');

-- defaults and the strict name
select public.t_set('s26', (public.t_submit('def1', 'defaults@example.com', 'd-net', p_first := 'Wygrałeś 500 zł → bit.ly/x',
                                            p_locale := 'xx', p_form := 'popup'))::text);
select public.t_true('S26 an unknown locale → pl, an unknown form → hero; a URL as the name → no name', 'postgres', $q$
  select r->>'locale' = 'pl'
     and (public.t_s('defaults@example.com'))->>'form_variant' = 'hero'
     and (public.t_s('defaults@example.com'))->>'first_name' is null
    from (select public.t_var('s26')::jsonb as r) x $q$);

-- prior contact / prior account (D7)
select public.t_user('known', 'known-account@example.com');
select public.t_submit('pa', 'known-account@example.com', 'pa-net');
select public.t_submit('pc', 'formfan@example.com', 'pc-net');
select public.t_true('S27 an address that already had an account → prior_account; one already a contact → prior_contact', 'postgres', $q$
  select ((public.t_s('known-account@example.com'))->>'prior_account')::boolean
     and not ((public.t_s('known-account@example.com'))->>'prior_contact')::boolean
     and ((public.t_s('formfan@example.com'))->>'prior_contact')::boolean $q$);

-- the answer handle and the channel question
select public.t_eq('S28 the channel answer of the creating submit is saved', 'anon',
  $q$ select public.t_channel('s9', 'allegro') $q$, 'ok');
select public.t_eq('S29 the FIRST answer wins: a second answer says ok…', 'anon',
  $q$ select public.t_channel('s9', 'amazon') $q$, 'ok');
select public.t_eq('S29b … but changes nothing', 'postgres',
  $q$ select (public.t_s('anna.nowak+promo@example.com'))->>'seller_channel' $q$, 'allegro');
select public.t_eq('S30 the handle of a NON-creating submit was never bound → invalid (no channel for somebody else''s address, S7)', 'anon',
  $q$ select public.t_channel('s15', 'amazon') $q$, 'invalid');
select public.t_eq('S31 an unknown channel → invalid', 'anon', $q$ select public.t_channel('ip22', 'ebay') $q$, 'invalid');
update public.prelaunch_signups set answer_until = now() - interval '1 minute' where email = 'net22@example.com';
select public.t_eq('S32 an expired handle → expired', 'anon', $q$ select public.t_channel('ip22', 'amazon') $q$, 'expired');

-- mail bookkeeping
select public.t_true('S33 prelaunch_mark_sent: ok stamps sent_at, a failure stamps send_failed_at', 'anon', $q$
  select public.prelaunch_mark_sent(public.t_tok(), (public.t_var('s9')::jsonb->>'token_id')::uuid, true)
     and public.prelaunch_mark_sent(public.t_tok(), (public.t_var('s17')::jsonb->>'token_id')::uuid, false) $q$);
select public.t_true('S33b … stored', 'postgres', $q$
  select (select sent_at is not null and send_failed_at is null from public.prelaunch_optin_tokens
           where id = (public.t_var('s9')::jsonb->>'token_id')::uuid)
     and (select sent_at is null and send_failed_at is not null from public.prelaunch_optin_tokens
           where id = (public.t_var('s17')::jsonb->>'token_id')::uuid) $q$);
update public.email_settings set smtp_host = 'smtp.example.com', from_email = 'hello@grovbase.test', smtp_secret_ciphertext = 'c';
select public.t_true('S34 the mail payload for the server: the mailbox WITHOUT the confirmation on/off switch (it is off here)', 'anon', $q$
  select p->>'from_email' = 'hello@grovbase.test' and p->'smtp'->>'host' = 'smtp.example.com' and p->'smtp'->>'ciphertext' = 'c'
     and not (p ? 'subject')
    from (select public.prelaunch_mail_payload(public.t_tok()) as p) x $q$);
SQL
}

# ── D. THE DOI CLICK ────────────────────────────────────────────────────────
confirm_checks() {
  q >/dev/null <<'SQL'
select public.t_be('anon');
select public.t_true('D0  while pending the contact is not mailable', 'postgres', $q$
  select not ((public.t_c('anna.nowak+promo@example.com'))->>'marketing_consent')::boolean $q$);
-- The first link (s9). The click applies the name and language of THAT
-- submission ('Anna', de) — not s17's 'Anka' in pl (review S8).
select public.t_set('d1', (public.t_confirm('s9'))::text);
select public.t_true('D1  the click confirms: status, welcome, the clicked link''s name and language, the referral code — and the address for the welcome mail (server only)', 'postgres', $q$
  select r->>'status' = 'confirmed' and (r->>'welcome')::boolean and r->>'first_name' = 'Anna'
     and r->>'email' = 'anna.nowak+promo@example.com' and r->>'locale' = 'de' and r->>'referral_code' ~ '^[A-HJ-NP-Z2-9]{8}$'
     and not (r->>'referral_counted')::boolean
    from (select public.t_var('d1')::jsonb as r) x $q$);
select public.t_true('D2  the signup is confirmed; ONLY the consent set of the clicked link is stamped (2 of 10 rows)', 'postgres', $q$
  select s->>'status' = 'confirmed' and s->>'confirmed_at' is not null
     and (select count(*) from public.prelaunch_consents c where c.signup_id = (s->>'id')::uuid and c.confirmed_at is not null) = 2
     and (select count(*) from public.prelaunch_consents c where c.signup_id = (s->>'id')::uuid and c.confirmed_at is null) = 8
     and (select bool_and(c.confirmed_at is not null) from public.prelaunch_consents c
           join public.prelaunch_optin_tokens t on t.consent_set = c.consent_set
          where t.token_hash = public.t_sha('doi:s9'))
    from (select public.t_s('anna.nowak+promo@example.com') as s) x $q$);
select public.t_true('D3  the contact: marketing consent from the DOI (source waitlist_doi, the marketing row''s version), the name, in group prelaunch', 'postgres', $q$
  select (c->>'marketing_consent')::boolean and c->>'consent_source' = 'waitlist_doi'
     and c->>'consent_version' = 'marketing_email@bbbbbbbbbbbb' and c->>'first_name' = 'Anna' and c->>'consent_at' is not null
     and exists (select 1 from public.newsletter_group_members m join public.newsletter_groups g on g.id = m.group_id
                  where g.key = 'prelaunch' and m.contact_id = (c->>'id')::uuid)
    from (select public.t_c('anna.nowak+promo@example.com') as c) x $q$);
select public.t_eq('D4  the legacy waitlist table holds this person only now, as confirmed (D15)', 'postgres', $q$
  select status || ',' || (confirmed_at is not null)::text || ',' || source from public.waitlist_subscribers
   where email = 'anna.nowak+promo@example.com' $q$, 'confirmed,true,final');
select public.t_set('d5_used', (select used_at::text from public.prelaunch_optin_tokens where token_hash = public.t_sha('doi:s9')));
select public.t_set('d5', (public.t_confirm('s9'))::text);
select public.t_true('D5  the same link again → already with the public fields, no welcome, no address — and the link stays used ONCE (used_at untouched)', 'postgres', $q$
  select r->>'status' = 'already' and not coalesce((r->>'welcome')::boolean, false) and r->>'referral_code' is not null
     and not (r ? 'email')
     and (select used_at::text from public.prelaunch_optin_tokens where token_hash = public.t_sha('doi:s9')) = public.t_var('d5_used')
    from (select public.t_var('d5')::jsonb as r) x $q$);
select public.t_set('d6', (public.t_confirm('s17'))::text);
select public.t_true('D6  ANOTHER unused link of the confirmed address → already, no welcome; that link''s own consent set gets stamped', 'postgres', $q$
  select r->>'status' = 'already' and not coalesce((r->>'welcome')::boolean, false)
     and (select bool_and(c.confirmed_at is not null) from public.prelaunch_consents c
           join public.prelaunch_optin_tokens t on t.consent_set = c.consent_set where t.token_hash = public.t_sha('doi:s17'))
    from (select public.t_var('d6')::jsonb as r) x $q$);
update public.prelaunch_optin_tokens set expires_at = now() - interval '8 days', created_at = now() - interval '11 days'
 where token_hash = public.t_sha('doi:s9');
select public.t_eq('D7  "already" more than 7 days after the link expired says only that (no name, no code, S19)', 'anon',
  $q$ select (public.t_confirm('s9'))::text $q$, '{"status": "already"}');
select public.t_eq('D8  an unknown token → invalid', 'anon',
  $q$ select (public.prelaunch_confirm(public.t_tok(), public.t_sha('never-issued')))::text $q$, '{"status": "invalid"}');
select public.t_eq('D9  a malformed token → invalid', 'anon',
  $q$ select (public.prelaunch_confirm(public.t_tok(), 'abc'))::text $q$, '{"status": "invalid"}');

-- expired link → resend by link → confirm
select public.t_submit('exp1', 'expiring@example.com', 'exp-net', p_first := 'Ewa');
update public.prelaunch_optin_tokens set expires_at = now() - interval '1 minute' where token_hash = public.t_sha('doi:exp1');
select public.t_eq('D10 an expired link → {status: expired} — no address, no name', 'anon',
  $q$ select (public.t_confirm('exp1'))::text $q$, '{"status": "expired"}');
select public.t_eq('D11 … and the signup stays pending', 'postgres',
  $q$ select (public.t_s('expiring@example.com'))->>'status' $q$, 'pending');
select public.t_age('expiring@example.com', 61);
select public.t_set('d12', (public.t_resend_link('exp2', 'exp1'))::text);
select public.t_true('D12 "send a new link" from the expired page (resend by the old link''s hash): sent, origin resend_link, the address only to the route', 'postgres', $q$
  select r->>'status' = 'sent' and (r->>'send')::boolean and r->>'email' = 'expiring@example.com'
     and (select origin from public.prelaunch_optin_tokens where id = (r->>'token_id')::uuid) = 'resend_link'
    from (select public.t_var('d12')::jsonb as r) x $q$);
select public.t_eq('D13 the new link confirms', 'anon', $q$ select public.t_confirm('exp2')->>'status' $q$, 'confirmed');

-- S11: a throttled resubmit leaves no set; the resend copies the latest set
select public.t_submit('rs1', 'resender@example.com', 'rs-net');
select public.t_submit('rs1b', 'resender@example.com', 'rs-net',
  p_consents := jsonb_set(public.t_consents(), '{1,version}', '"marketing_email@cccccccccccc"'));
select public.t_age('resender@example.com', 61);
select public.t_set('rs2', (public.t_resend('rs2', 'resender@example.com', 'rs-net'))::text);
select public.t_true('D14 "send again" by address: sent, origin resend_email, the new link confirms the signup''s LATEST consent set (S11)', 'postgres', $q$
  select x.r->>'status' = 'sent' and t.origin = 'resend_email' and t.consent_set = s.consent_set_id
     and public.t_sets('resender@example.com') = 1
    from (select public.t_var('rs2')::jsonb as r) x
    join public.prelaunch_optin_tokens t on t.id = (x.r->>'token_id')::uuid
    join public.prelaunch_signups s on s.id = t.signup_id $q$);
select public.t_eq('D15 confirming through the resent link…', 'anon', $q$ select public.t_confirm('rs2')->>'status' $q$, 'confirmed');
select public.t_true('D15b … stamps the original set and records ITS marketing version on the contact (never NULL → v1)', 'postgres', $q$
  select (public.t_c('resender@example.com'))->>'consent_version' = 'marketing_email@bbbbbbbbbbbb'
     and (select bool_and(confirmed_at is not null) from public.prelaunch_consents c
           where c.signup_id = ((public.t_s('resender@example.com'))->>'id')::uuid) $q$);
select public.t_true('D16 resend: unknown address → noop (no address back); confirmed address → noop; both or neither identifier → noop', 'anon', $q$
  select public.t_resend('rs3', 'nobody@example.com')->>'status' = 'noop'
     and public.t_resend('rs3b', 'nobody@example.com')->>'email' is null
     and public.t_resend('rs4', 'resender@example.com')->>'status' = 'noop'
     and public.prelaunch_resend(public.t_tok(), null, null, null, public.t_sha('doi:rs5'))->>'status' = 'noop'
     and public.prelaunch_resend(public.t_tok(), 'resender@example.com', public.t_sha('doi:rs2'), null,
                                 public.t_sha('doi:rs6'))->>'status' = 'noop' $q$);
update public.prelaunch_signups set last_sent_at = now() where email = 'net22@example.com';
select public.t_eq('D17 resend within 60 s of the last mail to a PENDING address → noop (the same per-address throttle)', 'anon', $q$
  select public.t_resend('rs7', 'net22@example.com')->>'status' $q$, 'noop');

-- D3: a legacy terms-tick "consent" is replaced by the DOI; another source's consent is kept
select public.t_submit('lg1', 'legacy@example.com', 'lg-net');
select public.t_eq('D18 legacy waitlist/v1 consent + DOI …', 'anon', $q$ select public.t_confirm('lg1')->>'status' $q$, 'confirmed');
select public.t_true('D18b … replaced: consent_source waitlist_doi, the marketing version, dated now (D3)', 'postgres', $q$
  select c->>'consent_source' = 'waitlist_doi' and c->>'consent_version' = 'marketing_email@bbbbbbbbbbbb'
     and (c->>'consent_at')::timestamptz > now() - interval '1 minute'
    from (select public.t_c('legacy@example.com') as c) x $q$);
select public.t_eq('D19 a contact consented through the CMS form confirms the DOI…', 'anon', $q$
  select public.t_confirm('pc')->>'status' $q$, 'confirmed');
select public.t_true('D19b … and keeps its FIRST yes (cms_form / form-v1, the old date)', 'postgres', $q$
  select c->>'consent_source' = 'cms_form' and c->>'consent_version' = 'form-v1'
     and (c->>'consent_at')::timestamptz < now() - interval '1 day'
    from (select public.t_c('formfan@example.com') as c) x $q$);

-- S16: unsubscribed → DOI → mailable again; a hard suppression stays
insert into public.newsletter_contacts (email, source_key, marketing_consent, unsubscribed_at)
  values ('unsub@example.com', 'form', false, now() - interval '3 days');
insert into public.newsletter_suppressions (email, reason) values ('unsub@example.com', 'unsubscribed');
select public.t_eq('D20 an UNSUBSCRIBED address gets a DOI mail (it is not a hard suppression)', 'anon', $q$
  select public.t_submit('un1', 'unsub@example.com', 'un-net')->>'send' $q$, 'true');
select public.t_eq('D21 … and confirming it…', 'anon', $q$ select public.t_confirm('un1')->>'status' $q$, 'confirmed');
select public.t_true('D21b … lifts the unsubscribe through newsletter_resubscribe: no suppression, consent on, source waitlist_doi, unsubscribed_at cleared (S16)', 'postgres', $q$
  select not exists (select 1 from public.newsletter_suppressions where email = 'unsub@example.com')
     and (c->>'marketing_consent')::boolean and c->>'consent_source' = 'waitlist_doi' and c->>'unsubscribed_at' is null
    from (select public.t_c('unsub@example.com') as c) x $q$);
select public.t_submit('hb1', 'hardlater@example.com', 'hb-net');
insert into public.newsletter_suppressions (email, reason) values ('hardlater@example.com', 'complained');
select public.t_eq('D22 a mail that drew a complaint AFTER it was sent: the click still confirms the signup…', 'anon', $q$
  select public.t_confirm('hb1')->>'status' $q$, 'confirmed');
select public.t_true('D22b … but consent stays OFF and the hard suppression stays', 'postgres', $q$
  select not ((public.t_c('hardlater@example.com'))->>'marketing_consent')::boolean
     and exists (select 1 from public.newsletter_suppressions where email = 'hardlater@example.com' and reason = 'complained') $q$);

-- marketing optional (owner switch)
select public.t_cfg('{"marketing_required":false}');
select public.t_eq('D23 with marketing_required off, the terms consent alone is accepted…', 'anon', $q$
  select public.t_submit('mo1', 'termsonly@example.com', 'mo-net', p_consents := public.t_consents(false))->>'send' $q$, 'true');
select public.t_eq('D23b … and the DOI confirms…', 'anon', $q$ select public.t_confirm('mo1')->>'status' $q$, 'confirmed');
select public.t_true('D23c … WITHOUT marketing consent: one consent row, a contact that is not mailable', 'postgres', $q$
  select public.t_sets('termsonly@example.com') = 1
     and (select count(*) from public.prelaunch_consents c where c.signup_id = ((public.t_s('termsonly@example.com'))->>'id')::uuid) = 1
     and not ((public.t_c('termsonly@example.com'))->>'marketing_consent')::boolean $q$);
select public.t_cfg('{"marketing_required":true}');

-- a confirmed address submits again
select public.t_set('d24', (public.t_submit('again', 'expiring@example.com', 'again-net'))::text);
select public.t_true('D24 a confirmed address submitting again: status confirmed, no mail, no new consent set', 'postgres', $q$
  select r->>'status' = 'confirmed' and not (r->>'send')::boolean and not (r->>'created')::boolean
     and public.t_sets('expiring@example.com') = 1
    from (select public.t_var('d24')::jsonb as r) x $q$);
select public.t_submit('race1', 'raceclick@example.com', 'race-net');
SQL

  # D25: two backends click the same fresh link at the same moment; each
  # keeps its transaction open a second after the call.
  local click="begin; set local role anon; select public.t_confirm('race1'); select pg_sleep(1); commit;"
  race "$click" "$click"
  local welcomes confirmed already
  welcomes=$(cat "$WORK"/race_1.out "$WORK"/race_2.out | grep -c '"welcome": true' || true)
  confirmed=$(cat "$WORK"/race_1.out "$WORK"/race_2.out | grep -c '"status": "confirmed"' || true)
  already=$(cat "$WORK"/race_1.out "$WORK"/race_2.out | grep -c '"status": "already"' || true)
  if [ "$welcomes" = "1" ] && [ "$confirmed" = "1" ] && [ "$already" = "1" ]; then
    record 'D25 two concurrent clicks on one link (scanner + human): exactly one confirmed with welcome, the other already' true ''
  else
    record 'D25 two concurrent clicks on one link (scanner + human): exactly one confirmed with welcome, the other already' false \
      "welcomes=$welcomes confirmed=$confirmed already=$already: $(tr '\n' ' ' < "$WORK/race_1.out") | $(tr '\n' ' ' < "$WORK/race_2.out")"
  fi
}

# ── W. THE LEGACY DOOR ──────────────────────────────────────────────────────
waitlist_checks() {
  q >/dev/null <<'SQL'
select public.t_be('anon');
select public.t_eq('W1  AFTER 0144, anon waitlist_subscribe with consent:true still records the address (created)…', 'anon',
  $q$ select (public.waitlist_subscribe('legacy-door@example.com', 'hero', 'pl', '{"consent":true,"consent_version":"v9"}'::jsonb))->>'status' $q$,
  'created');
select public.t_true('W2  … but the contact is NOT marketing-consented: no consent date, source or version (S1 closed)', 'postgres', $q$
  select not (c->>'marketing_consent')::boolean and c->>'consent_at' is null and c->>'consent_source' is null
    from (select public.t_c('legacy-door@example.com') as c) x $q$);
select public.t_eq('W3  a repeat → the SAME answer as a new address, and never a welcome (review S5: no membership oracle, no mail without DOI)', 'anon',
  $q$ select (public.waitlist_subscribe('legacy-door@example.com', 'hero', 'pl', '{"consent":true}'::jsonb))::text $q$,
  '{"status": "created", "confirmation": false}');
select public.t_eq('W3c a name typed at the legacy door never reaches the contact (review S8)', 'postgres', $q$
  select coalesce((public.waitlist_subscribe('legacy-name@example.com', 'hero', 'pl',
            '{"first_name":"Odbierz nagrode na evil.example","last_name":"x"}'::jsonb))->>'status', '?') || ','
      || coalesce((select first_name from public.newsletter_contacts where email = 'legacy-name@example.com'), 'null') $q$,
  'created,null');
select public.t_eq('W3d the strict address check: comment, comma, semicolon, colon, quote, bracket and a bad label are invalid (review S6)', 'anon', $q$
  select string_agg((public.waitlist_subscribe(e, 'hero', 'pl', '{}'::jsonb))->>'status', ',' order by e)
    from unnest(array['a(1)victim@example.com', 'x,victim@example.com', 'x;victim@example.com', 'x:victim@example.com',
                      '"q"@example.com', 'x@[1.2.3.4]', 'x@-bad.example.com', 'x@example']) e $q$,
  'invalid,invalid,invalid,invalid,invalid,invalid,invalid,invalid');
select public.t_eq('W3b … still no consent', 'postgres',
  $q$ select marketing_consent::text from public.newsletter_contacts where email = 'legacy-door@example.com' $q$, 'false');
SQL
}

# ── F. REFERRALS ────────────────────────────────────────────────────────────
referral_checks() {
  q >/dev/null <<'SQL'
select public.t_be('anon');
-- referrer R1 (network A)
select public.t_confirmed('r1', 'referrer.one@example.com', 'net-A', p_first := 'Rafał');
select public.t_set('code_r1', (public.t_s('referrer.one@example.com'))->>'referral_code');
select public.t_set('f1', (public.t_submit('f1', 'friend.one@example.com', 'net-B', p_ref := lower(public.t_var('code_r1'))))::text);
select public.t_true('F1  a new address submitted with R1''s code (any case) is linked at creation, and not counted yet', 'postgres', $q$
  select (public.t_var('f1')::jsonb->>'created')::boolean
     and (public.t_s('friend.one@example.com'))->>'referred_by' = (public.t_s('referrer.one@example.com'))->>'id'
     and (public.t_s('friend.one@example.com'))->>'referral_counted_at' is null $q$);
select public.t_set('f2', (public.t_confirm('f1'))::text);
select public.t_true('F2  the referral counts at the referred person''s DOI', 'postgres', $q$
  select (public.t_var('f2')::jsonb->>'referral_counted')::boolean
     and (public.t_s('friend.one@example.com'))->>'referral_counted_at' is not null $q$);
select public.t_set('f3', (public.t_confirm('f1'))::text);
select public.t_true('F3  decided once: another click changes nothing', 'postgres', $q$
  select public.t_var('f3')::jsonb->>'status' = 'already'
     and (public.t_s('friend.one@example.com'))->>'referral_rejected' is null $q$);
select public.t_submit('f4', 'expiring@example.com', 'f4-net', p_ref := public.t_var('code_r1'));
select public.t_submit('f4b', 'badcode@example.com', 'f4b-net', p_ref := 'IO01IO01');
select public.t_true('F4  a code on an EXISTING signup does not change the row at submit (it rides on that link); a malformed code is ignored', 'postgres', $q$
  select (public.t_s('expiring@example.com'))->>'referred_by' is null
     and (public.t_s('badcode@example.com'))->>'referred_by' is null $q$);
-- self: the same mailbox through a Gmail alias
select public.t_confirmed('self0', 'self.person+a@gmail.com', 'net-S1');
select public.t_age('self.person+a@gmail.com', 61);
select public.t_set('code_self', (public.t_s('self.person+a@gmail.com'))->>'referral_code');
select public.t_submit('self1', 'selfperson+b@googlemail.com', 'net-S2', p_ref := public.t_var('code_self'));
select public.t_set('f5', (public.t_confirm('self1'))::text);
select public.t_eq('F5  referring your own mailbox (alias / dots / googlemail) → rejected self', 'postgres', $q$
  select (public.t_var('f5')::jsonb->>'referral_counted') || ',' || ((public.t_s('selfperson+b@googlemail.com'))->>'referral_rejected') $q$,
  'false,self');
-- same network as the referrer
select public.t_submit('sn1', 'same.net@example.com', 'net-A', p_ref := public.t_var('code_r1'));
select public.t_set('f6', (public.t_confirm('sn1'))::text);
select public.t_eq('F6  the referred person''s first IP equals the referrer''s → rejected same_network', 'postgres', $q$
  select (public.t_var('f6')::jsonb->>'referral_counted') || ',' || ((public.t_s('same.net@example.com'))->>'referral_rejected') $q$,
  'false,same_network');
-- duplicate mailbox for the same referrer
select public.t_submit('du1', 'dup.box+1@example.com', 'net-D1', p_ref := public.t_var('code_r1'));
select public.t_age('dup.box+1@example.com', 61);
select public.t_submit('du2', 'dup.box+2@example.com', 'net-D2', p_ref := public.t_var('code_r1'));
select public.t_set('f7a', (public.t_confirm('du1'))::text);
select public.t_set('f7b', (public.t_confirm('du2'))::text);
select public.t_eq('F7  two aliases of one mailbox for one referrer: the first counts, the second → duplicate', 'postgres', $q$
  select (public.t_var('f7a')::jsonb->>'referral_counted') || ',' || (public.t_var('f7b')::jsonb->>'referral_counted') || ','
      || ((public.t_s('dup.box+2@example.com'))->>'referral_rejected') $q$, 'true,false,duplicate');
-- existing contact / existing account
select public.t_submit('ec1', 'legacy-door@example.com', 'net-E1', p_ref := public.t_var('code_r1'));
select public.t_set('f8', (public.t_confirm('ec1'))::text);
select public.t_eq('F8  an address that was already a contact → rejected existing_contact (D7)', 'postgres', $q$
  select (public.t_var('f8')::jsonb->>'referral_counted') || ',' || ((public.t_s('legacy-door@example.com'))->>'referral_rejected') $q$,
  'false,existing_contact');
select public.t_user('acct', 'has.account@example.com');
select public.t_submit('ea1', 'has.account@example.com', 'net-E2', p_ref := public.t_var('code_r1'));
select public.t_set('f9', (public.t_confirm('ea1'))::text);
select public.t_eq('F9  an address that already had an account → rejected existing_account (D7)', 'postgres', $q$
  select (public.t_var('f9')::jsonb->>'referral_counted') || ',' || ((public.t_s('has.account@example.com'))->>'referral_rejected') $q$,
  'false,existing_account');
-- cluster: three referred people from one network (not the referrer's)
select public.t_confirmed('r2', 'referrer.two@example.com', 'net-R2');
select public.t_set('code_r2', (public.t_s('referrer.two@example.com'))->>'referral_code');
select public.t_submit('cl1', 'cluster1@example.com', 'net-C', p_ref := public.t_var('code_r2'));
select public.t_submit('cl2', 'cluster2@example.com', 'net-C', p_ref := public.t_var('code_r2'));
select public.t_submit('cl3', 'cluster3@example.com', 'net-C', p_ref := public.t_var('code_r2'));
select public.t_set('f10a', (public.t_confirm('cl1'))::text);
select public.t_set('f10b', (public.t_confirm('cl2'))::text);
select public.t_set('f10c', (public.t_confirm('cl3'))::text);
select public.t_eq('F10 the 3rd counted referral of one referrer from one network → rejected cluster (at most two per network)', 'postgres', $q$
  select (public.t_var('f10a')::jsonb->>'referral_counted') || ',' || (public.t_var('f10b')::jsonb->>'referral_counted') || ','
      || (public.t_var('f10c')::jsonb->>'referral_counted') || ',' || ((public.t_s('cluster3@example.com'))->>'referral_rejected') $q$,
  'true,true,false,cluster');
-- cap
select public.t_cfg('{"referral_cap":3}');
select public.t_confirmed('r3', 'referrer.three@example.com', 'net-R3');
select public.t_set('code_r3', (public.t_s('referrer.three@example.com'))->>'referral_code');
do $$ begin
  for i in 1..4 loop
    perform public.t_submit('cp' || i, 'capped' || i || '@example.com', 'net-cap-' || i, p_ref := public.t_var('code_r3'));
  end loop;
  for i in 1..4 loop
    perform public.t_set('f11_' || i, (public.t_confirm('cp' || i))::text);
  end loop;
end $$;
select public.t_eq('F11 referral_cap 3: all four COUNT — the cap limits what is paid, not what is counted (review S2)', 'postgres', $q$
  select string_agg(public.t_var('f11_' || i)::jsonb->>'referral_counted', ',' order by i) || ','
      || coalesce((public.t_s('capped4@example.com'))->>'referral_rejected', '-')
    from generate_series(1, 4) i $q$, 'true,true,true,true,-');
-- the referrer lock under concurrency: two spellings of ONE mailbox, referred
-- by one referrer, confirm at the same moment
select public.t_confirmed('r4', 'referrer.four@example.com', 'net-R4');
select public.t_set('code_r4', (public.t_s('referrer.four@example.com'))->>'referral_code');
do $$ begin
  perform public.t_submit('cc3', 'conc.box+3@example.com', 'net-conc-3', p_ref := public.t_var('code_r4'));
  perform public.t_age('conc.box+3@example.com', 61);
  perform public.t_submit('cc4', 'conc.box+4@example.com', 'net-conc-4', p_ref := public.t_var('code_r4'));
end $$;
SQL
  race "begin; set local role anon; select public.t_confirm('cc3'); select pg_sleep(1); commit;" \
       "begin; set local role anon; select public.t_confirm('cc4'); select pg_sleep(1); commit;"
  q >/dev/null <<'SQL'
select public.t_eq('F12 two spellings of one mailbox confirm AT THE SAME MOMENT for one referrer → exactly one counted, the other duplicate (referrer row lock)', 'postgres', $q$
  select (select count(*) from public.prelaunch_signups s where s.referred_by = ((public.t_s('referrer.four@example.com'))->>'id')::uuid
            and s.referral_counted_at is not null)::text || ','
      || (select string_agg(coalesce(s.referral_rejected, '-'), ',' order by s.referral_rejected nulls first)
            from public.prelaunch_signups s where s.email in ('conc.box+3@example.com', 'conc.box+4@example.com')) $q$, '1,-,duplicate');
select public.t_cfg('{"referral_cap":10}');
-- ALIASES (review S1): a repeat submit's link earns for the address
select public.t_set('f13r', (public.t_submit('f13r', 'referrer.one@example.com', 'net-A'))::text);
select public.t_submit('f13', 'via.alias@example.com', 'net-F13', p_ref := public.t_var('f13r')::jsonb->>'referral_code');
select public.t_set('f13c', (public.t_confirm('f13'))::text);
select public.t_true('F13 the alias handed to a CONFIRMED address''s repeat submit links a new person to that address and counts at their DOI', 'postgres', $q$
  select public.t_var('f13r')::jsonb->>'referral_code' <> (public.t_s('referrer.one@example.com'))->>'referral_code'
     and (public.t_s('via.alias@example.com'))->>'referred_by' = (public.t_s('referrer.one@example.com'))->>'id'
     and (public.t_var('f13c')::jsonb->>'referral_counted')::boolean $q$);
do $$ begin
  for i in 1..52 loop perform public.t_submit('f14_' || i, 'many.repeats@example.com', 'net-F14'); end loop;
end $$;
select public.t_eq('F14 at most 50 aliases per signup; past that the answer carries no code (the route sends an unstored decoy)', 'postgres', $q$
  select (select count(*) from public.prelaunch_referral_aliases a join public.prelaunch_signups s on s.id = a.signup_id
           where s.email = 'many.repeats@example.com')::text || ','
      || coalesce(public.t_submit('f14_x', 'many.repeats@example.com', 'net-F14')->>'referral_code', 'null') $q$, '50,null');
-- THE CLICKED LINK DECIDES THE REFERRER AND THE NAME (review S3/S8)
select public.t_confirmed('mal', 'mallory@example.com', 'net-mal');
select public.t_confirmed('fri', 'honest.friend@example.com', 'net-fri');
select public.t_submit('v_m', 'victim.v@example.com', 'net-mal2', p_ref := (public.t_s('mallory@example.com'))->>'referral_code',
  p_first := 'Zablokowane');
select public.t_age('victim.v@example.com', 61);
select public.t_submit('v_f', 'victim.v@example.com', 'net-vic', p_ref := (public.t_s('honest.friend@example.com'))->>'referral_code',
  p_first := 'Wiktoria');
select public.t_set('f15', (public.t_confirm('v_f'))::text);
select public.t_true('F15 a stranger typed the address first with their code and a name; the owner confirms THEIR link → the friend is the referrer and the owner''s name is used', 'postgres', $q$
  select (public.t_s('victim.v@example.com'))->>'referred_by' = (public.t_s('honest.friend@example.com'))->>'id'
     and (public.t_var('f15')::jsonb->>'referral_counted')::boolean
     and public.t_var('f15')::jsonb->>'first_name' = 'Wiktoria'
     and (public.t_s('victim.v@example.com'))->>'first_name' = 'Wiktoria'
     and (public.t_c('victim.v@example.com'))->>'first_name' = 'Wiktoria' $q$);
select public.t_submit('v2_m', 'victim.two@example.com', 'net-mal3', p_ref := (public.t_s('mallory@example.com'))->>'referral_code');
select public.t_age('victim.two@example.com', 61);
select public.t_submit('v2_n', 'victim.two@example.com', 'net-vic2');
select public.t_age('victim.two@example.com', 61);
select public.t_resend_link('v2_r', 'v2_m');
select public.t_true('F16 a resend from an old link carries THAT link''s referrer; a link without one leaves the row''s', 'postgres', $q$
  select (select referrer from public.prelaunch_optin_tokens where token_hash = public.t_sha('doi:v2_r'))
         = ((public.t_s('mallory@example.com'))->>'id')::uuid
     and (select referrer from public.prelaunch_optin_tokens where token_hash = public.t_sha('doi:v2_n')) is null $q$);
-- THE STRICT ADDRESS AND THE MAILBOX LIMITS (review S6)
select public.t_eq('F17 prelaunch_signup refuses addresses the mailer would re-parse into another mailbox', 'anon', $q$
  select string_agg(public.t_submit('bad' || i, e, 'net-bad')->>'status', ',' order by i)
    from unnest(array['a(1)victim@example.com', 'x,victim@example.com', 'x;victim@example.com', 'x:victim@example.com;',
                      '"q"@example.com', 'x <victim@example.com>']) with ordinality as u(e, i) $q$,
  'invalid,invalid,invalid,invalid,invalid,invalid');
select public.t_eq('F17b … and keeps the ordinary ones (dots, plus tags, apostrophes, subdomains, long TLDs)', 'anon', $q$
  select string_agg(coalesce(public.t_submit('ok' || i, e, 'net-ok-' || i)->>'status', '?'), ',' order by i)
    from unnest(array['jan.kowalski@example.com', 'o''brien+shop@mail.example.co.uk', 'x_y-z@sub.example.travel'])
         with ordinality as u(e, i) $q$, 'pending,pending,pending');
insert into public.newsletter_suppressions (email, reason) values ('suppressed.box@gmail.com', 'complained');
select public.t_true('F18 a complained mailbox is not mailed through another spelling of it (plus tag, dots)', 'anon', $q$
  select not (public.t_submit('sup1', 'suppressed.box+new@gmail.com', 'net-sup1')->>'send')::boolean
     and not (public.t_submit('sup2', 'suppressedbox@gmail.com', 'net-sup2')->>'send')::boolean $q$);
do $$ begin
  for i in 1..5 loop
    perform public.t_age('mbox+' || (i - 1) || '@example.com', 61);
    if not (public.t_submit('mb' || i, 'mbox+' || i || '@example.com', 'net-mb-' || i)->>'send')::boolean then
      raise exception 'mailbox mail % not sent', i; end if;
  end loop;
  for i in 1..5 loop perform public.t_age('mbox+' || i || '@example.com', 61); end loop;
end $$;
select public.t_true('F19 five DOI mails in 24 h to ONE mailbox across five spellings, then the sixth spelling gets none', 'anon', $q$
  select not (r->>'send')::boolean and (r->>'throttled')::boolean
    from (select public.t_submit('mb6', 'mbox+6@example.com', 'net-mb-6') as r) x $q$);
SQL
}

# ── E. THE CREDITS ──────────────────────────────────────────────────────────
reward_checks() {
  q >/dev/null <<'SQL'
-- People: accounts created AFTER their signup unless said otherwise.
select public.t_confirmed('e_main', 'main.user@example.com', 'net-m1');
select public.t_user('main', 'main.user@example.com');
select public.t_set('e1', (public.t_ensure('main'))::text);
select public.t_eq('E1  rewards switched off → granted 0 and no claim (the dormant state 0144 ships in)', 'postgres', $q$
  select public.t_var('e1') || ',' || public.t_n('select count(*) from public.prelaunch_reward_claims')::text $q$,
  '{"error": null, "signup": 0, "granted": 0, "referrals": 0},0');
select public.t_cfg('{"rewards_active":true,"signup_credits":100,"signup_credits_approved":true,"referral_credits":20,"referral_credits_approved":true,"referral_cap":10}');

select public.t_user('unverified', 'unverified.user@example.com', p_verified := false);
select public.t_confirmed('e_unv', 'unverified.user@example.com', 'net-m2');
select public.t_eq('E2  an unverified account → 0, unverified', 'postgres', $q$ select public.t_ensure('unverified')->>'error' $q$, 'unverified');

select public.t_confirmed('e_blk', 'blocked.user@example.com', 'net-m3');
select public.t_user('blocked', 'blocked.user@example.com');
update public.profiles set blocked = true where id = public.t_uid('blocked');
select public.t_eq('E3  a blocked account (account_blocked) → 0, blocked', 'postgres', $q$ select public.t_ensure('blocked')->>'error' $q$, 'blocked');
update public.profiles set blocked_until = now() - interval '1 hour' where id = public.t_uid('blocked');
select public.t_eq('E3b a timed block that ran out is no block → paid', 'postgres', $q$ select public.t_ensure('blocked')->>'signup' $q$, '75');

select public.t_user('nosignup', 'no.signup@example.com');
select public.t_eq('E4  no pre-launch signup → 0, no_signup', 'postgres', $q$ select public.t_ensure('nosignup')->>'error' $q$, 'no_signup');
select public.t_submit('e_pend', 'pending.user@example.com', 'net-m4');
select public.t_user('pending', 'pending.user@example.com');
select public.t_eq('E5  a PENDING (unconfirmed) signup earns nothing → no_signup', 'postgres', $q$ select public.t_ensure('pending')->>'error' $q$, 'no_signup');

select public.t_confirmed('e_nw', 'no.wallet@example.com', 'net-m5');
select public.t_user('nowallet', 'no.wallet@example.com', p_wallet := false);
select public.t_set('e6', public.t_ensure('nowallet')->>'error');
select public.t_eq('E6  no wallet (an invited member) → no_wallet, and NO claim was inserted', 'postgres', $q$
  select public.t_var('e6') || ',' || public.t_claims('nowallet', 'signup')::text $q$, 'no_wallet,0');

select public.t_set('e7', (public.t_ensure('main'))::text);
select public.t_eq('E7  the normal case: born with 25, X = 100 → the DELTA 75 is granted (X replaces the 25, it does not add)', 'postgres', $q$
  select public.t_var('e7') $q$, '{"error": null, "signup": 75, "granted": 75, "referrals": 0}');
select public.t_true('E8  the ledger: one bonus tx of 75, source prelaunch_signup, created_by the user, reference = the claim; balance 100', 'postgres', $q$
  select t.amount = 75 and t.type = 'bonus' and t.metadata->>'source' = 'prelaunch_signup' and t.metadata->>'campaign' = 'prelaunch-2026'
     and t.created_by = public.t_uid('main') and t.reference_id = c.id and c.credit_transaction_id = t.id and c.amount = 75
     and public.t_balance('main') = 100 and t.description = 'Bonus premierowy'
    from public.prelaunch_reward_claims c join public.credit_transactions t on t.id = c.credit_transaction_id
   where c.user_id = public.t_uid('main') and c.kind = 'signup' $q$);
select public.t_set('e9', public.t_ensure('main')->>'granted');
select public.t_eq('E9  idempotent: again → 0, still one claim, balance 100', 'postgres', $q$
  select public.t_var('e9') || ',' || public.t_claims('main', 'signup')::text || ',' || public.t_balance('main')::text $q$, '0,1,100');
select public.t_true('E10 the contact is bound to the account (user_id) on the way', 'postgres', $q$
  select (public.t_c('main.user@example.com'))->>'user_id' = public.t_uid('main')::text $q$);

-- created before the signup
select public.t_user('early', 'early.bird@example.com', p_created := now() - interval '10 days');
select public.t_confirmed('e_early', 'early.bird@example.com', 'net-m6');
select public.t_set('e11', public.t_ensure('early')->>'granted');
select public.t_eq('E11 account created BEFORE the signup and already given its signup bonus → nothing, no claim', 'postgres', $q$
  select public.t_var('e11') || ',' || public.t_claims('early', 'signup')::text $q$, '0,0');
select public.t_user('refused', 'refused.at.birth@example.com', p_created := now() - interval '10 days', p_bonus := 0);
select public.t_confirmed('e_ref', 'refused.at.birth@example.com', 'net-m7');
select public.t_set('e12', public.t_ensure('refused')->>'signup');
select public.t_eq('E12 account created before the signup but refused its 25 at birth (signup closed) → the full X (D6)', 'postgres', $q$
  select public.t_var('e12') || ',' || public.t_balance('refused')::text $q$, '100,100');
select public.t_confirmed('e_boot', 'bootstrap.user@example.com', 'net-m8');
select public.t_user('boot', 'bootstrap.user@example.com', p_bonus_source := 'bootstrap_recovery');
select public.t_eq('E13 born with a bootstrap_recovery 25 → delta 75', 'postgres', $q$ select public.t_ensure('boot')->>'signup' $q$, '75');
select public.t_confirmed('e_prior', 'prior.grant@example.com', 'net-m9');
select public.t_user('prior', 'prior.grant@example.com');
select public.apply_credit_transaction(public.t_wallet('prior'), 80, 'bonus', 'Bonus premierowy', null,
  '{"source":"prelaunch_signup","campaign":"earlier"}', public.t_uid('prior'));
select public.t_set('e14', public.t_ensure('prior')->>'granted');
select public.t_eq('E14 the wallet already got signup 25 + an earlier prelaunch_signup 80 → delta 0; the claim is kept at amount 0', 'postgres', $q$
  select public.t_var('e14') || ',' || public.t_n($s$select amount from public.prelaunch_reward_claims
            where kind = 'signup' and user_id = public.t_uid('prior')$s$)::text $q$, '0,0');

-- the e-mail hop and the aliases (S2)
select public.t_confirmed('e_hopb', 'hop.second@example.com', 'net-h2');
update auth.users set email = 'hop.second@example.com' where id = public.t_uid('main');
select public.t_set('e15', public.t_ensure('main')->>'signup');
update auth.users set email = 'main.user@example.com' where id = public.t_uid('main');
select public.t_eq('E15 the account changes its e-mail to ANOTHER confirmed address → no second signup reward (one per account)', 'postgres', $q$
  select public.t_var('e15') || ',' || public.t_claims('main', 'signup')::text || ',' || public.t_balance('main')::text $q$, '0,1,100');
select public.t_confirmed('e_al1', 'alias.person+1@gmail.com', 'net-al1');
-- One mailbox gets one DOI mail a minute, whichever spelling (review S6).
select public.t_age('alias.person+1@gmail.com', 61);
select public.t_confirmed('e_al2', 'aliasperson+2@gmail.com', 'net-al2');
select public.t_user('alias1', 'alias.person+1@gmail.com');
select public.t_user('alias2', 'aliasperson+2@gmail.com');
select public.t_set('e16a', public.t_ensure('alias1')->>'signup');
select public.t_set('e16b', public.t_ensure('alias2')->>'signup');
select public.t_eq('E16 two accounts on two aliases of ONE Gmail mailbox: the first is paid, the second gets no signup reward', 'postgres', $q$
  select public.t_var('e16a') || ',' || public.t_var('e16b') || ',' || public.t_claims('alias2', 'signup')::text $q$, '75,0,0');

-- a contact bound to somebody else
select public.t_confirmed('e_bnd', 'bound.else@example.com', 'net-b1');
select public.t_user('bound', 'bound.else@example.com');
update public.newsletter_contacts set user_id = public.t_uid('customer') where email = 'bound.else@example.com';
select public.t_set('e17', public.t_ensure('bound')->>'error');
select public.t_eq('E17 the address''s contact belongs to ANOTHER account → bound_elsewhere, no claim', 'postgres', $q$
  select public.t_var('e17') || ',' || public.t_claims('bound', 'signup')::text $q$, 'bound_elsewhere,0');

-- referrals: five counted (the confirm-time cap is 10), none an account yet
select public.t_confirmed('e_ref0', 'ref.owner@example.com', 'net-ro');
select public.t_user('refowner', 'ref.owner@example.com');
select public.t_set('code_ro', (public.t_s('ref.owner@example.com'))->>'referral_code');
do $$ begin
  for i in 1..5 loop
    perform public.t_submit('rf' || i, 'referred' || i || '@example.com', 'net-rf-' || i, p_ref := public.t_var('code_ro'));
    perform public.t_confirm('rf' || i);
  end loop;
end $$;
select public.t_eq('E18 five counted referrals, all of them counted at confirm', 'postgres', $q$
  select count(*)::text from public.prelaunch_signups where referral_counted_at is not null
     and referred_by = ((public.t_s('ref.owner@example.com'))->>'id')::uuid $q$, '5');
select public.t_cfg('{"referral_cap":3}');
select public.t_eq('E18b … none is an account yet: the signup reward is paid, the referrals are NOT (referral_requires_account, S15)', 'postgres', $q$
  select public.t_ensure('refowner')::text $q$, '{"error": null, "signup": 75, "granted": 75, "referrals": 0}');
select public.t_user('rf1', 'referred1@example.com');
select public.t_user('rf2', 'referred2@example.com', p_verified := false);
select public.t_eq('E19 one referred address becomes a verified account (another an unverified one) → exactly one referral paid', 'postgres', $q$
  select public.t_ensure('refowner')->>'referrals' $q$, '20');
select public.t_user('rf3', 'referred3@example.com');
select public.t_user('rf4', 'referred4@example.com');
select public.t_user('rf5', 'referred5@example.com');
update auth.users set email_confirmed_at = now() where id = public.t_uid('rf2');
select public.t_set('e20', public.t_ensure('refowner')->>'referrals');
select public.t_eq('E20 all five are verified accounts now: paid up to the cap of 3 claims per account, never more', 'postgres', $q$
  select public.t_var('e20') || ',' || public.t_claims('refowner', 'referral')::text || ',' || public.t_balance('refowner')::text $q$,
  '40,3,160');
select public.t_eq('E21 and stays there', 'postgres', $q$ select public.t_ensure('refowner')->>'granted' $q$, '0');
-- the cap is a PAYOUT rule (review S2): referrals that never become accounts
-- do not use it up
select public.t_confirmed('e_cap0', 'cap.owner@example.com', 'net-cap0');
select public.t_user('capowner', 'cap.owner@example.com');
select public.t_set('code_cap', (public.t_s('cap.owner@example.com'))->>'referral_code');
do $$ begin
  for i in 1..4 loop
    perform public.t_submit('cr' || i, 'capref' || i || '@example.com', 'net-cr-' || i, p_ref := public.t_var('code_cap'));
    perform public.t_confirm('cr' || i);
  end loop;
end $$;
select public.t_user('cr4', 'capref4@example.com');
select public.t_eq('E21b cap 3: four counted, only the 4th became an account → it IS paid (the three that never will do not fill the cap)', 'postgres', $q$
  select (select count(*) from public.prelaunch_signups where referral_counted_at is not null
            and referred_by = ((public.t_s('cap.owner@example.com'))->>'id')::uuid)::text
      || ',' || (public.t_ensure('capowner')->>'referrals') $q$, '4,20');
select public.t_true('E21c a claim keeps the mailbox as a sha256, never an address (review S7)', 'postgres', $q$
  select bool_and(mailbox_hash ~ '^[0-9a-f]{64}$') and bool_and(position('@' in mailbox_hash) = 0)
     and bool_and(mailbox_hash = public.prelaunch_mailbox_hash(s.canonical_email))
    from public.prelaunch_reward_claims c join public.prelaunch_signups s on s.id = c.source_signup
   where c.kind = 'signup' $q$);

-- the cap is per ACCOUNT, not per referrer address (S2)
select public.t_cfg('{"referral_cap":10}');
select public.t_confirmed('e_ro2', 'ref.owner.second@example.com', 'net-ro2');
select public.t_set('code_ro2', (public.t_s('ref.owner.second@example.com'))->>'referral_code');
do $$ begin
  for i in 6..7 loop
    perform public.t_submit('rf' || i, 'referred' || i || '@example.com', 'net-rf-' || i, p_ref := public.t_var('code_ro2'));
    perform public.t_confirm('rf' || i);
    perform public.t_user('rf' || i, 'referred' || i || '@example.com');
  end loop;
end $$;
select public.t_cfg('{"referral_cap":3}');
update auth.users set email = 'ref.owner.second@example.com' where id = public.t_uid('refowner');
select public.t_set('e22', public.t_ensure('refowner')->>'granted');
update auth.users set email = 'ref.owner@example.com' where id = public.t_uid('refowner');
select public.t_eq('E22 the same account moves to another referrer address with 2 payable referrals → still capped at 3 in total', 'postgres', $q$
  select public.t_var('e22') || ',' || public.t_claims('refowner', 'referral')::text $q$, '0,3');

-- a referred address whose account is blocked is not paid (until unblocked)
select public.t_cfg('{"referral_cap":10}');
select public.t_confirmed('e_me', 'me.myself@example.com', 'net-me');
select public.t_user('me', 'me.myself@example.com');
select public.t_set('code_me', (public.t_s('me.myself@example.com'))->>'referral_code');
select public.t_submit('me2', 'blocked.friend@example.com', 'net-me2', p_ref := public.t_var('code_me'));
select public.t_confirm('me2');
select public.t_user('bfriend', 'blocked.friend@example.com');
update public.profiles set blocked = true where id = public.t_uid('bfriend');
select public.t_eq('E23 a counted referral whose account is BLOCKED is not paid…', 'postgres', $q$
  select public.t_ensure('me')->>'referrals' $q$, '0');
update public.profiles set blocked = false where id = public.t_uid('bfriend');
select public.t_eq('E23b … and is paid once the block is lifted', 'postgres', $q$
  select public.t_ensure('me')->>'referrals' $q$, '20');

-- the claim window
select public.t_cfg('{"reward_claim_until":"2020-01-01T00:00:00Z"}');
select public.t_confirmed('e_late', 'late.user@example.com', 'net-late');
select public.t_user('late', 'late.user@example.com');
select public.t_eq('E24 after reward_claim_until no new claim → closed', 'postgres', $q$ select public.t_ensure('late')->>'error' $q$, 'closed');
select public.t_cfg('{"reward_claim_until":null}');

-- the customer sees only their own claims
select public.t_be('main');
select public.t_eq('E25 RLS: the customer reads exactly their own claims', 'authenticated', $q$
  select count(*)::text from public.prelaunch_reward_claims $q$, '1');
select public.t_be('customer');
select public.t_eq('E25b another customer reads none of them', 'authenticated', $q$
  select count(*)::text from public.prelaunch_reward_claims $q$, '0');
select public.t_be('admin');
select public.t_true('E25c an admin reads them all', 'authenticated', $q$ select count(*) > 5 from public.prelaunch_reward_claims $q$);
select public.t_be('customer');
select public.t_eq('E25d a customer cannot read signups, tokens or consents (admin-only)', 'authenticated', $q$
  select ((select count(*) from public.prelaunch_signups) + (select count(*) from public.prelaunch_optin_tokens)
          + (select count(*) from public.prelaunch_consents))::text $q$, '0');

-- E26 setup: an account with five payable referrals (counted under cap 10)
select public.t_confirmed('e_race', 'race.user@example.com', 'net-race');
select public.t_user('racer', 'race.user@example.com');
select public.t_set('code_racer', (public.t_s('race.user@example.com'))->>'referral_code');
do $$ begin
  for i in 1..5 loop
    perform public.t_submit('rr' || i, 'racer.ref' || i || '@example.com', 'net-rr-' || i, p_ref := public.t_var('code_racer'));
    perform public.t_confirm('rr' || i);
    perform public.t_user('rr' || i, 'racer.ref' || i || '@example.com');
  end loop;
end $$;
select public.t_cfg('{"referral_cap":3}');
SQL

  # E26: ten renders of one account at the same moment, each holding its
  # transaction open a little after the call.
  local render="begin; select public.t_ensure('racer'); select pg_sleep(0.1); commit;" renders=() i
  for i in $(seq 1 10); do renders+=("$render"); done
  race "${renders[@]}"
  local failed_backends
  failed_backends=$(cat "$WORK"/race_*.out | grep -c 'ERROR' || true)
  q >/dev/null <<SQL
select public.t_eq('E26 ten parallel renders of one account: one signup claim, exactly the cap of referral claims, balance exact (25 + 75 + 3×20), no backend failed', 'postgres', \$q\$
  select public.t_claims('racer', 'signup')::text || ',' || public.t_claims('racer', 'referral')::text || ','
      || public.t_balance('racer')::text || ',' || '$failed_backends' \$q\$, '1,3,160,0');
SQL
  q >/dev/null <<'SQL'
select public.t_cfg('{"referral_cap":10}');
select public.t_true('E27 never topup: every prelaunch credit is a bonus with created_by set; no topup row exists at all', 'postgres', $q$
  select not exists (select 1 from public.credit_transactions where type = 'topup')
     and (select bool_and(type = 'bonus' and created_by is not null) from public.credit_transactions
           where metadata->>'source' like 'prelaunch%') $q$);
select public.t_true('E28 every wallet balance equals the sum of its ledger, and every claim''s amount equals its transaction', 'postgres', $q$
  select not exists (select 1 from public.credit_wallets w
                      where w.balance <> coalesce((select sum(amount) from public.credit_transactions t where t.wallet_id = w.id), 0))
     and not exists (select 1 from public.prelaunch_reward_claims c left join public.credit_transactions t on t.id = c.credit_transaction_id
                      where coalesce(t.amount, 0) <> c.amount) $q$);
SQL
}

# ── H. ADMIN READS ──────────────────────────────────────────────────────────
admin_checks() {
  q >/dev/null <<'SQL'
-- one pending signup whose only link ran out
select public.t_submit('stale1', 'stale.pending@example.com', 'net-stale');
update public.prelaunch_optin_tokens set expires_at = now() - interval '1 hour' where token_hash = public.t_sha('doi:stale1');
select public.t_be('admin');
select public.t_true('H1  prelaunch_admin_summary: every KPI key of the contract, consistent counts, a rate in [0,1]', 'authenticated', $q$
  select s ?& array['signups', 'confirmed', 'pending', 'expired', 'confirm_rate', 'dois_sent', 'resends', 'send_failures',
                    'by_form', 'by_source', 'by_referrer_host', 'by_channel', 'referrals', 'rewards']
     and (s->>'signups')::int = (s->>'confirmed')::int + (s->>'pending')::int and (s->>'signups')::int > 50
     and (s->>'confirm_rate')::numeric between 0 and 1 and (s->>'dois_sent')::int = 1 and (s->>'send_failures')::int = 1
     and (s->>'resends')::int >= 2 and (s->>'expired')::int >= 1
     and s->'referrals' ?& array['counted', 'rejected', 'top'] and (s->'referrals'->>'counted')::int >= 10
     and s->'rewards' ?& array['signup_claims', 'signup_credits', 'referral_claims', 'referral_credits']
     and (s->'rewards'->>'referral_claims')::int >= 3
     and jsonb_array_length(s->'by_channel') = 1 and s->'by_channel'->0->>'channel' = 'allegro'
     and exists (select 1 from jsonb_array_elements(s->'by_source') e where e->>'utm_source' = 'facebook')
     and exists (select 1 from jsonb_array_elements(s->'by_referrer_host') e where e->>'host' = 'm.facebook.com')
     and exists (select 1 from jsonb_array_elements(s->'by_form') e where e->>'form' = 'final')
     and exists (select 1 from jsonb_array_elements(s->'referrals'->'rejected') e where e->>'reason' = 'cluster')
     and not exists (select 1 from jsonb_array_elements(s->'referrals'->'rejected') e where e->>'reason' = 'cap')
     and (s->'referrals'->'top'->0) ?& array['signup_id', 'email', 'contact_id', 'counted']
     and jsonb_array_length(s->'referrals'->'top') between 1 and 20
    -- 30 days back: D7 moved the one link marked sent 11 days into the past.
    from (select public.prelaunch_admin_summary(now() - interval '30 days', now() + interval '1 minute') as s) x $q$);
select public.t_eq('H2  an empty range: zero counts and a null rate (no division by zero)', 'authenticated', $q$
  select (s->>'signups') || ',' || coalesce(s->>'confirm_rate', 'null')
    from (select public.prelaunch_admin_summary('2000-01-01', '2000-01-02') as s) x $q$, '0,null');
select public.t_true('H3  prelaunch_admin_contact: status, attribution, channel, every consent record with its exact text', 'authenticated', $q$
  select c->'signup'->>'status' = 'confirmed' and c->'signup'->'attribution'->>'utm_source' = 'facebook'
     and c->'signup'->>'seller_channel' = 'allegro' and jsonb_array_length(c->'consents') = 10
     and c->'consents'->0 ?& array['consent_key', 'consent_version', 'consent_text', 'accepted_at', 'confirmed_at', 'doc_versions']
    from (select public.prelaunch_admin_contact((select id from public.newsletter_contacts where email = 'anna.nowak+promo@example.com')) as c) x $q$);
select public.t_true('H4  … a referrer''s view counts its referrals; a referred view names its referrer; no signup → null', 'authenticated', $q$
  select (public.prelaunch_admin_contact((select id from public.newsletter_contacts where email = 'referrer.three@example.com'))
            ->'signup'->>'referrals_counted')::int = 4
     and public.prelaunch_admin_contact((select id from public.newsletter_contacts where email = 'capped1@example.com'))
            ->'signup'->>'referred_by_email' = 'referrer.three@example.com'
     and public.prelaunch_admin_contact((select id from public.newsletter_contacts where email = 'capped1@example.com'))
            ->'signup'->>'referred_by_contact_id'
         = (select id::text from public.newsletter_contacts where email = 'referrer.three@example.com')
     and public.prelaunch_admin_contact(gen_random_uuid()) is null $q$);
SQL
}

# ── X. ERASURE WITHOUT REMOVING ROWS (S4) ───────────────────────────────────
erasure_checks() {
  q >/dev/null <<'SQL'
select public.t_set('erase_contact', (select id::text from public.newsletter_contacts where email = 'friend.one@example.com'));
select public.t_raises('X1  BEFORE the scrub, removing a contact that has a pre-launch signup fails (the FK the scrub exists for)', 'postgres',
  $q$ delete from public.newsletter_contacts where id = public.t_var('erase_contact')::uuid $q$, 'foreign key');
select public.t_be('admin');
select public.t_eq('X2  the admin scrub', 'authenticated',
  $q$ select (public.prelaunch_forget_contact(public.t_var('erase_contact')::uuid))::text $q$, '{"ok": true, "signups": 1}');
select public.t_true('X3  the signup is unlinked and scrubbed (erased address, no name, no network hashes, no answer handle); its links are spent; the legacy row is scrubbed', 'postgres', $q$
  select count(*) = 1 and bool_and(s.contact_id is null and s.email = 'erased:' || s.id and s.canonical_email = 'erased:' || s.id
     and s.first_name is null and s.ip_hash is null and s.last_ip_hash is null and s.answer_hash is null
     and s.referral_counted_at is not null
     and (select bool_and(t.ip_hash is null and t.used_at is not null) from public.prelaunch_optin_tokens t where t.signup_id = s.id)
     and (select bool_and(c.ip_hash is null) from public.prelaunch_consents c where c.signup_id = s.id))
     and not exists (select 1 from public.waitlist_subscribers where email = 'friend.one@example.com')
    from public.prelaunch_signups s where s.email like 'erased:%' $q$);
select public.t_runs('X4  … and the contact can now be removed (here directly; the admin action does it in the app)', 'postgres',
  $q$ delete from public.newsletter_contacts where id = public.t_var('erase_contact')::uuid $q$);
select public.t_be('anon');
select public.t_true('X5  a link of the erased signup is invalid; resending by it is a noop', 'anon', $q$
  select public.t_confirm('f1')->>'status' = 'invalid' and public.t_resend_link('f1x', 'f1')->>'status' = 'noop' $q$);
select public.t_true('X6  the same address can sign up afresh afterwards', 'anon', $q$
  select (public.t_submit('f1new', 'friend.one@example.com', 'net-new')->>'created')::boolean $q$);
SQL
}

# ── I. ONE GALLERY BLOCK PER KEY ────────────────────────────────────────────
gallery_checks() {
  q >/dev/null <<'SQL'
insert into public.cms_pages (slug) values ('premiera'), ('inna');
insert into public.cms_blocks (page_id, type, content) values
  ((select id from public.cms_pages where slug = 'premiera'), 'launch_gallery', '{"gallery":"thumbs","items":[]}');
select public.t_raises('I1  a second launch_gallery block for the same key on the same page → unique violation', 'postgres', $q$
  insert into public.cms_blocks (page_id, type, content) values
    ((select id from public.cms_pages where slug = 'premiera'), 'launch_gallery', '{"gallery":"thumbs","items":[]}') $q$,
  'cms_blocks_one_launch_gallery');
select public.t_runs('I2  other keys on the same page, the same key on another page, and other block types are unaffected', 'postgres', $q$
  insert into public.cms_blocks (page_id, type, content) values
    ((select id from public.cms_pages where slug = 'premiera'), 'launch_gallery', '{"gallery":"retouch","items":[]}'),
    ((select id from public.cms_pages where slug = 'inna'), 'launch_gallery', '{"gallery":"thumbs","items":[]}'),
    ((select id from public.cms_pages where slug = 'premiera'), 'text', '{"gallery":"thumbs"}'),
    ((select id from public.cms_pages where slug = 'premiera'), 'text', '{"gallery":"thumbs"}') $q$);
SQL
}

# ── P. A THIRD APPLY, OVER A POPULATED DATABASE ─────────────────────────────
reapply_checks() {
  local mig="$1"
  q -c "update public.app_settings set value = value || '{\"signup_credits\":250}' where key = 'prelaunch'" >/dev/null
  q -c "insert into public.t_vars values ('schema_before_3', public.t_schema_print()), ('data_before_3', public.t_data_print())
        on conflict (name) do update set v = excluded.v" >/dev/null
  if apply_migration "$mig"; then
    record 'P1  0144 applies a third time over a populated database' true ''
  else
    record 'P1  0144 applies a third time over a populated database' false "$(tr '\n' ' ' < "$ERR")"
    return 0
  fi
  q >/dev/null <<'SQL'
select public.t_true('P2  … changing no function, column, index, policy or grant', 'postgres', $q$
  select public.t_schema_print() = public.t_var('schema_before_3') $q$);
select public.t_true('P3  … and no row: the admin''s edited campaign settings, every signup, token, consent, claim and ledger row are untouched', 'postgres', $q$
  select public.t_data_print() = public.t_var('data_before_3')
     and (select (value->>'signup_credits')::int = 250 from public.app_settings where key = 'prelaunch') $q$);
SQL
}

run_suite() {  # $1 = database, $2 = migration file
  DB="$1"
  SUITE_ABORTED=0
  dropdb "${PGCONN[@]}" --if-exists --force "$DB" >/dev/null 2>&1 || true
  createdb "${PGCONN[@]}" -E UTF8 -T template0 --locale=C "$DB"
  build_rehearsal
  rehearsal_checks
  apply_checks "$2"
  if [ "$SUITE_ABORTED" = "1" ]; then return 0; fi
  grant_checks
  gate_checks
  config_checks
  signup_checks
  confirm_checks
  waitlist_checks
  referral_checks
  reward_checks
  admin_checks
  erasure_checks
  gallery_checks
  reapply_checks "$2"
}

scoreboard() {
  DB="$DB_MAIN"
  q -c "select case when ok then '  PASS ' else '  FAIL ' end || name
                || case when not ok or name like 'Z%' then '  — ' || detail else '' end
          from public.test_results order by seq"
  local failed total passed
  failed=$(q -c "select count(*) from public.test_results where not ok")
  total=$(q -c "select count(*) from public.test_results")
  passed=$((total - failed))
  echo
  echo "prelaunch-sql: PASS $passed / FAIL $failed (of $total)"
  if [ "$failed" != "0" ]; then
    exit 1
  fi
}

# ════════════════════════════════════════════════════════════════════════════
run_suite "$DB_MAIN" "$MIGRATION"

# ── Z. MUTATION TESTS — THE SUITE MUST GO RED ON A BROKEN 0144 ──────────────
#   1. the DOI claim without "used_at is null"   → D5 (a spent link is claimed again)
#   2. the reward ensure granted to anon         → G3 A8
#   3. no referrer lock before counting          → F12 (the duplicate rule races)
mutate() {  # $1 = n, $2 = perl program → path of the mutant
  local out="$WORK/0144_mutant_$1.sql"
  perl -0777 -pe "$2" "$MIGRATION" > "$out"
  echo "$out"
}
MUTANT_FILES=(
  "$(mutate 1 's/where token_hash = p_token_hash and used_at is null and expires_at > now\(\)/where token_hash = p_token_hash and expires_at > now()/')"
  "$(mutate 2 's/grant execute on function public\.prelaunch_reward_ensure\(\) to authenticated;/grant execute on function public.prelaunch_reward_ensure() to anon, authenticated;/')"
  "$(mutate 3 's/select \* into v_ref from public\.prelaunch_signups where id = v_row\.referred_by for update;/select * into v_ref from public.prelaunch_signups where id = v_row.referred_by;/')"
)
MUTANT_LABELS=(
  'prelaunch_confirm claims a token without "used_at is null"'
  'prelaunch_reward_ensure granted to anon'
  'prelaunch_confirm counts without locking the referrer'
)
MUTANT_EXPECT=('D5' 'G3 A8' 'F12')

Z_RESULTS=()
for i in 0 1 2; do
  n=$((i + 1))
  label="Z$n  mutant $n caught (${MUTANT_LABELS[$i]})"
  if [ "${SKIP_MUTANTS:-0}" = "1" ]; then
    continue
  fi
  if [ "$SUITE_ABORTED" = "1" ]; then
    Z_RESULTS+=("$label|false|skipped: the real migration did not apply")
    continue
  fi
  changed=$(diff "$MIGRATION" "${MUTANT_FILES[$i]}" | grep -c '^[<>]' || true)
  if [ "$changed" = "0" ]; then
    Z_RESULTS+=("$label|false|the mutation did not apply: the copy is identical to 0144")
    continue
  fi
  echo "prelaunch-sql: running the suite against mutant $n (${MUTANT_LABELS[$i]})…" >&2
  ( run_suite "${MUTANT_DBS[$i]}" "${MUTANT_FILES[$i]}" ) >/dev/null 2>&1 || true
  DB="${MUTANT_DBS[$i]}"
  applied=$(q -c "select coalesce(bool_and(ok), false) from public.test_results where name like 'M1 %'" 2>/dev/null || echo f)
  red=$(q -c "select coalesce(string_agg(split_part(name, ' ', 1), ' ' order by seq), '') from public.test_results where not ok" 2>/dev/null || echo '?')
  total=$(q -c "select count(*) from public.test_results" 2>/dev/null || echo '?')
  caught=true
  [ "$applied" = "t" ] || caught=false
  for want in ${MUTANT_EXPECT[$i]}; do
    case " $red " in *" $want "*) ;; *) caught=false ;; esac
  done
  Z_RESULTS+=("$label|$caught|diff vs 0144: ${changed} line(s); mutant applied: $applied; red: ${red:-none} of $total checks (must include: ${MUTANT_EXPECT[$i]})")
  [ "${KEEP_DB:-0}" = "1" ] || dropdb "${PGCONN[@]}" --if-exists --force "${MUTANT_DBS[$i]}" >/dev/null 2>&1 || true
done

DB="$DB_MAIN"
for r in "${Z_RESULTS[@]+"${Z_RESULTS[@]}"}"; do
  IFS='|' read -r name ok detail <<<"$r"
  record "$name" "$ok" "$detail"
done

scoreboard
