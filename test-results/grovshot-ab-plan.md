# GrovBase Shot — płatny test A/B (do zatwierdzenia)

Limit: **≤ 2 USD łącznie** — egzekwowany przez serwer (`experiment_daily_budget_usd = 2`, funkcja `grovshot_shot_experiment_create`, 0168).
Koszt jednego wywołania: cena 2K z zamówienia źródłowego 0,134 USD + rezerwa tokenów 0,01 USD = **≈ 0,144 USD** (rzeczywiste wywołania z 13.11: 0,1396–0,1400 USD).
Konto: administratora (eksperymenty to przebiegi testowe — bez pobierania kredytów, bez galerii klienta).

A = istniejące obrazy z produkcji (bez kosztu): oryginał + ponowna generacja tam, gdzie była.
B = nowy prompt, **te same zdjęcia w tej samej kolejności**, ten sam model, rozdzielczość i proporcje (eksperyment kopiuje je ze zlecenia źródłowego).

| # | Zlecenie | Ujęcie | Wariant | Zdjęcia | Dlaczego to ujęcie | A do porównania |
|---|---|---|---|---|---|---|
| 1 | 0fb04563 (dziadek do orzechów, 13.11) | 4 (kawiarnia, szeroki) | B | Z1, Z2 (jak A) | regenerowane: „poprawił produkt, ale znowu rozmiar” | oryginał + 58c337bd |
| 2 | 0fb04563 | 1 (hero na komodzie) | B | Z1, Z2 | kadr 85 mm / 1,5 m sprzeczny z 50 cm | oryginał |
| 3 | 0fb04563 | 4 | **B‑EN** (tekst niżej) | Z1, Z2 | test języka instrukcji | wynik #1 |
| 4 | 293ad254 (Tefal, 07.11) | 2 | B | Z5, Z2 (jak A) | regenerowane | oryginał + 0a6e65ad |
| 5 | 293ad254 | 4 (detal) | B | jak A | regenerowane | oryginał + 0af2d21f |
| 6 | 9053a8e7 (worek, 13.11) | 5 | B + „Użyj doboru B” | Z1, Z2 (bez złożonego pakietu Z5) | A wysłał złożony pakiet za całym workiem | oryginał |
| 7 | 293ad254 | 1 (hero) | B | Z2 (jak A) | jedna referencja – czysty test tekstu | oryginał |

**Razem: 7 wywołań ≈ 1,01 USD** (górna granica rezerwacji; serwer odrzuci każde kolejne ponad 2 USD dziennie).

## Jak uruchomić (każde ujęcie: 3 kliknięcia)
Panel admina → GrovBase Shot → Zlecenia → zlecenie → **Podgląd procesu** → kafel ujęcia → **Uruchom ponownie to ujęcie** →
przełącznik **„B – zdjęcia nadrzędne”** → zaznacz potwierdzenie ceny → **Uruchom**. Wynik pojawia się na kanwie obok ujęcia A.
Dla #3 wklej tekst z sekcji „B‑EN” w pole promptu (zdjęcia zostaw jak w A). Dla #6 kliknij też „Użyj doboru B”.

## Jak oceniać (każda para A / B)
1. kształt i konstrukcja produktu (np. kula w brzuchu, berło, kapelusz; kosz frytkownicy; uchwyty worka),
2. kolory i materiały,
3. liczba elementów,
4. proporcje i **skala względem otoczenia/ludzi**,
5. umiejscowienie napisów i logo,
6. czy to nie jest „typowy model z kategorii” zamiast tego produktu.

## B‑EN — ujęcie 4 dziadka (wierne tłumaczenie B‑PL, wyłącznie do testu języka)

```
Images 1 and 2 are photographs of exactly this product: a 50 cm nutcracker figurine with a musical LED water globe. Place this same object in the scene, reproduced faithfully from the photos: shape and construction, proportions, colours, materials, number and arrangement of parts, text and logos where they are. Take the product's appearance from the photos, not from an idea of a typical product of this category.

Features that must not be confused: one nutcracker figurine: tall black hat with a blue band with gold zigzags, 3 gold feathers and a red jewel at the front; white beard; red uniform, blue trousers, black boots. In the belly one transparent globe with a Christmas tree, a teddy bear and presents. A gold sceptre with a lily in the figurine's right hand. A round base with a gold top and a blue cylinder.

Christmas advertising campaign, magical, fairy-tale mood, like a frame from a Christmas commercial. A real photo, not a render (raw photo). Light only from real sources (fairy lights, candles, fire, street lamps outside the window), warm lights and cooler, deep shadows, moderate saturation, film grain. With a proud smile the owner places the last decoration in the shop window, while guests at the tables behind her glance at the lit figurine. Behind the glass an evening street; inside, chatter and the smell of coffee. A woman about 45, dark hair in a bun, red wool sweater, dark jeans, smiling and focused, looking at the figurine, not at the camera. A European café with wooden tables and dark chairs, a brick wall, a narrow shop-window sill with a few fir branches and a small string of fairy lights by the glass, no lettering. Behind the glass an evening street, blurred street-lamp lights, no snow. Golden light from the fairy lights and street lamps behind the glass rims the figurine's edges, cooler patches deeper in the room. The figurine stands upright on the window sill, base flat on the surface, sceptre on the left of the frame, fully visible from hat to base, facing into the café, in a slight 3/4 view as in image 2. Seasonal motif matching the product's season, realistic and in moderation.

16:9, wide shot, camera at 1.3 m height, about 5° downward, distance about 3 m, 35 mm lens. The figurine on the window sill in the right third of the frame, fully visible and not covered by anyone. On the left the owner in half profile next to the figurine, further back tables with guests. Real size of the product: height 50 cm, width 17 cm, depth 16 cm, i.e. about 1.5 × the height of a 1.5 l water bottle (33 cm). Keep this scale relative to the surroundings and people.

One single product. The product fully visible, unobstructed, sharp. Natural people with correct hands, not looking at the camera. Plain props without text or logos. European interiors, no flares and no sun in the frame. Ultra realistic, 8k, cinematic light, realistic materials, shallow depth of field.
```
