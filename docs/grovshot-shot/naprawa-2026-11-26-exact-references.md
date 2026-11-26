# GrovShot V2.3 — Exact References i Exact Replay (26.11.2026)

## Problem (zamówienie f23e0676, Philips BHD530, 5 ujęć)

Opus 5.5 zaplanował referencje: 1: Z2+Z1, 2: Z2+Z5, 3: Z2+Z6, 4: Z7+Z2, 5: Z3+Z2.
Na PROD backend zmienił je w trzech ujęciach. Robił to selektor referencji V2 (`selectReferencesV2`, `lib/grovshot-shot/refs.ts`):

- **ujęcie 1** — Z2 wypadło jako „inny stan” (`inny_stan`): plan sceny to „komplet obok siebie”, a Z2 to „bez nasadki”;
- **ujęcia 4 i 5 (detale)** — gałąź detalu wybiera kontekst rankingiem widoków i odrzuca resztę jako „limit”, choć limitu nie było. W ujęciu 5 Z3 zastąpiło Z2, bo `lead(1)` zwraca pierwsze zdjęcie całości, a ono było już zdjęciem głównym.

Dane z granicy sieciowej PROD potwierdziły, że reszta ścieżki działa poprawnie:

- transport do Google jest poprawny: części `inlineData` w kolejności z backendu, SHA zgodne ze Storage, `transform: none`, png;
- konfiguracja jest poprawna: `gemini-3-pro-image:generateContent`, `responseModalities: ["IMAGE"]`, `imageConfig {imageSize: "2K", aspectRatio: "16:9"}`;
- prompt jest identyczny (`prompt_matches: true`);
- odbiór obrazu jest poprawny: jeden obraz finalny, `pickGeminiFinalImage` bierze ostatni obraz, który nie jest `thought`.

Przyczyną zmian był więc wyłącznie selektor, nie wysyłka.

## Exact References

Ustawienie `app_settings.grovshot_shot.prompt.references`, w panelu: Admin → GrovShot → Ustawienia → „Referencje obrazu (nowe zlecenia)”.

| wartość | działanie |
|---|---|
| `auto` | dotychczasowy dobór V2 (domyślny) |
| `exact_admin` | dokładnie według planu Opusa, tylko zlecenia administratorów (**PROD od migracji 0185**) |
| `exact` | dokładnie według planu Opusa, wszystkie zlecenia — **nie włączać przed akceptacją testu obrazowego** |

Tryb jest przypinany do zlecenia przy starcie (`input.reference_mode`, `orderReferenceMode` w `lib/grovshot-shot/settings.ts`). Zlecenie w toku nie zmienia trybu.

W trybie exact `selectReferencesExact` (`refs.ts`) zwraca `referencje` planu bez zmian: te same numery, ta sama kolejność, nic nie jest dodawane ani usuwane. Powód każdej pozycji to `plan_opus`. Grafika zostaje na miejscu wskazanym przez Opusa i jest oznaczona jako pomocnicza.

Niepoprawny wybór jest **blokowany jawnie**, bez wywołania i bez kredytów:

- `reference_invalid_plan` — zdjęcie innego wariantu, kolaż lub zdjęcie z innymi produktami, nieistniejący numer zdjęcia albo pusta lista;
- `reference_limit` — więcej zdjęć niż limit 6.

Ochrona plików działa tak jak dotąd: hash zdjęcia przypięty do zlecenia (`reference_changed`), odczyt Storage, `prepareReferenceImage`.

Bramka planu w trybie exact (`planViolations(..., { exactRefs: true })`) traktuje zdjęcie całości w innym stanie obok zdjęcia stanu jako zdjęcie tożsamości, a nie jako konflikt. `whole_with_fragment` jest wtedy naruszeniem miękkim. Pozostałe twarde reguły uczciwości obowiązują dalej.

Prompt B3, KB v4.3, Opus 5.5 Medium, logika scen, ceny i kredyty pozostały bez zmian.

## Diagnostyka A → B → C (panel procesu, tylko administrator)

Każda runda Nano Banana zapisuje w kroku `stage_checks`:

- `opus_plan` (A), `prepared` (B), `sent` (C — zdjęcia z faktycznego requestu, rozpoznane po SHA);
- `plan_kept` (A = B), `prepared_matches_request` (B = C), `prompt_intact` (SHA tekstu = SHA promptu z panelu i z requestu);
- `images_complete`, `image_received`, `reference_mode`.

Gdy requestu nie dało się zaobserwować, wartości C są równe `null` („—”), a nie „ok”.

Panel rundy ma blok „Kontrola etapów A → B → C”. W tabeli referencji kolumna „Wymagane przez plan” pokazuje plan Opusa.

Nie zapisujemy kluczy API ani dodatkowych kopii base64: obrazy z granicy sieciowej mają tylko hash i wymiary, tak jak dotąd.

## Exact Replay — ponów identyczne żądanie

Panel procesu → ujęcie → przycisk **„Exact Replay — ponów identyczne żądanie”**. Edytor otwiera się z finalnym promptem ujęcia i z referencjami faktycznie wysłanymi, w tej samej kolejności.

- **„Referencje z planu Opusa: …”** wczytuje plan Opusa.
- **„Referencje faktycznie wysłane: …”** przywraca oryginał.
- **„Kopiuj pełny prompt”** kopiuje cały prompt.
- Strzałkami można zmienić kolejność zdjęć, a przyciskiem usunąć zdjęcie albo dodać inne (tylko zdjęcia tego zlecenia, maks. 6).
- Wskaźniki pokazują, czy prompt i zdjęcia są identyczne z wysłanymi.

Exact Replay to wyłącznie generacja obrazu: bez Opusa, bez selektora i bez składania promptu. `experiment()` w `lifestyle.ts` wysyła tekst i listę verbatim. Pozostałe zasady:

- koszt jest widoczny i trzeba go potwierdzić przed wywołaniem;
- jedno płatne wywołanie, bez ponowień;
- dzienny limit eksperymentów i idempotencja (0168);
- trasa jest tylko dla administratora;
- klient nie jest obciążany, a wynik nie trafia do galerii bez „Dodaj do galerii klienta”.

Paczka do porównania z Higgsfield jest dostępna w panelu rundy (przycisk paczki ZIP: request, prompt, zdjęcia, odpowiedź).

## Testy

- `npm run test:grovshot-fix`, sekcja X (16 sprawdzeń):
  - f23e0676 przed zmianą (auto zmienia ujęcia 1, 4, 5) i po niej (exact: Z2+Z1, Z2+Z5, Z2+Z6, Z7+Z2, Z3+Z2);
  - zserializowane body Gemini: zdjęcia bajt w bajt i w kolejności, potem prompt o tym samym SHA, `generationConfig` bez dodatków;
  - blokady: inny wariant, kolaż, brakujący plik, pusta lista, limit;
  - 1, 2, 3 i 6 referencji;
  - HTC-2;
  - mapowanie trybów i parsowanie ustawień.
- `npm run test:grovshot2`:
  - LXE1–11 — pełny silnik z mockiem Nano Banana: 5 ujęć równolegle z odpowiedziami w innej kolejności, przypisanie obrazów do ujęć, `stage_checks`, serializacja wejścia adaptera, koszt (5 wywołań i 5 opłat), idempotencja, tryb auto bez zmian, `exact_admin`, blokada innego wariantu, obraz pośredni i finalny;
  - L34b — Exact Replay odtwarza request ujęcia źródłowego (ten sam prompt, SHA, zdjęcia i bajty, zero wywołań Claude).
- Brakujący lub zmieniony plik (`reference_changed`), nieczytelny odczyt (`unreadable`) i ponowienia pokrywają istniejące testy E/L.

## Wdrożenie i wycofanie

- Migracja `0185_grovshot_exact_references_admin.sql` ustawia `prompt.references = "exact_admin"`.
- Wycofanie: ustawić „Automatyczny dobór (obecny)” w panelu albo przywrócić `auto` w SQL.
- Kod jest wstecznie zgodny: brak klucza oznacza `auto`.
