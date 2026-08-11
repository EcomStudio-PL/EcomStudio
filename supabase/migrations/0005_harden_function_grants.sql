-- Trigger-only functions: not callable via API at all
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.prevent_role_escalation() from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

-- Helper checks: needed by RLS for signed-in users only
revoke execute on function public.is_admin(uuid) from public, anon;
revoke execute on function public.is_workspace_member(uuid, uuid) from public, anon;
revoke execute on function public.is_workspace_manager(uuid, uuid) from public, anon;
grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.is_workspace_member(uuid, uuid) to authenticated;
grant execute on function public.is_workspace_manager(uuid, uuid) to authenticated;

-- Audit log append: signed-in users only
revoke execute on function public.log_activity(uuid,text,text,uuid,jsonb,uuid) from public, anon;

-- Pin search_path on the touch trigger
alter function public.touch_updated_at() set search_path = public;

-- Accepted advisor WARNs (by design): is_admin / is_workspace_member / is_workspace_manager /
-- log_activity remain executable by `authenticated` — required for RLS policy evaluation and
-- the append-only audit trail; they expose nothing beyond the caller's own booleans.
