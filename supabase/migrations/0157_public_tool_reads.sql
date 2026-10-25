-- 0157 — PUBLIC TOOLS V1: THE SERVER MAY PRICE A TOOL FOR A VISITOR.
--
-- A visitor who opens a tool page (behind the `public_tools` switch, off by
-- default) must see the same honest facts a customer sees: can this tool run
-- right now, and what does the current configuration cost. Those facts are
-- computed on the SERVER, by the same TypeScript every customer page uses
-- (lib/server/retouch.ts, lib/server/image-tools.ts, lib/ai/router.ts,
-- lib/server/thumbnail/settings.ts …) — there is no second calculator.
--
-- That code reads a handful of objects a visitor's role cannot read today:
--
--   ai_models, ai_providers         RLS: `auth.uid() IS NOT NULL`
--   providers_with_credentials()    body: `auth.uid() IS NOT NULL`
--   ai_tool_runtime(), ai_tool_workflow_read(), thumbnail_config_read(),
--   ai_background_presets_read()    EXECUTE granted to authenticated only —
--                                   all four already refuse without the
--                                   server token (server_call_ok, 0077).
--
-- WHAT CHANGES — and what does not:
--
--   1. server_request_ok(): true only when the PostgREST request carries the
--      server's own token in the `x-grovbase-server` header. The token is
--      the dispatch secret (DISPATCH env on the server, its sha256 in
--      app_settings.notifications) — never in a browser, never in a
--      NEXT_PUBLIC variable. lib/server/public-tools.ts guestReadClient() is
--      the ONLY client that sends it, and only from server code.
--   2. ai_models / ai_providers: readable when signed in (as before) OR when
--      the request is the server's. A browser holding the publishable key
--      still reads nothing as a visitor.
--   3. Their admin write policies are scoped `to authenticated`. They were
--      `to public` with `is_admin()`, which a visitor's role may not execute —
--      so ANY anonymous read of these tables failed with "permission denied for
--      function is_admin" instead of returning no rows. Same fix 0110 applied
--      to app_settings ("split the policy by role"). Admins are always
--      authenticated; nothing an admin can do changes.
--   4. providers_with_credentials(): same rule as 2.
--   5. EXECUTE on the four token-gated readers to anon. Without the token they
--      return nothing (or raise 'forbidden'), exactly as for a customer who
--      calls them from a browser today.
--
-- Nothing here grants a write, and nothing returns a prompt to anybody who
-- could not already get it: the readers that carry encrypted prompts are
-- token-gated and their output never leaves the server (the pages pass only
-- prices, availability and preset NAMES to the browser).
--
-- RE-RUNNABLE: create or replace / drop policy if exists / grant.
--
-- ROLLBACK (manual):
--   drop policy aimodel_select on public.ai_models;
--   create policy aimodel_select on public.ai_models for select using (auth.uid() is not null);
--   drop policy aiprov_select on public.ai_providers;
--   create policy aiprov_select on public.ai_providers for select using (auth.uid() is not null);
--   (admin write policies may stay `to authenticated` — that is strictly narrower)
--   restore providers_with_credentials() from 0018;
--   revoke execute on the four readers from anon; drop function public.server_request_ok();
--
-- Probe after apply (must hold): as anon without the header,
--   select count(*) from public.ai_models  → 0 rows, NO error;
--   select * from public.providers_with_credentials() → no rows.

set local lock_timeout = '10s';

-- 1 ─────────────────────────────────────────────────────────────────────────
create or replace function public.server_request_ok()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_token text;
begin
  begin
    v_token := nullif(current_setting('request.headers', true), '')::json ->> 'x-grovbase-server';
  exception when others then
    -- No PostgREST request (a migration, the SQL editor) or a malformed
    -- header set: not the server.
    return false;
  end;
  if v_token is null or v_token = '' or length(v_token) > 512 then return false; end if;
  return public.server_call_ok(v_token);
end $$;

revoke all on function public.server_request_ok() from public;
grant execute on function public.server_request_ok() to anon, authenticated;

comment on function public.server_request_ok() is
  'Public tools (0157): true when the PostgREST request carries the server token in x-grovbase-server. Used by RLS so the server can price a tool for a visitor; a browser never holds the token.';

-- 2 + 3 ─────────────────────────────────────────────────────────────────────
drop policy if exists aimodel_admin_write on public.ai_models;
create policy aimodel_admin_write on public.ai_models for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists aimodel_select on public.ai_models;
create policy aimodel_select on public.ai_models for select
  using (auth.uid() is not null or (select public.server_request_ok()));

drop policy if exists aiprov_admin_write on public.ai_providers;
create policy aiprov_admin_write on public.ai_providers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists aiprov_select on public.ai_providers;
create policy aiprov_select on public.ai_providers for select
  using (auth.uid() is not null or (select public.server_request_ok()));

-- 4 ─────────────────────────────────────────────────────────────────────────
create or replace function public.providers_with_credentials()
returns setof uuid
language sql
security definer
set search_path = public
as $$
  select distinct c.provider_id
    from public.ai_provider_credentials c
    join public.ai_providers p on p.id = c.provider_id
   where c.active and p.active
     and (auth.uid() is not null or public.server_request_ok());
$$;

revoke execute on function public.providers_with_credentials() from public;
grant execute on function public.providers_with_credentials() to anon, authenticated;

-- 5 ─────────────────────────────────────────────────────────────────────────
grant execute on function public.ai_tool_runtime(text, text) to anon;
grant execute on function public.ai_tool_workflow_read(text, text, uuid) to anon;
grant execute on function public.thumbnail_config_read(text) to anon;
grant execute on function public.ai_background_presets_read(text) to anon;
