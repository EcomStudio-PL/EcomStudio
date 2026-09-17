-- ─────────────────────────────────────────────────────────────────────────────
-- "USUŃ KONTO" ACTUALLY DELETES THE ACCOUNT
--
-- What it did before (0068): rewrote `profiles.email` to
-- `usuniete-<8 hex>@grovbase.invalid`, blanked the name, set `blocked` and
-- stopped. `auth.users` was never touched, so:
--
--   * the customer stayed in the CRM list forever as a row nobody could name;
--   * their REAL address stayed occupied in `auth.users`, so signing up again
--     with it failed — the one thing an operator deletes an account to allow;
--   * and because only `profiles.blocked` carried the lock, anything that
--     later cleared that flag handed the "deleted" account back its login.
--     Two such rows exist in production today, both able to sign in.
--
-- This replaces it with a real delete, in ONE transaction, so there is no
-- state where the account is half-gone.
--
-- HOW THE DELETE REACHES EVERYTHING. `profiles.id` references `auth.users(id)`
-- ON DELETE CASCADE, and `workspaces.owner_id` references `profiles(id)` the
-- same way. Removing the auth row therefore takes profiles, workspaces, and
-- everything hanging off a workspace — wallets and their ledger, generations,
-- jobs, prompts, products, tool results, preferences, notifications, support
-- threads, memberships — with it. Every foreign key pointing at `auth.users`
-- is CASCADE or SET NULL; none is RESTRICT, so nothing can wedge halfway.
-- Rows that merely RECORD the account (audit_logs.actor_id, activity_logs,
-- usage_events) are SET NULL and survive, which is what an audit trail is for.
--
-- WHAT DOES NOT GO. `payments` is money that changed hands; a ledger with
-- holes in it is not a ledger, and deleting a customer must not rewrite
-- history. Its workspace reference was CASCADE, which would have destroyed
-- those rows — so it becomes SET NULL, and the identity the row needs to stay
-- reconcilable is copied onto it before the account goes. The account is still
-- gone and the e-mail is still free: nothing is kept alive to hold a receipt.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Payments survive the account they came from ──────────────────────────

alter table public.payments
  alter column workspace_id drop not null;

alter table public.payments
  drop constraint if exists payments_workspace_id_fkey;

alter table public.payments
  add constraint payments_workspace_id_fkey
  foreign key (workspace_id) references public.workspaces(id) on delete set null;

-- Who the payment belonged to, written at the moment the account is deleted.
-- Without this a detached row is an amount with no counterparty.
alter table public.payments
  add column if not exists archived_workspace_id uuid,
  add column if not exists archived_account_email text,
  add column if not exists archived_at timestamptz;

comment on column public.payments.archived_account_email is
  'E-mail of the account this payment belonged to, copied here when that account was deleted. The account itself is gone.';

-- ── 2. The delete itself ────────────────────────────────────────────────────

create or replace function public.admin_hard_delete_user(p_user_id uuid, p_confirm_email text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_profile_email text;
  v_auth_email text;
  v_confirm text := lower(trim(coalesce(p_confirm_email, '')));
  v_payments int := 0;
begin
  if not public.is_admin(v_actor) then
    raise exception 'not_authorized';
  end if;
  -- An admin cannot delete their own account from the CRM: it would lock the
  -- panel behind a door nobody is left holding a key to.
  if p_user_id = v_actor then
    raise exception 'cannot_delete_self';
  end if;

  select p.email, u.email into v_profile_email, v_auth_email
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.id = p_user_id;

  if v_auth_email is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- The typed confirmation is checked HERE, not only in the dialog: a mistyped
  -- address must fail on the server too, or the confirmation is decoration.
  -- EITHER address is accepted, because they can differ: an account closed by
  -- the old soft delete shows a `…@grovbase.invalid` placeholder in the panel
  -- while `auth.users` still holds the real one, and the operator must be able
  -- to clear that leftover by typing what is actually on their screen.
  if v_confirm <> lower(coalesce(v_profile_email, '')) and v_confirm <> lower(v_auth_email) then
    return jsonb_build_object('ok', false, 'error', 'confirmation_mismatch');
  end if;

  -- Detach the money before the workspaces go, and stamp each row with the
  -- account it belonged to so it stays reconcilable afterwards.
  update public.payments pay
  set archived_workspace_id = pay.workspace_id,
      archived_account_email = coalesce(v_auth_email, v_profile_email),
      archived_at = now(),
      workspace_id = null
  from public.workspaces w
  where w.id = pay.workspace_id
    and w.owner_id = p_user_id;
  get diagnostics v_payments = row_count;

  -- One statement, and the cascade does the rest. If anything below it were
  -- to fail, the whole function rolls back — the account is never half-deleted.
  delete from auth.users where id = p_user_id;

  return jsonb_build_object(
    'ok', true,
    'email', v_auth_email,
    'payments_archived', v_payments
  );
end;
$$;

revoke all on function public.admin_hard_delete_user(uuid, text) from public;
revoke all on function public.admin_hard_delete_user(uuid, text) from anon;
grant execute on function public.admin_hard_delete_user(uuid, text) to authenticated;

-- ── 3. The soft delete is gone ──────────────────────────────────────────────
--
-- Dropped rather than left in place: a definer function that quietly keeps an
-- account alive while telling the operator it is deleted is the bug this
-- migration exists to remove, and leaving it callable invites its return.
drop function if exists public.admin_soft_delete_user(uuid, text);
