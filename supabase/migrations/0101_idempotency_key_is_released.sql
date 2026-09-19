-- AN IDEMPOTENCY KEY GUARDS A RUN IN FLIGHT, NOT A RUN THAT ENDED.
--
-- APPLY THIS ONE AFTER THE APPLICATION DEPLOY. 0100 only adds a function, so
-- it is safe to apply while the old build is live. This file removes the
-- policy the old build writes through, so applying it early breaks every paid
-- run until the new build lands. Order: 0100 → deploy → 0101.
--
-- ── THE GAP BETWEEN THOSE TWO STEPS IS NOT EMPTY ───────────────────────────
--
-- Apply this PROMPTLY after the deploy, not at the next convenient moment,
-- and know what the interval costs. The new build derives the generation key
-- from the request instead of from the job row, and until this file lands a
-- COMPLETED run still carries that key. So inside the window: a seller who
-- presses "Generuj" twice with identical settings, or "Ponów" on the same
-- photo, is told the run is already in progress — about a run that finished.
--
-- It is bounded and self-healing: at most the five-minute bucket in the
-- derived key, only for a byte-identical re-submit, and gone the moment this
-- migration is applied. Nothing is charged twice and nothing is lost. It is
-- written down here because an operator watching the deploy should recognise
-- it as the known cost of the ordering rather than as a new defect.
--
-- ── 1. The key is released when the run ends ────────────────────────────────
--
-- THE DEFECT THIS FIXES, which 0100 introduced. `usage_event_start` refuses a
-- second request carrying a key that already exists, and that is right while
-- the first request is still running: it is what stops a double submit being
-- charged twice or run twice. But the row keeps the key after the run is over,
-- so the refusal outlived the thing it was protecting:
--
--   * the tool panel ships a "Ponów nieudane" button whose entire job is to
--     re-send exactly the same bytes and settings after a provider error. The
--     failed event still held the key, so every retry was refused instantly —
--     and `duplicate_request` is not a translated error, so the customer was
--     told "Nie udało się przetworzyć" about a run the server declined to
--     start.
--   * re-running the same photo with the same settings later was refused for
--     the same reason.
--
-- Freeing the key on the terminal states makes the guard mean what it says:
-- one submit, one charge, one run — and a finished run is finished. A second
-- identical request is then a NEW run, charged like one, which is the honest
-- answer once the first has delivered or been refunded.
--
-- `idempotency_key` is nullable and its unique index ignores NULLs, so any
-- number of closed events can sit there with no key at all.
--
-- WHAT STILL BLOCKS. An event that is `pending` keeps its key, because a
-- request really is in flight. If a run dies without reaching either RPC — the
-- route is killed at its 120 s ceiling, or the response to
-- `usage_event_start` is lost — the row stays `pending` and holds the key.
-- app/api/tools/run/route.ts bounds that by putting a five-minute window in
-- the derived key, so an orphan blocks its own input for at most one window
-- rather than forever. Reconciling stale `pending` events is a scheduled job
-- this codebase does not have yet, and it is recorded as such rather than
-- half-built here.

create or replace function public.usage_event_complete(
  p_token text,
  p_event_id uuid,
  p_result_count integer,
  p_api_cost_usd_micros bigint default 0,
  p_request_id text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ws uuid;
begin
  -- Gated as well, and not only for tidiness: p_api_cost_usd_micros is what the
  -- margin and economics views are computed from. Left open, a customer could
  -- write an arbitrary provider cost onto their own event and make the
  -- profitability reporting say whatever they wanted.
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  select workspace_id into v_ws from public.usage_events where id = p_event_id;
  if v_ws is null or not public.is_workspace_member(v_ws) then
    raise exception 'not_authorized';
  end if;
  update public.usage_events
    set status = 'succeeded',
        result_count = greatest(0, coalesce(p_result_count, 0)),
        actual_api_cost_usd_micros = greatest(0, coalesce(p_api_cost_usd_micros, 0)),
        provider_request_id = left(p_request_id, 200),
        -- The run is over; the key has nothing left to protect. Releasing it
        -- here is what lets a seller run the same tool on the same photo again.
        idempotency_key = null,
        finished_at = now()
    where id = p_event_id and status = 'pending';
end $$;

create or replace function public.usage_event_fail(
  p_token text,
  p_event_id uuid,
  p_error text,
  p_api_cost_usd_micros bigint default 0
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_event record;
  v_wallet uuid;
  v_tx uuid;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  select id, workspace_id, credits_charged, status, refund_tx_id, credit_tx_id
    into v_event from public.usage_events where id = p_event_id for update;
  if v_event.id is null or not public.is_workspace_member(v_event.workspace_id) then
    raise exception 'not_authorized';
  end if;
  if v_event.status = 'pending' then
    update public.usage_events
      set status = 'failed', error = left(coalesce(p_error, 'error'), 200),
          finished_at = now(),
          actual_api_cost_usd_micros = greatest(0, coalesce(p_api_cost_usd_micros, 0)),
          -- Released here for the same reason, and this is the case that
          -- matters most: retrying a failed run is a thing the UI offers.
          idempotency_key = null
      where id = p_event_id;
    v_event.status := 'failed';
  end if;
  -- Idempotent: a second call, a succeeded event, or an already-refunded event
  -- all fall out here without touching the ledger. Unchanged.
  if v_event.status <> 'failed' or v_event.refund_tx_id is not null or v_event.credits_charged <= 0 then
    return null;
  end if;
  -- 0099: credits_charged is the PRICE of the event; credit_tx_id is the
  -- RECEIPT. Nothing was charged here, so nothing is returned, and the quoted
  -- price is cleared off the row so no reporting path reads it as revenue.
  if v_event.credit_tx_id is null then
    update public.usage_events
       set credits_charged = 0,
           api_cost_usd_micros_snapshot = 0,
           sale_value_cents_snapshot = 0,
           actual_api_cost_usd_micros = 0
     where id = p_event_id;
    return null;
  end if;
  select id into v_wallet from public.credit_wallets where workspace_id = v_event.workspace_id;
  v_tx := public.apply_credit_transaction(
    v_wallet, v_event.credits_charged, 'refund', 'Refund: generation failed',
    p_event_id, jsonb_build_object('reason', left(coalesce(p_error, 'error'), 100)), auth.uid());
  update public.usage_events set status = 'refunded', refund_tx_id = v_tx where id = p_event_id;
  return v_tx;
end $$;

comment on function public.usage_event_complete(text, uuid, integer, bigint, text) is
  'Closes a usage event as succeeded and records the real provider cost. Releases the idempotency key: the run is over, so an identical later request is a new run. Server-token gated.';

-- ── 2. The customer-writable path, closed ───────────────────────────────────
--
-- Reads stay exactly as they were: usage_events_member_read (own workspace or
-- admin) and usage_events_admin_update are untouched. Only the ability to
-- CREATE a billing record goes away, and usage_event_start (0100) replaces it.
--
-- The table-level grant goes too. Dropping the policy is what actually stops
-- the insert — with RLS on and no permissive policy, nothing gets through —
-- but leaving `INSERT` granted means a future policy written for some other
-- purpose could quietly re-open the ledger. Revoking the privilege makes that
-- take two mistakes instead of one. SELECT is left exactly as it is.
drop policy if exists usage_events_member_insert on public.usage_events;
revoke insert on table public.usage_events from anon, authenticated;
