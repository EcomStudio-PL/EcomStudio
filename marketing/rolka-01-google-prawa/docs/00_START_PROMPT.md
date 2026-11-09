# GROVBASE | ROLKA #1 — GOOGLE GRAFIKA / PRAWA AUTORSKIE
## MASTER PRODUKCJA CLAUDE CODE + REMOTION

**TRYB:** realizuj od początku do końca po rozpakowaniu ZIP. Przygotuj gotowy projekt Remotion, wyrenderuj MP4 1080×1920, 30 FPS i wykonaj kontrolę jakości. Nie pytaj o kolejne materiały, wszystkie wymagane wizualizacje są załączone. Nie kończ na planie czy samym kodzie.

### 0. Zasady nadrzędne

1. **Jedyne źródło lektora:** `audio/voice_1.2x.mp3`. Jest już przetworzony i trwa 54.65 sekundy. NIE wykonuj drugiego przyspieszenia, pitch-shiftu ani ponownego przycinania zdań.
2. Oryginalne MP3 tylko do weryfikacji. Tekst **bez skrótów** w `docs/transkrypcja_lektora.txt`. Obrazy, napisy i muzykę dopasuj do głosu, nigdy odwrotnie.
3. `timing/sceny_czasowe.json` zawiera kotwice scen bazujące na przerwach i długości audio. Najpierw nałóż dokładny waveform i odsłuchaj, a następnie dopasuj cięcia na poziomie pojedynczych słów. Końcowy film: około 54.65 s (jeśli potrzebne maksymalnie ~0.5s domknięcia dźwięku bez opóźniania końcowego pytania).
4. **To jest edukacyjna rolka o prawach do zdjęć**, nie bezpośrednia reklama Retuszu AI. GrovBase pojawia się dopiero w miejscu zgodnym z lektorem, obok ChatGPT i Gemini. Nie dodawaj nieistniejących funkcji ani promocyjnego CTA, którego nie ma w głosie.
5. Styl: nasze PREMIUM GrovBase + standard PhoenixSpace, **zaawansowany spatial motion design**, nie Canva ani statyczny slideshow.
6. Format 9:16 1080×1920, 30 FPS, H.264, AAC, Rec.709; eksport dokładnie w faktycznej rozdzielczości, **bez pozornego 1080p w nazwie pliku**.
7. Nie korzystaj z obrazów zdjętych z Google bez praw. Wszystkie zdjęcia w demonstracji to nasze oryginalne rysunki wektorowe.

### 1. HOOK 3Z — pierwsze 3 sekundy

**Zaadresuj:** osoba prowadząca stronę, sklep lub social media, która pobiera fotografie z Google.
**Złam oczekiwanie:** „w Google = można wykorzystać” okazuje się błędem; ryzyko może być kosztowne.
**Zgraj:** 4 elementy naraz — obraz Google → przeciągnięcie zdjęcia → e-sklep; na słowie „uważaj” pojawia się sygnał ryzyka; głos 1,2×; konkretny SFX.

**Wizual:** zaczynamy od AKCJI, nie pustego logo ani tekstu. Duże okno przeglądarki w przestrzeni (perspectiveZ, depth), widoczne wyniki zdjęć. Kursorem chwytamy jedno zdjęcie (nasz rysunek wazonu), przenosimy do strony WWW. Zrzut przechodzi w 2.5D ekran e-commerce, a kamera zatrzymuje się na czerwonej ramce potencjalnego ryzyka. Krótkie „PRAWA AUTORSKIE?” / „UWAŻAJ!” — we właściwym momencie wypowiedzi. Nie przedstawiaj naruszenia jako przesądzonego w każdej sytuacji.

### 2. KADRY I NARRACJA

Ważne: poszczególne segmenty mają zachodzić na siebie wizualnie przez przejścia dziedziczące obiekty. **Nie** zamieniaj ich w nieruchome plansze. Dokładne kotwice: `timing/sceny_czasowe.json`.

| Kotwica po obróbce | Blok | Kompozycja i ruch |
|---|---|---|
| 0.00–4.69s | HOOK_3Z | Sekwencja Google Grafika → miniatura → drag do strony WWW → czerwone ostrzeżenie; glitch tylko w momencie alarmu |
| 5.11–6.95s | GOOGLE_TYLKO_WYSZUKUJE | Wirtualna kamera oddala się od wyników; miniatury odczepiają się od wyszukiwarki; podpis „WYSZUKIWARKA ≠ LICENCJA” |
| 7.34–11.86s | RYZYKO_STRONA_SKLEP_SOCIAL | Ta sama karta zdjęcia przechodzi przez trzy środowiska demonstracyjne: WWW / sklep / social |
| 12.37–12.82s | ZWROT_UWAGA | Krótki impuls, zbliżenie i zatrzymanie w locie kadru (0.1–0.2s), bez pustej planszy |
| 13.19–19.60s | EDYCJA_NIE_DAJE_PRAW | Jedna karta dzieli się w 3 formy: kadrowanie, usunięcie tła, edycja AI; na każdej nakładka „TO NIE NADAJE PRAW” |
| 20.13–20.83s | JAK_SPRAWDZIC | Karta zdjęcia obraca się w interfejs wyszukiwarki; marker/cursor podążający do opcji |
| 21.37–25.86s | GOOGLE_UI_KROKI | Weryfikowany schemat: Google Grafika → Narzędzia → Prawa użytkowania; kamera na każdą kontrolkę |
| 26.19–32.17s | LICENCJA_U_ZRODLA | Z menu filtrów przejście do karty źródła: autor, licencja, wykorzystanie komercyjne, modyfikacje, atrybucja |
| 32.50–40.15s | TRZY_NARZEDZIA_AI | Trzy spójne przestrzenne karty ChatGPT / Gemini / GrovBase; finał przechodzi w różowo-białe logo GrovBase |
| 40.49–46.21s | PRAWA_MATERIALOW_WEJSCIOWYCH | Ujęcie wejściowych grafik → potwierdzone prawa + checklist licencji/narzędzia; bez obiecywania automatycznych praw od AI |
| 46.66–49.39s | CTA_ZAPISZ | Dynamiczny bookmark w przestrzeni, puls na słowie ZAPISZ; końcowe karty pozostają w ruchu |
| 49.72–50.01s | CTA_A_TY | Kamera robi krótkie przybliżenie w pytanie |
| 50.45–54.65s | CTA_KOMENTARZE | Dwie opcje odpowiedzi na karty, komentarz jako obiekt 2.5D, koniec CTA w bezpiecznej strefie |

**Łączenie scen:** zdjęcie w pierwszym oknie pozostaje TYM SAMYM obiektem w witrynie, sklepie, social mediach, panelu edycji i w oknie licencji. Kamera przemieszcza się po jednej kompozycji, nie skacze między pełnymi screenami. Można używać obiektów React, CSS 3D transforms, Remotion spring, @remotion/paths, SVG masks i React Three Fiber gdy rzeczywiście potrzebne.

**Sekwencja prawa użytkowania:** dane Google należy pokazać poprawnie zgodnie z dostarczonymi schematami: najpierw Google Grafika, potem `Narzędzia`, potem `Prawa użytkowania`. Podkreśl, że filtr wyświetla obrazy z informacją licencyjną, nie przyznaje licencji. Następnie widz otwiera szczegóły licencji i **weryfikuje je na stronie źródłowej**. Uważaj: układ interfejsu może różnić się między urządzeniami. Nie przedstawiaj mockupu jako screen recordingu ani nie dodawaj fikcyjnego przycisku „darmowe do użycia”.

**Prawa autorskie:** nie twórz komunikatów sugerujących, że przycięcie, usunięcie tła lub AI „kasują prawa”. Zaznacz, że prawa mogą być udzielone na licencji, a w niektórych sytuacjach obowiązują ustawowe wyjątki. Zgodnie z lektorem nie robimy wykładu prawnego.

**ChatGPT / Gemini / GrovBase:** przedstaw trzy narzędzia na równych, eleganckich kartach. Nie sugeruj, że każde generuje treści automatycznie wolne od ograniczeń prawnych. W sekcji GrovBase użyj ORYGINALNEGO logo z `assets/brand`, bez jego odtwarzania. Na wszystkich ekranach poprawna pisownia: Google, ChatGPT, Gemini, GrovBase.

### 3. SZCZEGÓŁOWE WYMAGANIA MOTION DESIGN

- 1 świat w 2.5D: przeglądarka, fotografie, oferta, okno edycji, licencja, narzędzia, CTA są elementami powiązanymi przestrzennie. Długie płynne arc/whip movements, z kontrolowanym przyspieszeniem i spowolnieniem. Nie przesadzaj z obrotami.
- Co ~0.5–1.5 s dzieje się drobna intencjonalna akcja: wymiana stanu, focus, animowany podpis, pointer, zmiana scale, podział karty, subtelny parallax. Nie znaczy to nowych cięć co 1 sekundę.
- Karty powinny być komponowane z oddzielnych warstw. Nie przesuwaj tylko całych PNG przez ekran.
- Kinetic typography: animacje całych fraz, wyraźne hierarchie, podkreślenie słów „UWAŻAJ”, „PRAWA UŻYTKOWANIA”, „SPRAWDŹ LICENCJĘ”, „ZAPISZ”. Tekst może wchodzić maską, rotacją 2.5D lub morphingiem layoutu; **czytelność > ilość efektów**.
- Ruch elementów i shape transitions powinny być płynnie łączone, nie poprzez nieprzemyślane jump-cut. Każdy obiekt wchodzi i wychodzi w kierunku spójnym z ruchem kamery.
- Zbuduj logiczne prowadzenie wzroku, zwłaszcza w 3Z. Obraz ma pokazywać sens zdania, a nie tylko powtarzać treść lektora napisami.
- Nie ma potrzeby kopiowania konkretnych kadrów z filmów referencyjnych. Analizuj tempo, choreografię, głębię i flow; **nie używaj fragmentów oryginalnych filmów w finalnym materiale**.
- Tło: głęboki granat/czerń, subtelny glow, eleganckie światło i gradienty, GrovBase `#D628CF`, `#F950E1` jako akcenty. Czerwony alarm na prawa autorskie. Nie zalewaj filmu neonem.

### 4. NAPISY

- Napisy dynamiczne z kluczowymi słowami (word/phrase highlights), w języku polskim, z poprawnymi diakrytykami.
- Nie zmieniaj wypowiadanego tekstu w podpisach treściowych. Dopuszczalne krótkie hasła wizualne i etykiety, które nie zmieniają znaczenia.
- Korzystaj z precyzyjnych znaczników czasu na bazie realnego MP3 i waveform, nie z podziału czasu proporcjonalnie do liczby zdań.
- Użyj fontu dostępnego w projekcie wspierającego ą ć ę ł ń ó ś ź ż.
- Safe zones: istotne teksty nie bliżej niż 90 px od boków, 250 px od dołu i 170 px od góry (rekomendacja konserwatywna, dopasuj do UI). Do not overlap subtitles with CTA.

### 5. MUZYKA / SFX

- Dynamika premium SaaS / digital education: nowoczesny electro / breakbeat 125–140 BPM, energiczny puls bez spokojnego intro, ale NIE zagłuszaj voiceover.
- Lektor pierwszoplanowy. Sidechain / ducking muzyki lub automatyzacja głośności, delikatne transienty. Dźwięki kliknięć, przesuwania, ostrzeżenia, UI wybierania praw użytkowania i finalnego bookmarku.
- Stosuj WYŁĄCZNIE muzykę i efekty z potwierdzonymi prawami do publikacji w social media i reklamy, albo oryginalnie skomponowane w ramach realizacji, bez imitowania znanych utworów. Jeżeli nie ma muzyki licencjonowanej, wyeksportuj wersję z lektorem/SFX i wyraźnie zaznacz brak muzyki zamiast podkładać nielegalny utwór.
- Dźwięki pojawiają się pod konkretnymi ruchami. Oszczędne SFX, nie spamuj whooshami.

### 6. PRZEBIEG PRACY CLAUDE CODE

1. Rozpakuj paczkę i sprawdź pliki. Użyj `audio/voice_1.2x.mp3` bez dodatkowej obróbki. Przeczytaj README, transkrypcję i JSON czasu.
2. Przejrzyj 3 filmy referencyjne **tylko do inspiracji**.
3. Zainicjuj projekt React + Remotion, sprawdź zależności i komponenty. Rozdziel dane scen i reżyserię od warstw wizualnych.
4. Najpierw zaimplementuj 0–8 s z prawdziwą interakcją Google → ryzyko → kontynuacja ruchu, wyrenderuj krótki segment do wewnętrznej kontroli *w rzeczywistym 1080 × 1920*.
5. Następnie dokończ resztę scen z wykorzystaniem gotowych PNG/SVG, z prawdziwą synchronizacją do lektora. Nie skupiaj się na przesadnych testach kodu bez renderowania klatek.
6. Przygotuj podgląd pełny 1080×1920 30 FPS. Obejrzyj kluczowe przejścia i popraw kolizje i pauzy, nie generuj niepotrzebnych kilkunastu wersji.
7. Finalny render MP4 H.264 High, yuv420p, AAC 48k, faststart. Ustaw sensowną jakość, np. CRF 17–19. Zweryfikuj przez ffprobe prawdziwą rozdzielczość, FPS i długość.
8. Sprawdź początek, okolice przejść, czytelność licencji, poprawną pisownię i zakończenie. Dostarcz MP4, edytowalny projekt i notatkę QA.

### 7. OBOWIĄZKOWE KRYTERIA AKCEPTACJI

- Pełny lektor bez pominięcia zdań. Finalny plik MP3 jest w paczce i słychać naturalny głos bez piskliwości.
- Przez pierwsze 3 sekundy widać akcję Google → reuse / warning, a nie tylko statyczny napis.
- Właściwe ostrzeżenie: pobranie / przeróbka przez AI **nie zapewniają same w sobie praw**.
- Rzeczywista ścieżka Google Grafika → Narzędzia → Prawa użytkowania, następnie kontrola licencji u źródła.
- Wszystkie trzy nazwy narzędzi pisane poprawnie.
- Ekspresyjny premium motion, ciągłość obiektów, żadnych przeskoków w połowie przejść, brak ekranu pustego przez >0.15s.
- Safe area, brak obciętych napisów; źródłowy logo bez deformacji; legalnie użyta muzyka.
- MP4 faktycznie 1080×1920, 30 FPS; projekt gotowy do późniejszej edycji.

### 8. PLIKI WYJŚCIOWE

`out/GrovBase_Rolka_01_Google_Prawa_1080x1920.mp4` + kompletny folder Remotion / ZIP + raport `QA.md` z prawdziwymi parametrami ffprobe. Nie twórz nieistniejących ścieżek i nie twierdź, że wykonano render, jeśli nie istnieje.

**URUCHOM PRODUKCJĘ.** Bez pytań, bez wymagania nowych materiałów i bez oddawania samej koncepcji.
