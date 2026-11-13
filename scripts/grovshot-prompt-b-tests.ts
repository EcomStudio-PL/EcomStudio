/**
 * GROVBASE SHOT — PROMPT B and REFERENCES V2, checked on a REAL order.
 *
 * Fixture: the PROD order 0fb04563 (13.11.2026, nutcracker figurine, 5
 * photos): its card, its product and scene modules and its plan, as stored
 * — the very shots whose results drifted (shot 4 was regenerated: product
 * right the second time, size wrong again). Prompt A is rebuilt with the
 * production assembler from the same modules, prompt B with the new one, so
 * the comparison is like for like. Nothing here calls a model.
 *
 *   A  prompt B: binding first, product short, no foreign flag rules, no
 *      NEGATIVE list naming objects, no internal photo ids, one size source
 *      whose anchor is arithmetically right
 *   B  references V2: whole-product shots get only whole-product photos;
 *      packaging / variant / collage / graphic never lead; every choice has
 *      its reason; no whole photo → blocked
 *   C  the flag: the default keeps prompt A for everyone
 *
 * Run: npm run test:grovshot-promptb  (writes the A/B texts to
 * test-results/grovshot-prompt-ab.md for the report)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { assemblePrompt, type ProductModules, type SceneModules } from "@/lib/grovshot-shot/prompt";
import { assemblePromptB, codeAnchor, scaleBlock, stripProportionClaims, capSentences, framingCheck } from "@/lib/grovshot-shot/prompt-b";
import { selectReferences, selectReferencesV2 } from "@/lib/grovshot-shot/refs";
import { parseShotSettings, DEFAULT_SHOT_SETTINGS } from "@/lib/grovshot-shot/settings";
import type { ProductCard } from "@/lib/grovshot-shot/card";
import type { KbParsed } from "@/lib/grovshot-shot/kb";
import type { PlanShot } from "@/lib/grovshot-shot/plan";

let failed = 0;
function check(name: string, ok: boolean, detail: unknown = "") {
  if (!ok) failed++;
  console.log(`  ${ok ? "✓" : "✗"} ${name}${ok || detail === "" ? "" : `\n       ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
}

/* ── the order's knowledge (KB v2, the parts these shots use) ──────────────*/
const kb = {
  format: 1, title: "KB v2",
  recipes: [{
    id: "swiateczna_aura", name: "Świąteczna aura", categories: [], slogan: null, testedOn: null, derived: false, derivedNote: null,
    direction: "Bożonarodzeniowa kampania reklamowa, magiczna, bajkowa aura, jak klatka ze świątecznego spotu. Prawdziwe zdjęcie, nie render (raw photo). Światło tylko z prawdziwych źródeł (lampki, świece, ogień, latarnie za oknem), ciepłe światła i chłodniejsze, głębokie cienie, umiarkowane nasycenie, ziarno filmowe.",
    rules: "", negative: [],
  }],
  special: [
    { flag: "swieci", title: "", derived: false, derivedNote: null, rules: "", block: "Świecące elementy produktu świecą jednolitym, nasyconym kolorem na całej długości, z miękką poświatą wokół. Tuż za produktem lub pod nim jest powierzchnia, która łapie mocną plamę jego koloru; pomieszczenie dalej niż ok. 1 m od produktu zachowuje naturalne, ciepłe kolory. Nigdy blade ani białawe świecenie, nigdy przesadnie zabarwiony cały pokój ani neon klubowy." },
    { flag: "sezonowy", title: "", derived: false, derivedNote: null, rules: "", block: "Motyw pory roku zgodny z sezonem produktu, realistyczny i w umiarkowanej ilości." },
    { flag: "elektronika", title: "", derived: false, derivedNote: null, rules: "", block: "Na produkcie neutralne lub chłodne, czyste światło z kontrolowaną ekspozycją, produkt najjaśniejszym punktem kadru; ciepło tylko jako akcent (lampka), nigdy jako filtr na całym zdjęciu." },
    { flag: "wiele_sztuk", title: "", derived: false, derivedNote: null, rules: "", block: null },
  ],
  footers: [
    { key: "detal", when: { types: ["detal"], recipe: null, flag: null, people: null, isDefault: false }, text: "Ultra realistic, 8k, cinematic light, realistic materials, sharp focus on texture." },
    { key: "akcja", when: { types: null, recipe: null, flag: null, people: ["dlonie", "postacie"], isDefault: false }, text: "Ultra realistic, 8k, cinematic light, realistic materials, shallow depth of field." },
    { key: "wnetrze", when: { types: null, recipe: null, flag: null, people: null, isDefault: true }, text: "Ultra realistic, 8k, cinematic light, sharp focus, realistic materials." },
  ],
  negativeBase: "",
  negativeItems: ["render", "CGI", "3D", "plastikowa skóra", "sztuczny uśmiech", "patrzenie w obiektyw", "zniekształcone dłonie", "dodatkowe palce", "inny kolor produktu", "inny kształt", "przekręcone napisy", "inne logo", "napisy", "metki", "etykiety na kosmetykach i butelkach", "amerykańskie wnętrze", "flara", "słońce w kadrze", "przesycone kolory", "efekt wklejenia", "kolaż", "logo lub napisy produktu na innych przedmiotach i w tle", "drugi egzemplarz produktu"],
  planRules: [], directions: [], peopleTable: null, sections: [],
  binding: {
    logo: "Logo i napisy produktu wyłącznie w ich rzeczywistych miejscach na produkcie, nigdy na innych przedmiotach ani w tle.",
    calosc_n: "Zdjęcia {lista} przedstawiają dokładnie ten sam produkt, który należy odwzorować. Zachowaj identyczną konstrukcję, proporcje, materiały, kolory, elementy i oznaczenia. Nie zastępuj go innym produktem tej kategorii.",
    kontekst: "Zdjęcie {lista} pokazuje cały produkt i służy wyłącznie do zachowania spójności kolorów, materiałów i proporcji.",
    detal_glowny: "Zdjęcie 1 przedstawia detal produktu ({opis}) do odtworzenia 1:1.",
  },
} as unknown as KbParsed;

/* ── the order's card (as validated) ───────────────────────────────────────*/
const STATE = "wyłączony, stojący";
const card: ProductCard = {
  produkt: { nazwa: "Figurka dziadka do orzechów z muzyczną kulą wodną LED (pozytywka) 50 cm", wariant: "", kategoria: "dekoracje świąteczne" },
  wymiary: { tekst: "Wysokość 50 cm (z opisu)", zrodlo: "opis", szerokosc_cm: 17, glebokosc_cm: 16, wysokosc_cm: 50, pewne: false },
  skala: ["wysokość 50 cm to mniej więcej połowa wysokości drzwi wewnętrznych"],
  budowa: { elementy: [], kolory: [], materialy: [], liczby: [] },
  napisy: [], stany: [{ stan: STATE, zdjecia: ["Z1", "Z2", "Z3", "Z4", "Z5"] }],
  zdjecia: [
    { id: "Z1", n: 1, rola: "calosc", forma: "zdjecie", ujecie: "przod", stan: STATE, widok: "cała figurka z przodu na białym tle, berło po lewej stronie kadru", nie_kopiowac: ["białe tło studyjne"] },
    { id: "Z2", n: 2, rola: "calosc", forma: "zdjecie", ujecie: "3_4", stan: STATE, widok: "cała figurka obrócona w 3/4, berło przed twarzą i korpusem", nie_kopiowac: ["białe tło studyjne"] },
    { id: "Z3", n: 3, rola: "calosc", forma: "zdjecie", ujecie: "tyl", stan: STATE, widok: "cała figurka od tyłu, przycisk zasilania na podstawie", nie_kopiowac: [] },
    { id: "Z4", n: 4, rola: "detal", forma: "zdjecie", ujecie: "przod", stan: STATE, widok: "zbliżenie na kulę wodną w brzuchu z choinką, misiem, prezentami", nie_kopiowac: [] },
    { id: "Z5", n: 5, rola: "detal", forma: "zdjecie", ujecie: "gora", stan: STATE, widok: "zbliżenie na podstawę z góry pod kątem", nie_kopiowac: [] },
  ],
  argumenty: ["pozytywka"], zastosowania: [], grupa_docelowa: "", uczciwosc: [], sezon: { produkt: "zima", uzycie: "zima" },
  ryzyka: [
    "zmienia liczbę elementów w kuli lub gubi misia, prezenty i choinkę", "gubi lub dubluje berło, przesuwa je do złej ręki",
    "zmienia proporcje: rośnie do rozmiaru człowieka lub robi się szczuplejszy", "zmienia kolory munduru (czerwień na bordo, niebieski na granat)",
    "rozmywa złote zdobienia, piórka i klejnot na kapeluszu",
  ],
  flagi: ["swieci", "sezonowy", "elektronika"], przepis_stylu: "swiateczna_aura",
};

const product: ProductModules = {
  produkt: "Produkt identyczny jak na zdjęciach referencyjnych. Jedna figurka dziadka do orzechów: czarny wysoki kapelusz z niebieskim otokiem w złote zygzaki, 3 złotymi piórami i czerwonym klejnotem z przodu; biała broda; czerwony mundur, niebieskie spodnie, czarne buty. W brzuchu jedna przezroczysta kula z choinką, misiem i prezentami. Złote berło z lilią w prawej ręce figurki. Okrągła podstawa ze złotym blatem i niebieskim walcem. Brak napisów i logo, tylko mały znak zasilania na podstawie z tyłu.",
  skala: "Wysokość 50 cm (ok. 20 cali), podstawa ok. 16 cm średnicy, korpus z ramionami ok. 17 cm. Figurka sięga mniej więcej do połowy wysokości drzwi wewnętrznych, podstawa wielkości talerza obiadowego.",
};

const scenes: Record<number, SceneModules> = {
  1: {
    numer: 1, detal: "", postac: "",
    kadr: "16:9, poziomo, kamera na wysokości 20 cm nad blatem komody, kąt 0–5° od poziomu, odległość ok. 1,5 m, obiektyw 85 mm. Figurka w centrum kadru, zajmuje ok. 70% wysokości kadru, przed nią ok. 25% wolnego blatu. Nic jej nie zasłania, żadnego pierwszego planu. Po prawej kilka dyskretnych ozdób dalej od figurki, po lewej okno.",
    moment: "Wieczór zaczyna się od ciszy przed świętami: figurka dziadka do orzechów lśni na komodzie jak gwiazda pokoju, a w salonie czuć spokojne, ciepłe oczekiwanie. Za oknem powoli opada śnieg, w świetle latarni widać tylko kilka płatków.",
    stan_chwyt: "Figurka stoi pionowo na komodzie, cała podstawa (złoty blat, niebieski walec ze złotymi obrzeżami) leży płasko na blacie. Berło ze złotą lilią po lewej stronie kadru, jedna kula w brzuchu, wszystkie elementy dokładnie jak na zdjęciu 1 i zdjęciu 2. Czarne buty widoczne nad złotym blatem.",
    scenografia: "Ciemna drewniana komoda w europejskim salonie, ciepłe tło z miękko rozmytymi girlandami lampek na półce po prawej. Za oknem po lewej latarnia uliczna i gęsto padający śnieg tylko za szybą. Obok figurki, w odstępie, dwie małe ozdoby: mała szyszka i ceramiczna miseczka z cynamonem, bez napisów. Światło z boku z lampy z abażurem, chłodniejsze głębokie cienie w tle, figurka najjaśniejszym punktem kadru, bez flar.",
    negative_dopiski: ["druga figurka", "druga kula", "drewnopodobny blat podstawy", "śnieg wewnątrz pokoju", "brokat poza kulą", "figurka zasłonięta ozdobami"],
  },
  2: {
    numer: 2, moment: "", postac: "", stan_chwyt: "", scenografia: "",
    kadr: "16:9, zbliżenie z przodu pod tym samym kątem co zdjęcie 1 (Z4): prosto na wprost, wysokość kamery na wysokości kuli, ok. 0°, obiektyw 100 mm. Kula w centrum, po prawej i lewej stronie rękawy i ręka w rękawiczce z berłem, na dole pas z klamrą, na górze biała broda.",
    detal: "Wycinek skopiowany 1:1 ze zdjęcia 1 (Z4): przezroczysta owalna kula w brzuchu figurki z choinką z gwiazdą, bombkami i czerwonymi kokardami, misiem z czerwoną kokardą, prezentami, piłką w paski i drewnianym konikiem, drobinami brokatu tylko wewnątrz kuli. Obok czerwone rękawy, ręka w białej rękawiczce z berłem, czarny pas ze złotą klamrą, dół białej brody. Zmienione tylko tło i światło: rozmyte ciepłe plamy girland lampek i kominka w tle na półce nad kominkiem, ciepłe światło z boku, brokat w kuli łapie smugę światła, głębokie cienie wokół. Liczba i układ elementów w kuli bez zmian.",
    negative_dopiski: ["druga kula obok figurki", "zmieniona scenka w kuli", "pełna figurka w kadrze"],
  },
  4: {
    numer: 4, detal: "",
    kadr: "16:9, szeroki kadr, kamera na wysokości 1,3 m, kąt ok. 5° w dół, odległość ok. 3 m, obiektyw 35 mm. Figurka na parapecie po prawej trzeciej części kadru, cała widoczna, zajmuje ok. 45% wysokości kadru i nikt jej nie zasłania. Po lewej właścicielka w półprofilu przy figurce, dalej stoliki z klientami. Proporcja: figurka sięga do połowy wysokości ramy okna, ok. dwa razy wyższa niż filiżanka na stoliku obok.",
    moment: "Z dumnym uśmiechem właścicielka ustawia ostatnią dekorację w witrynie, a za nią goście przy stolikach zerkają na rozświetloną figurkę. Za szybą wieczorna ulica, w środku gwar i zapach kawy.",
    postac: "Kobieta ok. 45 lat, ciemne włosy związane w kok, czerwony wełniany sweter, ciemne dżinsy, uśmiech i skupienie, patrzy na figurkę, nie w obiektyw. W tle dwie osoby przy stoliku, rozmawiają przy kawie, ubrane w zieleń i musztardę.",
    stan_chwyt: "Figurka stoi pionowo na parapecie witryny, podstawa płasko na blacie, berło po lewej stronie kadru, widoczna w całości od kapelusza po podstawę, ustawiona przodem do wnętrza kawiarni, w lekkim 3/4 jak na zdjęciu 2. Jedna kula w brzuchu, złoty blat podstawy.",
    scenografia: "Europejska kawiarnia z drewnianymi stolikami i ciemnymi krzesłami, ceglana ściana, wąski parapet witryny z kilkoma gałązkami jodły i małą girlandą lampek przy szybie, bez napisów. Za szybą wieczorna ulica, rozmyte światła lamp ulicznych, bez śniegu. Złote światło lampek i lamp ulicznych zza szyby tworzy kontrę na krawędziach figurki, chłodniejsze plamy w głębi sali. Tło spokojniejsze niż figurka, bez flar.",
    negative_dopiski: ["druga figurka", "napisy na szybie lub w menu", "postać zasłaniająca figurkę", "logo kawiarni", "uniform kelnera", "figurka w rozmiarze człowieka"],
  },
};
const plan: Record<number, PlanShot> = {
  1: { numer: 1, typ: "hero", ludzie: "brak", caly_produkt: true, stan: STATE, referencje: [1, 2], argument: "", kierunek: "", miejsce: "", swiatlo: "", swiatlo_typ: "inne", kadr: "hero", opis: "", skala_cm: null, fixed: false },
  2: { numer: 2, typ: "detal", ludzie: "brak", caly_produkt: false, stan: STATE, referencje: [4, 1], argument: "", kierunek: "", miejsce: "", swiatlo: "", swiatlo_typ: "inne", kadr: "ciasny", opis: "", skala_cm: null, fixed: false },
  4: { numer: 4, typ: "uzycie", ludzie: "postacie", caly_produkt: true, stan: STATE, referencje: [1, 2], argument: "", kierunek: "", miejsce: "", swiatlo: "", swiatlo_typ: "inne", kadr: "szeroki", opis: "", skala_cm: null, fixed: false },
};

const out: string[] = ["# GrovBase Shot — prompt A vs B (zlecenie 0fb04563, dziadek do orzechów)\n"];

console.log("A. PROMPT B on the real order");
for (const n of [1, 2, 4]) {
  const shot = plan[n];
  const refs = { refs: shot.referencje, aux: [] as number[] };
  const a = assemblePrompt({ kb, card, shot, product, scene: scenes[n], refs });
  const b = assemblePromptB({ kb, card, shot, product, scene: scenes[n], refs, aspectRatio: "16:9" });
  const pct = Math.round((1 - b.text.length / a.text.length) * 100);
  out.push(`## Ujęcie ${n} (${shot.typ}) — A: ${a.text.length} znaków, B: ${b.text.length} znaków (−${pct}%)\n`, "### A (obecny)\n", "```", a.text, "```\n", "### B (zdjęcia nadrzędne)\n", "```", b.text, "```\n");
  check(`shot ${n}: B is shorter than A (A ${a.text.length}, B ${b.text.length}, −${pct}%)`, b.text.length < a.text.length * 0.75);
  check(`shot ${n}: B opens with the binding (which photos ARE the product)`, b.modules[0].name === "WIĄZANIE ZDJĘĆ" && /^Zdjęci[ae] 1/.test(b.text));
  check(`shot ${n}: no NEGATIVE list, no object named only to be excluded`, !/Negative:/i.test(b.text) && !/druga figurka|druga kula|rozmiarze człowieka|bordo|granat/.test(b.text), b.text.match(/druga \w+|bordo|granat/g));
  check(`shot ${n}: no internal photo id (Z4) reaches the image model`, !/\bZ\d\b/.test(b.text), b.text.match(/\bZ\d\b/g));
  check(`shot ${n}: the grow-lamp rule ("świecą jednolitym…") and the cool-light electronics rule are left out`,
    !/jednolitym, nasyconym kolorem/.test(b.text) && !/neutralne lub chłodne/.test(b.text) && b.notes.flags_dropped.includes("swieci"));
  if (shot.typ !== "detal") {
    check(`shot ${n}: order of authority — binding → product → scene → frame & scale → constraints`,
      b.modules.map((m) => m.name).join(">") === "WIĄZANIE ZDJĘĆ>PRODUKT>SCENA>KADR I SKALA>OGRANICZENIA", b.modules.map((m) => m.name));
    check(`shot ${n}: the size comes from the card's numbers (50 cm) with a correct anchor`, /wysokość 50 cm/.test(b.text) && /butelki wody 1,5 l \(33 cm\)/.test(b.text), scaleBlock(card));
    check(`shot ${n}: the wrong anchors are gone ("połowa drzwi" = 100 cm, "dwa razy filiżanka" = 16 cm)`, !/drzwi wewnętrznych/.test(b.text) && !/filiżank/.test(b.text));
    const names = (t: string) => (t.match(/dziad(ek|ka) do orzechów|figurk/gi) ?? []).length;
    check(`shot ${n}: the product is named less often than in A (A ${names(a.text)}, B ${names(b.text)})`, names(b.text) < names(a.text));
  }
}

console.log("B. SCALE ANCHORS — computed, never guessed");
check("50 cm → ≈ 1,5 × a 1.5 l bottle (33 cm)", codeAnchor(50) === "ok. 1,5 × wysokość butelki wody 1,5 l (33 cm)", codeAnchor(50));
check("31 cm → about an A4 sheet standing (30 cm)", codeAnchor(31) === "mniej więcej wysokość kartki A4 ustawionej pionowo (30 cm)", codeAnchor(31));
check("200 cm → a door", /drzwi/.test(codeAnchor(200) ?? ""), codeAnchor(200));
check("8 cm → a fraction of a hand or a mug", /dłoni|kubka/.test(codeAnchor(8) ?? ""), codeAnchor(8));
check("the proportion claim is removed, the frame stays", (() => {
  const r = stripProportionClaims(scenes[4].kadr);
  return r.removed.length === 1 && /45% wysokości kadru/.test(r.text);
})());
check("frame arithmetic: 45% of a 16:9 frame at 3 m / 35 mm = ~78 cm for a 50 cm product → the share is dropped", (() => {
  const r = framingCheck(scenes[4].kadr, 50, "16:9");
  return r.implied === 78 && r.removed.length === 1 && /obiektyw 35 mm/.test(r.text);
})(), framingCheck(scenes[4].kadr, 50, "16:9"));
check("frame arithmetic: a consistent share is kept (45% at 1.5 m / 50 mm ≈ 27 cm for a 30 cm product)",
  framingCheck("Odległość ok. 1,5 m, obiektyw 50 mm. Produkt zajmuje ok. 45% wysokości kadru.", 30, "16:9").removed.length === 0);
check("a long first sentence is kept whole (never cut mid-sentence)", capSentences("Jedno bardzo długie zdanie " + "słowo ".repeat(60) + "koniec. Drugie.", 10).endsWith("koniec."));

console.log("C. REFERENCES V2");
{
  const v2 = (shot: Partial<PlanShot>, c: ProductCard = card) => selectReferencesV2({ typ: "uzycie", caly_produkt: true, stan: STATE, referencje: [], ...shot } as PlanShot, c, { max: 5 });
  const hero = v2({ typ: "hero", referencje: [4, 1] });
  check("nutcracker hero planned [Z4 close-up, Z1] → only whole photos [Z1 front, Z2 3/4]", JSON.stringify(hero.refs) === "[1,2]" && hero.dropped.some((d) => d.photo === 4 && d.reason === "fragment_w_ujeciu_calosci"), hero);
  check("…each with its reason", hero.reasons.map((r) => r.reason).join(",") === "calosc_najlepsza,calosc_inny_kat");
  const det = v2({ typ: "detal", caly_produkt: false, referencje: [4, 1, 5] });
  check("detail shot: the planned detail first, ONE whole photo as context", JSON.stringify(det.refs) === "[4,1]" && det.reasons[0].reason === "detal_ujecia", det);

  // The bag (order 9053a8e7, shot 5): Z5 is the folded pack — another STATE of the product.
  const bag: ProductCard = {
    ...card, stany: [{ stan: "rozłożony", zdjecia: ["Z1", "Z2", "Z3", "Z4"] }, { stan: "złożony", zdjecia: ["Z5"] }],
    zdjecia: [
      { id: "Z1", n: 1, rola: "calosc", forma: "zdjecie", ujecie: "przod", stan: "rozłożony", widok: "worek stojący z przodu", nie_kopiowac: [] },
      { id: "Z2", n: 2, rola: "calosc", forma: "zdjecie", ujecie: "3_4", stan: "rozłożony", widok: "worek leżący 3/4", nie_kopiowac: [] },
      { id: "Z3", n: 3, rola: "detal", forma: "zdjecie", ujecie: "inne", stan: "rozłożony", widok: "uchwyt", nie_kopiowac: [] },
      { id: "Z4", n: 4, rola: "detal", forma: "zdjecie", ujecie: "inne", stan: "rozłożony", widok: "dno", nie_kopiowac: [] },
      { id: "Z5", n: 5, rola: "opakowanie", forma: "zdjecie", ujecie: "gora", stan: "złożony", widok: "złożony płaski pakiet obok obręczy", nie_kopiowac: [] },
    ],
  };
  const a1 = selectReferences({ typ: "uzycie", referencje: [5] }, bag, { max: 5 });
  check("prompt A's rule sent the folded pack behind the whole bag (the PROD finding)", JSON.stringify(a1.refs) === "[1,2,5]", a1.refs);
  const b1 = v2({ typ: "uzycie", caly_produkt: true, stan: "rozłożony", referencje: [5] }, bag);
  check("V2: a whole-product scene of the unfolded bag never gets the folded pack", JSON.stringify(b1.refs) === "[1,2]" && b1.dropped.some((d) => d.photo === 5), b1);
  const b2 = v2({ typ: "uzycie", caly_produkt: true, stan: "złożony", referencje: [5] }, bag);
  check("V2: no whole photo of the scene's state → the best whole photo of any state, flagged", b2.stateFallback && JSON.stringify(b2.refs) === "[1,2]", b2);

  // The Tefal card style: Z7 a 3/4 photo with dimension arrows, Z8 a collage, Z5 a usage close-up.
  const tefal: ProductCard = {
    ...card, stany: [{ stan: "zamknięta", zdjecia: [] }],
    zdjecia: [
      { id: "Z1", n: 1, rola: "calosc", ujecie: "przod", forma: "zdjecie", stan: "", widok: "przód na wprost, białe tło", nie_kopiowac: [] },
      { id: "Z2", n: 2, rola: "calosc", ujecie: "przod", forma: "zdjecie", stan: "", widok: "przód na blacie", nie_kopiowac: [] },
      { id: "Z3", n: 3, rola: "calosc", ujecie: "3_4", forma: "zdjecie", stan: "", widok: "3/4 z prawej", nie_kopiowac: [] },
      { id: "Z5", n: 5, rola: "uzycie", ujecie: "inne", forma: "zdjecie", stan: "", widok: "dłoń kręci pokrętłem", nie_kopiowac: [] },
      { id: "Z7", n: 7, rola: "detal", ujecie: "3_4", forma: "grafika", stan: "", widok: "strzałki wymiarowe", nie_kopiowac: [] },
      { id: "Z8", n: 8, rola: "uzycie", ujecie: "gora", forma: "kolaz", stan: "", widok: "kolaż 4 ujęć", nie_kopiowac: [] },
    ],
  };
  const t1 = v2({ typ: "uzycie", caly_produkt: true, stan: "", referencje: [5, 2, 7, 8] }, tefal);
  check("Tefal whole shot planned [usage, front, graphic, collage] → [front Z1, 3/4 Z3] only", JSON.stringify(t1.refs) === "[1,3]", t1);
  check("…graphic and collage dropped with their reasons", t1.dropped.some((d) => d.photo === 7 && d.reason === "grafika_w_ujeciu_calosci") && t1.dropped.some((d) => d.photo === 8 && d.reason === "kolaz_lub_inne_produkty"));
  const t2 = v2({ typ: "uzycie", caly_produkt: false, stan: "", referencje: [5] }, tefal);
  check("Tefal partial use shot (hand on the knob): whole photos first, then the pose to copy", JSON.stringify(t2.refs) === "[1,3,5]" && t2.reasons[2].reason === "uzycie_poza", t2);
  const none = v2({ typ: "hero", referencje: [7] }, { ...tefal, zdjecia: tefal.zdjecia.filter((p) => p.rola !== "calosc") });
  check("no clean whole-product photo → blocked (never drawn from words alone)", none.blocked && none.refs.length === 0);
}

console.log("D. THE FLAG");
check("default variant is A (customers keep the current prompt)", DEFAULT_SHOT_SETTINGS.prompt.variant === "a");
const okB = parseShotSettings({ prompt: { variant: "b_admin" } });
check("variant b_admin is accepted", okB.ok && okB.settings.prompt.variant === "b_admin");
const bad = parseShotSettings({ prompt: { variant: "x" } });
check("an unknown variant is refused", !bad.ok);

mkdirSync("test-results", { recursive: true });
writeFileSync("test-results/grovshot-prompt-ab.md", out.join("\n"));
console.log(failed ? `\n${failed} PROMPT B TEST(S) FAILED` : "\nAll prompt B tests passed.");
process.exit(failed ? 1 : 0);
