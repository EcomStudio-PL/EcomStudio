-- PERFORMANCE — the admin dashboard summed every generation transaction in
-- JavaScript, transferring the whole ledger on each /admin view. This moves
-- the sum into SQL. SECURITY INVOKER on purpose: RLS still decides which
-- rows the caller may aggregate, so the function grants nothing.
create or replace function public.generation_credits_total()
returns bigint
language sql stable security invoker set search_path = public
as $$
  select coalesce(sum(abs(amount)), 0)::bigint
  from public.credit_transactions
  where type = 'generation';
$$;

-- Matching index so the aggregate stays cheap as the ledger grows.
create index if not exists credit_transactions_type_idx
  on public.credit_transactions (type);
