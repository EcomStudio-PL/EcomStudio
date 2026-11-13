# GrovBase — Dokumenty prawne V1 (PL) — raport wdrożenia

Data: 2026-10-23 · Gałąź: `claude/ecomstudio-extract-push-f8ceir` · `main` → `55d0de7`
Produkcja: Vercel `ecomstudio-prod` `dpl_7UdJ5uuV1YhjBbAqyXn6qExz1Rjp` (READY, grovbase.com)
Punkt powrotu: `ed0a4be` / `dpl_AUkVJitsCD8v2MJyF5YqUs3ZvWJ4` + wersje „Przed importem: …” w Historii CMS.

## 1. Przyczyna limitu długości

Nie jeden limit, tylko trzy ścieżki, z których żadna nie obsługiwała dokumentu prawnego:

| Gdzie | Co blokowało | Odniesienie (kod sprzed zmian, `ed0a4be`) |
|---|---|---|
| Edytor wizualny (ICE) | pola tekstowe ≤ 2000 znaków w UI i akcji serwera, ≤ 4000 w bazie; strony prawne nie były z niego wyłączone | `lib/ice/validate.ts:28`, `lib/server/ice/actions.ts:642`, `0141_inline_content_editor.sql:507` |
| Page Builder, sekcja `legal` | pole edycji zapisywało `description`, a strona renderowała najpierw `html` — zmiany admina bywały niewidoczne; tekst renderowany jako zwykłe akapity, bez struktury | `lib/cms-schema.ts:98`, `components/cms/blocks.tsx:257-265` |
| Stan PROD | Regulamin wklejony do zwykłej sekcji `text` (tytuł „Regulanin”), Polityka prywatności = szkic z zaślepką | dane PROD przed importem |

Baza (`jsonb`, TEXT) i akcja zapisu CMS nie miały twardego limitu — problem był w ścieżkach edycji i renderowania.

## 2. Naprawa

- Jeden CMS: dokument = sekcja `legal` z polem `doc` = `{pl|en|de: {status, text, version, effective, sha256, chars}}` (`lib/legal/content.ts`). Tekst zapisywany 1:1 (jedyna normalizacja: CRLF→LF, BOM). Limit: 1 000 000 znaków na język, 1 400 000 łącznie (`MAX_LEGAL_CHARS`). Limity reszty CMS bez zmian.
- Edytor (`components/admin/cms/legal-doc-field.tsx`): wgranie .txt (UTF-8, ostrzeżenie o U+FFFD), wklejanie, licznik znaków i wierszy, podgląd tym samym rendererem co strona, pełny ekran bez utraty kursora, pobranie zapisanego .txt (dokładnie tej sekcji), wersja i data, statusy PL/EN/DE, przeniesienie starego tekstu sekcji.
- sha256/chars liczone na serwerze przy zapisie; Publikuj nie publikuje, gdy zapis został odrzucony.
- ICE nie edytuje stron prawnych (wymuszone po stronie serwera).
- Strony publiczne `/regulamin`, `/polityka-prywatnosci`, `/polityka-cookies`, `/umowa-powierzenia-danych`: każda linia pliku = jeden element (numeracja z pliku, bez generowania), spis treści z prawdziwych nagłówków, wersja i data, PDF, linki „powiązane dokumenty” (DPA ↔ Załącznik nr 2), kontrast WCAG AA, mobile.
- PDF `/<slug>/pdf`: A4, Inter (osadzony, polskie znaki), numeracja „Strona X z Y”, zakładki, tag wersji w URL (`?v=`) i ETag z tekstu+wersji+daty+języka.
- Import (0146 + 0147): tekst w częściach ≤ 20 000 znaków, funkcja sklejająca z kontrolą liczby części, znaków i sha256; jednorazowy (`already_imported`), chroni tekst admina (`legal_import_conflict`), zapisuje wersję „Przed importem”, ukrywa (nie usuwa) stare sekcje, publikuje.

## 3. Gdzie admin edytuje

`/admin/www` → panel **„Dokumenty prawne”** (4 wiersze: status, wersja, data, znaki, sha256, ostrzeżenia PDF) → **Edytuj** (`/admin/www/<slug>`, sekcja „Dokument prawny”): zakładki PL/EN/DE, wgraj .txt / wklej, zapis automatyczny (szkic), **Podgląd**, **Publikuj**; **Historia** (`/admin/www/<slug>/historia`) — przywracanie wersji; **Pobierz zapisany tekst (.txt)**; **PDF**.

## 4. Status dokumentów (PROD)

| Dokument | Status | Wersja | Obowiązuje od | PL | EN | DE |
|---|---|---|---|---|---|---|
| Regulamin | opublikowany | 1.0 | 2026-10-20 | aktywny | wkrótce | wkrótce |
| Polityka prywatności | opublikowany | 1.0 | 2026-10-20 | aktywny | wkrótce | wkrótce |
| Polityka cookies | opublikowany (nowa strona) | 1.0 | 2026-10-20 | aktywny | wkrótce | wkrótce |
| Umowa powierzenia (Załącznik nr 2) | opublikowany (nowa strona) | 1.0 | 2026-10-20 | aktywny | wkrótce | wkrótce |

## 5. Znaki przed / po

| Dokument | Przed (PROD) | Po (PROD) | Plik |
|---|---|---|---|
| Regulamin | 75 254 (sekcja `text`, plik bez końcowego `\n`) | 75 255 | 75 255 |
| Polityka prywatności | szkic, zaślepka 137 zn. + spis „W przygotowaniu.” (niepubliczny) | 25 157 | 25 157 |
| Polityka cookies | brak strony | 7 964 | 7 964 |
| Umowa powierzenia | brak strony | 13 568 | 13 568 |

## 6. Porównanie źródło ↔ publikacja (SHA-256)

A = plik, B = baza (szkic i opublikowany snapshot), C = ponowny odczyt (.txt z panelu, lokalnie), D = strona publiczna (tekst znormalizowany co do białych znaków), PDF = pdftotext.

| Dokument | A = B (PROD) | C (lokalnie) | D (grovbase.com) | PDF (grovbase.com) |
|---|---|---|---|---|
| Regulamin | `151b56dac58febce…` ✔ | bajt w bajt ✔ | równe ✔ | 119 398 B, 26 str., ID `8c69562d…` = render lokalny, tekst = plik ✔ |
| Polityka prywatności | `7d0c1b6fbe3b5f3e…` ✔ | ✔ | równe ✔ | 53 659 B, 9 str., ID `5a8277d5…` ✔ |
| Polityka cookies | `0cd23f4b95e1d7f4…` ✔ | ✔ | równe ✔ | 30 866 B, 4 str., ID `170df212…` ✔ |
| Umowa powierzenia | `a572bc928eaeff3b…` ✔ | ✔ | równe ✔ | 37 421 B, 6 str., ID `cdab6b9a…` ✔ |

Każda część importu sprawdzona osobno na PROD (znaki + sha256 = plik), funkcja importu na PROD = plik repo (md5 ciała `2edcc24a…`).

## 7. Testy

- Lokalne E2E na kopii stanu PROD (Playwright, prawdziwe logowanie z kodem e-mail): testy 1–13, 15 PASS; 14 PARTIAL (sporadyczny React #418 w kreatorze admina, 2× na kilkadziesiąt wejść, nieodtwarzalny w 17 próbach, bez wpływu na zapis); 16 PARTIAL (landing przedpremierowy sprawdzony przez podgląd admina — pliki landingu bez zmian w diffie; na PROD sprawdzony bezpośrednio: formularze i linki zgód działają).
- Niezależna weryfikacja (drugi agent, tylko odczyt): A/B/C/D/PDF zgodne dla 4 dokumentów, w tym 320/375/768/1280 px, jasny/ciemny.
- Edytor: 75 255 znaków zapis → odczyt → edycja → wgranie .txt → publikacja → przywrócenie z Historii — wszystko przez UI, stan końcowy = pliki.
- Okno między wdrożeniem kodu a importem: nowy kod pokazuje dotychczasowy Regulamin w całości (sprawdzone lokalnie i na grovbase.com).
- Import: idempotentny (drugie uruchomienie wszystkich 14 części = `unchanged`, zero zmian).
- Zestawy: typecheck ✔; legal render / PDF (219) / admin (181) / SQL (202) ✔; regresja 109/110 ✔ — jedyny błąd `test:tilebytes` istnieje na `main` przed zmianą (pliki, których dotyczy, nie były zmieniane).
- PDF kompletne: A4, Inter osadzony, „Strona N z N”, Regulamin zawiera Rozdział IX, Załącznik nr 1, Załącznik nr 2, Historia wersji; DPA zawiera Załącznik A i B.

## 8. Linki

- https://grovbase.com/regulamin — PDF: https://grovbase.com/regulamin/pdf
- https://grovbase.com/polityka-prywatnosci — PDF: https://grovbase.com/polityka-prywatnosci/pdf
- https://grovbase.com/polityka-cookies — PDF: https://grovbase.com/polityka-cookies/pdf
- https://grovbase.com/umowa-powierzenia-danych — PDF: https://grovbase.com/umowa-powierzenia-danych/pdf

Linkowanie: formularz przedpremierowy (Regulamin, Polityka prywatności), rejestracja, kasa (linia prawna), stopki (SiteFooter: wszystkie 4; /plany: + Polityka cookies), DPA ↔ Regulamin (Załącznik nr 2, bez osobnego checkboxa). Logika zgód, rejestracji i płatności bez zmian; import nie dotyka tabel zgód.

## 9. Języki

PL — aktywny. EN, DE — „Wkrótce”: strona pokazuje komunikat z bezpośrednim linkiem do pełnej wersji polskiej i polskiego PDF; brak automatycznych tłumaczeń. Panel ma miejsce na EN/DE (status, tekst, wersja, data) — gotowe na tłumaczenia.

## 10. Commit i wdrożenie

- Kod: `main` = `55d0de7` (gałąź robocza zawiera pełną historię), produkcja `dpl_7UdJ5uuV1YhjBbAqyXn6qExz1Rjp`.
- Migracje PROD (MCP): `20261023163013 legal_documents`, `20261023163130…163903 legal_documents_v1_pl_01…13`.
- Kolejność: kod → 0146 → 0147 (13 części). Wycofanie kodu po 0147: przywrócić i opublikować wersję „Przed importem” Regulaminu, pozostałe trzy strony cofnąć do szkicu.

## 11. Rozbieżności prawne do decyzji właściciela (tekst NIE był zmieniany)

1. **Języki.** Regulamin § 5 ust. 1 („Serwis jest dostępny w języku polskim, angielskim i niemieckim”) i § 31 ust. 3 („Regulamin jest udostępniany w języku polskim, angielskim i niemieckim. Wobec Konsumenta wiążąca jest wersja językowa, w której zawarł umowę”) — wersje EN/DE dokumentów nie istnieją („Wkrótce”).
2. **Cookies.** Polityka cookies pkt 2 ust. 3, 3.3 i 4 (baner, GA dopiero po zgodzie, „Odrzuć wszystkie”, link „Ustawienia cookies” w stopce, `ecs_first_touch` za zgodą) oraz Polityka prywatności pkt 14 — w aplikacji nie ma banera ani ustawień cookies, a Google Analytics ładuje się bez zgody (`components/analytics/google-analytics.tsx`).
3. **Lista oczekujących.** Polityka prywatności pkt 3 (lista oczekujących: art. 6 ust. 1 lit. b, „nie zawiera treści promocyjnych”) — formularz przedpremierowy V2 wymaga zgody marketingowej i zapisuje UTM/polecenia/kanał.
4. **Powiadomienia wewnętrzne.** Polityka prywatności pkt 7 ust. 4 („zawierają wyłącznie techniczny identyfikator Konta i rodzaj zdarzenia. Nie zawierają imienia, adresu e-mail, adresu IP ani odpowiedzi z ankiety”) — powiadomienia `user.registered` (`app/auth/callback/route.ts:137-165`), `waitlist.signup` (`lib/server/prelaunch/attribution.ts:42-79`) i `welcome.survey_completed` (`app/actions/welcome-bonus.ts:77-107`) zawierają imię i nazwisko, e-mail, a odpowiednio IP/urządzenie i odpowiedzi z ankiety.
5. **Rejestracja.** Regulamin § 6 ust. 1 i § 9 ust. 4 (oświadczenie o wieku, odrębna akceptacja cech Wyników z § 9 ust. 3) — formularz rejestracji ma jeden checkbox „Akceptuję Regulamin oraz Politykę Prywatności”.
6. **Zakup.** Regulamin § 9 ust. 4, § 18 ust. 2, § 24 ust. 4 (checkboxy przy zamówieniu, zapis akceptacji, „Zamawiam z obowiązkiem zapłaty”) — kasa nie zapisuje akceptacji dokumentów (sprawdzić przed włączeniem płatności).
7. **Odstąpienie / wypowiedzenie.** Regulamin § 24 ust. 3 pkt 1 („Odstąp od umowy tutaj” w Koncie i stopce) oraz § 18 ust. 5 pkt 2 („Wypowiedz umowę tutaj” bez logowania) — takie funkcje nie istnieją.
8. **PDF w e-mailu.** Regulamin § 18 ust. 3 (Regulamin w PDF w potwierdzeniu) — wysyłka e-mail nie obsługuje załączników (możliwy link do `/regulamin/pdf`).
9. **Archiwum wersji.** Regulamin § 28 ust. 5 i Polityka prywatności pkt 16 („wersje dostępne w Serwisie”) — historia wersji istnieje tylko w panelu admina.
10. **Wersja zgody.** Zapisy zgód przechowują jako wersję dokumentu datę publikacji strony (`published_at`), nie numer „1.0”; każda publikacja zmienia ten znacznik. Import nie zmienił żadnej istniejącej zgody.
