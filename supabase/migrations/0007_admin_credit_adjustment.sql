-- Admin-only credit adjustment. Goes through the ledger (apply_credit_transaction)
-- so balances can never be edited directly; is_admin gate enforced server-side.
create or replace function public.admin_adjust_credits(
  p_wallet_id uuid,
  p_amount int,
  p_description text default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_tx uuid;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'not_admin';
  end if;
  v_tx := public.apply_credit_transaction(
    p_wallet_id, p_amount, 'admin_adjustment', p_description, null,
    jsonb_build_object('source','admin_panel'), auth.uid());
  return v_tx;
end;
$$;
revoke execute on function public.admin_adjust_credits(uuid,int,text) from public, anon;
grant execute on function public.admin_adjust_credits(uuid,int,text) to authenticated;
