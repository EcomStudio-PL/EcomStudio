#!/usr/bin/env bash
#
# THE HOMEPAGE, PROVEN AGAINST A REAL POSTGRES.
#
# WHAT THIS EXISTS TO CATCH, in the exact shape it happened.
#
# On 2026-09-20 the admin panel showed "Strona premiery" as the active homepage
# and grovbase.com served the ordinary landing. Nothing was broken in the code
# that read the setting. The setting could not be READ by a visitor at all:
#
#   set local role anon;
#   select count(*) from public.app_settings;
#   → ERROR 42501: permission denied for function is_admin
#
# `settings_admin_write` (0008) is `for all ... using (is_admin())` with no role
# clause, so it applies to anon too, and anon has had no EXECUTE on is_admin
# since 0005. Postgres initialises every function in the OR-combined policy
# expression, so the whole SELECT raises instead of filtering. getHomepageMode()
# ignored the error, read `data` as null, and returned its "full" default — for
# every single logged-out visitor, silently, for as long as the row existed.
#
# A TYPE CHECKER HAS NO OPINION ABOUT ANY OF THAT, and neither does a test that
# runs as an admin. So section A reproduces the failure FIRST, on the policies
# exactly as production carries them, and only then applies 0110 and shows the
# same query working. A fix nobody watched fail is a fix nobody can trust.
#
# Sections B–D then hold the new model to its promises: exactly one homepage
# (enforced by an index, not by hope), moved atomically, never flagged onto a
# page a visitor cannot be served, and never taken off the air by an unpublish,
# an archive or a delete.
#
# It runs against the local harness, never Supabase: DEV does not carry this
# schema at all and PROD is not a place to rehearse policy changes.
#
#   bash scripts/pg-harness-up.sh && npm run test:homepage:sql
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
PSQL=(psql -h "$PGSOCK" -p "$PGPORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -X -q -t -A)

if ! "${PSQL[@]}" -c 'select 1' >/dev/null 2>&1; then
  echo "homepage-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Overridable so the guard can be mutation-tested: point it at a deliberately
# broken copy of 0110 and the run must go red. A guard nobody has watched fail
# is a guard nobody knows works.
MIGRATION="${MIGRATION:-$ROOT/supabase/migrations/0110_homepage_is_a_page.sql}"
[ -f "$MIGRATION" ] || { echo "homepage-sql: $MIGRATION not found" >&2; exit 2; }

OUT=$(mktemp); trap 'rm -f "$OUT"' EXIT

# ── A throwaway rehearsal of the real thing ─────────────────────────────────
#
# Only what 0110 touches, with the policies and grants replayed from the
# migrations that created them — 0005 (the revoke that makes the defect
# possible), 0008 (app_settings and its two policies), 0051 (the per-role CMS
# read policies) and 0107 (the private-row filter). auth.uid() and is_admin()
# read session settings so a test can BE each caller, which is what Supabase's
# own helpers do at runtime.
"${PSQL[@]}" >/dev/null <<'SQL'
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'drop owned by anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'drop owned by authenticated'; end if;
end $$;

drop schema if exists public cascade;  create schema public;
drop schema if exists auth cascade;    create schema auth;

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

grant usage on schema public, auth to anon, authenticated;

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('test.uid', true), '')::uuid
$$;

-- The real is_admin is SECURITY DEFINER over profiles. What matters here is
-- its SHAPE — a definer function anon may not execute — so the body is a
-- session setting and the GRANTS are copied verbatim from 0005.
create function public.is_admin(uid uuid default auth.uid())
returns boolean language sql stable security definer as $$
  select coalesce(current_setting('test.admin', true) = '1', false)
$$;
revoke execute on function public.is_admin(uuid) from public, anon;
grant execute on function public.is_admin(uuid) to authenticated;

-- 0107, verbatim.
create function public.app_setting_is_private(p_key text)
returns boolean language sql immutable parallel safe as $$
  select p_key in ('notifications', 'login_security_dispatch', 'auth_email_hook');
$$;

-- ── app_settings, with the policies production actually carries ────────────
create table public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
-- 0008: no role clause. This is the defect.
create policy "settings_admin_write" on public.app_settings for all
  using (public.is_admin()) with check (public.is_admin());
-- 0107: replaced settings_select_all, left the one above alone.
create policy "settings_select_public" on public.app_settings for select
  using (not public.app_setting_is_private(key));
grant select, insert, update, delete on public.app_settings to anon, authenticated;

insert into public.app_settings (key, value) values
  ('homepage', '{"mode":"waitlist"}'),
  ('public_site', '{"instagram_url":""}'),
  ('notifications', '{"dispatch_hash":"SECRET"}'),
  ('login_security_dispatch', '{"hash":"SECRET"}'),
  ('auth_email_hook', '{"uri":"SECRET"}');

-- ── cms_pages, with 0051's per-role read policies ─────────────────────────
create table public.cms_pages (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  status text not null default 'draft',
  kind text not null default 'standard',
  sort_order int not null default 100,
  scheduled_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.cms_pages enable row level security;
create policy "cms_pages_read_public" on public.cms_pages for select to anon
  using (status = 'published'
         or (status = 'scheduled' and scheduled_at is not null and scheduled_at <= now()));
create policy "cms_pages_read_authenticated" on public.cms_pages for select to authenticated
  using (status = 'published'
         or (status = 'scheduled' and scheduled_at is not null and scheduled_at <= now())
         or public.is_admin());
create policy "cms_pages_admin_write" on public.cms_pages for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.cms_pages to anon, authenticated;

insert into public.cms_pages (slug, title, status, kind, sort_order) values
  ('home',     'Strona główna',  'draft',     'standard', 0),
  ('premiera', 'Strona premiery','published', 'launch',   10),
  ('cennik',   'Cennik',         'published', 'standard', 20),
  ('o-nas',    'O nas',          'draft',     'standard', 30);

-- ── The scoreboard and two helpers ────────────────────────────────────────
create table public.test_results (name text, ok boolean, detail text, seq serial);

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
SQL

# ── A. THE DEFECT, BEFORE THE MIGRATION ─────────────────────────────────────
#
# EVERY HEREDOC IS ITS OWN SESSION, so the admin flag the is_admin stub reads
# has to be set inside each one. The first run of this file set it with a
# separate `psql -c`, lost it, and turned three "an admin can" assertions into
# "an anonymous caller cannot" assertions that passed for the wrong reason.
"${PSQL[@]}" >/dev/null <<'SQL'
select set_config('test.admin', '1', false);

select public.t_raises(
  'A1  BEFORE: an anonymous read of app_settings raises instead of filtering',
  'anon', 'select count(*) from public.app_settings', 'permission denied for function is_admin');
select public.t_raises(
  'A2  BEFORE: and so does the homepage row specifically — this is what "/" ran',
  'anon', 'select value from public.app_settings where key = ''homepage''',
  'permission denied for function is_admin');
select public.t_true(
  'A3  BEFORE: an admin reads the very same row without trouble',
  'authenticated', 'select (select value->>''mode'' from public.app_settings where key = ''homepage'') = ''waitlist''');
SQL

# ── APPLY THE REAL MIGRATION FILE ───────────────────────────────────────────
"${PSQL[@]}" -f "$MIGRATION" >/dev/null

# ── B–F. WHAT IT IS SUPPOSED TO HAVE ACHIEVED ───────────────────────────────
"${PSQL[@]}" >/dev/null <<'SQL'
select set_config('test.admin', '1', false);

-- B. THE READ THAT WAS BROKEN
select public.t_true(
  'B1  AFTER: an anonymous visitor reads the homepage setting',
  'anon', 'select (select value->>''mode'' from public.app_settings where key = ''homepage'') = ''waitlist''');
select public.t_true(
  'B2  AFTER: and the three private rows are still invisible to them',
  'anon', 'select count(*) = 0 from public.app_settings
             where key in (''notifications'', ''login_security_dispatch'', ''auth_email_hook'')');
select public.t_true(
  'B3  AFTER: an admin still sees everything, private rows included',
  'authenticated', 'select count(*) = 5 from public.app_settings');
-- An anonymous UPDATE does not RAISE, and asserting that it does would be
-- asserting the wrong thing: with no write policy for the role, the USING
-- clause simply matches nothing and Postgres reports zero rows changed. What
-- has to hold is that the value survives.
select public.t_true(
  'B4  AFTER: an anonymous UPDATE reaches no rows',
  'anon', 'with u as (update public.app_settings set value = ''{"mode":"full"}''
                      where key = ''homepage'' returning 1)
           select count(*) = 0 from u');
select public.t_true(
  'B5  AFTER: and the stored value is untouched',
  'anon', 'select (select value->>''mode'' from public.app_settings where key = ''homepage'') = ''waitlist''');
select public.t_raises(
  'B6  AFTER: an anonymous INSERT is refused outright',
  'anon', 'insert into public.app_settings (key, value) values (''pwned'', ''{}'')',
  'row-level security');

-- C. ONE HOMEPAGE, AND IT IS THE ONE THE OLD SWITCH MEANT
select public.t_true(
  'C1  the backfill flagged exactly one page',
  'authenticated', 'select count(*) = 1 from public.cms_pages where is_homepage');
select public.t_true(
  'C2  and it is the launch page, because the old mode said waitlist',
  'authenticated', 'select slug = ''premiera'' from public.cms_pages where is_homepage');
select public.t_true(
  'C3  the anonymous resolver query returns it — this is lib/server/homepage.ts',
  'anon', 'select slug = ''premiera'' from public.cms_pages where is_homepage');
select public.t_raises(
  'C4  a second homepage is refused by the database, not by a convention',
  'authenticated', 'update public.cms_pages set is_homepage = true where slug = ''cennik''',
  'cms_pages_one_homepage');

-- D. THE SWITCH ITSELF
select public.t_raises(
  'D1  an anonymous caller cannot even reach cms_set_homepage',
  'anon', 'select public.cms_set_homepage((select id from public.cms_pages where slug = ''cennik''))',
  'permission denied for function cms_set_homepage');
SQL

# A signed-in customer who is not an admin. The flag has to be off for this one
# call and on again afterwards, which is why it is its own statement.
"${PSQL[@]}" >/dev/null <<'SQL'
select set_config('test.admin', '0', false);
select public.t_raises(
  'D2  a signed-in customer is refused by the function''s own check',
  'authenticated', 'select public.cms_set_homepage((select id from public.cms_pages where slug = ''cennik''))',
  'not_admin');
select set_config('test.admin', '1', false);

select public.t_raises(
  'D3  an admin cannot point "/" at a draft',
  'authenticated', 'select public.cms_set_homepage((select id from public.cms_pages where slug = ''o-nas''))',
  'not_published');
select public.t_true(
  'D4  and the refusal left the old homepage exactly where it was',
  'authenticated', 'select slug = ''premiera'' from public.cms_pages where is_homepage');

select public.t_true(
  'D5  moving it to a published page works and returns the new slug',
  'authenticated', 'select public.cms_set_homepage((select id from public.cms_pages where slug = ''cennik'')) = ''cennik''');
select public.t_true(
  'D6  and there is still exactly one, now on the new page',
  'authenticated', 'select count(*) = 1 from public.cms_pages where is_homepage and slug = ''cennik''');
select public.t_true(
  'D7  the page it moved off is untouched apart from the flag',
  'authenticated', 'select status = ''published'' and not is_homepage
                      from public.cms_pages where slug = ''premiera''');

-- E. THE FRONT DOOR CANNOT BE TAKEN DOWN BY ACCIDENT
select public.t_raises(
  'E1  the homepage cannot be unpublished',
  'authenticated', 'update public.cms_pages set status = ''draft'' where slug = ''cennik''',
  'homepage_protected');
select public.t_raises(
  'E2  the homepage cannot be archived',
  'authenticated', 'update public.cms_pages set status = ''archived'' where slug = ''cennik''',
  'homepage_protected');
select public.t_raises(
  'E3  the homepage cannot be deleted',
  'authenticated', 'delete from public.cms_pages where slug = ''cennik''', 'homepage_protected');
select public.t_raises(
  'E4  nor scheduled forward, which would take "/" off the air until the date',
  'authenticated', 'update public.cms_pages
                      set status = ''scheduled'', scheduled_at = now() + interval ''7 days''
                      where slug = ''cennik''',
  'homepage_protected');
select public.t_true(
  'E5  after four refusals the homepage is still live and still the homepage',
  'anon', 'select status = ''published'' from public.cms_pages where is_homepage and slug = ''cennik''');

-- F. AND NONE OF THAT IS A DEAD END
select public.t_true(
  'F1  moving the homepage back frees the page that was holding it',
  'authenticated', 'select public.cms_set_homepage((select id from public.cms_pages where slug = ''premiera'')) = ''premiera''');
select public.t_true(
  'F2  which can now be unpublished like any other page',
  'authenticated', 'with u as (update public.cms_pages set status = ''draft''
                               where slug = ''cennik'' returning 1) select count(*) = 1 from u');
select public.t_true(
  'F3  an ordinary page is still deletable',
  'authenticated', 'with d as (delete from public.cms_pages where slug = ''o-nas'' returning 1)
                    select count(*) = 1 from d');
SQL

"${PSQL[@]}" -c \
  "select case when ok then '  ✓ ' else '  ✗ ' end || name || case when ok then '' else '  — ' || detail end
   from public.test_results order by seq" > "$OUT"

cat "$OUT"
FAILED=$("${PSQL[@]}" -c "select count(*) from public.test_results where not ok")
TOTAL=$("${PSQL[@]}" -c "select count(*) from public.test_results")

if [ "$FAILED" = "0" ]; then
  echo
  echo "All $TOTAL homepage SQL tests passed."
else
  echo
  echo "$FAILED of $TOTAL FAILED" >&2
  exit 1
fi
