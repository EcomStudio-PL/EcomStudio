-- 0182 · GrovBase Shot knowledge base: a flexible import, a guarded activation.
--
-- From now on the admin panel saves ANY readable .md knowledge file as a new,
-- inactive version (the structure is no longer a reason to refuse an upload);
-- a file the engine cannot run on is a draft. This migration makes sure such
-- a draft can never replace the working active version: activation (and
-- rollback) refuse a version whose stored parse the engine would not accept —
-- the same test as readKb() in lib/grovshot-shot/kb.ts: format 1, the known
-- arrays, at least one style recipe and a default footer.
--
-- Nothing else changes: the import function (0166), the versions, their
-- history and the engine's pinned read are untouched; orders in progress keep
-- the version they pinned.

create or replace function public.grovshot_shot_kb_ready(p jsonb)
returns boolean
language plpgsql immutable set search_path = public as $$
begin
  if p is null or jsonb_typeof(p) is distinct from 'object' or (p->>'format') is distinct from '1' then return false; end if;
  if jsonb_typeof(p->'recipes') is distinct from 'array' or jsonb_typeof(p->'special') is distinct from 'array'
     or jsonb_typeof(p->'footers') is distinct from 'array' or jsonb_typeof(p->'negativeBase') is distinct from 'string'
     or jsonb_typeof(p->'sections') is distinct from 'array' or jsonb_typeof(p->'planRules') is distinct from 'array'
     or jsonb_typeof(p->'directions') is distinct from 'array' then
    return false;
  end if;
  if jsonb_array_length(p->'recipes') = 0 then return false; end if;
  return exists (
    select 1 from jsonb_array_elements(p->'footers') f
    where jsonb_typeof(f) = 'object' and jsonb_typeof(f->'when') = 'object' and (f->'when'->'isDefault') = 'true'::jsonb
  );
end $$;
revoke all on function public.grovshot_shot_kb_ready(jsonb) from public, anon;
grant execute on function public.grovshot_shot_kb_ready(jsonb) to authenticated;

-- Activate a version for NEW orders (an earlier one = a rollback). Orders in
-- progress keep the version they pinned. A version the engine cannot run on is
-- refused before anything changes.
create or replace function public.grovshot_shot_kb_activate(p_version_id uuid, p_note text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v public.knowledge_versions;
  v_prev public.knowledge_versions;
  v_action text;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select * into v from public.knowledge_versions where id = p_version_id and tool_key = 'grovshot_shot';
  if not found then return jsonb_build_object('error', 'not_found'); end if;
  if v.active then return jsonb_build_object('version', v.version, 'unchanged', true); end if;
  if not public.grovshot_shot_kb_ready(v.parsed) then return jsonb_build_object('error', 'not_engine_ready', 'version', v.version); end if;
  select * into v_prev from public.knowledge_versions where tool_key = 'grovshot_shot' and active;
  v_action := case when v_prev.id is not null and v.version < v_prev.version then 'rolled_back' else 'activated' end;
  update public.knowledge_versions set active = false where tool_key = 'grovshot_shot' and active;
  update public.knowledge_versions set active = true, activated_by = auth.uid(), activated_at = now() where id = v.id;
  insert into public.knowledge_version_events (tool_key, version_id, action, from_version_id, note, actor)
  values ('grovshot_shot', v.id, v_action, v_prev.id, nullif(left(btrim(coalesce(p_note, '')), 2000), ''), auth.uid());
  perform public.log_activity(null, case when v_action = 'rolled_back' then 'admin.grovshot_kb_rolled_back' else 'admin.grovshot_kb_activated' end,
    'knowledge_version', v.id, jsonb_build_object('version', v.version, 'from_version', v_prev.version), null);
  return jsonb_build_object('version', v.version, 'action', v_action, 'from_version', v_prev.version);
end $$;
revoke all on function public.grovshot_shot_kb_activate(uuid, text) from public, anon;
grant execute on function public.grovshot_shot_kb_activate(uuid, text) to authenticated;
