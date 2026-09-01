-- ============================================================
-- 0042 — AI ENGINE: KNOWLEDGE BASE + PROMPT RULES + VERSIONING
--
-- The admin continuously feeds the GrovBase engine with reference sets
-- (documentation PDF + BEFORE reference photos + AFTER generations).
-- The engine retrieves the most similar past examples at planning time.
--
-- KNOW-HOW PROTECTION follows the concept-prompt pattern: everything the
-- ENGINE consumes at generation time (running under the CUSTOMER's own
-- session) is handed out ONLY as AES-256-GCM ciphertext through definer
-- RPCs — a customer calling those RPCs directly gets bytes that are
-- useless without the server-side APP_ENCRYPTION_KEY. The plaintext
-- admin-facing fields sit behind admin-only RLS.
-- ============================================================

create extension if not exists vector with schema extensions;

-- 1) Knowledge sets — one imported ZIP = one set -----------------------------
create table if not exists public.knowledge_sets (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  product_category text,
  product_description text,
  model text,
  status text not null default 'uploaded'
    check (status in ('uploaded','validating','extracting','processing','indexing','ready','error')),
  error text,
  notes text,
  -- Extracted document text. UNTRUSTED DATA by contract: never treated as
  -- instructions, only as source material an admin reads and curates.
  doc_text text,
  file_count integer not null default 0,
  zip_path text,
  version integer not null default 1,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) Examples — one BEFORE/AFTER pair with curation fields -------------------
create table if not exists public.knowledge_examples (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references public.knowledge_sets(id) on delete cascade,
  reference_path text,
  generated_path text,
  prompt_used text,
  result_rating integer check (result_rating between 1 and 5),
  what_worked text,
  what_failed text,
  correction text,
  tags text[] not null default '{}',
  enabled boolean not null default true,
  embedding extensions.vector(1536),
  -- Engine-facing distilled hint, ciphertext only (see header note).
  hint_encrypted text,
  hint_iv text,
  hint_tag text,
  created_at timestamptz not null default now()
);
create index if not exists knowledge_examples_set_idx on public.knowledge_examples(set_id);

-- 3) Prompt engine rules — admin-tunable directives --------------------------
create table if not exists public.prompt_engine_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rule_type text not null default 'style' check (rule_type in ('style','quality','avoid')),
  content text not null,
  content_encrypted text,
  content_iv text,
  content_tag text,
  priority integer not null default 100,
  enabled boolean not null default true,
  version integer not null default 1,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4) Engine version history --------------------------------------------------
create table if not exists public.prompt_engine_versions (
  id uuid primary key default gen_random_uuid(),
  version text not null,
  changelog text,
  active boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Generations already log prompt_template_version; sessions now carry the
-- engine version and the knowledge examples that influenced the plan.
alter table public.prompt_sessions
  add column if not exists engine_version integer,
  add column if not exists knowledge_used jsonb;

-- 5) RLS — the whole module is ADMIN-ONLY at the row level -------------------
alter table public.knowledge_sets enable row level security;
alter table public.knowledge_examples enable row level security;
alter table public.prompt_engine_rules enable row level security;
alter table public.prompt_engine_versions enable row level security;

drop policy if exists ks_admin_all on public.knowledge_sets;
create policy ks_admin_all on public.knowledge_sets
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists ke_admin_all on public.knowledge_examples;
create policy ke_admin_all on public.knowledge_examples
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists per_admin_all on public.prompt_engine_rules;
create policy per_admin_all on public.prompt_engine_rules
  for all using (public.is_admin()) with check (public.is_admin());
drop policy if exists pev_admin_all on public.prompt_engine_versions;
create policy pev_admin_all on public.prompt_engine_versions
  for all using (public.is_admin()) with check (public.is_admin());

-- 6) Storage: private knowledge bucket, admin-only ---------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('knowledge', 'knowledge', false, 26214400,
        array['image/jpeg','image/png','image/webp','image/avif','application/pdf','application/zip','application/x-zip-compressed','text/plain','application/json'])
on conflict (id) do nothing;

drop policy if exists knowledge_admin_select on storage.objects;
create policy knowledge_admin_select on storage.objects for select
  using (bucket_id = 'knowledge' and public.is_admin());
drop policy if exists knowledge_admin_insert on storage.objects;
create policy knowledge_admin_insert on storage.objects for insert
  with check (bucket_id = 'knowledge' and public.is_admin());
drop policy if exists knowledge_admin_delete on storage.objects;
create policy knowledge_admin_delete on storage.objects for delete
  using (bucket_id = 'knowledge' and public.is_admin());

-- 7) ENGINE RPCs — ciphertext out, nothing else ------------------------------
create or replace function public.match_knowledge_examples(
  p_embedding extensions.vector(1536),
  p_top_k integer default 3
) returns table (
  id uuid,
  similarity double precision,
  hint_encrypted text,
  hint_iv text,
  hint_tag text
) language sql security definer stable
set search_path = public, extensions as $$
  select e.id,
         1 - (e.embedding <=> p_embedding) as similarity,
         e.hint_encrypted, e.hint_iv, e.hint_tag
    from public.knowledge_examples e
    join public.knowledge_sets s on s.id = e.set_id
   where e.enabled
     and e.embedding is not null
     and e.hint_encrypted is not null
     and s.status = 'ready'
   order by e.embedding <=> p_embedding
   limit least(greatest(coalesce(p_top_k, 3), 1), 5);
$$;

revoke all on function public.match_knowledge_examples(extensions.vector, integer) from public, anon;
grant execute on function public.match_knowledge_examples(extensions.vector, integer) to authenticated;

create or replace function public.get_engine_rules()
returns table (
  id uuid,
  rule_type text,
  priority integer,
  content_encrypted text,
  content_iv text,
  content_tag text
) language sql security definer stable
set search_path = public as $$
  select r.id, r.rule_type, r.priority,
         r.content_encrypted, r.content_iv, r.content_tag
    from public.prompt_engine_rules r
   where r.enabled and r.content_encrypted is not null
   order by r.priority asc, r.created_at asc
   limit 20;
$$;

revoke all on function public.get_engine_rules() from public, anon;
grant execute on function public.get_engine_rules() to authenticated;

-- 8) Seed the version history with the shipping engine -----------------------
insert into public.prompt_engine_versions (version, changelog, active)
select 'v3', 'Generator V3: planer scen + zaszyfrowane prompty + typy sesji + opisy ujęć klienta.', true
where not exists (select 1 from public.prompt_engine_versions);
