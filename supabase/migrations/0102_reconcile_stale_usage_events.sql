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
--   no free run           delivery outranks the clock; a delivered run is
--                         closed, not refunded.
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
      update public.usage_events
         set status = 'succeeded',
             result_count = greatest(result_count, v_delivered),
             finished_at = coalesce(finished_at, now()),
             idempotency_key = null,
             metadata = coalesce(metadata, '{}'::jsonb)
               || jsonb_build_object('reconciled', 'delivered', 'reconciled_at', now())
       where id = v_row.id and status = 'pending';
      event_id := v_row.id; outcome := 'closed_delivered'; return next;
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
      -- Reported, not swallowed: a charged event whose workspace has no wallet
      -- is something an operator needs to see, not something to guess at.
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
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  select count(*) filter (where outcome = 'refunded'),
         count(*) filter (where outcome = 'closed_delivered'),
         count(*) filter (where outcome = 'closed_uncharged'),
         count(*) filter (where outcome = 'no_wallet')
    into v_refunded, v_delivered, v_closed, v_stuck
    from public.usage_events_reconcile_stale(p_limit);
  -- Counts only. No event id, no workspace id, nothing that identifies a
  -- customer travels back over HTTP.
  return jsonb_build_object(
    'refunded', coalesce(v_refunded, 0),
    'delivered', coalesce(v_delivered, 0),
    'closed', coalesce(v_closed, 0),
    'no_wallet', coalesce(v_stuck, 0));
end $$;

revoke all on function public.usage_events_reconcile(text, integer) from public, anon;
grant execute on function public.usage_events_reconcile(text, integer) to authenticated;

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
