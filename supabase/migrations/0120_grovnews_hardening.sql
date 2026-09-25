-- ============================================================================
-- 0120 — GROVNEWS: three tightenings found by the Stage 1 security review
-- ============================================================================
--
-- 1. A CUSTOMER NO LONGER READS ENTITLEMENT ROWS AT ALL. 0119 let a user
--    SELECT their own row, which handed them the admin's `internal_note` and
--    the granting admin's id over plain REST. Nothing customer-facing reads
--    this table — access is asked through grovnews_has_access() — so the
--    own-row policy is dropped. Admins keep full access through
--    grovnews_entitlements_admin (FOR ALL).
--
-- 2. A BLOCKED ACCOUNT HAS NO GROVNEWS ACCESS. The block was enforced by the
--    app layout only; now the access function refuses it too, so a blocked
--    account with an entitlement reads nothing over REST either.
--
-- 3. `grovnews_posts.metadata` is readable by every entitled subscriber (the
--    reader and the admin share the `authenticated` role, so a column grant
--    would take it from the admin as well). Recorded on the column so nobody
--    later puts internal data there.
--
-- CREATE OR REPLACE keeps the function's grants (authenticated only; revoked
-- from public and anon in 0119).

begin;

drop policy if exists grovnews_entitlements_own_read on public.grovnews_entitlements;

create or replace function public.grovnews_has_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not public.account_blocked(auth.uid())
    and exists (
      select 1 from public.grovnews_entitlements e
      where e.user_id = auth.uid()
        and e.status = 'ACTIVE'
        and e.starts_at <= now()
        and (e.expires_at is null or e.expires_at > now())
    );
$$;

comment on column public.grovnews_posts.metadata is
  'Readable by every entitled subscriber. Never store internal or sensitive data here.';

commit;
