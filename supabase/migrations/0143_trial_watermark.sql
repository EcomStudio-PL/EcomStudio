-- 0143 — TRIAL WATERMARK: who gets a marked image, where its clean original
-- waits (sealed), who may unlock it, and how it disappears.
--
-- WHAT IT IS. A workspace that never paid gets its AI images with the
-- GrovBase mark. The clean original is kept for `original_retention_days`
-- (30 by default, frozen per original) as AES-256-GCM ciphertext in a new
-- private bucket; its per-original key, itself wrapped under a key the
-- database never sees (lib/server/trial-watermark/keys.ts), lives in a table
-- no client role can touch. An ACTIVE PAID SUBSCRIPTION unlocks it: the clean
-- file becomes the asset's ordinary library file and the key is destroyed.
-- Expiry destroys the key too (crypto-erasure, immediate); the blob is purged
-- by the daily cron through the Storage API.
--
-- THE CONTRACT IS lib/server/trial-watermark/rpc.ts: every function below has
-- the name, argument names and reply keys its wrapper there parses. Two
-- departures, recorded where they happen: trial_original_reserve takes the
-- original's id (`p_id`) from the server, because the key wrap and the blob
-- are both bound to that id before the row exists; and the helpers the
-- storage policies need (uploadable / purgeable / purgeable_member) are here
-- because a policy cannot read a table its role cannot.
--
--  1. trial_originals, trial_original_keys, trial_originals_purge_heartbeat
--     RLS on, NO policies, every privilege revoked from the client roles.
--  2. Internal helpers (no grant): the config reader (the ONLY parser of
--     app_settings.trial_watermark; never raises — R26), the paid predicates
--     (D2), the derivative path of lib/thumbs.ts, the marker-protected event
--     writer (R8) and the subscription-confirmed note.
--  3. Server functions, all `server_call_ok(p_token)` first (the dispatch
--     token, as in 0077/0102/0139), and then the caller's own membership:
--       trial_watermark_decide / _config_read / _entitlement
--       trial_original_reserve / _attach / _release
--       trial_original_unlock_begin / _unlock_finish / _unlock_abort (R3)
--       trial_original_next_batch, trial_original_source (R14)
--       trial_watermark_log (the 7 names), trial_originals_sweep_now
--       trial_originals_purge_list / _mark_purged / _purge_heartbeat (anon
--       too: the purge runs from the cron's session-less client)
--     Member reads (no token): trial_original_states, trial_original_summary.
--     Admin read: trial_watermark_stats. Owner only (pg_cron): trial_originals_sweep.
--  4. Triggers: an asset deleted → its original deleted and key destroyed
--     (never raises); an activity_logs row named watermark_* is refused unless
--     written by one of the definer writers above (R8), plus a dedupe index.
--  5. set_asset_derivatives (0083) redefined, same signature and grants: a
--     derivative must be THIS asset's current file's `_t`/`_p` (R12).
--  6. Storage: bucket `trial-originals` (private, octet-stream, 50 MB) and
--     its policies. FIRST every existing storage.objects policy written
--     without a TO clause (roles {public}) is re-scoped to `authenticated`
--     (R1). On PROD those are the 19 policies of 0004, 0012, 0013, 0042 and
--     0043: product_images_{select,insert,update,delete},
--     generation_assets_{select,insert,delete}, media_public_read,
--     media_admin_{insert,update,delete}, branding_public_read,
--     branding_member_{insert,update,delete}, knowledge_admin_{select,insert,
--     update,delete}. Their USING/WITH CHECK are untouched. Why: an `anon`
--     query on storage.objects evaluates every {public} policy, and the
--     ones calling is_workspace_member / is_admin raise 42501 for anon (0005
--     revoked them) — so today no anon request can read or delete ANY object,
--     including the purge below. Nothing anon does today works through these
--     policies (it errors), and public-bucket URLs are served without RLS, so
--     no anonymous reader loses anything. Keeping media/branding reads TO
--     public would newly let anon LIST workspace-branding/{ws}/… (every
--     workspace id) — the reason they are re-scoped too.
--  7. app_settings.trial_watermark (dormant: enabled=false) and its place on
--     the private list (the five keys of 0139 kept verbatim).
--  8. pg_cron job grovbase-trial-originals-sweep, every 15 minutes, in the
--     defensive block of 0102/0121.
--
-- ZERO BEHAVIOUR CHANGE ON APPLY. The config is seeded disabled, so decide
-- answers `off` for every run; no existing row, price, ledger function or
-- prompt is touched. The two changes to existing objects are the policy
-- re-scope above and the stricter set_asset_derivatives check, which every
-- caller already satisfies (generation.ts, thumbnail/run.ts, the library
-- thumb route all pass thumbPathFor/previewPathFor of the asset's storage_path).
--
-- APPLY BEFORE THE CODE DEPLOY that uses it. Verified on DEV (rolled back):
-- the migration role can CREATE and ALTER POLICY on storage.objects, and
-- `postgres` has BYPASSRLS (the purge list reads storage.objects as owner).
-- After apply, this read-only probe must return 0 and no error:
--   begin read only; set local role anon;
--   select count(*) from storage.objects where bucket_id = 'trial-originals';
--   rollback;
--
-- ROLLBACK (manual, in this order; nothing else depends on these objects):
--   select cron.unschedule('grovbase-trial-originals-sweep');
--   drop policy trial_originals_member_insert, trial_originals_member_select,
--     trial_originals_member_delete, trial_originals_purge_select,
--     trial_originals_purge_delete on storage.objects;  (one statement each)
--   alter policy <each of the 19 above> on storage.objects to public;
--   (restore set_asset_derivatives from 0083 verbatim)
--   (restore app_setting_is_private without 'trial_watermark' — 0139's body)
--   drop trigger activity_logs_watermark_guard on public.activity_logs;
--   drop index public.activity_logs_watermark_dedupe_uq;
--   drop trigger trial_originals_asset_deleted on public.generation_assets;
--   drop every function this file creates (list in section headers below);
--   drop table public.trial_originals_purge_heartbeat, public.trial_original_keys,
--     public.trial_originals;
--   delete from public.app_settings where key = 'trial_watermark';
--   The bucket `trial-originals` is emptied through the Storage API first,
--   then removed from the dashboard. Marked library files stay as they are.

set local lock_timeout = '3s';

-- 1 ─────────────────────────────────────────────────────────────────────────
-- One row per clean original. No FK on asset_id (the delete trigger below
-- must still find the row when the asset goes; an ON DELETE SET NULL would
-- fire first and hide it) and none on job_id (job rows are member-updatable).
-- workspace_id is SET NULL, not CASCADE: a deleted workspace's blobs must
-- still be found and purged.
create table if not exists public.trial_originals (
  id uuid primary key,
  workspace_id uuid references public.workspaces(id) on delete set null,
  user_id uuid,
  job_id uuid,
  operation text not null check (operation ~ '^[a-z0-9_.-]{1,64}$'),
  asset_id uuid,
  marked_path text check (marked_path is null or char_length(marked_path) <= 512),
  marked_sha256 text check (marked_sha256 is null or marked_sha256 ~ '^[0-9a-f]{64}$'),
  object_path text not null unique check (char_length(object_path) <= 512),
  status text not null default 'pending'
    check (status in ('pending', 'locked', 'unlocking', 'unlocked', 'expired', 'deleted', 'orphaned')),
  clean_sha256 text not null check (clean_sha256 ~ '^[0-9a-f]{64}$'),
  clean_mime text not null check (clean_mime in ('image/png', 'image/jpeg', 'image/webp')),
  clean_bytes integer not null check (clean_bytes > 0),
  width integer check (width is null or width > 0),
  height integer check (height is null or height > 0),
  -- The mark as drawn (variant, luminance, sizes…). Never a path.
  watermark jsonb not null default '{}'::jsonb check (jsonb_typeof(watermark) = 'object'),
  -- Frozen at reserve from the config of that moment: shortening the
  -- retention later never shortens (or extends) an existing promise.
  retention_days integer not null check (retention_days between 1 and 365),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  unlock_started_at timestamptz,
  lease_until timestamptz,
  target_path text check (target_path is null or char_length(target_path) <= 512),
  unlocked_at timestamptz,
  unlocked_by uuid,
  unlocked_path text,
  expired_at timestamptz,
  deleted_at timestamptz,
  purge_armed_until timestamptz,
  purged_at timestamptz,
  constraint trial_originals_bound check (
    status not in ('locked', 'unlocking', 'unlocked')
    or (asset_id is not null and marked_path is not null and expires_at is not null)),
  constraint trial_originals_leased check (
    status <> 'unlocking' or (lease_until is not null and target_path is not null)),
  constraint trial_originals_unlocked_path check (status <> 'unlocked' or unlocked_path is not null)
);
create unique index if not exists trial_originals_asset_uq
  on public.trial_originals (asset_id) where asset_id is not null;
-- One live original per library path (R20): a reused slot path refuses.
create unique index if not exists trial_originals_marked_live_uq
  on public.trial_originals (marked_path) where status in ('pending', 'locked', 'unlocking');
create index if not exists trial_originals_ws_status_idx on public.trial_originals (workspace_id, status);
create index if not exists trial_originals_due_idx on public.trial_originals (status, expires_at);
create index if not exists trial_originals_lease_idx on public.trial_originals (status, lease_until);
-- The purge backlog, oldest first.
create index if not exists trial_originals_unpurged_idx
  on public.trial_originals (created_at) where purged_at is null;

-- The wrapped key: 60 bytes (iv | tag | AES-GCM(KEK, dek)) → exactly 80
-- base64 characters, and the fingerprint of the KEK that wrapped it. The
-- database never holds a raw key.
create table if not exists public.trial_original_keys (
  original_id uuid primary key references public.trial_originals(id) on delete cascade,
  wrapped_key text not null check (char_length(wrapped_key) = 80 and wrapped_key ~ '^[A-Za-z0-9+/]{80}$'),
  kek_fp text not null check (kek_fp ~ '^[0-9a-f]{16}$'),
  created_at timestamptz not null default now()
);

-- The last purge run, for the admin page (R6). One row.
create table if not exists public.trial_originals_purge_heartbeat (
  id boolean primary key default true check (id),
  ran_at timestamptz not null default now(),
  report jsonb not null default '{}'::jsonb check (jsonb_typeof(report) = 'object')
);

alter table public.trial_originals enable row level security;
alter table public.trial_original_keys enable row level security;
alter table public.trial_originals_purge_heartbeat enable row level security;
-- No policies: every read and write goes through the functions below.
revoke all on table public.trial_originals from public, anon, authenticated;
revoke all on table public.trial_original_keys from public, anon, authenticated;
revoke all on table public.trial_originals_purge_heartbeat from public, anon, authenticated;

comment on table public.trial_originals is
  'Clean originals of trial (watermarked) images: state, retention frozen per row, unlock lease. No client access; see 0143.';
comment on table public.trial_original_keys is
  'Wrapped per-original keys (base64, KEK outside the database). Deleting a row makes its original unrecoverable. No client access.';

-- 2 ─────────────────────────────────────────────────────────────────────────
-- Internal helpers. None is granted to a client role; the definer functions
-- below reach them as the owner.

-- A JSON number inside [min, max] (and whole, when asked) — otherwise the
-- default. plpgsql on purpose: a SQL CASE may fold a cast at plan time.
create or replace function public.trial_wm_number(
  p_value jsonb, p_min numeric, p_max numeric, p_default numeric, p_integer boolean default false
) returns numeric
language plpgsql immutable set search_path = public as $$
declare
  v numeric;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'number' then return p_default; end if;
  v := (p_value #>> '{}')::numeric;
  if v < p_min or v > p_max then return p_default; end if;
  if p_integer and v <> trunc(v) then return p_default; end if;
  return v;
end $$;

/*
  THE configuration, as every function and the server see it. The same rules
  as parseTrialWatermarkConfig (lib/trial-watermark/config.ts): a missing,
  mistyped or out-of-range field falls back to ITS default alone, `enabled`
  is true only when the row literally says true, `exempt_staff` is false only
  when it literally says false. It never raises — a garbage row is a dormant
  feature, not a broken generator. `force_trial_user_ids` keeps valid uuids only.
*/
create or replace function public.trial_watermark_config_effective()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  r jsonb;
  v_color text;
  v_force jsonb;
begin
  select s.value into r from public.app_settings s where s.key = 'trial_watermark';
  if r is null or jsonb_typeof(r) <> 'object' then r := '{}'::jsonb; end if;
  v_color := case when jsonb_typeof(r->'dark_color') = 'string' then r->>'dark_color' end;
  if v_color is null or v_color !~* '^#[0-9a-f]{6}$' then v_color := '#111111'; end if;
  select coalesce(jsonb_agg(distinct lower(e #>> '{}')), '[]'::jsonb) into v_force
    from jsonb_array_elements(case when jsonb_typeof(r->'force_trial_user_ids') = 'array'
                                   then r->'force_trial_user_ids' else '[]'::jsonb end) e
   where jsonb_typeof(e) = 'string'
     and (e #>> '{}') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  return jsonb_build_object(
    'v', 1,
    'enabled', coalesce(r->'enabled' = 'true'::jsonb, false),
    'width_ratio', public.trial_wm_number(r->'width_ratio', 0.1, 0.9, 0.5),
    'opacity', public.trial_wm_number(r->'opacity', 0.05, 1, 0.38),
    'luminance_threshold', public.trial_wm_number(r->'luminance_threshold', 0, 1, 0.55),
    'dark_color', lower(v_color),
    'glow_radius_ratio', public.trial_wm_number(r->'glow_radius_ratio', 0, 0.1, 0.015),
    'glow_opacity', public.trial_wm_number(r->'glow_opacity', 0, 1, 0.2),
    'original_retention_days', public.trial_wm_number(r->'original_retention_days', 1, 365, 30, true)::integer,
    'signed_url_ttl_seconds', public.trial_wm_number(r->'signed_url_ttl_seconds', 10, 600, 60, true)::integer,
    'exempt_staff', not coalesce(r->'exempt_staff' = 'false'::jsonb, false),
    'force_trial_user_ids', v_force
  );
end $$;

-- D2 (a) — an active paid subscription NOW. The same predicate unlocks (§1.2).
create or replace function public.trial_wm_subscribed(p_workspace_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.subscriptions s
      join public.subscription_plans p on p.id = s.plan_id
     where s.workspace_id = p_workspace_id
       and s.status = 'active' and s.current_period_end > now()
       and p.slug <> 'free' and p.price_cents > 0);
$$;

-- D2 (b) + (c) — money that ever reached this workspace: a settled Stripe
-- payment that granted credits (refunds still count, a dispute does not, a
-- $0 invoice does not), or an admin-recorded paid top-up. Bonus, signup,
-- admin_adjustment and refund credits are free. Never a metadata key.
create or replace function public.trial_wm_paid_credits(p_workspace_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
      select 1 from public.payments pm
       where pm.workspace_id = p_workspace_id
         and pm.provider = 'stripe' and pm.amount_cents > 0 and pm.credits_granted > 0
         and pm.status in ('succeeded', 'paid', 'completed', 'refunded', 'partially_refunded'))
    or exists (
      select 1 from public.credit_transactions ct
        join public.credit_wallets w on w.id = ct.wallet_id
       where w.workspace_id = p_workspace_id
         and ct.type = 'topup' and ct.amount > 0 and ct.created_by is not null);
$$;

-- lib/thumbs.ts `derive`: `<dir>/<n>.<ext>` → `<dir>/<n><suffix>`; a path
-- whose last segment has no dot keeps its whole name.
create or replace function public.asset_derivative_path(p_storage_path text, p_suffix text)
returns text
language sql immutable set search_path = public as $$
  select regexp_replace(p_storage_path, '\.[^./]*$', '') || p_suffix
$$;

/*
  THE ONLY WRITER OF watermark_* EVENTS (R8). The guard trigger on
  activity_logs refuses those names unless this marker is set, and only this
  function sets it — for its own insert, then clears it. A dedupe key makes
  the event once-per-key in its workspace: serialised by an advisory lock,
  backed by the partial unique index. A caller's own "dedupe" key in the
  metadata is dropped, so a duplicate cannot be pre-planted.
*/
create or replace function public.trial_wm_emit(
  p_workspace_id uuid, p_actor_id uuid, p_action text, p_entity_id uuid, p_metadata jsonb, p_dedupe text
) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_meta jsonb := (case when jsonb_typeof(p_metadata) = 'object' then p_metadata else '{}'::jsonb end) - 'dedupe';
begin
  if p_action is null or not (p_action = any (array[
      'watermark_unlock_clicked', 'watermark_paywall_opened', 'watermark_plan_selected',
      'watermark_subscription_confirmed', 'watermark_unlocked', 'watermark_bulk_unlocked',
      'watermark_original_expired'])) then
    raise exception 'invalid_action';
  end if;
  if p_dedupe is not null then
    if char_length(p_dedupe) not between 1 and 200 then raise exception 'invalid_dedupe'; end if;
    v_meta := v_meta || jsonb_build_object('dedupe', p_dedupe);
    perform pg_advisory_xact_lock(hashtextextended(
      'trial_wm|' || coalesce(p_workspace_id::text, '-') || '|' || p_action || '|' || p_dedupe, 0));
    if exists (select 1 from public.activity_logs l
                where l.workspace_id is not distinct from p_workspace_id
                  and l.action = p_action and l.metadata->>'dedupe' = p_dedupe) then
      return false;
    end if;
  end if;
  perform set_config('grovbase.trial_wm_writer', '1', true);
  begin
    insert into public.activity_logs (workspace_id, actor_id, action, entity_type, entity_id, metadata)
    values (p_workspace_id, p_actor_id, p_action, 'trial_watermark', p_entity_id, v_meta);
  exception when unique_violation then
    perform set_config('grovbase.trial_wm_writer', '', true);
    return false;
  end;
  perform set_config('grovbase.trial_wm_writer', '', true);
  return true;
end $$;

/*
  watermark_subscription_confirmed (R8, sweep step 5): a paid subscription,
  active now and created in the last 30 days, whose workspace opened the
  paywall in the 30 days BEFORE it was created. Once per subscription
  (dedupe sub:<id>), carrying the latest such paywall id. NULL = every workspace.
*/
create or replace function public.trial_wm_confirm_subscriptions(p_workspace_id uuid)
returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare
  r record;
  v_paywall text;
  n integer := 0;
begin
  for r in
    select s.id, s.workspace_id, s.created_at, p.slug
      from public.subscriptions s
      join public.subscription_plans p on p.id = s.plan_id
     where (p_workspace_id is null or s.workspace_id = p_workspace_id)
       and s.status = 'active' and s.current_period_end > now()
       and p.slug <> 'free' and p.price_cents > 0
       and s.created_at > now() - interval '30 days'
       and not exists (select 1 from public.activity_logs l
                        where l.workspace_id = s.workspace_id
                          and l.action = 'watermark_subscription_confirmed'
                          and l.metadata->>'dedupe' = 'sub:' || s.id::text)
     order by s.created_at
     limit 500
  loop
    select l.metadata->>'paywall_id' into v_paywall
      from public.activity_logs l
     where l.workspace_id = r.workspace_id and l.action = 'watermark_paywall_opened'
       and l.created_at <= r.created_at and l.created_at >= r.created_at - interval '30 days'
     order by l.created_at desc
     limit 1;
    if found then
      if public.trial_wm_emit(r.workspace_id, null, 'watermark_subscription_confirmed', r.id,
           jsonb_build_object('subscription_id', r.id, 'plan_slug', r.slug, 'paywall_id', v_paywall),
           'sub:' || r.id::text) then
        n := n + 1;
      end if;
    end if;
  end loop;
  return n;
end $$;

revoke all on function public.trial_wm_number(jsonb, numeric, numeric, numeric, boolean) from public, anon, authenticated;
revoke all on function public.trial_watermark_config_effective() from public, anon, authenticated;
revoke all on function public.trial_wm_subscribed(uuid) from public, anon, authenticated;
revoke all on function public.trial_wm_paid_credits(uuid) from public, anon, authenticated;
revoke all on function public.asset_derivative_path(text, text) from public, anon, authenticated;
revoke all on function public.trial_wm_emit(uuid, uuid, text, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.trial_wm_confirm_subscriptions(uuid) from public, anon, authenticated;

-- 3 ─────────────────────────────────────────────────────────────────────────
-- THE DECISION, once per run and before the charge. Never null: off, paid or
-- trial with a reason.
--   off   · disabled  — the config says so (the default)
--         · free_run  — the run charges nothing
--   paid  · subscription / paid_credits — D2
--         · staff     — the acting user AND the workspace owner are admins
--                       and exempt_staff is on (R33)
--   trial · forced    — the caller is in force_trial_user_ids (it disables the
--                       staff exemption only; it never overrides paid)
--         · trial     — everyone else
create or replace function public.trial_watermark_decide(p_token text, p_workspace_id uuid, p_credits integer)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_cfg jsonb;
  v_forced boolean;
  reply jsonb;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if v_uid is null or p_workspace_id is null or not public.is_workspace_member(p_workspace_id) then
    raise exception 'forbidden';
  end if;
  v_cfg := public.trial_watermark_config_effective();
  reply := jsonb_build_object('config', v_cfg);
  -- A FORCED account (the admin's test account) is decided as if the feature
  -- were on, so the whole trial path can be checked on PROD while every
  -- customer stays dormant. It still never overrides a paid workspace.
  v_forced := (v_cfg->'force_trial_user_ids') ? v_uid::text;
  if not (v_cfg->>'enabled')::boolean and not v_forced then
    return reply || jsonb_build_object('mode', 'off', 'reason', 'disabled');
  end if;
  -- NULL is not "free": an unknown price is decided like a paid one.
  if p_credits is not null and p_credits <= 0 then
    return reply || jsonb_build_object('mode', 'off', 'reason', 'free_run');
  end if;
  if public.trial_wm_subscribed(p_workspace_id) then
    return reply || jsonb_build_object('mode', 'paid', 'reason', 'subscription');
  end if;
  if public.trial_wm_paid_credits(p_workspace_id) then
    return reply || jsonb_build_object('mode', 'paid', 'reason', 'paid_credits');
  end if;
  if v_forced then
    return reply || jsonb_build_object('mode', 'trial', 'reason', 'forced');
  end if;
  if (v_cfg->>'exempt_staff')::boolean and public.is_admin(v_uid)
     and exists (select 1 from public.workspaces w where w.id = p_workspace_id and public.is_admin(w.owner_id)) then
    return reply || jsonb_build_object('mode', 'paid', 'reason', 'staff');
  end if;
  return reply || jsonb_build_object('mode', 'trial', 'reason', 'trial');
end $$;

create or replace function public.trial_watermark_config_read(p_token text)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  return public.trial_watermark_config_effective();
end $$;

/*
  WHO MAY UNLOCK, as the database sees it: an active paid subscription now
  (the entitled row is preferred, then the newest — R34). `pending` (R15): not
  entitled, but a checkout is plausibly settling — an `incomplete` row less
  than 2 h old, or a succeeded subscription payment in the last 24 h.
  `has_live_subscription`: any row in active / trialing / past_due (the
  paywall then offers "manage", never a second subscription).
*/
create or replace function public.trial_watermark_entitlement(p_token text, p_workspace_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_ok boolean := false;
  v_slug text;
  v_status text;
  v_provider text;
  v_provider_id text;
  v_pending boolean;
  v_live boolean;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if auth.uid() is null or p_workspace_id is null or not public.is_workspace_member(p_workspace_id) then
    raise exception 'forbidden';
  end if;
  select coalesce(s.status = 'active' and s.current_period_end > now() and p.slug <> 'free' and p.price_cents > 0, false),
         p.slug, s.status, s.provider, s.provider_subscription_id
    into v_ok, v_slug, v_status, v_provider, v_provider_id
    from public.subscriptions s
    join public.subscription_plans p on p.id = s.plan_id
   where s.workspace_id = p_workspace_id
   order by coalesce(s.status = 'active' and s.current_period_end > now() and p.slug <> 'free' and p.price_cents > 0, false) desc,
            s.created_at desc, s.id desc
   limit 1;
  v_ok := coalesce(v_ok, false);
  v_live := exists (select 1 from public.subscriptions s
                     where s.workspace_id = p_workspace_id and s.status in ('active', 'trialing', 'past_due'));
  v_pending := not v_ok and (
       exists (select 1 from public.subscriptions s
                where s.workspace_id = p_workspace_id and s.status = 'incomplete'
                  and s.created_at > now() - interval '2 hours')
    or exists (select 1 from public.payments pm
                where pm.workspace_id = p_workspace_id and pm.kind = 'subscription'
                  and pm.status = 'succeeded' and pm.created_at > now() - interval '24 hours'));
  return jsonb_build_object(
    'entitled', v_ok, 'pending', v_pending, 'has_live_subscription', v_live,
    'plan_slug', v_slug, 'status', v_status, 'provider', v_provider,
    'provider_subscription_id', v_provider_id);
end $$;

revoke all on function public.trial_watermark_decide(text, uuid, integer) from public, anon, authenticated;
revoke all on function public.trial_watermark_config_read(text) from public, anon, authenticated;
revoke all on function public.trial_watermark_entitlement(text, uuid) from public, anon, authenticated;
grant execute on function public.trial_watermark_decide(text, uuid, integer) to authenticated;
grant execute on function public.trial_watermark_config_read(text) to authenticated;
grant execute on function public.trial_watermark_entitlement(text, uuid) to authenticated;

-- 4 ─────────────────────────────────────────────────────────────────────────
/*
  RESERVE a clean original: a `pending` row and its wrapped key, BEFORE the
  marked file is stored. The id is the server's (`p_id`): the key wrap and
  the blob's own authentication are bound to it already. The object path is
  the database's: `{workspace}/{id}.bin`. The retention is frozen here.
  Every field is checked; a refusal raises, and the producer then does not
  deliver the image.
*/
create or replace function public.trial_original_reserve(
  p_token text, p_id uuid, p_workspace_id uuid, p_job_id uuid, p_operation text,
  p_marked_path text, p_wrapped_key text, p_kek_fp text,
  p_clean_sha256 text, p_clean_mime text, p_clean_bytes integer,
  p_width integer, p_height integer, p_watermark jsonb
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_path text;
  v_days integer;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if v_uid is null or p_workspace_id is null or not public.is_workspace_member(p_workspace_id) then
    raise exception 'forbidden';
  end if;
  if p_id is null then raise exception 'invalid_id'; end if;
  if p_operation is null or p_operation !~ '^[a-z0-9_.-]{1,64}$' then raise exception 'invalid_operation'; end if;
  if p_marked_path is not null and (
       p_marked_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9_.-]+$'
       or char_length(p_marked_path) > 512
       or split_part(p_marked_path, '/', 1) <> p_workspace_id::text) then
    raise exception 'invalid_marked_path';
  end if;
  if p_wrapped_key is null or char_length(p_wrapped_key) <> 80 or p_wrapped_key !~ '^[A-Za-z0-9+/]{80}$' then
    raise exception 'invalid_wrapped_key';
  end if;
  if p_kek_fp is null or p_kek_fp !~ '^[0-9a-f]{16}$' then raise exception 'invalid_kek_fp'; end if;
  if p_clean_sha256 is null or p_clean_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'invalid_sha256'; end if;
  if p_clean_mime is null or p_clean_mime not in ('image/png', 'image/jpeg', 'image/webp') then
    raise exception 'invalid_mime';
  end if;
  if p_clean_bytes is null or p_clean_bytes not between 1 and 52428800 then raise exception 'invalid_size'; end if;
  if (p_width is not null and p_width not between 1 and 100000)
     or (p_height is not null and p_height not between 1 and 100000) then
    raise exception 'invalid_dimensions';
  end if;
  if p_watermark is not null and (jsonb_typeof(p_watermark) <> 'object' or octet_length(p_watermark::text) > 4096) then
    raise exception 'invalid_watermark';
  end if;
  if p_job_id is not null and not exists (
       select 1 from public.generation_jobs j where j.id = p_job_id and j.workspace_id = p_workspace_id) then
    raise exception 'invalid_job';
  end if;

  v_path := p_workspace_id::text || '/' || p_id::text || '.bin';
  v_days := (public.trial_watermark_config_effective()->>'original_retention_days')::integer;
  begin
    insert into public.trial_originals (
      id, workspace_id, user_id, job_id, operation, marked_path, object_path, status,
      clean_sha256, clean_mime, clean_bytes, width, height, watermark, retention_days)
    values (
      p_id, p_workspace_id, v_uid, p_job_id, p_operation, p_marked_path, v_path, 'pending',
      p_clean_sha256, p_clean_mime, p_clean_bytes, p_width, p_height, coalesce(p_watermark, '{}'::jsonb), v_days);
    insert into public.trial_original_keys (original_id, wrapped_key, kek_fp)
    values (p_id, p_wrapped_key, p_kek_fp);
  exception when unique_violation then
    raise exception 'reserve_conflict';
  end;
  return jsonb_build_object('id', p_id, 'object_path', v_path, 'retention_days', v_days);
end $$;

/*
  ATTACH: pending → locked, bound to the library asset showing the marked
  file. The asset must be in the original's workspace (through its
  generation), of its job when it has one, at exactly that path. The
  retention starts at the reserve: expires_at = created_at + retention_days.
  Idempotent: the same asset again is ok.
*/
create or replace function public.trial_original_attach(
  p_token text, p_original_id uuid, p_asset_id uuid, p_marked_path text, p_marked_sha256 text
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  o public.trial_originals;
  v_expires timestamptz;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  select * into o from public.trial_originals where id = p_original_id for update;
  if o.id is null or o.workspace_id is null or not public.is_workspace_member(o.workspace_id) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if o.status = 'locked' and o.asset_id = p_asset_id and o.marked_path = p_marked_path then
    return jsonb_build_object('ok', true, 'expires_at', o.expires_at, 'already', true);
  end if;
  if o.status <> 'pending' then return jsonb_build_object('ok', false, 'error', 'not_pending'); end if;
  if p_marked_sha256 is null or p_marked_sha256 !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_sha256');
  end if;
  if p_marked_path is null or p_marked_path !~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[A-Za-z0-9_.-]+$'
     or split_part(p_marked_path, '/', 1) <> o.workspace_id::text
     or (o.marked_path is not null and o.marked_path <> p_marked_path) then
    return jsonb_build_object('ok', false, 'error', 'path_mismatch');
  end if;
  if not exists (
       select 1 from public.generation_assets a
         join public.generations g on g.id = a.generation_id
        where a.id = p_asset_id and g.workspace_id = o.workspace_id
          and a.storage_path = p_marked_path
          and (o.job_id is null or g.job_id = o.job_id)) then
    return jsonb_build_object('ok', false, 'error', 'asset_mismatch');
  end if;
  if exists (select 1 from public.trial_originals x where x.asset_id = p_asset_id and x.id <> o.id) then
    return jsonb_build_object('ok', false, 'error', 'asset_taken');
  end if;
  v_expires := o.created_at + make_interval(days => o.retention_days);
  begin
    update public.trial_originals
       set status = 'locked', asset_id = p_asset_id, marked_path = p_marked_path,
           marked_sha256 = p_marked_sha256, expires_at = v_expires
     where id = o.id;
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'path_taken');
  end;
  return jsonb_build_object('ok', true, 'expires_at', v_expires);
end $$;

-- RELEASE a stash whose image was not delivered: pending → orphaned, key
-- destroyed at once. The object path comes back so the caller can remove the
-- blob; it does NOT come back for a row in any other state.
create or replace function public.trial_original_release(p_token text, p_original_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  o public.trial_originals;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  select * into o from public.trial_originals where id = p_original_id for update;
  if o.id is null or o.workspace_id is null or not public.is_workspace_member(o.workspace_id) then
    return jsonb_build_object('object_path', null, 'state', 'not_found');
  end if;
  if o.status = 'pending' then
    update public.trial_originals set status = 'orphaned' where id = o.id;
    delete from public.trial_original_keys where original_id = o.id;
    return jsonb_build_object('object_path', o.object_path, 'state', 'orphaned');
  end if;
  if o.status = 'orphaned' then
    return jsonb_build_object('object_path', o.object_path, 'state', 'orphaned');
  end if;
  return jsonb_build_object('object_path', null, 'state', o.status);
end $$;

revoke all on function public.trial_original_reserve(text, uuid, uuid, uuid, text, text, text, text, text, text, integer, integer, integer, jsonb) from public, anon, authenticated;
revoke all on function public.trial_original_attach(text, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.trial_original_release(text, uuid) from public, anon, authenticated;
grant execute on function public.trial_original_reserve(text, uuid, uuid, uuid, text, text, text, text, text, text, integer, integer, integer, jsonb) to authenticated;
grant execute on function public.trial_original_attach(text, uuid, uuid, text, text) to authenticated;
grant execute on function public.trial_original_release(text, uuid) to authenticated;

-- 5 ─────────────────────────────────────────────────────────────────────────
/*
  STATES for the gallery and the library: one row per asked asset (at most
  200) that is a trial image of a workspace the caller belongs to.
    locked       the clean original can be unlocked until expires_at
                 (an `unlocking` row is still locked to its owner)
    unlocked     an ordinary clean library file now
    expired      expires_at <= now() — exact, whether or not the sweep ran
    unavailable  marked, but no original can be offered (deleted / orphaned;
                 found through the asset's path when the row was never bound)
  `pending` rows are left out. days_left = ceil(seconds / 86400), never < 0.
*/
create or replace function public.trial_original_states(p_asset_ids uuid[])
returns jsonb
language sql stable security definer set search_path = public as $$
  with ids as (
    select distinct u.id
      from (select x.id from unnest(coalesce(p_asset_ids, '{}'::uuid[])) with ordinality as x(id, n)
             where x.id is not null order by x.n limit 200) u
  ),
  assets as (
    select a.id, a.storage_path, g.workspace_id
      from ids
      join public.generation_assets a on a.id = ids.id
      join public.generations g on g.id = a.generation_id
     where public.is_workspace_member(g.workspace_id)
  ),
  picked as (
    select distinct on (a.id) a.id as asset_id, o.status, o.expires_at, o.lease_until
      from assets a
      join public.trial_originals o
        on o.workspace_id = a.workspace_id
       and (o.asset_id = a.id or (o.asset_id is null and o.marked_path = a.storage_path))
     where o.status <> 'pending'
     order by a.id, (o.asset_id is not distinct from a.id) desc, o.created_at desc
  ),
  judged as (
    select p.*, case
             when p.status = 'unlocked' then 'unlocked'
             when p.status in ('locked', 'unlocking')
                  and (p.expires_at > now() or (p.status = 'unlocking' and p.lease_until > now())) then 'locked'
             when p.status in ('locked', 'unlocking', 'expired') then 'expired'
             else 'unavailable' end as state
      from picked p
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'asset_id', j.asset_id,
           'state', j.state,
           'expires_at', case when j.state = 'locked' then j.expires_at end,
           'days_left', case when j.state = 'locked'
                             then greatest(0, ceil(extract(epoch from (j.expires_at - now())) / 86400))::integer end)
         order by j.asset_id), '[]'::jsonb)
    from judged j;
$$;

-- The library's bulk button: how many of this workspace's originals are
-- still unlockable, and the nearest expiry.
create or replace function public.trial_original_summary(p_workspace_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_n integer;
  v_next timestamptz;
begin
  if p_workspace_id is null or not public.is_workspace_member(p_workspace_id) then raise exception 'forbidden'; end if;
  select count(*), min(o.expires_at) into v_n, v_next
    from public.trial_originals o
   where o.workspace_id = p_workspace_id and o.status in ('locked', 'unlocking') and o.expires_at > now();
  return jsonb_build_object('locked', v_n, 'nearest_expires_at', v_next);
end $$;

revoke all on function public.trial_original_states(uuid[]) from public, anon, authenticated;
revoke all on function public.trial_original_summary(uuid) from public, anon, authenticated;
grant execute on function public.trial_original_states(uuid[]) to authenticated;
grant execute on function public.trial_original_summary(uuid) to authenticated;

-- 6 ─────────────────────────────────────────────────────────────────────────
/*
  UNLOCK, PHASE 1 (R3). Judged ONCE, under the row lock: the caller's
  membership of the ORIGINAL's workspace, the database's entitlement for that
  workspace AND the caller's live Stripe verdict (p_live_ok), expiry. A
  locked row becomes `unlocking` with a 10-minute lease and a target path the
  database derives — `{ws}/{job or id}/u-{id}.{ext}` — which the server
  uploads the clean file to. A second begin inside the lease resumes the SAME
  target (re-checking entitlement, not expiry: the first begin judged it).
  The key leaves the database only in a `ready` answer.
*/
create or replace function public.trial_original_unlock_begin(p_token text, p_asset_id uuid, p_live_ok boolean)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  o public.trial_originals;
  k public.trial_original_keys;
  v_asset_path text;
  v_target text;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if v_uid is null or p_asset_id is null then return jsonb_build_object('state', 'not_found'); end if;
  begin
    select * into o from public.trial_originals where asset_id = p_asset_id for update nowait;
  exception when lock_not_available then
    return jsonb_build_object('state', 'busy');
  end;
  if o.id is null then
    -- A marked asset whose original was never bound is "unavailable" to its
    -- member; anything else is not ours to talk about.
    if exists (select 1 from public.generation_assets a
                 join public.generations g on g.id = a.generation_id
                 join public.trial_originals x on x.workspace_id = g.workspace_id
                  and x.asset_id is null and x.marked_path = a.storage_path
                  and x.status in ('orphaned', 'deleted', 'expired')
                where a.id = p_asset_id and public.is_workspace_member(g.workspace_id)) then
      return jsonb_build_object('state', 'unavailable');
    end if;
    return jsonb_build_object('state', 'not_found');
  end if;
  if o.workspace_id is null or not public.is_workspace_member(o.workspace_id) then
    return jsonb_build_object('state', 'not_found');
  end if;
  select a.storage_path into v_asset_path
    from public.generation_assets a
    join public.generations g on g.id = a.generation_id
   where a.id = p_asset_id and g.workspace_id = o.workspace_id;

  if o.status = 'unlocked' then
    return jsonb_build_object('state', 'unlocked', 'storage_path', coalesce(v_asset_path, o.unlocked_path));
  end if;
  if o.status in ('deleted', 'orphaned', 'pending') or v_asset_path is null then
    return jsonb_build_object('state', 'unavailable');
  end if;
  if o.status = 'expired' then return jsonb_build_object('state', 'expired'); end if;

  -- locked, or unlocking
  if v_asset_path is distinct from o.marked_path then return jsonb_build_object('state', 'unavailable'); end if;
  if not (o.status = 'unlocking' and o.lease_until > now()) and o.expires_at <= now() then
    return jsonb_build_object('state', 'expired');
  end if;
  if not coalesce(p_live_ok, false) or not public.trial_wm_subscribed(o.workspace_id) then
    return jsonb_build_object('state', 'not_entitled');
  end if;
  select * into k from public.trial_original_keys where original_id = o.id;
  if k.original_id is null then return jsonb_build_object('state', 'unavailable'); end if;

  if o.status = 'unlocking' and o.lease_until > now() then
    v_target := o.target_path;
  else
    v_target := o.workspace_id::text || '/' || coalesce(o.job_id, o.id)::text || '/u-' || o.id::text || '.'
                || case o.clean_mime when 'image/png' then 'png' when 'image/jpeg' then 'jpg' else 'webp' end;
    update public.trial_originals
       set status = 'unlocking', unlock_started_at = now(),
           lease_until = now() + interval '10 minutes', target_path = v_target
     where id = o.id;
  end if;

  -- The funnel's "confirmed" for this workspace now rather than at the next
  -- sweep. Never in the way of the unlock.
  begin
    perform public.trial_wm_confirm_subscriptions(o.workspace_id);
  exception when others then null;
  end;

  return jsonb_build_object(
    'state', 'ready', 'original_id', o.id, 'workspace_id', o.workspace_id, 'job_id', o.job_id,
    'object_path', o.object_path, 'wrapped_key', k.wrapped_key, 'kek_fp', k.kek_fp,
    'clean_sha256', o.clean_sha256, 'clean_mime', o.clean_mime, 'target_path', v_target);
end $$;

/*
  UNLOCK, PHASE 2 (R3/R12/R13): commits an `unlocking` row INSIDE its lease
  (entitlement and expiry are not judged again). In one transaction:
    · the asset points at the clean target; its derivatives are the ones
      passed (each null or exactly the target's `_t`/`_p`) — a null REMOVES
      the key, so the library rebuilds it from the clean file;
    · Miniaturka step outputs, run outputs and the run's delivered mark that
      named the marked file now name the target (R13);
    · the row is unlocked, its key destroyed, `watermark_unlocked` written.
  The old marked file and its derivatives come back in old_paths for the
  caller to remove, with the blob's path. Idempotent: an unlocked row answers
  `already` with the same lists.
*/
create or replace function public.trial_original_unlock_finish(
  p_token text, p_asset_id uuid, p_thumb_path text, p_preview_path text, p_via text, p_bulk_id uuid
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  o public.trial_originals;
  v_asset_path text;
  v_target text;
  v_old jsonb;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if p_via is null or p_via not in ('single', 'bulk') then raise exception 'invalid_via'; end if;
  if v_uid is null or p_asset_id is null then return jsonb_build_object('state', 'not_found'); end if;
  select * into o from public.trial_originals where asset_id = p_asset_id for update;
  if o.id is null or o.workspace_id is null or not public.is_workspace_member(o.workspace_id) then
    return jsonb_build_object('state', 'not_found');
  end if;
  select a.storage_path into v_asset_path
    from public.generation_assets a
    join public.generations g on g.id = a.generation_id
   where a.id = p_asset_id and g.workspace_id = o.workspace_id
     for update of a;
  v_old := jsonb_build_array(o.marked_path,
                             public.asset_derivative_path(o.marked_path, '_t.webp'),
                             public.asset_derivative_path(o.marked_path, '_p.webp'));

  if o.status = 'unlocked' then
    return jsonb_build_object('state', 'unlocked', 'already', true,
      'storage_path', coalesce(v_asset_path, o.unlocked_path), 'old_paths', v_old, 'object_path', o.object_path);
  end if;
  if o.status = 'deleted' or v_asset_path is null then return jsonb_build_object('state', 'deleted'); end if;
  if o.status = 'pending' then return jsonb_build_object('state', 'not_found'); end if;
  if o.status <> 'unlocking' or o.lease_until is null or o.lease_until <= now()
     or v_asset_path is distinct from o.marked_path then
    return jsonb_build_object('state', 'lease_lost');
  end if;

  v_target := o.target_path;
  if p_thumb_path is not null and p_thumb_path <> public.asset_derivative_path(v_target, '_t.webp') then
    raise exception 'invalid_thumb_path';
  end if;
  if p_preview_path is not null and p_preview_path <> public.asset_derivative_path(v_target, '_p.webp') then
    raise exception 'invalid_preview_path';
  end if;

  update public.generation_assets
     set storage_path = v_target,
         metadata = (coalesce(metadata, '{}'::jsonb) - 'thumb' - 'preview')
                    || jsonb_strip_nulls(jsonb_build_object('thumb', p_thumb_path, 'preview', p_preview_path))
   where id = p_asset_id;

  -- R13 — Miniaturka reads its Retusz inputs and its result from these.
  update public.ai_engine_step_runs s
     set output = jsonb_set(s.output, '{path}', to_jsonb(v_target))
    from public.ai_engine_runs r
   where r.id = s.run_id and r.workspace_id = o.workspace_id
     and jsonb_typeof(s.output) = 'object' and s.output->>'path' = o.marked_path;
  update public.ai_engine_runs r
     set outputs = (select jsonb_agg(case when jsonb_typeof(e.v) = 'object' and e.v->>'path' = o.marked_path
                                          then jsonb_set(e.v, '{path}', to_jsonb(v_target)) else e.v end
                                     order by e.n)
                      from jsonb_array_elements(r.outputs) with ordinality as e(v, n))
   where r.workspace_id = o.workspace_id
     and exists (select 1 from jsonb_array_elements(r.outputs) x(v)
                  where jsonb_typeof(x.v) = 'object' and x.v->>'path' = o.marked_path);
  update public.ai_engine_runs r
     set progress = jsonb_set(r.progress, '{delivered,path}', to_jsonb(v_target))
   where r.workspace_id = o.workspace_id
     and jsonb_typeof(r.progress->'delivered') = 'object'
     and r.progress->'delivered'->>'path' = o.marked_path;

  update public.trial_originals
     set status = 'unlocked', unlocked_at = now(), unlocked_by = v_uid, unlocked_path = v_target, lease_until = null
   where id = o.id;
  delete from public.trial_original_keys where original_id = o.id;

  perform public.trial_wm_emit(o.workspace_id, v_uid, 'watermark_unlocked', p_asset_id,
    jsonb_build_object('asset_id', p_asset_id, 'original_id', o.id, 'via', p_via, 'bulk_id', p_bulk_id,
                       'tool', o.operation, 'age_days', floor(extract(epoch from (now() - o.created_at)) / 86400)::integer),
    'unlocked:' || o.id::text);

  return jsonb_build_object('state', 'unlocked', 'already', false, 'storage_path', v_target,
    'old_paths', v_old, 'object_path', o.object_path);
end $$;

/*
  UNLOCK, ABORTED: unlocking → locked (the target was not committed). The
  target path comes back for the caller to remove — for ANY row that is not
  unlocked (a stale lease's leftover too). For an unlocked row it is null:
  that path is the customer's file now, and a caller must take the path to
  remove from THIS answer, never from its own begin.
*/
create or replace function public.trial_original_unlock_abort(p_token text, p_asset_id uuid)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  o public.trial_originals;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  select * into o from public.trial_originals where asset_id = p_asset_id for update;
  if o.id is null or o.workspace_id is null or not public.is_workspace_member(o.workspace_id) then
    return jsonb_build_object('target_path', null, 'state', 'not_found');
  end if;
  if o.status = 'unlocked' then return jsonb_build_object('target_path', null, 'state', 'unlocked'); end if;
  if o.status = 'unlocking' then
    update public.trial_originals set status = 'locked', lease_until = null where id = o.id;
    return jsonb_build_object('target_path', o.target_path, 'state', 'locked');
  end if;
  return jsonb_build_object('target_path', o.target_path, 'state', o.status);
end $$;

-- The bulk unlock's next batch: unlockable assets of the workspace (a stale
-- lease counts), oldest first, not in skip, at most 10. `remaining` = how many
-- are left AFTER this batch.
create or replace function public.trial_original_next_batch(
  p_token text, p_workspace_id uuid, p_limit integer, p_skip uuid[]
) returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 4), 1), 10);
  v_ids jsonb;
  v_total integer;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if auth.uid() is null or p_workspace_id is null or not public.is_workspace_member(p_workspace_id) then
    raise exception 'forbidden';
  end if;
  with elig as (
    select o.asset_id, o.created_at, o.id
      from public.trial_originals o
     where o.workspace_id = p_workspace_id and o.asset_id is not null and o.expires_at > now()
       and (o.status = 'locked' or (o.status = 'unlocking' and o.lease_until <= now()))
       and not (o.asset_id = any (coalesce(p_skip, '{}'::uuid[])))
  ),
  batch as (select e.asset_id, e.created_at, e.id from elig e order by e.created_at, e.id limit v_limit)
  select (select coalesce(jsonb_agg(b.asset_id order by b.created_at, b.id), '[]'::jsonb) from batch b),
         (select count(*) from elig)
    into v_ids, v_total;
  return jsonb_build_object('asset_ids', v_ids, 'remaining', v_total - jsonb_array_length(v_ids));
end $$;

revoke all on function public.trial_original_unlock_begin(text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.trial_original_unlock_finish(text, uuid, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.trial_original_unlock_abort(text, uuid) from public, anon, authenticated;
revoke all on function public.trial_original_next_batch(text, uuid, integer, uuid[]) from public, anon, authenticated;
grant execute on function public.trial_original_unlock_begin(text, uuid, boolean) to authenticated;
grant execute on function public.trial_original_unlock_finish(text, uuid, text, text, text, uuid) to authenticated;
grant execute on function public.trial_original_unlock_abort(text, uuid) to authenticated;
grant execute on function public.trial_original_next_batch(text, uuid, integer, uuid[]) to authenticated;

-- 7 ─────────────────────────────────────────────────────────────────────────
/*
  MINIATURKA'S SOURCE (R14): was this library path of the caller's OWN
  workspace a trial image? NULL = never (definitive). Otherwise the row; the
  wrapped key only while the original can still be opened (pending, locked
  and unexpired, or inside a live unlock lease). A locked row past its expiry
  reads `expired` here exactly as everywhere else.
*/
create or replace function public.trial_original_source(p_token text, p_workspace_id uuid, p_marked_path text)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  o public.trial_originals;
  k public.trial_original_keys;
  v_status text;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if auth.uid() is null or p_workspace_id is null or not public.is_workspace_member(p_workspace_id) then
    raise exception 'forbidden';
  end if;
  if p_marked_path is null or split_part(p_marked_path, '/', 1) <> p_workspace_id::text then return null; end if;
  select * into o from public.trial_originals x
   where x.workspace_id = p_workspace_id and x.marked_path = p_marked_path
     and split_part(x.marked_path, '/', 1) = p_workspace_id::text
   order by (x.status in ('pending', 'locked', 'unlocking')) desc, (x.status = 'unlocked') desc, x.created_at desc
   limit 1;
  if o.id is null then return null; end if;
  v_status := case
    when o.status = 'locked' and o.expires_at <= now() then 'expired'
    when o.status = 'unlocking' and o.lease_until <= now() and o.expires_at <= now() then 'expired'
    else o.status end;
  if v_status in ('pending', 'locked', 'unlocking') then
    select * into k from public.trial_original_keys where original_id = o.id;
  end if;
  return jsonb_build_object(
    'status', v_status, 'original_id', o.id, 'object_path', o.object_path,
    'wrapped_key', k.wrapped_key, 'kek_fp', k.kek_fp,
    'clean_sha256', o.clean_sha256, 'clean_mime', o.clean_mime, 'unlocked_path', o.unlocked_path);
end $$;

-- 8 ─────────────────────────────────────────────────────────────────────────
-- The server's door to the 7 events (the actions, the bulk route). The actor
-- is the caller; the workspace must be theirs.
create or replace function public.trial_watermark_log(
  p_token text, p_workspace_id uuid, p_action text, p_entity_id uuid, p_metadata jsonb, p_dedupe text
) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if v_uid is null or p_workspace_id is null or not public.is_workspace_member(p_workspace_id) then
    raise exception 'forbidden';
  end if;
  if p_metadata is not null and (jsonb_typeof(p_metadata) <> 'object' or octet_length(p_metadata::text) > 4096) then
    raise exception 'invalid_metadata';
  end if;
  return public.trial_wm_emit(p_workspace_id, v_uid, p_action, p_entity_id, p_metadata, p_dedupe);
end $$;

revoke all on function public.trial_original_source(text, uuid, text) from public, anon, authenticated;
revoke all on function public.trial_watermark_log(text, uuid, text, uuid, jsonb, text) from public, anon, authenticated;
grant execute on function public.trial_original_source(text, uuid, text) to authenticated;
grant execute on function public.trial_watermark_log(text, uuid, text, uuid, jsonb, text) to authenticated;

-- 9 ─────────────────────────────────────────────────────────────────────────
/*
  THE SWEEP (pg_cron, every 15 minutes; owner only). State, keys and events —
  never files (SQL cannot delete storage objects; the purge does). Five
  steps, each per row in its own exception block, so one bad row is counted
  and skipped rather than stopping the run. Re-running changes nothing new.
    1. heal: a pending row whose marked file reached the library (an asset of
       its OWN job at exactly its path, or Miniaturka's single asset when the
       path was chosen later) becomes locked;
    2. orphan: pending for more than 24 h → orphaned, key destroyed;
    3. stale leases: unlocking past its lease → locked (target kept for cleanup);
    4. expire: locked and expires_at <= now() → expired, key destroyed,
       watermark_original_expired — a row in a live lease is never expired;
    5. watermark_subscription_confirmed for subscriptions that followed a paywall.
*/
create or replace function public.trial_originals_sweep()
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  r record;
  v_asset uuid;
  v_path text;
  n_heal integer := 0;
  n_orphan integer := 0;
  n_lease integer := 0;
  n_expire integer := 0;
  n_confirm integer := 0;
  n_err integer := 0;
begin
  -- 1
  for r in
    select o.id, o.workspace_id, o.job_id, o.marked_path
      from public.trial_originals o
     where o.status = 'pending' and o.asset_id is null and o.job_id is not null and o.workspace_id is not null
     order by o.created_at
     limit 500
       for update skip locked
  loop
    begin
      v_asset := null;
      v_path := null;
      if r.marked_path is not null then
        select a.id, a.storage_path into v_asset, v_path
          from public.generation_assets a
          join public.generations g on g.id = a.generation_id
         where g.job_id = r.job_id and g.workspace_id = r.workspace_id and a.storage_path = r.marked_path
           and not exists (select 1 from public.trial_originals x where x.asset_id = a.id)
         limit 1;
      elsif (select count(*) from public.generation_assets a
               join public.generations g on g.id = a.generation_id
              where g.job_id = r.job_id and g.workspace_id = r.workspace_id) = 1 then
        select a.id, a.storage_path into v_asset, v_path
          from public.generation_assets a
          join public.generations g on g.id = a.generation_id
         where g.job_id = r.job_id and g.workspace_id = r.workspace_id
           and split_part(a.storage_path, '/', 1) = r.workspace_id::text
           and not exists (select 1 from public.trial_originals x where x.asset_id = a.id);
      end if;
      if v_asset is not null then
        update public.trial_originals
           set status = 'locked', asset_id = v_asset, marked_path = v_path,
               expires_at = created_at + make_interval(days => retention_days)
         where id = r.id and status = 'pending';
        n_heal := n_heal + 1;
      end if;
    exception when others then
      n_err := n_err + 1;
    end;
  end loop;

  -- 2
  for r in
    select o.id from public.trial_originals o
     where o.status = 'pending' and o.created_at < now() - interval '24 hours'
     order by o.created_at
     limit 500
       for update skip locked
  loop
    begin
      update public.trial_originals set status = 'orphaned' where id = r.id;
      delete from public.trial_original_keys where original_id = r.id;
      n_orphan := n_orphan + 1;
    exception when others then
      n_err := n_err + 1;
    end;
  end loop;

  -- 3
  for r in
    select o.id from public.trial_originals o
     where o.status = 'unlocking' and o.lease_until <= now()
     order by o.lease_until
     limit 500
       for update skip locked
  loop
    begin
      update public.trial_originals set status = 'locked', lease_until = null where id = r.id;
      n_lease := n_lease + 1;
    exception when others then
      n_err := n_err + 1;
    end;
  end loop;

  -- 4
  for r in
    select o.id, o.workspace_id, o.asset_id, o.operation
      from public.trial_originals o
     where o.status = 'locked' and o.expires_at <= now()
     order by o.expires_at
     limit 500
       for update skip locked
  loop
    begin
      update public.trial_originals set status = 'expired', expired_at = now() where id = r.id;
      delete from public.trial_original_keys where original_id = r.id;
      if r.workspace_id is not null then
        perform public.trial_wm_emit(r.workspace_id, null, 'watermark_original_expired', r.asset_id,
          jsonb_build_object('asset_id', r.asset_id, 'original_id', r.id, 'tool', r.operation),
          'expired:' || r.id::text);
      end if;
      n_expire := n_expire + 1;
    exception when others then
      n_err := n_err + 1;
    end;
  end loop;

  -- 5
  begin
    n_confirm := public.trial_wm_confirm_subscriptions(null);
  exception when others then
    n_err := n_err + 1;
  end;

  return jsonb_build_object('healed', n_heal, 'orphaned', n_orphan, 'leases_returned', n_lease,
    'expired', n_expire, 'confirmed', n_confirm, 'errors', n_err, 'ran_at', now());
end $$;

-- The HTTP belt (the daily cron route runs it before the purge).
create or replace function public.trial_originals_sweep_now(p_token text)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  return public.trial_originals_sweep();
end $$;

revoke all on function public.trial_originals_sweep() from public, anon, authenticated;
revoke all on function public.trial_originals_sweep_now(text) from public, anon, authenticated;
-- anon: the cron's session-less client. `server_call_ok(p_token)` inside is
-- the gate (the 0102 shape).
grant execute on function public.trial_originals_sweep_now(text) to anon, authenticated;

-- 10 ────────────────────────────────────────────────────────────────────────
-- What the storage policies of `trial-originals` ask. Definer: the policy's
-- role cannot read trial_originals itself.

-- A member may UPLOAD a blob only where a pending row of their workspace
-- expects one.
create or replace function public.trial_original_uploadable(p_name text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.trial_originals o
     where o.object_path = p_name and o.status = 'pending'
       and o.workspace_id is not null
       and split_part(p_name, '/', 1) = o.workspace_id::text
       and public.is_workspace_member(o.workspace_id));
$$;

-- A member may DELETE a blob whose key is gone (useless ciphertext).
create or replace function public.trial_original_purgeable_member(p_name text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.trial_originals o
     where o.object_path = p_name
       and o.status in ('unlocked', 'expired', 'deleted', 'orphaned')
       and not exists (select 1 from public.trial_original_keys k where k.original_id = o.id)
       and o.workspace_id is not null
       and public.is_workspace_member(o.workspace_id));
$$;

-- ANON may read and delete a blob only while the purge has it armed (R1):
-- key destroyed AND listed by purge_list in the last 10 minutes. Nothing
-- else is visible to anon, so no workspace id can be listed.
create or replace function public.trial_original_purgeable(p_name text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.trial_originals o
     where o.object_path = p_name
       and o.status in ('unlocked', 'expired', 'deleted', 'orphaned')
       and o.purge_armed_until > now()
       and not exists (select 1 from public.trial_original_keys k where k.original_id = o.id));
$$;

/*
  THE PURGE LIST (R6). First every key-destroyed row whose blob is already
  gone (removed by the unlock or the release, or never written) is marked
  purged — so those rows can never jam the queue — then the oldest of the
  rest are armed for 10 minutes and their paths returned. The caller removes
  them with the Storage API as anon and reports back what storage confirmed.
*/
create or replace function public.trial_originals_purge_list(p_token text, p_limit integer)
returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_paths jsonb;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  update public.trial_originals o
     set purged_at = now()
   where o.id in (
     select x.id from public.trial_originals x
      where x.purged_at is null and x.status in ('unlocked', 'expired', 'deleted', 'orphaned')
        and not exists (select 1 from public.trial_original_keys k where k.original_id = x.id)
        and not exists (select 1 from storage.objects so
                         where so.bucket_id = 'trial-originals' and so.name = x.object_path)
      order by x.created_at
      limit 1000);
  with c as (
    select x.id from public.trial_originals x
     where x.purged_at is null and x.status in ('unlocked', 'expired', 'deleted', 'orphaned')
       and not exists (select 1 from public.trial_original_keys k where k.original_id = x.id)
     order by x.created_at
     limit v_limit
       for update skip locked
  ),
  armed as (
    update public.trial_originals o
       set purge_armed_until = now() + interval '10 minutes'
      from c
     where o.id = c.id
    returning o.object_path, o.created_at
  )
  select coalesce(jsonb_agg(a.object_path order by a.created_at), '[]'::jsonb) into v_paths from armed a;
  return v_paths;
end $$;

-- What storage confirmed removed. A row is marked only when its key is gone
-- and its object really is no longer there.
create or replace function public.trial_originals_mark_purged(p_token text, p_paths text[])
returns integer
language plpgsql security definer set search_path = public, extensions as $$
declare
  n integer;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if p_paths is null or cardinality(p_paths) = 0 then return 0; end if;
  update public.trial_originals o
     set purged_at = now()
   where o.object_path = any (p_paths[1:1000])
     and o.purged_at is null
     and o.status in ('unlocked', 'expired', 'deleted', 'orphaned')
     and not exists (select 1 from public.trial_original_keys k where k.original_id = o.id)
     and not exists (select 1 from storage.objects so
                      where so.bucket_id = 'trial-originals' and so.name = o.object_path);
  get diagnostics n = row_count;
  return n;
end $$;

create or replace function public.trial_originals_purge_heartbeat(p_token text, p_report jsonb)
returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_report jsonb := case when jsonb_typeof(p_report) = 'object' then p_report else '{}'::jsonb end;
begin
  if not public.server_call_ok(p_token) then raise exception 'forbidden'; end if;
  if octet_length(v_report::text) > 4096 then v_report := jsonb_build_object('truncated', true); end if;
  insert into public.trial_originals_purge_heartbeat (id, ran_at, report)
  values (true, now(), v_report)
  on conflict (id) do update set ran_at = excluded.ran_at, report = excluded.report;
  return true;
end $$;

revoke all on function public.trial_original_uploadable(text) from public, anon, authenticated;
revoke all on function public.trial_original_purgeable_member(text) from public, anon, authenticated;
revoke all on function public.trial_original_purgeable(text) from public, anon, authenticated;
revoke all on function public.trial_originals_purge_list(text, integer) from public, anon, authenticated;
revoke all on function public.trial_originals_mark_purged(text, text[]) from public, anon, authenticated;
revoke all on function public.trial_originals_purge_heartbeat(text, jsonb) from public, anon, authenticated;
grant execute on function public.trial_original_uploadable(text) to authenticated;
grant execute on function public.trial_original_purgeable_member(text) to authenticated;
-- A policy needs EXECUTE for the role it is evaluated as.
grant execute on function public.trial_original_purgeable(text) to anon, authenticated;
grant execute on function public.trial_originals_purge_list(text, integer) to anon, authenticated;
grant execute on function public.trial_originals_mark_purged(text, text[]) to anon, authenticated;
grant execute on function public.trial_originals_purge_heartbeat(text, jsonb) to anon, authenticated;

-- 11 ────────────────────────────────────────────────────────────────────────
/*
  The admin page's numbers. Items (unlocked, expired) come from the
  originals themselves and conversions from subscriptions; the events count
  only intent (R8). The sweep's last pg_cron runs and the purge heartbeat
  show whether retention is really running.
*/
create or replace function public.trial_watermark_stats(p_days integer)
returns jsonb
language plpgsql stable security definer set search_path = public, extensions as $$
declare
  v_days integer := least(greatest(coalesce(p_days, 30), 1), 365);
  v_since timestamptz;
  v_status jsonb;
  v_events jsonb;
  v_items jsonb;
  v_sweep jsonb := null;
  v_purge jsonb;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  v_since := now() - make_interval(days => v_days);

  select coalesce(jsonb_object_agg(s.status, s.n), '{}'::jsonb) into v_status
    from (select o.status, count(*) as n from public.trial_originals o group by o.status) s;

  select coalesce(jsonb_object_agg(e.action, jsonb_build_object(
           'events', e.n, 'workspaces', e.ws, 'paywalls', e.pw)), '{}'::jsonb) into v_events
    from (select l.action, count(*) as n, count(distinct l.workspace_id) as ws,
                 count(distinct l.metadata->>'paywall_id') as pw
            from public.activity_logs l
           where l.action like 'watermark\_%' and l.created_at >= v_since
           group by l.action) e;

  select jsonb_build_object(
      'created', count(*) filter (where o.created_at >= v_since),
      'unlocked', count(*) filter (where o.unlocked_at >= v_since),
      'expired', count(*) filter (where o.expired_at >= v_since),
      'locked_live', count(*) filter (where o.status in ('locked', 'unlocking') and o.expires_at > now()),
      'expiring_24h', count(*) filter (where o.status = 'locked' and o.expires_at > now()
                                         and o.expires_at <= now() + interval '24 hours'),
      'purge_backlog', count(*) filter (where o.purged_at is null
                                          and o.status in ('unlocked', 'expired', 'deleted', 'orphaned')),
      'purged', count(*) filter (where o.purged_at is not null),
      'converted_workspaces', (
        select count(distinct l.workspace_id)
          from public.activity_logs l
         where l.action = 'watermark_paywall_opened' and l.created_at >= v_since
           and exists (select 1 from public.subscriptions s
                         join public.subscription_plans p on p.id = s.plan_id
                        where s.workspace_id = l.workspace_id and s.created_at >= l.created_at
                          and s.status = 'active' and p.slug <> 'free' and p.price_cents > 0)))
    into v_items
    from public.trial_originals o;

  if to_regclass('cron.job_run_details') is not null then
    begin
      execute $q$
        select jsonb_build_object(
                 'last_start', max(d.start_time),
                 'last_success', max(d.start_time) filter (where d.status = 'succeeded'),
                 'last_status', (array_agg(d.status order by d.start_time desc))[1])
          from cron.job j join cron.job_run_details d on d.jobid = j.jobid
         where j.jobname = $1 $q$
        into v_sweep using 'grovbase-trial-originals-sweep';
    exception when others then
      v_sweep := jsonb_build_object('error', 'unreadable');
    end;
  end if;

  select jsonb_build_object('ran_at', h.ran_at, 'report', h.report) into v_purge
    from public.trial_originals_purge_heartbeat h where h.id;

  return jsonb_build_object('days', v_days, 'status', v_status, 'events', v_events, 'items', v_items,
    'sweep', v_sweep, 'purge', v_purge);
end $$;

revoke all on function public.trial_watermark_stats(integer) from public, anon, authenticated;
grant execute on function public.trial_watermark_stats(integer) to authenticated;

-- 12 ────────────────────────────────────────────────────────────────────────
-- An asset deleted (the delete route, delete_generation, a workspace going):
-- its original — or a pending one waiting for that path — is deleted and its
-- key destroyed at once. An unlocked row stays unlocked. Never raises: a
-- delete is never blocked by this.
create or replace function public.trial_originals_asset_deleted()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    with hit as (
      update public.trial_originals o
         set status = 'deleted', deleted_at = now(), lease_until = null
       where o.status in ('pending', 'locked', 'unlocking')
         and (o.asset_id = old.id
              or (o.status = 'pending' and o.asset_id is null and o.marked_path = old.storage_path))
      returning o.id
    )
    delete from public.trial_original_keys k using hit where k.original_id = hit.id;
  exception when others then
    raise warning 'trial_originals_asset_deleted: %', sqlerrm;
  end;
  return old;
end $$;
revoke all on function public.trial_originals_asset_deleted() from public, anon, authenticated;

create or replace trigger trial_originals_asset_deleted
  after delete on public.generation_assets
  for each row execute function public.trial_originals_asset_deleted();

-- R8 — a watermark_* event is the database's own record (an unlock, an
-- expiry, a funnel step written by the server), never a member's. log_activity
-- accepts any action from a member, so the guard sits on the table.
create or replace function public.activity_logs_watermark_guard()
returns trigger
language plpgsql set search_path = public as $$
begin
  if lower(new.action) like 'watermark\_%'
     and coalesce(current_setting('grovbase.trial_wm_writer', true), '') <> '1' then
    raise exception 'watermark_event_forbidden' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.activity_logs_watermark_guard() from public, anon, authenticated;

create or replace trigger activity_logs_watermark_guard
  before insert on public.activity_logs
  for each row execute function public.activity_logs_watermark_guard();

create unique index if not exists activity_logs_watermark_dedupe_uq
  on public.activity_logs (workspace_id, action, (metadata->>'dedupe'))
  where action like 'watermark\_%' and metadata ? 'dedupe';

-- 13 ────────────────────────────────────────────────────────────────────────
-- 0083's body, one rule added (R12): a derivative must be THIS asset's
-- current file's `_t` / `_p`. An after() that finishes after an unlock would
-- otherwise point the clean asset at the marked thumbnail. Every caller
-- already passes thumbPathFor/previewPathFor(storage_path). Same signature,
-- same grants.
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
  v_path text;
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

  select g.workspace_id, a.storage_path into v_ws, v_path
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
  -- …and be the derivative of the file the asset shows NOW (lib/thumbs.ts).
  if thumb_path <> public.asset_derivative_path(v_path, '_t.webp') then
    raise exception 'thumb path is not this asset''s derivative';
  end if;
  if preview_path is not null and preview_path <> public.asset_derivative_path(v_path, '_p.webp') then
    raise exception 'preview path is not this asset''s derivative';
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

revoke all on function public.set_asset_derivatives(uuid, text, text) from public;
revoke all on function public.set_asset_derivatives(uuid, text, text) from anon;
grant execute on function public.set_asset_derivatives(uuid, text, text) to authenticated;

-- 14 ────────────────────────────────────────────────────────────────────────
-- Private, ciphertext only. `do update`, not `do nothing`: whatever a bucket
-- of this name was before, it is private after this file.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trial-originals', 'trial-originals', false, 52428800, array['application/octet-stream'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- R1, first: every policy without a TO clause is re-scoped to `authenticated`
-- (the 19 listed in the header on PROD). Idempotent: a second run finds none.
do $$
declare
  p record;
  v_done text[] := '{}';
begin
  for p in
    select policyname from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and roles = '{public}'::name[]
     order by policyname
  loop
    execute format('alter policy %I on storage.objects to authenticated', p.policyname);
    v_done := v_done || p.policyname::text;
  end loop;
  raise notice 'storage.objects policies re-scoped to authenticated (%): %',
    cardinality(v_done), coalesce(nullif(array_to_string(v_done, ', '), ''), '(none)');
end $$;

drop policy if exists trial_originals_member_insert on storage.objects;
create policy trial_originals_member_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'trial-originals' and public.trial_original_uploadable(name));

drop policy if exists trial_originals_member_select on storage.objects;
create policy trial_originals_member_select on storage.objects for select to authenticated
  using (bucket_id = 'trial-originals' and public.is_workspace_member((storage.foldername(name))[1]::uuid));

drop policy if exists trial_originals_member_delete on storage.objects;
create policy trial_originals_member_delete on storage.objects for delete to authenticated
  using (bucket_id = 'trial-originals'
         and public.is_workspace_member((storage.foldername(name))[1]::uuid)
         and (public.trial_original_uploadable(name) or public.trial_original_purgeable_member(name)));

drop policy if exists trial_originals_purge_select on storage.objects;
create policy trial_originals_purge_select on storage.objects for select to anon
  using (bucket_id = 'trial-originals' and public.trial_original_purgeable(name));

drop policy if exists trial_originals_purge_delete on storage.objects;
create policy trial_originals_purge_delete on storage.objects for delete to anon
  using (bucket_id = 'trial-originals' and public.trial_original_purgeable(name));
-- No UPDATE policy (a blob is never overwritten) and no admin branch (an
-- admin has no business reading a customer's ciphertext).

-- 15 ────────────────────────────────────────────────────────────────────────
-- Dormant until an admin switches it on (the dedicated admin section, with
-- an audit entry). Shapes as serializeTrialWatermarkConfig writes them.
insert into public.app_settings (key, value)
values ('trial_watermark', jsonb_build_object(
  'v', 1,
  'enabled', false,
  'width_ratio', 0.5,
  'opacity', 0.38,
  'luminance_threshold', 0.55,
  'dark_color', '#111111',
  'glow_radius_ratio', 0.015,
  'glow_opacity', 0.2,
  'original_retention_days', 30,
  'signed_url_ttl_seconds', 60,
  'exempt_staff', true,
  'force_trial_user_ids', '[]'::jsonb
))
on conflict (key) do nothing;

-- 0139's five keys verbatim, plus this one: no anon and no customer reads it
-- (who is forced into the trial path is not theirs to see).
create or replace function public.app_setting_is_private(p_key text)
returns boolean
language sql
immutable parallel safe
as $$
  select p_key in (
    'notifications',
    'login_security_dispatch',
    'auth_email_hook',
    'ai_background_presets',
    'thumbnail',
    'trial_watermark'
  );
$$;

-- 16 ────────────────────────────────────────────────────────────────────────
-- pg_cron, in 0102's defensive style: an existing job of this name is
-- replaced, a project without pg_cron is told so instead of failing. Expiry
-- does not depend on it — every function judges expires_at itself.
do $$
declare
  v_name constant text := 'grovbase-trial-originals-sweep';
  v_existing integer;
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice 'trial originals sweep: pg_cron is absent; the daily cron route runs trial_originals_sweep_now instead.';
    return;
  end if;
  execute 'select count(*) from cron.job where jobname = $1' into v_existing using v_name;
  if v_existing > 0 then execute 'select cron.unschedule($1)' using v_name; end if;
  execute 'select cron.schedule($1, $2, $3)'
    using v_name, '*/15 * * * *', 'select public.trial_originals_sweep();';
exception when others then
  raise notice 'trial originals sweep: could not schedule (%). Nothing was left half-configured.', sqlerrm;
end $$;
