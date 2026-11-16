-- SMART SUBSCRIPTION MANAGEMENT (0181) — the financial promises, checked on a
-- real Postgres on top of the Cennik V2 ledger (0173–0176).
-- Every check writes one row to t_results; the runner fails on any false.
\set ON_ERROR_STOP on
set search_path = public, extensions;

create table if not exists public.t_results (n serial, name text, ok boolean, detail text);
create or replace function public.t_ok(p_name text, p_ok boolean, p_detail text default '') returns void
language sql security definer as $$ insert into public.t_results (name, ok, detail) values (p_name, coalesce(p_ok, false), coalesce(p_detail, '')) $$;
create table if not exists public.t_r (k text primary key, v text);
create or replace function public.t_set(p_k text, p_v text) returns void language sql as $$
  insert into public.t_r values (p_k, p_v) on conflict (k) do update set v = excluded.v $$;
create or replace function public.t_get(p_k text) returns text language sql as $$ select v from public.t_r where k = p_k $$;
create or replace function public.t_bal(p_ws uuid) returns numeric language sql as $$
  select balance from public.credit_wallets where workspace_id = p_ws $$;
create or replace function public.t_lot(p_id uuid) returns numeric language sql as $$
  select remaining from public.credit_lots where id = p_id $$;
create or replace function public.t_as(p_uid uuid) returns void language sql as $$
  select set_config('app.current_user', coalesce(p_uid::text, ''), false) $$;
create or replace function public.t_audit_clean() returns boolean language sql as $$
  select not exists (select 1 from public.credit_lots_audit()) $$;
grant execute on function public.t_ok(text, boolean, text) to anon, authenticated;

-- A quote row, built from plan_change_context exactly as the server does.
create or replace function public.t_quote(p_ws uuid, p_kind text, p_timing text, p_to uuid, p_to_period text, p_to_price text,
                                          p_list integer, p_deduction integer, p_effective timestamptz default now())
returns uuid language plpgsql as $$
declare ctx jsonb := public.plan_change_context('srv-token', p_ws);
begin
  return public.plan_change_open('srv-token', p_ws, jsonb_build_object(
    'status', 'quoted', 'provider_subscription_id', ctx->'subscription'->>'provider_subscription_id', 'kind', p_kind, 'timing', p_timing,
    'from_plan_id', ctx->'subscription'->>'plan_id', 'from_period', ctx->'subscription'->>'period',
    'from_price_id', ctx->'subscription'->>'stripe_price_id', 'to_plan_id', p_to, 'to_period', p_to_period, 'to_price_id', p_to_price,
    'currency', 'USD', 'list_price_cents', p_list, 'deduction_cents', p_deduction, 'amount_due_cents', p_list - p_deduction,
    'basis_cents', 2490, 'closed_credits', 0, 'effective_at', p_effective, 'fingerprint', 'fp',
    'quote', jsonb_build_object('payment_id', ctx->'payment'->>'id', 'pool', jsonb_build_object(
      'lots', (select coalesce(jsonb_agg(jsonb_build_object('id', x->>'id', 'remaining', (x->>'remaining')::numeric)), '[]'::jsonb) from jsonb_array_elements(ctx->'lots') x),
      'tranches', (select coalesce(jsonb_agg(jsonb_build_object('id', x->>'id', 'credits', (x->>'credits')::numeric)), '[]'::jsonb) from jsonb_array_elements(ctx->'tranches'->'pending') x)))));
end $$;

\set ADMIN '''22289203-3a80-446d-b377-c2c75c253c0d'''
\set C1 '''00000000-0000-0000-0000-0000000000c1'''
\set C1_WS '''00000000-0000-0000-0000-00000000aaa1'''
\set C1_W '''00000000-0000-0000-0000-0000000bbbb1'''
\set C2 '''00000000-0000-0000-0000-0000000000c2'''
\set C2_WS '''00000000-0000-0000-0000-00000000aaa2'''
\set C2_W '''00000000-0000-0000-0000-0000000bbbb2'''
\set STARTER '''bca46e0c-00d2-4e1a-b034-3bb5ef751221'''
\set PRO '''d39062bd-03ef-4844-b65b-7dc6b80e79b0'''
\set AGENCY '''984262c1-a47f-4d36-9d3d-4a680dd46798'''
\set P_STARTER_M '''price_1UbRIsPOBRMZKbwYpIHaAKiv'''
\set P_STARTER_A '''price_1UbRIvPOBRMZKbwYWhkcuHbU'''
\set P_PRO_M '''price_1UbRJ1POBRMZKbwYwrr44zvv'''
\set P_PRO_A '''price_1UbRJ4POBRMZKbwYe57EKQ8F'''
\set P_AGENCY_M '''price_1UbRJBPOBRMZKbwYFyGu3w0V'''

/* ── 0. the migration itself ───────────────────────────────────────────────*/
select t_ok('Z1 the module starts OFF (and a re-run did not switch it)',
  (select value from public.app_settings where key = 'plan_changes') = '{"enabled": false}'::jsonb and not public.plan_changes_enabled());
select t_ok('Z2 one active change per workspace is an index, not a hope',
  exists (select 1 from pg_indexes where indexname = 'plan_changes_one_active' and indexdef ilike '%unique%'));
select t_ok('Z3 clients cannot write plan_changes directly',
  not has_table_privilege('authenticated', 'public.plan_changes', 'insert')
  and not has_table_privilege('authenticated', 'public.plan_changes', 'update')
  and not has_table_privilege('anon', 'public.plan_changes', 'select'));
select t_ok('Z4 the reservation functions are closed to anon',
  not has_function_privilege('anon', 'public.plan_change_open(text, uuid, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.plan_change_hold(text, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.plan_change_context(text, uuid)', 'execute'));

/* ── 1. a monthly Starter customer ─────────────────────────────────────────*/
-- Starter, paid $24.90 for a period that started 15 days ago and ends in 15.
select t_set('m1', (public.stripe_settle_v2('srv-token', 'evt_PC_M1', 'invoice.paid', :C1_WS, 'in_PC_M1', 2490, 'usd', 'subscription', :STARTER, 'cus_PC1',
  jsonb_build_object('source', 'invoice', 'subscription', 'sub_PC1', 'billing_reason', 'subscription_create', 'billing_period', 'monthly'),
  jsonb_build_array(jsonb_build_object('type', 'lot', 'credits', 55, 'expires_at', now() + interval '15 days', 'plan_id', :STARTER,
                                       'billing_period', 'monthly', 'subscription', 'sub_PC1', 'description', 'Abonament: Starter')), null))->>'payment_id');
insert into public.subscriptions (workspace_id, plan_id, status, current_period_start, current_period_end, provider, provider_subscription_id, stripe_price_id)
values (:C1_WS, :STARTER, 'active', now() - interval '15 days', now() + interval '15 days', 'stripe', 'sub_PC1', :P_STARTER_M);
select t_set('lot1', (select id::text from public.credit_lots where wallet_id = :C1_W and kind = 'subscription'));
-- Other pools the change must never touch: a top-up (40) and a bonus (10).
select public.apply_credit_transaction(:C1_W, 40, 'topup', 'test top-up', null, '{"lot_kind":"topup"}', null);
select public.apply_credit_transaction(:C1_W, 10, 'bonus', 'test bonus', null, '{}', null);
select t_set('topup', (select id::text from public.credit_lots where wallet_id = :C1_W and kind = 'topup'));
select t_set('bonus', (select id::text from public.credit_lots where wallet_id = :C1_W and kind = 'bonus'));
-- 20 credits used: they come from the subscription lot first.
select t_as(:C1);
select public.usage_event_start('srv-token', :C1, :C1_WS, :C1_W, 'image_generation', 20, null, null, null, 'pc-u1', '{}');
update public.usage_events set status = 'succeeded' where idempotency_key = 'pc-u1';
select t_ok('S1 20 of 55 used from the subscription pool (35 left)', t_lot(t_get('lot1')::uuid) = 35, t_lot(t_get('lot1')::uuid)::text);

create temp table ctx1 as select public.plan_change_context('srv-token', :C1_WS) as c;
select t_ok('M1 context: the period payment, its one lot (35 of 55), monthly, nothing in flight',
  (select (c->'payment'->>'amount_cents')::int = 2490 and jsonb_array_length(c->'lots') = 1
          and (c->'lots'->0->>'remaining')::numeric = 35 and (c->>'period_lot_credits')::numeric = 55
          and c->'subscription'->>'period' = 'monthly' and (c->>'inflight_usage')::int = 0
          and not (c->'payment'->>'proration_lots')::boolean from ctx1), (select c::text from ctx1));
select t_ok('M1b the context never lists a top-up or bonus lot as eligible',
  not exists (select 1 from ctx1, jsonb_array_elements(c->'lots') x where (x->>'id') in (t_get('topup'), t_get('bonus'))));

-- Starter → PRO: deduction 1245 (the spec's example), due 3745.
select t_set('q1', public.t_quote(:C1_WS, 'upgrade', 'immediate', :PRO, 'monthly', :P_PRO_M, 4990, 1245)::text);
select t_ok('M2 module OFF: the reservation refuses', (public.plan_change_hold('srv-token', t_get('q1')::uuid))->>'status' = 'disabled');
update public.app_settings set value = '{"enabled": true}'::jsonb where key = 'plan_changes';

-- A generation still running blocks the reservation.
select public.usage_event_start('srv-token', :C1, :C1_WS, :C1_W, 'image_generation', 1, null, null, null, 'pc-u2', '{}');
select t_ok('M3 a pending generation blocks the reservation', (public.plan_change_hold('srv-token', t_get('q1')::uuid))->>'status' = 'inflight_usage');
update public.usage_events set status = 'succeeded' where idempotency_key = 'pc-u2';
select t_set('m4', (public.plan_change_hold('srv-token', t_get('q1')::uuid))->>'status');
select t_ok('M4 the pool moved since the quote (1 more credit used): stale, closed',
  t_get('m4') = 'pool_changed' and (select status from public.plan_changes where id = t_get('q1')::uuid) = 'expired', t_get('m4'));

select t_set('q2', public.t_quote(:C1_WS, 'upgrade', 'immediate', :PRO, 'monthly', :P_PRO_M, 4990, 1245)::text);

-- Permissions: another customer, and the anonymous role.
select t_as(:C2);
do $$ begin
  perform public.plan_change_hold('srv-token', (select v from public.t_r where k = 'q2')::uuid);
  perform public.t_ok('M5 another customer cannot reserve this change', false);
exception when others then perform public.t_ok('M5 another customer cannot reserve this change', sqlerrm = 'not_authorized', sqlerrm); end $$;
do $$ begin
  perform public.plan_change_open('srv-token', '00000000-0000-0000-0000-00000000aaa1', '{}'::jsonb);
  perform public.t_ok('M6 another customer cannot open a change for this workspace', false);
exception when others then perform public.t_ok('M6 another customer cannot open a change for this workspace', sqlerrm = 'not_authorized', sqlerrm); end $$;
do $$ begin
  perform public.plan_change_hold('wrong-token', (select v from public.t_r where k = 'q2')::uuid);
  perform public.t_ok('M7 without the server token nothing runs', false);
exception when others then perform public.t_ok('M7 without the server token nothing runs', sqlerrm = 'forbidden', sqlerrm); end $$;
set role authenticated;
select t_ok('M8 RLS: another customer sees none of this workspace''s changes',
  (select count(*) from public.plan_changes where workspace_id = :C1_WS) = 0);
select t_as(:C1);
select t_ok('M9 RLS: the customer sees their own changes',
  (select count(*) from public.plan_changes where workspace_id = :C1_WS) >= 2);
do $$ begin
  insert into public.plan_changes (workspace_id, provider_subscription_id, kind, timing, to_plan_id, to_period, to_price_id, currency, list_price_cents, amount_due_cents)
  values ('00000000-0000-0000-0000-00000000aaa1', 'x', 'upgrade', 'immediate', gen_random_uuid(), 'monthly', 'x', 'USD', 1, 1);
  perform public.t_ok('M10 a customer cannot write a change row directly', false);
exception when others then perform public.t_ok('M10 a customer cannot write a change row directly', true); end $$;
reset role;

/* ── 2. the reservation ────────────────────────────────────────────────────*/
select t_set('bal_before_hold', t_bal(:C1_WS)::text);
select t_ok('H1 the reservation is taken', (public.plan_change_hold('srv-token', t_get('q2')::uuid))->>'status' = 'held');
select t_ok('H2 the whole eligible pool (34) is out of reach', t_lot(t_get('lot1')::uuid) = 0
  and (select held_credits from public.plan_changes where id = t_get('q2')::uuid) = 34);
select t_ok('H3 top-up and bonus pools untouched', t_lot(t_get('topup')::uuid) = 40 and t_lot(t_get('bonus')::uuid) = 10);
select t_ok('H4 through the ledger: one expiration −34, reason plan_change_hold',
  (select count(*) = 1 and sum(amount) = -34 from public.credit_transactions
    where reference_id = t_get('q2')::uuid and type = 'expiration' and metadata->>'reason' = 'plan_change_hold'));
select t_ok('H5 balance = 50 (40 top-up + 10 bonus), invariant holds', t_bal(:C1_WS) = 50 and t_audit_clean(), t_bal(:C1_WS)::text);
select t_ok('H6 the same reservation twice: refused', (public.plan_change_hold('srv-token', t_get('q2')::uuid))->>'status' = 'not_quoted');
select t_set('q3', public.t_quote(:C1_WS, 'upgrade', 'immediate', :AGENCY, 'monthly', :P_AGENCY_M, 10990, 0)::text);
select t_ok('H7 a second change while one is reserved: refused', (public.plan_change_hold('srv-token', t_get('q3')::uuid))->>'status' = 'change_in_progress');
do $$ begin
  update public.plan_changes set status = 'held' where id = (select v from public.t_r where k = 'q3')::uuid;
  perform public.t_ok('H8 the unique index refuses two active changes', false);
exception when unique_violation then perform public.t_ok('H8 the unique index refuses two active changes', true); end $$;
select t_ok('H9 spending during the reservation uses other pools, never the reserved one',
  (select status from public.usage_event_start('srv-token', :C1, :C1_WS, :C1_W, 'image_generation', 5, null, null, null, 'pc-u3', '{}')) = 'ok'
  and t_lot(t_get('lot1')::uuid) = 0 and t_bal(:C1_WS) = 45);
update public.usage_events set status = 'succeeded' where idempotency_key = 'pc-u3';

/* ── 3. release (payment failed) ───────────────────────────────────────────*/
select t_ok('R1 release', (public.plan_change_release('srv-token', t_get('q2')::uuid, 'failed', 'card_declined'))->>'status' = 'failed');
select t_set('lot2', (select (release->'lots'->0->>'lot_id') from public.plan_changes where id = t_get('q2')::uuid));
select t_ok('R2 the 34 credits are back, same plan, same payment, same expiry',
  (select l2.remaining = 34 and l2.kind = 'subscription' and l2.plan_id = l1.plan_id and l2.payment_id = l1.payment_id
          and l2.expires_at = l1.expires_at and l2.provider_subscription_id = 'sub_PC1'
     from public.credit_lots l1, public.credit_lots l2 where l1.id = t_get('lot1')::uuid and l2.id = t_get('lot2')::uuid));
select t_ok('R3 analytics-neutral: the change''s expiration entries sum to 0',
  (select sum(amount) from public.credit_transactions where reference_id = t_get('q2')::uuid and type = 'expiration') = 0);
select t_ok('R4 balance restored (45 + 34 = 79), invariant holds', t_bal(:C1_WS) = 79 and t_audit_clean(), t_bal(:C1_WS)::text);
select t_ok('R5 releasing twice changes nothing',
  (public.plan_change_release('srv-token', t_get('q2')::uuid, 'failed', 'again'))->>'status' = 'noop' and t_bal(:C1_WS) = 79);

/* ── 4. paid: the webhook settles ──────────────────────────────────────────*/
update public.plan_changes set status = 'canceled' where id = t_get('q3')::uuid;
select t_set('q4', public.t_quote(:C1_WS, 'upgrade', 'immediate', :PRO, 'monthly', :P_PRO_M, 4990, 1245)::text);
select t_ok('P1 a fresh quote reserves the released pool', (public.plan_change_hold('srv-token', t_get('q4')::uuid))->>'status' = 'held'
  and t_lot(t_get('lot2')::uuid) = 0 and t_bal(:C1_WS) = 45);
select t_ok('P2 the Stripe invoice is attached', public.plan_change_attach('srv-token', t_get('q4')::uuid,
  jsonb_build_object('status', 'awaiting_payment', 'invoice', 'in_PC_UP', 'payment_intent', 'pi_PC_UP', 'coupon', 'co_PC')) = 'ok');
-- A refund of an older generation lands on the reserved lot meanwhile: it was
-- never part of the deduction, so the settlement must leave it alone.
select public.apply_credit_transaction(:C1_W, 20, 'refund', 'late refund', (select id from public.usage_events where idempotency_key = 'pc-u1'), '{}', null);
select t_set('m_up', (public.stripe_settle_v2('srv-token', 'evt_PC_UP', 'invoice.paid', :C1_WS, 'in_PC_UP', 3745, 'usd', 'subscription', :PRO, 'cus_PC1',
  jsonb_build_object('source', 'invoice', 'subscription', 'sub_PC1', 'billing_reason', 'subscription_update', 'billing_period', 'monthly'),
  jsonb_build_array(jsonb_build_object('type', 'lot', 'credits', 125, 'expires_at', now() + interval '1 month', 'plan_id', :PRO,
                                       'billing_period', 'monthly', 'subscription', 'sub_PC1', 'description', 'Abonament: Pro')), null))->>'payment_id');
create temp table settle1 as select public.plan_change_settle('srv-token', 'sub_PC1', 'in_PC_UP', t_get('m_up')::uuid, :P_PRO_M) as r;
select t_ok('P3 settled: completed, tied to the payment, not late',
  (select r->>'status' = 'completed' and not (r->>'late')::boolean from settle1)
  and (select status = 'completed' and payment_id = t_get('m_up')::uuid from public.plan_changes where id = t_get('q4')::uuid), (select r::text from settle1));
select t_ok('P4 the new plan''s full pool: 125 PRO credits', exists (select 1 from public.credit_lots
  where wallet_id = :C1_W and plan_id = :PRO and amount = 125 and remaining = 125 and payment_id = t_get('m_up')::uuid));
select t_ok('P5 the old pool stays closed; the late refund (20) is NOT taken away',
  t_lot(t_get('lot2')::uuid) = 0 and t_lot(t_get('lot1')::uuid) = 20);
select t_ok('P6 balance = 45 + 20 refund + 125 = 190, invariant holds', t_bal(:C1_WS) = 190 and t_audit_clean(), t_bal(:C1_WS)::text);
select t_ok('P7 the same settlement again: already', (public.plan_change_settle('srv-token', 'sub_PC1', 'in_PC_UP', null, :P_PRO_M))->>'status' = 'already');
select t_ok('P8 an unrelated invoice: none', (public.plan_change_settle('srv-token', 'sub_PC1', 'in_OTHER', null, :P_PRO_M))->>'status' = 'none');
select t_ok('P9 the after-sale report reads the change (Starter → Pro, −12.45)',
  (select r->>'from_plan' = 'Starter' and r->>'to_plan' = 'Pro' and (r->>'deduction_cents')::int = 1245 and (r->>'amount_due_cents')::int = 3745
     from (select public.plan_change_for_payment('srv-token', t_get('m_up')::uuid) as r) x));
select t_ok('P10 the payment row is the invoice (3745), counted once', (select count(*) = 1 and sum(amount_cents) = 3745 from public.payments where provider_payment_id = 'in_PC_UP'));

/* ── 5. a payment that arrives AFTER the reservation was released ──────────*/
update public.subscriptions set plan_id = :PRO, stripe_price_id = :P_PRO_M where provider_subscription_id = 'sub_PC1';
select t_set('q5', public.t_quote(:C1_WS, 'upgrade', 'immediate', :AGENCY, 'monthly', :P_AGENCY_M, 10990, 1000)::text);
select t_ok('L1 Pro → Business reserves the Pro pool (125)', (public.plan_change_hold('srv-token', t_get('q5')::uuid))->>'status' = 'held');
select public.plan_change_attach('srv-token', t_get('q5')::uuid, jsonb_build_object('status', 'awaiting_payment', 'invoice', 'in_PC_LATE'));
select public.plan_change_release('srv-token', t_get('q5')::uuid, 'expired', 'payment_window_passed');
select t_set('lot5', (select (release->'lots'->0->>'lot_id') from public.plan_changes where id = t_get('q5')::uuid));
select t_ok('L2 released: the 125 are back', t_lot(t_get('lot5')::uuid) = 125);
select t_set('m_late', (public.stripe_settle_v2('srv-token', 'evt_PC_LATE', 'invoice.paid', :C1_WS, 'in_PC_LATE', 9990, 'usd', 'subscription', :AGENCY, 'cus_PC1',
  jsonb_build_object('source', 'invoice', 'subscription', 'sub_PC1', 'billing_reason', 'subscription_update', 'billing_period', 'monthly'),
  jsonb_build_array(jsonb_build_object('type', 'lot', 'credits', 290, 'expires_at', now() + interval '1 month', 'plan_id', :AGENCY,
                                       'billing_period', 'monthly', 'subscription', 'sub_PC1', 'description', 'Abonament: Business')), null))->>'payment_id');
create temp table settle2 as select public.plan_change_settle('srv-token', 'sub_PC1', 'in_PC_LATE', t_get('m_late')::uuid, :P_AGENCY_M) as r;
select t_ok('L3 the late payment completes the change, marked late, the released 125 closed again',
  (select r->>'status' = 'completed' and (r->>'late')::boolean and (r->>'re_closed')::numeric = 125 from settle2)
  and t_lot(t_get('lot5')::uuid) = 0, (select r::text from settle2));
select t_ok('L4 invariant holds after a late payment', t_audit_clean());

/* ── 6. an annual plan: current tranche + future tranches ──────────────────*/
select t_as(null);
select t_set('a1', (public.stripe_settle_v2('srv-token', 'evt_PC_A1', 'invoice.paid', :C2_WS, 'in_PC_A1', 24900, 'usd', 'subscription', :STARTER, 'cus_PC2',
  jsonb_build_object('source', 'invoice', 'subscription', 'sub_PC2', 'billing_reason', 'subscription_create', 'billing_period', 'annual'),
  jsonb_build_array(jsonb_build_object('type', 'annual', 'credits_per_month', 55, 'period_start', now() - interval '10 days',
                                       'period_end', now() - interval '10 days' + interval '1 year', 'plan_id', :STARTER, 'subscription', 'sub_PC2')), null))->>'payment_id');
insert into public.subscriptions (workspace_id, plan_id, status, current_period_start, current_period_end, provider, provider_subscription_id, stripe_price_id)
values (:C2_WS, :STARTER, 'active', now() - interval '10 days', now() - interval '10 days' + interval '1 year', 'stripe', 'sub_PC2', :P_STARTER_A);
select t_ok('A1 annual Starter: 12 tranches, ONE granted now (55), 11 pending',
  (select count(*) = 12 from public.subscription_tranches where payment_id = t_get('a1')::uuid)
  and (select count(*) = 1 and sum(credits) = 55 from public.subscription_tranches where payment_id = t_get('a1')::uuid and status = 'granted')
  and t_bal(:C2_WS) = 55);
select t_as(:C2);
select public.usage_event_start('srv-token', :C2, :C2_WS, :C2_W, 'image_generation', 5, null, null, null, 'pc-a-u1', '{}');
update public.usage_events set status = 'succeeded' where idempotency_key = 'pc-a-u1';
create temp table ctx2 as select public.plan_change_context('srv-token', :C2_WS) as c;
select t_ok('A2 context: the current tranche lot (50) + 11 pending tranches, total 660, annual',
  (select jsonb_array_length(c->'lots') = 1 and (c->'lots'->0->>'remaining')::numeric = 50 and c->'lots'->0->>'tranche_id' is not null
          and jsonb_array_length(c->'tranches'->'pending') = 11 and (c->'tranches'->>'total')::numeric = 660
          and c->'subscription'->>'period' = 'annual' from ctx2));
select t_set('qa', public.t_quote(:C2_WS, 'upgrade', 'immediate', :PRO, 'annual', :P_PRO_A, 49900, 23000)::text);
select t_set('a3h', (public.plan_change_hold('srv-token', t_get('qa')::uuid))->>'status');
select t_ok('A3 the reservation takes the current tranche AND voids the 11 future ones',
  t_get('a3h') = 'held' and t_bal(:C2_WS) = 0
  and (select count(*) = 11 from public.subscription_tranches where payment_id = t_get('a1')::uuid and status = 'void'
         and void_reason = 'plan_change_hold:' || t_get('qa')));
update public.subscription_tranches set starts_at = now() - interval '1 minute'
 where payment_id = t_get('a1')::uuid and tranche_no = 2;
select t_ok('A4 the tick never grants a voided tranche', (public.credit_lots_tick())->>'granted' = '0' and t_bal(:C2_WS) = 0);
select public.plan_change_release('srv-token', t_get('qa')::uuid, 'canceled', 'customer');
select t_ok('A5 release: the 11 tranches pending again, the 50 back',
  (select count(*) = 11 from public.subscription_tranches where payment_id = t_get('a1')::uuid and status = 'pending') and t_bal(:C2_WS) = 50);
-- the tick now grants the due tranche 2 (moved into the past above): the
-- pool changed, so a new quote is needed — exactly what the hold checks.
select public.credit_lots_tick();
update public.subscription_tranches set starts_at = now() + interval '20 days'
 where payment_id = t_get('a1')::uuid and tranche_no = 2 and status = 'pending';
select t_set('qa2', public.t_quote(:C2_WS, 'upgrade', 'immediate', :PRO, 'annual', :P_PRO_A, 49900, 23000)::text);
select t_ok('A6 reserved again', (public.plan_change_hold('srv-token', t_get('qa2')::uuid))->>'status' = 'held');
select public.plan_change_attach('srv-token', t_get('qa2')::uuid, jsonb_build_object('status', 'awaiting_payment', 'invoice', 'in_PC_A2'));
select t_set('a2', (public.stripe_settle_v2('srv-token', 'evt_PC_A2', 'invoice.paid', :C2_WS, 'in_PC_A2', 26900, 'usd', 'subscription', :PRO, 'cus_PC2',
  jsonb_build_object('source', 'invoice', 'subscription', 'sub_PC2', 'billing_reason', 'subscription_update', 'billing_period', 'annual'),
  jsonb_build_array(jsonb_build_object('type', 'annual', 'credits_per_month', 125, 'period_start', now(),
                                       'period_end', now() + interval '1 year', 'plan_id', :PRO, 'subscription', 'sub_PC2')), null))->>'payment_id');
select t_ok('A7 settled', (public.plan_change_settle('srv-token', 'sub_PC2', 'in_PC_A2', t_get('a2')::uuid, :P_PRO_A))->>'status' = 'completed');
select t_ok('A8 the new year: 12 tranches, only the first (125) granted — never 12 months at once',
  (select count(*) = 12 from public.subscription_tranches where payment_id = t_get('a2')::uuid)
  and (select count(*) = 1 and sum(credits) = 125 from public.subscription_tranches where payment_id = t_get('a2')::uuid and status = 'granted'));
select t_ok('A9 the superseded tranches stay void (no double grant)',
  not exists (select 1 from public.subscription_tranches where payment_id = t_get('a1')::uuid and status = 'pending'));
select t_ok('A10 invariant holds', t_audit_clean());

/* ── 7. a change at the END of the paid year (Subscription Schedule) ───────*/
update public.subscriptions set plan_id = :PRO, stripe_price_id = :P_PRO_A where provider_subscription_id = 'sub_PC2';
select t_set('bal_c2', t_bal(:C2_WS)::text);
select t_set('qs', public.t_quote(:C2_WS, 'downgrade', 'period_end', :STARTER, 'annual', :P_STARTER_A, 24900, 0, now())::text);
select t_ok('D1 a scheduled change reserves nothing (credits continue)',
  (public.plan_change_hold('srv-token', t_get('qs')::uuid))->>'status' = 'held' and t_bal(:C2_WS)::text = t_get('bal_c2')
  and (select held_credits = 0 from public.plan_changes where id = t_get('qs')::uuid));
select t_set('d2', public.plan_change_attach('srv-token', t_get('qs')::uuid, jsonb_build_object('status', 'scheduled', 'schedule', 'sub_sched_PC2')));
select t_ok('D2 scheduled', t_get('d2') = 'ok' and (select status from public.plan_changes where id = t_get('qs')::uuid) = 'scheduled');
select t_set('a3', (public.stripe_settle_v2('srv-token', 'evt_PC_A3', 'invoice.paid', :C2_WS, 'in_PC_A3', 24900, 'usd', 'subscription', :STARTER, 'cus_PC2',
  jsonb_build_object('source', 'invoice', 'subscription', 'sub_PC2', 'billing_reason', 'subscription_cycle', 'billing_period', 'annual'),
  jsonb_build_array(jsonb_build_object('type', 'annual', 'credits_per_month', 55, 'period_start', now(),
                                       'period_end', now() + interval '1 year', 'plan_id', :STARTER, 'subscription', 'sub_PC2')), null))->>'payment_id');
select t_set('d3', (public.plan_change_settle('srv-token', 'sub_PC2', 'in_PC_A3', t_get('a3')::uuid, :P_STARTER_A))->>'status');
select t_ok('D3 the renewal at the new price completes the scheduled change (matched by subscription + price)',
  t_get('d3') = 'completed'
  and (select payment_id from public.plan_changes where id = t_get('qs')::uuid) = t_get('a3')::uuid);

/* ── 8. the sweep's view, the admin switch ─────────────────────────────────*/
select t_as(:C1);
select t_set('qx', public.t_quote(:C1_WS, 'upgrade', 'immediate', :AGENCY, 'monthly', :P_AGENCY_M, 10990, 0)::text);
update public.plan_changes set expires_at = now() - interval '1 minute' where id = t_get('qx')::uuid;
select t_as(null);
select t_set('w1', jsonb_array_length(public.plan_change_due('srv-token'))::text);
select t_ok('W1 a quote past its time is closed by the sweep and not returned',
  t_get('w1') = '0' and (select status from public.plan_changes where id = t_get('qx')::uuid) = 'expired');
select t_as(:C1);
select t_set('qy', public.t_quote(:C1_WS, 'upgrade', 'immediate', :AGENCY, 'monthly', :P_AGENCY_M, 10990, 0)::text);
select public.plan_change_hold('srv-token', t_get('qy')::uuid);
update public.plan_changes set expires_at = now() - interval '1 minute' where id = t_get('qy')::uuid;
select t_ok('W2 a reservation past its payment window is handed to the app (void first, then release)',
  (select count(*) = 1 from jsonb_array_elements(public.plan_change_due('srv-token')) x where x->>'id' = t_get('qy')));
select public.plan_change_release('srv-token', t_get('qy')::uuid, 'expired', 'payment_window_passed');
do $$ begin
  perform public.plan_changes_set(true, null);
  perform public.t_ok('W3 a customer cannot switch the module', false);
exception when others then perform public.t_ok('W3 a customer cannot switch the module', sqlerrm = 'not_admin', sqlerrm); end $$;
select t_as(:ADMIN);
select t_set('w4', (public.plan_changes_set(false, '{"before":[]}'::jsonb))->>'enabled');
select t_ok('W4 an admin can, and the portal record is kept', t_get('w4') = 'false'
  and (select value ? 'portal' from public.app_settings where key = 'plan_changes'));

/* ── 9. the whole ledger ───────────────────────────────────────────────────*/
select t_as(null);
select t_ok('X1 every wallet still equals the sum of its lots', t_audit_clean());
select t_ok('X2 no lot below zero or above its amount', not exists (select 1 from public.credit_lots where remaining < 0 or remaining > amount));
select t_ok('X3 nothing outside the ledger: every lot movement is tied to a ledger entry',
  not exists (select 1 from public.credit_lot_moves m left join public.credit_transactions t on t.id = m.tx_id where t.id is null));
