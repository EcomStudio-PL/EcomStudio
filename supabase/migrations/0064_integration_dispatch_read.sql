-- ============================================================================
-- 0064 — THE MAILBOX, READABLE BY THE CODE THAT ACTUALLY SENDS
--
-- integration_settings is admin-only, and rightly so: it holds the SMTP and
-- Turnstile credentials. But two paths that legitimately need those settings
-- run with NO session at all:
--
--   · the Supabase Send Email Hook — an unauthenticated POST from Supabase,
--     authenticated by its signature, which then has to send the mail;
--   · public signup — an anonymous visitor whose captcha token the server has
--     to verify against the Turnstile secret.
--
-- Both were silently reading NOTHING and degrading to "not configured". For
-- the hook that meant every confirmation e-mail failed, which made GoTrue fail
-- the signup, which is the "Nie udało się połączyć z serwerem" the customer
-- saw. For signup it meant the captcha was never actually verified.
--
-- The fix is the door this codebase already uses twice for exactly this
-- problem (notification_dispatch_claim, message_template_lookup): a SECURITY
-- DEFINER read gated by the dispatch token, whose sha256 lives in
-- app_settings->'notifications'->>'dispatch_hash'. The token is DERIVED from
-- the encryption key the server already holds, so no new environment variable
-- appears, and holding the anon key alone opens nothing.
--
-- What comes back is the config plus the secret ENVELOPES — ciphertext, iv and
-- auth tag. Useless without the key. The plaintext never exists in the
-- database and never crosses this boundary.
-- ============================================================================

create or replace function public.integration_dispatch_read(
  p_token text,
  p_type text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
  v_row public.integration_settings%rowtype;
begin
  select value->>'dispatch_hash' into v_hash
    from public.app_settings where key = 'notifications';
  if v_hash is null or v_hash = '' then return null; end if;
  if encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') is distinct from v_hash then
    return null;
  end if;

  select * into v_row from public.integration_settings where type = p_type;
  if not found then return null; end if;

  -- `secrets` is a bag of {c,i,t} envelopes. Handing them over is safe: the
  -- key that opens them is held by the server process, never by the database.
  return jsonb_build_object(
    'enabled', v_row.enabled,
    'config', v_row.config,
    'secrets', v_row.secrets,
    'status', v_row.status
  );
end;
$$;

revoke execute on function public.integration_dispatch_read(text, text) from public;
grant execute on function public.integration_dispatch_read(text, text) to anon, authenticated;
