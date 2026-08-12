-- Members cannot UPDATE usage_events (that guard is what stops a customer
-- flipping a succeeded event to failed and claiming a refund), so the real
-- provider cost of a call is recorded through the same SECURITY DEFINER
-- lifecycle functions that already own the transition.
create or replace function public.complete_usage_event(
  p_event_id uuid,
  p_result_count int,
  p_api_cost_usd_micros bigint default 0,
  p_request_id text default null
) returns void language plpgsql security definer set search_path = public as $$
declare v_ws uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  select workspace_id into v_ws from public.usage_events where id = p_event_id;
  if v_ws is null or not public.is_workspace_member(v_ws) then raise exception 'not_authorized'; end if;
  update public.usage_events
    set status = 'succeeded',
        result_count = greatest(p_result_count, 0),
        actual_api_cost_usd_micros = greatest(coalesce(p_api_cost_usd_micros, 0), 0),
        provider_request_id = left(p_request_id, 200),
        finished_at = now()
    where id = p_event_id and status = 'pending';
end;
$$;
grant execute on function public.complete_usage_event(uuid,int,bigint,text) to authenticated;

-- A failure can still have cost us money (a provider that bills per attempt,
-- or a partially delivered batch). Recording it keeps margin reporting honest
-- instead of hiding spend behind refunded events.
create or replace function public.fail_usage_event(
  p_event_id uuid,
  p_error text,
  p_api_cost_usd_micros bigint default 0
) returns uuid language plpgsql security definer set search_path = public as $$
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
      set status = 'failed', error = left(coalesce(p_error, 'error'), 200),
          actual_api_cost_usd_micros = greatest(coalesce(p_api_cost_usd_micros, 0), 0),
          finished_at = now()
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
grant execute on function public.fail_usage_event(uuid,text,bigint) to authenticated;
