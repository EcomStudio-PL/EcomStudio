-- TEMPORARY ACCOUNT BLOCK
--
-- `profiles.blocked` already existed as a permanent switch: an account was
-- either usable or it was not, for ever, and the only way back was an admin
-- flipping it again. What operations actually needs most of the time is a
-- PAUSE — "this account is under manual review until Thursday" — that expires
-- by itself and never touches a credit, a file or a generation.
--
-- Three principles here:
--
--  1. Nothing is deleted. A block hides access, not data.
--  2. The expiry is a FACT ABOUT THE ROW, not a job that has to run. A block
--     is in force while `blocked = true and (blocked_until is null or
--     blocked_until > now())`, so if the sweep never ran, the block still
--     lifts itself on the next read. The sweep only tidies the flag.
--  3. `blocked_until is null` keeps meaning "indefinite", which is what every
--     existing blocked row is — including the accounts neutralised by
--     close_out_denied_signup(). Their behaviour is unchanged.

alter table public.profiles
  add column if not exists blocked_until timestamptz,
  add column if not exists blocked_reason text,
  add column if not exists blocked_note text,
  add column if not exists blocked_at timestamptz,
  add column if not exists blocked_by uuid references auth.users(id) on delete set null;

comment on column public.profiles.blocked_until is
  'When a temporary block expires. NULL with blocked = true means indefinite.';
comment on column public.profiles.blocked_note is
  'Internal note. Never shown to the customer.';

-- ── Is this account blocked RIGHT NOW? ──────────────────────────────────────
--
-- One definition, used by the app shell, by every protected API route and by
-- the CRM list, so those three can never disagree about a customer's state.
create or replace function public.account_blocked(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select p.blocked and (p.blocked_until is null or p.blocked_until > now())
     from public.profiles p where p.id = p_user),
    false);
$$;

revoke execute on function public.account_blocked(uuid) from anon;

-- ── Block an account until a moment ─────────────────────────────────────────
--
-- SECURITY DEFINER with the admin check as its first statement, for the same
-- reason every other admin write in this codebase is: hiding a button is not
-- an authorisation model. An admin cannot block themselves — an operator
-- locking themselves out of the panel that unlocks them is a support ticket
-- nobody can answer.
create or replace function public.admin_block_user(
  p_user uuid,
  p_until timestamptz default null,
  p_reason text default null,
  p_note text default null
)
returns timestamptz
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor uuid := auth.uid();
  v_until timestamptz := p_until;
begin
  if not public.is_admin(v_actor) then
    raise exception 'not_authorized';
  end if;
  if p_user = v_actor then
    raise exception 'cannot_block_self';
  end if;
  if v_until is not null and v_until <= now() then
    raise exception 'until_in_the_past';
  end if;
  -- A year is not a temporary block; anything longer is a deletion decision
  -- that should be taken deliberately, not typed into a date field.
  if v_until is not null and v_until > now() + interval '365 days' then
    raise exception 'until_too_far';
  end if;

  update public.profiles
  set blocked = true,
      blocked_until = v_until,
      blocked_reason = nullif(btrim(coalesce(p_reason, '')), ''),
      blocked_note = nullif(btrim(coalesce(p_note, '')), ''),
      blocked_at = now(),
      blocked_by = v_actor
  where id = p_user;

  if not found then
    raise exception 'user_not_found';
  end if;
  return v_until;
end;
$$;

revoke execute on function public.admin_block_user(uuid, timestamptz, text, text) from anon, public;

-- ── Lift a block early ──────────────────────────────────────────────────────
create or replace function public.admin_unblock_user(p_user uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'not_authorized';
  end if;
  update public.profiles
  set blocked = false,
      blocked_until = null,
      blocked_reason = null,
      blocked_at = null,
      blocked_by = null
  where id = p_user;
  -- blocked_note deliberately survives: the reason an account was paused is
  -- worth keeping after it is running again.
end;
$$;

revoke execute on function public.admin_unblock_user(uuid) from anon, public;

-- ── The tidy-up sweep ───────────────────────────────────────────────────────
--
-- Not the mechanism, only the housekeeping: account_blocked() has already
-- stopped enforcing an expired block. This clears the flag so the CRM does not
-- keep showing rows as "blocked until a date that has passed", and returns how
-- many it lifted so the caller can log something true.
create or replace function public.expire_account_blocks()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count integer;
begin
  update public.profiles
  set blocked = false, blocked_until = null, blocked_reason = null,
      blocked_at = null, blocked_by = null
  where blocked and blocked_until is not null and blocked_until <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.expire_account_blocks() from anon, public;

-- Only the cron path (an admin session, or the service role) should sweep.
-- Everyone else reads the truth from account_blocked() instead.
create or replace function public.admin_expire_account_blocks()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'not_authorized';
  end if;
  return public.expire_account_blocks();
end;
$$;

revoke execute on function public.admin_expire_account_blocks() from anon, public;

-- ── The CRM list learns about the new state ─────────────────────────────────
--
-- Return type changes, so the old signature is dropped first. Same arguments,
-- one extra column and one extra status filter: 'temp' — the operator's real
-- question is "who is paused right now", which is not the same as "who has the
-- flag set", now that the flag can be stale by a few minutes.
drop function if exists public.admin_customer_rows(
  text, text, text, text, text, timestamptz, text, integer, integer);

create function public.admin_customer_rows(
  p_search text default null,
  p_role text default null,
  -- 'active' | 'blocked' (any block) | 'temp' (a block with an end date)
  p_status text default null,
  p_verified text default null,
  p_plan text default null,
  p_since timestamptz default null,
  p_sort text default 'newest',
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  id uuid,
  email text,
  full_name text,
  role text,
  blocked boolean,
  blocked_until timestamptz,
  created_at timestamptz,
  verified boolean,
  last_sign_in_at timestamptz,
  workspace_id uuid,
  workspace_name text,
  plan text,
  credits integer,
  spent_cents bigint,
  generations bigint,
  last_active timestamptz,
  total_count bigint
)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'not_authorized';
  end if;

  return query
  with base as (
    select
      p.id,
      p.email,
      p.full_name,
      p.role::text as role,
      -- The same definition the gate uses: an expired block is not a block.
      (coalesce(p.blocked, false)
        and (p.blocked_until is null or p.blocked_until > now())) as blocked,
      case
        when coalesce(p.blocked, false) and p.blocked_until > now()
        then p.blocked_until
      end as blocked_until,
      p.created_at,
      (u.email_confirmed_at is not null) as verified,
      u.last_sign_in_at,
      ws.id as workspace_id,
      ws.name as workspace_name,
      coalesce(sub.plan_name, 'free') as plan,
      coalesce(cw.balance, 0) as credits,
      coalesce(pay.spent_cents, 0)::bigint as spent_cents,
      coalesce(ev.n, 0)::bigint as generations,
      ev.last_at as last_active
    from public.profiles p
    left join auth.users u on u.id = p.id
    left join lateral (
      select w.id, w.name
      from public.workspaces w
      where w.owner_id = p.id
         or exists (select 1 from public.workspace_members m
                    where m.workspace_id = w.id and m.user_id = p.id)
      order by (w.owner_id = p.id) desc, w.created_at
      limit 1
    ) ws on true
    left join lateral (
      select sp.name as plan_name
      from public.subscriptions s
      join public.subscription_plans sp on sp.id = s.plan_id
      where s.workspace_id = ws.id and s.status = 'active'
      order by s.created_at desc
      limit 1
    ) sub on true
    left join lateral (
      select cwx.balance from public.credit_wallets cwx
      where cwx.workspace_id = ws.id limit 1
    ) cw on true
    left join lateral (
      select sum(pm.amount_cents) as spent_cents
      from public.payments pm
      where pm.workspace_id = ws.id
        and pm.status in ('succeeded', 'paid', 'completed')
    ) pay on true
    left join lateral (
      select count(*) as n, max(e.created_at) as last_at
      from public.usage_events e
      where e.user_id = p.id
    ) ev on true
  ),
  filtered as (
    select * from base b
    where (v_search is null
           or b.email ilike '%' || v_search || '%'
           or coalesce(b.full_name, '') ilike '%' || v_search || '%')
      and (p_role is null or b.role = p_role)
      and (p_status is null
           or (p_status = 'blocked' and b.blocked)
           or (p_status = 'temp' and b.blocked and b.blocked_until is not null)
           or (p_status = 'active' and not b.blocked))
      and (p_verified is null
           or (p_verified = 'yes' and b.verified)
           or (p_verified = 'no' and not b.verified))
      and (p_plan is null or b.plan = p_plan)
      and (p_since is null or b.created_at >= p_since)
  )
  select f.*, count(*) over () as total_count
  from filtered f
  order by
    case when p_sort = 'oldest' then f.created_at end asc,
    case when p_sort = 'name' then lower(coalesce(f.full_name, f.email)) end asc,
    case when p_sort = 'spent' then f.spent_cents end desc,
    case when p_sort = 'credits' then f.credits end desc,
    case when p_sort = 'active' then f.last_active end desc nulls last,
    f.created_at desc
  limit v_limit offset v_offset;
end;
$$;

revoke execute on function public.admin_customer_rows(
  text, text, text, text, text, timestamptz, text, integer, integer
) from anon, public;
