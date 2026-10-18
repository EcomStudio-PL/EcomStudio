#!/usr/bin/env bash
#
# TRIAL WATERMARK (0143), PROVEN AGAINST A REAL POSTGRES.
#
# 0143 decides who gets a marked image, keeps the clean original sealed,
# hands its key to the server only for an entitled unlock, and makes it
# disappear: key destroyed at expiry, blob purged by an anonymous cron through
# the Storage API. Every one of those rules is a database rule, so every one
# is asserted here AS the caller it is meant to stop — anon, a customer,
# another tenant, an admin acting in a customer's workspace, the owner — on
# the real migration file, applied verbatim TWICE and a third time over a
# populated database.
#
# The rehearsal schema is what 0143 lands on, replayed from the migrations
# that created it (extracted, not retyped, where the body matters):
#   · roles anon / authenticated and SUPABASE'S DEFAULT PRIVILEGES (every new
#     table and function in public is granted to both), so 0143's revokes are
#     what make "no access" true;
#   · auth.uid() as PROD defines it; is_admin / is_workspace_member (0002)
#     with 0005's revoke from anon — without it the anon storage failure 0143
#     fixes cannot be seen (R1: a stub without the revoke is a false PASS);
#   · server_call_ok (0077), log_activity (0036), set_asset_derivatives
#     (0083), app_setting_is_private (0139), the app_settings policies (0110);
#   · a storage schema: buckets, objects (RLS on, granted to the client roles
#     as on Supabase), storage.foldername as Supabase ships it, the
#     protect_delete guard (only the Storage API may delete), and the 19
#     storage.objects policies of 0004/0012/0013/0042/0043 extracted verbatim;
#   · the generation, credit, billing, activity and engine-run tables with the
#     columns 0143 reads; pg_cron ABSENT (the defensive block must cope).
#
# The last section (X) breaks three copies of 0143 on purpose and checks the
# suite goes red where it should.
#
# Local harness only, its own databases (trialwm_sqltest, _m1…_m3), dropped
# on exit (KEEP_DB=1 keeps them).
#
#   bash scripts/pg-harness-up.sh && npm run test:trialwm:sql
set -euo pipefail

PGSOCK="${PGSOCK:-/tmp/pgtest}"
PGPORT="${PGPORT:-5433}"
PGCONN=(-h "$PGSOCK" -p "$PGPORT" -U postgres)

if ! psql "${PGCONN[@]}" -d postgres -X -q -t -A -c 'select 1' >/dev/null 2>&1; then
  echo "trialwm-sql: no harness on $PGSOCK:$PGPORT — run: bash scripts/pg-harness-up.sh" >&2
  exit 2
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
M="$ROOT/supabase/migrations"
MIGRATION="${MIGRATION:-$M/0143_trial_watermark.sql}"
[ -f "$MIGRATION" ] || { echo "trialwm-sql: $MIGRATION not found" >&2; exit 2; }

extract() { # file, function name, end marker regex
  awk -v start="^create (or replace )?function public[.]$2[(]" -v stop="$3" \
    '$0 ~ start {on=1} on {print} on && $0 ~ stop {exit}' "$1"
}
IS_ADMIN=$(extract "$M/0002_functions_and_triggers.sql" is_admin '^[$][$];')
IS_MEMBER=$(extract "$M/0002_functions_and_triggers.sql" is_workspace_member '^[$][$];')
SERVER_CALL_OK=$(extract "$M/0077_server_only_rpcs.sql" server_call_ok '^end [$][$];')
LOG_ACTIVITY=$(extract "$M/0036_definer_function_hardening.sql" log_activity '^end [$][$];')
SET_DERIV=$(extract "$M/0083_asset_thumbnails.sql" set_asset_derivatives '^[$][$];')
PRIVATE_0139=$(extract "$M/0139_miniaturka.sql" app_setting_is_private '^[$][$];')
STORAGE_POLICIES=$(for f in 0004_storage_and_seed.sql 0012_saas_foundation.sql 0013_studio_notifications_support.sql \
                            0042_ai_engine.sql 0043_engine_rpc_hardening.sql; do
  perl -0777 -ne 'while (/(create policy\s+"?\w+"?\s+on storage\.objects\b.*?;)/gs) { print "$1\n" }' "$M/$f"
done)
for v in IS_ADMIN IS_MEMBER SERVER_CALL_OK LOG_ACTIVITY SET_DERIV PRIVATE_0139 STORAGE_POLICIES; do
  [ -n "${!v}" ] || { echo "trialwm-sql: could not extract $v" >&2; exit 2; }
done

DB_MAIN="${TRIALWM_DB:-trialwm_sqltest}"
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

# ── The rehearsal ───────────────────────────────────────────────────────────
build_rehearsal() {
  q >/dev/null <<SQL
set client_min_messages = warning;
do \$\$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end \$\$;
create schema auth; create schema extensions; create schema storage;
create extension if not exists pgcrypto with schema extensions;
grant usage on schema public, auth, extensions, storage to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;

-- PROD's auth.uid(), verbatim.
create function auth.uid() returns uuid language sql stable as \$f\$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
\$f\$;

-- 0001 enums (0011 widened credit_tx_type)
create type public.user_role as enum ('user','admin');
create type public.workspace_role as enum ('owner','admin','editor','viewer','operator');
create type public.job_status as enum ('queued','processing','completed','failed','cancelled');
create type public.credit_tx_type as enum ('subscription','topup','generation','refund','bonus','admin_adjustment',
  'purchase','promotion','admin_grant','manual_adjustment');
create type public.asset_type as enum ('image','video','text');

create table public.profiles (id uuid primary key, email text not null default '', role public.user_role not null default 'user');
create table public.workspaces (id uuid primary key default gen_random_uuid(), name text not null default 'ws',
  owner_id uuid not null references public.profiles(id) on delete cascade);
create table public.workspace_members (workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.workspace_role not null default 'owner', primary key (workspace_id, user_id));

$IS_ADMIN
$IS_MEMBER
-- 0005
revoke execute on function public.is_admin(uuid) from public, anon;
revoke execute on function public.is_workspace_member(uuid, uuid) from public, anon;
grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.is_workspace_member(uuid, uuid) to authenticated;

-- 0008 + 0110 policies + 0139's private list
create table public.app_settings (key text primary key, value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now());
alter table public.app_settings enable row level security;
$PRIVATE_0139
create policy "settings_admin_write" on public.app_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy "settings_select_public" on public.app_settings for select to anon, authenticated
  using (not public.app_setting_is_private(key));

$SERVER_CALL_OK
revoke all on function public.server_call_ok(text) from public, anon, authenticated;
insert into public.app_settings (key, value) values
  ('notifications', jsonb_build_object('dispatch_hash', encode(extensions.digest('trial-wm-test-dispatch-token', 'sha256'), 'hex'))),
  ('billing', '{"currency":"PLN"}');

-- generation tables (0001 + 0013's settings), member RLS as on PROD
create table public.generation_jobs (id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status public.job_status not null default 'completed', settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now());
create table public.generations (id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.generation_jobs(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  created_at timestamptz not null default now());
create table public.generation_assets (id uuid primary key default gen_random_uuid(),
  generation_id uuid not null references public.generations(id) on delete cascade,
  asset_type public.asset_type not null default 'image', storage_path text not null,
  width int, height int, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());
alter table public.generation_jobs enable row level security;
alter table public.generations enable row level security;
alter table public.generation_assets enable row level security;
create policy gj_select on public.generation_jobs for select using (public.is_workspace_member(workspace_id) or public.is_admin());
create policy gen_select on public.generations for select using (public.is_workspace_member(workspace_id) or public.is_admin());
create policy ga_select on public.generation_assets for select using (exists (select 1 from public.generations g
  where g.id = generation_id and (public.is_workspace_member(g.workspace_id) or public.is_admin())));
$SET_DERIV
revoke all on function public.set_asset_derivatives(uuid, text, text) from public;
revoke all on function public.set_asset_derivatives(uuid, text, text) from anon;
grant execute on function public.set_asset_derivatives(uuid, text, text) to authenticated;

-- credits and billing (0001 + 0113 columns/checks)
create table public.credit_wallets (id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null unique references public.workspaces(id) on delete cascade, balance int not null default 0);
create table public.credit_transactions (id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.credit_wallets(id) on delete cascade, amount int not null,
  type public.credit_tx_type not null, description text, reference_id uuid, metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now());
create table public.subscription_plans (id uuid primary key default gen_random_uuid(), slug text not null unique,
  name text not null, monthly_credits int not null default 0, price_cents int not null default 0, active boolean not null default true);
create table public.subscriptions (id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  plan_id uuid not null references public.subscription_plans(id), status text not null default 'active'
    check (status in ('active','trialing','past_due','canceled','incomplete','incomplete_expired','unpaid','paused')),
  current_period_start timestamptz not null default now(), current_period_end timestamptz,
  provider text, provider_subscription_id text, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now());
create table public.payments (id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete set null, amount_cents int not null,
  currency text not null default 'PLN', status text not null default 'pending'
    check (status in ('pending','processing','succeeded','paid','completed','failed','canceled','refunded','partially_refunded','disputed')),
  provider text, provider_payment_id text, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  kind text check (kind is null or kind in ('credit_pack','custom_credits','subscription')),
  credits_granted integer not null default 0);

-- activity_logs (0001), its one policy (0003), log_activity (0036) and its grants (0005/0036)
create table public.activity_logs (id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  on_behalf_of uuid references public.profiles(id) on delete set null,
  action text not null, entity_type text, entity_id uuid, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now());
alter table public.activity_logs enable row level security;
create policy "act_select" on public.activity_logs for select using (public.is_workspace_member(workspace_id) or public.is_admin());
$LOG_ACTIVITY
revoke execute on function public.log_activity(uuid, text, text, uuid, jsonb, uuid) from public, anon;
grant execute on function public.log_activity(uuid, text, text, uuid, jsonb, uuid) to authenticated;

-- engine runs (0126/0129: the columns unlock_finish rewrites)
create table public.ai_engine_runs (id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  tool_key text not null default 'ecommerce_thumbnail', workspace_id uuid references public.workspaces(id) on delete cascade,
  user_id uuid, run_kind text not null default 'thumbnail', status text not null default 'ok',
  input jsonb not null default '{}'::jsonb, outputs jsonb not null default '[]'::jsonb check (jsonb_typeof(outputs) = 'array'),
  progress jsonb not null default '{}'::jsonb check (jsonb_typeof(progress) = 'object'),
  updated_at timestamptz not null default now());
create table public.ai_engine_step_runs (id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_engine_runs(id) on delete cascade, "position" smallint not null,
  item_index smallint not null default -1, operation text not null default 'image_edit',
  status text not null default 'succeeded', output jsonb, unique (run_id, "position", item_index));
alter table public.ai_engine_runs enable row level security;
alter table public.ai_engine_step_runs enable row level security;

-- ── storage, as Supabase has it ──────────────────────────────────────────
create table storage.buckets (id text primary key, name text not null, owner uuid, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now());
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now(),
  unique (bucket_id, name));
alter table storage.buckets enable row level security;
alter table storage.objects enable row level security;
grant all on storage.buckets, storage.objects to anon, authenticated;
CREATE OR REPLACE FUNCTION storage.foldername(name text)
 RETURNS text[]
 LANGUAGE plpgsql
AS \$function\$
DECLARE
_parts text[];
BEGIN
	select string_to_array(name, '/') into _parts;
	return _parts[1:array_length(_parts,1)-1];
END
\$function\$;
-- "Direct deletion from storage tables is not allowed. Use the Storage API
-- instead." — the API sets storage.allow_delete_query for its own delete.
create function storage.protect_delete() returns trigger language plpgsql as \$f\$
begin
  if coalesce(current_setting('storage.allow_delete_query', true), '') <> 'true' then
    raise exception 'Direct deletion from storage tables is not allowed. Use the Storage API instead.';
  end if;
  return old;
end \$f\$;
create trigger protect_objects_delete before delete on storage.objects for each row execute function storage.protect_delete();
insert into storage.buckets (id, name, public) values
  ('product-images', 'product-images', false), ('generation-assets', 'generation-assets', false),
  ('media', 'media', true), ('workspace-branding', 'workspace-branding', true), ('knowledge', 'knowledge', false);
$STORAGE_POLICIES
SQL

  q >/dev/null <<'SQL'
set client_min_messages = warning;
-- Some helpers name 0143's functions, which do not exist yet.
set check_function_bodies = off;
-- ── the scoreboard and its helpers ──────────────────────────────────────
create table public.test_results (name text, ok boolean, detail text, seq serial);
create table public.t_vars (name text primary key, v text);
create function public.t_var(p_name text) returns text language sql stable as $$ select v from public.t_vars where name = p_name $$;
create function public.t_set(p_name text, p_v text) returns void language sql as $$
  insert into public.t_vars values (p_name, p_v) on conflict (name) do update set v = excluded.v $$;
create function public.t_tok() returns text language sql immutable as $$ select 'trial-wm-test-dispatch-token'::text $$;
create function public.t_wkey() returns text language sql immutable as $$ select repeat('QUJD', 20) $$;
create function public.t_sha(p text) returns text language sql immutable as $$ select encode(extensions.digest(p, 'sha256'), 'hex') $$;

create function public.t_uid(p_who text) returns uuid language sql immutable as $$
  select (case p_who
    when 'admin'    then 'ad000000-0000-0000-0000-000000000001'
    when 'customer' then 'c0000000-0000-0000-0000-000000000001'
    when 'other'    then 'c0000000-0000-0000-0000-000000000002'
    when 'matrix'   then 'c0000000-0000-0000-0000-000000000003'
    when 'forced'   then 'c0000000-0000-0000-0000-000000000004'
    when 'teammate' then 'c0000000-0000-0000-0000-000000000005'
  end)::uuid $$;
-- workspaces: 'w' || two hex digits
create function public.t_ws(p_name text) returns uuid language sql immutable as $$
  select ('e0000000-0000-0000-0000-0000000000' || case p_name
    when 'staff' then '01' when 'customer' then '02' when 'other' then '03' when 'free' then '04'
    when 'starter' then '05' when 'pro' then '06' when 'agency' then '07' when 'pack' then '08'
    when 'expired' then '09' when 'incomplete' then '0a' when 'past_due' then '0b' when 'canceled' then '0c'
    when 'two_rows' then '0d' when 'topup' then '0e' when 'bonus' then '0f' when 'disputed' then '10'
    when 'refunded' then '11' when 'zero' then '12' when 'forced' then '13' when 'inc_expired' then '14'
    when 'non_stripe' then '15' when 'stale_active' then '16' end)::uuid $$;

create function public.t_be(p_who text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claims', case
    when p_who = 'anon' then '{"role":"anon"}'
    when public.t_uid(p_who) is not null
      then json_build_object('sub', public.t_uid(p_who), 'role', 'authenticated')::text
    else '' end, false);
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
-- Text equality, with what came back in the detail.
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

-- ── fixtures (run as the owner; the caller's identity comes from t_be) ──
create function public.t_job(p_ws uuid, p_user uuid) returns uuid language sql as $$
  insert into public.generation_jobs (workspace_id, user_id) values (p_ws, p_user) returning id $$;
create function public.t_asset(p_ws uuid, p_job uuid, p_path text) returns uuid language plpgsql as $$
declare v_gen uuid; v_asset uuid;
begin
  insert into public.generations (job_id, workspace_id) values (p_job, p_ws) returning id into v_gen;
  insert into public.generation_assets (generation_id, storage_path, metadata)
  values (v_gen, p_path, jsonb_build_object('thumb', regexp_replace(p_path, '\.[^./]*$', '') || '_t.webp',
                                            'preview', regexp_replace(p_path, '\.[^./]*$', '') || '_p.webp',
                                            'provider', 'google'))
  returning id into v_asset;
  return v_asset;
end $$;
-- A reserve with valid values, as the current role and JWT.
create function public.t_reserve(p_id uuid, p_ws uuid, p_job uuid, p_path text, p_mime text default 'image/png')
returns jsonb language sql as $$
  select public.trial_original_reserve(public.t_tok(), p_id, p_ws, p_job, 'generator', p_path, public.t_wkey(),
    '0123456789abcdef', public.t_sha('clean:' || p_id::text), p_mime, 1000, 640, 480, '{"variant":"light"}'::jsonb) $$;
-- A complete trial image: reserve → blob uploaded → asset row → attach.
-- Returns the ASSET id; the original's id is t_oid(asset).
create function public.t_make(p_who text, p_ws uuid, p_job uuid, p_name text, p_mime text default 'image/png')
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid(); v_path text := p_ws::text || '/' || p_job::text || '/' || p_name; v_asset uuid; r jsonb;
begin
  perform public.t_be(p_who);
  r := public.t_reserve(v_id, p_ws, p_job, v_path, p_mime);
  insert into storage.objects (bucket_id, name, owner) values ('trial-originals', r->>'object_path', public.t_uid(p_who));
  v_asset := public.t_asset(p_ws, p_job, v_path);
  r := public.trial_original_attach(public.t_tok(), v_id, v_asset, v_path, public.t_sha('marked:' || v_id::text));
  if not (r->>'ok')::boolean then raise exception 't_make attach failed: %', r; end if;
  return v_asset;
end $$;
create function public.t_oid(p_asset uuid) returns uuid language plpgsql stable security definer as $$
declare v uuid; begin execute 'select id from public.trial_originals where asset_id = $1' into v using p_asset; return v; end $$;
create function public.t_row(p_asset uuid) returns jsonb language plpgsql stable security definer as $$
declare v jsonb; begin execute 'select to_jsonb(o) from public.trial_originals o where asset_id = $1' into v using p_asset; return v; end $$;
create function public.t_has_key(p_original uuid) returns boolean language plpgsql stable security definer as $$
declare v boolean; begin execute 'select exists (select 1 from public.trial_original_keys where original_id = $1)' into v using p_original; return v; end $$;
-- The Storage API's delete, as the current role: returns how many rows went.
create function public.t_storage_remove(p_bucket text, p_names text[]) returns integer language plpgsql as $$
declare n integer;
begin
  perform set_config('storage.allow_delete_query', 'true', true);
  with d as (delete from storage.objects where bucket_id = p_bucket and name = any (p_names) returning 1)
  select count(*) into n from d;
  perform set_config('storage.allow_delete_query', '', true);
  return n;
end $$;
create function public.t_enable(p_patch jsonb default '{}'::jsonb) returns void language sql as $$
  update public.app_settings set value = value || jsonb_build_object('enabled', true) || p_patch where key = 'trial_watermark' $$;

-- Everything 0143 creates, as one digest (functions: body, result, ACL,
-- definer, volatility, search_path).
create function public.t_fn_print() returns text language sql stable as $$
  select count(*)::text || '#' || coalesce(string_agg(p.oid::regprocedure::text || ':' || md5(
           p.prosrc || '|' || pg_get_function_result(p.oid) || '|' || coalesce(p.proacl::text, '') || '|'
           || p.prosecdef::text || '|' || p.provolatile::text || '|' || coalesce(array_to_string(p.proconfig, ','), '')),
         ',' order by p.oid::regprocedure::text), '')
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and (p.proname like 'trial\_%' or p.proname in ('asset_derivative_path', 'activity_logs_watermark_guard',
                                                      'set_asset_derivatives', 'app_setting_is_private'))
$$;
create function public.t_storage_policy_print() returns text language sql stable as $$
  select string_agg(policyname || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, ''), ','
                    order by policyname)
    from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname not like 'trial\_originals\_%'
$$;
create function public.t_data_print() returns text language plpgsql stable as $$
begin
  return md5(
    (select coalesce(string_agg(t::text, '|' order by t::text), '') from public.trial_originals t) || '#' ||
    (select coalesce(string_agg(t::text, '|' order by t::text), '') from public.trial_original_keys t) || '#' ||
    (select coalesce(string_agg(t::text, '|' order by t::text), '') from public.app_settings t where key = 'trial_watermark') || '#' ||
    (select count(*)::text from public.activity_logs));
end $$;
SQL
}

# ── fixtures: people, workspaces, billing states ────────────────────────────
seed() {
  q >/dev/null <<'SQL'
insert into public.profiles (id, role) values
  (public.t_uid('admin'), 'admin'), (public.t_uid('customer'), 'user'), (public.t_uid('other'), 'user'),
  (public.t_uid('matrix'), 'user'), (public.t_uid('forced'), 'user'), (public.t_uid('teammate'), 'user');
insert into public.workspaces (id, owner_id) values
  (public.t_ws('staff'), public.t_uid('admin')), (public.t_ws('customer'), public.t_uid('customer')),
  (public.t_ws('other'), public.t_uid('other')), (public.t_ws('forced'), public.t_uid('forced'));
insert into public.workspaces (id, owner_id)
  select public.t_ws(n), public.t_uid('matrix') from unnest(array['free','starter','pro','agency','pack','expired',
    'incomplete','past_due','canceled','two_rows','topup','bonus','disputed','refunded','zero','inc_expired',
    'non_stripe','stale_active']) n;
insert into public.workspace_members (workspace_id, user_id, role)
  select id, owner_id, 'owner' from public.workspaces;
-- the admin acting in a customer's workspace (R33), a teammate of the customer
insert into public.workspace_members values (public.t_ws('customer'), public.t_uid('admin'), 'admin'),
                                            (public.t_ws('customer'), public.t_uid('teammate'), 'editor'),
                                            (public.t_ws('pro'), public.t_uid('forced'), 'editor');
insert into public.credit_wallets (workspace_id) select id from public.workspaces;

insert into public.subscription_plans (slug, name, monthly_credits, price_cents) values
  ('free', 'Free', 25, 0), ('starter', 'Starter', 300, 9900), ('pro', 'PRO', 1000, 29900), ('agency', 'Agency', 5000, 99900);
create function public.t_plan(p text) returns uuid language sql stable as $$ select id from public.subscription_plans where slug = p $$;
insert into public.subscriptions (workspace_id, plan_id, status, current_period_end, provider, provider_subscription_id, created_at) values
  (public.t_ws('free'),     public.t_plan('free'),    'active',   now() + interval '20 days', 'stripe', 'sub_free', now() - interval '10 days'),
  (public.t_ws('starter'),  public.t_plan('starter'), 'active',   now() + interval '20 days', 'stripe', 'sub_starter', now() - interval '10 days'),
  (public.t_ws('pro'),      public.t_plan('pro'),     'active',   now() + interval '20 days', 'stripe', 'sub_pro', now() - interval '10 days'),
  (public.t_ws('agency'),   public.t_plan('agency'),  'active',   now() + interval '20 days', 'stripe', 'sub_agency', now() - interval '10 days'),
  (public.t_ws('expired'),  public.t_plan('pro'),     'active',   now() - interval '1 day',   'stripe', 'sub_expired', now() - interval '40 days'),
  (public.t_ws('incomplete'), public.t_plan('pro'),   'incomplete', null,                     'stripe', 'sub_inc', now() - interval '10 minutes'),
  (public.t_ws('past_due'), public.t_plan('pro'),     'past_due', now() + interval '20 days', 'stripe', 'sub_pd', now() - interval '10 days'),
  (public.t_ws('canceled'), public.t_plan('pro'),     'canceled', now() + interval '20 days', 'stripe', 'sub_can', now() - interval '10 days'),
  (public.t_ws('two_rows'), public.t_plan('pro'),     'canceled', now() - interval '5 days',  'stripe', 'sub_two_old', now() - interval '60 days'),
  (public.t_ws('two_rows'), public.t_plan('starter'), 'active',   now() + interval '25 days', 'stripe', 'sub_two_new', now() - interval '5 days'),
  (public.t_ws('inc_expired'), public.t_plan('pro'),  'incomplete_expired', now() + interval '20 days', 'stripe', 'sub_ie', now() - interval '3 days'),
  (public.t_ws('stale_active'), public.t_plan('pro'), 'active',   now() - interval '2 hours', 'stripe', 'sub_stale', now() - interval '35 days');

create function public.t_wallet(p_ws uuid) returns uuid language sql stable as $$ select id from public.credit_wallets where workspace_id = p_ws $$;
insert into public.payments (workspace_id, amount_cents, status, provider, kind, credits_granted, provider_payment_id) values
  (public.t_ws('pack'),      4900, 'succeeded', 'stripe', 'credit_pack', 200, 'pi_pack'),
  (public.t_ws('disputed'),  4900, 'disputed',  'stripe', 'credit_pack', 200, 'pi_disp'),
  (public.t_ws('refunded'),  4900, 'refunded',  'stripe', 'credit_pack', 200, 'pi_ref'),
  (public.t_ws('zero'),         0, 'succeeded', 'stripe', 'subscription', 300, 'in_zero'),
  (public.t_ws('zero'),      4900, 'succeeded', 'stripe', 'credit_pack',  0,  'pi_nocredits'),
  (public.t_ws('non_stripe'), 4900, 'succeeded', 'manual', 'credit_pack', 200, 'pi_manual');
insert into public.credit_transactions (wallet_id, amount, type, created_by, metadata) values
  (public.t_wallet(public.t_ws('topup')), 500, 'topup', public.t_uid('admin'), '{"source":"admin_panel"}'),
  (public.t_wallet(public.t_ws('bonus')), 150, 'bonus', public.t_uid('matrix'), '{"source":"welcome_survey_bonus"}'),
  (public.t_wallet(public.t_ws('bonus')), 100, 'admin_adjustment', public.t_uid('admin'), '{"source":"admin_panel"}'),
  (public.t_wallet(public.t_ws('bonus')),  50, 'refund', public.t_uid('admin'), '{}'),
  (public.t_wallet(public.t_ws('bonus')),  70, 'bonus', public.t_uid('admin'), '{"stripe_event_id":"evt_fake"}'),
  (public.t_wallet(public.t_ws('bonus')),  80, 'topup', null, '{"stripe_event_id":"evt_fake"}'),
  (public.t_wallet(public.t_ws('customer')), 25, 'bonus', public.t_uid('customer'), '{"source":"signup"}');

-- a media object and a generation-assets object, for the re-scope checks
insert into storage.objects (bucket_id, name) values ('media', 'ice/hero.png'),
  ('generation-assets', public.t_ws('customer')::text || '/00000000-0000-0000-0000-00000000aaaa/0.png');
SQL
}

# ── R. THE REHEARSAL IS WHAT IT CLAIMS TO BE (before 0143) ─────────────────
rehearsal_checks() {
  q >/dev/null <<'SQL'
select public.t_true('R1  the 19 storage.objects policies of 0004/0012/0013/0042/0043 are in place, all TO {public}', 'postgres', $q$
  select count(*) = 19 and bool_and(roles = '{public}'::name[])
    from pg_policies where schemaname = 'storage' and tablename = 'objects' $q$);
select public.t_be('anon');
select public.t_raises('R2  BEFORE 0143, anon reading ANY bucket raises 42501 on is_workspace_member (the R1 blocker, reproduced)', 'anon',
  $q$ select count(*) from storage.objects where bucket_id = 'media' $q$, 'permission denied for function is_workspace_member');
select public.t_true('R3  is_admin / is_workspace_member are definers anon cannot execute (0005)', 'postgres', $q$
  select bool_and(p.prosecdef and not has_function_privilege('anon', p.oid, 'execute')
                  and has_function_privilege('authenticated', p.oid, 'execute'))
    from pg_proc p where p.oid in ('public.is_admin(uuid)'::regprocedure, 'public.is_workspace_member(uuid,uuid)'::regprocedure) $q$);
select public.t_be('customer');
select public.t_eq('R4  auth.uid() reads the JWT claims PostgREST sets', 'authenticated',
  $q$ select auth.uid()::text $q$, 'c0000000-0000-0000-0000-000000000001');
-- The two holes 0143 closes, seen open first.
select public.t_runs('R5  BEFORE 0143, a customer can write a watermark_* event through log_activity (the forgery R8 closes)', 'authenticated',
  $q$ select public.log_activity(public.t_ws('customer'), 'watermark_probe_before') $q$);
select public.t_set('r6_asset', public.t_asset(public.t_ws('customer'), public.t_job(public.t_ws('customer'), public.t_uid('customer')),
  public.t_ws('customer')::text || '/00000000-0000-0000-0000-00000000bbbb/0.png')::text);
select public.t_runs('R6  BEFORE 0143, set_asset_derivatives accepts a path that is NOT the asset''s derivative (R12 closes)', 'authenticated',
  format($q$ select public.set_asset_derivatives(%L::uuid, %L) $q$, public.t_var('r6_asset'),
         public.t_ws('customer')::text || '/00000000-0000-0000-0000-00000000bbbb/9_t.webp'));
insert into public.t_vars values ('policies_before', public.t_storage_policy_print());
insert into public.t_vars values ('private_acl_before',
  (select coalesce(proacl::text, '') from pg_proc where oid = 'public.app_setting_is_private(text)'::regprocedure));
delete from public.activity_logs;
SQL
}

# ── M. APPLY THE REAL FILE — AND AGAIN ──────────────────────────────────────
apply_checks() {
  local mig="$1"
  if apply_migration "$mig"; then
    record 'M1  0143 applies to the pre-0143 schema in one transaction (pg_cron absent: notice, no failure)' true ''
  else
    record 'M1  0143 applies to the pre-0143 schema in one transaction (pg_cron absent: notice, no failure)' false "$(tr '\n' ' ' < "$ERR")"
    SUITE_ABORTED=1
    return 0
  fi
  q -c "insert into public.t_vars values ('fn_after_1', public.t_fn_print())" >/dev/null
  if apply_migration "$mig"; then
    record 'M2  and applies again on top of itself (re-runnable)' true ''
  else
    record 'M2  and applies again on top of itself (re-runnable)' false "$(tr '\n' ' ' < "$ERR")"
  fi
  q >/dev/null <<'SQL'
select public.t_true('M3  the second apply left every 0143 function exactly as the first made it', 'postgres', $q$
  select public.t_fn_print() = public.t_var('fn_after_1') $q$);
select public.t_true('M4  storage.objects: not one {public} policy left; exactly the 5 trial-originals policies, each with an explicit role', 'postgres', $q$
  select (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and roles = '{public}'::name[]) = 0
     and (select array_agg(policyname || ':' || cmd || ':' || roles::text order by policyname) from pg_policies
           where schemaname = 'storage' and tablename = 'objects' and policyname like 'trial\_originals\_%')
         = array['trial_originals_member_delete:DELETE:{authenticated}', 'trial_originals_member_insert:INSERT:{authenticated}',
                 'trial_originals_member_select:SELECT:{authenticated}', 'trial_originals_purge_delete:DELETE:{anon}',
                 'trial_originals_purge_select:SELECT:{anon}'] $q$);
select public.t_true('M5  the 19 re-scoped policies are TO {authenticated} with their USING / WITH CHECK byte for byte unchanged', 'postgres', $q$
  select public.t_storage_policy_print() = public.t_var('policies_before')
     and (select count(*) = 19 and bool_and(roles = '{authenticated}'::name[]) from pg_policies
           where schemaname = 'storage' and tablename = 'objects' and policyname not like 'trial\_originals\_%') $q$);
select public.t_true('M6  bucket trial-originals: private, 50 MB, application/octet-stream only', 'postgres', $q$
  select public = false and file_size_limit = 52428800 and allowed_mime_types = array['application/octet-stream']
    from storage.buckets where id = 'trial-originals' $q$);
select public.t_true('M7  app_settings.trial_watermark seeded dormant, with every key of the serializer + force_trial_user_ids', 'postgres', $q$
  select value = '{"v":1,"enabled":false,"width_ratio":0.5,"opacity":0.38,"luminance_threshold":0.55,"dark_color":"#111111",
                   "glow_radius_ratio":0.015,"glow_opacity":0.2,"original_retention_days":30,"signed_url_ttl_seconds":60,
                   "exempt_staff":true,"force_trial_user_ids":[]}'::jsonb
    from public.app_settings where key = 'trial_watermark' $q$);
select public.t_true('M8  app_setting_is_private: the five 0139 keys and trial_watermark; nothing else became private; ACL unchanged', 'postgres', $q$
  select public.app_setting_is_private('notifications') and public.app_setting_is_private('login_security_dispatch')
     and public.app_setting_is_private('auth_email_hook') and public.app_setting_is_private('ai_background_presets')
     and public.app_setting_is_private('thumbnail') and public.app_setting_is_private('trial_watermark')
     and not public.app_setting_is_private('billing') and not public.app_setting_is_private('general')
     and (select coalesce(proacl::text, '') from pg_proc where oid = 'public.app_setting_is_private(text)'::regprocedure)
         = public.t_var('private_acl_before') $q$);
select public.t_true('M9  the two triggers exist: AFTER DELETE on generation_assets, BEFORE INSERT on activity_logs', 'postgres', $q$
  select exists (select 1 from pg_trigger where tgname = 'trial_originals_asset_deleted' and tgrelid = 'public.generation_assets'::regclass and not tgisinternal)
     and exists (select 1 from pg_trigger where tgname = 'activity_logs_watermark_guard' and tgrelid = 'public.activity_logs'::regclass and not tgisinternal) $q$);
select public.t_true('M10 the dedupe index is UNIQUE on (workspace_id, action, metadata->>dedupe), partial on watermark_% rows with a dedupe', 'postgres', $q$
  select i.indisunique and pg_get_expr(i.indpred, i.indrelid) like '%watermark%' and pg_get_expr(i.indpred, i.indrelid) like '%dedupe%'
    from pg_index i where i.indexrelid = 'public.activity_logs_watermark_dedupe_uq'::regclass $q$);
SQL
}

# ── A. ACLs (R9) ────────────────────────────────────────────────────────────
acl_checks() {
  q >/dev/null <<'SQL'
select public.t_true('A1  RLS is ON for trial_originals, trial_original_keys, trial_originals_purge_heartbeat — and they have NO policies', 'postgres', $q$
  select bool_and(c.relrowsecurity) and not exists (select 1 from pg_policies p where p.schemaname = 'public'
           and p.tablename in ('trial_originals', 'trial_original_keys', 'trial_originals_purge_heartbeat'))
    from pg_class c where c.oid in ('public.trial_originals'::regclass, 'public.trial_original_keys'::regclass,
                                    'public.trial_originals_purge_heartbeat'::regclass) $q$);
select public.t_true('A2  relacl: PUBLIC, anon and authenticated hold no privilege at all on the three tables (the default grants revoked)', 'postgres', $q$
  select not exists (select 1 from pg_class c, aclexplode(c.relacl) a
                      where c.oid in ('public.trial_originals'::regclass, 'public.trial_original_keys'::regclass,
                                      'public.trial_originals_purge_heartbeat'::regclass)
                        and a.grantee in (0, 'anon'::regrole, 'authenticated'::regrole))
     and not has_table_privilege('authenticated', 'public.trial_original_keys', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
     and not has_table_privilege('anon', 'public.trial_originals', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') $q$);

create temp table want (fn regprocedure, grantees text);
insert into want values
  ('public.trial_watermark_decide(text,uuid,integer)', 'authenticated'),
  ('public.trial_watermark_config_read(text)', 'authenticated'),
  ('public.trial_watermark_entitlement(text,uuid)', 'authenticated'),
  ('public.trial_original_reserve(text,uuid,uuid,uuid,text,text,text,text,text,text,integer,integer,integer,jsonb)', 'authenticated'),
  ('public.trial_original_attach(text,uuid,uuid,text,text)', 'authenticated'),
  ('public.trial_original_release(text,uuid)', 'authenticated'),
  ('public.trial_original_states(uuid[])', 'authenticated'),
  ('public.trial_original_summary(uuid)', 'authenticated'),
  ('public.trial_original_unlock_begin(text,uuid,boolean)', 'authenticated'),
  ('public.trial_original_unlock_finish(text,uuid,uuid,text,text,text,uuid)', 'authenticated'),
  ('public.trial_original_unlock_abort(text,uuid,uuid)', 'authenticated'),
  ('public.trial_original_next_batch(text,uuid,integer,uuid[])', 'authenticated'),
  ('public.trial_original_source(text,uuid,text)', 'authenticated'),
  ('public.trial_watermark_log(text,uuid,text,uuid,jsonb,text)', 'authenticated'),
  ('public.trial_watermark_stats(integer)', 'authenticated'),
  ('public.trial_original_uploadable(text)', 'authenticated'),
  ('public.trial_original_purgeable_member(text)', 'authenticated'),
  ('public.set_asset_derivatives(uuid,text,text)', 'authenticated'),
  ('public.trial_original_purgeable(text)', 'anon,authenticated'),
  ('public.trial_originals_sweep_now(text)', 'anon,authenticated'),
  ('public.trial_originals_purge_list(text,integer)', 'anon,authenticated'),
  ('public.trial_originals_mark_purged(text,text[])', 'anon,authenticated'),
  ('public.trial_originals_purge_heartbeat(text,jsonb)', 'anon,authenticated'),
  ('public.trial_originals_sweep()', ''),
  ('public.trial_wm_number(jsonb,numeric,numeric,numeric,boolean)', ''),
  ('public.trial_watermark_config_effective()', ''),
  ('public.trial_wm_subscribed(uuid)', ''),
  ('public.trial_wm_paid_credits(uuid)', ''),
  ('public.asset_derivative_path(text,text)', ''),
  ('public.trial_wm_emit(uuid,uuid,text,uuid,jsonb,text)', ''),
  ('public.trial_wm_confirm_subscriptions(uuid)', ''),
  ('public.trial_originals_asset_deleted()', ''),
  ('public.activity_logs_watermark_guard()', '');
insert into public.test_results (name, ok, detail)
select 'A3  proacl of ' || w.fn::text || ' = EXECUTE to {' || w.grantees || '} only (never PUBLIC)',
       coalesce(g.got, '') = w.grantees and p.proacl is not null,
       'got {' || coalesce(g.got, '') || '}'
  from want w join pg_proc p on p.oid = w.fn
  left join lateral (select string_agg(case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end, ','
                                       order by case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end) as got
                       from aclexplode(p.proacl) a where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner) g on true;
select public.t_true('A4  every function 0143 creates exists (33 checked above) and no other trial_* function slipped in', 'postgres', $q$
  select (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and (proname like 'trial\_%'))
         = (select count(*) from want where fn::text like 'trial\_%' or fn::text like 'public.trial\_%') $q$);
select public.t_true('A5  every token / member / admin function is SECURITY DEFINER with search_path pinned', 'postgres', $q$
  select bool_and(p.prosecdef and array_to_string(p.proconfig, ',') like 'search_path=public%')
    from want w join pg_proc p on p.oid = w.fn
   where w.fn not in ('public.trial_wm_number(jsonb,numeric,numeric,numeric,boolean)'::regprocedure,
                      'public.asset_derivative_path(text,text)'::regprocedure,
                      'public.activity_logs_watermark_guard()'::regprocedure) $q$);
select public.t_true('A5b the three that are not definers are the pure helpers and the guard: invoker, search_path pinned', 'postgres', $q$
  select bool_and(not p.prosecdef and p.proconfig = '{search_path=public}')
    from pg_proc p where p.oid in ('public.trial_wm_number(jsonb,numeric,numeric,numeric,boolean)'::regprocedure,
                                   'public.asset_derivative_path(text,text)'::regprocedure,
                                   'public.activity_logs_watermark_guard()'::regprocedure) $q$);

select public.t_be('anon');
select public.t_raises('A6  anon cannot read trial_originals: permission denied', 'anon',
  $q$ select count(*) from public.trial_originals $q$, 'permission denied for table trial_originals');
select public.t_raises('A7  anon cannot call trial_watermark_decide: permission denied', 'anon',
  $q$ select public.trial_watermark_decide(public.t_tok(), public.t_ws('customer'), 5) $q$, 'permission denied for function trial_watermark_decide');
select public.t_be('customer');
select public.t_raises('A8  a customer cannot read trial_original_keys: permission denied', 'authenticated',
  $q$ select count(*) from public.trial_original_keys $q$, 'permission denied for table trial_original_keys');
select public.t_raises('A9  a customer cannot call the event writer trial_wm_emit directly', 'authenticated',
  $q$ select public.trial_wm_emit(public.t_ws('customer'), auth.uid(), 'watermark_unlocked', null, '{}', null) $q$, 'permission denied for function trial_wm_emit');
select public.t_raises('A10 a customer cannot run the sweep: permission denied', 'authenticated',
  $q$ select public.trial_originals_sweep() $q$, 'permission denied for function trial_originals_sweep');
select public.t_raises('A11 a customer calling a token function with a wrong token: forbidden', 'authenticated',
  $q$ select public.trial_watermark_decide('not-the-token', public.t_ws('customer'), 5) $q$, 'forbidden');
select public.t_raises('A12 … and with no token at all: forbidden', 'authenticated',
  $q$ select public.trial_original_unlock_begin(null, gen_random_uuid(), true) $q$, 'forbidden');
select public.t_true('A13 a customer reads 0 rows of app_settings.trial_watermark (private), but still reads billing', 'authenticated', $q$
  select (select count(*) from public.app_settings where key = 'trial_watermark') = 0
     and (select count(*) from public.app_settings where key = 'billing') = 1 $q$);
select public.t_be('anon');
select public.t_true('A14 anon reads 0 rows of it too', 'anon', $q$ select count(*) = 0 from public.app_settings where key = 'trial_watermark' $q$);
select public.t_be('admin');
select public.t_true('A15 an admin reads it (settings_admin_write)', 'authenticated', $q$ select count(*) = 1 from public.app_settings where key = 'trial_watermark' $q$);
SQL
}

# ── C. THE CONFIG READER NEVER RAISES (R26) ────────────────────────────────
config_checks() {
  q >/dev/null <<'SQL'
select public.t_be('customer');
create function public.t_cfg(p_value jsonb) returns jsonb language plpgsql as $$
begin
  update public.app_settings set value = p_value where key = 'trial_watermark';
  return public.trial_watermark_config_read(public.t_tok());
end $$;
insert into public.t_vars values ('cfg_saved', (select value::text from public.app_settings where key = 'trial_watermark'));
select public.t_eq('C1  a JSON string as the whole row → every default, disabled', 'postgres',
  $q$ select public.t_cfg('"enabled"')::text $q$,
  '{"v": 1, "enabled": false, "opacity": 0.38, "dark_color": "#111111", "width_ratio": 0.5, "exempt_staff": true, "glow_opacity": 0.2, "glow_radius_ratio": 0.015, "luminance_threshold": 0.55, "force_trial_user_ids": [], "signed_url_ttl_seconds": 60, "original_retention_days": 30}');
select public.t_true('C2  JSON null and an array → the same defaults', 'postgres', $q$
  select public.t_cfg('null') = public.t_cfg('[1,2]') and public.t_cfg('[1,2]')->>'enabled' = 'false' $q$);
select public.t_eq('C3  wrong types and ranges fall back field by field; a good value next to them survives', 'postgres', $q$
  select public.t_cfg('{"enabled":"true","width_ratio":"0.5","opacity":5,"luminance_threshold":-1,"dark_color":"red",
                        "glow_radius_ratio":0.3,"glow_opacity":0.5,"original_retention_days":30.5,"signed_url_ttl_seconds":5,
                        "exempt_staff":"false"}')::text $q$,
  '{"v": 1, "enabled": false, "opacity": 0.38, "dark_color": "#111111", "width_ratio": 0.5, "exempt_staff": true, "glow_opacity": 0.5, "glow_radius_ratio": 0.015, "luminance_threshold": 0.55, "force_trial_user_ids": [], "signed_url_ttl_seconds": 60, "original_retention_days": 30}');
select public.t_eq('C4  valid edges are kept: enabled true, #ABCDEF lower-cased, retention 7, 30.0 read as 30, ttl 600, exempt_staff false', 'postgres', $q$
  select (c->>'enabled') || ' ' || (c->>'dark_color') || ' ' || (c->>'original_retention_days') || ' '
         || (public.t_cfg('{"original_retention_days":30.0}')->>'original_retention_days') || ' '
         || (c->>'signed_url_ttl_seconds') || ' ' || (c->>'exempt_staff') || ' ' || (c->>'width_ratio')
    from (select public.t_cfg('{"enabled":true,"dark_color":"#ABCDEF","original_retention_days":7,"signed_url_ttl_seconds":600,
                                "exempt_staff":false,"width_ratio":0.9}') c) s $q$,
  'true #abcdef 7 30 600 false 0.9');
select public.t_eq('C5  force_trial_user_ids keeps valid uuids only (lower-cased, distinct); a non-array is []', 'postgres', $q$
  select (public.t_cfg('{"force_trial_user_ids":["not-a-uuid", 5, null, "C0000000-0000-0000-0000-000000000004",
                                                  "c0000000-0000-0000-0000-000000000004", {"id":1}]}')->'force_trial_user_ids')::text
         || ' ' || (public.t_cfg('{"force_trial_user_ids":"c0000000-0000-0000-0000-000000000004"}')->'force_trial_user_ids')::text $q$,
  '["c0000000-0000-0000-0000-000000000004"] []');
select public.t_true('C6  with the row deleted entirely: defaults, and decide answers off/disabled (no error)', 'postgres', $q$
  with d as (delete from public.app_settings where key = 'trial_watermark' returning 1) select count(*) = 1 from d $q$);
select public.t_true('C6b (… read back)', 'postgres', $q$
  select (public.trial_watermark_config_read(public.t_tok())->>'enabled') = 'false'
     and public.trial_watermark_decide(public.t_tok(), public.t_ws('customer'), 5) @> '{"mode":"off","reason":"disabled"}' $q$);
insert into public.app_settings (key, value) select 'trial_watermark', public.t_var('cfg_saved')::jsonb;
select public.t_true('C7  a garbage row never makes decide raise: off/disabled', 'postgres', $q$
  select public.t_cfg('{"enabled":{"x":1},"opacity":"lots","force_trial_user_ids":{"a":1}}') is not null
     and public.trial_watermark_decide(public.t_tok(), public.t_ws('customer'), 5) @> '{"mode":"off","reason":"disabled"}' $q$);
update public.app_settings set value = public.t_var('cfg_saved')::jsonb where key = 'trial_watermark';
select public.t_be('anon');
select public.t_raises('C8  anon cannot read the config through trial_watermark_config_read', 'anon',
  $q$ select public.trial_watermark_config_read(public.t_tok()) $q$, 'permission denied');
SQL
}

# ── D. THE DECISION MATRIX ─────────────────────────────────────────────────
decide_checks() {
  q >/dev/null <<'SQL'
select public.t_enable();
create function public.t_decide(p_ws text, p_credits integer default 7) returns text language sql as $$
  select (r->>'mode') || '/' || (r->>'reason')
    from (select public.trial_watermark_decide(public.t_tok(), public.t_ws(p_ws), p_credits) r) s $$;
select public.t_be('matrix');
select public.t_eq('D1  Free plan, active → trial/trial', 'authenticated', $q$ select public.t_decide('free') $q$, 'trial/trial');
select public.t_eq('D2  Starter active → paid/subscription', 'authenticated', $q$ select public.t_decide('starter') $q$, 'paid/subscription');
select public.t_eq('D3  PRO active → paid/subscription', 'authenticated', $q$ select public.t_decide('pro') $q$, 'paid/subscription');
select public.t_eq('D4  Agency active → paid/subscription', 'authenticated', $q$ select public.t_decide('agency') $q$, 'paid/subscription');
select public.t_eq('D5  a paid credit pack (Stripe, succeeded, credits granted), no subscription → paid/paid_credits', 'authenticated', $q$ select public.t_decide('pack') $q$, 'paid/paid_credits');
select public.t_eq('D6  an "active" subscription whose period has ended → trial', 'authenticated', $q$ select public.t_decide('expired') $q$, 'trial/trial');
select public.t_eq('D7  incomplete → trial', 'authenticated', $q$ select public.t_decide('incomplete') $q$, 'trial/trial');
select public.t_eq('D8  past_due → trial', 'authenticated', $q$ select public.t_decide('past_due') $q$, 'trial/trial');
select public.t_eq('D9  canceled with a future period end → trial', 'authenticated', $q$ select public.t_decide('canceled') $q$, 'trial/trial');
select public.t_eq('D10 incomplete_expired with a future period end → trial', 'authenticated', $q$ select public.t_decide('inc_expired') $q$, 'trial/trial');
select public.t_eq('D11 two rows (an old canceled PRO, a new active Starter) → paid/subscription', 'authenticated', $q$ select public.t_decide('two_rows') $q$, 'paid/subscription');
select public.t_eq('D12 an admin-recorded top-up (type topup, created_by set) → paid/paid_credits', 'authenticated', $q$ select public.t_decide('topup') $q$, 'paid/paid_credits');
select public.t_eq('D13 bonus / admin_adjustment / refund, a bare topup with no author, a stripe_event_id METADATA key → still trial', 'authenticated', $q$ select public.t_decide('bonus') $q$, 'trial/trial');
select public.t_eq('D14 a disputed payment → trial', 'authenticated', $q$ select public.t_decide('disputed') $q$, 'trial/trial');
select public.t_eq('D15 a refunded payment still counts → paid/paid_credits', 'authenticated', $q$ select public.t_decide('refunded') $q$, 'paid/paid_credits');
select public.t_eq('D16 a 0-amount invoice, and a payment that granted no credits → trial', 'authenticated', $q$ select public.t_decide('zero') $q$, 'trial/trial');
select public.t_eq('D17 a non-Stripe payment → trial', 'authenticated', $q$ select public.t_decide('non_stripe') $q$, 'trial/trial');
select public.t_eq('D18 an active row with a past period (stale) → trial', 'authenticated', $q$ select public.t_decide('stale_active') $q$, 'trial/trial');
select public.t_be('admin');
select public.t_eq('D19 staff in their own workspace (actor AND owner are admins) → paid/staff', 'authenticated', $q$ select public.t_decide('staff') $q$, 'paid/staff');
select public.t_eq('D20 an admin acting in a CUSTOMER''s workspace (owner is not staff) → trial/trial (R33)', 'authenticated', $q$ select public.t_decide('customer') $q$, 'trial/trial');
select public.t_be('customer');
select public.t_eq('D21 the customer in their own never-paid workspace → trial/trial', 'authenticated', $q$ select public.t_decide('customer') $q$, 'trial/trial');
select public.t_enable('{"exempt_staff": false}');
select public.t_be('admin');
select public.t_eq('D22 exempt_staff=false: the admin''s own workspace → trial/trial', 'authenticated', $q$ select public.t_decide('staff') $q$, 'trial/trial');
select public.t_enable(jsonb_build_object('exempt_staff', true, 'force_trial_user_ids', jsonb_build_array(public.t_uid('admin'), public.t_uid('forced'))));
select public.t_eq('D23 forced admin in their own workspace → trial/forced (only the staff exemption is lifted)', 'authenticated', $q$ select public.t_decide('staff') $q$, 'trial/forced');
select public.t_be('forced');
select public.t_eq('D24 a forced customer in a never-paid workspace → trial/forced', 'authenticated', $q$ select public.t_decide('forced') $q$, 'trial/forced');
select public.t_eq('D25 the forced user in a PRO workspace → paid/subscription (forced never overrides paid)', 'authenticated', $q$ select public.t_decide('pro') $q$, 'paid/subscription');
select public.t_be('matrix');
select public.t_eq('D26 a free run (0 credits) → off/free_run, and so is -1', 'authenticated',
  $q$ select public.t_decide('free', 0) || ' ' || public.t_decide('free', -1) $q$, 'off/free_run off/free_run');
select public.t_eq('D27 an unknown price (NULL credits) is decided, not free → trial/trial', 'authenticated', $q$ select public.t_decide('free', null) $q$, 'trial/trial');
select public.t_true('D28 the reply carries the effective config (enabled, retention, the forced list)', 'authenticated', $q$
  select r->'config'->>'enabled' = 'true' and r->'config'->>'original_retention_days' = '30'
     and jsonb_array_length(r->'config'->'force_trial_user_ids') = 2
    from (select public.trial_watermark_decide(public.t_tok(), public.t_ws('free'), 7) r) s $q$);
update public.app_settings set value = value || '{"enabled": false}' where key = 'trial_watermark';
select public.t_eq('D29 disabled → off/disabled even for a paid workspace', 'authenticated', $q$ select public.t_decide('pro') $q$, 'off/disabled');
select public.t_be('forced');
select public.t_eq('D30 … but a forced (test) account is decided as if enabled, so PROD can be checked while customers stay dormant', 'authenticated', $q$ select public.t_decide('forced') $q$, 'trial/forced');
select public.t_enable('{"force_trial_user_ids": []}');
select public.t_be('matrix');
select public.t_true('D31 decide is NEVER null: every workspace × credits {-1, 0, 7, null} answers a mode in off/paid/trial and a reason', 'authenticated', $q$
  select bool_and(r is not null and r->>'mode' in ('off', 'paid', 'trial') and r->>'reason' is not null)
    from unnest(array['free','starter','pro','agency','pack','expired','incomplete','past_due','canceled','two_rows','topup',
                      'bonus','disputed','refunded','zero','inc_expired','non_stripe','stale_active']) w,
         unnest(array[-1, 0, 7, null]::integer[]) c,
         lateral (select public.trial_watermark_decide(public.t_tok(), public.t_ws(w), c) r) x $q$);
select public.t_raises('D32 a workspace the caller is not a member of → forbidden', 'authenticated',
  $q$ select public.t_decide('customer') $q$, 'forbidden');
select public.t_be('nobody');
select public.t_raises('D33 a signed-in role with no sub → forbidden', 'authenticated', $q$ select public.t_decide('free') $q$, 'forbidden');
SQL
}

# ── V. RESERVE / ATTACH / RELEASE ───────────────────────────────────────────
reserve_checks() {
  q >/dev/null <<'SQL'
select public.t_set('job1', public.t_job(public.t_ws('customer'), public.t_uid('customer'))::text);
select public.t_set('other_job', public.t_job(public.t_ws('other'), public.t_uid('other'))::text);
select public.t_set('v_id', gen_random_uuid()::text);
select public.t_set('v_path', public.t_ws('customer')::text || '/' || public.t_var('job1') || '/0.png');
select public.t_be('customer');
select public.t_true('V1  reserve: the answer names the server''s id, {ws}/{id}.bin and the config''s retention', 'authenticated', $q$
  select r->>'id' = public.t_var('v_id') and r->>'object_path' = public.t_ws('customer')::text || '/' || public.t_var('v_id') || '.bin'
     and r->>'retention_days' = '30'
    from (select public.t_reserve(public.t_var('v_id')::uuid, public.t_ws('customer'), public.t_var('job1')::uuid, public.t_var('v_path')) r) s $q$);
select public.t_true('V2  … the row is pending, unbound, no expiry yet, made by the caller; its wrapped key stored beside it', 'postgres', $q$
  select o.status = 'pending' and o.asset_id is null and o.expires_at is null and o.user_id = public.t_uid('customer')
     and o.retention_days = 30 and o.marked_path = public.t_var('v_path') and o.watermark = '{"variant":"light"}'
     and public.t_has_key(o.id)
    from public.trial_originals o where o.id = public.t_var('v_id')::uuid $q$);
-- every refusal
create function public.t_res(p_patch jsonb) returns jsonb language plpgsql as $$
declare a jsonb := jsonb_build_object('id', gen_random_uuid(), 'ws', public.t_ws('customer'), 'job', public.t_var('job1'),
  'op', 'generator', 'path', public.t_ws('customer')::text || '/' || public.t_var('job1') || '/' || (random()*1e9)::bigint || '.png',
  'key', public.t_wkey(), 'fp', '0123456789abcdef', 'sha', public.t_sha('x'), 'mime', 'image/png', 'bytes', 10, 'w', 10, 'h', 10,
  'wm', '{}'::jsonb) || p_patch;
begin
  return public.trial_original_reserve(public.t_tok(), (a->>'id')::uuid, (a->>'ws')::uuid, (a->>'job')::uuid, a->>'op', a->>'path',
    a->>'key', a->>'fp', a->>'sha', a->>'mime', (a->>'bytes')::integer, (a->>'w')::integer, (a->>'h')::integer, a->'wm');
end $$;
select public.t_raises('V3  a wrapped key of 79 characters → invalid_wrapped_key', 'authenticated', $q$ select public.t_res(jsonb_build_object('key', left(public.t_wkey(), 79))) $q$, 'invalid_wrapped_key');
select public.t_raises('V4  … of 81 → invalid_wrapped_key', 'authenticated', $q$ select public.t_res(jsonb_build_object('key', public.t_wkey() || 'A')) $q$, 'invalid_wrapped_key');
select public.t_raises('V5  … 80 characters outside base64 → invalid_wrapped_key', 'authenticated', $q$ select public.t_res(jsonb_build_object('key', repeat('-', 80))) $q$, 'invalid_wrapped_key');
select public.t_raises('V6  a KEK fingerprint that is not 16 lower-hex → invalid_kek_fp', 'authenticated', $q$ select public.t_res('{"fp":"0123456789ABCDEF"}') $q$, 'invalid_kek_fp');
select public.t_raises('V7  a 63-hex sha256 → invalid_sha256', 'authenticated', $q$ select public.t_res(jsonb_build_object('sha', left(public.t_sha('x'), 63))) $q$, 'invalid_sha256');
select public.t_raises('V8  image/gif → invalid_mime', 'authenticated', $q$ select public.t_res('{"mime":"image/gif"}') $q$, 'invalid_mime');
select public.t_raises('V9  a marked path in ANOTHER workspace → invalid_marked_path', 'authenticated',
  $q$ select public.t_res(jsonb_build_object('path', public.t_ws('other')::text || '/' || public.t_var('job1') || '/0.png')) $q$, 'invalid_marked_path');
select public.t_raises('V10 a marked path with ".." → invalid_marked_path', 'authenticated',
  $q$ select public.t_res(jsonb_build_object('path', public.t_ws('customer')::text || '/../x/0.png')) $q$, 'invalid_marked_path');
select public.t_raises('V11 an operation outside [a-z0-9_.-] → invalid_operation', 'authenticated', $q$ select public.t_res('{"op":"Bad Op"}') $q$, 'invalid_operation');
select public.t_raises('V12 no id → invalid_id', 'authenticated', $q$ select public.t_res('{"id":null}') $q$, 'invalid_id');
select public.t_raises('V13 a job of another workspace → invalid_job', 'authenticated',
  $q$ select public.t_res(jsonb_build_object('job', public.t_var('other_job'))) $q$, 'invalid_job');
select public.t_raises('V14 watermark params that are not an object → invalid_watermark', 'authenticated', $q$ select public.t_res('{"wm":[1]}') $q$, 'invalid_watermark');
select public.t_raises('V15 0 bytes → invalid_size', 'authenticated', $q$ select public.t_res('{"bytes":0}') $q$, 'invalid_size');
select public.t_raises('V16 the same marked path while the first is live → reserve_conflict (R20)', 'authenticated',
  $q$ select public.t_res(jsonb_build_object('path', public.t_var('v_path'))) $q$, 'reserve_conflict');
select public.t_raises('V17 the same id again → reserve_conflict', 'authenticated',
  $q$ select public.t_res(jsonb_build_object('id', public.t_var('v_id'))) $q$, 'reserve_conflict');
select public.t_be('other');
select public.t_raises('V18 another tenant reserving in the customer''s workspace → forbidden', 'authenticated',
  $q$ select public.t_res('{}') $q$, 'forbidden');
select public.t_true('V19 none of the refusals left a row behind', 'postgres', $q$ select count(*) = 1 from public.trial_originals $q$);

-- attach
select public.t_set('v_asset', public.t_asset(public.t_ws('customer'), public.t_var('job1')::uuid, public.t_var('v_path'))::text);
select public.t_set('o_asset', public.t_asset(public.t_ws('other'), public.t_job(public.t_ws('other'), public.t_uid('other')),
  public.t_ws('other')::text || '/00000000-0000-0000-0000-00000000cccc/0.png')::text);
select public.t_set('v_asset_wrongpath', public.t_asset(public.t_ws('customer'), public.t_var('job1')::uuid,
  public.t_ws('customer')::text || '/' || public.t_var('job1') || '/7.png')::text);
select public.t_be('other');
select public.t_eq('V20 attach by another tenant → not_found (nothing learned)', 'authenticated',
  $q$ select public.trial_original_attach(public.t_tok(), public.t_var('v_id')::uuid, public.t_var('v_asset')::uuid, public.t_var('v_path'), public.t_sha('m'))->>'error' $q$, 'not_found');
select public.t_be('customer');
select public.t_eq('V21 attach to an asset of another workspace → asset_mismatch', 'authenticated',
  $q$ select public.trial_original_attach(public.t_tok(), public.t_var('v_id')::uuid, public.t_var('o_asset')::uuid, public.t_var('v_path'), public.t_sha('m'))->>'error' $q$, 'asset_mismatch');
select public.t_eq('V22 attach naming a path other than the reserved one → path_mismatch', 'authenticated',
  $q$ select public.trial_original_attach(public.t_tok(), public.t_var('v_id')::uuid, public.t_var('v_asset_wrongpath')::uuid,
         public.t_ws('customer')::text || '/' || public.t_var('job1') || '/7.png', public.t_sha('m'))->>'error' $q$, 'path_mismatch');
select public.t_eq('V23 attach to an asset whose file is elsewhere → asset_mismatch', 'authenticated',
  $q$ select public.trial_original_attach(public.t_tok(), public.t_var('v_id')::uuid, public.t_var('v_asset_wrongpath')::uuid, public.t_var('v_path'), public.t_sha('m'))->>'error' $q$, 'asset_mismatch');
select public.t_eq('V24 attach with a bad sha → invalid_sha256', 'authenticated',
  $q$ select public.trial_original_attach(public.t_tok(), public.t_var('v_id')::uuid, public.t_var('v_asset')::uuid, public.t_var('v_path'), 'nope')->>'error' $q$, 'invalid_sha256');
select public.t_true('V25 attach → ok; locked, bound, expires_at = created_at + 30 days exactly', 'authenticated', $q$
  select (public.trial_original_attach(public.t_tok(), public.t_var('v_id')::uuid, public.t_var('v_asset')::uuid, public.t_var('v_path'), public.t_sha('m'))->>'ok')::boolean $q$);
select public.t_true('V26 (… read back)', 'postgres', $q$
  select status = 'locked' and asset_id = public.t_var('v_asset')::uuid and marked_sha256 = public.t_sha('m')
     and expires_at = created_at + interval '30 days'
    from public.trial_originals where id = public.t_var('v_id')::uuid $q$);
select public.t_set('v_expires', (select expires_at::text from public.trial_originals where id = public.t_var('v_id')::uuid));
select public.t_true('V27 attach again with the same asset → ok (idempotent), expiry unchanged', 'authenticated', $q$
  select (r->>'ok')::boolean and (r->>'expires_at')::timestamptz = public.t_var('v_expires')::timestamptz
    from (select public.trial_original_attach(public.t_tok(), public.t_var('v_id')::uuid, public.t_var('v_asset')::uuid, public.t_var('v_path'), public.t_sha('m')) r) s $q$);
select public.t_set('v2_id', gen_random_uuid()::text);
select public.t_runs('V28 a second original of the same job, its path not chosen yet…', 'authenticated',
  $q$ select public.t_reserve(public.t_var('v2_id')::uuid, public.t_ws('customer'), public.t_var('job1')::uuid, null) $q$);
select public.t_eq('V29 … cannot be attached to an asset another original is bound to → asset_taken', 'authenticated',
  $q$ select public.trial_original_attach(public.t_tok(), public.t_var('v2_id')::uuid, public.t_var('v_asset')::uuid,
       public.t_var('v_path'), public.t_sha('m'))->>'error' $q$, 'asset_taken');
-- Miniaturka: the path is chosen after the reserve
select public.t_set('v3_id', gen_random_uuid()::text);
select public.t_set('job_mini', public.t_job(public.t_ws('customer'), public.t_uid('customer'))::text);
select public.t_runs('V30 a reserve with NO marked path (Miniaturka chooses it later)', 'authenticated',
  $q$ select public.t_reserve(public.t_var('v3_id')::uuid, public.t_ws('customer'), public.t_var('job_mini')::uuid, null) $q$);
select public.t_set('mini_path', public.t_ws('customer')::text || '/' || public.t_var('job_mini') || '/' || gen_random_uuid()::text || '.png');
select public.t_set('mini_asset', public.t_asset(public.t_ws('customer'), public.t_var('job_mini')::uuid, public.t_var('mini_path'))::text);
select public.t_true('V31 … attached with the path it got: locked, marked_path recorded', 'authenticated', $q$
  select (public.trial_original_attach(public.t_tok(), public.t_var('v3_id')::uuid, public.t_var('mini_asset')::uuid,
            public.t_var('mini_path'), public.t_sha('mm'))->>'ok')::boolean $q$);
select public.t_true('V32 (… read back)', 'postgres', $q$
  select status = 'locked' and marked_path = public.t_var('mini_path') from public.trial_originals where id = public.t_var('v3_id')::uuid $q$);
-- release
select public.t_true('V33 release a pending original → its object path back; orphaned; key destroyed', 'authenticated', $q$
  select public.trial_original_release(public.t_tok(), public.t_var('v2_id')::uuid)->>'object_path'
         = public.t_ws('customer')::text || '/' || public.t_var('v2_id') || '.bin' $q$);
select public.t_true('V34 (… read back)', 'postgres', $q$
  select status = 'orphaned' and not public.t_has_key(id) from public.trial_originals where id = public.t_var('v2_id')::uuid $q$);
select public.t_true('V35 release again → the same path (idempotent)', 'authenticated', $q$
  select public.trial_original_release(public.t_tok(), public.t_var('v2_id')::uuid)->>'object_path' is not null $q$);
select public.t_true('V36 release of a LOCKED original → no path, nothing changes (it keeps its key)', 'authenticated', $q$
  select public.trial_original_release(public.t_tok(), public.t_var('v_id')::uuid)->'object_path' = 'null'::jsonb $q$);
select public.t_true('V37 (… still locked with its key)', 'postgres', $q$
  select status = 'locked' and public.t_has_key(id) from public.trial_originals where id = public.t_var('v_id')::uuid $q$);
select public.t_be('other');
select public.t_true('V38 release by another tenant → no path, nothing changes', 'authenticated', $q$
  select public.trial_original_release(public.t_tok(), public.t_var('v3_id')::uuid)->>'state' = 'not_found' $q$);
-- retention frozen per row
select public.t_enable('{"original_retention_days": 7}');
select public.t_be('customer');
select public.t_set('v7_id', gen_random_uuid()::text);
select public.t_eq('V39 a reserve under retention 7 → retention_days 7', 'authenticated',
  $q$ select public.t_reserve(public.t_var('v7_id')::uuid, public.t_ws('customer'), public.t_var('job1')::uuid,
       public.t_ws('customer')::text || '/' || public.t_var('job1') || '/2.png')->>'retention_days' $q$, '7');
select public.t_enable('{"original_retention_days": 30}');
select public.t_true('V40 setting the config back to 30 changes no existing row (7 stays 7, 30 stays 30)', 'postgres', $q$
  select (select retention_days from public.trial_originals where id = public.t_var('v7_id')::uuid) = 7
     and (select retention_days from public.trial_originals where id = public.t_var('v_id')::uuid) = 30 $q$);
SQL
}

# ── S. STATES AND RETENTION AT EXACT TIMES ─────────────────────────────────
states_checks() {
  q >/dev/null <<'SQL'
select public.t_set('jobs', public.t_job(public.t_ws('customer'), public.t_uid('customer'))::text);
select public.t_set('s_new', public.t_make('customer', public.t_ws('customer'), public.t_var('jobs')::uuid, '0.png')::text);
select public.t_set('s_29', public.t_make('customer', public.t_ws('customer'), public.t_var('jobs')::uuid, '1.png')::text);
select public.t_set('s_30m', public.t_make('customer', public.t_ws('customer'), public.t_var('jobs')::uuid, '2.jpg', 'image/jpeg')::text);
select public.t_set('s_30', public.t_make('customer', public.t_ws('customer'), public.t_var('jobs')::uuid, '3.png')::text);
select public.t_set('s_31', public.t_make('customer', public.t_ws('customer'), public.t_var('jobs')::uuid, '4.webp', 'image/webp')::text);
select public.t_set('s_pending_path', public.t_ws('customer')::text || '/' || public.t_var('jobs') || '/5.png');
select public.t_reserve(gen_random_uuid(), public.t_ws('customer'), public.t_var('jobs')::uuid, public.t_var('s_pending_path'));
select public.t_set('s_pending', public.t_asset(public.t_ws('customer'), public.t_var('jobs')::uuid, public.t_var('s_pending_path'))::text);
-- an orphaned original whose marked file IS in the library (attach and heal never happened)
select public.t_set('s_orph_path', public.t_ws('customer')::text || '/' || public.t_var('jobs') || '/6.png');
select public.t_set('s_orph_id', gen_random_uuid()::text);
select public.t_reserve(public.t_var('s_orph_id')::uuid, public.t_ws('customer'), public.t_var('jobs')::uuid, public.t_var('s_orph_path'));
select public.trial_original_release(public.t_tok(), public.t_var('s_orph_id')::uuid);
select public.t_set('s_orph', public.t_asset(public.t_ws('customer'), public.t_var('jobs')::uuid, public.t_var('s_orph_path'))::text);
select public.t_set('s_other', public.t_make('other', public.t_ws('other'), public.t_job(public.t_ws('other'), public.t_uid('other')), '0.png')::text);
-- time travel (the owner moves the clock of the rows, not the clock)
update public.trial_originals set created_at = now() - interval '29 days' where asset_id = public.t_var('s_29')::uuid;
update public.trial_originals set created_at = now() - interval '31 days' where asset_id = public.t_var('s_31')::uuid;
update public.trial_originals set expires_at = created_at + make_interval(days => retention_days)
 where asset_id in (public.t_var('s_29')::uuid, public.t_var('s_31')::uuid);
-- a deleted original whose asset is (somehow) still there
select public.t_set('s_del', public.t_make('customer', public.t_ws('customer'), public.t_var('jobs')::uuid, '7.png')::text);
update public.trial_originals set status = 'deleted', deleted_at = now() where asset_id = public.t_var('s_del')::uuid;
delete from public.trial_original_keys where original_id = public.t_oid(public.t_var('s_del')::uuid);

create function public.t_state(p_asset text) returns text language sql as $$
  select coalesce((select (e->>'state') || ':' || coalesce(e->>'days_left', '-')
                     from jsonb_array_elements(public.trial_original_states(array[public.t_var(p_asset)::uuid])) e), 'absent') $$;
select public.t_be('customer');
select public.t_eq('S1  a fresh original: locked, 30 days left', 'authenticated', $q$ select public.t_state('s_new') $q$, 'locked:30');
select public.t_eq('S2  at +29 days: locked, 1 day left', 'authenticated', $q$ select public.t_state('s_29') $q$, 'locked:1');
select public.t_eq('S5  at +31 days: expired (the sweep has not run: the predicate decides)', 'authenticated', $q$ select public.t_state('s_31') $q$, 'expired:-');
SQL
  # +30 days − 1 s and +30 days EXACTLY, inside one transaction: `now()` is
  # the same instant on both sides of `<=`, so the boundary is exact rather
  # than a race with the clock.
  q >/dev/null <<'SQL'
select public.t_be('customer');
begin;
update public.trial_originals set created_at = now() - interval '30 days' + interval '1 second',
       expires_at = now() + interval '1 second' where asset_id = public.t_var('s_30m')::uuid;
update public.trial_originals set created_at = now() - interval '30 days', expires_at = now() where asset_id = public.t_var('s_30')::uuid;
select public.t_set('s30m_state', public.t_state('s_30m'));
select public.t_set('s30_state', public.t_state('s_30'));
commit;
select public.t_eq('S3  at +30 days − 1 second: still locked, 1 day left (ceil, never 0)', 'postgres', $q$ select public.t_var('s30m_state') $q$, 'locked:1');
select public.t_eq('S4  at +30 days exactly (expires_at = now()): expired', 'postgres', $q$ select public.t_var('s30_state') $q$, 'expired:-');
select public.t_be('customer');
select public.t_eq('S6  a pending original is omitted', 'authenticated', $q$ select public.t_state('s_pending') $q$, 'absent');
select public.t_eq('S7  an orphaned original whose marked file is in the library → unavailable (found by path)', 'authenticated', $q$ select public.t_state('s_orph') $q$, 'unavailable:-');
select public.t_eq('S7b a deleted original → unavailable', 'authenticated', $q$ select public.t_state('s_del') $q$, 'unavailable:-');
select public.t_eq('S8  another tenant''s asset is not reported to the customer', 'authenticated', $q$ select public.t_state('s_other') $q$, 'absent');
select public.t_true('S9  expires_at is reported for a locked asset only', 'authenticated', $q$
  select (select e->>'expires_at' from jsonb_array_elements(public.trial_original_states(array[public.t_var('s_new')::uuid])) e) is not null
     and (select e->'expires_at' from jsonb_array_elements(public.trial_original_states(array[public.t_var('s_31')::uuid])) e) = 'null'::jsonb $q$);
select public.t_true('S10 at most 200 ids are read: the 201st is ignored, the 1st is answered', 'authenticated', $q$
  select jsonb_array_length(public.trial_original_states(array_prepend(public.t_var('s_new')::uuid,
           (select array_agg(gen_random_uuid()) from generate_series(1, 249))))) = 1
     and jsonb_array_length(public.trial_original_states(
           (select array_agg(gen_random_uuid()) from generate_series(1, 200)) || public.t_var('s_new')::uuid)) = 0 $q$);
select public.t_eq('S11 null and empty inputs → []', 'authenticated',
  $q$ select public.trial_original_states(null)::text || public.trial_original_states('{}')::text $q$, '[][]');
select public.t_be('teammate');
select public.t_eq('S12 a teammate (editor) of the workspace sees the same state', 'authenticated', $q$ select public.t_state('s_29') $q$, 'locked:1');
select public.t_be('other');
select public.t_eq('S13 the other tenant asking for the customer''s asset → nothing', 'authenticated', $q$ select public.t_state('s_new') $q$, 'absent');
select public.t_be('anon');
select public.t_raises('S14 anon → permission denied', 'anon', $q$ select public.trial_original_states(array[gen_random_uuid()]) $q$, 'permission denied');
select public.t_be('customer');
select public.t_true('S15 summary: locked = the unexpired locked/unlocking of the workspace, nearest_expires_at = the earliest of them (≈ +1 day)', 'postgres', $q$
  select (r->>'locked')::integer = (select count(*) from public.trial_originals where workspace_id = public.t_ws('customer')
                                      and status in ('locked', 'unlocking') and expires_at > now())
     and (r->>'locked')::integer >= 4
     and (r->>'nearest_expires_at')::timestamptz = (select min(expires_at) from public.trial_originals where workspace_id = public.t_ws('customer')
                                      and status in ('locked', 'unlocking') and expires_at > now())
     and (r->>'nearest_expires_at')::timestamptz < now() + interval '25 hours'
    from (select public.trial_original_summary(public.t_ws('customer')) r) s $q$);
select public.t_raises('S16 summary of another workspace → forbidden', 'authenticated',
  $q$ select public.trial_original_summary(public.t_ws('other')) $q$, 'forbidden');
SQL
}

# ── U. UNLOCK: BEGIN / FINISH / ABORT / BATCH ──────────────────────────────
unlock_checks() {
  q >/dev/null <<'SQL'
select public.t_set('ju', public.t_job(public.t_ws('customer'), public.t_uid('customer'))::text);
select public.t_set('u1', public.t_make('customer', public.t_ws('customer'), public.t_var('ju')::uuid, '0.png')::text);
select public.t_set('u2', public.t_make('customer', public.t_ws('customer'), public.t_var('ju')::uuid, '1.jpg', 'image/jpeg')::text);
select public.t_set('u3', public.t_make('customer', public.t_ws('customer'), public.t_var('ju')::uuid, '2.webp', 'image/webp')::text);
select public.t_set('u4', public.t_make('customer', public.t_ws('customer'), public.t_var('ju')::uuid, '3.png')::text);
select public.t_set('u1_marked', public.t_ws('customer')::text || '/' || public.t_var('ju') || '/0.png');
-- a Miniaturka run that used u1 as a Retusz input and a run of ANOTHER workspace naming the same string
insert into public.ai_engine_runs (id, workspace_id, user_id, outputs, progress) values
  ('f0000000-0000-0000-0000-000000000001', public.t_ws('customer'), public.t_uid('customer'),
   jsonb_build_array(jsonb_build_object('path', public.t_var('u1_marked'), 'step', 3, 'item', -1), jsonb_build_object('path', 'x/y/z.png')),
   jsonb_build_object('stage', 'done', 'delivered', jsonb_build_object('job_id', public.t_var('ju'), 'path', public.t_var('u1_marked')))),
  ('f0000000-0000-0000-0000-000000000002', public.t_ws('other'), public.t_uid('other'),
   jsonb_build_array(jsonb_build_object('path', public.t_var('u1_marked'))), '{}');
insert into public.ai_engine_step_runs (run_id, "position", item_index, output) values
  ('f0000000-0000-0000-0000-000000000001', 1, 0, jsonb_build_object('job_id', public.t_var('ju'), 'path', public.t_var('u1_marked'), 'credits', 7)),
  ('f0000000-0000-0000-0000-000000000001', 3, -1, jsonb_build_object('path', 'other/file.png')),
  ('f0000000-0000-0000-0000-000000000002', 1, 0, jsonb_build_object('path', public.t_var('u1_marked')));

create function public.t_begin(p_asset text, p_live boolean default true) returns jsonb language sql as $$
  select public.trial_original_unlock_begin(public.t_tok(), public.t_var(p_asset)::uuid, p_live) $$;
-- The lease a begin handed out, as the row holds it (null once committed or given back).
create function public.t_lease(p_asset text) returns uuid language sql as $$
  select (public.t_row(public.t_var(p_asset)::uuid)->>'lease_id')::uuid $$;
create function public.t_ent() returns jsonb language sql as $$
  select public.trial_watermark_entitlement(public.t_tok(), public.t_ws('customer')) $$;

select public.t_be('customer');
select public.t_true('U1  never paid: begin → not_entitled, and the answer carries no key', 'authenticated', $q$
  select r = '{"state":"not_entitled"}'::jsonb from (select public.t_begin('u1') r) s $q$);
select public.t_eq('U2  entitlement: not entitled, not pending, no live subscription, no plan', 'authenticated',
  $q$ select (r->>'entitled') || (r->>'pending') || (r->>'has_live_subscription') || coalesce(r->>'plan_slug', '-') from (select public.t_ent() r) s $q$,
  'falsefalsefalse-');
insert into public.subscriptions (workspace_id, plan_id, status, provider, provider_subscription_id, created_at)
  values (public.t_ws('customer'), public.t_plan('pro'), 'incomplete', 'stripe', 'sub_c_inc', now() - interval '5 minutes');
select public.t_eq('U3  an incomplete row < 2 h old → pending (the paywall waits instead of selling twice)', 'authenticated',
  $q$ select (r->>'entitled') || (r->>'pending') from (select public.t_ent() r) s $q$, 'falsetrue');
update public.subscriptions set created_at = now() - interval '3 hours' where provider_subscription_id = 'sub_c_inc';
select public.t_eq('U4  … older than 2 h → not pending', 'authenticated', $q$ select (public.t_ent())->>'pending' $q$, 'false');
insert into public.payments (workspace_id, amount_cents, status, provider, kind, credits_granted, provider_payment_id)
  values (public.t_ws('customer'), 29900, 'succeeded', 'stripe', 'subscription', 1000, 'in_c_1');
select public.t_eq('U5  a succeeded subscription payment in the last 24 h while no row is entitled → pending', 'authenticated',
  $q$ select (public.t_ent())->>'pending' $q$, 'true');
update public.subscriptions set status = 'past_due', current_period_end = now() + interval '20 days' where provider_subscription_id = 'sub_c_inc';
select public.t_eq('U6  past_due → not entitled, but has_live_subscription (manage, never a second plan)', 'authenticated',
  $q$ select (r->>'entitled') || (r->>'has_live_subscription') || (r->>'status') from (select public.t_ent() r) s $q$, 'falsetruepast_due');
update public.subscriptions set status = 'active' where provider_subscription_id = 'sub_c_inc';
select public.t_eq('U7  active PRO now → entitled, plan pro, provider stripe, its id, not pending', 'authenticated',
  $q$ select (r->>'entitled') || (r->>'pending') || (r->>'plan_slug') || (r->>'provider') || (r->>'provider_subscription_id') from (select public.t_ent() r) s $q$,
  'truefalseprostripesub_c_inc');
select public.t_eq('U8  entitled in the database but the live Stripe check said no (p_live_ok false) → not_entitled', 'authenticated',
  $q$ select (public.t_begin('u1', false))->>'state' $q$, 'not_entitled');
select public.t_be('other');
select public.t_eq('U9  another tenant → not_found', 'authenticated', $q$ select (public.t_begin('u1'))->>'state' $q$, 'not_found');
select public.t_be('matrix');
select public.t_eq('U10 a signed-in non-member → not_found', 'authenticated', $q$ select (public.t_begin('u1'))->>'state' $q$, 'not_found');
select public.t_raises('U11 entitlement of a workspace the caller is not in → forbidden', 'authenticated', $q$ select public.t_ent() $q$, 'forbidden');
select public.t_be('customer');
select public.t_true('U12 begin → ready: the key, the KEK fingerprint, the hash, the mime and the DB-derived target {ws}/{job}/u-{id}.png', 'authenticated', $q$
  select r->>'state' = 'ready' and r->>'wrapped_key' = public.t_wkey() and r->>'kek_fp' = '0123456789abcdef'
     and r->>'original_id' = public.t_oid(public.t_var('u1')::uuid)::text and r->>'workspace_id' = public.t_ws('customer')::text
     and r->>'job_id' = public.t_var('ju') and r->>'clean_mime' = 'image/png'
     and r->>'object_path' = public.t_ws('customer')::text || '/' || (r->>'original_id') || '.bin'
     and r->>'target_path' = public.t_ws('customer')::text || '/' || public.t_var('ju') || '/u-' || (r->>'original_id') || '.png'
     and r->>'lease_id' ~ '^[0-9a-f-]{36}$'
    from (select public.t_begin('u1') r) s $q$);
select public.t_true('U13 (… the row is unlocking, with a 3-minute lease, its lease id and the target recorded)', 'postgres', $q$
  select r->>'status' = 'unlocking' and (r->>'lease_until')::timestamptz between now() + interval '170 seconds' and now() + interval '3 minutes'
     and r->>'lease_id' is not null and r->>'target_path' like '%/u-%.png'
    from (select public.t_row(public.t_var('u1')::uuid) r) s $q$);
select public.t_set('u1_lease', public.t_row(public.t_var('u1')::uuid)->>'lease_until');
select public.t_set('u1_target', public.t_row(public.t_var('u1')::uuid)->>'target_path');
select public.t_set('u1_lid', public.t_lease('u1')::text);
select public.t_true('U14 begin again while that lease is live → busy, and no key: one request at a time, never a shared target; the lease is not moved', 'authenticated', $q$
  select r = '{"state":"busy"}'::jsonb
     and (public.t_row(public.t_var('u1')::uuid)->>'lease_until') = public.t_var('u1_lease')
     and public.t_lease('u1')::text = public.t_var('u1_lid')
    from (select public.t_begin('u1') r) s $q$);
select public.t_true('U15 the jpeg and webp originals get .jpg and .webp targets', 'authenticated', $q$
  select (public.t_begin('u2'))->>'target_path' like '%/u-%.jpg' and (public.t_begin('u3'))->>'target_path' like '%/u-%.webp' $q$);
select public.t_eq('U16 states reports an unlocking asset as locked', 'authenticated', $q$ select split_part(public.t_state('u1'), ':', 1) $q$, 'locked');
select public.t_raises('U17 finish with a thumb that is not the target''s derivative → invalid_thumb_path', 'authenticated',
  $q$ select public.trial_original_unlock_finish(public.t_tok(), public.t_var('u1')::uuid, public.t_lease('u1'), public.t_var('u1_marked'), null, 'single', null) $q$, 'invalid_thumb_path');
select public.t_raises('U18 finish with a via outside single/bulk → invalid_via', 'authenticated',
  $q$ select public.trial_original_unlock_finish(public.t_tok(), public.t_var('u1')::uuid, public.t_lease('u1'), null, null, 'api', null) $q$, 'invalid_via');
select public.t_be('other');
select public.t_eq('U19 finish by another tenant → not_found', 'authenticated',
  $q$ select public.trial_original_unlock_finish(public.t_tok(), public.t_var('u1')::uuid, public.t_lease('u1'), null, null, 'single', null)->>'state' $q$, 'not_found');
select public.t_be('customer');
select public.t_eq('U19b finish naming ANOTHER lease (a stale or concurrent request) → lease_lost, nothing committed', 'authenticated',
  $q$ select public.trial_original_unlock_finish(public.t_tok(), public.t_var('u1')::uuid, gen_random_uuid(), null, null, 'single', null)->>'state' $q$, 'lease_lost');
select public.t_eq('U19c … and finish naming NO lease → lease_lost', 'authenticated',
  $q$ select public.trial_original_unlock_finish(public.t_tok(), public.t_var('u1')::uuid, null, null, null, 'single', null)->>'state' $q$, 'lease_lost');
select public.t_true('U19d (… the row is still unlocking under its own lease, the asset still the marked file, the key kept)', 'postgres', $q$
  select r->>'status' = 'unlocking' and r->>'lease_id' = public.t_var('u1_lid') and public.t_has_key((r->>'id')::uuid)
     and (select storage_path = public.t_var('u1_marked') from public.generation_assets where id = public.t_var('u1')::uuid)
    from (select public.t_row(public.t_var('u1')::uuid) r) s $q$);
select public.t_true('U20 finish (thumb = the target''s _t, no preview) → unlocked, not already, storage_path = target, old_paths = marked + _t + _p, the blob path', 'authenticated', $q$
  select r->>'state' = 'unlocked' and r->>'already' = 'false' and r->>'storage_path' = public.t_var('u1_target')
     and r->'old_paths' = jsonb_build_array(public.t_var('u1_marked'), replace(public.t_var('u1_marked'), '0.png', '0_t.webp'),
                                            replace(public.t_var('u1_marked'), '0.png', '0_p.webp'))
     and r->>'object_path' like '%.bin'
    from (select public.trial_original_unlock_finish(public.t_tok(), public.t_var('u1')::uuid, public.t_var('u1_lid')::uuid,
            replace(public.t_var('u1_target'), '.png', '_t.webp'), null, 'single', null) r) s $q$);
select public.t_true('U21 (… the asset now IS the clean file: path = target, thumb = target _t, the preview key REMOVED, other metadata kept)', 'postgres', $q$
  select storage_path = public.t_var('u1_target') and metadata->>'thumb' = replace(public.t_var('u1_target'), '.png', '_t.webp')
     and not metadata ? 'preview' and metadata->>'provider' = 'google'
    from public.generation_assets where id = public.t_var('u1')::uuid $q$);
select public.t_true('U22 (… the row is unlocked by the customer at the target, lease cleared, KEY DESTROYED)', 'postgres', $q$
  select r->>'status' = 'unlocked' and r->>'unlocked_by' = public.t_uid('customer')::text and r->>'unlocked_path' = public.t_var('u1_target')
     and r->'lease_until' = 'null'::jsonb and r->'lease_id' = 'null'::jsonb and r->>'unlocked_at' is not null and not public.t_has_key((r->>'id')::uuid)
    from (select public.t_row(public.t_var('u1')::uuid) r) s $q$);
select public.t_true('U23 (… one watermark_unlocked event, written by the database: actor, via, tool, asset, dedupe)', 'postgres', $q$
  select count(*) = 1 and bool_and(actor_id = public.t_uid('customer') and entity_type = 'trial_watermark'
           and entity_id = public.t_var('u1')::uuid and metadata->>'via' = 'single' and metadata->>'tool' = 'generator'
           and metadata->>'age_days' = '0' and metadata->>'dedupe' like 'unlocked:%')
    from public.activity_logs where action = 'watermark_unlocked' $q$);
select public.t_true('U24 R13: the run''s outputs, its delivered mark and the Retusz step output now name the target; other entries untouched', 'postgres', $q$
  select (select outputs->0->>'path' = public.t_var('u1_target') and outputs->1->>'path' = 'x/y/z.png'
                 and outputs->0->>'step' = '3' and progress->'delivered'->>'path' = public.t_var('u1_target')
                 and progress->>'stage' = 'done'
            from public.ai_engine_runs where id = 'f0000000-0000-0000-0000-000000000001')
     and (select output->>'path' = public.t_var('u1_target') and output->>'credits' = '7'
            from public.ai_engine_step_runs where run_id = 'f0000000-0000-0000-0000-000000000001' and "position" = 1)
     and (select output->>'path' = 'other/file.png'
            from public.ai_engine_step_runs where run_id = 'f0000000-0000-0000-0000-000000000001' and "position" = 3) $q$);
select public.t_true('U25 R13 stays inside the workspace: another tenant''s run naming the same string is untouched', 'postgres', $q$
  select (select outputs->0->>'path' = public.t_var('u1_marked') from public.ai_engine_runs where id = 'f0000000-0000-0000-0000-000000000002')
     and (select output->>'path' = public.t_var('u1_marked') from public.ai_engine_step_runs where run_id = 'f0000000-0000-0000-0000-000000000002') $q$);
select public.t_true('U26 finish again → unlocked, already, same path, same old_paths — and no second event', 'authenticated', $q$
  select r->>'state' = 'unlocked' and r->>'already' = 'true' and r->>'storage_path' = public.t_var('u1_target')
     and jsonb_array_length(r->'old_paths') = 3
    from (select public.trial_original_unlock_finish(public.t_tok(), public.t_var('u1')::uuid, public.t_var('u1_lid')::uuid, null, null, 'single', null) r) s $q$);
select public.t_true('U27 (… still exactly one event)', 'postgres', $q$ select count(*) = 1 from public.activity_logs where action = 'watermark_unlocked' $q$);
SQL
  q >/dev/null <<'SQL'
select public.t_be('customer');
select public.t_true('U28 begin on the unlocked asset → {state: unlocked, storage_path: target}, no key', 'authenticated', $q$
  select public.t_begin('u1') = jsonb_build_object('state', 'unlocked', 'storage_path', public.t_var('u1_target')) $q$);
-- lease lost (u2 is unlocking from U15)
select public.t_set('u2_lid', public.t_lease('u2')::text);
update public.trial_originals set lease_until = now() - interval '1 second' where asset_id = public.t_var('u2')::uuid;
select public.t_eq('U29 finish after its own lease ran out → lease_lost; the asset is untouched', 'authenticated',
  $q$ select public.trial_original_unlock_finish(public.t_tok(), public.t_var('u2')::uuid, public.t_var('u2_lid')::uuid, null, null, 'single', null)->>'state' $q$, 'lease_lost');
select public.t_true('U30 (… asset still the marked file, row still holds its key)', 'postgres', $q$
  select (select storage_path not like '%/u-%' from public.generation_assets where id = public.t_var('u2')::uuid)
     and public.t_has_key(public.t_oid(public.t_var('u2')::uuid)) $q$);
select public.t_set('u2_target', public.t_row(public.t_var('u2')::uuid)->>'target_path');
select public.t_true('U31 begin after a stale lease → ready on the same derived target…', 'authenticated', $q$
  select r->>'state' = 'ready' and r->>'target_path' = public.t_var('u2_target')
    from (select public.t_begin('u2') r) s $q$);
select public.t_true('U31b (… with a NEW 3-minute lease under a NEW lease id)', 'postgres', $q$
  select (public.t_row(public.t_var('u2')::uuid)->>'lease_until')::timestamptz > now() + interval '170 seconds'
     and public.t_lease('u2')::text <> public.t_var('u2_lid') $q$);
select public.t_eq('U31c the request whose lease ran out cannot commit into the new one (lease_lost)', 'authenticated',
  $q$ select public.trial_original_unlock_finish(public.t_tok(), public.t_var('u2')::uuid, public.t_var('u2_lid')::uuid, null, null, 'single', null)->>'state' $q$, 'lease_lost');
select public.t_true('U31d … nor give it back: abort with the old lease → busy, nothing named, the new lease untouched', 'authenticated', $q$
  select r->>'state' = 'busy' and r->'target_path' = 'null'::jsonb
     and public.t_row(public.t_var('u2')::uuid)->>'status' = 'unlocking'
     and public.t_lease('u2')::text <> public.t_var('u2_lid')
    from (select public.trial_original_unlock_abort(public.t_tok(), public.t_var('u2')::uuid, public.t_var('u2_lid')::uuid) r) s $q$);
-- expiry inside the lease (u3 is unlocking): the commit still goes through
update public.trial_originals set expires_at = now() - interval '1 minute' where asset_id = public.t_var('u3')::uuid;
select public.t_eq('U32 states during a live lease past expiry → still locked to its owner (0 days)', 'authenticated',
  $q$ select public.t_state('u3') $q$, 'locked:0');
select public.t_eq('U33 begin while that live lease runs, past expiry → busy (its holder still commits)', 'authenticated',
  $q$ select (public.t_begin('u3'))->>'state' $q$, 'busy');
select public.t_eq('U34 finish inside the lease, past expiry → unlocked (expiry is judged once, at begin)', 'authenticated',
  $q$ select public.trial_original_unlock_finish(public.t_tok(), public.t_var('u3')::uuid, public.t_lease('u3'), null, null, 'bulk', 'b0000000-0000-0000-0000-000000000001')->>'state' $q$, 'unlocked');
select public.t_true('U35 (… no derivatives passed: the asset has neither thumb nor preview — the library rebuilds them)', 'postgres', $q$
  select not metadata ? 'thumb' and not metadata ? 'preview' from public.generation_assets where id = public.t_var('u3')::uuid $q$);
select public.t_true('U36 (… the bulk event carries via=bulk and the bulk id)', 'postgres', $q$
  select count(*) = 1 from public.activity_logs where action = 'watermark_unlocked' and metadata->>'via' = 'bulk'
     and metadata->>'bulk_id' = 'b0000000-0000-0000-0000-000000000001' $q$);
-- a locked original past expiry, no lease: expired at once
update public.trial_originals set expires_at = now() - interval '1 second' where asset_id = public.t_var('u4')::uuid;
select public.t_eq('U37 begin on a locked original past expiry (no sweep yet) → expired, no key', 'authenticated',
  $q$ select (public.t_begin('u4'))::text $q$, '{"state": "expired"}');
update public.trial_originals set expires_at = now() + interval '5 days' where asset_id = public.t_var('u4')::uuid;
-- abort
select public.t_true('U38 begin u4 → ready', 'authenticated', $q$ select (public.t_begin('u4'))->>'state' = 'ready' $q$);
select public.t_set('u4_lid', public.t_lease('u4')::text);
select public.t_true('U38b abort naming another lease → busy: someone else''s lease is never given back, nothing named', 'authenticated', $q$
  select r->>'state' = 'busy' and r->'target_path' = 'null'::jsonb and public.t_lease('u4')::text = public.t_var('u4_lid')
    from (select public.trial_original_unlock_abort(public.t_tok(), public.t_var('u4')::uuid, gen_random_uuid()) r) s $q$);
select public.t_true('U38c … and a lease-less cleanup of that live row names nothing either (a request is writing it)', 'authenticated', $q$
  select r->>'state' = 'busy' and r->'target_path' = 'null'::jsonb
    from (select public.trial_original_unlock_abort(public.t_tok(), public.t_var('u4')::uuid, null) r) s $q$);
select public.t_true('U39 abort by the lease''s own holder → locked, and NO path named (it removed its target before, under its lease)', 'authenticated', $q$
  select r->'target_path' = 'null'::jsonb and r->>'state' = 'locked'
    from (select public.trial_original_unlock_abort(public.t_tok(), public.t_var('u4')::uuid, public.t_var('u4_lid')::uuid) r) s $q$);
select public.t_true('U39b (… the row is locked again, lease and lease id cleared, the target recorded, the key kept)', 'postgres', $q$
  select r->>'status' = 'locked' and r->'lease_until' = 'null'::jsonb and r->'lease_id' = 'null'::jsonb
     and r->>'target_path' like '%/u-%.png' and public.t_has_key((r->>'id')::uuid)
    from (select public.t_row(public.t_var('u4')::uuid) r) s $q$);
select public.t_true('U39c a lease-less cleanup of a LOCKED row names nothing (a later unlock reuses that target)', 'authenticated', $q$
  select r->'target_path' = 'null'::jsonb and r->>'state' = 'locked'
    from (select public.trial_original_unlock_abort(public.t_tok(), public.t_var('u4')::uuid, null) r) s $q$);
select public.t_true('U40 abort on an UNLOCKED asset → no target (that file is the customer''s now)', 'authenticated', $q$
  select r->'target_path' = 'null'::jsonb and r->>'state' = 'unlocked'
    from (select public.trial_original_unlock_abort(public.t_tok(), public.t_var('u1')::uuid, null) r) s $q$);
select public.t_eq('U41 finish on a locked (aborted) row, with the lease it had → lease_lost', 'authenticated',
  $q$ select public.trial_original_unlock_finish(public.t_tok(), public.t_var('u4')::uuid, public.t_var('u4_lid')::uuid, null, null, 'single', null)->>'state' $q$, 'lease_lost');
update public.trial_originals set expires_at = now() - interval '1 second' where asset_id = public.t_var('u4')::uuid;
select public.t_true('U41b a LOCKED row past its expiry (no sweep yet) is dead: the lease-less cleanup names its leftover target', 'authenticated', $q$
  select r->>'target_path' like '%/u-%.png' and r->>'state' = 'locked'
    from (select public.trial_original_unlock_abort(public.t_tok(), public.t_var('u4')::uuid, null) r) s $q$);
update public.trial_originals set expires_at = now() + interval '5 days' where asset_id = public.t_var('u4')::uuid;
-- the subscription ends: unlocked stays unlocked
update public.subscriptions set current_period_end = now() - interval '1 minute' where provider_subscription_id = 'sub_c_inc';
select public.t_eq('U42 after the subscription ended: the unlocked asset is still unlocked (states)', 'authenticated',
  $q$ select public.t_state('u1') $q$, 'unlocked:-');
select public.t_eq('U43 … begin still answers unlocked', 'authenticated', $q$ select (public.t_begin('u1'))->>'state' $q$, 'unlocked');
select public.t_eq('U44 … and a locked one is not unlockable any more → not_entitled', 'authenticated', $q$ select (public.t_begin('u4'))->>'state' $q$, 'not_entitled');
update public.subscriptions set current_period_end = now() + interval '20 days' where provider_subscription_id = 'sub_c_inc';
-- batch
select public.t_set('jb', public.t_job(public.t_ws('customer'), public.t_uid('customer'))::text);
select public.t_make('customer', public.t_ws('customer'), public.t_var('jb')::uuid, n || '.png') from generate_series(0, 11) n;
select public.t_be('customer');
create function public.t_batch(p_limit integer, p_skip uuid[] default '{}') returns jsonb language sql as $$
  select public.trial_original_next_batch(public.t_tok(), public.t_ws('customer'), p_limit, p_skip) $$;
create view public.t_eligible as
  select asset_id, created_at, id from public.trial_originals
   where workspace_id = public.t_ws('customer') and asset_id is not null and expires_at > now()
     and (status = 'locked' or (status = 'unlocking' and lease_until <= now()));
select public.t_true('U45 next_batch: 4 asked → 4, oldest first; remaining = what is left AFTER the batch', 'postgres', $q$
  select jsonb_array_length(b->'asset_ids') = 4
     and (b->>'remaining')::integer = (select count(*) from public.t_eligible) - 4
     and b->'asset_ids' = (select jsonb_agg(asset_id order by created_at, id) from
                             (select * from public.t_eligible order by created_at, id limit 4) x)
    from (select public.t_batch(4) b) s $q$);
select public.t_true('U46 a live lease (u2) is not offered; skip is honoured; a limit of 50 is clamped to 10', 'postgres', $q$
  select not ((public.t_batch(50))->'asset_ids' ? public.t_var('u2'))
     and jsonb_array_length((public.t_batch(50))->'asset_ids') = 10
     and not ((public.t_batch(10, array[public.t_var('u4')::uuid]))->'asset_ids' ? public.t_var('u4'))
     and (select count(*) from public.t_eligible where asset_id = public.t_var('u4')::uuid) = 1 $q$);
select public.t_be('other');
select public.t_raises('U47 next_batch for another workspace → forbidden', 'authenticated', $q$ select public.t_batch(4) $q$, 'forbidden');
SQL
  # BUSY: begin while another session holds the row (NOWAIT, never a wait).
  local hold_name="trialwm_hold_$DB" staged=true
  PGAPPNAME="$hold_name" q >/dev/null 2>&1 <<'SQL' &
begin;
select 1 from public.trial_originals where asset_id = public.t_var('u4')::uuid for update;
select pg_sleep(3);
commit;
SQL
  local hold_pid=$! _
  for _ in $(seq 1 50); do
    [ "$(q -c "select count(*) from pg_stat_activity where application_name = '$hold_name' and wait_event = 'PgSleep'")" != "0" ] && break
    sleep 0.1
  done
  q >/dev/null <<'SQL'
select public.t_be('customer');
select public.t_eq('U48 begin while another request holds the row → busy (NOWAIT, never a queue)', 'authenticated',
  $q$ select (public.t_begin('u4'))->>'state' $q$, 'busy');
SQL
  wait "$hold_pid" || staged=false
  [ "$staged" = true ] || record 'U48b the holding session ran' false 'background session failed'
}

# ── Q. MINIATURKA'S SOURCE (R14) ───────────────────────────────────────────
source_checks() {
  q >/dev/null <<'SQL'
select public.t_set('jq', public.t_job(public.t_ws('customer'), public.t_uid('customer'))::text);
select public.t_set('q_locked', public.t_make('customer', public.t_ws('customer'), public.t_var('jq')::uuid, '0.png')::text);
select public.t_set('q_expired', public.t_make('customer', public.t_ws('customer'), public.t_var('jq')::uuid, '1.png')::text);
update public.trial_originals set expires_at = now() - interval '1 second' where asset_id = public.t_var('q_expired')::uuid;
select public.t_be('customer');
create function public.t_src(p_ws text, p_path text) returns jsonb language sql as $$
  select public.trial_original_source(public.t_tok(), public.t_ws(p_ws), p_path) $$;
select public.t_true('Q1  a library path that never was a trial image → NULL (definitive)', 'authenticated', $q$
  select public.t_src('customer', public.t_ws('customer')::text || '/' || public.t_var('jq') || '/9.png') is null $q$);
select public.t_true('Q2  a locked one → status locked, its key, hash and mime; no unlocked path', 'authenticated', $q$
  select r->>'status' = 'locked' and r->>'wrapped_key' = public.t_wkey() and r->>'kek_fp' = '0123456789abcdef'
     and r->>'original_id' = public.t_oid(public.t_var('q_locked')::uuid)::text and r->>'clean_mime' = 'image/png'
     and length(r->>'clean_sha256') = 64 and r->'unlocked_path' = 'null'::jsonb
    from (select public.t_src('customer', public.t_ws('customer')::text || '/' || public.t_var('jq') || '/0.png') r) s $q$);
select public.t_true('Q3  a locked one past its expiry → status expired and NO key', 'authenticated', $q$
  select r->>'status' = 'expired' and r->'wrapped_key' = 'null'::jsonb and r->'kek_fp' = 'null'::jsonb
    from (select public.t_src('customer', public.t_ws('customer')::text || '/' || public.t_var('jq') || '/1.png') r) s $q$);
select public.t_true('Q4  an unlocked one (by its old marked path) → status unlocked, the unlocked path, no key', 'authenticated', $q$
  select r->>'status' = 'unlocked' and r->>'unlocked_path' = public.t_var('u1_target') and r->'wrapped_key' = 'null'::jsonb
    from (select public.t_src('customer', public.t_var('u1_marked')) r) s $q$);
select public.t_true('Q5  an orphaned one → status orphaned, no key', 'authenticated', $q$
  select r->>'status' = 'orphaned' and r->'wrapped_key' = 'null'::jsonb
    from (select public.t_src('customer', public.t_var('s_orph_path')) r) s $q$);
select public.t_true('Q6  a pending one → its key (the composition may run before the attach)', 'authenticated', $q$
  select r->>'status' = 'pending' and r->>'wrapped_key' = public.t_wkey()
    from (select public.t_src('customer', public.t_var('s_pending_path')) r) s $q$);
select public.t_raises('Q7  asking in a workspace the caller is not a member of → forbidden', 'authenticated',
  $q$ select public.t_src('other', public.t_ws('other')::text || '/x/0.png') $q$, 'forbidden');
select public.t_be('other');
select public.t_true('Q8  another tenant naming the customer''s path from their OWN workspace → NULL (scoped to the workspace and its folder)', 'authenticated', $q$
  select public.t_src('other', public.t_ws('customer')::text || '/' || public.t_var('jq') || '/0.png') is null $q$);
SQL
}

# ── W. THE SWEEP ───────────────────────────────────────────────────────────
sweep_checks() {
  q >/dev/null <<'SQL'
select public.t_be('customer');
select public.t_set('jw', public.t_job(public.t_ws('customer'), public.t_uid('customer'))::text);
select public.t_set('jw2', public.t_job(public.t_ws('customer'), public.t_uid('customer'))::text);
-- heal (generator): pending, its file in the library, attach never ran
select public.t_set('w_heal_path', public.t_ws('customer')::text || '/' || public.t_var('jw') || '/0.png');
select public.t_set('w_heal_id', gen_random_uuid()::text);
select public.t_reserve(public.t_var('w_heal_id')::uuid, public.t_ws('customer'), public.t_var('jw')::uuid, public.t_var('w_heal_path'));
select public.t_set('w_heal_asset', public.t_asset(public.t_ws('customer'), public.t_var('jw')::uuid, public.t_var('w_heal_path'))::text);
-- NOT healed: the file at its path belongs to a generation of ANOTHER job
select public.t_set('w_wrongjob_path', public.t_ws('customer')::text || '/' || public.t_var('jw') || '/1.png');
select public.t_set('w_wrongjob_id', gen_random_uuid()::text);
select public.t_reserve(public.t_var('w_wrongjob_id')::uuid, public.t_ws('customer'), public.t_var('jw')::uuid, public.t_var('w_wrongjob_path'));
select public.t_asset(public.t_ws('customer'), public.t_var('jw2')::uuid, public.t_var('w_wrongjob_path'));
-- heal (Miniaturka): no path, the job has exactly one asset
select public.t_set('jw_mini', public.t_job(public.t_ws('customer'), public.t_uid('customer'))::text);
select public.t_set('w_mini_id', gen_random_uuid()::text);
select public.t_reserve(public.t_var('w_mini_id')::uuid, public.t_ws('customer'), public.t_var('jw_mini')::uuid, null);
select public.t_set('w_mini_path', public.t_ws('customer')::text || '/' || public.t_var('jw_mini') || '/' || gen_random_uuid()::text || '.png');
select public.t_set('w_mini_asset', public.t_asset(public.t_ws('customer'), public.t_var('jw_mini')::uuid, public.t_var('w_mini_path'))::text);
-- NOT healed: no path and the job has two assets (which one is unknowable)
select public.t_set('jw_two', public.t_job(public.t_ws('customer'), public.t_uid('customer'))::text);
select public.t_set('w_two_id', gen_random_uuid()::text);
select public.t_reserve(public.t_var('w_two_id')::uuid, public.t_ws('customer'), public.t_var('jw_two')::uuid, null);
select public.t_asset(public.t_ws('customer'), public.t_var('jw_two')::uuid, public.t_ws('customer')::text || '/' || public.t_var('jw_two') || '/a.png');
select public.t_asset(public.t_ws('customer'), public.t_var('jw_two')::uuid, public.t_ws('customer')::text || '/' || public.t_var('jw_two') || '/b.png');
-- orphan: pending for 25 h, nothing in the library
select public.t_set('w_old_id', gen_random_uuid()::text);
select public.t_reserve(public.t_var('w_old_id')::uuid, public.t_ws('customer'), public.t_var('jw')::uuid, public.t_ws('customer')::text || '/' || public.t_var('jw') || '/2.png');
update public.trial_originals set created_at = now() - interval '25 hours' where id = public.t_var('w_old_id')::uuid;
select public.t_set('w_fresh_id', gen_random_uuid()::text);
select public.t_reserve(public.t_var('w_fresh_id')::uuid, public.t_ws('customer'), public.t_var('jw')::uuid, public.t_ws('customer')::text || '/' || public.t_var('jw') || '/3.png');
-- stale lease / live lease
select public.t_set('w_stale', public.t_make('customer', public.t_ws('customer'), public.t_var('jw')::uuid, '4.png')::text);
select public.t_set('w_live', public.t_make('customer', public.t_ws('customer'), public.t_var('jw')::uuid, '5.png')::text);
select public.trial_original_unlock_begin(public.t_tok(), public.t_var('w_stale')::uuid, true);
select public.trial_original_unlock_begin(public.t_tok(), public.t_var('w_live')::uuid, true);
update public.trial_originals set lease_until = now() - interval '1 minute' where asset_id = public.t_var('w_stale')::uuid;
update public.trial_originals set expires_at = now() - interval '1 minute' where asset_id = public.t_var('w_live')::uuid;
-- expire: due, and one not due
select public.t_set('w_due', public.t_make('customer', public.t_ws('customer'), public.t_var('jw')::uuid, '6.png')::text);
select public.t_set('w_notdue', public.t_make('customer', public.t_ws('customer'), public.t_var('jw')::uuid, '7.png')::text);
update public.trial_originals set created_at = now() - interval '31 days', expires_at = now() - interval '1 day' where asset_id = public.t_var('w_due')::uuid;
-- the stale lease is also past due: returned to locked AND expired in the same run
update public.trial_originals set expires_at = now() - interval '1 hour' where asset_id = public.t_var('w_stale')::uuid;
-- subscription confirmed: a paywall, then a subscription in that workspace
-- (the PRO row of the U section predates the paywall)
update public.subscriptions set created_at = now() - interval '10 days' where provider_subscription_id = 'sub_c_inc';
select public.trial_watermark_log(public.t_tok(), public.t_ws('customer'), 'watermark_paywall_opened', null,
  '{"paywall_id":"pw-1","surface":"gallery"}', 'pw-1');
update public.activity_logs set created_at = now() - interval '2 days' where metadata->>'paywall_id' = 'pw-1';
insert into public.subscriptions (workspace_id, plan_id, status, current_period_end, provider, provider_subscription_id, created_at)
  values (public.t_ws('customer'), public.t_plan('starter'), 'active', now() + interval '30 days', 'stripe', 'sub_after_paywall', now() - interval '1 day');
insert into public.t_vars select 'w_unlocked_before', to_jsonb(o)::text from public.trial_originals o where asset_id = public.t_var('u1')::uuid;

select public.t_set('sweep1', public.trial_originals_sweep()::text);
SQL
  q >/dev/null <<'SQL'
select public.t_true('W1  heal: the pending original whose file reached the library (own job, exact path) is locked, expiry from its reserve', 'postgres', $q$
  select status = 'locked' and asset_id = public.t_var('w_heal_asset')::uuid and expires_at = created_at + interval '30 days'
    from public.trial_originals where id = public.t_var('w_heal_id')::uuid $q$);
select public.t_true('W2  heal never binds an asset of ANOTHER job at the same path', 'postgres', $q$
  select status = 'pending' and asset_id is null from public.trial_originals where id = public.t_var('w_wrongjob_id')::uuid $q$);
select public.t_true('W3  heal (Miniaturka): no path, one asset in its job → locked at that asset''s path', 'postgres', $q$
  select status = 'locked' and asset_id = public.t_var('w_mini_asset')::uuid and marked_path = public.t_var('w_mini_path')
    from public.trial_originals where id = public.t_var('w_mini_id')::uuid $q$);
select public.t_true('W4  … but not when the job has two assets', 'postgres', $q$
  select status = 'pending' from public.trial_originals where id = public.t_var('w_two_id')::uuid $q$);
select public.t_true('W5  orphan: pending for 25 h → orphaned, key destroyed; a fresh pending one is untouched', 'postgres', $q$
  select (select status = 'orphaned' and not public.t_has_key(id) from public.trial_originals where id = public.t_var('w_old_id')::uuid)
     and (select status = 'pending' and public.t_has_key(id) from public.trial_originals where id = public.t_var('w_fresh_id')::uuid) $q$);
select public.t_true('W6  a stale lease is returned to locked (target kept for cleanup) — and, being past due, expired in the same run', 'postgres', $q$
  select r->>'status' = 'expired' and r->>'target_path' like '%/u-%' and r->'lease_until' = 'null'::jsonb
     and r->'lease_id' = 'null'::jsonb
    from (select public.t_row(public.t_var('w_stale')::uuid) r) s $q$);
select public.t_be('customer');
select public.t_true('W6b a lease-less cleanup of that EXPIRED row names the target an interrupted unlock left (nobody can write it any more)', 'authenticated', $q$
  select r->>'state' = 'expired' and r->>'target_path' = public.t_row(public.t_var('w_stale')::uuid)->>'target_path'
    from (select public.trial_original_unlock_abort(public.t_tok(), public.t_var('w_stale')::uuid, null) r) s $q$);
select public.t_true('W7  a row in a LIVE lease is never expired, even past its expiry (it keeps its key)', 'postgres', $q$
  select r->>'status' = 'unlocking' and public.t_has_key((r->>'id')::uuid)
    from (select public.t_row(public.t_var('w_live')::uuid) r) s $q$);
select public.t_true('W8  expire: due → expired, expired_at set, KEY DESTROYED; not due → locked with its key', 'postgres', $q$
  select (select r->>'status' = 'expired' and r->>'expired_at' is not null and not public.t_has_key((r->>'id')::uuid)
            from (select public.t_row(public.t_var('w_due')::uuid) r) s)
     and (select r->>'status' = 'locked' and public.t_has_key((r->>'id')::uuid)
            from (select public.t_row(public.t_var('w_notdue')::uuid) r) s) $q$);
select public.t_true('W9  watermark_original_expired written once per expired original (6), no actor, with asset and tool', 'postgres', $q$
  select (select count(*) from public.activity_logs where action = 'watermark_original_expired')
         = (select count(*) from public.trial_originals where status = 'expired' and expired_at is not null)
     and (select count(*) from public.activity_logs where action = 'watermark_original_expired') = 6
     and (select bool_and(actor_id is null and entity_type = 'trial_watermark' and metadata->>'tool' = 'generator'
                          and metadata->>'dedupe' like 'expired:%')
            from public.activity_logs where action = 'watermark_original_expired')
     and exists (select 1 from public.activity_logs where action = 'watermark_original_expired' and entity_id = public.t_var('w_due')::uuid) $q$);
select public.t_true('W10 watermark_subscription_confirmed: once, for the subscription that followed the paywall, with that paywall id', 'postgres', $q$
  select count(*) = 1 and bool_and(metadata->>'paywall_id' = 'pw-1' and metadata->>'plan_slug' = 'starter'
                                   and metadata->>'dedupe' like 'sub:%' and actor_id is null)
    from public.activity_logs where action = 'watermark_subscription_confirmed' $q$);
select public.t_true('W11 … and NOT for the earlier PRO subscription created before any paywall', 'postgres', $q$
  select not exists (select 1 from public.activity_logs l join public.subscriptions s on s.id = l.entity_id
                      where l.action = 'watermark_subscription_confirmed' and s.provider_subscription_id = 'sub_c_inc') $q$);
select public.t_true('W12 the counts: healed 3 (two here + the pending one of S6), orphaned 1, leases 1, expired 6, confirmed 1, errors 0', 'postgres', $q$
  select r->>'healed' = '3' and r->>'orphaned' = '1' and r->>'leases_returned' = '1' and r->>'expired' = '6'
     and r->>'confirmed' = '1' and r->>'errors' = '0'
    from (select public.t_var('sweep1')::jsonb r) s $q$);
select public.t_true('W13 the unlocked original is byte for byte what it was', 'postgres', $q$
  select to_jsonb(o)::text = public.t_var('w_unlocked_before') from public.trial_originals o where asset_id = public.t_var('u1')::uuid $q$);
insert into public.t_vars values ('w_print', public.t_data_print());
select public.t_set('sweep2', public.trial_originals_sweep()::text);
select public.t_true('W14 a second run changes nothing: all counts 0, every row and event as it was', 'postgres', $q$
  select r->>'healed' = '0' and r->>'orphaned' = '0' and r->>'leases_returned' = '0' and r->>'expired' = '0'
     and r->>'confirmed' = '0' and r->>'errors' = '0' and public.t_data_print() = public.t_var('w_print')
    from (select public.t_var('sweep2')::jsonb r) s $q$);
select public.t_be('anon');
select public.t_true('W15 sweep_now: anon with the token runs it (the cron belt) and gets the counts', 'anon', $q$
  select (public.trial_originals_sweep_now(public.t_tok()))->>'errors' = '0' $q$);
select public.t_raises('W16 sweep_now with a wrong token → forbidden', 'anon', $q$ select public.trial_originals_sweep_now('nope') $q$, 'forbidden');
SQL
  # ONE BAD ROW DOES NOT STOP THE RUN. A Miniaturka original whose heal would
  # take a path another live original already holds (the unique index
  # refuses), next to an ordinary healable one: the bad row is counted and
  # skipped, the good one is healed in the same run.
  q >/dev/null <<'SQL'
select public.t_be('customer');
select public.t_set('jx', public.t_job(public.t_ws('customer'), public.t_uid('customer'))::text);
select public.t_set('jx2', public.t_job(public.t_ws('customer'), public.t_uid('customer'))::text);
select public.t_set('x_path', public.t_ws('customer')::text || '/' || public.t_var('jx') || '/' || gen_random_uuid()::text || '.png');
select public.t_set('x_bad', gen_random_uuid()::text);
select public.t_reserve(public.t_var('x_bad')::uuid, public.t_ws('customer'), public.t_var('jx')::uuid, null);
select public.t_asset(public.t_ws('customer'), public.t_var('jx')::uuid, public.t_var('x_path'));
select public.t_set('x_squatter', gen_random_uuid()::text);
select public.t_reserve(public.t_var('x_squatter')::uuid, public.t_ws('customer'), public.t_var('jx2')::uuid, public.t_var('x_path'));
select public.t_set('x_good', gen_random_uuid()::text);
select public.t_set('x_good_path', public.t_ws('customer')::text || '/' || public.t_var('jx2') || '/0.png');
select public.t_reserve(public.t_var('x_good')::uuid, public.t_ws('customer'), public.t_var('jx2')::uuid, public.t_var('x_good_path'));
select public.t_asset(public.t_ws('customer'), public.t_var('jx2')::uuid, public.t_var('x_good_path'));
select public.t_set('sweep3', public.trial_originals_sweep()::text);
select public.t_true('W17 a row whose heal fails is counted (errors 1) and left pending; the run went on and healed the next one', 'postgres', $q$
  select (public.t_var('sweep3')::jsonb)->>'errors' = '1' and (public.t_var('sweep3')::jsonb)->>'healed' = '1'
     and (select status = 'pending' and marked_path is null from public.trial_originals where id = public.t_var('x_bad')::uuid)
     and (select status = 'locked' from public.trial_originals where id = public.t_var('x_good')::uuid) $q$);
select public.trial_original_release(public.t_tok(), public.t_var('x_squatter')::uuid);
select public.t_set('sweep4', public.trial_originals_sweep()::text);
select public.t_true('W18 once the path is free, the next run heals it (errors 0)', 'postgres', $q$
  select (public.t_var('sweep4')::jsonb)->>'errors' = '0' and (public.t_var('sweep4')::jsonb)->>'healed' = '1'
     and (select status = 'locked' and marked_path = public.t_var('x_path') from public.trial_originals where id = public.t_var('x_bad')::uuid) $q$);
SQL
}

# ── P. THE PURGE (R1/R6) AND THE ANON POLICIES ──────────────────────────────
purge_checks() {
  q >/dev/null <<'SQL'
-- blobs: every t_make wrote one. The expired w_due blob exists; the orphaned
-- w_old has none (its upload never happened); u1's was removed by the unlock.
select public.t_set('p_due_obj', public.t_row(public.t_var('w_due')::uuid)->>'object_path');
select public.t_set('p_locked_obj', public.t_row(public.t_var('w_notdue')::uuid)->>'object_path');
select public.t_set('p_u1_obj', public.t_row(public.t_var('u1')::uuid)->>'object_path');
select public.t_set('p_old_obj', (select object_path from public.trial_originals where id = public.t_var('w_old_id')::uuid));
select public.t_storage_remove('trial-originals', array[public.t_var('p_u1_obj')]);
select public.t_be('anon');
select public.t_true('P1  BEFORE any purge list: anon sees no trial-originals object, not even key-destroyed ones (not armed)', 'anon', $q$
  select count(*) = 0 from storage.objects where bucket_id = 'trial-originals' $q$);
select public.t_set('p_list', public.trial_originals_purge_list(public.t_tok(), 200)::text);
SQL
  q >/dev/null <<'SQL'
select public.t_true('P2  purge_list (anon, with the token): the expired blob is listed; locked and unlocking ones never are', 'postgres', $q$
  select (public.t_var('p_list')::jsonb) ? public.t_var('p_due_obj')
     and not (public.t_var('p_list')::jsonb) ? public.t_var('p_locked_obj')
     and not exists (select 1 from jsonb_array_elements_text(public.t_var('p_list')::jsonb) p
                      join public.trial_originals o on o.object_path = p where o.status in ('pending', 'locked', 'unlocking')) $q$);
select public.t_true('P3  … the rows whose blob is already gone (u1 removed by the unlock, w_old never written) are marked purged, not listed', 'postgres', $q$
  select (select purged_at is not null from public.trial_originals where object_path = public.t_var('p_u1_obj'))
     and (select purged_at is not null from public.trial_originals where object_path = public.t_var('p_old_obj'))
     and not (public.t_var('p_list')::jsonb) ? public.t_var('p_u1_obj') $q$);
select public.t_true('P4  … the listed rows are armed for one minute', 'postgres', $q$
  select purge_armed_until between now() + interval '50 seconds' and now() + interval '1 minute'
    from public.trial_originals where object_path = public.t_var('p_due_obj') $q$);
select public.t_be('anon');
select public.t_true('P5  anon SELECTs the armed, key-destroyed blob', 'anon', $q$
  select count(*) = 1 from storage.objects where bucket_id = 'trial-originals' and name = public.t_var('p_due_obj') $q$);
select public.t_true('P6  anon cannot see a LOCKED blob (0 rows, no error)', 'anon', $q$
  select count(*) = 0 from storage.objects where bucket_id = 'trial-originals' and name = public.t_var('p_locked_obj') $q$);
select public.t_eq('P7  anon cannot DELETE a locked blob through the Storage API (0 rows)', 'anon',
  $q$ select public.t_storage_remove('trial-originals', array[public.t_var('p_locked_obj')])::text $q$, '0');
select public.t_eq('P8  anon DELETEs the armed blob through the Storage API', 'anon',
  $q$ select public.t_storage_remove('trial-originals', array[public.t_var('p_due_obj')])::text $q$, '1');
select public.t_raises('P9  SQL itself cannot delete a storage object (protect_delete): the purge has to be the API', 'postgres',
  $q$ delete from storage.objects where bucket_id = 'trial-originals' and name = public.t_var('p_locked_obj') $q$, 'Use the Storage API');
SQL
  q >/dev/null <<'SQL'
select public.t_be('anon');
select public.t_eq('P10 mark_purged(every listed path + a locked one) → 1: only the object storage really removed', 'anon',
  $q$ select public.trial_originals_mark_purged(public.t_tok(), (select array_agg(p) from jsonb_array_elements_text(public.t_var('p_list')::jsonb) p)
                                                  || public.t_var('p_locked_obj'))::text $q$, '1');
select public.t_true('P10b mark_purged marks only rows whose object is really gone (the locked path and the still-present ones are not)', 'postgres', $q$
  select (select purged_at is not null from public.trial_originals where object_path = public.t_var('p_due_obj'))
     and (select purged_at is null from public.trial_originals where object_path = public.t_var('p_locked_obj'))
     and (select count(*) = 0 from public.trial_originals o where o.purged_at is not null
            and exists (select 1 from storage.objects so where so.bucket_id = 'trial-originals' and so.name = o.object_path)) $q$);
select public.t_eq('P11 mark_purged of the same paths again → 0 (idempotent)', 'anon',
  $q$ select public.trial_originals_mark_purged(public.t_tok(), array[public.t_var('p_due_obj'), public.t_var('p_locked_obj')])::text $q$, '0');
select public.t_raises('P12 purge_list with a wrong token → forbidden', 'anon', $q$ select public.trial_originals_purge_list('nope', 10) $q$, 'forbidden');
select public.t_true('P13 heartbeat: anon with the token records the run (one row, the report as sent)', 'anon', $q$
  select public.trial_originals_purge_heartbeat(public.t_tok(), '{"listed":3,"removed":1,"marked":1}') $q$);
select public.t_true('P14 … a second heartbeat replaces it; a non-object report is stored as {}', 'anon', $q$
  select public.trial_originals_purge_heartbeat(public.t_tok(), '[1,2]') $q$);
select public.t_true('P15 (… one row, report {})', 'postgres', $q$
  select count(*) = 1 and bool_and(report = '{}'::jsonb) from public.trial_originals_purge_heartbeat $q$);
-- the arm runs out
select public.t_set('p_rearm', public.trial_originals_purge_list(public.t_tok(), 200)::text);
update public.trial_originals set purge_armed_until = now() - interval '1 second' where purged_at is null;
select public.t_true('P16 an arm that ran out hides the blob from anon again', 'anon', $q$
  select count(*) = 0 from storage.objects where bucket_id = 'trial-originals' $q$);
-- R1: the other buckets after the re-scope
select public.t_true('P17 anon listing media / generation-assets / workspace-branding no longer raises: 0 rows, no error', 'anon', $q$
  select (select count(*) from storage.objects where bucket_id = 'media') = 0
     and (select count(*) from storage.objects where bucket_id = 'generation-assets') = 0
     and (select count(*) from storage.objects where bucket_id = 'workspace-branding') = 0 $q$);
select public.t_raises('P18 anon still cannot upload anywhere (no anon INSERT policy)', 'anon',
  $q$ insert into storage.objects (bucket_id, name) values ('generation-assets', public.t_ws('customer')::text || '/x/y.png') $q$, 'row-level security');
SQL
}

# ── B. MEMBER STORAGE POLICIES ON trial-originals ───────────────────────────
bucket_checks() {
  q >/dev/null <<'SQL'
select public.t_be('customer');
select public.t_set('jbk', public.t_job(public.t_ws('customer'), public.t_uid('customer'))::text);
select public.t_set('b_id', gen_random_uuid()::text);
select public.t_set('b_obj', (public.t_reserve(public.t_var('b_id')::uuid, public.t_ws('customer'), public.t_var('jbk')::uuid,
  public.t_ws('customer')::text || '/' || public.t_var('jbk') || '/0.png'))->>'object_path');
select public.t_be('other');
select public.t_raises('B1  another tenant cannot upload at the customer''s pending path', 'authenticated',
  $q$ insert into storage.objects (bucket_id, name) values ('trial-originals', public.t_var('b_obj')) $q$, 'row-level security');
select public.t_be('customer');
select public.t_raises('B2  the customer cannot upload at a path no pending row expects (own workspace folder)', 'authenticated',
  $q$ insert into storage.objects (bucket_id, name) values ('trial-originals', public.t_ws('customer')::text || '/' || gen_random_uuid()::text || '.bin') $q$, 'row-level security');
select public.t_runs('B3  the customer uploads the blob at the pending row''s object path', 'authenticated',
  $q$ insert into storage.objects (bucket_id, name, owner) values ('trial-originals', public.t_var('b_obj'), auth.uid()) $q$);
select public.t_true('B4  the customer can read (sign/download) their own ciphertext', 'authenticated', $q$
  select count(*) = 1 from storage.objects where bucket_id = 'trial-originals' and name = public.t_var('b_obj') $q$);
select public.t_be('other');
select public.t_true('B5  another tenant sees none of the customer''s blobs', 'authenticated', $q$
  select count(*) = 0 from storage.objects where bucket_id = 'trial-originals' and split_part(name, '/', 1) = public.t_ws('customer')::text $q$);
select public.t_eq('B6  another tenant cannot delete it', 'authenticated',
  $q$ select public.t_storage_remove('trial-originals', array[public.t_var('b_obj')])::text $q$, '0');
select public.t_be('customer');
select public.t_eq('B7  the customer cannot delete a LOCKED blob (their own original would be lost)', 'authenticated',
  $q$ select public.t_storage_remove('trial-originals', array[public.t_var('p_locked_obj')])::text $q$, '0');
select public.t_true('B8  no UPDATE policy: an overwrite reaches 0 rows', 'authenticated', $q$
  with u as (update storage.objects set metadata = '{"x":1}' where bucket_id = 'trial-originals' returning 1) select count(*) = 0 from u $q$);
select public.t_eq('B9  the customer can delete a pending blob (a failed stash cleans up after itself)', 'authenticated',
  $q$ select public.t_storage_remove('trial-originals', array[public.t_var('b_obj')])::text $q$, '1');
select public.t_runs('B10 re-upload while still pending', 'authenticated',
  $q$ insert into storage.objects (bucket_id, name, owner) values ('trial-originals', public.t_var('b_obj'), auth.uid()) $q$);
select public.trial_original_release(public.t_tok(), public.t_var('b_id')::uuid);
select public.t_eq('B11 once released, the orphaned (key-destroyed) blob can be deleted by its member', 'authenticated',
  $q$ select public.t_storage_remove('trial-originals', array[public.t_var('b_obj')])::text $q$, '1');
select public.t_raises('B12 … and its path can never be uploaded to again (no pending row expects it)', 'authenticated',
  $q$ insert into storage.objects (bucket_id, name) values ('trial-originals', public.t_var('b_obj')) $q$, 'row-level security');
select public.t_true('B13 the re-scoped buckets work as before for members: insert + read in their generation-assets folder', 'authenticated', $q$
  with i as (insert into storage.objects (bucket_id, name) values ('generation-assets', public.t_ws('customer')::text || '/z/0.png') returning 1)
  select count(*) = 1 from i $q$);
select public.t_true('B14 … and still see their existing generation-assets object, but not media writes', 'authenticated', $q$
  select (select count(*) from storage.objects where bucket_id = 'generation-assets') >= 1 $q$);
select public.t_raises('B15 a customer still cannot write to media (admin-only, unchanged)', 'authenticated',
  $q$ insert into storage.objects (bucket_id, name) values ('media', 'x.png') $q$, 'row-level security');
SQL
}

# ── T. THE DELETE TRIGGER ─────────────────────────────────────────────────
trigger_checks() {
  q >/dev/null <<'SQL'
select public.t_be('customer');
select public.t_set('jt', public.t_job(public.t_ws('customer'), public.t_uid('customer'))::text);
select public.t_set('t_locked', public.t_make('customer', public.t_ws('customer'), public.t_var('jt')::uuid, '0.png')::text);
select public.t_set('t_locked_oid', public.t_oid(public.t_var('t_locked')::uuid)::text);
select public.t_set('t_unlocking', public.t_make('customer', public.t_ws('customer'), public.t_var('jt')::uuid, '1.png')::text);
select public.trial_original_unlock_begin(public.t_tok(), public.t_var('t_unlocking')::uuid, true);
select public.t_set('t_unlocking_lid', public.t_lease('t_unlocking')::text);
select public.t_set('t_pend_path', public.t_ws('customer')::text || '/' || public.t_var('jt') || '/2.png');
select public.t_set('t_pend_id', gen_random_uuid()::text);
select public.t_reserve(public.t_var('t_pend_id')::uuid, public.t_ws('customer'), public.t_var('jt')::uuid, public.t_var('t_pend_path'));
select public.t_set('t_pend_asset', public.t_asset(public.t_ws('customer'), public.t_var('jt')::uuid, public.t_var('t_pend_path'))::text);
insert into public.t_vars select 't_unlocked_before', to_jsonb(o)::text from public.trial_originals o where asset_id = public.t_var('u1')::uuid;
delete from public.generation_assets where id in (public.t_var('t_locked')::uuid, public.t_var('t_pend_asset')::uuid, public.t_var('u1')::uuid);
SQL
  q >/dev/null <<'SQL'
select public.t_true('T1  a locked original''s asset deleted → deleted, deleted_at, KEY DESTROYED', 'postgres', $q$
  select status = 'deleted' and deleted_at is not null and not public.t_has_key(id)
    from public.trial_originals where id = public.t_var('t_locked_oid')::uuid $q$);
select public.t_true('T2  a pending original (no asset yet) whose path''s asset was deleted → deleted, key destroyed', 'postgres', $q$
  select status = 'deleted' and not public.t_has_key(id) from public.trial_originals where id = public.t_var('t_pend_id')::uuid $q$);
select public.t_true('T3  an unlocked original''s asset deleted → the row stays exactly as it was (unlocked)', 'postgres', $q$
  select to_jsonb(o)::text = public.t_var('t_unlocked_before') from public.trial_originals o where id = (public.t_var('t_unlocked_before')::jsonb->>'id')::uuid $q$);
delete from public.generation_assets where id = public.t_var('t_unlocking')::uuid;
select public.t_be('customer');
select public.t_eq('T4  an UNLOCKING original whose asset is deleted mid-unlock → finish answers deleted (the caller removes its target)', 'authenticated',
  $q$ select public.trial_original_unlock_finish(public.t_tok(), public.t_var('t_unlocking')::uuid, public.t_var('t_unlocking_lid')::uuid, null, null, 'single', null)->>'state' $q$, 'deleted');
select public.t_true('T5  the trigger function is a definer that catches everything (a delete is never blocked)', 'postgres', $q$
  select prosecdef and prosrc like '%exception when others%' from pg_proc where oid = 'public.trial_originals_asset_deleted()'::regprocedure $q$);
select public.t_set('t6_oid', public.t_oid(public.t_var('s_other')::uuid)::text);
select public.t_set('t6_obj', public.t_row(public.t_var('s_other')::uuid)->>'object_path');
delete from public.workspaces where id = public.t_ws('other');
select public.t_true('T6  a whole workspace deleted: its original keeps its row (workspace_id NULL, deleted, key destroyed)…', 'postgres', $q$
  select workspace_id is null and status = 'deleted' and not public.t_has_key(id)
    from public.trial_originals where id = public.t_var('t6_oid')::uuid $q$);
select public.t_true('T7  … so its blob is still listed for the purge', 'postgres', $q$
  select (public.trial_originals_purge_list(public.t_tok(), 500)) ? public.t_var('t6_obj') $q$);
SQL
  # The trigger never raises, so a swallowed error (a deadlock, say) leaves a
  # row that was never told its image went. begin/finish do its work then.
  q >/dev/null <<'SQL'
select public.t_be('customer');
select public.t_set('t8', public.t_make('customer', public.t_ws('customer'), public.t_var('jt')::uuid, '8.png')::text);
select public.t_set('t8_oid', public.t_oid(public.t_var('t8')::uuid)::text);
select public.t_set('t9', public.t_make('customer', public.t_ws('customer'), public.t_var('jt')::uuid, '9.png')::text);
select public.t_set('t9_oid', public.t_oid(public.t_var('t9')::uuid)::text);
select public.trial_original_unlock_begin(public.t_tok(), public.t_var('t9')::uuid, true);
select public.t_set('t9_lid', public.t_lease('t9')::text);
alter table public.generation_assets disable trigger trial_originals_asset_deleted;
delete from public.generation_assets where id in (public.t_var('t8')::uuid, public.t_var('t9')::uuid);
alter table public.generation_assets enable trigger trial_originals_asset_deleted;
SQL
  q >/dev/null <<'SQL'
select public.t_be('customer');
select public.t_eq('T8  a LOCKED row whose asset vanished untold → begin answers unavailable…', 'authenticated',
  $q$ select public.trial_original_unlock_begin(public.t_tok(), public.t_var('t8')::uuid, true)->>'state' $q$, 'unavailable');
select public.t_true('T8b … and does the trigger''s work: deleted, key destroyed', 'postgres', $q$
  select status = 'deleted' and deleted_at is not null and not public.t_has_key(id)
    from public.trial_originals where id = public.t_var('t8_oid')::uuid $q$);
select public.t_be('customer');
select public.t_eq('T9  an UNLOCKING row whose asset vanished untold → finish answers deleted…', 'authenticated',
  $q$ select public.trial_original_unlock_finish(public.t_tok(), public.t_var('t9')::uuid, public.t_var('t9_lid')::uuid, null, null, 'single', null)->>'state' $q$, 'deleted');
select public.t_true('T9b … and does the trigger''s work: deleted, lease cleared, key destroyed', 'postgres', $q$
  select status = 'deleted' and lease_until is null and not public.t_has_key(id)
    from public.trial_originals where id = public.t_var('t9_oid')::uuid $q$);
select public.t_true('T10 unlock_finish locks the asset BEFORE the original (the delete path''s order: no deadlock)', 'postgres', $q$
  select position('for update of a' in prosrc) > 0
     and position('for update of a' in prosrc) < position('where id = o.id for update' in prosrc)
     and prosrc not like '%where asset_id = p_asset_id for update%'
    from pg_proc where oid = 'public.trial_original_unlock_finish(text,uuid,uuid,text,text,text,uuid)'::regprocedure $q$);
SQL
}

# ── L. THE EVENT GUARD (R8) ───────────────────────────────────────────────
log_checks() {
  q >/dev/null <<'SQL'
select public.t_be('customer');
select public.t_raises('L1  a customer''s log_activity(''watermark_unlocked'') is refused', 'authenticated',
  $q$ select public.log_activity(public.t_ws('customer'), 'watermark_unlocked', 'trial_watermark', null, '{"asset_id":"x"}') $q$, 'watermark_event_forbidden');
select public.t_raises('L2  … in any case (Watermark_Paywall_Opened)', 'authenticated',
  $q$ select public.log_activity(public.t_ws('customer'), 'Watermark_Paywall_Opened') $q$, 'watermark_event_forbidden');
select public.t_be('admin');
select public.t_raises('L3  an admin''s log_activity(''watermark_subscription_confirmed'') is refused too', 'authenticated',
  $q$ select public.log_activity(public.t_ws('customer'), 'watermark_subscription_confirmed') $q$, 'watermark_event_forbidden');
select public.t_be('customer');
select public.t_runs('L4  ordinary events still go through log_activity', 'authenticated',
  $q$ select public.log_activity(public.t_ws('customer'), 'generation.created', 'generation', null, '{}') $q$);
select public.t_true('L5  trial_watermark_log (server token, the customer''s session) → true; the row is the customer''s, entity trial_watermark', 'authenticated', $q$
  select public.trial_watermark_log(public.t_tok(), public.t_ws('customer'), 'watermark_unlock_clicked', public.t_var('u2')::uuid,
                                    '{"asset_id":"a","surface":"lightbox"}', null) $q$);
select public.t_true('L6  (… read back)', 'postgres', $q$
  select count(*) = 1 and bool_and(actor_id = public.t_uid('customer') and entity_type = 'trial_watermark'
                                   and metadata = '{"asset_id":"a","surface":"lightbox"}'::jsonb)
    from public.activity_logs where action = 'watermark_unlock_clicked' $q$);
select public.t_eq('L7  dedupe: the same key twice → true then false; one row', 'authenticated',
  $q$ select public.trial_watermark_log(public.t_tok(), public.t_ws('customer'), 'watermark_plan_selected', null, '{"plan_slug":"pro"}', 'pw-9|pro')::text
          || public.trial_watermark_log(public.t_tok(), public.t_ws('customer'), 'watermark_plan_selected', null, '{"plan_slug":"pro"}', 'pw-9|pro')::text $q$,
  'truefalse');
select public.t_be('matrix');
select public.t_eq('L8  the same dedupe key in ANOTHER workspace is its own event → true', 'authenticated',
  $q$ select public.trial_watermark_log(public.t_tok(), public.t_ws('free'), 'watermark_plan_selected', null, '{}', 'pw-9|pro')::text $q$, 'true');
select public.t_be('customer');
select public.t_true('L9  a caller''s own "dedupe" key in the metadata is dropped (it cannot pre-plant a duplicate)', 'authenticated', $q$
  select public.trial_watermark_log(public.t_tok(), public.t_ws('customer'), 'watermark_paywall_opened', null, '{"dedupe":"pw-planted","paywall_id":"p"}', null) $q$);
select public.t_true('L10 (… stored without it; the planted key is free for a real event)', 'postgres', $q$
  select not exists (select 1 from public.activity_logs where metadata->>'dedupe' = 'pw-planted') $q$);
select public.t_raises('L11 an action outside the 7 → invalid_action', 'authenticated',
  $q$ select public.trial_watermark_log(public.t_tok(), public.t_ws('customer'), 'watermark_hacked', null, '{}', null) $q$, 'invalid_action');
select public.t_raises('L12 metadata over 4 KiB → invalid_metadata', 'authenticated',
  $q$ select public.trial_watermark_log(public.t_tok(), public.t_ws('customer'), 'watermark_unlock_clicked', null,
       jsonb_build_object('x', repeat('a', 5000)), null) $q$, 'invalid_metadata');
select public.t_raises('L13 another workspace → forbidden', 'authenticated',
  $q$ select public.trial_watermark_log(public.t_tok(), public.t_ws('other'), 'watermark_unlock_clicked', null, '{}', null) $q$, 'forbidden');
select public.t_raises('L14 the marker does not leak: a forged log_activity right after a real write, in the SAME transaction, is refused', 'authenticated',
  $q$ do $x$ begin
       perform public.trial_watermark_log(public.t_tok(), public.t_ws('customer'), 'watermark_unlock_clicked', null, '{}', null);
       perform public.log_activity(public.t_ws('customer'), 'watermark_unlocked');
     end $x$ $q$, 'watermark_event_forbidden');
select public.t_raises('L15 the unique index backs the dedupe even for a writer that skips the check', 'postgres',
  $q$ do $x$ begin
       perform set_config('grovbase.trial_wm_writer', '1', true);
       insert into public.activity_logs (workspace_id, action, metadata)
       values (public.t_ws('customer'), 'watermark_plan_selected', '{"dedupe":"pw-9|pro"}');
     end $x$ $q$, 'activity_logs_watermark_dedupe_uq');
select public.t_raises('L16 the owner without the marker is refused as well (the trigger binds every writer)', 'postgres',
  $q$ insert into public.activity_logs (workspace_id, action) values (public.t_ws('customer'), 'watermark_unlocked') $q$, 'watermark_event_forbidden');
-- The dedupe probe as trial_wm_emit writes it, planned with sequential scans
-- priced out: the partial unique index must be able to answer it.
create or replace function public.t_explain(p_sql text) returns text language plpgsql as $f$
declare r record; v text := '';
begin
  perform set_config('enable_seqscan', 'off', true);
  for r in execute 'explain ' || p_sql loop v := v || r."QUERY PLAN" || E'\n'; end loop;
  perform set_config('enable_seqscan', 'on', true);
  return v;
end $f$;
select public.t_true('L17 the emit dedupe probe is answered by activity_logs_watermark_dedupe_uq (never a scan of the whole log)', 'postgres', $q$
  select public.t_explain(format($p$select 1 from public.activity_logs l
            where l.workspace_id = %L and l.action = 'watermark_unlocked' and (l.metadata->>'dedupe') = 'x'
              and l.action like 'watermark\_%%' and l.metadata ? 'dedupe'$p$, public.t_ws('customer'))) like '%activity_logs_watermark_dedupe_uq%'
     and (select prosrc not like '%is not distinct from p_workspace_id%'
            from pg_proc where oid = 'public.trial_wm_emit(uuid,uuid,text,uuid,jsonb,text)'::regprocedure) $q$);
select public.t_true('L18 subscription_confirmed candidates are only subscriptions a paywall preceded (the limit cannot fill with others)', 'postgres', $q$
  select position('watermark_paywall_opened' in prosrc) < position('limit 500' in prosrc)
    from pg_proc where oid = 'public.trial_wm_confirm_subscriptions(uuid)'::regprocedure $q$);
SQL
}

# ── Z. set_asset_derivatives, STRICTER (R12) ───────────────────────────────
deriv_checks() {
  q >/dev/null <<'SQL'
select public.t_set('jz', public.t_job(public.t_ws('customer'), public.t_uid('customer'))::text);
select public.t_set('z_dir', public.t_ws('customer')::text || '/' || public.t_var('jz'));
select public.t_set('z_gen', public.t_asset(public.t_ws('customer'), public.t_var('jz')::uuid, public.t_var('z_dir') || '/0.png')::text);
select public.t_set('z_jpg', public.t_asset(public.t_ws('customer'), public.t_var('jz')::uuid, public.t_var('z_dir') || '/1.jpg')::text);
select public.t_set('z_mini_name', gen_random_uuid()::text);
select public.t_set('z_mini', public.t_asset(public.t_ws('customer'), public.t_var('jz')::uuid, public.t_var('z_dir') || '/' || public.t_var('z_mini_name') || '.png')::text);
select public.t_be('customer');
select public.t_runs('Z1  generation.ts: {ws}/{job}/0.png with 0_t.webp + 0_p.webp → recorded', 'authenticated',
  $q$ select public.set_asset_derivatives(public.t_var('z_gen')::uuid, public.t_var('z_dir') || '/0_t.webp', public.t_var('z_dir') || '/0_p.webp') $q$);
select public.t_runs('Z2  a jpeg: 1.jpg → 1_t.webp + 1_p.webp', 'authenticated',
  $q$ select public.set_asset_derivatives(public.t_var('z_jpg')::uuid, public.t_var('z_dir') || '/1_t.webp', public.t_var('z_dir') || '/1_p.webp') $q$);
select public.t_runs('Z3  thumbnail/run.ts: {ws}/{job}/{uuid}.png with its derivatives', 'authenticated',
  $q$ select public.set_asset_derivatives(public.t_var('z_mini')::uuid, public.t_var('z_dir') || '/' || public.t_var('z_mini_name') || '_t.webp',
                                          public.t_var('z_dir') || '/' || public.t_var('z_mini_name') || '_p.webp') $q$);
select public.t_runs('Z4  the library thumb route when the preview upload failed: thumb only', 'authenticated',
  $q$ select public.set_asset_derivatives(public.t_var('z_gen')::uuid, public.t_var('z_dir') || '/0_t.webp', null) $q$);
select public.t_raises('Z5  a thumb of ANOTHER file in the same folder → not this asset''s derivative (the R6 path that passed before 0143)', 'authenticated',
  $q$ select public.set_asset_derivatives(public.t_var('z_gen')::uuid, public.t_var('z_dir') || '/9_t.webp') $q$, 'not this asset''s derivative');
select public.t_raises('Z6  a preview that is not the asset''s → refused', 'authenticated',
  $q$ select public.set_asset_derivatives(public.t_var('z_gen')::uuid, public.t_var('z_dir') || '/0_t.webp', public.t_var('z_dir') || '/0_t.webp') $q$, 'preview path is not this asset''s derivative');
select public.t_raises('Z7  after an unlock, the MARKED file''s _t (a late after()) → refused', 'authenticated',
  $q$ select public.set_asset_derivatives(public.t_var('u3')::uuid, public.t_ws('customer')::text || '/' || public.t_var('ju') || '/2_t.webp') $q$, 'not this asset''s derivative');
select public.t_runs('Z8  … the clean target''s _t is accepted (the library rebuilds the derivative)', 'authenticated',
  $q$ select public.set_asset_derivatives(public.t_var('u3')::uuid,
       regexp_replace((select storage_path from public.generation_assets where id = public.t_var('u3')::uuid), '\.[^./]*$', '') || '_t.webp') $q$);
select public.t_raises('Z9  the 0083 checks still hold: another workspace''s folder → outside the workspace', 'authenticated',
  $q$ select public.set_asset_derivatives(public.t_var('z_gen')::uuid, public.t_ws('other')::text || '/' || public.t_var('jz') || '/0_t.webp') $q$, 'outside the workspace');
select public.t_raises('Z10 … a malformed path → invalid thumb path', 'authenticated',
  $q$ select public.set_asset_derivatives(public.t_var('z_gen')::uuid, 'not/a/path') $q$, 'invalid thumb path');
select public.t_be('other');
select public.t_raises('Z11 … a non-member → not a member', 'authenticated',
  $q$ select public.set_asset_derivatives(public.t_var('z_gen')::uuid, public.t_var('z_dir') || '/0_t.webp') $q$, 'not a member');
select public.t_be('anon');
select public.t_raises('Z12 … anon → permission denied', 'anon',
  $q$ select public.set_asset_derivatives(public.t_var('z_gen')::uuid, public.t_var('z_dir') || '/0_t.webp') $q$, 'permission denied');
select public.t_true('Z13 asset_derivative_path matches lib/thumbs.ts derive() on the edge cases', 'postgres', $q$
  select public.asset_derivative_path('a/b/0.png', '_t.webp') = 'a/b/0_t.webp'
     and public.asset_derivative_path('a/b/x.tar.gz', '_t.webp') = 'a/b/x.tar_t.webp'
     and public.asset_derivative_path('a/b.c/d', '_t.webp') = 'a/b.c/d_t.webp'
     and public.asset_derivative_path('a/b/noext', '_p.webp') = 'a/b/noext_p.webp'
     and public.asset_derivative_path('a/.png', '_t.webp') = 'a/_t.webp'
     and public.asset_derivative_path('x.png', '_t.webp') = 'x_t.webp' $q$);
SQL
}

# ── X0. STATS ARE ADMIN-ONLY ───────────────────────────────────────────────
stats_checks() {
  q >/dev/null <<'SQL'
select public.t_set('k_unlocked', (select count(*)::text from public.trial_originals where status = 'unlocked'));
select public.t_set('k_expired_ev', (select count(*)::text from public.activity_logs where action = 'watermark_original_expired'));
select public.t_be('admin');
select public.t_true('K1  an admin reads the stats: status counts, items from the originals, the events, the purge heartbeat', 'authenticated', $q$
  select (r->'status'->>'unlocked') = public.t_var('k_unlocked') and public.t_var('k_unlocked') = '2'
     and (r->'items'->>'unlocked')::integer = 2
     and (r->'events'->'watermark_original_expired'->>'events') = public.t_var('k_expired_ev')
     and (r->'events'->'watermark_plan_selected'->>'workspaces')::integer = 2
     and r->'purge'->>'ran_at' is not null and r->'sweep' = 'null'::jsonb and r->>'days' = '30'
    from (select public.trial_watermark_stats(30) r) s $q$);
select public.t_true('K2  the window is clamped (0 → 1 day, 9999 → 365)', 'authenticated', $q$
  select public.trial_watermark_stats(0)->>'days' = '1' and public.trial_watermark_stats(9999)->>'days' = '365' $q$);
select public.t_be('customer');
select public.t_raises('K3  a customer → forbidden', 'authenticated', $q$ select public.trial_watermark_stats(30) $q$, 'forbidden');
select public.t_be('anon');
select public.t_raises('K4  anon → permission denied', 'anon', $q$ select public.trial_watermark_stats(30) $q$, 'permission denied');
SQL
}

# ── M (again). OVER A POPULATED DATABASE ───────────────────────────────────
reapply_checks() {
  local before after
  q -c "update public.app_settings set value = value || '{\"opacity\": 0.5}' where key = 'trial_watermark'" >/dev/null
  before=$(q -c 'select public.t_data_print()')
  if apply_migration "$1"; then
    record 'M11 0143 applies a third time, over every row the tests above wrote' true ''
  else
    record 'M11 0143 applies a third time, over every row the tests above wrote' false "$(tr '\n' ' ' < "$ERR")"
  fi
  after=$(q -c 'select public.t_data_print()')
  if [ "$before" = "$after" ]; then
    record 'M12 and not one original, key, event or the admin''s edited config row changed' true ''
  else
    record 'M12 and not one original, key, event or the admin''s edited config row changed' false "$before → $after"
  fi
  q >/dev/null <<'SQL'
select public.t_true('M13 and the functions are still exactly the first apply''s', 'postgres', $q$ select public.t_fn_print() = public.t_var('fn_after_1') $q$);
SQL
}

# ── J. pg_cron PRESENT (an emulated `cron` schema) ─────────────────────────
cron_checks() {
  q >/dev/null <<'SQL'
create schema cron;
create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
create table cron.job_run_details (runid bigserial primary key, jobid bigint, status text, start_time timestamptz);
create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command) returning jobid $$;
create function cron.unschedule(p_name text) returns boolean language sql as $$
  with d as (delete from cron.job where jobname = p_name returning 1) select count(*) > 0 from d $$;
SQL
  local i ok=true
  for i in 1 2; do apply_migration "$1" || ok=false; done
  record 'J1  with pg_cron present, 0143 applies (twice)' "$ok" "$(tr '\n' ' ' < "$ERR")"
  q >/dev/null <<'SQL'
select public.t_true('J2  … and leaves exactly ONE job grovbase-trial-originals-sweep, every 15 minutes, running the owner-only sweep', 'postgres', $q$
  select count(*) = 1 and bool_and(schedule = '*/15 * * * *' and command = 'select public.trial_originals_sweep();')
    from cron.job where jobname = 'grovbase-trial-originals-sweep' $q$);
insert into cron.job_run_details (jobid, status, start_time)
  select jobid, s, now() - make_interval(mins => m) from cron.job, (values ('succeeded', 30), ('failed', 15)) v(s, m)
   where jobname = 'grovbase-trial-originals-sweep';
select public.t_be('admin');
select public.t_true('J3  the admin stats show the sweep''s last run (failed) and the last success separately', 'authenticated', $q$
  select r->'sweep'->>'last_status' = 'failed' and (r->'sweep'->>'last_success')::timestamptz < (r->'sweep'->>'last_start')::timestamptz
    from (select public.trial_watermark_stats(30) r) s $q$);
SQL
}

SUITE_ABORTED=0
run_suite() {  # $1 = database, $2 = migration file
  DB="$1"
  dropdb "${PGCONN[@]}" --if-exists --force "$DB" >/dev/null 2>&1
  createdb "${PGCONN[@]}" -T template0 -E UTF8 "$DB"
  build_rehearsal
  seed
  rehearsal_checks
  apply_checks "$2"
  [ "$SUITE_ABORTED" = "0" ] || return 0
  acl_checks
  config_checks
  decide_checks
  reserve_checks
  states_checks
  unlock_checks
  source_checks
  sweep_checks
  purge_checks
  bucket_checks
  trigger_checks
  log_checks
  deriv_checks
  stats_checks
  reapply_checks "$2"
  cron_checks "$2"
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
    echo "All $total trial-watermark SQL tests passed."
  else
    echo "$failed of $total FAILED" >&2
    exit 1
  fi
}

# ════════════════════════════════════════════════════════════════════════════
run_suite "$DB_MAIN" "$MIGRATION"

# ── X. MUTATION TESTS — THE SUITE MUST GO RED ON A BROKEN 0143 ──────────────
#   1. the anon purge helper without the arm         → P1 (anon sees unarmed blobs)
#   2. a disputed payment counted as paid            → D14
#   3. the activity_logs guard trigger not created   → L1 L2 L3 L16
mutate() {  # $1 = n, $2 = perl program → path of the mutant
  local out="$WORK/0143_mutant_$1.sql"
  perl -0777 -pe "$2" "$MIGRATION" > "$out"
  echo "$out"
}
MUTANT_FILES=(
  "$(mutate 1 's/(\n       and o\.purge_armed_until > now\(\))//')"
  "$(mutate 2 "s/'refunded', 'partially_refunded'\)\)/'refunded', 'partially_refunded', 'disputed'))/")"
  "$(mutate 3 's/create or replace trigger activity_logs_watermark_guard\n  before insert on public\.activity_logs\n  for each row execute function public\.activity_logs_watermark_guard\(\);//')"
)
MUTANT_LABELS=(
  'trial_original_purgeable without "purge_armed_until > now()"'
  'trial_wm_paid_credits counting disputed payments'
  'no activity_logs_watermark_guard trigger'
)
MUTANT_EXPECT=('P1' 'D14' 'L1 L2 L3 L16')

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
    X_RESULTS+=("$label|false|the mutation did not apply: the copy is identical to 0143")
    continue
  fi
  echo "trialwm-sql: running the suite against mutant $n (${MUTANT_LABELS[$i]})…" >&2
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
  X_RESULTS+=("$label|$caught|diff vs 0143: ${changed} line(s); mutant applied: $applied; red: ${red:-none} of $total checks (must include: ${MUTANT_EXPECT[$i]})")
  [ "${KEEP_DB:-0}" = "1" ] || dropdb "${PGCONN[@]}" --if-exists --force "${MUTANT_DBS[$i]}" >/dev/null 2>&1 || true
done

DB="$DB_MAIN"
for r in "${X_RESULTS[@]}"; do
  IFS='|' read -r name ok detail <<<"$r"
  record "$name" "$ok" "$detail"
done

scoreboard
