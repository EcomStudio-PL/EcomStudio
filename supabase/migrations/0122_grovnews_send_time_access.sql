-- ============================================================================
-- 0122 — GROVNEWS STAGE 2.1: ACCESS IS CHECKED AT THE MOMENT OF SENDING
-- ============================================================================
--
-- THE BLOCKER THIS CLOSES. Until now a GrovNews subscriber's access was
-- evaluated exactly once on the mailing path: by grovnews_group_sync_core(),
-- when the edition was queued. newsletter_queue_claim() re-checks consent,
-- unsubscription and suppression on every batch — never GrovNews access — and
-- the audience is frozen into newsletter_recipients. So a person whose access
-- was revoked, ran out, or whose account was blocked AFTER queueing still
-- received the edition: during the drain (≈4 messages a minute at the default
-- pace), on an SMTP retry (+3/+9/+27/+81 min), after a pause/resume, or at a
-- scheduled send time.
--
-- WHAT THIS ADDS
--
-- 1. grovnews_user_has_access(user) — THE ONE place that says what "has
--    GrovNews access right now" means: an ACTIVE entitlement whose window has
--    started and not ended, on an account that is not blocked. Everything else
--    asks it. Stage 3 extends THIS function (paid access); nothing else.
--    Feature availability is deliberately not part of it: lib/features.ts
--    keeps availability ("is the module on") and entitlement ("who may read
--    it") as separate questions, and 0119/0120 never mixed them either.
--
-- 2. grovnews_has_access() — the reader's question (RLS on grovnews_posts,
--    the /grovnews pages, grovnews_current_edition) now delegates to (1).
--    Behaviour is unchanged: same predicate, same NULL-for-anonymous answer.
--
-- 3. grovnews_eligible_contacts(contacts[] | NULL) — the mail-side question:
--    which newsletter contacts belong to a person with access (1) and a
--    CONFIRMED sign-in address? Linking rules are exactly 0121's: the
--    contact's own user_id, or — for an unlinked contact — the confirmed
--    auth.users address. Set-based, so group sync stays one pass.
--
-- 4. grovnews_group_sync_core() — rewritten to ask (3) instead of carrying
--    its own copy of the access predicate. Same result, one definition.
--
-- 5. grovnews_send_guard(token, recipient_ids[]) — asked by the newsletter
--    worker IMMEDIATELY BEFORE the SMTP send. For each recipient it answers
--    whether the row belongs to a GrovNews campaign and, if so, whether its
--    contact is eligible (3) right now — one set-based answer per call. Rows of ordinary campaigns always come
--    back allowed — the guard changes nothing for them. The worker closes a
--    refused row through the existing newsletter_queue_finish(…'skipped',
--    'grovnews_access_inactive'), so events, counters and campaign closing
--    stay exactly the newsletter's own.
--
--    A GrovNews campaign is (a) one an edition points at (campaign_id), or
--    (b) one whose audience is exactly the static `grovnews` group — the group
--    that by definition means "people with GrovNews access", so a campaign an
--    operator aims at it by hand is held to the same rule. A campaign that
--    merely INCLUDES the group next to others is left alone: its other
--    recipients never needed GrovNews access, and the guard cannot tell which
--    group put a row there.
--
-- WHAT THIS DOES NOT TOUCH. newsletter_queue_claim / _finish / _start_due,
-- the worker's pacing, retries, tracking, consent and suppression are
-- unchanged. Suppression and unsubscription still win first (the claim never
-- hands such a row to the worker, so the guard never even sees it).
--
-- SECURITY. (1) and (3) are internal: revoked from every client role, so
-- nobody can ask about another person's access. (5) is reachable only with the
-- dispatch token (server_call_ok), like every other worker door, and answers
-- three columns: id, is-GrovNews, allowed. No entitlement row, note or admin
-- data leaves the database.
--
-- ROLLBACK (manual, in this order): re-create grovnews_group_sync_core and
-- grovnews_has_access from 0121 / 0120, then
--   drop function public.grovnews_send_guard(text, uuid[]);
--   drop function public.grovnews_eligible_contacts(uuid[]);
--   drop function public.grovnews_user_has_access(uuid);
-- DEPLOY ORDER: this migration BEFORE the worker code. The worker asks the
-- guard before it claims anything and sends nothing without an answer (fail
-- closed, no attempt spent), so code without this migration pauses newsletter
-- sending rather than breaking it — and code must be rolled back together
-- with this migration.
--
-- KNOWN LIMIT: a campaign built by hand in the generic Newsletter screen is
-- classified by its audience at send time, so an admin who pauses such a
-- campaign and adds a second group to its audience takes the guard off its
-- remaining rows. Edition campaigns — the GrovNews mailing path — are
-- classified by the edition's campaign_id, which 0121 makes immutable.

begin;

-- ── 1. THE CANONICAL RESOLVER ───────────────────────────────────────────────
create function public.grovnews_user_has_access(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null
     and not public.account_blocked(p_user_id)
     and exists (
       select 1 from public.grovnews_entitlements e
        where e.user_id = p_user_id
          and e.status = 'ACTIVE'
          and e.starts_at <= now()
          and (e.expires_at is null or e.expires_at > now())
     );
$$;

revoke all on function public.grovnews_user_has_access(uuid) from public, anon, authenticated;

-- ── 2. THE READER'S QUESTION DELEGATES ──────────────────────────────────────
-- CREATE OR REPLACE would keep 0119's grants; they are restated anyway so the
-- door does not depend on the function having existed before this file.
create or replace function public.grovnews_has_access()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.grovnews_user_has_access(auth.uid());
$$;

revoke all on function public.grovnews_has_access() from public, anon;
grant execute on function public.grovnews_has_access() to authenticated;

-- ── 3. THE MAIL-SIDE QUESTION ───────────────────────────────────────────────
-- Which of these newsletter contacts belong to a person with access (1) and a
-- CONFIRMED sign-in address? NULL means "all contacts" (group sync); an array
-- means "just these" (the send guard). Linking rules are exactly 0121's: the
-- contact's own user_id, or — for an unlinked contact — the confirmed
-- auth.users address, never profiles.email. Set-based on purpose: two hash
-- joins over the contacts asked about, not a lookup per contact, so a group
-- sync over tens of thousands of contacts stays one pass.
create function public.grovnews_eligible_contacts(p_contact_ids uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id
    from public.newsletter_contacts c
    join auth.users u on u.id = c.user_id
   where (p_contact_ids is null or c.id = any (p_contact_ids))
     and u.email is not null and u.email_confirmed_at is not null
     and public.grovnews_user_has_access(u.id)
  union
  select c.id
    from public.newsletter_contacts c
    join auth.users u on lower(u.email) = c.email
   where c.user_id is null
     and (p_contact_ids is null or c.id = any (p_contact_ids))
     and u.email_confirmed_at is not null
     and public.grovnews_user_has_access(u.id);
$$;

revoke all on function public.grovnews_eligible_contacts(uuid[]) from public, anon, authenticated;

-- ── 4. GROUP SYNC ASKS THE SAME QUESTION ────────────────────────────────────
-- Identical to 0121 except `wanted`, which is now (3)'s answer for every
-- contact instead of a private copy of the access rule.
create or replace function public.grovnews_group_sync_core()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid;
  v_added integer;
  v_removed integer;
begin
  insert into public.newsletter_groups (key, name, description, is_dynamic)
  values ('grovnews', 'GrovNews — subskrybenci',
          'Utrzymywana automatycznie przez GrovNews: kontakty użytkowników z aktywnym dostępem. Nie edytuj ręcznie.',
          false)
  on conflict (key) do nothing;
  select g.id into strict v_group from public.newsletter_groups g where g.key = 'grovnews';
  -- A dynamic group is resolved from its rules, not its members: mailing it
  -- would reach whoever the rules match, entitled or not. Refuse.
  if exists (select 1 from public.newsletter_groups g where g.id = v_group and g.is_dynamic) then
    raise exception 'grovnews_group_dynamic';
  end if;

  with wanted as (
    select e.id from public.grovnews_eligible_contacts(null) e(id)
  ), removed as (
    delete from public.newsletter_group_members m
     where m.group_id = v_group and m.contact_id not in (select id from wanted)
    returning 1
  ), added as (
    insert into public.newsletter_group_members (group_id, contact_id)
    select v_group, w.id from wanted w
    on conflict do nothing
    returning 1
  )
  select (select count(*) from added), (select count(*) from removed) into v_added, v_removed;

  return jsonb_build_object('group_id', v_group, 'added', v_added, 'removed', v_removed);
end $$;

-- Internal, as in 0121: reached only through grovnews_group_sync (admin or
-- token) and grovnews_edition_send (token).
revoke all on function public.grovnews_group_sync_core() from public, anon, authenticated;

-- ── 5. THE SEND-TIME GUARD ──────────────────────────────────────────────────
-- Read-only: it decides, the worker closes the row through the newsletter's
-- own finish function. A recipient id that no longer exists is simply absent
-- from the answer (its campaign was deleted); the worker sends nothing for it.
create function public.grovnews_send_guard(p_token text, p_recipient_ids uuid[])
returns table (recipient_id uuid, grovnews boolean, allowed boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.server_call_ok(p_token) then
    raise exception 'forbidden';
  end if;
  if p_recipient_ids is null or cardinality(p_recipient_ids) = 0 then
    return;
  end if;
  -- The claim hands out at most 200 rows; nothing legitimate asks for more.
  if cardinality(p_recipient_ids) > 200 then
    raise exception 'too_many_recipients';
  end if;

  return query
    with target as (
      select r.id, r.contact_id,
             (exists (select 1 from public.grovnews_editions e where e.campaign_id = r.campaign_id)
              or exists (
                select 1 from public.newsletter_campaigns k
                  join public.newsletter_groups g on g.key = 'grovnews'
                 where k.id = r.campaign_id
                   and k.audience->'include' = jsonb_build_array(g.id::text)
              )) as is_grovnews
        from public.newsletter_recipients r
       where r.id = any (p_recipient_ids)
    )
    , eligible as (
      -- '{}' rather than NULL when there is no GrovNews row: NULL means "all".
      select e.id from public.grovnews_eligible_contacts(
        coalesce((select array_agg(t.contact_id) from target t where t.is_grovnews), '{}')) e(id)
    )
    select t.id,
           t.is_grovnews,
           case when t.is_grovnews then t.contact_id in (select e.id from eligible e) else true end
      from target t;
end $$;

revoke all on function public.grovnews_send_guard(text, uuid[]) from public, anon, authenticated;
grant execute on function public.grovnews_send_guard(text, uuid[]) to anon, authenticated;

commit;
