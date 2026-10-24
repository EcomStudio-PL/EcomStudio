-- 0154 — KONTAKT V2: the contact page (one contact_page section).
--
-- GENERATED from lib/cms-seed.ts by `npm run cms:seed-sql -- --contact-v2`.
-- Do not edit by hand: change the TypeScript and regenerate.
--
-- Content only: no table, no column, no function. Channels without a valid
-- link (Instagram and Facebook fall back to Ustawienia → public_site; TikTok
-- and YouTube have none yet), the VAT-invoice FAQ link (no such question on
-- /plany yet) and the company tile (off, empty) are not on the page until
-- they are filled in "Edytuj stronę".
--
-- ORDER: 0152 (tickets) and 0153 (editing) first; the code that renders
-- contact_page must be LIVE before this runs — an older build draws nothing
-- for it, and /kontakt would be a header and a footer.

do $contact$
declare
  v_page uuid;
  v_seo jsonb;
  v_snapshot jsonb;
begin
  insert into public.cms_pages (slug, title, status, kind)
  values ('kontakt', 'Kontakt', 'draft', 'standard')
  on conflict (slug) do nothing;
  select id into v_page from public.cms_pages where slug = 'kontakt';

  if exists (select 1 from public.cms_blocks b where b.page_id = v_page and b.type = 'contact_page') then
    raise notice 'kontakt: already on the Kontakt V2 layout, nothing written';
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
           'Przed Kontakt V2';
  end if;

  -- 2. The new section.
  delete from public.cms_blocks where page_id = v_page;
  insert into public.cms_blocks (page_id, sort_order, type, content, style, anchor, analytics_id)
  select v_page, v.sort_order, v.type, v.content, v.style, v.anchor, v.analytics_id
  from (values
      (0, 'contact_page', '{"badge":{"pl":"KONTAKT","en":"CONTACT","de":"KONTAKT"},"title":{"pl":"Napisz do nas","en":"Write to us","de":"Schreib uns"},"subtitle":{"pl":"Odpowiadamy w ciągu {czas}. Wybierz kanał, który jest dla Ciebie najwygodniejszy.","en":"We reply within {czas}. Choose the channel that suits you best.","de":"Wir antworten innerhalb von {czas}. Wähle den Kanal, der für dich am bequemsten ist."},"items":[{"value":"email","title":{"pl":"E-mail","en":"E-mail","de":"E-Mail"},"description":{"pl":"Napisz bezpośrednio na nasz adres.","en":"Write straight to our address.","de":"Schreib direkt an unsere Adresse."},"url":"mailto:contact@grovbase.com"},{"value":"instagram","title":{"pl":"Instagram","en":"Instagram","de":"Instagram"},"description":{"pl":"Napisz w wiadomości prywatnej","en":"Send us a direct message","de":"Schreib uns eine Direktnachricht"}},{"value":"facebook","title":{"pl":"Facebook","en":"Facebook","de":"Facebook"},"description":{"pl":"Strona GrovBase na Facebooku","en":"GrovBase on Facebook","de":"GrovBase auf Facebook"}},{"value":"tiktok","title":{"pl":"TikTok","en":"TikTok","de":"TikTok"},"description":{"pl":"Zobacz przykłady na żywo","en":"See live examples","de":"Sieh dir Live-Beispiele an"}},{"value":"youtube","title":{"pl":"YouTube","en":"YouTube","de":"YouTube"},"description":{"pl":"Zobacz przykłady na żywo","en":"See live examples","de":"Sieh dir Live-Beispiele an"}}],"tiles":[{"title":{"pl":"Jak działają kredyty?","en":"How do credits work?","de":"Wie funktionieren Credits?"},"url":"/plany#faq-credits"},{"title":{"pl":"Jak kupić dodatkowe kredyty?","en":"How do I buy extra credits?","de":"Wie kaufe ich zusätzliche Credits?"},"url":"/plany#faq-topups"},{"title":{"pl":"Czy subskrypcja odnawia się automatycznie?","en":"Does the subscription renew automatically?","de":"Verlängert sich das Abo automatisch?"},"url":"/plany#faq-renewal"},{"title":{"pl":"Czy istnieje możliwość zwrotu?","en":"Is a refund possible?","de":"Ist eine Erstattung möglich?"},"url":"/plany#faq-refunds"},{"title":{"pl":"Jak otrzymać fakturę VAT?","en":"How do I get a VAT invoice?","de":"Wie erhalte ich eine Rechnung mit MwSt.?"}}],"company":{"hidden":true},"fields":{"reply.time":{"pl":"1 dnia roboczego","en":"1 business day","de":"1 Werktag"},"channels.title":{"pl":"Kanały kontaktu","en":"Contact channels","de":"Kontaktkanäle"},"channel.messenger":{"pl":"Napisz na Messengerze","en":"Message us on Messenger","de":"Schreib uns im Messenger"},"faq.title":{"pl":"Zanim napiszesz, sprawdź odpowiedzi","en":"Before you write, check the answers","de":"Bevor du schreibst: Hier findest du Antworten"},"form.title":{"pl":"Formularz kontaktowy","en":"Contact form","de":"Kontaktformular"},"form.topic":{"pl":"Czego dotyczy wiadomość?","en":"What is your message about?","de":"Worum geht es?"},"topic.app":{"pl":"Pytanie o aplikację","en":"Question about the app","de":"Frage zur App"},"topic.payments":{"pl":"Płatności i faktury","en":"Payments and invoices","de":"Zahlungen und Rechnungen"},"topic.technical":{"pl":"Problem techniczny","en":"Technical problem","de":"Technisches Problem"},"topic.cooperation":{"pl":"Współpraca / większe zamówienia","en":"Partnership / larger orders","de":"Zusammenarbeit / größere Aufträge"},"topic.other":{"pl":"Inne","en":"Other","de":"Sonstiges"},"form.name":{"pl":"Imię (opcjonalnie)","en":"First name (optional)","de":"Vorname (optional)"},"form.email":{"pl":"E-mail","en":"E-mail","de":"E-Mail"},"form.message":{"pl":"Wiadomość","en":"Message","de":"Nachricht"},"form.generation":{"pl":"ID generacji lub link do niej (opcjonalnie)","en":"Generation ID or link to it (optional)","de":"Generierungs-ID oder Link dazu (optional)"},"form.files":{"pl":"Załączniki (opcjonalnie)","en":"Attachments (optional)","de":"Anhänge (optional)"},"form.filesHint":{"pl":"Do 3 plików JPG, PNG lub WebP, maks. 5 MB każdy.","en":"Up to 3 JPG, PNG or WebP files, max. 5 MB each.","de":"Bis zu 3 Dateien (JPG, PNG oder WebP), je max. 5 MB."},"form.nip":{"pl":"NIP (jeśli dotyczy faktury)","en":"Tax ID (if it concerns an invoice)","de":"USt-IdNr. (falls es um eine Rechnung geht)"},"form.consent":{"pl":"Wysyłając wiadomość, zgadzasz się na przetwarzanie podanych danych w celu udzielenia odpowiedzi.","en":"By sending this message you agree to your data being processed so that we can reply.","de":"Mit dem Senden stimmst du der Verarbeitung deiner Daten zur Beantwortung zu."},"form.privacy":{"pl":"Polityka prywatności","en":"Privacy Policy","de":"Datenschutzerklärung"},"form.submit":{"pl":"Wyślij wiadomość","en":"Send message","de":"Nachricht senden"},"form.sending":{"pl":"Wysyłanie…","en":"Sending…","de":"Wird gesendet…"},"success.title":{"pl":"Dziękujemy!","en":"Thank you!","de":"Danke!"},"success.body":{"pl":"Odpowiemy w ciągu {czas}.","en":"We will reply within {czas}.","de":"Wir antworten innerhalb von {czas}."},"success.ticket":{"pl":"Numer zgłoszenia: #{numer}","en":"Ticket number: #{numer}","de":"Ticketnummer: #{numer}"},"success.backHome":{"pl":"Wróć na stronę główną","en":"Back to the home page","de":"Zurück zur Startseite"},"success.backApp":{"pl":"Wróć do aplikacji","en":"Back to the app","de":"Zurück zur App"},"firm.title":{"pl":"Dane firmy","en":"Company details","de":"Firmendaten"},"email.copy":{"pl":"Kopiuj adres","en":"Copy address","de":"Adresse kopieren"},"email.copied":{"pl":"Skopiowano","en":"Copied","de":"Kopiert"}}}'::jsonb, '{"base":{"width":"wide","paddingTop":"lg","paddingBottom":"lg"}}'::jsonb, 'formularz', 'contact.page')
  ) as v(sort_order, type, content, style, anchor, analytics_id);

  -- 3. Menu group, SEO, the site's own chrome.
  v_seo := '{"pl":{"title":"Kontakt — napisz do zespołu GrovBase","description":"Pytanie o aplikację, płatności i faktury, problem techniczny albo współpraca? Napisz do zespołu GrovBase przez formularz lub na contact@grovbase.com."},"en":{"title":"Contact — write to the GrovBase team","description":"A question about the app, payments and invoices, a technical problem or a partnership? Write to the GrovBase team through the form or at contact@grovbase.com."},"de":{"title":"Kontakt — schreib dem GrovBase-Team","description":"Eine Frage zur App, zu Zahlungen und Rechnungen, ein technisches Problem oder eine Zusammenarbeit? Schreib dem GrovBase-Team über das Formular oder an contact@grovbase.com."},"ogImage":"https://grovbase.com/launch/og.jpg"}'::jsonb;
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
    v_snapshot, v_seo, 'publish', 'Kontakt V2'
  );
  update public.cms_pages
     set published_snapshot = v_snapshot,
         status = 'published',
         published_at = now(),
         updated_at = now(),
         scheduled_at = null
   where id = v_page;
end $contact$;
