-- SYSTEM PROMPT ASSETS ARE STAFF-ONLY.
--
-- prompt_blocks and the system prompt_templates (workspace_id IS NULL) are
-- EcomStudio's own prompt composition logic. They were readable by every
-- authenticated user, which put the product's core IP one API call away.
-- Reads are now restricted to admins; the prompt engine keeps working
-- because it composes prompts server-side.
drop policy if exists "prompt_blocks_read" on public.prompt_blocks;
create policy "prompt_blocks_admin_read" on public.prompt_blocks
  for select using (is_admin());

-- A workspace still sees the templates it owns; the system library does not
-- leave the admin surface.
drop policy if exists "ptpl_select" on public.prompt_templates;
create policy "ptpl_select" on public.prompt_templates
  for select using (
    (workspace_id is not null and is_workspace_member(workspace_id))
    or is_admin()
  );
