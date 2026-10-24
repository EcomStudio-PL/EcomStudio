#!/usr/bin/env bash
#
# KONTAKT V2 (0152), PROVEN AGAINST A REAL POSTGRES.
#
# 0152 turns the contact form into tickets: a number, statuses, a private
# bucket for attachments, and writers that only the server can reach. What has
# to hold is not that the happy path works but that NOTHING ELSE does:
#
#   · no visitor and no customer reads a ticket, an attachment row or a file
#     of a sent ticket — only an admin;
#   · no browser creates a ticket or an upload slot around the route (the
#     server token gates every writer), and the old 0086 function is closed;
#   · the account a ticket names is auth.uid() — never something the request
#     says — and a guest's ticket carries no account snapshot;
#   · the limits live in the table (per address, per IP hash), a retried
#     submission is ONE ticket, and a file must be a slot THIS submission
#     reserved (path, type, size, count);
#   · a confirmation retry is claimed, so two runs cannot send it twice.
#
# The rehearsal schema is what 0152 lands on, replayed from the migrations
# that created it (bodies EXTRACTED from the files, not retyped): roles anon /
# authenticated with SUPABASE'S DEFAULT PRIVILEGES, pgcrypto in `extensions`,
# auth.uid() as PROD defines it, profiles, is_admin (0002) with 0005's grants,
# server_call_ok (0077), content_text_ok (0141), contact_messages as 0086
# created it with 0148's topic list and 0148's submit_contact_message, and a
# minimal storage schema (buckets, objects with RLS on, as Supabase has it).
#
# Local harness only, its own database (contact_sqltest), removed on exit
# (KEEP_DB=1 keeps it).
#
#   bash scripts/pg-harness-up.sh && npm run test:contact:sql
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
PGCONN=(-h "$PGSOCK" -p "$PGPORT" -U postgres)

if ! psql "${PGCONN[@]}" -d postgres -X -q -t -A -c 'select 1' >/dev/null 2>&1; then
  echo "contact-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
M="$ROOT/supabase/migrations"
MIGRATION="${MIGRATION:-$M/0152_contact_tickets.sql}"
[ -f "$MIGRATION" ] || { echo "contact-sql: $MIGRATION not found" >&2; exit 2; }

extract() { # file, function name, end marker regex
  awk -v start="^create (or replace )?function public[.]$2[(]" -v stop="$3" \
    '$0 ~ start {on=1} on {print} on && $0 ~ stop {exit}' "$1"
}
IS_ADMIN=$(extract "$M/0002_functions_and_triggers.sql" is_admin '^[$][$];')
SERVER_CALL_OK=$(extract "$M/0077_server_only_rpcs.sql" server_call_ok '^end [$][$];')
TEXT_OK=$(extract "$M/0141_inline_content_editor.sql" content_text_ok '^[$][$];')
SUBMIT_0148=$(extract "$M/0148_public_pages_v1.sql" submit_contact_message '^end [$][$];')
for v in IS_ADMIN SERVER_CALL_OK TEXT_OK SUBMIT_0148; do
  [ -n "${!v}" ] || { echo "contact-sql: could not extract $v" >&2; exit 2; }
done

DB="${CONTACT_DB:-contact_sqltest}"
WORK=$(mktemp -d)
cleanup() {
  [ "${KEEP_DB:-0}" = "1" ] || dropdb "${PGCONN[@]}" --if-exists --force "$DB" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
ERR="$WORK/err"
q() { psql "${PGCONN[@]}" -d "$DB" -v ON_ERROR_STOP=1 -X -q -t -A "$@"; }
record() {
  q -v name="$1" -v ok="$2" -v detail="$3" >/dev/null <<'SQL'
insert into public.test_results (name, ok, detail) values (:'name', :'ok'::boolean, :'detail');
SQL
}

dropdb "${PGCONN[@]}" --if-exists --force "$DB" >/dev/null 2>&1 || true
createdb "${PGCONN[@]}" "$DB"

# ── The rehearsal ───────────────────────────────────────────────────────────
q >/dev/null <<'SQL'
set client_min_messages = warning;
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;
create schema auth; create schema extensions; create schema storage;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema public, auth, extensions, storage to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;

create function auth.uid() returns uuid language sql stable as $f$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$f$;
create table public.profiles (id uuid primary key, email text not null default '', role text not null default 'user');
create table public.app_settings (key text primary key, value jsonb not null default '{}'::jsonb);
alter table public.app_settings enable row level security;
insert into public.app_settings (key, value) values
  ('notifications', jsonb_build_object('dispatch_hash', encode(extensions.digest('contact-test-token', 'sha256'), 'hex')));

-- Supabase storage, as far as policies are concerned.
create table storage.buckets (id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, metadata jsonb, created_at timestamptz default now(), unique (bucket_id, name));
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated;
grant select on storage.buckets to anon, authenticated;
insert into storage.buckets (id, name, public) values ('media', 'media', true), ('product-images', 'product-images', false);

-- 0086, with 0148's topic list.
create table public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  topic text not null default 'other',
  name text not null,
  email text not null,
  message text not null,
  locale text not null default 'pl',
  source text,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  handled_at timestamptz,
  handled_by uuid references public.profiles(id) on delete set null,
  constraint contact_messages_topic_check
    check (topic in ('question', 'sales', 'support', 'partnership', 'press', 'other')),
  constraint contact_messages_status_check
    check (status in ('new', 'handled', 'spam'))
);
alter table public.contact_messages enable row level security;
SQL
{
  echo "set client_min_messages = warning;"
  printf '%s\n' "$IS_ADMIN" "$SERVER_CALL_OK" "$TEXT_OK" "$SUBMIT_0148"
} > "$WORK/bodies.sql"
q -f "$WORK/bodies.sql" >/dev/null 2>"$ERR" || { cat "$ERR" >&2; exit 2; }

q >/dev/null <<'SQL'
set client_min_messages = warning;
-- Helpers name 0152's functions, which do not exist yet.
set check_function_bodies = off;
create policy "contact_messages_admin" on public.contact_messages for all
  to authenticated using (public.is_admin()) with check (public.is_admin());
revoke execute on function public.is_admin(uuid) from public, anon;
grant execute on function public.is_admin(uuid) to authenticated;
revoke all on function public.server_call_ok(text) from public, anon, authenticated;
revoke all on function public.submit_contact_message(text, text, text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.submit_contact_message(text, text, text, text, text, text, jsonb) to anon, authenticated;

-- A message written before 0152, in the old vocabulary.
insert into public.contact_messages (topic, name, email, message, status)
values ('question', 'Ola', 'ola@example.com', 'Stara wiadomość sprzed zmiany.', 'handled'),
       ('support', 'Ela', 'ela@example.com', 'Druga stara wiadomość, nowa.', 'new');

create table public.test_results (name text, ok boolean, detail text, seq serial);
create table public.t_vars (name text primary key, v text);
create function public.t_var(p_name text) returns text language plpgsql volatile as $$
declare v text; begin execute 'select v from public.t_vars where name = $1' into v using p_name; return v; end $$;
create function public.t_set(p_name text, p_v text) returns void language sql as $$
  insert into public.t_vars values (p_name, p_v) on conflict (name) do update set v = excluded.v $$;
create function public.t_tok() returns text language sql immutable as $$ select 'contact-test-token'::text $$;
create function public.t_ip(p text) returns text language sql immutable as $$
  select encode(extensions.digest('ip:' || p, 'sha256'), 'hex') $$;
create function public.t_uid(p_who text) returns uuid language plpgsql volatile as $$
begin return nullif(public.t_var('uid:' || p_who), '')::uuid; end $$;
create function public.t_be(p_who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claims', case
    when p_who = 'anon' then '{"role":"anon"}'
    when public.t_uid(p_who) is not null then json_build_object('sub', public.t_uid(p_who), 'role', 'authenticated')::text
    else '' end, false);
end $$;
create function public.t_user(p_who text, p_role text default 'user') returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  perform public.t_set('uid:' || p_who, v_id::text);
  insert into public.profiles (id, email, role) values (v_id, p_who || '@example.com', p_role);
  return v_id;
end $$;
select public.t_user('customer'); select public.t_user('other'); select public.t_user('admin', 'admin');

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
-- Run `p_sql` (returning jsonb) as `p_role` and keep the answer in t_vars.
create function public.t_keep(p_var text, p_role text, p_sql text)
returns void language plpgsql as $$
declare v jsonb; v_err text;
begin
  begin
    execute format('set local role %I', p_role);
    execute p_sql into v;
  exception when others then v_err := sqlerrm;
  end;
  execute 'reset role';
  perform public.t_set(p_var, coalesce(v::text, 'ERROR: ' || coalesce(v_err, 'null')));
end $$;
-- The route's call, as the current role.
create function public.t_submit(p_sub text, p_email text, p_topic text default 'app',
  p_message text default 'Dzień dobry, mam pytanie o GrovBase.', p_ip text default '1.1.1.1',
  p_nip text default null, p_gen text default null, p_files jsonb default '[]'::jsonb,
  p_account jsonb default '{"plan":"Pro","credits":120}'::jsonb, p_token text default 'contact-test-token')
returns jsonb language sql as $$
  select public.contact_submit(p_token, md5(p_sub)::uuid, p_topic, 'Jan', p_email, p_message, 'pl',
    p_nip, p_gen, p_account, '{"browser":"Firefox"}'::jsonb, public.t_ip(p_ip), p_files, 'kontakt') $$;
SQL

# ── APPLY THE REAL MIGRATION FILE — AND THEN AGAIN ──────────────────────────
apply() { PGOPTIONS='-c client_min_messages=warning' psql "${PGCONN[@]}" -d "$DB" -v ON_ERROR_STOP=1 -X -q -t -A -1 -f "$MIGRATION" >/dev/null 2>"$ERR"; }
if apply; then record 'M0  0152 applies in one transaction' true ''
else record 'M0  0152 applies in one transaction' false "$(tr '\n' ' ' < "$ERR")"; fi
if apply; then record 'M0b and again (re-runnable)' true ''
else record 'M0b and again (re-runnable)' false "$(tr '\n' ' ' < "$ERR")"; fi

q >/dev/null <<'SQL'
-- ── M. WHAT THE APPLY LEFT BEHIND ───────────────────────────────────────
select public.t_true('M1  old values mapped: question→app, support→technical, handled→closed; numbers from 1001', 'postgres', $q$
  select (select topic = 'app' and status = 'closed' and ticket_no >= 1001 from public.contact_messages where email = 'ola@example.com')
     and (select topic = 'technical' and status = 'new' from public.contact_messages where email = 'ela@example.com')
     and (select count(distinct ticket_no) = 2 from public.contact_messages) $q$);
select public.t_raises('M2  the new CHECK refuses an old topic', 'postgres',
  $q$ insert into public.contact_messages (topic, name, email, message) values ('sales', '', 'x@example.com', 'xxxxxxxxxxxx') $q$,
  'contact_messages_topic_check');
select public.t_raises('M3  … and an old status', 'postgres',
  $q$ update public.contact_messages set status = 'handled' where email = 'ola@example.com' $q$, 'contact_messages_status_check');
select public.t_true('M4  the bucket is private, 5 MB, JPG/PNG/WebP only', 'postgres', $q$
  select public = false and file_size_limit = 5242880 and allowed_mime_types = array['image/jpeg','image/png','image/webp']
    from storage.buckets where id = 'contact-attachments' $q$);
select public.t_true('M5  every new writer is SECURITY DEFINER with search_path=public', 'postgres', $q$
  select count(*) = 8 and bool_and(prosecdef and proconfig = '{search_path=public}') from pg_proc
   where proname in ('contact_reserve_uploads', 'contact_submit', 'contact_confirmation_mark', 'contact_confirmations_due',
                     'contact_attachments_expired', 'contact_attachments_forget', 'contact_attachment_pending', 'contact_attachment_removable') $q$);
select public.t_true('M6  no policy on contact_messages or contact_attachments names anon', 'postgres', $q$
  select not exists (select 1 from pg_policies where tablename in ('contact_messages', 'contact_attachments') and 'anon' = any(roles)) $q$);

-- ── A. NOBODY BUT AN ADMIN READS A TICKET ───────────────────────────────
select public.t_be('anon');
select public.t_raises('A1  anon cannot read contact_messages (no privilege at all)', 'anon',
  $q$ select count(*) from public.contact_messages $q$, 'permission denied');
select public.t_raises('A2  anon cannot insert a ticket around the writer', 'anon',
  $q$ insert into public.contact_messages (topic, name, email, message) values ('app', '', 'a@example.com', 'xxxxxxxxxxxx') $q$,
  'permission denied');
select public.t_raises('A3  0086''s submit_contact_message is closed to anon', 'anon',
  $q$ select public.submit_contact_message('question', 'A', 'a@example.com', 'xxxxxxxxxxx', 'pl', null, '{}') $q$,
  'permission denied');
select public.t_raises('A4  anon cannot read attachment rows', 'anon',
  $q$ select count(*) from public.contact_attachments $q$, 'permission denied');
select public.t_be('customer');
select public.t_true('A5  a customer reads no ticket', 'authenticated', $q$ select count(*) = 0 from public.contact_messages $q$);
select public.t_true('A6  a customer cannot change a status (RLS: nothing updated)', 'authenticated', $q$
  with u as (update public.contact_messages set status = 'closed' returning 1) select count(*) = 0 from u $q$);
select public.t_raises('A7  … nor create a ticket directly', 'authenticated',
  $q$ insert into public.contact_messages (topic, name, email, message) values ('app', '', 'c@example.com', 'xxxxxxxxxxxx') $q$,
  'permission denied');
select public.t_raises('A8  0086''s function is closed to a customer too', 'authenticated',
  $q$ select public.submit_contact_message('question', 'A', 'a@example.com', 'xxxxxxxxxxx', 'pl', null, '{}') $q$,
  'permission denied');
select public.t_true('A9  a customer reads no attachment row', 'authenticated', $q$ select count(*) = 0 from public.contact_attachments $q$);
select public.t_be('admin');
select public.t_true('A10 an admin reads every ticket and may change a status', 'authenticated', $q$
  with u as (update public.contact_messages set status = 'in_progress' where email = 'ela@example.com' returning 1)
  select (select count(*) from u) = 1 $q$);

-- ── B. THE WRITERS ANSWER ONLY THE SERVER ───────────────────────────────
select public.t_be('anon');
select public.t_raises('B1  contact_submit without the token: not_allowed', 'anon',
  $q$ select public.t_submit('b1', 'b1@example.com', p_token => null) $q$, 'not_allowed');
select public.t_raises('B2  … with a wrong token: not_allowed', 'anon',
  $q$ select public.t_submit('b1', 'b1@example.com', p_token => 'guess') $q$, 'not_allowed');
select public.t_raises('B3  contact_reserve_uploads without the token: not_allowed', 'anon',
  $q$ select public.contact_reserve_uploads('nope', gen_random_uuid(), 1, public.t_ip('x')) $q$, 'not_allowed');
select public.t_raises('B4  contact_confirmation_mark without the token (anon): not_allowed', 'anon',
  $q$ select public.contact_confirmation_mark('nope', gen_random_uuid(), 'sent', null) $q$, 'not_allowed');
select public.t_raises('B5  contact_confirmations_due without the token: not_allowed', 'anon',
  $q$ select * from public.contact_confirmations_due('nope', 5) $q$, 'not_allowed');
select public.t_raises('B6  the sweep without the token: not_allowed', 'anon',
  $q$ select * from public.contact_attachments_expired('nope', 5) $q$, 'not_allowed');

-- ── C. A TICKET ─────────────────────────────────────────────────────────
select public.t_keep('c1', 'anon', $q$ select public.t_submit('c1', ' Gosc@Example.com ') $q$);
select public.t_true('C1  a guest''s ticket: created, numbered, not a duplicate', 'postgres', $q$
  select (public.t_var('c1')::jsonb ->> 'status') = 'created' and (public.t_var('c1')::jsonb ->> 'ticket')::bigint >= 1001
     and (public.t_var('c1')::jsonb -> 'duplicate') = 'false'::jsonb $q$);
select public.t_true('C2  … stored lower-cased, with NO account and no user, an IP hash, never an IP', 'postgres', $q$
  select email = 'gosc@example.com' and user_id is null and account = '{}'::jsonb and ip_hash ~ '^[0-9a-f]{64}$'
     and status = 'new' and confirmation_status = 'pending' and topic = 'app'
    from public.contact_messages where id = (public.t_var('c1')::jsonb ->> 'id')::uuid $q$);
select public.t_be('customer');
select public.t_keep('c3', 'authenticated', $q$ select public.t_submit('c3', 'customer@example.com', 'payments',
  'Proszę o fakturę za ostatni miesiąc.', '2.2.2.2', 'PL 123-456-78-90') $q$);
select public.t_true('C3  a customer''s ticket names THEM (auth.uid()) and keeps the server''s snapshot and the NIP', 'postgres', $q$
  select user_id = public.t_uid('customer') and account = '{"plan":"Pro","credits":120}'::jsonb and nip = 'PL 123-456-78-90'
     and topic = 'payments'
    from public.contact_messages where id = (public.t_var('c3')::jsonb ->> 'id')::uuid $q$);
select public.t_keep('c4', 'authenticated', $q$ select public.t_submit('c3', 'customer@example.com', 'payments',
  'Proszę o fakturę za ostatni miesiąc.', '2.2.2.2', 'PL 123-456-78-90') $q$);
select public.t_true('C4  the SAME submission again is the same ticket (duplicate), not a second one', 'postgres', $q$
  select (public.t_var('c4')::jsonb ->> 'ticket') = (public.t_var('c3')::jsonb ->> 'ticket')
     and (public.t_var('c4')::jsonb -> 'duplicate') = 'true'::jsonb
     and (select count(*) = 1 from public.contact_messages where email = 'customer@example.com') $q$);
select public.t_keep('c5', 'authenticated', $q$ select public.t_submit('c3', 'someone@example.com') $q$);
select public.t_true('C5  that submission id with ANOTHER address is refused', 'postgres', $q$
  select (public.t_var('c5')::jsonb ->> 'status') = 'invalid' $q$);
select public.t_keep('c6', 'authenticated', $q$ select public.t_submit('c6-new', 'customer@example.com', 'payments',
  'Proszę o fakturę za ostatni miesiąc.', '2.2.2.2', 'PL 123-456-78-90') $q$);
select public.t_true('C6  the same words from the same address within 30 min: the earlier ticket', 'postgres', $q$
  select (public.t_var('c6')::jsonb ->> 'ticket') = (public.t_var('c3')::jsonb ->> 'ticket')
     and (select count(*) = 1 from public.contact_messages where email = 'customer@example.com') $q$);
select public.t_be('anon');
-- Refusals, each with the field it names.
select public.t_true('C7  validation: topic, e-mail, message (min 10, max 5000), name, extras per topic', 'anon', $q$
  select public.t_submit('v1', 'v@example.com', 'sales') ->> 'field' = 'topic'
     and public.t_submit('v2', 'not-an-address') ->> 'field' = 'email'
     and public.t_submit('v3', 'v@example.com', 'app', 'za krótko') ->> 'field' = 'message'
     and public.t_submit('v4', 'v@example.com', 'app', repeat('x', 5001)) ->> 'field' = 'message'
     and public.t_submit('v5', 'v@example.com', 'app', p_nip => '1234567890') ->> 'field' = 'nip'
     and public.t_submit('v6', 'v@example.com', 'payments', p_nip => 'abc') ->> 'field' = 'nip'
     and public.t_submit('v7', 'v@example.com', 'app', p_gen => 'gen_1') ->> 'field' = 'generation'
     and public.t_submit('v8', 'v@example.com', 'other', p_files => '[{"path":"x","name":"a.png","mime":"image/png","size":10}]') ->> 'field' = 'attachments'
     and public.t_submit('v9', 'v@example.com', 'technical', p_files => '{"not":"a list"}') ->> 'field' = 'attachments'
     and public.t_submit('v10', 'v@example.com', 'technical', p_message => E'Treść z \u0007 dzwonkiem') ->> 'field' = 'message' $q$);
select public.t_true('C7b none of the refusals wrote anything', 'postgres', $q$
  select count(*) = 0 from public.contact_messages where email in ('v@example.com', 'not-an-address') $q$);
select public.t_true('C8  a guest''s account snapshot is dropped even when sent', 'postgres', $q$
  select account = '{}'::jsonb from public.contact_messages where id = (public.t_var('c1')::jsonb ->> 'id')::uuid $q$);
-- Rate limits: the address (5 an hour), the IP hash (10 an hour).
select public.t_true('C9  five tickets an hour per address, the sixth is rate_limited', 'anon', $q$
  select (select bool_and(public.t_submit('r' || i, 'rate@example.com', 'other', 'Wiadomość numer ' || i || ' — test limitu.', '9.9.9.' || i) ->> 'status' = 'created')
            from generate_series(1, 5) i)
     and public.t_submit('r6', 'rate@example.com', 'other', 'Wiadomość numer 6 — test limitu.', '9.9.9.6') ->> 'status' = 'rate_limited' $q$);
select public.t_true('C10 ten an hour per IP hash, across addresses', 'anon', $q$
  select (select bool_and(public.t_submit('ip' || i, 'ip' || i || '@example.com', 'other', 'Wiadomość z jednego IP numer ' || i, '7.7.7.7') ->> 'status' = 'created')
            from generate_series(1, 10) i)
     and public.t_submit('ip11', 'ip11@example.com', 'other', 'Wiadomość z jednego IP numer 11', '7.7.7.7') ->> 'status' = 'rate_limited' $q$);

-- ── D. ATTACHMENTS ──────────────────────────────────────────────────────
select public.t_keep('d1', 'anon', $q$ select public.contact_reserve_uploads(public.t_tok(), md5('d')::uuid, 3, public.t_ip('5.5.5.5')) $q$);
select public.t_true('D1  three random slots for the submission', 'postgres', $q$
  select (public.t_var('d1')::jsonb ->> 'status') = 'ok' and jsonb_array_length(public.t_var('d1')::jsonb -> 'paths') = 3
     and (select bool_and(p ~ '^[0-9]{4}-[0-9]{2}/[0-9a-f-]{36}$') from jsonb_array_elements_text(public.t_var('d1')::jsonb -> 'paths') p) $q$);
select public.t_true('D2  four at once is invalid; more than six per submission is too_many', 'anon', $q$
  select public.contact_reserve_uploads(public.t_tok(), md5('d')::uuid, 4, public.t_ip('5.5.5.5')) ->> 'status' = 'invalid'
     and public.contact_reserve_uploads(public.t_tok(), md5('d')::uuid, 3, public.t_ip('5.5.5.5')) ->> 'status' = 'ok'
     and public.contact_reserve_uploads(public.t_tok(), md5('d')::uuid, 1, public.t_ip('5.5.5.5')) ->> 'status' = 'too_many' $q$);
select public.t_true('D3  fifteen slots an hour per IP hash', 'anon', $q$
  select (select bool_and(public.contact_reserve_uploads(public.t_tok(), md5('dd' || i)::uuid, 3, public.t_ip('6.6.6.6')) ->> 'status' = 'ok')
            from generate_series(1, 5) i)
     and public.contact_reserve_uploads(public.t_tok(), md5('dd6')::uuid, 1, public.t_ip('6.6.6.6')) ->> 'status' = 'rate_limited' $q$);
select public.t_true('D4  anon uploads to a reserved path', 'anon', $q$
  with i as (insert into storage.objects (bucket_id, name) values ('contact-attachments', public.t_var('d1')::jsonb -> 'paths' ->> 0) returning 1)
  select count(*) = 1 from i $q$);
select public.t_raises('D5  … but not to any other path', 'anon',
  $q$ insert into storage.objects (bucket_id, name) values ('contact-attachments', '2026-10/' || gen_random_uuid()) $q$, 'row-level security');
select public.t_raises('D6  … nor into another bucket', 'anon',
  $q$ insert into storage.objects (bucket_id, name) values ('product-images', public.t_var('d1')::jsonb -> 'paths' ->> 1) $q$, 'row-level security');
select public.t_true('D7  the server (same session) can read the pending upload back to sniff it', 'anon', $q$
  select count(*) = 1 from storage.objects where bucket_id = 'contact-attachments' and name = public.t_var('d1')::jsonb -> 'paths' ->> 0 $q$);
select public.t_true('D8  files: another submission''s slot, a bad type, too big, twice the same path — all refused', 'anon', $q$
  select public.t_submit('d-other', 'd@example.com', 'technical', p_files => jsonb_build_array(jsonb_build_object(
           'path', public.t_var('d1')::jsonb -> 'paths' ->> 0, 'name', 'a.png', 'mime', 'image/png', 'size', 100))) ->> 'field' = 'attachments'
     and public.t_submit('d', 'd@example.com', 'technical', p_files => jsonb_build_array(jsonb_build_object(
           'path', public.t_var('d1')::jsonb -> 'paths' ->> 0, 'name', 'a.gif', 'mime', 'image/gif', 'size', 100))) ->> 'field' = 'attachments'
     and public.t_submit('d', 'd@example.com', 'technical', p_files => jsonb_build_array(jsonb_build_object(
           'path', public.t_var('d1')::jsonb -> 'paths' ->> 0, 'name', 'a.png', 'mime', 'image/png', 'size', 5242881))) ->> 'field' = 'attachments'
     and public.t_submit('d', 'd@example.com', 'technical', p_files => jsonb_build_array(
           jsonb_build_object('path', public.t_var('d1')::jsonb -> 'paths' ->> 0, 'name', 'a.png', 'mime', 'image/png', 'size', 100),
           jsonb_build_object('path', public.t_var('d1')::jsonb -> 'paths' ->> 0, 'name', 'b.png', 'mime', 'image/png', 'size', 100))) ->> 'field' = 'attachments'
     and public.t_submit('d', 'd@example.com', 'technical', p_files => jsonb_build_array(jsonb_build_object(
           'path', public.t_var('d1')::jsonb -> 'paths' ->> 0, 'name', '../etc/passwd', 'mime', 'image/png', 'size', 100))) ->> 'field' = 'attachments'
     and public.t_submit('d', 'd@example.com', 'technical', p_files => jsonb_build_array(jsonb_build_object(
           'path', public.t_var('d1')::jsonb -> 'paths' ->> 0, 'name', 'a.png', 'mime', 'image/png', 'size', 'duży'))) ->> 'field' = 'attachments' $q$);
select public.t_keep('d9', 'anon', $q$ select public.t_submit('d', 'd@example.com', 'technical',
  'Generator zwraca błąd przy zapisie.', '5.5.5.5', null, 'gen_123', jsonb_build_array(
    jsonb_build_object('path', public.t_var('d1')::jsonb -> 'paths' ->> 0, 'name', 'zrzut ekranu.png', 'mime', 'image/png', 'size', 2048),
    jsonb_build_object('path', public.t_var('d1')::jsonb -> 'paths' ->> 1, 'name', 'drugi.jpg', 'mime', 'image/jpeg', 'size', 4096))) $q$);
select public.t_true('D9  a technical ticket with two files: created, both bound with name, type and size', 'postgres', $q$
  select (public.t_var('d9')::jsonb ->> 'status') = 'created'
     and (select count(*) = 2 and bool_and(bound_at is not null) from public.contact_attachments
           where message_id = (public.t_var('d9')::jsonb ->> 'id')::uuid)
     and (select file_name = 'zrzut ekranu.png' and mime = 'image/png' and size_bytes = 2048 from public.contact_attachments
           where object_path = public.t_var('d1')::jsonb -> 'paths' ->> 0)
     and (select generation_ref = 'gen_123' from public.contact_messages where id = (public.t_var('d9')::jsonb ->> 'id')::uuid) $q$);
select public.t_true('D10 once bound, anon can no longer read the file', 'anon', $q$
  select count(*) = 0 from storage.objects where bucket_id = 'contact-attachments' $q$);
select public.t_true('D11 … nor delete it (0 rows)', 'anon', $q$
  with d as (delete from storage.objects where bucket_id = 'contact-attachments' returning 1) select count(*) = 0 from d $q$);
select public.t_raises('D12 … nor upload over a bound path', 'anon',
  $q$ insert into storage.objects (bucket_id, name) values ('contact-attachments', public.t_var('d1')::jsonb -> 'paths' ->> 1) $q$, 'row-level security');
select public.t_true('D13 a submission already sent cannot reserve more', 'anon', $q$
  select public.contact_reserve_uploads(public.t_tok(), md5('d')::uuid, 1, public.t_ip('5.5.5.5')) ->> 'status' = 'already_sent' $q$);
select public.t_be('customer');
select public.t_true('D14 a customer cannot read the file or the rows', 'authenticated', $q$
  select (select count(*) from storage.objects where bucket_id = 'contact-attachments') = 0
     and (select count(*) from public.contact_attachments) = 0 $q$);
select public.t_be('admin');
select public.t_true('D15 an admin reads the file and the rows', 'authenticated', $q$
  select (select count(*) from storage.objects where bucket_id = 'contact-attachments') = 1
     and (select count(*) from public.contact_attachments where message_id is not null) = 2 $q$);
select public.t_be('anon');
select public.t_true('D16 a refused upload (unbound slot) can be removed by the visitor''s session', 'anon', $q$
  with i as (insert into storage.objects (bucket_id, name) values ('contact-attachments', public.t_var('d1')::jsonb -> 'paths' ->> 2) returning 1),
       n as (select count(*) c from i)
  select (select c from n) = 1 $q$);
select public.t_true('D16b (removed)', 'anon', $q$
  with d as (delete from storage.objects where bucket_id = 'contact-attachments' and name = public.t_var('d1')::jsonb -> 'paths' ->> 2 returning 1)
  select count(*) = 1 from d $q$);

-- ── E. CONFIRMATIONS AND THE SWEEP ──────────────────────────────────────
select public.t_true('E1  the server marks a confirmation failed (attempts +1, error scrubbed)', 'anon', $q$
  select true from (select public.contact_confirmation_mark(public.t_tok(), (public.t_var('c1')::jsonb ->> 'id')::uuid, 'failed', 'smtp <b>@x')) x $q$);
select public.t_true('E1b … stored as failed, one attempt, no markup', 'postgres', $q$
  select confirmation_status = 'failed' and confirmation_attempts = 1 and confirmation_error = 'smtp__b__x'
    from public.contact_messages where id = (public.t_var('c1')::jsonb ->> 'id')::uuid $q$);
select public.t_raises('E2  a bad status is refused', 'anon',
  $q$ select public.contact_confirmation_mark(public.t_tok(), (public.t_var('c1')::jsonb ->> 'id')::uuid, 'pending', null) $q$, 'bad_input');
select public.t_true('E3  the due list claims the failed one …', 'anon', $q$
  select count(*) >= 1 and bool_or(email = 'gosc@example.com') from public.contact_confirmations_due(public.t_tok(), 25) $q$);
select public.t_true('E4  … and a second run right after gets NOTHING of it (claimed: sending)', 'anon', $q$
  select not exists (select 1 from public.contact_confirmations_due(public.t_tok(), 25) where email = 'gosc@example.com') $q$);
select public.t_be('admin');
select public.t_true('E5  an admin may mark it (Wyślij ponownie) without the token', 'authenticated', $q$
  select true from (select public.contact_confirmation_mark(null, (public.t_var('c1')::jsonb ->> 'id')::uuid, 'sent', null)) x $q$);
select public.t_be('customer');
select public.t_raises('E6  a customer may not', 'authenticated',
  $q$ select public.contact_confirmation_mark(null, (public.t_var('c1')::jsonb ->> 'id')::uuid, 'sent', null) $q$, 'not_allowed');
select public.t_be('anon');
-- Age the unused slots past expiry + 1h, then sweep.
update public.contact_attachments set expires_at = now() - interval '2 hours', created_at = now() - interval '3 hours'
 where message_id is null;
select public.t_true('E7  the sweep lists only unbound, expired slots', 'postgres', $q$
  select count(*) > 0 and bool_and(p not in (select object_path from public.contact_attachments where message_id is not null))
    from public.contact_attachments_expired(public.t_tok(), 100) p $q$);
select public.t_true('E8  … forgets them, never a bound one', 'anon', $q$
  select public.contact_attachments_forget(public.t_tok(), (select array_agg(p) from public.contact_attachments_expired(public.t_tok(), 100) p)) > 0 $q$);
select public.t_true('E8b (bound files still there)', 'postgres', $q$
  select (select count(*) from public.contact_attachments where message_id is not null) = 2
     and (select count(*) from public.contact_attachments where message_id is null) = 0 $q$);
SQL

# ── M (again). RE-APPLY OVER A POPULATED DATABASE ──────────────────────────
BEFORE=$(q -c "select md5(string_agg(t::text, '|' order by t.ticket_no)) from public.contact_messages t")
if apply; then record 'M7  re-apply over a populated database' true ''
else record 'M7  re-apply over a populated database' false "$(tr '\n' ' ' < "$ERR")"; fi
AFTER=$(q -c "select md5(string_agg(t::text, '|' order by t.ticket_no)) from public.contact_messages t")
if [ "$BEFORE" = "$AFTER" ]; then record 'M7b … changes no ticket (numbers, statuses, topics)' true ''
else record 'M7b … changes no ticket (numbers, statuses, topics)' false "$BEFORE vs $AFTER"; fi

q -c "select case when ok then '  ✓ ' else '  ✗ ' end || name || case when ok then '' else '  — ' || detail end
      from public.test_results order by seq"
FAILED=$(q -c "select count(*) from public.test_results where not ok")
TOTAL=$(q -c "select count(*) from public.test_results")
if [ "$FAILED" = "0" ]; then
  echo; echo "All $TOTAL Kontakt (0152) SQL tests passed."
else
  echo; echo "$FAILED of $TOTAL FAILED" >&2; exit 1
fi
