-- ============================================================================
-- 0065 — THE CAPTCHA GETS A REAL SWITCH
--
-- `captcha_site_key()` answered with the site key whenever BOTH halves were
-- stored, and ignored `integration_settings.enabled` entirely. That column has
-- existed on this row since 0054 and meant nothing — a switch wired to
-- nothing, which is worse than no switch at all.
--
-- It means something now, and it is the ONLY authority:
--
--   enabled = true  → the site key is published → the widget renders → the
--                     server demands a token and verifies it.
--   enabled = false → no site key → no widget → the server does not demand
--                     one, because none was ever offered.
--
-- The client and the server read the SAME function, so they cannot disagree:
-- there is no version of this where a widget is hidden by CSS while the server
-- still requires a token, or where the server waves a signup through while the
-- customer was asked to solve something.
--
-- This is a diagnostic and operational control, not a way to make a problem go
-- away — with it off, registration is genuinely unprotected, and the admin
-- panel says so in those words.
--
-- The row on production is enabled = true, so applying this changes nothing
-- about today's behaviour. It only makes tomorrow's toggle real.
-- ============================================================================

create or replace function public.captcha_site_key()
returns text
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_site text;
begin
  select nullif(btrim(coalesce(config->>'site_key', '')), '')
    into v_site
    from public.integration_settings
   where type = 'captcha'
     -- BOTH halves stored, as before …
     and jsonb_typeof(secrets->'secret_key') = 'object'
     -- … AND the protection actually switched on.
     and enabled is true;

  return coalesce(v_site, '');
end;
$$;

revoke execute on function public.captcha_site_key() from public;
grant execute on function public.captcha_site_key() to anon, authenticated;
