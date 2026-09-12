-- PHOTOROOM AS A FULL PROVIDER, AND THE SIX EDITS IT BRINGS WITH IT
--
-- Photoroom was already in ai_providers as a background-removal backend
-- (0026_image_tools.sql). It does considerably more than that: one endpoint,
-- /v2/edit, applies AI backgrounds, relighting, cast shadows, beautification,
-- uncrop and ghost-mannequin in the same call shape. Those six arrive here as
-- ordinary catalogue services, priced by the same cost engine as everything
-- else, so an operator can reprice or switch any of them off without a deploy.
--
-- THE PRICES BELOW ARE THE VENDOR'S, NOT OURS. Photoroom bills per image by
-- which API answered: $0.02 for the Remove Background API (/v1/segment) and
-- $0.10 for the Image Editing API (/v2/edit), and it charges that way across
-- plans in both directions. api_cost_usd_micros records the second figure —
-- 100000 micro-dollars — for every edit. credits_cost stays a floor of 1: the
-- engine raises the real price to whatever the margin rule demands at the
-- provider that ends up running the tool, so a cheaper vendor appearing later
-- makes these cheaper automatically.

-- 1. The six new catalogue entries ------------------------------------------
insert into public.service_catalog
  (slug, name, category, service_type, unit, credits_cost, api_cost_usd_micros, min_margin_percent, sort_order)
values
  ('tool_ai_background',   'Tool — AI background',   'tools', 'image', 'image', 1, 100000, 50, 28),
  ('tool_relight',         'Tool — AI relight',      'tools', 'image', 'image', 1, 100000, 50, 29),
  ('tool_ai_shadow',       'Tool — AI shadow',       'tools', 'image', 'image', 1, 100000, 50, 30),
  ('tool_beautify',        'Tool — AI beautify',     'tools', 'image', 'image', 1, 100000, 50, 31),
  ('tool_uncrop',          'Tool — AI uncrop',       'tools', 'image', 'image', 1, 100000, 50, 32),
  ('tool_ghost_mannequin', 'Tool — ghost mannequin', 'tools', 'image', 'image', 1, 100000, 50, 33)
on conflict (slug) do nothing;

-- 2. Which Photoroom environment the key belongs to --------------------------
-- Sandbox is a property of the KEY at Photoroom: a key beginning with
-- `sandbox_` hits the same endpoints, costs nothing, is capped at roughly a
-- thousand calls a month and stamps a watermark on the result. So there is no
-- host to switch and nothing to store but the operator's intent — which the
-- panel needs anyway, to say plainly that watermarked output is expected
-- rather than letting it look like a bug.
--
-- `environment` is advisory: the runtime reads the real environment off the
-- key itself. It exists so the panel can warn when the two disagree — a live
-- key pasted into a sandbox-selected provider, or the reverse.
update public.ai_providers
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('environment', 'live')
where slug = 'photoroom' and not (metadata ? 'environment');

-- 3. Free background removal -------------------------------------------------
-- Background removal is the tool sellers open first and the cheapest one we
-- buy ($0.02), which makes it the only sensible candidate for a free tier.
-- "Free forever, unmetered" is not: at a hundred images a day per seller it is
-- a real bill with no revenue against it, and the limit has to be enforced
-- where it cannot be edited — server-side, against a counted window.
--
-- Everything here is off by default. An operator turns it on in the settings
-- panel, and nothing about the existing paid path changes until they do.
insert into public.app_settings (key, value)
select 'free_tools', jsonb_build_object(
  'remove_bg', jsonb_build_object(
    'enabled', false,
    -- Images per window, per workspace.
    'limit', 10,
    -- 'day' | 'week' | 'month'
    'window', 'day',
    -- Plans the allowance applies to. Empty means every plan.
    'plans', '[]'::jsonb
  ))
where not exists (select 1 from public.app_settings where key = 'free_tools');

-- 4. Counting the free runs --------------------------------------------------
-- usage_events already records every run, but it records what was CHARGED.
-- A free run charges zero credits, and so does a local tool, so the ledger
-- cannot tell "this seller used their free allowance" from "this seller
-- resized a photo". One row per granted free run, counted inside the window.
create table if not exists public.free_tool_grants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  tool_slug text not null,
  usage_event_id uuid references public.usage_events(id) on delete set null,
  created_at timestamptz not null default now()
);

-- The only query this table serves: "how many for this workspace and tool
-- since <window start>".
create index if not exists free_tool_grants_window_idx
  on public.free_tool_grants (workspace_id, tool_slug, created_at desc);

alter table public.free_tool_grants enable row level security;

-- A seller may see their own workspace's grants (the panel shows "3 of 10
-- left"). Nobody writes through the API: rows are created by the SECURITY
-- DEFINER function below, which is the only thing that may decide a run is
-- free — a client-side insert would be a self-service discount.
create policy "free_grants_read_own" on public.free_tool_grants for select
  using (public.is_workspace_member(workspace_id));
create policy "free_grants_admin_read" on public.free_tool_grants for select
  using (public.is_admin());

-- 5. Claim one free run, atomically -----------------------------------------
-- Read-then-insert in application code is a race: two batch workers a
-- millisecond apart both read 9 of 10 and both proceed. The count and the
-- insert happen here, in one statement, under the row lock the insert takes.
--
-- Returns the number of free runs REMAINING after this one, or -1 when the
-- allowance is exhausted or switched off. The caller charges credits on -1.
create or replace function public.claim_free_tool_run(
  p_workspace_id uuid,
  p_tool_slug text,
  p_limit int,
  p_window_start timestamptz
) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_used int;
begin
  -- The caller is the seller themselves; a workspace they do not belong to is
  -- not theirs to spend.
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  if not public.is_workspace_member(p_workspace_id) then raise exception 'forbidden'; end if;
  if p_limit is null or p_limit <= 0 then return -1; end if;

  select count(*) into v_used
  from public.free_tool_grants
  where workspace_id = p_workspace_id
    and tool_slug = p_tool_slug
    and created_at >= p_window_start;

  if v_used >= p_limit then return -1; end if;

  insert into public.free_tool_grants (workspace_id, user_id, tool_slug)
  values (p_workspace_id, auth.uid(), p_tool_slug);

  return p_limit - v_used - 1;
end;
$$;

revoke all on function public.claim_free_tool_run(uuid, text, int, timestamptz) from public;
grant execute on function public.claim_free_tool_run(uuid, text, int, timestamptz) to authenticated;

-- How many are left, without consuming one. Feeds the badge on the tool card.
create or replace function public.free_tool_remaining(
  p_workspace_id uuid,
  p_tool_slug text,
  p_limit int,
  p_window_start timestamptz
) returns int
language sql security definer set search_path = public stable as $$
  select greatest(0, p_limit - count(*)::int)
  from public.free_tool_grants
  where workspace_id = p_workspace_id
    and tool_slug = p_tool_slug
    and created_at >= p_window_start
    and public.is_workspace_member(p_workspace_id)
    and auth.uid() is not null;
$$;

revoke all on function public.free_tool_remaining(uuid, text, int, timestamptz) from public;
grant execute on function public.free_tool_remaining(uuid, text, int, timestamptz) to authenticated;
