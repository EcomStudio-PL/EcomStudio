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

## Zasady

- **Produkcja bierze kod wyłącznie z `main`.** Gałąź robocza daje preview, nie produkcję.
- **Zielony build to nie to samo co zweryfikowana produkcja.** Po deployu sprawdź SHA
  faktycznie serwowanego deploymentu, a potem funkcję na żywym adresie — nie na preview,
  nie lokalnie, nie „bo testy przeszły".
- **Nie redeployuj starego deploymentu payloadowego**, żeby „odświeżyć" produkcję. To
  wystawia z powrotem kod sprzed migracji do gita.
- Migracje bazy jadą osobno, przez `supabase/migrations/` — deploy Vercela ich nie rusza.
