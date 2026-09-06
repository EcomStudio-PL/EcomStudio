-- ============================================================================
-- PLATFORM ACCESS — the pre-launch door, enforced in the database.
--
-- The four switches themselves live in app_settings under `platform_access`
-- (public SELECT, admin-only write via the existing settings_admin_write
-- policy), so no new table is needed and no configuration is duplicated.
--
-- What DOES need the database is one narrow case the application cannot
-- handle on its own: a brand-new Google/Apple account arriving while
-- registration is closed. The provider round trip has already created the
-- auth.users row by the time our callback runs, and deleting it would need a
-- service-role key this application deliberately does not carry. So the
-- account is neutralised instead — profiles.blocked = true, which every
-- protected surface already refuses to render for.
--
-- That write cannot be done by the customer's own session: profiles_role_guard
-- (correctly) forbids a non-admin from touching `blocked`, which is exactly
-- what stops a blocked account unblocking itself. The function below is the
-- one sanctioned exception: SECURITY DEFINER, it blocks ONLY the caller, ONLY
-- while signup is genuinely closed, and never an admin. The guard trigger is
-- taught to recognise it by a transaction-local setting that only this
-- function sets — not by weakening the rule for everyone.
-- ============================================================================

-- ── 1. The guard learns about one sanctioned writer ──────────────────────────
--
-- Unchanged for every other caller: a non-admin still cannot change role,
-- blocked or account_manager_id. The only addition is that the platform-access
-- gate below, running as a definer, may set `blocked`. `set_config(..., true)`
-- is transaction-local and lives in pg_catalog, so it is not reachable through
-- PostgREST and cannot be forged by a client.
create or replace function public.prevent_role_escalation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  gate_open boolean := coalesce(
    current_setting('grovbase.access_gate', true), ''
  ) = 'on';
begin
  if not public.is_admin(auth.uid()) then
    if new.role is distinct from old.role then
      raise exception 'not_allowed_to_change_role';
    end if;
    if new.blocked is distinct from old.blocked and not gate_open then
      raise exception 'not_allowed_to_change_blocked';
    end if;
    if new.account_manager_id is distinct from old.account_manager_id then
      raise exception 'not_allowed_to_change_account_manager';
    end if;
  end if;
  return new;
end;
$$;

-- ── 2. Is registration open right now, by the SERVER's clock ────────────────
--
-- The same three inputs the application reads: the switch, the legacy
-- registration kill switch the older settings screen writes, and the optional
-- scheduled opening. Kept here as well as in TypeScript because the function
-- below must not trust a caller's claim about it.
--
-- Fail-safe OPEN, matching the application: an unreadable or absent settings
-- row must not start blocking accounts.
create or replace function public.platform_signup_open()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  with cfg as (
    select
      coalesce((value ->> 'allow_signup')::boolean, true) as allow_signup,
      nullif(value ->> 'signup_opens_at', '')::timestamptz as opens_at
    from public.app_settings where key = 'platform_access'
  ), legacy as (
    select coalesce((value ->> 'registration_enabled')::boolean, true) as enabled
    from public.app_settings where key = 'security'
  )
  select
    coalesce((select allow_signup from cfg), true)
    and coalesce((select enabled from legacy), true)
    and coalesce((select opens_at from cfg) <= now(), true);
$$;

-- ── 3. Neutralise the caller's own account, and only under those terms ──────
--
-- Returns true when it actually blocked the account. Deliberately narrow:
--   · it can only ever touch auth.uid() — no user_id argument exists;
--   · it refuses while registration is open, so it cannot be used as a
--     "block me" button during normal operation;
--   · it refuses for an admin, so an operator can never lock themselves out;
--   · it is revoked from anon — a session is required to have one to end.
create or replace function public.close_out_denied_signup()
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then return false; end if;
  if public.platform_signup_open() then return false; end if;
  if public.is_admin(uid) then return false; end if;

  perform set_config('grovbase.access_gate', 'on', true);
  update public.profiles set blocked = true where id = uid and blocked = false;
  perform set_config('grovbase.access_gate', 'off', true);
  return true;
end;
$$;

revoke execute on function public.close_out_denied_signup() from public, anon;
grant execute on function public.close_out_denied_signup() to authenticated;

revoke execute on function public.platform_signup_open() from public;
grant execute on function public.platform_signup_open() to anon, authenticated;

-- ── 4. The settings row, created open so nothing changes on deploy ──────────
insert into public.app_settings (key, value)
values ('platform_access', jsonb_build_object(
  'allow_signup', true,
  'allow_login', true,
  'show_auth_entry', true,
  'waitlist_enabled', false,
  'signup_opens_at', null,
  'copy', '{}'::jsonb,
  'mobile_override', false,
  'mobile_copy', '{}'::jsonb
))
on conflict (key) do nothing;
