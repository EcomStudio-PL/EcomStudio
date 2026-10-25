-- 0156 — FAQ V1, THE PAGES: /faq gets its section, Kontakt links to it,
-- the footer's "Pomoc" lists it, and O nas stops carrying its own questions.
--
-- GENERATED from lib/faq-seed.ts by `npm run faq:seed-sql -- --pages`. Do not
-- edit by hand: change the TypeScript and regenerate.
--
-- ORDER: 0155 first; the code that reads the FAQ base (faq_page, the new
-- about_faq, faq links on Kontakt) must be LIVE before this runs — an older
-- build draws nothing for faq_page and would show O nas without questions.
--
-- Content only. Each page is kept as it was in a version first ("Przed FAQ
-- V1", restorable in Strony WWW → Historia) and every step is guarded, so a
-- second run changes nothing. The change is made to the draft AND to the
-- published copy separately: an admin's unpublished draft is never published
-- by this file.
--   /faq     its one faq_page section (the page has none today), SEO, and the
--            footer group "Pomoc", right above Kontakt.
--   Kontakt  back in "Pomoc" (0154 had put it under "Firma"); each FAQ link
--            that still points at its old /plany address moves to the same
--            question on /faq; the VAT-invoice link gets its question's
--            address (it shows once that question is published). A link an
--            admin has changed since is left alone.
--   O nas    the about_faq section keeps its heading and loses its own list:
--            its questions are in the base (0155) and the section reads them.

set local lock_timeout = '10s';

-- The Kontakt links, mapped: only a tile still on its old address (or the
-- VAT tile with none) moves. Session-temporary, gone when the migration ends.
create or replace function pg_temp.faq_map_tiles(p_tiles jsonb, p_links jsonb)
returns jsonb
language sql
immutable
as $$
  select case when jsonb_typeof(p_tiles) <> 'array' then p_tiles else (
    select coalesce(jsonb_agg(
             case when l.value is null then t.value
                  else jsonb_set(t.value, '{url}', to_jsonb(l.value ->> 'to')) end
             order by t.ordinality), '[]'::jsonb)
      from jsonb_array_elements(p_tiles) with ordinality t
      left join lateral (
        select x.value from jsonb_array_elements(p_links) x
         where (x.value ->> 'from' is not null and t.value ->> 'url' = x.value ->> 'from')
            or (x.value ->> 'from' is null and coalesce(btrim(t.value ->> 'url'), '') = ''
                and t.value -> 'title' ->> 'pl' = x.value ->> 'title')
         limit 1
      ) l on true
  ) end;
$$;

do $faq_pages$
declare
  v_page uuid;
  v_snapshot jsonb;
  v_links jsonb := '[{"title":"Jak działają kredyty?","from":"/plany#faq-credits","to":"/faq#jak-dzialaja-kredyty"},{"title":"Jak kupić dodatkowe kredyty?","from":"/plany#faq-topups","to":"/faq#jak-kupic-dodatkowe-kredyty"},{"title":"Czy subskrypcja odnawia się automatycznie?","from":"/plany#faq-renewal","to":"/faq#czy-subskrypcja-odnawia-sie-automatycznie"},{"title":"Czy istnieje możliwość zwrotu?","from":"/plany#faq-refunds","to":"/faq#czy-istnieje-mozliwosc-zwrotu"},{"title":"Jak otrzymać fakturę VAT?","from":null,"to":"/faq#czy-otrzymam-fakture-vat"}]'::jsonb;
  v_published jsonb;
begin
  /* ── /faq ─────────────────────────────────────────────────────────────── */
  insert into public.cms_pages (slug, title, status, kind)
  values ('faq', 'FAQ', 'draft', 'standard')
  on conflict (slug) do nothing;
  select id into v_page from public.cms_pages where slug = 'faq';

  if not exists (select 1 from public.cms_blocks b where b.page_id = v_page and b.type = 'faq_page') then
    insert into public.cms_page_versions (page_id, version, snapshot, seo, reason, label)
    select p.id,
           coalesce((select max(v.version) from public.cms_page_versions v where v.page_id = p.id), 0) + 1,
           coalesce(p.published_snapshot, '[]'::jsonb), coalesce(p.seo, '{}'::jsonb), 'manual', 'Przed FAQ V1'
      from public.cms_pages p where p.id = v_page;
    insert into public.cms_blocks (page_id, sort_order, type, content, style, anchor, analytics_id)
    values (v_page, 0, 'faq_page', '{"badge":{"pl":"POMOC","en":"HELP","de":"HILFE"},"title":{"pl":"Najczęstsze pytania","en":"Frequently asked questions","de":"Häufige Fragen"},"subtitle":{"pl":"Nie znalazłeś odpowiedzi?","en":"Didn''t find an answer?","de":"Keine Antwort gefunden?"},"ctaLabel":{"pl":"Napisz do nas","en":"Write to us","de":"Schreib uns"},"ctaUrl":"/kontakt","description":{"pl":"– odpowiadamy w ciągu 1 dnia roboczego.","en":"– we reply within 1 business day.","de":"– wir antworten innerhalb von 1 Werktag."},"cta2Label":{"pl":"Napisz do nas","en":"Write to us","de":"Schreib uns"},"cta2Url":"/kontakt","fields":{"find.placeholder":{"pl":"Szukaj w pytaniach…","en":"Search the questions…","de":"Fragen durchsuchen…"},"find.empty":{"pl":"Nic nie znaleźliśmy.","en":"We found nothing.","de":"Wir haben nichts gefunden."},"find.emptyHint":{"pl":"Napisz do nas","en":"Write to us","de":"Schreib uns"},"find.emptyCta":{"pl":"Kontakt","en":"Contact","de":"Kontakt"},"topics.label":{"pl":"Kategorie pytań","en":"Question categories","de":"Fragenkategorien"},"end.title":{"pl":"Nie znalazłeś odpowiedzi?","en":"Didn''t find an answer?","de":"Keine Antwort gefunden?"},"vote.question":{"pl":"Czy to pomogło?","en":"Did this help?","de":"Hat dir das geholfen?"},"vote.yes":{"pl":"Tak","en":"Yes","de":"Ja"},"vote.no":{"pl":"Nie","en":"No","de":"Nein"},"vote.thanks":{"pl":"Dziękujemy za ocenę!","en":"Thanks for your feedback!","de":"Danke für deine Bewertung!"},"vote.sorry":{"pl":"Dziękujemy. Przykro nam, że ta odpowiedź nie pomogła.","en":"Thank you. We''re sorry this answer didn''t help.","de":"Danke. Schade, dass diese Antwort nicht geholfen hat."},"vote.contact":{"pl":"Napisz do nas","en":"Write to us","de":"Schreib uns"},"link.copy":{"pl":"Kopiuj link","en":"Copy link","de":"Link kopieren"},"link.copied":{"pl":"Skopiowano link","en":"Link copied","de":"Link kopiert"}}}'::jsonb, '{"base":{"paddingTop":"lg","paddingBottom":"lg"}}'::jsonb, null, 'faq.page');
    update public.cms_pages
       set seo = '{"pl":{"title":"FAQ — najczęstsze pytania o GrovBase","description":"Odpowiedzi na najczęstsze pytania o GrovBase: pierwsze kroki, kredyty i plany, płatności, jakość grafik, prawa i dane, konto."},"en":{"title":"FAQ — frequently asked questions about GrovBase","description":"Answers to the most common questions about GrovBase: getting started, credits and plans, payments, image quality, rights and data, your account."},"de":{"title":"FAQ — häufige Fragen zu GrovBase","description":"Antworten auf die häufigsten Fragen zu GrovBase: erste Schritte, Credits und Pläne, Zahlungen, Bildqualität, Rechte und Daten, dein Konto."},"ogImage":"https://grovbase.com/launch/og.jpg"}'::jsonb,
           nav_group = 'help', nav_order = 15,
           header_mode = 'global', footer_mode = 'global', updated_at = now()
     where id = v_page;
    -- What was published stays published; the new section joins it.
    select coalesce(p.published_snapshot, '[]'::jsonb) || coalesce((
             select jsonb_agg(jsonb_build_object(
            'id', b.id, 'type', b.type, 'sort_order', b.sort_order,
            'visible', b.visible, 'content', b.content,
            'style', b.style, 'code', b.code,
            'analytics_id', b.analytics_id, 'anchor', b.anchor,
            'show_from', b.show_from, 'show_until', b.show_until,
            'audience', b.audience
          ))
               from public.cms_blocks b where b.page_id = v_page and b.type = 'faq_page'), '[]'::jsonb)
      into v_snapshot
      from public.cms_pages p where p.id = v_page;
    update public.cms_pages
       set published_snapshot = v_snapshot, status = 'published',
           published_at = now(), updated_at = now(), scheduled_at = null
     where id = v_page;
    insert into public.cms_page_versions (page_id, version, snapshot, seo, reason, label)
    values (
      v_page,
      coalesce((select max(v.version) from public.cms_page_versions v where v.page_id = v_page), 0) + 1,
      v_snapshot, coalesce((select p.seo from public.cms_pages p where p.id = v_page), '{}'::jsonb),
      'publish', 'FAQ V1'
    );
  else
    raise notice 'faq: the faq_page section is already there, nothing written';
  end if;

  /* ── Kontakt ──────────────────────────────────────────────────────────── */
  select id into v_page from public.cms_pages where slug = 'kontakt';
  if v_page is not null then
    update public.cms_pages
       set nav_group = 'help', nav_order = 20, updated_at = now()
     where id = v_page and nav_group is distinct from 'help';

    select coalesce(p.published_snapshot, '[]'::jsonb) into v_published from public.cms_pages p where p.id = v_page;
    select coalesce(jsonb_agg(
             case when e.value ->> 'type' = 'contact_page' and jsonb_typeof(e.value -> 'content' -> 'tiles') = 'array'
                  then jsonb_set(e.value, '{content,tiles}', pg_temp.faq_map_tiles(e.value -> 'content' -> 'tiles', v_links))
                  else e.value end
             order by e.ordinality), '[]'::jsonb)
      into v_snapshot
      from jsonb_array_elements(v_published) with ordinality e;

    if v_snapshot is distinct from v_published then
      insert into public.cms_page_versions (page_id, version, snapshot, seo, reason, label)
      select p.id,
             coalesce((select max(v.version) from public.cms_page_versions v where v.page_id = p.id), 0) + 1,
             coalesce(p.published_snapshot, '[]'::jsonb), coalesce(p.seo, '{}'::jsonb), 'manual', 'Przed FAQ V1'
        from public.cms_pages p where p.id = v_page;
      update public.cms_pages
         set published_snapshot = v_snapshot, status = 'published',
             published_at = now(), updated_at = now(), scheduled_at = null
       where id = v_page;
      insert into public.cms_page_versions (page_id, version, snapshot, seo, reason, label)
      values (
        v_page,
        coalesce((select max(v.version) from public.cms_page_versions v where v.page_id = v_page), 0) + 1,
        v_snapshot, coalesce((select p.seo from public.cms_pages p where p.id = v_page), '{}'::jsonb),
        'publish', 'FAQ V1'
      );
    else
      raise notice 'kontakt: no published FAQ link to move';
    end if;
    -- The draft, on its own: the same links, nothing else touched.
    update public.cms_blocks b
       set content = jsonb_set(b.content, '{tiles}', pg_temp.faq_map_tiles(b.content -> 'tiles', v_links)), updated_at = now()
     where b.page_id = v_page and b.type = 'contact_page' and jsonb_typeof(b.content -> 'tiles') = 'array'
       and pg_temp.faq_map_tiles(b.content -> 'tiles', v_links) is distinct from b.content -> 'tiles';
  end if;

  /* ── O nas ────────────────────────────────────────────────────────────── */
  select id into v_page from public.cms_pages where slug = 'o-nas';
  if v_page is not null then
    select coalesce(p.published_snapshot, '[]'::jsonb) into v_published from public.cms_pages p where p.id = v_page;
    select coalesce(jsonb_agg(
             case when e.value ->> 'type' = 'about_faq' and e.value -> 'content' ? 'items'
                  then jsonb_set(e.value, '{content}', (e.value -> 'content') - 'items')
                  else e.value end
             order by e.ordinality), '[]'::jsonb)
      into v_snapshot
      from jsonb_array_elements(v_published) with ordinality e;

    if v_snapshot is distinct from v_published then
      insert into public.cms_page_versions (page_id, version, snapshot, seo, reason, label)
      select p.id,
             coalesce((select max(v.version) from public.cms_page_versions v where v.page_id = p.id), 0) + 1,
             coalesce(p.published_snapshot, '[]'::jsonb), coalesce(p.seo, '{}'::jsonb), 'manual', 'Przed FAQ V1'
        from public.cms_pages p where p.id = v_page;
      update public.cms_pages
         set published_snapshot = v_snapshot, status = 'published',
             published_at = now(), updated_at = now(), scheduled_at = null
       where id = v_page;
      insert into public.cms_page_versions (page_id, version, snapshot, seo, reason, label)
      values (
        v_page,
        coalesce((select max(v.version) from public.cms_page_versions v where v.page_id = v_page), 0) + 1,
        v_snapshot, coalesce((select p.seo from public.cms_pages p where p.id = v_page), '{}'::jsonb),
        'publish', 'FAQ V1'
      );
    else
      raise notice 'o-nas: about_faq already reads the FAQ base';
    end if;
    update public.cms_blocks set content = content - 'items', updated_at = now()
     where page_id = v_page and type = 'about_faq' and content ? 'items';
  end if;
end $faq_pages$;
