-- ONE SECRET STORE FOR GROVBASE, ON SUPABASE VAULT
--
-- THE BUG THIS EXISTS TO KILL.
--
-- Every operator-managed secret — the mailbox password, the Telegram token, the
-- Turnstile key, every AI provider key — was AES-256-GCM ciphertext in an
-- ordinary table, sealed with APP_ENCRYPTION_KEY from the server environment.
-- That key is one value in one deploy payload, and when a deploy dropped it the
-- failure was not "mail stops sending". It was worse:
--
--   the admin could not even TYPE a new password.
--
-- The panel disabled the password fields, because without the key the server
-- could not encrypt what was typed. So the one action that would have fixed the
-- outage was the one action the outage prevented. A secret store whose failure
-- mode is "the owner is locked out of their own panel" is the wrong design for
-- a product whose whole promise is that it is the panel.
--
-- WHAT REPLACES IT, AND WHY THIS AND NOT SOMETHING INVENTED.
--
-- Supabase Vault (supabase_vault 0.3.1, schema `vault`) is already installed on
-- this project — verified, not assumed, along with the exact signatures used
-- below and a full write/read round trip. Secrets are encrypted at rest with a
-- key held by Supabase's own infrastructure, OUTSIDE this database, so there is
-- no master key in a table protecting the table it lives in, and no hand-rolled
-- cryptography anywhere in GrovBase.
--
-- `vault.decrypted_secrets` is readable by neither anon nor authenticated —
-- checked. The only way in is through the four functions below, which run as
-- their owner and decide for themselves who may call them.
--
-- THE ACCESS RULE, AND THE PART THAT MATTERS MOST.
--
-- WRITING a secret needs nothing but an admin session. is_admin() is the whole
-- gate. That is what makes the lock-out impossible from here on: whatever else
-- is broken, an operator who can log into GrovBase can always set a new
-- password from the panel, and it is sealed by Supabase, not by a value that
-- may or may not have survived the last deploy.
--
-- READING is split, because the two readers are genuinely different:
--   · an ADMIN reading their own mailbox — testing the connection, opening the
--     inbox, sending a message — is authorised by is_admin() and needs no
--     server credential at all;
--   · the SERVER acting for somebody who is not an admin — the waitlist
--     confirmation to an anonymous visitor, the Supabase auth hook, the captcha
--     check, a customer's generation reaching for a provider key — cannot be
--     recognised by identity, because its identity is the same anon key the
--     browser holds. That path carries the proof-of-server token this codebase
--     already uses (server_call_ok, migration 0077).
--
-- So the admin half of the product works with no environment variable at all,
-- and only the unattended half depends on one bootstrap value.

-- ── 1. Write ────────────────────────────────────────────────────────────────
-- Upsert by name. Named secrets are unique in the vault, so an existing one is
-- updated in place rather than accumulating rows that all claim to be the SMTP
-- password.
create or replace function public.secret_put(p_name text, p_value text)
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_name is null or btrim(p_name) = '' then raise exception 'invalid_name'; end if;
  -- An empty value is never a secret. Clearing one is secret_clear's job, and
  -- keeping them apart stops a blank form field from silently wiping a working
  -- credential — the single most expensive mistake this module can make.
  if p_value is null or p_value = '' then raise exception 'empty_value'; end if;

  select id into v_id from vault.secrets where name = p_name;
  if v_id is null then
    perform vault.create_secret(p_value, p_name, 'GrovBase managed secret');
  else
    perform vault.update_secret(v_id, p_value, p_name, 'GrovBase managed secret');
  end if;
end $$;

revoke all on function public.secret_put(text, text) from public, anon;
grant execute on function public.secret_put(text, text) to authenticated;

-- ── 2. Clear ────────────────────────────────────────────────────────────────
create or replace function public.secret_clear(p_name text)
returns boolean
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_hit integer;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  delete from vault.secrets where name = p_name;
  get diagnostics v_hit = row_count;
  return v_hit > 0;
end $$;

revoke all on function public.secret_clear(text) from public, anon;
grant execute on function public.secret_clear(text) to authenticated;

-- ── 3. Status — for the panel, and carrying no plaintext ────────────────────
-- The last four characters are computed HERE. The alternative — shipping the
-- secret to the browser so the browser can slice it — is how a masked field
-- ends up being a full credential in a page payload.
create or replace function public.secret_status(p_names text[])
returns table(name text, configured boolean, last_four text, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path = public, vault, extensions
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return query
    select n.n as name,
           (s.id is not null) as configured,
           case
             when s.decrypted_secret is null then null
             when length(s.decrypted_secret) <= 4 then repeat('•', length(s.decrypted_secret))
             else right(s.decrypted_secret, 4)
           end as last_four,
           s.updated_at
      from unnest(p_names) as n(n)
      left join vault.decrypted_secrets s on s.name = n.n;
end $$;

revoke all on function public.secret_status(text[]) from public, anon;
grant execute on function public.secret_status(text[]) to authenticated;

-- ── 4. Read — the only function that returns plaintext ──────────────────────
-- Two doors, both narrow. An admin reading their own integration, or the server
-- proving it is the server. Nothing else, and never the browser: the value
-- returned here is used to open an SMTP session or sign a provider request and
-- is not serialised into any response.
create or replace function public.secret_read(p_name text, p_token text default null)
returns text
language plpgsql
stable
security definer
set search_path = public, vault, extensions
as $$
declare
  v_value text;
begin
  if not (public.is_admin() or public.server_call_ok(p_token)) then
    raise exception 'forbidden';
  end if;
  select decrypted_secret into v_value from vault.decrypted_secrets where name = p_name;
  return v_value;
end $$;

revoke all on function public.secret_read(text, text) from public, anon;
grant execute on function public.secret_read(text, text) to authenticated;

comment on function public.secret_put(text, text) is
  'Store an operator-managed secret in Supabase Vault. Admin session is the only requirement - deliberately, so a lost server environment variable can never lock an operator out of their own panel again.';
comment on function public.secret_read(text, text) is
  'The only function returning secret plaintext. Admin session, or the proof-of-server token used by the unattended paths (waitlist mail, auth hook, captcha, provider calls). Never reachable from a browser.';
