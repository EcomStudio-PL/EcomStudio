-- ONE ROUND TRIP FOR AN INTEGRATION'S SECRETS.
--
-- An integration owns more than one credential — the mailbox has an IMAP
-- password and an SMTP password — and reading them one at a time is one network
-- round trip each, on paths where that is not free: the signup form checks the
-- captcha secret, every login attempt may need the SMTP password to send a
-- security code, and the waitlist confirmation goes out inside a visitor's
-- request. Three calls where one would do is latency the visitor pays for.
--
-- Same gate as secret_read, for the same two callers, checked ONCE for the
-- whole batch rather than per name: an admin session, or the proof-of-server
-- token used by the unattended paths. Nothing is returned for a name that has
-- no secret, so the caller cannot distinguish "not stored" from "not allowed"
-- by the shape of the answer any more than they can with secret_read.
--
-- The plaintext this returns is used to open an SMTP session or sign a provider
-- request. It is never serialised into a response and never reaches a browser,
-- which holds neither an admin session's privileges nor the token.

create or replace function public.secret_read_many(p_names text[], p_token text default null)
returns table(name text, value text)
language plpgsql
stable
security definer
set search_path = public, vault, extensions
as $$
begin
  if not (public.is_admin() or public.server_call_ok(p_token)) then
    raise exception 'forbidden';
  end if;
  -- An empty or null array is a legitimate "nothing to fetch", not an error:
  -- an integration with no secrets still calls this.
  if p_names is null or array_length(p_names, 1) is null then
    return;
  end if;
  -- Capped so a caller cannot turn this into a bulk export of the vault. No
  -- integration owns anywhere near this many credentials.
  if array_length(p_names, 1) > 32 then
    raise exception 'too_many_names';
  end if;

  return query
    select s.name, s.decrypted_secret
      from vault.decrypted_secrets s
     where s.name = any(p_names);
end $$;

revoke all on function public.secret_read_many(text[], text) from public;
grant execute on function public.secret_read_many(text[], text) to anon, authenticated;

comment on function public.secret_read_many(text[], text) is
  'Batched secret_read: every credential an integration owns in one round trip, for the request paths where latency is a visitor waiting. Same gate - admin session, or the proof-of-server token. Never reachable from a browser.';
