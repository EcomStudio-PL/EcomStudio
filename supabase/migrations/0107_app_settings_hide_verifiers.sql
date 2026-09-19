-- THREE SETTINGS ROWS STOP BEING WORLD-READABLE.
--
-- ORDERING: additive in effect and safe at any point, but it belongs AFTER the
-- application deploy that adds the two guards described below — without them
-- two code paths log an error on every auth mail and every step-up. Nothing
-- breaks either way; it is a matter of noise.
--   0100 + 0104 → APP DEPLOY → 0101 → 0102 → 0103 → 0105 → 0106 → 0107.
--
-- THE DEFECT (P1-22). Migration 0008 made every `app_settings` row readable by
-- everyone, which was proportionate when the rows were the app's name and the
-- welcome-credit count. They now also include two sha256 verifiers, the
-- address of an internal hook and a per-IP signup cap.
--
-- WHAT THIS IS AND IS NOT. The audit first read the dispatch verifier as
-- offline-breakable; it is not, and that correction matters. The token is at
-- least 32 random characters, so recovering it from its sha256 is a preimage
-- attack on a 256-bit value. What remains true is that publishing a verifier
-- buys an attacker a free oracle for guesses and costs us nothing to withhold.
--
-- WHY A DENYLIST AND NOT AN ALLOWLIST. An allowlist is the tidier shape and it
-- was the first design. It also silently changes what every OTHER key can do:
-- RLS hides rows without an error, so a key nobody thought to list turns into
-- a feature that quietly reads its defaults — on the landing page, in the tool
-- catalogue, in the generator's own configuration. That is a visible
-- regression traded for a hardening with no measured exposure. Naming the
-- three rows that must not be public cannot do that: every other read behaves
-- exactly as it does today, which is the property this stage is being held to.
--
-- Each of the three is already read where it is needed:
--   notifications.dispatch_hash        → server_call_ok(), SECURITY DEFINER,
--                                        reads it as the owner
--   login_security_dispatch.hash       → the 0057 challenge functions, same
--   auth_email_hook                    → lib/server/auth-hook-secret.ts, and
--                                        the admin screen that configures it
-- and admins keep reading all of them: settings_admin_write is FOR ALL with
-- USING (is_admin()), which covers SELECT.
--
-- WHAT THIS COSTS THE TWO hash-PUBLISHING PATHS, measured rather than assumed.
-- `ensureDispatchHash` and `ensureLoginSecurityHash` run on a customer's own
-- session. After this migration their SELECT returns NO ROW — RLS hides it
-- silently — so they go on to upsert, and that upsert is refused with SQLSTATE
-- 42501 (verified on PostgreSQL 16 against these exact policies; it is 42501
-- and not a unique violation, and the stored value is left untouched). Both
-- callers already silence exactly that code and report anything else. The cost
-- is one wasted round trip; nothing breaks and nothing is logged.
--
-- THE ONE LATENT TRAP, stated because it is invisible otherwise. `activeSecret`
-- in lib/server/auth-hook-secret.ts resolves env → vault → a PRE-MIGRATION AES
-- envelope stored in this `auth_email_hook` row. The hook endpoint has no
-- session, so after this migration it can no longer read that third fallback.
-- On this deployment that does not matter — production's row carries only
-- timestamps and the hook URI, with no `ciphertext`, so the live path is the
-- vault (checked read-only before writing this). A deployment that never
-- regenerated its hook secret would lose verification silently, and would have
-- to regenerate it from the admin screen. Recorded rather than guarded,
-- because guarding it would mean keeping the row readable, which is the whole
-- point of this file.

create or replace function public.app_setting_is_private(p_key text)
returns boolean
language sql
immutable
parallel safe
as $$
  select p_key in (
    'notifications',           -- carries dispatch_hash, the server-token verifier
    'login_security_dispatch', -- carries hash, the step-up token verifier
    'auth_email_hook'          -- the internal hook address and its rotation state
  );
$$;

comment on function public.app_setting_is_private(text) is
  'Settings rows that no client may read: token verifiers and internal endpoints. Everything else stays readable exactly as before. Admins are unaffected (settings_admin_write is FOR ALL).';

drop policy if exists "settings_select_all" on public.app_settings;

create policy "settings_select_public" on public.app_settings
  for select
  using (not public.app_setting_is_private(key));

-- ROLLBACK:
--   drop policy "settings_select_public" on public.app_settings;
--   create policy "settings_select_all" on public.app_settings for select using (true);
--   drop function if exists public.app_setting_is_private(text);
