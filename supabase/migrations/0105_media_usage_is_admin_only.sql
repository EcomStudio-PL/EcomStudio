-- media_usage ASKS AN ADMIN QUESTION AND ANSWERED IT FOR ANYONE.
--
-- ORDERING: additive and self-contained. It only tightens one function, so it
-- is safe at any point, including before the application deploy — the caller
-- is an admin server action and its behaviour for an admin does not change.
--
-- THE DEFECT (P1-16). `media_usage` is the admin media library's "what would
-- break if I delete this": it reports every slot and every CMS page that
-- references an asset. 0090 granted it to `authenticated` because its only
-- caller is an admin action — but the GRANT defines the exposure, not the
-- caller, and the body asks nothing about who is calling. So any signed-in
-- customer could enumerate the slugs of UNPUBLISHED CMS pages, which is the
-- marketing roadmap: the page an operator is drafting and has not launched.
--
-- Its two siblings both open with a role check — `admin_customer_rows` and
-- `newsletter_scheduler_status` — and the module comment in
-- lib/services/media-slots.ts already claims this one is admin-only. This
-- makes the claim true.
--
-- `language sql` cannot raise, so the function becomes plpgsql. The signature,
-- the OUT columns and the query are otherwise unchanged from the definition
-- currently deployed (read back with pg_get_functiondef before writing this).
-- The only additions are the gate and the explicit casts plpgsql needs.

create or replace function public.media_usage(p_media_id uuid)
returns table (usage_kind text, usage_key text, usage_label text)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  -- The whole change. An operator asking what an asset is used for is an
  -- admin; anyone else gets nothing, not a partial answer.
  if not public.is_admin() then
    raise exception 'forbidden';
  end if;

  return query
  with asset as (
    select id, storage_path, external_url from public.media_assets where id = p_media_id
  )
  select 'slot'::text, s.slot_key,
         (case
            when s.media_id = p_media_id then 'desktop'
            when s.tablet_media_id = p_media_id then 'tablet'
            when s.mobile_media_id = p_media_id then 'mobile'
            else 'poster'
          end)::text
  from public.media_slots s
  where p_media_id in (s.media_id, s.tablet_media_id, s.mobile_media_id, s.poster_media_id)
  union all
  select 'cms_page'::text, p.slug, p.status
  from public.cms_pages p, asset a
  where a.storage_path is not null
    and exists (
      select 1 from public.cms_blocks b
      where b.page_id = p.id and b.content::text like '%' || a.storage_path || '%'
    );
end;
$function$;

-- The grant stays: the admin action calls this as the signed-in operator, so
-- `authenticated` is the right role to hold EXECUTE. What changes is that
-- holding it is no longer enough.
revoke all on function public.media_usage(uuid) from public, anon;
grant execute on function public.media_usage(uuid) to authenticated;

comment on function public.media_usage(uuid) is
  'What an asset is used for, across slots and CMS pages. ADMIN ONLY — it reports the slugs of unpublished pages, so it opens with is_admin() rather than relying on its caller being an admin screen.';

-- ROLLBACK: restore the previous `language sql` body from migration 0090.
