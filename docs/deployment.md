# Deployment

## Jak produkcja dostaje kod

```
branch → GitHub (EcomStudio-PL/EcomStudio) → main → Vercel „ecomstudio-prod" → grovbase.com
```

Produkcyjny projekt to **`ecomstudio-prod`** (`prj_Z8H5WAexovMwjbpqersDJ2AbP7yH`). To on ma
`grovbase.com`, `www.grovbase.com`, komplet zmiennych środowiskowych i Function Region
`fra1` obok bazy w `eu-central-1`. Production Branch: **`main`**.

## Dwie pułapki, które kosztowały jeden cały update

Obie były ciche. Żadna nie dawała objawu w aplikacji, obie sprawiały, że praca
wyglądała na wdrożoną i nie była.

**1. Istnieje drugi projekt o mylącej nazwie.** `ecomstudio` (bez `-prod`) też jest
podłączony do tego samego repo i też buduje się przy każdym pushu — ale ma wyłącznie
adresy `*.vercel.app` i **zero zmiennych środowiskowych**. Zielony build tam nie znaczy
nic dla grovbase.com. Jego produkcyjny build pada z premedytacją:

```
Supabase is not configured for production … refusing to fall back to the development project
```

To jest zabezpieczenie z `lib/supabase/config.ts`, nie awaria — deployment czytający nie tę
bazę wygląda identycznie jak działający, więc build ma się wtedy wywalić, a nie zgadywać.
**Nie wklejaj tam produkcyjnych sekretów, żeby „naprawić" ten build.**

**2. Install Command projektu to `bash setup.sh`.** Pliku nie było w repo przez całą jego
historię, więc każdy build z gita umierał na pierwszej linii z kodem 127 — jedenaście
deploymentów pod rząd, wszystkie czerwone, nikt tego nie widział, bo produkcję
aktualizowano wtedy ręcznym payloadem plików, który tej komendy nie uruchamia.
`setup.sh` w katalogu głównym spełnia ten kontrakt i robi to, co zrobiłby krok domyślny.
Jeżeli ktoś kiedyś wyczyści Install Command w dashboardzie, plik może zniknąć.

**3. Install Command zaczął klonować `main` i nadpisywać checkout.** Ustawienie w
dashboardzie brzmiało:

```
git clone --depth 1 -b main <repo> _src && cp -a _src/. . && rm -rf _src && npm install
```

`cp -a` nadpisuje pliki, ale niczego nie kasuje — więc **każdy build był w rzeczywistości
buildem `main`** plus te pliki, które istniały wyłącznie w commicie wyzwalającym. Dwa
skutki, oba ciche:

- preview gałęzi nigdy nie testował tej gałęzi, więc zielony preview nie znaczył nic;
- gałąź, w której nowy moduł korzystał z czegoś dodanego w tym samym commicie, padała na
  błędzie typów definicji, której `main` jeszcze nie miał. Dokładnie tak umarło pierwsze
  podejście do globalnej wyszukiwarki: `lib/server/tool-popularity.ts` przetrwał kopiowanie,
  a typy RPC, których potrzebuje, zostały nadpisane wersją z `main`.

Poprawna komenda jest teraz w **`vercel.json`** (`"installCommand": "npm ci"`), a nie w
dashboardzie: `vercel.json` ma pierwszeństwo, leży w repo, przechodzi review i jest
wersjonowany razem z kodem, który buduje. `npm ci` zamiast `npm install`, bo lockfile jest
w repo i build nigdy nie powinien rozwiązać innego drzewa zależności niż to przetestowane.

Jeżeli kiedykolwiek zobaczysz błąd typów na Vercelu, którego nie ma lokalnie po
`rm -rf node_modules .next && npm ci` — najpierw sprawdź pierwsze linie build logu i to,
jaką komendą instalacyjną build się posłużył.

## Zmienne środowiskowe — czego wymaga produkcja

Ta sekcja istnieje, bo brak zmiennej **nie wygląda jak awaria**. Aplikacja
wstaje, strony się renderują, build jest zielony — a zadanie, które od niej
zależy, po prostu nigdy się nie wykonuje. Każdy wiersz mówi, co dokładnie
milknie, żeby nie trzeba było tego odkrywać po miesiącu.

| Zmienna | Bez niej |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Build produkcyjny celowo pada (`lib/supabase/config.ts`) zamiast wejść na bazę deweloperską. Ta sama wartość wyznacza projekt, do którego idzie synchronizacja Auth, i jedyny host dozwolony dla optymalizatora obrazów. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Jak wyżej — build pada. |
| `GROVBASE_SERVER_KEY` | Wszystkie ścieżki bez sesji odmawiają: potwierdzenie zapisu na listę, hook pocztowy Supabase, captcha, klucze dostawców w generacji, rozliczanie porzuconych `usage_events`, sprzątanie wygasłych blokad. Panel admina działa dalej (te operacje autoryzuje `is_admin()`), więc objaw widać tylko u klienta i w harmonogramie. |
| `CRON_SECRET` | **Cały dzienny harmonogram nie rusza.** `vercel.json` woła `/api/cron/mail`, planista nie ma sesji, a bez tej zmiennej trasa odpowiada 401, zanim dojdzie do jakiejkolwiek pracy — poczta, tygodniowy ranking narzędzi i sprzątanie blokad milkną razem. To poprawna odmowa, nie błąd do obejścia: bez sekretu nic nie odróżnia planisty od przypadkowego gościa. Nie ma na to obejścia w kodzie — zmienna musi być ustawiona. |
| `SUPABASE_MANAGEMENT_TOKEN` | Synchronizacja ustawień Auth (Site URL, lista przekierowań, szablony, SMTP) zostaje ręczna. Panel mówi to wprost. |

Dwie rzeczy warto sprawdzić po każdym deployu produkcyjnym, bo żadna nie
zgłosi się sama:

1. czy `/api/cron/mail` odpowiada 200 na żądanie planisty (a nie 401);
2. czy `app_settings.tool_popularity` ma niepuste `computed_at` — dopóki jest
   `null`, tygodniowy ranking nigdy nie policzył się w produkcji i wyszukiwarka
   pokazuje kolejność z rejestru, oznaczoną jako `fallback`.

## Zasady

- **Produkcja bierze kod wyłącznie z `main`.** Gałąź robocza daje preview, nie produkcję.
- **Zielony build to nie to samo co zweryfikowana produkcja.** Po deployu sprawdź SHA
  faktycznie serwowanego deploymentu, a potem funkcję na żywym adresie — nie na preview,
  nie lokalnie, nie „bo testy przeszły".
- **Nie redeployuj starego deploymentu payloadowego**, żeby „odświeżyć" produkcję. To
  wystawia z powrotem kod sprzed migracji do gita.
- Migracje bazy jadą osobno, przez `supabase/migrations/` — deploy Vercela ich nie rusza.
