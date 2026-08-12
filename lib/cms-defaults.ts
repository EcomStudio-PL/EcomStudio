import type { CmsBlock } from "./cms";

const L = (pl: string, en: string, de: string) => ({ pl, en, de });

/** Default homepage sections. Rendered as the live homepage until an admin
 *  publishes a customized version from ADMIN → Strona WWW, and used to seed
 *  the CMS editor with a starting point. */
export const DEFAULT_HOME_BLOCKS: CmsBlock[] = [
  {
    type: "hero", sort_order: 0, visible: true, content: {
      badge: L("AI PRODUCT CONTENT PLATFORM", "AI PRODUCT CONTENT PLATFORM", "AI PRODUCT CONTENT PLATFORM"),
      title: L(
        "Twórz content produktowy, który wygląda jak prawdziwa sesja.",
        "Create product content that looks like a real photo shoot.",
        "Erstelle Produkt-Content, der wie ein echtes Shooting aussieht."
      ),
      subtitle: L(
        "Od kilku zdjęć produktu do gotowych reklam, packshotów, lifestyle shots i video AI — w jednym workflow.",
        "From a few product photos to finished ads, packshots, lifestyle shots and AI video — in one workflow.",
        "Von wenigen Produktfotos zu fertigen Anzeigen, Packshots, Lifestyle-Shots und KI-Video — in einem Workflow."
      ),
      ctaLabel: L("Wypróbuj za darmo", "Try for free", "Kostenlos testen"),
      ctaUrl: "/register",
      cta2Label: L("Zobacz możliwości", "See what it can do", "Möglichkeiten ansehen"),
      cta2Url: "#showcase",
    },
  },
  {
    type: "showcase", sort_order: 1, visible: true, content: {
      title: L(
        "Jedno zdjęcie produktu. Dziesiątki materiałów sprzedażowych.",
        "One product photo. Dozens of sales assets.",
        "Ein Produktfoto. Dutzende Verkaufsmaterialien."
      ),
      description: L(
        "Ten sam produkt — nowe sceny, formaty i konteksty. Bez studia.",
        "The same product — new scenes, formats and contexts. No studio.",
        "Dasselbe Produkt — neue Szenen, Formate und Kontexte. Ohne Studio."
      ),
      items: [
        { title: L("Lifestyle", "Lifestyle", "Lifestyle") },
        { title: L("Packshot", "Packshot", "Packshot") },
        { title: L("Detail", "Detail", "Detail") },
        { title: L("Social Ad", "Social Ad", "Social Ad") },
        { title: L("Marketplace", "Marketplace", "Marketplace") },
        { title: L("Video", "Video", "Video") },
      ],
    },
  },
  {
    type: "before_after", sort_order: 2, visible: true, content: {
      title: L("Przed i po", "Before & after", "Vorher & nachher"),
      description: L(
        "Zwykłe zdjęcie z telefonu zamienione w profesjonalny content sprzedażowy.",
        "An ordinary phone photo turned into professional sales content.",
        "Ein gewöhnliches Handyfoto, verwandelt in professionellen Verkaufs-Content."
      ),
    },
  },
  {
    type: "video", sort_order: 3, visible: true, content: {
      title: L("Nie tylko zdjęcia.", "Not just photos.", "Nicht nur Fotos."),
      subtitle: L(
        "Zamień produkt w reklamę video.",
        "Turn your product into a video ad.",
        "Verwandle dein Produkt in eine Videoanzeige."
      ),
    },
  },
  {
    type: "product_lock", sort_order: 4, visible: true, content: {
      badge: L("PRODUCT LOCK", "PRODUCT LOCK", "PRODUCT LOCK"),
      title: L(
        "AI może zmienić scenę. Nie Twój produkt.",
        "AI can change the scene. Not your product.",
        "KI darf die Szene ändern. Nicht dein Produkt."
      ),
      description: L(
        "Product Lock pilnuje każdego detalu podczas generacji.",
        "Product Lock guards every detail during generation.",
        "Product Lock schützt jedes Detail während der Generierung."
      ),
      items: [
        { title: L("Kolor", "Color", "Farbe") },
        { title: L("Kształt", "Shape", "Form") },
        { title: L("Logo", "Logo", "Logo") },
        { title: L("Proporcje", "Proportions", "Proportionen") },
        { title: L("Elementy produktu", "Product elements", "Produktelemente") },
      ],
    },
  },
  {
    type: "workflow", sort_order: 5, visible: true, content: {
      title: L("Jak to działa", "How it works", "So funktioniert's"),
      items: [
        { title: L("Dodaj produkt", "Add a product", "Produkt hinzufügen"),
          description: L("Kilka zdjęć referencyjnych wystarczy.", "A few reference photos are enough.", "Wenige Referenzfotos genügen.") },
        { title: L("Wybierz styl / prompt", "Pick a style / prompt", "Stil / Prompt wählen"),
          description: L("Gotowe szablony i inspiracje albo własny prompt.", "Ready templates and inspirations or your own prompt.", "Fertige Vorlagen und Inspirationen oder eigener Prompt.") },
        { title: L("Generuj gotowe materiały", "Generate finished assets", "Fertige Materialien generieren"),
          description: L("Packshoty, lifestyle, reklamy i video w minutach.", "Packshots, lifestyle, ads and video in minutes.", "Packshots, Lifestyle, Anzeigen und Video in Minuten.") },
      ],
    },
  },
  {
    type: "use_cases", sort_order: 6, visible: true, content: {
      title: L("Stworzone dla e-commerce", "Built for e-commerce", "Gemacht für E-Commerce"),
      items: [
        { title: L("Sprzedawcy Allegro", "Allegro sellers", "Allegro-Verkäufer") },
        { title: L("Marketplace", "Marketplace", "Marketplace") },
        { title: L("Sklepy internetowe", "Online stores", "Onlineshops") },
        { title: L("Hurtownie", "Wholesalers", "Großhändler") },
        { title: L("Agencje", "Agencies", "Agenturen") },
        { title: L("Marki D2C", "D2C brands", "D2C-Marken") },
        { title: L("Social Ads", "Social Ads", "Social Ads") },
      ],
    },
  },
  {
    type: "features", sort_order: 7, visible: true, content: {
      title: L("Wszystko w jednym studio", "Everything in one studio", "Alles in einem Studio"),
      items: [
        { title: L("AI Studio", "AI Studio", "AI Studio"),
          description: L("Generacje obrazów i wideo z wielu modeli.", "Image and video generations from multiple models.", "Bild- und Video-Generierung aus mehreren Modellen.") },
        { title: L("Generator promptów", "Prompt generator", "Prompt-Generator"),
          description: L("Profesjonalne prompty produktowe w sekundę.", "Professional product prompts in seconds.", "Professionelle Produkt-Prompts in Sekunden.") },
        { title: L("Product Lock", "Product Lock", "Product Lock"),
          description: L("Wierność produktu pilnowana automatycznie.", "Product fidelity guarded automatically.", "Produkttreue automatisch geschützt.") },
        { title: L("Biblioteka i historia", "Library & history", "Bibliothek & Verlauf"),
          description: L("Każdy materiał i zadanie w jednym miejscu.", "Every asset and job in one place.", "Jedes Asset und jeder Auftrag an einem Ort.") },
        { title: L("Workspaces", "Workspaces", "Workspaces"),
          description: L("Praca zespołowa i tryb agencyjny.", "Teamwork and agency mode.", "Teamarbeit und Agentur-Modus.") },
        { title: L("Kredyty", "Credits", "Credits"),
          description: L("Przejrzyste rozliczenia bez subskrypcyjnych pułapek.", "Transparent billing without subscription traps.", "Transparente Abrechnung ohne Abo-Fallen.") },
      ],
    },
  },
  {
    type: "cta", sort_order: 8, visible: true, content: {
      title: L(
        "Zacznij tworzyć profesjonalny content produktowy już dziś",
        "Start creating professional product content today",
        "Erstelle noch heute professionellen Produkt-Content"
      ),
      ctaLabel: L("Rozpocznij za darmo", "Start for free", "Kostenlos starten"),
      ctaUrl: "/register",
    },
  },
];
