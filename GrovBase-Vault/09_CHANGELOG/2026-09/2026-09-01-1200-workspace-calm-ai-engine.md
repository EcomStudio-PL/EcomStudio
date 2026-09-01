# 2026-09-01 — Workspace calm restyle · real drawing tools · AI Engine (Knowledge Base)

Zakres: Task I ("Precyzyjny upgrade UI paneli roboczych") + dokończenie Task H (AI Engine).

## 1. Workspace design system (§31–33)
- Nowe tokeny w `app/globals.css`: `--workspace-bg / -surface / -surface-elevated / -border / -text-primary / -text-secondary / -accent / -accent-hover`, osobno dla LIGHT (czyste biele/szarości) i DARK (grafit prawie czarny, bez fioletowej poświaty).
- Scope `.workspace` re-mapuje generyczne tokeny (`--surface`, `--ink`, `--line`, `--hairline`, `--glass`…) na spokojną rampę — wszystkie komponenty genv3 przejmują nowy wygląd bez przepisywania klas. `.panel/.plate/.overlay/.dock` w scope: płaskie powierzchnie, cienkie neutralne bordery, zero blur/gradientów. `.is-selected`: cichy fioletowy ring + delikatny wash. Gradient pozostał wyłącznie na `.cta`.
- `.workspace-page::before`: płaskie tło viewportu przykrywa marketingowy ambient wash tylko na stronach generatora. Homepage/dashboard nietknięte (§30).

## 2. Strony generatora (§3, §5)
- `/prompts` i `/generator`: usunięty blok PageHeader (TWÓRZ / H1 / opis) — mode toggle zaczyna się bezpośrednio pod navbar.
- Lewa kolumna: `clamp(420px, 29vw, 470px)`.
- `/k/[cat]/[wf]`: ten sam scope, kompaktowy nagłówek kategorii zostaje (nawigacja presetów).

## 3. Regenerate — prawdziwe narzędzia rysowania (§21–22)
- Nowy `components/genv3/draw.tsx`: wektorowy silnik adnotacji na canvasie (współrzędne znormalizowane). Narzędzia: Pędzel, Gumka (usuwa element pod kursorem), Ramka, Okrąg, Linia, Strzałka, Rączka (przesuwanie elementów), Magia (flood-fill wand na realnych pikselach). Kolory (7 + custom picker), suwak rozmiaru, Cofnij, Resetuj.
- `regenerate.tsx` przebudowany 1:1 wg mockupu: obraz+canvas po lewej z filmstripem, po prawej 1) opis poprawek, 2) narzędzia, 3) model. Adnotacje spłaszczane na kopię obrazu (webp ≤2048px) → upload do `product-images/{ws}/markup/` → `markedImagePath` w POST.
- Backend: `GenerateInput.markedImagePath` w `lib/server/generation.ts` — obraz-podkład dołączany jako OSTATNIA referencja z kontraktem MARKED GUIDANCE IMAGE (oznaczenia lokalizują zmiany, nigdy nie są renderowane); rezerwacja slotu w budżecie referencji; kontrakt INSPIRATION przełącza się na numerację jawną gdy oba obecne. Walidacja ścieżki w route (prefiks workspace, charset, długość). Obie ścieżki regeneracji (koncept + custom) obsługują znacznik.

## 4. Image details (§24–26)
- Pobieranie: + TIFF (LZW, bezstratny) — sharp koduje natywnie; `OUTPUT_FORMATS` + narzędzie `format`/`compress`/`watermark`/`white_bg` przyjmują tiff; mime `image/tiff`.
- Kafelek „Popraw obraz (AI)" dodany jako uczciwy stan „Wkrótce" (brak backendu — bez atrapy).

## 5. AI Engine — Baza wiedzy (Task H §39–41)
- Migracja `0042_ai_engine.sql` ZASTOSOWANA NA PROD: `knowledge_sets`, `knowledge_examples` (pgvector 1536 + hint ciphertext), `prompt_engine_rules` (content + ciphertext), `prompt_engine_versions`, `prompt_sessions.engine_version/knowledge_used`, admin-only RLS, prywatny bucket `knowledge`, definer RPC `match_knowledge_examples` / `get_engine_rules` (zwracają WYŁĄCZNIE szyfrogram — klucz tylko server-side).
- Importer ZIP `app/api/admin/knowledge/import` (admin-only, staged status): własny bezpieczny reader ZIP (`lib/server/unzip.ts`: limity 400 plików / 25 MB / 200 MB, traversal, symlink, whitelist rozszerzeń, brak wykonywalnych), pdf-parse (≤5 PDF, 60 stron), pary before/after po stemie, hinty szyfrowane, embeddingi OpenAI text-embedding-3-small (best-effort).
- Retrieval w silniku promptów: reguły admina + top-K podobne przykłady (podłoga podobieństwa 0.25) dołączane do wewnętrznego briefu plannera; sesje stampują `engine_version` + `knowledge_used`. Treść PDF/ZIP = DANE, nigdy instrukcje.
- Panel `/admin/engine` (nav: AI → AI Engine): import z podglądem etapów, lista zestawów (filtry status/kategoria + szukaj), edycja meta/przykładów (ocena 1–5, tagi, worked/failed/correction, enable, delete — hint ciphertext przebudowywany + re-embed), reguły promptów (CRUD, szyfrowanie przy zapisie, wersjonowanie), historia wersji silnika (dodawanie/aktywacja). Server actions w `app/actions/engine.ts` z requireAdmin + log_activity.

## 6. i18n
- `genv3.*`: narzędzia rysowania, regenMark/Reset/Undo, dlTiff, editEnhance. `admin.engine.*`: ~60 kluczy. `common.saved/deleted`. Wszystko ×3 (PL/EN/DE).

## Weryfikacja
- `npm run typecheck` ✅, `npm run build` ✅. Przegląd adwersaryjny (4 wymiary) — wyniki i poprawki w raporcie zadania.
