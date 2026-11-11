-- 0171 — ENGINE PROMPTS NEVER REACH A CUSTOMER'S BROWSER, NOT EVEN THROUGH THE API
--
-- A customer buys the result of a GrovBase tool, not the instructions the
-- engine wrote for it. The app already projects only the customer's own
-- prompt (lib/generation-prompt.ts), but three tables were readable column
-- by column — and generation_jobs writable — by any workspace member straight
-- from the browser (the publishable key + their session, through PostgREST):
--
--   generation_jobs    prompt_text of older engine rows (no origin), settings;
--                      and UPDATE of every column (origin, settings, status…)
--   generated_prompts  engine-written descriptions, older plaintext templates
--   prompt_sessions    the engine's analysis, product lock, knowledge used
--
-- From now on a member reaches these rows only through the APPLICATION: the
-- server's requests carry its own token in `x-grovbase-server`, which
-- public.server_request_ok() (0157) verifies; a browser never holds it. An
-- admin keeps direct read access as before. Definer functions (the engine's
-- token-guarded RPCs, favourites, notes, deletes) are unaffected — they never
-- ran under these policies.
--
-- What does NOT change: no row, column, prompt (encrypted or plain) or
-- history entry is touched — historical engine prompts stay for admin
-- diagnostics. Membership is still required (the token proves the caller is
-- the server; membership proves it acts for the right workspace).
--
-- Idempotent: every policy is dropped (if present) and created again.
--
-- ROLLBACK (manual): recreate the previous policies without
-- `(select public.server_request_ok())` — their bodies are quoted in each
-- comment below.

set local lock_timeout = '10s';

-- generation_jobs ─────────────────────────────────────────────────────────────
-- before: gj_select  (is_workspace_member(workspace_id) or (select is_admin()))
--         gj_insert  is_workspace_member(workspace_id) and user_id = (select auth.uid())
--         gj_update  (is_workspace_member(workspace_id) or (select is_admin()))
drop policy if exists gj_select on public.generation_jobs;
create policy gj_select on public.generation_jobs for select
  using ((public.is_workspace_member(workspace_id) and (select public.server_request_ok())) or (select public.is_admin()));
drop policy if exists gj_insert on public.generation_jobs;
create policy gj_insert on public.generation_jobs for insert
  with check (public.is_workspace_member(workspace_id) and user_id = (select auth.uid()) and (select public.server_request_ok()));
drop policy if exists gj_update on public.generation_jobs;
create policy gj_update on public.generation_jobs for update
  using ((public.is_workspace_member(workspace_id) and (select public.server_request_ok())) or (select public.is_admin()));

-- generated_prompts ───────────────────────────────────────────────────────────
-- before: gp_select (is_workspace_member(workspace_id) or is_admin())
--         gp_insert / gp_update / gp_delete  is_workspace_member(workspace_id)
drop policy if exists gp_select on public.generated_prompts;
create policy gp_select on public.generated_prompts for select
  using ((public.is_workspace_member(workspace_id) and (select public.server_request_ok())) or (select public.is_admin()));
drop policy if exists gp_insert on public.generated_prompts;
create policy gp_insert on public.generated_prompts for insert
  with check (public.is_workspace_member(workspace_id) and (select public.server_request_ok()));
drop policy if exists gp_update on public.generated_prompts;
create policy gp_update on public.generated_prompts for update
  using (public.is_workspace_member(workspace_id) and (select public.server_request_ok()));
drop policy if exists gp_delete on public.generated_prompts;
create policy gp_delete on public.generated_prompts for delete
  using (public.is_workspace_member(workspace_id) and (select public.server_request_ok()));

-- prompt_sessions ─────────────────────────────────────────────────────────────
-- before: ps_select (is_workspace_member(workspace_id) or is_admin())
--         ps_insert  is_workspace_member(workspace_id) and user_id = auth.uid()
--         ps_update / ps_delete  is_workspace_member(workspace_id)
drop policy if exists ps_select on public.prompt_sessions;
create policy ps_select on public.prompt_sessions for select
  using ((public.is_workspace_member(workspace_id) and (select public.server_request_ok())) or (select public.is_admin()));
drop policy if exists ps_insert on public.prompt_sessions;
create policy ps_insert on public.prompt_sessions for insert
  with check (public.is_workspace_member(workspace_id) and user_id = (select auth.uid()) and (select public.server_request_ok()));
drop policy if exists ps_update on public.prompt_sessions;
create policy ps_update on public.prompt_sessions for update
  using (public.is_workspace_member(workspace_id) and (select public.server_request_ok()));
drop policy if exists ps_delete on public.prompt_sessions;
create policy ps_delete on public.prompt_sessions for delete
  using (public.is_workspace_member(workspace_id) and (select public.server_request_ok()));
