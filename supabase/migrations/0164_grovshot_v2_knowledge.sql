-- ════════════════════════════════════════════════════════════════════════════
-- 0164 · GROVBASE SHOT V2 — THE EXPERT KNOWLEDGE BASE (sources → rules → versions)
--
-- The knowledge library (0042: knowledge_sets + knowledge_examples) stored a
-- document as one text blob (doc_text, cut at 40 000 characters) that nothing
-- read, and examples for V1's retrieval. GrovShot V2 needs the expert's
-- material as RULES the engine can apply per stage and per product — with
-- their source, date, scope and approval — and a published, versioned set an
-- order can pin. Nothing here is parallel to the library: a source belongs to
-- a knowledge set (the material lives there once), test cases stay
-- knowledge_examples.
--
--   knowledge_sources   one uploaded document version of a set: format, the
--                       original in the private `knowledge` bucket, its sha256,
--                       its full extracted text (≤ 600 000 chars, never cut),
--                       author, date, and what parsing it produced;
--   knowledge_rules     one rule each (a paragraph, list item or table row of
--                       a source, a test-case correction, or an admin's rule):
--                       topic, stages, scope (global · category · recipe ·
--                       shot type · product type), DELIVERY (knowledge = sent
--                       through {{knowledge_rules}}; config / template / code =
--                       already carried by the engine; reference = background),
--                       supersedes, status. Proposals are `pending`; an
--                       APPROVED rule's content can never change (an edit is a
--                       new revision that supersedes it), so a version that
--                       lists it stays exactly what it was;
--   knowledge_versions  a published snapshot of the approved rules (ids +
--                       content hash); exactly one is active; rolling back =
--                       activating an earlier one. An order SEALS the active
--                       version's sent rules at its start (lib/server/grovshot-v2
--                       /start.ts) and keeps them to its end.
--
-- Admin-only at every layer (RLS is_admin(); the review/publish functions
-- check it again). The engine reads a snapshot only with the server token.
-- Nothing is published by this migration and no existing row is deleted.
--
-- ROLLBACK (manual): drop function public.grovshot_knowledge_snapshot(text, boolean),
--   public.grovshot_knowledge_activate(uuid), public.grovshot_knowledge_publish(text),
--   public.grovshot_knowledge_review(uuid[], text, text), public.knowledge_rule_guard();
--   drop table public.knowledge_versions, public.knowledge_rules, public.knowledge_sources;
--   alter table public.knowledge_sets drop column scope;
--   alter table public.knowledge_examples drop column description, drop column correction_scope, drop column created_by.
-- ════════════════════════════════════════════════════════════════════════════

set local lock_timeout = '10s';

-- A set can be GrovShot V2's (its rules and test cases serve V2 only; V1's
-- retrieval keeps using ai_tool_knowledge as before).
alter table public.knowledge_sets add column if not exists scope text;
alter table public.knowledge_sets drop constraint if exists knowledge_sets_scope_check;
alter table public.knowledge_sets add constraint knowledge_sets_scope_check check (scope is null or scope in ('grovshot_v2'));

-- Test cases (knowledge_examples, source_kind 'manual'): what the product was,
-- which scope the correction is meant for, who wrote it.
alter table public.knowledge_examples add column if not exists description text;
alter table public.knowledge_examples add column if not exists correction_scope jsonb;
alter table public.knowledge_examples add column if not exists created_by uuid references public.profiles(id) on delete set null;
alter table public.knowledge_examples drop constraint if exists knowledge_examples_description_check;
alter table public.knowledge_examples add constraint knowledge_examples_description_check check (description is null or char_length(description) <= 4000);

/* ── sources ─────────────────────────────────────────────────────────────*/
create table if not exists public.knowledge_sources (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.knowledge_sets(id) on delete cascade,
  tool_key text not null default 'grovshot_v2' check (tool_key = 'grovshot_v2'),
  doc_key text not null check (doc_key ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  version integer not null check (version between 1 and 10000),
  title text not null check (char_length(title) between 1 and 200),
  format text not null check (format in ('md', 'txt', 'pdf')),
  role text not null default 'primary' check (role in ('primary', 'confirmation')),
  storage_path text check (storage_path is null or (char_length(storage_path) between 6 and 400 and storage_path !~ '\.\.')),
  content text check (content is null or char_length(content) <= 600000),
  content_chars integer not null default 0 check (content_chars >= 0),
  sha256 text check (sha256 is null or sha256 ~ '^[0-9a-f]{64}$'),
  bytes integer check (bytes is null or bytes >= 0),
  source_date date,
  author text check (author is null or char_length(author) <= 120),
  status text not null default 'parsed' check (status in ('parsed', 'skipped', 'error')),
  parse_note text check (parse_note is null or char_length(parse_note) <= 500),
  rules_found integer not null default 0 check (rules_found >= 0),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (set_id, doc_key, version, format)
);
create index if not exists knowledge_sources_set_idx on public.knowledge_sources (set_id, created_at desc);

/* ── rules ───────────────────────────────────────────────────────────────*/
create table if not exists public.knowledge_rules (
  id uuid primary key default gen_random_uuid(),
  tool_key text not null default 'grovshot_v2' check (tool_key = 'grovshot_v2'),
  rule_key text not null check (rule_key ~ '^[a-z0-9][a-z0-9:._-]{1,159}$'),
  revision integer not null default 1 check (revision between 1 and 1000),
  source_id uuid references public.knowledge_sources(id) on delete set null,
  example_id uuid references public.knowledge_examples(id) on delete set null,
  origin text not null check (origin in ('document', 'test_case', 'admin', 'customer_feedback')),
  section text check (section is null or char_length(section) <= 300),
  page integer check (page is null or page between 1 and 10000),
  position integer not null default 0,
  source_date date,
  topic text not null check (topic in (
    'fidelity', 'card_scale', 'planning', 'recipes', 'creative', 'anti_stock', 'references',
    'people', 'light_color', 'prompt_build', 'qc', 'errors', 'cost', 'context')),
  stages text[] not null default '{}' check (stages <@ array['validate', 'card', 'plan', 'prompt', 'qc']::text[]),
  scope_kind text not null default 'global' check (scope_kind in ('global', 'category', 'recipe', 'shot_type', 'product_type')),
  scope_values text[] not null default '{}' check (cardinality(scope_values) <= 30),
  delivery text not null default 'knowledge' check (delivery in ('knowledge', 'config', 'template', 'code', 'reference')),
  is_correction boolean not null default false,
  title text not null check (char_length(title) between 1 and 200),
  body text not null check (char_length(body) between 1 and 4000),
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  supersedes uuid[] not null default '{}' check (cardinality(supersedes) <= 20),
  duplicate_of uuid,
  conflicts_with uuid[] not null default '{}' check (cardinality(conflicts_with) <= 20),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'superseded', 'retired')),
  review_note text check (review_note is null or char_length(review_note) <= 1000),
  created_by uuid references public.profiles(id) on delete set null,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rule_key, revision),
  -- A rule that is sent to a model has a stage to be sent to; a scoped rule names what it applies to.
  constraint knowledge_rules_delivery_stages check (delivery <> 'knowledge' or cardinality(stages) > 0),
  constraint knowledge_rules_scope_values check (scope_kind = 'global' or cardinality(scope_values) > 0)
);
create index if not exists knowledge_rules_status_idx on public.knowledge_rules (tool_key, status);
create index if not exists knowledge_rules_source_idx on public.knowledge_rules (source_id, position);
create index if not exists knowledge_rules_example_idx on public.knowledge_rules (example_id) where example_id is not null;

-- An approved (or superseded / retired) rule's content is frozen; status moves
-- only along the review paths. Pending rules are freely edited.
create or replace function public.knowledge_rule_guard()
returns trigger
language plpgsql set search_path = public as $$
begin
  if old.status in ('approved', 'superseded', 'retired') and (
       new.body is distinct from old.body or new.title is distinct from old.title
    or new.stages is distinct from old.stages or new.scope_kind is distinct from old.scope_kind
    or new.scope_values is distinct from old.scope_values or new.delivery is distinct from old.delivery
    or new.topic is distinct from old.topic or new.is_correction is distinct from old.is_correction
    or new.supersedes is distinct from old.supersedes or new.rule_key is distinct from old.rule_key
    or new.revision is distinct from old.revision or new.body_sha256 is distinct from old.body_sha256) then
    raise exception 'rule_immutable';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'pending' and new.status in ('approved', 'rejected'))
    or (old.status = 'rejected' and new.status = 'pending')
    or (old.status = 'approved' and new.status in ('superseded', 'retired'))
    or (old.status = 'retired' and new.status = 'approved')
    or (old.status = 'superseded' and new.status = 'approved')) then
    raise exception 'invalid_transition';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists knowledge_rules_guard on public.knowledge_rules;
create trigger knowledge_rules_guard before update on public.knowledge_rules
  for each row execute function public.knowledge_rule_guard();

/* ── versions ────────────────────────────────────────────────────────────*/
create table if not exists public.knowledge_versions (
  id uuid primary key default gen_random_uuid(),
  tool_key text not null default 'grovshot_v2' check (tool_key = 'grovshot_v2'),
  version integer not null check (version between 1 and 100000),
  active boolean not null default false,
  rule_ids uuid[] not null,
  example_ids uuid[] not null default '{}',
  rule_count integer not null check (rule_count >= 0),
  delivered_count integer not null check (delivered_count >= 0),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  changelog text check (changelog is null or char_length(changelog) <= 2000),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  activated_by uuid references public.profiles(id) on delete set null,
  activated_at timestamptz,
  unique (tool_key, version)
);
create unique index if not exists knowledge_versions_one_active on public.knowledge_versions (tool_key) where active;

/* ── RLS: admin only ─────────────────────────────────────────────────────*/
alter table public.knowledge_sources enable row level security;
alter table public.knowledge_rules enable row level security;
alter table public.knowledge_versions enable row level security;
drop policy if exists knowledge_sources_admin on public.knowledge_sources;
create policy knowledge_sources_admin on public.knowledge_sources for all
  using ((select public.is_admin())) with check ((select public.is_admin()));
drop policy if exists knowledge_rules_admin on public.knowledge_rules;
create policy knowledge_rules_admin on public.knowledge_rules for all
  using ((select public.is_admin())) with check ((select public.is_admin()));
-- Versions are written only by the publish/activate functions below.
drop policy if exists knowledge_versions_admin_read on public.knowledge_versions;
create policy knowledge_versions_admin_read on public.knowledge_versions for select
  using ((select public.is_admin()));
revoke all on public.knowledge_sources, public.knowledge_rules, public.knowledge_versions from anon;
revoke insert, update, delete on public.knowledge_versions from authenticated;

/* ── review: approve / reject / retire / reopen (admin) ──────────────────*/
create or replace function public.grovshot_knowledge_review(p_ids uuid[], p_status text, p_note text)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_rule public.knowledge_rules;
  v_n integer := 0;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  if p_status not in ('approved', 'rejected', 'retired', 'pending') then raise exception 'invalid_status'; end if;
  if p_ids is null or cardinality(p_ids) not between 1 and 500 then raise exception 'invalid_input'; end if;
  for v_rule in select * from public.knowledge_rules where id = any(p_ids) and tool_key = 'grovshot_v2' order by position loop
    if p_status = 'approved' then
      if v_rule.status not in ('pending', 'retired', 'superseded') then continue; end if;
      update public.knowledge_rules set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(),
        review_note = coalesce(left(p_note, 1000), review_note) where id = v_rule.id;
      -- What this rule replaces, in its own scope: the rules it names, and an
      -- earlier approved revision of the same key.
      update public.knowledge_rules set status = 'superseded', reviewed_by = auth.uid(), reviewed_at = now()
       where status = 'approved' and id <> v_rule.id
         and (id = any(v_rule.supersedes) or (rule_key = v_rule.rule_key and revision < v_rule.revision));
      -- …and the other way round: approved AFTER the rule that replaces it.
      if exists (select 1 from public.knowledge_rules o where o.status = 'approved' and o.id <> v_rule.id
                  and (v_rule.id = any(o.supersedes) or (o.rule_key = v_rule.rule_key and o.revision > v_rule.revision))) then
        update public.knowledge_rules set status = 'superseded' where id = v_rule.id;
      end if;
    elsif p_status = 'rejected' then
      if v_rule.status <> 'pending' then continue; end if;
      update public.knowledge_rules set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
        review_note = coalesce(left(p_note, 1000), review_note) where id = v_rule.id;
    elsif p_status = 'retired' then
      if v_rule.status <> 'approved' then continue; end if;
      update public.knowledge_rules set status = 'retired', reviewed_by = auth.uid(), reviewed_at = now(),
        review_note = coalesce(left(p_note, 1000), review_note) where id = v_rule.id;
    else
      if v_rule.status <> 'rejected' then continue; end if;
      update public.knowledge_rules set status = 'pending', reviewed_by = auth.uid(), reviewed_at = now() where id = v_rule.id;
    end if;
    v_n := v_n + 1;
  end loop;
  if v_n > 0 then
    perform public.log_activity(null, 'admin.knowledge_rules_reviewed', 'knowledge_rule', case when cardinality(p_ids) = 1 then p_ids[1] end,
      jsonb_build_object('status', p_status, 'count', v_n, 'ids', to_jsonb(p_ids[1:50]), 'note', left(p_note, 200)), null);
  end if;
  return v_n;
end $$;
revoke all on function public.grovshot_knowledge_review(uuid[], text, text) from public, anon;
grant execute on function public.grovshot_knowledge_review(uuid[], text, text) to authenticated;

/* ── publish: a new active version from the approved rules (admin) ───────*/
create or replace function public.grovshot_knowledge_publish(p_changelog text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_ids uuid[];
  v_delivered integer;
  v_sha text;
  v_active public.knowledge_versions;
  v_examples uuid[];
  v_version integer;
  v_id uuid;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  -- Two approved rules may never share a key (an approved revision supersedes the older one).
  if exists (select 1 from public.knowledge_rules where tool_key = 'grovshot_v2' and status = 'approved'
              group by rule_key having count(*) > 1) then
    return jsonb_build_object('error', 'duplicate_rule_key');
  end if;
  select coalesce(array_agg(id order by id), '{}'), count(*) filter (where delivery = 'knowledge'),
         encode(extensions.digest(coalesce(string_agg(id::text || ':' || body_sha256 || ':' || delivery, ',' order by id), ''), 'sha256'), 'hex')
    into v_ids, v_delivered, v_sha
    from public.knowledge_rules where tool_key = 'grovshot_v2' and status = 'approved';
  if cardinality(v_ids) = 0 or v_delivered = 0 then return jsonb_build_object('error', 'no_rules'); end if;
  select coalesce(array_agg(e.id order by e.id), '{}') into v_examples
    from public.knowledge_examples e join public.knowledge_sets s on s.id = e.set_id
   where s.scope = 'grovshot_v2' and e.review_status = 'approved' and e.enabled and coalesce(e.result_rating, 0) >= 4;
  select * into v_active from public.knowledge_versions where tool_key = 'grovshot_v2' and active;
  if found and v_active.content_sha256 = v_sha and v_active.example_ids = v_examples then
    return jsonb_build_object('error', 'no_changes', 'version', v_active.version);
  end if;
  select coalesce(max(version), 0) + 1 into v_version from public.knowledge_versions where tool_key = 'grovshot_v2';
  update public.knowledge_versions set active = false where tool_key = 'grovshot_v2' and active;
  insert into public.knowledge_versions (tool_key, version, active, rule_ids, example_ids, rule_count, delivered_count,
    content_sha256, changelog, created_by, activated_by, activated_at)
  values ('grovshot_v2', v_version, true, v_ids, v_examples, cardinality(v_ids), v_delivered, v_sha,
    nullif(left(btrim(coalesce(p_changelog, '')), 2000), ''), auth.uid(), auth.uid(), now())
  returning id into v_id;
  perform public.log_activity(null, 'admin.knowledge_published', 'knowledge_version', v_id,
    jsonb_build_object('version', v_version, 'rules', cardinality(v_ids), 'delivered', v_delivered, 'examples', cardinality(v_examples)), null);
  return jsonb_build_object('id', v_id, 'version', v_version, 'rules', cardinality(v_ids), 'delivered', v_delivered, 'examples', cardinality(v_examples));
end $$;
revoke all on function public.grovshot_knowledge_publish(text) from public, anon;
grant execute on function public.grovshot_knowledge_publish(text) to authenticated;

/* ── activate an earlier version (rollback) or the latest again (admin) ──*/
create or replace function public.grovshot_knowledge_activate(p_version_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v public.knowledge_versions;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select * into v from public.knowledge_versions where id = p_version_id and tool_key = 'grovshot_v2';
  if not found then raise exception 'not_found'; end if;
  if v.active then return jsonb_build_object('version', v.version, 'unchanged', true); end if;
  update public.knowledge_versions set active = false where tool_key = 'grovshot_v2' and active;
  update public.knowledge_versions set active = true, activated_by = auth.uid(), activated_at = now() where id = v.id;
  perform public.log_activity(null, 'admin.knowledge_activated', 'knowledge_version', v.id, jsonb_build_object('version', v.version), null);
  return jsonb_build_object('version', v.version);
end $$;
revoke all on function public.grovshot_knowledge_activate(uuid) from public, anon;
grant execute on function public.grovshot_knowledge_activate(uuid) to authenticated;

/* ── the snapshot an order seals at its start ────────────────────────────
   Server token: the ACTIVE version's rules that are sent to models
   (delivery = 'knowledge') and its approved test cases (rating ≥ 4).
   p_preview (an admin's test before publishing): the rules approved now. */
create or replace function public.grovshot_knowledge_snapshot(p_token text, p_preview boolean)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v public.knowledge_versions;
  v_rules jsonb;
  v_examples jsonb;
begin
  if coalesce(p_preview, false) then
    if not public.is_admin() then raise exception 'forbidden'; end if;
  elsif not public.server_call_ok(p_token) then
    raise exception 'forbidden';
  end if;
  if not coalesce(p_preview, false) then
    select * into v from public.knowledge_versions where tool_key = 'grovshot_v2' and active;
    if not found then return null; end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'rule_key', r.rule_key, 'revision', r.revision, 'topic', r.topic, 'stages', to_jsonb(r.stages),
           'scope_kind', r.scope_kind, 'scope_values', to_jsonb(r.scope_values), 'is_correction', r.is_correction,
           'title', r.title, 'body', r.body, 'source_date', r.source_date, 'supersedes', to_jsonb(r.supersedes))
         order by r.position, r.created_at), '[]'::jsonb)
    into v_rules
    from public.knowledge_rules r
   where r.tool_key = 'grovshot_v2' and r.delivery = 'knowledge'
     and (case when coalesce(p_preview, false) then r.status = 'approved' else r.id = any(v.rule_ids) end);
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'category', e.product_category, 'rating', e.result_rating,
           'what_worked', left(e.what_worked, 600), 'prompt_excerpt', left(e.prompt_used, 600)) order by e.created_at), '[]'::jsonb)
    into v_examples
    from public.knowledge_examples e join public.knowledge_sets s on s.id = e.set_id
   where s.scope = 'grovshot_v2' and e.review_status = 'approved' and e.enabled and coalesce(e.result_rating, 0) >= 4
     and (case when coalesce(p_preview, false) then true else e.id = any(v.example_ids) end);
  return jsonb_build_object(
    'version_id', case when coalesce(p_preview, false) then null else v.id end,
    'version', case when coalesce(p_preview, false) then 0 else v.version end,
    'preview', coalesce(p_preview, false),
    'rules', v_rules, 'examples', v_examples);
end $$;
revoke all on function public.grovshot_knowledge_snapshot(text, boolean) from public, anon;
grant execute on function public.grovshot_knowledge_snapshot(text, boolean) to authenticated;
