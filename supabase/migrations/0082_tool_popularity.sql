-- WHICH TOOLS PEOPLE ACTUALLY USE
--
-- The global search opens with "najczęściej używane" and "popularne narzędzia".
-- Both lists have to come from real usage, not from an array somebody typed
-- once and nobody updated. This migration adds the two database halves of that:
-- a way to COUNT usage across the whole product, and a way to STORE the answer
-- so the search modal reads one small row instead of aggregating on open.
--
-- WHY COUNTING NEEDS A FUNCTION AT ALL.
--
-- usage_events already records every run of every tool, and it is the right
-- source — a page visit is not usage, a tile click is not usage, a SUCCEEDED
-- event is. But the table is fenced by `usage_events_member_read`: a caller
-- sees their own workspace and nothing else. That is correct and stays. It also
-- means a product-wide ranking can never be computed by a normal client, which
-- is why the aggregation runs SECURITY DEFINER and is gated by the same
-- proof-of-server token the rest of this codebase uses (server_call_ok,
-- migration 0077). No new raw table, no new root of trust.
--
-- What comes back is COUNTS, never rows: service slug, the tool tag the run
-- carried, and how many succeeded. Nothing identifies a workspace, a customer
-- or a prompt, so the ranking cannot become a side channel into other people's
-- work even if the stored result is world-readable — and it is, deliberately.
--
-- WHY THE ANSWER IS STORED IN app_settings.
--
-- "Ranking nie może być przeliczany ciężkim SQL-em przy każdym otwarciu
-- wyszukiwarki." app_settings is already the project's cache of computed,
-- non-secret, product-wide state (homepage, launch_page, billing), it is
-- readable by everyone through settings_select_all, and the customer layout
-- already reads from it. One jsonb row is the whole read path.
--
-- Writing it cannot use settings_admin_write, because the thing doing the
-- writing is a scheduled job with no admin session. So the write is a second
-- definer function behind the same token — the ranking is server-computed data,
-- not an operator setting, and an admin has no reason to hand-edit it.

-- ── 1. counting ─────────────────────────────────────────────────────────────
-- Grouped by the three tags a usage row can carry, because one service_slug
-- covers several screens: `image_generation` is the custom generator, the
-- prompt engine, Retusz and every Moda tool, told apart by metadata. The
-- mapping from these tags to a feature lives in TypeScript
-- (lib/server/tool-popularity.ts) next to FEATURE_REGISTRY, so there is exactly
-- one place that knows which route a tool opens.
create or replace function public.tool_usage_counts(
  p_token text,
  p_since timestamptz
)
returns table (
  service_slug text,
  tool text,
  operation text,
  prompt_origin text,
  uses bigint
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  -- Fails closed: without the server key there is no ranking, and the caller
  -- falls back to the registry order rather than receiving a partial answer.
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;

  return query
    select
      e.service_slug,
      e.metadata->>'tool',
      e.metadata->>'operation',
      e.metadata->>'prompt_origin',
      count(*)
    from public.usage_events e
    where e.status = 'succeeded'
      and e.created_at >= p_since
    group by 1, 2, 3, 4;
end $$;

revoke execute on function public.tool_usage_counts(text, timestamptz) from public;
grant execute on function public.tool_usage_counts(text, timestamptz) to anon, authenticated;

-- The aggregation reads one window at a time and only succeeded rows, so it
-- gets an index shaped exactly like that. Partial, because failed and refunded
-- events are noise for this question and there is no reason to carry them.
create index if not exists usage_events_succeeded_created_idx
  on public.usage_events (created_at desc)
  where status = 'succeeded';

-- ── 2. storing ──────────────────────────────────────────────────────────────
create or replace function public.tool_popularity_store(
  p_token text,
  p_value jsonb
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  insert into public.app_settings (key, value, updated_at)
  values ('tool_popularity', coalesce(p_value, '{}'::jsonb), now())
  on conflict (key) do update
    set value = excluded.value, updated_at = now();
end $$;

revoke execute on function public.tool_popularity_store(text, jsonb) from public;
grant execute on function public.tool_popularity_store(text, jsonb) to anon, authenticated;

-- ── 3. the row exists from the start ────────────────────────────────────────
-- `source: fallback` is the honest initial state: nothing has been computed
-- yet, so the search shows the registry's own order and says nothing about
-- popularity it cannot back up. The first scheduled run replaces this.
insert into public.app_settings (key, value)
values (
  'tool_popularity',
  jsonb_build_object(
    'version', 1,
    'source', 'fallback',
    'computed_at', null,
    'window_days', null,
    'sample', 0,
    'keys', '[]'::jsonb
  )
)
on conflict (key) do nothing;
