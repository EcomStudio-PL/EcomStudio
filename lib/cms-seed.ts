import type { CmsBlock, LocaleText, PageSeo, SectionStyle } from "./cms";

/**
 * THE PUBLIC WEBSITE, AS A STARTING POINT.
 *
 * Seven pages, every one of them a DRAFT. Nothing here publishes anything and
 * nothing here touches the waiting-list page that is currently the front door
 * — the new homepage is the `home` row, which only becomes public when an
 * admin switches the homepage mode, and that switch is not flipped by this
 * file or by anything that calls it.
 *
 * WHY IT IS CODE AND NOT A MIGRATION. This is COPY. It is going to be rewritten
 * by whoever owns the marketing voice, in three languages, probably next week.
 * Keeping it in TypeScript means it is reviewable in a diff, can be re-seeded
 * onto an empty page from the panel, and can be typed — a section with a field
 * the renderer does not read is a compile error here rather than a blank
 * region on a live page.
 *
 * WHAT IS DELIBERATELY NOT HERE:
 *
 *   LEGAL TEXT. Regulamin and Polityka prywatności get their STRUCTURE — the
 *   headings a document like that needs, the table of contents, the reading
 *   column — and an explicit placeholder saying the wording is being prepared.
 *   Inventing terms of service or a privacy policy would be worse than having
 *   none: somebody would believe it.
 *
 *   PRICES, TOOL NAMES AND MODEL NAMES. /cennik renders `subscription_plans`,
 *   /narzedzia renders FEATURE_REGISTRY and /o-nas's model list renders
 *   `ai_models`. A marketing page with its own copy of any of those is a page
 *   that lies the first time an operator changes one.
 *
 *   CLAIMS WE CANNOT BACK. No invented customer counts, no fake testimonials,
 *   no logos of companies that are not customers. The social-proof section
 *   exists and is EMPTY, ready for real ones.
 */

const L = (pl: string, en: string, de: string): LocaleText => ({ pl, en, de });

/** A section, with the two things every one of them needs spelled out. */
type Seed = {
  type: string;
  content: CmsBlock["content"];
  style?: SectionStyle;
  anchor?: string;
  analyticsId?: string;
};

export type SeedPage = {
  slug: string;
  title: string;
  navGroup: string | null;
  navOrder: number;
  seo: PageSeo;
  sections: Seed[];
  /**
   * Replace the sections of a page that already has some.
   *
   * True for exactly one page: `home`, which has carried the previous
   * default layout since the CMS was first seeded and is what this brief
   * asks to be rebuilt. Everywhere else a page with sections is somebody's
   * work and is left alone.
   *
   * REPLACING IS NOT DESTROYING. The caller snapshots the outgoing draft into
   * cms_page_versions first, so the old layout is one click away in Historia
   * and the page is not published either way.
   */
  replaceExisting?: boolean;
};

/* ── SHARED PIECES ───────────────────────────────────────────────────────── */

const CTA_PRIMARY = {
  ctaLabel: L("Zacznij za darmo", "Start for free", "Kostenlos starten"),
  ctaUrl: "/register",
};

const wide: SectionStyle = { base: { width: "wide" } };
const narrow: SectionStyle = { base: { width: "narrow" } };
const centred: SectionStyle = { base: { align: "center" } };

/* ── 1. STRONA GŁÓWNA ────────────────────────────────────────────────────── */

const HOME: SeedPage = {
  slug: "home",
  title: "Strona główna",
  navGroup: null,
  navOrder: 0,
  // The one page this seed rebuilds rather than skips — see the field's own
  // comment. The outgoing draft is kept as a version first.
  replaceExisting: true,
  seo: {
    pl: {
      title: "GrovBase — zdjęcia produktowe, które sprzedają",
      description: "Zamień kilka zdjęć produktu w gotowe materiały sprzedażowe: packshoty, sesje lifestyle i kreacje reklamowe. Bez studia, bez fotografa, bez czekania.",
    },
    en: {
      title: "GrovBase — product photography that sells",
      description: "Turn a few product photos into finished sales material: packshots, lifestyle shoots and ad creative. No studio, no photographer, no waiting.",
    },
    de: {
      title: "GrovBase — Produktfotos, die verkaufen",
      description: "Aus wenigen Produktfotos werden fertige Verkaufsmaterialien: Packshots, Lifestyle-Shootings und Werbemotive. Ohne Studio, ohne Fotograf, ohne Wartezeit.",
    },
  },
  sections: [
    {
      type: "hero",
      analyticsId: "homepage.hero.cta",
      style: { base: { paddingTop: "xl", paddingBottom: "lg", width: "wide" } },
      content: {
        badge: L("AI DLA E-COMMERCE", "AI FOR E-COMMERCE", "KI FÜR E-COMMERCE"),
        title: L(
          "Twój produkt. Sesja zdjęciowa, której nigdy nie musiałeś zamawiać.",
          "Your product. The photo shoot you never had to book.",
          "Dein Produkt. Das Shooting, das du nie buchen musstest.",
        ),
        subtitle: L(
          "Wgraj kilka zwykłych zdjęć. GrovBase zwraca packshoty, ujęcia lifestyle i kreacje reklamowe — z zachowaniem kształtu, kolorów i detali Twojego produktu.",
          "Upload a few ordinary photos. GrovBase returns packshots, lifestyle shots and ad creative — with your product's shape, colours and details intact.",
          "Lade ein paar gewöhnliche Fotos hoch. GrovBase liefert Packshots, Lifestyle-Aufnahmen und Werbemotive — Form, Farben und Details deines Produkts bleiben erhalten.",
        ),
        ...CTA_PRIMARY,
        cta2Label: L("Zobacz efekty", "See the results", "Ergebnisse ansehen"),
        cta2Url: "#efekty",
      },
    },
    {
      type: "showcase",
      anchor: "efekty",
      style: wide,
      content: {
        title: L("Efekty, nie obietnice", "Results, not promises", "Ergebnisse statt Versprechen"),
        description: L(
          "Każde z tych zdjęć powstało z jednego zwykłego zdjęcia produktu.",
          "Every one of these started life as one ordinary product photo.",
          "Jedes dieser Bilder entstand aus einem gewöhnlichen Produktfoto.",
        ),
        // Deliberately empty: the gallery is filled from the media library
        // with real generations, not with stock images pretending to be ours.
        items: [],
      },
    },
    {
      type: "use_cases",
      content: {
        title: L("Dla kogo jest GrovBase", "Who GrovBase is for", "Für wen GrovBase gedacht ist"),
        items: [
          { title: L("Allegro", "Allegro", "Allegro") },
          { title: L("Amazon", "Amazon", "Amazon") },
          { title: L("Sklepy internetowe", "Online shops", "Onlineshops") },
          { title: L("Marki własne", "Own brands", "Eigenmarken") },
          { title: L("Importerzy", "Importers", "Importeure") },
          { title: L("Hurtownie", "Wholesalers", "Großhändler") },
        ],
      },
    },
    {
      type: "tools_grid",
      style: wide,
      content: {
        title: L("Narzędzia, które robią robotę", "The tools that do the work", "Werkzeuge, die die Arbeit machen"),
        description: L(
          "Każde z nich działa na Twoich własnych zdjęciach.",
          "Every one of them works on your own photographs.",
          "Jedes davon arbeitet mit deinen eigenen Fotos.",
        ),
        // Empty filter = the whole registry. The list is the product's, not
        // a copy of it.
        filter: ["image", "edit"],
      },
    },
    {
      type: "models",
      content: {
        title: L("Silniki, na których to działa", "The engines behind it", "Die Engines dahinter"),
        description: L(
          "Wybieramy model do zadania, a nie zadanie do modelu.",
          "We pick the model for the job, not the job for the model.",
          "Wir wählen das Modell zur Aufgabe, nicht die Aufgabe zum Modell.",
        ),
      },
    },
    {
      type: "workflow",
      style: { base: { columns: 3, background: "sunken" } },
      content: {
        title: L("Jak to działa", "How it works", "So funktioniert es"),
        items: [
          {
            title: L("Wgraj zdjęcia", "Upload your photos", "Fotos hochladen"),
            description: L(
              "Zwykłe zdjęcia z telefonu wystarczą. Im więcej ujęć, tym lepiej AI rozumie produkt.",
              "Ordinary phone photos are enough. The more angles, the better the AI understands the product.",
              "Gewöhnliche Handyfotos genügen. Je mehr Perspektiven, desto besser versteht die KI das Produkt.",
            ),
          },
          {
            title: L("Wybierz efekt", "Choose the result", "Ergebnis wählen"),
            description: L(
              "Packshot, sesja lifestyle, kreacja reklamowa albo Twój własny opis sceny.",
              "A packshot, a lifestyle shoot, ad creative — or your own description of the scene.",
              "Packshot, Lifestyle-Shooting, Werbemotiv — oder deine eigene Szenenbeschreibung.",
            ),
          },
          {
            title: L("Pobierz i sprzedawaj", "Download and sell", "Herunterladen und verkaufen"),
            description: L(
              "Gotowe pliki w formatach pod Allegro, Amazon, sklep i social media.",
              "Finished files sized for Allegro, Amazon, your shop and social media.",
              "Fertige Dateien in den Formaten für Allegro, Amazon, Shop und Social Media.",
            ),
          },
        ],
      },
    },
    {
      type: "before_after",
      style: wide,
      content: {
        title: L("Przed i po", "Before and after", "Vorher und nachher"),
        description: L(
          "Ten sam produkt. Różnica jest w tym, co widzi kupujący.",
          "The same product. The difference is what the buyer sees.",
          "Dasselbe Produkt. Der Unterschied ist, was der Käufer sieht.",
        ),
      },
    },
    {
      type: "product_lock",
      content: {
        badge: L("PRODUCT LOCK", "PRODUCT LOCK", "PRODUCT LOCK"),
        title: L(
          "Twój produkt zostaje Twoim produktem",
          "Your product stays your product",
          "Dein Produkt bleibt dein Produkt",
        ),
        description: L(
          "Generator, który „poprawia” kształt butelki albo dokłada guzik, jest bezużyteczny w e-commerce. Każde zlecenie niesie ze sobą opis wierności produktu, a wynik jest sprawdzany pod jego kątem.",
          "A generator that “improves” the shape of a bottle or adds a button is useless in e-commerce. Every request carries a product-fidelity instruction, and the result is checked against it.",
          "Ein Generator, der die Form einer Flasche „verbessert“ oder einen Knopf hinzufügt, ist im E-Commerce nutzlos. Jede Anfrage trägt eine Produkttreue-Anweisung, und das Ergebnis wird daran geprüft.",
        ),
        items: [
          { title: L("Kształt i proporcje", "Shape and proportions", "Form und Proportionen") },
          { title: L("Kolory", "Colours", "Farben") },
          { title: L("Liczba sztuk", "Item count", "Stückzahl") },
          { title: L("Etykiety i napisy", "Labels and text", "Etiketten und Aufschriften") },
          { title: L("Materiał", "Material", "Material") },
          { title: L("Skala", "Scale", "Maßstab") },
        ],
      },
    },
    {
      type: "testimonials",
      style: wide,
      content: {
        title: L("Co mówią sprzedawcy", "What sellers say", "Was Verkäufer sagen"),
        // EMPTY ON PURPOSE. An invented testimonial is a lie printed on the
        // homepage. This section is here, ready, for the first real one.
        items: [],
      },
    },
    {
      type: "pricing_table",
      anchor: "cennik",
      style: wide,
      content: {
        title: L("Proste ceny", "Simple pricing", "Einfache Preise"),
        description: L(
          "Płacisz za wygenerowane materiały, nie za dostęp.",
          "You pay for the material you generate, not for access.",
          "Du zahlst für erzeugte Materialien, nicht für den Zugang.",
        ),
        ctaLabel: L("Wybierz plan", "Choose a plan", "Plan wählen"),
        ctaUrl: "/cennik",
      },
    },
    {
      type: "faq",
      anchor: "faq",
      content: {
        title: L("Najczęstsze pytania", "Frequently asked", "Häufige Fragen"),
        items: [
          {
            title: L(
              "Czy zdjęcia z telefonu wystarczą?",
              "Are phone photos good enough?",
              "Reichen Handyfotos aus?",
            ),
            description: L(
              "Tak. Potrzebny jest ostry produkt na w miarę równym tle. Reszta to już zadanie GrovBase.",
              "Yes. What is needed is a sharp product on a reasonably even background. The rest is GrovBase's job.",
              "Ja. Nötig ist ein scharfes Produkt vor einem einigermaßen gleichmäßigen Hintergrund. Den Rest übernimmt GrovBase.",
            ),
          },
          {
            title: L(
              "Czy produkt na zdjęciu będzie wyglądał jak mój?",
              "Will the product look like mine?",
              "Sieht das Produkt aus wie meines?",
            ),
            description: L(
              "To jest cały sens Product Lock. Kształt, kolory, liczba sztuk, etykiety i materiał są chronione, a wynik dostaje ocenę zgodności z oryginałem.",
              "That is the entire point of Product Lock. Shape, colours, item count, labels and material are protected, and the result is scored against the original.",
              "Genau dafür gibt es Product Lock. Form, Farben, Stückzahl, Etiketten und Material sind geschützt, und das Ergebnis wird mit dem Original abgeglichen.",
            ),
          },
          {
            title: L(
              "Czy mogę używać tych zdjęć komercyjnie?",
              "Can I use the images commercially?",
              "Darf ich die Bilder kommerziell nutzen?",
            ),
            description: L(
              "Tak — po to powstały. Szczegóły znajdziesz w Regulaminie.",
              "Yes — that is what they are for. The details are in the Terms.",
              "Ja — dafür sind sie gemacht. Die Details stehen in den AGB.",
            ),
          },
        ],
      },
    },
    {
      type: "cta",
      analyticsId: "homepage.final_cta.register",
      style: { base: { background: "gradient", align: "center", paddingTop: "xl", paddingBottom: "xl" } },
      content: {
        title: L(
          "Zobacz, jak wygląda Twój produkt w dobrym świetle",
          "See what your product looks like in a good light",
          "Sieh dein Produkt im richtigen Licht",
        ),
        description: L(
          "Załóż konto i wygeneruj pierwszą sesję w kilka minut.",
          "Create an account and generate your first shoot in minutes.",
          "Konto erstellen und das erste Shooting in wenigen Minuten erzeugen.",
        ),
        ...CTA_PRIMARY,
      },
    },
  ],
};

/* ── 2. NARZĘDZIA ────────────────────────────────────────────────────────── */

const TOOLS: SeedPage = {
  slug: "narzedzia",
  title: "Narzędzia",
  navGroup: "main",
  navOrder: 10,
  seo: {
    pl: {
      title: "Narzędzia GrovBase",
      description: "Wszystkie narzędzia GrovBase w jednym miejscu: generowanie zdjęć produktowych, retusz, usuwanie tła, zmiana formatu, kompresja i więcej.",
    },
    en: {
      title: "GrovBase tools",
      description: "Every GrovBase tool in one place: product image generation, retouching, background removal, resizing, compression and more.",
    },
    de: {
      title: "GrovBase-Werkzeuge",
      description: "Alle GrovBase-Werkzeuge an einem Ort: Produktbild-Generierung, Retusche, Freistellen, Formatwechsel, Komprimierung und mehr.",
    },
  },
  sections: [
    {
      type: "hero",
      style: { base: { paddingTop: "lg", paddingBottom: "sm", align: "center", width: "narrow" } },
      content: {
        title: L("Wszystko, co robisz ze zdjęciem produktu", "Everything you do to a product photo", "Alles, was du mit einem Produktfoto machst"),
        subtitle: L(
          "Od pierwszego ujęcia do pliku gotowego na marketplace.",
          "From the first shot to a file ready for the marketplace.",
          "Vom ersten Foto bis zur marktplatzfertigen Datei.",
        ),
      },
    },
    {
      type: "tools_grid",
      style: { base: { width: "wide", columns: 3 } },
      content: {
        title: L("Obraz", "Image", "Bild"),
        filter: ["image"],
      },
    },
    {
      type: "tools_grid",
      style: { base: { width: "wide", columns: 3 } },
      content: {
        title: L("Edycja", "Editing", "Bearbeitung"),
        filter: ["edit"],
      },
    },
    {
      type: "tools_grid",
      style: { base: { width: "wide", columns: 3 } },
      content: {
        title: L("Tworzenie", "Creation", "Erstellung"),
        filter: ["create"],
      },
    },
    {
      type: "tools_grid",
      style: { base: { width: "wide", columns: 3 } },
      content: {
        title: L("Wideo", "Video", "Video"),
        filter: ["video"],
      },
    },
    {
      type: "cta",
      style: { base: { background: "soft", align: "center" } },
      content: {
        title: L("Wypróbuj na swoim produkcie", "Try it on your own product", "Probiere es an deinem Produkt"),
        ...CTA_PRIMARY,
      },
    },
  ],
};

/* ── 3. CENNIK ───────────────────────────────────────────────────────────── */

const PRICING: SeedPage = {
  slug: "cennik",
  title: "Cennik",
  navGroup: "main",
  navOrder: 20,
  seo: {
    pl: {
      title: "Cennik GrovBase",
      description: "Plany i kredyty GrovBase. Płacisz za wygenerowane materiały, nie za sam dostęp.",
    },
    en: {
      title: "GrovBase pricing",
      description: "GrovBase plans and credits. You pay for the material you generate, not for access.",
    },
    de: {
      title: "GrovBase-Preise",
      description: "GrovBase-Pläne und Credits. Du zahlst für erzeugte Materialien, nicht für den Zugang.",
    },
  },
  sections: [
    {
      type: "hero",
      style: { base: { paddingTop: "lg", paddingBottom: "sm", align: "center", width: "narrow" } },
      content: {
        title: L("Płacisz za efekt", "You pay for the result", "Du zahlst für das Ergebnis"),
        subtitle: L(
          "Kredyty zużywają się przy generowaniu. Narzędzia edycyjne, biblioteka i eksport są w każdym planie.",
          "Credits are spent on generation. The editing tools, the library and export are in every plan.",
          "Credits werden beim Generieren verbraucht. Bearbeitungswerkzeuge, Bibliothek und Export sind in jedem Plan enthalten.",
        ),
      },
    },
    {
      type: "pricing_table",
      style: { base: { width: "wide" } },
      content: {
        ctaLabel: L("Wybierz", "Choose", "Wählen"),
        ctaUrl: "/register",
      },
    },
    {
      type: "faq",
      style: narrow,
      content: {
        title: L("Pytania o rozliczenia", "Billing questions", "Fragen zur Abrechnung"),
        items: [
          {
            title: L("Czym jest kredyt?", "What is a credit?", "Was ist ein Credit?"),
            description: L(
              "Jednostką rozliczeniową za generowanie. Koszt jednej generacji zależy od użytego modelu i jest pokazany zanim ją uruchomisz.",
              "The unit generation is billed in. What one generation costs depends on the model used, and is shown before you start it.",
              "Die Abrechnungseinheit für Generierungen. Was eine Generierung kostet, hängt vom Modell ab und wird vor dem Start angezeigt.",
            ),
          },
          {
            title: L("Czy niewykorzystane kredyty przepadają?", "Do unused credits expire?", "Verfallen ungenutzte Credits?"),
            description: L(
              "Zasady rozliczania kredytów opisuje Regulamin.",
              "How credits are settled is described in the Terms.",
              "Wie Credits abgerechnet werden, steht in den AGB.",
            ),
          },
        ],
      },
    },
    {
      type: "cta",
      style: { base: { background: "soft", align: "center" } },
      content: {
        title: L("Masz pytanie o wycenę?", "A question about pricing?", "Eine Frage zum Preis?"),
        ctaLabel: L("Napisz do nas", "Write to us", "Schreib uns"),
        ctaUrl: "/kontakt",
      },
    },
  ],
};

/* ── 4. O NAS ────────────────────────────────────────────────────────────── */

const ABOUT: SeedPage = {
  slug: "o-nas",
  title: "O nas",
  navGroup: "company",
  navOrder: 10,
  seo: {
    pl: {
      title: "O GrovBase",
      description: "Dlaczego powstał GrovBase i dla kogo jest zbudowany.",
    },
    en: { title: "About GrovBase", description: "Why GrovBase exists and who it is built for." },
    de: { title: "Über GrovBase", description: "Warum es GrovBase gibt und für wen es gebaut ist." },
  },
  sections: [
    {
      type: "hero",
      style: { base: { paddingTop: "lg", paddingBottom: "sm", width: "narrow" } },
      content: {
        title: L(
          "Zbudowaliśmy to, czego sami szukaliśmy",
          "We built the thing we were looking for",
          "Wir haben gebaut, wonach wir selbst gesucht haben",
        ),
        subtitle: L(
          "GrovBase powstał z jednego problemu: dobre zdjęcie produktowe kosztuje więcej niż marża na produkcie.",
          "GrovBase came out of one problem: a good product photo costs more than the margin on the product.",
          "GrovBase entstand aus einem Problem: ein gutes Produktfoto kostet mehr als die Marge am Produkt.",
        ),
      },
    },
    {
      type: "text",
      style: narrow,
      content: {
        title: L("Czym jest GrovBase", "What GrovBase is", "Was GrovBase ist"),
        description: L(
          "Narzędziem do robienia materiałów sprzedażowych ze zdjęć, które sprzedawca już ma.\n\nNie jest generatorem obrazków ani zabawką do eksperymentów z AI. Jest narzędziem pracy dla kogoś, kto ma sto produktów w magazynie i żadnego budżetu na sesję dla każdego z nich.",
          "A tool for making sales material out of the photographs a seller already has.\n\nIt is not an image generator or a toy for experimenting with AI. It is a working tool for somebody with a hundred products in a warehouse and no budget for a shoot for each one.",
          "Ein Werkzeug, um aus vorhandenen Fotos Verkaufsmaterial zu machen.\n\nEs ist kein Bildgenerator und kein KI-Spielzeug. Es ist ein Arbeitsgerät für jemanden mit hundert Produkten im Lager und ohne Budget für ein Shooting pro Produkt.",
        ),
      },
    },
    {
      type: "text",
      style: narrow,
      content: {
        title: L("Dlaczego powstał", "Why it exists", "Warum es entstanden ist"),
        description: L(
          "Bo sprzedaż w internecie wygrywa się zdjęciem, a zdjęcie jest najdroższym i najwolniejszym elementem całego procesu.\n\nSesja to termin, studio, fotograf, retusz i tydzień czekania — na produkt, który być może okaże się nietrafiony. GrovBase skraca ten cykl do kilku minut, a koszt do ułamka.",
          "Because online sales are won with a photograph, and the photograph is the most expensive and slowest part of the whole process.\n\nA shoot means a date, a studio, a photographer, retouching and a week of waiting — for a product that may not sell at all. GrovBase shortens that cycle to minutes and the cost to a fraction.",
          "Weil Onlineverkauf über das Foto entschieden wird — und das Foto ist der teuerste und langsamste Teil des Prozesses.\n\nEin Shooting bedeutet Termin, Studio, Fotograf, Retusche und eine Woche Wartezeit — für ein Produkt, das sich vielleicht gar nicht verkauft. GrovBase verkürzt diesen Zyklus auf Minuten und die Kosten auf einen Bruchteil.",
        ),
      },
    },
    {
      type: "benefits",
      style: { base: { columns: 3, background: "sunken" } },
      content: {
        title: L("Nasze podejście", "How we work", "Unser Ansatz"),
        items: [
          {
            icon: "shield",
            title: L("Wierność przed kreatywnością", "Fidelity before creativity", "Treue vor Kreativität"),
            description: L(
              "Ładne zdjęcie cudzego produktu jest bezwartościowe. Kształt, kolor i detal są ważniejsze niż efekt artystyczny.",
              "A beautiful photo of somebody else's product is worthless. Shape, colour and detail matter more than artistic effect.",
              "Ein schönes Foto eines fremden Produkts ist wertlos. Form, Farbe und Detail zählen mehr als künstlerischer Effekt.",
            ),
          },
          {
            icon: "zap",
            title: L("Bez uzależnienia od jednego dostawcy", "No single-vendor lock-in", "Keine Abhängigkeit von einem Anbieter"),
            description: L(
              "Modele AI zmieniają się co kilka miesięcy. GrovBase dobiera model do zadania i wymienia go, kiedy pojawi się lepszy.",
              "AI models change every few months. GrovBase picks the model for the job and swaps it when a better one appears.",
              "KI-Modelle ändern sich alle paar Monate. GrovBase wählt das Modell zur Aufgabe und tauscht es, sobald ein besseres kommt.",
            ),
          },
          {
            icon: "eye",
            title: L("Bez udawania", "No pretending", "Kein Vortäuschen"),
            description: L(
              "Funkcja, która jeszcze nie działa, jest opisana jako niedostępna. Nie pokazujemy przycisków, które nic nie robią.",
              "A feature that does not work yet says so. We do not show buttons that do nothing.",
              "Eine Funktion, die noch nicht läuft, sagt das auch. Wir zeigen keine Buttons, die nichts tun.",
            ),
          },
        ],
      },
    },
    {
      type: "text",
      style: narrow,
      content: {
        title: L("Dla kogo", "Who it is for", "Für wen"),
        description: L(
          "Dla sprzedawców na Allegro i Amazon, sklepów internetowych, marek własnych, importerów i hurtowni — wszędzie tam, gdzie asortyment jest większy niż budżet na fotografię.",
          "For sellers on Allegro and Amazon, online shops, own brands, importers and wholesalers — wherever the range is larger than the photography budget.",
          "Für Verkäufer auf Allegro und Amazon, Onlineshops, Eigenmarken, Importeure und Großhändler — überall dort, wo das Sortiment größer ist als das Fotobudget.",
        ),
      },
    },
    {
      type: "cta",
      style: { base: { align: "center", background: "gradient" } },
      content: {
        title: L("Zacznij od jednego produktu", "Start with one product", "Beginne mit einem Produkt"),
        ...CTA_PRIMARY,
        cta2Label: L("Napisz do nas", "Write to us", "Schreib uns"),
        cta2Url: "/kontakt",
      },
    },
  ],
};

/* ── 5. KONTAKT ──────────────────────────────────────────────────────────── */

const CONTACT: SeedPage = {
  slug: "kontakt",
  title: "Kontakt",
  navGroup: "help",
  navOrder: 10,
  seo: {
    pl: { title: "Kontakt — GrovBase", description: "Napisz do nas w sprawie sprzedaży, pomocy technicznej, partnerstwa lub mediów." },
    en: { title: "Contact — GrovBase", description: "Write to us about sales, support, partnerships or press." },
    de: { title: "Kontakt — GrovBase", description: "Schreib uns zu Vertrieb, Support, Partnerschaften oder Presse." },
  },
  sections: [
    {
      type: "hero",
      style: { base: { paddingTop: "lg", paddingBottom: "sm", width: "narrow" } },
      content: {
        title: L("Napisz do nas", "Write to us", "Schreib uns"),
        subtitle: L(
          "Odpowiadamy w dni robocze, zwykle tego samego dnia.",
          "We reply on working days, usually the same day.",
          "Wir antworten an Werktagen, meist am selben Tag.",
        ),
      },
    },
    {
      type: "contact_form",
      style: narrow,
      analyticsId: "contact.form.submit",
      content: {
        formHandler: "contact",
        ctaLabel: L("Wyślij wiadomość", "Send message", "Nachricht senden"),
        subtitle: L(
          "Wysyłając wiadomość zgadzasz się na przetwarzanie podanych danych w celu udzielenia odpowiedzi. Szczegóły w Polityce prywatności.",
          "By sending this message you agree to your data being processed so that we can reply. Details are in the Privacy policy.",
          "Mit dem Senden stimmst du der Verarbeitung deiner Daten zur Beantwortung zu. Details in der Datenschutzerklärung.",
        ),
        items: [
          { value: "sales", title: L("Sprzedaż", "Sales", "Vertrieb") },
          { value: "support", title: L("Pomoc", "Support", "Support") },
          { value: "partnership", title: L("Partnerstwo", "Partnership", "Partnerschaft") },
          { value: "press", title: L("Media", "Press", "Presse") },
          { value: "other", title: L("Inne", "Other", "Sonstiges") },
        ],
      },
    },
    {
      type: "contact",
      style: narrow,
      content: {
        title: L("Dane firmy", "Company details", "Unternehmensdaten"),
        // Filled in by the operator: inventing a registered address or a tax
        // number would be a fabricated legal record on a public page.
        items: [],
      },
    },
  ],
};

/* ── 6 & 7. DOKUMENTY PRAWNE ─────────────────────────────────────────────── */

/**
 * The legal pages get their structure and an honest placeholder. The wording
 * is a legal document; it is not something this codebase invents. Until
 * somebody writes it, the page says so — which is exactly what these two
 * routes already did before the CMS existed.
 */
function legalPage(
  slug: string, title: string, seo: PageSeo, pending: LocaleText, headings: LocaleText,
): SeedPage {
  return {
    slug, title, navGroup: "legal", navOrder: slug === "regulamin" ? 10 : 20, seo,
    sections: [
      {
        type: "text",
        style: narrow,
        content: { description: pending },
      },
      {
        type: "legal",
        style: narrow,
        content: { html: headings },
      },
    ],
  };
}

const TERMS = legalPage(
  "regulamin",
  "Regulamin",
  {
    pl: { title: "Regulamin — GrovBase", description: "Regulamin korzystania z serwisu GrovBase." },
    en: { title: "Terms — GrovBase", description: "Terms of service for GrovBase." },
    de: { title: "AGB — GrovBase", description: "Nutzungsbedingungen für GrovBase." },
  },
  L(
    "Treść regulaminu jest przygotowywana i zostanie opublikowana przed startem usługi. Poniższy spis wskazuje, co będzie zawierał.",
    "The terms are being prepared and will be published before the service opens. The outline below shows what they will contain.",
    "Die AGB werden vorbereitet und vor dem Start veröffentlicht. Die folgende Gliederung zeigt ihren Inhalt.",
  ),
  L(
    "<h2>Postanowienia ogólne</h2><p>W przygotowaniu.</p><h2>Definicje</h2><p>W przygotowaniu.</p><h2>Warunki korzystania z usługi</h2><p>W przygotowaniu.</p><h2>Konto użytkownika</h2><p>W przygotowaniu.</p><h2>Kredyty i płatności</h2><p>W przygotowaniu.</p><h2>Prawa do wygenerowanych materiałów</h2><p>W przygotowaniu.</p><h2>Odpowiedzialność</h2><p>W przygotowaniu.</p><h2>Reklamacje</h2><p>W przygotowaniu.</p><h2>Odstąpienie od umowy</h2><p>W przygotowaniu.</p><h2>Zmiany regulaminu</h2><p>W przygotowaniu.</p>",
    "<h2>General provisions</h2><p>In preparation.</p><h2>Definitions</h2><p>In preparation.</p><h2>Conditions of use</h2><p>In preparation.</p><h2>User account</h2><p>In preparation.</p><h2>Credits and payments</h2><p>In preparation.</p><h2>Rights to generated material</h2><p>In preparation.</p><h2>Liability</h2><p>In preparation.</p><h2>Complaints</h2><p>In preparation.</p><h2>Withdrawal</h2><p>In preparation.</p><h2>Changes to these terms</h2><p>In preparation.</p>",
    "<h2>Allgemeine Bestimmungen</h2><p>In Vorbereitung.</p><h2>Definitionen</h2><p>In Vorbereitung.</p><h2>Nutzungsbedingungen</h2><p>In Vorbereitung.</p><h2>Benutzerkonto</h2><p>In Vorbereitung.</p><h2>Credits und Zahlungen</h2><p>In Vorbereitung.</p><h2>Rechte an erzeugten Materialien</h2><p>In Vorbereitung.</p><h2>Haftung</h2><p>In Vorbereitung.</p><h2>Beschwerden</h2><p>In Vorbereitung.</p><h2>Widerruf</h2><p>In Vorbereitung.</p><h2>Änderungen der AGB</h2><p>In Vorbereitung.</p>",
  ),
);

const PRIVACY = legalPage(
  "polityka-prywatnosci",
  "Polityka prywatności",
  {
    pl: { title: "Polityka prywatności — GrovBase", description: "Jak GrovBase przetwarza dane osobowe." },
    en: { title: "Privacy policy — GrovBase", description: "How GrovBase processes personal data." },
    de: { title: "Datenschutzerklärung — GrovBase", description: "Wie GrovBase personenbezogene Daten verarbeitet." },
  },
  L(
    "Treść polityki prywatności jest przygotowywana i zostanie opublikowana przed startem usługi. Poniższy spis wskazuje, co będzie zawierała.",
    "The privacy policy is being prepared and will be published before the service opens. The outline below shows what it will contain.",
    "Die Datenschutzerklärung wird vorbereitet und vor dem Start veröffentlicht. Die folgende Gliederung zeigt ihren Inhalt.",
  ),
  L(
    "<h2>Administrator danych</h2><p>W przygotowaniu.</p><h2>Jakie dane zbieramy</h2><p>W przygotowaniu.</p><h2>Cele i podstawy przetwarzania</h2><p>W przygotowaniu.</p><h2>Okres przechowywania</h2><p>W przygotowaniu.</p><h2>Odbiorcy danych i podprocesorzy</h2><p>W przygotowaniu.</p><h2>Przekazywanie poza EOG</h2><p>W przygotowaniu.</p><h2>Twoje prawa</h2><p>W przygotowaniu.</p><h2>Pliki cookie</h2><p>W przygotowaniu.</p><h2>Zdjęcia wgrywane do serwisu</h2><p>W przygotowaniu.</p><h2>Kontakt w sprawie danych</h2><p>W przygotowaniu.</p>",
    "<h2>Data controller</h2><p>In preparation.</p><h2>What we collect</h2><p>In preparation.</p><h2>Purposes and legal bases</h2><p>In preparation.</p><h2>Retention</h2><p>In preparation.</p><h2>Recipients and sub-processors</h2><p>In preparation.</p><h2>Transfers outside the EEA</h2><p>In preparation.</p><h2>Your rights</h2><p>In preparation.</p><h2>Cookies</h2><p>In preparation.</p><h2>Images uploaded to the service</h2><p>In preparation.</p><h2>Contacting us about data</h2><p>In preparation.</p>",
    "<h2>Verantwortlicher</h2><p>In Vorbereitung.</p><h2>Welche Daten wir erheben</h2><p>In Vorbereitung.</p><h2>Zwecke und Rechtsgrundlagen</h2><p>In Vorbereitung.</p><h2>Speicherdauer</h2><p>In Vorbereitung.</p><h2>Empfänger und Auftragsverarbeiter</h2><p>In Vorbereitung.</p><h2>Übermittlung außerhalb des EWR</h2><p>In Vorbereitung.</p><h2>Deine Rechte</h2><p>In Vorbereitung.</p><h2>Cookies</h2><p>In Vorbereitung.</p><h2>Hochgeladene Bilder</h2><p>In Vorbereitung.</p><h2>Kontakt in Datenschutzfragen</h2><p>In Vorbereitung.</p>",
  ),
);

export const SEED_PAGES: SeedPage[] = [HOME, TOOLS, PRICING, ABOUT, CONTACT, TERMS, PRIVACY];

/** The global header and footer, as a starting point. Same rule: links come
 *  from the page list, so this only carries what is not a page. */
export const SEED_GLOBALS = {
  header: {
    visible: true,
    content: {
      ctaLabel: L("Zacznij za darmo", "Start for free", "Kostenlos starten"),
      ctaUrl: "/register",
      items: [],
    },
  },
  footer: {
    visible: true,
    content: {
      description: L(
        "GrovBase zamienia zwykłe zdjęcia produktów w materiały, które sprzedają — bez studia i bez czekania.",
        "GrovBase turns ordinary product photos into material that sells — with no studio and no waiting.",
        "GrovBase macht aus gewöhnlichen Produktfotos Material, das verkauft — ohne Studio und ohne Wartezeit.",
      ),
      items: [],
    },
  },
} as const;
