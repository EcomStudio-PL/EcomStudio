-- ============================================================================
-- 0114 — STRIPE: which workspace is this customer?
--
-- 0113 gave the application `stripe_customer_for(workspace) -> customer`,
-- which is what CHECKOUT needs. The webhook needs the other direction, and it
-- needs it for a specific failure:
--
--   A renewal arrives as `invoice.paid`. GrovBase puts its own metadata on
--   every Subscription it creates, so a renewal it started can name its
--   workspace. But a subscription created from the STRIPE DASHBOARD — an
--   operator fixing something by hand, a migrated customer, a plan changed in
--   the portal — carries no GrovBase metadata at all. Its only link back is
--   the Customer id.
--
--   Without this lookup, that invoice settles against nothing: the money is
--   taken and no credits are granted, and the only trace is a payment_events
--   row nobody reads. With it, the customer id resolves to the workspace that
--   was linked when the customer was created, and the renewal lands.
--
-- WHY IT IS A FUNCTION AND NOT A SELECT. `stripe_customers` has RLS on, no
-- policy and no grants — deliberately, because it is what decides whose cards
-- the Billing Portal opens. Nothing outside a SECURITY DEFINER function can
-- read it, and the dispatch token is what proves the caller is the server.
-- ============================================================================

create or replace function public.stripe_workspace_for(
  p_token text, p_stripe_customer_id text
)
returns uuid
language plpgsql security definer stable set search_path = public, extensions as $$
declare v uuid;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if coalesce(p_stripe_customer_id, '') = '' then return null; end if;
  select workspace_id into v
    from public.stripe_customers
   where stripe_customer_id = p_stripe_customer_id;
  return v;
end;
$$;

comment on function public.stripe_workspace_for(text, text) is
  'Reverse of stripe_customer_for: the workspace a Stripe Customer belongs to. '
  'Used by the webhook when an event carries no GrovBase metadata — a '
  'subscription created in the Stripe dashboard, for instance.';

revoke execute on function public.stripe_workspace_for(text, text) from public;
grant  execute on function public.stripe_workspace_for(text, text) to anon, authenticated;

-- ── recording an event that changes nothing ─────────────────────────────────
-- A FAILED payment has to leave a trace: a customer asking "why did my card
-- not work" deserves an answer, and an endpoint that silently drops half the
-- events it is subscribed to is an endpoint nobody can debug.
--
-- But recording a failure must not be able to TOUCH a payment. The first draft
-- of the webhook reused stripe_record_refund() for this, which writes
-- `status` onto a matching payments row — so a stray failure event naming an
-- id that had already succeeded could have flipped a settled payment to
-- 'failed'. This function cannot: it writes one payment_events row and stops.
create or replace function public.stripe_record_event(
  p_token        text,
  p_event_id     text,
  p_event_type   text,
  p_object_id    text,
  p_workspace_id uuid,
  p_outcome      text,
  p_detail       jsonb
)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;

  insert into public.payment_events
    (stripe_event_id, event_type, object_id, workspace_id, outcome, detail)
  values
    (p_event_id, p_event_type, nullif(p_object_id, ''), p_workspace_id,
     coalesce(nullif(p_outcome, ''), 'recorded'), coalesce(p_detail, '{}'::jsonb))
  on conflict (stripe_event_id) do nothing;

  if not found then
    return jsonb_build_object('status', 'duplicate_event');
  end if;
  return jsonb_build_object('status', 'recorded');
end;
$$;

comment on function public.stripe_record_event(text, text, text, text, uuid, text, jsonb) is
  'Records a Stripe event that moves no money — a failed payment, an event '
  'acknowledged but not acted on. Writes payment_events only; it can never '
  'change a payments row.';

revoke execute on function public.stripe_record_event(text, text, text, text, uuid, text, jsonb) from public;
grant  execute on function public.stripe_record_event(text, text, text, text, uuid, text, jsonb) to anon, authenticated;
