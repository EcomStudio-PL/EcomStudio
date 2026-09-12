-- THE UNATTENDED PATHS RUN AS `anon`, AND 0078 LOCKED THEM OUT.
--
-- GrovBase's server talks to Postgres with the same publishable key the browser
-- holds. For a request with no signed-in user — a visitor joining the waitlist,
-- Supabase calling the Send Email Hook — the role is `anon`, not
-- `authenticated`. Migration 0078 granted EXECUTE on secret_read to
-- `authenticated` only, so every one of those paths would have failed with
-- "permission denied for function secret_read" the moment it reached for the
-- SMTP password. Silently, on a best-effort mail path, which is the worst place
-- for a permission error to hide.
--
-- The five SECURITY DEFINER functions that already serve those same paths —
-- integration_dispatch_read, message_template_lookup, mail_sync_context,
-- notification_dispatch_claim, waitlist_subscribe — all grant `anon` for
-- exactly this reason. This brings secret_read in line with them.
--
-- WHY THIS GIVES NOTHING AWAY. The grant lets a role REACH the function; it
-- does not decide what the function does. secret_read's first statement is
--
--     if not (public.is_admin() or public.server_call_ok(p_token)) then
--       raise exception 'forbidden';
--
-- An anonymous caller is not an admin, and server_call_ok compares
-- sha256(p_token) against a hash in app_settings that only the server can
-- produce a preimage for. So an anon caller with no token, or a wrong one, gets
-- `forbidden` — the same answer they got before, reached one step later.
--
-- WRITING STAYS ADMIN-ONLY. secret_put, secret_clear and secret_status are
-- deliberately NOT granted here. Nothing unattended has any business storing,
-- deleting or enumerating a credential; those are operator actions and they
-- keep needing an operator's session.

grant execute on function public.secret_read(text, text) to anon;

comment on function public.secret_read(text, text) is
  'The only function returning secret plaintext. Reachable by anon and authenticated so the unattended paths (waitlist mail, auth hook, captcha, provider calls) can call it at all; authorised inside by is_admin() OR the proof-of-server token. Never reachable from a browser, which holds neither.';
