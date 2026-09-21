-- ============================================================================
-- 0112 — LOGIN SECURITY: close the door 0111 replaced.
--
-- SEPARATE FROM 0111 ON PURPOSE, AND APPLIED AFTER THE DEPLOY.
--
-- 0111 added login_challenge_start, which refuses to mint a second code while
-- one is still alive. login_challenge_open — the function it replaces — opens
-- one unconditionally, so as long as anybody may call it there are two ways to
-- get a code and only one of them obeys the rule. That is the kind of leftover
-- that quietly makes a control untrue a year later.
--
-- It could not be revoked in 0111 because a migration lands BEFORE the code
-- that needs it. At that moment production is still calling the old function;
-- revoking it there would break every step-up for the length of a build, and a
-- login outage is not an acceptable price for tidiness.
--
--   0111  →  deploy the code that calls login_challenge_start  →  0112
--
-- Run this only once the deployment is live. If it is ever applied early, the
-- symptom is loud (the step-up reports an error and issues nothing) rather
-- than silent, which is the right way round for an auth control.
--
-- The function itself is KEPT, not dropped: 0057/0059 stay readable, and a
-- request still in flight during the switch fails on a permission check
-- instead of quietly opening a second code.
-- ============================================================================

revoke execute on function public.login_challenge_open(
  text, uuid, text, text, text, text, text, integer, integer
) from anon, authenticated;

comment on function public.login_challenge_open(text, uuid, text, text, text, text, text, integer, integer) is
  'SUPERSEDED by login_challenge_start (0111) and revoked in 0112. It opens a '
  'challenge unconditionally and would bypass the one-live-code rule.';
