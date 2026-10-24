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

/**
 * THE PICTURES ARE THE PRODUCT'S OWN, from the media library — the /home
 * before/after pair of the thumbnail tool and the tool cards Admin → Media
 * already shows on /tools — never a stock image. They live in the production
 * project's public `media` bucket, which is where the picker would put them;
 * any of them is one click away from being replaced in Strony WWW.
 *
 * The product areas below are the ones the brief names, each an admin-edited
 * card. What is not released carries "Wkrótce" — and nothing on this page
 * links into the signed-in app, where a visitor would only meet a login.
 */
const MEDIA = "https://orjkxijqpecnbzhxhfct.supabase.co/storage/v1/object/public/media/";
/** The 1200×630 share card cut from the premiere artwork (public/launch). */
const OG_IMAGE = "https://grovbase.com/launch/og.jpg";

/**
 * O NAS AS PUBLIC PAGES V1 RELEASED IT — kept verbatim, because migration
 * 0148 is GENERATED from it (scripts/cms-seed-sql.ts --release) and a
 * committed migration must regenerate byte for byte. The page itself is
 * O NAS V2 below; 0151 replaces this one with it.
 */
export const ABOUT_V1: SeedPage = {
  slug: "o-nas",
  title: "O nas",
  navGroup: "company",
  navOrder: 10,
  seo: {
    pl: {
      title: "O nas",
      description: "GrovBase to platforma narzędzi AI dla sprzedawców e-commerce: retusz, miniaturki produktowe, GrovShot i edycja zdjęć w jednym miejscu.",
    },
    en: {
      title: "About us",
      description: "GrovBase is a platform of AI tools for e-commerce sellers: retouching, product thumbnails, GrovShot and photo editing in one place.",
    },
    de: {
      title: "Über uns",
      description: "GrovBase ist eine Plattform mit KI-Werkzeugen für E-Commerce-Händler: Retusche, Produkt-Thumbnails, GrovShot und Bildbearbeitung an einem Ort.",
    },
    ogImage: OG_IMAGE,
  },
  sections: [
    {
      type: "page_hero",
      analyticsId: "about.hero",
      style: { base: { paddingTop: "lg", paddingBottom: "lg", width: "wide" } },
      content: {
        badge: L("POZNAJ GROVBASE", "MEET GROVBASE", "GROVBASE KENNENLERNEN"),
        title: L(
          "Tworzymy prostszy sposób na profesjonalne zdjęcia produktów.",
          "We are building a simpler way to professional product photos.",
          "Wir schaffen einen einfacheren Weg zu professionellen Produktfotos.",
        ),
        subtitle: L(
          "GrovBase to platforma narzędzi AI tworzona z myślą o sprzedawcach e-commerce. Pomagamy przygotowywać atrakcyjne materiały produktowe szybciej, prościej i bez konieczności korzystania z wielu różnych aplikacji.",
          "GrovBase is a platform of AI tools built for e-commerce sellers. We help you prepare attractive product material faster, more simply and without juggling lots of different apps.",
          "GrovBase ist eine Plattform mit KI-Werkzeugen, die für E-Commerce-Händler entwickelt wird. Wir helfen dabei, ansprechendes Produktmaterial schneller und einfacher zu erstellen – ohne viele verschiedene Apps.",
        ),
        ctaLabel: L("Zobacz, co tworzymy", "See what we build", "Sieh dir an, was wir bauen"),
        ctaUrl: "#co-tworzymy",
        cta2Label: L("Napisz do nas", "Write to us", "Schreib uns"),
        cta2Url: "/kontakt",
        mediaUrl: `${MEDIA}ice/ecc3dfd8-4a75-49c8-8f95-96c8b2179967/miniaturka.png`,
        media2Url: `${MEDIA}ice/944e755f-208c-4a8b-9552-8f198ae881a1/zestaw.png`,
        alt: L(
          "Zdjęcie produktu przed i po przygotowaniu miniaturki w GrovBase",
          "A product photo before and after a GrovBase thumbnail",
          "Ein Produktfoto vor und nach dem Thumbnail mit GrovBase",
        ),
      },
    },
    {
      type: "benefits",
      anchor: "dlaczego-grovbase",
      style: { base: { columns: 3, paddingTop: "md", width: "wide" } },
      content: {
        title: L("Dlaczego GrovBase?", "Why GrovBase?", "Warum GrovBase?"),
        description: L(
          "Trzy zasady, według których projektujemy każde narzędzie.",
          "Three principles behind every tool we design.",
          "Drei Grundsätze, nach denen wir jedes Werkzeug gestalten.",
        ),
        items: [
          {
            icon: "sparkles",
            title: L("Prostota", "Simplicity", "Einfachheit"),
            description: L(
              "Profesjonalne efekty bez skomplikowanej obsługi. Wgrywasz zdjęcie, wybierasz narzędzie i pobierasz gotowy materiał.",
              "Professional results without complicated controls. Upload a photo, choose a tool and download the finished material.",
              "Professionelle Ergebnisse ohne komplizierte Bedienung. Foto hochladen, Werkzeug wählen, fertiges Material herunterladen.",
            ),
          },
          {
            icon: "bag",
            title: L("E-commerce", "E-commerce", "E-Commerce"),
            description: L(
              "Narzędzia projektowane pod potrzeby sprzedawców: miniaturki ofert, białe tło, packshoty i zdjęcia gotowe do marketplace'ów.",
              "Tools designed around what sellers need: listing thumbnails, white backgrounds, packshots and marketplace-ready photos.",
              "Werkzeuge, die auf die Bedürfnisse von Händlern zugeschnitten sind: Angebots-Thumbnails, weißer Hintergrund, Packshots und Marktplatz-taugliche Fotos.",
            ),
          },
          {
            icon: "layers",
            title: L("Jedna platforma", "One platform", "Eine Plattform"),
            description: L(
              "Różne możliwości tworzenia i poprawiania materiałów w jednym miejscu — bez przełączania się między aplikacjami.",
              "Many ways to create and improve your material in one place — without switching between apps.",
              "Viele Möglichkeiten, Material zu erstellen und zu verbessern – an einem Ort, ohne zwischen Apps zu wechseln.",
            ),
          },
        ],
      },
    },
    {
      type: "cards",
      anchor: "co-tworzymy",
      style: { base: { columns: 3, width: "wide", background: "sunken" } },
      content: {
        title: L("Co tworzymy?", "What we build", "Was wir bauen"),
        description: L(
          "Narzędzia, które działają już w GrovBase — i jedno, nad którym pracujemy.",
          "The tools already working in GrovBase — and one we are still working on.",
          "Die Werkzeuge, die in GrovBase schon funktionieren – und eines, an dem wir noch arbeiten.",
        ),
        items: [
          {
            title: L("Retusz AI", "AI retouching", "KI-Retusche"),
            description: L(
              "Zwykłe zdjęcie produktu w jakości premium packshotu — z zachowaniem kształtu, kolorów i detali.",
              "An ordinary product photo at premium packshot quality — with its shape, colours and details kept.",
              "Ein gewöhnliches Produktfoto in Premium-Packshot-Qualität – Form, Farben und Details bleiben erhalten.",
            ),
            mediaUrl: `${MEDIA}1790372790079-hf_20260924_232245_bcc9c632-3199-4bf5-9b9a-1bdac998f70e.png`,
            alt: L("Retusz AI w GrovBase", "AI retouching in GrovBase", "KI-Retusche in GrovBase"),
          },
          {
            title: L("Miniaturki produktowe", "Product thumbnails", "Produkt-Thumbnails"),
            description: L(
              "Kadr pod pierwsze zdjęcie oferty — czytelny na liście wyników marketplace'u.",
              "The crop for a listing's first photo — readable in a marketplace's search results.",
              "Der Bildausschnitt für das erste Angebotsfoto – gut lesbar in den Suchergebnissen eines Marktplatzes.",
            ),
            mediaUrl: `${MEDIA}1790377334354-hf_20260925_230008_51f45311-b635-4b84-b3d6-4cdf69ee866a.png`,
            alt: L("Miniaturka produktowa w GrovBase", "A product thumbnail in GrovBase", "Ein Produkt-Thumbnail in GrovBase"),
          },
          {
            title: L("GrovShot", "GrovShot", "GrovShot"),
            description: L(
              "Sesja produktowa z jednego zdjęcia: studio, światło i sceny pod kampanię.",
              "A product shoot from a single photo: studio, light and campaign scenes.",
              "Ein Produkt-Shooting aus einem einzigen Foto: Studio, Licht und Szenen für die Kampagne.",
            ),
            mediaUrl: `${MEDIA}1790378392231-hf_20260925_231414_bd183a8c-d321-42b8-8392-c3c8754cdbe9.png`,
            alt: L("Sesja GrovShot", "A GrovShot shoot", "Ein GrovShot-Shooting"),
          },
          {
            title: L("Edycja zdjęć", "Photo editing", "Bildbearbeitung"),
            description: L(
              "Edytor, zmiana rozmiaru i kompresja — poprawki bez wychodzenia z GrovBase.",
              "Editor, resizing and compression — touch-ups without leaving GrovBase.",
              "Editor, Größenänderung und Komprimierung – Korrekturen, ohne GrovBase zu verlassen.",
            ),
            mediaUrl: `${MEDIA}1790290699357-hf_20260924_225653_d6ff4fdc-78c4-4e02-9b06-16cc7fcd371f.png`,
            alt: L("Edycja zdjęć w GrovBase", "Photo editing in GrovBase", "Bildbearbeitung in GrovBase"),
          },
          {
            title: L("Narzędzia e-commerce", "E-commerce tools", "E-Commerce-Werkzeuge"),
            description: L(
              "Białe tło, usuwanie tła, tło i cień AI — zdjęcia zgodne z wymaganiami sklepów i marketplace'ów.",
              "White background, background removal, AI background and shadow — photos that meet shop and marketplace requirements.",
              "Weißer Hintergrund, Hintergrund entfernen, KI-Hintergrund und -Schatten – Fotos nach den Vorgaben von Shops und Marktplätzen.",
            ),
            mediaUrl: `${MEDIA}1790374677683-hf_20260925_221637_cdc9afe9-30fa-4167-b792-95ea51ffe66e.png`,
            alt: L("Narzędzia e-commerce w GrovBase", "E-commerce tools in GrovBase", "E-Commerce-Werkzeuge in GrovBase"),
          },
          {
            title: L("Sesje modowe", "Fashion shoots", "Mode-Shootings"),
            badge: L("Wkrótce", "Soon", "Bald"),
            description: L(
              "Niewidzialny manekin, flat lay i inne narzędzia dla odzieży. Pracujemy nad nimi — jeszcze nie są dostępne.",
              "Ghost mannequin, flat lay and more tools for clothing. We are working on them — they are not available yet.",
              "Unsichtbare Schaufensterpuppe, Flat Lay und weitere Werkzeuge für Bekleidung. Wir arbeiten daran – noch nicht verfügbar.",
            ),
            mediaUrl: `${MEDIA}1790288192575-hf_20260924_221537_be0ec52c-1e79-4497-b5aa-5af204fd9f13.png`,
            alt: L("Sesje modowe — wkrótce", "Fashion shoots — soon", "Mode-Shootings – bald"),
          },
        ],
      },
    },
    {
      // NO PHOTO YET, ON PURPOSE: the picture of the people behind GrovBase is
      // theirs to add (Strony WWW → this section → Obraz). Until then the
      // section renders as text — no stock face, no invented founder.
      type: "text_image",
      anchor: "nasze-podejscie",
      style: { base: { paddingTop: "xl", paddingBottom: "lg", width: "wide" } },
      content: {
        title: L("Nasze podejście", "Our approach", "Unser Ansatz"),
        description: L(
          "GrovBase powstaje po to, aby upraszczać pracę sprzedawców. Zamiast kolejnej skomplikowanej aplikacji — narzędzia, które robią jedną rzecz dobrze: przygotowują zdjęcia produktów do sprzedaży.\n\nNajważniejsza jest dla nas wierność produktu. Kształt, kolory, proporcje i detale muszą zostać zachowane, bo ładne zdjęcie produktu, który w rzeczywistości wygląda inaczej, nie pomaga sprzedawać.\n\nFunkcje, które jeszcze nie działają, oznaczamy jako niedostępne. Nie obiecujemy niczego, czego nie da się dziś użyć.",
          "GrovBase exists to make sellers' work simpler. Instead of another complicated app — tools that do one thing well: get product photos ready to sell.\n\nWhat matters most to us is product fidelity. Shape, colours, proportions and details have to be kept, because a beautiful photo of a product that looks different in reality does not help anyone sell.\n\nFeatures that do not work yet are marked as unavailable. We do not promise anything you cannot use today.",
          "GrovBase entsteht, um Händlern die Arbeit zu erleichtern. Statt einer weiteren komplizierten App – Werkzeuge, die eine Sache gut machen: Produktfotos verkaufsfertig vorbereiten.\n\nAm wichtigsten ist uns die Produkttreue. Form, Farben, Proportionen und Details müssen erhalten bleiben, denn ein schönes Foto eines Produkts, das in Wirklichkeit anders aussieht, hilft niemandem beim Verkaufen.\n\nFunktionen, die noch nicht funktionieren, kennzeichnen wir als nicht verfügbar. Wir versprechen nichts, was sich heute nicht nutzen lässt.",
        ),
        alignment: "right",
      },
    },
    {
      type: "cta",
      analyticsId: "about.final_cta",
      style: { base: { align: "center", background: "gradient", paddingTop: "xl", paddingBottom: "xl" } },
      content: {
        title: L(
          "Zobacz, co możesz stworzyć z GrovBase.",
          "See what you can create with GrovBase.",
          "Sieh dir an, was du mit GrovBase erstellen kannst.",
        ),
        description: L(
          "Przykłady efektów znajdziesz na stronie premiery, a plany i pakiety — w cenniku.",
          "You will find example results on the premiere page, and the plans and packs in the pricing.",
          "Beispiele findest du auf der Premierenseite, Pläne und Pakete in der Preisübersicht.",
        ),
        ctaLabel: L("Sprawdź możliwości", "Explore what it can do", "Möglichkeiten entdecken"),
        ctaUrl: "/",
        cta2Label: L("Zobacz cennik", "See pricing", "Preise ansehen"),
        cta2Url: "/plany",
      },
    },
  ],
};

/**
 * O NAS V2 — the about page as a product page: where GrovBase comes from, how
 * an effect is made, what it believes, who it is for and who builds it.
 *
 * The nine sections are the about_* types (components/cms/about-sections.tsx);
 * every picture is a media slot (lib/about-page.ts) chosen and framed in
 * "Edytuj stronę", so no file is named here. Two things are deliberately
 * SWITCHED OFF and carry a bracketed placeholder instead of an invented
 * answer — the sixth value ("Twoje zdjęcia są Twoje") and the questions about
 * photos and company details. A placeholder can never be published: the
 * renderer drops any tile or question still holding "[…]", switched on or not.
 *
 * The hero keeps the analytics id `about.hero`: it is also 0148's "already on
 * the new layout" marker, so a later run of 0148 can never put V1 back.
 */
const ABOUT: SeedPage = {
  slug: "o-nas",
  title: "O nas",
  navGroup: "company",
  navOrder: 10,
  seo: {
    pl: {
      title: "O nas — GrovBase",
      description: "GrovBase robi z prostego zdjęcia z telefonu gotowe materiały do sprzedaży na Allegro, Amazon i we własnym sklepie. Poznaj ludzi i zasady, które za tym stoją.",
    },
    en: {
      title: "About us — GrovBase",
      description: "GrovBase turns a simple phone photo into ready-to-sell material for Allegro, Amazon and your own shop. Meet the people and the principles behind it.",
    },
    de: {
      title: "Über uns — GrovBase",
      description: "GrovBase macht aus einem einfachen Handyfoto fertiges Verkaufsmaterial für Allegro, Amazon und den eigenen Shop. Lerne die Menschen und Grundsätze dahinter kennen.",
    },
  },
  sections: [
    {
      type: "about_hero",
      analyticsId: "about.hero",
      style: { base: { paddingTop: "lg", paddingBottom: "md", width: "wide" } },
      content: {
        badge: L("O NAS", "ABOUT US", "ÜBER UNS"),
        title: L(
          "Dobre zdjęcie produktu nie powinno kosztować więcej niż marża na produkcie",
          "A good product photo shouldn’t cost more than the margin on the product",
          "Ein gutes Produktfoto sollte nicht mehr kosten als die Marge auf das Produkt",
        ),
        subtitle: L(
          "GrovBase robi z prostego zdjęcia z telefonu gotowe materiały do sprzedaży. Bez studia, bez promptów i bez czekania na grafika.",
          "GrovBase turns a simple phone photo into ready-to-sell material. No studio, no prompts and no waiting for a designer.",
          "GrovBase macht aus einem einfachen Handyfoto fertiges Verkaufsmaterial. Ohne Studio, ohne Prompts und ohne Warten auf einen Grafiker.",
        ),
      },
    },
    {
      type: "about_story",
      analyticsId: "about.story",
      anchor: "historia",
      style: { base: { paddingTop: "lg", paddingBottom: "lg" } },
      content: {
        title: L("Skąd się wzięliśmy", "Where we come from", "Woher wir kommen"),
        description: L(
          "Od ponad pięciu lat robimy grafiki dla sprzedawców z Allegro i innych marketplace’ów. Popyt na dobre miniaturki i zdjęcia produktów był tak duży, że nie dało się przyjąć wszystkich zleceń, a sprzedawcy czekali dniami na coś, co powinno zająć minuty.\n\nNarzędzia AI, które testowaliśmy, dawały efekt „typowego AI”, wymagały pisania promptów albo robiły tylko jedną rzecz. Postanowiliśmy więc zamknąć nasz warsztat w aplikacji, z której każdy sprzedawca może skorzystać sam.",
          "For more than five years we have been creating graphics for sellers on Allegro and other marketplaces. Demand for good thumbnails and product photos was so high that we couldn’t take on every order, and sellers waited days for something that should take minutes.\n\nThe AI tools we tested produced that “typical AI” look, required writing prompts or did only one thing. So we decided to put our workshop into an app that any seller can use on their own.",
          "Seit mehr als fünf Jahren gestalten wir Grafiken für Händler auf Allegro und anderen Marktplätzen. Die Nachfrage nach guten Thumbnails und Produktfotos war so groß, dass wir nicht alle Aufträge annehmen konnten – und Händler tagelang auf etwas warteten, das Minuten dauern sollte.\n\nDie KI-Werkzeuge, die wir getestet haben, lieferten den typischen „KI-Look“, verlangten das Schreiben von Prompts oder konnten nur eine Sache. Also haben wir unsere Werkstatt in eine App gepackt, die jeder Händler selbst nutzen kann.",
        ),
        // No address: the button follows the platform's state — the sign-up
        // dialog when sign-up is open, the waitlist before the launch.
        ctaLabel: L("Wypróbuj za darmo", "Try it for free", "Kostenlos ausprobieren"),
      },
    },
    {
      type: "about_process",
      analyticsId: "about.process",
      anchor: "jak-to-dziala",
      style: { base: { paddingTop: "lg", paddingBottom: "lg", background: "sunken" } },
      content: {
        badge: L("JAK TO DZIAŁA", "HOW IT WORKS", "SO FUNKTIONIERT ES"),
        title: L("Projektuje grafik, wykonuje AI", "A designer designs, AI delivers", "Ein Grafiker gestaltet, die KI setzt um"),
        items: [
          {
            icon: "pen",
            title: L("Grafik projektuje efekt", "A designer designs the effect", "Ein Grafiker gestaltet den Effekt"),
            description: L(
              "Każde narzędzie ustawia grafik e-commerce: kompozycję, światło, cienie i wymagania marketplace’ów. To te same zasady, według których robimy grafiki ręcznie.",
              "Every tool is set up by an e-commerce designer: composition, light, shadows and marketplace requirements. The same rules we follow when we make graphics by hand.",
              "Jedes Werkzeug richtet ein E-Commerce-Grafiker ein: Komposition, Licht, Schatten und die Anforderungen der Marktplätze. Dieselben Regeln, nach denen wir Grafiken von Hand erstellen.",
            ),
          },
          {
            icon: "wand",
            title: L("AI go wykonuje", "AI carries it out", "Die KI setzt ihn um"),
            description: L(
              "Do każdego zadania dobieramy model, który daje najlepszy efekt, i wymieniamy go, gdy pojawi się lepszy.",
              "For every task we pick the model that gives the best result, and we replace it when a better one comes along.",
              "Für jede Aufgabe wählen wir das Modell, das das beste Ergebnis liefert, und tauschen es aus, sobald es ein besseres gibt.",
            ),
          },
          {
            icon: "download",
            title: L("Ty dostajesz gotowy plik", "You get a finished file", "Du bekommst eine fertige Datei"),
            description: L(
              "Wgrywasz zdjęcie, wybierasz efekt i pobierasz grafikę gotową do wystawienia oferty.",
              "Upload a photo, choose an effect and download a graphic ready for your listing.",
              "Foto hochladen, Effekt wählen und eine Grafik herunterladen, die bereit fürs Angebot ist.",
            ),
          },
        ],
      },
    },
    {
      type: "about_importance",
      analyticsId: "about.importance",
      style: { base: { paddingTop: "lg", paddingBottom: "lg" } },
      content: {
        title: L("Dlaczego zdjęcie ma znaczenie", "Why the photo matters", "Warum das Foto zählt"),
        description: L(
          "Na liście ofert kupujący widzi najpierw miniaturkę, dopiero potem cenę i opis. Zdjęcie decyduje, czy w ogóle kliknie. A dobra sesja to termin, studio, fotograf, retusz i tydzień czekania – na produkt, który może się nie sprzedać. GrovBase skraca to do kilku minut, a koszt do ułamka.",
          "In a list of offers the buyer sees the thumbnail first and only then the price and description. The photo decides whether they click at all. And a good shoot means a booking, a studio, a photographer, retouching and a week of waiting – for a product that might not sell. GrovBase cuts that to a few minutes and the cost to a fraction.",
          "In einer Angebotsliste sieht der Käufer zuerst das Thumbnail, erst danach Preis und Beschreibung. Das Foto entscheidet, ob er überhaupt klickt. Und ein gutes Shooting heißt Termin, Studio, Fotograf, Retusche und eine Woche Warten – für ein Produkt, das sich vielleicht nicht verkauft. GrovBase verkürzt das auf wenige Minuten und die Kosten auf einen Bruchteil.",
        ),
        // The public page that shows what the tools make.
        ctaLabel: L("Zobacz przykłady", "See examples", "Beispiele ansehen"),
        ctaUrl: "/narzedzia",
      },
    },
    {
      type: "about_values",
      analyticsId: "about.values",
      anchor: "zasady",
      style: { base: { paddingTop: "lg", paddingBottom: "lg", background: "sunken" } },
      content: {
        badge: L("NASZE ZASADY", "OUR PRINCIPLES", "UNSERE GRUNDSÄTZE"),
        title: L("W co wierzymy", "What we believe", "Woran wir glauben"),
        items: [
          {
            icon: "target",
            title: L("Wierność przed kreatywnością", "Fidelity before creativity", "Treue vor Kreativität"),
            description: L(
              "Ładne zdjęcie, na którym produkt wygląda inaczej niż w rzeczywistości, to zwrot i zła opinia. Kształt, kolor i detal są ważniejsze niż efekt.",
              "A pretty photo in which the product looks different than in reality means a return and a bad review. Shape, colour and detail matter more than the effect.",
              "Ein schönes Foto, auf dem das Produkt anders aussieht als in Wirklichkeit, bedeutet eine Rücksendung und eine schlechte Bewertung. Form, Farbe und Details sind wichtiger als der Effekt.",
            ),
          },
          {
            icon: "zap",
            title: L("Bez promptów", "No prompts", "Ohne Prompts"),
            description: L(
              "Sprzedawca ma sprzedawać, nie uczyć się pisania poleceń dla AI. Wgrywasz zdjęcie, wybierasz efekt, gotowe.",
              "A seller should be selling, not learning to write instructions for AI. Upload a photo, choose an effect, done.",
              "Ein Händler soll verkaufen, nicht lernen, Anweisungen für KI zu schreiben. Foto hochladen, Effekt wählen, fertig.",
            ),
          },
          {
            icon: "pen",
            title: L("Zaprojektowane w praktyce", "Designed in practice", "In der Praxis entworfen"),
            description: L(
              "Efekty powstają na bazie tysięcy grafik wykonanych dla prawdziwych sprzedawców, a nie z myślą o ładnym demo.",
              "Our effects are built on thousands of graphics made for real sellers, not with a pretty demo in mind.",
              "Unsere Effekte basieren auf Tausenden Grafiken für echte Händler, nicht auf einer hübschen Demo.",
            ),
          },
          {
            icon: "layers",
            title: L("Najlepszy model do zadania", "The best model for the job", "Das beste Modell für die Aufgabe"),
            description: L(
              "Modele AI zmieniają się co kilka miesięcy. Nie jesteśmy przywiązani do jednego dostawcy.",
              "AI models change every few months. We are not tied to a single provider.",
              "KI-Modelle ändern sich alle paar Monate. Wir sind an keinen einzelnen Anbieter gebunden.",
            ),
          },
          {
            icon: "eye",
            title: L("Bez udawania", "No pretending", "Kein Vortäuschen"),
            description: L(
              "Funkcja, która jeszcze nie działa, jest oznaczona jako „wkrótce”. Nie pokazujemy przycisków, które nic nie robią.",
              "A feature that doesn’t work yet is marked “coming soon”. We don’t show buttons that do nothing.",
              "Eine Funktion, die noch nicht funktioniert, ist als „bald verfügbar“ gekennzeichnet. Wir zeigen keine Schaltflächen, die nichts tun.",
            ),
          },
          {
            // Switched off until its wording is approved — and never shown
            // while it still holds the placeholder, switched on or not.
            hidden: true,
            icon: "lock",
            title: L("Twoje zdjęcia są Twoje", "Your photos are yours", "Deine Fotos gehören dir"),
            description: L("[treść do potwierdzenia]", "[content to be confirmed]", "[Inhalt zu bestätigen]"),
          },
        ],
      },
    },
    {
      type: "about_audience",
      analyticsId: "about.audience",
      anchor: "dla-kogo",
      style: { base: { paddingTop: "lg", paddingBottom: "lg" } },
      content: {
        badge: L("DLA KOGO", "WHO IT’S FOR", "FÜR WEN"),
        title: L("Dla każdego, kto sprzedaje online", "For everyone who sells online", "Für alle, die online verkaufen"),
        items: [
          {
            slot: "about.audience.small",
            icon: "bag",
            title: L("Mali sprzedawcy", "Small sellers", "Kleine Händler"),
            description: L(
              "Prowadzisz sklep sam i nie masz budżetu na sesję dla każdego produktu.",
              "You run your shop on your own and don’t have the budget for a shoot for every product.",
              "Du führst deinen Shop allein und hast kein Budget für ein Shooting für jedes Produkt.",
            ),
            points: [
              { icon: "clock", title: L("Miniaturka w kilka minut zamiast kilku dni", "A thumbnail in minutes instead of days", "Ein Thumbnail in Minuten statt Tagen") },
              { icon: "coins", title: L("Koszt kilku złotych zamiast kilkudziesięciu", "A few złoty instead of dozens", "Ein paar Złoty statt Dutzender") },
              { icon: "wand", title: L("Bez umiejętności graficznych", "No design skills needed", "Keine Grafikkenntnisse nötig") },
              { icon: "gift", title: L("Darmowe kredyty na start", "Free credits to start", "Kostenlose Credits zum Start") },
            ],
          },
          {
            slot: "about.audience.large",
            icon: "company",
            title: L("Duzi sprzedawcy i marki", "Large sellers and brands", "Große Händler und Marken"),
            description: L(
              "Sprzedajesz w wielu kanałach i regularnie wprowadzasz nowe produkty.",
              "You sell across many channels and launch new products regularly.",
              "Du verkaufst über viele Kanäle und bringst regelmäßig neue Produkte heraus.",
            ),
            points: [
              { icon: "layers", title: L("Spójne zdjęcia dla całego asortymentu", "Consistent photos across your whole range", "Einheitliche Fotos für das ganze Sortiment") },
              { icon: "crop", title: L("Formaty pod Allegro, Amazon i własny sklep", "Formats for Allegro, Amazon and your own shop", "Formate für Allegro, Amazon und den eigenen Shop") },
              { icon: "images", title: L("Wiele zdjęć w jednej generacji", "Many photos in one generation", "Viele Fotos in einer Generierung") },
              { icon: "users", title: L("Plan dla zespołu", "A plan for your team", "Ein Plan für dein Team") },
            ],
          },
        ],
      },
    },
    {
      type: "about_team",
      analyticsId: "about.team",
      anchor: "zespol",
      style: { base: { paddingTop: "lg", paddingBottom: "lg", background: "sunken" } },
      content: {
        badge: L("ZESPÓŁ", "TEAM", "TEAM"),
        title: L("Kto za tym stoi", "Who’s behind it", "Wer dahintersteht"),
        items: [
          {
            slot: "about.team.jakub",
            value: "J",
            title: L("Jakub", "Jakub", "Jakub"),
            badge: L("Grafik e-commerce, współzałożyciel", "E-commerce designer, co-founder", "E-Commerce-Grafiker, Mitgründer"),
            description: L(
              "Od ponad pięciu lat projektuje miniaturki i zdjęcia produktów dla sprzedawców z marketplace’ów. W GrovBase odpowiada za to, jak wyglądają efekty każdego narzędzia.",
              "For more than five years he has been designing thumbnails and product photos for marketplace sellers. At GrovBase he is responsible for how every tool’s effects look.",
              "Seit mehr als fünf Jahren gestaltet er Thumbnails und Produktfotos für Marktplatz-Händler. Bei GrovBase verantwortet er, wie die Effekte jedes Werkzeugs aussehen.",
            ),
          },
          {
            slot: "about.team.marcel",
            value: "M",
            title: L("Marcel", "Marcel", "Marcel"),
            badge: L("Technologia, współzałożyciel", "Technology, co-founder", "Technologie, Mitgründer"),
            description: L(
              "Od ponad sześciu lat projektuje i buduje sklepy internetowe i strony. W GrovBase odpowiada za aplikację i to, żeby wszystko działało szybko i bez błędów.",
              "For more than six years he has been designing and building online shops and websites. At GrovBase he is responsible for the app and for everything working fast and without errors.",
              "Seit mehr als sechs Jahren konzipiert und baut er Onlineshops und Websites. Bei GrovBase verantwortet er die App und dass alles schnell und fehlerfrei läuft.",
            ),
          },
        ],
      },
    },
    {
      type: "about_faq",
      analyticsId: "about.faq",
      anchor: "faq",
      style: { base: { paddingTop: "lg", paddingBottom: "md" } },
      content: {
        title: L("Masz pytania?", "Any questions?", "Noch Fragen?"),
        items: [
          {
            title: L("Czym jest GrovBase?", "What is GrovBase?", "Was ist GrovBase?"),
            description: L(
              "GrovBase to aplikacja dla sprzedawców e-commerce, która z prostego zdjęcia produktu robi gotowe materiały do sprzedaży: miniaturki, retusz, packshoty i zdjęcia lifestyle. Wgrywasz zdjęcie, wybierasz efekt i pobierasz plik gotowy do oferty.",
              "GrovBase is an app for e-commerce sellers that turns a simple product photo into ready-to-sell material: thumbnails, retouching, packshots and lifestyle photos. Upload a photo, choose an effect and download a file ready for your listing.",
              "GrovBase ist eine App für E-Commerce-Händler, die aus einem einfachen Produktfoto fertiges Verkaufsmaterial macht: Thumbnails, Retusche, Packshots und Lifestyle-Fotos. Foto hochladen, Effekt wählen und eine angebotsfertige Datei herunterladen.",
            ),
          },
          {
            title: L("Kto stoi za GrovBase?", "Who is behind GrovBase?", "Wer steht hinter GrovBase?"),
            description: L(
              "GrovBase tworzą dwie osoby. Jakub jest grafikiem e-commerce i odpowiada za to, jak wyglądają efekty narzędzi. Marcel projektuje i buduje sklepy oraz aplikacje i odpowiada za technologię.",
              "GrovBase is made by two people. Jakub is an e-commerce designer and is responsible for how the tools’ effects look. Marcel designs and builds shops and apps and is responsible for the technology.",
              "GrovBase wird von zwei Personen entwickelt. Jakub ist E-Commerce-Grafiker und verantwortet, wie die Effekte der Werkzeuge aussehen. Marcel konzipiert und baut Shops und Apps und verantwortet die Technik.",
            ),
          },
          {
            title: L("Na jakich modelach AI pracujecie?", "Which AI models do you use?", "Mit welchen KI-Modellen arbeitet ihr?"),
            description: L(
              "Korzystamy z modeli kilku dostawców i do każdego narzędzia dobieramy ten, który daje w nim najlepszy efekt. Gdy pojawi się lepszy model, możemy go wymienić — sposób korzystania z aplikacji się nie zmienia.",
              "We use models from several providers and, for each tool, pick the one that gives the best result there. When a better model appears we can switch to it — the way you use the app stays the same.",
              "Wir nutzen Modelle mehrerer Anbieter und wählen für jedes Werkzeug dasjenige, das dort das beste Ergebnis liefert. Gibt es ein besseres Modell, können wir wechseln – die Bedienung der App bleibt gleich.",
            ),
          },
          {
            title: L("Czym różnicie się od innych narzędzi AI do zdjęć?", "How are you different from other AI photo tools?", "Was unterscheidet euch von anderen KI-Foto-Tools?"),
            description: L(
              "Efekty w GrovBase ustawia grafik e-commerce, więc nie musisz pisać promptów ani znać się na AI. Najważniejsza jest wierność produktu: kształt, kolory i detale mają pozostać takie, jak na Twoim zdjęciu.",
              "The effects in GrovBase are set up by an e-commerce designer, so you don’t need to write prompts or know anything about AI. Product fidelity comes first: shape, colours and details should stay as they are in your photo.",
              "Die Effekte in GrovBase richtet ein E-Commerce-Grafiker ein – du musst also keine Prompts schreiben und nichts über KI wissen. An erster Stelle steht die Produkttreue: Form, Farben und Details sollen so bleiben wie auf deinem Foto.",
            ),
          },
          {
            hidden: true,
            title: L("Co dzieje się z moimi zdjęciami?", "What happens to my photos?", "Was passiert mit meinen Fotos?"),
            description: L("[treść do potwierdzenia]", "[content to be confirmed]", "[Inhalt zu bestätigen]"),
          },
          {
            hidden: true,
            title: L("Dane firmy", "Company details", "Firmendaten"),
            description: L("[nazwa firmy], [miasto], NIP [numer]", "[company name], [city], VAT ID [number]", "[Firmenname], [Stadt], USt-IdNr. [Nummer]"),
          },
        ],
      },
    },
    {
      type: "about_cta",
      analyticsId: "about.cta",
      style: { base: { paddingTop: "md", paddingBottom: "xl", width: "wide" } },
      content: {
        title: L("Sprzedawaj od pierwszego spojrzenia", "Sell from the first glance", "Verkaufe ab dem ersten Blick"),
        subtitle: L("Gotowe zdjęcia produktów w kilka minut.", "Finished product photos in minutes.", "Fertige Produktfotos in wenigen Minuten."),
        // No address: the platform's own start (sign-up or the waitlist).
        ctaLabel: L("Zacznij za darmo", "Start for free", "Kostenlos starten"),
        cta2Label: L("Napisz do nas", "Write to us", "Schreib uns"),
        cta2Url: "/kontakt",
      },
    },
  ],
};

/* ── 5. KONTAKT ──────────────────────────────────────────────────────────── */

/**
 * ONE ADDRESS, THREE PURPOSES. contact@grovbase.com is the mailbox GrovBase
 * actually runs (Komunikacja → Kanały, and the address the Regulamin gives for
 * every kind of matter), so each tile names it; the tiles say what to write
 * about, not where a different team sits. No phone line, office or hours are
 * invented here — a tile for one is added in Strony WWW once it exists.
 *
 * The form posts to /api/public/contact: the message is stored in
 * contact_messages and the admin is told through the notification pipeline.
 */
const CONTACT_MAIL = "mailto:contact@grovbase.com";

/** Kontakt as Public pages V1 released it (0148): page_hero + contact_hub +
 *  faq. Replaced by Kontakt V2 (CONTACT below, 0154); kept because 0148's
 *  generator (scripts/cms-seed-sql.ts --release) must keep printing the
 *  migration that is already applied. */
export const CONTACT_V1: SeedPage = {
  slug: "kontakt",
  title: "Kontakt",
  navGroup: "company",
  navOrder: 20,
  seo: {
    pl: {
      title: "Kontakt",
      description: "Masz pytanie dotyczące GrovBase, potrzebujesz pomocy lub chcesz nawiązać współpracę? Napisz do nas przez formularz albo na contact@grovbase.com.",
    },
    en: {
      title: "Contact",
      description: "A question about GrovBase, need help or want to work together? Write to us through the form or at contact@grovbase.com.",
    },
    de: {
      title: "Kontakt",
      description: "Eine Frage zu GrovBase, Hilfe nötig oder Interesse an einer Zusammenarbeit? Schreib uns über das Formular oder an contact@grovbase.com.",
    },
    ogImage: OG_IMAGE,
  },
  sections: [
    {
      type: "page_hero",
      analyticsId: "contact.hero",
      style: { base: { paddingTop: "lg", paddingBottom: "sm", width: "wide" } },
      content: {
        badge: L("KONTAKT", "CONTACT", "KONTAKT"),
        title: L("Porozmawiajmy.", "Let's talk.", "Lass uns reden."),
        subtitle: L(
          "Masz pytanie dotyczące GrovBase, potrzebujesz pomocy lub chcesz nawiązać współpracę? Napisz do nas.",
          "Have a question about GrovBase, need help or want to work together? Write to us.",
          "Du hast eine Frage zu GrovBase, brauchst Hilfe oder möchtest mit uns zusammenarbeiten? Schreib uns.",
        ),
      },
    },
    {
      type: "contact_hub",
      anchor: "formularz",
      analyticsId: "contact.form.submit",
      style: { base: { width: "wide", paddingTop: "sm" } },
      content: {
        title: L("Napisz wiadomość", "Send us a message", "Schreib uns eine Nachricht"),
        description: L(
          "Wiadomość trafi bezpośrednio do zespołu GrovBase. Odpowiemy na adres e-mail podany w formularzu.",
          "Your message goes straight to the GrovBase team. We will reply to the e-mail address you enter.",
          "Deine Nachricht geht direkt an das GrovBase-Team. Wir antworten an die E-Mail-Adresse aus dem Formular.",
        ),
        formHandler: "contact",
        ctaLabel: L("Wyślij wiadomość", "Send message", "Nachricht senden"),
        subtitle: L(
          "Wysyłając wiadomość, zgadzasz się na przetwarzanie podanych danych w celu udzielenia odpowiedzi.",
          "By sending this message you agree to your data being processed so that we can reply.",
          "Mit dem Senden stimmst du der Verarbeitung deiner Daten zur Beantwortung zu.",
        ),
        items: [
          { value: "question", title: L("Pytanie", "Question", "Frage") },
          { value: "support", title: L("Pomoc techniczna", "Technical support", "Technischer Support") },
          { value: "partnership", title: L("Współpraca", "Partnership", "Zusammenarbeit") },
          { value: "other", title: L("Inne", "Other", "Sonstiges") },
        ],
        badge: L("Szybki kontakt", "Quick contact", "Schneller Kontakt"),
        tiles: [
          {
            icon: "mail",
            title: L("Kontakt e-mail", "E-mail", "E-Mail"),
            description: L(
              "Pytania o GrovBase, konto, płatności i sprawy ogólne.",
              "Questions about GrovBase, your account, payments and general matters.",
              "Fragen zu GrovBase, deinem Konto, Zahlungen und allgemeine Anliegen.",
            ),
            url: CONTACT_MAIL,
          },
          {
            icon: "support",
            title: L("Pomoc techniczna", "Technical support", "Technischer Support"),
            description: L(
              "Coś nie działa? Opisz, czego używasz i co się dzieje. Jeśli masz konto, możesz też napisać z zakładki Pomoc w panelu.",
              "Something not working? Tell us what you were using and what happened. If you have an account, you can also write from Help in the app.",
              "Etwas funktioniert nicht? Beschreib, was du genutzt hast und was passiert ist. Mit Konto kannst du auch über „Hilfe“ in der App schreiben.",
            ),
            url: CONTACT_MAIL,
          },
          {
            icon: "handshake",
            title: L("Współpraca biznesowa", "Business partnerships", "Geschäftliche Zusammenarbeit"),
            description: L(
              "Partnerstwa, integracje, media i propozycje współpracy.",
              "Partnerships, integrations, press and collaboration proposals.",
              "Partnerschaften, Integrationen, Presse und Kooperationsvorschläge.",
            ),
            url: CONTACT_MAIL,
          },
        ],
      },
    },
    {
      type: "faq",
      anchor: "faq",
      style: { base: { width: "narrow", paddingTop: "md" } },
      content: {
        title: L("Najczęstsze pytania", "Frequently asked questions", "Häufige Fragen"),
        items: [
          {
            title: L("Czy muszę mieć konto, żeby napisać?", "Do I need an account to write to you?", "Brauche ich ein Konto, um zu schreiben?"),
            description: L(
              "Nie. Formularz i adres e-mail są dostępne dla każdego. Odpowiedź wyślemy na adres podany w wiadomości.",
              "No. The form and the e-mail address are open to everyone. We will reply to the address in your message.",
              "Nein. Formular und E-Mail-Adresse stehen allen offen. Wir antworten an die Adresse aus deiner Nachricht.",
            ),
          },
          {
            title: L("Jak zgłosić problem techniczny?", "How do I report a technical problem?", "Wie melde ich ein technisches Problem?"),
            description: L(
              "Wybierz temat „Pomoc techniczna” i opisz, czego używasz, co chcesz zrobić i jaki komunikat się pojawia. Jeśli masz konto, podaj adres e-mail, na który jest założone.",
              "Choose the “Technical support” topic and describe what you are using, what you are trying to do and which message appears. If you have an account, give the e-mail address it is registered to.",
              "Wähle das Thema „Technischer Support“ und beschreib, was du nutzt, was du tun möchtest und welche Meldung erscheint. Mit Konto gib bitte die E-Mail-Adresse an, mit der es registriert ist.",
            ),
          },
          {
            title: L("Gdzie znajdę ceny i plany?", "Where can I find prices and plans?", "Wo finde ich Preise und Pläne?"),
            description: L(
              "Aktualne plany i pakiety kredytów są w cenniku — link znajdziesz w stopce każdej strony.",
              "The current plans and credit packs are on the pricing page — the link is in the footer of every page.",
              "Die aktuellen Pläne und Credit-Pakete stehen in der Preisübersicht – der Link ist im Footer jeder Seite.",
            ),
          },
          {
            title: L("Co dzieje się z danymi z formularza?", "What happens to the data from the form?", "Was passiert mit den Daten aus dem Formular?"),
            description: L(
              "Wykorzystujemy je, aby odpowiedzieć na Twoją wiadomość. Formularz nie zapisuje Cię do newslettera. Zasady przetwarzania danych opisuje Polityka prywatności.",
              "We use it to reply to your message. The form does not sign you up to any newsletter. How data is processed is described in the Privacy policy.",
              "Wir nutzen sie, um deine Nachricht zu beantworten. Das Formular meldet dich bei keinem Newsletter an. Wie Daten verarbeitet werden, steht in der Datenschutzerklärung.",
            ),
          },
        ],
      },
    },
  ],
};

/**
 * KONTAKT V2 — one contact_page section (lib/contact-page.ts): the header,
 * the channels, the FAQ links to /plany, the ticket form and the company
 * tile. Every word below is editable in "Edytuj stronę"; the response time is
 * ONE value (fields["reply.time"]) that the subtitle, the success card and the
 * confirmation mail all say through {czas}.
 *
 * NOTHING HERE IS INVENTED. The e-mail channel is the mailbox GrovBase runs
 * (contact@grovbase.com, see CONTACT_V1). Instagram and Facebook take the
 * profiles from Ustawienia → public_site when the card has no link of its
 * own; TikTok and YouTube have none yet — and a channel without a valid link
 * is not on the page at all. The VAT-invoice question has no counterpart on
 * /plany yet, so its tile has no link and stays off the page, marked
 * "wymaga konfiguracji" in the editor. The company tile is off and empty
 * until somebody types the real data.
 */
const CONTACT: SeedPage = {
  slug: "kontakt",
  title: "Kontakt",
  navGroup: "company",
  navOrder: 20,
  seo: {
    pl: {
      title: "Kontakt — napisz do zespołu GrovBase",
      description: "Pytanie o aplikację, płatności i faktury, problem techniczny albo współpraca? Napisz do zespołu GrovBase przez formularz lub na contact@grovbase.com.",
    },
    en: {
      title: "Contact — write to the GrovBase team",
      description: "A question about the app, payments and invoices, a technical problem or a partnership? Write to the GrovBase team through the form or at contact@grovbase.com.",
    },
    de: {
      title: "Kontakt — schreib dem GrovBase-Team",
      description: "Eine Frage zur App, zu Zahlungen und Rechnungen, ein technisches Problem oder eine Zusammenarbeit? Schreib dem GrovBase-Team über das Formular oder an contact@grovbase.com.",
    },
    ogImage: OG_IMAGE,
  },
  sections: [
    {
      type: "contact_page",
      anchor: "formularz",
      analyticsId: "contact.page",
      style: { base: { width: "wide", paddingTop: "lg", paddingBottom: "lg" } },
      content: {
        badge: L("KONTAKT", "CONTACT", "KONTAKT"),
        title: L("Napisz do nas", "Write to us", "Schreib uns"),
        subtitle: L(
          "Odpowiadamy w ciągu {czas}. Wybierz kanał, który jest dla Ciebie najwygodniejszy.",
          "We reply within {czas}. Choose the channel that suits you best.",
          "Wir antworten innerhalb von {czas}. Wähle den Kanal, der für dich am bequemsten ist.",
        ),
        items: [
          {
            value: "email",
            title: L("E-mail", "E-mail", "E-Mail"),
            description: L("Napisz bezpośrednio na nasz adres.", "Write straight to our address.", "Schreib direkt an unsere Adresse."),
            url: CONTACT_MAIL,
          },
          {
            value: "instagram",
            title: L("Instagram", "Instagram", "Instagram"),
            description: L("Napisz w wiadomości prywatnej", "Send us a direct message", "Schreib uns eine Direktnachricht"),
          },
          {
            value: "facebook",
            title: L("Facebook", "Facebook", "Facebook"),
            description: L("Strona GrovBase na Facebooku", "GrovBase on Facebook", "GrovBase auf Facebook"),
          },
          {
            value: "tiktok",
            title: L("TikTok", "TikTok", "TikTok"),
            description: L("Zobacz przykłady na żywo", "See live examples", "Sieh dir Live-Beispiele an"),
          },
          {
            value: "youtube",
            title: L("YouTube", "YouTube", "YouTube"),
            description: L("Zobacz przykłady na żywo", "See live examples", "Sieh dir Live-Beispiele an"),
          },
        ],
        tiles: [
          { title: L("Jak działają kredyty?", "How do credits work?", "Wie funktionieren Credits?"), url: "/plany#faq-credits" },
          { title: L("Jak kupić dodatkowe kredyty?", "How do I buy extra credits?", "Wie kaufe ich zusätzliche Credits?"), url: "/plany#faq-topups" },
          { title: L("Czy subskrypcja odnawia się automatycznie?", "Does the subscription renew automatically?", "Verlängert sich das Abo automatisch?"), url: "/plany#faq-renewal" },
          { title: L("Czy istnieje możliwość zwrotu?", "Is a refund possible?", "Ist eine Erstattung möglich?"), url: "/plany#faq-refunds" },
          // No such question on /plany yet: no link, so no tile on the page.
          { title: L("Jak otrzymać fakturę VAT?", "How do I get a VAT invoice?", "Wie erhalte ich eine Rechnung mit MwSt.?") },
        ],
        company: { hidden: true },
        fields: {
          "reply.time": L("1 dnia roboczego", "1 business day", "1 Werktag"),
          "channels.title": L("Kanały kontaktu", "Contact channels", "Kontaktkanäle"),
          "channel.messenger": L("Napisz na Messengerze", "Message us on Messenger", "Schreib uns im Messenger"),
          "faq.title": L("Zanim napiszesz, sprawdź odpowiedzi", "Before you write, check the answers", "Bevor du schreibst: Hier findest du Antworten"),
          "form.title": L("Formularz kontaktowy", "Contact form", "Kontaktformular"),
          "form.topic": L("Czego dotyczy wiadomość?", "What is your message about?", "Worum geht es?"),
          "topic.app": L("Pytanie o aplikację", "Question about the app", "Frage zur App"),
          "topic.payments": L("Płatności i faktury", "Payments and invoices", "Zahlungen und Rechnungen"),
          "topic.technical": L("Problem techniczny", "Technical problem", "Technisches Problem"),
          "topic.cooperation": L("Współpraca / większe zamówienia", "Partnership / larger orders", "Zusammenarbeit / größere Aufträge"),
          "topic.other": L("Inne", "Other", "Sonstiges"),
          "form.name": L("Imię (opcjonalnie)", "First name (optional)", "Vorname (optional)"),
          "form.email": L("E-mail", "E-mail", "E-Mail"),
          "form.message": L("Wiadomość", "Message", "Nachricht"),
          "form.generation": L("ID generacji lub link do niej (opcjonalnie)", "Generation ID or link to it (optional)", "Generierungs-ID oder Link dazu (optional)"),
          "form.files": L("Załączniki (opcjonalnie)", "Attachments (optional)", "Anhänge (optional)"),
          "form.filesHint": L(
            "Do 3 plików JPG, PNG lub WebP, maks. 5 MB każdy.",
            "Up to 3 JPG, PNG or WebP files, max. 5 MB each.",
            "Bis zu 3 Dateien (JPG, PNG oder WebP), je max. 5 MB.",
          ),
          "form.nip": L("NIP (jeśli dotyczy faktury)", "Tax ID (if it concerns an invoice)", "USt-IdNr. (falls es um eine Rechnung geht)"),
          // The clause the contact form has always carried (CONTACT_V1) — not new legal text.
          "form.consent": L(
            "Wysyłając wiadomość, zgadzasz się na przetwarzanie podanych danych w celu udzielenia odpowiedzi.",
            "By sending this message you agree to your data being processed so that we can reply.",
            "Mit dem Senden stimmst du der Verarbeitung deiner Daten zur Beantwortung zu.",
          ),
          "form.privacy": L("Polityka prywatności", "Privacy Policy", "Datenschutzerklärung"),
          "form.submit": L("Wyślij wiadomość", "Send message", "Nachricht senden"),
          "form.sending": L("Wysyłanie…", "Sending…", "Wird gesendet…"),
          "success.title": L("Dziękujemy!", "Thank you!", "Danke!"),
          "success.body": L("Odpowiemy w ciągu {czas}.", "We will reply within {czas}.", "Wir antworten innerhalb von {czas}."),
          "success.ticket": L("Numer zgłoszenia: #{numer}", "Ticket number: #{numer}", "Ticketnummer: #{numer}"),
          "success.backHome": L("Wróć na stronę główną", "Back to the home page", "Zurück zur Startseite"),
          "success.backApp": L("Wróć do aplikacji", "Back to the app", "Zurück zur App"),
          "firm.title": L("Dane firmy", "Company details", "Firmendaten"),
          "email.copy": L("Kopiuj adres", "Copy address", "Adresse kopieren"),
          "email.copied": L("Skopiowano", "Copied", "Kopiert"),
        },
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
/* ── THE FOOTER (Public pages V1) ─────────────────────────────────────────
 *
 * Two columns beside the brand: "GrovBase" (O nas, Kontakt, Cennik — typed
 * here with all three languages, so the footer never prints a page's
 * Polish-only title on the English site) and "Informacje" (the documents,
 * which the footer always carries). The links' group is the item's `value`.
 * /plany is the public cennik; /cennik answers 308 to it.
 */
export const FOOTER_ITEMS = [
  { title: L("O nas", "About us", "Über uns"), url: "/o-nas", value: "company" },
  { title: L("Kontakt", "Contact", "Kontakt"), url: "/kontakt", value: "company" },
  { title: L("Cennik", "Pricing", "Preise"), url: "/plany", value: "company" },
];
export const FOOTER_HEADINGS: Record<string, LocaleText> = {
  "group.company": L("GrovBase", "GrovBase", "GrovBase"),
  "group.legal": L("Informacje", "Information", "Informationen"),
};
export const FOOTER_BRAND_LINE = L("Narzędzia AI dla e-commerce", "AI tools for e-commerce", "KI-Werkzeuge für E-Commerce");

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
      subtitle: FOOTER_BRAND_LINE,
      items: FOOTER_ITEMS,
      fields: FOOTER_HEADINGS,
    },
  },
} as const;
