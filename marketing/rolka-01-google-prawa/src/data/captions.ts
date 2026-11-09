import { WORDS } from "./words";

// Caption phrases = spoken text, verbatim, split for reading rhythm (word index ranges, inclusive).
// `hl` = word indices drawn as keywords; colour per tone.
export type Tone = "alarm" | "brand" | "info" | "ok";
export type CaptionGroup = { from: number; to: number; hl?: Record<number, Tone> };

export const CAPTION_GROUPS: CaptionGroup[] = [
  { from: 0, to: 3, hl: { 3: "info" } }, // Znalazłeś zdjęcie w Google?
  { from: 4, to: 7, hl: { 4: "alarm" } }, // Uważaj, bo wykorzystanie go
  { from: 8, to: 11, hl: { 10: "alarm", 11: "alarm" } }, // może Cię słono kosztować!
  { from: 12, to: 15, hl: { 13: "info", 14: "info" } }, // Google tylko wyszukuje zdjęcia.
  { from: 16, to: 21, hl: { 17: "alarm" } }, // To nie znaczy, że możesz je
  { from: 22, to: 23, hl: { 22: "info" } }, // swobodnie wykorzystywać
  { from: 24, to: 26, hl: { 26: "brand" } }, // na swojej stronie,
  { from: 27, to: 31, hl: { 28: "brand", 30: "brand", 31: "brand" } }, // w sklepie czy social mediach.
  { from: 32, to: 33, hl: { 33: "alarm" } }, // I uwaga.
  { from: 34, to: 37, hl: { 36: "info" } }, // Nawet jeśli przytniesz zdjęcie,
  { from: 38, to: 39, hl: { 38: "info", 39: "info" } }, // usuniesz tło
  { from: 40, to: 44, hl: { 41: "info", 44: "brand" } }, // albo przerobisz je przez AI,
  { from: 45, to: 47, hl: { 45: "alarm", 46: "alarm" } }, // nie oznacza to,
  { from: 48, to: 52, hl: { 52: "alarm" } }, // że masz do niego prawa.
  { from: 53, to: 55, hl: { 55: "brand" } }, // Jak to sprawdzić?
  { from: 56, to: 59, hl: { 58: "info", 59: "info" } }, // Wejdź w grafikę Google,
  { from: 60, to: 61, hl: { 61: "brand" } }, // kliknij Narzędzia,
  { from: 62, to: 65, hl: { 64: "brand", 65: "brand" } }, // a następnie Prawa użytkowania.
  { from: 66, to: 67 }, // Pamiętaj jednak,
  { from: 68, to: 70, hl: { 69: "info", 70: "info" } }, // żeby zawsze sprawdzić
  { from: 71, to: 74, hl: { 71: "brand", 72: "brand", 74: "brand" } }, // warunki licencji u źródła,
  { from: 75, to: 77, hl: { 75: "info" } }, // szczególnie jeśli wykorzystujesz
  { from: 78, to: 79, hl: { 79: "alarm" } }, // zdjęcie komercyjnie.
  { from: 80, to: 84, hl: { 83: "info", 84: "info" } }, // A jeśli potrzebujesz własnych grafik,
  { from: 85, to: 89 }, // możesz tworzyć je za pomocą
  { from: 90, to: 93, hl: { 90: "info", 91: "info", 93: "brand" } }, // ChatGPT, Gemini albo GrovBase,
  { from: 94, to: 96, hl: { 95: "brand" } }, // które specjalizuje się
  { from: 97, to: 99, hl: { 98: "brand", 99: "brand" } }, // w zdjęciach produktowych.
  { from: 100, to: 101 }, // Pamiętaj tylko,
  { from: 102, to: 105, hl: { 105: "info" } }, // żeby korzystać z materiałów,
  { from: 106, to: 110, hl: { 109: "ok", 110: "ok" } }, // do których masz odpowiednie prawa,
  { from: 111, to: 113, hl: { 112: "info", 113: "info" } }, // i sprawdzać warunki
  { from: 114, to: 115, hl: { 115: "info" } }, // używania narzędzi.
  { from: 116, to: 118, hl: { 116: "brand" } }, // Zapisz tę rolkę,
  { from: 119, to: 123, hl: { 122: "alarm", 123: "alarm" } }, // żeby nie popełnić kosztownego błędu!
  { from: 124, to: 125, hl: { 125: "brand" } }, // A ty?
  { from: 126, to: 130, hl: { 128: "ok", 130: "ok" } }, // Sprawdzałeś wcześniej prawa do zdjęć?
  { from: 131, to: 135, hl: { 134: "alarm" } }, // Czy po prostu pobierałeś je
  { from: 136, to: 138, hl: { 138: "info" } }, // z wyszukiwarki Google?
];

export const groupStart = (g: CaptionGroup) => WORDS[g.from].s;
export const groupEnd = (g: CaptionGroup) => WORDS[g.to].e;
