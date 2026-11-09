# QA — GrovBase Rolka #1 „Google Grafika i prawa do zdjęć”

Plik: `out/GrovBase_Rolka_01_Google_Prawa_1080x1920.mp4` (render: `npm run render`, data: 2026-11-09).
Wszystkie liczby poniżej pochodzą z `ffprobe` / `ffmpeg` uruchomionych na gotowym pliku.

## 1. Parametry pliku (ffprobe)

```
Video  : h264 (High, level 5.0) · 1080×1920 · SAR 1:1 · DAR 9:16 · yuv420p · color_range tv
         color_space/primaries/transfer = bt709 · 30/1 fps (r_frame_rate = avg_frame_rate = 30/1)
         nb_frames 1650 · duration 55.000 s · ~4.40 Mb/s (CRF 17, x264 preset slow)
Audio  : aac (LC) · 48000 Hz · stereo · 320 kb/s · duration 55.018 s
Format : mp4 · duration 55.018 s · 32 532 436 B
Atoms  : ftyp, moov, free, mdat  → moov przed mdat (faststart ✔)
```
Rozdzielczość jest faktyczna (1080×1920 w strumieniu), nie tylko w nazwie pliku.

## 2. Lektor

- Źródło: `public/audio/voice_1.2x.mp3` — bajtowo identyczny z `audio/voice_1.2x.mp3` z paczki (`cmp`),
  54,648 s, 44,1 kHz mono. Bez ponownego przyspieszania, pitch-shiftu i cięcia.
- W miksie: przesunięcie względem obrazu **0 próbek** (korelacja miks↔lektor), lektor obecny w każdym
  5-sekundowym odcinku (korelacja 0,79–0,96 przy muzyce i SFX), wszystkie 139 słów transkrypcji.
- Synchronizacja: znaczniki słów = Whisper (small, MIT) + dociągnięcie do ciszy z waveformu (RMS 10 ms).
  Zgodność z kotwicami paczki:

| Segment | Kotwica paczki | Zmierzone słowa | Tekst |
|---|---|---|---|
| HOOK_3Z | 0.00–4.69 | 0.00–4.71 | „Znalazłeś … kosztować!” |
| GOOGLE_TYLKO_WYSZUKUJE | 5.11–6.95 | 5.10–6.97 | „Google … zdjęcia.” |
| RYZYKO_STRONA_SKLEP_SOCIAL | 7.34–11.86 | 7.33–11.87 | „To … mediach.” |
| ZWROT_UWAGA | 12.37–12.82 | 12.36–12.83 | „I … uwaga.” |
| EDYCJA_NIE_DAJE_PRAW | 13.19–19.60 | 13.18–19.62 | „Nawet … prawa.” |
| JAK_SPRAWDZIC | 20.13–20.83 | 20.13–20.85 | „Jak … sprawdzić?” |
| GOOGLE_UI_KROKI | 21.37–25.86 | 21.36–25.88 | „Wejdź … użytkowania.” |
| LICENCJA_U_ZRODLA | 26.19–32.17 | 26.20–32.18 | „Pamiętaj … komercyjnie.” |
| TRZY_NARZEDZIA_AI | 32.50–40.15 | 32.50–40.17 | „A … produktowych.” |
| PRAWA_MATERIALOW_WEJSCIOWYCH | 40.49–46.21 | 40.49–46.22 | „Pamiętaj … narzędzi.” |
| CTA_ZAPISZ | 46.66–49.39 | 46.67–49.40 | „Zapisz … błędu!” |
| CTA_A_TY | 49.72–50.01 | 49.72–50.03 | „A … ty?” |
| CTA_KOMENTARZE | 50.45–54.65 | 50.46–54.44 | „Sprawdzałeś … Google?” |

Długość filmu 55,000 s = lektor 54,648 s + 0,35 s domknięcia dźwięku (ostatnia sylaba kończy się w 54,44 s).

## 3. Muzyka i SFX — prawa

- **Oryginalna kompozycja** wygenerowana w tym projekcie (`scripts/compose_audio.py`): 128 BPM, F-moll,
  electro/breakbeat, synteza od zera (bez sampli, bez imitowania istniejących utworów). 21 SFX również
  syntezowanych. Można publikować w social media i reklamach — nie ma tu cudzego materiału.
- Ducking: sidechain sterowany obwiednią lektora (atak 15 ms, release 320 ms, do −8 dB); muzyka ok. 11,5 dB
  poniżej lektora przed duckingiem. Aranż na cue lektora: stop na „I uwaga.”, breakdown na „Jak to sprawdzić?”,
  podniesienie na narzędziach AI, przerwa na „A ty?”, akord końcowy na ostatniej sylabie.
- Mastering (`scripts/master.sh`): kompresja mowy 3:1 + limiter look-ahead z kompensacją opóźnienia
  (przesunięcie A/V = 0 próbek), redukcja limitera maks. ~1,6 dB.

```
EBU R128 (plik końcowy): I = −14.0 LUFS · LRA = 3.1 LU · true peak = −1.5 dBTP
Lektor w pliku końcowym: przesunięcie względem obrazu 0 ms (korelacja krzyżowa, 48 kHz)
Cisza < −50 dB dłuższa niż 0,4 s: brak
```

## 4. Obraz — kontrola

- `blackdetect` (d ≥ 0,10 s): **brak** pustych/czarnych klatek. `freezedetect` (≥ 0,25 s): **brak** zamrożeń;
  najdłuższy prawie statyczny odcinek: 4 klatki (0,13 s).
- Przejrzane kadry (z gotowego MP4): 0,0 · 0,5 · 1,13 · 1,7 · 2,7 · 4,6 · 5,2 · 6,3 · 7,9 · 9,95 · 10,6 · 11,25 ·
  12,45 · 13,1 · 14,3 · 15,5 · 16,8 · 18,3 · 19,8 · 20,4 · 21,0 · 21,9 · 23,4 · 25,1 · 25,7 · 26,4 · 26,9 · 27,25 ·
  28,6 · 31,7 · 32,6 · 33,6 · 35,0 · 36,0 · 37,6 · 38,9 · 39,9 · 40,4 · 41,1 · 43,6 · 44,1 · 45,8 · 46,4 · 46,9 ·
  48,5 · 49,6 · 49,9 · 50,6 · 52,4 · 54,95 s — początek, wszystkie przejścia, czytelność licencji, zakończenie.
- Szybkie przejazdy kamery (whip) mają kinowy motion blur (4–12 próbek, migawka 180°) — w ruchu nie ma
  „przeskoków” wyglądających jak cięcie; największe skoki obrazu to zamierzony impuls „I uwaga.” (12,37 s).
- Strefy bezpieczne (kompozycja QA `GrovBaseRolka01-SafeZones`): napisy w pasie 1470–1630 px (dolna granica
  1670 px), nagłówki/HUD od 196 px w dół, wszystkie teksty ≥ 90 px od boków. Napisy nie nachodzą na karty CTA.
- **Test stabilności renderu**: film wyrenderowano dwukrotnie z różną współbieżnością (4 i 3 karty Chrome)
  i porównano 1650 klatek: 0 klatek z różnicą treści (maks. obszar pikseli różniących się o > 40/255: 0,001 %,
  czyli szum kodeka). Wcześniejsza wersja miała sporadyczne „duchy” nakładek (artefakt kompozytora headless
  Chrome) — usunięte: render `--gl=swiftshader`, brak trybów mieszania i `backdrop-filter`, warstwy ekranowe
  budowane od nowa co klatkę, 3 klatki animacji na ustabilizowanie przed zrzutem.

## 5. Treść merytoryczna (checklista z 00_START_PROMPT)

- [x] Pierwsze 3 s: akcja Google Grafika → chwyt miniatury kursorem → drag na stronę WWW → czerwona ramka,
      ⚠ i „UWAŻAJ!” dokładnie na słowie „Uważaj” (1,67 s), „PRAWA AUTORSKIE?” na „wykorzystanie” (2,60 s).
      Glitch tylko w momencie alarmu (1,65–1,99 s). Pytajnik — ryzyko nie jest przedstawione jako przesądzone.
- [x] „WYSZUKIWARKA ≠ LICENCJA” na „Google tylko wyszukuje zdjęcia” — miniatury odczepiają się od wyszukiwarki.
- [x] Ta sama karta zdjęcia przechodzi przez WWW → sklep → social (lądowania na słowach „stronie”, „sklepie”, „social”).
- [x] „I uwaga.” — impuls, zbliżenie, krótkie zatrzymanie kadru + stop muzyki.
- [x] Jedna karta dzieli się na kadrowanie / usunięcie tła / przeróbkę AI (na tym samym rysunku), na każdej
      „TO NIE NADAJE PRAW” — bez sugestii, że edycja „kasuje” prawa.
- [x] Karta obraca się w interfejs wyszukiwarki; ścieżka: **Grafika → Narzędzia → Prawa użytkowania**
      (HUD 1-2-3 + kursor na każdej kontrolce), opcje: Wszystkie / Licencje Creative Commons /
      Licencje komercyjne i inne. Komunikat „To filtr wyników, nie gwarancja praw.”
- [x] Widoki Google = schemat edukacyjny z widoczną notką „Schemat edukacyjny — układ opcji może się różnić”;
      logo Google nie jest odtwarzane (zwykły krój jak w schemacie z paczki); brak fikcyjnego przycisku „darmowe”.
- [x] „Szczegóły licencji” → strona źródłowa z tym samym zdjęciem: autor, licencja, komercyjnie, modyfikacje,
      atrybucja; „Warunki licencji są decydujące”; akcent na „komercyjnie”.
- [x] ChatGPT, Gemini, GrovBase na równych kartach (nazwy tekstem; GrovBase = oryginalne logo z `assets/brand`,
      stała proporcja 3256:706). Finał przechodzi w różowo-białe logo GrovBase. GrovBase pojawia się dopiero,
      gdy lektor je wymienia (37,47 s).
- [x] Materiały wejściowe: własne zdjęcie ✓, z licencją ✓, nieznane źródło ✕; „Warunki korzystania z narzędzia”
      — bez obiecywania automatycznych praw od AI.
- [x] CTA: zakładka 3D z pulsem na „Zapisz”, „A TY?” z przybliżeniem, dwie odpowiedzi A/B + komentarz 2.5D;
      świat z wszystkimi scenami dryfuje w tle (karty pozostają w ruchu). Brak CTA spoza lektora.
- [x] Pisownia: Google, ChatGPT, Gemini, GrovBase; pełne polskie diakrytyki (Inter / Space Grotesk).
- [x] Napisy = tekst lektora 1:1 (139 słów), podświetlanie słowo po słowie z prawdziwych czasów.
- [x] Filmy referencyjne nie są użyte w materiale (tylko analiza tempa/choreografii).

## 6. Uwagi techniczne / znane ograniczenia

- Widoki Google to edukacyjne schematy (zgodne z Google Search Help: Grafika → Narzędzia → Prawa użytkowania),
  nie zrzut ekranu — oznaczone w kadrze. Rzeczywisty układ może się różnić między urządzeniami.
- Czasy słów: Whisper + waveform, dokładność ok. ±30–50 ms; granice fraz dociągnięte do ciszy (10 ms).
- Muzyka nie była dostarczona w paczce — skomponowano oryginalną (patrz pkt 3). Osobna wersja bez muzyki:
  kompozycja `GrovBaseRolka01-NoMusic`.
- Render w tym środowisku: Chrome Headless Shell z Playwright (`--browser-executable`), bo serwer pobierania
  Remotion był niedostępny. Na innej maszynie wystarczy `npm run render`.
- Plik `music_ducked.wav` (24-bit) jest częścią projektu; `music_raw.wav` odtwarza `npm run compose:audio`.
