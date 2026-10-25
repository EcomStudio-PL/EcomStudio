-- ============================================================================
-- 0160 — POWIADOMIENIA V2: TWO KINDS OF NOTIFICATION, ADMIN ANNOUNCEMENTS,
-- RETENTION. (+ the gallery's favourite-ring switch.)
--
-- 1. EVERY ROW HAS A CATEGORY. `important` lights the bell's badge, `activity`
--    never does. The category is DERIVED from the type, in ONE place —
--    public.notification_category() below, mirrored by lib/notifications/
--    catalog.ts and pinned against each other by scripts/notifications-tests.ts
--    — and a trigger writes it on every insert, so no producer can file a
--    generation under "important" by passing the wrong value.
-- 2. HISTORY IS KEPT. Existing rows are classified by their real type; only
--    the generation rows (now activity) are marked read. Idempotent: the
--    backfill touches rows whose category is still NULL, and after the first
--    run there are none — a second run changes nothing.
-- 3. ADMIN ANNOUNCEMENTS. A message an admin writes goes to the audience they
--    chose, resolved from the plans AT PUBLICATION (the recipients snapshot),
--    fanned out in batches (idempotent: one row per announcement and user),
--    published now or by pg_cron when its time comes. Both priorities are
--    `important`; "Ważny" is also pinned and gets the bar under the header
--    until that user closes it (banner_dismissed_at — a state of its own,
--    separate from read_at). Withdrawing removes it from every recipient and
--    keeps the admin's record (with its read count) and the audit trail.
-- 4. RETENTION. Activity older than 30 days is deleted hourly by pg_cron;
--    important rows stay (an announcement stops showing at its expiry).
-- 5. PAYMENTS. A failed plan invoice (payment_events, written by the existing
--    webhook — unchanged) and a cancelled plan ending within three days each
--    become an important notification for the workspace's owners. Both are
--    best-effort: a failure here can never fail the webhook's own insert.
-- 6. CUSTOMERS MAY ONLY write what is theirs to write: insert the ordinary
--    columns (category, pinning and announcement links are server-side), and
--    update read_at / banner_dismissed_at — nothing else.
-- ============================================================================

-- ── 1. columns ─────────────────────────────────────────────────────────────
alter table public.notifications
  add column if not exists category text,
  add column if not exists meta jsonb not null default '{}'::jsonb,
  add column if not exists dedupe_key text,
  add column if not exists announcement_id uuid,
  add column if not exists pinned boolean not null default false,
  add column if not exists expires_at timestamptz,
  add column if not exists banner_dismissed_at timestamptz;

-- ── 2. the one classification ──────────────────────────────────────────────
-- Unknown types are activity: a new event someone forgets to classify can
-- never start lighting every customer's badge.
create or replace function public.notification_category(p_type text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_type
    when 'announcement'    then 'important'
    when 'payment_failed'  then 'important'
    when 'renewal_failed'  then 'important'
    when 'plan_expiring'   then 'important'
    when 'credits_granted' then 'important'
    when 'credits_removed' then 'important'
    when 'support_reply'   then 'important'
    when 'bonus'           then 'important'
    else 'activity'
  end
$$;

comment on function public.notification_category(text) is
  'Powiadomienia V2: the single type → category map (important lights the bell badge, activity never does). Mirrored by lib/notifications/catalog.ts; scripts/notifications-tests.ts pins the two together.';

-- ── 3. backfill — idempotent ───────────────────────────────────────────────
update public.notifications
   set category = public.notification_category(type),
       read_at = case
         when type in ('generation_done', 'generation_failed') then coalesce(read_at, created_at)
         else read_at
       end
 where category is null;

alter table public.notifications alter column category set default 'activity';
alter table public.notifications alter column category set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notifications_category_check') then
    alter table public.notifications
      add constraint notifications_category_check check (category in ('important', 'activity'));
  end if;
end $$;

create or replace function public.notifications_set_category()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.category := public.notification_category(new.type);
  return new;
end $$;

drop trigger if exists notifications_category on public.notifications;
create trigger notifications_category
  before insert or update of type on public.notifications
  for each row execute function public.notifications_set_category();

create index if not exists notifications_user_cat_idx
  on public.notifications (user_id, category, created_at desc);
create unique index if not exists notifications_user_dedupe_uniq
  on public.notifications (user_id, dedupe_key);
create index if not exists notifications_activity_age_idx
  on public.notifications (created_at) where category = 'activity';

-- ── 4. what a customer may write ──────────────────────────────────────────
revoke insert, update on public.notifications from anon, authenticated;
grant insert (user_id, type, title, body, href, meta, dedupe_key) on public.notifications to authenticated;
grant update (read_at, banner_dismissed_at) on public.notifications to authenticated;

-- ── 5. announcements ───────────────────────────────────────────────────────
create table if not exists public.admin_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  body text not null check (char_length(btrim(body)) between 1 and 600),
  cta_label text check (cta_label is null or char_length(btrim(cta_label)) between 1 and 40),
  -- An internal path ("/credits", never "//host" or "/\host") or an https URL.
  -- No other scheme, no whitespace or control characters. The app validates
  -- the same rule before saving and again before rendering.
  cta_href text check (
    cta_href is null or (
      char_length(cta_href) <= 500
      and cta_href !~ '[[:space:][:cntrl:]]'
      and (cta_href ~ '^/([^/\\].*)?$' or cta_href ~* '^https://[a-z0-9.-]+(:[0-9]+)?([/?#].*)?$')
    )
  ),
  priority text not null default 'normal' check (priority in ('normal', 'important')),
  -- {"kind": "all" | "no_plan" | "plans" | "user", "plan_ids": [uuid…], "user_id": uuid}
  audience jsonb not null check (audience->>'kind' in ('all', 'no_plan', 'plans', 'user')),
  audience_label text,
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'published', 'withdrawn')),
  publish_at timestamptz,
  published_at timestamptz,
  expires_at timestamptz,
  fanout_done boolean not null default false,
  recipient_count integer not null default 0,
  read_count_final integer,
  withdrawn_at timestamptz,
  withdrawn_by uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_announcements_cta_pair check ((cta_href is null) = (cta_label is null)),
  constraint admin_announcements_expiry check (expires_at is null or publish_at is null or expires_at > publish_at)
);

create index if not exists admin_announcements_due_idx
  on public.admin_announcements (publish_at) where status = 'scheduled';
create index if not exists admin_announcements_fanout_idx
  on public.admin_announcements (published_at) where status = 'published' and not fanout_done;

alter table public.admin_announcements enable row level security;
drop policy if exists admin_announcements_admin on public.admin_announcements;
create policy admin_announcements_admin on public.admin_announcements
  for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
revoke all on public.admin_announcements from anon;

-- Who the announcement went to, fixed at publication.
create table if not exists public.admin_announcement_recipients (
  announcement_id uuid not null references public.admin_announcements(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (announcement_id, user_id)
);
alter table public.admin_announcement_recipients enable row level security;
drop policy if exists admin_announcement_recipients_admin on public.admin_announcement_recipients;
create policy admin_announcement_recipients_admin on public.admin_announcement_recipients
  for select to authenticated using ((select public.is_admin()));
revoke all on public.admin_announcement_recipients from anon;
revoke insert, update, delete on public.admin_announcement_recipients from authenticated;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notifications_announcement_fk') then
    alter table public.notifications
      add constraint notifications_announcement_fk foreign key (announcement_id)
      references public.admin_announcements(id) on delete cascade;
  end if;
end $$;
create unique index if not exists notifications_announcement_user_uniq
  on public.notifications (announcement_id, user_id);

-- The audience, resolved against the plans as they are NOW. A paid plan is a
-- live subscription (active / trialing / past_due — what the app treats as
-- live) to a plan with a price; Free is "no plan".
create or replace function public.announcement_audience_users(p_audience jsonb)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with live as (
    select distinct m.user_id, s.plan_id
      from public.workspace_members m
      join public.subscriptions s
        on s.workspace_id = m.workspace_id and s.status in ('active', 'trialing', 'past_due')
      join public.subscription_plans sp on sp.id = s.plan_id and sp.price_cents > 0
  )
  select p.id
    from public.profiles p
   where case coalesce(p_audience->>'kind', '')
     when 'all' then true
     when 'no_plan' then not exists (select 1 from live l where l.user_id = p.id)
     when 'plans' then exists (
       select 1 from live l
        where l.user_id = p.id
          and l.plan_id::text in (select jsonb_array_elements_text(coalesce(p_audience->'plan_ids', '[]'::jsonb))))
     when 'user' then p.id::text = coalesce(p_audience->>'user_id', '')
     else false
   end
$$;
revoke all on function public.announcement_audience_users(jsonb) from public, anon, authenticated;

create or replace function public.announcement_audience_count(p_audience jsonb)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return (select count(*) from public.announcement_audience_users(p_audience));
end $$;
revoke all on function public.announcement_audience_count(jsonb) from public, anon;
grant execute on function public.announcement_audience_count(jsonb) to authenticated;

-- Scheduled → published: the recipients are fixed here, once.
create or replace function public.announcement_start(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.admin_announcements%rowtype;
begin
  select * into a from public.admin_announcements
   where id = p_id and status = 'scheduled' and coalesce(publish_at, now()) <= now()
   for update;
  if a.id is null then return false; end if;
  if a.expires_at is not null and a.expires_at <= now() then
    -- Its time came and went before it could go out: nothing is sent.
    update public.admin_announcements
       set status = 'published', published_at = now(), fanout_done = true, recipient_count = 0, updated_at = now()
     where id = p_id;
    return true;
  end if;
  insert into public.admin_announcement_recipients (announcement_id, user_id)
    select p_id, u.user_id from public.announcement_audience_users(a.audience) u
  on conflict do nothing;
  update public.admin_announcements
     set status = 'published', published_at = now(), updated_at = now(),
         recipient_count = (select count(*) from public.admin_announcement_recipients r where r.announcement_id = p_id)
   where id = p_id;
  return true;
end $$;
revoke all on function public.announcement_start(uuid) from public, anon, authenticated;

-- One batch of the fan-out. Idempotent: a recipient who already has the row
-- is skipped, and the unique index would refuse a second one anyway.
create or replace function public.announcement_fanout_batch(p_id uuid, p_limit integer default 5000)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.admin_announcements%rowtype;
  v_n integer;
  v_limit integer := greatest(1, least(coalesce(p_limit, 5000), 10000));
begin
  -- The row lock orders this against a withdrawal: whichever comes second
  -- sees the other's result.
  select * into a from public.admin_announcements
   where id = p_id and status = 'published' and not fanout_done
   for update;
  if a.id is null then return 0; end if;
  insert into public.notifications
    (user_id, type, title, body, href, meta, announcement_id, pinned, expires_at, created_at)
  select r.user_id, 'announcement', a.title, a.body, a.cta_href,
         jsonb_build_object('priority', a.priority, 'cta_label', a.cta_label, 'cta_href', a.cta_href),
         a.id, a.priority = 'important', a.expires_at, coalesce(a.published_at, now())
    from public.admin_announcement_recipients r
   where r.announcement_id = a.id
     and not exists (
       select 1 from public.notifications n where n.announcement_id = a.id and n.user_id = r.user_id)
   limit v_limit
  on conflict do nothing;
  get diagnostics v_n = row_count;
  if v_n < v_limit then
    update public.admin_announcements set fanout_done = true, updated_at = now() where id = a.id;
  end if;
  return v_n;
end $$;
revoke all on function public.announcement_fanout_batch(uuid, integer) from public, anon, authenticated;

-- The admin's "Opublikuj teraz": start it (if due) and deliver up to 20 000
-- rows in this call; anything beyond that is finished by the minute tick.
create or replace function public.announcement_process(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total integer := 0;
  v_n integer;
  a public.admin_announcements%rowtype;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  perform public.announcement_start(p_id);
  loop
    v_n := public.announcement_fanout_batch(p_id, 5000);
    v_total := v_total + v_n;
    exit when v_n < 5000 or v_total >= 20000;
  end loop;
  select * into a from public.admin_announcements where id = p_id;
  return jsonb_build_object('status', a.status, 'delivered', v_total,
    'recipients', a.recipient_count, 'done', a.fanout_done);
end $$;
revoke all on function public.announcement_process(uuid) from public, anon;
grant execute on function public.announcement_process(uuid) to authenticated;

create or replace function public.announcement_withdraw(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.admin_announcements%rowtype;
  v_reads integer;
  v_removed integer;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  select * into a from public.admin_announcements where id = p_id for update;
  if a.id is null then return jsonb_build_object('status', 'not_found'); end if;
  if a.status = 'withdrawn' then return jsonb_build_object('status', 'already_withdrawn'); end if;
  select count(*) filter (where read_at is not null) into v_reads
    from public.notifications where announcement_id = p_id;
  update public.admin_announcements
     set status = 'withdrawn', withdrawn_at = now(), withdrawn_by = auth.uid(),
         read_count_final = v_reads, fanout_done = true, updated_at = now()
   where id = p_id;
  delete from public.notifications where announcement_id = p_id;
  get diagnostics v_removed = row_count;
  return jsonb_build_object('status', 'withdrawn', 'removed', v_removed, 'reads', v_reads);
end $$;
revoke all on function public.announcement_withdraw(uuid) from public, anon;
grant execute on function public.announcement_withdraw(uuid) to authenticated;

-- Read figures for the admin's list. Counts only — never whose.
create or replace function public.announcement_stats()
returns table (announcement_id uuid, delivered integer, reads integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return query
    select a.id,
           (select count(*)::integer from public.notifications n where n.announcement_id = a.id),
           case when a.status = 'withdrawn' then coalesce(a.read_count_final, 0)
                else (select count(*)::integer from public.notifications n
                       where n.announcement_id = a.id and n.read_at is not null) end
      from public.admin_announcements a;
end $$;
revoke all on function public.announcement_stats() from public, anon;
grant execute on function public.announcement_stats() to authenticated;

-- ── 6. the bell, in one round trip ─────────────────────────────────────────
-- SECURITY INVOKER: the caller's own RLS decides what it sees.
create or replace function public.notification_bell(p_limit integer default 20)
returns jsonb
language sql
stable
set search_path = public
as $$
  with mine as (
    select id, type, category, title, body, href, meta, read_at, created_at,
           pinned, expires_at, banner_dismissed_at
      from public.notifications
     where user_id = (select auth.uid())
       and (expires_at is null or expires_at > now())
  )
  select jsonb_build_object(
    'important', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.pinned desc, x.created_at desc)
        from (select * from mine where category = 'important'
               order by pinned desc, created_at desc limit greatest(1, least(p_limit, 50))) x), '[]'::jsonb),
    'activity', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.created_at desc)
        from (select * from mine where category = 'activity'
               order by created_at desc limit greatest(1, least(p_limit, 50))) x), '[]'::jsonb),
    'unread', (select count(*) from mine where category = 'important' and read_at is null),
    'banner', (
      select to_jsonb(x) from (
        select id, title, body, href, meta from mine
         where pinned and banner_dismissed_at is null
         order by created_at desc limit 1) x)
  )
$$;
revoke all on function public.notification_bell(integer) from public, anon;
grant execute on function public.notification_bell(integer) to authenticated;

-- ── 7. payments → important ───────────────────────────────────────────────
create or replace function public.notify_payment_failure()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_start timestamptz;
  v_plan text;
  v_kind text;
begin
  if new.event_type <> 'invoice.payment_failed' or new.outcome <> 'failed' or new.workspace_id is null then
    return new;
  end if;
  begin
    select s.status, s.current_period_start, p.name
      into v_status, v_start, v_plan
      from public.subscriptions s
      left join public.subscription_plans p on p.id = s.plan_id
     where s.workspace_id = new.workspace_id
     order by s.created_at desc
     limit 1;
    -- A plan that has already run a period is a renewal that failed; anything
    -- else is the plan's payment itself.
    v_kind := case
      when v_status in ('active', 'trialing', 'past_due', 'unpaid') and v_start < now() - interval '1 day'
        then 'renewal_failed' else 'payment_failed' end;
    insert into public.notifications (user_id, type, title, body, href, meta, dedupe_key)
      select m.user_id, v_kind, v_kind, null, '/credits',
             jsonb_build_object('plan', v_plan), 'stripe:' || new.stripe_event_id
        from public.workspace_members m
       where m.workspace_id = new.workspace_id and m.role in ('owner', 'admin')
    on conflict do nothing;
  exception when others then
    -- Never the webhook's problem: its own row is already written.
    raise warning 'notify_payment_failure: %', sqlerrm;
  end;
  return new;
end $$;
revoke all on function public.notify_payment_failure() from public, anon, authenticated;

drop trigger if exists payment_events_notify_failure on public.payment_events;
create trigger payment_events_notify_failure
  after insert on public.payment_events
  for each row execute function public.notify_payment_failure();

-- ── 8. the schedules ──────────────────────────────────────────────────────
create or replace function public.announcements_cron_tick()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in select id from public.admin_announcements
            where status = 'scheduled' and publish_at <= now()
            order by publish_at limit 20 loop
    perform public.announcement_start(r.id);
  end loop;
  for r in select id from public.admin_announcements
            where status = 'published' and not fanout_done
            order by published_at limit 20 loop
    perform public.announcement_fanout_batch(r.id, 5000);
  end loop;
end $$;
revoke all on function public.announcements_cron_tick() from public, anon, authenticated;

create or replace function public.notifications_hourly_tick()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
  v_expiring integer;
begin
  delete from public.notifications
   where category = 'activity' and created_at < now() - interval '30 days';
  get diagnostics v_deleted = row_count;

  insert into public.notifications (user_id, type, title, body, href, meta, dedupe_key)
    select m.user_id, 'plan_expiring', 'plan_expiring', null, '/credits',
           jsonb_build_object('plan', p.name, 'ends_at', s.current_period_end),
           'plan_expiring:' || s.id || ':' || to_char(s.current_period_end at time zone 'UTC', 'YYYY-MM-DD')
      from public.subscriptions s
      join public.subscription_plans p on p.id = s.plan_id
      join public.workspace_members m on m.workspace_id = s.workspace_id and m.role in ('owner', 'admin')
     where s.cancel_at_period_end
       and s.status in ('active', 'trialing')
       and s.current_period_end > now()
       and s.current_period_end <= now() + interval '3 days'
  on conflict do nothing;
  get diagnostics v_expiring = row_count;
  return jsonb_build_object('activity_deleted', v_deleted, 'plan_expiring', v_expiring);
end $$;
revoke all on function public.notifications_hourly_tick() from public, anon, authenticated;

do $$
declare
  v_existing integer;
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice 'notifications v2: pg_cron is absent; schedule announcements_cron_tick() and notifications_hourly_tick() by other means.';
    return;
  end if;
  execute 'select count(*) from cron.job where jobname = $1' into v_existing using 'grovbase-announcements';
  if v_existing > 0 then execute 'select cron.unschedule($1)' using 'grovbase-announcements'; end if;
  execute 'select cron.schedule($1, $2, $3)'
    using 'grovbase-announcements', '* * * * *', 'select public.announcements_cron_tick();';
  execute 'select count(*) from cron.job where jobname = $1' into v_existing using 'grovbase-notifications-hourly';
  if v_existing > 0 then execute 'select cron.unschedule($1)' using 'grovbase-notifications-hourly'; end if;
  execute 'select cron.schedule($1, $2, $3)'
    using 'grovbase-notifications-hourly', '23 * * * *', 'select public.notifications_hourly_tick();';
exception when others then
  raise notice 'notifications v2: could not schedule (%). Nothing was left half-configured.', sqlerrm;
end $$;

-- ── 9. Ulubione V2: the favourite ring, ON unless an admin turns it off ────
-- In the existing "general" settings row (Zaawansowane → general), so the
-- switch lives with the other appearance settings rather than in a panel of
-- its own. Only added when absent: an admin's choice is never overwritten.
insert into public.app_settings (key, value)
values ('general', '{"favorite_ring": true}'::jsonb)
on conflict (key) do update
  set value = public.app_settings.value || '{"favorite_ring": true}'::jsonb
  where not (public.app_settings.value ? 'favorite_ring');

comment on table public.admin_announcements is
  'Powiadomienia V2: messages an admin sends to an audience (all / no plan / chosen plans / one user). Recipients fixed at publication (admin_announcement_recipients), fanned out to notifications in batches; withdrawn ones are removed from every recipient and kept here.';
