# GrovBase — Pre-launch Landing V2: raport wdrożenia (2026-10-22)

Strona główna grovbase.com (CMS `premiera`, `kind = launch`, `is_homepage`) jest teraz długim landingiem konwersyjnym z prawdziwym double opt-in, zgodami zapisywanymi z treścią i wersją, poleceniami oraz nagrodami wypłacanymi przez istniejący portfel. Wszystkie obietnice z wartościami (data, X, Y, godziny, cena premierowa) są **niezatwierdzone i ukryte**. Odwiedzający nie widzi żadnego znacznika `{…}` ani `[X]`.

| | |
|---|---|
| Commit | `ed0a4be` (gałąź `claude/ecomstudio-extract-push-f8ceir`, fast-forward na `main`) |
| Deployment produkcyjny | `dpl_AUkVJitsCD8v2MJyF5YqUs3ZvWJ4` (ecomstudio-prod) → grovbase.com, www.grovbase.com |
| Migracje na PROD | `20261022115700` 0144 part1, `20261022115821` 0144 part2, `20261022115934` 0144 part3, `20261022120705` 0145 |
| Punkt powrotu | commit `efec08f`, deployment `dpl_5Lu9Eotm41Gq6PbgChHi7KcgU8iA` + wersja 2 strony `premiera` w Historii |

## Oś czasu (UTC)

| Godzina | Krok |
|---|---|
| 11:57:00–11:59:34 | 0144 na PROD w trzech transakcjach (jak 0143). Wcześniej podział przeszedł cały zestaw testów SQL w trybie trzech transakcji (218/218). |
| 11:59:38 | push `main` → build produkcyjny (stary build projektu `ecomstudio` anulowany, zgodnie z zasadą) |
| 12:03:56 | `dpl_AUkVJitsCD8v2MJyF5YqUs3ZvWJ4` READY, aliasy grovbase.com |
| 12:04 | sprawdzenie grovbase.com: nowy kod, stara treść, brak surowych znaczników |
| 12:07:05 | 0145 (nowa treść strony) |

**Okno przejściowe** (nowe `waitlist_subscribe` + stary kod, 11:59:34–12:03:56): 0 nowych wierszy `waitlist_subscribers`, 0 nowych kontaktów. Nikogo nie trzeba zapraszać ponownie do double opt-in.

**Zgodność schematu PROD z repozytorium:** wszystkie 27 funkcji (`prelaunch_*`, `waitlist_subscribe`, `app_setting_is_private`) mają na PROD identyczny skrót `md5(pg_get_functiondef)` jak w lokalnej bazie zbudowanej z plików migracji. Kolumny, ograniczenia, indeksy, polityki RLS, uprawnienia tabel i funkcji też są identyczne. Przed wdrożeniem sprawdziłem zależności: sygnatury `newsletter_upsert_contact`, `apply_credit_transaction`, `server_call_ok`, `account_blocked`, `is_admin`, `newsletter_resubscribe`, `waitlist_subscribe`, typ `credit_tx_type` i kolumny tabel bazowych są na PROD takie same jak w repozytorium.

---

## 1. Co wdrożono

**Landing (`/`)**
- **Hero:** badge „ZDJĘCIA AI DLA SPRZEDAWCÓW”, H1 „GrovBase już wkrótce.”, podtytuł, trzy chipy i linia oferty. Linia oferty ma 4 warianty (data+kredyty / data / kredyty / bez wartości) i pokazuje pierwszy, którego wszystkie wartości są zatwierdzone. Dziś to wariant „bez wartości”.
- **Odliczanie** do premiery (Europe/Warsaw, czas serwera, znika po dacie i odświeża treść w otwartej karcie). Pokazuje się tylko przy zatwierdzonej dacie.
- **Skrzynka korzyści:** „X kredytów na start / Zamiast standardowych {standard}”, „Cena premierowa” i „Wcześniejszy dostęp”. Każda karta ma osobny warunek:
  - „Cena premierowa” wymaga zatwierdzenia i aktywnej oferty premierowej w cenniku.
  - „Wcześniejszy dostęp” nie renderuje się w ogóle (`EARLY_ACCESS_SUPPORTED = false`).
- **Trzy galerie PRZED/PO:** MINIATURKI, RETUSZ i MODA.
  - Format 1:1, 4 w rzędzie na PC, strzałki, przewijanie palcem na telefonie, suwak sterowany myszą, dotykiem i klawiaturą.
  - Pusta galeria jest niewidoczna dla odwiedzających. Na PROD wszystkie trzy są puste, bo nie dodaliśmy żadnych zdjęć.
- **Pozostałe sekcje:**
  - Pasek kosztów i sekcja „Kto za tym stoi”: domyślnie wyłączone.
  - Końcowe CTA z drugim formularzem, przyklejone CTA, przełącznik języka i istniejąca stopka.

**Formularz i double opt-in**
- **Pola:**
  - E-mail (wymagany, ścisła reguła adresu, domeny IDN zamieniane na punycode) i imię (opcjonalne).
  - Dwie osobne, niezaznaczone, wymagane zgody: Regulamin + Polityka prywatności oraz zgoda marketingowa.
  - Honeypot.
- **Zapis zgód:** każda zgoda trafia do `prelaunch_consents` z kluczem, wersją (skrót treści), dokładną treścią zdania, wersjami dokumentów prawnych, czasem i formularzem. `confirmed_at` ustawia dopiero kliknięcie DOI.
- **Token DOI:** 32 losowe bajty, w bazie tylko sha256, jednorazowy, wygasa po 72 h. Link ma postać `/potwierdz-zapis#t=…`, więc token jest we fragmencie i nie trafia do logów. Potwierdzenie wymaga kliknięcia przycisku. Strona ma `noindex` (meta i nagłówek `X-Robots-Tag`).
- **Jednolita odpowiedź:** nowy adres, znany adres, adres zablokowany i honeypot dostają tę samą odpowiedź, więc nie da się sprawdzić, czy adres jest na liście.
- **Limity:**
  - Na adres i skrzynkę (Gmail, aliasy +tag): 1/min i 5/24 h.
  - Na sieć: 20/h.
  - Globalnie: 300 maili DOI/h.
- **„Wyślij ponownie”** wysyła ponownie z tym samym imieniem, językiem i kodem polecenia.
- **Wygasły link:** strona potwierdzenia oferuje wysłanie nowego linku.
- **Atrybucja first-touch:** UTM, referrer i ścieżka wejścia z ciasteczka serwera, zapisywane raz i nigdy nie nadpisywane.
- **Po wysłaniu formularza:**
  - Komunikat „Sprawdź skrzynkę i potwierdź zapis.”
  - Pytanie „Gdzie sprzedajesz?” (Allegro / Amazon / Własny sklep / Kilka kanałów).
  - Link polecający z przyciskami udostępniania.

**Polecenia i nagrody**
- **Liczenie polecenia:** polecenie liczy się dopiero po potwierdzeniu DOI i tylko przez link polecającego, który utworzył zapis. Inny link oznacza odrzucenie `other_link`.
- **Antyfraud:** własny link (`self`), istniejący kontakt lub konto, ta sama sieć, duplikat skrzynki, maksymalnie 2 polecenia z jednej sieci (`cluster`).
- **Wypłata:**
  - Leniwa (`prelaunch_reward_ensure` przy wejściu do aplikacji), tylko na zweryfikowane i niezablokowane konto, idempotentna.
  - Klucze unikalności: jedna nagroda za zapis na konto i na skrzynkę, jedna na źródło. Limit poleceń na konto.
  - Wypłata idzie wyłącznie przez `apply_credit_transaction` z typem `bonus`, nigdy `topup` (nie odblokowuje znaku wodnego).
- **Bezpieczniki:** główny przełącznik `rewards_active` jest wyłączony, a X i Y są niezatwierdzone. Dlatego dziś nikt nie dostaje kredytów.

**Administracja**
- **Panel „Kampania przedpremierowa”** w Strony WWW → premiera: data, X, Y, wartość standardowa, godziny, cena premierowa, limit poleceń, okno wypłat i przełącznik nagród. Każda wartość ma osobny przełącznik „zatwierdzone”, a ustawienia są prywatne (`app_setting_is_private`).
- **Edycja treści:** builder (PL/EN/DE, przełączniki sekcji, SEO/OG, media) i edytor w miejscu („Edytuj stronę”) z panelem galerii.
- **Newsletter (centralna lista, bez osobnej listy oczekujących):**
  - Kontakty z filtrem „Oczekujące / Potwierdzone” (`/admin/waitlist` przekierowuje do Newsletter → Kontakty).
  - Karta kontaktu z profilem przedpremierowym: zgody, atrybucja, kanał, polecenia.
  - Newsletter → Analityka ze statystykami: zapisy, potwierdzenia, wysłane i nieudane DOI, ponowienia, formularze, źródła, kanały, polecenia, nagrody.
- **Statystyki w bazie:** `prelaunch_admin_summary` jest jedynym źródłem tych liczb.

**Analityka (GA, 8 zdarzeń):** `prelaunch_page_view`, `prelaunch_form_start`, `prelaunch_signup_submitted`, `prelaunch_email_confirmed`, `prelaunch_cta_clicked`, `prelaunch_before_after_interaction`, `prelaunch_referral_shared`, `prelaunch_referral_confirmed`. `page_location` jest oczyszczany, a `ref_code` usuwany z paska adresu.

**SEO:** title „GrovBase — Zdjęcia AI dla sprzedawców | Premiera wkrótce”, nowy opis, OG/Twitter i canonical. `/potwierdz-zapis` jest poza sitemap i ma `noindex`.

**Bezpieczeństwo starej ścieżki zapisu:** `waitlist_subscribe` (formularz newslettera w CMS i stare strony) nie daje już zgody marketingowej, nie zapisuje imienia w kontakcie, nie wysyła maila „jesteś na liście” i odpowiada jednakowo.

**Czego nie zmieniłem:** generowanie AI, Retusz, GrovShot, Miniaturka, Moda, Stripe, subskrypcje, znak wodny, autoryzacja, prywatne galerie, blokada publicznej rejestracji i wybór strony głównej w CMS. Portfela dotyka tylko wypłata nagród przez istniejącą funkcję.

## 2. Ponownie wykorzystane komponenty

- **UI:**
  - `BeforeAfter` (suwak PRZED/PO), `Rail` (karuzela).
  - `IcePicture`, `CropEditor`, panel dopasowania par z edytora ICE.
  - `pairSuffix` / `groupPairs` / `planBulk` (masowe parowanie `*-przed` / `*-po`).
  - Bilety uploadu ICE (sprawdzanie bajtów pliku).
  - Wzorzec odliczania z `PremiereBanner`, `AuthDialog` (korzyści z kampanii).
- **CMS:** builder Strony WWW, `cms_page_versions` (Historia), `is_homepage` (0110), edytor w miejscu (`cms_inline_patch` z kontrolą wersji).
- **Newsletter:**
  - `newsletter_contacts`, `newsletter_contact_sources` (rozszerzone o kolumny atrybucji), `newsletter_groups` (nowa grupa `prelaunch`), `newsletter_suppressions`.
  - `newsletter_upsert_contact`, `newsletter_resubscribe`, ekrany Kontakty / Analityka / karta kontaktu.
- **Poczta:** silnik szablonów (`renderTemplateEmail`, `lookupPublishedTemplate`, Komunikacja → Szablony), transport SMTP (`email_settings` + Vault), powiadomienia admina (e-mail i Telegram).
- **Dostęp i kredyty:** `server_call_ok` (bramka tokenu serwera, 0077), `apply_credit_transaction` (portfel), `account_blocked`, `is_admin`, `log_activity` / audyt.
- **Analityka i i18n:** `lib/analytics/ga.ts` (trackEvent i oczyszczanie adresów), słowniki i18n PL/EN/DE.

## 3. Gdzie edytować stronę w adminie

| Co | Gdzie |
|---|---|
| Wszystkie teksty PL/EN/DE, SEO/OG, przełączniki sekcji (odliczanie, korzyści, koszty, „Kto za tym stoi”, CTA końcowe, przyklejone CTA, kanał, polecenia), media | **Admin → Strony WWW → `premiera`** (`/admin/www/premiera`) — builder; „Zapisz” → „Publikuj”; **Historia** = wersje do przywrócenia |
| Data premiery, X, Y, wartość standardowa, godziny, cena premierowa, limit poleceń, okno wypłat, **włączenie nagród** | Ta sama strona, panel **„Kampania przedpremierowa”** (każda wartość + „zatwierdzone”) |
| Edycja w miejscu (teksty, obraz w hero) i **galerie PRZED/PO** (dodaj/usuń/kolejność przeciągnij-upuść lub klawiatura, kadrowanie, wyrównanie, masowo `*-przed`/`*-po`, podpisy PL/EN/DE, ukryj, szkic → publikuj, odrzuć szkic) | Zalogowany admin na **grovbase.com** → **„Edytuj stronę”** |
| Mail potwierdzający (DOI) PL/EN/DE i powitalny | **Admin → Komunikacja → Szablony**: `waitlist.optin`, `waitlist.optin_en`, `waitlist.optin_de` (dziś domyślne z kodu — nieopublikowane) oraz `waitlist.confirmation` (opublikowany: „Jesteś na liście GrovBase 🚀”) |
| Lista zapisanych | **Admin → Newsletter → Kontakty** (filtr: Oczekujące / Potwierdzone), karta kontaktu |
| Statystyki | **Admin → Newsletter → Analityka** |

## 4. Sloty mediów

| Slot | Gdzie | Stan na PROD |
|---|---|---|
| `hero.image` — grafika w hero | edytor w miejscu / builder | domyślna `/launch/hero-dino.webp` |
| Galeria **MINIATURKI** (`launch_gallery` `thumbs`) — do 30 par PRZED/PO 1:1 | „Edytuj stronę” → galeria | pusta (ukryta) |
| Galeria **RETUSZ** (`retouch`) — do 30 par | jw. | pusta (ukryta) |
| Galeria **MODA** (`fashion`) — do 30 par | jw. | pusta (ukryta) |
| `creatorsImage` — zdjęcie w „Kto za tym stoi” | builder | brak (sekcja wyłączona) |
| `ogImage` — obraz udostępniania (1200×630) | builder (SEO) | domyślny `/launch/og.jpg` |

Masowy upload paruje pliki po nazwach `nazwa-przed.jpg` / `nazwa-po.jpg` (wielkość liter i rozszerzenia jpg/jpeg/png/webp bez znaczenia). Nie dodano żadnych zdjęć.

## 5. Wartości do uzupełnienia (wszystkie dziś **niezatwierdzone**)

| Wartość | Pole w panelu | Co się stanie po zatwierdzeniu |
|---|---|---|
| **DATA** premiery (Europe/Warsaw) | `launch_at` + „zatwierdzone” | odliczanie, linia oferty z datą; po dacie znika sama |
| **X** — kredyty na start | `signup_credits` | karta korzyści, oferta z kredytami, notka w oknie logowania; po włączeniu nagród wypłata X (zastępuje standardowe kredyty rejestracyjne: dopłata = X − już otrzymany bonus rejestracyjny) |
| **Y** — kredyty za polecenie | `referral_credits` (+ limit, domyślnie 10) | zdanie „+Y kredytów” po zapisie i potwierdzeniu; wypłata za potwierdzone polecenia na zweryfikowane konta |
| „Zamiast standardowych …” | `standard_credits` | druga linia karty X |
| **Czas wcześniejszego dostępu** [24/48 h] | `early_access_hours` | **nic** — brak mechanizmu wcześniejszego dostępu (wymagałby zmian w autoryzacji/rejestracji, zakazanych w briefie); karta nie renderuje się, dopóki to nie powstanie |
| Cena premierowa | `price_lock_approved` | karta tylko gdy zatwierdzona **i** oferta premierowa w cenniku jest aktywna (`PRICING_OFFER.premiere.endsAt` = 2026-10-31) |
| Włączenie nagród | `rewards_active` (+ opcjonalnie `reward_claim_until`) | bez tego nikt nie dostaje kredytów, nawet przy zatwierdzonych X/Y |
| Polityka bonusu ankiety 150 | `survey_bonus_policy` = `stack` | dziś 150 za ankietę sumuje się z X — do decyzji |
| Pasek kosztów („ok. 30 zł” / „kilka złotych”) | przełącznik sekcji „Koszty” | wyłączony — potrzebne źródło liczb |
| „Kto za tym stoi” (tekst, zdjęcie, podpis, zgoda osoby) | przełącznik sekcji + `creatorsImage` | wyłączony — potrzebna prawdziwa treść |

## 6. Treść zgód do weryfikacji prawnej

Zgody są edytowalne w CMS. Każda zmiana treści tworzy nową wersję, a zapis przechowuje dokładne zdanie, które widział użytkownik.

| | PL | EN | DE |
|---|---|---|---|
| Zgoda 1 (wymagana) | „Akceptuję **Regulamin** i **Politykę prywatności**.” | “I accept the **Terms of Service** and the **Privacy Policy**.” | „Ich akzeptiere die **AGB** und die **Datenschutzerklärung**.” |
| Zgoda 2 (dziś **wymagana**) | „Chcę otrzymywać e-mailem informacje o premierze i ofertach GrovBase.” | “I want to receive e-mails about the GrovBase launch and offers.” | „Ich möchte per E-Mail Informationen zum Start und zu Angeboten von GrovBase erhalten.” |
| Notka nagrody | „Kredyty dopiszemy po założeniu konta na ten sam adres e-mail.” | “We'll add the credits once you create an account with the same e-mail address.” | „Die Credits schreiben wir gut, sobald du ein Konto mit derselben E-Mail-Adresse anlegst.” |

**Mail DOI** (domyślny, PL; EN/DE analogicznie):
- Temat: „Potwierdź zapis na listę GrovBase”.
- Nagłówek: „Potwierdź swój adres e-mail”.
- Treść: „Ktoś — mamy nadzieję, że Ty — zapisał ten adres na listę przedpremierową GrovBase. Kliknij przycisk poniżej, aby potwierdzić zapis. Link jest ważny przez {{expires_hours}} godz. Jeśli to nie Ty, po prostu zignoruj tę wiadomość: bez potwierdzenia nie napiszemy do Ciebie ponownie.”
- Przycisk: „Potwierdzam zapis”.

**Pytania do prawnika:**
1. **Czy zgoda marketingowa może być warunkiem zapisu?** Obowiązkowa zgoda marketingowa może kolidować z wymogiem „dobrowolności” z RODO. Jest przełącznik `marketing_required`: po jego wyłączeniu druga zgoda staje się opcjonalna, a kontakt bez niej nie dostaje zgody marketingowej.
2. **Aktualizacja polityki prywatności:** trzeba w niej opisać UTM i referrer, polecenia, pytanie o kanał sprzedaży, zdarzenia GA, skrót IP oraz przechowywanie zgód.
3. **Zgoda GA:** strona nie ma banera ani Consent Mode.
4. **Legacy:** w bazie jest 5 starych „zgód” i 10 starych zapisów bez DOI. Nie zostały zmienione. Trzeba zdecydować, czy prosić te osoby o DOI.

## 7. Wyniki testów

### Testy automatyczne (lokalnie, prawdziwy Postgres/Supabase + Mailpit)

| Zestaw | Wynik |
|---|---|
| SQL 0144 (`scripts/prelaunch-sql-tests.sh`) — role anon/authenticated/admin, współbieżność na osobnych połączeniach, 4 mutanty migracji | **PASS 222/222** (podział na 3 transakcje jak na PROD: **PASS 218/218**, bez mutantów) |
| SQL 0145 (`prelaunch-copy-sql-tests.sh`) | **PASS 41/41** |
| Serwer (`test:prelaunch:server`) | **PASS 197/197** |
| UI (`test:prelaunch:ui`), galerie (`test:launchgallery` 36), edytor w miejscu (`test:ice` 373), CMS, homepage, seller-home (255), i18n scopes, download, analytics | **PASS** |
| Pełna regresja (106 zestawów bez przeglądarki) | **105 PASS / 1 FAIL** — `test:tilebytes` pada identycznie na `efec08f` (pliki silnika AI spoza zakresu; nie ruszane) |
| `npm run typecheck`, `next build` | **PASS** |

### Testy A–F (lokalny stos E2E z kopią strony z PROD, przeglądarka Chromium; runda 1 + poprawki + runda weryfikacyjna)

| Obszar | PASS | FAIL | NOT TESTED |
|---|---|---|---|
| **A** wygląd PC/tablet/telefon, PL/EN/DE, jasny/ciemny | układ, brak poziomego przewijania, fokus klawiatury w galerii, zoom, axe-core na `/potwierdz-zapis` (runda 1: 42/46 → 4 poprawione i potwierdzone) | — | wizualnie na PROD (kontener nie ma przeglądarki z dostępem do grovbase.com; PROD sprawdzony na poziomie HTML) |
| **B** CMS: tekst, dodaj/usuń/kolejność par, kadr, ukryj, zapis, publikacja, przywrócenie wersji | wszystko (runda 1: 42/45 → scalanie zapisu buildera z edycją w miejscu, przywracanie wersji zachowuje galerie, Historia > 50 wersji, `hero.image` — poprawione i potwierdzone 26/26) | — | edycja na PROD (bez sesji admina na PROD i bez zmian treści na PROD) |
| **C** PRZED/PO: mysz, dotyk, klawiatura, karuzela, kadr, masowy upload | wszystko | — | na PROD (galerie są puste — brak zdjęć) |
| **D** lista: formularz → PENDING → mail → potwierdzenie → aktywny; duplikat; wygasły link; ponowny zapis; brak zgód; zły e-mail; **awaria SMTP**; honeypot; limit; formularz końcowy | wszystko (DOI 25/25 + 8/8; awaria SMTP: odpowiedź 200 jednakowa, token oznaczony `send_failed_at`, licznik „Nieudane wysyłki” = 1, po naprawie SMTP „Wyślij ponownie” dostarcza mail) | — | prawdziwy DOI na PROD (patrz pkt 8) |
| **E** polecenia: poprawne; dwa; własny link; ta sama osoba wielokrotnie; brak potwierdzenia; ponowne przetwarzanie; bonus dopiero po weryfikacji konta | wszystko (runda 1: 36/38 → saldo po wypłacie na pierwszym widoku i etykieta `other_link` — poprawione i potwierdzone) | — | wypłata na PROD (nagrody wyłączone, X/Y niezatwierdzone) |
| **F** regresja: typecheck, build, CMS, Newsletter, Auth, kredyty, generowanie | wszystko poza `test:tilebytes` (istniejący wcześniej błąd) | `test:tilebytes` (pre-existing) | prawdziwe generowanie AI (zakaz kosztownych wywołań) |

### Weryfikacja produkcji (grovbase.com, tylko odczyt)

<!-- PROD-VERIFY -->

## 8. Czy potwierdzono prawdziwy przepływ double opt-in i poleceń

- **Tak, lokalnie i end-to-end.** Prawdziwy Supabase/Postgres z tymi samymi plikami migracji, prawdziwe wysyłki SMTP do Mailpit i kliknięcia w przeglądarce. Sprawdzone ścieżki:
  - zapis → mail → otwarcie linku bez auto-potwierdzenia → przycisk → potwierdzony kontakt z grupą `prelaunch` i zgodą DOI;
  - polecenie liczone po potwierdzeniu;
  - konto zweryfikowane → wypłata X i Y przez portfel, widoczna od pierwszego widoku;
  - ponowienie, wygaśnięcie, duplikaty, odrzucenia antyfraud;
  - awaria SMTP.
- **Na PROD:** funkcje bazy są bajtowo identyczne z przetestowanymi (porównanie skrótów definicji). Prawdziwego DOI na PROD **nie wykonałem**: wymaga skrzynki właściciela, a nie chciałem dodawać testowych kontaktów do produkcyjnej listy. Polecenia i wypłaty na PROD są uśpione (`rewards_active = false`, nic niezatwierdzone). Proponowany test właściciela: zapis własnym adresem na grovbase.com → mail → potwierdzenie → kontakt w Newsletter → Kontakty (Potwierdzone).

## 9. Commit i deployment

- Commit: **`ed0a4be`**. Seria V2 to `c472c87…ed0a4be` (22 commity od `efec08f`, 127 plików; ten raport jest osobnym commitem bez zmian w kodzie).
- Deployment: **`dpl_AUkVJitsCD8v2MJyF5YqUs3ZvWJ4`** (projekt `ecomstudio-prod`, READY, grovbase.com). Równoległe buildy projektu `ecomstudio` i podglądy gałęzi zostały anulowane.
- Migracje PROD: `0144_prelaunch_landing_part1_tables_helpers`, `…_part2_signup_confirm`, `…_part3_admin_rewards_grants`, `0145_prelaunch_copy`.

## 10. Punkt powrotu

- **Kod:** commit `efec08f`, deployment `dpl_5Lu9Eotm41Gq6PbgChHi7KcgU8iA` (Vercel → Instant Rollback).
- **Kolejność przy wycofaniu:** **najpierw** Admin → Strony WWW → `premiera` → Historia → przywróć wersję **2 „Landing V2 — treści sprzed aktualizacji (0145)”** i opublikuj. Dopiero **potem** cofnij kod. Stary renderer nie rozumie znaczników `{credits}`.
- **Baza:** tabele i funkcje 0144 zostają nieużywane i uśpione. `waitlist_subscribe` zachowuje treść z 0144: stara strona zapisuje bez zgody marketingowej i bez maila powitalnego. Przywrócenie treści z 0106 to osobna migracja do zatwierdzenia przez właściciela; bramka MCP nie pozwala na polecenia usuwające w plikach migracji.

## 11. Otwarte problemy

**Decyzje właściciela i prawnika (blokują obietnice, nie stronę):**
1. **Wartości:** DATA, X, Y, wartość standardowa i polityka bonusu 150 za ankietę (dziś sumuje się z X).
2. **Mechanizm nagród:** kto dostaje X i kiedy wypłacać Y.
3. **Wcześniejszy dostęp:** brak mechanizmu. Usunąć obietnicę albo zatwierdzić zmianę rejestracji.
4. **Cena premierowa:** cennik jej nie obsługuje poza ofertą premierową do 2026-10-31.
5. **Kwestie prawne:** treści zgód, obowiązkowa zgoda marketingowa (RODO), aktualizacja polityki prywatności, zgoda GA (brak banera i Consent Mode), retencja niepotwierdzonych zapisów (brak automatycznego usuwania).
6. **Legacy:** 5 starych zgód i 10 zapisów bez DOI. Czy prosić o DOI?
7. **Treści:** prawdziwe pary PRZED/PO dla 3 galerii, sekcja „Kto za tym stoi”, źródło liczb paska kosztów, OG, korekta EN/DE.
8. **`newsletter_subscribe`** (formularz newslettera w CMS) jest single opt-in. Nie zmieniałem go, bo był poza zakresem.

**Techniczne, niskie:**
- **Publikacja galerii z buildera:** „Publikuj” w builderze publikuje też szkice galerii, bez ostrzeżenia.
- **Builder a edycja w miejscu:** jeśli builder jest otwarty w innej karcie, pokazuje stary tekst pola, dopóki strony nie przeładujesz. Zapis scala zmiany per pole, ale ponowne wpisanie tego pola w builderze nadpisze edycję w miejscu.
- **Odrzucenie szkicu nieopublikowanej galerii** zostawia pusty blok. Status jest już poprawny (poprawka w `ed0a4be`).
- **Teksty poza CMS:** część mikrotekstów (przycisk logowania, stopka, komunikaty `prelaunchUi.*`) jest w słownikach, nie w CMS.
- **Edytor w miejscu:** stan „Kończenie…” czasem się zawiesza.
- **Dostępność:**
  - Cele dotykowe są mniejsze niż 44 px, ale spełniają wymóg AA 24 px.
  - Uchwyt suwaka PRZED/PO blokuje przewijanie pionowe na swoim pasku (wspólny komponent).
- **Wygląd:** w jasnym motywie systemowym tło `body` i `theme-color` są jasne pod ciemną stroną; logo jest za duże.
- **Za dużo danych dla odwiedzającego:** do anonimowego odwiedzającego trafiają w danych RSC teksty adminowe (przestrzenie i18n `cms` i `newsletter`). Nie są widoczne, ale niepotrzebnie zwiększają stronę.
- **Licznik kredytów w szufladzie:** po wypłacie X > 25 pokazuje „Pozostało: 50 / 25 · 100%”. To logika `lib/credit-usage.ts` sprzed tej zmiany i dotyczy też doładowań. Ujawni się po zatwierdzeniu X > 25.
- **Język kontaktu:** jeśli adres trafił najpierw przez stary formularz newslettera, `newsletter_contacts.locale` zostaje z tego pierwszego zapisu (język zapisu i maila jest poprawny).
- **Testy:** test wyścigu F12 bywa wrażliwy przy bardzo dużym obciążeniu; `test:tilebytes` pada już na `efec08f`.
