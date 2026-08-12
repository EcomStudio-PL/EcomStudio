-- Fixes for the customer-side generation path (found in production E2E):
-- the /api/generate route runs with the USER token, so it needs
-- member-scoped ways to (a) read the encrypted provider credential
-- (ciphertext only — decryption key never leaves the server), (b) charge
-- credits, (c) refund a failed usage event exactly once, and (d) insert
-- generation records.

-- (d) member inserts for generation results
create policy "gen_insert" on public.generations for insert
  with check (public.is_workspace_member(workspace_id));
create policy "ga_insert" on public.generation_assets for insert
  with check (exists (
    select 1 from public.generations g
    where g.id = generation_id and public.is_workspace_member(g.workspace_id)
  ));

-- (a) encrypted credential for server-side generation. Returns AES-256-GCM
-- ciphertext + iv + tag; useless without APP_ENCRYPTION_KEY (server-only).
create or replace function public.get_active_provider_credential(p_provider_id uuid)
returns table (encrypted_value text, iv text, auth_tag text, base_url text)
language sql security definer set search_path = public as $$
  select c.encrypted_value, c.iv, c.auth_tag, c.base_url
  from public.ai_provider_credentials c
  join public.ai_providers p on p.id = c.provider_id
  where c.provider_id = p_provider_id and c.active and p.active
    and auth.uid() is not null
  limit 1;
$$;
grant execute on function public.get_active_provider_credential(uuid) to authenticated;

-- (b) charge the caller's own workspace wallet for a usage event.
-- Spending your own credits is the only thing this can do.
create or replace function public.charge_usage_credits(
  p_wallet_id uuid,
  p_amount int,
  p_description text,
  p_reference_id uuid,
  p_metadata jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_ws uuid;
begin
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  if p_amount <= 0 or p_amount > 10000 then raise exception 'invalid_amount'; end if;
  select workspace_id into v_ws from public.credit_wallets where id = p_wallet_id;
  if v_ws is null or not public.is_workspace_member(v_ws) then
    raise exception 'not_authorized';
  end if;
  return public.apply_credit_transaction(
    p_wallet_id, -p_amount, 'generation', p_description, p_reference_id, p_metadata, auth.uid());
end;
$$;
grant execute on function public.charge_usage_credits(uuid,int,text,uuid,jsonb) to authenticated;

-- (c) refund a FAILED usage event exactly once: amount comes from the
-- event's own charge, the transition is atomic and repeat calls no-op.
create or replace function public.refund_usage_event(p_event_id uuid)
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
  if v_event.status <> 'failed' or v_event.refund_tx_id is not null or v_event.credits_charged <= 0 then
    return null; -- nothing to refund (idempotent)
  end if;
  select id into v_wallet from public.credit_wallets where workspace_id = v_event.workspace_id;
  v_tx := public.apply_credit_transaction(
    v_wallet, v_event.credits_charged, 'refund', 'Refund: generation failed',
    p_event_id, jsonb_build_object('reason', 'generation_failed'), auth.uid());
  update public.usage_events
    set status = 'refunded', refund_tx_id = v_tx
    where id = p_event_id;
  return v_tx;
end;
$$;
grant execute on function public.refund_usage_event(uuid) to authenticated;
