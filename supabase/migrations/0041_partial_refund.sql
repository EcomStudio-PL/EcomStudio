-- ============================================================
-- 0041 — PARTIAL DELIVERY REFUND
--
-- A batch can legally deliver fewer images than were paid for (one
-- provider URL times out, one storage upload fails) while the rest
-- succeed. fail_usage_event refunds all-or-nothing, so until now the
-- customer kept paying for the missing images. This definer RPC refunds
-- exactly the undelivered share of a still-pending event, once, before
-- the event is completed.
-- ============================================================

create or replace function public.refund_usage_partial(
  p_event_id uuid,
  p_amount int
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_event record;
  v_wallet uuid;
  v_tx uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  select id, workspace_id, credits_charged, status, refund_tx_id, metadata
    into v_event from public.usage_events where id = p_event_id for update;
  if v_event.id is null or not public.is_workspace_member(v_event.workspace_id) then
    raise exception 'not_authorized';
  end if;
  -- Only a live reservation can shrink, only once, and never below zero:
  -- the amount must leave part of the charge in place (a full refund is
  -- fail_usage_event's job, with its own idempotency).
  if v_event.status <> 'pending'
     or v_event.refund_tx_id is not null
     or coalesce((v_event.metadata->>'partial_refund_tx') is not null, false)
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
end;
$$;

revoke all on function public.refund_usage_partial(uuid, int) from public, anon;
grant execute on function public.refund_usage_partial(uuid, int) to authenticated;
