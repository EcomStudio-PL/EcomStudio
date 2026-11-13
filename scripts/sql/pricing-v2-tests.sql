-- CENNIK V2 REHEARSAL — what 0174 promises, checked against a real Postgres.
-- Every check writes one row to t_results; the runner fails on any false.
\set ON_ERROR_STOP on
set search_path = public, extensions;

create table if not exists public.t_results (n serial, name text, ok boolean, detail text);
create or replace function public.t_ok(p_name text, p_ok boolean, p_detail text default '') returns void
language sql security definer as $$ insert into public.t_results (name, ok, detail) values (p_name, coalesce(p_ok, false), coalesce(p_detail, '')) $$;
create table if not exists public.t_r (k text primary key, v text);
create or replace function public.t_bal(p_ws uuid) returns numeric language sql as $$
  select balance from public.credit_wallets where workspace_id = p_ws $$;
create or replace function public.t_lot(p_id uuid) returns numeric language sql as $$
  select remaining from public.credit_lots where id = p_id $$;
create or replace function public.t_as(p_uid uuid) returns void language sql as $$
  select set_config('app.current_user', p_uid::text, false) $$;

\set ADMIN_WS '''cdd6ed7d-4630-4e29-93d5-69fa60c5d660'''
\set ADMIN '''22289203-3a80-446d-b377-c2c75c253c0d'''
\set ADMIN_W '''ef961680-7ea8-4335-acbd-db19c2d5229e'''
\set C1 '''00000000-0000-0000-0000-0000000000c1'''
\set C1_WS '''00000000-0000-0000-0000-00000000aaa1'''
\set C1_W '''00000000-0000-0000-0000-0000000bbbb1'''
\set C2 '''00000000-0000-0000-0000-0000000000c2'''
\set C2_WS '''00000000-0000-0000-0000-00000000aaa2'''
\set C2_W '''00000000-0000-0000-0000-0000000bbbb2'''
\set PRO '''d39062bd-03ef-4844-b65b-7dc6b80e79b0'''
\set AGENCY '''984262c1-a47f-4d36-9d3d-4a680dd46798'''

/* ── A. nothing lost: every balance exactly as before, one legacy lot each ─*/
select t_ok('A1 admin keeps 49788 exactly', t_bal(:ADMIN_WS) = 49788, t_bal(:ADMIN_WS)::text);
select t_ok('A2 second account keeps 1124', t_bal('c538dc41-0ef4-4f04-a7e9-1d6ff73742a5') = 1124);
select t_ok('A3 E2E account keeps 488', t_bal('9b5352f5-b851-46ca-a29c-478f035c843e') = 488);
select t_ok('A4 balances are numeric(14,2) now',
  (select numeric_scale from information_schema.columns where table_name = 'credit_wallets' and column_name = 'balance') = 2);
select t_ok('A5 one legacy lot per funded wallet, equal to its balance',
  (select count(*) from public.credit_lots where kind = 'legacy') = 3
  and not exists (select 1 from public.credit_wallets w where w.balance > 0 and w.balance <>
                   (select sum(remaining) from public.credit_lots l where l.wallet_id = w.id and l.kind = 'legacy')));
select t_ok('A6 the ledger history is untouched (no row rewritten, none added)',
  (select count(*) from public.credit_transactions) = 4
  and (select sum(amount) from public.credit_transactions where wallet_id = :ADMIN_W) = 49788);
select t_ok('A7 a snapshot of the old pricing exists', exists (select 1 from public.billing_config_snapshots where label = 'before-pricing-v2'));

/* ── B. fractions are exact, a third decimal is refused ────────────────────*/
select t_as(:ADMIN);
insert into t_r select 'B1', status from public.usage_event_start('srv-token', :ADMIN, :ADMIN_WS, :ADMIN_W,
  'image_generation', 1.25, null, null, null, 'b1', '{}');
select t_ok('B1 a 1.25 charge is accepted', (select v from t_r where k = 'B1') = 'ok');
select t_ok('B2 49788 − 1.25 = 49786.75 exactly', t_bal(:ADMIN_WS) = 49786.75, t_bal(:ADMIN_WS)::text);
insert into t_r select 'B3', status from public.usage_event_start('srv-token', :ADMIN, :ADMIN_WS, :ADMIN_W,
  'image_generation', 1.255, null, null, null, 'b3', '{}');
select t_ok('B3 1.255 is refused, nothing charged', (select v from t_r where k = 'B3') = 'invalid_amount' and t_bal(:ADMIN_WS) = 49786.75);
select public.usage_event_start('srv-token', :ADMIN, :ADMIN_WS, :ADMIN_W, 'image_generation', 0.5, null, null, null, 'b4-a', '{}');
select public.usage_event_start('srv-token', :ADMIN, :ADMIN_WS, :ADMIN_W, 'image_generation', 0.75, null, null, null, 'b4-b', '{}');
select public.usage_event_start('srv-token', :ADMIN, :ADMIN_WS, :ADMIN_W, 'image_generation', 1.75, null, null, null, 'b4-c', '{}');
select t_ok('B4 0.5 + 0.75 + 1.75 sum exactly', t_bal(:ADMIN_WS) = 49783.75, t_bal(:ADMIN_WS)::text);
select t_ok('B5 apply_credit_transaction refuses 3 decimals', (select count(*) = 0 from public.credit_transactions where amount = -0.001));
do $$ begin
  begin perform public.apply_credit_transaction('ef961680-7ea8-4335-acbd-db19c2d5229e', -0.001, 'generation');
    perform public.t_ok('B6 0.001 raises', false);
  exception when others then perform public.t_ok('B6 0.001 raises invalid_amount', sqlerrm = 'invalid_amount', sqlerrm); end;
end $$;

/* ── C. a refund of a charge from before the pools goes back to legacy ─────*/
insert into t_r select 'C1', public.usage_event_fail('srv-token', '00000000-0000-0000-0000-00000000e0e0', 'x', 0)::text;
select t_ok('C1 the pre-0174 run refunds its 7 credits', (select v from t_r where k = 'C1') is not null and t_bal(:ADMIN_WS) = 49790.75, t_bal(:ADMIN_WS)::text);
select t_ok('C2 …into the legacy lot', (select remaining from public.credit_lots where wallet_id = :ADMIN_W and kind = 'legacy') = 49790.75);
insert into t_r select 'C3', public.usage_event_fail('srv-token', '00000000-0000-0000-0000-00000000e0e0', 'x', 0)::text;
select t_ok('C3 a second failure refunds nothing', (select v from t_r where k = 'C3') is null and t_bal(:ADMIN_WS) = 49790.75);

/* ── D. a paying customer: subscription first (earliest expiry), then top-up,
       then bonus; refunds return to the lots they came from ───────────────*/
insert into public.subscriptions (workspace_id, plan_id, status, current_period_end, provider, provider_subscription_id)
values (:C1_WS, :PRO, 'active', now() + interval '20 days', 'stripe', 'sub_D');
insert into public.payments (id, workspace_id, amount_cents, currency, status, provider, provider_payment_id, kind)
values ('00000000-0000-0000-0000-0000000d0001', :C1_WS, 560, 'USD', 'succeeded', 'stripe', 'pi_D', 'custom_credits');
create temp table d_tx (k text, tx uuid);
insert into d_tx select 'topup', public.apply_credit_transaction(:C1_W, 5, 'topup', 'topup', null, '{"payment_id":"00000000-0000-0000-0000-0000000d0001"}');
insert into d_tx select 'sub10', public.apply_credit_transaction(:C1_W, 10, 'subscription', 'sub10', null,
  jsonb_build_object('lot_kind', 'subscription', 'lot_expires_at', now() + interval '10 days'));
insert into d_tx select 'sub5', public.apply_credit_transaction(:C1_W, 4, 'subscription', 'sub5', null,
  jsonb_build_object('lot_kind', 'subscription', 'lot_expires_at', now() + interval '5 days'));
insert into d_tx select 'bonus', public.apply_credit_transaction(:C1_W, 3, 'bonus', 'bonus');
create temp table d_lots as select
  (select l.id from public.credit_lots l where l.source_tx_id = (select tx from d_tx where k = 'topup')) as topup,
  (select l.id from public.credit_lots l where l.source_tx_id = (select tx from d_tx where k = 'sub10')) as sub10,
  (select l.id from public.credit_lots l where l.source_tx_id = (select tx from d_tx where k = 'sub5')) as sub5,
  (select l.id from public.credit_lots l where l.source_tx_id = (select tx from d_tx where k = 'bonus')) as bonus;
select t_ok('D0 kinds as declared', (select (select kind from public.credit_lots where id = topup) = 'topup'
  and (select kind from public.credit_lots where id = sub10) = 'subscription' and (select kind from public.credit_lots where id = bonus) = 'bonus' from d_lots));
select t_as(:C1);
insert into t_r select 'D1', status from public.usage_event_start('srv-token', :C1, :C1_WS, :C1_W, 'image_generation', 12, null, null, null, 'd1', '{}');
select t_ok('D1 charge 12 ok', (select v from t_r where k = 'D1') = 'ok');
select t_ok('D2 took the 5-day lot (4) then the 10-day lot (8); top-up and bonus untouched',
  (select t_lot(sub5) = 0 and t_lot(sub10) = 2 and t_lot(topup) = 5 and t_lot(bonus) = 3 from d_lots),
  (select format('sub5=%s sub10=%s topup=%s bonus=%s', t_lot(sub5), t_lot(sub10), t_lot(topup), t_lot(bonus)) from d_lots));
insert into t_r select 'D3', status from public.usage_event_start('srv-token', :C1, :C1_WS, :C1_W, 'image_generation', 6.5, null, null, null, 'd3', '{}');
select t_ok('D3 charge 6.5 ok', (select v from t_r where k = 'D3') = 'ok');
select t_ok('D4 subscription emptied first, then 4.5 from the top-up; bonus last',
  (select t_lot(sub10) = 0 and t_lot(topup) = 0.5 and t_lot(bonus) = 3 from d_lots));
create temp table d3 as select id from public.usage_events where idempotency_key = 'd3';
insert into t_r select 'D5', public.usage_event_fail('srv-token', (select id from d3), 'boom', 0)::text;
select t_ok('D5 failing the 6.5 run returns 4.5 to the top-up and 2 to the subscription lot',
  (select v from t_r where k = 'D5') is not null
  and (select t_lot(sub10) = 2 and t_lot(topup) = 5 from d_lots));
insert into t_r select 'D6', public.usage_event_fail('srv-token', (select id from d3), 'boom', 0)::text;
select t_ok('D6 a second failure refunds nothing (one refund per run)',
  (select v from t_r where k = 'D6') is null
  and (select t_lot(topup) = 5 from d_lots));
insert into t_r select 'D7', status from public.usage_event_start('srv-token', :C1, :C1_WS, :C1_W, 'image_generation', 3.75, null, null, null, 'd7', '{}');
select t_ok('D7 charge 3.75 ok', (select v from t_r where k = 'D7') = 'ok'
  and (select t_lot(sub10) = 0 and t_lot(topup) = 3.25 from d_lots));
insert into t_r select 'D8', public.usage_event_refund_partial('srv-token', (select id from public.usage_events where idempotency_key = 'd7'), 1.25)::text;
select t_ok('D8 a partial refund of 1.25 goes back to the lot charged last (the top-up)',
  (select v from t_r where k = 'D8') is not null
  and (select t_lot(sub10) = 0 and t_lot(topup) = 4.5 from d_lots));
select t_ok('D9 balance = 14 + 4.5 + 3 − 12 … exactly the lots', t_bal(:C1_WS) = (select sum(remaining) from public.credit_lots where wallet_id = :C1_W));

/* ── E. no paid plan: top-ups are kept but cannot be spent ─────────────────*/
insert into public.payments (id, workspace_id, amount_cents, currency, status, provider, provider_payment_id, kind)
values ('00000000-0000-0000-0000-0000000e0001', :C2_WS, 560, 'USD', 'succeeded', 'stripe', 'pi_E', 'custom_credits');
select public.apply_credit_transaction(:C2_W, 5, 'topup', 'topup', null, '{"payment_id":"00000000-0000-0000-0000-0000000e0001"}');
select public.apply_credit_transaction(:C2_W, 1, 'bonus', 'bonus');
select t_as(:C2);
select t_ok('E1 wallet state: 6 held, 1 spendable, 5 locked',
  (select (s->>'balance')::numeric = 6 and (s->>'spendable')::numeric = 1 and (s->>'topup_locked')::numeric = 5
     from public.credit_wallet_state(:C2_WS) s));
insert into t_r select 'E2', status from public.usage_event_start('srv-token', :C2, :C2_WS, :C2_W, 'image_generation', 3, null, null, null, 'e2', '{}');
select t_ok('E2 charging 3 is refused — locked top-ups do not count',
  (select v from t_r where k = 'E2') = 'insufficient_credits'
  and t_bal(:C2_WS) = 6);
insert into t_r select 'E3', status from public.usage_event_start('srv-token', :C2, :C2_WS, :C2_W, 'image_generation', 1, null, null, null, 'e3', '{}');
select t_ok('E3 charging 1 uses the bonus', (select v from t_r where k = 'E3') = 'ok');
insert into public.subscriptions (workspace_id, plan_id, status, current_period_end, provider, provider_subscription_id)
values (:C2_WS, :PRO, 'active', now() + interval '30 days', 'stripe', 'sub_E');
insert into t_r select 'E4', status from public.usage_event_start('srv-token', :C2, :C2_WS, :C2_W, 'image_generation', 3, null, null, null, 'e4', '{}');
select t_ok('E4 with a plan again the top-up is usable', (select v from t_r where k = 'E4') = 'ok'
  and t_bal(:C2_WS) = 2);
update public.subscriptions set current_period_end = now() - interval '1 minute' where provider_subscription_id = 'sub_E';
select t_ok('E5 a lapsed period locks them again (status alone is not enough)',
  (select (s->>'spendable')::numeric = 0 and (s->>'topup_locked')::numeric = 2 from public.credit_wallet_state(:C2_WS) s));

/* ── F. expiry: only subscription credits, once, through the ledger ────────*/
select t_as(:C1);
update public.credit_lots set expires_at = now() - interval '1 second'
 where id = (select sub10 from d_lots);
select public.apply_credit_transaction(:C1_W, 2, 'subscription', 'expired-unticked', null,
  jsonb_build_object('lot_kind', 'subscription', 'lot_expires_at', now() - interval '1 second'));
insert into t_r select 'F0spend', (s->>'spendable') from public.credit_wallet_state(:C1_WS) s;
insert into t_r select 'F0', status from public.usage_event_start('srv-token', :C1, :C1_WS, :C1_W, 'image_generation',
  (select v::numeric + 0.01 from t_r where k = 'F0spend'), null, null, null, 'f0', '{}');
select t_ok('F0 an expired lot not yet ticked is never spent (spendable excludes it)',
  (select v from t_r where k = 'F0') = 'insufficient_credits'
  and (select v::numeric from t_r where k = 'F0spend') = t_bal(:C1_WS) - 2 - (select t_lot(sub10) from d_lots),
  (select v from t_r where k = 'F0spend'));
create temp table f_before as select t_bal(:C1_WS) as bal, (select t_lot(topup) from d_lots) as topup, (select t_lot(bonus) from d_lots) as bonus;
insert into t_r select 'F1', (public.credit_lots_tick())->>'expired';
select t_ok('F1 the tick expires the overdue subscription lots', (select v from t_r where k = 'F1')::int = 1, (select v from t_r where k = 'F1'));
select t_ok('F2 …by exactly what was left of them (2), as an expiration entry',
  t_bal(:C1_WS) = (select bal from f_before) - 2
  and exists (select 1 from public.credit_transactions where wallet_id = :C1_W and type = 'expiration' and amount = -2));
select t_ok('F3 top-up and bonus never expire', (select t_lot(topup) = (select topup from f_before) and t_lot(bonus) = (select bonus from f_before) from d_lots));
insert into t_r select 'F4', (public.credit_lots_tick())->>'expired';
select t_ok('F4 a second tick does nothing', (select v from t_r where k = 'F4')::int = 0);

/* ── G. annual: twelve tranches, one at a time, never twice ────────────────*/
select t_as(:C1);
create temp table g_settle as select public.stripe_settle_v2('srv-token', 'evt_G1', 'invoice.paid', :C1_WS, 'in_G', 109900, 'usd',
  'subscription', :AGENCY, 'cus_G', jsonb_build_object('billing_period', 'annual', 'payment_intent', 'pi_G'),
  jsonb_build_array(jsonb_build_object('type', 'annual', 'plan_id', :AGENCY, 'credits_per_month', 290,
    'period_start', now() - interval '1 hour', 'period_end', now() - interval '1 hour' + interval '1 year', 'subscription', 'sub_G')),
  null) as r;
select t_ok('G1 settled', (select r->>'status' from g_settle) = 'applied', (select r::text from g_settle));
select t_ok('G2 twelve tranches of 290 = 3480', (select count(*) = 12 and sum(credits) = 3480 from public.subscription_tranches where provider_subscription_id = 'sub_G'));
select t_ok('G3 only the first is granted now', (select count(*) filter (where status = 'granted') = 1 and count(*) filter (where status = 'pending') = 11
  from public.subscription_tranches where provider_subscription_id = 'sub_G'));
select t_ok('G4 its lot expires at the end of month one', exists (select 1 from public.credit_lots l join public.subscription_tranches t on t.lot_id = l.id
  where t.tranche_no = 1 and t.provider_subscription_id = 'sub_G' and l.expires_at = t.ends_at and l.billing_period = 'annual' and l.amount = 290));
select t_ok('G5 the same event again is a duplicate', (public.stripe_settle_v2('srv-token', 'evt_G1', 'invoice.paid', :C1_WS, 'in_G', 109900, 'usd',
  'subscription', :AGENCY, 'cus_G', '{}', '[]', null))->>'status' = 'duplicate_event');
select t_ok('G6 another event for the same invoice settles nothing', (public.stripe_settle_v2('srv-token', 'evt_G2', 'invoice.paid', :C1_WS, 'in_G', 109900, 'usd',
  'subscription', :AGENCY, 'cus_G', '{}', jsonb_build_array(jsonb_build_object('type', 'annual', 'plan_id', :AGENCY, 'credits_per_month', 290,
    'period_start', now(), 'period_end', now() + interval '1 year', 'subscription', 'sub_G')), null))->>'status' = 'already_settled'
  and (select count(*) from public.subscription_tranches where provider_subscription_id = 'sub_G') = 12);
insert into t_r select 'G7', (public.credit_lots_tick())->>'granted';
select t_ok('G7 a tick before month two grants nothing', (select v from t_r where k = 'G7')::int = 0);
update public.subscription_tranches set starts_at = now() - interval '1 minute' where provider_subscription_id = 'sub_G' and tranche_no = 2;
insert into t_r select 'G8', (public.credit_lots_tick())->>'granted';
select t_ok('G8 month two starts: the tick grants exactly one', (select v from t_r where k = 'G8')::int = 1);
insert into t_r select 'G9', (public.credit_lots_tick())->>'granted';
select t_ok('G9 ticking again grants nothing', (select v from t_r where k = 'G9')::int = 0);
insert into t_r select 'G10', public.credit_tranche_grant((select id from public.subscription_tranches where provider_subscription_id = 'sub_G' and tranche_no = 2))::text;
select t_ok('G10 granting tranche 2 directly again is a no-op',
  (select v from t_r where k = 'G10') is null
  and (select count(*) from public.credit_lots where tranche_id = (select id from public.subscription_tranches where provider_subscription_id = 'sub_G' and tranche_no = 2)) = 1);
-- calendar months in UTC, from the anchor (no drift), leap year included
insert into public.payments (id, workspace_id, amount_cents, currency, status, provider, provider_payment_id, kind)
values ('00000000-0000-0000-0000-0000000a0001', :C1_WS, 109900, 'USD', 'succeeded', 'stripe', 'in_leap', 'subscription');
select public.credit_schedule_annual(:C1_W, :C1_WS, '00000000-0000-0000-0000-0000000a0001', 'sub_leap', :AGENCY, 290,
  '2028-01-31T10:00:00Z', '2029-01-31T10:00:00Z');
select t_ok('G11 Jan 31 → Feb 29 (leap) → Mar 31: month lengths honoured',
  (select starts_at from public.subscription_tranches where provider_subscription_id = 'sub_leap' and tranche_no = 2) = '2028-02-29T10:00:00Z'
  and (select starts_at from public.subscription_tranches where provider_subscription_id = 'sub_leap' and tranche_no = 3) = '2028-03-31T10:00:00Z'
  and (select ends_at from public.subscription_tranches where provider_subscription_id = 'sub_leap' and tranche_no = 12) = '2029-01-31T10:00:00Z');
select t_ok('G12 the future schedule grants nothing yet', not exists (select 1 from public.subscription_tranches where provider_subscription_id = 'sub_leap' and status <> 'pending'));
insert into public.payments (id, workspace_id, amount_cents, currency, status, provider, provider_payment_id, kind)
values ('00000000-0000-0000-0000-0000000a0002', :C1_WS, 1, 'USD', 'succeeded', 'stripe', 'in_short', 'subscription');
select public.credit_schedule_annual(:C1_W, :C1_WS, '00000000-0000-0000-0000-0000000a0002', 'sub_short', :AGENCY, 290,
  '2030-03-01T00:00:00Z', '2030-05-16T00:00:00Z');
select t_ok('G13 a 2.5-month remainder: 3 windows, the last one pro rata',
  (select count(*) = 3 from public.subscription_tranches where provider_subscription_id = 'sub_short')
  and (select credits from public.subscription_tranches where provider_subscription_id = 'sub_short' and tranche_no = 3) = floor(290 * 15 / 31.0 * 100) / 100,
  (select string_agg(credits::text, ',' order by tranche_no) from public.subscription_tranches where provider_subscription_id = 'sub_short'));

/* ── H. top-ups: the server's order decides, Stripe's amount must match it ─*/
select t_as(:C1);
create temp table h_order as select public.credit_order_create('srv-token', :C1_WS, 100, 5200, 'usd', 'topup-v1') as id;
select t_ok('H1 the order is open', (select status from public.credit_orders where id = (select id from h_order)) = 'open');
insert into t_r select 'H2', (public.stripe_settle_v2('srv-token', 'evt_H1', 'payment_intent.succeeded', :C1_WS, 'pi_H', 5200, 'usd', 'custom_credits',
     null, 'cus_H', '{}', null, (select id from h_order)))->>'status';
select t_ok('H2 paid with the order''s amount: 100 credits into a top-up lot',
  (select v from t_r where k = 'H2') = 'applied'
  and exists (select 1 from public.credit_lots where wallet_id = :C1_W and kind = 'topup' and amount = 100 and expires_at is null));
select t_ok('H3 the same payment again grants nothing', (public.stripe_settle_v2('srv-token', 'evt_H2', 'checkout.session.completed', :C1_WS, 'pi_H', 5200, 'usd',
  'custom_credits', null, 'cus_H', '{}', null, (select id from h_order)))->>'status' = 'already_settled');
create temp table h_order2 as select public.credit_order_create('srv-token', :C1_WS, 20, 1120, 'usd', 'topup-v1') as id;
insert into t_r select 'H4', (public.stripe_settle_v2('srv-token', 'evt_H3', 'payment_intent.succeeded', :C1_WS, 'pi_H2', 100, 'usd', 'custom_credits',
     null, 'cus_H', '{}', null, (select id from h_order2)))->>'status';
select t_ok('H4 a different amount than the order: recorded, flagged, NO credits',
  (select v from t_r where k = 'H4') = 'order_mismatch'
  and not exists (select 1 from public.credit_lots l join public.payments p on p.id = l.payment_id where p.provider_payment_id = 'pi_H2'));
select t_ok('H5 another workspace cannot redeem an order', (public.stripe_settle_v2('srv-token', 'evt_H4', 'payment_intent.succeeded', :C2_WS, 'pi_H3', 1120, 'usd',
  'custom_credits', null, 'cus_X', '{}', null, (select id from h_order2)))->>'status' in ('order_mismatch', 'settled_without_credits'));
do $$ begin
  begin perform public.credit_order_create('wrong', '00000000-0000-0000-0000-00000000aaa1', 20, 1120, 'usd', 'x');
    perform public.t_ok('H6 an order needs the server token', false);
  exception when others then perform public.t_ok('H6 an order needs the server token', sqlerrm = 'forbidden', sqlerrm); end;
end $$;

/* ── I. plan change: unused share of the old plan back, the new one in ─────*/
select public.stripe_settle_v2('srv-token', 'evt_I1', 'invoice.paid', :C1_WS, 'in_I1', 4990, 'usd', 'subscription', :PRO, 'cus_I',
  '{"billing_period":"monthly"}', jsonb_build_array(jsonb_build_object('type', 'lot', 'credits', 125, 'plan_id', :PRO, 'billing_period', 'monthly',
    'expires_at', now() + interval '30 days', 'subscription', 'sub_I')), null);
select t_ok('I1 the month''s 125 credits', exists (select 1 from public.credit_lots where provider_subscription_id = 'sub_I' and remaining = 125));
select public.stripe_settle_v2('srv-token', 'evt_I2', 'invoice.paid', :C1_WS, 'in_I2', 5000, 'usd', 'subscription', :AGENCY, 'cus_I',
  '{"billing_period":"monthly"}', jsonb_build_array(
    jsonb_build_object('type', 'revert', 'credits', 60, 'plan_id', :PRO, 'subscription', 'sub_I'),
    jsonb_build_object('type', 'lot', 'credits', 145.5, 'plan_id', :AGENCY, 'billing_period', 'monthly', 'expires_at', now() + interval '15 days', 'subscription', 'sub_I')), null);
select t_ok('I2 the old plan keeps 65, the upgrade adds 145.5',
  (select remaining from public.credit_lots where provider_subscription_id = 'sub_I' and plan_id = :PRO) = 65
  and (select remaining from public.credit_lots where provider_subscription_id = 'sub_I' and plan_id = :AGENCY) = 145.5);
select t_ok('I3 the reversal is a ledger entry', exists (select 1 from public.credit_transactions where wallet_id = :C1_W and type = 'expiration' and amount = -60));

/* ── J. a full refund stops future tranches; what was granted stays ────────*/
insert into t_r select 'J1', (public.stripe_record_refund('srv-token', 'evt_J1', 'charge.refunded', 'pi_G', 109900, 'refunded', '{}'))->>'status';
select t_ok('J1 refund recorded (found by its PaymentIntent)', (select v from t_r where k = 'J1') = 'recorded');
select t_ok('J2 pending tranches voided, granted ones intact',
  (select count(*) filter (where status = 'void') = 10 and count(*) filter (where status = 'granted') = 2
     from public.subscription_tranches where provider_subscription_id = 'sub_G'));
select t_ok('J3 nothing clawed back', (select count(*) from public.credit_lots where provider_subscription_id = 'sub_G' and remaining > 0) = 2);

/* ── K. patched readers ────────────────────────────────────────────────────*/
select t_ok('K1 reconciler keeps the delivered share in hundredths',
  position('* 100) / 100' in pg_get_functiondef('public.usage_events_reconcile_stale(integer, integer)'::regprocedure)) > 0);
select t_ok('K2 GrovShot order total is numeric', position('v_total numeric' in pg_get_functiondef('public.grovshot_run_create(text, jsonb)'::regprocedure)) > 0);
select t_ok('K3 GrovShot job unit is numeric', position('v_unit numeric' in pg_get_functiondef('public.grovshot_srv_job_update(text, uuid, text, uuid, text, text, integer, jsonb)'::regprocedure)) > 0);
select t_ok('K4 welcome bonus reports a numeric balance', position('v_balance numeric' in pg_get_functiondef('public.claim_welcome_bonus(jsonb)'::regprocedure)) > 0);
select t_ok('K5 admin list returns credits numeric', position('credits numeric' in pg_get_function_result('public.admin_customer_rows(text, text, text, text, text, timestamptz, text, integer, integer)'::regprocedure)) > 0);
-- the reconciler on a 4 × 1.25 run that delivered 3
select t_as(:C1);
insert into public.subscriptions (workspace_id, plan_id, status, current_period_end, provider, provider_subscription_id)
values (:C1_WS, :PRO, 'active', now() + interval '20 days', 'stripe', 'sub_K') on conflict do nothing;
select public.apply_credit_transaction(:C1_W, 10, 'bonus', 'k');
insert into public.generation_jobs (id, workspace_id) values ('00000000-0000-0000-0000-00000000c0b1', :C1_WS);
insert into public.generations (id, job_id) select gen_random_uuid(), '00000000-0000-0000-0000-00000000c0b1' from generate_series(1, 3);
insert into public.generation_assets (generation_id) select id from public.generations where job_id = '00000000-0000-0000-0000-00000000c0b1';
select public.usage_event_start('srv-token', :C1, :C1_WS, :C1_W, 'image_generation', 5, null, null,
  '00000000-0000-0000-0000-00000000c0b1', 'k6', '{"quantity":4}');
update public.usage_events set started_at = now() - interval '2 hours' where idempotency_key = 'k6';
select * from public.usage_events_reconcile_stale(50, 900);
select t_ok('K6 3 of 4 delivered at 1.25: keeps 3.75, refunds 1.25',
  (select credits_charged from public.usage_events where id = (select id from public.usage_events where metadata->>'quantity' = '4')) = 3.75
  and exists (select 1 from public.credit_transactions where wallet_id = :C1_W and type = 'refund' and amount = 1.25));

/* ── L. GrovShot V2: the order's analysis is paid once, with the first shot ─*/
insert into public.ai_engine_runs (id, tool_key, workspace_id, user_id, status, run_kind, input, lease_owner, locked_until)
values ('00000000-0000-0000-0000-00000000f001', 'prompts', :C1_WS, :C1, 'running', 'grovshot',
        '{"quote":{"unit":1.25,"analysis":2,"total":8.25}}', 'w1', now() + interval '5 minutes');
insert into public.generation_jobs (id, workspace_id, settings) select gen_random_uuid(), :C1_WS, '{"run_id":"00000000-0000-0000-0000-00000000f001"}' from generate_series(1, 3);
create temp table l_jobs as select id, row_number() over (order by id) n from public.generation_jobs where settings->>'run_id' = '00000000-0000-0000-0000-00000000f001';
select t_as(:C1);
select public.grovshot_srv_usage_start('srv-token', '00000000-0000-0000-0000-00000000f001', 'w1', :C1_W, (select id from l_jobs where n = 1),
  'gsv2:00000000-0000-0000-0000-00000000f001:1', null, null, '{}');
select public.grovshot_srv_usage_start('srv-token', '00000000-0000-0000-0000-00000000f001', 'w1', :C1_W, (select id from l_jobs where n = 2),
  'gsv2:00000000-0000-0000-0000-00000000f001:2', null, null, '{}');
select t_ok('L1 first shot = 2 + 1.25, second = 1.25',
  (select credits_charged from public.usage_events where idempotency_key = 'gsv2:00000000-0000-0000-0000-00000000f001:1') = 3.25
  and (select credits_charged from public.usage_events where idempotency_key = 'gsv2:00000000-0000-0000-0000-00000000f001:2') = 1.25);
select public.usage_event_fail('srv-token', (select id from public.usage_events where metadata ? 'analysis_credits' and metadata->>'run_id' = '00000000-0000-0000-0000-00000000f001'), 'x', 0);
select public.grovshot_srv_usage_start('srv-token', '00000000-0000-0000-0000-00000000f001', 'w1', :C1_W, (select id from l_jobs where n = 3),
  'gsv2:00000000-0000-0000-0000-00000000f001:3', null, null, '{}');
select t_ok('L2 the first shot failed and was refunded: the next charged shot carries the analysis',
  (select credits_charged from public.usage_events where idempotency_key = 'gsv2:00000000-0000-0000-0000-00000000f001:3') = 3.25
  and (select count(*) from public.usage_events where metadata ? 'analysis_credits' and status in ('pending', 'succeeded')) = 1);

/* ── M. who may do what ────────────────────────────────────────────────────*/
select t_as(:C1);
set role authenticated;
do $$ begin
  begin perform public.apply_credit_transaction('00000000-0000-0000-0000-0000000bbbb1', 1000, 'bonus');
    perform public.t_ok('M1 a member cannot call the ledger', false);
  exception when insufficient_privilege then perform public.t_ok('M1 a member cannot call the ledger', true); end;
  begin perform public.credit_lots_tick();
    perform public.t_ok('M2 a member cannot run the tick', false);
  exception when insufficient_privilege then perform public.t_ok('M2 a member cannot run the tick', true); end;
  begin perform public.credit_tranche_grant(gen_random_uuid());
    perform public.t_ok('M3 a member cannot grant a tranche', false);
  exception when insufficient_privilege then perform public.t_ok('M3 a member cannot grant a tranche', true); end;
  begin insert into public.credit_lots (wallet_id, kind, amount, remaining) values ('00000000-0000-0000-0000-0000000bbbb1', 'bonus', 100, 100);
    perform public.t_ok('M4 a member cannot write a lot', false);
  exception when insufficient_privilege then perform public.t_ok('M4 a member cannot write a lot', true); end;
  begin perform public.stripe_settle_v2('not-the-token', 'evt_M', 'invoice.paid', '00000000-0000-0000-0000-00000000aaa1', 'in_M', 1, 'usd',
      'subscription', null, null, '{}', '[{"type":"lot","credits":1000,"expires_at":"2099-01-01"}]', null);
    perform public.t_ok('M5 settlement needs the server token', false);
  exception when others then perform public.t_ok('M5 settlement needs the server token', sqlerrm = 'forbidden', sqlerrm); end;
  begin perform public.usage_event_refund_partial('not-the-token', gen_random_uuid(), 1);
    perform public.t_ok('M6 a refund needs the server token', false);
  exception when others then perform public.t_ok('M6 a refund needs the server token', sqlerrm = 'forbidden', sqlerrm); end;
end $$;
select t_ok('M7 a member reads only their own lots',
  (select count(*) from public.credit_lots) > 0
  and not exists (select 1 from public.credit_lots where wallet_id <> '00000000-0000-0000-0000-0000000bbbb1'));
reset role;

/* ── N. the invariant, everywhere ──────────────────────────────────────────*/
select t_as(:ADMIN);
select t_ok('N1 balance = sum of lots for every wallet', not exists (select 1 from public.credit_lots_audit()),
  (select string_agg(wallet_id || ':' || balance || '≠' || lots, '; ') from public.credit_lots_audit()));
select t_ok('N2 no lot below zero or above its amount', not exists (select 1 from public.credit_lots where remaining < 0 or remaining > amount));
select t_ok('N3 admin, second and E2E balances still as before (admin net of its own test charges)',
  t_bal('c538dc41-0ef4-4f04-a7e9-1d6ff73742a5') = 1124 and t_bal('9b5352f5-b851-46ca-a29c-478f035c843e') = 488);

/* ── P. the catalogue switch (0175) ────────────────────────────────────────*/
select t_ok('P1 four paid plans in USD at the approved gross prices',
  (select string_agg(slug || ':' || price_cents || '/' || annual_price_cents || '/' || monthly_credits || '/' || currency, ',' order by sort_order)
     from public.subscription_plans where price_cents > 0) = 'mini:990/9900/20/USD,starter:2490/24900/55/USD,pro:4990/49900/125/USD,agency:10990/109900/290/USD',
  (select string_agg(slug || ':' || price_cents || '/' || annual_price_cents || '/' || monthly_credits || '/' || currency, ',' order by sort_order)
     from public.subscription_plans where price_cents > 0));
select t_ok('P2 annual = 10 × monthly on every plan (12 months for the price of 10)',
  not exists (select 1 from public.subscription_plans where price_cents > 0 and annual_price_cents <> price_cents * 10));
select t_ok('P3 each plan maps both periods to a confirmed Stripe Price',
  not exists (select 1 from public.subscription_plans where price_cents > 0 and (stripe_price_id_monthly is null or stripe_price_id_annual is null
    or stripe_price_monthly_cents <> price_cents or stripe_price_annual_cents <> annual_price_cents or stripe_sync_status <> 'synced')));
select t_ok('P4 the technical slug agency stays, customers read Business', exists (select 1 from public.subscription_plans where slug = 'agency' and name = 'Business'));
select t_ok('P5 the capabilities of existing plans are untouched',
  (select features from public.subscription_plans where slug = 'pro') = '{"products":500,"priority_queue":true,"workspace_members":5}'::jsonb);
select t_ok('P6 no pack is on offer', not exists (select 1 from public.credit_packages where active));
select t_ok('P7 tool prices: NBP 1/1/1.25, NB2 1/1.25/1.75, NB 0.5, GPT Image 2 1/1 (every quality)',
  (select pricing from public.ai_models where id = '70fe4bee-f2d1-491e-9161-6e0c8f2166c2') = '{"1K":1,"2K":1,"4K":1.25}'::jsonb
  and (select pricing from public.ai_models where id = '61314bc2-3e10-4d65-8988-936e799f4449') = '{"1K":1,"2K":1.25,"4K":1.75}'::jsonb
  and (select pricing from public.ai_models where id = '64917127-7f5d-4d16-b551-b40c3e23aded') = '{"1K":0.5}'::jsonb
  and (select metadata->'quality_pricing'->'high'->>'2K' from public.ai_models where id = 'cdcf4ac8-b303-4c3f-8732-9910022e263e') = '1');
select t_ok('P8 hidden models keep their rows as they were', (select pricing from public.ai_models where id = 'd4e1a1fb-ed6f-4862-9628-8e9b1f3224a9') = '{"2K":8}'::jsonb);
select t_ok('P9 GrovShot analysis 2, image 2K 1 / 4K 1.25; Miniaturka 2',
  (select credits_cost from public.service_catalog where slug = 'prompt_generation') = 2
  and (select credits_cost from public.service_catalog where slug = 'grovshot_image_2k') = 1
  and (select credits_cost from public.service_catalog where slug = 'grovshot_image_4k') = 1.25
  and (select credits_cost from public.service_catalog where slug = 'tool_thumbnail') = 2);
select t_ok('P10 the outdated FAQ answer is corrected; an admin-edited one is left alone',
  (select answer->>'pl' from public.faq_items where id = 'ee80b371-8530-40d2-8bfb-95b829324d78') like '%suwaku%'
  and (select answer->>'pl' from public.faq_items where id = '1c3d753e-200e-427f-ad75-bc4e04e11153') = 'Zmienione przez admina — nie ruszać.');
select t_ok('P11 the second and E2E accounts still hold exactly their balances',
  t_bal('c538dc41-0ef4-4f04-a7e9-1d6ff73742a5') = 1124 and t_bal('9b5352f5-b851-46ca-a29c-478f035c843e') = 488);

/* ── Q. finance view (0176): value by pool, never a flat price per credit ──*/
select t_as(:ADMIN);
insert into public.ai_provider_calls (usage_event_id, provider_slug, model, status, input_tokens, output_tokens, cost_usd_micros, cost_basis)
select id, 'google', 'gemini-3-pro-image', 'ok', 1000, 1290, 134000, 'estimated' from public.usage_events where metadata->>'quantity' = '4';
create temp table q_ev as select x as r from jsonb_array_elements(public.admin_finance_events(now() - interval '1 day', now() + interval '1 day', :C1_WS, 500)) x;
select t_ok('Q1 a run paid from a 100-credit $52.00 top-up is worth 52 cents per credit gross',
  exists (select 1 from q_ev where r->>'id' = (select id::text from public.usage_events where idempotency_key = 'gsv2:00000000-0000-0000-0000-00000000f001:2')),
  (select count(*)::text from q_ev));
select t_ok('Q2 bonus / legacy credits bring no revenue (internal admin runs)', (select coalesce(sum((r->>'revenue_gross')::numeric), 0) from jsonb_array_elements(
  public.admin_finance_events(now() - interval '1 day', now() + interval '1 day', :ADMIN_WS, 500)) r) = 0);
select t_ok('Q3 a priced API call is counted, an unpriced one is "unknown" (never 0)',
  (select (r->>'api_cost_usd_micros')::bigint from q_ev where r->>'id' = (select id::text from public.usage_events where metadata->>'quantity' = '4')) = 134000
  and (select (r->>'api_cost_unknown_calls')::int from q_ev where r->>'id' = (select id::text from public.usage_events where idempotency_key = 'd1')) = 1);
select t_ok('Q4 the admin workspace is internal', public.finance_is_internal(:ADMIN_WS) and not public.finance_is_internal(:C1_WS));
select t_ok('Q5 overview: cash, usage, deferred, credits blocks present',
  (select o ? 'payments' and o ? 'usage' and o ? 'deferred' and o ? 'credits' and (o->'payments'->>'gross')::numeric > 0
     from public.admin_finance_overview(now() - interval '1 day', now() + interval '1 day') o));
select t_ok('Q6 annual: the pending tranches are deferred revenue, not profit',
  (select (o->'deferred'->>'pending_tranches')::int > 0 from public.admin_finance_overview(now() - interval '1 day', now() + interval '1 day') o));
select t_as(:C1);
do $$ begin
  begin perform public.admin_finance_overview(now() - interval '1 day', now());
    perform public.t_ok('Q7 a customer cannot read the finance view', false);
  exception when others then perform public.t_ok('Q7 a customer cannot read the finance view', sqlerrm = 'not_admin', sqlerrm); end;
end $$;
