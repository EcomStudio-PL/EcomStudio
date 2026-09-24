-- ============================================================================
-- 0118 — THE STATUS SCREEN MUST BE ABLE TO ASK, WITHOUT BEING ABLE TO GRANT.
--
-- After confirming a payment the customer lands on a screen that has to answer
-- one question honestly: did this work, and are the credits actually there?
--
-- It cannot answer that from the browser. A PaymentIntent id in a URL is not
-- evidence — anyone can type one — and Stripe saying "succeeded" is not the
-- same fact as "the ledger moved", because the ledger moves on the signed
-- webhook and that arrives on its own schedule.
--
-- So the screen asks two sources and reports which one it has. This function is
-- the second: it looks for the `payments` row the WEBHOOK wrote, and says what
-- was credited. It is strictly read-only. There is no argument that makes it
-- grant, settle or change anything — the only function that may touch a balance
-- is still `apply_credit_transaction`, reached only through
-- `stripe_settle_payment`, reached only from a signature-verified event.
--
-- ─── WHY IT IS NOT A PLAIN SELECT ───────────────────────────────────────────
--
-- `payments` has RLS on and no member-facing policy (0113): a workspace member
-- may not read the payments table directly, and that is deliberate. The status
-- screen runs as the SERVER, proves it with the dispatch token, and is handed
-- exactly four fields about exactly one payment.
--
-- ─── WHY A SUBSCRIPTION NEEDS ITS OWN BRANCH ────────────────────────────────
--
-- A one-off purchase is keyed on the PaymentIntent, so `sub_...` would never
-- match. A subscription's money arrives as an INVOICE, and `onInvoicePaid`
-- keys the payment on the invoice id — each renewal its own row, which is what
-- makes every period grant exactly once.
--
-- The link back to the subscription is already written: that handler records
-- `metadata.subscription` on the payment. Reading it here means the status
-- screen follows the same trail the webhook laid, rather than inventing a
-- second way to associate the two.
--
-- ─── AND IT IS SCOPED TO THE CALLER'S WORKSPACE ─────────────────────────────
--
-- `workspace_id` is part of every lookup, not a field in the answer. A
-- reference belonging to another workspace's payment returns `found: false` —
-- not someone else's amount. Guessing a Stripe id is hard; relying on that
-- being hard is not a security model.
-- ============================================================================

create or replace function public.stripe_payment_status(
  p_token        text,
  p_workspace_id uuid,
  p_reference    text
)
returns jsonb
language plpgsql security definer stable set search_path = public, extensions as $$
declare
  v_row public.payments%rowtype;
begin
  if not public.server_call_ok(p_token) then
    raise exception 'forbidden';
  end if;
  if p_workspace_id is null or p_reference is null or p_reference = '' then
    return jsonb_build_object('found', false);
  end if;

  if p_reference like 'sub\_%' then
    -- The newest settled invoice belonging to this subscription. Newest,
    -- because a renewal is a new payment and the screen is always asking about
    -- the most recent one.
    select * into v_row
      from public.payments
     where workspace_id = p_workspace_id
       and provider = 'stripe'
       and metadata ->> 'subscription' = p_reference
     order by created_at desc
     limit 1;
  else
    select * into v_row
      from public.payments
     where workspace_id = p_workspace_id
       and provider = 'stripe'
       and provider_payment_id = p_reference
     limit 1;
  end if;

  if not found then
    return jsonb_build_object('found', false);
  end if;

  -- A payment that exists but failed or was refunded is NOT a success. Saying
  -- `found` for it would make the screen announce credits that were reversed.
  if v_row.status not in ('succeeded', 'paid') then
    return jsonb_build_object('found', false, 'status', v_row.status);
  end if;

  return jsonb_build_object(
    'found',           true,
    'amount_cents',    v_row.amount_cents,
    'currency',        v_row.currency,
    'credits_granted', v_row.credits_granted,
    'kind',            v_row.kind
  );
end $$;

revoke execute on function public.stripe_payment_status(text,uuid,text) from public;
grant execute on function public.stripe_payment_status(text,uuid,text) to anon, authenticated;
