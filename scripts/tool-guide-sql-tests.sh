#!/usr/bin/env bash
#
# TOOL GUIDES (0142), PROVEN AGAINST A REAL POSTGRES.
#
# 0142 adds three things a customer's screen depends on:
#
#   · tool_guides — the admin's per-tool tutorial / starter switches and copy.
#     Admin-only under RLS; anon holds no privilege on it at all.
#   · tool_guides_published() — the only way a customer or a visitor reads it:
#     the switches, the version, and the copy of the parts that are ON.
#   · mark_tool_tutorial_seen(tool, version) — "this user has seen version N",
#     merged into user_preferences.metadata.tool_tutorials of the CALLER's row
#     only, highest version wins, other keys untouched.
#
# What has to be proven is not that the happy path works but that nothing else
# does: a customer never reads a draft or an author, never writes a guide,
# never touches another user's preferences; markup and invisible characters
# never reach a page; a disabled tutorial's copy is never handed out. A type
# checker has no opinion about any of that, so every rule is asserted AS the
# caller it is meant to stop — anon, a signed-in customer, an admin, a caller
# that bypasses RLS — against the real migration file, applied verbatim,
# TWICE (it has to be re-runnable) and a THIRD time over a populated database.
#
# And because a guard nobody has watched fail is a guard nobody knows works,
# the last section (X) breaks three copies of 0142 on purpose, runs the same
# suite against each in a fresh database, and records whether the suite went
# red where it should.
#
# It runs against the local harness, never Supabase: DEV and PROD are not
# places to rehearse policy changes. It uses its own databases
# (tool_guides_sqltest, tool_guides_sqltest_m1…m3), created here and dropped
# on exit (KEEP_DB=1 keeps them for a post-mortem), so the harness's other
# databases are never touched.
#
#   bash scripts/pg-harness-up.sh && npm run test:guides:sql
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
PGCONN=(-h "$PGSOCK" -p "$PGPORT" -U postgres)

if ! psql "${PGCONN[@]}" -d postgres -X -q -t -A -c 'select 1' >/dev/null 2>&1; then
  echo "guides-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Overridable, like ice-sql-tests.sh, so the suite can be pointed at any copy.
MIGRATION="${MIGRATION:-$ROOT/supabase/migrations/0142_tool_guides.sql}"
CONTENT_SRC="$ROOT/supabase/migrations/0141_inline_content_editor.sql"
TOOLKEYS_SRC="$ROOT/lib/services/ai-tools.ts"
for f in "$MIGRATION" "$CONTENT_SRC" "$TOOLKEYS_SRC"; do
  [ -f "$f" ] || { echo "guides-sql: $f not found" >&2; exit 2; }
done

DB_MAIN="${GUIDES_DB:-tool_guides_sqltest}"
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
ERR="$WORK/err"; B_OUT="$WORK/race_b"

DB=""   # the database every helper below talks to; set by run_suite
q() { psql "${PGCONN[@]}" -d "$DB" -v ON_ERROR_STOP=1 -X -q -t -A "$@"; }

record() {
  q -v name="$1" -v ok="$2" -v detail="$3" >/dev/null <<'SQL'
insert into public.test_results (name, ok, detail) values (:'name', :'ok'::boolean, :'detail');
SQL
}

# Verbatim, in one transaction (`psql -1`: the file opens with `set local
# lock_timeout`, which only means something inside one).
apply_migration() {  # $1 = migration file
  PGOPTIONS='-c client_min_messages=warning' \
    psql "${PGCONN[@]}" -d "$DB" -v ON_ERROR_STOP=1 -X -q -t -A -1 -f "$1" >/dev/null 2>"$ERR"
}

# ── A throwaway rehearsal of the schema 0142 lands on ───────────────────────
#
# Exactly what 0142 depends on, replayed from the migrations that created it:
#   · roles anon / authenticated and SUPABASE'S DEFAULT PRIVILEGES — every
#     table and function the owner creates in `public` is granted to anon and
#     authenticated (and functions to PUBLIC, Postgres's own default), so RLS
#     and explicit revokes are the only locks. That is what 0142's revokes are
#     written against, and what makes "anon has no privilege" mean something;
#   · auth.uid() exactly as PROD defines it (request.jwt.claim.sub, then
#     request.jwt.claims ->> 'sub'), so a test BEs a caller by setting the
#     same settings PostgREST sets;
#   · profiles (0001: id, role — role kept as text here; 0142 only references
#     the key) and is_admin (0002 body, 0005 grants: authenticated only);
#   · ai_tools (0070: the key, RLS, the ai_tools_admin policy) with one row per
#     AI_TOOL_KEYS entry of lib/services/ai-tools.ts (checked in R1);
#   · user_preferences (0001:21-27 verbatim), its RLS (0003:3) and
#     prefs_all_own policy (0003:29-30), touch_updated_at + preferences_touch
#     (0002:104-114) with 0005's revoke and pinned search_path;
#   · content_text_ok copied verbatim from 0141 (checked in R2).
build_rehearsal() {
  q >/dev/null <<'SQL'
set client_min_messages = warning;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

create schema auth;
grant usage on schema public, auth to anon, authenticated;

alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;

-- PROD's auth.uid(), verbatim.
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;

-- ── profiles: 0001 (only id and role matter to 0142) ──────────────────────
create table public.profiles (id uuid primary key, role text not null default 'user');

-- ── is_admin: 0002 body, 0005 grants ──────────────────────────────────────
create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = uid and role = 'admin');
$$;
revoke execute on function public.is_admin(uuid) from public, anon;
grant execute on function public.is_admin(uuid) to authenticated;

-- ── user_preferences: 0001:21-27 verbatim, 0003 RLS + policy ──────────────
create table public.user_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  locale text not null default 'pl' check (locale in ('pl','en','de')),
  theme text not null default 'system' check (theme in ('light','dark','system')),
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_preferences enable row level security;
create policy "prefs_all_own" on public.user_preferences for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── touch_updated_at + preferences_touch: 0002:104-114, 0005 hardening ────
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create trigger preferences_touch before update on public.user_preferences for each row execute function public.touch_updated_at();
revoke execute on function public.touch_updated_at() from public, anon, authenticated;
alter function public.touch_updated_at() set search_path = public;

-- ── ai_tools: 0070 (the key 0142's FK points at; RLS admin-only) ──────────
create table public.ai_tools (
  tool_key text primary key,
  engine_mode text not null default 'off',
  updated_at timestamptz not null default now()
);
alter table public.ai_tools enable row level security;
create policy ai_tools_admin on public.ai_tools for all to authenticated
  using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
-- lib/services/ai-tools.ts AI_TOOL_KEYS, all 20 (R1 compares with the file).
insert into public.ai_tools (tool_key) values
  ('prompts'), ('generator'), ('retouch'),
  ('editor'), ('resize'), ('compress'),
  ('tool_upscale'), ('tool_expand'), ('tool_watermark'),
  ('tool_remove_bg'), ('tool_white_bg'), ('tool_ai_background'), ('tool_ai_shadow'),
  ('video'),
  ('fashion_ghost_mannequin'), ('fashion_flat_lay'), ('fashion_iron'), ('fashion_change_person'),
  ('fashion_change_face'),
  ('ecommerce_thumbnail');

-- ── content_text_ok: 0141, verbatim (R2 compares with the file) ───────────
create or replace function public.content_text_ok(p text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p is not null
    and p !~ '[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\u3164\uFEFF\uFFA0<>]'
    and p !~ '[\U000E0000-\U000E007F]';
$$;

-- ── The people, and the preferences rows they have before 0142 ────────────
-- (handle_new_user, 0002:75, gives every signup a row; 'noprefs' is the
-- edge the migration's own comment allows for.)
insert into public.profiles (id, role) values
  ('ad000000-0000-0000-0000-000000000001', 'admin'),
  ('c0000000-0000-0000-0000-000000000001', 'user'),   -- customer
  ('c0000000-0000-0000-0000-000000000002', 'user'),   -- other
  ('c0000000-0000-0000-0000-000000000003', 'user'),   -- noprefs (no row)
  ('c0000000-0000-0000-0000-000000000004', 'user'),   -- legacy (odd values)
  ('c0000000-0000-0000-0000-000000000005', 'user');   -- allkeys
insert into public.user_preferences (user_id, locale, theme, metadata, updated_at) values
  ('ad000000-0000-0000-0000-000000000001', 'pl', 'system', '{}', now() - interval '1 day'),
  ('c0000000-0000-0000-0000-000000000001', 'en', 'dark',
   '{"onboarding":{"done":true},"sidebar":"collapsed"}', now() - interval '1 day'),
  ('c0000000-0000-0000-0000-000000000002', 'de', 'light',
   '{"tool_tutorials":{"retouch":7,"prompts":2},"pinned":["retouch"]}', now() - interval '1 day'),
  ('c0000000-0000-0000-0000-000000000004', 'pl', 'system',
   '{"tool_tutorials":{"retouch":"seen","prompts":true},"beta":1}', now() - interval '1 day'),
  ('c0000000-0000-0000-0000-000000000005', 'pl', 'system', '{}', now() - interval '1 day');

-- ── The scoreboard and its helpers ────────────────────────────────────────
create table public.test_results (name text, ok boolean, detail text, seq serial);

/* Values a later assertion needs from an earlier one. Granted to every role
   by the default privileges above, so a test can read it while it runs AS
   the role under test. */
create table public.t_vars (name text primary key, v text);
create function public.t_var(p_name text) returns text language sql stable as $$
  select v from public.t_vars where name = p_name
$$;

create function public.t_uid(p_who text) returns uuid language sql immutable as $$
  select (case p_who
    when 'admin'    then 'ad000000-0000-0000-0000-000000000001'
    when 'customer' then 'c0000000-0000-0000-0000-000000000001'
    when 'other'    then 'c0000000-0000-0000-0000-000000000002'
    when 'noprefs'  then 'c0000000-0000-0000-0000-000000000003'
    when 'legacy'   then 'c0000000-0000-0000-0000-000000000004'
    when 'allkeys'  then 'c0000000-0000-0000-0000-000000000005'
  end)::uuid
$$;

/* BE a caller: the JWT settings PostgREST sets. Session-level, so they hold
   for the rest of the heredoc — and ONLY that heredoc: every heredoc is its
   own session, so each one calls t_be() itself. 'anon' carries no sub,
   'nosub' is a signed-in role whose token has none, 'nobody' carries
   nothing at all. */
create function public.t_be(p_who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claims', case
    when p_who = 'anon' then '{"role":"anon"}'
    when p_who = 'nosub' then '{"role":"authenticated"}'
    when public.t_uid(p_who) is not null
      then json_build_object('sub', public.t_uid(p_who), 'role', 'authenticated')::text
    else '' end, false);
end $$;

/* Run `p_sql` AS `p_role` and record whether it raised something containing
   `p_needle`. The role is reset before the result is written, or the insert
   itself would run as the role under test. */
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
    values (p_name, v_err is not null and v_err like '%' || p_needle || '%',
            coalesce(v_err, '(no error raised)'));
end $$;

/* Run a boolean `select` as `p_role`. An error is a failure, reported as one
   rather than aborting the run. */
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

/* Run `p_sql` as `p_role`; it passes when it raises nothing. For calls whose
   effect a LATER statement checks (a write is invisible to the snapshot of
   the statement that made it). */
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

/* A complete, valid guide in the shape lib/tool-guides.ts saves: PL/EN/DE,
   a nested steps array, diacritics and dashes that are allowed. */
create function public.t_valid_content() returns jsonb language sql immutable as $$
  select '{
    "tutorial": {
      "title": {"pl": "Retusz w trzech krokach", "en": "Retouch in three steps", "de": "Retusche in drei Schritten"},
      "body":  {"pl": "Dodaj zdjęcie produktu — resztę zrobimy za Ciebie.",
                "en": "Add a product photo — we do the rest.",
                "de": "Füge ein Produktfoto hinzu – den Rest übernehmen wir."},
      "steps": [
        {"title": {"pl": "Wgraj zdjęcie", "en": "Upload a photo", "de": "Foto hochladen"},
         "body":  {"pl": "Jedno ujęcie, dobre światło.", "en": "One shot, good light.", "de": "Ein Bild, gutes Licht."},
         "art": "upload"},
        {"title": {"pl": "Wybierz jakość", "en": "Pick a quality", "de": "Qualität wählen"},
         "body":  {"pl": "2K lub 4K.", "en": "2K or 4K.", "de": "2K oder 4K."},
         "art": "quality"}
      ]
    },
    "starter": {
      "title": {"pl": "Zacznij od przykładu", "en": "Start from an example", "de": "Mit einem Beispiel beginnen"},
      "body":  {"pl": "Zobacz, co potrafi Retusz.", "en": "See what Retouch can do.", "de": "Sieh, was die Retusche kann."}
    }
  }'::jsonb
$$;

/* Every row 0142 writes or guards, as one digest — read as the owner, so RLS
   hides nothing. plpgsql: tool_guides does not exist until 0142 creates it. */
create function public.t_fingerprint() returns text language plpgsql stable as $$
begin
  return md5(
    (select coalesce(string_agg(t::text, '|' order by t::text), '') from public.tool_guides t) || '#' ||
    (select coalesce(string_agg(t::text, '|' order by t::text), '') from public.user_preferences t) || '#' ||
    (select coalesce(string_agg(t::text, '|' order by t::text), '') from public.ai_tools t) || '#' ||
    (select coalesce(string_agg(t::text, '|' order by t::text), '') from public.profiles t));
end $$;

/* Everything that exists BEFORE 0142 and that 0142 must leave alone: rows,
   function definitions and grants, policies, table grants and RLS flags. */
create function public.t_legacy_print() returns text language sql stable as $$
  select md5(
    (select coalesce(string_agg(t::text, '|' order by t::text), '') from public.user_preferences t) || '#' ||
    (select coalesce(string_agg(t::text, '|' order by t::text), '') from public.ai_tools t) || '#' ||
    (select coalesce(string_agg(t::text, '|' order by t::text), '') from public.profiles t) || '#' ||
    (select string_agg(p.oid::regprocedure::text || ':' || md5(p.prosrc || '|' || coalesce(p.proacl::text, '') || '|'
                       || p.prosecdef::text || '|' || p.provolatile::text || '|' || coalesce(array_to_string(p.proconfig, ','), '')),
                       ',' order by p.oid::regprocedure::text)
       from pg_proc p
      where p.oid in ('public.is_admin(uuid)'::regprocedure, 'public.content_text_ok(text)'::regprocedure,
                      'auth.uid()'::regprocedure, 'public.touch_updated_at()'::regprocedure)) || '#' ||
    (select string_agg(tablename || '.' || policyname || ':' || cmd || roles::text || coalesce(qual, '') || coalesce(with_check, ''),
                       ',' order by tablename, policyname)
       from pg_policies where schemaname = 'public' and tablename in ('user_preferences', 'ai_tools')) || '#' ||
    (select string_agg(relname || ':' || coalesce(relacl::text, '') || relrowsecurity::text, ',' order by relname)
       from pg_class where oid in ('public.user_preferences'::regclass, 'public.ai_tools'::regclass, 'public.profiles'::regclass)) || '#' ||
    (select count(*)::text from pg_trigger where tgrelid = 'public.user_preferences'::regclass and not tgisinternal))
$$;

/* The three functions 0142 creates: body, signature, result, grants,
   definer/invoker, volatility, search_path. */
create function public.t_fn_print() returns text language sql stable as $$
  select count(*)::text || '#' || coalesce(string_agg(p.oid::regprocedure::text || ':' || md5(
           p.prosrc || '|' || pg_get_function_result(p.oid) || '|' || coalesce(p.proacl::text, '') || '|'
           || p.prosecdef::text || '|' || p.provolatile::text || '|' || coalesce(array_to_string(p.proconfig, ','), '')),
         ',' order by p.oid::regprocedure::text), '')
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('tool_guide_content_ok', 'tool_guides_published', 'mark_tool_tutorial_seen')
$$;
SQL
}

# ── R. THE REHEARSAL IS WHAT IT CLAIMS TO BE ────────────────────────────────
rehearsal_checks() {
  local code_keys db_keys file_md5 db_md5
  code_keys=$(perl -0777 -ne 'if (/export const AI_TOOL_KEYS = \[(.*?)\] as const/s) {
      my $b = $1; $b =~ s{//[^\n]*}{}g; my @k = ($b =~ /"([^"]+)"/g); print join(",", sort @k) }' "$TOOLKEYS_SRC")
  db_keys=$(q -c "select string_agg(tool_key, ',' order by tool_key collate \"C\") from public.ai_tools")
  if [ -n "$code_keys" ] && [ "$code_keys" = "$db_keys" ] && [ "$(tr ',' '\n' <<<"$db_keys" | wc -l)" = "20" ]; then
    record "R1  the rehearsal's ai_tools rows are exactly the 20 AI_TOOL_KEYS of lib/services/ai-tools.ts" true ''
  else
    record "R1  the rehearsal's ai_tools rows are exactly the 20 AI_TOOL_KEYS of lib/services/ai-tools.ts" false \
      "code: $code_keys / rehearsal: $db_keys"
  fi

  file_md5=$(perl -0777 -ne 'print $1 if /create or replace function public\.content_text_ok\(p text\)\n.*?\nas \$\$(.*?)\$\$;/s' \
               "$CONTENT_SRC" | md5sum | cut -d' ' -f1)
  db_md5=$(q -c "select md5(prosrc) from pg_proc where oid = 'public.content_text_ok(text)'::regprocedure
                    and provolatile = 'i' and proconfig = '{search_path=public}'")
  if [ "$file_md5" = "$db_md5" ]; then
    record "R2  content_text_ok is 0141's, byte for byte (immutable, search_path pinned)" true ''
  else
    record "R2  content_text_ok is 0141's, byte for byte (immutable, search_path pinned)" false "0141: $file_md5 / rehearsal: $db_md5"
  fi

  q >/dev/null <<'SQL'
select set_config('request.jwt.claim.sub', '', false),
       set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-000000000001","role":"authenticated"}', false);
insert into public.t_vars values ('r3_claims', coalesce(auth.uid()::text, 'null'));
select set_config('request.jwt.claim.sub', 'ad000000-0000-0000-0000-000000000001', false),
       set_config('request.jwt.claims', '', false);
insert into public.t_vars values ('r3_legacy', coalesce(auth.uid()::text, 'null'));
select public.t_be('anon');
insert into public.t_vars values ('r3_anon', coalesce(auth.uid()::text, 'null'));
select public.t_be('customer');
insert into public.t_vars values ('r3_be', coalesce(auth.uid()::text, 'null'));

select public.t_true(
  'R3  auth.uid() reads request.jwt.claims ->> ''sub'' and the legacy request.jwt.claim.sub, null for anon',
  'postgres', $q$
  select public.t_var('r3_claims') = 'c0000000-0000-0000-0000-000000000001'
     and public.t_var('r3_legacy') = 'ad000000-0000-0000-0000-000000000001'
     and public.t_var('r3_anon') = 'null'
     and public.t_var('r3_be') = 'c0000000-0000-0000-0000-000000000001' $q$);
select public.t_true(
  'R4  is_admin is a definer over profiles.role, executable by authenticated and not by anon',
  'postgres', $q$
  select p.prosecdef
     and not has_function_privilege('anon', p.oid, 'execute')
     and has_function_privilege('authenticated', p.oid, 'execute')
     and public.is_admin(public.t_uid('admin'))
     and not public.is_admin(public.t_uid('customer'))
    from pg_proc p where p.oid = 'public.is_admin(uuid)'::regprocedure $q$);
insert into public.t_vars values ('legacy_before', public.t_legacy_print());
SQL
}

# ── M. APPLY THE REAL MIGRATION FILE — AND THEN AGAIN ───────────────────────
apply_checks() {  # $1 = migration file
  local mig="$1" hits
  # Comments stripped (-- and /* */), then any DROP or TRUNCATE word and any
  # DELETE that is not the `on delete` of a foreign key — anywhere, function
  # bodies included.
  hits=$(perl -0777 -ne 's{/\*.*?\*/}{}gs; s{--[^\n]*}{}g; my @h;
           push @h, lc $1 while /\b(drop|truncate)\b/gi;
           push @h, "delete" while /(?<!on\s)\bdelete\b/gi;
           print join(" ", @h)' "$mig")
  if [ -z "$hits" ]; then
    record 'M0  0142 is purely additive: no DROP / TRUNCATE / DELETE statement anywhere (comments aside)' true ''
  else
    record 'M0  0142 is purely additive: no DROP / TRUNCATE / DELETE statement anywhere (comments aside)' false "found: $hits"
  fi

  if apply_migration "$mig"; then
    record 'M1  0142 applies to the pre-0142 schema in one transaction' true ''
  else
    # Nothing after this would mean anything: the schema is still pre-0142.
    # (A flag, not a non-zero return: calling this from an `if` would switch
    # `set -e` off inside it and let a broken heredoc drop checks silently.)
    record 'M1  0142 applies to the pre-0142 schema in one transaction' false "$(tr '\n' ' ' < "$ERR")"
    SUITE_ABORTED=1
    return 0
  fi
  q -c "insert into public.t_vars values ('fn_after_1', public.t_fn_print()),
          ('con_after_1', (select count(*)::text from pg_constraint where conrelid = 'public.tool_guides'::regclass))" >/dev/null
  if apply_migration "$mig"; then
    record 'M2  and applies again on top of itself (re-runnable)' true ''
  else
    record 'M2  and applies again on top of itself (re-runnable)' false "$(tr '\n' ' ' < "$ERR")"
  fi

  q >/dev/null <<'SQL'
select public.t_true(
  'M3  after the second apply there is exactly ONE policy on tool_guides: tool_guides_admin, ALL, to authenticated',
  'postgres', $q$
  select count(*) = 1
     and bool_and(policyname = 'tool_guides_admin' and cmd = 'ALL' and roles = '{authenticated}' and permissive = 'PERMISSIVE')
    from pg_policies where schemaname = 'public' and tablename = 'tool_guides' $q$);
select public.t_true(
  'M4  and the three functions are what the first apply made: same bodies, results, grants, definer, volatility, search_path',
  'postgres', $q$ select public.t_fn_print() = public.t_var('fn_after_1') and public.t_fn_print() like '3#%' $q$);
select public.t_true(
  'M5  and one of each constraint: pkey, FK to ai_tools (cascade), FK to profiles (set null), version CHECK, content CHECK',
  'postgres', $q$
  select (select count(*)::text from pg_constraint where conrelid = 'public.tool_guides'::regclass) = public.t_var('con_after_1')
     and (select array_agg(conname::text order by conname::text collate "C") from pg_constraint
           where conrelid = 'public.tool_guides'::regclass)
         = array['tool_guides_content_check', 'tool_guides_pkey', 'tool_guides_tool_key_fkey',
                 'tool_guides_tutorial_version_check', 'tool_guides_updated_by_fkey']
     and (select confdeltype = 'c' and confrelid = 'public.ai_tools'::regclass from pg_constraint
           where conname = 'tool_guides_tool_key_fkey')
     and (select confdeltype = 'n' and confrelid = 'public.profiles'::regclass from pg_constraint
           where conname = 'tool_guides_updated_by_fkey') $q$);
select public.t_true(
  'M6  RLS is on for tool_guides',
  'postgres', $q$ select relrowsecurity from pg_class where oid = 'public.tool_guides'::regclass $q$);
select public.t_true(
  'M7  anon holds no privilege of any kind on tool_guides (table or column), and neither does PUBLIC',
  'postgres', $q$
  select not has_table_privilege('anon', 'public.tool_guides', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     and not has_any_column_privilege('anon', 'public.tool_guides', 'SELECT,INSERT,UPDATE,REFERENCES')
     and not exists (select 1 from pg_class c, aclexplode(c.relacl) a
                      where c.oid = 'public.tool_guides'::regclass and a.grantee in (0, 'anon'::regrole)) $q$);
select public.t_true(
  'M8  tool_guides_published() is executable by anon and authenticated — and NOT by PUBLIC',
  'postgres', $q$
  select p.proacl is not null
     and has_function_privilege('anon', p.oid, 'execute')
     and has_function_privilege('authenticated', p.oid, 'execute')
     and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
    from pg_proc p where p.oid = 'public.tool_guides_published()'::regprocedure $q$);
select public.t_true(
  'M9  tool_guides_published() is SECURITY DEFINER, STABLE, search_path pinned to public',
  'postgres', $q$
  select p.prosecdef and p.provolatile = 's' and p.proconfig = '{search_path=public}'
    from pg_proc p where p.oid = 'public.tool_guides_published()'::regprocedure $q$);
select public.t_true(
  'M10 mark_tool_tutorial_seen is executable by authenticated ONLY: not anon, not PUBLIC',
  'postgres', $q$
  select p.proacl is not null
     and not has_function_privilege('anon', p.oid, 'execute')
     and has_function_privilege('authenticated', p.oid, 'execute')
     and (select array_agg(a.grantee::regrole::text) from aclexplode(p.proacl) a
           where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner) = array['authenticated']
    from pg_proc p where p.oid = 'public.mark_tool_tutorial_seen(text, integer)'::regprocedure $q$);
select public.t_true(
  'M11 mark_tool_tutorial_seen is SECURITY INVOKER (RLS applies to it), plpgsql, search_path pinned',
  'postgres', $q$
  select not p.prosecdef and l.lanname = 'plpgsql' and p.proconfig = '{search_path=public}'
    from pg_proc p join pg_language l on l.oid = p.prolang
   where p.oid = 'public.mark_tool_tutorial_seen(text, integer)'::regprocedure $q$);
select public.t_true(
  'M12 tool_guide_content_ok is IMMUTABLE (fit for a CHECK), search_path pinned',
  'postgres', $q$
  select p.provolatile = 'i' and p.proconfig = '{search_path=public}'
    from pg_proc p where p.oid = 'public.tool_guide_content_ok(jsonb)'::regprocedure $q$);
select public.t_true(
  'M13 nothing that existed before 0142 changed: rows, is_admin / content_text_ok / auth.uid / touch, policies, grants, RLS',
  'postgres', $q$ select public.t_legacy_print() = public.t_var('legacy_before') $q$);
SQL
}

# ── A. tool_guides AS EACH CALLER ───────────────────────────────────────────
table_checks() {
  q >/dev/null <<'SQL'
-- ── an admin ──
select public.t_be('admin');
select public.t_runs(
  'A1  an admin can INSERT a guide (retouch, full PL/EN/DE content, updated_by = the admin)',
  'authenticated', $q$
  insert into public.tool_guides (tool_key, content, updated_by)
  values ('retouch', public.t_valid_content(), auth.uid()) $q$);
select public.t_runs(
  'A2  … and four more: tutorial off, starter off, both off, and NULL content (the shipped default)',
  'authenticated', $q$
  insert into public.tool_guides (tool_key, tutorial_enabled, starter_enabled, tutorial_version, content, updated_by) values
    ('prompts',      false, true,  5, public.t_valid_content(), auth.uid()),
    ('generator',    true,  false, 1, public.t_valid_content(), auth.uid()),
    ('editor',       false, false, 3, public.t_valid_content(), auth.uid()),
    ('tool_upscale', true,  true,  1, null,                     auth.uid()) $q$);
select public.t_true(
  'A3  an admin SELECTs all five, content as saved; a NULL-content row took the defaults (on, on, version 1)',
  'authenticated', $q$
  select (select count(*) = 5 from public.tool_guides)
     and (select content = public.t_valid_content() and updated_by = public.t_uid('admin')
            from public.tool_guides where tool_key = 'retouch')
     and (select content is null and tutorial_enabled and starter_enabled and tutorial_version = 1
            from public.tool_guides where tool_key = 'tool_upscale') $q$);
select public.t_true(
  'A4  an admin can UPDATE (retouch → version 2) and the change sticks',
  'authenticated', $q$
  with u as (update public.tool_guides set tutorial_version = 2, updated_at = now(), updated_by = auth.uid()
              where tool_key = 'retouch' returning 1)
  select count(*) = 1 from u $q$);
select public.t_true(
  'A5  (… read back: version 2)',
  'authenticated', $q$ select tutorial_version = 2 from public.tool_guides where tool_key = 'retouch' $q$);
select public.t_raises(
  'A6  the FK refuses a tool_key that is not in ai_tools',
  'authenticated', $q$ insert into public.tool_guides (tool_key) values ('not_a_tool') $q$,
  'tool_guides_tool_key_fkey');

-- The content CHECK. Every refusal targets 'resize', which exists in ai_tools
-- and has no guide, so the CHECK is the only thing that can refuse it.
select public.t_raises('A7  content CHECK refuses markup <b>…</b>', 'authenticated',
  $q$ insert into public.tool_guides (tool_key, content)
      values ('resize', '{"tutorial":{"title":{"pl":"<b>Retusz</b>"}}}') $q$, 'tool_guides_content_check');
select public.t_raises('A8  content CHECK refuses a zero-width space (U+200B)', 'authenticated',
  $q$ insert into public.tool_guides (tool_key, content)
      values ('resize', jsonb_build_object('starter', jsonb_build_object('body', jsonb_build_object('en', U&'Re\200Btouch')))) $q$,
  'tool_guides_content_check');
select public.t_raises('A9  content CHECK refuses a Unicode TAG character (U+E0041)', 'authenticated',
  $q$ insert into public.tool_guides (tool_key, content)
      values ('resize', jsonb_build_object('tutorial', jsonb_build_object('title', jsonb_build_object('de', U&'Retusche\+0E0041')))) $q$,
  'tool_guides_content_check');
select public.t_raises('A10 content CHECK refuses a 2001-character string leaf (inside the steps array)', 'authenticated',
  $q$ insert into public.tool_guides (tool_key, content)
      values ('resize', jsonb_build_object('tutorial', jsonb_build_object('steps', jsonb_build_array(
                jsonb_build_object('body', jsonb_build_object('pl', repeat('a', 2001))))))) $q$,
  'tool_guides_content_check');
select public.t_raises('A11 content CHECK reaches every level: markup in a string of an array, in an object, in an array', 'authenticated',
  $q$ insert into public.tool_guides (tool_key, content)
      values ('resize', '{"tutorial":{"steps":[{"title":{"pl":"ok"}},{"tags":["ok","a > b"]}]}}') $q$,
  'tool_guides_content_check');
select public.t_raises('A12 content CHECK refuses a non-object document: an array', 'authenticated',
  $q$ insert into public.tool_guides (tool_key, content) values ('resize', '[{"pl":"Retusz"}]') $q$,
  'tool_guides_content_check');
select public.t_raises('A13 content CHECK refuses a non-object document: a bare string', 'authenticated',
  $q$ insert into public.tool_guides (tool_key, content) values ('resize', '"Retusz"') $q$,
  'tool_guides_content_check');
select public.t_raises('A14 content CHECK refuses a document over 64 KiB, every string in it valid (40 × 1900 chars)', 'authenticated',
  $q$ insert into public.tool_guides (tool_key, content)
      select 'resize', jsonb_build_object('tutorial', jsonb_object_agg('k' || g, repeat('a', 1900)))
        from generate_series(1, 40) g $q$,
  'tool_guides_content_check');
select public.t_true(
  'A15 a 2000-character leaf is fine (the bound is inclusive)',
  'authenticated', $q$
  with i as (insert into public.tool_guides (tool_key, content)
             values ('video', jsonb_build_object('starter', jsonb_build_object('body', jsonb_build_object('pl', repeat('a', 2000)))))
             returning 1)
  select count(*) = 1 from i $q$);
select public.t_true(
  'A16 a document just under 64 KiB is fine (30 × 1900 chars)',
  'authenticated', $q$
  with u as (update public.tool_guides
                set content = (select jsonb_build_object('tutorial', jsonb_object_agg('k' || g, repeat('a', 1900)))
                                 from generate_series(1, 30) g)
              where tool_key = 'video' returning octet_length(content::text) as n)
  select count(*) = 1 and bool_and(n between 50000 and 65536) from u $q$);
select public.t_raises('A17 tutorial_version 0 is refused', 'authenticated',
  $q$ insert into public.tool_guides (tool_key, tutorial_version) values ('resize', 0) $q$,
  'tool_guides_tutorial_version_check');
select public.t_raises('A18 tutorial_version 1000001 is refused', 'authenticated',
  $q$ insert into public.tool_guides (tool_key, tutorial_version) values ('resize', 1000001) $q$,
  'tool_guides_tutorial_version_check');
select public.t_true(
  'A19 tutorial_version 1 and 1000000 are both fine (the bounds are inclusive)',
  'authenticated', $q$
  with u as (update public.tool_guides set tutorial_version = 1000000
              where tool_key = 'video' and tutorial_version = 1 returning tutorial_version)
  select count(*) = 1 and bool_and(tutorial_version = 1000000) from u $q$);
-- A writer that skips RLS (the SQL editor, a service-role path) meets the
-- same CHECK.
select public.t_raises('A20 the content CHECK binds a writer that bypasses RLS too', 'postgres',
  $q$ insert into public.tool_guides (tool_key, content)
      values ('resize', '{"starter":{"title":{"en":"<script>x</script>"}}}') $q$, 'tool_guides_content_check');
select public.t_true(
  'A21 an admin can DELETE a guide (back to the shipped default)',
  'authenticated', $q$
  with d as (delete from public.tool_guides where tool_key = 'video' returning 1) select count(*) = 1 from d $q$);
select public.t_true(
  'A22 none of the refused writes stored anything: exactly the five guides the admin meant',
  'postgres', $q$
  select array_agg(tool_key order by tool_key collate "C") = array['editor', 'generator', 'prompts', 'retouch', 'tool_upscale']
    from public.tool_guides $q$);

insert into public.t_vars values ('A_print', public.t_fingerprint());

-- ── an anonymous visitor ──
select public.t_be('anon');
select public.t_raises(
  'A23 anon cannot SELECT tool_guides — permission denied, not merely 0 rows',
  'anon', $q$ select count(*) from public.tool_guides $q$, 'permission denied for table tool_guides');
select public.t_raises(
  'A24 anon cannot INSERT into tool_guides — permission denied',
  'anon', $q$ insert into public.tool_guides (tool_key) values ('resize') $q$, 'permission denied for table tool_guides');
select public.t_raises(
  'A25 anon cannot UPDATE tool_guides — permission denied',
  'anon', $q$ update public.tool_guides set tutorial_enabled = false $q$, 'permission denied for table tool_guides');

-- ── a signed-in customer ──
select public.t_be('customer');
select public.t_true(
  'A26 a customer SELECTs 0 rows from tool_guides (5 exist)',
  'authenticated', $q$ select count(*) = 0 from public.tool_guides $q$);
select public.t_raises(
  'A27 a customer cannot INSERT a guide (RLS)',
  'authenticated', $q$ insert into public.tool_guides (tool_key, content) values ('resize', public.t_valid_content()) $q$,
  'row-level security');
select public.t_true(
  'A28 a customer''s UPDATE reaches no rows',
  'authenticated', $q$
  with u as (update public.tool_guides set tutorial_enabled = false, content = null returning 1) select count(*) = 0 from u $q$);
select public.t_true(
  'A29 a customer''s DELETE reaches no rows',
  'authenticated', $q$ with d as (delete from public.tool_guides returning 1) select count(*) = 0 from d $q$);
select public.t_true(
  'A30 after every anonymous and customer attempt, not one row moved',
  'postgres', $q$ select public.t_fingerprint() = public.t_var('A_print') $q$);
SQL
}

# ── P. tool_guides_published() — WHAT A SCREEN MAY READ ─────────────────────
published_checks() {
  q >/dev/null <<'SQL'
select public.t_be('anon');
select public.t_true(
  'P1  anon can call tool_guides_published(): one row per saved guide, none for a tool without one',
  'anon', $q$
  select count(*) = 5 and count(*) filter (where tool_key = 'video') = 0 from public.tool_guides_published() $q$);
select public.t_true(
  'P2  retouch (both on): tutorial and starter are the saved copy; flags and version 2 reported',
  'anon', $q$
  select tutorial = public.t_valid_content() -> 'tutorial' and starter = public.t_valid_content() -> 'starter'
     and tutorial_enabled and starter_enabled and tutorial_version = 2
    from public.tool_guides_published() where tool_key = 'retouch' $q$);
select public.t_true(
  'P3  prompts (tutorial off): tutorial is NULL, the starter is still there, flags and version 5 reported',
  'anon', $q$
  select tutorial is null and starter = public.t_valid_content() -> 'starter'
     and not tutorial_enabled and starter_enabled and tutorial_version = 5
    from public.tool_guides_published() where tool_key = 'prompts' $q$);
select public.t_true(
  'P4  generator (starter off): starter is NULL, the tutorial is still there',
  'anon', $q$
  select starter is null and tutorial = public.t_valid_content() -> 'tutorial'
     and tutorial_enabled and not starter_enabled and tutorial_version = 1
    from public.tool_guides_published() where tool_key = 'generator' $q$);
select public.t_true(
  'P5  editor (both off): both NULL — the saved copy is not handed out — flags false, version 3 still reported',
  'anon', $q$
  select tutorial is null and starter is null and not tutorial_enabled and not starter_enabled and tutorial_version = 3
    from public.tool_guides_published() where tool_key = 'editor' $q$);
select public.t_true(
  'P6  tool_upscale (NULL content): both NULL, flags on, version 1',
  'anon', $q$
  select tutorial is null and starter is null and tutorial_enabled and starter_enabled and tutorial_version = 1
    from public.tool_guides_published() where tool_key = 'tool_upscale' $q$);
select public.t_true(
  'P7  the result type is exactly the six presentation columns: no updated_by, updated_at or raw content',
  'postgres', $q$
  select pg_get_function_result('public.tool_guides_published()'::regprocedure) =
         'TABLE(tool_key text, tutorial_enabled boolean, starter_enabled boolean, tutorial_version integer, tutorial jsonb, starter jsonb)'
     and pg_get_function_result('public.tool_guides_published()'::regprocedure) !~ '(updated_by|updated_at|content)' $q$);

select public.t_be('customer');
select public.t_true(
  'P8  a signed-in customer (who reads 0 rows of the table) gets the same five rows through it',
  'authenticated', $q$
  select (select count(*) from public.tool_guides_published()) = 5
     and (select count(*) from public.tool_guides) = 0
     and (select tutorial is null from public.tool_guides_published() where tool_key = 'prompts') $q$);

select public.t_be('admin');
select public.t_runs(
  'P9  an admin switches prompts'' tutorial back on',
  'authenticated', $q$ update public.tool_guides set tutorial_enabled = true where tool_key = 'prompts' $q$);
select public.t_be('customer');
select public.t_true(
  'P10 (… and the customer''s very next read carries it)',
  'authenticated', $q$
  select tutorial = public.t_valid_content() -> 'tutorial' and tutorial_enabled
    from public.tool_guides_published() where tool_key = 'prompts' $q$);
SQL
}

# ── S. mark_tool_tutorial_seen — THE CALLER'S ROW, MERGED, HIGHEST WINS ─────
seen_checks() {
  q >/dev/null <<'SQL'
insert into public.t_vars
select 'other_before', t::text from public.user_preferences t where user_id = public.t_uid('other');
insert into public.t_vars
select 'admin_before', t::text from public.user_preferences t where user_id = public.t_uid('admin');

select public.t_be('customer');
select public.t_runs(
  'S1  a customer marks (retouch, 1)',
  'authenticated', $q$ select public.mark_tool_tutorial_seen('retouch', 1) $q$);
select public.t_true(
  'S2  … their own row now holds metadata.tool_tutorials.retouch = 1, a JSON number',
  'authenticated', $q$
  select metadata -> 'tool_tutorials' = '{"retouch": 1}'::jsonb
     and jsonb_typeof(metadata #> '{tool_tutorials,retouch}') = 'number'
    from public.user_preferences where user_id = auth.uid() $q$);
select public.t_true(
  'S3  … every other metadata key it had is still there, unchanged',
  'authenticated', $q$
  select metadata - 'tool_tutorials' = '{"onboarding":{"done":true},"sidebar":"collapsed"}'::jsonb
    from public.user_preferences where user_id = auth.uid() $q$);
select public.t_true(
  'S4  … locale and theme are untouched; preferences_touch moved updated_at',
  'authenticated', $q$
  select locale = 'en' and theme = 'dark' and updated_at > now() - interval '1 hour'
    from public.user_preferences where user_id = auth.uid() $q$);
select public.t_runs(
  'S5  the customer marks (prompts, 2)',
  'authenticated', $q$ select public.mark_tool_tutorial_seen('prompts', 2) $q$);
select public.t_true(
  'S6  … merged, not overwritten: {retouch: 1, prompts: 2}',
  'authenticated', $q$
  select metadata -> 'tool_tutorials' = '{"retouch": 1, "prompts": 2}'::jsonb
    from public.user_preferences where user_id = auth.uid() $q$);
select public.t_runs(
  'S7  the customer marks (retouch, 3)',
  'authenticated', $q$ select public.mark_tool_tutorial_seen('retouch', 3) $q$);
select public.t_runs(
  'S8  … and then an OLDER version, (retouch, 1)',
  'authenticated', $q$ select public.mark_tool_tutorial_seen('retouch', 1) $q$);
select public.t_true(
  'S9  … the highest version wins: retouch stays 3',
  'authenticated', $q$
  select metadata -> 'tool_tutorials' = '{"retouch": 3, "prompts": 2}'::jsonb
    from public.user_preferences where user_id = auth.uid() $q$);

-- Defence in depth: RLS (prefs_all_own) is the SECOND lock on another user's
-- row. A caller that bypasses RLS — the table owner, a service-role path —
-- carrying a customer's JWT must still write only that customer's row,
-- because the function's own WHERE says so.
select public.t_runs(
  'S10 a caller that bypasses RLS (the owner) carrying the customer''s JWT marks (tool_expand, 1)',
  'postgres', $q$ select public.mark_tool_tutorial_seen('tool_expand', 1) $q$);
select public.t_true(
  'S11 … and it wrote ONLY the customer''s row — the function''s own WHERE scopes the write, not just RLS',
  'postgres', $q$
  select count(*) = 1 and bool_and(user_id = public.t_uid('customer'))
    from public.user_preferences where metadata -> 'tool_tutorials' ? 'tool_expand' $q$);
select public.t_true(
  'S12 the other user''s row is byte for byte what it was',
  'postgres', $q$
  select t::text = public.t_var('other_before') from public.user_preferences t where user_id = public.t_uid('other') $q$);
select public.t_true(
  'S13 and the customer cannot even see it (RLS), so cannot read anyone''s marks either',
  'authenticated', $q$ select count(*) = 1 and bool_and(user_id = auth.uid()) from public.user_preferences $q$);

-- ── refused callers and arguments ──
select public.t_be('anon');
select public.t_raises(
  'S14 anon calling mark_tool_tutorial_seen is refused: permission denied',
  'anon', $q$ select public.mark_tool_tutorial_seen('retouch', 1) $q$,
  'permission denied for function mark_tool_tutorial_seen');
select public.t_be('nosub');
select public.t_raises(
  'S15 a signed-in role whose token carries no sub is refused: unauthenticated',
  'authenticated', $q$ select public.mark_tool_tutorial_seen('retouch', 1) $q$, 'unauthenticated');

select public.t_be('customer');
insert into public.t_vars
select 'customer_before_refusals', t::text from public.user_preferences t where user_id = public.t_uid('customer');
select public.t_raises('S16 tool key ''Retouch!'' is bad_tool', 'authenticated',
  $q$ select public.mark_tool_tutorial_seen('Retouch!', 1) $q$, 'bad_tool');
select public.t_raises('S17 tool key '''' is bad_tool', 'authenticated',
  $q$ select public.mark_tool_tutorial_seen('', 1) $q$, 'bad_tool');
select public.t_raises('S18 tool key NULL is bad_tool', 'authenticated',
  $q$ select public.mark_tool_tutorial_seen(null, 1) $q$, 'bad_tool');
select public.t_raises('S19 a 49-character tool key is bad_tool', 'authenticated',
  $q$ select public.mark_tool_tutorial_seen('a' || repeat('b', 48), 1) $q$, 'bad_tool');
select public.t_raises('S20 version 0 is bad_version', 'authenticated',
  $q$ select public.mark_tool_tutorial_seen('retouch', 0) $q$, 'bad_version');
select public.t_raises('S21 version 1000001 is bad_version', 'authenticated',
  $q$ select public.mark_tool_tutorial_seen('retouch', 1000001) $q$, 'bad_version');
select public.t_raises('S22 version NULL is bad_version', 'authenticated',
  $q$ select public.mark_tool_tutorial_seen('retouch', null) $q$, 'bad_version');
select public.t_true(
  'S23 none of the refused calls changed the customer''s row',
  'postgres', $q$
  select t::text = public.t_var('customer_before_refusals')
    from public.user_preferences t where user_id = public.t_uid('customer') $q$);

-- ── a user with no preferences row ──
select public.t_be('noprefs');
select public.t_runs(
  'S24 a user with no preferences row marks (editor, 4)',
  'authenticated', $q$ select public.mark_tool_tutorial_seen('editor', 4) $q$);
select public.t_true(
  'S25 … gets a row: defaults pl / system, metadata exactly {tool_tutorials: {editor: 4}}',
  'authenticated', $q$
  select count(*) = 1
     and bool_and(locale = 'pl' and theme = 'system' and metadata = '{"tool_tutorials":{"editor":4}}'::jsonb)
    from public.user_preferences where user_id = auth.uid() $q$);
select public.t_runs(
  'S26 … and their next marks, (editor, 2) and (resize, 1), go through the UPDATE path',
  'authenticated', $q$ select public.mark_tool_tutorial_seen('editor', 2), public.mark_tool_tutorial_seen('resize', 1) $q$);
select public.t_true(
  'S27 (… one row, {editor: 4, resize: 1})',
  'authenticated', $q$
  select count(*) = 1 and bool_and(metadata = '{"tool_tutorials":{"editor":4,"resize":1}}'::jsonb)
    from public.user_preferences where user_id = auth.uid() $q$);

-- ── odd values already in metadata ──
select public.t_be('legacy');
select public.t_runs(
  'S28 a user whose tool_tutorials.retouch is the string "seen" marks (retouch, 2)',
  'authenticated', $q$ select public.mark_tool_tutorial_seen('retouch', 2) $q$);
select public.t_true(
  'S29 … the non-number is replaced by 2; prompts (true) and the other key "beta" are left alone',
  'authenticated', $q$
  select metadata = '{"tool_tutorials":{"retouch":2,"prompts":true},"beta":1}'::jsonb
    from public.user_preferences where user_id = auth.uid() $q$);
select public.t_runs(
  'S30 … then marks (prompts, 1)',
  'authenticated', $q$ select public.mark_tool_tutorial_seen('prompts', 1) $q$);
select public.t_true(
  'S31 (… the boolean is replaced by 1)',
  'authenticated', $q$
  select metadata = '{"tool_tutorials":{"retouch":2,"prompts":1},"beta":1}'::jsonb
    from public.user_preferences where user_id = auth.uid() $q$);

-- ── every real tool key passes the key rule ──
insert into public.t_vars
select 'tool_keys', string_agg(tool_key, ',' order by tool_key collate "C") from public.ai_tools;
select public.t_be('allkeys');
select public.t_runs(
  'S32 every one of the 20 AI_TOOL_KEYS is accepted as a tool key',
  'authenticated', $q$
  select count(*) from unnest(string_to_array(public.t_var('tool_keys'), ',')) k,
         lateral (select public.mark_tool_tutorial_seen(k, 1)) m $q$);
select public.t_true(
  'S33 (… 20 marks, one per key)',
  'authenticated', $q$
  select (select string_agg(k, ',' order by k collate "C") from jsonb_object_keys(metadata -> 'tool_tutorials') k)
         = public.t_var('tool_keys')
    from public.user_preferences where user_id = auth.uid() $q$);
SQL

  # Two marks of different tools in two SEPARATE sessions, one after another.
  local seq_ok=true tool
  for tool in resize compress; do
    q -v tool="$tool" >/dev/null 2>>"$ERR" <<'SQL' || seq_ok=false
select public.t_be('customer');
set role authenticated;
begin;
select public.mark_tool_tutorial_seen(:'tool', 1);
commit;
SQL
  done
  q -v seq_ok="$seq_ok" >/dev/null <<'SQL'
select public.t_be('customer');
select public.t_true(
  'S34 two marks of different tools, in two separate transactions, both survive (and nothing earlier was lost)',
  'authenticated', format($q$
  select %L::boolean
     and metadata -> 'tool_tutorials' = '{"retouch":3,"prompts":2,"tool_expand":1,"resize":1,"compress":1}'::jsonb
    from public.user_preferences where user_id = auth.uid() $q$, :'seq_ok'));
SQL

  # Two marks of different tools AT THE SAME TIME — two tabs. Staged
  # deterministically: A marks tool_watermark and holds its transaction open
  # until B (marking tool_remove_bg) is waiting on A's row lock; then A
  # commits. The header promises one statement merges the key, so B must
  # re-read A's row and keep A's mark.
  local race_a="tg_race_a_$DB" race_b="tg_race_b_$DB" staged=true a_pid b_pid
  local race_opts='-c statement_timeout=30s -c client_min_messages=warning'
  race_wait() {  # $1 application_name, $2 condition on its pg_stat_activity row; ~10 s at most
    local _
    for _ in $(seq 1 100); do
      [ "$(q -c "select count(*) from pg_stat_activity where application_name = '$1' and $2")" != "0" ] && return 0
      sleep 0.1
    done
    return 1
  }
  PGAPPNAME="$race_a" PGOPTIONS="$race_opts" q -v peer="$race_b" >/dev/null 2>&1 <<'SQL' &
begin;
select public.t_be('customer');
set local role authenticated;
select public.mark_tool_tutorial_seen('tool_watermark', 1);
reset role;
select set_config('tg.peer', :'peer', true);
do $$
declare v_seen boolean := false;
begin
  for i in 1..200 loop
    perform pg_stat_clear_snapshot();
    v_seen := exists (select 1 from pg_stat_activity
                       where application_name = current_setting('tg.peer') and wait_event_type = 'Lock');
    exit when v_seen;
    perform pg_sleep(0.05);
  end loop;
  insert into public.t_vars values ('race_staged', v_seen::text)
    on conflict (name) do update set v = excluded.v;
end $$;
commit;
SQL
  a_pid=$!
  race_wait "$race_a" "wait_event = 'PgSleep'" || staged=false
  PGAPPNAME="$race_b" PGOPTIONS="$race_opts" q >"$B_OUT" 2>&1 <<'SQL' &
select public.t_be('customer');
set role authenticated;
select public.mark_tool_tutorial_seen('tool_remove_bg', 1);
SQL
  b_pid=$!
  wait "$a_pid" || staged=false
  wait "$b_pid" || staged=false
  q -v staged="$staged" -v b_out="$(tr '\n' ' ' < "$B_OUT")" >/dev/null <<'SQL'
select public.t_true(
  'S35 two CONCURRENT marks of different tools (B waits on A''s row lock) both survive',
  'postgres', format($q$
  select %L::boolean and public.t_var('race_staged') = 'true'
     and (metadata -> 'tool_tutorials') ?& array['tool_watermark', 'tool_remove_bg', 'retouch', 'compress']
    from public.user_preferences where user_id = public.t_uid('customer') $q$, :'staged'));
update public.test_results
   set detail = detail || ' (staged: ' || :'staged' || ', A saw B waiting: ' || coalesce(public.t_var('race_staged'), '?')
                || '; B said: ' || :'b_out' || ')'
 where name like 'S35 %' and not ok;

select public.t_true(
  'S36 after all of it, the other user''s and the admin''s rows are byte for byte what they were',
  'postgres', $q$
  select (select t::text = public.t_var('other_before') from public.user_preferences t where user_id = public.t_uid('other'))
     and (select t::text = public.t_var('admin_before') from public.user_preferences t where user_id = public.t_uid('admin')) $q$);
SQL
}

# ── M (again). RE-APPLY OVER A POPULATED DATABASE ───────────────────────────
reapply_checks() {  # $1 = migration file
  local before after
  before=$(q -c 'select public.t_fingerprint()')
  if apply_migration "$1"; then
    record 'M14 0142 applies a third time, over every row the tests above wrote' true ''
  else
    record 'M14 0142 applies a third time, over every row the tests above wrote' false "$(tr '\n' ' ' < "$ERR")"
  fi
  after=$(q -c 'select public.t_fingerprint()')
  if [ "$before" = "$after" ]; then
    record 'M15 and not one guide, preferences, tool or profile row changed' true ''
  else
    record 'M15 and not one guide, preferences, tool or profile row changed' false "$before → $after"
  fi
  q >/dev/null <<'SQL'
select public.t_true(
  'M16 and the functions, grants and policy are still exactly the first apply''s',
  'postgres', $q$
  select public.t_fn_print() = public.t_var('fn_after_1')
     and (select count(*) = 1 from pg_policies where schemaname = 'public' and tablename = 'tool_guides') $q$);
SQL
}

# ── One full run against one migration file, in a fresh database ────────────
SUITE_ABORTED=0
run_suite() {  # $1 = database, $2 = migration file
  DB="$1"
  dropdb "${PGCONN[@]}" --if-exists --force "$DB" >/dev/null 2>&1
  createdb "${PGCONN[@]}" -T template0 -E UTF8 "$DB"
  build_rehearsal
  rehearsal_checks
  apply_checks "$2"
  [ "$SUITE_ABORTED" = "0" ] || return 0
  table_checks
  published_checks
  seen_checks
  reapply_checks "$2"
}

scoreboard() {
  DB="$DB_MAIN"
  q -c "select case when ok then '  ✓ ' else '  ✗ ' end || name
                || case when not ok or name like 'X%' then '  — ' || detail else '' end
          from public.test_results order by seq"
  local failed total
  failed=$(q -c "select count(*) from public.test_results where not ok")
  total=$(q -c "select count(*) from public.test_results")
  echo
  if [ "$failed" = "0" ]; then
    echo "All $total tool-guides SQL tests passed."
  else
    echo "$failed of $total FAILED" >&2
    exit 1
  fi
}

# ════════════════════════════════════════════════════════════════════════════
run_suite "$DB_MAIN" "$MIGRATION"

# ── X. MUTATION TESTS — THE SUITE MUST GO RED ON A BROKEN 0142 ──────────────
#
# Three deliberately broken copies of the migration (in a scratch directory;
# the real file is never touched), each run through the same suite in its own
# fresh database. A mutant is CAUGHT when it still applies (so the red is not
# a syntax error from the mutation) and every check that guards the broken
# line goes red.
#   1. tool_guides_published() granted to PUBLIC        → M8
#   2. mark_tool_tutorial_seen without `where user_id`  → S11, S12 (RLS alone would
#      hide it from a customer; the owner-with-JWT check sees it)
#   3. no `revoke all on tool_guides from anon`         → M7, A23, A24, A25
mutate() {  # $1 = n, $2 = sed program → path of the mutant
  local out="$WORK/0142_mutant_$1.sql"
  sed "$2" "$MIGRATION" > "$out"
  echo "$out"
}
MUTANT_FILES=(
  "$(mutate 1 's/^grant execute on function public\.tool_guides_published() to anon, authenticated;$/grant execute on function public.tool_guides_published() to public, anon, authenticated;/')"
  "$(mutate 2 's/^   where user_id = v_uid$/   where true/')"
  "$(mutate 3 '/^revoke all on public\.tool_guides from anon;$/d')"
)
MUTANT_LABELS=(
  'tool_guides_published granted to PUBLIC'
  'mark_tool_tutorial_seen without "where user_id = v_uid"'
  'no "revoke all on public.tool_guides from anon"'
)
MUTANT_EXPECT=('M8' 'S11 S12' 'M7 A23 A24 A25')

X_RESULTS=()
for i in 0 1 2; do
  n=$((i + 1))
  label="X$n  mutant $n caught (${MUTANT_LABELS[$i]})"
  if [ "$SUITE_ABORTED" = "1" ]; then
    X_RESULTS+=("$label|false|skipped: the real migration did not apply")
    continue
  fi
  changed=$(diff "$MIGRATION" "${MUTANT_FILES[$i]}" | grep -c '^[<>]' || true)
  if [ "$changed" = "0" ]; then
    X_RESULTS+=("$label|false|the mutation did not apply: the copy is identical to 0142")
    continue
  fi
  echo "guides-sql: running the suite against mutant $n (${MUTANT_LABELS[$i]})…" >&2
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
  X_RESULTS+=("$label|$caught|diff vs 0142: ${changed} line(s); mutant applied: $applied; red: ${red:-none} of $total checks (must include: ${MUTANT_EXPECT[$i]})")
  [ "${KEEP_DB:-0}" = "1" ] || dropdb "${PGCONN[@]}" --if-exists --force "${MUTANT_DBS[$i]}" >/dev/null 2>&1 || true
done

DB="$DB_MAIN"
for r in "${X_RESULTS[@]}"; do
  IFS='|' read -r name ok detail <<<"$r"
  record "$name" "$ok" "$detail"
done

scoreboard
