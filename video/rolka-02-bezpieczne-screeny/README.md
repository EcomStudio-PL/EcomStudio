# GrovBase — Rolka #2 „Bezpieczne screeny” (Remotion)

Edukacyjna rolka 9:16 o bezpiecznym zakrywaniu danych na zrzutach ekranu.
**1080 × 1920 · 30 FPS · 45,6 s (1368 klatek) · H.264 yuv420p / AAC 48 kHz · Rec.709.**

## Uruchomienie

```bash
npm install
npm run studio            # podgląd i edycja w Remotion Studio (kompozycja: GrovBaseRolka02)
bash scripts/render.sh    # pełny render + mastering głośności + ffprobe → out/
```

W środowisku bez dostępu do CDN Chrome-for-Testing wskaż lokalny `chrome-headless-shell`:
`REMOTION_BROWSER=/ścieżka/do/chrome-headless-shell bash scripts/render.sh`.

Podgląd pojedynczych klatek (QA): `node scripts/stills.mjs <katalog> 0.5 0 150 300 …` i
`python3 scripts/sheet.py <katalog> sheet.jpg` (arkusz kontaktowy).

## Audio — oś montażu

- `public/audio/voice_final_spedup.mp3` (45,384 s) — odtwarzany **1:1**: bez `playbackRate`,
  `atempo`, `timeStretch`, `silenceremove` i bez cięcia zdań.
- Granice fraz i akcenty słów zmierzono na tym pliku (`ffmpeg silencedetect`, −38 dB/0,12 s dla
  fraz i −30 dB/0,05 s dla mikropauz) — wyniki w `src/timing.ts` (`PHRASES`, `CUE`).
  Uwaga: `timing/sceny_czasowe.json` z paczki jest orientacyjny — np. „Jak tego uniknąć?” pada
  realnie w 25,57 s (JSON: 24,05 s), a „Zamiast zwykłego markera” w 26,62 s (JSON: 25,58 s).
- Muzyka: `music_original_minimal_tech.mp3` z paczki, ducking pod głosem (wygładzona obwiednia
  mowy z mapy fraz, ok. −9 dB pod mową), lekki swell w wybrzmieniu.
- SFX: 4 oryginalne dźwięki z paczki zsynchronizowane z akcjami (pociągnięcie markera, alarm,
  zrzut ekranu, suwaki, check, cięcie kadru, flip CTA) — `src/audio/Soundtrack.tsx`.
- Mastering (`scripts/render.sh`): łagodna kompresja + dwuprzebiegowy `loudnorm` całego miksu do
  −14 LUFS / −1,5 dBTP. To wyłącznie wzmocnienie i limiter — czas głosu nie jest zmieniany.

## Struktura

| Plik | Rola |
|---|---|
| `src/timing.ts` | mapa fraz lektora i klatki akcentów (jedno źródło prawdy dla synchronizacji) |
| `src/phoneTrack.ts` | jedna ciągła choreografia telefonu (kamera 2.5D, stany ekranu, marker, filtr, kadrowanie) |
| `src/components/ScreenSVG.tsx` | zrzut ekranu złożony z osobnych warstw SVG z paczki (`01`, `02`, `04`) |
| `src/components/Phone.tsx` | telefon jako obiekt 3D: korpus, ekran, filtr jasności/kontrastu, warstwa markera w eksplozji, karta „NIEKONIECZNIE!”, kadrowanie, narzędzia |
| `src/components/Kinetic.tsx` | kinetyczna typografia (maskowane słowa zsynchronizowane z głosem), chipy, geometryczny „≠” |
| `src/components/Background.tsx` | żywe tło (światła, podłoga perspektywiczna, pył), winieta, ziarno, logo |
| `src/scenes/*` | nakładki scen 01–11 |
| `public/pack/` | oryginalne SVG z paczki (źródła warstw) |

## Rzetelność merytoryczna

- Demo kontrastu to **prawdziwy filtr CSS** `brightness()/contrast()` nałożony na wyrenderowane
  piksele zrzutu z warstwą markera o kryciu 78% — cyfry pojawiają się tylko dlatego, że nadal są w
  pikselach. Ten sam filtr na prostokącie 100% (lupa w scenie kontroli) nie ujawnia niczego.
- Kadrowanie jest pokazane jako faktyczne usunięcie paska obrazu z pliku (pasek odpada,
  wynikowy obraz jest krótszy), a nie jako ramka-maska.
- Wszystkie dane są fikcyjne (`000 000 000`, `demo@example.com`, `Klient testowy`,
  `ul. Przykładowa 1`, `Dane testowe`); UI komunikatora i panel edycji są generyczne.
