-- A REFUND REQUIRES A CHARGE.
--
-- THE DEFECT. `usage_event_fail` decided whether to hand credits back by
-- reading `credits_charged` alone:
--
--     if v_event.status <> 'failed'
--        or v_event.refund_tx_id is not null
--        or v_event.credits_charged <= 0 then return null; end if;
--
-- `credits_charged` is the PRICE of the event, written when the row is created.
-- It is not evidence that anybody paid it. The debit is recorded elsewhere:
-- `usage_event_charge` stamps `credit_tx_id` onto the event in the same
-- transaction as the wallet update, so `credit_tx_id is null` means no money
-- ever moved.
--
-- lib/services/usage.ts creates the event first and charges second. When the
-- charge raises — and `insufficient_credits` is the ordinary way for it to
-- raise — the handler calls `usage_event_fail` to close the row out. That row
-- carries `credits_charged > 0` with `credit_tx_id` null, the guard above sees
-- a positive price and no prior refund, and `apply_credit_transaction` adds
-- credits to a wallet that was never debited. Every failed charge therefore
-- MINTED the price of the event. A wallet at zero calling a paid tool in a loop
-- grows without limit, and the loop needs no special access at all: running out
-- of credits is the trigger.
--
-- THE FIX. Read `credit_tx_id` — the old statement did not even SELECT the
-- column it needed — and refuse to refund without it. The original guard set is
-- left exactly as it was and the new precondition is added after it, so the
-- idempotency behaviour stays readable and unchanged.
--
-- Nothing else in either body changes. The status transition, the membership
-- check, the token gate and the amounts are all as they were.
--
-- WHAT THIS DELIBERATELY DOES NOT DO. It does not stop refunding. A real
-- charge followed by a real failure still returns the customer's credits, once,
-- exactly as before — that is the case the money path exists for, and the
-- regression suite asserts it in both directions so a later "simplification"
-- cannot quietly turn this into "never refund".
--
-- THE PRICE IS ZEROED, NOT LEFT LYING AROUND. An event that failed without
-- being charged now ends as `failed` instead of `refunded`, and that change of
-- status has a second-order effect: several reporting paths count
-- `credits_charged` for everything that is not `refunded`
-- (lib/services/ai-economics.ts, lib/services/usage.ts). Left alone, the fix
-- would silently inflate reported credits, revenue and provider cost with the
-- quoted price of generations that never ran. So the declining branch writes
-- the truth onto the row: no credits, no cost, no sale value. The row remains
-- as the record that the attempt happened and why.
--
-- VERIFIED AGAINST PRODUCTION BEFORE SHIPPING (read-only). Exactly one event
-- has `credit_tx_id is null` with a refund: a4be8cd2, 2026-08-12. Its wallet
-- debit and matching refund are both present in `credit_transactions`, so the
-- charge was real and only the link is missing — a row written before
-- `usage_event_charge` started stamping `credit_tx_id`. No credits were ever
-- minted on PROD by this defect. The only live rows the new precondition can
-- reach are two `pending` events with `credits_charged = 0`, which the
-- pre-existing `credits_charged <= 0` guard already declines. No legitimate
-- refund is blocked by this migration, and no backfill is needed.
--
-- FAILING CLOSED ON THE FK. `usage_events.credit_tx_id` is
-- `on delete set null`, so purging a `credit_transactions` row would blank the
-- link and block a refund that might otherwise be owed. That is the safe
-- direction — an operator can see the event and issue an adjustment, whereas
-- minting credits is silent and unbounded.
--
-- `usage_event_refund_partial` carries the same shape of guard and the same
-- gap; it is fixed here too rather than left as the next instance of this bug.
-- Its caller (lib/server/generation.ts, short delivery on a completed batch)
-- only ever runs on an event that was charged, so the new precondition changes
-- nothing for it.
--
-- No schema change, no RLS change, no grant change. Function bodies only.

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
          actual_api_cost_usd_micros = greatest(0, coalesce(p_api_cost_usd_micros, 0))
      where id = p_event_id;
    v_event.status := 'failed';
  end if;
  -- Idempotent: a second call, a succeeded event, or an already-refunded event
  -- all fall out here without touching the ledger. Unchanged.
  if v_event.status <> 'failed' or v_event.refund_tx_id is not null or v_event.credits_charged <= 0 then
    return null;
  end if;
  -- THE FIX. credits_charged is the PRICE of the event; credit_tx_id is the
  -- RECEIPT. Refunding on the price alone handed back money that was never
  -- taken. Nothing was charged here, so nothing is returned — and the quoted
  -- price is cleared off the row so no reporting path reads it as revenue,
  -- cost or credits spent. Reaching this branch a second time is impossible:
  -- credits_charged is now 0 and the guard above declines first.
  if v_event.credit_tx_id is null then
    update public.usage_events
       set credits_charged = 0,
           api_cost_usd_micros_snapshot = 0,
           sale_value_cents_snapshot = 0
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

create or replace function public.usage_event_refund_partial(
  p_token text,
  p_event_id uuid,
  p_amount integer
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_event record;
  v_wallet uuid;
  v_tx uuid;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  select id, workspace_id, credits_charged, status, refund_tx_id, metadata, credit_tx_id
    into v_event from public.usage_events where id = p_event_id for update;
  if v_event.id is null or not public.is_workspace_member(v_event.workspace_id) then
    raise exception 'not_authorized';
  end if;
  -- The original guard set, plus the same receipt check: still pending, not
  -- already fully refunded, not already partially refunded, a strictly partial
  -- amount — and an event that was actually charged.
  if v_event.status <> 'pending'
     or v_event.refund_tx_id is not null
     or coalesce((v_event.metadata->>'partial_refund_tx') is not null, false)
     or v_event.credit_tx_id is null
     or p_amount is null or p_amount <= 0 or p_amount >= v_event.credits_charged then
    return null;
  end if;
  select id into v_wallet from public.credit_wallets where workspace_id = v_event.workspace_id;
  v_tx := public.apply_credit_transaction(
    v_wallet, p_amount, 'refund', 'Refund: partial delivery',
    p_event_id, jsonb_build_object('reason', 'partial_delivery', 'amount', p_amount), auth.uid());
  update public.usage_events
     set credits_charged = credits_charged - p_amount,
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('partial_refund_tx', v_tx)
   where id = p_event_id;
  return v_tx;
end $$;

comment on function public.usage_event_fail(text, uuid, text, bigint) is
  'Marks a usage event failed and refunds its charge exactly once. Refunds only when credit_tx_id is present: credits_charged is the price, credit_tx_id is proof the wallet was debited. Server-token gated.';

comment on function public.usage_event_refund_partial(text, uuid, integer) is
  'Returns the undelivered share of a charged event, once. Requires credit_tx_id — an uncharged event has nothing to return. Server-token gated.';
