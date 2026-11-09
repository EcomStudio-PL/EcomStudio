# Raport QA — GrovBase Rolka #2 „Bezpieczne screeny”

Plik: `GrovBase_Rolka_02_Bezpieczne_Screeny_1080x1920.mp4`

## 1. Parametry techniczne (ffprobe na pliku finalnym)

| Parametr | Wynik | Wymóg |
|---|---|---|
| Rozdzielczość | **1080 × 1920** | 1080 × 1920 ✅ |
| Klatkaż | **30/1**, 1368 klatek | 30 FPS ✅ |
| Wideo | H.264 High@4.0, **yuv420p**, BT.709 (primaries/transfer/matrix), tv range | H.264, yuv420p, SDR Rec.709 ✅ |
| Audio | AAC, **48 kHz**, stereo, 320 kb/s | AAC 48 kHz ✅ |
| Czas | **45,61 s** (głos 45,384 s + 0,2 s wybrzmienia) | ≥ długość MP3, bez outro ✅ |
| Głośność | **−14,0 LUFS** zintegrowane, **true peak −1,7 dBTP**, LRA 3,0 LU | szczyty < 0 dBFS ✅ |
| `faststart` | tak (moov na początku) | iPhone / Reels / TikTok ✅ |

## 2. Audio i synchronizacja

- Użyto wyłącznie `voice_final_spedup.mp3`, odtwarzanego 1:1 (bez `playbackRate`, `atempo`, cięć).
- **Brak dryfu**: korelacja finalnej ścieżki z plikiem głosu w oknach 0,5 s / 15,5 s / 30 s / 43,2 s
  daje stałe przesunięcie −1,5 ms (opóźnienie kodeka AAC) — identyczne na początku i na końcu.
- Głos ~15 dB (RMS) nad muzyką+SFX w trakcie mowy; muzyka dyskretna, ducking bez pompowania
  (obwiednia mowy wygładzona oknem ~0,4 s).
- Mastering całego miksu: łagodna kompresja → wzmocnienie → limiter (`scripts/render.sh`).
  Zmienia tylko poziom, nie czas — zdania lektora są kompletne.
- Hook 3Z w pierwszych 3 s: obraz (marker rysuje się od klatki 0) + hasło („ZAMAZUJESZ DANE NA
  SCREENACH?” od klatki 0) + głos + dźwięk (swipe markera w klatce 0, alarm na „Uważaj”).

### Mapa scen wg realnej mowy (zmierzone na pliku MP3)

| Czas | Fraza | Obraz |
|---|---|---|
| 0,00–1,44 | Zamazujesz dane na skrinach? | telefon pod kątem, marker od klatki 0, skan kontrastu odsłania cyfry |
| 1,67–4,70 | Uważaj… całemu internetowi! | przelot kamery przez cyfrę → „ZAMAZANE ≠ BEZPIECZNE” → zrzut kopiuje się w sieć |
| 4,90–10,08 | Wyobraź sobie… czarnym markerem. | kopie składają telefon, rozmowa się przewija, zrzut ekranu, gest rysuje marker |
| 10,33–12,97 | Myślisz… Niekoniecznie! | „BEZPIECZNE?” za bryłą telefonu, marker odwraca się w kartę „NIEKONIECZNIE!”, pauza wizualna |
| 13,40–20,36 | Niektóre markery… widoczny! | rozsunięte warstwy (tekst / marker 78%), suwaki JASNOŚĆ i KONTRAST, split PRZED/PO, „MARKER ≠ USUNIĘCIE DANYCH” |
| 20,63–25,28 | Dotyczy to… bankowych. | elementy rozmowy odrywają się po łukach w 5 kart (każda na swoim słowie) |
| 25,57–26,32 | Jak tego uniknąć? | karty zbiegają się (smugi), błysk fuksji, rodzą się przyciski „100% ZAKRYJ” / „WYKADRUJ” |
| 26,62–32,20 | Zamiast zwykłego markera… zakryje dane. | przycisk rozrasta się w telefon, pędzel prostuje się w prostokąt, krycie 78%→100%, check |
| 32,50–35,54 | Możesz też… pokazywać. | kamera jedzie po krawędzi prostokąta, rogi kadru rosną z ramki pola, pasek z numerem odpada |
| 35,85–39,91 | Na koniec sprawdź… nic nie prześwituje. | dwa spłaszczone pliki, lupa z JASNOŚĆ+KONTRAST: MAX, checki, ZAKRYJ / WYKADRUJ / SPRAWDŹ |
| 40,10–42,40 | Zapisz tę rolkę… | check → zakładka, flip 3D do karty-porady z logo GrovBase |
| 42,62–45,07 | A Ty? Też wcześniej… | karta przepływa w dymek „A TY? ZAKRYWASZ DANE MARKEREM?”, pusty dymek komentarza |

Uwaga: `timing/sceny_czasowe.json` z paczki odbiega od nagrania od ok. 20 s (np. „Jak tego
uniknąć?” realnie 25,57 s zamiast 24,05 s) — montaż oparto na realnej mowie, zgodnie ze specyfikacją.

## 3. Klatki kontrolne (0,5 / 1,5 / 3 / 6 / 11 / 15 / 19 / 23 / 27 / 32 / 37 / 41 / 44 s)

Sprawdzone w 1080 × 1920 i po pomniejszeniu do 360 × 640 (`qa/`): napisy czytelne w 360 × 640,
brak uciętych liter i polskich znaków (Ó Ł Ą Ę Ś Ż Ź Ć), kluczowy tekst w x = 100…980, brak
kluczowych akcji w górnych/dolnych 260 px (tam tylko dyskretne logo). Ruch: wszystkie animacje z
`useCurrentFrame` + `interpolate`/`spring`, brak animacji zależnych od czasu przeglądarki.

## 4. Merytoryka i bezpieczeństwo

- Ujawnianie cyfr to realny filtr jasności/kontrastu na pikselach zrzutu z warstwą markera o kryciu
  < 1 (78%) — z dopiskiem „w niektórych przypadkach · dane fikcyjne”.
- Ten sam filtr (lupa) na prostokącie 100% i na krawędzi kadru niczego nie ujawnia — film nie
  sugeruje odzyskiwania danych spod pełnego zakrycia.
- Prostokąt nie jest nigdy „zdejmowany”: alternatywa (kadrowanie) startuje na świeżej kopii
  oryginalnego zrzutu, a wynik zakrycia odjeżdża jako osobny plik.
- Kadrowanie = faktyczne usunięcie paska z pliku (obraz wynikowy jest krótszy).
- Eksport opisany jako spłaszczony PNG/JPG; nie obiecujemy „100% ochrony w każdej sytuacji”.
- Tylko dane fikcyjne; UI komunikatora i panel edycji generyczne; brak fałszywych komentarzy i liczników.
- Napisy: „screen/screenshot/zrzut ekranu” (w głosie „skrin”).

## 5. Ograniczenia, o których warto wiedzieć

- Granice słów wyznaczono z analizy ciszy i mikropauz + liczby sylab (brak modelu ASR offline);
  zgodność potwierdzona na klatkach, ale nie jest to wyrównanie słowo-po-słowie z rozpoznawania mowy.
- Zamiast kosztownego motion blur użyto smug prędkości (velocity trails) przy szybkich przejściach.
