-- ADMIN CRM — one query behind the customer list.
--
-- The list used to be assembled in JavaScript: fetch 200 profiles, then EVERY
-- membership, EVERY payment (limit 20000) and EVERY usage event (limit 20000),
-- and join them in memory. That is wasteful, and worse, it made two features
-- dishonest — "sort by spend" only sorted inside the newest 200 customers, and
-- a filter on spend could not exist at all.
--
-- This does the work where the data is: search, filters, sorting and paging in
-- SQL, with the total so the UI can say how many matched rather than how many
-- it happened to fetch.
--
-- Verification comes from auth.users, which is why the function is SECURITY
-- DEFINER — and why the first statement in the body is the admin guard.

create or replace function public.admin_customer_rows(
  p_search text default null,
  p_role text default null,
  -- 'active' | 'blocked'
  p_status text default null,
  -- 'yes' | 'no'
  p_verified text default null,
  -- a plan name, or 'free' for customers with no active subscription
  p_plan text default null,
  -- registered since this moment
  p_since timestamptz default null,
  -- 'newest' | 'oldest' | 'name' | 'spent' | 'credits' | 'active'
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
      coalesce(p.blocked, false) as blocked,
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
    -- The workspace the customer is actually working in: the one they own,
    -- and only failing that the first they belong to.
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
    -- 'newest', and the tiebreaker for every other sort.
    f.created_at desc
  limit v_limit offset v_offset;
end;
$$;

revoke execute on function public.admin_customer_rows(
  text, text, text, text, text, timestamptz, text, integer, integer
) from anon, public;

-- The plan names an operator may filter by, taken from what actually exists
-- rather than from a hardcoded list in the UI. §26: only expose filters that
-- map to real states.
create or replace function public.admin_customer_plans()
returns table (plan text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'not_authorized';
  end if;
  return query
    select distinct sp.name
    from public.subscriptions s
    join public.subscription_plans sp on sp.id = s.plan_id
    where s.status = 'active'
    order by 1;
end;
$$;

revoke execute on function public.admin_customer_plans() from anon, public;
