-- THE USAGE LEDGER STOPS BEING CUSTOMER-WRITABLE.
--
-- THE DEFECT. `usage_events` carried an INSERT policy —
-- `usage_events_member_insert`, `is_workspace_member(workspace_id) and
-- user_id = auth.uid()` — so any signed-in seller could write rows into the
-- billing ledger through PostgREST. On its own that is untidy. Combined with
-- how a charge begins, it is free generation.
--
-- lib/services/usage.ts opened every paid run by asking whether an event with
-- this idempotency key already existed, and treating a hit as "already paid":
--
--     if (existing) return { ok: true, eventId: existing.id };
--
-- The key is derived, not accepted from the client — but derived from values
-- the client chooses: `tools:<workspace>:sha256(tool + settings + file)`. A
-- seller can compute the exact key of the run they are about to make, INSERT
-- that row themselves with `credits_charged: 0`, and then make the run. The
-- server finds the row, believes the charge happened, and generates. Every
-- paid tool, free, for any registered account.
--
-- "Check that the row looks charged" is not a fix. `credit_transactions` is
-- readable by its own workspace (`ctx_select`), so a forged row can quote the
-- id of a real earlier transaction.
--
-- THE FIX. The ledger becomes server-written, the same way the rest of the
-- money path already is:
--
--   1. `usage_event_start` — a server-token-gated SECURITY DEFINER function
--      that creates the event AND takes the credits in one transaction.
--   2. `usage_events_member_insert` is dropped — in 0101, NOT here. See below.
--
-- Only lib/services/usage.ts ever inserted into this table, so nothing else
-- has to change to lose the policy.
--
-- WHY THE POLICY DROP IS A SEPARATE MIGRATION.
--
-- These writes go through the customer's own session client, so RLS applies to
-- them. Dropping the policy in the same file that adds the function makes the
-- two halves of the release mutually exclusive:
--
--   * migration first, deploy second — the running build still INSERTs, RLS
--     now refuses it, and every paid run fails until the deploy lands;
--   * deploy first, migration second — the new build calls a function that
--     does not exist yet, and every paid run fails until the migration lands.
--
-- Both fail closed, so no money moves either way, but there is no ordering
-- that avoids taking the product down. Adding the function is backwards
-- compatible on its own: the old build keeps inserting under the policy that
-- is still there. So this migration adds, 0101 removes, and the release order
-- is 0100 → deploy → 0101.
--
-- THREE THINGS THIS BUYS BEYOND CLOSING THE BYPASS.
--
-- * NO UNCHARGED EVENT CAN EXIST. Insert and debit share one subtransaction;
--   if the debit raises, the event row goes with it. The old code wrote the
--   row first and charged second, which is what produced the refundable
--   never-charged rows that 0099 had to defend against.
--
-- * EXACTLY ONE WINNER. `apply_credit_transaction` takes `for update` on the
--   wallet, so concurrent starts serialise there. Ten simultaneous requests
--   against a balance that covers one produce one success and nine
--   `insufficient_credits` — asserted in scripts/sql/, run in parallel for
--   real rather than argued about.
--
-- * A DUPLICATE SUBMIT IS REFUSED, NOT GIVEN AWAY. `on conflict
--   (idempotency_key) do nothing` makes the unique index the arbiter: the
--   first request owns the run, the second is told `duplicate_request`.
--   Previously the second request was handed a free generation, which is the
--   same hole as the forged row with no attacker required.
--
-- BUSINESS OUTCOMES ARE RETURNED, NOT RAISED. `status` carries
-- service_unavailable / maintenance / insufficient_credits / duplicate_request
-- so the caller keeps the error strings it already maps to messages. Only
-- authorization failures raise, because those are never a normal outcome.
--
-- The event is attributed to `auth.uid()` and `p_user_id` must match it —
-- the same invariant the dropped policy enforced, kept rather than lost.

create or replace function public.usage_event_start(
  p_token text,
  p_user_id uuid,
  p_workspace_id uuid,
  p_wallet_id uuid,
  p_service_slug text,
  p_credits integer default null,
  p_provider_slug text default null,
  p_model_slug text default null,
  p_generation_job_id uuid default null,
  p_idempotency_key text default null,
  p_metadata jsonb default '{}'::jsonb
) returns table (event_id uuid, status text)
language plpgsql security definer set search_path = public as $$
declare
  v_service record;
  v_credits integer;
  v_event uuid;
  v_ws uuid;
  v_tx uuid;
  v_status text;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  if p_user_id is distinct from auth.uid() then raise exception 'not_authorized'; end if;
  if not public.is_workspace_member(p_workspace_id) then raise exception 'not_authorized'; end if;

  select * into v_service from public.service_catalog
    where slug = p_service_slug and enabled;
  if not found then
    return query select null::uuid, 'service_unavailable'::text;
    return;
  end if;
  if v_service.maintenance_mode then
    return query select null::uuid, 'maintenance'::text;
    return;
  end if;

  -- The price: the caller's figure (a model's credit cost × quantity) or the
  -- catalog's. Clamped for the same reason usage_event_charge clamps.
  v_credits := greatest(0, coalesce(p_credits, v_service.credits_cost));
  -- A price this size is a bug in the caller, not an attack — p_credits is
  -- computed server-side. Returned rather than raised, because the rule above
  -- is that only authorization failures raise.
  if v_credits > 10000 then
    return query select null::uuid, 'invalid_amount'::text;
    return;
  end if;

  -- A free run needs no wallet; a paid one needs this workspace's wallet.
  if v_credits > 0 then
    select workspace_id into v_ws from public.credit_wallets where id = p_wallet_id;
    if v_ws is null or v_ws <> p_workspace_id then raise exception 'not_authorized'; end if;
  end if;

  -- ONE SUBTRANSACTION FOR THE ROW AND THE MONEY. Either both happen or
  -- neither does; there is no instant at which a charged-looking event exists
  -- unpaid, and no instant at which credits are gone with nothing to show.
  begin
    insert into public.usage_events (
      user_id, workspace_id, service_id, service_slug, provider_slug, model_slug,
      credits_charged, api_cost_usd_micros_snapshot, sale_value_cents_snapshot,
      generation_job_id, idempotency_key, metadata
    ) values (
      auth.uid(), p_workspace_id, v_service.id, v_service.slug, p_provider_slug, p_model_slug,
      v_credits, v_service.api_cost_usd_micros, v_service.sale_value_cents,
      p_generation_job_id, p_idempotency_key, coalesce(p_metadata, '{}'::jsonb)
    )
    on conflict (idempotency_key) do nothing
    returning id into v_event;

    if v_event is null then
      -- The unique index refused us: an identical request got here first and
      -- owns this run. Postgres makes the loser wait for the winner to commit,
      -- so this answer is never a guess.
      v_status := 'duplicate_request';
    elsif v_credits > 0 then
      v_tx := public.apply_credit_transaction(
        p_wallet_id, -v_credits, 'generation', v_service.name, v_event,
        coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('service', v_service.slug),
        auth.uid());
      update public.usage_events set credit_tx_id = v_tx where id = v_event;
      v_status := 'ok';
    else
      v_status := 'ok';
    end if;
  exception when raise_exception then
    -- Everything above is undone. `insufficient_credits` is the ordinary case
    -- and is named; another deliberate `raise` (wallet_not_found) becomes a
    -- failure to start rather than a database message shown to a customer.
    --
    -- NARROW ON PURPOSE. `when others` would also swallow structural faults —
    -- a missing unique index, a column that changed shape — and turn a broken
    -- deploy into a quiet "could not start" on every run. Those must escape,
    -- and when they do the transaction is rolled back just the same, so a
    -- loud failure still cannot leave an unpaid event behind.
    v_event := null;
    v_status := case when sqlerrm = 'insufficient_credits'
                     then 'insufficient_credits' else 'event_failed' end;
  end;

  return query select v_event, v_status;
end $$;

revoke all on function public.usage_event_start(
  text, uuid, uuid, uuid, text, integer, text, text, uuid, text, jsonb) from public, anon;
grant execute on function public.usage_event_start(
  text, uuid, uuid, uuid, text, integer, text, text, uuid, text, jsonb) to authenticated;

comment on function public.usage_event_start(
  text, uuid, uuid, uuid, text, integer, text, text, uuid, text, jsonb) is
  'Opens a billable run: creates the usage event and takes the credits in one transaction, or neither. Server-token gated — the usage ledger has no customer-writable path. Returns status ok / service_unavailable / maintenance / insufficient_credits / duplicate_request / invalid_amount / event_failed.';

