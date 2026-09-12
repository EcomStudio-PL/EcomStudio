-- SERVER-LIFECYCLE RPCs STOP BEING CUSTOMER-CALLABLE
--
-- A family of SECURITY DEFINER functions that only GrovBase's own server has
-- any business calling was reachable by every signed-in customer through
-- PostgREST, guarded by nothing stronger than "are you a member of this
-- workspace". Membership is the wrong question for these: the caller IS the
-- member, and the thing being asserted is something only the server can know.
--
-- THE ONE THAT COSTS MONEY.
--
-- usage_events is readable by its own workspace (usage_events_member_read), so
-- a customer can see the id and 'pending' status of a generation that is at
-- that moment running. fail_usage_event() accepted that id from anyone in the
-- workspace, flipped pending -> failed, and refunded the charge. The images
-- still arrived, because the provider call had already been made and the assets
-- are written by the application, not by this function. Start a generation,
-- POST /rest/v1/rpc/fail_usage_event with your own event id, receive the images
-- and the credits back. Repeat. That is unlimited free generation for any
-- registered account, and registration is open.
--
-- THE ONES THAT LEAK.
--
-- get_active_provider_credential() returned encrypted_value/iv/auth_tag/base_url
-- for any provider id to anyone signed in, and provider ids are handed out by
-- providers_with_credentials() and readable from ai_providers (aiprov_select is
-- `auth.uid() is not null`). get_engine_rules() and match_knowledge_examples()
-- checked nothing at all. The values are AES-256-GCM ciphertext and the key is
-- not in the database, so this is not a plaintext key leak - but it hands an
-- attacker the entire ciphertext corpus plus every provider base URL, and it
-- contradicts the rule this codebase is built on: a stored credential never
-- leaves the server.
--
-- THE ONE THAT TAKES THE PLATFORM DOWN.
--
-- set_provider_health() let any signed-in user mark any provider 'down' with a
-- thirty-minute cooldown. The router demotes unhealthy providers, so one loop
-- over the provider slugs stops generation for every customer at once.
--
-- HOW THEY ARE FIXED, AND WHY THIS WAY.
--
-- This codebase already has exactly one mechanism for "prove you are the
-- server": a token whose sha256 must match app_settings.notifications
-- ->>'dispatch_hash'. integration_dispatch_read, message_template_lookup,
-- mail_sync_context, ai_tool_runtime, notification_dispatch_claim and the
-- signup guard all use it, and lib/server/integrations.ts derives it from the
-- master key that only the server process holds. So this migration applies the
-- existing pattern rather than inventing a second one - which also means no new
-- infrastructure secret: the owner's rule is one root-of-trust, not two.
--
-- The gate FAILS CLOSED when the master key is absent. That is the correct
-- direction and costs nothing today: without the key no provider credential can
-- be decrypted, so no generation can run to be refunded in the first place.
--
-- The old functions are REVOKED, not dropped. Revoking fails closed, leaves the
-- bodies readable next to their replacements, and is a one-line rollback. A
-- deploy that still calls the old names gets a permission error and refunds
-- nothing, which is the safe half of the failure.

-- ── 1. The shared gate ──────────────────────────────────────────────────────
-- Deliberately NOT granted to anon or authenticated. Inside a SECURITY DEFINER
-- function the call runs as the owner, so the callers below reach it without a
-- grant, while a client cannot use it as an oracle to test candidate tokens.
create or replace function public.server_call_ok(p_token text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_hash text;
begin
  select value->>'dispatch_hash' into v_hash
    from public.app_settings where key = 'notifications';
  if v_hash is null or v_hash = '' then return false; end if;
  return encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') = v_hash;
end $$;

revoke all on function public.server_call_ok(text) from public, anon, authenticated;

-- ── 2. Credit lifecycle, server-only ────────────────────────────────────────
-- Same bodies as the originals; the only change is the gate on the first line.
-- The workspace-membership check STAYS: the token proves the caller is the
-- server, membership still proves the server is acting for the right tenant.

create or replace function public.usage_event_fail(
  p_token text,
  p_event_id uuid,
  p_error text,
  p_api_cost_usd_micros bigint default 0
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_event record;
  v_wallet uuid;
  v_tx uuid;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  select id, workspace_id, credits_charged, status, refund_tx_id
    into v_event from public.usage_events where id = p_event_id for update;
  if v_event.id is null or not public.is_workspace_member(v_event.workspace_id) then
    raise exception 'not_authorized';
  end if;
  if v_event.status = 'pending' then
    update public.usage_events
      set status = 'failed', error = left(coalesce(p_error, 'error'), 200),
          finished_at = now(),
          actual_api_cost_usd_micros = greatest(0, coalesce(p_api_cost_usd_micros, 0))
      where id = p_event_id;
    v_event.status := 'failed';
  end if;
  -- Idempotent: a second call, a succeeded event, or an already-refunded event
  -- all fall out here without touching the ledger.
  if v_event.status <> 'failed' or v_event.refund_tx_id is not null or v_event.credits_charged <= 0 then
    return null;
  end if;
  select id into v_wallet from public.credit_wallets where workspace_id = v_event.workspace_id;
  v_tx := public.apply_credit_transaction(
    v_wallet, v_event.credits_charged, 'refund', 'Refund: generation failed',
    p_event_id, jsonb_build_object('reason', left(coalesce(p_error, 'error'), 100)), auth.uid());
  update public.usage_events set status = 'refunded', refund_tx_id = v_tx where id = p_event_id;
  return v_tx;
end $$;

create or replace function public.usage_event_complete(
  p_token text,
  p_event_id uuid,
  p_result_count integer,
  p_api_cost_usd_micros bigint default 0,
  p_request_id text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_ws uuid;
begin
  -- Gated as well, and not only for tidiness: p_api_cost_usd_micros is what the
  -- margin and economics views are computed from. Left open, a customer could
  -- write an arbitrary provider cost onto their own event and make the
  -- profitability reporting say whatever they wanted.
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  select workspace_id into v_ws from public.usage_events where id = p_event_id;
  if v_ws is null or not public.is_workspace_member(v_ws) then
    raise exception 'not_authorized';
  end if;
  update public.usage_events
    set status = 'succeeded',
        result_count = greatest(0, coalesce(p_result_count, 0)),
        actual_api_cost_usd_micros = greatest(0, coalesce(p_api_cost_usd_micros, 0)),
        provider_request_id = left(p_request_id, 200),
        finished_at = now()
    where id = p_event_id and status = 'pending';
end $$;

create or replace function public.usage_event_charge(
  p_token text,
  p_wallet_id uuid,
  p_amount integer,
  p_description text,
  p_reference_id uuid,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_ws uuid;
  v_ev_ws uuid;
  v_tx uuid;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  if p_amount <= 0 or p_amount > 10000 then raise exception 'invalid_amount'; end if;
  select workspace_id into v_ws from public.credit_wallets where id = p_wallet_id;
  if v_ws is null or not public.is_workspace_member(v_ws) then
    raise exception 'not_authorized';
  end if;
  -- The original wrote credit_tx_id onto p_reference_id with no check that the
  -- event belonged to the same workspace, so a caller could stamp a transaction
  -- id onto another tenant's usage row. The event must be ours.
  select workspace_id into v_ev_ws from public.usage_events where id = p_reference_id;
  if v_ev_ws is null or v_ev_ws <> v_ws then raise exception 'not_authorized'; end if;
  v_tx := public.apply_credit_transaction(
    p_wallet_id, -p_amount, 'generation', p_description, p_reference_id, p_metadata, auth.uid());
  update public.usage_events set credit_tx_id = v_tx where id = p_reference_id;
  return v_tx;
end $$;

create or replace function public.usage_event_refund_partial(
  p_token text,
  p_event_id uuid,
  p_amount integer
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_event record;
  v_wallet uuid;
  v_tx uuid;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if auth.uid() is null then raise exception 'unauthenticated'; end if;
  select id, workspace_id, credits_charged, status, refund_tx_id, metadata
    into v_event from public.usage_events where id = p_event_id for update;
  if v_event.id is null or not public.is_workspace_member(v_event.workspace_id) then
    raise exception 'not_authorized';
  end if;
  -- Byte-for-byte the original guard set: still pending, not already fully
  -- refunded, not already partially refunded, and a strictly partial amount.
  if v_event.status <> 'pending'
     or v_event.refund_tx_id is not null
     or coalesce((v_event.metadata->>'partial_refund_tx') is not null, false)
     or p_amount is null or p_amount <= 0 or p_amount >= v_event.credits_charged then
    return null;
  end if;
  select id into v_wallet from public.credit_wallets where workspace_id = v_event.workspace_id;
  v_tx := public.apply_credit_transaction(
    v_wallet, p_amount, 'refund', 'Refund: partial delivery',
    p_event_id, jsonb_build_object('reason', 'partial_delivery', 'amount', p_amount), auth.uid());
  update public.usage_events
     set credits_charged = credits_charged - p_amount,
         metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('partial_refund_tx', v_tx)
   where id = p_event_id;
  return v_tx;
end $$;

-- ── 3. Ciphertext reads, server-only ────────────────────────────────────────

create or replace function public.provider_credential_read(
  p_token text,
  p_provider_id uuid
) returns table(encrypted_value text, iv text, auth_tag text, base_url text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  return query
    select c.encrypted_value, c.iv, c.auth_tag, c.base_url
    from public.ai_provider_credentials c
    join public.ai_providers p on p.id = c.provider_id
    where c.provider_id = p_provider_id and c.active and p.active
    limit 1;
end $$;

create or replace function public.engine_rules_read(p_token text)
returns table(id uuid, content_encrypted text, content_iv text, content_tag text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  return query
    select r.id, r.content_encrypted, r.content_iv, r.content_tag
      from public.prompt_engine_rules r
     where r.enabled and r.content_encrypted is not null
     order by r.priority asc, r.created_at asc
     limit 20;
end $$;

create or replace function public.knowledge_match(
  p_token text,
  p_embedding extensions.vector,
  p_top_k integer default 3
) returns table(id uuid, hint_encrypted text, hint_iv text, hint_tag text)
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  return query
    select e.id, e.hint_encrypted, e.hint_iv, e.hint_tag
      from public.knowledge_examples e
      join public.knowledge_sets s on s.id = e.set_id
     where e.enabled
       and e.embedding is not null
       and e.hint_encrypted is not null
       and s.status = 'ready'
       and (1 - (e.embedding <=> p_embedding)) >= 0.25
     order by e.embedding <=> p_embedding
     limit least(greatest(coalesce(p_top_k, 3), 1), 5);
end $$;

-- ── 4. Provider health, server-only ─────────────────────────────────────────

create or replace function public.provider_health_set(
  p_token text,
  p_slug text,
  p_state text,
  p_cooldown_seconds integer default 0,
  p_note text default null
) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if p_state not in ('healthy','rate_limited','quota_exhausted','auth_error','degraded','down') then
    raise exception 'invalid_state';
  end if;
  if not exists (select 1 from public.ai_providers where slug = p_slug) then
    raise exception 'unknown_provider';
  end if;
  insert into public.provider_health (provider_slug, state, cooldown_until, note, updated_at)
  values (
    p_slug, p_state,
    case when p_cooldown_seconds > 0
      then now() + make_interval(secs => least(p_cooldown_seconds, 1800))
      else null end,
    left(p_note, 200), now()
  )
  on conflict (provider_slug) do update
    set state = excluded.state,
        cooldown_until = excluded.cooldown_until,
        note = excluded.note,
        updated_at = now();
end $$;

-- ── 5. Grants: the new ones in, the old ones out ────────────────────────────

revoke all on function public.usage_event_fail(text, uuid, text, bigint) from public, anon;
grant execute on function public.usage_event_fail(text, uuid, text, bigint) to authenticated;

revoke all on function public.usage_event_complete(text, uuid, integer, bigint, text) from public, anon;
grant execute on function public.usage_event_complete(text, uuid, integer, bigint, text) to authenticated;

revoke all on function public.usage_event_charge(text, uuid, integer, text, uuid, jsonb) from public, anon;
grant execute on function public.usage_event_charge(text, uuid, integer, text, uuid, jsonb) to authenticated;

revoke all on function public.usage_event_refund_partial(text, uuid, integer) from public, anon;
grant execute on function public.usage_event_refund_partial(text, uuid, integer) to authenticated;

revoke all on function public.provider_credential_read(text, uuid) from public, anon;
grant execute on function public.provider_credential_read(text, uuid) to authenticated;

revoke all on function public.engine_rules_read(text) from public, anon;
grant execute on function public.engine_rules_read(text) to authenticated;

revoke all on function public.knowledge_match(text, extensions.vector, integer) from public, anon;
grant execute on function public.knowledge_match(text, extensions.vector, integer) to authenticated;

revoke all on function public.provider_health_set(text, text, text, integer, text) from public, anon;
grant execute on function public.provider_health_set(text, text, text, integer, text) to authenticated;

-- The holes, closed. Each of these is superseded by a gated function above.
--
-- REVOKE FROM `public` AND NOT ONLY FROM anon/authenticated. Most of these
-- carried a blanket grant to the PUBLIC pseudo-role, which is what actually
-- made them callable; revoking from anon and authenticated alone removed
-- nothing at all and left every one of them open. That is not a theory - it is
-- what happened on the first attempt at this migration, and it was caught only
-- because the grants were read back afterwards instead of trusting "success".
revoke execute on function public.fail_usage_event(uuid, text) from public, anon, authenticated;
revoke execute on function public.fail_usage_event(uuid, text, bigint) from public, anon, authenticated;
revoke execute on function public.complete_usage_event(uuid, integer) from public, anon, authenticated;
revoke execute on function public.complete_usage_event(uuid, integer, bigint, text) from public, anon, authenticated;
revoke execute on function public.refund_usage_event(uuid) from public, anon, authenticated;
revoke execute on function public.refund_usage_partial(uuid, integer) from public, anon, authenticated;
revoke execute on function public.charge_usage_credits(uuid, integer, text, uuid, jsonb) from public, anon, authenticated;
revoke execute on function public.get_active_provider_credential(uuid) from public, anon, authenticated;
revoke execute on function public.get_engine_rules() from public, anon, authenticated;
revoke execute on function public.match_knowledge_examples(extensions.vector, integer) from public, anon, authenticated;
revoke execute on function public.set_provider_health(text, text, integer, text) from public, anon, authenticated;

-- Trigger functions are not an API. They were reachable as RPCs only because
-- every function in `public` is exposed by default; calling one outside its
-- trigger context does nothing useful, but nothing should be able to try.
revoke execute on function public.track_model_price_change() from public, anon, authenticated;
revoke execute on function public.track_service_price_change() from public, anon, authenticated;

comment on function public.server_call_ok(text) is
  'Proof that a caller is GrovBase''s own server: sha256(token) must equal app_settings.notifications->>dispatch_hash. Same gate as integration_dispatch_read and message_template_lookup. Never granted to anon or authenticated - SECURITY DEFINER callers reach it as the owner.';
