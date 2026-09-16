-- ─────────────────────────────────────────────────────────────────────────────
-- IMAGE DERIVATIVES FOR THE LIBRARY
--
-- The generator writes a small WebP grid thumbnail and a mid-size preview
-- beside every image it stores, and records their paths in
-- `generation_assets.metadata->>'thumb'` and `->>'preview'`. Every asset made
-- BEFORE that existed has neither, so every grid showing one downloads the
-- full render — several megabytes per tile — to paint a 250px square.
--
-- Backfilling those is a WRITE to a row the client may only read: customers
-- have no UPDATE on `generation_assets` (and must not — the row carries the
-- provider and model metadata). So the write goes through a definer function
-- that does exactly one thing: merge derivative paths into the metadata of an
-- asset the caller's workspace owns. The caller cannot set any other key,
-- cannot clear existing metadata, and cannot touch another workspace's asset.
--
-- `/api/library/thumb` is the only caller: it reads the original through RLS
-- with the member's own session, resizes it, uploads the derivatives, and then
-- records them here.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.set_asset_derivatives(
  asset_id uuid, thumb_path text, preview_path text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
  v_patch jsonb := '{}'::jsonb;
begin
  -- Each path must look like one of ours: "<workspace>/<job>/<n>_t.webp".
  -- A caller that could write an arbitrary string here could point the grid
  -- at any object in the bucket.
  if thumb_path is null or thumb_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9_.-]+$' then
    raise exception 'invalid thumb path';
  end if;
  if preview_path is not null and preview_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9_.-]+$' then
    raise exception 'invalid preview path';
  end if;

  select g.workspace_id into v_ws
  from public.generation_assets a
  join public.generations g on g.id = a.generation_id
  where a.id = asset_id;

  if v_ws is null then
    raise exception 'asset not found';
  end if;
  if not public.is_workspace_member(v_ws) then
    raise exception 'not a member of this workspace';
  end if;
  -- …and each derivative has to live in that same workspace's folder.
  if split_part(thumb_path, '/', 1) <> v_ws::text then
    raise exception 'thumb path outside the workspace';
  end if;
  if preview_path is not null and split_part(preview_path, '/', 1) <> v_ws::text then
    raise exception 'preview path outside the workspace';
  end if;

  v_patch := jsonb_build_object('thumb', thumb_path);
  if preview_path is not null then
    v_patch := v_patch || jsonb_build_object('preview', preview_path);
  end if;

  update public.generation_assets
  set metadata = coalesce(metadata, '{}'::jsonb) || v_patch
  where id = asset_id;

  return thumb_path;
end;
$$;

-- `revoke … from public` alone is not enough: Supabase's default privileges
-- grant EXECUTE on every new function to `anon` and `authenticated` by name,
-- and a named grant survives a revoke from PUBLIC. A signed-out caller would
-- be turned away by the membership check regardless — `auth.uid()` is null, so
-- `is_workspace_member` is false — but a definer function should not be
-- reachable by a role that can never legitimately use it.
revoke all on function public.set_asset_derivatives(uuid, text, text) from public;
revoke all on function public.set_asset_derivatives(uuid, text, text) from anon;
grant execute on function public.set_asset_derivatives(uuid, text, text) to authenticated;

-- Each gallery page embeds the assets of the generations it found, and
-- `generation_assets` carries nothing but its primary key — so that embed is
-- a sequential scan per page. This is the index it has always wanted.
--
-- NOTE: no index is added to `generations` here. The keyset scan this library
-- pages with is (workspace_id, created_at desc, id desc), and
-- `generations_ws_created_idx` already covers exactly that key in exactly that
-- order. A fourth workspace index would be write cost and bloat for nothing.
create index if not exists generation_assets_generation_idx
  on public.generation_assets (generation_id);
