-- ATTACKS ON THE CREDIT LEDGER.
--
-- Each block reproduces a finding from the 2026-09-18 audit. Run against the
-- harness BEFORE the remediation migration and the P0 blocks must FAIL; run it
-- after and they must PASS. A test that passes in both states proves nothing,
-- so the suite is executed in both directions (see scripts/ledger-sql-tests.sh).

\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on
\pset format unaligned

create or replace function public.t_check(p_label text, p_ok boolean, p_detail text default '')
returns void language plpgsql as $$
begin
  if p_ok then
    raise notice '  ok   %', p_label;
  else
    raise notice '  FAIL %  — %', p_label, p_detail;
    insert into public.t_failures (label, detail) values (p_label, p_detail);
  end if;
end $$;

create table if not exists public.t_failures (label text, detail text);
truncate public.t_failures;

-- ───────────────────────────────────────────────────────────────────────────
-- P0-02 — A FAILED CHARGE MUST NOT PRODUCE A REFUND.
--
-- lib/services/usage.ts writes credits_charged BEFORE attempting the debit,
-- then calls usage_event_fail when the debit raises. The event therefore
-- carries credits_charged > 0 with credit_tx_id NULL: it looks refundable, but
-- nothing was ever taken. This reproduces exactly that state.
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare
  f record; v_event uuid; v_before int; v_after int; v_tx uuid;
begin
  raise notice '';
  raise notice 'P0-02  refund without a charge';
  select * into f from public.t_fixture;
  perform set_config('app.current_user', f.user_id::text, false);

  update public.credit_wallets set balance = 0 where id = f.wallet_id;
  select balance into v_before from public.credit_wallets where id = f.wallet_id;

  -- The exact row startUsage leaves behind when usage_event_charge raises.
  insert into public.usage_events
    (user_id, workspace_id, service_slug, credits_charged, status, credit_tx_id)
  values (f.user_id, f.workspace_id, 'test-tool', 5, 'pending', null)
  returning id into v_event;

  v_tx := public.usage_event_fail('test-server-token', v_event, 'insufficient_credits', 0);
  select balance into v_after from public.credit_wallets where id = f.wallet_id;

  perform public.t_check(
    'a failed charge does not mint credits',
    v_after = v_before,
    format('balance %s -> %s, refund tx %s', v_before, v_after, coalesce(v_tx::text, 'none')));

  perform public.t_check(
    'no refund transaction is written for an uncharged event',
    not exists (select 1 from public.credit_transactions
                where reference_id = v_event and type = 'refund'),
    'a refund row exists for an event that was never debited');

  -- The row must also stop claiming a price nobody paid: several reporting
  -- paths count credits_charged for anything that is not 'refunded', and this
  -- event is now 'failed'. Left as 5, the fix would inflate the numbers.
  perform public.t_check(
    'the uncharged event stops claiming a price that was never paid',
    (select credits_charged = 0
        and api_cost_usd_micros_snapshot = 0
        and sale_value_cents_snapshot = 0
       from public.usage_events where id = v_event),
    format('credits_charged is still %s',
      (select credits_charged from public.usage_events where id = v_event)));

  perform public.t_check(
    'an uncharged failure ends as failed, not refunded',
    (select status from public.usage_events where id = v_event) = 'failed',
    format('status is %s', (select status from public.usage_events where id = v_event)));
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- P0-02b — THE LEGITIMATE REFUND MUST STILL WORK.
--
-- The fix must not be "never refund". A real charge followed by a real failure
-- still has to return the customer's credits exactly once.
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare
  f record; v_event uuid; v_tx uuid; v_after int; v_second uuid; v_final int;
begin
  raise notice '';
  raise notice 'P0-02b legitimate refund still works';
  select * into f from public.t_fixture;
  perform set_config('app.current_user', f.user_id::text, false);

  update public.credit_wallets set balance = 10 where id = f.wallet_id;

  insert into public.usage_events
    (user_id, workspace_id, service_slug, credits_charged, status)
  values (f.user_id, f.workspace_id, 'test-tool', 5, 'pending')
  returning id into v_event;

  -- A REAL debit, through the real RPC.
  v_tx := public.usage_event_charge('test-server-token', f.wallet_id, 5, 'Test tool', v_event, '{}'::jsonb);
  perform public.t_check('charge debits the wallet',
    (select balance from public.credit_wallets where id = f.wallet_id) = 5,
    'balance after charge');
  perform public.t_check('charge links credit_tx_id onto the event',
    (select credit_tx_id from public.usage_events where id = v_event) is not null);

  -- Now the generation fails for real.
  perform public.usage_event_fail('test-server-token', v_event, 'provider_timeout', 0);
  select balance into v_after from public.credit_wallets where id = f.wallet_id;
  perform public.t_check('a real failure refunds the real charge', v_after = 10,
    format('balance is %s, expected 10', v_after));

  -- And only once.
  v_second := public.usage_event_fail('test-server-token', v_event, 'provider_timeout', 0);
  select balance into v_final from public.credit_wallets where id = f.wallet_id;
  perform public.t_check('a second failure call cannot double-refund', v_final = 10,
    format('balance is %s after the second call, expected 10', v_final));
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- P0-02c — REPEATED ABUSE MUST NOT ACCUMULATE.
--
-- The audit's stated impact was "a zero-balance account calls a paid tool in a
-- loop and the balance grows". Ten iterations of the exact failure path.
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare
  f record; v_event uuid; v_start int; v_end int; i int;
begin
  raise notice '';
  raise notice 'P0-02c ten failed charges in a loop';
  select * into f from public.t_fixture;
  perform set_config('app.current_user', f.user_id::text, false);

  update public.credit_wallets set balance = 0 where id = f.wallet_id;
  select balance into v_start from public.credit_wallets where id = f.wallet_id;

  for i in 1..10 loop
    insert into public.usage_events
      (user_id, workspace_id, service_slug, credits_charged, status, credit_tx_id)
    values (f.user_id, f.workspace_id, 'test-tool', 5, 'pending', null)
    returning id into v_event;
    perform public.usage_event_fail('test-server-token', v_event, 'insufficient_credits', 0);
  end loop;

  select balance into v_end from public.credit_wallets where id = f.wallet_id;
  perform public.t_check('ten failed charges leave the balance at zero', v_end = v_start,
    format('balance %s -> %s (minted %s credits)', v_start, v_end, v_end - v_start));
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- P0-02d — THE PARTIAL REFUND HAS THE SAME GAP.
--
-- usage_event_refund_partial guards on status/refund_tx_id/amount and never
-- asked whether the event was charged either. Same invariant, same test.
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare
  f record; v_event uuid; v_before int; v_after int; v_tx uuid;
begin
  raise notice '';
  raise notice 'P0-02d partial refund without a charge';
  select * into f from public.t_fixture;
  perform set_config('app.current_user', f.user_id::text, false);

  update public.credit_wallets set balance = 0 where id = f.wallet_id;
  select balance into v_before from public.credit_wallets where id = f.wallet_id;

  insert into public.usage_events
    (user_id, workspace_id, service_slug, credits_charged, status, credit_tx_id)
  values (f.user_id, f.workspace_id, 'test-tool', 5, 'pending', null)
  returning id into v_event;

  v_tx := public.usage_event_refund_partial('test-server-token', v_event, 2);
  select balance into v_after from public.credit_wallets where id = f.wallet_id;

  perform public.t_check(
    'a partial refund on an uncharged event mints nothing',
    v_after = v_before,
    format('balance %s -> %s, refund tx %s', v_before, v_after, coalesce(v_tx::text, 'none')));
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- P0-02e — THE LEGITIMATE PARTIAL REFUND MUST STILL WORK.
--
-- lib/server/generation.ts calls this when a batch stores fewer images than
-- were paid for. That path must keep working after the fix.
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare
  f record; v_event uuid; v_after int; v_charged int;
begin
  raise notice '';
  raise notice 'P0-02e legitimate partial refund still works';
  select * into f from public.t_fixture;
  perform set_config('app.current_user', f.user_id::text, false);

  update public.credit_wallets set balance = 10 where id = f.wallet_id;

  insert into public.usage_events
    (user_id, workspace_id, service_slug, credits_charged, status)
  values (f.user_id, f.workspace_id, 'test-tool', 5, 'pending')
  returning id into v_event;

  perform public.usage_event_charge('test-server-token', f.wallet_id, 5, 'Test tool', v_event, '{}'::jsonb);
  -- Two of five images never stored: hand back their share.
  perform public.usage_event_refund_partial('test-server-token', v_event, 2);

  select balance into v_after from public.credit_wallets where id = f.wallet_id;
  select credits_charged into v_charged from public.usage_events where id = v_event;

  perform public.t_check('a short delivery refunds the undelivered share', v_after = 7,
    format('balance is %s, expected 7', v_after));
  perform public.t_check('the event keeps only what was delivered', v_charged = 3,
    format('credits_charged is %s, expected 3', v_charged));
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- P0-01 — A CUSTOMER MUST NOT BE ABLE TO WRITE THE BILLING LEDGER.
--
-- usage_events_member_insert let any workspace member INSERT. The idempotency
-- key of the run they are about to make is derivable from values they choose,
-- so writing that row first made the server believe the charge had happened.
-- The primitive is the insert; deny it and the bypass has nowhere to stand.
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare
  f record; v_denied boolean := false; v_rows int;
begin
  raise notice '';
  raise notice 'P0-01  the ledger is not customer-writable';
  select * into f from public.t_fixture;
  perform set_config('app.current_user', f.user_id::text, false);

  -- The suite runs twice against one database (before the fix, then after),
  -- so clear the key first: otherwise the second pass would be asserting on
  -- the row the first pass legitimately managed to write.
  delete from public.usage_events where idempotency_key = 'tools:forged:attack';

  begin
    -- `app_user` is this harness's `authenticated`: an ordinary role, so the
    -- policies apply to it exactly as they apply to a signed-in seller.
    perform set_config('role', 'app_user', true);
    insert into public.usage_events
      (user_id, workspace_id, service_slug, credits_charged, status, idempotency_key)
    values (f.user_id, f.workspace_id, 'test-tool', 0, 'pending', 'tools:forged:attack');
  exception when insufficient_privilege then
    v_denied := true;
  end;
  perform set_config('role', 'none', true);

  select count(*) into v_rows from public.usage_events
    where idempotency_key = 'tools:forged:attack';

  perform public.t_check('a signed-in customer cannot insert a usage event', v_denied,
    'the INSERT succeeded — the ledger is customer-writable');
  perform public.t_check('no forged ledger row exists', v_rows = 0,
    format('%s forged row(s) present', v_rows));
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- P0-01b — usage_event_start: THE CHARGE AND THE ROW ARE ONE TRANSACTION.
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare
  f record; r record; v_bal int; v_rows int; v_second record;
begin
  raise notice '';
  raise notice 'P0-01b usage_event_start charges atomically';
  select * into f from public.t_fixture;
  perform set_config('app.current_user', f.user_id::text, false);

  if to_regprocedure('public.usage_event_start(text,uuid,uuid,uuid,text,integer,text,text,uuid,text,jsonb)') is null then
    perform public.t_check('usage_event_start exists', false,
      'the function is absent — the ledger still has a customer-writable path');
    return;
  end if;

  -- Same reason as above: the suite runs twice against one database.
  delete from public.usage_events where idempotency_key in ('start:ok:1');

  -- A paid run with the money for it.
  update public.credit_wallets set balance = 10 where id = f.wallet_id;
  select * into r from public.usage_event_start(
    'test-server-token', f.user_id, f.workspace_id, f.wallet_id, 'test-tool',
    5, 'test-provider', 'test-model', null, 'start:ok:1', '{}'::jsonb);
  select balance into v_bal from public.credit_wallets where id = f.wallet_id;

  perform public.t_check('a funded start succeeds', r.status = 'ok',
    format('status is %s', r.status));
  perform public.t_check('a funded start debits the wallet once', v_bal = 5,
    format('balance is %s, expected 5', v_bal));
  perform public.t_check('the event carries its receipt',
    (select credit_tx_id is not null from public.usage_events where id = r.event_id));

  -- The same key again: refused, and it costs nothing.
  select * into v_second from public.usage_event_start(
    'test-server-token', f.user_id, f.workspace_id, f.wallet_id, 'test-tool',
    5, 'test-provider', 'test-model', null, 'start:ok:1', '{}'::jsonb);
  select balance into v_bal from public.credit_wallets where id = f.wallet_id;
  select count(*) into v_rows from public.usage_events where idempotency_key = 'start:ok:1';

  perform public.t_check('a duplicate request is refused, not run for free',
    v_second.status = 'duplicate_request' and v_second.event_id is null,
    format('status is %s', v_second.status));
  perform public.t_check('a duplicate request charges nothing', v_bal = 5,
    format('balance is %s, expected 5', v_bal));
  perform public.t_check('one key, one event', v_rows = 1,
    format('%s events carry the key', v_rows));
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- P0-01c — A START THAT CANNOT PAY LEAVES NOTHING BEHIND.
--
-- This is what made 0099 necessary in the first place: the old code wrote the
-- row, failed to charge, and left a refundable ghost. Now neither happens.
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare
  f record; r record; v_bal int; v_rows int;
begin
  raise notice '';
  raise notice 'P0-01c an unpayable start leaves no row';
  select * into f from public.t_fixture;
  perform set_config('app.current_user', f.user_id::text, false);

  if to_regprocedure('public.usage_event_start(text,uuid,uuid,uuid,text,integer,text,text,uuid,text,jsonb)') is null then
    perform public.t_check('usage_event_start exists', false, 'the function is absent');
    return;
  end if;

  delete from public.usage_events where idempotency_key in ('start:broke:1', 'start:free:1');

  update public.credit_wallets set balance = 1 where id = f.wallet_id;
  select * into r from public.usage_event_start(
    'test-server-token', f.user_id, f.workspace_id, f.wallet_id, 'test-tool',
    5, null, null, null, 'start:broke:1', '{}'::jsonb);
  select balance into v_bal from public.credit_wallets where id = f.wallet_id;
  select count(*) into v_rows from public.usage_events where idempotency_key = 'start:broke:1';

  perform public.t_check('an unpayable start reports insufficient_credits',
    r.status = 'insufficient_credits', format('status is %s', r.status));
  perform public.t_check('an unpayable start writes no event', v_rows = 0,
    format('%s row(s) written', v_rows));
  perform public.t_check('an unpayable start leaves the balance alone', v_bal = 1,
    format('balance is %s, expected 1', v_bal));

  -- A free run still works, and needs no wallet at all.
  select * into r from public.usage_event_start(
    'test-server-token', f.user_id, f.workspace_id, null, 'test-tool',
    0, 'local', 'sharp', null, 'start:free:1', '{}'::jsonb);
  perform public.t_check('a zero-credit run needs no wallet', r.status = 'ok',
    format('status is %s', r.status));
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- P0-01e — A RUN THAT ENDED MUST NOT KEEP BLOCKING THE NEXT ONE.
--
-- Refusing a duplicate key is right while the first request is in flight. Held
-- past the end of the run it broke the product's own "Ponów nieudane" button:
-- the failed event still owned the key, so every retry was refused instantly
-- and the customer was shown a processing error for a run the server declined
-- to start. Migration 0101 releases the key on the terminal states.
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare
  f record; r record; retry record; again record;
begin
  raise notice '';
  raise notice 'P0-01e a finished run releases its key';
  select * into f from public.t_fixture;
  perform set_config('app.current_user', f.user_id::text, false);

  if to_regprocedure('public.usage_event_start(text,uuid,uuid,uuid,text,integer,text,text,uuid,text,jsonb)') is null then
    perform public.t_check('usage_event_start exists', false, 'the function is absent');
    return;
  end if;
  delete from public.usage_events where idempotency_key in ('retry:after-fail', 'retry:after-ok');

  -- 1. A run that FAILS. The customer gets the credits back and presses retry.
  update public.credit_wallets set balance = 10 where id = f.wallet_id;
  select * into r from public.usage_event_start(
    'test-server-token', f.user_id, f.workspace_id, f.wallet_id, 'test-tool',
    5, null, null, null, 'retry:after-fail', '{}'::jsonb);
  perform public.usage_event_fail('test-server-token', r.event_id, 'provider_timeout', 0);
  perform public.t_check('the failed run was refunded',
    (select balance from public.credit_wallets where id = f.wallet_id) = 10,
    'balance after the refund');

  select * into retry from public.usage_event_start(
    'test-server-token', f.user_id, f.workspace_id, f.wallet_id, 'test-tool',
    5, null, null, null, 'retry:after-fail', '{}'::jsonb);
  perform public.t_check('retrying a failed run is allowed', retry.status = 'ok',
    format('status is %s — the retry button would show a processing error', retry.status));
  perform public.t_check('the retry is charged like the real run it is',
    (select balance from public.credit_wallets where id = f.wallet_id) = 5,
    format('balance is %s, expected 5',
      (select balance from public.credit_wallets where id = f.wallet_id)));

  -- 2. A run that SUCCEEDS. Running the same photo again later is a new run.
  update public.credit_wallets set balance = 10 where id = f.wallet_id;
  select * into r from public.usage_event_start(
    'test-server-token', f.user_id, f.workspace_id, f.wallet_id, 'test-tool',
    5, null, null, null, 'retry:after-ok', '{}'::jsonb);
  perform public.usage_event_complete('test-server-token', r.event_id, 1, 0, null);
  select * into again from public.usage_event_start(
    'test-server-token', f.user_id, f.workspace_id, f.wallet_id, 'test-tool',
    5, null, null, null, 'retry:after-ok', '{}'::jsonb);
  perform public.t_check('re-running a finished job is allowed', again.status = 'ok',
    format('status is %s', again.status));
  perform public.t_check('and it is a second charge, not a free ride',
    (select balance from public.credit_wallets where id = f.wallet_id) = 0,
    format('balance is %s, expected 0',
      (select balance from public.credit_wallets where id = f.wallet_id)));

  -- 3. But a request that is STILL RUNNING is still refused.
  update public.credit_wallets set balance = 10 where id = f.wallet_id;
  select * into r from public.usage_event_start(
    'test-server-token', f.user_id, f.workspace_id, f.wallet_id, 'test-tool',
    5, null, null, null, 'retry:in-flight', '{}'::jsonb);
  select * into again from public.usage_event_start(
    'test-server-token', f.user_id, f.workspace_id, f.wallet_id, 'test-tool',
    5, null, null, null, 'retry:in-flight', '{}'::jsonb);
  perform public.t_check('a duplicate of a run still in flight is refused',
    again.status = 'duplicate_request', format('status is %s', again.status));
  perform public.t_check('and the in-flight run was charged exactly once',
    (select balance from public.credit_wallets where id = f.wallet_id) = 5,
    format('balance is %s, expected 5',
      (select balance from public.credit_wallets where id = f.wallet_id)));
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- P0-01d — THE TOKEN GATE IS THE WHOLE POINT.
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare
  f record; v_refused boolean := false;
begin
  raise notice '';
  raise notice 'P0-01d usage_event_start is server-only';
  select * into f from public.t_fixture;
  perform set_config('app.current_user', f.user_id::text, false);

  if to_regprocedure('public.usage_event_start(text,uuid,uuid,uuid,text,integer,text,text,uuid,text,jsonb)') is null then
    perform public.t_check('usage_event_start exists', false, 'the function is absent');
    return;
  end if;

  begin
    perform public.usage_event_start(
      'not-the-server-token', f.user_id, f.workspace_id, f.wallet_id, 'test-tool',
      5, null, null, null, 'start:notoken:1', '{}'::jsonb);
  exception when others then
    v_refused := sqlerrm = 'forbidden';
  end;
  perform public.t_check('a caller without the dispatch token is refused', v_refused,
    'the function ran for a caller that could not prove it was the server');
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- P1-35 — A CHARGE WHOSE ANSWER WAS LOST MUST NOT STAY TAKEN FOREVER.
--
-- usage_event_start commits the event and the debit together. If the response
-- never reaches the application it has no event id, and every door out of a
-- usage event needs one — so the row sits 'pending' and charged with nobody to
-- close it. The reconciler (0102) is the way back. These blocks are the five
-- properties it was required to have, each one attacked rather than asserted.
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare
  f record; v_lost uuid; v_tx uuid; v_bal int; v_row record; n int;
begin
  raise notice '';
  raise notice 'P1-35  the reconciler returns a lost charge, exactly once';
  select * into f from public.t_fixture;
  perform set_config('app.current_user', f.user_id::text, false);

  if to_regprocedure('public.usage_events_reconcile_stale(integer,integer)') is null then
    perform public.t_check('usage_events_reconcile_stale exists', false,
      'the reconciler is absent — a lost response leaves the charge stuck forever');
    return;
  end if;

  -- A REAL charge, through the real RPC, then the response is "lost": nothing
  -- ever calls complete or fail. Backdated past the grace.
  update public.credit_wallets set balance = 10 where id = f.wallet_id;
  select event_id into v_lost from public.usage_event_start(
    'test-server-token', f.user_id, f.workspace_id, f.wallet_id, 'test-tool',
    5, null, null, null, 'lost:response:1', '{}'::jsonb);
  perform public.t_check('the lost run really was charged',
    (select balance from public.credit_wallets where id = f.wallet_id) = 5);
  update public.usage_events set started_at = now() - interval '2 hours' where id = v_lost;

  -- A run that is still legitimately in flight must survive the same sweep.
  perform public.usage_event_start(
    'test-server-token', f.user_id, f.workspace_id, f.wallet_id, 'test-tool',
    0, null, null, null, 'live:inflight:1', '{}'::jsonb);

  perform public.usage_events_reconcile_stale(50, 1800);
  select balance into v_bal from public.credit_wallets where id = f.wallet_id;
  select status, refund_tx_id, idempotency_key into v_row
    from public.usage_events where id = v_lost;

  perform public.t_check('a lost charge is returned', v_bal = 10,
    format('balance is %s, expected 10', v_bal));
  perform public.t_check('the event is closed as refunded', v_row.status = 'refunded',
    format('status is %s', v_row.status));
  perform public.t_check('and its key is released', v_row.idempotency_key is null);
  perform public.t_check('a run still in flight is left alone',
    (select status from public.usage_events where idempotency_key = 'live:inflight:1') = 'pending',
    'the reconciler reaped a live run');

  -- IDEMPOTENT: sweeping again must not pay twice.
  perform public.usage_events_reconcile_stale(50, 1800);
  perform public.usage_events_reconcile_stale(50, 1800);
  select balance into v_bal from public.credit_wallets where id = f.wallet_id;
  select count(*) into n from public.credit_transactions
   where reference_id = v_lost and type = 'refund';
  perform public.t_check('sweeping three times refunds once', v_bal = 10,
    format('balance is %s, expected 10', v_bal));
  perform public.t_check('and writes exactly one refund transaction', n = 1,
    format('%s refund rows', n));
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- P1-35b — DELIVERY OUTRANKS THE CLOCK.
--
-- A run whose images are already in the library was delivered. Refunding it
-- because the bookkeeping call was lost would be a free generation with extra
-- steps — the exact hole P0-01 closed, re-opened from the other side.
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare
  f record; v_job uuid; v_gen uuid; v_ev uuid; v_bal int; v_row record;
  v_session uuid; v_ev2 uuid;
begin
  raise notice '';
  raise notice 'P1-35b a delivered run is closed, not refunded';
  select * into f from public.t_fixture;
  perform set_config('app.current_user', f.user_id::text, false);
  if to_regprocedure('public.usage_events_reconcile_stale(integer,integer)') is null then
    perform public.t_check('usage_events_reconcile_stale exists', false, 'absent');
    return;
  end if;

  -- A generation that stored its images and then died before completeUsage.
  update public.credit_wallets set balance = 10 where id = f.wallet_id;
  insert into public.generation_jobs (workspace_id) values (f.workspace_id) returning id into v_job;
  select event_id into v_ev from public.usage_event_start(
    'test-server-token', f.user_id, f.workspace_id, f.wallet_id, 'test-tool',
    5, null, null, v_job, 'delivered:1', '{}'::jsonb);
  insert into public.generations (job_id) values (v_job) returning id into v_gen;
  insert into public.generation_assets (generation_id) values (v_gen), (v_gen);
  update public.usage_events set started_at = now() - interval '2 hours' where id = v_ev;

  -- A prompt session that wrote its prompts and then died the same way.
  insert into public.prompt_sessions (workspace_id) values (f.workspace_id) returning id into v_session;
  select event_id into v_ev2 from public.usage_event_start(
    'test-server-token', f.user_id, f.workspace_id, f.wallet_id, 'test-tool',
    0, null, null, null, 'delivered:2',
    jsonb_build_object('session_id', v_session::text));
  insert into public.generated_prompts (session_id) values (v_session);
  update public.usage_events set started_at = now() - interval '2 hours' where id = v_ev2;

  perform public.usage_events_reconcile_stale(50, 1800);
  select balance into v_bal from public.credit_wallets where id = f.wallet_id;
  select status, result_count into v_row from public.usage_events where id = v_ev;

  perform public.t_check('a delivered generation is not refunded', v_bal = 5,
    format('balance is %s, expected 5 — the reconciler paid for delivered work', v_bal));
  perform public.t_check('it is closed as succeeded', v_row.status = 'succeeded',
    format('status is %s', v_row.status));
  perform public.t_check('and records what was delivered', v_row.result_count = 2,
    format('result_count is %s, expected 2', v_row.result_count));
  perform public.t_check('a delivered prompt session is closed too',
    (select status from public.usage_events where id = v_ev2) = 'succeeded',
    format('status is %s', (select status from public.usage_events where id = v_ev2)));
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- P1-35d — "SOMETHING ARRIVED" IS NOT "EVERYTHING ARRIVED".
--
-- Found by the adversarial review of P1-35, not by writing this fix. The
-- reconciler treated ANY delivered asset as full delivery and stamped the run
-- `succeeded` at the full price. That state is reachable: runGeneration
-- inserts the assets BEFORE it prices the shortfall and before completeUsage,
-- so an invocation killed in between leaves a run charged for four images
-- that produced one — closed as a success, so nothing ever flags it again.
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare
  f record; v_job uuid; v_gen uuid; v_ev uuid; v_bal int; v_row record;
  v_job2 uuid; v_gen2 uuid; v_ev2 uuid; v_bal2 int;
  v_job3 uuid; v_gen3 uuid; v_ev3 uuid;
begin
  raise notice '';
  raise notice 'P1-35d a partial delivery is closed at the price of what arrived';
  select * into f from public.t_fixture;
  perform set_config('app.current_user', f.user_id::text, false);
  if to_regprocedure('public.usage_events_reconcile_stale(integer,integer)') is null then
    perform public.t_check('usage_events_reconcile_stale exists', false, 'absent');
    return;
  end if;

  -- Charged for four, one image on disk, the bookkeeping call never made.
  update public.credit_wallets set balance = 10 where id = f.wallet_id;
  insert into public.generation_jobs (workspace_id) values (f.workspace_id) returning id into v_job;
  select event_id into v_ev from public.usage_event_start(
    'test-server-token', f.user_id, f.workspace_id, f.wallet_id, 'test-tool',
    4, null, null, v_job, 'short:1', jsonb_build_object('quantity', 4));
  insert into public.generations (job_id) values (v_job) returning id into v_gen;
  insert into public.generation_assets (generation_id) values (v_gen);
  update public.usage_events set started_at = now() - interval '2 hours' where id = v_ev;

  perform public.usage_events_reconcile_stale(50, 1800);
  select balance into v_bal from public.credit_wallets where id = f.wallet_id;
  select status, result_count, credits_charged into v_row
    from public.usage_events where id = v_ev;

  -- 10 − 4 charged + 3 returned = 9. The seller keeps paying for the one
  -- image they actually received, and not for the three they did not.
  perform public.t_check('the shortfall comes back', v_bal = 9,
    format('balance is %s, expected 9 — four credits for one image', v_bal));
  perform public.t_check('the run is still closed as delivered', v_row.status = 'succeeded',
    format('status is %s', v_row.status));
  perform public.t_check('the price becomes what arrived', v_row.credits_charged = 1,
    format('credits_charged is %s, expected 1', v_row.credits_charged));
  perform public.t_check('and it records how much that was', v_row.result_count = 1,
    format('result_count is %s', v_row.result_count));

  -- A second sweep must not pay again. The row has left 'pending', so it
  -- cannot even be selected — this asserts the belt, not the theory.
  perform public.usage_events_reconcile_stale(50, 1800);
  select balance into v_bal2 from public.credit_wallets where id = f.wallet_id;
  perform public.t_check('a second sweep returns nothing more', v_bal2 = 9,
    format('balance moved to %s on the second pass', v_bal2));

  -- A shortfall the APPLICATION already priced is not priced twice. The
  -- marker is the same one usage_event_refund_partial writes.
  update public.credit_wallets set balance = 10 where id = f.wallet_id;
  insert into public.generation_jobs (workspace_id) values (f.workspace_id) returning id into v_job2;
  select event_id into v_ev2 from public.usage_event_start(
    'test-server-token', f.user_id, f.workspace_id, f.wallet_id, 'test-tool',
    4, null, null, v_job2, 'short:2', jsonb_build_object('quantity', 4));
  insert into public.generations (job_id) values (v_job2) returning id into v_gen2;
  insert into public.generation_assets (generation_id) values (v_gen2);
  update public.usage_events
     set started_at = now() - interval '2 hours',
         metadata = metadata || jsonb_build_object('partial_refund_tx', gen_random_uuid()::text)
   where id = v_ev2;

  perform public.usage_events_reconcile_stale(50, 1800);
  select balance into v_bal2 from public.credit_wallets where id = f.wallet_id;
  perform public.t_check('an already-priced shortfall is not refunded again', v_bal2 = 6,
    format('balance is %s, expected 6 — the reconciler paid a second time', v_bal2));

  -- And a run that delivered everything it was charged for is untouched.
  update public.credit_wallets set balance = 10 where id = f.wallet_id;
  insert into public.generation_jobs (workspace_id) values (f.workspace_id) returning id into v_job3;
  select event_id into v_ev3 from public.usage_event_start(
    'test-server-token', f.user_id, f.workspace_id, f.wallet_id, 'test-tool',
    2, null, null, v_job3, 'short:3', jsonb_build_object('quantity', 2));
  insert into public.generations (job_id) values (v_job3) returning id into v_gen3;
  insert into public.generation_assets (generation_id) values (v_gen3), (v_gen3);
  update public.usage_events set started_at = now() - interval '2 hours' where id = v_ev3;

  perform public.usage_events_reconcile_stale(50, 1800);
  perform public.t_check('a full delivery is not refunded at all',
    (select balance from public.credit_wallets where id = f.wallet_id) = 8,
    format('balance is %s, expected 8',
           (select balance from public.credit_wallets where id = f.wallet_id)));
  perform public.t_check('and keeps its full price',
    (select credits_charged from public.usage_events where id = v_ev3) = 2,
    format('credits_charged is %s',
           (select credits_charged from public.usage_events where id = v_ev3)));
end $$;

-- ───────────────────────────────────────────────────────────────────────────
-- P1-35c — AN UNCHARGED STALE EVENT IS CLOSED, NOT PAID.
-- 0099's rule again: no receipt, no refund. Production carries two such rows
-- from before 0100, so this is the case the first real sweep will meet.
-- ───────────────────────────────────────────────────────────────────────────
do $$
declare f record; v_ev uuid; v_bal int; v_row record;
begin
  raise notice '';
  raise notice 'P1-35c an uncharged stale event is closed without paying';
  select * into f from public.t_fixture;
  perform set_config('app.current_user', f.user_id::text, false);
  if to_regprocedure('public.usage_events_reconcile_stale(integer,integer)') is null then
    perform public.t_check('usage_events_reconcile_stale exists', false, 'absent');
    return;
  end if;

  update public.credit_wallets set balance = 7 where id = f.wallet_id;
  insert into public.usage_events
    (user_id, workspace_id, service_slug, credits_charged, status, credit_tx_id,
     started_at, idempotency_key)
  values (f.user_id, f.workspace_id, 'test-tool', 5, 'pending', null,
          now() - interval '3 hours', 'legacy:uncharged:1')
  returning id into v_ev;

  perform public.usage_events_reconcile_stale(50, 1800);
  select balance into v_bal from public.credit_wallets where id = f.wallet_id;
  select status, credits_charged, idempotency_key into v_row
    from public.usage_events where id = v_ev;

  perform public.t_check('no receipt, no refund', v_bal = 7,
    format('balance moved to %s — credits were created from nothing', v_bal));
  perform public.t_check('the row is closed as failed', v_row.status = 'failed',
    format('status is %s', v_row.status));
  perform public.t_check('and stops claiming a price nobody paid',
    v_row.credits_charged = 0, format('credits_charged is %s', v_row.credits_charged));
  perform public.t_check('its key is released', v_row.idempotency_key is null);
end $$;

-- ── summary ────────────────────────────────────────────────────────────────
do $$
declare n int;
begin
  select count(*) into n from public.t_failures;
  raise notice '';
  if n = 0 then
    raise notice 'ledger-sql: all checks passed';
  else
    raise notice 'ledger-sql: % check(s) failed', n;
  end if;
end $$;

select count(*) from public.t_failures;
