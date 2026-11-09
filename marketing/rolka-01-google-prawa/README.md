# GrovBase — Rolka #1: Google Grafika i prawa do zdjęć (Remotion)

Edytowalny projekt rolki edukacyjnej 9:16 (1080 × 1920, 30 fps, 55,0 s). Lektor: `public/audio/voice_1.2x.mp3`
z paczki produkcyjnej — **bez żadnej obróbki** (bez ponownego przyspieszania, pitch-shiftu i cięcia zdań).

## Uruchomienie

```bash
npm install
npm run studio          # podgląd i edycja w Remotion Studio
npm run render          # render + mastering → out/GrovBase_Rolka_01_Google_Prawa_1080x1920.mp4
```

Na maszynie bez dostępu do `remotion.media` dodaj do `render:raw` flagę
`--browser-executable=/ścieżka/do/chrome-headless-shell` (Remotion pobiera stamtąd Chrome).

Kompozycje: `GrovBaseRolka01` (finał), w folderze **QA**: `GrovBaseRolka01-SafeZones` (nakładka stref
bezpiecznych 90/170/250 px) i `GrovBaseRolka01-NoMusic` (wersja tylko lektor + SFX).

## Struktura (dane i reżyseria oddzielone od warstw wizualnych)

| Plik | Rola |
|---|---|
| `src/data/words.ts` | czasy każdego słowa lektora (Whisper + dociągnięcie do ciszy w waveformie, 10 ms) |
| `src/data/timeline.ts` | wszystkie kotwice reżyserskie liczone ze słów (`T.uwazaj`, `T.narzedzia`, …) |
| `src/data/captions.ts` | frazy napisów (tekst 1:1 z lektora) + słowa kluczowe |
| `src/data/sfx.ts` | arkusz SFX — każdy dźwięk przypięty do konkretnego ruchu |
| `src/data/sceny_czasowe.json` | kotwice z paczki (referencja) |
| `src/world/camera.ts` | jedna wirtualna kamera 2.5D (x, y, zoom, rotX/Y/Z) z łukami i whipami |
| `src/world/layout.ts` | współrzędne stacji w jednym świecie |
| `src/world/stations/*` | Hook (Google → drag → WWW/sklep/social), Bench (edycja → obrót karty → kroki Google), Source (licencja u źródła), Tools (ChatGPT/Gemini/GrovBase → materiały wejściowe) |
| `src/components/*` | warstwowe komponenty: wazon (tło/podłoże/cień/wazon/liście osobno), schemat Google Grafika, karty WWW/sklep/social, ikony |
| `src/overlay/*` | napisy dynamiczne, nagłówki kinetyczne, HUD kroków, CTA, tło i wykończenie |
| `scripts/compose_audio.py` | **oryginalna** muzyka 128 BPM + 21 SFX, syntezowane od zera, ducking pod lektorem |
| `scripts/master.sh` | mastering (−14 LUFS / −1 dBTP) i remux z `faststart` |

Zmiana tempa/tekstu lektora: podmień MP3, wygeneruj nowe `words.ts` (opis w komentarzu pliku), a cała
choreografia, napisy i SFX przesuną się same, bo są liczone z `timeline.ts`. Muzykę przelicz `npm run compose:audio`.

## Materiały z paczki — jak zostały użyte

- `assets/illustrations/*` — wazon przebudowany 1:1 z oryginalnego SVG jako warstwy (`src/components/Vase.tsx`),
  dzięki czemu kadrowanie, usuwanie tła i przeróbka AI dzieją się „na żywo” na tym samym obiekcie.
- `assets/ui/01–05` — schematy Google Grafika / Prawa użytkowania / karta licencji / WWW-sklep-social /
  ChatGPT-Gemini-GrovBase odtworzone jako warstwowe komponenty React (nie przesuwamy całych PNG).
  Kopie SVG w `public/ui/` jako referencja.
- `assets/objects/*.svg` — użyte bez zmian (ostrzeżenie ©, zielony check licencji).
- `assets/brand/grovbase_pink_white.png` — oryginalne logo, bez odtwarzania i bez deformacji (stała proporcja 3256:706).
- `assets/reference/*.mp4` — tylko analiza tempa/choreografii, **nie** ma ich w filmie.

## Prawa do dźwięku i fontów

- Muzyka i wszystkie SFX: skomponowane/syntezowane w tym projekcie (`scripts/compose_audio.py`), bez sampli
  i bez imitowania istniejących utworów — można publikować w social media i reklamach.
- Fonty: Inter i Space Grotesk (SIL Open Font License, pliki licencji w `public/fonts/`).
