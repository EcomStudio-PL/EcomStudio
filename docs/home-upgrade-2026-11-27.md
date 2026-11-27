# /home — adaptacyjna karuzela, media kafli i banery na trzy urządzenia (27.11.2026)

Izolowany upgrade strony głównej zalogowanego sprzedawcy (`/home`) i trybu „Edytuj stronę”.

Bez zmian pozostają:
- design i pozostałe sekcje;
- `/tools`, `/` i `/start`;
- GrovShot, generatory AI, kredyty i Stripe.

## 1. Karuzela narzędzi (pierwsza sekcja)

**Przyczyna pustej przestrzeni.** `ToolCarousel` zawsze dawał Railowi stałe `--rail-cols` (1.18 / 2.5 / 4.5). Rail rysuje każdy kafel jako `(100% − przerwy) ÷ cols`. Przy mniejszej liczbie kafli niż `cols` reszta wiersza zostawała więc pusta, np. 2 kafle na desktopie zajmowały 2/4.5 szerokości.

**Jak działa teraz** (`components/seller-home/tool-carousel.tsx`):
- Liczba `n` to kafle, które widzi **klient**: wpis nieukryty w układzie i narzędzie niebędące `customerHidden`. Nie liczą się kopie pętli, kafle widoczne tylko dla admina ani kafle ukryte w trybie edycji.
- Na każdym breakpoincie zostaje pojemność karuzeli (telefon 1.18, tablet `sm` 2.5, desktop `lg` 4.5). Jeśli wszystkie kafle mieszczą się w całości (telefon 1, tablet 2, desktop 4), dostają `cols = n`, czyli równe kafle na całą szerokość z tymi samymi odstępami.
- Jeśli się nie mieszczą, ten breakpoint przewija się jak dotąd.
- Od 5 kafli działa niezmieniona pętla (`LoopRail`).
- Klasy to literalne ciągi (`RAIL_SHAPE`), więc Tailwind je generuje. Przeliczenie przy zmianie szerokości i orientacji robi samo CSS, bez JS.
- Rail pokazuje strzałki tylko wtedy, gdy jest dokąd przewinąć. W układzie statycznym nie ma więc strzałek, klonów ani pętli.
- `sizes` obrazów jest liczone z kształtu. Pojedynczy kafel na całą szerokość nie pobiera pliku 22vw.
- **Tryb edycji:** ukryte kafle są nadal rysowane (wyszarzone, z flagą), żeby można je było włączyć ponownie. Kształt liczy się jednak z liczby kafli klienta.

## 2. Media kafli: zdjęcie, GIF, wideo

**Izolacja od /tools.** Kafel karuzeli ma teraz **własny slot**:
- klucz: `homeMedia.carousel.<from|id>` (ten sam co `data-config-key` kafla, od zawsze);
- wiersz `media_slots`: entity `global/sellerHome`;
- `lib/home-layout.ts` `carouselSlotKey`, `lib/ice/registry.ts` `carouselSlot`.

Slot karty narzędzia (`cardSlot`, współdzielony z `/tools`) nie jest już edytowany z `/home`. `video` i `positionOnly` dla kart narzędzi pozostały bez zmian. Kafle „polecanych narzędzi” nadal używają karty.

Kolejność fallbacków jest bez zmian (`MediaSlot`):
1. własne medium kafla `/home`;
2. karta narzędzia z `/tools`;
3. przykład dostarczony z aplikacją;
4. placeholder.

Klucz zależy od kafla, a nie od narzędzia. Dwa kafle tego samego narzędzia to więc dwa sloty, a zmiana kolejności nie zmienia przypisania. Kafle dodane później (id) rozpoznaje `slotSpec`.

**Formaty:** JPG, PNG, WebP, AVIF, GIF, MP4, WebM.

**GIF:**
- `sniff` i `isIceMime` są bez zmian, więc załączniki kontaktowe, próbki i inne sloty nadal odrzucają GIF.
- Upload edytora używa `sniffUpload` (bajty GIF87a/GIF89a, MIME `image/gif`). Obiekt zawsze ma nazwę `.gif`, a `registerUpload` to egzekwuje.
- GIF-y nie dostają pochodnych WebP, więc animacja zostaje. `IcePicture` pomija `srcset` dla `.gif`.
- Slot przyjmuje GIF tylko z flagą `gif` (kafle karuzeli). Serwer sprawdza to w `checkAsset(..., { gif })`.
- Pierwsza klatka jest zapisywana jako `poster_media_id`. Przy `prefers-reduced-motion` przeglądarka wybiera ją przez `<source media>`, bez JS.

**Wideo:**
- Odtwarzacz to istniejący `SlotVideo`: autoplay, muted, loop, playsinline, bez kontrolek, cover, kadr. Pobiera się dopiero przy zbliżeniu do widoku, pauzuje poza widokiem i wznawia po powrocie.
- Nowa opcja opt-in `stillOnCalm` (tylko kafle): przy reduced motion pokazuje wyłącznie poster, bez kontrolek i bez pobierania wideo.
- Nowa opcja `maxWidths` (tylko banery) zmienia breakpointy.
- Pozostałe miejsca, które nie przekazują tych opcji, działają jak dotąd.

**Automatyczny poster** (`components/ice/editor/poster.ts`):
- Przy wyborze wideo albo GIF-a przeglądarka rysuje pierwszą odczytaną klatkę na canvas (HTMLVideoElement / `<img>`).
- Wynik zapisuje jako JPEG w tej samej bibliotece i przypisuje go jako poster przy „Zapisz”.
- Poster jest generowany raz, nigdy przy wyświetleniu strony.
- Działa także dla wideo wybranego z biblioteki, a przycisk „Utwórz z pierwszej klatki” pozwala wygenerować go ponownie.
- Jeśli się nie uda, pojawia się czytelny błąd i można wybrać poster z biblioteki. Uszkodzony poster nie jest zapisywany po cichu.

## 3. Banery promo1–3 na trzy urządzenia

| urządzenie | szerokość | proporcja | plik |
|---|---|---|---|
| Desktop | ≥ 1280 px | 80:17 (2400 × 510) | główny |
| Tablet | 768–1279 px | 80:17 (1600 × 340) | `tablet_media_id`, jeśli jest; inaczej desktop |
| Telefon | < 768 px | 1:1 (1080 × 1080) lub 5:4 (1080 × 864) | `mobile_media_id`, jeśli jest; inaczej desktop |

Szczegóły:
- **Breakpointy** 768/1280 (Tailwind `md`/`xl`) dotyczą tylko tych trzech banerów: ramki, `<source media>`, źródła wideo, podglądu w edytorze (`BANNER_BREAKPOINTS`). Pozostałe media zostają przy 640/1024.
- **Pobierany jest jeden plik:** obraz przez `<picture>`, wideo przez wybór źródła w `SlotVideo` przed `preload`.
- **Kadr** (punkt + zoom) jest osobny dla każdego urządzenia: desktop `crop`, tablet `crop.t`, telefon `crop.m`.
- **Proporcja telefonu** jest zapisana per baner w `crop.pr`. Brak wartości oznacza 1:1, więc istniejące banery z plikiem mobilnym wyglądają jak dotąd.
- **Teksty na tablecie (768–1279)** dostały kompaktowe rozmiary, żeby zmieściły się w niskim kadrze 80:17. Treści, CTA i kolejność są bez zmian.

## 4. Przyciemnienie tła

- Ustawienie jest zapisane per baner w `crop.ov` (0–100, liczba całkowita).
- Ustawia opacity **samej warstwy gradientu**: 0% to brak przyciemnienia, 100% to dotychczasowy gradient. Brak wartości oznacza 100%, więc istniejące banery są identyczne.
- Tekst, badge i CTA nie są przyciemniane. Ustawienie działa na wszystkich urządzeniach.
- W edytorze jest podgląd na żywo na stronie. Zapis następuje dopiero po „Zapisz”; po anulowaniu strona wraca do stanu sprzed edycji.

## 5. Zapis, walidacja, historia

Ścieżka: edytor (`components/ice/editor/media-panel.tsx`: szkic, `writeOf` / `draftFrame`) → `slotSave` (`lib/server/ice/actions.ts`: `checkCrop`, `checkAsset`, plik tabletu tylko dla `spec.tablet`) → RPC `media_slots_write` (bez zmian) → resolver (`slotCrop` w `lib/media-slots.ts`) → render → `revalidateTag(media-slots)`.

- **Zgodność wsteczna:** brak `tabletMediaId` w zapisie (starszy klient) oznacza, że plik tabletu zostaje jak dotąd.
- **Historia:** `content_versions` (trigger z 0141). Snapshoty i przywracanie (`readSnapshot` / `snapshotWrite`) obejmują plik tabletu, `t`, `pr` i `ov`. „Wyczyść” usuwa także plik tabletu.
- **Niezależność ustawień:** zapis tła telefonu nie zmienia tabletu, a zapis przyciemnienia nie zmienia plików ani kadrów (testy `I1–I4`).

### Migracja `0186_home_banner_frames.sql`

Migracja jest addytywna i zmienia tylko dwie funkcje:
- `media_crop_ok` dopuszcza `t`, `pr` (`1:1` / `5:4`) i `ov` (int 0–100);
- `media_slots_crop_reset` usuwa `t`, gdy inny zapisujący podmieni plik tabletu (jak `m` dla telefonu).

Żadna tabela, kolumna ani wiersz się nie zmienia.

**Wycofanie:** przywrócić definicje funkcji z 0141 (po `update media_slots set crop = crop - 't' - 'pr' - 'ov' where crop ?| array['t','pr','ov']`) i cofnąć commit.

## 6. „Edytuj stronę” — instrukcja

**Kafel karuzeli:**
- Kliknij obraz kafla, a potem „Wgraj nowe” albo „Wybierz z biblioteki” (zdjęcie, GIF lub wideo).
- Ustaw kadr (punkt i zoom). Dla wideo i GIF-a poster tworzy się sam; można go zmienić albo utworzyć ponownie.
- „Zapisz” zapisuje zmiany, a „Przywróć poprzednie”, „Historia” i „Usuń przypisanie” działają jak dotąd.
- Pusty slot oznacza, że kafel pokazuje grafikę narzędzia z `/tools`. Zmiana na `/home` nie zmienia `/tools`.

**Baner:**
- Kliknij baner i wybierz zakładkę **Desktop**, **Tablet** albo **Telefon**. W każdej możesz wgrać plik lub wybrać go z biblioteki, zobaczyć podgląd, ustawić kadr albo usunąć nadpisanie.
- Na zakładce Telefon wybierasz proporcję 1:1 lub 5:4.
- Pod zakładkami jest „Przyciemnienie tła” (suwak 0–100%, podgląd na żywo, „Przywróć 100%”).
- Pusty tablet lub telefon oznacza, że używane jest tło desktopowe.

## 7. Testy

- `npm run test:ice` (449), `npm run test:homeupgrade` (25, nowy), `npm run test:sellerhome` (nowe sekcje 3c i 3d).
- `test:home`, `test:media`, `test:homelayout`, `test:homepage`, `test:i18n:scopes`, `test:ice:sql` (248).
- Migracja 0186 sprawdzona na lokalnym Postgresie: zastosowana dwukrotnie, zapis przez `media_slots_write`, reset `t` i CHECK.
- Testy przeglądarkowe (Chromium) w izolowanym harnessie (`app/probe-tmp`, niecommitowany): karuzela na 5 szerokościach dla 0–6 kafli, 7 formatów mediów, reduced motion, banery na 7 szerokościach, przyciemnienie 0/25/50/75/100%, porównanie pikselowe pozostałych sekcji ze starą wersją.
- WebKit/Safari nie był dostępny w środowisku testowym.
