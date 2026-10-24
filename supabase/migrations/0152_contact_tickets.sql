-- 0152 — KONTAKT V2: the contact form becomes a ticket.
--
-- contact_messages (0086, its topic list widened by 0148) has held every
-- message written through /kontakt — none on PROD when this was written. It
-- stays THE table; this file extends it rather than adding a second inbox:
--
--   1. a ticket number from a sequence (#1001, #1002, …), unique, never
--      reused, and the statuses Nowe / W trakcie / Zamknięte (new /
--      in_progress / closed); the topics of the new form (app / payments /
--      technical / cooperation / other). Old values are mapped, not lost.
--   2. what a ticket carries beyond the message: NIP (payments only), the
--      generation id or link (technical only), the author's account id — set
--      from auth.uid() inside the writer, never from the request — a snapshot
--      of their plan and credits read by the server, the browser, a salted
--      hash of the IP (never the address), the idempotency key of the form
--      submission, and the delivery state of the customer's confirmation.
--   3. contact_attachments: up to three pictures per technical ticket, in a
--      PRIVATE bucket `contact-attachments` (5 MB, JPG/PNG/WebP). A browser
--      may upload only to a path the server reserved for its submission a
--      moment earlier (a random name, 30 minutes); once the ticket is sent the
--      file belongs to it and only an admin can read it. No public URL exists.
--   4. the writers, all SECURITY DEFINER and all behind the server token
--      (server_call_ok, 0077) — so a browser holding the publishable key can
--      call none of them directly, and every request has passed the route's
--      honeypot, schema validation, file sniffing and in-memory limiter first:
--        contact_reserve_uploads   upload slots for one submission
--        contact_submit            the ticket (rate limits, dedupe, binding)
--        contact_confirmation_mark the customer mail's outcome (or an admin)
--        contact_confirmations_due the cron's retry list (claimed, so a retry
--                                  never sends twice at the same time)
--        contact_attachments_expired / _forget  the orphan sweep
--      Rate limits live HERE, in the table, so they hold across every Vercel
--      instance and restart: 5 tickets an hour per address, 10 per IP hash,
--      15 upload slots an hour per IP hash. The same submission retried (a
--      lost response, a double click) answers with the ticket it already
--      created; the same text from the same address within 30 minutes too.
--   5. 0086's submit_contact_message is no longer callable by anon or
--      authenticated: it wrote the old topics, without a ticket number, and
--      was the one way to the table around the route. Kept, not dropped, so a
--      rollback has it.
--
-- RLS. contact_messages keeps its single policy (admin, 0086); anon loses
-- every table privilege on it. contact_attachments: admin read only. Nothing
-- here adds a policy a visitor or a customer can read a ticket through.
--
-- APPLY BEFORE THE CODE DEPLOY that uses it. Between this file and the
-- deploy, the OLD /kontakt form answers an error (its function is revoked) —
-- minutes, on a page that has never received a message.
--
-- ROLLBACK (manual): revert the app code first; then
--   grant execute on function public.submit_contact_message(text, text, text, text, text, text, jsonb) to anon, authenticated;
--   drop the functions created below, the five storage policies
--   contact_attachments_*, table public.contact_attachments; the bucket is
--   emptied through the Storage API and removed in the dashboard. The new
--   columns may stay (all nullable or defaulted); to restore the old CHECKs,
--   map the values back first (app→question, payments→sales,
--   technical→support, cooperation→partnership; in_progress→new,
--   closed→handled).
--
-- After apply, this read-only probe must return 0 rows and no error:
--   begin read only; set local role anon;
--   select count(*) from storage.objects where bucket_id = 'contact-attachments';
--   rollback;

set local lock_timeout = '10s';

-- 1 ─────────────────────────────────────────────────────────────────────────
create sequence if not exists public.contact_ticket_no_seq start with 1001;

alter table public.contact_messages
  add column if not exists ticket_no bigint,
  add column if not exists nip text,
  add column if not exists generation_ref text,
  add column if not exists user_id uuid references public.profiles(id) on delete set null,
  add column if not exists account jsonb not null default '{}'::jsonb,
  add column if not exists client jsonb not null default '{}'::jsonb,
  add column if not exists submission_id uuid,
  add column if not exists ip_hash text,
  add column if not exists message_hash text,
  add column if not exists confirmation_status text not null default 'pending',
  add column if not exists confirmation_attempts integer not null default 0,
  add column if not exists confirmation_at timestamptz,
  add column if not exists confirmation_error text,
  add column if not exists updated_at timestamptz not null default now();

alter sequence public.contact_ticket_no_seq owned by public.contact_messages.ticket_no;
alter table public.contact_messages alter column ticket_no set default nextval('public.contact_ticket_no_seq');
update public.contact_messages set ticket_no = nextval('public.contact_ticket_no_seq') where ticket_no is null;
alter table public.contact_messages alter column ticket_no set not null;
-- An optional name: the form no longer asks for it.
alter table public.contact_messages alter column name set default '';

create unique index if not exists contact_messages_ticket_no_key on public.contact_messages (ticket_no);
create unique index if not exists contact_messages_submission_key on public.contact_messages (submission_id)
  where submission_id is not null;
create index if not exists contact_messages_email_recent_idx on public.contact_messages (email, created_at desc);
create index if not exists contact_messages_ip_recent_idx on public.contact_messages (ip_hash, created_at desc)
  where ip_hash is not null;
create index if not exists contact_messages_created_idx on public.contact_messages (created_at desc);

-- The old values, mapped onto the new lists (0 rows on PROD; DEV may differ).
alter table public.contact_messages drop constraint if exists contact_messages_topic_check;
update public.contact_messages set topic = case topic
    when 'question' then 'app' when 'sales' then 'payments' when 'support' then 'technical'
    when 'partnership' then 'cooperation' when 'press' then 'other' else topic end
  where topic in ('question', 'sales', 'support', 'partnership', 'press');
update public.contact_messages set topic = 'other'
  where topic not in ('app', 'payments', 'technical', 'cooperation', 'other');
alter table public.contact_messages add constraint contact_messages_topic_check
  check (topic in ('app', 'payments', 'technical', 'cooperation', 'other'));

alter table public.contact_messages drop constraint if exists contact_messages_status_check;
update public.contact_messages set status = case status when 'handled' then 'closed' when 'spam' then 'closed' else status end
  where status in ('handled', 'spam');
update public.contact_messages set status = 'new' where status not in ('new', 'in_progress', 'closed');
alter table public.contact_messages add constraint contact_messages_status_check
  check (status in ('new', 'in_progress', 'closed'));

alter table public.contact_messages drop constraint if exists contact_messages_confirmation_check;
alter table public.contact_messages add constraint contact_messages_confirmation_check
  check (confirmation_status in ('pending', 'sending', 'sent', 'failed', 'skipped'));
alter table public.contact_messages drop constraint if exists contact_messages_shape_check;
alter table public.contact_messages add constraint contact_messages_shape_check check (
  length(name) <= 120 and length(email) <= 254 and length(message) <= 5000
  and (nip is null or length(nip) <= 20)
  and (generation_ref is null or length(generation_ref) <= 300)
  and (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$')
  and jsonb_typeof(account) = 'object' and jsonb_typeof(client) = 'object'
);

-- Defence in depth: anon never had a policy here; now it has no privilege
-- either. authenticated keeps its grants under the admin-only policy (0086).
revoke all on table public.contact_messages from anon;
revoke all on sequence public.contact_ticket_no_seq from anon, authenticated;

-- 3 ─────────────────────────────────────────────────────────────────────────
create table if not exists public.contact_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references public.contact_messages(id) on delete cascade,
  submission_id uuid not null,
  object_path text not null unique,
  file_name text,
  mime text,
  size_bytes integer,
  ip_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 minutes',
  bound_at timestamptz,
  constraint contact_attachments_path_check
    check (object_path ~ '^[0-9]{4}-[0-9]{2}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  constraint contact_attachments_mime_check
    check (mime is null or mime in ('image/jpeg', 'image/png', 'image/webp')),
  constraint contact_attachments_size_check
    check (size_bytes is null or size_bytes between 1 and 5242880),
  constraint contact_attachments_name_check
    check (file_name is null or (length(file_name) between 1 and 100 and file_name ~ '^[A-Za-z0-9._ -]+$')),
  constraint contact_attachments_bound_check
    check ((message_id is null) = (bound_at is null))
);
create index if not exists contact_attachments_message_idx on public.contact_attachments (message_id);
create index if not exists contact_attachments_submission_idx on public.contact_attachments (submission_id);
create index if not exists contact_attachments_ip_recent_idx on public.contact_attachments (ip_hash, created_at desc);

alter table public.contact_attachments enable row level security;
revoke all on table public.contact_attachments from anon, authenticated;
grant select on table public.contact_attachments to authenticated;
drop policy if exists contact_attachments_admin_read on public.contact_attachments;
create policy contact_attachments_admin_read on public.contact_attachments for select
  to authenticated using (public.is_admin());

-- What the storage policies ask. Definer: the caller cannot read the table.
-- A path is UPLOADABLE (and readable back by the server that sniffs it) only
-- while it is a reserved, unexpired slot no ticket owns yet.
create or replace function public.contact_attachment_pending(p_name text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.contact_attachments a
     where a.object_path = p_name and a.message_id is null and a.expires_at > now());
$$;

-- REMOVABLE by the visitor's session (a refused file) or the sweep (an
-- orphan): any slot no ticket owns. A bound file is the admin's alone.
create or replace function public.contact_attachment_removable(p_name text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.contact_attachments a
     where a.object_path = p_name and a.message_id is null);
$$;

revoke all on function public.contact_attachment_pending(text) from public;
revoke all on function public.contact_attachment_removable(text) from public;
grant execute on function public.contact_attachment_pending(text) to anon, authenticated;
grant execute on function public.contact_attachment_removable(text) to anon, authenticated;

-- 4 ─────────────────────────────────────────────────────────────────────────
-- Upload slots for one form submission. Each call hands out `p_count` fresh
-- random paths; a submission may hold at most six (three files, retried
-- once), an IP hash at most fifteen an hour.
create or replace function public.contact_reserve_uploads(
  p_token text, p_submission uuid, p_count integer, p_ip_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_held integer;
  v_recent integer;
  v_paths text[] := '{}';
  v_path text;
begin
  if not public.server_call_ok(p_token) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_submission is null or p_count is null or p_count < 1 or p_count > 3
     or p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  if exists (select 1 from public.contact_messages m where m.submission_id = p_submission) then
    return jsonb_build_object('status', 'already_sent');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('contact.reserve:' || p_ip_hash, 0));
  select count(*) into v_held from public.contact_attachments where submission_id = p_submission;
  if v_held + p_count > 6 then return jsonb_build_object('status', 'too_many'); end if;
  select count(*) into v_recent from public.contact_attachments
   where ip_hash = p_ip_hash and created_at > now() - interval '1 hour';
  if v_recent + p_count > 15 then return jsonb_build_object('status', 'rate_limited'); end if;
  for i in 1..p_count loop
    v_path := to_char(now() at time zone 'utc', 'YYYY-MM') || '/' || gen_random_uuid()::text;
    insert into public.contact_attachments (submission_id, object_path, ip_hash)
    values (p_submission, v_path, p_ip_hash);
    v_paths := v_paths || v_path;
  end loop;
  return jsonb_build_object('status', 'ok', 'paths', to_jsonb(v_paths));
end $$;

-- THE TICKET. Every check the route makes is made again here, because this is
-- the boundary: shape, the closed topic list, the fields each topic may
-- carry, the limits, the files. user_id is auth.uid() — the session the
-- route called with — and nothing in the arguments can name another account.
create or replace function public.contact_submit(
  p_token text,
  p_submission uuid,
  p_topic text,
  p_name text,
  p_email text,
  p_message text,
  p_locale text default 'pl',
  p_nip text default null,
  p_generation text default null,
  p_account jsonb default '{}'::jsonb,
  p_client jsonb default '{}'::jsonb,
  p_ip_hash text default null,
  p_attachments jsonb default '[]'::jsonb,
  p_source text default 'kontakt'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_message text := btrim(replace(coalesce(p_message, ''), E'\r\n', E'\n'));
  v_topic text := coalesce(p_topic, '');
  v_nip text := nullif(btrim(coalesce(p_nip, '')), '');
  v_gen text := nullif(btrim(coalesce(p_generation, '')), '');
  v_locale text := case when p_locale in ('pl', 'en', 'de') then p_locale else 'pl' end;
  v_hash text;
  v_files jsonb := coalesce(p_attachments, '[]'::jsonb);
  v_count integer;
  v_bound integer;
  v_row public.contact_messages%rowtype;
  v_file jsonb;
begin
  if not public.server_call_ok(p_token) then raise exception 'not_allowed' using errcode = '42501'; end if;
  if p_submission is null then return jsonb_build_object('status', 'invalid', 'field', 'submission'); end if;

  -- The same submission again (a lost response, a second click): the ticket
  -- it already created — never a second one.
  select * into v_row from public.contact_messages where submission_id = p_submission;
  if found then
    if v_row.email <> v_email then return jsonb_build_object('status', 'invalid', 'field', 'submission'); end if;
    return jsonb_build_object('status', 'created', 'id', v_row.id, 'ticket', v_row.ticket_no, 'duplicate', true);
  end if;

  if v_topic not in ('app', 'payments', 'technical', 'cooperation', 'other') then
    return jsonb_build_object('status', 'invalid', 'field', 'topic');
  end if;
  if length(v_email) > 254 or v_email !~ '^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$' then
    return jsonb_build_object('status', 'invalid', 'field', 'email');
  end if;
  if length(v_name) > 120 or not public.content_text_ok(v_name) then
    return jsonb_build_object('status', 'invalid', 'field', 'name');
  end if;
  if length(v_message) < 10 or length(v_message) > 5000
     or v_message ~ '[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]' then
    return jsonb_build_object('status', 'invalid', 'field', 'message');
  end if;
  -- Each extra belongs to one topic only; anything else is a forged request.
  if v_nip is not null and (v_topic <> 'payments' or length(v_nip) > 20 or v_nip !~ '^([A-Za-z]{2,3} ?)?[0-9][0-9 -]{5,18}[0-9]$') then
    return jsonb_build_object('status', 'invalid', 'field', 'nip');
  end if;
  if v_gen is not null and (v_topic <> 'technical' or length(v_gen) > 300 or not public.content_text_ok(v_gen)) then
    return jsonb_build_object('status', 'invalid', 'field', 'generation');
  end if;
  if jsonb_typeof(v_files) is distinct from 'array' then
    return jsonb_build_object('status', 'invalid', 'field', 'attachments');
  end if;
  if jsonb_array_length(v_files) > 3 or (jsonb_array_length(v_files) > 0 and v_topic <> 'technical') then
    return jsonb_build_object('status', 'invalid', 'field', 'attachments');
  end if;
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('status', 'invalid', 'field', 'client');
  end if;
  if jsonb_typeof(coalesce(p_account, '{}'::jsonb)) is distinct from 'object'
     or jsonb_typeof(coalesce(p_client, '{}'::jsonb)) is distinct from 'object'
     or length(coalesce(p_account, '{}'::jsonb)::text) > 2000
     or length(coalesce(p_client, '{}'::jsonb)::text) > 1000 then
    return jsonb_build_object('status', 'invalid', 'field', 'client');
  end if;

  -- One address at a time, so two parallel sends cannot both pass the limit.
  perform pg_advisory_xact_lock(hashtextextended('contact.submit:' || v_email, 0));
  select * into v_row from public.contact_messages where submission_id = p_submission;
  if found then
    return jsonb_build_object('status', 'created', 'id', v_row.id, 'ticket', v_row.ticket_no, 'duplicate', true);
  end if;

  -- The same words from the same address within half an hour are one ticket.
  v_hash := md5(v_topic || E'\n' || v_message);
  select * into v_row from public.contact_messages
   where email = v_email and message_hash = v_hash and created_at > now() - interval '30 minutes'
   order by created_at desc limit 1;
  if found and jsonb_array_length(v_files) = 0 then
    return jsonb_build_object('status', 'created', 'id', v_row.id, 'ticket', v_row.ticket_no, 'duplicate', true);
  end if;

  select count(*) into v_count from public.contact_messages
   where email = v_email and created_at > now() - interval '1 hour';
  if v_count >= 5 then return jsonb_build_object('status', 'rate_limited'); end if;
  select count(*) into v_count from public.contact_messages
   where ip_hash = p_ip_hash and created_at > now() - interval '1 hour';
  if v_count >= 10 then return jsonb_build_object('status', 'rate_limited'); end if;

  -- Every file must be a slot THIS submission reserved, still open, named
  -- once. One test per statement: the shape is proven before anything casts.
  for v_file in select value from jsonb_array_elements(v_files) loop
    if jsonb_typeof(v_file) is distinct from 'object'
       or jsonb_typeof(v_file -> 'path') is distinct from 'string'
       or jsonb_typeof(v_file -> 'name') is distinct from 'string'
       or jsonb_typeof(v_file -> 'mime') is distinct from 'string'
       or jsonb_typeof(v_file -> 'size') is distinct from 'number' then
      return jsonb_build_object('status', 'invalid', 'field', 'attachments');
    end if;
    if (v_file ->> 'mime') not in ('image/jpeg', 'image/png', 'image/webp')
       or (v_file ->> 'size') !~ '^[1-9][0-9]{0,6}$'
       or length(v_file ->> 'name') not between 1 and 100
       or (v_file ->> 'name') !~ '^[A-Za-z0-9._ -]+$' then
      return jsonb_build_object('status', 'invalid', 'field', 'attachments');
    end if;
    if (v_file ->> 'size')::integer > 5242880
       or not exists (select 1 from public.contact_attachments a
                       where a.object_path = v_file ->> 'path' and a.submission_id = p_submission
                         and a.message_id is null and a.expires_at > now()) then
      return jsonb_build_object('status', 'invalid', 'field', 'attachments');
    end if;
  end loop;
  if (select count(distinct value ->> 'path') from jsonb_array_elements(v_files)) <> jsonb_array_length(v_files) then
    return jsonb_build_object('status', 'invalid', 'field', 'attachments');
  end if;

  insert into public.contact_messages (
    topic, name, email, message, locale, source, metadata, nip, generation_ref, user_id,
    account, client, submission_id, ip_hash, message_hash
  ) values (
    v_topic, v_name, v_email, v_message, v_locale, left(coalesce(p_source, 'kontakt'), 80), '{}'::jsonb,
    case when v_topic = 'payments' then v_nip end,
    case when v_topic = 'technical' then v_gen end,
    v_uid,
    case when v_uid is null then '{}'::jsonb else coalesce(p_account, '{}'::jsonb) end,
    coalesce(p_client, '{}'::jsonb), p_submission, p_ip_hash, v_hash
  )
  returning * into v_row;

  update public.contact_attachments a
     set message_id = v_row.id, bound_at = now(),
         file_name = f.value ->> 'name', mime = f.value ->> 'mime', size_bytes = (f.value ->> 'size')::integer
    from jsonb_array_elements(v_files) f
   where a.object_path = f.value ->> 'path' and a.submission_id = p_submission and a.message_id is null;
  get diagnostics v_bound = row_count;
  if v_bound <> jsonb_array_length(v_files) then raise exception 'attachments_changed'; end if;

  return jsonb_build_object('status', 'created', 'id', v_row.id, 'ticket', v_row.ticket_no, 'duplicate', false);
end $$;

-- The customer confirmation's outcome: the server after a send, the cron
-- after a retry, an admin after "Wyślij ponownie".
create or replace function public.contact_confirmation_mark(
  p_token text, p_id uuid, p_status text, p_error text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.server_call_ok(p_token) or public.is_admin()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('sent', 'failed', 'skipped') then raise exception 'bad_input'; end if;
  update public.contact_messages
     set confirmation_status = p_status,
         confirmation_attempts = confirmation_attempts + 1,
         confirmation_at = now(),
         confirmation_error = case when p_status = 'sent' then null
                                   else left(regexp_replace(coalesce(p_error, ''), '[^A-Za-z0-9_.:-]', '_', 'g'), 120) end,
         updated_at = now()
   where id = p_id;
  if not found then raise exception 'not_found'; end if;
end $$;

-- The cron's retry list: confirmations that failed (at most three attempts,
-- tickets younger than three days) or never ran. Each row is CLAIMED
-- ('sending') under a skip-locked lock, so two runs cannot send it twice; a
-- claim older than 30 minutes is a run that died, and is claimable again.
create or replace function public.contact_confirmations_due(p_token text, p_limit integer default 10)
returns table (id uuid, ticket_no bigint, email text, topic text, message text, locale text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.server_call_ok(p_token) then raise exception 'not_allowed' using errcode = '42501'; end if;
  return query
  with due as (
    select m.id from public.contact_messages m
     where m.created_at > now() - interval '3 days'
       and m.confirmation_attempts < 3
       and (m.confirmation_status = 'failed'
            or (m.confirmation_status = 'pending' and m.created_at < now() - interval '10 minutes')
            or (m.confirmation_status = 'sending' and m.updated_at < now() - interval '30 minutes'))
     order by m.created_at
     limit greatest(1, least(coalesce(p_limit, 10), 25))
     for update skip locked
  ), claimed as (
    update public.contact_messages m set confirmation_status = 'sending', updated_at = now()
      from due where m.id = due.id
    returning m.id, m.ticket_no, m.email, m.topic, m.message, m.locale
  )
  select c.id, c.ticket_no, c.email, c.topic, c.message, c.locale from claimed c;
end $$;

-- The orphan sweep: slots no ticket took, an hour past their expiry. The
-- cron removes the objects through the Storage API (the delete policy below
-- allows exactly these), then forgets the rows.
create or replace function public.contact_attachments_expired(p_token text, p_limit integer default 50)
returns setof text
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.server_call_ok(p_token) then raise exception 'not_allowed' using errcode = '42501'; end if;
  return query
    select a.object_path from public.contact_attachments a
     where a.message_id is null and a.expires_at < now() - interval '1 hour'
     order by a.created_at
     limit greatest(1, least(coalesce(p_limit, 50), 100));
end $$;

create or replace function public.contact_attachments_forget(p_token text, p_paths text[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if not public.server_call_ok(p_token) then raise exception 'not_allowed' using errcode = '42501'; end if;
  delete from public.contact_attachments a
   where a.object_path = any(coalesce(p_paths, '{}')) and a.message_id is null and a.expires_at < now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.contact_reserve_uploads(text, uuid, integer, text) from public;
revoke all on function public.contact_submit(text, uuid, text, text, text, text, text, text, text, jsonb, jsonb, text, jsonb, text) from public;
revoke all on function public.contact_confirmation_mark(text, uuid, text, text) from public;
revoke all on function public.contact_confirmations_due(text, integer) from public;
revoke all on function public.contact_attachments_expired(text, integer) from public;
revoke all on function public.contact_attachments_forget(text, text[]) from public;
-- anon and authenticated may CALL them; server_call_ok inside is the gate
-- (the 0102 shape: the route and the cron run with the publishable key).
grant execute on function public.contact_reserve_uploads(text, uuid, integer, text) to anon, authenticated;
grant execute on function public.contact_submit(text, uuid, text, text, text, text, text, text, text, jsonb, jsonb, text, jsonb, text) to anon, authenticated;
grant execute on function public.contact_confirmation_mark(text, uuid, text, text) to anon, authenticated;
grant execute on function public.contact_confirmations_due(text, integer) to anon, authenticated;
grant execute on function public.contact_attachments_expired(text, integer) to anon, authenticated;
grant execute on function public.contact_attachments_forget(text, text[]) to anon, authenticated;

-- 5 ─────────────────────────────────────────────────────────────────────────
revoke execute on function public.submit_contact_message(text, text, text, text, text, text, jsonb) from public, anon, authenticated;

-- 3 (storage) ───────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contact-attachments', 'contact-attachments', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists contact_attachments_upload on storage.objects;
create policy contact_attachments_upload on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'contact-attachments' and public.contact_attachment_pending(name));

drop policy if exists contact_attachments_read_pending on storage.objects;
create policy contact_attachments_read_pending on storage.objects for select to anon, authenticated
  using (bucket_id = 'contact-attachments' and public.contact_attachment_pending(name));

drop policy if exists contact_attachments_remove_unbound on storage.objects;
create policy contact_attachments_remove_unbound on storage.objects for delete to anon, authenticated
  using (bucket_id = 'contact-attachments' and public.contact_attachment_removable(name));

drop policy if exists contact_attachments_admin_read on storage.objects;
create policy contact_attachments_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'contact-attachments' and public.is_admin());

drop policy if exists contact_attachments_admin_delete on storage.objects;
create policy contact_attachments_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'contact-attachments' and public.is_admin());

comment on table public.contact_attachments is
  'Kontakt V2: pictures attached to a technical ticket, in the private bucket contact-attachments. Reserved by the server, uploaded by the browser to that exact path, bound to the ticket by contact_submit; admin read only.';
comment on function public.contact_submit(text, uuid, text, text, text, text, text, text, text, jsonb, jsonb, text, jsonb, text) is
  'Kontakt V2: create one ticket. Server token only; user_id = auth.uid(); DB rate limits per address and IP hash; idempotent per submission; binds the submission''s reserved attachments.';
