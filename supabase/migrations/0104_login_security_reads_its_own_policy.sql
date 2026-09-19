-- THE SECOND FACTOR DECIDES ITS OWN POLICY.
--
-- ORDERING: compatible in BOTH directions, so it is safe to apply before the
-- application deploy and it is meant to be — the running build passes the very
-- values the function now reads for itself, so nothing changes for it. Slot it
-- with 0100: 0100 + 0104 → APP DEPLOY → 0101 → 0102 → 0103.
--
-- THE DEFECT (P1-17). `login_security_check` took the three inputs that decide
-- whether a login needs an emailed code as ARGUMENTS:
--
--     p_verify_device boolean, p_verify_ip boolean, p_reverify_days integer
--
-- and it WRITES based on them — on a miss with `p_verify_device` false it
-- inserts the caller's device into `user_trusted_devices` and answers
-- `trusted: true`. The arguments come from the caller, and the function is
-- granted to every signed-in role, so the party the second factor exists to
-- stop is the same party that gets to say whether it applies. A holder of a
-- session could enrol their own device as trusted and never be challenged
-- again.
--
-- THE FIX. The policy is read inside the function, from the same
-- `app_settings.login_security` row the admin panel writes and
-- lib/server/login-security.ts parses. The three arguments stay in the
-- signature and become inert.
--
-- WHY THE SIGNATURE DOES NOT MOVE. Dropping or defaulting them would break the
-- currently deployed build the moment this is applied, and this migration is
-- meant to land BEFORE that build is replaced. Keeping the shape means the old
-- code keeps calling it, passes values that are now ignored, and gets the same
-- answers it would have got — because it was reading the same row to build
-- them. lib/database.types.ts stays valid for the same reason.
--
-- HOW IT DEGRADES. A missing row, an unparseable value, a row an operator has
-- never touched: every one of them lands on the STRICT default — verify the
-- device, verify the IP, re-verify after 7 days — which is what
-- LOGIN_SECURITY_DEFAULTS says in the TypeScript. A misconfiguration must
-- never be the thing that waves an attacker through.

create or replace function public.login_security_check(
  p_device_hash text,
  p_ip_hash     text,
  p_verify_device boolean,   -- IGNORED: kept so the signature does not move
  p_verify_ip     boolean,   -- IGNORED
  p_reverify_days integer    -- IGNORED
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_uid uuid := auth.uid();
  v_dev public.user_trusted_devices%rowtype;
  v_cfg jsonb;
  v_verify_device boolean;
  v_verify_ip     boolean;
  v_reverify_days integer;
begin
  if v_uid is null then
    return jsonb_build_object('trusted', false, 'reason', 'no_session');
  end if;

  -- THE POLICY, READ HERE. The admin panel writes these as flat strings
  -- ("1"/"0" and a number); anything else falls to the strict default, which
  -- is the same rule asFlag/asInt follow in lib/server/login-security.ts.
  select value into v_cfg from public.app_settings where key = 'login_security';
  v_verify_device := case lower(coalesce(v_cfg ->> 'verify_new_device', ''))
                       when '0' then false when 'false' then false
                       when 'f' then false when 'no' then false
                       else true end;
  v_verify_ip     := case lower(coalesce(v_cfg ->> 'verify_new_ip', ''))
                       when '0' then false when 'false' then false
                       when 'f' then false when 'no' then false
                       else true end;
  v_reverify_days := coalesce(
    (case when coalesce(v_cfg ->> 'reverify_days', '') ~ '^[0-9]+$'
          then least(365, (v_cfg ->> 'reverify_days')::int) end),
    7);

  /*
    THE FEATURE'S OWN OFF SWITCH, honoured here so both gates obey it.

    lib/server/login-security.ts opens with exactly this test and returns "no
    gate" — but that is the LAYOUT gate, and the middleware gate added for
    P1-23 has no way to run server-only code. Without this branch, an operator
    switching the second factor off in the admin panel would 403 every
    /api/* call for every customer: the middleware sends an empty device hash
    (the cookie is only ever issued BY the step-up page, which nobody now
    reaches), the refusal below fires, and a 403 an API caller cannot follow
    comes back from a product whose second factor is switched OFF. Pages would
    keep rendering, so the panel would look healthy while every tool was dead.

    Putting it in the function rather than in the middleware is what keeps the
    two gates from drifting again: there is one policy and one place that
    reads it.
  */
  if not v_verify_device and not v_verify_ip and v_reverify_days = 0 then
    return jsonb_build_object('trusted', true, 'reason', 'disabled');
  end if;

  if coalesce(p_device_hash, '') = '' then
    return jsonb_build_object('trusted', false, 'reason', 'new_device');
  end if;

  select * into v_dev from public.user_trusted_devices
   where user_id = v_uid and device_hash = p_device_hash and revoked_at is null
   limit 1;

  if not found then
    if v_verify_device then
      return jsonb_build_object('trusted', false, 'reason', 'new_device');
    end if;
    insert into public.user_trusted_devices (user_id, device_hash, last_ip_hash)
    values (v_uid, p_device_hash, nullif(p_ip_hash, ''))
    on conflict (user_id, device_hash) do update set last_seen_at = now(), revoked_at = null;
    return jsonb_build_object('trusted', true, 'reason', 'first_use');
  end if;

  if v_reverify_days > 0
     and v_dev.last_verified_at < now() - make_interval(days => v_reverify_days) then
    return jsonb_build_object('trusted', false, 'reason', 'stale');
  end if;

  if v_verify_ip and coalesce(p_ip_hash, '') <> ''
     and v_dev.last_ip_hash is not null
     and v_dev.last_ip_hash is distinct from p_ip_hash then
    return jsonb_build_object('trusted', false, 'reason', 'new_ip');
  end if;

  update public.user_trusted_devices
     set last_seen_at = now(),
         last_ip_hash = coalesce(nullif(p_ip_hash, ''), last_ip_hash)
   where id = v_dev.id;

  return jsonb_build_object('trusted', true, 'reason', 'known');
end;
$function$;

-- Both of these carry the default blanket grant to PUBLIC, which is what makes
-- them reachable by `anon` as well. Neither can do anything useful without a
-- session — both open on auth.uid() — but a function that decides whether a
-- second factor applies should not be callable by a caller who has no first
-- factor either.
revoke execute on function public.login_security_check(text, text, boolean, boolean, integer)
  from public, anon;
grant execute on function public.login_security_check(text, text, boolean, boolean, integer)
  to authenticated;

revoke execute on function public.trusted_device_revoke(uuid) from public, anon;
grant execute on function public.trusted_device_revoke(uuid) to authenticated;

comment on function public.login_security_check(text, text, boolean, boolean, integer) is
  'Decides whether this device needs an emailed code. Reads verify_new_device / verify_new_ip / reverify_days from app_settings.login_security — NEVER from its arguments, which are retained only so the signature does not move. Unparseable or missing settings mean the strict default.';
