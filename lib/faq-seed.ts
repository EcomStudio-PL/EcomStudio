import type { TicketTopic } from "./contact-page";
import type { FaqPage, FaqText } from "./faq";

/**
 * FAQ V1 — THE STARTING CONTENT, as data.
 *
 * The 30 questions of the FAQ V1 brief, word for word in Polish (their EN/DE
 * versions are translations of exactly that text), plus the one question of
 * the old /plany FAQ that the brief does not have ("Jak kupić dodatkowe
 * kredyty?"). The O nas questions the brief does not have are NOT here: the
 * migration copies them from the live about_faq section as they stand on the
 * day it runs (an admin may have edited them), see 0155.
 *
 * MAPPING, NOT DUPLICATES. A brief question that has the same meaning as a
 * question already published on /plany or /o-nas becomes ONE record carrying
 * both origins (`legacy`). When the brief's answer is complete and true it is
 * the record's answer. When it is a placeholder — or says something the code
 * contradicts — and the old page already had a checked answer, that answer
 * stays the published one and the brief's text is kept beside it as
 * `draft` (shown to the admin as "Propozycja do uzupełnienia"), so no page
 * loses a question it shows today and no placeholder reaches a visitor.
 *
 * scripts/faq-seed-sql.ts turns this file into the INSERTs of
 * supabase/migrations/0155_faq_v1.sql; scripts/faq-tests.ts holds the two
 * equal. Re-running the migration inserts nothing twice (import_key).
 */

export type FaqSeedCategory = {
  slug: string;
  name: Required<FaqText>;
  topic: TicketTopic;
};

export type FaqSeedItem = {
  /** Position in the brief (1–30), or null for a question only the old page had. */
  no: number | null;
  /** import_key: "brief:06", "plany:topups". */
  key: string;
  slug: string;
  category: string;
  pages: FaqPage[];
  question: Required<FaqText>;
  answer: FaqText;
  /** The brief's own answer when it is not the published one. */
  draft?: FaqText;
  visible: boolean;
  needsReview?: boolean;
  onlyPremiere?: boolean;
  /** For the admin: why the item is hidden, what to fill in, what was kept. */
  note?: string;
  /** The old questions this record replaces (plany:<key>, o-nas:<title>). */
  legacy?: string[];
};

export const FAQ_SEED_CATEGORIES: readonly FaqSeedCategory[] = [
  { slug: "pierwsze-kroki", topic: "app", name: { pl: "Pierwsze kroki", en: "Getting started", de: "Erste Schritte" } },
  { slug: "kredyty-i-plany", topic: "payments", name: { pl: "Kredyty i plany", en: "Credits and plans", de: "Credits und Pläne" } },
  { slug: "platnosci-i-faktury", topic: "payments", name: { pl: "Płatności i faktury", en: "Payments and invoices", de: "Zahlungen und Rechnungen" } },
  { slug: "jakosc-i-wyniki", topic: "technical", name: { pl: "Jakość i wyniki", en: "Quality and results", de: "Qualität und Ergebnisse" } },
  { slug: "prawa-i-dane", topic: "other", name: { pl: "Prawa i dane", en: "Rights and data", de: "Rechte und Daten" } },
  { slug: "konto-i-firma", topic: "app", name: { pl: "Konto i firma", en: "Account and company", de: "Konto und Unternehmen" } },
  { slug: "nadchodzace-funkcje", topic: "other", name: { pl: "Nadchodzące funkcje", en: "Coming soon", de: "Demnächst" } },
];

const KEPT = "Import FAQ V1: widoczna jest dotychczasowa, sprawdzona odpowiedź z cennika (/plany).";

export const FAQ_SEED_ITEMS: readonly FaqSeedItem[] = [
  /* ── PIERWSZE KROKI ─────────────────────────────────────────────────── */
  {
    no: 1, key: "brief:01", slug: "czym-jest-grovbase", category: "pierwsze-kroki", pages: ["faq", "o-nas"], visible: true,
    legacy: ["o-nas:Czym jest GrovBase?"],
    question: { pl: "Czym jest GrovBase?", en: "What is GrovBase?", de: "Was ist GrovBase?" },
    answer: {
      pl: "GrovBase to aplikacja do tworzenia zdjęć produktów dla sprzedawców internetowych: miniaturek na Allegro i inne marketplace’y, packshotów, retuszu i zdjęć odzieży. Wgrywasz zdjęcie produktu, wybierasz efekt i pobierasz gotową grafikę.",
      en: "GrovBase is an app that creates product photos for online sellers: thumbnails for Allegro and other marketplaces, packshots, retouching and clothing photos. You upload a photo of your product, choose an effect and download a finished image.",
      de: "GrovBase ist eine App, die Produktfotos für Online-Händler erstellt: Thumbnails für Allegro und andere Marktplätze, Packshots, Retusche und Bekleidungsfotos. Du lädst ein Foto deines Produkts hoch, wählst einen Effekt und lädst die fertige Grafik herunter.",
    },
  },
  {
    no: 2, key: "brief:02", slug: "czy-musze-umiec-pisac-prompty", category: "pierwsze-kroki", pages: ["faq"], visible: true,
    question: {
      pl: "Czy muszę umieć pisać prompty albo znać się na grafice?",
      en: "Do I need to know how to write prompts or understand graphic design?",
      de: "Muss ich Prompts schreiben können oder mich mit Grafik auskennen?",
    },
    answer: {
      pl: "Nie. Każde narzędzie ma gotowe ustawienia przygotowane przez grafika e-commerce. Wystarczy wgrać zdjęcie i kliknąć.",
      en: "No. Every tool comes with ready-made settings prepared by an e-commerce designer. Just upload a photo and click.",
      de: "Nein. Jedes Werkzeug hat fertige Einstellungen, die ein E-Commerce-Grafiker vorbereitet hat. Foto hochladen und klicken – mehr ist nicht nötig.",
    },
  },
  {
    no: 3, key: "brief:03", slug: "jakie-zdjecia-wgrywac", category: "pierwsze-kroki", pages: ["faq"], visible: true,
    question: { pl: "Jakie zdjęcia najlepiej wgrywać?", en: "What photos work best?", de: "Welche Fotos eignen sich am besten?" },
    answer: {
      pl: "Najlepiej ostre zdjęcie, na którym widać cały produkt, przy dobrym świetle. Wystarczy zdjęcie z telefonu. Obsługujemy JPG, PNG, WebP i AVIF do 10 MB.",
      en: "A sharp photo that shows the whole product in good light works best. A phone photo is enough. We support JPG, PNG, WebP and AVIF up to 10 MB.",
      de: "Am besten ein scharfes Foto, auf dem das ganze Produkt bei gutem Licht zu sehen ist. Ein Handyfoto reicht. Wir unterstützen JPG, PNG, WebP und AVIF bis 10 MB.",
    },
  },
  {
    no: 4, key: "brief:04", slug: "ile-trwa-generowanie", category: "pierwsze-kroki", pages: ["faq"], visible: true,
    question: { pl: "Ile trwa wygenerowanie grafiki?", en: "How long does it take to generate an image?", de: "Wie lange dauert das Erstellen einer Grafik?" },
    answer: {
      pl: "Zwykle od kilkudziesięciu sekund do kilku minut, w zależności od narzędzia i liczby zdjęć. Opcja Retusz AI wydłuża czas, bo każde zdjęcie jest najpierw poprawiane osobno.",
      en: "Usually from several dozen seconds to a few minutes, depending on the tool and the number of photos. The AI retouching option takes longer, because each photo is first improved separately.",
      de: "Meist zwischen einigen Dutzend Sekunden und ein paar Minuten, je nach Werkzeug und Anzahl der Fotos. Die Option KI-Retusche dauert länger, weil jedes Foto zuerst einzeln verbessert wird.",
    },
  },
  {
    no: 5, key: "brief:05", slug: "czy-grovbase-dziala-na-telefonie", category: "pierwsze-kroki", pages: ["faq"], visible: true,
    question: { pl: "Czy GrovBase działa na telefonie?", en: "Does GrovBase work on a phone?", de: "Funktioniert GrovBase auf dem Handy?" },
    answer: {
      pl: "Tak, aplikacja działa w przeglądarce na komputerze i telefonie. Nie trzeba niczego instalować.",
      en: "Yes, the app runs in the browser on your computer and your phone. There is nothing to install.",
      de: "Ja, die App läuft im Browser auf Computer und Handy. Du musst nichts installieren.",
    },
  },

  /* ── KREDYTY I PLANY ────────────────────────────────────────────────── */
  {
    no: 6, key: "brief:06", slug: "jak-dzialaja-kredyty", category: "kredyty-i-plany", pages: ["faq", "plany"], visible: true,
    legacy: ["plany:credits"],
    question: { pl: "Jak działają kredyty?", en: "How do credits work?", de: "Wie funktionieren Credits?" },
    answer: {
      pl: "Każda generacja kosztuje określoną liczbę kredytów, widoczną przy narzędziu przed kliknięciem. Kredyty dostajesz co miesiąc w ramach planu, a w razie potrzeby możesz je doładować.",
      en: "Every generation costs a set number of credits, shown next to the tool before you click. You get credits every month with your plan, and you can top them up whenever you need.",
      de: "Jede Generierung kostet eine bestimmte Anzahl Credits, die beim Werkzeug angezeigt wird, bevor du klickst. Credits bekommst du jeden Monat mit deinem Plan, und bei Bedarf kannst du sie aufladen.",
    },
  },
  {
    no: 7, key: "brief:07", slug: "ile-obrazow-moge-wygenerowac", category: "kredyty-i-plany", pages: ["faq", "plany"], visible: true,
    legacy: ["plany:howMany"],
    question: { pl: "Ile obrazów mogę wygenerować?", en: "How many images can I generate?", de: "Wie viele Bilder kann ich generieren?" },
    answer: {
      pl: "To zależy od narzędzia i jakości: koszt każdej generacji widzisz w kredytach, zanim ją uruchomisz, więc łatwo przeliczysz swój plan. Generowanie wideo jest w przygotowaniu i nie jest jeszcze dostępne.",
      en: "It depends on the tool and the quality: you see the credit cost of each generation before you run it, so it is easy to work out what your plan covers. Video generation is in preparation and not available yet.",
      de: "Das hängt vom Tool und der Qualität ab: Die Credit-Kosten jeder Generierung siehst du, bevor du sie startest, so kannst du deinen Plan leicht umrechnen. Die Videogenerierung ist in Vorbereitung und noch nicht verfügbar.",
    },
    draft: {
      pl: "To zależy od narzędzia. Przykładowo miniaturka kosztuje [X] kredytów, więc w planie PRO (1 200 kredytów) zrobisz ok. [Y] miniaturek miesięcznie. Przeliczenia dla każdego planu znajdziesz w cenniku.",
    },
    note: `${KEPT} Propozycja z briefu czeka na wartości [X] i [Y]; limit planu PRO (1 200 kredytów miesięcznie) jest zgodny z konfiguracją planów.`,
  },
  {
    no: 8, key: "brief:08", slug: "czy-kredyty-przechodza-na-kolejny-miesiac", category: "kredyty-i-plany", pages: ["faq", "plany"], visible: false,
    question: {
      pl: "Czy niewykorzystane kredyty przechodzą na kolejny miesiąc?",
      en: "Do unused credits roll over to the next month?",
      de: "Werden ungenutzte Credits in den nächsten Monat übernommen?",
    },
    answer: { pl: "[DO POTWIERDZENIA]" },
    note: "Do uzupełnienia: odpowiedź z briefu to [DO POTWIERDZENIA].",
  },
  {
    no: 9, key: "brief:09", slug: "czy-kredyty-z-doladowania-wygasaja", category: "kredyty-i-plany", pages: ["faq", "plany"], visible: false, needsReview: true,
    question: { pl: "Czy kredyty z doładowania wygasają?", en: "Do top-up credits expire?", de: "Verfallen aufgeladene Credits?" },
    answer: {
      pl: "Nie. Kredyty z doładowania nie wygasają i są dostępne od razu po zakupie, dopóki masz aktywny plan.",
      en: "No. Top-up credits never expire and are available right after purchase, as long as you have an active plan.",
      de: "Nein. Aufgeladene Credits verfallen nicht und stehen direkt nach dem Kauf zur Verfügung, solange du einen aktiven Plan hast.",
    },
    note: "Wymaga weryfikacji: aktywny plan jest w kodzie warunkiem ZAKUPU doładowania, ale wydawanie kredytów nie jest blokowane, gdy plan wygaśnie — zdanie „dopóki masz aktywny plan” nie zostało potwierdzone. Kredyty trafiają na konto po potwierdzeniu płatności.",
  },
  {
    no: 10, key: "brief:10", slug: "zwrot-kredytow-za-nieudana-generacje", category: "kredyty-i-plany", pages: ["faq"], visible: false,
    question: {
      pl: "Czy dostanę kredyty z powrotem, jeśli generacja się nie uda?",
      en: "Do I get my credits back if a generation fails?",
      de: "Bekomme ich meine Credits zurück, wenn eine Generierung fehlschlägt?",
    },
    answer: { pl: "[DO POTWIERDZENIA]" },
    note: "Do uzupełnienia: odpowiedź z briefu to [DO POTWIERDZENIA]. Dla porządku: w kodzie kredyty za nieudaną generację wracają na konto automatycznie (to samo mówiła dotychczasowa odpowiedź „Jak działają kredyty?” w cenniku).",
  },
  {
    no: 11, key: "brief:11", slug: "czy-moge-wyprobowac-za-darmo", category: "kredyty-i-plany", pages: ["faq", "plany"], visible: false,
    question: { pl: "Czy mogę wypróbować GrovBase za darmo?", en: "Can I try GrovBase for free?", de: "Kann ich GrovBase kostenlos testen?" },
    answer: {
      pl: "Tak. Po rejestracji dostajesz [25] darmowych kredytów. Grafiki z darmowych kredytów mają znak wodny, który możesz usunąć po wybraniu dowolnego planu.",
    },
    note: "Do uzupełnienia: liczba kredytów [25] (plan Free ma dziś 25 kredytów miesięcznie) i potwierdzenie zasad znaku wodnego (znak wodny wersji próbnej jest włączony w ustawieniach).",
  },
  {
    no: 12, key: "brief:12", slug: "jak-dziala-cena-premierowa", category: "kredyty-i-plany", pages: ["faq", "plany"], visible: true, onlyPremiere: true,
    legacy: ["plany:premiere"],
    question: { pl: "Jak działa cena premierowa?", en: "How does the launch price work?", de: "Wie funktioniert der Startpreis?" },
    answer: {
      pl: "Jeśli kupisz plan przed końcem oferty, zachowasz jego cenę premierową przy kolejnych odnowieniach — dopóki nie anulujesz subskrypcji lub nie zmienisz planu. Po zakończeniu oferty nowe subskrypcje mają cenę regularną.",
      en: "If you buy a plan before the offer ends, you keep its launch price on every renewal — until you cancel the subscription or change the plan. After the offer ends, new subscriptions are at the regular price.",
      de: "Wenn du einen Plan vor Ende des Angebots kaufst, behältst du seinen Startpreis bei jeder Verlängerung — bis du das Abo kündigst oder den Plan wechselst. Nach Ende des Angebots gilt für neue Abos der reguläre Preis.",
    },
    draft: {
      pl: "Jeśli wykupisz plan do [data], zachowujesz cenę premierową tak długo, jak masz aktywny plan. Cena zmienia się dopiero po anulowaniu lub zmianie planu.",
    },
    note: `${KEPT} Pokazywana tylko w trakcie premiery, jak dotąd. Propozycja z briefu czeka na [data].`,
  },
  {
    no: 13, key: "brief:13", slug: "czy-moge-zmienic-plan", category: "kredyty-i-plany", pages: ["faq", "plany"], visible: true,
    legacy: ["plany:change"],
    question: { pl: "Czy po zakupie mogę zmienić plan?", en: "Can I change my plan after buying?", de: "Kann ich meinen Plan nach dem Kauf ändern?" },
    answer: {
      pl: "Samodzielna zmiana planu w panelu nie jest jeszcze dostępna. Napisz do nas, a przeprowadzimy zmianę — albo anuluj obecny plan i po zakończeniu opłaconego okresu wybierz nowy.",
      en: "Changing your plan yourself in the panel is not available yet. Write to us and we will make the switch — or cancel your current plan and choose a new one once the paid period ends.",
      de: "Ein selbstständiger Planwechsel im Panel ist noch nicht verfügbar. Schreib uns, und wir stellen den Plan um — oder kündige den aktuellen Plan und wähle nach Ende des bezahlten Zeitraums einen neuen.",
    },
    draft: {
      pl: "Tak, w każdej chwili w ustawieniach konta. [DO POTWIERDZENIA: kiedy zmiana wchodzi w życie i jak rozliczana jest różnica]",
    },
    note: `${KEPT} Propozycja z briefu („Tak, w każdej chwili w ustawieniach konta”) jest sprzeczna z kodem: samodzielna zmiana planu w panelu nie jest dostępna.`,
  },
  {
    no: null, key: "plany:topups", slug: "jak-kupic-dodatkowe-kredyty", category: "kredyty-i-plany", pages: ["faq", "plany"], visible: true,
    legacy: ["plany:topups"],
    question: { pl: "Jak mogę kupić dodatkowe kredyty?", en: "How can I buy extra credits?", de: "Wie kann ich zusätzliche Credits kaufen?" },
    answer: {
      pl: "Doładowania są dostępne dla aktywnych planów płatnych: w sekcji „Doładuj kredyty” wybierz pakiet albo własną liczbę kredytów. Kredyty z doładowania nie wygasają i trafiają na konto po potwierdzeniu płatności.",
      en: "Top-ups are available on active paid plans: in “Top up credits”, choose a pack or a custom amount of credits. Top-up credits never expire and reach your account once the payment is confirmed.",
      de: "Aufladungen gibt es für aktive bezahlte Pläne: Wähle unter „Credits aufladen“ ein Paket oder eine eigene Anzahl Credits. Aufgeladene Credits verfallen nicht und landen nach Bestätigung der Zahlung auf deinem Konto.",
    },
    note: "Pytanie z dotychczasowego cennika, którego nie ma w briefie — zachowane bez zmian (link „Jak kupić dodatkowe kredyty?” na stronie Kontakt).",
  },

  /* ── PŁATNOŚCI I FAKTURY ────────────────────────────────────────────── */
  {
    no: 14, key: "brief:14", slug: "metody-platnosci", category: "platnosci-i-faktury", pages: ["faq", "plany"], visible: true,
    legacy: ["plany:methods"],
    question: { pl: "Z jakich metod płatności mogę skorzystać?", en: "Which payment methods can I use?", de: "Welche Zahlungsmethoden kann ich nutzen?" },
    answer: {
      pl: "Płatności obsługuje Stripe. Plan opłacisz kartą płatniczą, a jednorazowe doładowania także BLIKiem. Formularz płatności pokazuje metody dostępne na Twoim urządzeniu, w tym portfele takie jak Apple Pay czy Google Pay.",
      en: "Payments are handled by Stripe. You pay for a plan by card, and one-off top-ups also with BLIK. The payment form shows the methods available on your device, including wallets such as Apple Pay or Google Pay.",
      de: "Zahlungen laufen über Stripe. Einen Plan bezahlst du per Karte, einmalige Aufladungen auch mit BLIK. Das Zahlungsformular zeigt die auf deinem Gerät verfügbaren Methoden, darunter Wallets wie Apple Pay oder Google Pay.",
    },
    draft: { pl: "[DO POTWIERDZENIA]" },
    note: `${KEPT} Odpowiedź z briefu to [DO POTWIERDZENIA].`,
  },
  {
    no: 15, key: "brief:15", slug: "czy-otrzymam-fakture-vat", category: "platnosci-i-faktury", pages: ["faq"], visible: false, needsReview: true,
    question: { pl: "Czy otrzymam fakturę VAT?", en: "Will I get a VAT invoice?", de: "Bekomme ich eine Rechnung mit MwSt.?" },
    answer: {
      pl: "Tak. Fakturę wystawiamy automatycznie po każdej płatności. Dane do faktury, w tym NIP, uzupełnisz w ustawieniach konta.",
      en: "Yes. We issue an invoice automatically after every payment. You can add your invoice details, including your tax ID, in your account settings.",
      de: "Ja. Nach jeder Zahlung stellen wir automatisch eine Rechnung aus. Deine Rechnungsdaten, einschließlich der USt-IdNr., trägst du in den Kontoeinstellungen ein.",
    },
    note: "Wymaga weryfikacji: w ustawieniach konta nie ma pola na dane do faktury ani NIP, a w kodzie nie znaleziono automatycznego wystawiania faktur VAT.",
  },
  {
    no: 16, key: "brief:16", slug: "czy-subskrypcja-odnawia-sie-automatycznie", category: "platnosci-i-faktury", pages: ["faq", "plany"], visible: true,
    legacy: ["plany:renewal"],
    question: { pl: "Czy subskrypcja odnawia się automatycznie?", en: "Does the subscription renew automatically?", de: "Verlängert sich das Abo automatisch?" },
    answer: {
      pl: "Tak — plan odnawia się co miesiąc, a po każdej opłaconej płatności dodajemy kredyty z planu. Subskrypcję anulujesz w panelu płatności Stripe: plan działa do końca opłaconego okresu, a kredyty zostają na koncie.",
      en: "Yes — the plan renews every month, and after each paid payment we add the plan's credits. You cancel in the Stripe billing portal: the plan stays active until the end of the paid period, and your credits stay in your account.",
      de: "Ja — der Plan verlängert sich jeden Monat, und nach jeder bezahlten Zahlung schreiben wir die Credits des Plans gut. Du kündigst im Stripe-Zahlungsportal: Der Plan bleibt bis zum Ende des bezahlten Zeitraums aktiv, und deine Credits bleiben auf dem Konto.",
    },
    draft: {
      pl: "Tak, plan odnawia się automatycznie co miesiąc lub co rok, zależnie od wybranego rozliczenia. Możesz go anulować w każdej chwili w ustawieniach konta.",
    },
    note: `${KEPT} Propozycja z briefu wymaga weryfikacji: rozliczenie roczne nie jest dziś w sprzedaży (żaden plan nie ma ceny rocznej), a anulowanie odbywa się w panelu płatności Stripe, otwieranym z ustawień konta.`,
  },
  {
    no: 17, key: "brief:17", slug: "jak-anulowac-subskrypcje", category: "platnosci-i-faktury", pages: ["faq"], visible: false, needsReview: true,
    question: { pl: "Jak anulować subskrypcję?", en: "How do I cancel my subscription?", de: "Wie kündige ich mein Abo?" },
    answer: {
      pl: "W ustawieniach konta, w zakładce Plan. Po anulowaniu plan działa do końca opłaconego okresu.",
      en: "In your account settings, on the Plan tab. After you cancel, your plan stays active until the end of the paid period.",
      de: "In den Kontoeinstellungen im Tab „Plan“. Nach der Kündigung bleibt dein Plan bis zum Ende des bezahlten Zeitraums aktiv.",
    },
    note: "Wymaga weryfikacji: w ustawieniach konta nie ma zakładki „Plan” (są: Profil, Konto i bezpieczeństwo, Subskrypcje, Preferencje); anulowanie odbywa się w panelu płatności Stripe.",
  },
  {
    no: 18, key: "brief:18", slug: "czy-istnieje-mozliwosc-zwrotu", category: "platnosci-i-faktury", pages: ["faq", "plany"], visible: true,
    legacy: ["plany:refunds"],
    question: { pl: "Czy istnieje możliwość zwrotu?", en: "Can I get a refund?", de: "Gibt es eine Rückerstattung?" },
    answer: {
      pl: "Każdą prośbę o zwrot płatności rozpatrujemy indywidualnie — napisz do nas przez stronę kontaktu. Kredyty za generacje, które się nie udały, wracają na konto automatycznie.",
      en: "We review every refund request individually — write to us through the contact page. Credits for generations that failed go back to your account automatically.",
      de: "Jede Anfrage auf Rückerstattung prüfen wir einzeln — schreib uns über die Kontaktseite. Credits für fehlgeschlagene Generierungen gehen automatisch auf dein Konto zurück.",
    },
    draft: { pl: "[DO POTWIERDZENIA – zgodnie z regulaminem]" },
    note: `${KEPT} Odpowiedź z briefu to [DO POTWIERDZENIA – zgodnie z regulaminem].`,
  },

  /* ── JAKOŚĆ I WYNIKI ────────────────────────────────────────────────── */
  {
    no: 19, key: "brief:19", slug: "czy-produkt-bedzie-wygladal-jak-prawdziwy", category: "jakosc-i-wyniki", pages: ["faq"], visible: true,
    question: {
      pl: "Czy produkt na grafice będzie wyglądał jak prawdziwy?",
      en: "Will the product in the image look like the real one?",
      de: "Sieht das Produkt auf der Grafik aus wie das echte?",
    },
    answer: {
      pl: "Na tym zależy nam najbardziej: kształt, kolor i detale produktu mają zostać zachowane. AI może jednak czasem zmienić drobny element, np. napis na opakowaniu, dlatego przed wystawieniem oferty zawsze sprawdź grafikę.",
      en: "That is what matters to us most: the product's shape, colour and details should be preserved. AI can still sometimes change a small element, such as the text on a package, so always check the image before you publish a listing.",
      de: "Darauf legen wir am meisten Wert: Form, Farbe und Details des Produkts sollen erhalten bleiben. Die KI kann aber manchmal ein kleines Element verändern, etwa die Schrift auf einer Verpackung – prüfe die Grafik deshalb immer, bevor du ein Angebot einstellst.",
    },
  },
  {
    no: 20, key: "brief:20", slug: "co-jesli-wynik-mi-sie-nie-podoba", category: "jakosc-i-wyniki", pages: ["faq"], visible: true,
    question: { pl: "Co zrobić, jeśli wynik mi się nie podoba?", en: "What if I don't like the result?", de: "Was tun, wenn mir das Ergebnis nicht gefällt?" },
    answer: {
      pl: "Wygeneruj grafikę ponownie lub spróbuj innego zdjęcia wejściowego – często lepsze światło lub ostrość robią dużą różnicę. Jeśli problem się powtarza, napisz do nas i podaj ID generacji.",
      en: "Generate the image again or try a different input photo – better light or focus often makes a big difference. If the problem keeps coming back, write to us and include the generation ID.",
      de: "Erstelle die Grafik erneut oder probiere ein anderes Ausgangsfoto – besseres Licht oder mehr Schärfe machen oft einen großen Unterschied. Wenn das Problem bleibt, schreib uns und gib die Generierungs-ID an.",
    },
  },
  {
    no: 21, key: "brief:21", slug: "czy-grafiki-nadaja-sie-na-allegro", category: "jakosc-i-wyniki", pages: ["faq"], visible: true,
    question: {
      pl: "Czy grafiki nadają się na Allegro i inne marketplace’y?",
      en: "Are the images suitable for Allegro and other marketplaces?",
      de: "Eignen sich die Grafiken für Allegro und andere Marktplätze?",
    },
    answer: {
      pl: "Narzędzia są przygotowane z myślą o wymaganiach marketplace’ów, np. kwadratowy format i czyste tło. Zasady poszczególnych platform się zmieniają, dlatego przed wystawieniem oferty sprawdź aktualny regulamin platformy.",
      en: "The tools are designed with marketplace requirements in mind, such as a square format and a clean background. Each platform's rules change, so check its current terms before you publish a listing.",
      de: "Die Werkzeuge sind auf die Anforderungen von Marktplätzen ausgelegt, etwa ein quadratisches Format und ein sauberer Hintergrund. Die Regeln der einzelnen Plattformen ändern sich, prüfe deshalb vor dem Einstellen eines Angebots die aktuellen Bedingungen der Plattform.",
    },
  },
  {
    no: 22, key: "brief:22", slug: "rozdzielczosc-i-format-grafik", category: "jakosc-i-wyniki", pages: ["faq"], visible: false,
    question: {
      pl: "W jakiej rozdzielczości i formacie pobiorę grafiki?",
      en: "In what resolution and format can I download the images?",
      de: "In welcher Auflösung und welchem Format lade ich die Grafiken herunter?",
    },
    answer: { pl: "[DO POTWIERDZENIA: rozdzielczość i formaty]" },
    note: "Do uzupełnienia: rozdzielczość i formaty.",
  },

  /* ── PRAWA I DANE ───────────────────────────────────────────────────── */
  {
    no: 23, key: "brief:23", slug: "czy-moge-uzywac-grafik-komercyjnie", category: "prawa-i-dane", pages: ["faq"], visible: false,
    question: { pl: "Czy mogę używać grafik komercyjnie?", en: "Can I use the images commercially?", de: "Darf ich die Grafiken kommerziell nutzen?" },
    answer: {
      pl: "Tak, grafiki wygenerowane w płatnym planie możesz wykorzystywać w swoich ofertach, sklepie i reklamach. [DO POTWIERDZENIA: zakres zgodny z regulaminem]",
    },
    note: "Do uzupełnienia: zakres zgodny z regulaminem.",
  },
  {
    no: 24, key: "brief:24", slug: "co-dzieje-sie-z-moimi-zdjeciami", category: "prawa-i-dane", pages: ["faq", "o-nas"], visible: false,
    legacy: ["o-nas:Co dzieje się z moimi zdjęciami?"],
    question: { pl: "Co dzieje się z moimi zdjęciami?", en: "What happens to my photos?", de: "Was passiert mit meinen Fotos?" },
    answer: { pl: "[DO POTWIERDZENIA: przechowywanie, okres usuwania, przekazywanie dostawcom modeli]" },
    note: "Do uzupełnienia: przechowywanie, okres usuwania, przekazywanie dostawcom modeli.",
  },
  {
    no: 25, key: "brief:25", slug: "czy-zdjecia-sa-uzywane-do-trenowania-ai", category: "prawa-i-dane", pages: ["faq", "o-nas"], visible: false,
    question: {
      pl: "Czy moje zdjęcia są używane do trenowania AI?",
      en: "Are my photos used to train AI?",
      de: "Werden meine Fotos zum Trainieren von KI verwendet?",
    },
    answer: { pl: "[DO POTWIERDZENIA]" },
    note: "Do uzupełnienia: odpowiedź z briefu to [DO POTWIERDZENIA].",
  },

  /* ── KONTO I FIRMA ──────────────────────────────────────────────────── */
  {
    no: 26, key: "brief:26", slug: "jak-usunac-konto", category: "konto-i-firma", pages: ["faq"], visible: false,
    question: { pl: "Jak usunąć konto?", en: "How do I delete my account?", de: "Wie lösche ich mein Konto?" },
    answer: { pl: "[DO POTWIERDZENIA: w ustawieniach konta lub przez kontakt]" },
    note: "Do uzupełnienia: w ustawieniach konta czy przez kontakt.",
  },
  {
    no: 27, key: "brief:27", slug: "czy-moge-dodac-wspolpracownikow", category: "konto-i-firma", pages: ["faq"], visible: false, needsReview: true,
    question: {
      pl: "Czy mogę dodać do konta współpracowników?",
      en: "Can I add collaborators to my account?",
      de: "Kann ich meinem Konto Mitarbeitende hinzufügen?",
    },
    answer: {
      pl: "Praca zespołowa jest w przygotowaniu i będzie dostępna w planach PRO i Business.",
      en: "Team collaboration is in preparation and will be available on the PRO and Business plans.",
      de: "Teamarbeit ist in Vorbereitung und wird in den Plänen PRO und Business verfügbar sein.",
    },
    note: "Wymaga weryfikacji: konfiguracja planów przewiduje miejsca w zespole także w planie Starter (Starter 2, PRO 5, Business bez limitu — wszystkie oznaczone „wkrótce”).",
  },
  {
    no: 28, key: "brief:28", slug: "kto-stoi-za-grovbase", category: "konto-i-firma", pages: ["faq", "o-nas"], visible: true,
    legacy: ["o-nas:Kto stoi za GrovBase?"],
    question: { pl: "Kto stoi za GrovBase?", en: "Who is behind GrovBase?", de: "Wer steht hinter GrovBase?" },
    answer: {
      pl: "GrovBase tworzą Jakub, grafik e-commerce z ponad pięcioletnim doświadczeniem, i Marcel, który od ponad sześciu lat projektuje i buduje sklepy internetowe.",
      en: "GrovBase is made by Jakub, an e-commerce designer with more than five years of experience, and Marcel, who has been designing and building online shops for more than six years.",
      de: "GrovBase wird von Jakub entwickelt, einem E-Commerce-Grafiker mit mehr als fünf Jahren Erfahrung, und von Marcel, der seit über sechs Jahren Onlineshops konzipiert und baut.",
    },
  },
  {
    no: 29, key: "brief:29", slug: "dane-firmy", category: "konto-i-firma", pages: ["faq", "o-nas"], visible: false,
    legacy: ["o-nas:Dane firmy"],
    question: { pl: "Dane firmy", en: "Company details", de: "Firmendaten" },
    answer: { pl: "[nazwa firmy], [adres], NIP [numer]" },
    note: "Do uzupełnienia: nazwa firmy, adres, NIP.",
  },

  /* ── NADCHODZĄCE FUNKCJE ────────────────────────────────────────────── */
  {
    no: 30, key: "brief:30", slug: "kiedy-pojawi-sie-generowanie-wideo", category: "nadchodzace-funkcje", pages: ["faq"], visible: true,
    question: {
      pl: "Kiedy pojawi się generowanie wideo?",
      en: "When will video generation be available?",
      de: "Wann kommt die Videogenerierung?",
    },
    answer: {
      pl: "Pracujemy nad tym. Na stronie głównej aplikacji kliknij „Powiadom mnie” przy wideo – damy znać, gdy będzie gotowe.",
      en: "We are working on it. On the app's home page, click “Notify me” next to video – we will let you know when it is ready.",
      de: "Wir arbeiten daran. Klicke auf der Startseite der App bei Video auf „Benachrichtigen“ – wir sagen dir Bescheid, sobald sie fertig ist.",
    },
  },
];

/**
 * The O nas questions the brief has no twin for, and where they go. The
 * migration reads their CURRENT words from the live about_faq section; one it
 * does not recognise (an admin added it) is imported too, into the first
 * category, under a slug made from its Polish title.
 */
export const FAQ_ABOUT_EXTRAS: readonly { title: string; slug: string; category: string; after: string }[] = [
  { title: "Czym różnicie się od innych narzędzi AI do zdjęć?", slug: "czym-roznicie-sie-od-innych-narzedzi", category: "pierwsze-kroki", after: "czy-grovbase-dziala-na-telefonie" },
  { title: "Na jakich modelach AI pracujecie?", slug: "na-jakich-modelach-ai-pracujecie", category: "jakosc-i-wyniki", after: "rozdzielczosc-i-format-grafik" },
];

/** The O nas titles the brief's own records replace (their words win). */
export const FAQ_ABOUT_MAPPED: readonly string[] = FAQ_SEED_ITEMS
  .flatMap((it) => (it.legacy ?? []).filter((l) => l.startsWith("o-nas:")).map((l) => l.slice("o-nas:".length)));

/**
 * The /faq page's one section (faq_page): its own words, every one editable
 * in "Edytuj stronę". The questions are not here — they are the base.
 * The hero's line is three fields so the link can be a link:
 * "{subtitle} [{ctaLabel}]({ctaUrl}) {description}".
 */
export const FAQ_PAGE_SEED = {
  content: {
    badge: { pl: "POMOC", en: "HELP", de: "HILFE" },
    title: { pl: "Najczęstsze pytania", en: "Frequently asked questions", de: "Häufige Fragen" },
    subtitle: { pl: "Nie znalazłeś odpowiedzi?", en: "Didn't find an answer?", de: "Keine Antwort gefunden?" },
    ctaLabel: { pl: "Napisz do nas", en: "Write to us", de: "Schreib uns" },
    ctaUrl: "/kontakt",
    description: {
      pl: "– odpowiadamy w ciągu 1 dnia roboczego.",
      en: "– we reply within 1 business day.",
      de: "– wir antworten innerhalb von 1 Werktag.",
    },
    cta2Label: { pl: "Napisz do nas", en: "Write to us", de: "Schreib uns" },
    cta2Url: "/kontakt",
    fields: {
      "find.placeholder": { pl: "Szukaj w pytaniach…", en: "Search the questions…", de: "Fragen durchsuchen…" },
      "find.empty": { pl: "Nic nie znaleźliśmy.", en: "We found nothing.", de: "Wir haben nichts gefunden." },
      "find.emptyHint": { pl: "Napisz do nas", en: "Write to us", de: "Schreib uns" },
      "find.emptyCta": { pl: "Kontakt", en: "Contact", de: "Kontakt" },
      "topics.label": { pl: "Kategorie pytań", en: "Question categories", de: "Fragenkategorien" },
      "end.title": { pl: "Nie znalazłeś odpowiedzi?", en: "Didn't find an answer?", de: "Keine Antwort gefunden?" },
      "vote.question": { pl: "Czy to pomogło?", en: "Did this help?", de: "Hat dir das geholfen?" },
      "vote.yes": { pl: "Tak", en: "Yes", de: "Ja" },
      "vote.no": { pl: "Nie", en: "No", de: "Nein" },
      "vote.thanks": { pl: "Dziękujemy za ocenę!", en: "Thanks for your feedback!", de: "Danke für deine Bewertung!" },
      "vote.sorry": {
        pl: "Dziękujemy. Przykro nam, że ta odpowiedź nie pomogła.",
        en: "Thank you. We're sorry this answer didn't help.",
        de: "Danke. Schade, dass diese Antwort nicht geholfen hat.",
      },
      "vote.contact": { pl: "Napisz do nas", en: "Write to us", de: "Schreib uns" },
      "link.copy": { pl: "Kopiuj link", en: "Copy link", de: "Link kopieren" },
      "link.copied": { pl: "Skopiowano link", en: "Link copied", de: "Link kopiert" },
    },
  },
  style: { base: { paddingTop: "lg", paddingBottom: "lg" } },
  analyticsId: "faq.page",
  seo: {
    pl: {
      title: "FAQ — najczęstsze pytania o GrovBase",
      description: "Odpowiedzi na najczęstsze pytania o GrovBase: pierwsze kroki, kredyty i plany, płatności, jakość grafik, prawa i dane, konto.",
    },
    en: {
      title: "FAQ — frequently asked questions about GrovBase",
      description: "Answers to the most common questions about GrovBase: getting started, credits and plans, payments, image quality, rights and data, your account.",
    },
    de: {
      title: "FAQ — häufige Fragen zu GrovBase",
      description: "Antworten auf die häufigsten Fragen zu GrovBase: erste Schritte, Credits und Pläne, Zahlungen, Bildqualität, Rechte und Daten, dein Konto.",
    },
    ogImage: "https://grovbase.com/launch/og.jpg",
  },
  /** The footer's "Pomoc" column: FAQ right above Kontakt. */
  navGroup: "help",
  navOrder: 15,
} as const;

/** Kontakt goes back to "Pomoc" (0154 had moved it to "Firma"). */
export const FAQ_CONTACT_NAV = { navGroup: "help", navOrder: 20 } as const;

/** The Kontakt page's FAQ links, old address → new one (0156). */
export const FAQ_CONTACT_LINKS: readonly { title: string; from: string | null; to: string }[] = [
  { title: "Jak działają kredyty?", from: "/plany#faq-credits", to: "/faq#jak-dzialaja-kredyty" },
  { title: "Jak kupić dodatkowe kredyty?", from: "/plany#faq-topups", to: "/faq#jak-kupic-dodatkowe-kredyty" },
  { title: "Czy subskrypcja odnawia się automatycznie?", from: "/plany#faq-renewal", to: "/faq#czy-subskrypcja-odnawia-sie-automatycznie" },
  { title: "Czy istnieje możliwość zwrotu?", from: "/plany#faq-refunds", to: "/faq#czy-istnieje-mozliwosc-zwrotu" },
  { title: "Jak otrzymać fakturę VAT?", from: null, to: "/faq#czy-otrzymam-fakture-vat" },
];
