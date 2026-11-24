# GrovBase Shot – baza wiedzy silnika lifestyle

Wersja: 4.3 TESTOWA · 23.11.2026 (na podstawie v4.2 z 21.11.2026; dodano krótkie bloki obrazu dla 13 flag, NIEAKTYWOWANA)  (raczki: nowa reguła kategorii, styl kinowy dla flagi raczki za zgodą użytkownika, błąd buta na pierwszym planie, 2 zestawy wzorcowe; stacja ClimatiQ: podświetlenie 2 ujęciami, ostrzeżenia sceną-dowodem, zestaw wzorcowy – w regule ekranów; stacja pogodowa Daily600M: styl kinowy rozszerzony na flagę ekran (za zgodą), skala małych urządzeń, zestaw wzorcowy – w regule ekranów; kojec zadaszony niski: skala niskich kojców i zestaw wzorcowy – w regule kojca; klatka piętrowa z drutu: liczenie paneli przeciw dziurom, położenie drzwiczek – w regule kojca; kojec przezroczysty SONGMICS: czytelność przezroczystego produktu i zestaw wzorcowy – w regule kojca; NAPRAWA: styl kinowy zawężony do flag drabinka i kojec; przywrócone globalne stopki, Negative bazowy, wzorzec promptu i reguła hero sprzed zmian; zasada: zmiany globalne tylko po akceptacji; kojec modułowy ART-2278: reguła kojców/klatek z drutu, kontrast czarnej siatki na jasnym gładkim tle, zestaw wzorcowy; drabinka EASYSTEP 4-stopniowa: zestaw wzorcowy, poza i proporcje człowieka przez zdjęcie sprzedawcy, osoba na przedostatnim stopniu; drabinka EASYSTEP 3-stopniowa: przełomowy styl kinowy – zestaw wzorcowy, moduły ŚWIATŁO I KOLOR + SCENOGRAFIA I PALETA, look Arri/Portra, kąt hero opisany słownie; styl kinowy z art direction kolorów zamiast subtelnego gradingu; drabinka 3-stopniowa: skala przez blat, zamknięty wierzchołek; EASYSTEP: balans koloru – złoty środek między przesadą a płaskością, zestaw stołka 2-stopniowego, ujęcie zewnętrzne, hero w kącie referencji; drabinka 4-stopniowa: reguła drabinek z wzorcowym planem, liczba stopni, sens użycia, premium bez sterylnego minimalizmu, rozkład tonacji i kolorów w zestawie; czarny stół składany: czarny produkt, jeden stół zamiast dwóch, cały produkt w kadrze, naturalne światło z kierunkiem; lekcje ze słuchawki KANZA, stacji pogodowej MalTec, piaskownicy w walizce, krzesła składanego KANZA, promiennika gazowego KANZA i stołu składanego 200 × 90: stoły składane z wzorcowym planem, skala dużych mebli przez kotwice, wysokość mebla w zbliżeniach, biały produkt; przepis ogien_plener z wzorcowym planem, transport na kółkach, prowadzenie przewodów, jedna tonacja detali w serii, pełne lokale; meble składane z wzorcowym planem, stabilność mebli, otwory ślepe vs przelotowe, kąt kamery w detalu 1:1, różne miejsca dla produktów wielozastosowaniowych, obsada bez powtarzania cech; zachowanie materiału, pojemniki otwierane, nasycone kolory, skala małych elementów, energia w ujęciach z dziećmi; wszystkie strony produktu, komponenty od sprzedawcy, skala przy ludziach, geometria części, funkcja z nietypowego miejsca, limit prób, urządzenia ręczne wielotrybowe, ekrany i wyświetlacze, wtopienie produktu w scenę)
Opis zmiany: pełna przebudowa – wszystkie lekcje z ok. 30 produktów testowych zebrane w reguły, jedna tabela przepisów, rozstrzygnięte sprzeczności, aktualny wzorzec promptu, stopki i negative bazowy.

Plik ma stałe nagłówki drugiego poziomu. Kod wycina dosłownie: bloki KIERUNEK z sekcji „Przepisy stylu”, sekcję „Stopki” i sekcję „Negative bazowy”. Resztę pliku wkleja do instrukcji modeli w krokach 2–4 (karta produktu, plan ujęć, prompty).

---

## Zasady nadrzędne

1. Cel: zdjęcia do galerii wewnątrz aukcji (nie miniatura na białym tle) na poziomie kampanii dużych marek – każde ujęcie wygląda jak klatka ze spotu reklamowego, nie jak stock ani zdjęcie katalogowe.
2. Zdjęcie pokazuje moment z życia, w którym produkt daje korzyść, sfotografowany jak kadr z filmu – nie produkt w ładnym pokoju.
3. Wierność produktu jest ważniejsza niż piękno sceny. Produkt na zdjęciu = produkt w paczce: kształt, budowa, liczba elementów, kolory, napisy, skala.
4. Uczciwość: nie pokazujemy cech, akcesoriów, efektów ani skali, których produkt nie ma. Akcesorium spoza zestawu tylko wtedy, gdy bez niego nie da się pokazać działania (np. worki w stojaku), i wtedy gładkie, bez marki.
5. Każde ujęcie ma jeden argument sprzedażowy z opisu albo ze zdjęć sprzedawcy.
6. Wszystko, co silnik ustala, ma być konkretne (liczby, kolory, materiały, centymetry, kąty), nie przymiotnikowe.
7. Korekty z jednej kategorii nie nadpisują przepisu innej kategorii. Najpierw przepis kategorii, potem reguły specjalne włączane flagami.
8. Silnik nie edytuje gotowych zdjęć. Zły wynik = ponowna generacja z tym samym promptem. Poprawka promptu = zawsze pełny, nowy prompt, nigdy dopiski.

---

## Karta produktu

Krok 2 tworzy kartę (JSON) z polami poniżej. Wszystkie dalsze kroki czytają kartę, nie zdjęcia i opis.

| Pole | Zawartość |
| --- | --- |
| produkt | czym jest, wariant, kolor, liczba sztuk w zestawie |
| wymiary | z opisu; brak = założenie ze zdjęć oznaczone jako założenie |
| skala | 2–3 kotwice znane modelowi (dłoń, kartka A4, kubek, butelka 0,5 l, piłka, siedzisko krzesła 45 cm, stół 75 cm, kolano, łydka) |
| budowa | elementy w kolejności od dołu lub od przodu, liczby („DOKŁADNIE 3 pokrywy”), kształty, materiały, faktury, kolory każdego elementu |
| napisy i logo | co jest na produkcie i ma zostać; reszta = brak napisów |
| stany | stany produktu (złożony, otwarty, świeci, w pokrowcu) i które zdjęcie pokazuje który |
| zdjęcia | dla każdego zdjęcia: rola (całość / detal / użycie / infografika / opakowanie), widok, stan, elementy obce do zakazu kopiowania (ludzie, rośliny, grafiki, strzałki, wymiary, inne logo) |
| cechy | lista cech ze WSZYSTKICH zdjęć i opisu, także z infografik odrzuconych jako referencje |
| argumenty | argumenty sprzedażowe, po jednym na ujęcie |
| zastosowania | miejsca i sytuacje użycia z opisu |
| grupa docelowa | kto kupuje i używa, wiek, poziom (np. 30 kg = zaawansowani) |
| uczciwość | ograniczenia: IP, wiek dziecka, waga zwierzęcia, brak wody, tylko dorosły w pobliżu, zalecenia z FAQ (mata pod żeliwem, materiał między skórą a ogrzewaczem) |
| sezon | sezon produktu i sezon użycia |
| ryzyka | co model typowo psuje przy tym produkcie (rośnie, gubi elementy, zmienia kolor, dorabia logo) |
| flagi | flagi włączające reguły specjalne (lista w sekcji „Reguły specjalne”) |
| przepis | id przepisu stylu |
| blok produktu | jeden stały opis produktu (patrz „Wzorzec promptu”), identyczny we wszystkich ujęciach z całym produktem |
| do zgłoszenia sprzedawcy | niezgodności opisu ze zdjęciami i realne ryzyka reklamacji (np. „transporter” bez uchwytu, 7 µm jako „gruba folia”, waga w tytule ≠ w parametrach, zdjęcia z obcej aukcji, inne logo na części zdjęć) |

---

## Przepisy stylu

Każdy przepis ma id, kategorie, blok KIERUNEK (wklejany na początek promptu), zasady światła i scenografii oraz dopiski do negative. Scenografię silnik dobiera osobno i różnorodnie w każdym ujęciu. Blok KIERUNEK nigdy nie opisuje konkretnego miejsca.

### dom_ikea
Kategorie: produkty domowe codziennego użytku, organizacja, stojaki, kosze, czujniki i produkty bezpieczeństwa, drobne wyposażenie.
```
KIERUNEK: kampania lifestyle marki wyposażenia domu w stylu IKEA – jasny, ciepły, zamieszkany dom, ludzie w trakcie codziennej czynności. Prawdziwe zdjęcie, nie render (raw photo).
```
Światło: jasne, naturalne światło dnia z kontrolowaną ekspozycją albo ciepłe lampy wieczorem; noc i półmrok najwyżej w 1–2 ujęciach i zawsze z ciepłymi źródłami.
Zasady: pełne, zamieszkane wnętrza z kolorowymi akcentami; różne miejsca (kuchnia, balkon, taras, garaż, biuro); produkty pasywne (czujniki, zamki) sprzedają życie, które chronią – ludzie w centrum, pozytywna emocja, zagrożenie najwyżej w 1 ujęciu i pokazane spokojną reakcją.
Negative: puste showroomowe wnętrze, prześwietlone okna.

### wnetrza_premium
Kategorie: meble, duże wyposażenie, tekstylia wnętrzarskie.
```
KIERUNEK: kampania premium marki meblowej, kinowe światło późnego popołudnia. Prawdziwe zdjęcie, nie render (raw photo).
```
Światło: niskie słońce przez duże okna, smugi i cienie ramy okiennej na produkcie, reszta w miękkim półcieniu, ciepła lampa jako akcent.
Zasady: przestrzeń z charakterem dobrana do materiału (koniakowa skóra = loft: cegła, czarna stal, beton, okna szprosowe); dużo powietrza nad meblem; niski kadr 3/4; pełny kadr z 5–6 mocnych elementów; klasa wnętrza zgodna z ceną; niski salon z gładką szarą ścianą i frontalny kadr = tani wygląd. Skóra: „matowo-satynowa, naturalne usłojenie, zmarszczki na poduchach”. Liczbę poduch i zagłówków wpisywać wprost.
Meble i siedziska (krzesła, stołki, ławki) – zawsze stabilnie: nogi pionowo na podłożu, bez przechyłu, bujania i odrywania nóg; człowiek siedzący w ujęciu od dołu wygląda, jakby się przewracał – spód pokazujemy na pustym meblu, kamera dokładnie pionowo, w tle niebo, korony drzew lub dach dla perspektywy. Pusty mebel na pierwszym planie i życie w tle = katalog; klatka ze spotu wymaga ruchu i emocji tuż przy meblu (ktoś właśnie wstaje do tańca, dziecko przebiega obok, konfetti, bańki).
Negative: niski pokój, gładka szara ściana, błyszcząca plastikowa skóra, ekoskóra.

### agd_jedzenie
Kategorie: AGD kuchenne, akcesoria kuchenne, folie, krajalnice, pojemniki na żywność.
```
KIERUNEK: reklama premium marki AGD kuchennego, food styling. Prawdziwe zdjęcie, nie render (raw photo).
```
Światło: kierunkowe z boku i kontra; refleksy na stali i folii; tło ciemniejsze niż produkt; poranek, dzień, wieczór z lampą, złota godzina przy grillu.
Zasady: produkt najjaśniejszy w kadrze; jedzenie złociste, soczyste, z fakturą; każde ujęcie z jedzeniem ma ruch (para pod światło, dym, krople, spadające kawałki); pozy ze zdjęć sprzedawcy kopiowane 1:1; jeden kreatywny punkt widzenia (np. z wnętrza lodówki); przy produkcie bez własnego kształtu (folia) referencja tylko do wyglądu materiału; okienko urządzenia z jedzeniem w środku podświetlone jako najjaśniejszy punkt.
Negative: przypalone jedzenie, plastikowe jedzenie, fartuch kucharza, kuchnia restauracyjna.

### home_care
Kategorie: sprzątanie, czystość.
```
KIERUNEK: reklama premium marki środków czystości. Prawdziwe zdjęcie, nie render (raw photo).
```
Światło: jasne, ale kinowe – słońce z boku lub zza obiektu, kontra, połysk.
Zasady: akcja i ruch; efekt czyszczenia przez kontrast (kurz na ciemnym blacie, smugi na czarnej płycie); przed i po w jednym kadrze; kamera nisko przy powierzchni.
Negative: przesadny brud, uniform sprzątaczki.

### lazienka
Kategorie: armatura, prysznice, akcesoria łazienkowe.
```
KIERUNEK: reklama premium marki armatury łazienkowej, kinowy półmrok. Prawdziwe zdjęcie, nie render (raw photo).
```
Światło: ciemna łazienka, jedno ciepłe światło z boku i mocna kontra – strumień wody i para świecą.
Zasady: łazienki z charakterem (ciemny mikrocement, lastryko, zielone płytki, drewno); woda w kontrze w każdym ujęciu z wodą; ludzie od ramion w górę albo tyłem, bez nagości; funkcja ukryta w środku = przekrój techniczny; kilka sztuk obok siebie z różnym działaniem zamiast kolażu; słuchawka w uchwycie już osadzona albo w jednej dłoni; hero słuchawki prysznicowej = osadzona w uchwycie na ścianie pod prysznicem, z lecącą wodą (słuchawka w dłoni przed kamerą jako hero nie ma sensu).
Negative: sterylna pastelowa łazienka, złożone lniane ręczniki, nagość.

### kinowy_przemyslowy
Kategorie: narzędzia, elektronarzędzia, sprzęt ochronny, warsztat, motoryzacja.
```
KIERUNEK: kinowa kampania reklamowa marki elektronarzędzi, styl reportażowy w warsztacie. Prawdziwe zdjęcie, nie render (raw photo).
```
Światło: ciemny warsztat, twarde światło kluczowe z boku, mocna kontra z tyłu, chłodne tło z ciepłym akcentem.
Zasady: produkt dominuje kadr z bardzo niskiego kąta (50–80% kadru); człowiek częściowy (dłonie, przedramię, profil); pył, wióry, drobiny rdzy, mgiełka podświetlone w powietrzu; prawdziwe zużycie i kurz; efekt działania realny, nie poświatą; silnik bezszczotkowy = bez iskier; ujęcia sezonowe trafione w czas (wymiana kół na zimowe w listopadzie).
Negative: jasny sterylny garaż, twarz na wprost w środku kadru, iskry przy bezszczotkowych.

### ogrod_plener
Kategorie: ogród, narzędzia ogrodowe, worki, meble ogrodowe.
```
KIERUNEK: kampania marki ogrodowej, polski ogród przy nowoczesnym domu. Prawdziwe zdjęcie, nie render (raw photo).
```
Światło: ostre, czyste słońce i głęboko niebieskie niebo albo niskie słońce z kontrą; taras wieczorem z girlandą żarówek.
Zasady: kamera przy samej trawie, rozmyte źdźbła na pierwszym planie; produkt duży i dominujący; nowoczesny polski dom różny w każdym ujęciu; ogrody pełne i zamieszkane (rabaty, donice, meble, zabawki, rower, wąż); ludzie w odzieży roboczej w beżu i oliwce, w skupieniu; materiał w ruchu w kontrze; przed i po na jednej powierzchni.
Negative: amerykański dom z cegły, podjazd z garażem na dwa auta, pusty trawnik z żywopłotem.

### outdoor_akcja
Kategorie: sprzęt outdoorowy, turystyka, zabawki RC, odzież zimowa, ogrzewacze, termosy.
```
KIERUNEK: kinowa kampania marki outdoorowej. Prawdziwe zdjęcie, nie render (raw photo, 35mm film).
```
Światło: złote, niskie słońce z kontrą, niebieska godzina, mglisty świt.
Zasady: epicki plener (góry, jezioro, stok, las); kamera przy ziemi; para oddechu, śnieg, kurz, mgła i para z napojów podświetlone w kontrze; rumiane policzki, szron na ubraniu; ludzie blisko kamery z emocją (ulga, radość) albo tylko dłonie i fragmenty sylwetek; zwykłe spokojne sceny (pomost, ulica) przy małym produkcie = za zwyczajnie.
Negative: logo na ubraniach i sprzęcie, słońce w centrum kadru, przesadna flara.

### zwierzeta
Kategorie: akcesoria dla zwierząt, legowiska, kojce, drapaki.
```
KIERUNEK: kampania lifestyle premium marki akcesoriów dla zwierząt. Prawdziwe zdjęcie, nie render (raw photo).
```
Światło: miękkie, ciepłe przez firany, zapalone lampy.
Zasady: zwierzę bohaterem, kamera na wysokości jego oczu; wnętrze przytulne; rasa zgodnie z regułą „Zwierzęta”; wielkość zwierzęcia z wymiarów produktu; najwyżej 2 zwierzęta w kadrze; pies i królik nigdy razem.
Negative: typowe rasy AI, zwierzę za duże do produktu.

### beauty
Kategorie: kosmetyki, urządzenia beauty, pielęgnacja.
```
KIERUNEK: kinowa, edytorska kampania premium marki kosmetycznej, klatka z reklamy. Prawdziwe zdjęcie, nie render (raw photo, 35mm film look).
```
Światło: kinowy półmrok, twarde niskie słońce przez żaluzje – smugi na ścianie i twarzy, jedna smuga wprost na produkt; alternatywnie złote słońce przez firany z kontrą na włosach.
Zasady: wnętrza z charakterem (kamienica, tadelakt, loft); postać zgodnie z regułą „Postacie”; skóra zdrowa i rozświetlona z naturalną fakturą; kropla i pipeta zawsze na środku policzka, wyraźnie poniżej i z boku oka; butelki: osobno kolor szkła i kolor płynu; bez efektu przed i po, bez obietnic.
Negative: łza, kropla spod oka, porcelanowa skóra, przesadny retusz, lustro.

### komfort_zimowy
Kategorie: termofory, koce, kapcie, tekstylia ocieplające.
```
KIERUNEK: kampania lifestyle premium skandynawskiej marki tekstyliów domowych. Prawdziwe zdjęcie, nie render (raw photo).
```
Światło: zimowy poranek, wieczór z lampami, kinowa noc z ciepłą lampką.
Zasady: makro faktury i detali w ciepłym bokeh to najmocniejsze ujęcia; hero miękkiego produktu centralnie z góry (flat lay) z jedną smugą słońca; sceny z ludźmi z głębią (rozmyty pierwszy plan, kontra, para z kubka) i drugim elementem emocji (kot, druga osoba); sen pokazujemy nocą z historią w rekwizytach; detal zwykłego elementu potrzebuje czynności (nalewanie wody pod światło); dozwolone jedno ujęcie rodzinne ze świątecznymi światełkami (przepis swiateczna_aura).
Negative: płaski produkt, produkt schowany pod kocem, para z termoforu.

### zielen_w_domu
Kategorie: lampy do roślin, doniczki, akcesoria do uprawy.
```
KIERUNEK: kinowa fotografia lifestyle premium, zimowy wieczór w domu pełnym roślin. Prawdziwe zdjęcie, nie render (raw photo).
```
Światło: wieczór lub pochmurny dzień, ciepłe lampy domowe; światło lampy wg reguły „Produkty świecące”.
Zasady: zioła, rozsady, paproć, epipremnum, sukulenty, chili; listwy 20–30 cm nad roślinami; rośliny dopasowane do wysokości lampy; mocowanie tylko na pokazanych powierzchniach.
Negative: monstera, storczyk, białe światło lampy, przesadnie fioletowy cały pokój.

### swiateczna_aura
Kategorie: produkty świąteczne jako przedmiot (figurki, prezenty, słodycze), ujęcia świąteczne w innych kategoriach.
```
KIERUNEK: klatka z kinowego, świątecznego spotu reklamowego polskiej marki meblowej lub cukierniczej. Prawdziwe zdjęcie, nie render (raw photo). Realistyczny, zamieszkany dom w grudniowy wieczór, dekoracje w takiej ilości, jaką mają prawdziwi ludzie. Światło wyłącznie z prawdziwych źródeł: lampki, świece, ogień, latarnie za oknem. Ciepłe, złote światła i lekko chłodne, głębokie cienie, umiarkowane nasycenie, miękki kontrast, delikatne ziarno filmowe.
```
Zasady: brokat i drobiny tylko wewnątrz produktu (np. kula), śnieg tylko za oknem; rozmyty pierwszy plan najwyżej w co drugim ujęciu; ludzie blisko siebie, w akcji, szczęśliwi (rodzina pod jednym kocem); efekty funkcji (nutki) mało, małe, w tonacji zdjęcia.
Negative: brokat i iskry w powietrzu, złoty filtr na całym kadrze, przesadna ilość dekoracji, ciemne ponure wnętrze.

### ozdoby_swiateczne
Kategorie: dekoracje świąteczne i zimowe (naklejki, lampki, stroiki, girlandy).
```
KIERUNEK: klatka ze świątecznego spotu reklamowego IKEA – jasne, ciepłe mieszkanie pełne świątecznych dekoracji, przygotowania do świąt w toku. Prawdziwe zdjęcie, nie render (raw photo). Ciepłobiałe lampki, miękkie światło, naturalne kolory, delikatne ziarno filmowe.
```
Zasady: produkt-dekorację sprzedaje cała ozdobiona sceneria: stroiki z gałązek i szyszek, ceramiczny domek na tealight, pierniki, kartony z bombkami, choinka z ciepłobiałymi lampkami; ludzie w akcji (wieszanie lampek, ubieranie choinki, naklejanie); ilość produktu w kadrze zgodna z zestawem (np. 48 naklejek = jedno skrzydło okna, nie całe okno).
Negative: kolorowe migające lampki, brokat w powietrzu, złoty filtr, produkt w ilości większej niż zestaw.

### audio_gadzety
Kategorie: głośniki przenośne, słuchawki, gadżety lifestyle, akcesoria letnie.
```
KIERUNEK: klatka ze spotu reklamowego marki audio w stylu kampanii JBL – jasny dzień, twarde słońce, nasycone, czyste kolory, energia, ruch w każdym planie. Prawdziwe zdjęcie, nie render (raw photo, 35mm film, candid).
```
Zasady: kamera nisko, często pod niebo; produkt duży na pierwszym planie, w dłoni, pionowo, kluczową stroną (przyciski) do obiektywu; ludzie młodzi, w ruchu, ze szczerą radością, przycięci kadrem lub w nieostrości; interakcja (woda, taniec, skatepark); wodoodporność = żywy rozprysk na produkcie; w złożonej scenie blok PRODUKT na samym początku promptu.
Negative: pozująca grupa w rzędzie, ciemne wnętrze, produkt przechylony bokiem.

### ogien_plener
Kategorie: promienniki i parasole grzewcze, paleniska, misy ogniowe, lampy gazowe, kominki ogrodowe – produkty, których sednem jest ogień i ciepło na zewnątrz.
```
KIERUNEK: klatka z kinowego spotu reklamowego premium marki outdoor living – chłodny, granatowy wieczór i ciepło żywego ognia, ludzie, którzy nie chcą wracać do domu. Prawdziwe zdjęcie, nie render (raw photo, 35mm film, anamorphic look).
```
Światło: noc lub niebieska godzina w chłodnej, granatowo-turkusowej tonacji, lekka mgła podświetlona chłodno; ogień najjaśniejszy w kadrze; bursztynowa plama ciepła na ludziach i podłożu w promieniu ok. 1,5 m; para oddechów i napojów świeci złotem; wyraźny kontrast ciepło–chłód.
Zasady: każde ujęcie z ludźmi to moment ze spotu (taniec przy ogniu, dolewanie grzańca, urodziny, toast), nigdy siedzenie pod kocem bez akcji; lokale (restauracje, rooftopy, ogródki) zawsze pełne – ok. 10–12 stolików z gośćmi, kilka sztuk produktu w rytmie między stolikami, ostrość na jednej; tylko otwarta przestrzeń pod gołym niebem (bezpieczeństwo gazu), ludzie ok. 1 m od ognia; dym, para i ogień nad urządzeniem zakazane; w detalach i zbliżeniach kolory części wpisane wprost (np. „słupki SREBRNE, czarna wyłącznie blacha”), inaczej model przemalowuje elementy na kolor dominujący w kadrze; scena z akcesorium (pokrowiec) też ma akcję (zdejmowanie pokrowca w pierwszy śnieg); wszystkie postaci w scenie poruszają się w jednym, logicznym kierunku.
Negative: dym nad urządzeniem, płomień poza komorą, iskry, ognisko, zadaszenie, wnętrze, puste stoliki, okrągły grzybek grzewczy (dla piramid).
Karta dla promienników: geometria wprost (ścięta piramida, DOKŁADNIE 4 srebrne słupki od ziemi do szczytu, czarna blacha do ok. 80 cm, srebrna siatka, szklana tuba, perforowany walec, kwadratowy daszek), wysokość względem człowieka („daszek ok. 40 cm ponad głową”), płomień „WYŁĄCZNIE w tubie, u dołu niebieski, wyżej pomarańczowo-złoty”. Referencja z innym kolorem ramy (np. biała) = kolor wpisany wprost i zakaz w negative. Butla nie w zestawie → na zdjęciach gładka grafitowa butla bez etykiet albo pusta komora; zgłosić sprzedawcy niebieską butlę na zdjęciach. Bezpieczeństwo gazu: tylko otwarta przestrzeń, zgłosić sprzedawcy sprzeczność „altana/namiot” vs FAQ.
Wzorcowy plan (zaakceptowany zestaw promiennika KANZA, 15 zdjęć):
  1. Hero za dnia bez ludzi: promiennik w centrum ok. 90% kadru, niskie słońce z kontrą, ciemna elewacja za nim (płomień czytelny w dzień), nakryty stół z kocem, przelatujące liście.
  2. Para pod kocem przy promienniku o niebieskiej godzinie, ciepłe okna domu.
  3. Pełny ogródek restauracyjny na starówce: wiele promienników w rytmie, kelnerka z grzańcem, śmiech, mokry bruk.
  4. Przyjaciele grzeją dłonie (ok. 1 m od siatki), para z kubków.
  5. Pełny rooftop: urodziny z tortem, barman, panorama miasta, kilka promienników.
  6. Transport: mężczyzna przetacza promiennik, żona z kocami i pies idą w tę samą stronę, złota godzina.
  7. Zapalnik 1:1: dłonie na „Igniter” i pokrętle, świeży płomień, goście przy furtce w tle.
  8. Daszek od dołu o zmierzchu, ciepłe odbicie płomienia.
  9. Góra tuby bez daszka 1:1, perforacja świecąca bursztynem, chłodne niebo.
  10. Makro płomienia przez siatkę, pierwszy śnieg topnieje na drutach.
  11. Kółka: przechylony o 20°, stopki w powietrzu, nogi ciągnącego, mokre płyty i liście.
  12. Drzwiczki na łańcuszku z gładką grafitową butlą.
  13. Pokrowiec założony w mroźny poranek, szron, parujący kubek na balustradzie.
  14. Zdejmowanie pokrowca w pierwszy śnieg, goście z sankami w tle (trudne – wyszło za 5. razem).
  15. Akcesoria flat lay (reduktor, wąż, opaski) na ciemnych deskach w świetle lampionu, przy podstawie promiennika.

### elektronika_noc
Kategorie: elektronika z podświetleniem RGB jako główną cechą, gaming, oświetlenie dekoracyjne.
```
KIERUNEK: kinowa kampania premium marki elektroniki, nocny setup. Prawdziwe zdjęcie, nie render (raw photo).
```
Światło: ciemny pokój, jedyne źródła to ekran i podświetlenie produktu, chłód z ciepłym akcentem, kontra rysująca fakturę.
Zasady: produkt 3/4, blisko; bez ludzi albo tylko fragment w nieostrości; ekran z ogólnym obrazem bez interfejsu i napisów. Przenośna elektronika audio = przepis audio_gadzety. Elektronika użytkowa i zdrowotna = przepis dom_ikea (jasne, czyste światło, produkt najjaśniejszy, ciepło tylko jako akcent).
Negative: interfejs gry, napisy na ekranie, logo na sprzęcie.

### sport_fitness
Kategorie: lekkie akcesoria sportowe (gumy, maty, bidony, skakanki, wałki).
```
KIERUNEK: kampania reklamowa marki sportowej w stylu Nike / Reebok / Apple Fitness – czyste, graficzne tło, twarde słońce, jeden ruch, jeden bohater. Prawdziwe zdjęcie, nie render (raw photo, 35mm film).
```
Zasady: produkt NA ciele w trakcie ćwiczenia, duży i ostry, w poprawnym położeniu (guma na środku ud, nie na łydkach); tło proste (kort, architektura z płaszczyznami koloru, niebo, jasne mieszkanie); kolor przewodni z produktu powtórzony w otoczeniu, strój w kontrastowym kolorze; skupienie albo spokojna satysfakcja; każde ujęcie ma energię; komplet zestawu w osobnym flat lay.
Negative: grymas, zaciśnięte zęby, panorama miasta, rekwizyty rozrzucone dookoła, typowa fit-modelka AI.

### trening_silowy
Kategorie: sprzęt siłowy (kettlebelle, hantle, sztangi, obciążenia, ławki).
```
KIERUNEK: klatka ze spotu reklamowego Nike Pro / Under Armour – garaż przerobiony na siłownię albo ciemna, surowa siłownia, wysiłek i powaga. Prawdziwe zdjęcie, nie render (raw photo, 35mm film, ziarno).
```
Światło: półmrok z jedną ciepłą smugą słońca przez uchyloną bramę garażu (najlepszy wariant) albo jedna twarda lampa z góry / pasy LED; głęboka czerń, kontrast, pot i magnezja w kontrze. Do zestawu można dodać 2–3 plenery (kort, dach o zachodzie, plaża o zmierzchu, molo o świcie).
Zasady: skupienie i wysiłek, wzrok w dal; stroje czarne, białe, grafit, krem, czekolada, bordo, gładkie bez logo; kamera bardzo nisko, produkt blisko obiektywu, rozmyty stojak hantli na pierwszym planie; poprawna technika; ćwiczenia i obsada realne dla wagi (30 kg = silni dorośli, ćwiczenia oburącz; bez kobiet trzymających ciężki odważnik na wyprostowanych rękach); detale sprzedawcy jako proste makro; przekrój z niebieskimi laserami zamiast pustego makro faktury; hero = produkt w centrum, ok. 75% kadru, smuga światła na fakturze.
Negative: pastelowe kolory, uśmiech na siłę, grymas, logo na ubraniach i butach (swoosh, Under Armour), kulturysta.

### dziecko
Kategorie: zabawki, artykuły dziecięce.
```
KIERUNEK: kampania reklamowa premium marki zabawek, ciepły rodzinny poranek, kolorowy świat dziecka. Prawdziwe zdjęcie, nie render (raw photo, candid).
```
Światło: niskie, ciepłe słońce przez okno, kontra na włosach dziecka, czyste, nasycone kolory zabawki.
Zasady: kamera na wysokości oczu dziecka; moment odkrycia (zdumienie, zachwyt); każde ujęcie z dziećmi to zatrzymana klatka ze spotu – głośna emocja i ruch w toku (śmiech w głos, przybita piątka, bieg, sypiący się materiał w kontrze); dziecko bawiące się spokojnie bez emocji = odrzut; rodzic na poziomie dziecka; wiek dziecka zgodny z opisem; czynność z zabawką poprawna (pałeczka w ksylofon, nie w labirynt); małe elementy nigdy przy ustach.
Wariant „styl LEGO” (na życzenie lub dla zabawek konstrukcyjnych): jasne, miękkie, równe światło dzienne, neutralny balans bieli, bez złotej godziny, flar i smug słońca; czyste, nasycone, prawdziwe kolory; tło w prostych płaszczyznach koloru (np. ściana terakotowa / ciepła biel, jasne drewno); kamera na wysokości blatu, produkt w całości ostry, dziecko za nim pochylone nad budową, uśmiechnięte, z umiarkowaną nieostrością.
Negative: typowe dziecko AI, beżowy jednolity pokój, małe elementy w ustach dziecka.

---

## Reguły planu

### Skład zestawu
- Jedno zdjęcie = jeden argument. Cecha ważna dla kupującego dostaje własne ujęcie.
- Przed planem spisz cechy ze wszystkich zdjęć sprzedawcy i opisu (także z infografik, które nie będą referencją) i sprawdź, czy każda ma ujęcie.
- Każde zbliżenie detalu od sprzedawcy dostaje własne ujęcie: kadr skopiowany 1:1, zmienione tylko tło, światło i czynność. Grafiki z tych zdjęć (strzałki, okręgi, kropki, ramki) zakazane w prompcie.
- Proporcja: mniej więcej połowa ujęć użycia, połowa detali.
- Zastosowania z opisu = różne miejsca i sytuacje (dom, balkon, taras, biuro, plener); każdy kupujący ma zobaczyć „swój” dom. Bez jednej spójnej sesji.
- Przed i po w jednym kadrze tam, gdzie produkt rozwiązuje problem.
- Funkcja ukryta w środku produktu = przekrój techniczny (reguła „Przekrój”).
- Kilka trybów działania = kilka sztuk obok siebie, każda w innym trybie, zamiast kolażu. Sztuki leżą na prawdziwej powierzchni (np. na boku na mokrym łupku), nie lewitują – lewitujące produkty wyglądają jak kiepskie AI.
- Komplet zestawu = osobne ujęcie z góry lub z wysokiego kąta. Gdy zestaw ma pojemnik (walizka, etui, pudełko), elementy układamy W pojemniku – pojemnik sam pilnuje skali. Elementy rozłożone wokół pojemnika model powiększa (żuraw dłuższy niż walizka); jeśli muszą leżeć obok, prompt podaje proporcje względem pojemnika („pojazd = 1/3 szerokości walizki, foremka = 1/8”).
- Ujęcia bez wyraźnego argumentu są pomijane.

### Hero
- Produkt blisko, dokładnie w centrum, ok. 70–75% kadru, cały i ostry.
- Kinowe światło na produkcie (smuga, kontra) i życie w tle w nieostrości (ludzie, zwierzę, rekwizyty sceny).
- Przy flagach drabinka, kojec, ekran i raczki: hero wg sekcji „Styl kinowy” i wzorców z tych reguł (kąt z referencji opisany słownie, produkt 75–85% kadru).
- Produkt w pustym pomieszczeniu albo frontalnie w płaskim świetle = odrzut.

### Kadry i światło
- Typy kadru mieszane: hero, szeroki, średni, w dłoni, makro, z góry. Ten sam typ najwyżej 2 razy.
- Złota godzina najwyżej w 2 ujęciach; reszta: poranek, dzień, pochmurny dzień, niebieska godzina, kinowy półmrok, noc z lampką. Ta sama tonacja w ponad połowie zdjęć = stock.
- Pierwszy plan rozmyty tylko przy krawędzi kadru, nigdy na produkcie.
- Kadr z wnętrza pojemnika tylko, gdy otwór leży na osi kamery.
- Bez słońca i flar w kadrze; bez prześwietlonych okien.
- Lustro tylko w ujęciu od strony lustra.

### Styl kinowy z art direction kolorów (TYLKO flagi: drabinka, kojec, ekran, raczki – NIE globalnie)
- Zakres: wyłącznie drabinki domowe, kojce/wybiegi dla zwierząt oraz produkty z ekranem (stacje pogodowe – test na Daily600M udany, zaakceptowany przez użytkownika) i raczki/nakładki antypoślizgowe na buty (test na raczkach Malcom zaakceptowany – „lekko lepiej” niż outdoor_akcja). Inne kategorie zachowują własne przepisy stylu i stopki; styl kinowy dla nowej kategorii tylko po decyzji użytkownika.
- Formuła „subtelny grading, umiarkowany kontrast, nienasycone kolory” dała zdjęcia blade, smutne, ponure lub prześwietlone – ODRZUCONA. Klient chce klatki ze spotów reklamowych z kinowym sznytem, które budzą emocje (wzorzec: Pinterest – Uber Eats, Apple, Garnier, Huawei, Samsung, Back Market).
- Źródło koloru = ART DIRECTION scenografii, nie filtr: przemyślana paleta 3–4 mocnych kolorów w ścianach, meblach, ubraniach i rekwizytach (kobalt + pomarańcz + róż, turkus + czerwień + krem, burgund + musztarda + granat, koral + butelkowa zieleń), wzorzyste dywany, kolorowe grzbiety książek, retro AGD w kolorze.
- Światło: kinowe, warstwowe – ciepłe słońce przez okno rysuje smugi + ciepłe lampy praktyczne w kadrze + chłodniejsze dopełnienie z okna/niebieskiej godziny; głębia, cienie z gęstością, pełna, soczysta ekspozycja; look Arri Alexa / Kodak Portra 400.
- Kamera: 24–35 mm, często nisko lub z ciekawego punktu (przez drzwi, zza mebla), pierwszy plan przy krawędzi, kadr pełen detali życia.
- Emocja wyrazista i konkretna: śmiech, zaskoczenie, czułość, gag (mąka w powietrzu, taniec z wałkiem), sytuacja, w której klient widzi siebie.
- Czego unikać nadal: pomarańczowy filtr na całym kadrze, HDR, twarde południowe słońce na czarnym detalu, flara. Negative zawsze: „blade wyprane kolory, szare płaskie światło, pochmurno, ponuro, prześwietlenie, mgiełka, nijakie białe wnętrze, stockowe zdjęcie”.

### Kontrola anty-stock (przed każdym promptem)
Czy wiadomo, co dzieje się w tej sekundzie? Czy ktoś coś czuje? Czy światło ma kierunek i porę dnia? Czy widać efekt działania? Czy kadr jest ciekawszy niż „produkt na środku blatu”? Dwa razy „nie” = scena do przepisania. Każde ujęcie z ludźmi: konkretna czynność w toku, wyraźna emocja, światło z kierunkiem, kolor ubrania dobrany celowo, tło spokojniejsze niż produkt. Każde ujęcie z akcją ma element ruchu (krople, para, kurz, piasek, spadające kawałki).

### Ludzie i zwierzęta w zestawie

| Liczba zdjęć | Cała postać | Dłonie | Bez ludzi |
| --- | --- | --- | --- |
| 1–2 | 0–1 | 0–1 | reszta |
| 3–5 | 1–2 | 1 | reszta |
| 6–10 | 2–4 | 1–3 | reszta, w tym detale |

Przy produktach używanych w dłoni dłonie mogą być w większości ujęć. Różnorodność wieku, płci i liczby osób w grupie docelowej, ale głównie osoby młode i w średnim wieku, żeby produkt nie wyglądał na „dla seniorów”. Postać to kupujący, nie usługodawca (bez uniformów).

### Pora roku
- Produkt sezonowy z natury: motyw sezonu (zima, lato).
- Produkt całoroczny używany głównie w jednej porze (inhalator, termofor, ogrzewacz = jesień/zima; wentylator = lato): ta pora za oknem i w ubraniach, bez świąt.
- Produkt całoroczny: bez śniegu, choinek i jesiennych liści.
- Zima za oknem najwyżej w 2–3 ujęciach zestawu.

### Kolejność w galerii
Najpierw hero i główne argumenty (działanie, kluczowe funkcje), potem użycie w różnych miejscach i emocje, na końcu detale.

---

## Reguły specjalne

Włączane flagą z karty albo zawsze obowiązujące (oznaczone „zawsze”).

### Postacie (zawsze)
- Atrakcyjni, naturalni ludzie jak w kampaniach dużych marek. Każda postać ma konkretne, wyraziste cechy: wiek, fryzura, kolor włosów, karnacja, piegi, brwi, zarost, strój z kolorem.
- „Nietypowa uroda” nie oznacza nieatrakcyjnej.
- Bez powtarzania tych samych cech w kolejnych produktach: rude włosy z piegami najwyżej w 1 ujęciu na zestaw i nie w każdym zestawie; rozkład włosów: głównie ciemny blond, jasny brąz, brąz, ciemne. Obsada zgodna z rynkiem i grupą docelową sprzedawcy (Allegro – polski klient), bez dobierania cech „na siłę”.
- Nikt nie patrzy w obiektyw (wyjątek: ujęcie lustra).
- Negative: typowa uroda AI, idealnie symetryczna twarz, długie falowane blond włosy (gdy nieopisane), stockowy uśmiech, pozowanie.

### Zwierzęta (zawsze)
- Unikamy ras typowych dla AI: golden retriever, labrador, husky, corgi, buldożek francuski. Rasa konkretna, z umaszczeniem i pozą (np. pręgowany whippet, rudy wyżeł węgierski, beagle trikolor, kot syjamski, rudy pręgowany kot). Rudy cocker spaniel z mokrą sierścią wygląda jak golden – tylko jeśli opis wymaga długiej sierści. Umaszczenie wielobarwne opisywać mapą („czarne siodło, brązowa głowa, biały pysk, klatka i łapy”).
- Zwierzę w akcji jak w spocie: ruch typowy dla gatunku (otrzepywanie się z kroplami w kontrze, lizanie opiekuna po nadgarstku, merdanie) daje emocję lepiej niż pozowanie do kamery.
- Dotyczy też zwierząt w tle.
- Rotacja ras między produktami: ta sama rasa (np. pręgowany whippet) najwyżej w 1 produkcie z rzędu – kolejne: beagle, wyżeł, border terrier, jamnik szorstkowłosy, owczarek australijski, mieszaniec; koty: pręgowany szaro-biały, czarny, syjamski, rudy.
- Wielkość zwierzęcia z wymiarów produktu; referencji z niepasującym zwierzęciem nie dołączamy.
- Emocja zwierzęcia opisana wprost i pozytywnie: zrelaksowane, ufne, zadowolone (pysk lekko otwarty, przymrużone oczy, swobodne uszy, opiera się o opiekuna). Przy kąpieli, pielęgnacji i weterynarii model domyślnie robi zwierzę przestraszone – negative: przestraszony, spięty, smutne oczy, widoczne białka oczu, ogon pod brzuchem.

### Cudze logo i napisy (zawsze)
- Rekwizyty, ubrania, buty, czapki, plecaki, laptopy, butelki: gładkie, bez naszywek, emblematów, logo i napisów – opisywać to wprost w POSTAĆ/SCENOGRAFIA, nie tylko w negative.
- Napisy na produkcie: „wierne albo nieczytelne, nigdy przekręcone”.
- Na produkcie bez napisów: „bez logo, napisów, wytłoczeń, cyfr i oznaczeń wagi”.

### Skala (zawsze)
- Wymiary w cm + 2 kotwice tuż obok produktu. Najpewniejsze kotwice: dłoń, kartka A4, kubek, butelka 0,5 l, piłka, poduszka, siedzisko 45 cm, stół 75 cm. Porównania z ciałem („od podbródka do żeber”) zawyżają produkt – używać dłoni.
- Produkt prawie kwadratowy lub miękki: proporcja („wyższy niż szeroki, 3:2”) ważniejsza niż wysokość.
- Spójność kotwic: przed promptem sprawdź rachunkiem, czy się nie wykluczają; model rozwiązuje sprzeczność, powiększając produkt. Podest podnosi produkt do potrzebnej wysokości.
- Otwory i pojemności w cm z porównaniem do dłoni („30 × 40 cm = dwie dłonie obok siebie”).
- Duży, ciężki produkt: „kula wyraźnie większa niż głowa dorosłego” itp.
- Mały produkt blisko obiektywu tylko w zbliżeniach bez ludzi i zwierząt. W scenie z człowiekiem lub zwierzęciem produkt jest na tej samej głębokości co trzymająca go dłoń, a prompt porównuje go z twarzą lub głową („głowica wyraźnie mniejsza niż twarz kobiety i niż głowa psa”). Produkt przy obiektywie w szerokim kadrze rośnie (słuchawka większa od głowy).

### Wierność budowy (zawsze)
- Każda widoczna część musi mieć pokrycie w referencji.
- Karta opisuje KAŻDĄ stronę produktu (przód, tył, boki, spód) na podstawie wszystkich zdjęć, także infografik. Gdy w kadrze widać stronę, której nie ma na głównej referencji (np. tył głowicy słuchawki z wypukłą listwą i dyszą), dołączamy zdjęcie tej strony, a prompt opisuje ją wprost; bez tego model rysuje gładki tył.
- Zdjęcie komponentu od sprzedawcy (wkład filtra, akcesorium) jest źródłem prawdy o jego wyglądzie, nawet gdy opis jest uboższy lub sprzeczny. Niezgodność zgłaszamy sprzedawcy, ale komponentu nie zastępujemy innym ani wymyślonym.
- Liczby wpisywane wprost: „DOKŁADNIE 3 ramiona / 2 pompony / 5 sztabek / 7 wkładek”.
- Otwory, kratki, perforacje: zawsze pisać, czy są przelotowe, czy ślepe („płytkie, ślepe wgłębienia – przez nie NIE widać tła”); przy jasnym tle za elementem model robi z każdego wgłębienia dziurę na wylot.
- Detal 1:1 kopiuje także kąt kamery z referencji; zmiana kąta (np. ze skośnego na pionowy) psuje układ elementów.
- Produkt wielozastosowaniowy (np. krzesło cateringowe): sceny w różnych typach miejsc (dom, plener, sala eventowa, stodoła weselna), nie wszystkie przy tym samym domu.
- Powtarzalne elementy w zbliżeniu: wymienić każdy element i jego miejsce w kadrze („na pierwszym planie żółta, za nią niebieska, przy prawej krawędzi zielona”), inaczej model gubi te poza kadrem.
- Produkt z sekcjami: nazwać zawartość każdej sekcji i czego w niej nie ma.
- Nie mieszać stanów produktu w jednym kadrze; referencje tylko z tym samym stanem.
- Zbliżenie fragmentu nie jest referencją w ujęciu z całym produktem; prompt mówi, że element jest częścią produktu („kula jest tułowiem figurki”).
- Rekwizyty nie trafiają na produkt w miejscach, których nie ma na referencji.
- Produkt nie montowany w sposób, którego nie pokazują zdjęcia (np. lampa na karniszu).
- W kadrze nigdy drugi egzemplarz produktu, chyba że plan go wymaga (DOKŁADNIE N sztuk).

### Geometria części
- Karta zapisuje stały układ części względem siebie, z porównaniem znanym modelowi (np. „tarcza słuchawki leży w płaszczyźnie równoległej do rączki i patrzy w tę samą stronę co przyciski, jak rakietka do ping-ponga – nie jak latarka”). Części nieregulowane: w negative „głowica odchylona, wygięta, obrócona względem rączki”.
- Miejsce połączenia części opisywać wprost: do czego dochodzi (do obwodu, do środka), w jakiej płaszczyźnie, czy coś jest wyżej. Elementy wypukłe na powierzchni (listwy, garby) opisywać jako niską nakładkę leżącą płasko na powierzchni, NIE jako szyjkę czy łącznik – inaczej model robi z nich zgięcie i podnosi na nich resztę produktu.
- Przed promptem sprawdź, czy opis ułożenia (kierunek rączki, kierunek tarczy, strona przycisków) nie wymusza niemożliwej geometrii; sprzeczny opis model rozwiązuje, wyginając produkt.
- Przekrój, wnętrze, komponent w środku: zewnętrzne proporcje produktu bez zmian (np. średnica rączki ok. 1/4 średnicy głowicy); komponent skalujemy do produktu, nigdy produkt do komponentu. Linie laserowe tylko na krawędzi cięcia, nie na nienaruszonych częściach.

### Przewody, węże, kable
- Trasę przewodu opisać od początku do końca i po której stronie ścianki biegnie („w całości wewnątrz komory, po wewnętrznej stronie prawej ścianki”), z negative „przechodzący przez ściankę”. Inaczej model przeprowadza wąż przez blachę lub szczeliny.
- Detale w serii trzymają tonację całej galerii (np. zmierzch) – jeden detal w jasnym dniu odstaje od reszty.

### Produkt premium (gdy sprzedawca lub cena wskazują wysoką półkę)
- NIE przechodzić na sterylny minimalizm „obiekt designu” (Vipp/HAY, twarde graficzne słońce, puste wnętrza) – test na drabince: produkt wyglądał tanio, model gubił detale (białe stopnie bez mat), użytkownik ocenił jako klapę. Premium budujemy w zwykłym kierunku „ciepły, zamieszkany dom, klatka ze spotu” przez: wierność detali, słowa jakości w bloku produktu („gładka, satynowa powłoka, równe krawędzie, precyzyjne spasowanie”), wyważoną ekspozycję i dobre wnętrza.
- Każde ujęcie zestawu ma inną paletę; ten sam kolor ścian lub mebli najwyżej w 2 ujęciach (zielony/szałwia powtarzał się w całej serii – w negative każdego ujęcia „zielone ściany, szałwia”, gdy model sam w nią ucieka).
- Elementy, które model gubi, wpisać przy KAŻDYM wystąpieniu („KAŻDY z 4 stopni ma CZARNĄ matę na całej powierzchni”).

### Drabinki i podesty domowe (flaga: drabinka)

#### Blok do promptu
Zachowaj DOKŁADNĄ liczbę stopni i ich kolejność, rzeczywistą geometrię ramy, pałąka, stopek i krzyżaków zgodnie z referencjami. Drabinka jest stabilnie rozłożona; jeśli w scenie jest osoba, stoi na właściwych stopniach. Styl: prawdziwa fotografia kinowej kampanii z konkretną paletą kolorów.

- Karta: każdy stopień z wysokością od podłogi, materiał i kolor maty na KAŻDYM stopniu, kształt poręczy/pałąka, gdzie dokładnie są krzyżaki i listwy (na jakiej wysokości i po której stronie), nasadki przednie vs stopki tylne, jednostronna/dwustronna.
- Bezpieczeństwo: najwyżej 1 osoba, przodem do stopni, nogi oparte o pałąk; nikt na pałąku; dziecko tylko na podłodze; drabinka zawsze w pełni rozłożona. Osoba MUSI stać na drabince, nie obok niej (model potrafi postawić ją na krześle) – „w pobliżu drabinki nie ma krzeseł”.
- Sens: cel wyraźnie poza zasięgiem z podłogi (antresola, karnisz przy suficie 2,6–2,8 m, lampa pod sufitem 3 m). Miejsca: przeprowadzka, remont/malowanie, zasłony, lampa, chowanie w szczelinę – nie kuchnia przy gotowaniu, nie łazienka.
- Detale konstrukcji: kadr możliwie ciasny, z referencji tylko 2–3 elementy, wprost „w kadrze NIE MA innych części”; wielowarstwowe ujęcia (stopień + rama tylna + stopka w tle) model psuje – stopkę pokazać osobnym ujęciem. Drabinka w detalu stoi w realnym pokoju (podłoga pod stopniem, odbicie okna, cień listwy na macie), inaczej wygląda na wklejoną.
- Wzorcowy plan (zaakceptowany zestaw drabinki 4-stopniowej, 11 zdjęć): hero przy przeprowadzce (para z kartonem w tle); zasłony w wysokim oknie z falującym lnem; malowanie przy suficie (żart z farbą na nosie); lampa pod wysokim sufitem z rodziną przy kolacji; złożona w szczelinie przy lodówce; oś stopnia z butem na macie; tylna stopka na szachownicy przy remoncie; przednia nasadka na jodełce z kotem; listwa przy stopniu; krzyżak X; hero bez ludzi z firanką i parującą kawą.
- Najlepsza klatka serii 3-stopniowej: wieczór przed wyjazdem – sypialnia w ciepłym beżu z kolorowymi akcentami (musztardowa walizka, terakotowa pościel, ręcznik w paski), zachód za oknem + ciepłe lampy, gag (kapelusz spada partnerowi na głowę), dużo dzieje się w pokoju. Wzorzec: scena wieczorna z historią, kolorowe rekwizyty związane z celem sięgania, wyraźny gag/emocja dwóch osób.
- Niskie podesty (2 stopnie, 80 cm) z człowiekiem: model robi z nich „balkonik/chodzik” z wysoką poręczą przy biodrach. Pisać: „pałąk tylko 33 cm nad górnym stopniem – poniżej kolan osoby”, kamera z boku na całą postać, negative „balkonik, chodzik rehabilitacyjny, wysoka poręcz”. Cel sięgania musi być wyraźnie poza zasięgiem z podłogi (sufit 2,6 m, osoba na stopniu sięga go dłońmi, druga osoba z podłogi nie sięga). Zakaz kolażu/podzielonego kadru w negative.
- Zaakceptowany zestaw drabinki 2-stopniowej (11 zdjęć): hero w kremowej kuchni z terakotą i falującą zasłoną; kieliszki z górnej szafki przy pizzy (ochra, wieczór); lampion-księżyc przy suficie nad łóżkiem dziecka (pudrowy róż); album ze zdjęciami z najwyższej półki (błękit, deszczowy wieczór); girlanda na balkonie o zachodzie z przyjaciółmi; złożona wsuwana pod łóżko z kotem; taśma malarska przy suficie w remoncie (partner z farbą na policzku); hero bez ludzi w urządzanym mieszkaniu (ochra, płachta, lustro, kawa); detale: oś z butem, stopka tylna na balkonie, nasadka przednia na terakocie z czereśniami. Do każdej drabinki min. 1 ujęcie remontowe.
- Hero bez ludzi: najlepiej działa produkt blisko, ułożony jak na zdjęciu sprzedawcy, w naturalnym słonecznym dniu; wieczór z kominkiem i mocnym ciepłym gradingiem wychodzi przepalony i przesadzony. Grading: „naturalne kolory, wyważona ekspozycja, bez przesadnego koloryzowania i flar”.
- Złożony produkt w szczelinie: wzorzec zaakceptowany – jasna kuchnia, szczelina między lodówką a dębowym słupkiem, kobieta z kubkiem wsuwa produkt jedną ręką, kot na parapecie, ciepłe poranne słońce.
- Zaakceptowany zestaw EASYSTEP (czarny stołek A 60 cm, 2 stopnie, bez poręczy, 10 zdjęć): hero w kuchni; ciasteczka z górnej szafki z psem; półka w remoncie; rolki w przedpokoju; namiot w garażu; złożony w szczelinie lodówka–dębowy słupek z kobietą z kubkiem i czarnym kotem; hero bez ludzi przy otwartych drzwiach tarasowych (kąt jak na zdjęciu sprzedawcy, produkt 75% kadru); montaż kinkietu przy wejściu nowoczesnego domu (ojciec na stopniu, córka podaje śrubkę, beagle); detale: zawias, górny stopień z osią na tarasie z desek, dolny stopień z dwoma nitami i tylną nogą na betonowych płytach przy ogrodzie. Hero bez ludzi: zawsze „skopiuj 1:1 kąt kamery i perspektywę ze zdjęcia sprzedawcy, produkt ok. 75% wysokości kadru” – inaczej model oddala produkt.
- Niskie czarne drabinki bez poręczy (EASYSTEP 84 cm): model przerabia je na wysokie drabiny z bocznicami i poręczą. Pisać: „najwyższy punkt NIŻEJ niż blat kuchenny 90 cm”, „przednia i tylna noga stykają się w zamknięty wierzchołek z nasadką – nic nie wystaje wyżej”, „osoba na 3. stopniu: wierzchołek na wysokości jej kolan”; negative „wysoka drabina, bocznice ponad stopniami, nogi wystające nad górny stopień o więcej niż 22 cm”.
- PRZEŁOMOWY zestaw drabinki EASYSTEP 3-stopniowej (84 cm, czarna, bez poręczy, 11 zdjęć – „niebo a ziemia, zdjęcia sprzedają same sobą”): 1) pierwszy wieczór w nowym mieszkaniu – kobieta na 3. stopniu wiesza papierowy lampion, partner z pizzą wiwatuje, niebieska godzina za oknem vs ciepłe lampy, kobalt + róż + musztarda; 2) tata na 2. stopniu podaje tortownicę, córka klaszcze i wybucha chmurka mąki – turkusowa kuchnia, czerwona lodówka retro, szachownica; 3) remont – on maluje koralem pod sufitem, ona tańczy z wałkiem jak z mikrofonem, ściana butelkowa zieleń, musztardowa sofa w folii, niski kąt 24 mm; 4) ZEWNĄTRZ – mama w kobaltowej sukience zrywa czereśnie, syn łapie czereśnię ustami, border terrier skacze, złota kontra przez liście; 5) deszczowy wieczór – tata zsuwa pudło z misiem z najwyższej półki, córka w czerwonej piżamie z latarką, burgundowe ściany, perski dywan; 6) złożona – kobieta w czerwonym płaszczu z bagietką i tulipanami chowa drabinkę do zielonej spiżarni, rudy kot łapie tulipan, różowy przedpokój; 7) hero w turkusowym salonie (kąt z referencji); 8) detal środkowego stopnia z truskawkami i mąką na tle turkusu i czerwonej lodówki; 9) detal górnego stopnia z nasadkami i musztardową konewką na balkonie o złotej godzinie; 10) sneaker z kolorową skarpetką wchodzi na dolny stopień (motion blur drugiej stopy, puszka koralowej farby); 11) hero w ogrodzie – czereśnie na górnym stopniu, koszyk, hortensje i floksy, stół w czerwoną kratkę z żółtymi krzesełkami.
- Wnioski z tego zestawu: (a) każda scena = mini-historia z gagiem lub wzruszeniem i rekwizytem-celem (lampion, tortownica, miś, czereśnie); (b) jeden „efekt w powietrzu” na ujęcie (mąka, spadająca czereśnia, taniec) + motion blur w stopce; (c) sceny między sobą łączą rekwizyty (czereśnie: ujęcia 4 i 11; truskawki/mąka: 2 i 8) – galeria wygląda jak jedna kampania; (d) skala przez blat działa – drabinka przestała być wysoka; (e) w hero z kątem referencji opisać kąt słownie (która noga bliżej kamery, z której strony, jak wysoko kamera), bo samo „skopiuj kąt” nie wystarcza; (f) Kodak Portra / Arri Alexa w KIERUNKU daje właściwy filmowy kolor bez przepalonego pomarańczu.
- Zaakceptowany zestaw EASYSTEP 4-stopniowej (108 cm, 11 zdjęć, styl kinowy): 1) kamienica – kobieta na 4. stopniu wiesza makramę z bluszczem pod sufitem 3 m, partner trzyma pędy jak welon, musztarda + granat + róż; 2) wnuk na 3. stopniu podaje babci słoik wiśni z wysokiej spiżarni, wiśniowe szafki, słoiki świecą pod światło; 3) REMONT – tapetowanie, pas tapety spada partnerce na głowę, kobalt + pomarańcz; 4) ZEWNĄTRZ – girlanda nad pergolą przed przyjęciem, jamnik szorstkowłosy ucieka z kiełbaskami, złota godzina; 5) garaż – ojciec zdejmuje żółty SUP spod sufitu, syn łapie dziób, czerwone kombi w bramie; 6) wieczór – mama nakleja świecące gwiazdki na granatowy sufit, dzieci w piętrowym łóżku z zachwytem; 7) złożona do szczeliny przy błękitnej pralce, kot syjamski w koszu z praniem, żółte kafle; 8) hero jako kwietnik w różowym salonie (pilea, bluszcz, kaktus, książki, miedziana konewka); 9) detal wierzchołka z nasadkami, paleta i pędzle w kobaltowej pracowni; 10) detal stopnia ze słoikiem wiśni w czerwonej kuchni (łączy się z ujęciem 2); 11) hero w ogrodzie – jabłka na stopniu, skrzynka jabłek, niebieskie hortensje, leżaki w pasy.
- Postać źle stoi / drabinka za duża względem człowieka (5 nieudanych prób girlandy i tapety): pomogło (a) dołączenie zdjęcia sprzedawcy z człowiekiem na drabince jako „zdjęcie 2 – bierz WYŁĄCZNIE proporcje człowieka do drabinki i sposób stania (nie twarz, nie ubranie, nie tło)”; (b) blok „PROPORCJE I SPOSÓB STANIA”: obie stopy na środku 3. stopnia, przodem do wierzchołka, ciało między przednimi rurami, wierzchołek na wysokości połowy ud; (c) cel dokładnie nad drabinką (belka pergoli 2,4 m nad nią) albo „drabinka TYLNYMI nogami do ściany, stopnie do pokoju” przy pracy na ścianie; (d) kamera z boku 3/4 od przodu na wysokości ok. 1 m, żeby widać było stopy na stopniu; (e) negative: „drabina duża względem człowieka, sięgająca do piersi, osoba bokiem, na krawędzi stopnia, stopy rozkrokiem na różnych stopniach, drabina bokiem do ściany”. Przy wyższych drabinkach domyślnie stawiać osobę na przedostatnim stopniu – na najwyższym model częściej myli pozę.
- Wyjątek od zakazu referencji z ludźmi: zdjęcie SPRZEDAWCY z modelem na produkcie wolno dołączyć jako referencję pozy i proporcji, z wyraźnym zakazem kopiowania twarzy, ubrania i tła.
- Przy drabinkach dodać 1 ujęcie na zewnątrz (dom, taras, ogród) w słoneczny dzień.
- Mycie okien sprzedaje najsłabiej: drabinka mała w kadrze, uwagę zabiera szyba i osoba za nią, odbicia. Unikać lub kadrować z drabinką dominującą.
- Detale konstrukcji można przenosić między wariantami tej samej linii (3- i 4-stopniowa) – oszczędza generacje.
- Urozmaicenie = kolory WNĘTRZ, nie światła. Test z chłodnym, pochmurnym światłem i białymi/szarymi wnętrzami (drabinka 3-stopniowa) zabił duszę i emocje – odrzucone. Światło zostaje jak w zaakceptowanych: ciepłe, niskie słońce z kierunkiem w dzień, ciepłe lampy wieczorem. Zmieniamy kolory ścian i mebli między ujęciami (kość słoniowa, terakota, pudrowy róż, ochra, karmel, granat, ciepły beż, błękit) – każdy najwyżej 2 razy, zieleń najwyżej 1 raz; wnętrza ciepłe, zamieszkane, z kolorowymi akcentami.

### Liczba szczebli i stopni
- Przy ludziach na drabinkach/schodkach model dodaje stopień. Wypisać każdy stopień z wysokością („1. na 23 cm … 4. na 93 cm; nad 4. tylko pałąk; pałąk nie jest stopniem”) i pozycję osoby („pod jej stopami DOKŁADNIE 2 stopnie, nad nimi 1 wolny stopień”); negative „5 stopni, stopień pod pałąkiem”.
- W detalu 1:1 wpisać, czego na danej wysokości NIE MA („na tej wysokości nie ma krzyżaka X”) – model dokleja charakterystyczne elementy z innych części produktu.

### Sens użycia w scenie
- Każda scena musi pokazywać, PO CO produkt jest w kadrze. Drabinka w kuchni przy gotowaniu = bez sensu; przy przeprowadzce pod antresolą, przy malowaniu przy suficie = z sensem.
- Produkt dający wysokość lub zasięg: cel musi być wyraźnie poza zasięgiem bez produktu („lampa ok. 1 m ponad wyciągniętą ręką osoby stojącej na podłodze”, sufit 3 m). Cel na wysokości barków = produkt zbędny.
- Miejsce zgodne z typowym użyciem (drabinka: przedpokój, salon, remont – nie łazienka bez powodu).
- Detale 1:1 bez ludzi i z jednolitym, spokojnym tłem, gdy referencja to precyzyjna konstrukcja (krzyżaki, listwy) – ruchliwe tło odciąga uwagę. Perspektywę takiego detalu opisać geometrycznie: gdzie w kadrze biegnie każdy element i skąd patrzy kamera.
- Ujęcie „schowany w szczelinie”: opisać prosty układ mebli od lewej do prawej i kierunek wsuwania, inaczej model generuje zniekształcone szafki.

### Transport na kółkach
- W zbliżeniu kółek model stawia produkt na stopkach (kółka są na referencji tuż nad ziemią). Przechył wpisać liczbowo („przechylony o 20°, podłoża dotykają WYŁĄCZNIE 2 kółka, przednie stopki 12 cm w powietrzu, pod nimi pusta szczelina i cień”), kamera dokładnie z boku i w kadrze przyczyna przechyłu (dłoń i nogi osoby ciągnącej). Negative: „stopki na ziemi, produkt stojący pionowo”.
- Akcja z akcesorium (zdejmowanie pokrowca) często wychodzi nienaturalnie – pewniejsze jest akcesorium założone w scenie z nastrojem (mroźny poranek, szron); wersja z akcją jest możliwa, ale wymaga kilku generacji (pokrowiec ściągany z góry jedną ręką, druga przytrzymuje dół, śnieg zsypuje się w kontrze).

### Orientacja produktu w ruchu
- Przy ćwiczeniach i dynamicznym ruchu opisać, którą stroną produkt jest do kamery („kamera z przodu-boku 45°, widać przednie pole, NIE spód”).
- W złożonej scenie (kilka osób, woda, ruch) produkt pionowo, kluczową stroną do obiektywu, blisko kamery; przechylony bokiem produkt jest upraszczany.

### Funkcja z nietypowego miejsca
- Gdy funkcja działa z nietypowej części produktu (np. strumień z dyszy na tyle głowicy, a nie z tarczy), dołączamy zdjęcie sprzedawcy, które tę funkcję pokazuje, jako zdjęcie 1, nawet z grafiką (z zakazem kopiowania grafiki), i kopiujemy z niego ułożenie produktu względem kamery. Sam opis słowny nie wystarcza – model puszcza wodę z miejsca typowego dla kategorii.
- Ujęcie ustawiamy tak, żeby źródło funkcji było widoczne (kamera od strony dyszy), a w negative wpisujemy typowe źródło („woda z tarczy, z dysz z przodu”).
- W szerokiej scenie z ludźmi i zwierzętami model wraca do typowego trzymania produktu i ignoruje nietypową funkcję. Wtedy ujęcie robimy jako zbliżenie akcji, które kopiuje kompozycję zdjęcia sprzedawcy (produkt dominuje, ok. 40–50% kadru; z człowieka tylko dłoń, twarz najwyżej w nieostrości).

- Limit prób: jeśli funkcja sprzeczna z nawykiem modelu nie wychodzi po 2 poprawkach promptu, nie walczymy dalej. Scena z ludźmi lub zwierzętami pokazuje cechę zgodną z nawykiem modelu (np. wypustki i zwykły strumień z tarczy), a nietypową funkcję pokazuje osobne ujęcie samego produktu, kopiujące 1:1 kompozycję zdjęcia sprzedawcy z tą funkcją.

### Referencje z innego wariantu
- Zdjęcie innego wariantu produktu (inne pokrywy, inne logo, inny kolor) przecieka do generacji mimo zakazu. Dołączać je tylko, gdy jest jedynym źródłem informacji (np. sposób mocowania), z dopiskiem „bierz WYŁĄCZNIE …”, a cechę własnego produktu opisać wprost i powtórzyć w negative.

### Produkty świecące (flaga: swieci)

#### Blok do promptu
Światło emitują tylko elementy, które rzeczywiście świecą na referencjach. Barwa i zasięg świecenia odpowiadają produktowi; obudowa zachowuje własny kolor i fakturę. Bez zmiany barwy całego produktu.

- Światło produktu ma natężenie jak na prawdziwych zdjęciach: element świecący jednolicie nasycony na całej długości z miękką poświatą; tuż za lub pod produktem powierzchnia łapie mocną plamę koloru; obiekty pod światłem zabarwione, ale z widocznym własnym kolorem; pomieszczenie dalej niż ok. 1 m w naturalnych, ciepłych kolorach.
- Otoczenie ciemniejsze niż produkt (wieczór, półmrok z ciepłymi lampami, pochmurny dzień); limit ujęć nocnych nie obowiązuje.
- Obudowa zachowuje własny kolor (np. czarna).
- Za słabo: „pada miękko, szybko słabnie”. Za mocno: „najsilniejsze światło, zalewa wszystko”.
- Lampy do roślin: magenta, nigdy białe ani żółte.

### Umowna poświata ciepła (flaga: cieplo)

#### Blok do promptu
Jeśli scena pokazuje działanie grzewcze, dozwolona jest delikatna, umowna bursztynowa poświata ciepła, a nie nowa lampa, płomień lub neon. Forma i kolor obudowy pozostają 1:1 ze zdjęciem.

- Produkty grzejące bez widocznego efektu (ogrzewacze): ciepłe, bursztynowo-pomarańczowe światło wewnątrz produktu, najjaśniejsze w środku, słabnące ku brzegom, miękki blask na dłoniach; nie neon, nie ogień, bez iskier. Produkt jako ciepły punkt w chłodnym kadrze.

### Przekrój i wizualizacja działania (flaga: wnetrze)

#### Blok do promptu
Tylko dla ujęcia świadomie zaplanowanego jako przekrój: obudowa zachowuje rozmiary i rzeczywisty kształt, widoczna jest wyłącznie kontrolowana krawędź cięcia. W innych ujęciach produkt nie jest przecinany ani przezroczysty.

- Przekrój techniczny: obudowa przecięta, nieprzezroczysta, z widoczną krawędzią cięcia i grubością ścianki (wersja „przezroczysta jak szkło” wygląda jak inny produkt).
- Przepływ: przed i po w samym przepływie (np. mętna woda z osadem na wlocie, czysta na wylocie; kolor umowny, nie błoto).
- Gdy przekrój mógłby wyglądać jak pęknięcie: krawędź cięcia obrysowana cienkimi, świecącymi niebieskimi liniami laserowymi, płaszczyzna idealnie gładka.
- Efekty graficzne funkcji (fale, nutki, przepływ): mało, małe, w tonacji zdjęcia, bez napisów i tęczy.

### Mgiełka, para, dym (flaga: mgielka)

#### Blok do promptu
Mgiełka/para, jeśli występuje w danej scenie, wydobywa się wyłącznie z rzeczywistego wylotu produktu; jest lekka i fizycznie wiarygodna, bez dodawania dysz, rurek i otworów.

- Opisywać prędkość i zachowanie („powolny, miękki obłok jak oddech na mrozie”), nigdy „strumień”; wskazać jedyne miejsce, z którego wylatuje. Para z napojów i jedzenia zawsze pod światło.

### Zachowanie materiału (zawsze przy masach, piaskach, żelach, cieczach)
- Model zachowuje się jak przy najpopularniejszym materiale z kategorii (piasek kinetyczny → sypki piasek plażowy, drobiny w powietrzu). Prompt opisuje zachowanie TEGO materiału i wpisuje ruch zgodny z nim (piasek kinetyczny: spójne grudy, powolne, miękkie „przelewanie się” płatami, kruszenie na brzegach, nigdy pył i drobiny w powietrzu); negative: zachowanie materiału popularnego („sypiący się piasek, drobiny w powietrzu, pył”).
- Element ruchu z reguły anty-stock dobieramy do materiału – nie każdy materiał może „lecieć w kontrze”.

- Porównania model bierze dosłownie („wiórek jak strużyna z ołówka” → drewniane wióry). Zamiast porównania opisujemy sam efekt („mała, miękka grudka piasku w łyżeczce”).
- Narzędzie, z którego powstał element (foremka, szablon, wycinarka), wyrzucamy z kadru, jeśli nie musi w nim być – obok gotowego elementu model je skleja lub przenosi kolor (niebieska babka z niebieskiej foremki). Gotowy element opisujemy jako „cały z [materiału], w kolorze [materiału]”.

### Pojemniki otwierane (walizki, etui, pudełka)
- Opisać stopień otwarcia i geometrię wprost („otwarta płasko o 180°, obie połowy leżą na stole obok siebie, każda płytka jak taca ok. 3,5 cm”); inaczej model robi z walizki głęboką skrzynię z pionowym wiekiem. Negative: „wieko podniesione pionowo, głęboka skrzynia, pudełko”.
- Wymiary połówek liczyć z wymiarów zamkniętego pojemnika: walizka 36,5 × 30 × 7 cm otwarta jak książka = dwie połowy po 36,5 × 30 cm i 3,5 cm głębokości (razem 36,5 × 60 cm), nie „36 × 15”. Błędny wymiar w prompcie = zniekształcone proporcje całego kadru.
- Duże meble (stoły, ławki): same centymetry nie wystarczają – podać proporcję („długość ok. 2,2 × szerokość”) i kotwicę z ludzi lub rzeczy („za stołem stoją swobodnie 2 osoby obok siebie i zostaje wolny blat”, „przy stole DOKŁADNIE 6 osób, po 3 na boku”, „w rzędzie DOKŁADNIE 6 skrzynek po 30 cm”); kamera prawie frontalnie do dłuższego boku albo wzdłuż stołu.
- Zbliżenia pod blatem i przy nogach mebla: tło zdradza wysokość. Małe całe postaci w tle albo całe krzesła pod blatem robią z mebla olbrzyma – w tle tylko elementy z tej samej wysokości (kolana dorosłych, krzewy, koc), kamera tuż przy poziomie blatu.
- Małe elementy przy ludziach: skala do dłoni i palców w tym samym kadrze („foremka 4,5 cm – nie wyższa niż kciuk dziecka, mieści się w zaciśniętej piąstce”); bez tego model powiększa je do rozmiaru wiaderek.

### Materiały przezierne (flaga: siatka)

#### Blok do promptu
Zachowaj rozmiar oczek, grubość nici lub prętów, kolor i przejrzystość materiału dokładnie według zdjęć. Przez rzeczywiście otwartą siatkę widać tło; nie zmieniaj materiału na szkło ani pełną płytę.

- Siatki i tkaniny przezierne: kolor, wielkość oczek względem nitek, przejrzystość („czarna, przejrzysta, oczka większe niż nitki, przez siatkę wszystko widać ostro”).

### Produkty miękkie i worki (flaga: miekki)

#### Blok do promptu
Elastyczne części mają rzeczywiste, miękkie fałdy i naturalne naprężenie, zachowują liczbę i położenie uchwytów oraz rozmiar z referencji. Nie zamieniaj tkaniny lub worka w sztywną bryłę.

- Model spłaszcza i zmniejsza miękkie produkty: proporcja + kotwica tuż obok + porównanie z ciałem w szerokich kadrach, dłoń w detalach.
- Worki w stojakach i obręczach: worek włożony od góry, brzeg wywinięty na zewnątrz przez krawędź, poniżej zwisa luźno jak folia z fałdami; negative „sztywny pojemnik, wiadro, kosz z korpusem, worek naciągnięty jak na wiadro”.
- Uchwyty: liczba i położenie wprost („wyłącznie na zewnątrz, dokładnie dwa górne i jeden dolny”).

### Armatura i urządzenia ręczne wielotrybowe (flaga: reczne_wielotrybowe)

#### Blok do promptu
Głowica, rączka i ich połączenie zachowują jedną rzeczywistą, sztywną geometrię. Widoczne przyciski, dysze i otwory mają tę samą liczbę i rozmieszczenie co na zdjęciach. Efekt użycia odpowiada tylko wybranemu trybowi.

Dotyczy: słuchawki prysznicowe, deszczownice ręczne, pistolety zraszające, suszarki, szczoteczki, masażery, odkurzacze ręczne – produkty trzymane w dłoni, z głowicą, przyciskami trybów i często akcesoriami (wąż, uchwyt, wkład).
- Karta – blok produktu ma 4 części, zawsze w tej kolejności: (1) GEOMETRIA – jak głowica łączy się z rączką (do obwodu czy do środka, w jakiej płaszczyźnie, analogia: „jak rakietka do ping-ponga”), że jest sztywna i bez zgięć, proporcja rączki do głowicy („rączka ok. 1/4 średnicy głowicy”); (2) PRZÓD – strefy tarczy od zewnątrz do środka, z liczbami; (3) TYŁ i BOKI – listwy, dysze, garby jako niskie nakładki leżące płasko; (4) RĄCZKA – przyciski z liczbą i opisem ikon, pierścienie, faktury, króciec.
- Referencje: przód (główne zdjęcie) + zdjęcie tyłu w każdym ujęciu, w którym widać tył + zdjęcie od sprzedawcy pokazujące nietypową funkcję w ujęciu tej funkcji. Prawdziwe zdjęcie produktu w dłoni (nawet amatorskie, z bałaganem w tle) jest najlepszą referencją geometrii – z zakazem kopiowania tła.
- Wkład lub element wymienny: wyglądem ze zdjęcia sprzedawcy (np. przezroczysty wkład z warstwami kulek, kolejność warstw wypisana), zmniejszony do produktu.
- Wzorcowy plan 10 ujęć (zaakceptowany zestaw słuchawki):
  1. Hero: produkt osadzony w uchwycie na ścianie, działa, para, w tle rozmyta osoba, kinowy półmrok.
  2. Tryby: N sztuk leży na plecach na mokrym łupku, każda w innym trybie, woda tryska pionowo w górę (fontanny), kamera nisko.
  3. Przekrój wkładu: produkt poziomo, cięcie tylko części z wkładem, niebieskie lasery na krawędzi cięcia, woda bursztynowa na wlocie i czysta na wylocie.
  4–6. Każdy tryb na człowieku, w innym miejscu i porze: mgiełka na twarz (poranek, lastryko), masaż karku (noc, czarny mikrocement), wypustki przy myciu włosów (kadr 1:1 z detalu sprzedawcy).
  7. Funkcja nietypowa: sam produkt, kompozycja 1:1 ze zdjęcia sprzedawcy, cel praktyczny (np. strumień czyści narożnik wanny).
  8. Zwierzę lub rodzina: klatka ze spotu, ruch i emocja (pies otrzepuje się, opiekun się śmieje), produkt działa zwykłym trybem.
  9. Przyciski: kadr 1:1 z detalu sprzedawcy, mokra dłoń wciska tryb, w tle świecący strumień.
  10. Komplet z góry + akcesoria 1:1 (wąż na mokrym teku w smudze słońca, uchwyt dociskany dłonią do ściany – montaż bez wiercenia).
- Ryzyka (negative dla tej grupy): głowica wygięta, odchylona lub obrócona względem rączki; rączka podniesiona nad głowicę; słuchawka jak latarka, jak stempel; gruba rączka; gładki tył bez listwy; woda z tarczy w trybie z innej dyszy; niebieskie podświetlenie i diody z infografik; produkt większy niż głowa przy ludziach.

### Meble składane i eventowe (flaga: meble_skladane)

#### Blok do promptu
Zachowaj rzeczywistą geometrię stelaża, liczbę nóg, poprzeczek, blokad i proporcje blatu/siedziska. Mebel stabilnie stoi na podłożu, a jego własny materiał i kolor są wyraźne. Liczba egzemplarzy wynika z planu sceny.

Dotyczy: krzesła i stoły składane, cateringowe, ogrodowe, turystyczne, ławki eventowe.
- Karta: geometria ramy opisana wprost (np. „dwie długie rury od oparcia ukośnie do przednich stóp, tylne nogi ukośnie do tyłu – z boku litera X; DOKŁADNIE 2 poprzeczki nisko”), faktura tworzywa („drobna, chropowata jak skórka pomarańczy”), uchwyt w oparciu, stan złożony z grubością w cm. Typowe pomyłki modelu do negative: krzesło Tiffany/Chiavari, drewniane, białe, z poduszką, podłokietnikami, chromowaną ramą, oparciem z listew, siedziskiem z siatki.
- Produkt czarny: tło jasne (biały tynk, jasne deski, zieleń, niebo) albo mocna kontra na krawędziach – inaczej czerń zlewa się z tłem.
- Stabilność zawsze (patrz „Meble i siedziska” w przepisie wnetrza_premium): nogi płasko, bez przechyłu, bez ludzi bujających się na krześle; spód tylko na pustym meblu.
- Uczciwość: zestaw = 1 szt., a sceny eventowe pokazują wiele sztuk – zgłosić sprzedawcy „cena za 1 szt.”; na pierwszym planie zawsze jedna sztuka.
- Wzorcowy plan 10 ujęć (zaakceptowany zestaw krzesła KANZA):
  1. Hero: krzesło stabilnie w centrum ok. 75% kadru na jasnym tarasie, tuż za nim przebiegają dzieci z bańkami, w tle wchodzący goście.
  2. Rodzinna uroczystość w ogrodzie (urodziny dziadka), DOKŁADNIE 4 krzesła, krzesło bohatera na pierwszym planie z widoczną ramą.
  3. Transport: dorosły niesie 2 złożone krzesła pod pachami od bagażnika (lekkość, płaski profil).
  4. Event w INNYM miejscu niż dom (stodoła weselna, sala, plener): goście zrywają się do tańca, puste odsunięte krzesło na pierwszym planie, konfetti w kontrze.
  5. Firma: warsztaty w loftowej sali, krzesła w półkolu.
  6–10. Detale 1:1 z kątem kamery z referencji: siedzisko z góry (liść w plamach słońca), krawędź po deszczu (krople w kontrze), dłoń w uchwycie oparcia, nogi i nasadki w dzień na tarasie (piłka obok, rodzina w tle), spód od dołu z niebem i drzewami (wgłębienia ślepe).
- Stoły składane (zaakceptowany zestaw stołu 200 × 90 cm):
  - Karta: proporcja blatu wprost („długość ok. 2,2 × szerokość”), linia podziału przez środek blatu, DOKŁADNIE 4 nogi tylko przy końcach („na środku pod blatem NIE MA nóg”), 1 poprzeczka na parę, wspornik z pierścieniem blokady, krawędź 4 cm, spód z płytkimi, ślepymi wgłębieniami, walizka po złożeniu z grubością i rączką.
  - Biały produkt: „matowa, lekko ziarnista biel jak skorupka jajka, nie lśniąca i nie prześwietlona”, tło ciemniejsze lub zielone, w negative „prześwietlona biała plama”.
  - Bez obrusa – blat jest produktem; jedzenie i naczynia zostawiają część blatu wolną.
  - Długość pilnują kotwice: liczba nakryć/osób/skrzynek na boku i kamera prawie frontalnie do dłuższego boku lub wzdłuż stołu. Bez nich model skraca stół do ok. 150 cm.
  - Hero z dużym daniem: konkretne, apetyczne danie (kurczak z ziemniakami, pieczeń na desce) – nie cały pieczony zwierzak (prosiak wyglądał dziwnie).
  - Złożona walizka w bagażniku: pionowo za oparciami wyszła dobrze i została zaakceptowana; jeśli wygląda za mało, wersja płasko wsuwana na podłogę bagażnika na całą jego szerokość.
  - Rozkładanie (spód do góry): opisać, że w górę sterczy DOKŁADNIE JEDNA para (przy dalszym końcu), a druga leży płasko; kształt nóg opisać ze zgięciem („w górnej ćwierci zginają się na zewnątrz ok. 30°, jak litera Y”) i długością względem blatu („prawie tyle co szerokość blatu”) – inaczej model podnosi obie pary, prostuje je albo skraca.
  - Czarna wersja (zaakceptowany zestaw, inny niż biały, żeby aukcje się nie dublowały): czerń „głęboka, matowa, z drobną fakturą jak skórka pomarańczy, bez lakierowego połysku”, tło jasne/zielone, w negative „czarna plama bez detalu”. Plan: 1 urodziny 40-tki z tortem i zimnymi ogniami, konfetti; 2 nagła letnia ulewa – goście ze śmiechem ratują talerze, krople perlą się na blacie; 3 organizatorka niesie walizkę od busa przez łąkę na plenerowe wesele o świcie; 4 bufet cateringowy w stodole (5 desek w rzędzie); 5 jarmark na polskiej starówce z owocami (6 łubianek, 2 sprzedawczynie, neutralne światło dzienne); 6 rozkładanie na tarasie – kobieta śmieje się do przyjaciółki ze skrzynką; 7 pierścień blokady w złotej godzinie (w tle kolana dorosłych); 8 narożnik po deszczu z liściem klonu; 9 rączka – walizka wyciągana z busa pełnego stołów; 10 sam stół na trawniku w cieniu liści, cały w kadrze z marginesem.
  - Pojedynczy stół w scenie z wieloma straganami: „JEDEN stół, linia podziału to złożenie, nie dwa stoły” – inaczej model zsuwa dwa krótkie stoły. Kadry 3/4 całego produktu: kamera dalej i „margines wokół wszystkich narożników i stopek”, inaczej stół ucieka poza kadr.
  - „Naturalne światło” nie znaczy płaskie, pochmurne – takie ujęcia tracą życie. Zostawić słońce z boku i kontrę, a prześwietlenie leczyć zapisem „ekspozycja wyważona, jasne podłoże nieprzepalone”. Neutralny balans bieli (bez ciepłego filtra) najlepiej działa w scenach z jarmarkiem i w samym produkcie na trawie w cieniu liści.
  - Wzorcowy plan: 1 hero przy obiedzie (tata stawia danie, pies na tylnych łapach, dzieci podskakują); 2 przyjęcie z rozlaną lemoniadą starte jednym ruchem (wodoodporność); 3 transport walizki – mężczyzna od tyłu idzie do znajomych przy grillu; 4 stragan na targu z pełną długością stołu i 2 sprzedawczyniami; 5 śniadanie na kempingu nad jeziorem we mgle; 6 rozkładanie na trawie; 7 pierścień blokady (w tle kolana dorosłych); 8 narożnik po deszczu (w tle zieleń na wysokości blatu); 9 dłoń na rączce w garażu; 10 walizka do bagażnika o niebieskiej godzinie; 11 sam stół 3/4 lekko z góry (kąt z referencji) w niskim słońcu z cieniami liści.

### Kojce, klatki i ogrodzenia modułowe z drutu (flaga: kojec)

#### Blok do promptu
Zachowaj dokładną liczbę i rozmiary paneli, układ kratki lub tafli, położenie drzwiczek, łączników i ewentualnego dachu. Wysokość i szerokość zgodnie z wymiarami; nie dodawaj ścian. Produkt pozostaje czytelny w kinowej, kolorystycznie zaplanowanej scenie.

- Karta: liczba paneli i ich układ na bokach („dłuższy bok = 4 panele, krótszy = 2”), wymiar panelu, kierunek gęstych drutów (pionowe w niskim kojcu, poziome w wysokiej konfiguracji – zależy od obrotu panelu), liczba słupków na każdym boku, rodzaje łączników w każdym miejscu (górne kapsle, kuliste na styku kondygnacji, dolne stopki). Zawsze: „NIE MA dna, dachu, drzwiczek ani kółek – stoi wprost na podłodze, w środku PUSTO / mata”.
- Negative stały: kojec z dnem, plastikowa kuweta-podstawa, dach, drzwiczki, kółka, drewniana rama, biały kojec, srebrne druty, siatka heksagonalna, płot ogrodowy, wygięte ściany, brakujące łączniki, zwierzę przechodzące przez siatkę.
- KONTRAST: czarna siatka znika na trawie, krzewach i ciemnym tle (hero na trawniku odrzucone). Hero i detale: jasne, gładkie tło za sylwetką (tynk w kremie/brzoskwini, jasne płyty kamienne, jasny dąb), kolorowe akcenty TYLKO po bokach, nigdy za siatką; słońce z boku rzuca graficzny cień kratki na ścianę i podłogę. W scenach z ludźmi kolor daje mata w środku (koral, turkus, żółć) – siatka czyta się na niej dobrze.
- Skala: wysokość kojca względem kolana dorosłego / uda dziecka; zwierzęta podane w realnym rozmiarze (królik miniaturka ok. 25 cm).
- Konfiguracje: każda opisana osobno; wysoka wersja z referencji – podać proporcje („wyraźnie dłuższa niż wysoka”), inaczej model robi sześcian.
- Detale łączników: opisywać element po elemencie (kanały w krzyż, żeberka, kołnierz, podstawa, które druty gdzie wchodzą), inaczej model robi gładki kapsel lub nóżkę meblową; łącznik na jasnym parkiecie z rozjaśnionym tłem.
- Zaakceptowany zestaw kojca ART-2278 (12 zdjęć): 1) hero – dziewczynka nos w nos z królikiem baranem przez siatkę, mama na musztardowej sofie, terakota + turkus; 2) ZEWNĄTRZ – króliki na trawie, jeden skacze, chłopiec podaje mlecze, mama w kobalcie na kocu; 3) składanie z gumowym młotkiem, para śmieje się, świnki morskie wyglądają z kartonu; 4) wysoka konfiguracja wieczorem – kot na komodzie zagląda do królika, nastolatka tłumi śmiech, granat + róż; 5) poranek – kobieta w piżamie sypie siano w smudze słońca, świnka „popcorning”, błękitna szachownica + żółta mata; 6) hero w różowym salonie (kąt referencji); 7) hero z góry kąt 1:1 z referencji – koralowa mata, domek, świnki, turkusowa ściana z cieniem okna; 8) wysoka klatka pusta przed brzoskwiniową ścianą z turkusowymi okiennicami (kontrast!); 9) detal łącznika z gumką i dłonią; 10) detal dolnej stopki na jasnym parkiecie z sianem i marchewką.

- Klatki zamknięte z kostek (dach, ściany, dno): model zostawia pustą kratkę bez panelu, przez którą zwierzę wyskakuje lub wychodzi. Pisać liczbę paneli na każdej ścianie („front = 9 paneli (3 × 3), tył = 9, każdy bok = 6, dach = 6, dno = 6, bez żadnej pustej kratki”), „jedynym otworem są drzwiczki”, zwierzęta „w całości wewnątrz, za siatką, nie dotykają frontu”; nie dawać akcji „łapa przez kraty”. Drzwiczki: położenie opisać z punktu widzenia kamery moduł po module (dolny lewy – pełny panel, dolny środkowy – pełny panel, dolny prawy – drzwiczki) i kadrować prawie frontalnie. Negative: brakujący panel, pusta kratka w ścianie, otwór w klatce, otwarty bok/dach, zwierzę wyskakujące z klatki, łapa/głowa przez siatkę.
- Zaakceptowany zestaw klatki piętrowej 3 × 2 × 3 (10 zdjęć): fretki na piętrach z rodzeństwem (krem); kotka szylkretowa z pomponem na górnej półce, kobieta przy biurku (brzoskwinia); królik wychodzi przez drzwiczki-rampę do dziewczynki w żółtej piżamie (pudrowy błękit); hero frontalne z fretkami i kolorowym wyposażeniem; hero na patio przed brzoskwiniową ścianą z turkusowymi drzwiami; hero 3/4 pusta w salonie (kąt referencji, rampa przy tylnym narożniku); detale: drewniany młotek nad łącznikiem, opaska zaciskowa, filcowa podkładka w dłoniach, łącznik od dołu z hamakami w tle.
- Niskie kojce (np. 37 cm z modułów 35 cm): model zawyża wysokość (wychodzi ~50 cm) – panele robi wyższe niż szersze, a kamera przy podłodze dodatkowo wydłuża. Działa: „każdy panel ściany jest KWADRATEM – tak samo szeroki jak wysoki”, „szerokość prawie 3 razy większa niż wysokość, niska płaska skrzynka”, kotwice skali (dach niżej niż siedzisko sofy / materac łóżka, do połowy łydki dorosłego, grzbiet szczeniaka na 3/4 ścianki, nad świnką ponad połowa wysokości), kamera na 80–100 cm patrząca lekko z góry pod 25–30°; opcjonalnie aranżacja sprzedawcy jako „zdjęcie 2 – bierz WYŁĄCZNIE proporcje kojca względem mebli”. Negative: wysoki kojec, panele wyższe niż szersze, kamera przy samej podłodze. Przy zadaszonych wersjach dopisać, że zwierzę leży NA kratce dachu, bo model gubi dach.
- Zaakceptowany zestaw kojca zadaszonego Nobo Kids 3 × 2 × 1 (8 zdjęć): kot leży na dachu i zagląda do królików, kobieta z laptopem się śmieje (turkus + musztarda + koral); ogród – świnki na trawie, szczeniak-mieszaniec węszy przy siatce, rodzeństwo na kocu (złota godzina); drzwiczki w środkowym panelu – królik wychodzi po mlecz do chłopca w piżamie w lisy (pudrowy błękit); wersja bez dachu – nastolatki głaszczą świnki (butelkowa zieleń + róż); hero w salonie z kolorową ściółką i otwartymi drzwiczkami (kąt referencji); hero na terakotowym tarasie przed brzoskwiniową ścianą z turkusowymi drzwiami; detal drzwiczek z pyszczkiem królika i jabłkiem; detal drewnianego młotka nad łącznikiem.
- Wariant z PRZEZROCZYSTYCH płyt (SONGMICS 143 × 73 × 46, płyty PP lekko mleczne, srebrne pręty na krawędziach, czarne łączniki, DNO z 8 płyt 35 × 35): problem odwrotny niż czarna siatka – przezroczysty produkt znika na jasnym, szarym tle. Działa: blok „CZYTELNOŚĆ PRZEZROCZYSTEGO PRODUKTU” (srebrne pręty łapią refleksy, czarne łączniki jak punkty, mleczny połysk i odbicia okna na taflach, przez płyty widać przygaszony kolor), kolorowe tło lub wzorzysty dywan ZA wybiegiem i kolorowa mata w środku; podłoże ciepły parkiet zamiast szarej wykładziny. Negative: niewidoczny produkt, akwarium, gruba szyba, czarna siatka z drutu, kolorowe płyty, białe nieprzezroczyste płyty.
- Zaakceptowany zestaw przezroczystego wybiegu (10+ zdjęć): wieczór filmowy – rodzina na sofie, dzieci przy wybiegu, króliki „oglądają” (granat + ochra); taras domku letniskowego – królik z wiankiem ze stokrotek, mama i córka (złota godzina); montaż – syn z gumowym młotkiem, tata kciuk w górę, chomik w transporterze (kobalt + pomarańcz); czyszczenie – kobieta przeciera płytę żółtą ściereczką, królik myje pyszczek (turkus + żółte kafle + szachownica); litera L – dziewczynka czyta jeżowi pigmejskiemu przy latarce (róż + butelkowa zieleń); detale: młotek nad górnym łącznikiem, dolny łącznik z wycięciami w płytach przy śwince; hero z góry wg kąta zdjęcia sprzedawcy z WKŁADEM HIGIENICZNYM (biały pikowany prostokąt z błękitną ramką na 2 płytach dna, świnka obok, nie na nim; szałwiowa ściana, parkiet w jodełkę, musztardowy fotel). Akcesoria z opisu (wkład, mata) pokazywać w hero jako drugi najważniejszy element z osobnym blokiem.

### Raczki i nakładki antypoślizgowe na buty (flaga: raczki)

#### Blok do promptu
Zachowaj typ uprzęży, łańcuchów oraz dokładną liczbę i położenie kolców zgodnie ze zdjęciami. W scenie z postacią raczki są na obu butach noszonych przez tę postać, w tym samym planie głębi; nie dodawaj ogromnego buta blisko kamery. Prawdziwa fotografia kinowa.

- Styl: kinowy z art direction kolorów (jak drabinki) – decyzja użytkownika po teście 2 zestawów. Produkt sezonowy: sceny zimowe; jeśli opis podaje inne zastosowanie (koszenie skarp), 1 scena letnia.
- Karta: materiał i kolor uprzęży (silikon czarny / guma pomarańczowa), gdzie dokładnie są kolce i ILE na bucie (np. 6 przód + 4 pięta = 10), kształt kolca (żółty krążek z bolcem / stalowa płytka z trójkątnymi zębami), łańcuchy tak/nie, okno pod śródstopiem, pasek-blokada na czubku. Negative: drugi typ raczków (silikonowe z krążkami vs łańcuchowe), raki z metalową ramą, więcej kolców niż w opisie.
- NAJWIĘKSZY BŁĄD: „but na pierwszym planie” + „kamera przy ziemi” = model dokleja ogromny, pływający lub leżący but bliżej obiektywu niż postać (odrzucone 3 ujęcia). Pisać: „raczki na OBU butach, na stopach postaci, w tym samym planie co osoba; nic na pierwszym planie przed nimi”, kamera na wysokości bioder 3–4 m, 35 mm; negative „but na pierwszym planie, ogromny/unoszący się/leżący but, but bliżej kamery niż postać, kamera przy ziemi”. Zbliżenie buta tylko jako osobny detal.
- Efekt AI (plastikowa skóra, przesadnie epickie góry, świecące odpryski, kontra słońca naraz) – dodać „realistyczna skóra, prawdziwe zdjęcie z aparatu”, słońce z boku zamiast w kontrze, krajobraz spokojniejszy.
- Zakładanie: osoba w grubych wełnianych skarpetach trzyma BUT w rękach (na kolanach) i naciąga raczek dokładnie jak na referencji sprzedawcy; negative „raczek naciągany na stopę, osoba w butach”.
- Rozciąganie: przy kominku w schronisku, dłonie rozciągają uprząż jak na referencji, partnerka w tle.
- Zaakceptowany zestaw Koanni (silikon, 10 żółtych kolców): rodzina na oblodzonym szlaku z córką na barana; zakładanie przy bagażniku w norweskich skarpetach; oblodzone schody w kamienicach – ona pewnie, sąsiad balansuje; leśnik na zboczu z seterem irlandzkim; para butów na ośnieżonym pniu (kąt referencji); detal przednich 6 kolców; detal pięty wbijającej się w lód z odpryskami; rozciąganie w schronisku.
- Zaakceptowany zestaw Malcom (pomarańczowa guma, łańcuchy, 8 zębów): mama ciągnie sanki z berneńczykiem do czerwonej chaty, mąż bez raczków drepcze po lodzie; LATO – koszenie stromej skarpy podkaszarką, żona z lemoniadą ślizga się w kaloszach; naciąganie na ganku schroniska w skarpetach; pakowanie do worka z logo przy bagażniku, owczarek szetlandzki wącha łańcuchy; para butów na ośnieżonym głazie (kąt referencji); spód buta na ławce przed schroniskiem; makro zęba z kryształkami lodu; raczki płasko na stole w schronisku z mapą, kubkiem i lampą naftową.
- Zgłaszać sprzedawcy niespójności zdjęć (płytki srebrne vs czarne, więcej zębów niż w opisie, luźne kolce bez wzmianki w opisie).

### Butelki, szkło, płyny (flaga: szklo)

#### Blok do promptu
Kształt i transparentność szkła zgodne z referencją. Kolor samego szkła i kolor płynu są odrębne i wierne zdjęciom; nie dodawaj etykiet ani elementów nieobecnych na produkcie.

- Osobno kolor szkła i kolor płynu („przezroczyste szkło, jasnoniebieski płyn”).
- Kropla i pipeta przy twarzy: środek policzka, wyraźnie poniżej i z boku oka.

### Ekrany i wyświetlacze produktu (flaga: ekran)

#### Blok do promptu
Ekran produktu 1:1 ze zdjęciami: identyczny podział na strefy, położenie ikon, cyfr, napisów i ramek; LCD monochromatyczny lub kolorowy dokładnie jak w referencji. Zachowaj autentyczną skalę urządzenia. Jeśli zdjęcia pokazują sondę lub przewód, odwzoruj ich połączenie, długość i kształt bez wymyślania nowych części.

Dotyczy: stacje pogodowe, budziki, termometry, wagi, liczniki – produkty, których ekran sprzedaje funkcję.
- Układ ekranu opisany strefami z wartościami i kolorami (np. „lewa ramka OUTDOOR – zielone 25.8 °C, niebieskie 61 %RH; środek – ikona prognozy…; dół – biały zegar”); referencja ekranu na wprost jako osobne zdjęcie.
- Te same wartości we wszystkich ujęciach; zmieniamy najwyżej 1–2 wartości, gdy scena tego wymaga (zima: temperatura zewnętrzna na minusie, noc: zegar 02:14), z negative na starą wartość („25.8 °C na zewnątrz”).
- Drobne napisy „wierne albo nieczytelne”; jeśli zdjęcia sprzedawcy mają przekręcone napisy na ekranie (zdjęcia z AI), zgłosić sprzedawcy.
- Ekran świeci jak prawdziwy LCD: nasycone kolory, głęboka czerń, lekki refleks okna na szybce, kolorowa poświata na blacie w półmroku.
- Poziomy jasności = rząd N identycznych sztuk od wyłączonej do pełnej jasności; noc = najniższe podświetlenie przy łóżku.
- Elektronika użytkowa nie tylko w domu: najmocniejsze ujęcie to zastosowanie poza domem z historią związaną z funkcją (barometr → żaglówka przed wypłynięciem, prognoza → wędkarze o świcie).

- SKALA MAŁYCH URZĄDZEŃ (stacja 10,5 × 8,7 cm, czujnik 10,5 × 5 cm): model zawyża rozmiar 2–3× (stacja wyglądała na 20+ cm, czujnik na 30 cm). Przyczyny: zła kotwica („wielkości pocztówki” = 15 cm) i produkt na pierwszym planie bliżej obiektywu niż ludzie. Działa blok „SKALA (KLUCZOWE)” z 3–4 kotwicami: dłoń z palcami dłuższa niż stacja, opuszek zakrywa 1/5 ekranu, czujnik trzymany czubkami 3 palców; przedmioty obok (bloczek karteczek samoprzylepnych, kubek tej samej wysokości, litrowy słoik wyższy, pomidor malinowy, doniczka, łopatka 3× dłuższa, rysunek A4 2× szerszy i 3× wyższy, liście bluszczu, słupek 9 cm); proporcja w kadrze („1/6 szerokości drzwi lodówki”); oraz „produkt w TEJ SAMEJ odległości od kamery co dłoń/twarz osoby”, obiektyw 50 mm z ~2 m. Negative: duża stacja, większa niż dłoń/twarz, wielkości tabletu, bliżej kamery niż ludzie.
- Ekran: monochromatyczny LCD opisany strefami (OUT/linia/IN/4 pola dotykowe) z wartościami; zmiana wartości tylko gdy scena wymaga (zima OUT -8.4 °C, noc IN 21.0 °C) + negative na starą wartość. Podświetlenie nocne: „jasne białe tło, czarne cyfry, białe światło na twarzy”.
- Wszystkie detale sprzedawcy dostają własne ujęcie (suwak dźwięku, tylna podpórka z otworami głośnika) – pominięcie podpórki od tyłu (zastąpiona widokiem z boku) było błędem.
- Zaakceptowany zestaw stacji pogodowej Daily600M (styl kinowy, 10 zdjęć): 1) zima – stacja na lodówce pokazuje -8.4, partnerka wkłada mężczyźnie w cienkim płaszczu czapkę z pomponem, w ręce szal w paski (turkus + czerwień + krem; wersja z dziećmi w tle odrzucona); 2) ZEWNĄTRZ – tata przykręca czujnik do zielonej szopy, owczarek australijski blue merle „pomaga” łapą, złota godzina; 3) noc – tata dotyka podświetlonego ekranu przy łóżeczku, granat + lampka-księżyc; 4) piwnica – dziadek z wiśniami, wnuk oblizuje miód, stacja między słoikami; 5) szklarnia – kobieta je pomidorka, stacja obok doniczki; 6) hero na półce z kubkiem i rośliną, turkusowa ściana (kąt referencji); 7) deszczowy wieczór – stacja na parapecie, czujnik za szybą na ramie okna, rudy kot, kakao; 8) detal suwaka dźwięku z palcem, sypialnia wieczorem; 9) detal tylnej podpórki z otworami głośnika na dębowym biurku; 10) czujnik z rosą na słupku pergoli o świcie.
- Logo na zdjęciach sprzedawcy (John Green) różne od marki w opisie (MalTec) – prompty kopiują logo ze zdjęć; niezgodność zgłosić sprzedawcy.

- Stacja z kolorowym ekranem i podświetleniem (ClimatiQ, 15 × 9,5 cm, czarna ramka): pokazać podświetlenie 2 ujęciami – (a) noc, ekran jedynym źródłem światła z gagiem (przyłapany przy słoiku ciastek o 02:47); (b) hero z DWIEMA identycznymi stacjami obok siebie: lewa bez podświetlenia („matowe szaro-zielonkawe tło, przygaszone kolory, nie czarny ekran”), prawa w pełni podświetlona, palec przy przycisku; negative „ekran podzielony na pół w jednej stacji, obie podświetlone”.
- Funkcje-ostrzeżenia (alarm pleśni, komfort) pokazać sceną-dowodem: ekran (wyróżniona ramka alarmu, wilgotność 78 %, trójkąt pod „TOO WET”) + zaparowana szyba ze spływającymi kroplami + małe, wyraźne skupisko pleśni w narożniku za zasłoną + mina „aha, to dlatego”; scena ciepła, nie ponura (negative: zgniła ściana, wielkie plamy, przerażenie); zostawić spokojną ścianę na ikony.
- Sceny bez gagu/efektu w powietrzu (wietrzenie z otwartym oknem, para na sofie) wyszły „mniej drabinkowe” – odrzucone. Zima zaakceptowana: powrót z sanek, ona strzepuje śnieg z czapki w smudze światła, przykłada lodowate dłonie do policzków partnera, stacja na ścianie przy włączniku (kotwica skali: włącznik 8 cm, lustro 60 cm).
- Zaakceptowany zestaw ClimatiQ (11 zdjęć): drzemka z kotem na twarzy; ZEWNĄTRZ – czujnik na słupku płotu, wyżeł węgierski z patykiem; zima – śnieg w przedpokoju; hero na komodzie (kąt referencji); detale: tył z podpórką i szczelinami X, czujnik na zielonej ramie okna w deszczu, tył czujnika wieszany na wkręcie; noc – słoik ciastek; hero podświetlony vs nie; alarm pleśni.

### Wtopienie produktu w scenę (zawsze przy produkcie na pierwszym planie)
- Twardy, prostokątny produkt na pierwszym planie (elektronika, sprzęt AGD) łatwo wygląda na wklejony: równe frontowe światło niezależne od sceny, ostrość jak wycięta, brak cienia. Prompt musi go związać ze sceną:
  - dotyk – dłoń postaci trzyma, obraca lub wciska produkt;
  - to samo światło co scena – kontra z tego samego źródła na krawędziach, część obudowy w cieniu;
  - kontaktowy cień pod produktem na blacie;
  - odbicie otoczenia (okno, lampa) na szybce ekranu lub połysku obudowy;
  - ostrość zgodna z głębią – krawędzie produktu miękną tam, gdzie mięknie blat.
- Negative: „efekt wklejenia, produkt oświetlony inaczej niż scena, brak cienia pod produktem, krawędzie jak wycięte”.
- Przy wielu elementach w scenie (para, drzwi, mapa, czujnik, markiza) produkt ginie i wygląda obco – w ujęciu z produktem na pierwszym planie najwyżej 1 historia i 2–3 rekwizyty.

### Kolor produktu (zawsze)
- Słowa „jasno-” (jasnożółty, jasnoniebieski) model czyta jako pastel i wybiela kolor. Kolor nasycony opisujemy przez kotwicę z kadru lub znany obiekt („żywy, nasycony żółty – ten sam odcień co żółte pojazdy w zestawie, jak kask budowlany”) i dajemy negative „pastelowy, wyblakły, kremowy, bladożółty”.
- Ciepłe światło przesuwa pastele i szarości w beż: zdanie chroniące kolor („chłodny, jasny, srebrzysty szary – nie beżowy, także w smudze słońca”).

### Dzieci (zawsze)
- Wiek zgodny z opisem; dziecko przy produktach „pod nadzorem” tylko z dorosłym w kadrze; bez sytuacji niebezpiecznych.

---

## Wzorzec promptu

Kolejność modułów (stała):

1. **KIERUNEK** – blok z przepisu stylu (dosłownie).
2. **PRODUKT** – blok produktu z karty, z dopiskiem „(WIERNOŚĆ NAJWAŻNIEJSZA)”: „identyczny jak na zdjęciu 1”, budowa w kolejności elementów, liczby, kolory, faktury, napisy, czego produkt NIE jest, zakaz kopiowania elementów obcych z referencji. W scenach złożonych (kilka osób, woda, ruch) blok PRODUKT idzie na samą górę, przed KIERUNEK, z nagłówkiem „(NAJWAŻNIEJSZE, CZYTAJ NAJPIERW)”.
3. **SKALA** – cm + kotwice.
4. **STAN / CHWYT / ORIENTACJA** – stan produktu, gdzie są dłonie, którą stroną do kamery.
5. **MOMENT** – konkretna sytuacja, argument, emocja, ruch.
6. **KADR** – format, wysokość i kąt kamery, obiektyw, położenie produktu w kadrze, % kadru, co ostre.
7. **POSTAĆ** – wg reguły „Postacie”, stroje bez logo.
8. **ŚWIATŁO** – kierunek, pora, źródła, kontra, co świeci. (Przy flagach drabinka, kojec, ekran i raczki: „ŚWIATŁO I KOLOR” wg sekcji „Styl kinowy”.)
9. **SCENOGRAFIA / TŁO** – w szerokich kadrach konkretne elementy; w zbliżeniach rozmyte plamy koloru i światła. (Przy flagach drabinka, kojec, ekran i raczki: „SCENOGRAFIA I PALETA”.)
10. **STOPKA** – z sekcji „Stopki” wg typu ujęcia.
11. **NEGATIVE** – baza z sekcji „Negative bazowy” + negative przepisu + ryzyka z karty + dopiski ujęcia.

Detal sprzedawcy (krótszy wzorzec): KIERUNEK → DETAL („skopiuj 1:1 kadr ze zdjęcia 1 … Ze zdjęcia 1 NIE kopiuj [grafiki]. Zmienione tylko: …”) → MOMENT → KADR → ŚWIATŁO → TŁO → STOPKA → NEGATIVE.

Referencje:
- Dołączane tylko zdjęcia wskazane w planie, w ustalonej kolejności; prompt mówi „zdjęcie 1”, „zdjęcie 2”.
- Zwykle 1–2 referencje: czysty widok produktu + detal lub poza.
- Infografiki z napisami, kolaże, zdjęcia z obcymi ludźmi lub zwierzętami: nie jako referencje (ich cechy opisujemy słowami).
- Inspiracje i zdjęcia konkurencji: nigdy jako referencje – tylko do spisania zasad słowami.
- Przy słabej wierności: czysty widok produktu dołączony dwa razy albo zaakceptowana wcześniej generacja z wiernym produktem jako „zdjęcie 2 – bierz WYŁĄCZNIE wygląd produktu”.

Kandydaci: 1 generacja na ujęcie; ujęcia z ludźmi i złożone sceny – zalecane 2.

---

## Stopki

| Typ ujęcia | Stopka |
| --- | --- |
| wnętrze, hero we wnętrzu | Ultra realistic, 8k, cinematic light, sharp focus, realistic materials, premium real estate visualization. |
| ludzie, akcja | Ultra realistic, 8k, cinematic light, realistic materials, shallow depth of field, film grain. |
| makro, detal | Ultra realistic, 8k, cinematic light, realistic materials, sharp focus on texture, film grain. |
| hero produktu bez ludzi | Ultra realistic, 8k, cinematic light, realistic materials, sharp focus, film grain. |
| zwierzęta | Ultra realistic, 8k, soft natural window light, realistic materials, shallow depth of field. |
| beauty | Ultra realistic, 8k, cinematic warm golden light, editorial beauty photography, realistic glowing skin, realistic materials, shallow depth of field. |
| ruch | stopka „ludzie, akcja” + motion blur on [element w ruchu]. |

---

## Negative bazowy

render 3D, CGI, efekt wklejenia, kolaż, napisy na zdjęciu, znaki wodne, strzałki, linie wymiarowe, ikony, grafiki, logo innych marek, logo na ubraniach, butach, czapkach i rekwizytach, naszywki, swoosh, przekręcone napisy, zniekształcone dłonie, dodatkowe palce, sklonowane twarze, patrzenie w obiektyw, stockowy uśmiech, pozowanie, typowa uroda AI, idealnie symetryczna twarz, flara, słońce w kadrze, prześwietlone okna, monstera, storczyk, gałązka eukaliptusa, płatki róż, beżowa lniana sofa, złożone lniane ręczniki, sterylna pastelowa łazienka, puste showroomowe wnętrze, amerykańskie wnętrze, dekoracje świąteczne (poza przepisami świątecznymi), świece (poza przepisami świątecznymi), kopiowanie ludzi, zwierząt, roślin i tła ze zdjęć referencyjnych

---

## Procedura przed każdym produktem

Zmiany zasad globalnych (Zasady nadrzędne, Reguły planu, Wzorzec promptu, Stopki, Negative bazowy, sekcje „zawsze”) wprowadzamy WYŁĄCZNIE po akceptacji użytkownika. Lekcje z produktu zapisujemy w regule jego kategorii/flagi.


Silnik przechodzi listę i zapisuje odpowiedzi w karcie. Reguły są odhaczane, nie przypominane z pamięci.

1. Kategoria → przepis stylu.
2. Sezon produktu i sezon użycia; ile ujęć z zimą za oknem (maks. 2–3).
3. Cechy ze wszystkich zdjęć i opisu → każda ma ujęcie.
4. Każde zbliżenie detalu od sprzedawcy → własne ujęcie 1:1.
5. Rozkład światła (maks. 2 w złotej godzinie) i typów kadru (ten sam maks. 2 razy).
6. Hero: produkt w centrum, blisko, z życiem w tle.
7. Każde ujęcie: argument, kierunek, kontrola anty-stock, element ruchu.
8. Postacie i zwierzęta: konkretne cechy, bez typowej urody i ras AI, stroje i rekwizyty bez logo.
9. Skala: kotwice tuż obok, sprawdzenie spójności rachunkiem.
10. Referencje: czyste widoki, bez infografik i kolaży; elementy obce do zakazu kopiowania; warianty produktu.
11. Flagi reguł specjalnych; geometria części i wszystkie strony produktu opisane; funkcje z nietypowych miejsc mają swoje zdjęcie referencyjne.
12. Uczciwość: zawartość zestawu, ilość produktu w kadrze, wiek, skala, brak obietnic zdrowotnych, zalecenia z FAQ.
13. Lista „do zgłoszenia sprzedawcy”.
14. Kolejność w galerii.
