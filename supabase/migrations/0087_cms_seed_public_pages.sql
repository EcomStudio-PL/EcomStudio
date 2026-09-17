-- THE PUBLIC WEBSITE, SEEDED AS DRAFTS.
--
-- Generated from lib/cms-seed.ts by scripts/cms-seed-sql.ts. Do not edit by
-- hand: edit the TypeScript and regenerate, or the panel's own "Utwórz strony
-- startowe" button will disagree with this file.
--
-- NOTHING HERE PUBLISHES ANYTHING. Every page is created as a draft, the
-- homepage mode is not touched, and the waiting-list page stays the public
-- front door. A page that already exists is left alone; sections are added
-- only to a page that has none.

-- ── Strona główna (/home) ──────────────────────────────────────────
insert into public.cms_pages (slug, title, status, kind, nav_group, nav_order, seo)
values ('home', 'Strona główna', 'draft', 'standard',
        null, 0, '{"pl":{"title":"GrovBase — zdjęcia produktowe, które sprzedają","description":"Zamień kilka zdjęć produktu w gotowe materiały sprzedażowe: packshoty, sesje lifestyle i kreacje reklamowe. Bez studia, bez fotografa, bez czekania."},"en":{"title":"GrovBase — product photography that sells","description":"Turn a few product photos into finished sales material: packshots, lifestyle shoots and ad creative. No studio, no photographer, no waiting."},"de":{"title":"GrovBase — Produktfotos, die verkaufen","description":"Aus wenigen Produktfotos werden fertige Verkaufsmaterialien: Packshots, Lifestyle-Shootings und Werbemotive. Ohne Studio, ohne Fotograf, ohne Wartezeit."}}'::jsonb)
on conflict (slug) do nothing;

insert into public.cms_page_versions (page_id, version, snapshot, seo, reason, label)
select p.id,
       coalesce((select max(v.version) from public.cms_page_versions v where v.page_id = p.id), 0) + 1,
       coalesce(
         (select jsonb_agg(jsonb_build_object(
            'id', b.id, 'type', b.type, 'sort_order', b.sort_order,
            'visible', b.visible, 'content', b.content,
            'style', b.style, 'code', b.code,
            'analytics_id', b.analytics_id, 'anchor', b.anchor
          ) order by b.sort_order)
          from public.cms_blocks b where b.page_id = p.id),
         '[]'::jsonb),
       coalesce(p.seo, '{}'::jsonb),
       'manual',
       'poprzedni układ strony głównej'
from public.cms_pages p
where p.slug = 'home'
  and exists (select 1 from public.cms_blocks b where b.page_id = p.id)
  and not exists (select 1 from public.cms_blocks b where b.page_id = p.id and b.analytics_id = 'homepage.hero.cta');

delete from public.cms_blocks b
using public.cms_pages p
where b.page_id = p.id and p.slug = 'home'
  and not exists (select 1 from public.cms_blocks b where b.page_id = p.id and b.analytics_id = 'homepage.hero.cta');

insert into public.cms_blocks (page_id, sort_order, type, content, style, anchor, analytics_id)
select p.id, v.sort_order, v.type, v.content, v.style, v.anchor, v.analytics_id
from public.cms_pages p
cross join (values
    (0, 'hero', '{"badge":{"pl":"AI DLA E-COMMERCE","en":"AI FOR E-COMMERCE","de":"KI FÜR E-COMMERCE"},"title":{"pl":"Twój produkt. Sesja zdjęciowa, której nigdy nie musiałeś zamawiać.","en":"Your product. The photo shoot you never had to book.","de":"Dein Produkt. Das Shooting, das du nie buchen musstest."},"subtitle":{"pl":"Wgraj kilka zwykłych zdjęć. GrovBase zwraca packshoty, ujęcia lifestyle i kreacje reklamowe — z zachowaniem kształtu, kolorów i detali Twojego produktu.","en":"Upload a few ordinary photos. GrovBase returns packshots, lifestyle shots and ad creative — with your product''s shape, colours and details intact.","de":"Lade ein paar gewöhnliche Fotos hoch. GrovBase liefert Packshots, Lifestyle-Aufnahmen und Werbemotive — Form, Farben und Details deines Produkts bleiben erhalten."},"ctaLabel":{"pl":"Zacznij za darmo","en":"Start for free","de":"Kostenlos starten"},"ctaUrl":"/register","cta2Label":{"pl":"Zobacz efekty","en":"See the results","de":"Ergebnisse ansehen"},"cta2Url":"#efekty"}'::jsonb, '{"base":{"paddingTop":"xl","paddingBottom":"lg","width":"wide"}}'::jsonb, null, 'homepage.hero.cta'),
    (1, 'showcase', '{"title":{"pl":"Efekty, nie obietnice","en":"Results, not promises","de":"Ergebnisse statt Versprechen"},"description":{"pl":"Każde z tych zdjęć powstało z jednego zwykłego zdjęcia produktu.","en":"Every one of these started life as one ordinary product photo.","de":"Jedes dieser Bilder entstand aus einem gewöhnlichen Produktfoto."},"items":[]}'::jsonb, '{"base":{"width":"wide"}}'::jsonb, 'efekty', null),
    (2, 'use_cases', '{"title":{"pl":"Dla kogo jest GrovBase","en":"Who GrovBase is for","de":"Für wen GrovBase gedacht ist"},"items":[{"title":{"pl":"Allegro","en":"Allegro","de":"Allegro"}},{"title":{"pl":"Amazon","en":"Amazon","de":"Amazon"}},{"title":{"pl":"Sklepy internetowe","en":"Online shops","de":"Onlineshops"}},{"title":{"pl":"Marki własne","en":"Own brands","de":"Eigenmarken"}},{"title":{"pl":"Importerzy","en":"Importers","de":"Importeure"}},{"title":{"pl":"Hurtownie","en":"Wholesalers","de":"Großhändler"}}]}'::jsonb, '{}'::jsonb, null, null),
    (3, 'tools_grid', '{"title":{"pl":"Narzędzia, które robią robotę","en":"The tools that do the work","de":"Werkzeuge, die die Arbeit machen"},"description":{"pl":"Każde z nich działa na Twoich własnych zdjęciach.","en":"Every one of them works on your own photographs.","de":"Jedes davon arbeitet mit deinen eigenen Fotos."},"filter":["image","edit"]}'::jsonb, '{"base":{"width":"wide"}}'::jsonb, null, null),
    (4, 'models', '{"title":{"pl":"Silniki, na których to działa","en":"The engines behind it","de":"Die Engines dahinter"},"description":{"pl":"Wybieramy model do zadania, a nie zadanie do modelu.","en":"We pick the model for the job, not the job for the model.","de":"Wir wählen das Modell zur Aufgabe, nicht die Aufgabe zum Modell."}}'::jsonb, '{}'::jsonb, null, null),
    (5, 'workflow', '{"title":{"pl":"Jak to działa","en":"How it works","de":"So funktioniert es"},"items":[{"title":{"pl":"Wgraj zdjęcia","en":"Upload your photos","de":"Fotos hochladen"},"description":{"pl":"Zwykłe zdjęcia z telefonu wystarczą. Im więcej ujęć, tym lepiej AI rozumie produkt.","en":"Ordinary phone photos are enough. The more angles, the better the AI understands the product.","de":"Gewöhnliche Handyfotos genügen. Je mehr Perspektiven, desto besser versteht die KI das Produkt."}},{"title":{"pl":"Wybierz efekt","en":"Choose the result","de":"Ergebnis wählen"},"description":{"pl":"Packshot, sesja lifestyle, kreacja reklamowa albo Twój własny opis sceny.","en":"A packshot, a lifestyle shoot, ad creative — or your own description of the scene.","de":"Packshot, Lifestyle-Shooting, Werbemotiv — oder deine eigene Szenenbeschreibung."}},{"title":{"pl":"Pobierz i sprzedawaj","en":"Download and sell","de":"Herunterladen und verkaufen"},"description":{"pl":"Gotowe pliki w formatach pod Allegro, Amazon, sklep i social media.","en":"Finished files sized for Allegro, Amazon, your shop and social media.","de":"Fertige Dateien in den Formaten für Allegro, Amazon, Shop und Social Media."}}]}'::jsonb, '{"base":{"columns":3,"background":"sunken"}}'::jsonb, null, null),
    (6, 'before_after', '{"title":{"pl":"Przed i po","en":"Before and after","de":"Vorher und nachher"},"description":{"pl":"Ten sam produkt. Różnica jest w tym, co widzi kupujący.","en":"The same product. The difference is what the buyer sees.","de":"Dasselbe Produkt. Der Unterschied ist, was der Käufer sieht."}}'::jsonb, '{"base":{"width":"wide"}}'::jsonb, null, null),
    (7, 'product_lock', '{"badge":{"pl":"PRODUCT LOCK","en":"PRODUCT LOCK","de":"PRODUCT LOCK"},"title":{"pl":"Twój produkt zostaje Twoim produktem","en":"Your product stays your product","de":"Dein Produkt bleibt dein Produkt"},"description":{"pl":"Generator, który „poprawia” kształt butelki albo dokłada guzik, jest bezużyteczny w e-commerce. Każde zlecenie niesie ze sobą opis wierności produktu, a wynik jest sprawdzany pod jego kątem.","en":"A generator that “improves” the shape of a bottle or adds a button is useless in e-commerce. Every request carries a product-fidelity instruction, and the result is checked against it.","de":"Ein Generator, der die Form einer Flasche „verbessert“ oder einen Knopf hinzufügt, ist im E-Commerce nutzlos. Jede Anfrage trägt eine Produkttreue-Anweisung, und das Ergebnis wird daran geprüft."},"items":[{"title":{"pl":"Kształt i proporcje","en":"Shape and proportions","de":"Form und Proportionen"}},{"title":{"pl":"Kolory","en":"Colours","de":"Farben"}},{"title":{"pl":"Liczba sztuk","en":"Item count","de":"Stückzahl"}},{"title":{"pl":"Etykiety i napisy","en":"Labels and text","de":"Etiketten und Aufschriften"}},{"title":{"pl":"Materiał","en":"Material","de":"Material"}},{"title":{"pl":"Skala","en":"Scale","de":"Maßstab"}}]}'::jsonb, '{}'::jsonb, null, null),
    (8, 'testimonials', '{"title":{"pl":"Co mówią sprzedawcy","en":"What sellers say","de":"Was Verkäufer sagen"},"items":[]}'::jsonb, '{"base":{"width":"wide"}}'::jsonb, null, null),
    (9, 'pricing_table', '{"title":{"pl":"Proste ceny","en":"Simple pricing","de":"Einfache Preise"},"description":{"pl":"Płacisz za wygenerowane materiały, nie za dostęp.","en":"You pay for the material you generate, not for access.","de":"Du zahlst für erzeugte Materialien, nicht für den Zugang."},"ctaLabel":{"pl":"Wybierz plan","en":"Choose a plan","de":"Plan wählen"},"ctaUrl":"/cennik"}'::jsonb, '{"base":{"width":"wide"}}'::jsonb, 'cennik', null),
    (10, 'faq', '{"title":{"pl":"Najczęstsze pytania","en":"Frequently asked","de":"Häufige Fragen"},"items":[{"title":{"pl":"Czy zdjęcia z telefonu wystarczą?","en":"Are phone photos good enough?","de":"Reichen Handyfotos aus?"},"description":{"pl":"Tak. Potrzebny jest ostry produkt na w miarę równym tle. Reszta to już zadanie GrovBase.","en":"Yes. What is needed is a sharp product on a reasonably even background. The rest is GrovBase''s job.","de":"Ja. Nötig ist ein scharfes Produkt vor einem einigermaßen gleichmäßigen Hintergrund. Den Rest übernimmt GrovBase."}},{"title":{"pl":"Czy produkt na zdjęciu będzie wyglądał jak mój?","en":"Will the product look like mine?","de":"Sieht das Produkt aus wie meines?"},"description":{"pl":"To jest cały sens Product Lock. Kształt, kolory, liczba sztuk, etykiety i materiał są chronione, a wynik dostaje ocenę zgodności z oryginałem.","en":"That is the entire point of Product Lock. Shape, colours, item count, labels and material are protected, and the result is scored against the original.","de":"Genau dafür gibt es Product Lock. Form, Farben, Stückzahl, Etiketten und Material sind geschützt, und das Ergebnis wird mit dem Original abgeglichen."}},{"title":{"pl":"Czy mogę używać tych zdjęć komercyjnie?","en":"Can I use the images commercially?","de":"Darf ich die Bilder kommerziell nutzen?"},"description":{"pl":"Tak — po to powstały. Szczegóły znajdziesz w Regulaminie.","en":"Yes — that is what they are for. The details are in the Terms.","de":"Ja — dafür sind sie gemacht. Die Details stehen in den AGB."}}]}'::jsonb, '{}'::jsonb, 'faq', null),
    (11, 'cta', '{"title":{"pl":"Zobacz, jak wygląda Twój produkt w dobrym świetle","en":"See what your product looks like in a good light","de":"Sieh dein Produkt im richtigen Licht"},"description":{"pl":"Załóż konto i wygeneruj pierwszą sesję w kilka minut.","en":"Create an account and generate your first shoot in minutes.","de":"Konto erstellen und das erste Shooting in wenigen Minuten erzeugen."},"ctaLabel":{"pl":"Zacznij za darmo","en":"Start for free","de":"Kostenlos starten"},"ctaUrl":"/register"}'::jsonb, '{"base":{"background":"gradient","align":"center","paddingTop":"xl","paddingBottom":"xl"}}'::jsonb, null, 'homepage.final_cta.register')
) as v(sort_order, type, content, style, anchor, analytics_id)
where p.slug = 'home'
  -- Only a page nobody has arranged yet. (For the homepage the delete above
  -- has just emptied it, so this is what makes the replace idempotent too.)
  and not exists (select 1 from public.cms_blocks b where b.page_id = p.id);

-- ── Narzędzia (/narzedzia) ──────────────────────────────────────────
insert into public.cms_pages (slug, title, status, kind, nav_group, nav_order, seo)
values ('narzedzia', 'Narzędzia', 'draft', 'standard',
        'main', 10, '{"pl":{"title":"Narzędzia GrovBase","description":"Wszystkie narzędzia GrovBase w jednym miejscu: generowanie zdjęć produktowych, retusz, usuwanie tła, zmiana formatu, kompresja i więcej."},"en":{"title":"GrovBase tools","description":"Every GrovBase tool in one place: product image generation, retouching, background removal, resizing, compression and more."},"de":{"title":"GrovBase-Werkzeuge","description":"Alle GrovBase-Werkzeuge an einem Ort: Produktbild-Generierung, Retusche, Freistellen, Formatwechsel, Komprimierung und mehr."}}'::jsonb)
on conflict (slug) do nothing;

insert into public.cms_blocks (page_id, sort_order, type, content, style, anchor, analytics_id)
select p.id, v.sort_order, v.type, v.content, v.style, v.anchor, v.analytics_id
from public.cms_pages p
cross join (values
    (0, 'hero', '{"title":{"pl":"Wszystko, co robisz ze zdjęciem produktu","en":"Everything you do to a product photo","de":"Alles, was du mit einem Produktfoto machst"},"subtitle":{"pl":"Od pierwszego ujęcia do pliku gotowego na marketplace.","en":"From the first shot to a file ready for the marketplace.","de":"Vom ersten Foto bis zur marktplatzfertigen Datei."}}'::jsonb, '{"base":{"paddingTop":"lg","paddingBottom":"sm","align":"center","width":"narrow"}}'::jsonb, null, null),
    (1, 'tools_grid', '{"title":{"pl":"Obraz","en":"Image","de":"Bild"},"filter":["image"]}'::jsonb, '{"base":{"width":"wide","columns":3}}'::jsonb, null, null),
    (2, 'tools_grid', '{"title":{"pl":"Edycja","en":"Editing","de":"Bearbeitung"},"filter":["edit"]}'::jsonb, '{"base":{"width":"wide","columns":3}}'::jsonb, null, null),
    (3, 'tools_grid', '{"title":{"pl":"Tworzenie","en":"Creation","de":"Erstellung"},"filter":["create"]}'::jsonb, '{"base":{"width":"wide","columns":3}}'::jsonb, null, null),
    (4, 'tools_grid', '{"title":{"pl":"Wideo","en":"Video","de":"Video"},"filter":["video"]}'::jsonb, '{"base":{"width":"wide","columns":3}}'::jsonb, null, null),
    (5, 'cta', '{"title":{"pl":"Wypróbuj na swoim produkcie","en":"Try it on your own product","de":"Probiere es an deinem Produkt"},"ctaLabel":{"pl":"Zacznij za darmo","en":"Start for free","de":"Kostenlos starten"},"ctaUrl":"/register"}'::jsonb, '{"base":{"background":"soft","align":"center"}}'::jsonb, null, null)
) as v(sort_order, type, content, style, anchor, analytics_id)
where p.slug = 'narzedzia'
  -- Only a page nobody has arranged yet. (For the homepage the delete above
  -- has just emptied it, so this is what makes the replace idempotent too.)
  and not exists (select 1 from public.cms_blocks b where b.page_id = p.id);

-- ── Cennik (/cennik) ──────────────────────────────────────────
insert into public.cms_pages (slug, title, status, kind, nav_group, nav_order, seo)
values ('cennik', 'Cennik', 'draft', 'standard',
        'main', 20, '{"pl":{"title":"Cennik GrovBase","description":"Plany i kredyty GrovBase. Płacisz za wygenerowane materiały, nie za sam dostęp."},"en":{"title":"GrovBase pricing","description":"GrovBase plans and credits. You pay for the material you generate, not for access."},"de":{"title":"GrovBase-Preise","description":"GrovBase-Pläne und Credits. Du zahlst für erzeugte Materialien, nicht für den Zugang."}}'::jsonb)
on conflict (slug) do nothing;

insert into public.cms_blocks (page_id, sort_order, type, content, style, anchor, analytics_id)
select p.id, v.sort_order, v.type, v.content, v.style, v.anchor, v.analytics_id
from public.cms_pages p
cross join (values
    (0, 'hero', '{"title":{"pl":"Płacisz za efekt","en":"You pay for the result","de":"Du zahlst für das Ergebnis"},"subtitle":{"pl":"Kredyty zużywają się przy generowaniu. Narzędzia edycyjne, biblioteka i eksport są w każdym planie.","en":"Credits are spent on generation. The editing tools, the library and export are in every plan.","de":"Credits werden beim Generieren verbraucht. Bearbeitungswerkzeuge, Bibliothek und Export sind in jedem Plan enthalten."}}'::jsonb, '{"base":{"paddingTop":"lg","paddingBottom":"sm","align":"center","width":"narrow"}}'::jsonb, null, null),
    (1, 'pricing_table', '{"ctaLabel":{"pl":"Wybierz","en":"Choose","de":"Wählen"},"ctaUrl":"/register"}'::jsonb, '{"base":{"width":"wide"}}'::jsonb, null, null),
    (2, 'faq', '{"title":{"pl":"Pytania o rozliczenia","en":"Billing questions","de":"Fragen zur Abrechnung"},"items":[{"title":{"pl":"Czym jest kredyt?","en":"What is a credit?","de":"Was ist ein Credit?"},"description":{"pl":"Jednostką rozliczeniową za generowanie. Koszt jednej generacji zależy od użytego modelu i jest pokazany zanim ją uruchomisz.","en":"The unit generation is billed in. What one generation costs depends on the model used, and is shown before you start it.","de":"Die Abrechnungseinheit für Generierungen. Was eine Generierung kostet, hängt vom Modell ab und wird vor dem Start angezeigt."}},{"title":{"pl":"Czy niewykorzystane kredyty przepadają?","en":"Do unused credits expire?","de":"Verfallen ungenutzte Credits?"},"description":{"pl":"Zasady rozliczania kredytów opisuje Regulamin.","en":"How credits are settled is described in the Terms.","de":"Wie Credits abgerechnet werden, steht in den AGB."}}]}'::jsonb, '{"base":{"width":"narrow"}}'::jsonb, null, null),
    (3, 'cta', '{"title":{"pl":"Masz pytanie o wycenę?","en":"A question about pricing?","de":"Eine Frage zum Preis?"},"ctaLabel":{"pl":"Napisz do nas","en":"Write to us","de":"Schreib uns"},"ctaUrl":"/kontakt"}'::jsonb, '{"base":{"background":"soft","align":"center"}}'::jsonb, null, null)
) as v(sort_order, type, content, style, anchor, analytics_id)
where p.slug = 'cennik'
  -- Only a page nobody has arranged yet. (For the homepage the delete above
  -- has just emptied it, so this is what makes the replace idempotent too.)
  and not exists (select 1 from public.cms_blocks b where b.page_id = p.id);

-- ── O nas (/o-nas) ──────────────────────────────────────────
insert into public.cms_pages (slug, title, status, kind, nav_group, nav_order, seo)
values ('o-nas', 'O nas', 'draft', 'standard',
        'company', 10, '{"pl":{"title":"O GrovBase","description":"Dlaczego powstał GrovBase i dla kogo jest zbudowany."},"en":{"title":"About GrovBase","description":"Why GrovBase exists and who it is built for."},"de":{"title":"Über GrovBase","description":"Warum es GrovBase gibt und für wen es gebaut ist."}}'::jsonb)
on conflict (slug) do nothing;

insert into public.cms_blocks (page_id, sort_order, type, content, style, anchor, analytics_id)
select p.id, v.sort_order, v.type, v.content, v.style, v.anchor, v.analytics_id
from public.cms_pages p
cross join (values
    (0, 'hero', '{"title":{"pl":"Zbudowaliśmy to, czego sami szukaliśmy","en":"We built the thing we were looking for","de":"Wir haben gebaut, wonach wir selbst gesucht haben"},"subtitle":{"pl":"GrovBase powstał z jednego problemu: dobre zdjęcie produktowe kosztuje więcej niż marża na produkcie.","en":"GrovBase came out of one problem: a good product photo costs more than the margin on the product.","de":"GrovBase entstand aus einem Problem: ein gutes Produktfoto kostet mehr als die Marge am Produkt."}}'::jsonb, '{"base":{"paddingTop":"lg","paddingBottom":"sm","width":"narrow"}}'::jsonb, null, null),
    (1, 'text', '{"title":{"pl":"Czym jest GrovBase","en":"What GrovBase is","de":"Was GrovBase ist"},"description":{"pl":"Narzędziem do robienia materiałów sprzedażowych ze zdjęć, które sprzedawca już ma.\n\nNie jest generatorem obrazków ani zabawką do eksperymentów z AI. Jest narzędziem pracy dla kogoś, kto ma sto produktów w magazynie i żadnego budżetu na sesję dla każdego z nich.","en":"A tool for making sales material out of the photographs a seller already has.\n\nIt is not an image generator or a toy for experimenting with AI. It is a working tool for somebody with a hundred products in a warehouse and no budget for a shoot for each one.","de":"Ein Werkzeug, um aus vorhandenen Fotos Verkaufsmaterial zu machen.\n\nEs ist kein Bildgenerator und kein KI-Spielzeug. Es ist ein Arbeitsgerät für jemanden mit hundert Produkten im Lager und ohne Budget für ein Shooting pro Produkt."}}'::jsonb, '{"base":{"width":"narrow"}}'::jsonb, null, null),
    (2, 'text', '{"title":{"pl":"Dlaczego powstał","en":"Why it exists","de":"Warum es entstanden ist"},"description":{"pl":"Bo sprzedaż w internecie wygrywa się zdjęciem, a zdjęcie jest najdroższym i najwolniejszym elementem całego procesu.\n\nSesja to termin, studio, fotograf, retusz i tydzień czekania — na produkt, który być może okaże się nietrafiony. GrovBase skraca ten cykl do kilku minut, a koszt do ułamka.","en":"Because online sales are won with a photograph, and the photograph is the most expensive and slowest part of the whole process.\n\nA shoot means a date, a studio, a photographer, retouching and a week of waiting — for a product that may not sell at all. GrovBase shortens that cycle to minutes and the cost to a fraction.","de":"Weil Onlineverkauf über das Foto entschieden wird — und das Foto ist der teuerste und langsamste Teil des Prozesses.\n\nEin Shooting bedeutet Termin, Studio, Fotograf, Retusche und eine Woche Wartezeit — für ein Produkt, das sich vielleicht gar nicht verkauft. GrovBase verkürzt diesen Zyklus auf Minuten und die Kosten auf einen Bruchteil."}}'::jsonb, '{"base":{"width":"narrow"}}'::jsonb, null, null),
    (3, 'benefits', '{"title":{"pl":"Nasze podejście","en":"How we work","de":"Unser Ansatz"},"items":[{"icon":"shield","title":{"pl":"Wierność przed kreatywnością","en":"Fidelity before creativity","de":"Treue vor Kreativität"},"description":{"pl":"Ładne zdjęcie cudzego produktu jest bezwartościowe. Kształt, kolor i detal są ważniejsze niż efekt artystyczny.","en":"A beautiful photo of somebody else''s product is worthless. Shape, colour and detail matter more than artistic effect.","de":"Ein schönes Foto eines fremden Produkts ist wertlos. Form, Farbe und Detail zählen mehr als künstlerischer Effekt."}},{"icon":"zap","title":{"pl":"Bez uzależnienia od jednego dostawcy","en":"No single-vendor lock-in","de":"Keine Abhängigkeit von einem Anbieter"},"description":{"pl":"Modele AI zmieniają się co kilka miesięcy. GrovBase dobiera model do zadania i wymienia go, kiedy pojawi się lepszy.","en":"AI models change every few months. GrovBase picks the model for the job and swaps it when a better one appears.","de":"KI-Modelle ändern sich alle paar Monate. GrovBase wählt das Modell zur Aufgabe und tauscht es, sobald ein besseres kommt."}},{"icon":"eye","title":{"pl":"Bez udawania","en":"No pretending","de":"Kein Vortäuschen"},"description":{"pl":"Funkcja, która jeszcze nie działa, jest opisana jako niedostępna. Nie pokazujemy przycisków, które nic nie robią.","en":"A feature that does not work yet says so. We do not show buttons that do nothing.","de":"Eine Funktion, die noch nicht läuft, sagt das auch. Wir zeigen keine Buttons, die nichts tun."}}]}'::jsonb, '{"base":{"columns":3,"background":"sunken"}}'::jsonb, null, null),
    (4, 'text', '{"title":{"pl":"Dla kogo","en":"Who it is for","de":"Für wen"},"description":{"pl":"Dla sprzedawców na Allegro i Amazon, sklepów internetowych, marek własnych, importerów i hurtowni — wszędzie tam, gdzie asortyment jest większy niż budżet na fotografię.","en":"For sellers on Allegro and Amazon, online shops, own brands, importers and wholesalers — wherever the range is larger than the photography budget.","de":"Für Verkäufer auf Allegro und Amazon, Onlineshops, Eigenmarken, Importeure und Großhändler — überall dort, wo das Sortiment größer ist als das Fotobudget."}}'::jsonb, '{"base":{"width":"narrow"}}'::jsonb, null, null),
    (5, 'cta', '{"title":{"pl":"Zacznij od jednego produktu","en":"Start with one product","de":"Beginne mit einem Produkt"},"ctaLabel":{"pl":"Zacznij za darmo","en":"Start for free","de":"Kostenlos starten"},"ctaUrl":"/register","cta2Label":{"pl":"Napisz do nas","en":"Write to us","de":"Schreib uns"},"cta2Url":"/kontakt"}'::jsonb, '{"base":{"align":"center","background":"gradient"}}'::jsonb, null, null)
) as v(sort_order, type, content, style, anchor, analytics_id)
where p.slug = 'o-nas'
  -- Only a page nobody has arranged yet. (For the homepage the delete above
  -- has just emptied it, so this is what makes the replace idempotent too.)
  and not exists (select 1 from public.cms_blocks b where b.page_id = p.id);

-- ── Kontakt (/kontakt) ──────────────────────────────────────────
insert into public.cms_pages (slug, title, status, kind, nav_group, nav_order, seo)
values ('kontakt', 'Kontakt', 'draft', 'standard',
        'help', 10, '{"pl":{"title":"Kontakt — GrovBase","description":"Napisz do nas w sprawie sprzedaży, pomocy technicznej, partnerstwa lub mediów."},"en":{"title":"Contact — GrovBase","description":"Write to us about sales, support, partnerships or press."},"de":{"title":"Kontakt — GrovBase","description":"Schreib uns zu Vertrieb, Support, Partnerschaften oder Presse."}}'::jsonb)
on conflict (slug) do nothing;

insert into public.cms_blocks (page_id, sort_order, type, content, style, anchor, analytics_id)
select p.id, v.sort_order, v.type, v.content, v.style, v.anchor, v.analytics_id
from public.cms_pages p
cross join (values
    (0, 'hero', '{"title":{"pl":"Napisz do nas","en":"Write to us","de":"Schreib uns"},"subtitle":{"pl":"Odpowiadamy w dni robocze, zwykle tego samego dnia.","en":"We reply on working days, usually the same day.","de":"Wir antworten an Werktagen, meist am selben Tag."}}'::jsonb, '{"base":{"paddingTop":"lg","paddingBottom":"sm","width":"narrow"}}'::jsonb, null, null),
    (1, 'contact_form', '{"formHandler":"contact","ctaLabel":{"pl":"Wyślij wiadomość","en":"Send message","de":"Nachricht senden"},"subtitle":{"pl":"Wysyłając wiadomość zgadzasz się na przetwarzanie podanych danych w celu udzielenia odpowiedzi. Szczegóły w Polityce prywatności.","en":"By sending this message you agree to your data being processed so that we can reply. Details are in the Privacy policy.","de":"Mit dem Senden stimmst du der Verarbeitung deiner Daten zur Beantwortung zu. Details in der Datenschutzerklärung."},"items":[{"value":"sales","title":{"pl":"Sprzedaż","en":"Sales","de":"Vertrieb"}},{"value":"support","title":{"pl":"Pomoc","en":"Support","de":"Support"}},{"value":"partnership","title":{"pl":"Partnerstwo","en":"Partnership","de":"Partnerschaft"}},{"value":"press","title":{"pl":"Media","en":"Press","de":"Presse"}},{"value":"other","title":{"pl":"Inne","en":"Other","de":"Sonstiges"}}]}'::jsonb, '{"base":{"width":"narrow"}}'::jsonb, null, 'contact.form.submit'),
    (2, 'contact', '{"title":{"pl":"Dane firmy","en":"Company details","de":"Unternehmensdaten"},"items":[]}'::jsonb, '{"base":{"width":"narrow"}}'::jsonb, null, null)
) as v(sort_order, type, content, style, anchor, analytics_id)
where p.slug = 'kontakt'
  -- Only a page nobody has arranged yet. (For the homepage the delete above
  -- has just emptied it, so this is what makes the replace idempotent too.)
  and not exists (select 1 from public.cms_blocks b where b.page_id = p.id);

-- ── Regulamin (/regulamin) ──────────────────────────────────────────
insert into public.cms_pages (slug, title, status, kind, nav_group, nav_order, seo)
values ('regulamin', 'Regulamin', 'draft', 'standard',
        'legal', 10, '{"pl":{"title":"Regulamin — GrovBase","description":"Regulamin korzystania z serwisu GrovBase."},"en":{"title":"Terms — GrovBase","description":"Terms of service for GrovBase."},"de":{"title":"AGB — GrovBase","description":"Nutzungsbedingungen für GrovBase."}}'::jsonb)
on conflict (slug) do nothing;

insert into public.cms_blocks (page_id, sort_order, type, content, style, anchor, analytics_id)
select p.id, v.sort_order, v.type, v.content, v.style, v.anchor, v.analytics_id
from public.cms_pages p
cross join (values
    (0, 'text', '{"description":{"pl":"Treść regulaminu jest przygotowywana i zostanie opublikowana przed startem usługi. Poniższy spis wskazuje, co będzie zawierał.","en":"The terms are being prepared and will be published before the service opens. The outline below shows what they will contain.","de":"Die AGB werden vorbereitet und vor dem Start veröffentlicht. Die folgende Gliederung zeigt ihren Inhalt."}}'::jsonb, '{"base":{"width":"narrow"}}'::jsonb, null, null),
    (1, 'legal', '{"html":{"pl":"<h2>Postanowienia ogólne</h2><p>W przygotowaniu.</p><h2>Definicje</h2><p>W przygotowaniu.</p><h2>Warunki korzystania z usługi</h2><p>W przygotowaniu.</p><h2>Konto użytkownika</h2><p>W przygotowaniu.</p><h2>Kredyty i płatności</h2><p>W przygotowaniu.</p><h2>Prawa do wygenerowanych materiałów</h2><p>W przygotowaniu.</p><h2>Odpowiedzialność</h2><p>W przygotowaniu.</p><h2>Reklamacje</h2><p>W przygotowaniu.</p><h2>Odstąpienie od umowy</h2><p>W przygotowaniu.</p><h2>Zmiany regulaminu</h2><p>W przygotowaniu.</p>","en":"<h2>General provisions</h2><p>In preparation.</p><h2>Definitions</h2><p>In preparation.</p><h2>Conditions of use</h2><p>In preparation.</p><h2>User account</h2><p>In preparation.</p><h2>Credits and payments</h2><p>In preparation.</p><h2>Rights to generated material</h2><p>In preparation.</p><h2>Liability</h2><p>In preparation.</p><h2>Complaints</h2><p>In preparation.</p><h2>Withdrawal</h2><p>In preparation.</p><h2>Changes to these terms</h2><p>In preparation.</p>","de":"<h2>Allgemeine Bestimmungen</h2><p>In Vorbereitung.</p><h2>Definitionen</h2><p>In Vorbereitung.</p><h2>Nutzungsbedingungen</h2><p>In Vorbereitung.</p><h2>Benutzerkonto</h2><p>In Vorbereitung.</p><h2>Credits und Zahlungen</h2><p>In Vorbereitung.</p><h2>Rechte an erzeugten Materialien</h2><p>In Vorbereitung.</p><h2>Haftung</h2><p>In Vorbereitung.</p><h2>Beschwerden</h2><p>In Vorbereitung.</p><h2>Widerruf</h2><p>In Vorbereitung.</p><h2>Änderungen der AGB</h2><p>In Vorbereitung.</p>"}}'::jsonb, '{"base":{"width":"narrow"}}'::jsonb, null, null)
) as v(sort_order, type, content, style, anchor, analytics_id)
where p.slug = 'regulamin'
  -- Only a page nobody has arranged yet. (For the homepage the delete above
  -- has just emptied it, so this is what makes the replace idempotent too.)
  and not exists (select 1 from public.cms_blocks b where b.page_id = p.id);

-- ── Polityka prywatności (/polityka-prywatnosci) ──────────────────────────────────────────
insert into public.cms_pages (slug, title, status, kind, nav_group, nav_order, seo)
values ('polityka-prywatnosci', 'Polityka prywatności', 'draft', 'standard',
        'legal', 20, '{"pl":{"title":"Polityka prywatności — GrovBase","description":"Jak GrovBase przetwarza dane osobowe."},"en":{"title":"Privacy policy — GrovBase","description":"How GrovBase processes personal data."},"de":{"title":"Datenschutzerklärung — GrovBase","description":"Wie GrovBase personenbezogene Daten verarbeitet."}}'::jsonb)
on conflict (slug) do nothing;

insert into public.cms_blocks (page_id, sort_order, type, content, style, anchor, analytics_id)
select p.id, v.sort_order, v.type, v.content, v.style, v.anchor, v.analytics_id
from public.cms_pages p
cross join (values
    (0, 'text', '{"description":{"pl":"Treść polityki prywatności jest przygotowywana i zostanie opublikowana przed startem usługi. Poniższy spis wskazuje, co będzie zawierała.","en":"The privacy policy is being prepared and will be published before the service opens. The outline below shows what it will contain.","de":"Die Datenschutzerklärung wird vorbereitet und vor dem Start veröffentlicht. Die folgende Gliederung zeigt ihren Inhalt."}}'::jsonb, '{"base":{"width":"narrow"}}'::jsonb, null, null),
    (1, 'legal', '{"html":{"pl":"<h2>Administrator danych</h2><p>W przygotowaniu.</p><h2>Jakie dane zbieramy</h2><p>W przygotowaniu.</p><h2>Cele i podstawy przetwarzania</h2><p>W przygotowaniu.</p><h2>Okres przechowywania</h2><p>W przygotowaniu.</p><h2>Odbiorcy danych i podprocesorzy</h2><p>W przygotowaniu.</p><h2>Przekazywanie poza EOG</h2><p>W przygotowaniu.</p><h2>Twoje prawa</h2><p>W przygotowaniu.</p><h2>Pliki cookie</h2><p>W przygotowaniu.</p><h2>Zdjęcia wgrywane do serwisu</h2><p>W przygotowaniu.</p><h2>Kontakt w sprawie danych</h2><p>W przygotowaniu.</p>","en":"<h2>Data controller</h2><p>In preparation.</p><h2>What we collect</h2><p>In preparation.</p><h2>Purposes and legal bases</h2><p>In preparation.</p><h2>Retention</h2><p>In preparation.</p><h2>Recipients and sub-processors</h2><p>In preparation.</p><h2>Transfers outside the EEA</h2><p>In preparation.</p><h2>Your rights</h2><p>In preparation.</p><h2>Cookies</h2><p>In preparation.</p><h2>Images uploaded to the service</h2><p>In preparation.</p><h2>Contacting us about data</h2><p>In preparation.</p>","de":"<h2>Verantwortlicher</h2><p>In Vorbereitung.</p><h2>Welche Daten wir erheben</h2><p>In Vorbereitung.</p><h2>Zwecke und Rechtsgrundlagen</h2><p>In Vorbereitung.</p><h2>Speicherdauer</h2><p>In Vorbereitung.</p><h2>Empfänger und Auftragsverarbeiter</h2><p>In Vorbereitung.</p><h2>Übermittlung außerhalb des EWR</h2><p>In Vorbereitung.</p><h2>Deine Rechte</h2><p>In Vorbereitung.</p><h2>Cookies</h2><p>In Vorbereitung.</p><h2>Hochgeladene Bilder</h2><p>In Vorbereitung.</p><h2>Kontakt in Datenschutzfragen</h2><p>In Vorbereitung.</p>"}}'::jsonb, '{"base":{"width":"narrow"}}'::jsonb, null, null)
) as v(sort_order, type, content, style, anchor, analytics_id)
where p.slug = 'polityka-prywatnosci'
  -- Only a page nobody has arranged yet. (For the homepage the delete above
  -- has just emptied it, so this is what makes the replace idempotent too.)
  and not exists (select 1 from public.cms_blocks b where b.page_id = p.id);

-- ── The shared header and footer ─────────────────────────────────────────
-- Only a slot still holding its empty default is filled, so an edited header
-- is never overwritten.
update public.cms_global_sections
set content = '{"ctaLabel":{"pl":"Zacznij za darmo","en":"Start for free","de":"Kostenlos starten"},"ctaUrl":"/register","items":[]}'::jsonb,
    published_snapshot = '{"ctaLabel":{"pl":"Zacznij za darmo","en":"Start for free","de":"Kostenlos starten"},"ctaUrl":"/register","items":[]}'::jsonb,
    visible = true,
    published_at = now(),
    updated_at = now()
where slot = 'header' and content = '{}'::jsonb;
update public.cms_global_sections
set content = '{"description":{"pl":"GrovBase zamienia zwykłe zdjęcia produktów w materiały, które sprzedają — bez studia i bez czekania.","en":"GrovBase turns ordinary product photos into material that sells — with no studio and no waiting.","de":"GrovBase macht aus gewöhnlichen Produktfotos Material, das verkauft — ohne Studio und ohne Wartezeit."},"items":[]}'::jsonb,
    published_snapshot = '{"description":{"pl":"GrovBase zamienia zwykłe zdjęcia produktów w materiały, które sprzedają — bez studia i bez czekania.","en":"GrovBase turns ordinary product photos into material that sells — with no studio and no waiting.","de":"GrovBase macht aus gewöhnlichen Produktfotos Material, das verkauft — ohne Studio und ohne Wartezeit."},"items":[]}'::jsonb,
    visible = true,
    published_at = now(),
    updated_at = now()
where slot = 'footer' and content = '{}'::jsonb;
