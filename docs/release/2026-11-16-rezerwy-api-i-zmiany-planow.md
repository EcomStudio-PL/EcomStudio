# GrovBase — Rezerwy API + Zmiany planów: raport wdrożenia (2026-11-16)

Dwa niezależne moduły, każdy z osobną migracją, osobnymi commitami i osobnym wyłącznikiem.

| | |
|---|---|
| Commity | Moduł 1: `0e3181c` (centrum rezerw), `80a43f2` (klucz fal z rekordu sprzed Vault), `5ed0c82` (raporty finansowe jako tabele w Telegramie, temat e-maila bez podwójnego „GrovBase”). Moduł 2: `896cb75`. Gałęzie `premiera-poprawki` → `main`. |
| Migracje na PROD | `0180_api_reserves` (moduł 1), `0181_plan_changes` (moduł 2) — addytywne, powtarzalne, historyczne migracje nietknięte. Treść funkcji na PROD = baza testowa z pliku (md5 `pg_get_functiondef`: 8/8 dla 0180, 10/10 dla 0181). |
| Wdrożenia | Moduł 1: `dpl_Gh24Hu9hag63AMuXWKkWumSZ7cYx` (READY; pierwsza próba `dpl_3nLF…` padła na OOM maszyny budującej, ponowiona bez zmian). Moduł 2 + poprawki: `dpl_FV1yWcxcb1ZXcJchqS4EDTBLSfG5` (commit `896cb75`) |
| Wyłączniki | Moduł 1: `api_reserve_settings.enabled` (Finanse → Rezerwy API → Ustawienia). Moduł 2: `app_settings.plan_changes.enabled` — **WYŁĄCZONY** (Finanse → Zmiany planów). |
| Bez zmian | salda (488 / 1 124 / 49 743,75 — przed i po), pule, transze, subskrypcje, Stripe Price ID, ceny i waluty, checkout, Customer Portal, GrovNews. Inwariant `saldo = Σ pul`: 0 rozbieżności przed i po. |

## Moduł 1 — Centrum rezerw API (tylko administratorzy)

- **Finanse → Rezerwy API** (`/admin/finance/rezerwy`): stan ogólny, KPI (środki u dostawców, wydatki dziś / 24 h / 7 dni / 30 dni, kredyty klientów, sprzedane / wykorzystane / wygasłe, przyszłe transze, koszt realizacji, zalecana rezerwa, brakująca kwota), pule (abonament / doładowania / bonusy / historyczne / transze, klienci osobno od kont wewnętrznych), prognoza (koszt kredytu z historii albo z konfiguracji cen — opisane, które), karta na dostawcę (saldo lub limit, koszty godzina / dziś / miesiąc, wywołania, udział, rezerwa, doładowanie, „starczy na”, synchronizacja, status OK / Ostrzeżenie / Krytyczny / Brak danych, link do rozliczeń), ustawienia i historia raportów.
- **Źródło kosztów**: wyłącznie `ai_provider_calls` (jedno wywołanie = jeden wiersz; `usage_events.actual_api_cost` to suma tych samych wierszy — nigdy nie dodawane). Wywołania o nieznanym koszcie są liczone, nigdy jako $0. Brak danych = „Brak danych”, nie $0.
- **Tryby dostawców** (tylko oficjalne API, tylko odczyt, nic nie jest kupowane):

  | Dostawca | Tryb | Dlaczego |
  |---|---|---|
  | fal.ai | automatyczny | `GET /v1/account/billing?expand=credits` → saldo w USD |
  | Stability AI | automatyczny | `GET /v1/user/balance` → kredyty (1 = $0,01); obecnie brak klucza |
  | Google Gemini | postpaid | rozliczenie Google Cloud po fakcie — kwota do zabezpieczenia |
  | OpenAI, Anthropic | ręczny | brak API salda (koszty tylko przez Admin API) |
  | Photoroom, remove.bg | ręczny | API podaje kredyty obrazów, nie pieniądze |
  | Clipdrop, Higgsfield | ręczny | brak udokumentowanego API salda |

- **Rezerwa** = zapotrzebowanie × (1 + bufor, domyślnie 20 %); doładowanie = max(0, rezerwa − dostępne); scenariusz standardowy i ostrożny; ekspozycja 24 h / 7 dni / horyzont osobno.
- **Raporty**: po sprzedaży (tylko z webhooka po ZAKSIĘGOWANEJ płatności, po odpowiedzi), godzinowy (puste godziny pomijane), dzienny (23:00 Europe/Warsaw, edytowalne), alert niskich środków (deduplikacja + powtórka co N godzin). Kanały per zdarzenie: panel / e-mail / Telegram w Komunikacja → Powiadomienia (nowy kanał „Panel administratora”). Harmonogram: pg_cron `grovbase-api-reserves` (co 15 min) → pg_net → `/api/cron/reserves` (token). Błąd powiadomienia nigdy nie cofa ani nie blokuje płatności.
- **Weryfikacja na PROD**: trasa crona bez tokenu → 401, GET → 405, strona admina bez sesji → przekierowanie do logowania; ręczny tick → `200 {"via":"dispatch_token","hourly":"sent","synced":2}`, raport godzinowy zapisany w panelu. Raport dzienny 23:00 (Warszawa) wyszedł 15.11 o 22:00 UTC: panel „sent”, e-mail „sent”, Telegram „skipped” (bot nie jest podłączony w integracjach).
- **fal.ai — stan faktyczny**: synchronizacja zwraca „not_configured” i to jest prawda. Klucz fal jest zapisany jako szyfrogram sprzed Vault, a środowisko produkcyjne nie ma `APP_ENCRYPTION_KEY`, więc nie da się go odczytać ani w synchronizacji, ani w narzędziach (fal nie ma żadnego wywołania w `ai_provider_calls`). `80a43f2` sprawia, że synchronizacja odczytuje klucz dokładnie tak jak narzędzia (env → Vault → stary rekord). Żeby włączyć automatyczne saldo fal: zapisać klucz fal ponownie w panelu (AI → Dostawcy) — trafi do Vault.
- **Poprawka w trakcie** (`5ed0c82`): renderer Telegrama traktował raport finansowy jak kartę zdarzenia — 🔁 dostawało etykietę „Następna płatność”, 🧮 „Saldo po zakupie”, inne etykiety znikały, równe wartości („$0.00”) były scalane, widać było 8 wierszy. Dla `finance.*` wiersze idą teraz jako tabela (etykieta zostaje, bez scalania, do 24 wierszy); pozostałe zdarzenia bez zmian. Temat e-maila nie dostaje drugiego „— GrovBase”.

## Moduł 2 — Zmiana planu (WYŁĄCZONY)

- **Zasady** (`lib/billing/plan-change.ts`): odliczenie = min(wartość pozostałego czasu, wartość niewykorzystanych kredytów BIEŻĄCEJ puli tej subskrypcji), liczone z tego, co klient faktycznie zapłacił. Wyższy plan miesięczny / miesięczny → roczny / wyższy roczny: od razu, z odliczeniem (roczny: bieżąca transza + przyszłe transze rozliczone raz). Niższy miesięczny: od razu, pełna cena, stare kredyty do pierwotnego wygaśnięcia, bez zwrotu. Niższy roczny i roczny → miesięczny: Subscription Schedule na koniec okresu. Doładowania, bonusy i kredyty historyczne nigdy nie są liczone ani ruszane.
- **Przykład ze specyfikacji** (Starter → PRO, połowa miesiąca, 20/55 zużyte): czas $12.45, kredyty $15.84, odliczenie $12.45, do zapłaty **$37.45** — test A1 i zrzut 04.
- **Stripe** (API przypięte 2024-06-20): jedna subskrypcja (aktualizacja tej samej pozycji), `proration_behavior: none` (bez odliczenia Stripe), `billing_cycle_anchor: now` (nowy okres), `payment_behavior: pending_if_incomplete` (zmiana tylko po opłaceniu faktury). Odliczenie = jednorazowy kupon (`amount_off`, `once`, `max_redemptions 1`, tylko produkt nowego planu), dołączany osobną aktualizacją niebilingową — wersja 2024-06-20 nie przyjmuje `discounts` z `pending_if_incomplete` (dodane w 2026-05-27). Faktura sprawdzana linia po linii z wyceną; różnica = unieważnienie faktury, zdjęcie kuponu, zwolnienie puli, zgłoszenie do admina. Klucze idempotencji z id zmiany. SCA: client secret do przeglądarki (`handleNextAction` / Payment Element); kredyty wyłącznie z podpisanego webhooka (`stripe_settle_v2` z linii faktury → `plan_change_settle`). `success_url` niczego nie przyznaje.
- **Antynadużycia**: wycena ważna 15 min i ponownie wyliczana przy potwierdzeniu (odcisk); pula rezerwowana przez ledger PRZED jakimkolwiek zapisem w Stripe (celowany debet `expiration`, transze `void`); jedna aktywna zmiana na workspace (unikalny indeks); trwające generacje blokują rezerwację; sweep co 15 min najpierw unieważnia otwartą fakturę, dopiero potem zwalnia pulę; płatność po zwolnieniu ponownie zamyka zwolnione kredyty i oznacza zmianę jako „late”; nietypowe subskrypcje (rabat, harmonogram, historia proracji z portalu, podatek / saldo klienta) → ręczna obsługa + powiadomienie `finance.plan_change_review`.
- **Customer Portal**: obecnie `bpc_1UJEWVPOBRMZKbwYi8PdP3jJ` (domyślny) ma `subscription_update` WŁĄCZONE (`default_allowed_updates: [price]`, `proration_behavior: always_invoice`, `billing_cycle_anchor: unchanged`, `schedule_at_period_end: decreasing_item_amount, shortening_interval`); karta, faktury, `customer_update` i anulowanie (`at_period_end`) włączone. Moduł wyłączony = portal bez zmian. Włączenie modułu wyłącza wyłącznie `subscription_update` w każdej aktywnej konfiguracji i zapisuje poprzednią; wyłączenie ją przywraca (uwaga: `schedule_at_period_end` nie jest ustawiane przez API 2024-06-20 — po wyłączeniu modułu sprawdzić w panelu Stripe).

## Testy

| Zestaw | Wynik |
|---|---|
| `test:planchange` (nowy) | 69/69 — wszystkie scenariusze wyceny, 4000 losowych przypadków, sekwencja Stripe na atrapie, webhook, renderery, i18n |
| `test:planchange:sql` (nowy, prawdziwy Postgres na ledgerze Cennika V2) | 64/64 — rezerwacja, zwolnienie, rozliczenie, transze roczne, późna płatność, uprawnienia, RLS, inwariant |
| `test:reserves` / `:sql` | 58/58, 44/44 |
| `test:stripe`, `:sql`; `test:ledger`, `:sql`; `test:pricing`, `:sql` (98); `test:planpage` (209); `test:plancaps`; `test:pricingcards` (109); `test:notifications` (83), `:sql` (38); `test:comm`; `test:telegram`; `test:cronauth`; `test:budget`; `test:aicc`; `test:i18n:scopes`; `test:rls:initplan`; `test:authmail` | wszystkie zaliczone |
| `test:sellerhome` | tylko 4 znane wcześniej porażki (globals.css, prompt-engine, gallery, generator) |
| `i18n:check` | bez nowych braków (6 literałów z fixture, 4 znane dryfy) |
| typecheck, `next build` | OK |

Hashe `stripe-webhook.ts` przypięte na nowo z komentarzem w `plan-page-tests` i `seller-home-tests`.

## Przed włączeniem modułu 2 (blokery)

1. **Brak klucza testowego Stripe** (konto ma tylko LIVE) — nie było możliwe przejście e2e z prawdziwym 3-D Secure, odrzuceniem karty, harmonogramem i webhookiem w trybie testowym. Zasada „bez płatności LIVE” została zachowana. Potrzebne: `sk_test_…` + `whsec_…` testowego endpointu na środowisku preview i jeden przebieg: upgrade (z 3DS i bez), odrzucona karta, porzucenie (sweep), obniżka miesięczna, roczny → niższy roczny (harmonogram), roczny upgrade.
2. Sweep zmian działa z tym samym tickiem co rezerwy — wyłączenie raportów (`api_reserve_settings.enabled = false`) zatrzymuje też sweep.
3. Kredyty zwrócone (refund) na zarezerwowaną pulę PO rezerwacji zostają klientowi do wygaśnięcia tej puli (nie były w odliczeniu).

## Wycofanie

Moduł 2: wyłącznik (stan obecny). Pełne usunięcie — komentarz ROLLBACK w `0181_plan_changes.sql`. Moduł 1: wyłącznik w ustawieniach rezerw albo `select cron.unschedule('grovbase-api-reserves')`; pełne — komentarz ROLLBACK w `0180_api_reserves.sql`. Kod: revert `896cb75` / `5ed0c82` / `80a43f2` / `0e3181c`.

## Weryfikacja po wdrożeniu modułu 2 (`dpl_FV1yWcxcb1ZXcJchqS4EDTBLSfG5`, READY → grovbase.com)

- Tick pg_cron 02:48 i 03:00 UTC → `200`, `"plan_changes":{"released":0,"skipped":0}` (sweep działa), o 03:00 `hourly: skipped_empty`, `synced: 2`.
- `/plany` 200 (gość: 0 przycisków zmiany planu), `/plan` i `/admin/finance/zmiany-planow` bez sesji → logowanie.
- PROD po wdrożeniu: flaga `{"enabled": false}`, `plan_changes` 0 wierszy, salda 488 / 1 124 / 49 743,75 (bez zmian), inwariant 0 rozbieżności, Customer Portal bez zmian.
- Błędy runtime (8 h): 0.
- Notion: strona nie została utworzona — przestrzeń Notion wyczerpała limit darmowych bloków; dokumentacja jest w `CLAUDE.md` i tym pliku.

