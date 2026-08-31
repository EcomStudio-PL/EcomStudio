-- ============================================================
-- 0040 — GENERATOR V3
-- Additive, backward-safe. Old code keeps working against it.
--
-- 1. ai_models: per-mode visibility (Gotowy generator / Własny prompt),
--    admin-chosen badge tone, admin cap on outputs per run.
-- 2. prompt_sessions: first-class session type (advertising | lifestyle)
--    + the customer's optional per-shot briefs (jsonb snapshot).
-- 3. generations: customer note + a definer RPC to write it (clients have
--    deliberately no UPDATE grant on generations).
-- 4. delete_generation: definer RPC removing one generation and returning
--    its storage paths so the caller can clear the bucket under its own
--    storage policy.
-- 5. Pagination index for the generations gallery.
-- 6. Seed: Google image models additionally support 3:4 (the Gemini image
--    API accepts the ratio natively; OpenAI/FAL keep their fixed maps).
-- ============================================================

-- 1) Model catalog additions -------------------------------------------------
alter table public.ai_models
  add column if not exists visible_managed boolean not null default true,
  add column if not exists visible_custom  boolean not null default true,
  add column if not exists badge_tone      text,
  add column if not exists max_outputs     integer;

comment on column public.ai_models.visible_managed is
  'Customer can pick this model in the managed generator (Gotowy generator).';
comment on column public.ai_models.visible_custom is
  'Customer can pick this model in the custom-prompt generator (Własny prompt).';
comment on column public.ai_models.badge_tone is
  'Visual tone of the customer-facing badge (green/amber/blue/info/violet/pink/neutral). Null = default per badge key.';
comment on column public.ai_models.max_outputs is
  'Admin cap on images per run; effective max = least(adapter capability, this). Null = adapter capability.';

-- 2) Session type + shot briefs ---------------------------------------------
alter table public.prompt_sessions
  add column if not exists session_type text,
  add column if not exists shot_briefs jsonb;

alter table public.prompt_sessions
  drop constraint if exists prompt_sessions_session_type_check;
alter table public.prompt_sessions
  add constraint prompt_sessions_session_type_check
  check (session_type is null or session_type in ('advertising', 'lifestyle'));

comment on column public.prompt_sessions.session_type is
  'Customer-chosen session flavour steering the hidden prompt engine: advertising | lifestyle.';
comment on column public.prompt_sessions.shot_briefs is
  'Snapshot of optional customer per-shot briefs: [{text, keep_framing, ref_index}].';

-- 3) Customer note on a generation ------------------------------------------
alter table public.generations
  add column if not exists user_note text;

create or replace function public.set_generation_note(gen_id uuid, note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
begin
  select workspace_id into v_ws from public.generations where id = gen_id;
  if v_ws is null or not public.is_workspace_member(v_ws, auth.uid()) then
    raise exception 'not_found';
  end if;
  update public.generations
     set user_note = nullif(left(coalesce(note, ''), 2000), '')
   where id = gen_id;
end;
$$;

revoke all on function public.set_generation_note(uuid, text) from public, anon;
grant execute on function public.set_generation_note(uuid, text) to authenticated;

-- 4) Delete one generation (rows only; storage is removed by the caller
--    under the existing member delete policy on the bucket) ------------------
create or replace function public.delete_generation(gen_id uuid)
returns text[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_paths text[];
begin
  select workspace_id into v_ws from public.generations where id = gen_id;
  if v_ws is null or not public.is_workspace_member(v_ws, auth.uid()) then
    raise exception 'not_found';
  end if;
  select coalesce(array_agg(p), '{}') into v_paths from (
    select storage_path as p
      from public.generation_assets where generation_id = gen_id
    union all
    select metadata->>'thumb'
      from public.generation_assets
     where generation_id = gen_id and metadata->>'thumb' is not null
  ) s;
  delete from public.generation_assets where generation_id = gen_id;
  delete from public.generations where id = gen_id;
  return v_paths;
end;
$$;

revoke all on function public.delete_generation(uuid) from public, anon;
grant execute on function public.delete_generation(uuid) to authenticated;

-- 5) Gallery pagination index ------------------------------------------------
create index if not exists generations_ws_created_idx
  on public.generations (workspace_id, created_at desc, id desc);

-- 6) Capability seed: Google image models render 3:4 natively ----------------
update public.ai_models m
   set supported_aspect_ratios = array_append(m.supported_aspect_ratios, '3:4')
  from public.ai_providers p
 where m.provider_id = p.id
   and p.slug = 'google'
   and m.type = 'image'
   and not ('3:4' = any(coalesce(m.supported_aspect_ratios, '{}')));
