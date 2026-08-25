-- Library favourites. Additive only: one boolean on the existing generations
-- table plus a definer RPC to flip it.
--
-- The flag is written through an RPC rather than a plain UPDATE policy on
-- purpose: RLS cannot restrict WHICH columns an update touches, so granting
-- clients UPDATE on `generations` to let them star an image would also let
-- them rewrite prompt_text, product_match_score and the cost columns. The
-- function below is the only write path, and it touches exactly one column.
alter table public.generations
  add column if not exists favorite boolean not null default false;

-- Partial index: the favourites shelf only ever queries the true rows.
create index if not exists generations_favorite_idx
  on public.generations (workspace_id, created_at desc)
  where favorite;

create or replace function public.set_generation_favorite(gen_id uuid, value boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ws uuid;
begin
  select workspace_id into v_ws from public.generations where id = gen_id;
  if v_ws is null then
    raise exception 'generation not found';
  end if;
  if not public.is_workspace_member(v_ws) then
    raise exception 'not a member of this workspace';
  end if;

  update public.generations set favorite = value where id = gen_id;
  return value;
end;
$$;

revoke all on function public.set_generation_favorite(uuid, boolean) from public;
grant execute on function public.set_generation_favorite(uuid, boolean) to authenticated;
