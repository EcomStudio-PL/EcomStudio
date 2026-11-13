-- 0176 — CENNIK V2: the administrator's finance view (read-only).
--
-- WHAT A CREDIT WAS WORTH is not one number. A credit from Mini, from a
-- Business month, from a Business year or from a top-up was bought at a
-- different price, and a bonus / legacy / admin credit was bought at none.
-- So revenue is attributed through the pools (0174): every credit a run used
-- came out of a lot, every lot came from a payment (or from nothing), and the
-- lot's unit value is that payment's amount over the credits it bought —
-- for an annual payment, over its twelve tranches. Refunded credits are
-- subtracted the same way. Nothing here assumes a flat price per credit.
--
--   gross      what the customer paid (USD, VAT included)
--   net        minus Stripe's reported tax when there is one, otherwise an
--              ESTIMATE at billing.vat_rate_estimate (default 23 %, PL) —
--              always flagged as estimated
--   fee        Stripe's balance-transaction fee, in the payment's currency,
--              when the webhook could read it; otherwise unknown (null)
--   API cost   ai_provider_calls (official price lists × reported usage —
--              cost_basis 'estimated'); a call without a price is counted as
--              unknown, never as 0
--
-- Internal accounts (the admin's and the test workspaces: billing.
-- internal_workspace_ids, plus any workspace owned by an admin) are reported
-- apart: their runs cost real API money, their credits are not sales.
--
-- Everything here is SECURITY DEFINER behind is_admin(); nothing writes.

-- The three internal workspaces as of 13.11.2026 (admin, second test account,
-- E2E). A setting, not code: an admin can extend the list.
insert into public.app_settings (key, value)
values ('billing', jsonb_build_object('internal_workspace_ids', jsonb_build_array(
  'cdd6ed7d-4630-4e29-93d5-69fa60c5d660', 'c538dc41-0ef4-4f04-a7e9-1d6ff73742a5', '9b5352f5-b851-46ca-a29c-478f035c843e'),
  'vat_rate_estimate', 0.23))
on conflict (key) do update set value = public.app_settings.value
  || jsonb_build_object('internal_workspace_ids', coalesce(public.app_settings.value->'internal_workspace_ids', excluded.value->'internal_workspace_ids'),
                        'vat_rate_estimate', coalesce(public.app_settings.value->'vat_rate_estimate', excluded.value->'vat_rate_estimate'));

create or replace function public.finance_is_internal(p_workspace_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_settings s, jsonb_array_elements_text(coalesce(s.value->'internal_workspace_ids', '[]'::jsonb)) w
                  where s.key = 'billing' and w = p_workspace_id::text)
      or exists (select 1 from public.workspaces ws join public.profiles p on p.id = ws.owner_id
                  where ws.id = p_workspace_id and p.role = 'admin');
$$;
revoke all on function public.finance_is_internal(uuid) from public, anon;

-- Unit value of one credit of each lot (minor units of the payment currency).
create or replace function public.finance_lot_values()
returns table (lot_id uuid, wallet_id uuid, kind text, paid boolean, currency text,
               unit_gross numeric, unit_net numeric, unit_fee numeric, vat_estimated boolean, fee_known boolean)
language sql stable security definer set search_path = public as $$
  with vat as (
    select coalesce((select (value->>'vat_rate_estimate')::numeric from public.app_settings where key = 'billing'), 0.23) as r
  ), pay as (
    select p.id, p.amount_cents::numeric as amount, upper(p.currency) as currency, p.tax_cents,
           case when p.stripe_fee_amount is null then null
                when upper(coalesce(p.stripe_fee_currency, p.currency)) = upper(p.currency) or p.stripe_exchange_rate is null
                  then p.stripe_fee_amount::numeric
                else p.stripe_fee_amount::numeric / p.stripe_exchange_rate end as fee,
           coalesce(nullif((select sum(t.credits) from public.subscription_tranches t where t.payment_id = p.id and t.status <> 'void'), 0),
                    nullif((select sum(l.amount) from public.credit_lots l where l.payment_id = p.id), 0)) as credits
      from public.payments p
  )
  select l.id, l.wallet_id, l.kind, pay.id is not null and pay.credits > 0, coalesce(pay.currency, 'USD'),
         case when pay.credits > 0 then pay.amount / pay.credits else 0 end,
         case when pay.credits > 0 then
           (pay.amount - coalesce(pay.tax_cents::numeric, pay.amount - pay.amount / (1 + (select r from vat)))) / pay.credits
         else 0 end,
         case when pay.credits > 0 and pay.fee is not null then pay.fee / pay.credits else 0 end,
         pay.id is not null and pay.tax_cents is null,
         pay.id is null or pay.fee is not null
    from public.credit_lots l left join pay on pay.id = l.payment_id;
$$;
revoke all on function public.finance_lot_values() from public, anon, authenticated;

-- Runs in a window: credits used per pool value, refunds, API calls.
create or replace function public.admin_finance_events(
  p_from timestamptz, p_to timestamptz, p_workspace_id uuid default null, p_limit integer default 200
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public.is_admin(auth.uid()) then raise exception 'not_admin'; end if;
  with vals as (select * from public.finance_lot_values()),
  ev as (
    select e.* from public.usage_events e
     where e.started_at >= p_from and e.started_at < p_to
       and (p_workspace_id is null or e.workspace_id = p_workspace_id)
     order by e.started_at desc limit greatest(1, least(coalesce(p_limit, 200), 100000))
  ), used as (
    select e.id as event_id, m.lot_id, -m.amount as credits
      from ev e join public.credit_lot_moves m on m.tx_id = e.credit_tx_id and m.amount < 0
    union all
    select e.id, m.lot_id, -m.amount
      from ev e join public.credit_transactions rt on rt.reference_id = e.id and rt.type = 'refund'
      join public.credit_lot_moves m on m.tx_id = rt.id and m.amount > 0
  ), rev as (
    select u.event_id,
           sum(u.credits * v.unit_gross) as gross, sum(u.credits * v.unit_net) as net, sum(u.credits * v.unit_fee) as fee,
           sum(u.credits) filter (where v.paid) as paid_credits, sum(u.credits) filter (where not v.paid) as free_credits,
           bool_or(v.vat_estimated) as vat_estimated, bool_and(v.fee_known) as fee_known, max(v.currency) as currency
      from used u join vals v on v.lot_id = u.lot_id group by u.event_id
  ), refunds as (
    select rt.reference_id as event_id, sum(rt.amount) as credits, count(*) as n
      from public.credit_transactions rt join ev e on e.id = rt.reference_id where rt.type = 'refund' group by rt.reference_id
  ), calls as (
    select c.usage_event_id as event_id,
           jsonb_agg(jsonb_build_object('provider', c.provider_slug, 'model', c.model, 'status', c.status,
             'input_tokens', c.input_tokens, 'output_tokens', c.output_tokens, 'thought_tokens', c.thought_tokens,
             'resolution', c.resolution, 'cost_usd_micros', c.cost_usd_micros, 'cost_basis', c.cost_basis) order by c.created_at) as calls,
           sum(c.cost_usd_micros) as cost_known, count(*) filter (where c.cost_usd_micros is null) as cost_unknown,
           count(*) as n, sum(c.input_tokens) as tin, sum(c.output_tokens) as tout
      from public.ai_provider_calls c join ev e on e.id = c.usage_event_id group by c.usage_event_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'at', e.started_at, 'workspace_id', e.workspace_id, 'internal', public.finance_is_internal(e.workspace_id),
      'user_email', (select p.email from public.profiles p where p.id = e.user_id),
      'tool', coalesce(e.metadata->>'operation', e.metadata->>'tool', e.service_slug), 'service', e.service_slug,
      'job_id', e.generation_job_id, 'status', e.status, 'model', e.model_slug,
      'resolution', coalesce(e.metadata->>'resolution', (select c->>'resolution' from jsonb_array_elements(coalesce(k.calls, '[]'::jsonb)) c limit 1)),
      'inputs', nullif(coalesce(e.metadata->>'images', e.metadata->>'photos', ''), ''),
      'outputs', e.result_count, 'credits', e.credits_charged,
      'refunded_credits', coalesce(r.credits, 0), 'refunds', coalesce(r.n, 0),
      'calls', coalesce(k.calls, '[]'::jsonb), 'calls_count', coalesce(k.n, 0),
      'input_tokens', k.tin, 'output_tokens', k.tout,
      'api_cost_usd_micros', case when k.n is null then nullif(e.actual_api_cost_usd_micros, 0) else k.cost_known end,
      'api_cost_unknown_calls', coalesce(k.cost_unknown, case when k.n is null and e.actual_api_cost_usd_micros = 0 then 1 else 0 end),
      'revenue_gross', round(coalesce(v.gross, 0)), 'revenue_net', round(coalesce(v.net, 0)), 'fee', round(coalesce(v.fee, 0)),
      'currency', coalesce(v.currency, 'USD'), 'paid_credits', coalesce(v.paid_credits, 0), 'free_credits', coalesce(v.free_credits, 0),
      'vat_estimated', coalesce(v.vat_estimated, false), 'fee_known', coalesce(v.fee_known, true)
    ) order by e.started_at desc), '[]'::jsonb)
    into v
    from ev e left join rev v on v.event_id = e.id left join refunds r on r.event_id = e.id left join calls k on k.event_id = e.id;
  return v;
end $$;
revoke all on function public.admin_finance_events(timestamptz, timestamptz, uuid, integer) from public, anon;
grant execute on function public.admin_finance_events(timestamptz, timestamptz, uuid, integer) to authenticated;

-- The period's money: cash in, deferred, recognised, costs, margin.
create or replace function public.admin_finance_overview(p_from timestamptz, p_to timestamptz, p_workspace_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_vat numeric := coalesce((select (value->>'vat_rate_estimate')::numeric from public.app_settings where key = 'billing'), 0.23);
  v_pay jsonb; v_use jsonb; v_tools jsonb; v_deferred jsonb; v_credits jsonb;
begin
  if not public.is_admin(auth.uid()) then raise exception 'not_admin'; end if;

  -- Cash: payments taken in the window, by kind and period. Plans and
  -- top-ups are sold in USD only (0175); a payment in any other currency is
  -- counted apart, never added to the dollars.
  select jsonb_build_object(
      'other_currency', (select count(*) from public.payments
                          where provider = 'stripe' and upper(currency) <> 'USD'
                            and status in ('succeeded', 'paid', 'completed', 'refunded', 'partially_refunded')
                            and created_at >= p_from and created_at < p_to
                            and (p_workspace_id is null or workspace_id = p_workspace_id)),
      'count', count(*),
      'gross', coalesce(sum(amount_cents), 0),
      'net', coalesce(sum(amount_cents - coalesce(tax_cents, round(amount_cents - amount_cents / (1 + v_vat)))), 0),
      'vat_estimated', bool_or(tax_cents is null),
      'subscription_monthly', coalesce(sum(amount_cents) filter (where kind = 'subscription' and coalesce(billing_period, 'monthly') = 'monthly'), 0),
      'subscription_annual', coalesce(sum(amount_cents) filter (where kind = 'subscription' and billing_period = 'annual'), 0),
      'topups', coalesce(sum(amount_cents) filter (where kind in ('custom_credits', 'credit_pack')), 0),
      'fees', coalesce(sum(case when stripe_fee_amount is null then 0
                                when upper(coalesce(stripe_fee_currency, currency)) = upper(currency) or stripe_exchange_rate is null then stripe_fee_amount
                                else round(stripe_fee_amount / stripe_exchange_rate) end), 0),
      'fees_unknown', count(*) filter (where stripe_fee_amount is null),
      'refunded', coalesce(sum((metadata->'refund'->>'amount_cents')::numeric), 0),
      'internal', coalesce(sum(amount_cents) filter (where public.finance_is_internal(workspace_id)), 0),
      'currency', 'USD')
    into v_pay
    from public.payments
   where provider = 'stripe' and status in ('succeeded', 'paid', 'completed', 'refunded', 'partially_refunded')
     and upper(currency) = 'USD'
     and created_at >= p_from and created_at < p_to
     and (p_workspace_id is null or workspace_id = p_workspace_id);

  -- Usage: credits used and what they were worth; API cost, paying vs internal.
  with ev as (
    select e.* from public.usage_events e
     where e.started_at >= p_from and e.started_at < p_to and (p_workspace_id is null or e.workspace_id = p_workspace_id)
  ), rows as (select (x)::jsonb as r from jsonb_array_elements(public.admin_finance_events(p_from, p_to, p_workspace_id, 100000)) x)
  select jsonb_build_object(
      'runs', count(*),
      'credits_used', coalesce(sum((r->>'credits')::numeric), 0),
      'paid_credits', coalesce(sum((r->>'paid_credits')::numeric), 0),
      'free_credits', coalesce(sum((r->>'free_credits')::numeric), 0),
      'revenue_gross', coalesce(sum((r->>'revenue_gross')::numeric), 0),
      'revenue_net', coalesce(sum((r->>'revenue_net')::numeric), 0),
      'fee_attributed', coalesce(sum((r->>'fee')::numeric), 0),
      'api_cost_paying_usd_micros', coalesce(sum((r->>'api_cost_usd_micros')::numeric) filter (where not (r->>'internal')::boolean), 0),
      'api_cost_internal_usd_micros', coalesce(sum((r->>'api_cost_usd_micros')::numeric) filter (where (r->>'internal')::boolean), 0),
      'api_cost_unknown_calls', coalesce(sum((r->>'api_cost_unknown_calls')::numeric), 0),
      'runs_internal', count(*) filter (where (r->>'internal')::boolean))
    into v_use from rows;

  select coalesce(jsonb_agg(jsonb_build_object('tool', q.tool, 'runs', q.runs, 'succeeded', q.succeeded, 'failed', q.failed,
           'outputs', q.outputs, 'credits', q.credits, 'internal_runs', q.internal_runs) order by q.runs desc), '[]'::jsonb)
    into v_tools from (
    select coalesce(e.metadata->>'operation', e.metadata->>'tool', e.service_slug) as tool,
           count(*) as runs, count(*) filter (where e.status = 'succeeded') as succeeded,
           count(*) filter (where e.status in ('failed', 'refunded')) as failed,
           coalesce(sum(e.result_count), 0) as outputs, coalesce(sum(e.credits_charged), 0) as credits,
           count(*) filter (where public.finance_is_internal(e.workspace_id)) as internal_runs
      from public.usage_events e
     where e.started_at >= p_from and e.started_at < p_to and (p_workspace_id is null or e.workspace_id = p_workspace_id)
     group by 1) q;

  -- Deferred: what paid customers are still owed, at the price they paid —
  -- annual tranches not yet granted, and paid credits not yet used or expired.
  select jsonb_build_object(
      'pending_tranches', coalesce((select count(*) from public.subscription_tranches t
                                     where t.status = 'pending' and (p_workspace_id is null or t.workspace_id = p_workspace_id)), 0),
      'pending_tranche_credits', coalesce((select sum(t.credits) from public.subscription_tranches t
                                     where t.status = 'pending' and (p_workspace_id is null or t.workspace_id = p_workspace_id)), 0),
      'pending_tranche_net', coalesce((select round(sum(t.credits
                                         * (p.amount_cents - coalesce(p.tax_cents::numeric, p.amount_cents - p.amount_cents / (1 + v_vat)))
                                         / nullif((select sum(t2.credits) from public.subscription_tranches t2
                                                    where t2.payment_id = t.payment_id and t2.status <> 'void'), 0)))
                                     from public.subscription_tranches t join public.payments p on p.id = t.payment_id
                                    where t.status = 'pending' and (p_workspace_id is null or t.workspace_id = p_workspace_id)), 0),
      'unused_paid_credits', coalesce((select sum(l.remaining) from public.credit_lots l join public.finance_lot_values() v on v.lot_id = l.id
                                       join public.credit_wallets w on w.id = l.wallet_id
                                      where v.paid and l.remaining > 0 and (p_workspace_id is null or w.workspace_id = p_workspace_id)), 0),
      'unused_paid_net', coalesce((select round(sum(l.remaining * v.unit_net)) from public.credit_lots l join public.finance_lot_values() v on v.lot_id = l.id
                                       join public.credit_wallets w on w.id = l.wallet_id
                                      where v.paid and l.remaining > 0 and (p_workspace_id is null or w.workspace_id = p_workspace_id)), 0))
    into v_deferred;

  -- Credits in the window by movement.
  select jsonb_build_object(
      'granted_subscription', coalesce(sum(t.amount) filter (where t.type = 'subscription' and t.amount > 0), 0),
      'granted_topup', coalesce(sum(t.amount) filter (where t.type in ('topup', 'purchase') and t.amount > 0), 0),
      'granted_bonus', coalesce(sum(t.amount) filter (where t.type in ('bonus', 'promotion', 'admin_grant', 'admin_adjustment', 'manual_adjustment') and t.amount > 0), 0),
      'used', coalesce(-sum(t.amount) filter (where t.type = 'generation'), 0),
      'refunded', coalesce(sum(t.amount) filter (where t.type = 'refund'), 0),
      'expired', coalesce(-sum(t.amount) filter (where t.type = 'expiration'), 0),
      'expired_paid_net', coalesce((select round(sum(-m.amount * v.unit_net)) from public.credit_transactions x
                                     join public.credit_lot_moves m on m.tx_id = x.id
                                     join public.finance_lot_values() v on v.lot_id = m.lot_id
                                     join public.credit_wallets w on w.id = x.wallet_id
                                    where x.type = 'expiration' and x.created_at >= p_from and x.created_at < p_to
                                      and (p_workspace_id is null or w.workspace_id = p_workspace_id)), 0))
    into v_credits
    from public.credit_transactions t join public.credit_wallets w on w.id = t.wallet_id
   where t.created_at >= p_from and t.created_at < p_to and (p_workspace_id is null or w.workspace_id = p_workspace_id);

  return jsonb_build_object('from', p_from, 'to', p_to, 'vat_rate_estimate', v_vat,
    'payments', v_pay, 'usage', v_use, 'tools', v_tools, 'deferred', v_deferred, 'credits', v_credits);
end $$;
revoke all on function public.admin_finance_overview(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.admin_finance_overview(timestamptz, timestamptz, uuid) to authenticated;
