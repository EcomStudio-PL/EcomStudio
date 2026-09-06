-- ============================================================================
-- 0059 — LOGIN SECURITY: code TTL in SECONDS (default 120 s), tighter defaults.
--
-- Task 11 / Priorytet 2:
--   * the OTP now lives 120 SECONDS by default (was 10 minutes) — the setting
--     key becomes `code_ttl_seconds` and login_challenge_open takes
--     p_ttl_seconds instead of p_ttl_minutes;
--   * re-verification window default drops 14 → 7 days;
--   * new-IP verification default flips ON.
--
-- The settings row migrates in place: a value the admin customised is
-- preserved (minutes are converted ×60); a value still equal to the old seed
-- default moves to the new default. Everything stays a flat string — the same
-- shape the admin editor writes.
-- ============================================================================

do $$
declare
  v jsonb;
begin
  select value into v from public.app_settings where key = 'login_security' for update;

  if v is null then
    insert into public.app_settings (key, value)
    values ('login_security', jsonb_build_object(
      'verify_new_device', '1',
      'verify_new_ip',     '1',
      'reverify_days',     '7',
      'code_ttl_seconds',  '120',
      'max_attempts',      '5',
      'resend_seconds',    '60'
    ));
    return;
  end if;

  -- TTL: minutes → seconds. The old default (10 min) becomes the new default
  -- (120 s); an admin-set custom value keeps its duration, converted.
  if not (v ? 'code_ttl_seconds') then
    if coalesce(v->>'code_ttl_minutes', '10') = '10' then
      v := (v - 'code_ttl_minutes') || jsonb_build_object('code_ttl_seconds', '120');
    else
      v := (v - 'code_ttl_minutes') || jsonb_build_object(
        'code_ttl_seconds',
        (greatest(30, least(3600, coalesce(nullif(v->>'code_ttl_minutes', ''), '10')::int * 60)))::text
      );
    end if;
  end if;

  -- Old seed defaults move to the new defaults; customised values stay.
  if coalesce(v->>'reverify_days', '14') = '14' then
    v := v || jsonb_build_object('reverify_days', '7');
  end if;
  if coalesce(v->>'verify_new_ip', '0') = '0' then
    v := v || jsonb_build_object('verify_new_ip', '1');
  end if;

  update public.app_settings
     set value = v, updated_at = now()
   where key = 'login_security';
end $$;

-- ── login_challenge_open: TTL parameter in seconds ───────────────────────────
-- Same body as 0057 apart from make_interval(secs => …). The parameter NAME
-- changes (PostgREST calls by name), so the old signature is dropped, not
-- replaced. Floor of 30 s guards against a nonsense TTL locking users out
-- before they can type.
drop function if exists public.login_challenge_open(text, uuid, text, text, text, text, text, integer, integer);

create function public.login_challenge_open(
  p_token        text,
  p_user         uuid,
  p_device_hash  text,
  p_code_hash    text,
  p_ip_hash      text,
  p_device_label text,
  p_reason       text,
  p_ttl_seconds  integer,
  p_max_attempts integer
)
returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid;
begin
  if not public.login_security_token_ok(p_token) then
    return null;
  end if;

  -- Spend any live challenge for this device so only one code is ever valid.
  update public.login_security_challenges
     set used_at = now()
   where user_id = p_user and device_hash = p_device_hash
     and used_at is null and expires_at > now();

  insert into public.login_security_challenges
    (user_id, device_hash, code_hash, ip_hash, device_label, reason,
     max_attempts, expires_at)
  values
    (p_user, p_device_hash, p_code_hash, nullif(p_ip_hash, ''),
     coalesce(p_device_label, ''), coalesce(nullif(p_reason, ''), 'new_device'),
     greatest(1, coalesce(p_max_attempts, 5)),
     now() + make_interval(secs => greatest(30, coalesce(p_ttl_seconds, 120))))
  returning id into v_id;

  insert into public.security_login_events
    (user_id, event_type, ip_hash, device_summary, reason)
  values
    (p_user, 'verification_required', nullif(p_ip_hash, ''),
     coalesce(p_device_label, ''), coalesce(nullif(p_reason, ''), 'new_device'));

  return v_id;
end;
$$;

revoke execute on function public.login_challenge_open(text, uuid, text, text, text, text, text, integer, integer) from public;
grant execute on function public.login_challenge_open(text, uuid, text, text, text, text, text, integer, integer) to anon, authenticated;
