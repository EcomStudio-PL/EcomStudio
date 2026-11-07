-- ════════════════════════════════════════════════════════════════════════════
-- 0166 · GROVBASE SHOT — LIFESTYLE ENGINE ("jak działa automatyzacja"), STAGE 1
--
-- The new pipeline (card → plan → prompt modules → Nano Banana Pro, no image
-- QC, one generation per shot) runs on the SAME run store, worker, ledger and
-- server functions as GrovShot V2 (0162–0165). This migration only ADDS:
--
--   1. a second scope of the knowledge tables, 'grovshot_shot': the engine's
--      knowledge is ONE Markdown file per version (sources = the file, its
--      sha256; versions = the parse, its hash, the change note, draft/active).
--      V2's rule-based knowledge ('grovshot_v2') is untouched;
--   2. knowledge_version_events — the publication history (imported,
--      activated, rolled back), written only by the functions below;
--   3. a version, once saved, never changes (a guard trigger): an order that
--      pinned it keeps exactly that text to its end; versions are never
--      deleted (no delete grant);
--   4. grovshot_shot_kb_import / _activate (admin) and grovshot_shot_kb
--      (server token: the pinned or the active parse);
--   5. GLOBAL provider slots (text / image) with a lease — the engine's calls
--      in flight across every server instance; a crashed holder's slot
--      expires by itself;
--   6. grovshot_shot_test_create — an admin's test order (never charged),
--      built here from the request, the engine settings and the chosen
--      knowledge version; the panel and an operator use this one door;
--   7. grovshot_srv_library_add accepts quality 'skipped' (an image no
--      automatic check looked at — the new engine has none);
--   8. app_settings 'grovshot_shot' with the engine defaults (Claude Sonnet
--      5.5 for the card, plan and prompts; the per-instance limits the app
--      already runs with) — only when absent.
--
-- Nothing is activated and no customer is routed anywhere new: the flag
-- grovshot_engine_v2 and the margin gate decide who orders, as before.
--
-- ROLLBACK (manual, only once no 'grovshot_shot' rows matter):
--   drop function public.grovshot_shot_test_create(jsonb), public.grovshot_shot_queue(),
--     public.grovshot_slot_release(text, text, text), public.grovshot_slot_acquire(text, text, integer, text, integer),
--     public.grovshot_shot_kb(text, uuid), public.grovshot_shot_kb_activate(uuid, text),
--     public.grovshot_shot_kb_import(jsonb, jsonb), public.knowledge_version_guard(), public.knowledge_source_guard();
--   drop table public.grovshot_provider_slots, public.knowledge_version_events;
--   alter table public.knowledge_examples drop column title, drop column photo_paths, drop column notes;
--   delete from public.knowledge_versions where tool_key = 'grovshot_shot';
--   delete from public.knowledge_sources where tool_key = 'grovshot_shot';
--   alter table public.knowledge_versions drop column source_id, drop column parsed,
--     drop column source_sha256, drop column format_version, drop column summary;
--   restore the three tool_key/scope checks and 0163's grovshot_srv_library_add.
-- ════════════════════════════════════════════════════════════════════════════

set local lock_timeout = '10s';

/* 1 ── the second scope ──────────────────────────────────────────────────*/
alter table public.knowledge_sets drop constraint if exists knowledge_sets_scope_check;
alter table public.knowledge_sets add constraint knowledge_sets_scope_check
  check (scope is null or scope in ('grovshot_v2', 'grovshot_shot'));
alter table public.knowledge_sources drop constraint if exists knowledge_sources_tool_key_check;
alter table public.knowledge_sources add constraint knowledge_sources_tool_key_check
  check (tool_key in ('grovshot_v2', 'grovshot_shot'));
alter table public.knowledge_versions drop constraint if exists knowledge_versions_tool_key_check;
alter table public.knowledge_versions add constraint knowledge_versions_tool_key_check
  check (tool_key in ('grovshot_v2', 'grovshot_shot'));

alter table public.knowledge_versions add column if not exists source_id uuid references public.knowledge_sources(id) on delete restrict;
alter table public.knowledge_versions add column if not exists parsed jsonb;
alter table public.knowledge_versions add column if not exists source_sha256 text;
alter table public.knowledge_versions add column if not exists format_version integer;
alter table public.knowledge_versions add column if not exists summary jsonb;
alter table public.knowledge_versions drop constraint if exists knowledge_versions_shot_check;
alter table public.knowledge_versions add constraint knowledge_versions_shot_check check (
  tool_key <> 'grovshot_shot' or (
    source_id is not null and parsed is not null and jsonb_typeof(parsed) = 'object'
    and source_sha256 ~ '^[0-9a-f]{64}$' and format_version = 1
    and changelog is not null and char_length(btrim(changelog)) between 3 and 2000
  ));
create index if not exists knowledge_versions_tool_idx on public.knowledge_versions (tool_key, version desc);

-- The test set (≈10 products): a test case of the 'grovshot_shot' set with
-- its photos in order, its Allegro description and notes (knowledge_examples
-- stays the one place for test cases; admin-only by its RLS, 0042).
alter table public.knowledge_examples add column if not exists title text;
alter table public.knowledge_examples add column if not exists photo_paths text[];
alter table public.knowledge_examples add column if not exists notes text;
alter table public.knowledge_examples drop constraint if exists knowledge_examples_shot_check;
alter table public.knowledge_examples add constraint knowledge_examples_shot_check check (
  (title is null or char_length(title) <= 200)
  and (photo_paths is null or cardinality(photo_paths) between 1 and 10)
  and (notes is null or char_length(notes) <= 1000));

/* 2 ── the publication history ───────────────────────────────────────────*/
create table if not exists public.knowledge_version_events (
  id uuid primary key default gen_random_uuid(),
  tool_key text not null check (tool_key in ('grovshot_v2', 'grovshot_shot')),
  version_id uuid not null references public.knowledge_versions(id) on delete restrict,
  action text not null check (action in ('imported', 'activated', 'rolled_back')),
  from_version_id uuid references public.knowledge_versions(id) on delete restrict,
  note text check (note is null or char_length(note) <= 2000),
  actor uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists knowledge_version_events_idx on public.knowledge_version_events (tool_key, created_at desc);
alter table public.knowledge_version_events enable row level security;
drop policy if exists knowledge_version_events_admin_read on public.knowledge_version_events;
create policy knowledge_version_events_admin_read on public.knowledge_version_events for select
  using ((select public.is_admin()));
revoke all on public.knowledge_version_events from anon;
revoke insert, update, delete on public.knowledge_version_events from authenticated;

/* 3 ── a saved version never changes ─────────────────────────────────────*/
create or replace function public.knowledge_version_guard()
returns trigger
language plpgsql set search_path = public as $$
begin
  if old.tool_key = 'grovshot_shot' and (
       new.tool_key is distinct from old.tool_key or new.version is distinct from old.version
    or new.parsed is distinct from old.parsed or new.source_id is distinct from old.source_id
    or new.source_sha256 is distinct from old.source_sha256 or new.content_sha256 is distinct from old.content_sha256
    or new.changelog is distinct from old.changelog or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at) then
    raise exception 'knowledge_version_frozen';
  end if;
  return new;
end $$;
drop trigger if exists knowledge_versions_guard on public.knowledge_versions;
create trigger knowledge_versions_guard before update on public.knowledge_versions
  for each row execute function public.knowledge_version_guard();
-- The file of a version never changes either.
create or replace function public.knowledge_source_guard()
returns trigger
language plpgsql set search_path = public as $$
begin
  if old.tool_key = 'grovshot_shot' then raise exception 'knowledge_source_frozen'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists knowledge_sources_guard on public.knowledge_sources;
create trigger knowledge_sources_guard before update or delete on public.knowledge_sources
  for each row execute function public.knowledge_source_guard();

/* 4 ── import (a DRAFT, never active), activate / roll back, read ────────*/
/*
  p_file:     { title, file_name, content, sha256, parsed, summary, change_note, format_version }
              — `parsed` is the server's parse of `content` (lib/grovshot-shot/kb.ts);
              `sha256` must be the content's own (checked here).
  p_original: optional { title, file_name, content, sha256 } — the unchanged
              source document a converted file was made from (kept once, by hash).
  The same file again (same sha256): the existing version, not a second one.
*/
create or replace function public.grovshot_shot_kb_import(p_file jsonb, p_original jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_set uuid;
  v_content text := p_file->>'content';
  v_sha text;
  v_existing public.knowledge_versions;
  v_src uuid;
  v_orig uuid;
  v_version integer;
  v_id uuid;
  v_note text := btrim(coalesce(p_file->>'change_note', ''));
  v_author text;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if v_content is null or char_length(v_content) = 0 or char_length(v_content) > 300000 then return jsonb_build_object('error', 'invalid_file'); end if;
  if char_length(v_note) < 3 or char_length(v_note) > 2000 then return jsonb_build_object('error', 'change_note_required'); end if;
  if jsonb_typeof(p_file->'parsed') is distinct from 'object' or (p_file->>'format_version') is distinct from '1' then
    return jsonb_build_object('error', 'invalid_parse');
  end if;
  v_sha := encode(extensions.digest(convert_to(v_content, 'UTF8'), 'sha256'), 'hex');
  if v_sha is distinct from p_file->>'sha256' then return jsonb_build_object('error', 'sha_mismatch'); end if;

  select * into v_existing from public.knowledge_versions where tool_key = 'grovshot_shot' and source_sha256 = v_sha order by version limit 1;
  if found then return jsonb_build_object('id', v_existing.id, 'version', v_existing.version, 'duplicate', true); end if;

  select id into v_set from public.knowledge_sets where scope = 'grovshot_shot' order by created_at limit 1;
  if v_set is null then
    insert into public.knowledge_sets (name, status, notes, scope, created_by)
    values ('GrovBase Shot – baza wiedzy silnika (pliki)', 'ready', 'Wersjonowane pliki bazy wiedzy silnika lifestyle (0166).', 'grovshot_shot', auth.uid())
    returning id into v_set;
  end if;
  select coalesce(nullif(btrim(p.full_name), ''), p.email) into v_author from public.profiles p where p.id = auth.uid();

  -- The unchanged source document, once.
  if p_original is not null and coalesce(p_original->>'content', '') <> '' then
    if char_length(p_original->>'content') > 600000
       or encode(extensions.digest(convert_to(p_original->>'content', 'UTF8'), 'sha256'), 'hex') is distinct from p_original->>'sha256' then
      return jsonb_build_object('error', 'invalid_original');
    end if;
    select id into v_orig from public.knowledge_sources where tool_key = 'grovshot_shot' and sha256 = p_original->>'sha256' limit 1;
    if v_orig is null then
      insert into public.knowledge_sources (set_id, tool_key, doc_key, version, title, format, role, content, content_chars, sha256, bytes,
        source_date, author, status, parse_note, rules_found, created_by)
      values (v_set, 'grovshot_shot', 'specyfikacja-zrodlowa',
        (select coalesce(max(version), 0) + 1 from public.knowledge_sources where set_id = v_set and doc_key = 'specyfikacja-zrodlowa'),
        left(coalesce(nullif(btrim(p_original->>'title'), ''), 'Specyfikacja źródłowa'), 200), 'md', 'confirmation',
        p_original->>'content', char_length(p_original->>'content'), p_original->>'sha256', octet_length(convert_to(p_original->>'content', 'UTF8')),
        current_date, left(v_author, 120), 'skipped', 'Źródło bez zmian (nie parsowane – wersja zgodna jest osobnym plikiem).', 0, auth.uid())
      returning id into v_orig;
    end if;
  end if;

  select coalesce(max(version), 0) + 1 into v_version from public.knowledge_versions where tool_key = 'grovshot_shot';
  insert into public.knowledge_sources (set_id, tool_key, doc_key, version, title, format, role, content, content_chars, sha256, bytes,
    source_date, author, status, parse_note, rules_found, created_by)
  values (v_set, 'grovshot_shot', 'baza-wiedzy', v_version,
    left(coalesce(nullif(btrim(p_file->>'title'), ''), coalesce(nullif(btrim(p_file->>'file_name'), ''), 'Baza wiedzy')), 200), 'md', 'primary',
    v_content, char_length(v_content), v_sha, octet_length(convert_to(v_content, 'UTF8')),
    current_date, left(v_author, 120), 'parsed', left(nullif(btrim(coalesce(p_file->>'file_name', '')), ''), 500),
    coalesce(jsonb_array_length(p_file->'parsed'->'planRules'), 0), auth.uid())
  returning id into v_src;

  insert into public.knowledge_versions (tool_key, version, active, rule_ids, example_ids, rule_count, delivered_count, content_sha256,
    changelog, created_by, source_id, parsed, source_sha256, format_version, summary)
  values ('grovshot_shot', v_version, false, '{}', '{}',
    coalesce(jsonb_array_length(p_file->'parsed'->'planRules'), 0), coalesce(jsonb_array_length(p_file->'parsed'->'recipes'), 0),
    encode(extensions.digest(convert_to((p_file->'parsed')::text, 'UTF8'), 'sha256'), 'hex'),
    v_note, auth.uid(), v_src, p_file->'parsed', v_sha, 1,
    case when jsonb_typeof(p_file->'summary') = 'object' then p_file->'summary' || jsonb_build_object('original_source_id', v_orig) else jsonb_build_object('original_source_id', v_orig) end)
  returning id into v_id;
  insert into public.knowledge_version_events (tool_key, version_id, action, note, actor)
  values ('grovshot_shot', v_id, 'imported', v_note, auth.uid());
  perform public.log_activity(null, 'admin.grovshot_kb_imported', 'knowledge_version', v_id,
    jsonb_build_object('version', v_version, 'sha256', v_sha, 'note', left(v_note, 200)), null);
  return jsonb_build_object('id', v_id, 'version', v_version, 'duplicate', false);
end $$;
revoke all on function public.grovshot_shot_kb_import(jsonb, jsonb) from public, anon;
grant execute on function public.grovshot_shot_kb_import(jsonb, jsonb) to authenticated;

-- Activate a version for NEW orders (an earlier one = a rollback). Orders in
-- progress keep the version they pinned.
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

-- The engine's read: a pinned version by id, or (null) the active one.
create or replace function public.grovshot_shot_kb(p_token text, p_version_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v public.knowledge_versions;
begin
  if not public.server_call_ok(p_token) and not public.is_admin() then raise exception 'forbidden'; end if;
  if p_version_id is null then
    select * into v from public.knowledge_versions where tool_key = 'grovshot_shot' and active;
  else
    select * into v from public.knowledge_versions where tool_key = 'grovshot_shot' and id = p_version_id;
  end if;
  if not found then return null; end if;
  return jsonb_build_object('id', v.id, 'version', v.version, 'active', v.active, 'sha256', v.content_sha256,
    'source_sha256', v.source_sha256, 'parsed', v.parsed);
end $$;
revoke all on function public.grovshot_shot_kb(text, uuid) from public;
grant execute on function public.grovshot_shot_kb(text, uuid) to anon, authenticated;

/* 5 ── global provider slots ─────────────────────────────────────────────*/
create table if not exists public.grovshot_provider_slots (
  kind text not null check (kind in ('text', 'image')),
  slot integer not null check (slot between 0 and 49),
  holder text not null check (char_length(holder) between 1 and 120),
  expires_at timestamptz not null,
  primary key (kind, slot)
);
alter table public.grovshot_provider_slots enable row level security;
revoke all on public.grovshot_provider_slots from anon, authenticated;

-- One free slot below the limit (a free one or one whose holder's lease ran
-- out), or null: the call waits in the queue.
create or replace function public.grovshot_slot_acquire(p_token text, p_kind text, p_limit integer, p_holder text, p_ttl_seconds integer)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v integer;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if p_kind not in ('text', 'image') or p_holder is null or char_length(p_holder) not between 1 and 120 then raise exception 'invalid_input'; end if;
  for i in 0 .. least(greatest(coalesce(p_limit, 1), 1), 50) - 1 loop
    insert into public.grovshot_provider_slots (kind, slot, holder, expires_at)
    values (p_kind, i, p_holder, now() + make_interval(secs => least(greatest(coalesce(p_ttl_seconds, 60), 10), 600)))
    on conflict (kind, slot) do update set holder = excluded.holder, expires_at = excluded.expires_at
      where public.grovshot_provider_slots.expires_at < now() or public.grovshot_provider_slots.holder = excluded.holder
    returning slot into v;
    if v is not null then return v; end if;
  end loop;
  return null;
end $$;
revoke all on function public.grovshot_slot_acquire(text, text, integer, text, integer) from public;
grant execute on function public.grovshot_slot_acquire(text, text, integer, text, integer) to anon;

create or replace function public.grovshot_slot_release(p_token text, p_kind text, p_holder text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  delete from public.grovshot_provider_slots where kind = p_kind and holder = p_holder;
end $$;
revoke all on function public.grovshot_slot_release(text, text, text) from public;
grant execute on function public.grovshot_slot_release(text, text, text) to anon;

-- The admin's queue view: open orders and slots in use (no prompt, no photo).
create or replace function public.grovshot_shot_queue()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return jsonb_build_object(
    'slots', (select coalesce(jsonb_object_agg(kind, n), '{}'::jsonb) from (
      select kind, count(*) as n from public.grovshot_provider_slots where expires_at > now() group by kind) s),
    'open', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'kind', r.run_kind, 'status', r.status, 'stage', r.progress->>'stage', 'created_at', r.created_at,
        'locked_until', r.locked_until, 'invocations', r.invocations, 'pipeline', r.input->>'pipeline') order by r.created_at), '[]'::jsonb)
      from public.ai_engine_runs r
     where r.run_kind in ('grovshot', 'grovshot_test') and r.status in ('queued', 'running')));
end $$;
revoke all on function public.grovshot_shot_queue() from public, anon;
grant execute on function public.grovshot_shot_queue() to authenticated;

/* 6 ── an admin's test order ─────────────────────────────────────────────*/
/*
  p_req: { workspace_id, photos[] (product-images paths of that workspace, in
  order), description, notes, shots 1–10, aspect_ratio, resolution,
  kb_version_id (null = the active one), mode 'prompts' | 'full',
  user_plan (array | null) }. Never charged (run kind grovshot_test). The
  photo bytes' hashes and the official image price are pinned by the worker
  on its first step; the settings and the knowledge version are pinned here.
*/
create or replace function public.grovshot_shot_test_create(p_req jsonb)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_ws uuid;
  v_photos jsonb := p_req->'photos';
  v_shots integer;
  v_model record;
  v_kb public.knowledge_versions;
  v_settings jsonb;
  v_input jsonb;
  v_key text;
  v_id uuid;
  v_desc text := coalesce(p_req->>'description', '');
  v_notes text := coalesce(p_req->>'notes', '');
  v_mode text := coalesce(p_req->>'mode', 'prompts');
  p text;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  v_ws := (p_req->>'workspace_id')::uuid;
  if v_ws is null or not exists (select 1 from public.workspace_members m where m.workspace_id = v_ws and m.user_id = v_uid) then
    return jsonb_build_object('error', 'workspace');
  end if;
  if jsonb_typeof(v_photos) is distinct from 'array' or jsonb_array_length(v_photos) not between 1 and 10 then return jsonb_build_object('error', 'photos'); end if;
  for p in select jsonb_array_elements_text(v_photos) loop
    if p !~ ('^' || v_ws::text || '/[A-Za-z0-9_./-]+$') or p ~ '\.\.'
       or not exists (select 1 from storage.objects o where o.bucket_id = 'product-images' and o.name = p) then
      return jsonb_build_object('error', 'photo_not_found', 'path', p);
    end if;
  end loop;
  if (select count(distinct x) from jsonb_array_elements_text(v_photos) x) <> jsonb_array_length(v_photos) then return jsonb_build_object('error', 'photos'); end if;
  v_shots := (p_req->>'shots')::integer;
  if v_shots is null or v_shots not between 1 and 10 then return jsonb_build_object('error', 'shots'); end if;
  if char_length(v_desc) > 20000 or char_length(v_notes) > 1000 then return jsonb_build_object('error', 'text_too_long'); end if;
  if v_mode not in ('prompts', 'full') then return jsonb_build_object('error', 'mode'); end if;
  if p_req->'user_plan' is not null and jsonb_typeof(p_req->'user_plan') not in ('array', 'null') then return jsonb_build_object('error', 'user_plan'); end if;

  select m.id, m.model_identifier, pr.slug as provider, m.supported_resolutions, m.supported_aspect_ratios into v_model
    from public.ai_models m join public.ai_providers pr on pr.id = m.provider_id
   where m.model_identifier = 'gemini-3-pro-image' and m.active and pr.active
   order by m.created_at limit 1;
  if not found then return jsonb_build_object('error', 'model_unavailable'); end if;
  if not (p_req->>'resolution' = any(v_model.supported_resolutions)) or not (p_req->>'aspect_ratio' = any(v_model.supported_aspect_ratios)) then
    return jsonb_build_object('error', 'format');
  end if;

  if p_req->>'kb_version_id' is not null then
    select * into v_kb from public.knowledge_versions where tool_key = 'grovshot_shot' and id = (p_req->>'kb_version_id')::uuid;
  else
    select * into v_kb from public.knowledge_versions where tool_key = 'grovshot_shot' and active;
  end if;
  if not found then return jsonb_build_object('error', 'knowledge_unpublished'); end if;
  select value into v_settings from public.app_settings where key = 'grovshot_shot';

  v_input := jsonb_build_object(
    'v', 2, 'engine', 'grovshot_v2', 'pipeline', 'lifestyle', 'engine_version', 'grovshot-lifestyle-1.0',
    'test', true, 'test_mode', v_mode, 'photos', v_photos, 'photo_shas', null,
    'shots', v_shots, 'aspect_ratio', p_req->>'aspect_ratio', 'resolution', p_req->>'resolution', 'session_type', 'lifestyle',
    'description', v_desc, 'notes', v_notes, 'user_plan', coalesce(p_req->'user_plan', 'null'::jsonb),
    'quote', jsonb_build_object('unit', 0, 'total', 0),
    'model', jsonb_build_object('id', v_model.id, 'identifier', v_model.model_identifier, 'provider', v_model.provider),
    'unit_price_usd_micros', null, 'budget_cap_usd_micros', null,
    'settings', coalesce(v_settings, '{}'::jsonb),
    'kb', jsonb_build_object('version_id', v_kb.id, 'version', v_kb.version, 'sha256', v_kb.content_sha256),
    'test_product_id', case when coalesce(p_req->>'test_product_id', '') ~ '^[0-9a-f-]{36}$' then p_req->>'test_product_id' end);
  v_key := 'gsls:' || v_ws::text || ':' || floor(extract(epoch from now()) / 300)::bigint::text || ':'
    || left(encode(extensions.digest(convert_to(v_input::text, 'UTF8'), 'sha256'), 'hex'), 32);
  insert into public.ai_engine_runs (
    tool_key, workspace_id, user_id, mode, status, run_kind, idempotency_key,
    engine_version, input, expected_outputs, credits, progress
  ) values (
    'prompts', v_ws, v_uid, 'grovbase', 'queued', 'grovshot_test', v_key,
    'grovshot-lifestyle-1.0', v_input, v_shots, 0, '{}'::jsonb
  )
  on conflict (idempotency_key) where idempotency_key is not null do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from public.ai_engine_runs where idempotency_key = v_key;
    return jsonb_build_object('id', v_id, 'created', false);
  end if;
  perform public.log_activity(v_ws, 'admin.grovshot_test_created', 'ai_engine_run', v_id,
    jsonb_build_object('pipeline', 'lifestyle', 'mode', v_mode, 'shots', v_shots, 'photos', jsonb_array_length(v_photos), 'kb_version', v_kb.version), null);
  return jsonb_build_object('id', v_id, 'created', true);
end $$;
revoke all on function public.grovshot_shot_test_create(jsonb) from public, anon;
grant execute on function public.grovshot_shot_test_create(jsonb) to authenticated;

/* 7 ── an image no automatic check looked at ─────────────────────────────*/
create or replace function public.grovshot_srv_library_add(
  p_token text, p_run_id uuid, p_owner text, p_job_id uuid, p_path text, p_width integer, p_height integer,
  p_quality text, p_score numeric, p_shot integer
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_run public.ai_engine_runs;
  v_gen uuid;
  v_asset uuid;
begin
  v_run := public.grovshot_srv_scope(p_token, p_run_id, p_owner);
  if not exists (select 1 from public.generation_jobs j where j.id = p_job_id and j.workspace_id = v_run.workspace_id
                   and j.settings->>'run_id' = v_run.id::text) then raise exception 'not_found'; end if;
  if p_path is null or p_path !~ ('^' || v_run.workspace_id::text || '/' || p_job_id::text || '/[A-Za-z0-9_.-]+$') then
    raise exception 'invalid_path';
  end if;
  if p_quality not in ('passed', 'warning', 'skipped') then raise exception 'invalid_quality'; end if;
  insert into public.generations (job_id, workspace_id, quality_status, product_match_score)
  values (p_job_id, v_run.workspace_id, p_quality::public.quality_status, p_score) returning id into v_gen;
  insert into public.generation_assets (generation_id, asset_type, storage_path, width, height, metadata)
  values (v_gen, 'image', p_path, p_width, p_height, jsonb_build_object('tool', 'prompts', 'engine', 'grovshot_v2', 'shot', p_shot,
    'pipeline', coalesce(v_run.input->>'pipeline', 'v2')))
  returning id into v_asset;
  return jsonb_build_object('generation_id', v_gen, 'asset_id', v_asset);
end $$;

/* 8 ── the engine's defaults (only when absent) ──────────────────────────*/
insert into public.app_settings (key, value)
values ('grovshot_shot', jsonb_build_object(
  'models', jsonb_build_object(
    'card', jsonb_build_object('provider', 'anthropic', 'model', 'claude-sonnet-5-5', 'effort', 'medium'),
    'plan', jsonb_build_object('provider', 'anthropic', 'model', 'claude-sonnet-5-5', 'effort', 'medium'),
    'prompt', jsonb_build_object('provider', 'anthropic', 'model', 'claude-sonnet-5-5', 'effort', 'medium')),
  'limits', jsonb_build_object('text_concurrency', 2, 'image_concurrency', 2),
  'text_budget_usd', 1.5,
  'description_min_chars', 80,
  'scenarios', jsonb_build_object('lifestyle', true, 'reklamowa', false)))
on conflict (key) do nothing;
