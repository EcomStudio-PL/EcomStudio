-- NEWSLETTER — THE SCHEDULER, AND THE THREE DOORS THE WORKER STILL NEEDED.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- READ THIS BEFORE APPLYING, AND READ IT AGAIN IF IT FAILS.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- WHAT PROBLEM THE SCHEDULER SOLVES.
--
-- "Zaplanuj na 18:00" is a promise about a minute. Vercel's Hobby plan runs a
-- cron job ONCE A DAY, at an hour of its choosing, and cannot honour it. A
-- campaign scheduled for 18:00 would go out whenever tomorrow's single
-- invocation happened to land, which is not a scheduler — it is a lottery with
-- a nice confirmation screen.
--
-- Postgres can do what the platform cannot. pg_cron 1.6.4 and pg_net 0.20.4 are
-- both available on this project (verified in pg_available_extensions;
-- installed_version was null for both before this file). pg_cron gives a
-- once-a-minute tick inside the database, pg_net lets that tick make an HTTP
-- request, and the request is a POST to /api/newsletter/worker — the same
-- endpoint the platform cron and the admin's "wyślij teraz" button reach. One
-- worker, three ways to wake it.
--
-- THIS FILE IS SAFE TO FAIL. THAT IS A FEATURE, NOT AN ACCIDENT.
--
-- If the extensions cannot be created — a plan that forbids them, a role that
-- may not, a future Supabase change — every statement below is written to raise
-- a NOTICE and carry on. Nothing is left half-built, no table is altered and no
-- existing behaviour changes. What you lose is minute precision, and ONLY that:
--
--   · the admin's "wyślij teraz" button still sends, because it calls
--     runWorkerBatch through a server action under the operator's own session;
--   · the once-a-day Vercel cron still drains the queue;
--   · a campaign scheduled for 18:00 still goes out — late, on the next
--     invocation, which is exactly the behaviour the product had before this
--     file existed and is why the settings screen must keep saying so.
--
-- So: applying this improves the product, failing to apply it does not break
-- it, and half-applying it is not a state this file can reach.
--
-- WHAT YOU MUST DO AFTER APPLYING IT. The job is scheduled by this migration
-- but does NOTHING until two secrets exist — it has no way to know the site's
-- own URL or the server's dispatch token, and neither belongs in a migration:
--
--   grovbase.newsletter.worker_url    e.g. https://grovbase.com/api/newsletter/worker
--   grovbase.newsletter.worker_token  the value dispatchToken() returns on the server
--
-- They are stored the way every other GrovBase secret is stored: Supabase Vault,
-- through migration 0078's secret store, under the same
-- `grovbase.<integration>.<field>` naming that lib/server/secret-store.ts's
-- `secretName()` produces. Two ways to write them:
--
--   · FROM THE PANEL (preferred) — an admin session calls `secret_put`, which is
--     what putSecret() in lib/server/secret-store.ts already does. The token is
--     computed server-side by dispatchToken(); it is never typed by a human and
--     never shown in a form.
--   · FROM THE SQL EDITOR — `secret_put` is gated on is_admin() and the SQL
--     editor is the `postgres` role with no auth.uid(), so it is refused there.
--     Write the vault directly instead:
--
--       select vault.create_secret('https://grovbase.com/api/newsletter/worker',
--                                  'grovbase.newsletter.worker_url',
--                                  'GrovBase managed secret');
--       select vault.create_secret('<dispatch token>',
--                                  'grovbase.newsletter.worker_token',
--                                  'GrovBase managed secret');
--
-- Until both exist, `newsletter_cron_tick()` returns 'not_configured' every
-- minute and costs one cheap query. It never guesses a URL and never posts
-- without a token — a scheduler that invents its own destination is a request
-- forgery with a schedule attached.
--
-- WHY THE TICK DECIDES WHETHER TO WAKE THE WORKER AT ALL.
--
-- The database already knows whether there is anything to send. Posting to a
-- serverless function every sixty minutes of every day to be told "nothing due"
-- is 1440 invocations a day, billed, logged and alert-noisy, to answer a
-- question one index lookup answers for free. So the tick checks the kill
-- switch and the queue first and only then makes the request. The check is
-- deliberately WIDER than newsletter_queue_claim's own predicate — it omits the
-- consent and suppression joins — because a gate that is wider than the claim
-- costs at most one wasted invocation, while a gate that is narrower would
-- leave mail sitting in the queue forever with nothing to wake it.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- PART 2 OF THIS FILE IS NOT THE SCHEDULER, AND IT IS NOT OPTIONAL EITHER.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 0094 gave the worker a door to CLAIM rows and a door to FINISH them, both
-- gated on the dispatch token so the unattended path needs no session. It did
-- not give it a door to READ what to send. Rendering a message needs
-- newsletter_campaigns (tracking settings and utm), newsletter_campaign_steps
-- (the words) and newsletter_links (the click map), and all three are
-- admin-only under RLS — an anonymous client reads them as EMPTY, not as an
-- error, so the worker would have sent every campaign as a blank page and
-- reported success. Two smaller gaps sit beside it: newsletter_events is
-- admin-only, so the 'accepted' event could not be written, and app_settings is
-- admin-WRITABLE, so the run stamps could not be either — the settings screen
-- would have said "jeszcze nie działał" while thousands of messages went out.
--
-- Three functions close those three gaps, with the same gate, the same grants
-- and the same silent-refusal contract as 0094's queue functions. No new table,
-- no policy change, nothing existing touched.
--
-- IF THIS FILE IS NEVER APPLIED, the worker still works from the admin path:
-- lib/server/newsletter/worker.ts tries the ordinary service functions first
-- and only falls back to these RPCs when a direct read comes back empty. The
-- button works today; the scheduler needs this file.

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 1 — THE SCHEDULER
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1.1 The extensions ─────────────────────────────────────────────────────
--
-- Neither carries a schema clause. pg_cron and pg_net both fix their own schema
-- in their control file (`cron` and `net`), and naming a different one is an
-- error rather than a preference. The call site below resolves pg_net's
-- function through the catalogue anyway, so a build that places it elsewhere
-- still works.
do $$
begin
  execute 'create extension if not exists pg_cron';
exception when others then
  raise notice 'newsletter scheduler: pg_cron could not be created (%). Minute-precision scheduling is OFF; the admin button and the daily platform cron still send.', sqlerrm;
end $$;

do $$
begin
  execute 'create extension if not exists pg_net';
exception when others then
  raise notice 'newsletter scheduler: pg_net could not be created (%). Minute-precision scheduling is OFF; the admin button and the daily platform cron still send.', sqlerrm;
end $$;

-- pg_cron's own tables live in `cron` and are owned by the extension. The role
-- that applies migrations needs to see them to schedule anything; on a project
-- where it already can, these are no-ops.
do $$
begin
  execute 'grant usage on schema cron to postgres';
  execute 'grant all privileges on all tables in schema cron to postgres';
exception when others then
  raise notice 'newsletter scheduler: cron schema grants skipped (%).', sqlerrm;
end $$;

-- ── 1.2 The tick ───────────────────────────────────────────────────────────
--
-- Created unconditionally, whether or not the extensions exist: it is ordinary
-- plpgsql, every reference to pg_net goes through dynamic SQL, and a tick that
-- exists but is never scheduled is harmless. That also means an operator who
-- enables the extensions later has only the schedule left to run.
--
-- It returns a short status string rather than void so `select
-- public.newsletter_cron_tick();` is a usable diagnostic: 'paused', 'idle',
-- 'not_configured', 'no_pg_net', or 'posted:<request id>'.
--
-- IT NEVER RETURNS A SECRET. The URL and the token are read into local
-- variables, used to build one request, and discarded.
create or replace function public.newsletter_cron_tick()
returns text
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
  v_paused boolean;
  v_due boolean;
  v_url text;
  v_token text;
  v_fn text;
  v_request bigint;
begin
  -- The kill switch, read where it is cheapest to read. §74's pause is
  -- marketing-only; nothing here can affect auth mail, login codes or admin
  -- notifications, which are a different transport path entirely.
  select coalesce((s.value->>'paused')::boolean, false) into v_paused
    from public.app_settings s where s.key = 'newsletter';
  if coalesce(v_paused, false) then
    return 'paused';
  end if;

  -- Is there anything at all to wake the worker for? A campaign whose moment
  -- has arrived, or a queued message that is due. See the note at the top of
  -- this file on why this is deliberately wider than the claim's predicate.
  v_due :=
    exists (
      select 1 from public.newsletter_campaigns k
       where k.status = 'scheduled'
         and k.scheduled_at is not null
         and k.scheduled_at <= now()
    )
    or exists (
      select 1
        from public.newsletter_recipients r
        join public.newsletter_campaigns k on k.id = r.campaign_id
       where r.status in ('pending', 'sending')
         and r.send_after <= now()
         and (r.next_attempt_at is null or r.next_attempt_at <= now())
         -- The same five-minute reaper the claim uses: a row claimed a second
         -- ago is somebody else's, and waking a second worker for it would
         -- only have it find nothing.
         and (r.claimed_at is null or r.claimed_at < now() - interval '5 minutes')
         and r.attempts < 5
         and k.status = 'sending'
    );

  if not v_due then
    return 'idle';
  end if;

  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'grovbase.newsletter.worker_url';
  select decrypted_secret into v_token
    from vault.decrypted_secrets where name = 'grovbase.newsletter.worker_token';
  -- No destination or no credential means no request. A scheduler that guesses
  -- its own target is a request forgery with a schedule attached.
  if v_url is null or btrim(v_url) = '' or v_token is null or btrim(v_token) = '' then
    return 'not_configured';
  end if;

  -- Resolved from the catalogue rather than hardcoded, so this works whichever
  -- schema the platform installed pg_net into, and degrades to a status string
  -- rather than an error when it is not installed at all. The name is
  -- interpolated with %s below rather than %I because it is a qualified
  -- reference, not one identifier; it is safe because it can only ever be one
  -- of the three schemas this query allows.
  select n.nspname || '.' || p.proname into v_fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'http_post'
     and n.nspname in ('net', 'extensions', 'public')
   order by case n.nspname when 'net' then 0 when 'extensions' then 1 else 2 end
   limit 1;
  if v_fn is null then
    return 'no_pg_net';
  end if;

  -- FIRE AND FORGET, ON PURPOSE. pg_net queues the request and returns an id;
  -- the tick does not wait for the worker to finish, and must not — a batch
  -- takes most of a minute and this runs inside a cron slot. The worker's own
  -- idempotency (the unique index on newsletter_recipients, plus the claim's
  -- FOR UPDATE SKIP LOCKED) is what makes an overlapping invocation harmless,
  -- so nothing here has to be careful about it.
  execute format(
    'select %s(url := $1, headers := $2, body := $3, timeout_milliseconds := $4)', v_fn
  )
  into v_request
  using
    btrim(v_url),
    jsonb_build_object(
      'Content-Type', 'application/json',
      -- The route accepts a bearer CRON_SECRET or this header. The header is
      -- what a stored secret can carry cleanly; there is no session path in.
      'x-newsletter-token', btrim(v_token)
    ),
    '{}'::jsonb,
    5000;

  return 'posted:' || coalesce(v_request::text, 'unknown');
end $$;

-- Nobody but the job calls this. The owner (which is what the cron job runs as)
-- always has execute; every other role is refused, including an admin — the
-- panel's "wyślij teraz" goes through the route, not through the scheduler.
revoke all on function public.newsletter_cron_tick() from public, anon, authenticated;

comment on function public.newsletter_cron_tick() is
  'Once-a-minute newsletter scheduler tick. Checks the kill switch and the queue, then POSTs to the worker route with the dispatch token. Reads its URL and token from Supabase Vault (grovbase.newsletter.worker_url / .worker_token) and returns a status string, never a secret. No-ops as not_configured until both secrets exist.';

-- ── 1.3 The schedule ───────────────────────────────────────────────────────
--
-- Idempotent: an existing job of this name is removed first, so re-applying
-- this migration replaces the schedule instead of accumulating duplicates that
-- would each wake the worker every minute.
--
-- Every reference to pg_cron goes through EXECUTE. plpgsql prepares a statement
-- the first time it reaches it, so the guard below returns before anything that
-- mentions the `cron` schema is ever parsed — which is what lets this file run
-- cleanly on a project where the extension does not exist.
do $$
declare
  v_name constant text := 'grovbase-newsletter-worker';
  v_existing integer;
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice 'newsletter scheduler: pg_cron is not installed, so no minute-by-minute job was scheduled. The admin button and the once-a-day platform cron still send; a campaign scheduled for a particular hour will go out late. Install pg_cron and re-apply this migration to fix that.';
    return;
  end if;

  execute 'select count(*) from cron.job where jobname = $1' into v_existing using v_name;
  if v_existing > 0 then
    execute 'select cron.unschedule($1)' using v_name;
  end if;

  -- Every minute. The tick itself is one settings read and one existence check
  -- when there is nothing to do, which is the overwhelming majority of minutes.
  execute 'select cron.schedule($1, $2, $3)'
    using v_name, '* * * * *', 'select public.newsletter_cron_tick();';

  raise notice 'newsletter scheduler: job % scheduled every minute. It stays dormant until the vault holds grovbase.newsletter.worker_url and grovbase.newsletter.worker_token.', v_name;
exception when others then
  raise notice 'newsletter scheduler: the job could not be scheduled (%). Nothing was left half-configured; the admin button and the daily platform cron still send.', sqlerrm;
end $$;

-- ── 1.4 Is it actually on? ─────────────────────────────────────────────────
--
-- An operator must be able to see whether minute precision is live WITHOUT
-- reading pg_cron's tables, which `authenticated` cannot see and should not be
-- granted. Without this, a settings screen has no honest way to say whether a
-- campaign scheduled for 18:00 will leave at 18:00 — and guessing "yes" there
-- is exactly the kind of confident fiction this module refuses to print.
--
-- It reports state, never a secret: whether each secret EXISTS, never its value.
create or replace function public.newsletter_scheduler_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, vault, extensions
as $$
declare
  v_cron boolean := to_regprocedure('cron.schedule(text,text,text)') is not null;
  v_net boolean := exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where p.proname = 'http_post' and n.nspname in ('net', 'extensions', 'public')
  );
  v_job boolean := false;
  v_last jsonb := null;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;

  if v_cron then
    begin
      execute 'select count(*) > 0 from cron.job where jobname = $1'
        into v_job using 'grovbase-newsletter-worker';
      execute $q$
        select jsonb_build_object('status', d.status, 'at', d.end_time, 'message', left(d.return_message, 200))
          from cron.job_run_details d
          join cron.job j on j.jobid = d.jobid
         where j.jobname = $1
         order by d.start_time desc
         limit 1
      $q$ into v_last using 'grovbase-newsletter-worker';
    exception when others then
      -- A readable job list is a nicety, not the answer. Never let it turn a
      -- status call into an error.
      v_last := null;
    end;
  end if;

  return jsonb_build_object(
    'pgCron', v_cron,
    'pgNet', v_net,
    'jobScheduled', v_job,
    'urlConfigured', exists (
      select 1 from vault.decrypted_secrets
       where name = 'grovbase.newsletter.worker_url' and coalesce(btrim(decrypted_secret), '') <> ''
    ),
    'tokenConfigured', exists (
      select 1 from vault.decrypted_secrets
       where name = 'grovbase.newsletter.worker_token' and coalesce(btrim(decrypted_secret), '') <> ''
    ),
    'lastRun', v_last
  );
end $$;

revoke all on function public.newsletter_scheduler_status() from public, anon, authenticated;
grant execute on function public.newsletter_scheduler_status() to authenticated;

comment on function public.newsletter_scheduler_status() is
  'Admin-only. Whether minute-precision newsletter scheduling is actually live: extensions present, job scheduled, both vault secrets set, and the last cron run. Reports existence of the secrets, never their values.';

-- ═══════════════════════════════════════════════════════════════════════════
-- PART 2 — THE THREE DOORS THE WORKER NEEDED AND 0094 DID NOT OPEN
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Same contract as the queue functions: the dispatch token or nothing, a silent
-- refusal rather than an error on a bad token, and execute granted to anon and
-- authenticated so the anonymous server path can reach them. Granting to anon is
-- safe precisely because the token, not the role, is the gate — the identical
-- argument 0094 §12 makes for the claim and finish functions.

-- ── 2.1 What to send ───────────────────────────────────────────────────────
--
-- One round trip that answers "what does this campaign's step look like, and
-- who are these contacts". The alternative — three selects per message —
-- is sixty round trips for a batch of twenty, inside a sixty-second budget that
-- is mostly pacing delay.
--
-- THREE ANSWERS, AND THE WORKER TREATS THEM DIFFERENTLY:
--   `{}`                 the token was refused, or the campaign is gone in a way
--                        that cannot be told apart from it → transient, the row
--                        goes back to the queue with a backoff;
--   no `step` key        the step genuinely does not exist → terminal, the row
--                        is closed as 'skipped' rather than retried forever;
--   a full payload       send it.
-- Collapsing those into one answer is how a worker either retries a deleted
-- step five times or gives up on a campaign that was merely unreadable.
create or replace function public.newsletter_worker_context(
  p_token text,
  p_campaign uuid,
  p_step integer,
  p_variant text default 'A',
  p_contacts uuid[] default '{}'
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_campaign record;
  v_step record;
  v_has_step boolean := false;
  v_links jsonb;
  v_contacts jsonb;
  v_payload jsonb;
begin
  if not public.server_call_ok(p_token) then
    return '{}'::jsonb;
  end if;

  select k.id, k.track_opens, k.track_clicks, k.utm
    into v_campaign
    from public.newsletter_campaigns k
   where k.id = p_campaign;
  if v_campaign.id is null then
    -- Recipients cascade with their campaign, so this is close to impossible.
    -- It still must not look like a refused token: an empty campaign object
    -- means "there is nothing here to send", which is terminal.
    return jsonb_build_object('campaign', '{}'::jsonb);
  end if;

  select s.subject, s.preheader, s.editor, s.blocks, s.body_html
    into v_step
    from public.newsletter_campaign_steps s
   where s.campaign_id = p_campaign
     and s.step_index = p_step
     -- The exact variant first; then the step at that index whatever its
     -- variant. A queue row written before an A/B variant was renamed must
     -- still send the message the operator wrote, not nothing at all.
     and s.variant = coalesce(p_variant, 'A')
   limit 1;
  v_has_step := found;

  if not v_has_step then
    select s.subject, s.preheader, s.editor, s.blocks, s.body_html
      into v_step
      from public.newsletter_campaign_steps s
     where s.campaign_id = p_campaign and s.step_index = p_step
     order by s.variant
     limit 1;
    v_has_step := found;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'url', l.url)), '[]'::jsonb)
    into v_links
    from public.newsletter_links l
   where l.campaign_id = p_campaign;

  -- The two merge fields the claim does not carry. The worker asks for them on
  -- every context call because the answer is a handful of short strings and the
  -- alternative is a second round trip for the rare body that uses
  -- {{last_name}} or {{source}} — and a blank where a name should be is the
  -- single most recognisable sign of a broken mailing.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id, 'last_name', c.last_name, 'source_key', c.source_key)), '[]'::jsonb)
    into v_contacts
    from public.newsletter_contacts c
   where c.id = any(coalesce(p_contacts, array[]::uuid[]));

  v_payload := jsonb_build_object(
    'campaign', jsonb_build_object(
      'track_opens', v_campaign.track_opens,
      'track_clicks', v_campaign.track_clicks,
      'utm', coalesce(v_campaign.utm, '{}'::jsonb)
    ),
    'links', v_links,
    'contacts', v_contacts
  );

  if v_has_step then
    v_payload := v_payload || jsonb_build_object('step', jsonb_build_object(
      'subject', coalesce(v_step.subject, ''),
      'preheader', coalesce(v_step.preheader, ''),
      'editor', coalesce(v_step.editor, 'builder'),
      'blocks', coalesce(v_step.blocks, '[]'::jsonb),
      'body_html', coalesce(v_step.body_html, '')
    ));
  end if;

  return v_payload;
end $$;

revoke all on function public.newsletter_worker_context(text, uuid, integer, text, uuid[])
  from public, anon, authenticated;
grant execute on function public.newsletter_worker_context(text, uuid, integer, text, uuid[])
  to anon, authenticated;

comment on function public.newsletter_worker_context(text, uuid, integer, text, uuid[]) is
  'Server-only. Everything the newsletter worker needs to render one campaign step: tracking settings, the words, the click map and the merge fields the queue does not carry. An empty object means the token was refused; a payload with no step key means the step is gone.';

-- ── 2.2 "The server took it" ───────────────────────────────────────────────
--
-- newsletter_queue_finish already records that WE sent. This records that the
-- mail server accepted responsibility for the address, which is a different
-- fact and the only one this transport can actually substantiate. Keeping them
-- apart is what lets the report say "przyjęte przez serwer pocztowy" instead of
-- a "dostarczone" nobody here can prove.
--
-- Guarded against a second insert: `accepted` is counted raw on the dashboard,
-- so a duplicate would inflate a number an operator reads as a measurement.
create or replace function public.newsletter_worker_accept(
  p_token text,
  p_recipient uuid
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_rec record;
begin
  if not public.server_call_ok(p_token) then return; end if;

  select r.id, r.campaign_id, r.step_index, r.variant, r.contact_id
    into v_rec
    from public.newsletter_recipients r
   where r.id = p_recipient and r.status = 'sent';
  if v_rec.id is null then return; end if;

  if exists (
    select 1 from public.newsletter_events e
     where e.recipient_id = v_rec.id and e.event_type = 'accepted'
  ) then
    return;
  end if;

  insert into public.newsletter_events
    (event_type, campaign_id, step_index, variant, contact_id, recipient_id)
  values
    ('accepted', v_rec.campaign_id, v_rec.step_index, v_rec.variant, v_rec.contact_id, v_rec.id);
end $$;

revoke all on function public.newsletter_worker_accept(text, uuid) from public, anon, authenticated;
grant execute on function public.newsletter_worker_accept(text, uuid) to anon, authenticated;

comment on function public.newsletter_worker_accept(text, uuid) is
  'Server-only. Records that the mail server accepted an address for a sent recipient row. Separate from the sent event on purpose: acceptance is what this transport can prove, delivery is not.';

-- ── 2.3 The run stamps ─────────────────────────────────────────────────────
--
-- app_settings is world-readable and admin-writable, so the scheduled path —
-- anonymous key, no session — cannot write its own run stamps: the upsert is
-- refused by RLS and "Ostatni przebieg" would read "jeszcze nie działał" while
-- thousands of messages went out. That is not a cosmetic bug; it is the panel
-- lying about whether the product is working.
--
-- The write MERGES at the top level (`value || excluded.value`) rather than
-- replacing, so the operator's own dials — the kill switch, the rate, the batch
-- size — cannot be erased by a worker writing a timestamp. That is the same
-- read-modify-write discipline writeSettings() uses in TypeScript, enforced
-- here in one statement so a concurrent save cannot interleave with it.
create or replace function public.newsletter_worker_stamp(
  p_token text,
  p_sent integer,
  p_failed integer,
  p_error text default null
) returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not (public.server_call_ok(p_token) or public.is_admin()) then return; end if;

  insert into public.app_settings (key, value)
  values ('newsletter', jsonb_build_object(
    'lastRunAt', now(),
    'lastRunSent', greatest(0, coalesce(p_sent, 0)),
    'lastRunFailed', greatest(0, coalesce(p_failed, 0)),
    -- A NULL argument becomes JSON null here, which is exactly what
    -- toSettings() reads back as "no error". Cleared on a clean run: a stale
    -- error sitting on the settings screen forever after one bad night is its
    -- own kind of dishonesty.
    'lastError', left(nullif(btrim(coalesce(p_error, '')), ''), 200)
  ))
  on conflict (key) do update
    set value = app_settings.value || excluded.value,
        updated_at = now();
end $$;

revoke all on function public.newsletter_worker_stamp(text, integer, integer, text)
  from public, anon, authenticated;
grant execute on function public.newsletter_worker_stamp(text, integer, integer, text)
  to anon, authenticated;

comment on function public.newsletter_worker_stamp(text, integer, integer, text) is
  'Server-only (or admin). Merges the worker run stamps into app_settings.newsletter without touching the operator dials. Exists because the scheduled path has no session and app_settings is admin-writable.';
