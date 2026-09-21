-- ============================================================================
-- 0111 — LOGIN SECURITY: a new code cannot be asked for while one is alive.
--
-- THE PRODUCT DECISION THIS REPLACES.
--   Until now the screen showed two clocks that disagreed on purpose:
--     "Kod wygaśnie za 01:54"        ← code_ttl_seconds, 120 s
--     "Wyślij kod ponownie za 00:53" ← resend_seconds,    59 s
--   so from 00:59 onwards a person could ask for a second code while the
--   first was still valid. Every such request is an e-mail we send, an OTP we
--   mint, and a second chance at the same account for whoever is guessing.
--
--   The new rule is one clock: THE CODE LIVES 120 SECONDS AND A REPLACEMENT
--   CAN ONLY BE ASKED FOR ONCE IT HAS EXPIRED. `resend_seconds` stops being a
--   separate knob, because the answer is now derived from expires_at.
--
-- WHY THIS NEEDS THE DATABASE AND NOT JUST A DISABLED BUTTON.
--   A disabled button is a rendering. The server has to be the one that
--   refuses, and it has to refuse ATOMICALLY: two taps that arrive together
--   would both read "no live challenge", both insert, and both send mail.
--   login_challenge_open cannot express the refusal — it returns a uuid, and
--   null already means "bad token" — so the decision moves inside a function
--   that takes a per-(user, device) advisory lock and answers with a status.
--
--   The lock is transaction-scoped and every PostgREST call is its own
--   transaction, so it is released when the call ends, including on error.
--
-- WHAT DOES NOT CHANGE: the token gate, the TTL setting, max_attempts, the
-- trusted-device model, the risk policy read inside login_security_check
-- (0104 — P1-17), and who may execute what.
-- ============================================================================

-- ── open a challenge, but only if none is alive ──────────────────────────────
create or replace function public.login_challenge_start(
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
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_live public.login_security_challenges%rowtype;
  v_id   uuid;
  v_ttl  integer := greatest(30, coalesce(p_ttl_seconds, 120));
begin
  if not public.login_security_token_ok(p_token) then
    return jsonb_build_object('status', 'forbidden');
  end if;

  -- SERIALISE PER (user, device). Two taps a few milliseconds apart must not
  -- both find an empty table and both send an e-mail. Whoever gets here second
  -- waits, then sees the row the first one wrote and is refused.
  perform pg_advisory_xact_lock(
    hashtextextended(p_user::text || ':' || coalesce(p_device_hash, ''), 0)
  );

  select * into v_live
    from public.login_security_challenges
   where user_id = p_user
     and device_hash = p_device_hash
     and used_at is null
     and expires_at > now()
   order by created_at desc
   limit 1;

  if found then
    -- REFUSED, and the caller is told exactly how long it has to wait: the
    -- live row's own remaining lifetime, not a window computed elsewhere.
    return jsonb_build_object(
      'status', 'live',
      'expires_in_seconds',
      greatest(0, floor(extract(epoch from (v_live.expires_at - now())))::int)
    );
  end if;

  insert into public.login_security_challenges
    (user_id, device_hash, code_hash, ip_hash, device_label, reason,
     max_attempts, expires_at)
  values
    (p_user, p_device_hash, p_code_hash, nullif(p_ip_hash, ''),
     coalesce(p_device_label, ''), coalesce(nullif(p_reason, ''), 'new_device'),
     greatest(1, coalesce(p_max_attempts, 5)),
     now() + make_interval(secs => v_ttl))
  returning id into v_id;

  insert into public.security_login_events
    (user_id, event_type, ip_hash, device_summary, reason)
  values
    (p_user, 'verification_required', nullif(p_ip_hash, ''),
     coalesce(p_device_label, ''), coalesce(nullif(p_reason, ''), 'new_device'));

  return jsonb_build_object('status', 'opened', 'id', v_id, 'expires_in_seconds', v_ttl);
end;
$$;

comment on function public.login_challenge_start(text, uuid, text, text, text, text, text, integer, integer) is
  'Opens a login challenge unless one is still live for this (user, device). '
  'Returns {status: opened|live|forbidden}. Serialised by a transaction-scoped '
  'advisory lock so concurrent taps cannot both send a code.';

-- ── release a challenge whose code never left the building ───────────────────
-- WHY THIS EXISTS. With "one live code at a time", a challenge that is opened
-- but whose e-mail then fails to send would strand the person for the full
-- TTL: they hold a code nobody sent them and may not ask for another. That
-- turns a momentary SMTP hiccup into a two-minute lockout.
--
-- So the sender spends the row it just opened when delivery fails, and the
-- resend button is immediately available again. It can only ever touch a row
-- it names, belonging to that user and device, that is still live — it is a
-- compensating action for a failed send, not a way to clear someone's code.
create or replace function public.login_challenge_abandon(
  p_token text, p_user uuid, p_device_hash text, p_id uuid
)
returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare v_hit integer;
begin
  if not public.login_security_token_ok(p_token) then return false; end if;
  update public.login_security_challenges
     set used_at = now()
   where id = p_id
     and user_id = p_user
     and device_hash = p_device_hash
     and used_at is null
     and expires_at > now();
  get diagnostics v_hit = row_count;
  return v_hit > 0;
end;
$$;

comment on function public.login_challenge_abandon(text, uuid, text, uuid) is
  'Spends a just-opened challenge whose e-mail could not be delivered, so a '
  'failed send does not lock the user out for the remaining TTL.';

revoke execute on function public.login_challenge_start(text, uuid, text, text, text, text, text, integer, integer) from public;
revoke execute on function public.login_challenge_abandon(text, uuid, text, uuid) from public;
grant  execute on function public.login_challenge_start(text, uuid, text, text, text, text, text, integer, integer) to anon, authenticated;
grant  execute on function public.login_challenge_abandon(text, uuid, text, uuid) to anon, authenticated;

-- ── login_challenge_open IS NOT REVOKED HERE, AND THAT IS DELIBERATE ─────────
--
-- It must be, eventually: leaving a second way to mint a code that does not
-- honour the rule above is exactly the forgotten back door that makes a
-- control untrue later. But the code running in production AT THE MOMENT THIS
-- MIGRATION IS APPLIED still calls it, and a migration always lands before the
-- deployment that needs it. Revoking here would mean that for the length of a
-- build — minutes — every step-up fails and nobody can finish signing in.
--
-- A login outage is not an acceptable price for tidiness, so the revoke is
-- migration 0112, applied AFTER the new code is serving. The order is:
--
--   0111  →  deploy  →  0112
--
-- Between 0111 and 0112 both functions exist and both are callable; only the
-- old code calls the old one, and it is on its way out.
comment on function public.login_challenge_open(text, uuid, text, text, text, text, text, integer, integer) is
  'SUPERSEDED by login_challenge_start (0111): this one opens a challenge '
  'unconditionally and bypasses the one-live-code rule. Execute is revoked in '
  '0112, which is applied only after the code that calls it is no longer live.';
