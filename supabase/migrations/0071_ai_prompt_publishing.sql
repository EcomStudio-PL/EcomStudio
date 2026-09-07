-- PROMPT PUBLISHING — one transaction, so production is never left in a state
-- nobody chose.
--
-- Saving and publishing a hidden prompt touches two rows: the new version, and
-- the one it replaces. Doing that as two statements from the application means
-- a failure between them can leave a tool with two published prompts (the
-- unique index would refuse) or none. These functions do it atomically, and
-- allocate the version number inside the same transaction so two operators
-- drafting at once cannot collide.
--
-- Every one of them starts with the admin guard: SECURITY DEFINER exists here
-- to make the write atomic, not to widen who may write.

create or replace function public.ai_save_tool_prompt(
  p_tool_key text,
  p_body_encrypted text,
  p_iv text,
  p_tag text,
  p_summary text default null,
  p_reason text default null,
  p_source text default 'manual',
  p_publish boolean default false
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_version integer;
  v_id uuid;
begin
  if not public.is_admin(v_actor) then
    raise exception 'not_authorized';
  end if;
  if p_tool_key is null or not exists (select 1 from public.ai_tools t where t.tool_key = p_tool_key) then
    return jsonb_build_object('ok', false, 'error', 'unknown_tool');
  end if;
  if coalesce(btrim(p_body_encrypted), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'empty_body');
  end if;

  select coalesce(max(version), 0) + 1 into v_version
    from public.ai_tool_prompts where tool_key = p_tool_key;

  -- Publishing supersedes the standing version rather than overwriting it:
  -- every previous prompt stays readable and restorable.
  if p_publish then
    update public.ai_tool_prompts
       set status = 'superseded'
     where tool_key = p_tool_key and status = 'published';
  end if;

  insert into public.ai_tool_prompts (
    tool_key, version, status, body_encrypted, body_iv, body_tag,
    summary, reason, source, created_by, published_at
  ) values (
    p_tool_key, v_version,
    case when p_publish then 'published' else 'draft' end,
    p_body_encrypted, p_iv, p_tag,
    nullif(btrim(coalesce(p_summary, '')), ''),
    nullif(btrim(coalesce(p_reason, '')), ''),
    case when p_source in ('manual', 'knowledge') then p_source else 'manual' end,
    v_actor,
    case when p_publish then now() else null end
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'version', v_version);
end;
$$;

revoke execute on function public.ai_save_tool_prompt(text, text, text, text, text, text, text, boolean) from anon, public;

-- Publish an existing draft.
create or replace function public.ai_publish_tool_prompt(p_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_tool text;
  v_status text;
begin
  if not public.is_admin(v_actor) then
    raise exception 'not_authorized';
  end if;
  select tool_key, status into v_tool, v_status
    from public.ai_tool_prompts where id = p_id;
  if v_tool is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if v_status = 'published' then return jsonb_build_object('ok', true, 'already', true); end if;

  update public.ai_tool_prompts set status = 'superseded'
   where tool_key = v_tool and status = 'published';
  update public.ai_tool_prompts
     set status = 'published',
         published_at = now(),
         reason = coalesce(nullif(btrim(coalesce(p_reason, '')), ''), reason)
   where id = p_id;

  return jsonb_build_object('ok', true, 'tool_key', v_tool);
end;
$$;

revoke execute on function public.ai_publish_tool_prompt(uuid, text) from anon, public;

-- Restore an older version by COPYING it forward into a new published
-- version. History is append-only: "restore Tuesday's prompt" must not erase
-- what happened since, and the ciphertext never leaves the database to do it.
create or replace function public.ai_restore_tool_prompt(p_id uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_src public.ai_tool_prompts%rowtype;
  v_version integer;
  v_id uuid;
begin
  if not public.is_admin(v_actor) then
    raise exception 'not_authorized';
  end if;
  select * into v_src from public.ai_tool_prompts where id = p_id;
  if v_src.id is null then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;

  select coalesce(max(version), 0) + 1 into v_version
    from public.ai_tool_prompts where tool_key = v_src.tool_key;

  update public.ai_tool_prompts set status = 'superseded'
   where tool_key = v_src.tool_key and status = 'published';

  insert into public.ai_tool_prompts (
    tool_key, version, status, body_encrypted, body_iv, body_tag,
    summary, reason, source, created_by, published_at
  ) values (
    v_src.tool_key, v_version, 'published',
    v_src.body_encrypted, v_src.body_iv, v_src.body_tag,
    v_src.summary,
    coalesce(nullif(btrim(coalesce(p_reason, '')), ''), 'restore v' || v_src.version),
    v_src.source, v_actor, now()
  )
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'version', v_version, 'from_version', v_src.version);
end;
$$;

revoke execute on function public.ai_restore_tool_prompt(uuid, text) from anon, public;
