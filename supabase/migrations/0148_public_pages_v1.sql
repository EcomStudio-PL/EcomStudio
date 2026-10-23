-- 0148 — PUBLIC PAGES V1: Kontakt, O nas and the site footer.
--
-- GENERATED from lib/cms-seed.ts by `npm run cms:seed-sql -- --release`. Do
-- not edit by hand: change the TypeScript and regenerate, so the panel's own
-- seed and this file can never disagree.
--
-- APPLY ONLY AFTER the Public pages V1 code is live: the two new section
-- types (page_hero, contact_hub) render as nothing in the previous renderer.
--
-- Rolling back: Strony WWW → O nas / Kontakt → Historia → "Przed Public pages
-- V1" restores the previous layout (Kontakt was a draft before this; O nas was
-- published). The topic list keeps 'question' — harmless to older code, which
-- never sends it.

-- ── 1. THE CONTACT FORM'S TOPICS ─────────────────────────────────────────
-- "Pytanie" joins the closed list (lib/cms-forms.ts CONTACT_TOPICS). The
-- function is 0086's — the same checks, limit and grants — with the one value
-- added; it is still the only way anon reaches contact_messages.
alter table public.contact_messages drop constraint if exists contact_messages_topic_check;
alter table public.contact_messages add constraint contact_messages_topic_check
  check (topic in ('question', 'sales', 'support', 'partnership', 'press', 'other'));

create or replace function public.submit_contact_message(
  p_topic text,
  p_name text,
  p_email text,
  p_message text,
  p_locale text default 'pl',
  p_source text default null,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name text := trim(coalesce(p_name, ''));
  v_message text := trim(coalesce(p_message, ''));
  v_topic text := coalesce(nullif(trim(coalesce(p_topic, '')), ''), 'other');
  v_recent integer;
  v_id uuid;
begin
  if v_email !~ '^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$' then
    return jsonb_build_object('status', 'invalid');
  end if;
  if length(v_message) < 5 or length(v_message) > 4000 then
    return jsonb_build_object('status', 'invalid');
  end if;
  if length(v_name) = 0 or length(v_name) > 120 then
    return jsonb_build_object('status', 'invalid');
  end if;
  if v_topic not in ('question', 'sales', 'support', 'partnership', 'press', 'other') then
    v_topic := 'other';
  end if;

  select count(*) into v_recent from public.contact_messages
    where email = v_email and created_at > now() - interval '1 hour';
  if v_recent >= 5 then
    return jsonb_build_object('status', 'rate_limited');
  end if;

  insert into public.contact_messages (topic, name, email, message, locale, source, metadata)
  values (
    v_topic, left(v_name, 120), left(v_email, 254), left(v_message, 4000),
    coalesce(nullif(p_locale, ''), 'pl'), left(coalesce(p_source, ''), 80),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return jsonb_build_object('status', 'created', 'id', v_id);
end $$;

revoke all on function public.submit_contact_message(text, text, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.submit_contact_message(text, text, text, text, text, text, jsonb)
  to anon, authenticated;

-- ── 2. O nas (/o-nas) — replaced and published ───────────────
do $release$
declare
  v_page uuid;
  v_seo jsonb;
  v_snapshot jsonb;
begin
  insert into public.cms_pages (slug, title, status, kind)
  values ('o-nas', 'O nas', 'draft', 'standard')
  on conflict (slug) do nothing;
  select id into v_page from public.cms_pages where slug = 'o-nas';

  if exists (select 1 from public.cms_blocks b where b.page_id = v_page and b.analytics_id = 'about.hero') then
    raise notice 'o-nas: already on the Public pages V1 layout, nothing written';
    return;
  end if;

  -- 1. Keep what is being replaced.
  if exists (select 1 from public.cms_blocks b where b.page_id = v_page) then
    insert into public.cms_page_versions (page_id, version, snapshot, seo, reason, label)
    select v_page,
           coalesce((select max(v.version) from public.cms_page_versions v where v.page_id = v_page), 0) + 1,
           (select jsonb_agg(jsonb_build_object(
            'id', b.id, 'type', b.type, 'sort_order', b.sort_order,
            'visible', b.visible, 'content', b.content,
            'style', b.style, 'code', b.code,
            'analytics_id', b.analytics_id, 'anchor', b.anchor,
            'show_from', b.show_from, 'show_until', b.show_until,
            'audience', b.audience
          ) order by b.sort_order)
              from public.cms_blocks b where b.page_id = v_page),
           coalesce((select p.seo from public.cms_pages p where p.id = v_page), '{}'::jsonb),
           'manual',
           'Przed Public pages V1';
  end if;

  -- 2. The new sections.
  delete from public.cms_blocks where page_id = v_page;
  insert into public.cms_blocks (page_id, sort_order, type, content, style, anchor, analytics_id)
  select v_page, v.sort_order, v.type, v.content, v.style, v.anchor, v.analytics_id
  from (values
      (0, 'page_hero', '{"badge":{"pl":"POZNAJ GROVBASE","en":"MEET GROVBASE","de":"GROVBASE KENNENLERNEN"},"title":{"pl":"Tworzymy prostszy sposób na profesjonalne zdjęcia produktów.","en":"We are building a simpler way to professional product photos.","de":"Wir schaffen einen einfacheren Weg zu professionellen Produktfotos."},"subtitle":{"pl":"GrovBase to platforma narzędzi AI tworzona z myślą o sprzedawcach e-commerce. Pomagamy przygotowywać atrakcyjne materiały produktowe szybciej, prościej i bez konieczności korzystania z wielu różnych aplikacji.","en":"GrovBase is a platform of AI tools built for e-commerce sellers. We help you prepare attractive product material faster, more simply and without juggling lots of different apps.","de":"GrovBase ist eine Plattform mit KI-Werkzeugen, die für E-Commerce-Händler entwickelt wird. Wir helfen dabei, ansprechendes Produktmaterial schneller und einfacher zu erstellen – ohne viele verschiedene Apps."},"ctaLabel":{"pl":"Zobacz, co tworzymy","en":"See what we build","de":"Sieh dir an, was wir bauen"},"ctaUrl":"#co-tworzymy","cta2Label":{"pl":"Napisz do nas","en":"Write to us","de":"Schreib uns"},"cta2Url":"/kontakt","mediaUrl":"https://orjkxijqpecnbzhxhfct.supabase.co/storage/v1/object/public/media/ice/ecc3dfd8-4a75-49c8-8f95-96c8b2179967/miniaturka.png","media2Url":"https://orjkxijqpecnbzhxhfct.supabase.co/storage/v1/object/public/media/ice/944e755f-208c-4a8b-9552-8f198ae881a1/zestaw.png","alt":{"pl":"Zdjęcie produktu przed i po przygotowaniu miniaturki w GrovBase","en":"A product photo before and after a GrovBase thumbnail","de":"Ein Produktfoto vor und nach dem Thumbnail mit GrovBase"}}'::jsonb, '{"base":{"paddingTop":"lg","paddingBottom":"lg","width":"wide"}}'::jsonb, null, 'about.hero'),
      (1, 'benefits', '{"title":{"pl":"Dlaczego GrovBase?","en":"Why GrovBase?","de":"Warum GrovBase?"},"description":{"pl":"Trzy zasady, według których projektujemy każde narzędzie.","en":"Three principles behind every tool we design.","de":"Drei Grundsätze, nach denen wir jedes Werkzeug gestalten."},"items":[{"icon":"sparkles","title":{"pl":"Prostota","en":"Simplicity","de":"Einfachheit"},"description":{"pl":"Profesjonalne efekty bez skomplikowanej obsługi. Wgrywasz zdjęcie, wybierasz narzędzie i pobierasz gotowy materiał.","en":"Professional results without complicated controls. Upload a photo, choose a tool and download the finished material.","de":"Professionelle Ergebnisse ohne komplizierte Bedienung. Foto hochladen, Werkzeug wählen, fertiges Material herunterladen."}},{"icon":"bag","title":{"pl":"E-commerce","en":"E-commerce","de":"E-Commerce"},"description":{"pl":"Narzędzia projektowane pod potrzeby sprzedawców: miniaturki ofert, białe tło, packshoty i zdjęcia gotowe do marketplace''ów.","en":"Tools designed around what sellers need: listing thumbnails, white backgrounds, packshots and marketplace-ready photos.","de":"Werkzeuge, die auf die Bedürfnisse von Händlern zugeschnitten sind: Angebots-Thumbnails, weißer Hintergrund, Packshots und Marktplatz-taugliche Fotos."}},{"icon":"layers","title":{"pl":"Jedna platforma","en":"One platform","de":"Eine Plattform"},"description":{"pl":"Różne możliwości tworzenia i poprawiania materiałów w jednym miejscu — bez przełączania się między aplikacjami.","en":"Many ways to create and improve your material in one place — without switching between apps.","de":"Viele Möglichkeiten, Material zu erstellen und zu verbessern – an einem Ort, ohne zwischen Apps zu wechseln."}}]}'::jsonb, '{"base":{"columns":3,"paddingTop":"md","width":"wide"}}'::jsonb, 'dlaczego-grovbase', null),
      (2, 'cards', '{"title":{"pl":"Co tworzymy?","en":"What we build","de":"Was wir bauen"},"description":{"pl":"Narzędzia, które działają już w GrovBase — i jedno, nad którym pracujemy.","en":"The tools already working in GrovBase — and one we are still working on.","de":"Die Werkzeuge, die in GrovBase schon funktionieren – und eines, an dem wir noch arbeiten."},"items":[{"title":{"pl":"Retusz AI","en":"AI retouching","de":"KI-Retusche"},"description":{"pl":"Zwykłe zdjęcie produktu w jakości premium packshotu — z zachowaniem kształtu, kolorów i detali.","en":"An ordinary product photo at premium packshot quality — with its shape, colours and details kept.","de":"Ein gewöhnliches Produktfoto in Premium-Packshot-Qualität – Form, Farben und Details bleiben erhalten."},"mediaUrl":"https://orjkxijqpecnbzhxhfct.supabase.co/storage/v1/object/public/media/1790372790079-hf_20260924_232245_bcc9c632-3199-4bf5-9b9a-1bdac998f70e.png","alt":{"pl":"Retusz AI w GrovBase","en":"AI retouching in GrovBase","de":"KI-Retusche in GrovBase"}},{"title":{"pl":"Miniaturki produktowe","en":"Product thumbnails","de":"Produkt-Thumbnails"},"description":{"pl":"Kadr pod pierwsze zdjęcie oferty — czytelny na liście wyników marketplace''u.","en":"The crop for a listing''s first photo — readable in a marketplace''s search results.","de":"Der Bildausschnitt für das erste Angebotsfoto – gut lesbar in den Suchergebnissen eines Marktplatzes."},"mediaUrl":"https://orjkxijqpecnbzhxhfct.supabase.co/storage/v1/object/public/media/1790377334354-hf_20260925_230008_51f45311-b635-4b84-b3d6-4cdf69ee866a.png","alt":{"pl":"Miniaturka produktowa w GrovBase","en":"A product thumbnail in GrovBase","de":"Ein Produkt-Thumbnail in GrovBase"}},{"title":{"pl":"GrovShot","en":"GrovShot","de":"GrovShot"},"description":{"pl":"Sesja produktowa z jednego zdjęcia: studio, światło i sceny pod kampanię.","en":"A product shoot from a single photo: studio, light and campaign scenes.","de":"Ein Produkt-Shooting aus einem einzigen Foto: Studio, Licht und Szenen für die Kampagne."},"mediaUrl":"https://orjkxijqpecnbzhxhfct.supabase.co/storage/v1/object/public/media/1790378392231-hf_20260925_231414_bd183a8c-d321-42b8-8392-c3c8754cdbe9.png","alt":{"pl":"Sesja GrovShot","en":"A GrovShot shoot","de":"Ein GrovShot-Shooting"}},{"title":{"pl":"Edycja zdjęć","en":"Photo editing","de":"Bildbearbeitung"},"description":{"pl":"Edytor, zmiana rozmiaru i kompresja — poprawki bez wychodzenia z GrovBase.","en":"Editor, resizing and compression — touch-ups without leaving GrovBase.","de":"Editor, Größenänderung und Komprimierung – Korrekturen, ohne GrovBase zu verlassen."},"mediaUrl":"https://orjkxijqpecnbzhxhfct.supabase.co/storage/v1/object/public/media/1790290699357-hf_20260924_225653_d6ff4fdc-78c4-4e02-9b06-16cc7fcd371f.png","alt":{"pl":"Edycja zdjęć w GrovBase","en":"Photo editing in GrovBase","de":"Bildbearbeitung in GrovBase"}},{"title":{"pl":"Narzędzia e-commerce","en":"E-commerce tools","de":"E-Commerce-Werkzeuge"},"description":{"pl":"Białe tło, usuwanie tła, tło i cień AI — zdjęcia zgodne z wymaganiami sklepów i marketplace''ów.","en":"White background, background removal, AI background and shadow — photos that meet shop and marketplace requirements.","de":"Weißer Hintergrund, Hintergrund entfernen, KI-Hintergrund und -Schatten – Fotos nach den Vorgaben von Shops und Marktplätzen."},"mediaUrl":"https://orjkxijqpecnbzhxhfct.supabase.co/storage/v1/object/public/media/1790374677683-hf_20260925_221637_cdc9afe9-30fa-4167-b792-95ea51ffe66e.png","alt":{"pl":"Narzędzia e-commerce w GrovBase","en":"E-commerce tools in GrovBase","de":"E-Commerce-Werkzeuge in GrovBase"}},{"title":{"pl":"Sesje modowe","en":"Fashion shoots","de":"Mode-Shootings"},"badge":{"pl":"Wkrótce","en":"Soon","de":"Bald"},"description":{"pl":"Niewidzialny manekin, flat lay i inne narzędzia dla odzieży. Pracujemy nad nimi — jeszcze nie są dostępne.","en":"Ghost mannequin, flat lay and more tools for clothing. We are working on them — they are not available yet.","de":"Unsichtbare Schaufensterpuppe, Flat Lay und weitere Werkzeuge für Bekleidung. Wir arbeiten daran – noch nicht verfügbar."},"mediaUrl":"https://orjkxijqpecnbzhxhfct.supabase.co/storage/v1/object/public/media/1790288192575-hf_20260924_221537_be0ec52c-1e79-4497-b5aa-5af204fd9f13.png","alt":{"pl":"Sesje modowe — wkrótce","en":"Fashion shoots — soon","de":"Mode-Shootings – bald"}}]}'::jsonb, '{"base":{"columns":3,"width":"wide","background":"sunken"}}'::jsonb, 'co-tworzymy', null),
      (3, 'text_image', '{"title":{"pl":"Nasze podejście","en":"Our approach","de":"Unser Ansatz"},"description":{"pl":"GrovBase powstaje po to, aby upraszczać pracę sprzedawców. Zamiast kolejnej skomplikowanej aplikacji — narzędzia, które robią jedną rzecz dobrze: przygotowują zdjęcia produktów do sprzedaży.\n\nNajważniejsza jest dla nas wierność produktu. Kształt, kolory, proporcje i detale muszą zostać zachowane, bo ładne zdjęcie produktu, który w rzeczywistości wygląda inaczej, nie pomaga sprzedawać.\n\nFunkcje, które jeszcze nie działają, oznaczamy jako niedostępne. Nie obiecujemy niczego, czego nie da się dziś użyć.","en":"GrovBase exists to make sellers'' work simpler. Instead of another complicated app — tools that do one thing well: get product photos ready to sell.\n\nWhat matters most to us is product fidelity. Shape, colours, proportions and details have to be kept, because a beautiful photo of a product that looks different in reality does not help anyone sell.\n\nFeatures that do not work yet are marked as unavailable. We do not promise anything you cannot use today.","de":"GrovBase entsteht, um Händlern die Arbeit zu erleichtern. Statt einer weiteren komplizierten App – Werkzeuge, die eine Sache gut machen: Produktfotos verkaufsfertig vorbereiten.\n\nAm wichtigsten ist uns die Produkttreue. Form, Farben, Proportionen und Details müssen erhalten bleiben, denn ein schönes Foto eines Produkts, das in Wirklichkeit anders aussieht, hilft niemandem beim Verkaufen.\n\nFunktionen, die noch nicht funktionieren, kennzeichnen wir als nicht verfügbar. Wir versprechen nichts, was sich heute nicht nutzen lässt."},"alignment":"right"}'::jsonb, '{"base":{"paddingTop":"xl","paddingBottom":"lg","width":"wide"}}'::jsonb, 'nasze-podejscie', null),
      (4, 'cta', '{"title":{"pl":"Zobacz, co możesz stworzyć z GrovBase.","en":"See what you can create with GrovBase.","de":"Sieh dir an, was du mit GrovBase erstellen kannst."},"description":{"pl":"Przykłady efektów znajdziesz na stronie premiery, a plany i pakiety — w cenniku.","en":"You will find example results on the premiere page, and the plans and packs in the pricing.","de":"Beispiele findest du auf der Premierenseite, Pläne und Pakete in der Preisübersicht."},"ctaLabel":{"pl":"Sprawdź możliwości","en":"Explore what it can do","de":"Möglichkeiten entdecken"},"ctaUrl":"/","cta2Label":{"pl":"Zobacz cennik","en":"See pricing","de":"Preise ansehen"},"cta2Url":"/plany"}'::jsonb, '{"base":{"align":"center","background":"gradient","paddingTop":"xl","paddingBottom":"xl"}}'::jsonb, null, 'about.final_cta')
  ) as v(sort_order, type, content, style, anchor, analytics_id);

  -- 3. Menu group, SEO, the site's own chrome.
  v_seo := '{"pl":{"title":"O nas","description":"GrovBase to platforma narzędzi AI dla sprzedawców e-commerce: retusz, miniaturki produktowe, GrovShot i edycja zdjęć w jednym miejscu."},"en":{"title":"About us","description":"GrovBase is a platform of AI tools for e-commerce sellers: retouching, product thumbnails, GrovShot and photo editing in one place."},"de":{"title":"Über uns","description":"GrovBase ist eine Plattform mit KI-Werkzeugen für E-Commerce-Händler: Retusche, Produkt-Thumbnails, GrovShot und Bildbearbeitung an einem Ort."},"ogImage":"https://grovbase.com/launch/og.jpg"}'::jsonb;
  update public.cms_pages
     set nav_group = 'company',
         nav_order = 10,
         seo = v_seo,
         header_mode = 'global',
         footer_mode = 'global',
         updated_at = now()
   where id = v_page;

  -- 4. Publish, as publishPage does: the version first, then the page.
  select jsonb_agg(jsonb_build_object(
            'id', b.id, 'type', b.type, 'sort_order', b.sort_order,
            'visible', b.visible, 'content', b.content,
            'style', b.style, 'code', b.code,
            'analytics_id', b.analytics_id, 'anchor', b.anchor,
            'show_from', b.show_from, 'show_until', b.show_until,
            'audience', b.audience
          ) order by b.sort_order)
    into v_snapshot
    from public.cms_blocks b where b.page_id = v_page;
  insert into public.cms_page_versions (page_id, version, snapshot, seo, reason, label)
  values (
    v_page,
    coalesce((select max(v.version) from public.cms_page_versions v where v.page_id = v_page), 0) + 1,
    v_snapshot, v_seo, 'publish', 'Public pages V1'
  );
  update public.cms_pages
     set published_snapshot = v_snapshot,
         status = 'published',
         published_at = now(),
         updated_at = now(),
         scheduled_at = null
   where id = v_page;
end $release$;

-- ── 2. Kontakt (/kontakt) — replaced and published ───────────────
do $release$
declare
  v_page uuid;
  v_seo jsonb;
  v_snapshot jsonb;
begin
  insert into public.cms_pages (slug, title, status, kind)
  values ('kontakt', 'Kontakt', 'draft', 'standard')
  on conflict (slug) do nothing;
  select id into v_page from public.cms_pages where slug = 'kontakt';

  if exists (select 1 from public.cms_blocks b where b.page_id = v_page and b.analytics_id = 'contact.hero') then
    raise notice 'kontakt: already on the Public pages V1 layout, nothing written';
    return;
  end if;

  -- 1. Keep what is being replaced.
  if exists (select 1 from public.cms_blocks b where b.page_id = v_page) then
    insert into public.cms_page_versions (page_id, version, snapshot, seo, reason, label)
    select v_page,
           coalesce((select max(v.version) from public.cms_page_versions v where v.page_id = v_page), 0) + 1,
           (select jsonb_agg(jsonb_build_object(
            'id', b.id, 'type', b.type, 'sort_order', b.sort_order,
            'visible', b.visible, 'content', b.content,
            'style', b.style, 'code', b.code,
            'analytics_id', b.analytics_id, 'anchor', b.anchor,
            'show_from', b.show_from, 'show_until', b.show_until,
            'audience', b.audience
          ) order by b.sort_order)
              from public.cms_blocks b where b.page_id = v_page),
           coalesce((select p.seo from public.cms_pages p where p.id = v_page), '{}'::jsonb),
           'manual',
           'Przed Public pages V1';
  end if;

  -- 2. The new sections.
  delete from public.cms_blocks where page_id = v_page;
  insert into public.cms_blocks (page_id, sort_order, type, content, style, anchor, analytics_id)
  select v_page, v.sort_order, v.type, v.content, v.style, v.anchor, v.analytics_id
  from (values
      (0, 'page_hero', '{"badge":{"pl":"KONTAKT","en":"CONTACT","de":"KONTAKT"},"title":{"pl":"Porozmawiajmy.","en":"Let''s talk.","de":"Lass uns reden."},"subtitle":{"pl":"Masz pytanie dotyczące GrovBase, potrzebujesz pomocy lub chcesz nawiązać współpracę? Napisz do nas.","en":"Have a question about GrovBase, need help or want to work together? Write to us.","de":"Du hast eine Frage zu GrovBase, brauchst Hilfe oder möchtest mit uns zusammenarbeiten? Schreib uns."}}'::jsonb, '{"base":{"paddingTop":"lg","paddingBottom":"sm","width":"wide"}}'::jsonb, null, 'contact.hero'),
      (1, 'contact_hub', '{"title":{"pl":"Napisz wiadomość","en":"Send us a message","de":"Schreib uns eine Nachricht"},"description":{"pl":"Wiadomość trafi bezpośrednio do zespołu GrovBase. Odpowiemy na adres e-mail podany w formularzu.","en":"Your message goes straight to the GrovBase team. We will reply to the e-mail address you enter.","de":"Deine Nachricht geht direkt an das GrovBase-Team. Wir antworten an die E-Mail-Adresse aus dem Formular."},"formHandler":"contact","ctaLabel":{"pl":"Wyślij wiadomość","en":"Send message","de":"Nachricht senden"},"subtitle":{"pl":"Wysyłając wiadomość, zgadzasz się na przetwarzanie podanych danych w celu udzielenia odpowiedzi.","en":"By sending this message you agree to your data being processed so that we can reply.","de":"Mit dem Senden stimmst du der Verarbeitung deiner Daten zur Beantwortung zu."},"items":[{"value":"question","title":{"pl":"Pytanie","en":"Question","de":"Frage"}},{"value":"support","title":{"pl":"Pomoc techniczna","en":"Technical support","de":"Technischer Support"}},{"value":"partnership","title":{"pl":"Współpraca","en":"Partnership","de":"Zusammenarbeit"}},{"value":"other","title":{"pl":"Inne","en":"Other","de":"Sonstiges"}}],"badge":{"pl":"Szybki kontakt","en":"Quick contact","de":"Schneller Kontakt"},"tiles":[{"icon":"mail","title":{"pl":"Kontakt e-mail","en":"E-mail","de":"E-Mail"},"description":{"pl":"Pytania o GrovBase, konto, płatności i sprawy ogólne.","en":"Questions about GrovBase, your account, payments and general matters.","de":"Fragen zu GrovBase, deinem Konto, Zahlungen und allgemeine Anliegen."},"url":"mailto:contact@grovbase.com"},{"icon":"support","title":{"pl":"Pomoc techniczna","en":"Technical support","de":"Technischer Support"},"description":{"pl":"Coś nie działa? Opisz, czego używasz i co się dzieje. Jeśli masz konto, możesz też napisać z zakładki Pomoc w panelu.","en":"Something not working? Tell us what you were using and what happened. If you have an account, you can also write from Help in the app.","de":"Etwas funktioniert nicht? Beschreib, was du genutzt hast und was passiert ist. Mit Konto kannst du auch über „Hilfe“ in der App schreiben."},"url":"mailto:contact@grovbase.com"},{"icon":"handshake","title":{"pl":"Współpraca biznesowa","en":"Business partnerships","de":"Geschäftliche Zusammenarbeit"},"description":{"pl":"Partnerstwa, integracje, media i propozycje współpracy.","en":"Partnerships, integrations, press and collaboration proposals.","de":"Partnerschaften, Integrationen, Presse und Kooperationsvorschläge."},"url":"mailto:contact@grovbase.com"}]}'::jsonb, '{"base":{"width":"wide","paddingTop":"sm"}}'::jsonb, 'formularz', 'contact.form.submit'),
      (2, 'faq', '{"title":{"pl":"Najczęstsze pytania","en":"Frequently asked questions","de":"Häufige Fragen"},"items":[{"title":{"pl":"Czy muszę mieć konto, żeby napisać?","en":"Do I need an account to write to you?","de":"Brauche ich ein Konto, um zu schreiben?"},"description":{"pl":"Nie. Formularz i adres e-mail są dostępne dla każdego. Odpowiedź wyślemy na adres podany w wiadomości.","en":"No. The form and the e-mail address are open to everyone. We will reply to the address in your message.","de":"Nein. Formular und E-Mail-Adresse stehen allen offen. Wir antworten an die Adresse aus deiner Nachricht."}},{"title":{"pl":"Jak zgłosić problem techniczny?","en":"How do I report a technical problem?","de":"Wie melde ich ein technisches Problem?"},"description":{"pl":"Wybierz temat „Pomoc techniczna” i opisz, czego używasz, co chcesz zrobić i jaki komunikat się pojawia. Jeśli masz konto, podaj adres e-mail, na który jest założone.","en":"Choose the “Technical support” topic and describe what you are using, what you are trying to do and which message appears. If you have an account, give the e-mail address it is registered to.","de":"Wähle das Thema „Technischer Support“ und beschreib, was du nutzt, was du tun möchtest und welche Meldung erscheint. Mit Konto gib bitte die E-Mail-Adresse an, mit der es registriert ist."}},{"title":{"pl":"Gdzie znajdę ceny i plany?","en":"Where can I find prices and plans?","de":"Wo finde ich Preise und Pläne?"},"description":{"pl":"Aktualne plany i pakiety kredytów są w cenniku — link znajdziesz w stopce każdej strony.","en":"The current plans and credit packs are on the pricing page — the link is in the footer of every page.","de":"Die aktuellen Pläne und Credit-Pakete stehen in der Preisübersicht – der Link ist im Footer jeder Seite."}},{"title":{"pl":"Co dzieje się z danymi z formularza?","en":"What happens to the data from the form?","de":"Was passiert mit den Daten aus dem Formular?"},"description":{"pl":"Wykorzystujemy je, aby odpowiedzieć na Twoją wiadomość. Formularz nie zapisuje Cię do newslettera. Zasady przetwarzania danych opisuje Polityka prywatności.","en":"We use it to reply to your message. The form does not sign you up to any newsletter. How data is processed is described in the Privacy policy.","de":"Wir nutzen sie, um deine Nachricht zu beantworten. Das Formular meldet dich bei keinem Newsletter an. Wie Daten verarbeitet werden, steht in der Datenschutzerklärung."}}]}'::jsonb, '{"base":{"width":"narrow","paddingTop":"md"}}'::jsonb, 'faq', null)
  ) as v(sort_order, type, content, style, anchor, analytics_id);

  -- 3. Menu group, SEO, the site's own chrome.
  v_seo := '{"pl":{"title":"Kontakt","description":"Masz pytanie dotyczące GrovBase, potrzebujesz pomocy lub chcesz nawiązać współpracę? Napisz do nas przez formularz albo na contact@grovbase.com."},"en":{"title":"Contact","description":"A question about GrovBase, need help or want to work together? Write to us through the form or at contact@grovbase.com."},"de":{"title":"Kontakt","description":"Eine Frage zu GrovBase, Hilfe nötig oder Interesse an einer Zusammenarbeit? Schreib uns über das Formular oder an contact@grovbase.com."},"ogImage":"https://grovbase.com/launch/og.jpg"}'::jsonb;
  update public.cms_pages
     set nav_group = 'company',
         nav_order = 20,
         seo = v_seo,
         header_mode = 'global',
         footer_mode = 'global',
         updated_at = now()
   where id = v_page;

  -- 4. Publish, as publishPage does: the version first, then the page.
  select jsonb_agg(jsonb_build_object(
            'id', b.id, 'type', b.type, 'sort_order', b.sort_order,
            'visible', b.visible, 'content', b.content,
            'style', b.style, 'code', b.code,
            'analytics_id', b.analytics_id, 'anchor', b.anchor,
            'show_from', b.show_from, 'show_until', b.show_until,
            'audience', b.audience
          ) order by b.sort_order)
    into v_snapshot
    from public.cms_blocks b where b.page_id = v_page;
  insert into public.cms_page_versions (page_id, version, snapshot, seo, reason, label)
  values (
    v_page,
    coalesce((select max(v.version) from public.cms_page_versions v where v.page_id = v_page), 0) + 1,
    v_snapshot, v_seo, 'publish', 'Public pages V1'
  );
  update public.cms_pages
     set published_snapshot = v_snapshot,
         status = 'published',
         published_at = now(),
         updated_at = now(),
         scheduled_at = null
   where id = v_page;
end $release$;

-- ── 3. THE FOOTER — links, column headings, brand line ────────────────────
-- Draft and published copy together (the footer has no separate draft today),
-- and only while neither holds links of its own: an admin's footer is theirs.
update public.cms_global_sections
   set content = coalesce(content, '{}'::jsonb) || '{"subtitle":{"pl":"Narzędzia AI dla e-commerce","en":"AI tools for e-commerce","de":"KI-Werkzeuge für E-Commerce"},"items":[{"title":{"pl":"O nas","en":"About us","de":"Über uns"},"url":"/o-nas","value":"company"},{"title":{"pl":"Kontakt","en":"Contact","de":"Kontakt"},"url":"/kontakt","value":"company"},{"title":{"pl":"Cennik","en":"Pricing","de":"Preise"},"url":"/plany","value":"company"}],"fields":{"group.company":{"pl":"GrovBase","en":"GrovBase","de":"GrovBase"},"group.legal":{"pl":"Informacje","en":"Information","de":"Informationen"}}}'::jsonb,
       published_snapshot = coalesce(published_snapshot, content, '{}'::jsonb) || '{"subtitle":{"pl":"Narzędzia AI dla e-commerce","en":"AI tools for e-commerce","de":"KI-Werkzeuge für E-Commerce"},"items":[{"title":{"pl":"O nas","en":"About us","de":"Über uns"},"url":"/o-nas","value":"company"},{"title":{"pl":"Kontakt","en":"Contact","de":"Kontakt"},"url":"/kontakt","value":"company"},{"title":{"pl":"Cennik","en":"Pricing","de":"Preise"},"url":"/plany","value":"company"}],"fields":{"group.company":{"pl":"GrovBase","en":"GrovBase","de":"GrovBase"},"group.legal":{"pl":"Informacje","en":"Information","de":"Informationen"}}}'::jsonb,
       published_at = now(),
       updated_at = now()
 where slot = 'footer'
   and coalesce(jsonb_array_length(content->'items'), 0) = 0
   and coalesce(jsonb_array_length(published_snapshot->'items'), 0) = 0;
