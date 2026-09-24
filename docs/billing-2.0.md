# Billing 2.0 — wewnętrzny checkout + synchronizacja cennika GrovBase ↔ Stripe

**Stan: wdrożone na produkcję.** Commit `9813c98`. Migracje `0117` i `0118` zastosowane na PROD
(`orjkxijqpecnbzhxhfct`).

> Ten dokument **rozszerza**, nie zastępuje, notatki „STRIPE LIVE — integracja płatności"
> (Notion, 2026-09-21). Wszystkie zapisane tam inwarianty **nadal obowiązują i nie zostały
> zmienione**.
>
> Powstał w repo, a nie w Notion, ponieważ workspace Notion wyczerpał limit bloków w planie
> darmowym i utworzenie strony zostało odrzucone. Treść jest gotowa do wklejenia.

## 1. Błąd architektoniczny, który zamknięto

`savePlanFullAction`, `updatePlanAction` i `savePackageAction` zapisywały `price_cents` prosto do
Postgresa i **nigdy nie rozmawiały ze Stripe**. Obiekt Stripe Price — ten, który faktycznie
decyduje, ile zostanie pobrane z karty — zachowywał starą kwotę.

```
admin zmienia      49 zł → 59 zł
GrovBase pokazuje  59 zł
Stripe pobiera     49 zł
```

Cicho, i na korzyść sprzedawcy. Nic tego nie wykrywało, bo jedna liczba była tutaj, a druga tam,
i nic ich nie porównywało.

**Zweryfikowano przed naprawą:** w dniu wdrożenia żywy cennik **zgadzał się** ze Stripe we
wszystkich 7 zmapowanych cenach. Błąd był **utajony**, nie zrealizowany — ujawniłby się przy
pierwszej edycji ceny.

### Dlaczego to nie jest „zaktualizuj cenę w Stripe"

Stripe Price jest **niezmienny** w `unit_amount`, z założenia. Subskrypcje i faktury wskazują NA
Price; pozwolenie, by zmienił się wstecz, przepisywałoby to, na co klienci już się zgodzili.
Poprawny przepływ to nowy obiekt na tym samym Produkcie.

## 2. Model danych (migracja 0117)

| Kolumna | Tabela | Znaczenie |
| --- | --- | --- |
| `stripe_price_cents` | `credit_packages` | Kwota, którą niesie **żywy** Stripe Price, zapisana dopiero gdy Stripe potwierdził |
| `stripe_price_monthly_cents` | `subscription_plans` | j.w., cena miesięczna |
| `stripe_price_annual_cents` | `subscription_plans` | j.w., cena roczna |
| `stripe_sync_status` | obie | `unknown` / `syncing` / `synced` / `failed` / `reconcile` |
| `stripe_synced_at` | obie | Kiedy potwierdzono |
| `stripe_sync_error` | obie | Powód niepowodzenia, bez sekretów |

**To NIE są duplikaty `price_cents`.** To dwie liczby z dwóch systemów, obok siebie w jednym
wierszu — jedyny układ, w którym „GrovBase mówi 59, Stripe mówi 49" jest czymś, co zapytanie
potrafi znaleźć, test potrafi obalić, a checkout potrafi odmówić.

### Funkcje i widok

- `stripe_apply_price(...)` — SECURITY DEFINER, bramkowana `server_call_ok(p_token)`. Zapisuje
  **wyświetlaną kwotę, id Stripe i kwotę potwierdzoną w JEDNEJ instrukcji**. Zwraca
  `previous_price_id`, żeby wywołujący wiedział, co zarchiwizować.
- `stripe_mark_price_sync(...)` — tylko status i błąd; **nigdy** nie zmienia kwoty.
- `stripe_payment_status(...)` (0118) — tylko odczyt, dla ekranu statusu. Nie ma argumentu, który
  by cokolwiek przyznał.
- `public.stripe_price_drift` — widok (`security_invoker`): pozycje cennika, których wyświetlana
  cena nie jest dowodliwie ceną Stripe. **Pusty = inwariant trzyma.** Dziś pusty.

## 3. Kolejność operacji — cały argument bezpieczeństwa

Nie ma transakcji obejmującej Stripe i Postgresa. Nie może być. Kolejność dobrano tak, by **każde**
przerwanie zostawiało stan bezpieczny, a „bezpieczny" znaczy: nikt nigdy nie zostaje obciążony
kwotą, której GrovBase nie pokazał.

1. oznacz `syncing` — awaria od tego miejsca jest **widoczna**, nie domniemana
2. utwórz nowy Price w Stripe ← krok, który może się nie udać
3. `stripe_apply_price(...)` — jedna atomowa zapisana lokalnie
4. zarchiwizuj stary Price — best effort

- **Stripe przed Postgresem**, bo awaria Stripe musi zostawić cenę GrovBase dokładnie taką, jaka
  była. Zapis do Postgresa najpierw odtwarzałby pierwotny błąd celowo, w ścieżce awaryjnej.
- **Awaria kroku 3** → Stripe trzyma Price, do którego nic nie wskazuje (martwy, bo checkout nie
  sięgnie po id, którego nigdy nie zapisano), wiersz zostaje `syncing`, osierocony Price jest
  archiwizowany.
- **Awaria kroku 4** → inwariant klienta nadal trzyma: nowe zakupy idą na nowe id. Dlatego nieudana
  archiwizacja to notatka, nie status.

### Klucz idempotencji zawiera zastępowany Price

Klucz „ta pozycja w tej kwocie" byłby zły w sposób, który ujawnia się po dobie: admin idący
49 → 59 → 49 w 24-godzinnym oknie klucza Stripe dostałby z powrotem **PIERWSZY** Price 49, który
krok 4 zarchiwizował — i checkout wskazywałby na zarchiwizowany Price.

## 4. Wewnętrzny checkout

`/checkout` obsługuje wszystkie trzy rzeczy, które GrovBase sprzedaje, jednym kodem:

```
/checkout?kind=subscription&plan=<uuid>&period=monthly
/checkout?kind=package&pack=<uuid>
/checkout?kind=credits&n=2500
```

**Query string to intencja, nie cena.** Nie ma w nim kwoty i żadna nie jest przyjmowana.

| Co | Jak |
| --- | --- |
| Pakiet / doładowanie | `PaymentIntent`, `automatic_payment_methods[enabled]=true` |
| Plan | `Subscription` z `payment_behavior=default_incomplete`, `expand[]=latest_invoice.payment_intent` |
| Do przeglądarki | **wyłącznie** `client_secret` + klucz publikowalny |
| Dane karty | Stripe iframe → Stripe. Nasze serwery nigdy ich nie widzą |

**Metody płatności wybiera Stripe**, nie my — per urządzenie, kraj, waluta, kwota i konfiguracja
konta. Lista na sztywno oferowałaby BLIK przy subskrypcji (Stripe na to nie pozwala) i Apple Pay
na pulpicie z Windows, i wymagałaby deployu przy każdej zmianie w Dashboardzie.

### Bramka parytetu ceny w czasie rzeczywistym

`sellable()` sprawdza **każdy** quote: czy kwota potwierdzona przez Stripe nadal równa się kwocie
wyświetlanej. Niezgodność **odmawia sprzedaży** (`price_out_of_sync`). Wiersz ze statusem innym niż
`synced` też nie jest na sprzedaż — w tym każdy wiersz sprzed tej migracji, dopóki synchronizacja
go nie potwierdzi.

## 5. Inwarianty — bez zmian, potwierdzone testami

- **Kredyty zmienia wyłącznie podpisany webhook** → `stripe_settle_payment()` →
  `apply_credit_transaction()`. Ścieżka rozliczenia **nie była zmieniana** — nowe metadane napisano
  tak, by pasowały do tego, co webhook już czyta.
- `success_url` / `return_url` / callback frontendu **nie przyznają niczego**.
- Liczba kredytów pochodzi z **bazy**, nie z metadanych Stripe (wyjątek: custom credits, których
  kwotę policzył ten serwer).
- Dwuwarstwowa idempotencja: `payment_events.stripe_event_id` + `payments UNIQUE(provider,
  provider_payment_id)`.
- Brak klienta service-role. Dispatch token sprawdzany wewnątrz SECURITY DEFINER.

## 6. Subskrypcje — zmiana ceny NIE dotyka istniejących klientów

Zmiana ceny planu dotyczy **nowych** zakupów. Kto kupił za 299 zł, zostaje na obiekcie Price, który
kupił — bo **zarchiwizowany Price nadal działa dla subskrypcji już na nim**, i to jest właśnie
zachowanie, które ich chroni.

Przeniesienie istniejących klientów to **osobna** akcja (`migrateSubscriptionPriceAction`):
niezaznaczona domyślnie, pokazuje liczbę objętych subskrypcji oraz starą i nową kwotę, wymaga
jawnego wyboru proracji (`create_prorations` / `none` — nie ma bezpiecznego domyślnego) i drugiego
potwierdzenia, a przed wykonaniem **ponownie czyta liczbę** i odmawia, jeśli się zmieniła — admin
nie może potwierdzić liczby, której nie widział.

Podmiana ceny idzie przez **item** subskrypcji (`items[0][id]` + `items[0][price]`). Ustawienie
ceny bez id itemu utworzyłoby DRUGI item i naliczało oba.

## 7. Faktury — co system NAPRAWDĘ robi

Dane firmowe zbierane w checkoucie trafiają do **`billing_profiles`** — tego samego wiersza, który
zapisuje ekran Ustawień. Jeden magazyn, więc adres zmieniony w jednym miejscu jest adresem
używanym przez drugie.

> **Copy mówi to, co system robi:** dane zapisane i przekazane do Stripe, potwierdzenie zakupu
> e-mailem. **Nie mówi „Faktura VAT"**, bo GrovBase nie wystawia numerowanej polskiej faktury VAT.
> Napisanie tych słów przy checkboxie byłoby obietnicą, której produkt nie dotrzymuje.

## 8. Otwarte pozycje dla operatora

1. **`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` nie jest ustawiony w Vercel.** Bez niego Payment Element
   się nie zamontuje. **Do czasu dodania klucza checkout automatycznie cofa się do hostowanego
   Stripe Checkout** — płatności działają, tylko arkusz jest na stronie Stripe. Klucz publikowalny
   jest z założenia jawny; `lib/stripe/publishable.ts` odmawia przyjęcia czegokolwiek, co nie ma
   kształtu `pk_`, żeby literówka w nazwie zmiennej nie opublikowała klucza sekretnego.
2. **P24 (Przelewy24) i Google Pay są WYŁĄCZONE** w konfiguracji metod płatności
   (`pmc_1UIBdUPOBRMZKbwY1IXD2gfh`). Włączone: `card`, `blik`, `apple_pay`, `link`, `klarna`.
   Włączenie wymaga Dashboardu Stripe — **nie wymaga zmiany kodu**; `automatic_payment_methods`
   podchwyci je samo.
3. **BLIK nie jest dostępny dla płatności cyklicznych** — potwierdzone empirycznie na tym koncie
   (sesje w trybie `subscription` rozwiązywały się do `[card, link, klarna]`, w trybie `payment`
   do `[card, blik, link, klarna]`). Działa dla pakietów i doładowań.
4. Webhook `we_1UIFYlPOBRMZKbwY1IZVDJ43` **nie ma przypiętej wersji API** (`api_version: null`),
   więc podąża za domyślną wersją konta. Handler czyta oba kształty faktury obronnie, więc to
   działa — ale warto przypiąć.

## 9. Testy

`npm run test:billingsync` — nowy zestaw, 90+ asercji. Nic nie dotyka prawdziwego Stripe ani bazy:
`globalThis.fetch` jest podmieniony na nagrywającą atrapę odpowiadającą jak REST API Stripe, więc
**prawdziwy** `syncPrice`, **prawdziwy** enkoder i **prawdziwa** kolejność są wykonywane.

Pokrycie: nowy Price + archiwizacja starego · reużycie Produktu · brak wywołania gdy nic się nie
zmieniło · awaria Stripe → cena GrovBase bez zmian · awaria Postgresa → nic nie jest na sprzedaż po
niezweryfikowanej cenie · Stripe zwraca inną kwotę → odmowa · `sellable()` · custom credits liczone
po stronie serwera · subskrypcje · **§26 parytet ceny co do grosza** · sekrety · webhook nadal
jedynym źródłem przyznania.

> **Test parytetu (§26):** dla 5 kwot sprawdza, że *kwota admina = kwota wysłana do Stripe = kwota
> wyświetlana = kwota potwierdzona*, oraz że **różnica jednego grosza** zostałaby wychwycona.

## 10. Czego NIE zweryfikowano

- **Prawdziwej płatności nie wykonano.** Konto jest LIVE; nie obciążono żadnej karty. `payments`,
  `payment_events`, `subscriptions` pozostają puste.
- Renderu Payment Element z prawdziwym `client_secret` — wymaga klucza publikowalnego i zalogowanej
  sesji przeglądarkowej.
- Faktycznej listy metod w arkuszu — to wybiera Stripe w czasie wykonania.
