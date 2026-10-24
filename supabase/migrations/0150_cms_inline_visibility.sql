-- 0150 — O NAS V2: switching a section, a tile or a point on and off from
-- "Edytuj stronę".
--
-- The inline editor already changes ONE text of a published CMS page live
-- (cms_inline_patch, 0141): the draft and the published copy get the same
-- one-field change, the page gets a version, nothing else is published along
-- with it. This is the same contract for one switch:
--
--   path []                          the section (cms_blocks.visible and the
--                                    snapshot's "visible");
--   path [items, n]                  one item ("hidden": true in its content);
--   path [items, n, points, m]       one point of an item.
--
-- Only the sections built for it (lib/about-page.ts): any about_* section as a
-- whole, the items of about_process / values / audience / team / faq, the
-- points of about_audience's cards. A switched-off item stays in the content
-- — editable, and restored by switching it back on — and the renderer leaves
-- it out of the HTML, the RSC payload and the JSON-LD. Switching an item on
-- whose text still holds a "[…]" placeholder publishes nothing: the renderer
-- drops such an item whatever its switch says.
--
-- Same safety as cms_inline_patch: admin only, page and block locked, a
-- compare-and-set on the block's updated_at, refused when the block's draft
-- differs from what is published (draft_diverged), a cms_page_versions row (a
-- rollback point in Strony WWW → Historia) and a content_versions row (the
-- editor's own history).

create or replace function public.cms_inline_visibility(
  p_block_id uuid, p_path text[], p_hidden boolean, p_label text, p_base timestamptz
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_block public.cms_blocks%rowtype;
  v_page public.cms_pages%rowtype;
  v_len int := coalesce(array_length(p_path, 1), 0);
  v_idx int;
  v_live jsonb;
  v_target jsonb;
  v_content jsonb;
  v_snap jsonb;
  v_before boolean;
  v_version int;
  v_now timestamptz := clock_timestamp();
begin
  if not public.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  if p_hidden is null then raise exception 'bad_input'; end if;
  if not (
    v_len = 0
    or (v_len = 2 and p_path[1] = 'items' and p_path[2] ~ '^[0-9]{1,3}$')
    or (v_len = 4 and p_path[1] = 'items' and p_path[2] ~ '^[0-9]{1,3}$'
        and p_path[3] = 'points' and p_path[4] ~ '^[0-9]{1,3}$')
  ) then
    raise exception 'bad_path';
  end if;

  -- The page first, then the block, both locked (the order cms_inline_patch
  -- and the builder's save use).
  select * into v_page from public.cms_pages
    where id = (select b.page_id from public.cms_blocks b where b.id = p_block_id) for update;
  if not found then raise exception 'block_missing'; end if;
  select * into v_block from public.cms_blocks where id = p_block_id for update;
  if not found or v_block.page_id <> v_page.id then raise exception 'block_missing'; end if;
  if v_page.status <> 'published' or jsonb_typeof(v_page.published_snapshot) is distinct from 'array' then
    raise exception 'not_published';
  end if;
  if p_base is not null and v_block.updated_at <> p_base then raise exception 'conflict'; end if;

  if left(v_block.type, 6) <> 'about_' then raise exception 'not_editable'; end if;
  if v_len >= 2 and v_block.type not in ('about_process', 'about_values', 'about_audience', 'about_team', 'about_faq') then
    raise exception 'not_editable';
  end if;
  if v_len = 4 and v_block.type <> 'about_audience' then raise exception 'not_editable'; end if;

  select (e.ordinality - 1)::int into v_idx
  from jsonb_array_elements(v_page.published_snapshot) with ordinality as e(value, ordinality)
  where e.value ->> 'id' = p_block_id::text
  limit 1;
  if v_idx is null then raise exception 'not_in_snapshot'; end if;
  v_live := v_page.published_snapshot -> v_idx;

  if v_len = 0 then
    -- The section. Published "visible": false = hidden (anything else reads
    -- as shown, the renderer's rule); the draft's switch must agree.
    v_before := coalesce(v_live -> 'visible' = 'false'::jsonb, false);
    if v_before is distinct from (not v_block.visible) then raise exception 'draft_diverged'; end if;
    if v_before = p_hidden then raise exception 'noop'; end if;
    v_snap := jsonb_set(v_page.published_snapshot, array[v_idx::text, 'visible'], to_jsonb(not p_hidden), true);
    update public.cms_blocks
      set visible = not p_hidden, updated_at = v_now, updated_by = auth.uid()
      where id = p_block_id;
  else
    -- An item or a point: only while the draft holds exactly what is
    -- published, so the path names the same thing in both.
    if v_block.content is distinct from (v_live -> 'content') then raise exception 'draft_diverged'; end if;
    v_target := (v_live -> 'content') #> p_path;
    if v_target is null or jsonb_typeof(v_target) <> 'object' then raise exception 'bad_path'; end if;
    v_before := coalesce(v_target -> 'hidden' = 'true'::jsonb, false);
    if v_before = p_hidden then raise exception 'noop'; end if;
    v_content := case
      when p_hidden then jsonb_set(v_live -> 'content', p_path || array['hidden'], 'true'::jsonb, true)
      else (v_live -> 'content') #- (p_path || array['hidden'])
    end;
    if coalesce((v_content #> p_path) -> 'hidden' = 'true'::jsonb, false) is distinct from p_hidden then
      raise exception 'bad_path';
    end if;
    v_snap := jsonb_set(v_page.published_snapshot, array[v_idx::text, 'content'], v_content, false);
    update public.cms_blocks
      set content = v_content, updated_at = v_now, updated_by = auth.uid()
      where id = p_block_id;
  end if;

  select coalesce(max(version), 0) + 1 into v_version from public.cms_page_versions where page_id = v_page.id;
  begin
    insert into public.cms_page_versions (page_id, version, snapshot, seo, reason, label, created_by)
    values (v_page.id, v_version, v_snap, v_page.seo, 'publish', left(coalesce(p_label, 'Edytor wizualny · widoczność'), 120), auth.uid());
  exception when unique_violation then
    raise exception 'conflict';
  end;

  update public.cms_pages
    set published_snapshot = v_snap, published_at = v_now, updated_at = v_now, updated_by = auth.uid()
    where id = v_page.id;

  insert into public.content_versions (target, key, locale, action, before, after, created_by)
  values ('cms',
    v_page.id::text || ':' || p_block_id::text || ':'
      || case when v_len = 0 then 'visible' else array_to_string(p_path, '.') || '.hidden' end,
    null, 'save',
    jsonb_build_object('hidden', v_before), jsonb_build_object('hidden', p_hidden), auth.uid());
  return v_now;
end;
$$;

revoke all on function public.cms_inline_visibility(uuid, text[], boolean, text, timestamptz) from public, anon;
grant execute on function public.cms_inline_visibility(uuid, text[], boolean, text, timestamptz) to authenticated;

comment on function public.cms_inline_visibility(uuid, text[], boolean, text, timestamptz) is
  'Edytuj stronę: switch one about_* section, item or point of a published CMS page on or off — live, in the draft and the published copy alike, with a page version. Admin only; compare-and-set on the block; refused when the block''s draft differs from what is published.';
