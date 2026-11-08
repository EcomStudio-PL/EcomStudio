# GrovBase Shot – baza wiedzy silnika lifestyle (v2)

<!--
FORMAT IMPORTU (GrovBase Shot → Baza wiedzy). Wymagane sekcje: Przepisy stylu, Reguły planu,
Reguły specjalne, Stopki, Negative bazowy. Każdy przepis ma blok #### KIERUNEK.
Teksty KIERUNEK, „Blok do promptu”, stopki i Negative bazowy trafiają do promptu Nano Banana Pro
DOSŁOWNIE. Cała reszta pliku trafia do instrukcji modelu w krokach 2–4 (karta, plan, prompty);
komentarz „etapy:” pod nagłówkiem sekcji zawęża, do których kroków.

ŹRÓDŁA: „GrovBase Shot – specyfikacja silnika lifestyle 2” (@Kuba, 27.10–04.11.2026,
sha256 14454bd6…dd6e8, kopia bez zmian: docs/grovshot-shot/zrodla/) oraz „GrovBase Shot – jak działa
automatyzacja” (@Kuba, 06.11.2026). Przy rozbieżności rozstrzyga dokument „jak działa automatyzacja”.

CELOWO POMINIĘTE ZE STARSZEJ SPECYFIKACJI (zgodnie z „jak działa automatyzacja”):
· Etap 0 jako odrzucanie zdjęć klienta (ostrość, ucięcie, inny wariant) – zdjęcia nie są odrzucane,
  karta zapisuje ich rolę i ograniczenia;
· pytania do klienta o wymiary – brak wymiarów = założenie oznaczone jako założenie;
· Etap 4 (automatyczna kontrola jakości, wybór z dwóch kandydatów, kontrola koloru, ponowna generacja
  z poprawionym promptem) – klient dostaje każde ujęcie i sam decyduje o ponownej generacji;
· „Koszty i limity”, „Otwarte kwestie” – dane biznesowe, nie instrukcje dla modelu.

ZMIANY W v2 (08.11.2026, po diagnozie zniekształconych ujęć całego produktu):
· nowa sekcja „Blok wiązania zdjęć” – pierwszy blok każdego promptu mówi wprost, które zdjęcie
  JEST produktem, które jest detalem, a które grafiką pomocniczą (numeracja = kolejność wysłania);
· „Referencje” opisują reguły, które od v2 egzekwuje kod (całość pierwsza, grafiki na końcu, limit);
· Negative bazowy: logo i napisy produktu na innych przedmiotach, drugi egzemplarz produktu;
· flaga „elektronika” nie narzuca już jasności sceny (rozstrzyga KIERUNEK przepisu), tylko barwę
  i ekspozycję produktu – wcześniej kłóciła się z ciemnymi kierunkami (AGD, półmrok premium);
· stopka domyślna bez „premium real estate visualization” (hasło wnętrz trafiało do patelni i AGD);
  hasło zostaje w osobnej stopce przepisu „Wnętrza premium”.

BLOKI POCHODNE: każdy blok oznaczony „pochodny: tak” został zredagowany z opisowych zasad źródła
(nie jest cytatem). Zasady źródłowe stoją dosłownie pod nim, w „#### Zasady”.
-->

## Zasady ogólne silnika
<!-- etapy: karta, plan, produkt, sceny -->

Silnik zamienia zdjęcia produktu i opis z Allegro w gotowy zestaw 1–10 zdjęć lifestyle na poziomie profesjonalnego grafika. Zdjęcia trafiają do galerii wewnątrz aukcji i mają od razu podnosić postrzeganą jakość produktu. Punktem odniesienia jest poziom reklam dużych marek (np. kampanie lifestyle Philipsa), nie zdjęcia katalogowe. Wierność produktu jest ważniejsza niż artystyczna kreatywność.

Ograniczenia modelu generującego, na których opiera się projekt:

- Model nie zna wymiarów produktu, dopóki nie dostanie odniesienia w prompcie.
- Myli liczbę powtarzalnych elementów (półki, sztuki w zestawie).
- Składa produkt z fragmentów, gdy referencje pokazują tylko części, i dobudowuje brakujące elementy.
- Edycja gotowego zdjęcia psuje kolory (czerwonawa poświata), więc każdy błąd oznacza pełną generację od zera. Ciężar leży na zapobieganiu, nie na poprawianiu.

Decyzje (02.11): zestaw celowo pokazuje produkt w różnych miejscach i sytuacjach (każdy kupujący ma szansę zobaczyć „swój” dom), bez jednej spójnej sesji. Bez automatycznej korekty koloru po generacji: cała jakość ma wynikać z promptu. Sceny pełne i ciepłe zamiast minimalistycznych. Drobne błędy modelu (szczegóły mocowań, odbicia) są akceptowane, o ile nie zmieniają produktu ani nie wprowadzają w błąd.

## Karta produktu
<!-- etapy: karta -->

Karta produktu to najważniejszy plik całego silnika: wszystkie późniejsze etapy czytają z niej, a nie ze zdjęć i opisu bezpośrednio.

Model wizyjny czyta zdjęcia wyłącznie po to, żeby opisać produkt i nazwać rolę każdego zdjęcia (całość, detal, użycie, opakowanie). Niczego nie odrzuca. Bez tego plan nie wie, które zdjęcie dołączyć do którego ujęcia.

### Jak czytać zdjęcia i opis

1. Spójność zdjęć: zdjęcie, które pokazuje inny wariant (inna faktura, kolor spoza oferty, stockowe zdjęcie), oznacz jako inny wariant – plan nie użyje go jako referencji wyglądu produktu.
2. Elementy, których nie wolno kopiować: telefony, strzałki i wymiary, numerki, przekręcone napisy na przedmiotach obok. Takie zdjęcie służy tylko do odczytu danych albo jako referencja samego produktu z wyraźnym zakazem kopiowania tych elementów.
3. Dodatki z referencji: np. wklejone kocięta na zdjęciu drapaka. Zapisz je w karcie, prompt musi zakazać ich kopiowania.
4. Wymiary: z opisu; brak w opisie = założenie ze zdjęć wyraźnie oznaczone jako założenie. Niejasne wymiary (np. 120×110×30 bez opisu osi) = zapisz założenie, której osi dotyczy która liczba, i oznacz je jako niepewne.
5. Zgodność opisu ze zdjęciami: np. opis mówi „Gray”, a obudowa jest lawendowa. Opisz kolor tak, jak go widać.
6. Nie wykluczaj zdjęcia z powodu drobnego tekstu (naklejki, napisy na boku): każde zdjęcie pokazujące inny widok produktu zwiększa wierność.

### Pola karty produktu

| Pole | Zawartość | Przykład z testów |
| --- | --- | --- |
| produkt | czym jest, wariant | zestaw 8 foremek ze stemplem |
| wymiary | z opisu albo założenie oznaczone jako założenie | 120 × 110 × 30 cm |
| skala w odniesieniu | porównania z przedmiotami znanymi modelowi | „długość jajka”, „na wysokości klamki” |
| wygląd i budowa | kolor, materiał, elementy w kolejności, liczba elementów | 2 kolumny × 6 poziomów |
| napisy i logo | co jest na produkcie, co musi zostać | „TOKIN”, „BEAUTY LIMITED®” |
| stany produktu | zamknięty, otwarty, rozmontowany, z inną końcówką + które zdjęcie pokazuje który | szafka zamknięta / otwarta / sam stelaż |
| dostępne kąty | z jakich stron są zdjęcia | przód i 3/4 z lewej, brak prawego boku |
| role zdjęć | produkt (całość), efekt użycia, opakowanie, detal | foremki + ciasteczka |
| grafiki do zakazu kopiowania | wymiary, strzałki, inne produkty, dodatki | Z4: linie wymiarowe i gwiazdki |
| argumenty sprzedażowe | z opisu, po jednym na ujęcie | pojemność, mycie w zmywarce |
| zastosowania i miejsca użycia | lista z opisu | kuchnia, łazienka, okna, samochód |
| grupa docelowa | kto kupuje, kto używa, wiek | rodziny 30–55 lat |
| ograniczenia uczciwości | wiek dziecka, waga zwierzęcia, brak wodoodporności, moc światła | koty do 4 kg, dzieci od 3 lat |
| sezon | sezon produktu i sezon użycia | foremki = zima; inhalator całoroczny, używany jesienią i zimą |
| ryzyka | co model typowo psuje przy tym produkcie | rośnie, traci półki, zmienia kolor |
| flagi kategorii | cechy, które włączają reguły specjalne | swieci, miekki, sezonowy, dla_zwierzat |
| przepis stylu | id jednego z przepisów z sekcji „Przepisy stylu” | wnetrza_premium |

## Procedura przed każdym produktem
<!-- etapy: karta, plan -->

Zanim powstanie plan ujęć, silnik przechodzi tę listę i zapisuje odpowiedzi w karcie produktu. Zasady nie są przypominane z pamięci, tylko odhaczane.

1. Kategoria → przepis stylu i jego światło (sekcja „Przepisy stylu”).
2. Sezon produktu i sezon użycia.
3. Rozkład światła w zestawie: ile ujęć w którym świetle (maks. 2 w złotej godzinie).
4. Rozkład typów kadru: ten sam typ maks. 2 razy.
5. Każde ujęcie ma kierunek z tabeli kierunków kreatywnych i przechodzi kontrolę anty-stock.
6. Referencja wybrana według strony produktu widocznej z kamery; akcesoria połączone opisane jako jeden przedmiot z liczbą sztuk.
7. Efekt działania i przed/po tam, gdzie produkt rozwiązuje problem.
8. Uczciwość: zawartość zestawu, wiek, skala, bez obietnic zdrowotnych.

## Przepisy stylu

Reklamowy wygląd nie powstaje z jednego przepisu: każda kategoria potrzebuje własnego, a przepis opisuje zasady, nie gotową scenografię. Silnik wybiera przepis w karcie produktu i dokleja jego KIERUNEK do każdego ujęcia zestawu. Scenografię za każdym razem dobiera konkretnie i różnorodnie. Korekty dotyczą swojej kategorii (maska lakiernicza, 29.10): poprawka z jednego produktu (np. „jasno, jak katalog IKEA” przy czujniku czadu) nie może nadpisać przepisu innej kategorii. Najpierw przepis kategorii, potem korekty zapisane dla tej kategorii.

Blok stylu nie może opisywać konkretnego miejsca (worek ogrodowy, 30.10): szczegółowy opis domu we wspólnym bloku daje ten sam dom w każdym ujęciu. Wspólny blok (KIERUNEK) opisuje tylko światło, klimat i jakość; miejsce opisuje się osobno w każdym ujęciu i każde jest inne.

### Przepis: Reklama sezonowa
- id: reklama_sezonowa
- kategorie: produkty sezonowe
- haslo: np. „grudniowa reklama cukiernicza premium”
- sprawdzony na: foremki
- pochodny: tak – hasło gatunku uogólnione z przykładu, światło z tabeli przepisów, zdanie „Prawdziwe zdjęcie, nie render (raw photo)” z modułu KIERUNEK wzorca promptu

#### KIERUNEK
Sezonowa reklama premium w nastroju pory roku produktu. Prawdziwe zdjęcie, nie render (raw photo). Ciepłe, kinowe światło ze źródłem widocznym w kadrze (piekarnik, lampki), złote bokeh w tle.

#### Zasady
Światło: ciepłe, kinowe, źródło w kadrze (piekarnik, lampki), złote bokeh. Scenografia warstwowa: rozmyte rekwizyty na pierwszym planie, rekwizyty związane z zastosowaniem i porą roku; efekty (mąka w świetle) tylko w zbliżeniach. Hasło gatunku dopasowane do produktu i pory roku, np. „grudniowa reklama cukiernicza premium”.

### Przepis: AGD i jedzenie
- id: agd_jedzenie
- kategorie: AGD kuchenne
- haslo: reklama premium AGD, food styling
- sprawdzony na: frytkownica
- pochodny: tak – hasło gatunku i światło z tabeli przepisów, zdanie „Prawdziwe zdjęcie, nie render (raw photo)” z modułu KIERUNEK

#### KIERUNEK
Reklama premium AGD, food styling. Prawdziwe zdjęcie, nie render (raw photo). Światło kierunkowe z boku i kontra, refleksy na stali, tło ciemniejsze od produktu.

#### Zasady
Światło: kierunkowe z boku + kontra, refleksy na stali, tło ciemniejsze. Produkt najjaśniejszy w kadrze; jedzenie złociste, z fakturą; nastrój dopasowany do argumentu (zmywarka jasno, spotkanie wieczorem).

### Przepis: Wnętrza premium
- id: wnetrza_premium
- kategorie: meble, wyposażenie, organizacja
- haslo: premium real estate visualization
- sprawdzony na: szafka
- pochodny: tak – hasło gatunku i światło z tabeli przepisów, zdanie „Prawdziwe zdjęcie, nie render (raw photo)” z modułu KIERUNEK

#### KIERUNEK
Premium real estate visualization. Prawdziwe zdjęcie, nie render (raw photo). Dzienne światło od okna lub drzwi, ciepła lampa jako akcent, szlachetne materiały, ograniczona paleta.

#### Zasady
Światło: dzienne od okna lub drzwi, cień rośliny, ciepła lampa. Pełny kadr z 5–6 mocnych elementów (drzwi/okno, sztuka, oświetlenie, mebel towarzyszący, roślina, drobiazgi); szlachetne materiały; ograniczona paleta; zawartość zróżnicowana.

### Przepis: Home care
- id: home_care
- kategorie: sprzątanie, czystość
- haslo: reklama premium środków czystości
- sprawdzony na: mikrofibra
- pochodny: tak – hasło gatunku i światło z tabeli przepisów, zdanie „Prawdziwe zdjęcie, nie render (raw photo)” z modułu KIERUNEK

#### KIERUNEK
Reklama premium środków czystości. Prawdziwe zdjęcie, nie render (raw photo). Jasne, ale kinowe światło: słońce z boku lub zza obiektu, kontra, połysk; słońce nigdy w kadrze.

#### Zasady
Światło: jasne, ale kinowe: słońce z boku lub zza obiektu, kontra, połysk. Ujęcia z akcją i ruchem, efekt czyszczenia przez kontrast, kamera nisko przy powierzchni; słońce nigdy w kadrze.

### Przepis: Outdoor i akcja
- id: outdoor_akcja
- kategorie: zabawki RC, sprzęt outdoorowy, odzież zimowa
- haslo: kampania marki outdoorowej
- sprawdzony na: auto RC, czapka LED
- pochodny: tak – hasło gatunku i światło z tabeli przepisów, zdanie „Prawdziwe zdjęcie, nie render (raw photo)” z modułu KIERUNEK

#### KIERUNEK
Kampania marki outdoorowej. Prawdziwe zdjęcie, nie render (raw photo). Złote, niskie słońce z kontrą albo niebieska godzina.

#### Zasady
Światło: złote, niskie słońce z kontrą albo niebieska godzina. Kamera przy ziemi, kurz, piasek, śnieg, para oddechu w świetle; nawierzchnie z opisu.

### Przepis: Lifestyle zwierząt
- id: lifestyle_zwierzat
- kategorie: akcesoria dla zwierząt
- haslo: kampania lifestyle premium marki dla zwierząt
- sprawdzony na: drapak
- pochodny: tak – hasło gatunku i światło z tabeli przepisów, zdanie „Prawdziwe zdjęcie, nie render (raw photo)” z modułu KIERUNEK

#### KIERUNEK
Kampania lifestyle premium marki dla zwierząt. Prawdziwe zdjęcie, nie render (raw photo). Miękkie, rozproszone, ciepłe światło przez firany, zapalone lampy.

#### Zasady
Światło: miękkie, rozproszone, ciepłe przez firany, zapalone lampy. Zwierzę bohaterem, kamera na wysokości jego oczu, wnętrze przytulne i urządzone; w zbliżeniach tło opisane jako bokeh, nie lista przedmiotów.

### Przepis: Edytorski lifestyle beauty
- id: beauty_edytorski
- kategorie: urządzenia beauty, pielęgnacja
- haslo: edytorska kampania lifestyle premium marki beauty
- sprawdzony na: szczoteczka soniczna, prostownica
- pochodny: tak – pierwsze dwa zdania dosłownie z przykładu modułu KIERUNEK, światło z tabeli przepisów

#### KIERUNEK
Edytorska kampania lifestyle premium marki beauty. Prawdziwe zdjęcie, nie render (raw photo). Złote, nisko stojące słońce przez firany i żaluzje, kontra na włosach.

#### Zasady
Światło: złote, nisko stojące słońce przez firany i żaluzje, kontra na włosach. Wnętrza z charakterem (kamienica, loft, kolorowe meble), wyraziste modelki, skóra zdrowa i rozświetlona bez akcentowania porów.

### Przepis: Kinowy przemysłowy
- id: kinowy_przemyslowy
- kategorie: narzędzia, sprzęt ochronny, warsztat
- haslo: kinowa kampania marki narzędziowej
- sprawdzony na: maska lakiernicza
- pochodny: tak – KIERUNEK zredagowany ze światła i jakości przepisu „kinowy przemysłowy” (bez miejsca)

#### KIERUNEK
Kinowa kampania marki narzędziowej. Prawdziwe zdjęcie, nie render (raw photo). Twarde światło kluczowe z boku i mocna kontra z tyłu, chłodne tło z ciepłym akcentem lamp, płytka głębia ostrości, ziarno filmowe.

#### Zasady
Przepis „kinowy przemysłowy” (narzędzia, sprzęt ochronny, warsztat): ciemny warsztat z akcentami lamp, twarde światło kluczowe z boku i mocna kontra z tyłu; pył, mgiełka lakieru, iskry i wióry podświetlone w powietrzu; chłodne tło z ciepłym akcentem; niski, „bohaterski” kąt kamery; postać jako pewny siebie fachowiec w skupieniu, faktury skóry, pot, kurz na ubraniu; płytka głębia ostrości, ziarno filmowe. Jasne, równe światło dnia w zwykłym garażu daje tu efekt taniego stocku.

Z referencji narzędziowych (Hitachi, Ryobi, piły, siekiery): produkt dominuje kadr z bardzo niskiego kąta (często 60–80% kadru), człowiek jest częściowy: dłonie, profil, sylwetka w nieostrości; styl reportażowy, światło zastane i praktyczne lampy, prawdziwe zużycie i kurz. Twarz na wprost, symetrycznie w środku kadru i efekty świecenia dają najbardziej sztuczny wynik (maska lakiernicza, ujęcie wizualizacji). Efekt działania pokazywać realnie (zakurzony filtr obok czystego, czysty ślad po masce na zakurzonej twarzy), a nie poświatą.

Maska lakiernicza (29.10): zadziałało połączenie przepisu „kinowy przemysłowy” dla ujęć detali (ciemny warsztat, kontra, mgiełka), stylu reportażowego dla ujęć użycia (niski kąt, profil, kurz i mgiełka w kontrze) oraz detali ze zdjęć sprzedawcy kopiowanych 1:1 z nową scenerią. Ujęcia użycia w różnych miejscach (warsztat, sad, budowa, przystań) pokazują szerokość zastosowań.

### Przepis: Ogród i plener
- id: ogrod_plener
- kategorie: ogród, kosiarki, glebogryzarki, myjki, worki i kosze ogrodowe
- haslo: kampania marki ogrodowej
- sprawdzony na: worek ogrodowy (z referencji kosiarek, glebogryzarek, myjek)
- pochodny: tak – KIERUNEK zredagowany ze światła i jakości przepisu „ogród i plener” (bez miejsca, zgodnie z korektą 30.10)

#### KIERUNEK
Kampania marki ogrodowej. Prawdziwe zdjęcie, nie render (raw photo). Ostre, czyste słońce i głęboko niebieskie niebo albo niskie słońce z kontrą; nasycona, ale naturalna zieleń.

#### Zasady
Przepis „ogród i plener” (z referencji kosiarek, glebogryzarek, myjek, 29.10): kamera przy samej trawie, rozmyte źdźbła na pierwszym planie, produkt duży i dominujący; ostre, czyste słońce i głęboko niebieskie niebo albo niskie słońce z kontrą; nasycona, ale naturalna zieleń, trawnik w pasy; nowoczesny polski dom (elewacja z drewna, płaski dach, duże przeszklenia), żywopłot z tui, kostka brukowa, drewutnia; ludzie w odzieży roboczej w kolorze beżu i oliwki, w skupieniu, nie pozują; materiał w ruchu (ziemia, liście, trawa, woda) w kontrze; przed i po na jednej powierzchni. Taras wieczorem: girlandy żarówek, poduszki, drewno, styl IKEA.

Miejsce opisuje się osobno w każdym ujęciu i każde jest inne („nowoczesny dom” wystarcza modelowi do różnorodności). Ogrody i podwórka zawsze pełne i zamieszkane jak we wnętrzach: rabaty, donice, meble ogrodowe, zabawki, rower, wąż ogrodowy, drzewa owocowe. Pusty trawnik z żywopłotem = stock. Ogrody europejskie: bez amerykańskich domów z cegły i podjazdów z garażem na dwa auta.

### Przepis: Świąteczna aura
- id: swiateczna_aura
- kategorie: dekoracje i produkty świąteczne
- haslo: bożonarodzeniowa kampania reklamowa, magiczna, bajkowa aura
- sprawdzony na: dziadek do orzechów (03.11)
- pochodny: tak – KIERUNEK zredagowany z hasła gatunku i korekty przepisu świątecznego z 03.11 (korekta wygrywa z pierwszą wersją przepisu)

#### KIERUNEK
Bożonarodzeniowa kampania reklamowa, magiczna, bajkowa aura, jak klatka ze świątecznego spotu. Prawdziwe zdjęcie, nie render (raw photo). Światło tylko z prawdziwych źródeł (lampki, świece, ogień, latarnie za oknem), ciepłe światła i chłodniejsze, głębokie cienie, umiarkowane nasycenie, ziarno filmowe.

#### Zasady
Przepis „świąteczna aura” (z referencji grafika, 03.11): jeden stół czy kominek z kilkoma ozdobami to za mało. Potrzebne warstwy: (1) pierwszy plan z rozmytymi gałązkami jodły, czerwonymi jarzębinami, bombkami, cynamonem i suszoną pomarańczą przy krawędziach kadru; (2) środek z produktem otoczonym gęsto dekoracjami; (3) tło pełne złotego bokeh: girlandy z lampkami na każdej linii (półki, okno, kominek), choinka, świece; (4) za oknem gęsto padający śnieg; (5) unoszące się w powietrzu drobiny (śnieg, brokat, mąka) w smugach światła. Paleta: ciepłe złoto, głęboka czerwień, butelkowa zieleń, krem.

Korekta przepisu świątecznego (03.11) – ważniejsza od pierwszej wersji: pełne warstwy z drobinami w powietrzu, rekwizytami w każdym rogu i złotym filtrem dają kicz. Cel to klatka ze świątecznego spotu firm meblowych i cukierniczych: realistyczny dom, dekoracje w ilości, jaką mają prawdziwi ludzie, światło tylko z prawdziwych źródeł (lampki, świece, ogień, latarnie za oknem), ciepłe światła i chłodniejsze, głębokie cienie, umiarkowane nasycenie, ziarno filmowe. Brokat i drobiny tylko w kuli produktu, śnieg tylko za oknem. Rozmyty pierwszy plan najwyżej w co drugim ujęciu.

## Zasady wspólne dla wszystkich przepisów
<!-- etapy: plan, sceny -->

- Wnętrza europejskie, bez amerykańskich sprzętów (lodówki z dystrybutorem, gniazdka US). Aspiracyjne, ale osiągalne; klasa wnętrza dopasowana do ceny produktu.
- Bez flar i słońca w kadrze.
- Lista zakazanych klisz AI: cień liści na ścianie w każdym ujęciu, monstera, beżowa lniana sofa, płatki róż, storczyki, świece, sterylna łazienka w pastelach, pralnia z jasnym dębem i białymi płytkami w jodełkę, gałązka eukaliptusa w szklanym wazonie, złożone lniane ręczniki, szklana butelka bez etykiety, ogólnie „ładne, puste, jasne wnętrze z katalogu” bez momentu i nastroju. Lista rośnie z testami.
- Ciepłe światło przesuwa pastelowe kolory produktu → przy pastelowych produktach osobne zdanie chroniące kolor (reguła specjalna „pastelowy”).
- Inspiracje (Pinterest, kampanie marek) służą do spisania zasad słowami. Nie wysyłamy ich jako referencji do generacji (prawa autorskie, kopiowanie kompozycji).
- Rekwizyty bez marek i napisów. Model przenosi logo produktu na rekwizyty (szczotka z logo BaByliss obok prostownicy), co sugeruje, że są w zestawie.
- Lustra tylko w ujęciu od strony lustra. W szerokich kadrach model nie generuje poprawnych odbić osób, więc lustro skierowane na postać pomijamy albo ustawiamy bokiem do kamery.
- Złożone techniki użycia (kręcenie loka prostownicą) model upraszcza. Lepiej pokazać prosty, czytelny moment i gotowy efekt obok.

## Kierunki kreatywne
<!-- etapy: plan, sceny -->

Kierunki kreatywne pochodzą z ok. 40 referencji kampanii marek (28.10.2026). Główna zasada: zdjęcie pokazuje moment z życia, w którym produkt daje korzyść, sfotografowany jak kadr z filmu, a nie produkt w ładnym pokoju. Prompt zaczyna się od czasownika i emocji, nie od listy przedmiotów.

| Kierunek | Kiedy | Światło i kolor | Kadr i znaki rozpoznawcze |
| --- | --- | --- | --- |
| Kinowy półmrok premium | AGD, droga elektronika, hero | ciemne wnętrze, twarde niskie słońce, smugi i cienie żaluzji na ścianie | produkt lub osoba w plamie światła, reszta w cieniu |
| Ciepły lifestyle pod światło | dom, kuchnia, rodzina, beauty | złote słońce zza okna, kontra na włosach, rozmyty pierwszy plan | ludzie w trakcie czynności, kolorowe ubrania kontrastujące z tłem |
| Energetyczna akcja | narzędzia, sport, zabawki | jasne, kontrastowe, słońce zza obiektu | szeroki kąt z bardzo nisko, produkt duży na pierwszym planie, lecące wióry, kurz, krople |
| Nocny nastrój | gaming, sen, oświetlenie, oczyszczacze | jedyne źródło: ekran, lampka, neon; chłód z ciepłym akcentem | ciemne, nasycone, intymne |
| Wizualizacja działania | każda niewidoczna funkcja | jak sceny wyżej | subtelny efekt graficzny bez napisów: fale dźwięku, przepływ powietrza lub wody, ślad trasy, przekrój przez materiał |
| Przed i po w jednym kadrze | czyszczenie, pielęgnacja, naprawa | jak sceny wyżej | czysty pas w brudzie, jeden element brudny obok czystego, kadr podzielony na dwie połowy, dwie osoby w tej samej sytuacji: jedna z produktem bez kłopotu, druga bez produktu z problemem (z humorem, bez ośmieszania) |
| Produkt w dłoni | małe urządzenia, akcesoria | pod światło, głęboki bokeh | dłoń trzyma produkt przodem do kamery |
| Kreatywny punkt widzenia | małe produkty, opakowania | jak sceny wyżej | kadr z wnętrza torby, szuflady, pralki, przez drzwi; wielokrotna ekspozycja tej samej osoby do pokazania wielu zastosowań |
| Kolorowy świat dziecka | zabawki, artykuły dziecięce | jasne, nasycone, słońce | szeroki kąt z perspektywy dziecka, mocne kolory, wyraźna radość |
| Zwierzę i emocja | produkty dla zwierząt | ciepłe, miękkie lub twarde słońce | kamera nisko, emocja zwierzęcia i opiekuna |

Składniki obowiązkowe w każdym ujęciu z ludźmi: konkretna czynność w toku, wyraźna emocja (śmiech, skupienie, satysfakcja, zachwyt), światło z kierunkiem i cieniem w kadrze, kolor ubrania dobrany celowo, tło spokojniejsze niż produkt.

Efekty wizualne podkreślające działanie są pożądane (para, krople, przepływ, wióry, kurz, fale), ze smakiem i bez napisów. Napisy, plakietki i opisane powiększenia należą do przyszłego narzędzia z grafikami reklamowymi. Efekty graficzne funkcji (nutki, fale): mało, małe, w tonacji zdjęcia, bez kolorów tęczy i dodatków typu pięciolinia.

Kontrola anty-stock przed każdym promptem: czy wiadomo, co się dzieje w tej sekundzie? czy ktoś coś czuje? czy światło ma kierunek i porę dnia? czy widać efekt działania? czy kadr jest ciekawszy niż „produkt na środku blatu”? Jeśli na dwa pytania odpowiedź brzmi nie, scena idzie do przepisania.

Zróżnicowanie światła w zestawie: maksymalnie 2 ujęcia w złotej godzinie. Reszta: chłodny poranek, niebieska godzina, kinowy półmrok, rozproszone światło pochmurnego dnia, noc z lampką. Ta sama tonacja w ponad połowie zdjęć = wygląd stockowy.

Korekta (czujnik czadu, 29.10): „chłodne i czyste” nie znaczy ciemne i szare. Cały zestaw w chłodnym półmroku wygląda ponuro, tanio i nie budzi zaufania. Domyślnie: jasne, naturalne światło dnia i wnętrza pełne życia; noc i półmrok tylko w 1–2 ujęciach i zawsze z ciepłymi źródłami światła (lampy, kominek, ekran) oraz kolorowymi akcentami.

Czego unikać (odrzucone ujęcia): prześwietlone okna i bramy, flary, puste „showroomowe” wnętrza, nierealne układy (kominek na środku salonu), zwykłe sceny bez akcji i emocji (alarm, sypialnia, montaż pod sufitem).

Pora roku za oknem: produkt używany cały rok (kuchenka, przedpokój) → lato lub neutralna pora; zima tylko tam, gdzie naprawdę jest sednem (kominek, inhalacja). Zimowa aura w każdym ujęciu robi zestaw ponurym.

Proporcja ujęć nastrojowych: zdjęcia z silnika trafiają do galerii wewnątrz aukcji, nie na miniaturę listingu (tam jest zdjęcie na białym tle, poza zakresem silnika). Ujęcia nastrojowe i ciemniejsze są więc w porządku; warunek jest jeden: w każdym ujęciu produkt jest rozpoznawalny i nie znika za ludźmi ani w cieniu.

## Reguły planu
<!-- etapy: plan, sceny -->

Plan ujęć to etap, który najbardziej decyduje o jakości: silnik przejmuje tu rolę reżysera, nie tylko autora promptów. Każde ujęcie w planie ma: argument, typ (hero, użycie, detal), kierunek kreatywny, miejsce, światło, typ kadru, ludzi (brak, dłonie, postacie), referencje w kolejności dołączania i jedno zdanie opisu sceny. Każde ujęcie ma jedną generację; klient sam decyduje o ponownej generacji.

### Treść: co pokazuje każde zdjęcie

1. Jedno zdjęcie = jeden argument sprzedażowy z opisu. Nie „ładne sytuacje”, tylko cechy: wszechstronność, obsługa, pojemność, mycie, wspólne chwile.
2. Opis wymienia zastosowania lub miejsca użycia → każde ujęcie to inne zastosowanie, w innym pomieszczeniu.
3. Każde wyraźnie inne zdjęcie od sprzedawcy to kandydat na osobne ujęcie (np. kosz z frytkami, zmywarka), bo pokazuje, co sprzedawca uważa za ważne.
4. Efekt działania widoczny dzięki kontrastowi: kurz na ciemnym blacie, kolorowy sok zamiast przezroczystej wody, smugi na czarnej płycie. Zabrudzenie realistyczne, nie przesadzone.
5. Każde ujęcie z akcją ma element ruchu: krople, piana, kurz, para nad jedzeniem.
6. Argumenty bez akcji (liczba sztuk, organizacja) tylko w hero, nie jako osobne ujęcia.
7. Produkty składane pokazujemy w trakcie montażu, częściowo złożone. Rozwiązuje to liczenie elementów i skalę.
8. Uczciwość: efekt działania pokazujemy wyraźnie, także jako przed i po, gdy jest realny przy typowym użyciu (np. buty przed i po praniu w worku); bez efektów na skórze i ciele, których produkt nie gwarantuje, bez wody przy produktach niewodoodpornych, bez akcesoriów spoza zestawu (np. kabel), wiek dziecka i wielkość zwierzęcia zgodne z opisem, moc światła bez przesady.
9. Pomijamy zastosowania z cudzym logo w kadrze, np. kokpit samochodu.
10. Cecha ważna dla kupującego dostaje własne ujęcie, nawet jeśli wymaga akcesorium spoza zestawu (np. zasilanie bateryjne: komora z bateriami bez napisów). Rozstrzyga to, czy kupujący musi to wiedzieć, a nie to, czy akcesorium jest w zestawie.
11. Ujęcia bez wyraźnego argumentu (np. zdjęta maska i twarz) są pomijane.

### Kadr i różnorodność zestawu

1. Zestaw miesza typy kadrów: szeroki w otoczeniu, średni, ciasny, produkt w dłoni, bez ludzi (hero lub z góry). Ten sam typ kadru najwyżej dwa razy.
2. Zestaw miesza miejsca, a inspiracje to pula scenerii do rozłożenia na ujęcia, nie jeden wzór.
3. Cały zestaw ma jeden przepis stylu, także ujęcia bez ludzi.
4. Cały produkt najwyżej w 2 ujęciach, reszta to zbliżenia z akcją.
5. Hero: produkt dominuje i stoi w centrum, nic go nie zasłania, przed nim wolna przestrzeń.
6. Pierwszy plan tylko w zbliżeniach i przy krawędzi kadru, nigdy na produkcie.
7. Kolejność na aukcji: najpierw produkt i jak działa, potem emocje.

### Detale od sprzedawcy

Obowiązkowe (maska lakiernicza, 29.10): każde zbliżenie detalu przysłane przez sprzedawcę (mocowanie, wnętrze, uszczelka, paski, filtry osobno) dostaje własne ujęcie: detal skopiowany 1:1 z referencji, a zmienione tylko tło, światło i klimat na styl zestawu. Zestaw = mieszanka ujęć użycia i ujęć detali, mniej więcej po połowie. Ujęcie zestawu pokazuje wszystkie elementy z góry lub z wysokiego kąta, nigdy z poziomu blatu.

Gdy zamówiono mniej zdjęć, niż jest detali od sprzedawcy, pierwszeństwo mają detale najważniejsze dla argumentów sprzedażowych; konflikt zapisuje się w planie, nie dokłada ujęć.

### Wierność produktu

1. Każda widoczna część produktu musi mieć pokrycie w którejś referencji. Kąt może być nowy, ale bez części, których nikt nie widział (np. bok foremki z tłoczkiem).
2. Zbliżenie = wycinek znanego widoku z referencji, z tego samego kąta. Zbliżenie z referencji zostaje zbliżeniem.
3. Nie mieszamy dwóch stanów produktu w jednym kadrze i nie wysyłamy referencji z innym stanem (pokrowiec + goły stelaż = hybryda).
4. Przy produktach z wymiennymi częściami zawsze zdjęcie całości, nie same fragmenty.
5. Wiele sztuk w scenie z ludźmi: maksymalnie 2–3 widoczne. Pełny komplet tylko w hero.
6. Każdy egzemplarz produktu w kadrze widziany pod kątem zgodnym z kamerą. Przy niskiej kamerze nie kładziemy produktu „twarzą do góry”, bo wychodzi efekt naklejki.
7. Położenie człowieka lub zwierzęcia na produkcie zgodne z jego budową (kot przy myszkach = najwyższe piętro).
8. Nie wykluczamy referencji z powodu drobnego tekstu (naklejki, napisy na boku). W większości ujęć produkt jest na tyle daleko, że tekst i tak byłby nieczytelny także na prawdziwym zdjęciu; prompt mówi „napis wierny albo nieczytelny”. Każde zdjęcie pokazujące inny widok produktu zwiększa wierność.
9. Gdy sprzedawca ma zdjęcie konkretnego chwytu lub detalu, ujęcie kopiuje pozę 1:1 i zmienia tylko tło, światło i jeden element. Budowanie złożonej czynności od zera (dwie dłonie wkładające baterie) wymagało w testach wielu generacji i zawodziło.
10. Kadr z fragmentem produktu o kilku sekcjach: prompt nazywa każdą widoczną sekcję i jej zawartość oraz mówi wprost, czego w niej nie ma („drążki wyłącznie w prawej kolumnie”). Inaczej model przenosi elementy między sekcjami.
11. Liczba paneli i segmentów opisana przez cechy, które da się policzyć: „3 panele, 3 uszka na górze, 2 zamki między nimi”, plus proporcja do sąsiedniego przedmiotu (np. drzwi). W szerokich ujęciach 3/4 model dokłada segmenty i rozciąga produkt.
12. Rekwizyty nie trafiają na produkt w miejscach, których nie ma na referencji. Miś w kieszeni bocznej sprawił, że model dorobił kieszeń na froncie.
13. Montaż z życiem: dwie osoby albo osoba z interakcją (kawa na kartonie, instrukcja, śmiech), zamieszkane wnętrze. Pusty biały pokój i pojedyncza postać wyglądają jak stock AI.
14. Zbliżenie fragmentu jako referencja w scenie z całym produktem (dziadek do orzechów, 03.11): dołączenie zbliżenia samej kuli sprawiło, że model wygenerował osobną kulę obok figurki albo skrócił figurkę. W ujęciach z całym produktem dołączamy tylko widoki całości, a prompt mówi wprost, że element jest częścią produktu („kula jest tułowiem figurki, jeden przedmiot”).
15. Referencja z błędnym kolorem detalu (miętowy zamek na zdjęciu z pralką) przenosi błąd do sceny – do sceny wybieramy referencję z poprawnym kolorem.

### Referencje

- Dołączane są zdjęcia wskazane w planie; prompt odwołuje się do nich jako „zdjęcie 1”, „zdjęcie 2” (numer = miejsce na liście referencji ujęcia, po korektach kodu).
- Kod pilnuje kolejności w ujęciach z całym produktem: na początku czyste zdjęcia CAŁEGO produktu (z karty: rola calosc, forma zdjecie; przód, potem 3/4), dopiero za nimi detale. Grafika (strzałki wymiarów, linie, dodane napisy) idzie na koniec jako pomocnicza; kolaż i zdjęcie z innymi produktami nie są wysyłane. Bez czystego zdjęcia całości ujęcie z całym produktem nie jest generowane.
- Zwykle 2 referencje: główna (stan produktu w ujęciu) + uzupełniająca (efekt użycia albo całość).
- Referencje tylko z tym samym stanem produktu co w scenie.
- Przy zbliżeniu zawsze również zdjęcie całości.
- Detal z napisami (np. pilot) wyłącznie z kąta referencji.

### Ludzie i zwierzęta

| Liczba zdjęć | Cała postać | Dłonie | Bez ludzi |
| --- | --- | --- | --- |
| 1–2 | 0 | 0–1 | reszta |
| 3–5 | 1 | 1 | reszta |
| 6–10 | 2–3 | 1–2 | reszta, w tym detale |

- Przy produktach używanych w dłoni (ściereczki, urządzenia) dłonie mogą być w większości ujęć.
- Różnorodność wieku, płci i liczby osób w obrębie grupy docelowej.
- Postać to kupujący, nie usługodawca (bez fartuchów i uniformów sprzątaczki).
- Przy produktach dla zwierząt zwierzę jest bohaterem, kamera na wysokości jego oczu.

### Pora roku

Motyw sezonowy tylko przy produkcie sezonowym z natury (foremki do pierników = zima, kosiarka = lato, czapka LED = zima bez świąt). Produkty całoroczne bez śniegu, choinek i jesiennych liści, bo zdjęcia wiszą na aukcji miesiącami.

### Kadr z wnętrza pojemnika

Kadr z wnętrza pojemnika tylko wtedy, gdy otwór leży na osi kamery (torba na butelki z góry, bęben pralki). Torebka z zamkiem otwierana od góry = kadr z góry, nie z boku.

## Reguły specjalne

Reguły specjalne włączają flagi kategorii z karty produktu. „Blok do promptu” trafia dosłownie do promptu każdego ujęcia (oprócz ujęć detali, które mają krótszy wzorzec); „Zasady” czyta model w kroku planu i scen.

### Flaga: swieci – Produkty, które świecą
- pochodny: tak – blok zredagowany z akceptowanych zdjęć lampy dwugłowicowej (04.11)

#### Blok do promptu
Świecące elementy produktu świecą jednolitym, nasyconym kolorem na całej długości, z miękką poświatą wokół. Tuż za produktem lub pod nim jest powierzchnia, która łapie mocną plamę jego koloru; pomieszczenie dalej niż ok. 1 m od produktu zachowuje naturalne, ciepłe kolory. Nigdy blade ani białawe świecenie, nigdy przesadnie zabarwiony cały pokój ani neon klubowy.

#### Zasady
Produkty, które świecą – dawka światła (lampy do roślin, 04.11): wzorzec to akceptowane zdjęcia lampy dwugłowicowej. Intensywność budują trzy rzeczy: (1) listwy świecą jednolitym, nasyconym kolorem na całej długości (półprzezroczysty klosz) z miękką poświatą wokół – opis „przezroczysta tuba z rzędem diod” daje białawe kropki i tani, słaby wygląd; (2) w kadrze tuż za lampą lub pod nią jest powierzchnia, która łapie mocną plamę koloru (ściana, ościeżnica, plecy regału, blat); (3) liście pod lampą zabarwione, ale z widoczną zielenią, a pomieszczenie dalej niż ok. 1 m od lampy w naturalnych, ciepłych kolorach. Błędy: „pada miękko, szybko słabnie” = za słabo; „główne i najsilniejsze światło, zalewa wszystko” = cały kadr, dłonie, pilot i klips w magencie. Negative: „blade lub białawe listwy, przesadnie fioletowy cały pokój, neon klubowy”. Obudowa, ramiona i klips zawsze czarne. W tle nigdy drugi egzemplarz produktu. Detal z napisami (pilot) wyłącznie z kąta referencji. Lekcje z każdego produktu zapisywać od razu, żeby następny produkt z tej kategorii nie zaczynał od zera.

### Flaga: miekki – Miękkie produkty bez sztywnej formy
- pochodny: tak – blok zredagowany z korekty skali miękkich produktów (29.10)

#### Blok do promptu
Produkt jest miękki i bez sztywnej formy, ale zachowuje pełny rozmiar i proporcję z opisu skali: nie jest spłaszczony ani zmniejszony do rozmiaru torby na zakupy. Uchwyty dokładnie takie i w takiej liczbie jak na zdjęciach referencyjnych.

#### Zasady
Skala miękkich produktów bez sztywnej formy (worki, torby, kosze z plandeki, 29.10): model spłaszcza je i zmniejsza do rozmiaru torby na zakupy. Opis „sięga do bioder” nie wystarcza. W każdym ujęciu potrzebne są: proporcja („wyższy niż szeroki, ok. 5:4”), porównanie z przedmiotem o znanej wysokości tuż obok (taczka, siedzisko krzesła ogrodowego 45 cm, kompostownik), porównanie z ciałem osób w kadrze (dorosły: do połowy uda/bioder; dziecko 8 lat: do klatki piersiowej). W detalach z bliska skala ginie, więc obok musi być element odniesienia (dłoń, buty, grabie). Uchwyty zawsze opisane jako „wyłącznie na zewnątrz, dokładnie dwa górne i jeden dolny”.

### Flaga: pastelowy – Pastelowy kolor produktu
- pochodny: tak – blok zredagowany z zasady „ciepłe światło przesuwa pastelowe kolory produktu” i lekcji z worka do prania butów

#### Blok do promptu
Kolor produktu pozostaje dokładnie taki jak na zdjęciach referencyjnych, także w ciepłym świetle: bez przesunięcia odcienia w beż, róż ani żółć.

#### Zasady
Ciepłe światło przesuwa pastelowe kolory produktu → przy pastelowych produktach osobne zdanie chroniące kolor. Do pilnowania (worek do prania butów): ciepłe światło przesuwa szarą mikrofibrę w beż.

### Flaga: sezonowy – Produkt sezonowy z natury
- pochodny: tak – blok zredagowany z reguły „Pora roku”

#### Blok do promptu
Motyw pory roku zgodny z sezonem produktu, realistyczny i w umiarkowanej ilości.

#### Zasady
Motyw sezonowy tylko przy produkcie sezonowym z natury (foremki do pierników = zima, kosiarka = lato, czapka LED = zima bez świąt). Przy produktach sezonowych przepis „Reklama sezonowa” albo „Świąteczna aura”, zgodnie z kategorią.

### Flaga: sezon_uzycia – Produkt całoroczny używany głównie w jednej porze
- pochodny: tak – blok zredagowany z reguły „Sezon użycia”

#### Blok do promptu
Za oknem i w ubraniach osób widać porę roku, w której produkt jest głównie używany; bez dekoracji świątecznych.

#### Zasady
Sezon użycia: produkt całoroczny, którego używa się głównie w określonej porze (inhalator, nawilżacz = jesień i zima; wentylator = lato), w ujęciach z ludźmi pokazuje tę porę: śnieg i szron za oknem, ciepłe ubrania. Bez dekoracji świątecznych.

### Flaga: dla_zwierzat – Produkt dla zwierząt
- pochodny: tak – blok zredagowany z reguł „Ludzie i zwierzęta” oraz uczciwości

#### Blok do promptu
Zwierzę jest bohaterem kadru, kamera na wysokości jego oczu; wielkość zwierzęcia zgodna z ograniczeniami produktu.

#### Zasady
Przy produktach dla zwierząt zwierzę jest bohaterem, kamera na wysokości jego oczu. Położenie zwierzęcia na produkcie zgodne z jego budową (kot przy myszkach = najwyższe piętro). Wielkość i waga zwierzęcia zgodne z opisem (np. koty do 4 kg). Przepis „Lifestyle zwierząt”.

### Flaga: pasywny – Produkty pasywne i bezpieczeństwa
- pochodny: tak – blok zredagowany z akceptowanych ujęć czujnika czadu (29.10)

#### Blok do promptu
Ludzie w trakcie codziennej czynności, z pozytywną emocją (spokój, radość, bliskość); produkt ostry i czytelny jako naturalna część sceny.

#### Zasady
Produkty pasywne i bezpieczeństwa (czujniki, zamki, gaśnice): produkt sam niczego nie robi, więc zdjęcie sprzedaje życie, które chroni. Ludzie w centrum, w trakcie czynności, z pozytywną emocją (spokój, radość, bliskość), produkt ostry i czytelny w kadrze. Zagrożenie najwyżej w jednym ujęciu i pokazane przez spokojną reakcję, nie przez strach. Pusta ściana z produktem w roli głównej = stock.

Wzorzec, który działa (czujnik czadu, akceptowane ujęcia): „katalog IKEA / kampania marki domowej”: jasne, naturalne światło dnia z kontrolowaną ekspozycją (nic nie jest prześwietlone), pełne i zamieszkałe wnętrze z kolorowymi akcentami, ludzie w trakcie czynności z prawdziwą emocją, produkt jako naturalna część sceny.

### Flaga: elektronika – Elektronika i sprzęt zdrowotny
- pochodny: tak – blok zredagowany z zasady dla elektroniki i korekty z 29.10

#### Blok do promptu
Na produkcie neutralne lub chłodne, czyste światło z kontrolowaną ekspozycją, produkt najjaśniejszym punktem kadru; ciepło tylko jako akcent (lampka), nigdy jako filtr na całym zdjęciu.

#### Zasady
Elektronika i sprzęt zdrowotny: neutralne lub chłodne, czyste światło, kontrast, produkt najjaśniejszym punktem. Ciepło tylko jako akcent (lampka), nigdy jako filtr na całym zdjęciu. Korekta (czujnik czadu, 29.10): „chłodne i czyste” nie znaczy ciemne i szare – domyślnie jasne, naturalne światło dnia i wnętrza pełne życia.

### Flaga: mgielka – Mgiełka, para lub dym z produktu
- pochodny: tak – blok zredagowany z reguły „Mgiełka, para, dym”

#### Blok do promptu
Mgiełka wydobywa się wyłącznie z jednego miejsca produktu wskazanego w opisie sceny i płynie jako powolny, miękki obłok, jak oddech na mrozie; nigdy strumień ani linie przepływu.

#### Zasady
Mgiełka, para, dym: opisywać prędkość i zachowanie („powolny, miękki obłok jak oddech na mrozie”), nigdy „strumień” ani linie przepływu, bo daje to efekt spryskiwacza. Zawsze wskazać jedyne miejsce, z którego wylatuje.

### Flaga: ruch – Produkt w ruchu (np. auto RC)
- pochodny: tak – flaga wprowadzona dla stopki „ruch (auto RC)”; zasady z reguł planu i przepisu „Outdoor i akcja”

#### Zasady
Każde ujęcie z akcją ma element ruchu: kurz, piasek, śnieg, krople. Kamera przy ziemi; nawierzchnie z opisu. Stopka ujęć użycia z ruchem: „motion blur on wheels”.

### Flaga: skladany – Produkt składany lub montowany
- pochodny: nie

#### Zasady
Produkty składane pokazujemy w trakcie montażu, częściowo złożone. Rozwiązuje to liczenie elementów i skalę. Montaż z życiem: dwie osoby albo osoba z interakcją (kawa na kartonie, instrukcja, śmiech), zamieszkane wnętrze. Pusty biały pokój i pojedyncza postać wyglądają jak stock AI. Nie mieszamy dwóch stanów produktu w jednym kadrze (pokrowiec + goły stelaż = hybryda).

### Flaga: wiele_sztuk – Zestaw wielu sztuk lub elementów
- pochodny: nie

#### Zasady
Wiele sztuk w scenie z ludźmi: maksymalnie 2–3 widoczne. Pełny komplet tylko w hero. Ujęcie zestawu pokazuje wszystkie elementy z góry lub z wysokiego kąta, nigdy z poziomu blatu. Akcesoria połączone opisane jako jeden przedmiot z liczbą sztuk. Argumenty bez akcji (liczba sztuk, organizacja) tylko w hero.

### Flaga: wymienne_czesci – Produkt z wymiennymi częściami lub końcówkami
- pochodny: nie

#### Zasady
Przy produktach z wymiennymi częściami zawsze zdjęcie całości, nie same fragmenty. Akcesoria z zestawu w kształcie dokładnie takim jak na referencji (np. rękawica z dwoma palcami, nie z pięcioma).

### Flaga: w_dloni – Produkt używany w dłoni
- pochodny: nie

#### Zasady
Przy produktach używanych w dłoni (ściereczki, urządzenia) dłonie mogą być w większości ujęć. Przy produkcie w dłoni moduł STAN / CHWYT opisuje, która część dotyka skóry lub powierzchni, gdzie jest dłoń, gdzie drugi koniec. Bez porównań do przedmiotów o innym kształcie („jak długopis” zbudowało długopis).

### Flaga: kotwice_skali – Skala zależna od wysokości i osób w kadrze
- pochodny: nie

#### Zasady
Spójność kotwic skali: przed wysłaniem promptu silnik sprawdza rachunkiem, czy kotwice się nie wykluczają (np. figurka 50 cm stojąca na podłodze nie może mieć kuli na wysokości twarzy klęczącego dziecka, ok. 75 cm; model rozwiąże sprzeczność, powiększając produkt). Podest (stołek, komoda) podnosi produkt do potrzebnej wysokości.

## Wzorzec promptu
<!-- etapy: produkt, sceny -->

Prompt składa się z modułów w stałej kolejności: produkt i skala na początku, klimat krótko, stopka na końcu. Wcześniej opis wnętrza zajmował większość promptu i model traktował go jako ważniejszy od produktu. Kod składa prompt w kolejności: KIERUNEK (z przepisu), PRODUKT, SKALA, reguły specjalne, STAN / CHWYT, MOMENT, KADR, POSTAĆ, SCENOGRAFIA, STOPKA, NEGATIVE. Model pisze tylko części zależne od produktu i sceny; stałe teksty pochodzą z bazy wiedzy.

1. PRODUKT (raz na zlecenie, identyczny we wszystkich ujęciach z całym produktem): „identyczny jak na zdjęciach referencyjnych”, budowa w kolejności elementów, kolor, napisy („wierny albo nieczytelny, nigdy przekręcony”), czego produkt NIE jest („to nie jest mebel z płyty”), zakaz kopiowania dodatków z referencji.
2. SKALA (raz na zlecenie): wymiary w cm i calach + porównanie z przedmiotem tuż obok produktu (kubek, butelka 2 l, klamka, dłoń). W szerokich kadrach proporcja do ściany lub mebla. Przy produktach prawie kwadratowych główną kotwicą jest proporcja, nie sama wysokość.
3. STAN / CHWYT: w jakim stanie jest produkt. Przy produkcie w dłoni: która część dotyka skóry lub powierzchni, gdzie jest dłoń, gdzie drugi koniec. Bez porównań do przedmiotów o innym kształcie („jak długopis” zbudowało długopis).
4. MOMENT: konkretna sytuacja z argumentem sprzedażowym i elementem ruchu. Zaczyna się od czasownika i emocji.
5. KADR: format, kąt kamery w stopniach, wysokość, odległość, obiektyw, położenie elementów w procentach kadru. Obiektyw 50–100 mm dla produktów; szeroki kąt podbija skalę obiektu na pierwszym planie.
6. POSTAĆ: wiek, wygląd, ubiór, mimika; „nikt nie patrzy w obiektyw”, chyba że ujęcie lustra.
7. SCENOGRAFIA: w ujęciach szerokich konkretne elementy; w zbliżeniach tylko jako rozmyte plamy koloru i światła.

Ujęcia detali dostają krótszy wzorzec: KIERUNEK, opis detalu skopiowanego 1:1 z referencji (zmienione tylko tło, światło i jeden element), KADR z kątem z referencji, STOPKA detalu, NEGATIVE.

Pierwszy test z kierunkami kreatywnymi (worek do prania butów, 10 ujęć, 7 referencji): wszystkie 10 zaakceptowane za pierwszym razem. Kolejność „moment i emocja → światło → kadr → produkt → scenografia” w opisie sceny oraz przed i po w jednym kadrze dają poziom kampanii marek.

## Wierność produktu – lista kontrolna
<!-- etapy: produkt -->

Moduł PRODUKT musi pokryć każdy punkt tej listy konkretnie dla tego produktu (bez kopiowania listy do modułu):

{{fidelity_rules}}

## Blok wiązania zdjęć

Kod wstawia ten blok na początku promptu każdego ujęcia, z numerami zdjęć w kolejności wysłania do modelu obrazu. {lista} – numery zdjęć całego produktu („1 i 2”), {n} – numer zdjęcia, {opis} – widok z karty produktu.

- calosc_1: Zdjęcie {lista} przedstawia dokładnie produkt, który należy odwzorować. Zachowaj identyczną konstrukcję, proporcje, materiały, kolory, elementy i oznaczenia. Nie zastępuj go innym produktem tej kategorii.
- calosc_n: Zdjęcia {lista} przedstawiają dokładnie ten sam produkt, który należy odwzorować. Zachowaj identyczną konstrukcję, proporcje, materiały, kolory, elementy i oznaczenia. Nie zastępuj go innym produktem tej kategorii.
- detal: Zdjęcie {n} przedstawia detal tego samego produktu ({opis}) i służy wyłącznie do wiernego odtworzenia tego elementu.
- pomocnicze: Zdjęcie {n} to grafika pomocnicza ({opis}): użyj jej tylko do rozpoznania szczegółów produktu; nie odtwarzaj strzałek, linii, liczb, napisów ani innych elementów grafiki.
- logo: Logo i napisy produktu wyłącznie w ich rzeczywistych miejscach na produkcie, nigdy na innych przedmiotach ani w tle.
- detal_glowny: Zdjęcie 1 przedstawia detal produktu ({opis}) do odtworzenia 1:1.
- kontekst: Zdjęcie {lista} pokazuje cały produkt i służy wyłącznie do zachowania spójności kolorów, materiałów i proporcji.

## Stopki

Stopka zawsze jest w prompcie: w testach daje wyraźną poprawę realizmu i światła. Kod dobiera stopkę po typie ujęcia (detal), przepisie, fladze i ludziach; bez dopasowania – stopka domyślna.

### Stopka: detal
- typ: detal

Ultra realistic, 8k, cinematic light, realistic materials, sharp focus on texture.

### Stopka: zwierzeta
- przepis: lifestyle_zwierzat

Ultra realistic, 8k, soft natural window light, realistic materials, shallow depth of field.

### Stopka: beauty
- przepis: beauty_edytorski

Ultra realistic, 8k, cinematic warm golden light, editorial beauty photography, realistic glowing skin, realistic materials, shallow depth of field.

### Stopka: wnetrza_premium
- przepis: wnetrza_premium

Ultra realistic, 8k, cinematic light, sharp focus, realistic materials, premium real estate visualization.

### Stopka: ruch
- flaga: ruch
- typ: uzycie

Ultra realistic, 8k, cinematic light, realistic materials, shallow depth of field, motion blur on wheels.

### Stopka: akcja
- typ: uzycie

Ultra realistic, 8k, cinematic light, realistic materials, shallow depth of field.

### Stopka: wnetrze
- domyslna: tak

Ultra realistic, 8k, cinematic light, sharp focus, realistic materials.

## Negative bazowy

Do bazy kod dopisuje ryzyka z karty (np. „szafa sięgająca do ramion”, „woda, kałuże”, „kocięta z referencji”), dopiski przepisu i dopiski ujęcia.

```
render, CGI, 3D, plastikowa skóra, sztuczny uśmiech, patrzenie w obiektyw, zniekształcone dłonie, dodatkowe palce, inny kolor produktu, inny kształt, przekręcone napisy, inne logo, napisy, metki, etykiety na kosmetykach i butelkach, amerykańskie wnętrze, flara, słońce w kadrze, przesycone kolory, efekt wklejenia, kolaż, logo lub napisy produktu na innych przedmiotach i w tle, drugi egzemplarz produktu
```
