# GrovBase Shot – baza wiedzy silnika lifestyle

Wersja: 2.0 · 15.11.2026
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
Zasady: łazienki z charakterem (ciemny mikrocement, lastryko, zielone płytki, drewno); woda w kontrze w każdym ujęciu z wodą; ludzie od ramion w górę albo tyłem, bez nagości; funkcja ukryta w środku = przekrój techniczny; kilka sztuk obok siebie z różnym działaniem zamiast kolażu; słuchawka w uchwycie już osadzona albo w jednej dłoni.
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
Zasady: kamera na wysokości oczu dziecka; moment odkrycia (zdumienie, zachwyt); rodzic na poziomie dziecka; wiek dziecka zgodny z opisem; czynność z zabawką poprawna (pałeczka w ksylofon, nie w labirynt); małe elementy nigdy przy ustach.
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
- Kilka trybów działania = kilka sztuk obok siebie, każda w innym trybie, zamiast kolażu.
- Komplet zestawu = osobne ujęcie z góry lub z wysokiego kąta.
- Ujęcia bez wyraźnego argumentu są pomijane.

### Hero
- Produkt blisko, dokładnie w centrum, ok. 70–75% kadru, cały i ostry.
- Kinowe światło na produkcie (smuga, kontra) i życie w tle w nieostrości (ludzie, zwierzę, rekwizyty sceny).
- Produkt w pustym pomieszczeniu albo frontalnie w płaskim świetle = odrzut.

### Kadry i światło
- Typy kadru mieszane: hero, szeroki, średni, w dłoni, makro, z góry. Ten sam typ najwyżej 2 razy.
- Złota godzina najwyżej w 2 ujęciach; reszta: poranek, dzień, pochmurny dzień, niebieska godzina, kinowy półmrok, noc z lampką. Ta sama tonacja w ponad połowie zdjęć = stock.
- Pierwszy plan rozmyty tylko przy krawędzi kadru, nigdy na produkcie.
- Kadr z wnętrza pojemnika tylko, gdy otwór leży na osi kamery.
- Bez słońca i flar w kadrze; bez prześwietlonych okien.
- Lustro tylko w ujęciu od strony lustra.

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
- Nikt nie patrzy w obiektyw (wyjątek: ujęcie lustra).
- Negative: typowa uroda AI, idealnie symetryczna twarz, długie falowane blond włosy (gdy nieopisane), stockowy uśmiech, pozowanie.

### Zwierzęta (zawsze)
- Unikamy ras typowych dla AI: golden retriever, labrador, husky, corgi, buldożek francuski. Rasa konkretna, z umaszczeniem i pozą (np. pręgowany whippet, rudy wyżeł węgierski, cocker spaniel, beagle, kot syjamski, rudy pręgowany kot).
- Dotyczy też zwierząt w tle.
- Wielkość zwierzęcia z wymiarów produktu; referencji z niepasującym zwierzęciem nie dołączamy.

### Cudze logo i napisy (zawsze)
- Rekwizyty, ubrania, buty, czapki, plecaki, laptopy, butelki: gładkie, bez naszywek, emblematów, logo i napisów – opisywać to wprost w POSTAĆ/SCENOGRAFIA, nie tylko w negative.
- Napisy na produkcie: „wierne albo nieczytelne, nigdy przekręcone”.
- Na produkcie bez napisów: „bez logo, napisów, wytłoczeń, cyfr i oznaczeń wagi”.

### Skala (zawsze)
- Wymiary w cm + 2 kotwice tuż obok produktu. Najpewniejsze kotwice: dłoń, kartka A4, kubek, butelka 0,5 l, piłka, poduszka, siedzisko 45 cm, stół 75 cm. Porównania z ciałem („od podbródka do żeber”) zawyżają produkt – używać dłoni.
- Produkt prawie kwadratowy lub miękki: proporcja („wyższy niż szeroki, 3:2”) ważniejsza niż wysokość.
- Spójność kotwic: przed promptem sprawdź rachunkiem, czy się nie wykluczają; model rozwiązuje sprzeczność, powiększając produkt. Podest podnosi produkt do potrzebnej wysokości.
- Otwory i pojemności w cm z porównaniem do dłoni („30 × 40 cm = dwie dłonie obok siebie”).
- Duży, ciężki produkt: „kula wyraźnie większa niż głowa dorosłego” itp.; mały produkt trzymać blisko obiektywu.

### Wierność budowy (zawsze)
- Każda widoczna część musi mieć pokrycie w referencji.
- Liczby wpisywane wprost: „DOKŁADNIE 3 ramiona / 2 pompony / 5 sztabek / 7 wkładek”.
- Powtarzalne elementy w zbliżeniu: wymienić każdy element i jego miejsce w kadrze („na pierwszym planie żółta, za nią niebieska, przy prawej krawędzi zielona”), inaczej model gubi te poza kadrem.
- Produkt z sekcjami: nazwać zawartość każdej sekcji i czego w niej nie ma.
- Nie mieszać stanów produktu w jednym kadrze; referencje tylko z tym samym stanem.
- Zbliżenie fragmentu nie jest referencją w ujęciu z całym produktem; prompt mówi, że element jest częścią produktu („kula jest tułowiem figurki”).
- Rekwizyty nie trafiają na produkt w miejscach, których nie ma na referencji.
- Produkt nie montowany w sposób, którego nie pokazują zdjęcia (np. lampa na karniszu).
- W kadrze nigdy drugi egzemplarz produktu, chyba że plan go wymaga (DOKŁADNIE N sztuk).

### Orientacja produktu w ruchu
- Przy ćwiczeniach i dynamicznym ruchu opisać, którą stroną produkt jest do kamery („kamera z przodu-boku 45°, widać przednie pole, NIE spód”).
- W złożonej scenie (kilka osób, woda, ruch) produkt pionowo, kluczową stroną do obiektywu, blisko kamery; przechylony bokiem produkt jest upraszczany.

### Referencje z innego wariantu
- Zdjęcie innego wariantu produktu (inne pokrywy, inne logo, inny kolor) przecieka do generacji mimo zakazu. Dołączać je tylko, gdy jest jedynym źródłem informacji (np. sposób mocowania), z dopiskiem „bierz WYŁĄCZNIE …”, a cechę własnego produktu opisać wprost i powtórzyć w negative.

### Produkty świecące (flaga: swieci)
- Światło produktu ma natężenie jak na prawdziwych zdjęciach: element świecący jednolicie nasycony na całej długości z miękką poświatą; tuż za lub pod produktem powierzchnia łapie mocną plamę koloru; obiekty pod światłem zabarwione, ale z widocznym własnym kolorem; pomieszczenie dalej niż ok. 1 m w naturalnych, ciepłych kolorach.
- Otoczenie ciemniejsze niż produkt (wieczór, półmrok z ciepłymi lampami, pochmurny dzień); limit ujęć nocnych nie obowiązuje.
- Obudowa zachowuje własny kolor (np. czarna).
- Za słabo: „pada miękko, szybko słabnie”. Za mocno: „najsilniejsze światło, zalewa wszystko”.
- Lampy do roślin: magenta, nigdy białe ani żółte.

### Umowna poświata ciepła (flaga: cieplo)
- Produkty grzejące bez widocznego efektu (ogrzewacze): ciepłe, bursztynowo-pomarańczowe światło wewnątrz produktu, najjaśniejsze w środku, słabnące ku brzegom, miękki blask na dłoniach; nie neon, nie ogień, bez iskier. Produkt jako ciepły punkt w chłodnym kadrze.

### Przekrój i wizualizacja działania (flaga: wnetrze)
- Przekrój techniczny: obudowa przecięta, nieprzezroczysta, z widoczną krawędzią cięcia i grubością ścianki (wersja „przezroczysta jak szkło” wygląda jak inny produkt).
- Przepływ: przed i po w samym przepływie (np. mętna woda z osadem na wlocie, czysta na wylocie; kolor umowny, nie błoto).
- Gdy przekrój mógłby wyglądać jak pęknięcie: krawędź cięcia obrysowana cienkimi, świecącymi niebieskimi liniami laserowymi, płaszczyzna idealnie gładka.
- Efekty graficzne funkcji (fale, nutki, przepływ): mało, małe, w tonacji zdjęcia, bez napisów i tęczy.

### Mgiełka, para, dym (flaga: mgielka)
- Opisywać prędkość i zachowanie („powolny, miękki obłok jak oddech na mrozie”), nigdy „strumień”; wskazać jedyne miejsce, z którego wylatuje. Para z napojów i jedzenia zawsze pod światło.

### Materiały przezierne (flaga: siatka)
- Siatki i tkaniny przezierne: kolor, wielkość oczek względem nitek, przejrzystość („czarna, przejrzysta, oczka większe niż nitki, przez siatkę wszystko widać ostro”).

### Produkty miękkie i worki (flaga: miekki)
- Model spłaszcza i zmniejsza miękkie produkty: proporcja + kotwica tuż obok + porównanie z ciałem w szerokich kadrach, dłoń w detalach.
- Worki w stojakach i obręczach: worek włożony od góry, brzeg wywinięty na zewnątrz przez krawędź, poniżej zwisa luźno jak folia z fałdami; negative „sztywny pojemnik, wiadro, kosz z korpusem, worek naciągnięty jak na wiadro”.
- Uchwyty: liczba i położenie wprost („wyłącznie na zewnątrz, dokładnie dwa górne i jeden dolny”).

### Butelki, szkło, płyny (flaga: szklo)
- Osobno kolor szkła i kolor płynu („przezroczyste szkło, jasnoniebieski płyn”).
- Kropla i pipeta przy twarzy: środek policzka, wyraźnie poniżej i z boku oka.

### Kolor produktu (zawsze)
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
8. **ŚWIATŁO** – kierunek, pora, źródła, kontra, co świeci.
9. **SCENOGRAFIA / TŁO** – w szerokich kadrach konkretne elementy; w zbliżeniach rozmyte plamy koloru i światła.
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
11. Flagi reguł specjalnych.
12. Uczciwość: zawartość zestawu, ilość produktu w kadrze, wiek, skala, brak obietnic zdrowotnych, zalecenia z FAQ.
13. Lista „do zgłoszenia sprzedawcy”.
14. Kolejność w galerii.
