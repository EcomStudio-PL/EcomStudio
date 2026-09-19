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
