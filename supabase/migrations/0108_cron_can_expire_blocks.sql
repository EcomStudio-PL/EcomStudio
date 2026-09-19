-- A SCHEDULED JOB CANNOT BE AN ADMIN, AND THIS ONE WAS ASKED TO BE.
--
-- ORDERING: additive. It adds one function and changes nothing that exists,
-- so it is safe before or after the application deploy — before is better,
-- because the deploy is what starts calling it.
--   0100 + 0104 + 0108 → APP DEPLOY → 0101 → 0102 → 0103 → 0105 → 0106 → 0107.
--
-- THE DEFECT (P1-05 / P1-08 / P1-29). `/api/cron/mail` is called by Vercel
-- Cron with a bearer secret and NO SESSION. From that request it called
-- `expireBlocksAction()`, whose first line is `requireAdmin()` — read the
-- session, find no user, throw `unauthenticated`. The route catches that and
-- reports `{ ok: false }`, so for the whole life of the schedule the sweep has
-- run exactly never, and has said so in a shape nobody reads as a failure.
--
-- The block itself was always enforced correctly: `account_blocked()` compares
-- `blocked_until` to now(), so an expired block stopped applying the moment it
-- expired. What never happened is the tidy-up, which is why the symptom is a
-- CRM that shows "blocked until <a date last month>" on an account that has
-- been working since.
--
-- THE FIX is the shape every other unattended path here already has: a second
-- entry point that proves it is the server instead of proving it is a person.
-- `admin_expire_account_blocks()` stays exactly as it is for the admin screen;
-- this is its sibling for the schedule. Both funnel into the same
-- `expire_account_blocks()`, so there is one sweep, not two.
--
-- WHY `is_admin() or server_call_ok()` AND NOT THE TOKEN ALONE. The same route
-- answers the admin "sync now" button. On a deployment where the server key is
-- not configured the token is null, and an admin pressing the button would
-- otherwise get a refusal for a job they are plainly allowed to run. This is
-- the 0078/0079/0080 gate, unchanged.

create or replace function public.server_expire_account_blocks(p_token text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not (public.is_admin() or public.server_call_ok(p_token)) then
    raise exception 'forbidden';
  end if;
  return public.expire_account_blocks();
end;
$$;

-- The token is the gate, so the GRANT only has to let the server's own client
-- reach the function — it calls with the publishable key and no session, which
-- is the `anon` role. Same as tool_popularity_store (0082) and secret_read
-- (0079): holding EXECUTE is not authorisation here, passing the gate is.
revoke all on function public.server_expire_account_blocks(text) from public;
grant execute on function public.server_expire_account_blocks(text) to anon, authenticated;

comment on function public.server_expire_account_blocks(text) is
  'Clears the flag on account blocks that have already expired, for the daily schedule. Proof-of-server token (or an admin); the enforcement itself never depended on this running.';

-- ROLLBACK:
--   drop function if exists public.server_expire_account_blocks(text);
