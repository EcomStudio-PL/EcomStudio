-- ============================================================
-- 0043 — AI ENGINE: tighten what the retrieval RPCs hand out
--
-- Both functions are SECURITY DEFINER and executable by any authenticated
-- session, because the engine plans under the CUSTOMER's session. The
-- payload was always ciphertext, but the metadata beside it was not:
--
--   * match_knowledge_examples returned the raw cosine similarity for a
--     CALLER-CHOSEN vector — a similarity oracle against the curated
--     knowledge base. The 0.25 relevance floor also lived in TypeScript,
--     so the RPC answered for vectors below it. Both move into SQL: the
--     function now filters server-side and returns no score at all.
--   * get_engine_rules returned rule_type and priority, exposing the
--     internal rule taxonomy and ordering. The "Unikaj:" framing is now
--     sealed into the ciphertext when an admin saves the rule
--     (app/actions/engine.ts), so the function returns ciphertext only and
--     keeps the ordering server-side.
--
-- Also adds the storage UPDATE policy the importer's upsert needs: the
-- bucket had SELECT/INSERT/DELETE only, so any overwrite would be denied.
-- ============================================================

-- Return shapes change, so the old signatures are dropped first.
drop function if exists public.match_knowledge_examples(extensions.vector, integer);
drop function if exists public.get_engine_rules();

create function public.match_knowledge_examples(
  p_embedding extensions.vector(1536),
  p_top_k integer default 3
) returns table (
  id uuid,
  hint_encrypted text,
  hint_iv text,
  hint_tag text
) language sql security definer stable
set search_path = public, extensions as $$
  select e.id, e.hint_encrypted, e.hint_iv, e.hint_tag
    from public.knowledge_examples e
    join public.knowledge_sets s on s.id = e.set_id
   where e.enabled
     and e.embedding is not null
     and e.hint_encrypted is not null
     and s.status = 'ready'
     -- Below this a "similar" example is noise, not experience. Enforced
     -- here so the score never leaves the database.
     and (1 - (e.embedding <=> p_embedding)) >= 0.25
   order by e.embedding <=> p_embedding
   limit least(greatest(coalesce(p_top_k, 3), 1), 5);
$$;

revoke all on function public.match_knowledge_examples(extensions.vector, integer) from public, anon;
grant execute on function public.match_knowledge_examples(extensions.vector, integer) to authenticated;

create function public.get_engine_rules()
returns table (
  id uuid,
  content_encrypted text,
  content_iv text,
  content_tag text
) language sql security definer stable
set search_path = public as $$
  select r.id, r.content_encrypted, r.content_iv, r.content_tag
    from public.prompt_engine_rules r
   where r.enabled and r.content_encrypted is not null
   order by r.priority asc, r.created_at asc
   limit 20;
$$;

revoke all on function public.get_engine_rules() from public, anon;
grant execute on function public.get_engine_rules() to authenticated;

-- The importer uploads with upsert:true; without an UPDATE policy an
-- overwrite is silently refused by RLS.
drop policy if exists knowledge_admin_update on storage.objects;
create policy knowledge_admin_update on storage.objects for update
  using (bucket_id = 'knowledge' and public.is_admin())
  with check (bucket_id = 'knowledge' and public.is_admin());
