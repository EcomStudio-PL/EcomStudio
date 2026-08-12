-- Usage-event lifecycle under RLS (second production E2E finding): members
-- must not get a raw UPDATE policy on usage_events (they could flip a
-- succeeded event to 'failed' and claim a refund), so completion/failure
-- transitions become SECURITY DEFINER functions with strict guards.

-- Charge now also links the ledger tx back onto the event (the previous
-- client-side update was silently blocked by RLS).
create or replace function public.charge_usage_credits(
  p_wallet_id uuid,
  p_amount int,
  p_description text,
  p_reference_id uuid,
  p_metadata jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_ws uuid;
  v_tx uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  if p_amount <= 0 or p_amount > 10000 then raise exception 'invalid_amount'; end if;
  select workspace_id into v_ws from public.credit_wallets where id = p_wallet_id;
  if v_ws is null or not public.is_workspace_member(v_ws) then
    raise exception 'not_authorized';
  end if;
  v_tx := public.apply_credit_transaction(
    p_wallet_id, -p_amount, 'generation', p_description, p_reference_id, p_metadata, auth.uid());
  update public.usage_events set credit_tx_id = v_tx where id = p_reference_id;
  return v_tx;
end;
$$;
grant execute on function public.charge_usage_credits(uuid,int,text,uuid,jsonb) to authenticated;

-- pending -> succeeded (one-way; members only for their own workspace)
create or replace function public.complete_usage_event(p_event_id uuid, p_result_count int)
returns void language plpgsql security definer set search_path = public as $$
declare v_ws uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  select workspace_id into v_ws from public.usage_events where id = p_event_id;
  if v_ws is null or not public.is_workspace_member(v_ws) then raise exception 'not_authorized'; end if;
  update public.usage_events
    set status = 'succeeded', result_count = greatest(p_result_count, 0), finished_at = now()
    where id = p_event_id and status = 'pending';
end;
$$;
grant execute on function public.complete_usage_event(uuid,int) to authenticated;

-- pending -> failed (+ automatic one-time refund of the event's own charge)
create or replace function public.fail_usage_event(p_event_id uuid, p_error text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_event record;
  v_wallet uuid;
  v_tx uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  select id, workspace_id, credits_charged, status, refund_tx_id
    into v_event from public.usage_events where id = p_event_id for update;
  if v_event.id is null or not public.is_workspace_member(v_event.workspace_id) then
    raise exception 'not_authorized';
  end if;
  if v_event.status = 'pending' then
    update public.usage_events
      set status = 'failed', error = left(coalesce(p_error, 'error'), 200), finished_at = now()
      where id = p_event_id;
    v_event.status := 'failed';
  end if;
  if v_event.status <> 'failed' or v_event.refund_tx_id is not null or v_event.credits_charged <= 0 then
    return null; -- idempotent: nothing (more) to refund
  end if;
  select id into v_wallet from public.credit_wallets where workspace_id = v_event.workspace_id;
  v_tx := public.apply_credit_transaction(
    v_wallet, v_event.credits_charged, 'refund', 'Refund: generation failed',
    p_event_id, jsonb_build_object('reason', left(coalesce(p_error, 'error'), 100)), auth.uid());
  update public.usage_events set status = 'refunded', refund_tx_id = v_tx where id = p_event_id;
  return v_tx;
end;
$$;
grant execute on function public.fail_usage_event(uuid,text) to authenticated;
