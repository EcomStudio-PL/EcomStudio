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

## 7. Przegląd adwersaryjny — 15 potwierdzonych defektów naprawionych
Cztery niezależne przeglądy (canvas, backend znaczników, moduł AI Engine, restyle CSS); każde zgłoszenie weryfikowane przeciw kodowi.

**Canvas (7):** stale `shapesRef` przy szybkim ruchu wskaźnika (gumka/przeciąganie gubiły zmiany) → wszystkie zapisy przez `emit()` synchronizujący ref; `loadBitmap` cache'ował PORAŻKI (wygasły signed URL blokował różdżkę i spłaszczanie do przeładowania strony) → cache tylko sukcesów; różdżka kończąca się po zmianie obrazu nakładała maskę z poprzedniego zdjęcia → strażnik `urlRef`; snapshot undo dla nieudanej różdżki → snapshot dopiero przy sukcesie; `pointercancel` zatwierdzał niedokończony kształt → osobny handler odrzucający; próg grotu strzałki w px zamiast proporcji (rozjazd podgląd↔spłaszczenie) → `0.012 * W`; każda ponowna próba regeneracji wgrywała nowy plik markup → reużycie po sygnaturze kształtów.

**Backend (2):** model zapasowy o mniejszym `max_reference_images` obcinał końcowe referencje — czyli obraz z zaznaczeniami — podczas gdy prompt nadal twierdził, że jest załączony (realne dla domyślnego łańcucha gpt-image-2 → flux-pro-1.1). Referencje trzymane teraz w trzech rolach i dopasowywane PER KANDYDAT (`fitRefs`), a kontrakt budowany z tego, co faktycznie poleciało (`buildFidelity`); przy `max_reference_images = 1` znacznik ginął niedeterministycznie → ta sama zmiana usuwa problem uczciwie.

**AI Engine (6):** nieobsłużony błąd `insert` kończył import statusem „ready" z zerem przykładów → `fail()`; błąd uploadu ZIP zapisywał martwą ścieżkę → `zip_path` tylko przy sukcesie; budżet rozmiaru sprawdzany przed whitelistą metod kompresji (jeden nieobsługiwany plik wywracał całe archiwum) → kolejność odwrócona; `break` zamiast `continue` w budżecie reguł gubił krótkie reguły za długą; poll postępu importu śledził najnowszy zestaw globalnie → przypięty do zalogowanego admina i czasu startu; brak polityki UPDATE na buckecie `knowledge` przy `upsert:true` → migracja 0043.

**Restyle (4):** `--hairline-alpha: 0.9` × mnożniki 1.2–2.5 przekraczało 1 i CSS spłaszczał całą hierarchię obramowań do jednej wagi → 0.4; ziarno `body::after` malowało się NAD płaskim tłem workspace → wyłączone na tych stronach; `.workspace .is-selected { color }` nadpisywał `text-accent` na chipach i wyborze formatu → deklaracja usunięta; `.dark .workspace .plate` bił utility `hover:border-…` (utrata afordancji hover w dark) → `:where(.workspace) .plate`.

**Migracja 0043** (zastosowana na PROD): `match_knowledge_examples` nie zwraca już `similarity` a próg 0.25 egzekwuje SQL (koniec z oracle podobieństwa dla dowolnego wektora), `get_engine_rules` nie zwraca `rule_type`/`priority` (framing „Unikaj:" zapieczętowany w szyfrogramie przy zapisie), polityka UPDATE dla bucketa `knowledge`.

## Weryfikacja
- `npm run typecheck` ✅ · `npm run build` ✅ (35 tras).
- Responsywność: 320/390/430/768/1024/1366/1536/1920/2560 — **0 px** przewinięcia poziomego w każdym z nich, dark i light.
- Narzędzia rysowania zweryfikowane funkcjonalnie na canvasie (liczba nieprzezroczystych pikseli): pusty 0 → pędzel 2 024 → ramka 7 456 → strzałka 9 808 → okrąg 13 129 → różdżka 117 545 (flood fill po realnych pikselach) → przeciąganie 119 392 → gumka 115 097 (jeden element) → cofnij 119 392 (dokładne przywrócenie) → reset 0; spłaszczanie zwraca prawdziwy `image/webp` (7 588 B).
- Live E2E na PROD niewykonalne z tego środowiska: proxy wyjściowe blokuje host Supabase (CONNECT 403), więc logowanie testowego konta nie przechodzi lokalnie. Weryfikacja wizualna przeprowadzona na prawdziwych komponentach przez tymczasową trasę podglądu (usuniętą przed commitem).
