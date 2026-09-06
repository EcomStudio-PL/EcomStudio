-- ============================================================================
-- WELCOME BONUS + ONBOARDING SURVEY
--
-- A new account is offered a credit bonus for a bounded window after its
-- e-mail is verified, claimed by answering a short survey. Two tables and two
-- functions; the credit movement itself still goes through the one ledger
-- entry point the whole product uses (apply_credit_transaction).
--
-- The design problem this solves is double-claiming. apply_credit_transaction
-- is atomic but NOT idempotent — calling it twice adds twice — so the offer
-- row is the guard: claim_welcome_bonus() takes a row lock, checks the state
-- and only then moves credits, all in one transaction. Two concurrent tabs,
-- a double click and a retried request therefore all collapse to one grant.
--
-- Nothing here can be driven from the browser: both functions are SECURITY
-- DEFINER with EXECUTE revoked from anon, and the tables refuse every client
-- write. A customer can read their own offer and nothing else.
-- ============================================================================

create type welcome_bonus_status as enum ('ELIGIBLE', 'CLAIMED', 'EXPIRED');

create table if not exists public.welcome_bonus_offers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Which run of the campaign issued this offer. Bumping the version in the
  -- admin config starts a new campaign; the unique key below is what stops a
  -- single account collecting the same one twice.
  campaign_version integer not null default 1,
  -- Frozen at creation ON PURPOSE: an admin raising the amount tomorrow must
  -- not silently change what an offer already made to a customer is worth.
  reward_amount integer not null check (reward_amount > 0),
  eligible_at timestamptz not null default now(),
  expires_at timestamptz not null,
  claimed_at timestamptz,
  status welcome_bonus_status not null default 'ELIGIBLE',
  -- The ledger row this offer produced, so an operator can trace the credits.
  credit_transaction_id uuid references public.credit_transactions(id),
  created_at timestamptz not null default now(),
  constraint welcome_bonus_window check (expires_at > eligible_at),
  constraint welcome_bonus_one_per_campaign unique (user_id, campaign_version)
);

create index if not exists welcome_bonus_offers_user_idx
  on public.welcome_bonus_offers (user_id);
-- The analytics panel counts by state and the expiry sweep reads the window.
create index if not exists welcome_bonus_offers_status_idx
  on public.welcome_bonus_offers (status, expires_at);

-- One row per answered question, so a question added or renamed later does
-- not require rewriting anyone's stored answers. Multi-select answers keep
-- their several values in `answer` as a text array.
create table if not exists public.onboarding_survey_responses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  offer_id uuid references public.welcome_bonus_offers(id) on delete set null,
  question_key text not null,
  answer text[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint onboarding_answer_once unique (user_id, question_key)
);

create index if not exists onboarding_survey_user_idx
  on public.onboarding_survey_responses (user_id);

alter table public.welcome_bonus_offers enable row level security;
alter table public.onboarding_survey_responses enable row level security;

-- Customers READ their own offer (the modal needs the amount and the deadline)
-- and nothing else. Every write goes through the functions below, so there is
-- deliberately no insert/update/delete policy for a customer: no route exists
-- for setting your own reward_amount, claimed_at or status.
create policy welcome_bonus_read_own on public.welcome_bonus_offers
  for select to authenticated using (user_id = auth.uid() or is_admin(auth.uid()));

create policy onboarding_read_own on public.onboarding_survey_responses
  for select to authenticated using (user_id = auth.uid() or is_admin(auth.uid()));

-- ────────────────────────────────────────────────────────────────────────────
-- Creating the offer. Called server-side on the first sign-in of a verified
-- account. Idempotent by the unique key: a second call returns the offer that
-- already exists rather than issuing a new one, which is what stops a Google
-- user who also has a password login from collecting two bonuses.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.ensure_welcome_bonus_offer(
  p_user_id uuid,
  p_amount integer,
  p_hours integer,
  p_campaign_version integer default 1,
  p_eligible_at timestamptz default now()
) returns public.welcome_bonus_offers
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_offer public.welcome_bonus_offers;
begin
  if p_amount is null or p_amount <= 0 or p_hours is null or p_hours <= 0 then
    raise exception 'invalid_offer_config';
  end if;

  -- ON CONFLICT DO NOTHING + a follow-up read: two concurrent first requests
  -- (two tabs opening the app at once) both end up with the same row.
  insert into public.welcome_bonus_offers
      (user_id, campaign_version, reward_amount, eligible_at, expires_at)
    values
      (p_user_id, p_campaign_version, p_amount, p_eligible_at,
       p_eligible_at + make_interval(hours => p_hours))
    on conflict (user_id, campaign_version) do nothing;

  select * into v_offer from public.welcome_bonus_offers
    where user_id = p_user_id and campaign_version = p_campaign_version;

  -- Lazily settle a window that ran out. The status is derived from the clock
  -- either way (readers compare expires_at), but recording it keeps the admin
  -- counts honest without a scheduled job.
  if v_offer.status = 'ELIGIBLE' and v_offer.expires_at <= now() then
    update public.welcome_bonus_offers set status = 'EXPIRED'
      where id = v_offer.id returning * into v_offer;
  end if;

  return v_offer;
end;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- Claiming it. The whole thing is one transaction: lock, check, save answers,
-- move credits ONCE, stamp the claim.
--
-- `for update` on the offer row is the mutex. A second concurrent call blocks
-- here, and by the time it proceeds claimed_at is set, so it returns
-- 'already_claimed' and adds nothing. The server clock (now()) decides expiry
-- — never a timestamp from the caller.
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.claim_welcome_bonus(
  p_answers jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user_id uuid := auth.uid();
  v_offer public.welcome_bonus_offers;
  v_wallet_id uuid;
  v_tx_id uuid;
  v_balance integer;
  v_key text;
  v_value jsonb;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'unauthenticated');
  end if;

  -- THE LOCK. Everything after this runs with the offer row held.
  select * into v_offer from public.welcome_bonus_offers
    where user_id = v_user_id
    order by campaign_version desc
    limit 1
    for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'no_offer');
  end if;

  if v_offer.claimed_at is not null then
    -- Not an error the customer needs to see as a failure: they already have
    -- the credits. The caller renders the success state.
    return jsonb_build_object('ok', false, 'error', 'already_claimed',
                              'amount', v_offer.reward_amount);
  end if;

  if v_offer.expires_at <= now() then
    update public.welcome_bonus_offers set status = 'EXPIRED' where id = v_offer.id;
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  -- The wallet belongs to the user's workspace; a missing one means the
  -- account was never bootstrapped, which is a real failure worth reporting.
  select w.id, w.balance into v_wallet_id, v_balance
    from public.credit_wallets w
    join public.workspaces ws on ws.id = w.workspace_id
    where ws.owner_id = v_user_id
    order by ws.created_at asc
    limit 1;
  if v_wallet_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_wallet');
  end if;

  -- Answers first: if anything below fails the whole transaction rolls back,
  -- so credits without a survey (or a survey without credits) cannot happen.
  for v_key, v_value in select * from jsonb_each(coalesce(p_answers, '{}'::jsonb))
  loop
    insert into public.onboarding_survey_responses (user_id, offer_id, question_key, answer)
      values (
        v_user_id, v_offer.id, left(v_key, 60),
        (select coalesce(array_agg(left(x, 120)), '{}') from jsonb_array_elements_text(v_value) as t(x))
      )
      on conflict (user_id, question_key) do update set answer = excluded.answer;
  end loop;

  -- ONE credit movement, through the same ledger entry point everything else
  -- uses. reference_id ties the transaction back to the offer.
  v_tx_id := public.apply_credit_transaction(
    v_wallet_id,
    v_offer.reward_amount,
    'bonus'::credit_tx_type,
    'Bonus powitalny — ankieta onboardingowa',
    v_offer.id,
    jsonb_build_object('source', 'welcome_survey_bonus',
                       'campaign_version', v_offer.campaign_version),
    v_user_id
  );

  update public.welcome_bonus_offers
    set claimed_at = now(), status = 'CLAIMED', credit_transaction_id = v_tx_id
    where id = v_offer.id;

  select balance into v_balance from public.credit_wallets where id = v_wallet_id;

  return jsonb_build_object('ok', true, 'amount', v_offer.reward_amount,
                            'balance', v_balance, 'transaction_id', v_tx_id);
end;
$$;

-- Neither function is a client-callable endpoint: the app calls them from a
-- server action with the caller's own session, and anon has no business here.
revoke all on function public.ensure_welcome_bonus_offer(uuid, integer, integer, integer, timestamptz) from public, anon;
revoke all on function public.claim_welcome_bonus(jsonb) from public, anon;
grant execute on function public.claim_welcome_bonus(jsonb) to authenticated;

-- The default configuration. Flat values, matching how /admin/system renders
-- settings rows; the structured half (copy, questions) lives in its own key
-- so the generic editor never tries to print an object.
insert into public.app_settings (key, value)
  values ('welcome_bonus', jsonb_build_object(
    'active', true,
    'amount', 150,
    'hours', 72,
    'campaign_version', 1,
    'icon', '',
    'badge', 'BONUS'
  ))
  on conflict (key) do nothing;
