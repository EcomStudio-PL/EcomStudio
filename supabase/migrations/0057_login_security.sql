-- ============================================================================
-- 0057 — LOGIN SECURITY: trusted devices, email step-up challenges, events.
--
-- The app already authenticates through Supabase Auth. This adds an
-- APP-LEVEL second factor on top of it: after a correct password / Google /
-- Apple sign-in, a login from an unrecognised device — or a new IP, or one
-- that has not verified in N days — must confirm a 6-digit code emailed by
-- GrovBase before any protected page will render.
--
-- Three tables:
--   user_trusted_devices   one row per (user, device cookie). The cookie is a
--                          128-bit random value; only its SHA-256 is stored.
--   login_security_challenges  a pending or spent step-up. The OTP is stored
--                          only as sha256(code); the plaintext lives in the
--                          email and nowhere else.
--   security_login_events  an append-only trail (new device, code required,
--                          verified, failed, device revoked).
--
-- RLS: a user may READ their own devices and events; NOBODY writes any of
-- these from a client. Every write is a SECURITY DEFINER function, and the
-- ones the unauthenticated /auth/security-check flow needs are gated by the
-- same dispatch-token pattern the notification queue uses (0052): the token
-- is sha256("grovbase-login-security:" + key) and the database only ever
-- stores sha256(token), so the anon key alone opens nothing.
--
-- The admin knobs live in app_settings->'login_security', seeded here with
-- the product defaults, edited through /admin/settings integrations by the
-- generic settings writer — flat, primitive values only.
-- ============================================================================

-- ── settings row ────────────────────────────────────────────────────────────
-- Flat values on purpose: the admin settings editor renders each key as one
-- control and would mangle a nested object. `verify_device`/`verify_ip` are
-- "1"/"0" strings for the same reason the registration row uses strings.
insert into public.app_settings (key, value)
values (
  'login_security',
  jsonb_build_object(
    'verify_new_device', '1',
    'verify_new_ip',     '0',
    'reverify_days',     '14',
    'code_ttl_minutes',  '10',
    'max_attempts',      '5',
    'resend_seconds',    '60'
  )
)
on conflict (key) do nothing;

-- Publish sha256(login-security dispatch token) so the anon-callable functions
-- can authenticate the server. The server fills the real hash on boot
-- (ensureLoginSecurityHash), exactly like the notification dispatch hash; an
-- empty string means "not armed" and every gated call returns null.
insert into public.app_settings (key, value)
values ('login_security_dispatch', jsonb_build_object('hash', ''))
on conflict (key) do nothing;

-- ── trusted devices ─────────────────────────────────────────────────────────
create table if not exists public.user_trusted_devices (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  -- sha256(device cookie value). The raw cookie never reaches the database.
  device_hash       text not null,
  -- "iPhone • Safari" — a label a human recognises, never a fingerprint.
  device_label      text not null default '',
  -- HMAC-SHA256(ip, LOGIN_IP_HASH_SECRET). Never the raw address.
  last_ip_hash      text,
  first_verified_at timestamptz not null default now(),
  last_verified_at  timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  created_at        timestamptz not null default now(),
  revoked_at        timestamptz,
  unique (user_id, device_hash)
);

create index if not exists user_trusted_devices_user_idx
  on public.user_trusted_devices (user_id) where revoked_at is null;

-- ── step-up challenges ───────────────────────────────────────────────────────
create table if not exists public.login_security_challenges (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  device_hash  text not null,
  -- sha256(6-digit code). Plaintext is emailed, never stored.
  code_hash    text not null,
  ip_hash      text,
  device_label text not null default '',
  reason       text not null default 'new_device',
  attempts     integer not null default 0,
  max_attempts integer not null default 5,
  expires_at   timestamptz not null,
  used_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists login_security_challenges_user_idx
  on public.login_security_challenges (user_id, created_at desc);

-- ── event trail ──────────────────────────────────────────────────────────────
create table if not exists public.security_login_events (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  event_type     text not null,
  device_id      uuid references public.user_trusted_devices (id) on delete set null,
  ip_hash        text,
  device_summary text not null default '',
  success        boolean,
  reason         text,
  occurred_at    timestamptz not null default now()
);

create index if not exists security_login_events_user_idx
  on public.security_login_events (user_id, occurred_at desc);

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.user_trusted_devices      enable row level security;
alter table public.login_security_challenges enable row level security;
alter table public.security_login_events     enable row level security;

-- A signed-in user reads their own devices; admins read all. No client writes.
drop policy if exists trusted_devices_read_own on public.user_trusted_devices;
create policy trusted_devices_read_own on public.user_trusted_devices
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists security_events_read_own on public.security_login_events;
create policy security_events_read_own on public.security_login_events
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- Challenges hold a (hashed) OTP and are never read by a client — the verify
-- goes through a SECURITY DEFINER function. No SELECT policy = no client read.

-- ── dispatch-token gate ──────────────────────────────────────────────────────
-- Same shape as notification dispatch: the server holds the token, the table
-- holds only its hash, and a mismatch returns the "do nothing" answer rather
-- than raising (an exception would be an oracle on an anon-callable function).
create or replace function public.login_security_token_ok(p_token text)
returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select coalesce(
    (select value->>'hash' from public.app_settings where key = 'login_security_dispatch'),
    ''
  ) <> ''
  and encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
      = (select value->>'hash' from public.app_settings where key = 'login_security_dispatch');
$$;

-- ── open a challenge ─────────────────────────────────────────────────────────
-- Called server-side right after a correct password when the risk check fires.
-- Supersedes any earlier pending challenge for the same (user, device): a fresh
-- code always invalidates the old one. Returns the challenge id, or null when
-- the token is wrong. The plaintext code is generated by the SERVER and only
-- its hash is passed in — the database never sees the digits.
create or replace function public.login_challenge_open(
  p_token       text,
  p_user        uuid,
  p_device_hash text,
  p_code_hash   text,
  p_ip_hash     text,
  p_device_label text,
  p_reason      text,
  p_ttl_minutes integer,
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
     now() + make_interval(mins => greatest(1, coalesce(p_ttl_minutes, 10))))
  returning id into v_id;

  insert into public.security_login_events
    (user_id, event_type, ip_hash, device_summary, reason)
  values
    (p_user, 'verification_required', nullif(p_ip_hash, ''),
     coalesce(p_device_label, ''), coalesce(nullif(p_reason, ''), 'new_device'));

  return v_id;
end;
$$;

-- ── verify a challenge ───────────────────────────────────────────────────────
-- Returns a small json verdict the route maps to UI:
--   {ok:true}                        code correct → device trusted
--   {ok:false, reason:'expired'}     TTL passed / already used
--   {ok:false, reason:'locked'}      attempts exhausted
--   {ok:false, reason:'mismatch', attempts_left:N}
--   {ok:false, reason:'not_found'}   no live challenge / bad token
-- On success it upserts the trusted device (renewing last_verified_at + IP) so
-- a passing code is what makes the device trusted, and stamps the events.
create or replace function public.login_challenge_verify(
  p_token       text,
  p_user        uuid,
  p_device_hash text,
  p_code_hash   text,
  p_ip_hash     text,
  p_device_label text
)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_ch  public.login_security_challenges%rowtype;
  v_dev uuid;
begin
  if not public.login_security_token_ok(p_token) then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  select * into v_ch
    from public.login_security_challenges
   where user_id = p_user and device_hash = p_device_hash and used_at is null
   order by created_at desc
   limit 1
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if v_ch.expires_at <= now() then
    update public.login_security_challenges set used_at = now() where id = v_ch.id;
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  if v_ch.attempts >= v_ch.max_attempts then
    update public.login_security_challenges set used_at = now() where id = v_ch.id;
    return jsonb_build_object('ok', false, 'reason', 'locked');
  end if;

  if v_ch.code_hash is distinct from p_code_hash then
    update public.login_security_challenges
       set attempts = attempts + 1,
           used_at = case when attempts + 1 >= max_attempts then now() else null end
     where id = v_ch.id;
    insert into public.security_login_events
      (user_id, event_type, ip_hash, device_summary, success, reason)
    values (p_user, 'verification_failed', nullif(p_ip_hash, ''),
            coalesce(p_device_label, ''), false, 'mismatch');
    return jsonb_build_object(
      'ok', false,
      'reason', case when v_ch.attempts + 1 >= v_ch.max_attempts then 'locked' else 'mismatch' end,
      'attempts_left', greatest(0, v_ch.max_attempts - (v_ch.attempts + 1))
    );
  end if;

  -- Correct. Spend the code, trust the device, record it.
  update public.login_security_challenges set used_at = now() where id = v_ch.id;

  insert into public.user_trusted_devices
    (user_id, device_hash, device_label, last_ip_hash)
  values
    (p_user, p_device_hash, coalesce(nullif(p_device_label, ''), coalesce(v_ch.device_label, '')),
     nullif(p_ip_hash, ''))
  on conflict (user_id, device_hash) do update
    set last_verified_at = now(),
        last_seen_at     = now(),
        last_ip_hash     = coalesce(nullif(excluded.last_ip_hash, ''), public.user_trusted_devices.last_ip_hash),
        device_label     = coalesce(nullif(excluded.device_label, ''), public.user_trusted_devices.device_label),
        revoked_at       = null
  returning id into v_dev;

  insert into public.security_login_events
    (user_id, event_type, device_id, ip_hash, device_summary, success, reason)
  values (p_user, 'verification_success', v_dev, nullif(p_ip_hash, ''),
          coalesce(p_device_label, ''), true, v_ch.reason);

  return jsonb_build_object('ok', true);
end;
$$;

-- ── the risk decision + touch, in one call ───────────────────────────────────
-- "Given this signed-in user on this device+IP, does the login need a code?"
-- Runs as the USER (invoker rights): the layout already has an authenticated
-- session, and this only ever reads/writes that user's own rows through the
-- policies above — plus a device touch, which is why it is SECURITY DEFINER for
-- the UPDATE alone but pins the user id from auth.uid(), never a parameter.
-- Returns {trusted:bool, reason:text}. When trusted, it bumps last_seen_at so a
-- device that keeps showing up stays warm.
create or replace function public.login_security_check(
  p_device_hash text,
  p_ip_hash     text,
  p_verify_device boolean,
  p_verify_ip     boolean,
  p_reverify_days integer
)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_dev public.user_trusted_devices%rowtype;
begin
  if v_uid is null then
    -- No session: the caller must not treat this as "trusted".
    return jsonb_build_object('trusted', false, 'reason', 'no_session');
  end if;
  if coalesce(p_device_hash, '') = '' then
    return jsonb_build_object('trusted', false, 'reason', 'new_device');
  end if;

  select * into v_dev
    from public.user_trusted_devices
   where user_id = v_uid and device_hash = p_device_hash and revoked_at is null
   limit 1;

  if not found then
    -- Unknown device. Only actually challenge when the admin wants device
    -- checks; otherwise trust-on-first-use and record it below.
    if coalesce(p_verify_device, true) then
      return jsonb_build_object('trusted', false, 'reason', 'new_device');
    end if;
    insert into public.user_trusted_devices (user_id, device_hash, last_ip_hash)
    values (v_uid, p_device_hash, nullif(p_ip_hash, ''))
    on conflict (user_id, device_hash) do update set last_seen_at = now(), revoked_at = null;
    return jsonb_build_object('trusted', true, 'reason', 'first_use');
  end if;

  -- Known device. Stale?
  if coalesce(p_reverify_days, 0) > 0
     and v_dev.last_verified_at < now() - make_interval(days => p_reverify_days) then
    return jsonb_build_object('trusted', false, 'reason', 'stale');
  end if;

  -- New IP on a known device, and the admin asked us to care.
  if coalesce(p_verify_ip, false)
     and coalesce(p_ip_hash, '') <> ''
     and v_dev.last_ip_hash is not null
     and v_dev.last_ip_hash is distinct from p_ip_hash then
    return jsonb_build_object('trusted', false, 'reason', 'new_ip');
  end if;

  -- Trusted: touch it so it stays warm, and follow the IP forward.
  update public.user_trusted_devices
     set last_seen_at = now(),
         last_ip_hash = coalesce(nullif(p_ip_hash, ''), last_ip_hash)
   where id = v_dev.id;

  return jsonb_build_object('trusted', true, 'reason', 'known');
end;
$$;

-- ── peek at the live challenge ───────────────────────────────────────────────
-- The step-up page needs to know whether a code is already outstanding (so a
-- reload does not fire a second email) and how old it is (to honour the resend
-- cooldown), without a client ever reading the hashed code. Returns null when
-- the token is wrong or no live challenge exists.
create or replace function public.login_challenge_peek(
  p_token text, p_user uuid, p_device_hash text
)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare v_ch public.login_security_challenges%rowtype;
begin
  if not public.login_security_token_ok(p_token) then return null; end if;
  select * into v_ch from public.login_security_challenges
   where user_id = p_user and device_hash = p_device_hash and used_at is null and expires_at > now()
   order by created_at desc limit 1;
  if not found then return null; end if;
  return jsonb_build_object(
    'age_seconds', floor(extract(epoch from (now() - v_ch.created_at)))::int,
    'expires_in_seconds', floor(extract(epoch from (v_ch.expires_at - now())))::int,
    'attempts', v_ch.attempts,
    'max_attempts', v_ch.max_attempts,
    'reason', v_ch.reason
  );
end;
$$;

revoke execute on function public.login_challenge_peek(text, uuid, text) from public;
grant execute on function public.login_challenge_peek(text, uuid, text) to anon, authenticated;

-- ── revoke a device (account UI) ─────────────────────────────────────────────
-- Invoker rights would need an UPDATE policy; instead this SECURITY DEFINER
-- function pins the user to auth.uid() so a caller can only ever revoke their
-- OWN device, and returns whether a row was actually touched.
create or replace function public.trusted_device_revoke(p_device_id uuid)
returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_hit integer;
begin
  if v_uid is null then return false; end if;
  update public.user_trusted_devices
     set revoked_at = now()
   where id = p_device_id and user_id = v_uid and revoked_at is null;
  get diagnostics v_hit = row_count;
  if v_hit > 0 then
    insert into public.security_login_events (user_id, event_type, device_id, reason)
    values (v_uid, 'device_revoked', p_device_id, 'user_revoked');
  end if;
  return v_hit > 0;
end;
$$;

revoke execute on function public.login_challenge_open(text, uuid, text, text, text, text, text, integer, integer) from public;
revoke execute on function public.login_challenge_verify(text, uuid, text, text, text, text) from public;
grant execute on function public.login_challenge_open(text, uuid, text, text, text, text, text, integer, integer) to anon, authenticated;
grant execute on function public.login_challenge_verify(text, uuid, text, text, text, text) to anon, authenticated;
grant execute on function public.login_security_check(text, text, boolean, boolean, integer) to authenticated;
grant execute on function public.trusted_device_revoke(uuid) to authenticated;
