-- 0140 — MINIATURKA V2: the customer is told the outcome, not the workflow.
--
-- One function body is replaced (thumbnail_run_status — same signature, same
-- caller rule: the caller's own run in a workspace they belong to). Nothing
-- else is touched: no table, row, policy or storage object.
--
-- 1. THE CUSTOMER'S VIEW, SLIMMED SERVER-SIDE. thumbnail_run_status no longer
--    returns the run's stages, steps, intermediate file paths, job ids or
--    outputs — only what the panel shows: working / done / failed with a safe
--    error code, the finished file, and for a retry the photos the run was
--    started with and how many Retusz results are already paid for. Hiding
--    the steps in the browser alone would leave them one API call away.
--
-- APPLY AFTER the deploy that reads the slim shape (that code reads both).
--
-- ROLLBACK (manual): re-create thumbnail_run_status with 0139's body.

-- 1 ─────────────────────────────────────────────────────────────────────────
create or replace function public.thumbnail_run_status(p_run_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', r.id, 'status', r.status, 'error', r.error,
    'created_at', r.created_at, 'finished_at', r.finished_at,
    'driving', coalesce(r.locked_until > now(), false),
    'photos', coalesce(r.input->'photos', '[]'::jsonb),
    'retouch', coalesce((r.input->>'retouch')::boolean, false),
    'retouched_count', (
      select count(*) from public.ai_engine_step_runs s
       where s.run_id = r.id and s."position" = 1 and s.status = 'succeeded'),
    'result', case when r.status = 'ok' then jsonb_build_object(
      'path', coalesce(
        (select f.output->>'path' from public.ai_engine_step_runs f
          where f.run_id = r.id and f."position" = 3 and f.status = 'succeeded' limit 1),
        r.outputs->0->>'path'),
      'width', (select f.output->'width' from public.ai_engine_step_runs f
                 where f.run_id = r.id and f."position" = 3 and f.status = 'succeeded' limit 1),
      'height', (select f.output->'height' from public.ai_engine_step_runs f
                  where f.run_id = r.id and f."position" = 3 and f.status = 'succeeded' limit 1)) end)
    from public.ai_engine_runs r
   where r.id = p_run_id
     and r.run_kind = 'thumbnail'
     and r.user_id = auth.uid()
     and public.is_workspace_member(r.workspace_id);
$$;
revoke all on function public.thumbnail_run_status(uuid) from public, anon;
grant execute on function public.thumbnail_run_status(uuid) to authenticated;
