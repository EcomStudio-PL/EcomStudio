-- 0179 — PLANY V3: the feature lines on the plan cards, edited in „Edytuj stronę”.
--
-- The cards on /plany and /plan list each plan's features in groups
-- (Wyróżnione możliwości, Narzędzia, …) that were fixed in code
-- (components/plan/pricing-config.ts). An admin now edits them PER PLAN:
-- words (pl/en/de), order, hiding, adding and deleting lines, group names,
-- hiding a group. That arrangement is ONE presentation document
-- (components/plan/card-features.ts):
--
--   1. public.pricing_cards — one row (id 'cards'), the document and who
--      changed it when. NO ROW = the code's default: the cards exactly as
--      before. Admins may read the table; nobody may write it directly.
--   2. pricing_cards_published() — what the page reads: the document ONLY
--      (no author, no history), for anyone — /plany is public.
--   3. pricing_cards_write(doc, base, action) — the only writer: an admin, a
--      compare-and-set on updated_at (two tabs never overwrite each other
--      silently), a size cap, and ONE history row in the editor's existing
--      history, public.content_versions (target 'pricing', key 'cards', the
--      whole document before and after) — so a change, a deletion included,
--      can be restored from the history after a refresh.
--   4. content_versions_target_check gains 'pricing' (as 0155 added 'faq'
--      and 0170 'layout'); nothing in the table changes.
--
-- PRESENTATION ONLY. Prices, credits, capabilities, Stripe ids, checkout,
-- top-ups, tranches and webhooks are not read or written here; the document
-- is NOT stored in subscription_plans.features. A line bound to a capability
-- shows the truth the page computes from the plan row — the document cannot
-- turn an unavailable feature into a ✓ (card-features.ts, lineState).
--
-- PURELY ADDITIVE and RE-RUNNABLE: no existing row, table, policy or
-- function is dropped or rewritten (the check constraint is re-created with
-- one more value; every existing row satisfies it).
--
-- ROLLBACK (manual): drop function pricing_cards_write(jsonb, timestamptz, text),
-- pricing_cards_published(); drop table pricing_cards; delete from
-- content_versions where target = 'pricing'; restore the target check to
-- ('text','slot','cms','faq','layout').

set local lock_timeout = '3s';

-- 1 ─────────────────────────────────────────────────────────────────────────
create table if not exists public.pricing_cards (
  id text primary key default 'cards' check (id = 'cards'),
  doc jsonb not null check (jsonb_typeof(doc) = 'object' and octet_length(doc::text) <= 64000),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);
alter table public.pricing_cards enable row level security;

do $policy$ begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'pricing_cards' and policyname = 'pricing_cards_admin_read') then
    create policy pricing_cards_admin_read on public.pricing_cards
      for select to authenticated
      using ((select public.is_admin()));
  end if;
end $policy$;
-- No INSERT / UPDATE / DELETE policy: pricing_cards_write() is the only door.
revoke insert, update, delete on public.pricing_cards from anon, authenticated;

-- 2 ─────────────────────────────────────────────────────────────────────────
create or replace function public.pricing_cards_published()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('doc', c.doc)
    from public.pricing_cards c where c.id = 'cards';
$$;
revoke all on function public.pricing_cards_published() from public;
grant execute on function public.pricing_cards_published() to anon, authenticated;

-- 4 (before 3: the writer inserts target 'pricing') ────────────────────────
alter table public.content_versions drop constraint if exists content_versions_target_check;
alter table public.content_versions add constraint content_versions_target_check
  check (target in ('text', 'slot', 'cms', 'faq', 'layout', 'pricing'));

-- 3 ─────────────────────────────────────────────────────────────────────────
create or replace function public.pricing_cards_write(p_doc jsonb, p_base timestamptz, p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.pricing_cards%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if not public.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  if p_action is null or p_action not in ('save', 'restore') then raise exception 'bad_action'; end if;
  if p_doc is null or jsonb_typeof(p_doc) <> 'object' or (p_doc->>'v') is distinct from '1'
     or jsonb_typeof(p_doc->'plans') is distinct from 'object'
     or octet_length(p_doc::text) > 64000 then
    raise exception 'bad_input';
  end if;

  select * into v_old from public.pricing_cards where id = 'cards' for update;
  -- Compare-and-set: the editor sends the updated_at it last read (null when
  -- it read no row). Anything else is someone else's newer change.
  if found then
    if p_base is null or p_base is distinct from v_old.updated_at then
      raise exception 'conflict' using detail = v_old.updated_at::text;
    end if;
    if v_old.doc = p_doc then raise exception 'noop'; end if;
    update public.pricing_cards set doc = p_doc, updated_at = v_now, updated_by = auth.uid() where id = 'cards';
  else
    if p_base is not null then raise exception 'conflict'; end if;
    insert into public.pricing_cards (id, doc, updated_at, updated_by) values ('cards', p_doc, v_now, auth.uid());
  end if;

  insert into public.content_versions (target, key, locale, action, before, after, created_by)
  values ('pricing', 'cards', null, p_action,
          case when v_old.id is null then null else jsonb_build_object('doc', v_old.doc, 'updated_at', v_old.updated_at) end,
          jsonb_build_object('doc', p_doc, 'updated_at', v_now),
          auth.uid());
  return jsonb_build_object('updated_at', v_now);
end;
$$;
revoke all on function public.pricing_cards_write(jsonb, timestamptz, text) from public, anon;
grant execute on function public.pricing_cards_write(jsonb, timestamptz, text) to authenticated;

comment on table public.pricing_cards is
  'Plany V3: the plan cards'' feature lines an admin arranged per plan in Edytuj stronę (components/plan/card-features.ts). Presentation only. No row = the code default. Written only by pricing_cards_write(); history in content_versions (target pricing).';
