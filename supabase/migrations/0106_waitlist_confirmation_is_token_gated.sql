-- JOINING A WAITING LIST SHOULD NOT ANSWER WITH THE MAILBOX.
--
-- ORDERING: this one is NOT safe before the application deploy. It changes
-- what `waitlist_subscribe` returns, and the currently deployed route reads
-- the `mail` object out of that answer. Apply it AFTER the deploy that teaches
-- the route to ask for the payload separately:
--   0100 + 0104 → APP DEPLOY → 0101 → 0102 → 0103 → 0105 → 0106.
-- Applied early, the confirmation mail silently stops being sent (the signup
-- itself still succeeds); deployed early, the route asks for a payload the
-- database does not have yet and falls back to the same silence. Neither loses
-- a signup, but only one order sends the mail throughout.
--
-- THE DEFECT (P1-04 / P1-18). `waitlist_subscribe` is granted to `anon` —
-- correctly, a visitor has to be able to join. When the confirmation mail is
-- switched on it also returned the mailbox's full identity and the sealed SMTP
-- password: host, port, user, encryption, ciphertext, iv, auth tag. The route
-- only reads that server-side, but the GRANT defines the exposure, not the
-- caller. One function was doing a public write and a secret read.
--
-- THE FIX is the split 0079/0080 already made for `secret_read`: the anon half
-- says WHAT HAPPENED, and the payload half is behind the proof-of-server
-- token. Whether to send is still decided inside the security boundary — the
-- visitor cannot ask for a confirmation that the admin has switched off.
--
-- The subscribe body below is the deployed definition, read back with
-- pg_get_functiondef before this was written, with exactly one change: the
-- final return. Every validation, the insert, the newsletter upsert and its
-- deliberate placement before the 'exists' return are untouched.

create or replace function public.waitlist_subscribe(
  p_email text,
  p_source text default 'landing'::text,
  p_locale text default 'pl'::text,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_source text := left(coalesce(nullif(btrim(p_source), ''), 'landing'), 40);
  v_locale text := left(coalesce(nullif(btrim(p_locale), ''), 'pl'), 8);
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_first text := nullif(left(btrim(coalesce(v_meta->>'first_name', '')), 80), '');
  v_last text := nullif(left(btrim(coalesce(v_meta->>'last_name', '')), 80), '');
  v_phone text := nullif(left(btrim(coalesce(v_meta->>'phone', '')), 32), '');
  v_consent boolean := coalesce((v_meta->>'consent')::boolean, false);
  v_rows int := 0;
  v_cfg record;
begin
  if v_email !~ '^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$' or length(v_email) > 254 then
    return jsonb_build_object('status', 'invalid');
  end if;

  insert into public.waitlist_subscribers (email, source, locale, metadata, first_name, last_name, phone)
  values (v_email, v_source, v_locale, v_meta, v_first, v_last, v_phone)
  on conflict (lower(email)) do nothing;
  get diagnostics v_rows = row_count;

  -- THE NEWSLETTER LEARNS ABOUT EVERY SIGNUP, new or repeated. Before the
  -- 'exists' return on purpose, and wrapped so a fault here can never cost the
  -- signup that already succeeded on the line above.
  begin
    perform public.newsletter_upsert_contact(
      p_email := v_email,
      p_source_key := 'waitlist',
      p_first_name := v_first,
      p_last_name := v_last,
      p_locale := left(v_locale, 2),
      p_consent := v_consent,
      p_consent_source := 'waitlist',
      p_consent_version := coalesce(v_meta->>'consent_version', 'v1')
    );
  exception when others then
    raise notice 'newsletter contact upsert failed for waitlist signup: %', sqlerrm;
  end;

  if v_rows = 0 then
    return jsonb_build_object('status', 'exists');
  end if;

  -- A BOOLEAN, NOT A MAILBOX. Whether to send is still decided in here, where
  -- the visitor cannot influence it; what to send it THROUGH is a second call
  -- that has to prove it is the server.
  select * into v_cfg from public.email_settings where id limit 1;
  return jsonb_build_object(
    'status', 'created',
    'confirmation', coalesce(found and v_cfg.confirmation_enabled, false)
  );
end
$function$;

revoke all on function public.waitlist_subscribe(text, text, text, jsonb) from public;
grant execute on function public.waitlist_subscribe(text, text, text, jsonb) to anon, authenticated;

-- ── The payload, for the server only ────────────────────────────────────────
create or replace function public.waitlist_confirmation_payload(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_cfg record;
begin
  -- The same gate the rest of the credential reads use (0077/0079/0080), plus
  -- an admin, so the settings screen can still show what it is configured
  -- with. A visitor has neither.
  if not (public.is_admin() or public.server_call_ok(p_token)) then
    raise exception 'forbidden';
  end if;
  select * into v_cfg from public.email_settings where id limit 1;
  if not found or not v_cfg.confirmation_enabled then
    return null;
  end if;
  return jsonb_build_object(
    'from_name', v_cfg.from_name,
    'from_email', v_cfg.from_email,
    'reply_to', v_cfg.reply_to,
    'subject', v_cfg.confirmation_subject,
    'body', v_cfg.confirmation_body,
    'smtp', jsonb_build_object(
      'host', v_cfg.smtp_host,
      'port', v_cfg.smtp_port,
      'user', v_cfg.smtp_user,
      'encryption', v_cfg.smtp_encryption,
      'ciphertext', v_cfg.smtp_secret_ciphertext,
      'iv', v_cfg.smtp_secret_iv,
      'auth_tag', v_cfg.smtp_secret_auth_tag
    )
  );
end
$function$;

-- ANON IS ON THIS GRANT ON PURPOSE, and leaving it off was a real bug.
--
-- The instinct is that a function holding an SMTP password must not be
-- granted to `anon`. But EXECUTE is not the gate here — `server_call_ok()`
-- inside the body is, and PostgreSQL checks EXECUTE *before* the definer body
-- runs, so a missing grant means the gate is never even reached.
--
-- And the only caller is anonymous by definition: a visitor joining a waiting
-- list has no session, so the route's request runs as `anon`. Granted only to
-- `authenticated`, the route got "permission denied", read the answer as "no
-- confirmation configured", and every confirmation mail silently stopped —
-- the signup still succeeding, so nothing looked wrong.
--
-- Migration 0079 exists because this exact mistake was made once before, with
-- `secret_read`. Same resolution, same reason: the token is the gate, the
-- grant is only what lets the server's own client reach the door.
revoke all on function public.waitlist_confirmation_payload(text) from public;
grant execute on function public.waitlist_confirmation_payload(text) to anon, authenticated;

comment on function public.waitlist_subscribe(text, text, text, jsonb) is
  'Joins the waiting list. Anon-callable by design. Answers with a status and whether a confirmation is due — never with the mailbox it would be sent through.';
comment on function public.waitlist_confirmation_payload(text) is
  'The confirmation mailbox and its sealed password. Server-token gated (or an admin); split out of waitlist_subscribe, which anon can call.';

-- ROLLBACK: restore the 0097 body of waitlist_subscribe and
--   drop function if exists public.waitlist_confirmation_payload(text);
