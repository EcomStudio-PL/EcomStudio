-- 0181 — SMART SUBSCRIPTION MANAGEMENT: changing a plan without a second
-- subscription, without paying twice, and without counting a credit twice.
--
-- OFF BY DEFAULT. app_settings.plan_changes = {"enabled": false}: nothing a
-- customer does reaches these functions until an administrator switches the
-- module on (after the financial tests and the Stripe configuration check).
--
-- 1. plan_changes — one row per change: the quote (every figure the customer
--    saw), the reserved pool, the Stripe objects (coupon, invoice, schedule),
--    the status. ONE ACTIVE CHANGE PER WORKSPACE (a unique partial index), so
--    two tabs cannot start two changes.
-- 2. THE POOL IS RESERVED BEFORE ANY PAYMENT. On confirmation the eligible
--    current-period pool — this subscription's current-period lot(s) and, for
--    an annual plan, its pending tranches — is taken out of reach: the lots
--    through the ledger (a targeted 'expiration' debit, reason
--    plan_change_hold), the tranches voided (void_reason plan_change_hold:<id>).
--    What the deduction paid for cannot be spent while the payment runs.
-- 3. RELEASE (payment failed, abandoned, cancelled): the reserved credits come
--    back through the ledger as a lot with the ORIGINAL attributes and expiry
--    (a positive 'expiration' entry, so expired-credit analytics net to zero)
--    and the voided tranches return to 'pending'.
-- 4. SETTLEMENT is the signed webhook's: the invoice is settled by
--    stripe_settle_v2 exactly as any other (the new plan's credits come from
--    its line), then plan_change_settle closes the change; for a payment that
--    arrives after a release it closes the released credits again (they WERE
--    part of the deduction) and marks the change late for an administrator.
--
-- Top-up, bonus and legacy credits are never read as eligible and never
-- touched. Nothing here moves money; Stripe is driven by the app.
-- PURELY ADDITIVE and re-runnable.
--
-- ROLLBACK (manual): drop the functions below, drop table plan_changes,
-- delete from app_settings where key = 'plan_changes', delete the
-- 'finance.plan_change_review' notification_preferences row.

set local lock_timeout = '3s';

create table if not exists public.plan_changes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  requested_by uuid,
  provider_subscription_id text not null,
  kind text not null check (kind in ('upgrade', 'downgrade', 'to_annual', 'to_monthly')),
  timing text not null check (timing in ('immediate', 'period_end')),
  from_plan_id uuid,
  from_period text check (from_period in ('monthly', 'annual')),
  from_price_id text,
  to_plan_id uuid not null,
  to_period text not null check (to_period in ('monthly', 'annual')),
  to_price_id text not null,
  currency text not null,
  list_price_cents integer not null check (list_price_cents > 0),
  basis_cents integer not null default 0 check (basis_cents >= 0),
  time_value_cents integer not null default 0 check (time_value_cents >= 0),
  credit_value_cents integer not null default 0 check (credit_value_cents >= 0),
  deduction_cents integer not null default 0 check (deduction_cents >= 0),
  amount_due_cents integer not null check (amount_due_cents >= 0),
  closed_credits numeric(14,2) not null default 0,
  quote jsonb not null default '{}'::jsonb,
  fingerprint text,
  quoted_at timestamptz not null default now(),
  status text not null default 'quoted' check (status in (
    'quoted', 'held', 'awaiting_payment', 'scheduled', 'completed',
    'released', 'canceled', 'expired', 'failed', 'manual_review')),
  review_reason text check (review_reason is null or length(review_reason) <= 80),
  expires_at timestamptz not null default (now() + interval '15 minutes'),
  hold jsonb not null default '[]'::jsonb,
  held_credits numeric(14,2) not null default 0,
  release jsonb not null default '{}'::jsonb,
  stripe_coupon_id text,
  stripe_invoice_id text,
  stripe_payment_intent_id text,
  stripe_schedule_id text,
  payment_id uuid references public.payments(id) on delete set null,
  effective_at timestamptz,
  late boolean not null default false,
  error_code text check (error_code is null or length(error_code) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint plan_changes_due check (amount_due_cents = list_price_cents - deduction_cents)
);
create unique index if not exists plan_changes_one_active on public.plan_changes (workspace_id)
  where status in ('held', 'awaiting_payment', 'scheduled');
create index if not exists plan_changes_workspace on public.plan_changes (workspace_id, created_at desc);
create index if not exists plan_changes_invoice on public.plan_changes (stripe_invoice_id) where stripe_invoice_id is not null;
create index if not exists plan_changes_sub on public.plan_changes (provider_subscription_id, status);
create index if not exists plan_changes_payment on public.plan_changes (payment_id) where payment_id is not null;

alter table public.plan_changes enable row level security;
revoke all on public.plan_changes from anon, authenticated;
grant select on public.plan_changes to authenticated;
do $policy$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'plan_changes' and policyname = 'plan_changes_member_read') then
    create policy plan_changes_member_read on public.plan_changes for select to authenticated
      using (public.is_workspace_member(workspace_id) or public.is_admin(auth.uid()));
  end if;
end $policy$;

-- The switch. Inserted once and never switched back on by a re-run.
insert into public.app_settings (key, value)
values ('plan_changes', '{"enabled": false}'::jsonb)
on conflict (key) do nothing;

create or replace function public.plan_changes_enabled()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select (value->>'enabled')::boolean from public.app_settings where key = 'plan_changes'), false);
$$;
revoke all on function public.plan_changes_enabled() from public;
grant execute on function public.plan_changes_enabled() to anon, authenticated, service_role;

-- An administrator turns the module on or off; the app records the Customer
-- Portal configuration it changed alongside (so "off" can restore it).
create or replace function public.plan_changes_set(p_enabled boolean, p_portal jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_admin(auth.uid()) then raise exception 'not_admin' using errcode = '42501'; end if;
  insert into public.app_settings (key, value) values ('plan_changes', '{"enabled": false}'::jsonb)
  on conflict (key) do nothing;
  update public.app_settings
     set value = value || jsonb_build_object('enabled', coalesce(p_enabled, false), 'changed_at', now(), 'changed_by', auth.uid())
                       || case when p_portal is null then '{}'::jsonb else jsonb_build_object('portal', p_portal) end
   where key = 'plan_changes'
  returning value into v;
  return v;
end $$;
revoke all on function public.plan_changes_set(boolean, jsonb) from public, anon;
grant execute on function public.plan_changes_set(boolean, jsonb) to authenticated;

/* ── what a quote is computed from ─────────────────────────────────────────*/

-- Everything the app needs to price a change for this workspace, read in one
-- place. The CURRENT-PERIOD PAYMENT is the latest payment recorded for the
-- subscription; the ELIGIBLE POOL is only what that payment granted: its
-- subscription lots still open, and (annual) its pending tranches.
create or replace function public.plan_change_context(p_token text, p_workspace_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  s public.subscriptions;
  p public.payments;
  v_wallet uuid;
  v_period text;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if not (public.is_workspace_member(p_workspace_id) or public.is_admin(auth.uid()) or auth.uid() is null) then
    raise exception 'not_authorized';
  end if;
  select id into v_wallet from public.credit_wallets where workspace_id = p_workspace_id;
  select * into s from public.subscriptions
   where workspace_id = p_workspace_id and provider = 'stripe' and status in ('active', 'trialing', 'past_due')
   order by created_at desc limit 1;
  if not found then
    return jsonb_build_object('enabled', public.plan_changes_enabled(), 'subscription', null);
  end if;
  select case when sp.stripe_price_id_annual = s.stripe_price_id then 'annual'
              when sp.stripe_price_id_monthly = s.stripe_price_id then 'monthly' end
    into v_period
    from public.subscription_plans sp where sp.id = s.plan_id;
  select * into p from public.payments
   where provider = 'stripe' and kind = 'subscription' and workspace_id = p_workspace_id
     and metadata->>'subscription' = s.provider_subscription_id
   order by created_at desc limit 1;

  return jsonb_build_object(
    'enabled', public.plan_changes_enabled(),
    'wallet_id', v_wallet,
    'subscription', jsonb_build_object(
      'id', s.id, 'provider_subscription_id', s.provider_subscription_id, 'plan_id', s.plan_id, 'status', s.status,
      'current_period_start', s.current_period_start, 'current_period_end', s.current_period_end,
      'cancel_at_period_end', s.cancel_at_period_end, 'stripe_price_id', s.stripe_price_id,
      'stripe_customer_id', s.stripe_customer_id, 'period', v_period),
    'payment', case when p.id is null then null else jsonb_build_object(
      'id', p.id, 'provider_payment_id', p.provider_payment_id, 'amount_cents', p.amount_cents, 'tax_cents', p.tax_cents,
      'currency', upper(p.currency), 'status', p.status, 'plan_id', p.plan_id, 'billing_period', p.billing_period,
      'billing_reason', p.metadata->>'billing_reason', 'needs_review', coalesce((p.metadata->>'needs_review')::boolean, false),
      'created_at', p.created_at,
      -- A deduction this period was bought with (an earlier change): it is part
      -- of what the period is worth.
      'carried_deduction_cents', coalesce((select c.deduction_cents from public.plan_changes c
                                            where c.payment_id = p.id and c.status = 'completed' limit 1), 0),
      'from_change', exists (select 1 from public.plan_changes c where c.payment_id = p.id and c.status = 'completed'),
      'proration_lots', exists (select 1 from public.credit_lots l where l.payment_id = p.id and l.amount <> (
                                  select sp.monthly_credits + sp.bonus_credits from public.subscription_plans sp where sp.id = l.plan_id)
                                  and l.tranche_id is null)) end,
    'lots', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'amount', l.amount, 'remaining', l.remaining,
                         'expires_at', l.expires_at, 'plan_id', l.plan_id, 'tranche_id', l.tranche_id) order by l.expires_at, l.id)
                       from public.credit_lots l
                      where l.wallet_id = v_wallet and l.kind = 'subscription' and p.id is not null and l.payment_id = p.id
                        and l.remaining > 0 and l.expires_at > now()), '[]'::jsonb),
    'period_lot_credits', coalesce((select sum(l.amount) from public.credit_lots l
                                     where l.wallet_id = v_wallet and l.kind = 'subscription' and p.id is not null
                                       and l.payment_id = p.id and l.tranche_id is null), 0),
    'tranches', jsonb_build_object(
      'total', coalesce((select sum(t.credits) from public.subscription_tranches t where p.id is not null and t.payment_id = p.id and t.status <> 'void'), 0),
      'count', (select count(*) from public.subscription_tranches t where p.id is not null and t.payment_id = p.id and t.status <> 'void'),
      'pending', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'credits', t.credits, 'starts_at', t.starts_at, 'tranche_no', t.tranche_no) order by t.tranche_no)
                            from public.subscription_tranches t where p.id is not null and t.payment_id = p.id and t.status = 'pending'), '[]'::jsonb),
      'last_end', (select max(t.ends_at) from public.subscription_tranches t where p.id is not null and t.payment_id = p.id and t.status <> 'void')),
    'inflight_usage', (select count(*) from public.usage_events e
                        where e.workspace_id = p_workspace_id and e.status = 'pending' and e.created_at > now() - interval '6 hours'),
    'active_change', (select jsonb_build_object('id', c.id, 'status', c.status, 'kind', c.kind, 'timing', c.timing,
                         'to_plan_id', c.to_plan_id, 'to_period', c.to_period, 'effective_at', c.effective_at,
                         'amount_due_cents', c.amount_due_cents, 'currency', c.currency)
                        from public.plan_changes c
                       where c.workspace_id = p_workspace_id and c.status in ('held', 'awaiting_payment', 'scheduled')
                       order by c.created_at desc limit 1));
end $$;
revoke all on function public.plan_change_context(text, uuid) from public, anon;
grant execute on function public.plan_change_context(text, uuid) to authenticated, service_role;

/* ── 1. the quote is stored ─────────────────────────────────────────────────*/

-- The server priced it (lib/billing/plan-change.ts); the row keeps every
-- figure the customer is shown. 'manual_review' rows record a change that is
-- not automated (an unusual subscription) so an admin can act on it.
create or replace function public.plan_change_open(p_token text, p_workspace_id uuid, p jsonb)
returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_id uuid;
  v_status text := coalesce(p->>'status', 'quoted');
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if auth.uid() is null or not public.is_workspace_member(p_workspace_id) then raise exception 'not_authorized'; end if;
  if v_status not in ('quoted', 'manual_review') then raise exception 'bad_input'; end if;
  -- A newer quote replaces an older one that was never confirmed.
  update public.plan_changes set status = 'expired', updated_at = now()
   where workspace_id = p_workspace_id and status = 'quoted';
  insert into public.plan_changes (
    workspace_id, requested_by, provider_subscription_id, kind, timing, from_plan_id, from_period, from_price_id,
    to_plan_id, to_period, to_price_id, currency, list_price_cents, basis_cents, time_value_cents, credit_value_cents,
    deduction_cents, amount_due_cents, closed_credits, quote, fingerprint, status, review_reason, effective_at, expires_at)
  values (
    p_workspace_id, auth.uid(), p->>'provider_subscription_id', p->>'kind', p->>'timing',
    nullif(p->>'from_plan_id', '')::uuid, nullif(p->>'from_period', ''), nullif(p->>'from_price_id', ''),
    (p->>'to_plan_id')::uuid, p->>'to_period', p->>'to_price_id', upper(p->>'currency'),
    (p->>'list_price_cents')::integer, coalesce((p->>'basis_cents')::integer, 0),
    coalesce((p->>'time_value_cents')::integer, 0), coalesce((p->>'credit_value_cents')::integer, 0),
    coalesce((p->>'deduction_cents')::integer, 0), (p->>'amount_due_cents')::integer,
    coalesce((p->>'closed_credits')::numeric, 0), coalesce(p->'quote', '{}'::jsonb), p->>'fingerprint',
    v_status, left(nullif(p->>'review_reason', ''), 80), nullif(p->>'effective_at', '')::timestamptz,
    now() + interval '15 minutes')
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.plan_change_open(text, uuid, jsonb) from public, anon;
grant execute on function public.plan_change_open(text, uuid, jsonb) to authenticated, service_role;

/* ── 2. the reservation ─────────────────────────────────────────────────────*/

create or replace function public.plan_change_hold(p_token text, p_change_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  c public.plan_changes;
  v_wallet uuid;
  v_lot jsonb;
  l public.credit_lots;
  v_tx uuid;
  v_hold jsonb := '[]'::jsonb;
  v_held numeric(14,2) := 0;
  v_expected_lots uuid[];
  v_expected_tranches uuid[];
  v_pay uuid;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  select * into c from public.plan_changes where id = p_change_id for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if auth.uid() is null or not public.is_workspace_member(c.workspace_id) then raise exception 'not_authorized'; end if;
  if c.status <> 'quoted' then return jsonb_build_object('status', 'not_quoted'); end if;
  if c.expires_at <= now() then
    update public.plan_changes set status = 'expired', updated_at = now() where id = c.id;
    return jsonb_build_object('status', 'quote_expired');
  end if;
  if not public.plan_changes_enabled() then return jsonb_build_object('status', 'disabled'); end if;

  -- The wallet lock serialises this against every charge, refund and grant.
  select id into v_wallet from public.credit_wallets where workspace_id = c.workspace_id for update;
  if v_wallet is null then return jsonb_build_object('status', 'no_wallet'); end if;

  if exists (select 1 from public.plan_changes o where o.workspace_id = c.workspace_id and o.id <> c.id
               and o.status in ('held', 'awaiting_payment', 'scheduled')) then
    return jsonb_build_object('status', 'change_in_progress');
  end if;
  -- A generation still running may be refunded INTO a reserved lot; wait for it.
  if exists (select 1 from public.usage_events e where e.workspace_id = c.workspace_id and e.status = 'pending'
               and e.created_at > now() - interval '6 hours') then
    return jsonb_build_object('status', 'inflight_usage');
  end if;

  -- THE POOL MUST BE EXACTLY WHAT WAS QUOTED: the same lots with the same
  -- remaining credits, the same pending tranches, and nothing else eligible.
  select array_agg((x->>'id')::uuid) into v_expected_lots from jsonb_array_elements(coalesce(c.quote->'pool'->'lots', '[]'::jsonb)) x;
  select array_agg((x->>'id')::uuid) into v_expected_tranches from jsonb_array_elements(coalesce(c.quote->'pool'->'tranches', '[]'::jsonb)) x;
  v_pay := nullif(c.quote->>'payment_id', '')::uuid;
  if c.deduction_cents > 0 or (c.kind in ('upgrade', 'to_annual') and c.timing = 'immediate') then
    if v_pay is null then return jsonb_build_object('status', 'pool_changed'); end if;
    if exists (select 1 from jsonb_array_elements(coalesce(c.quote->'pool'->'lots', '[]'::jsonb)) x
                left join public.credit_lots cl on cl.id = (x->>'id')::uuid and cl.wallet_id = v_wallet
               where cl.id is null or cl.remaining <> (x->>'remaining')::numeric or cl.expires_at <= now())
       or exists (select 1 from public.credit_lots cl
                   where cl.wallet_id = v_wallet and cl.kind = 'subscription' and cl.payment_id = v_pay
                     and cl.remaining > 0 and cl.expires_at > now()
                     and not (cl.id = any(coalesce(v_expected_lots, '{}'::uuid[]))))
       or exists (select 1 from jsonb_array_elements(coalesce(c.quote->'pool'->'tranches', '[]'::jsonb)) x
                   left join public.subscription_tranches t on t.id = (x->>'id')::uuid and t.payment_id = v_pay
                  where t.id is null or t.status <> 'pending' or t.credits <> (x->>'credits')::numeric)
       or exists (select 1 from public.subscription_tranches t
                   where t.payment_id = v_pay and t.status = 'pending'
                     and not (t.id = any(coalesce(v_expected_tranches, '{}'::uuid[])))) then
      update public.plan_changes set status = 'expired', error_code = 'pool_changed', updated_at = now() where id = c.id;
      return jsonb_build_object('status', 'pool_changed');
    end if;

    -- Reserve: every eligible lot's remainder leaves through the ledger.
    for v_lot in select * from jsonb_array_elements(coalesce(c.quote->'pool'->'lots', '[]'::jsonb)) loop
      select * into l from public.credit_lots where id = (v_lot->>'id')::uuid for update;
      continue when l.remaining <= 0;
      v_tx := public.apply_credit_transaction(
        v_wallet, -l.remaining, 'expiration', 'Rezerwacja kredytów: zmiana planu', c.id,
        jsonb_build_object('lot_id', l.id, 'reason', 'plan_change_hold', 'plan_change_id', c.id), null);
      v_hold := v_hold || jsonb_build_array(jsonb_build_object(
        'lot_id', l.id, 'amount', l.remaining, 'tx_id', v_tx, 'expires_at', l.expires_at, 'plan_id', l.plan_id,
        'payment_id', l.payment_id, 'provider_subscription_id', l.provider_subscription_id,
        'billing_period', l.billing_period));
      v_held := v_held + l.remaining;
    end loop;
    -- …and the future tranches that the deduction also settles.
    update public.subscription_tranches
       set status = 'void', voided_at = now(), void_reason = 'plan_change_hold:' || c.id
     where id = any(coalesce(v_expected_tranches, '{}'::uuid[])) and status = 'pending';
  end if;

  update public.plan_changes
     set status = 'held', hold = v_hold, held_credits = v_held, expires_at = now() + interval '1 hour', updated_at = now()
   where id = c.id;
  return jsonb_build_object('status', 'held', 'held_credits', v_held);
end $$;
revoke all on function public.plan_change_hold(text, uuid) from public, anon;
grant execute on function public.plan_change_hold(text, uuid) to authenticated, service_role;

-- The Stripe objects the app created for this change.
create or replace function public.plan_change_attach(p_token text, p_change_id uuid, p jsonb)
returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  c public.plan_changes;
  v_status text := p->>'status';
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  select * into c from public.plan_changes where id = p_change_id for update;
  if not found then return 'not_found'; end if;
  if c.status not in ('held', 'awaiting_payment') then return 'not_held'; end if;
  if v_status is not null and v_status not in ('held', 'awaiting_payment', 'scheduled') then raise exception 'bad_input'; end if;
  update public.plan_changes set
    status = coalesce(v_status, status),
    stripe_coupon_id = coalesce(nullif(p->>'coupon', ''), stripe_coupon_id),
    stripe_invoice_id = coalesce(nullif(p->>'invoice', ''), stripe_invoice_id),
    stripe_payment_intent_id = coalesce(nullif(p->>'payment_intent', ''), stripe_payment_intent_id),
    stripe_schedule_id = coalesce(nullif(p->>'schedule', ''), stripe_schedule_id),
    -- A scheduled change waits for its date, not for a payment window.
    expires_at = case when v_status = 'scheduled' then coalesce(effective_at, now()) + interval '7 days' else expires_at end,
    updated_at = now()
  where id = c.id;
  return 'ok';
end $$;
revoke all on function public.plan_change_attach(text, uuid, jsonb) from public, anon;
grant execute on function public.plan_change_attach(text, uuid, jsonb) to authenticated, service_role;

/* ── 3. the release ─────────────────────────────────────────────────────────*/

create or replace function public.plan_change_release(p_token text, p_change_id uuid, p_status text, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  c public.plan_changes;
  v_wallet uuid;
  h jsonb;
  v_tx uuid;
  v_lot uuid;
  v_lots jsonb := '[]'::jsonb;
  v_tranches uuid[];
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if p_status not in ('released', 'canceled', 'expired', 'failed', 'manual_review') then raise exception 'bad_input'; end if;
  select * into c from public.plan_changes where id = p_change_id for update;
  if not found then return jsonb_build_object('status', 'not_found'); end if;
  if c.status = 'quoted' then
    update public.plan_changes set status = case when p_status = 'released' then 'canceled' else p_status end,
           error_code = left(p_reason, 80), updated_at = now() where id = c.id;
    return jsonb_build_object('status', 'closed');
  end if;
  if c.status not in ('held', 'awaiting_payment', 'scheduled') then return jsonb_build_object('status', 'noop', 'current', c.status); end if;

  select id into v_wallet from public.credit_wallets where workspace_id = c.workspace_id for update;
  -- The reserved credits come back with the attributes and expiry they had.
  for h in select * from jsonb_array_elements(coalesce(c.hold, '[]'::jsonb)) loop
    continue when coalesce((h->>'amount')::numeric, 0) <= 0;
    v_tx := public.apply_credit_transaction(
      v_wallet, (h->>'amount')::numeric, 'expiration', 'Zwolnienie rezerwacji: zmiana planu nie doszła do skutku', c.id,
      jsonb_build_object('lot_kind', 'subscription', 'lot_expires_at', h->>'expires_at', 'plan_id', h->>'plan_id',
                         'payment_id', h->>'payment_id', 'provider_subscription_id', h->>'provider_subscription_id',
                         'billing_period', h->>'billing_period', 'reason', 'plan_change_release',
                         'plan_change_id', c.id, 'released_from_lot', h->>'lot_id'), null);
    select id into v_lot from public.credit_lots where source_tx_id = v_tx;
    v_lots := v_lots || jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'amount', (h->>'amount')::numeric, 'tx_id', v_tx));
  end loop;
  with restored as (
    update public.subscription_tranches
       set status = 'pending', voided_at = null, void_reason = null
     where void_reason = 'plan_change_hold:' || c.id and status = 'void'
    returning id)
  select array_agg(id) into v_tranches from restored;

  update public.plan_changes
     set status = p_status, error_code = left(p_reason, 80), updated_at = now(),
         release = jsonb_build_object('at', now(), 'lots', v_lots, 'tranches', coalesce(to_jsonb(v_tranches), '[]'::jsonb))
   where id = c.id;
  return jsonb_build_object('status', p_status, 'released_lots', jsonb_array_length(v_lots),
                            'restored_tranches', coalesce(array_length(v_tranches, 1), 0));
end $$;
revoke all on function public.plan_change_release(text, uuid, text, text) from public, anon;
grant execute on function public.plan_change_release(text, uuid, text, text) to anon, authenticated, service_role;

/* ── 4. settlement (the signed webhook, after stripe_settle_v2) ─────────────*/

create or replace function public.plan_change_settle(
  p_token text, p_subscription text, p_invoice text, p_payment_id uuid, p_price_id text
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  c public.plan_changes;
  v_wallet uuid;
  h jsonb;
  l public.credit_lots;
  v_closed numeric(14,2) := 0;
  v_late boolean := false;
  v_t uuid;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  select * into c from public.plan_changes
   where (p_invoice is not null and stripe_invoice_id = p_invoice)
      or (status = 'scheduled' and provider_subscription_id = p_subscription and to_price_id = p_price_id
          and coalesce(effective_at, now()) <= now() + interval '2 days')
   order by (stripe_invoice_id = p_invoice) desc nulls last, created_at desc
   limit 1
   for update;
  if not found then return jsonb_build_object('status', 'none'); end if;
  if c.status = 'completed' then return jsonb_build_object('status', 'already', 'change_id', c.id); end if;
  if c.status in ('quoted', 'manual_review') then return jsonb_build_object('status', 'none'); end if;

  select id into v_wallet from public.credit_wallets where workspace_id = c.workspace_id for update;

  -- PAID AFTER A RELEASE (a late payment): the credits that came back are the
  -- very credits this payment's deduction settled — close them again, and
  -- void the tranches that were restored.
  if c.status in ('released', 'expired', 'failed', 'canceled') then
    v_late := true;
    for h in select * from jsonb_array_elements(coalesce(c.release->'lots', '[]'::jsonb)) loop
      select * into l from public.credit_lots where id = (h->>'lot_id')::uuid for update;
      continue when not found or l.remaining <= 0;
      perform public.apply_credit_transaction(v_wallet, -l.remaining, 'expiration', 'Korekta kredytów po zmianie planu', c.id,
        jsonb_build_object('lot_id', l.id, 'reason', 'plan_change', 'plan_change_id', c.id, 'late', true), null);
      v_closed := v_closed + l.remaining;
    end loop;
    for v_t in select (x #>> '{}')::uuid from jsonb_array_elements(coalesce(c.release->'tranches', '[]'::jsonb)) x loop
      update public.subscription_tranches set status = 'void', voided_at = now(), void_reason = 'plan_change:' || c.id
       where id = v_t and status = 'pending';
    end loop;
  end if;

  -- NOT re-closed: credits a refund returns to a reserved lot AFTER the hold.
  -- The deduction was priced on exactly the credits the hold took; a refund
  -- returns credits spent before the quote, never part of the deduction, so
  -- they stay the customer's until that lot's own expiry.

  update public.plan_changes
     set status = 'completed', late = v_late,
         -- A retried event settles as 'already_settled' without the payment's
         -- id; the invoice names it.
         payment_id = coalesce(p_payment_id, payment_id,
                               (select py.id from public.payments py where py.provider = 'stripe' and py.provider_payment_id = p_invoice)),
         stripe_invoice_id = coalesce(stripe_invoice_id, p_invoice), completed_at = now(), updated_at = now(),
         effective_at = coalesce(effective_at, now())
   where id = c.id;
  return jsonb_build_object('status', 'completed', 'change_id', c.id, 'late', v_late, 're_closed', v_closed);
end $$;
revoke all on function public.plan_change_settle(text, text, text, uuid, text) from public;
grant execute on function public.plan_change_settle(text, text, text, uuid, text) to anon, authenticated, service_role;

-- What the after-sale report says about a settled change.
create or replace function public.plan_change_for_payment(p_token text, p_payment_id uuid)
returns jsonb
language sql stable security definer set search_path = public, extensions as $$
  select case when public.server_call_ok(p_token) or public.is_admin(auth.uid()) then (
    select jsonb_build_object('id', c.id, 'kind', c.kind, 'timing', c.timing,
             'from_plan', (select sp.name from public.subscription_plans sp where sp.id = c.from_plan_id), 'from_period', c.from_period,
             'to_plan', (select sp.name from public.subscription_plans sp where sp.id = c.to_plan_id), 'to_period', c.to_period,
             'list_price_cents', c.list_price_cents, 'deduction_cents', c.deduction_cents, 'amount_due_cents', c.amount_due_cents,
             'closed_credits', c.closed_credits + 0, 'late', c.late)
      from public.plan_changes c where c.payment_id = p_payment_id and c.status = 'completed' limit 1)
  end;
$$;
revoke all on function public.plan_change_for_payment(text, uuid) from public;
grant execute on function public.plan_change_for_payment(text, uuid) to anon, authenticated, service_role;

/* ── 5. the sweep (the reserves cron, every 15 minutes) ─────────────────────*/

-- Quotes past their time are closed here (they reserve nothing). Reserved
-- changes past their payment window are RETURNED to the app, which voids the
-- open invoice in Stripe first and only then releases — a payment that is
-- already through is left for the webhook.
create or replace function public.plan_change_due(p_token text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  update public.plan_changes set status = 'expired', updated_at = now()
   where status = 'quoted' and expires_at < now();
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'status', c.status, 'workspace_id', c.workspace_id,
                     'subscription', c.provider_subscription_id, 'invoice', c.stripe_invoice_id,
                     'coupon', c.stripe_coupon_id, 'schedule', c.stripe_schedule_id, 'timing', c.timing,
                     'effective_at', c.effective_at, 'expires_at', c.expires_at) order by c.expires_at)
                     from public.plan_changes c
                    where (c.status in ('held', 'awaiting_payment') and c.expires_at < now())
                       or (c.status = 'scheduled' and c.expires_at < now())), '[]'::jsonb);
end $$;
revoke all on function public.plan_change_due(text) from public;
grant execute on function public.plan_change_due(text) to anon, authenticated, service_role;

-- A change the app could not automate is announced to the administrators
-- (finance category). Inserted once; an admin's later choice is kept.
do $$
begin
  if to_regclass('public.notification_preferences') is not null then
    execute $q$
      insert into public.notification_preferences (event_type, category, sort_order, telegram_enabled, admin_email_enabled, admin_panel_enabled)
      values ('finance.plan_change_review', 'finance', 150, true, false, true)
      on conflict (event_type) do nothing $q$;
  end if;
end $$;

comment on table public.plan_changes is
  'Smart Subscription Management (0181): one row per plan change — the quote, the reserved pool, the Stripe objects, the status. Off unless app_settings.plan_changes.enabled.';
