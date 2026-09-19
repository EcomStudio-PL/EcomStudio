-- A FREE RUN THAT NEVER STARTED IS NOT A FREE RUN.
--
-- ORDERING: this file only ADDS a function and touches no policy, so it is
-- safe to apply at any point — before the application deploy included, where
-- it is simply inert because nothing calls it yet. Applied after 0102 to keep
-- the numbering honest: 0100 → APP DEPLOY → 0101 → 0102 → 0103.
--
-- THE DEFECT (P1-36). lib/server/image-tools.ts claims a grant from the plan's
-- free-run allowance BEFORE it opens the billing event, because the price the
-- event is opened with depends on whether the run is free. Every refusal
-- between those two points — no wallet, not enough credits, and since
-- migration 0100 also a duplicate request — therefore costs the seller one of
-- their free runs and delivers nothing.
--
-- WHY THE CLAIM IS NOT SIMPLY MOVED AFTER THE START. Deciding the price needs
-- to know whether a grant is available, and asking without taking one lets two
-- concurrent requests both see "one left" and both run free. That trades a bug
-- that costs the customer for a bug that costs the business, which is not an
-- improvement — it is the same mistake facing the other way.
--
-- WHY A FUNCTION AND NOT A DELETE POLICY. A seller who can delete their own
-- grants can reset their own allowance. This is gated by server_call_ok, the
-- same proof-of-server the ledger RPCs use, so only GrovBase's server can hand
-- a run back.

create or replace function public.release_free_tool_run(
  p_token text,
  p_workspace_id uuid,
  p_tool_slug text,
  p_window_start timestamptz
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  if not public.is_workspace_member(p_workspace_id) then raise exception 'not_authorized'; end if;

  -- Grants are fungible counters — 0075 declares them per workspace and tool
  -- with no reference to the run that took them — so handing one back means
  -- deleting exactly ONE row inside the CURRENT window. Never more: the window
  -- bound is what stops a release reaching into a previous period's allowance.
  --
  -- `for update skip locked` is what keeps two concurrent releases from
  -- selecting the same row, where one of them would delete it and the other
  -- would silently return nothing.
  select id into v_id
    from public.free_tool_grants
   where workspace_id = p_workspace_id
     and tool_slug = p_tool_slug
     and created_at >= p_window_start
   order by created_at desc
   limit 1
     for update skip locked;

  -- Nothing to return is not an error. It is what a second call looks like,
  -- and it is what a release with no matching grant looks like; both must be
  -- harmless, because this runs on the failure path where something already
  -- went wrong.
  if v_id is null then return false; end if;

  delete from public.free_tool_grants where id = v_id;
  return true;
end $$;

revoke all on function public.release_free_tool_run(text, uuid, text, timestamptz) from public, anon;
grant execute on function public.release_free_tool_run(text, uuid, text, timestamptz) to authenticated;

comment on function public.release_free_tool_run(text, uuid, text, timestamptz) is
  'Hands back ONE free-tool grant when the run it paid for was never started. Server-token gated: a client cannot reset its own allowance. Returns false when there was nothing to return, which is not an error.';

-- ROLLBACK: drop function if exists public.release_free_tool_run(text, uuid, text, timestamptz);
