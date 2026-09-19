-- A CHARGED RUN THAT NEVER CAME BACK MUST NOT STAY CHARGED FOREVER.
--
-- APPLY AFTER 0101. Release order is 0100 → application deploy → 0101 → 0102.
-- This migration depends on nothing the deploy ships and on nothing in 0101, so
-- it could go earlier, but it belongs last: it is the safety net, not part of
-- the change it protects.
--
-- THE GAP IT CLOSES. `usage_event_start` (0100) commits the event row AND the
-- wallet debit in one transaction. If the response to it never reaches the
-- application — a reset connection, a gateway timeout, an invocation killed at
-- its ceiling — then lib/services/usage.ts has no event id, and every door out
-- of a usage event needs one: completeUsage, failUsage and
-- usage_event_refund_partial all take `p_event_id`. The row stays `pending`,
-- the credits stay taken, and nothing in this codebase ever looks at it again.
-- 0101 recorded that job as missing rather than half-building it. This is it.
--
-- WHY NOT JUST LOOK THE ROW UP BY ITS IDEMPOTENCY KEY.
--
-- Because the key does not identify a REQUEST, it identifies an INPUT. Two
-- submissions of the same photo from the same workspace inside one window
-- derive the same key by design (app/api/tools/run/route.ts). A lookup after a
-- failed call could therefore hand request B the event that request A owns, and
-- then B would complete or refund A's run. Recovering a lost response and
-- stealing a live one are indistinguishable from inside the request. So the
-- charge is reconciled out of band instead, from the database, where the only
-- rows considered are ones no request can still be running.
--
-- IT DECIDES ON EVIDENCE, NOT ON THE CLOCK ALONE.
--
-- A run whose images are already in the library was DELIVERED; refunding it
-- would be a free generation with extra steps. So delivery is checked first and
-- such an event is closed as `succeeded`. Only a run with nothing to show for
-- itself gets the money back. The image tools have no server-side delivery
-- evidence — their output goes to the HTTP response, and saving it is a
-- separate call the browser makes — so their window is shrunk at the source
-- instead, by retrying `usage_event_complete` in lib/services/usage.ts.
--
-- THE FIVE PROPERTIES IT HAS TO HAVE, AND WHERE EACH ONE COMES FROM.
--
--   idempotent            every write is conditional on the state it read
--                         (`and status = 'pending'`, `and refund_tx_id is null`),
--                         so a second pass over the same row does nothing.
--   concurrency-safe      `for update skip locked` — two runners never see the
--                         same row, and the one that has it holds the lock for
--                         the whole decision.
--   no free run           delivery outranks the clock: a run whose work is on
--                         disk is closed, not refunded. What it is closed AT
--                         is a second question — a run that delivered fewer
--                         images than it was charged for is closed at the
--                         price of what arrived, with the difference returned
--                         once. "Something was delivered" is not "everything
--                         was delivered", and treating the two as the same is
--                         how a seller ends up paying four credits for one
--                         image with nothing left to flag it.
--   no double charge      it never debits. There is no code path here that
--                         calls apply_credit_transaction with a negative amount.
--   no double refund      the refund and the `refund_tx_id` stamp are one
--                         transaction, and the stamp is also in the WHERE.
--
-- THE GRACE PERIOD IS NOT A GUESS. The longest ceiling any charging route
-- declares is 300 s (app/api/generate, fashion, retouch, concepts,
-- generations/regenerate; tools/run is 120 s). Vercel cannot run a function
-- past its ceiling, so 1800 s is six times the longest possible live run. The
-- clock starts when the CHARGE commits — `usage_events.started_at` defaults to
-- now() inside usage_event_start — so queueing and cold start are already
-- excluded. The floor below is what stops a careless caller reaping a live run.

create index if not exists usage_events_pending_started_idx
  on public.usage_events (started_at) where status = 'pending';

create or replace function public.usage_events_reconcile_stale(
  p_limit integer default 50,
  p_grace_seconds integer default 1800
) returns table (event_id uuid, outcome text)
language plpgsql security definer set search_path = public as $$
declare
  -- Floored at 15 minutes. The argument can make the reaper LAZIER, never more
  -- eager: a grace shorter than the longest route ceiling would refund a
  -- customer who is about to receive their images.
  v_grace interval := make_interval(secs => greatest(coalesce(p_grace_seconds, 1800), 900));
  v_limit integer := greatest(1, least(coalesce(p_limit, 50), 200));
  v_row record;
  v_wallet uuid;
  v_delivered integer;
  v_session uuid;
  v_tx uuid;
  -- How many the run was PAID for, and what a shortfall is worth. Zero means
  -- the row does not say, and an unknown expectation is never guessed at.
  v_expected integer;
  v_keep integer;
  v_short integer;
begin
  for v_row in
    select e.id, e.workspace_id, e.credits_charged, e.credit_tx_id,
           e.generation_job_id, e.metadata
      from public.usage_events e
     where e.status = 'pending'
       and e.started_at < now() - v_grace
       and e.refund_tx_id is null            -- belt: never a second receipt
     order by e.started_at
     limit v_limit
     for update skip locked                  -- two runners never see one row
  loop
    -- ── did the customer actually get anything? ────────────────────────────
    v_delivered := 0;
    if v_row.generation_job_id is not null then
      select count(*) into v_delivered
        from public.generation_assets a
        join public.generations g on g.id = a.generation_id
       where g.job_id = v_row.generation_job_id;
    else
      -- The prompt engine writes generated_prompts and only then calls
      -- completeUsage (lib/server/prompt-engine.ts), and carries the session id
      -- on the event's metadata, so the same question can be asked of it.
      begin
        v_session := nullif(v_row.metadata->>'session_id', '')::uuid;
      exception when others then
        v_session := null;
      end;
      if v_session is not null then
        select count(*) into v_delivered
          from public.generated_prompts p where p.session_id = v_session;
      end if;
    end if;

    if v_delivered > 0 then
      /*
        DELIVERED IS NOT THE SAME AS DELIVERED IN FULL.

        This branch used to stamp any run with at least one asset as
        `succeeded` at the full price. That state is reachable and expensive:
        runGeneration inserts the assets BEFORE it prices the shortfall and
        before completeUsage, so an invocation killed in between leaves a run
        charged for four images that produced one — and closing it as a
        success means nothing ever flags it again. The seller pays four
        credits for one image, permanently.

        The evidence needed to price it is already on the row: the ledger
        records `quantity` in metadata, and `v_delivered` is counted above. So
        the shortfall is returned here on exactly the terms the application
        would have used, and only then is the run closed.

        THREE THINGS KEEP THIS FROM PAYING TWICE. It is skipped when the
        application already priced a shortfall (`partial_refund_tx`, the same
        marker usage_event_refund_partial writes); it never runs on a row with
        no receipt; and the row leaves `pending` in the same statement, so no
        later sweep can select it again.

        An unknown or nonsensical `quantity` refunds NOTHING. Guessing at the
        price of a delivery is worse than leaving an operator a row to read.
      */
      begin
        v_expected := greatest(coalesce(nullif(v_row.metadata->>'quantity', '')::integer, 0), 0);
      exception when others then
        v_expected := 0;
      end;

      v_short := 0;
      if v_expected > 0 and v_delivered < v_expected
         and v_row.credit_tx_id is not null and v_row.credits_charged > 0
         and (v_row.metadata->>'partial_refund_tx') is null then
        /*
          THE APPLICATION'S FORMULA, NOT A SECOND ONE.

          lib/server/generation.ts prices a shortfall as
          `floor(cost / quantity) * missing`, and this used to compute
          `cost - floor(cost * delivered / quantity)` instead. Those agree
          whenever the price divides evenly and disagree when it does not —
          which `costOverride` makes reachable (retouch, Moda, concepts). At
          quantity 4, cost 5, one delivered, the app keeps 2 and this kept 1.

          The difference always favoured the customer, so nothing leaked; but
          two prices for one event is how a refund becomes unexplainable. The
          comment above claims the application's terms, so these are them.
        */
        v_keep := floor(v_row.credits_charged::numeric / v_expected)
                  * v_delivered;
        v_short := greatest(v_row.credits_charged - v_keep, 0);
      end if;

      if v_short > 0 then
        select id into v_wallet from public.credit_wallets
         where workspace_id = v_row.workspace_id;
        if v_wallet is null then
          /*
            NO WALLET TO PAY INTO — BUT THE ROW STILL LEAVES `pending`.

            It used to `continue` here without closing, which broke this
            file's own guarantee that a row leaves pending in the same
            statement. Two consequences, both silent: the idempotency key was
            never released, so that exact input could never be re-submitted;
            and because the sweep is `order by started_at limit 50`, stuck
            rows are permanently the OLDEST — fifty of them would stop the
            reconciler reconciling anything at all, forever.

            So it closes as delivered at the full price and says so. Not
            paying what we cannot pay is right; leaving a landmine in the
            queue to remember it by is not. The `reconciled` marker records
            that a shortfall was owed and could not be returned, which is what
            an operator needs to find it.
          */
          update public.usage_events
             set status = 'succeeded',
                 result_count = greatest(result_count, v_delivered),
                 finished_at = coalesce(finished_at, now()),
                 idempotency_key = null,
                 metadata = coalesce(metadata, '{}'::jsonb)
                   || jsonb_build_object('reconciled', 'delivered_short_unpaid',
                                         'reconciled_at', now(),
                                         'shortfall_owed', v_short)
           where id = v_row.id and status = 'pending';
          event_id := v_row.id; outcome := 'no_wallet'; return next;
          continue;
        end if;
        v_tx := public.apply_credit_transaction(
          v_wallet, v_short, 'refund', 'Refund: fewer images than the run was charged for',
          v_row.id,
          jsonb_build_object('reason', 'reconciled_shortfall', 'actor', 'system',
                             'delivered', v_delivered, 'expected', v_expected),
          null);
      end if;

      update public.usage_events
         set status = 'succeeded',
             result_count = greatest(result_count, v_delivered),
             -- The price becomes what was actually delivered, so no report
             -- reads the difference as revenue.
             credits_charged = credits_charged - v_short,
             finished_at = coalesce(finished_at, now()),
             idempotency_key = null,
             metadata = coalesce(metadata, '{}'::jsonb)
               || jsonb_build_object('reconciled',
                    case when v_short > 0 then 'delivered_short' else 'delivered' end,
                    'reconciled_at', now())
               -- The application's own marker, so the two paths cannot both
               -- price the same shortfall.
               || case when v_short > 0
                    then jsonb_build_object('partial_refund_tx', v_tx)
                    else '{}'::jsonb end
       where id = v_row.id and status = 'pending';
      event_id := v_row.id;
      outcome := case when v_short > 0 then 'closed_short' else 'closed_delivered' end;
      return next;
      continue;
    end if;

    -- ── nothing was delivered: close it, then return real money once ───────
    update public.usage_events
       set status = 'failed',
           error = 'reconciled_timeout',
           finished_at = coalesce(finished_at, now()),
           idempotency_key = null,
           metadata = coalesce(metadata, '{}'::jsonb)
             || jsonb_build_object('reconciled', 'timeout', 'reconciled_at', now())
     where id = v_row.id and status = 'pending';

    if v_row.credit_tx_id is null or v_row.credits_charged <= 0 then
      -- 0099's rule: credits_charged is the PRICE, credit_tx_id is the RECEIPT.
      -- No receipt means nothing was taken, so nothing is returned — and the
      -- quoted price comes off the row so no report reads it as revenue.
      update public.usage_events
         set credits_charged = 0,
             api_cost_usd_micros_snapshot = 0,
             sale_value_cents_snapshot = 0,
             actual_api_cost_usd_micros = 0
       where id = v_row.id and credit_tx_id is null;
      event_id := v_row.id; outcome := 'closed_uncharged'; return next;
      continue;
    end if;

    select id into v_wallet from public.credit_wallets
     where workspace_id = v_row.workspace_id;
    if v_wallet is null then
      -- Returned in the result set rather than guessed at. Be honest about
      -- what that is worth: under pg_cron the rows are discarded, and the
      -- event has already left 'pending' above, so no later sweep revisits
      -- it. It is a diagnostic for a deliberate run, not an alert.
      --
      -- It is also close to unreachable: deleting a wallet cascades
      -- credit_transactions, which nulls usage_events.credit_tx_id, so such a
      -- row takes the 'closed_uncharged' branch above instead. Kept because a
      -- branch that silently falls through is worse than one that says so.
      event_id := v_row.id; outcome := 'no_wallet'; return next;
      continue;
    end if;

    v_tx := public.apply_credit_transaction(
      v_wallet, v_row.credits_charged, 'refund', 'Refund: run never finished',
      v_row.id,
      jsonb_build_object('reason', 'reconciled_timeout', 'actor', 'system'),
      -- No auth.uid() here and that is the point: nobody is signed in. The
      -- column is nullable and the actor is recorded in the metadata instead.
      null);
    update public.usage_events
       set status = 'refunded', refund_tx_id = v_tx
     where id = v_row.id and refund_tx_id is null;
    event_id := v_row.id; outcome := 'refunded'; return next;
  end loop;
end $$;

-- Unreachable through PostgREST by design: no role is granted EXECUTE, so only
-- the owner — which is what a pg_cron job runs as — can call it. Everything
-- else goes through the token-gated wrapper below.
revoke all on function public.usage_events_reconcile_stale(integer, integer)
  from public, anon, authenticated;

comment on function public.usage_events_reconcile_stale(integer, integer) is
  'Closes usage events left pending past their grace: succeeded when the work was delivered, refunded exactly once when it was not. Idempotent, FOR UPDATE SKIP LOCKED, never touches a row that already carries a refund receipt. Grace is floored at 15 minutes so it cannot reap a live run.';

-- ── The same job, reachable by the server over HTTP ─────────────────────────
-- So the reconciler still runs where pg_cron is unavailable, and so an operator
-- can trigger it deliberately. Same proof-of-server gate as the rest of the
-- ledger (0077): the token is derived from the master key, and a caller who
-- cannot produce it is refused rather than quietly answered.
create or replace function public.usage_events_reconcile(
  p_token text,
  p_limit integer default 50
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_refunded integer; v_delivered integer; v_closed integer; v_stuck integer;
  v_short integer; v_other integer;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  /*
    EVERY OUTCOME IS COUNTED, INCLUDING ONES ADDED LATER.

    `closed_short` was added to the sweep without being added here, so a run
    that returned real credits reported all zeros — an operator triggering
    this deliberately, which is its stated purpose, was told nothing had
    happened while money moved. `v_other` is the guard against that repeating:
    a future outcome nobody adds a column for still shows up as a non-zero
    number that does not match anything, which is a question rather than a
    silence.
  */
  select count(*) filter (where outcome = 'refunded'),
         count(*) filter (where outcome = 'closed_delivered'),
         count(*) filter (where outcome = 'closed_short'),
         count(*) filter (where outcome = 'closed_uncharged'),
         count(*) filter (where outcome = 'no_wallet'),
         count(*) filter (where outcome not in
           ('refunded','closed_delivered','closed_short','closed_uncharged','no_wallet'))
    into v_refunded, v_delivered, v_short, v_closed, v_stuck, v_other
    from public.usage_events_reconcile_stale(p_limit);
  -- Counts only. No event id, no workspace id, nothing that identifies a
  -- customer travels back over HTTP.
  return jsonb_build_object(
    'refunded', coalesce(v_refunded, 0),
    'delivered', coalesce(v_delivered, 0),
    'short_refunded', coalesce(v_short, 0),
    'closed', coalesce(v_closed, 0),
    'no_wallet', coalesce(v_stuck, 0),
    'unclassified', coalesce(v_other, 0));
end $$;

-- ANON IS ON THIS GRANT ON PURPOSE. The belt's whole reason to exist is the
-- UNATTENDED caller: a platform cron arrives with a bearer secret and NO
-- session, so its Postgres role is `anon`. EXECUTE is checked before the
-- definer body runs, so granting only to `authenticated` does not make this
-- stricter — it makes the gate unreachable, and the belt would have worked
-- only when an admin pressed a button, which is the one case it was not for.
-- `server_call_ok(p_token)` inside is the gate. Same shape as 0108, 0082,
-- 0080 and 0079.
revoke all on function public.usage_events_reconcile(text, integer) from public;
grant execute on function public.usage_events_reconcile(text, integer) to anon, authenticated;

comment on function public.usage_events_reconcile(text, integer) is
  'Server-token gated entry point for the stale-usage reconciler. Returns counts only.';

-- ── The schedule ────────────────────────────────────────────────────────────
-- Written in 0095's defensive style: safe to fail, idempotent to re-apply, and
-- it never leaves the database half-configured. pg_cron 1.6.4 is installed on
-- production and already runs the newsletter worker every minute.
--
-- Ten minutes, not one: the grace is thirty, so nothing is gained by looking
-- more often, and a charged row is worth one extra sweep rather than 1440.
do $$
declare
  v_name constant text := 'grovbase-usage-reconcile';
  v_existing integer;
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice 'usage reconcile: pg_cron is absent; schedule public.usage_events_reconcile_stale() by other means.';
    return;
  end if;
  execute 'select count(*) from cron.job where jobname = $1' into v_existing using v_name;
  if v_existing > 0 then execute 'select cron.unschedule($1)' using v_name; end if;
  execute 'select cron.schedule($1, $2, $3)'
    using v_name, '*/10 * * * *', 'select public.usage_events_reconcile_stale();';
exception when others then
  raise notice 'usage reconcile: could not schedule (%). Nothing was left half-configured.', sqlerrm;
end $$;

-- ROLLBACK, in full:
--   select cron.unschedule('grovbase-usage-reconcile');
--   drop function if exists public.usage_events_reconcile(text, integer);
--   drop function if exists public.usage_events_reconcile_stale(integer, integer);
--   drop index if exists public.usage_events_pending_started_idx;
-- No table, column, policy, constraint or existing function is touched.
